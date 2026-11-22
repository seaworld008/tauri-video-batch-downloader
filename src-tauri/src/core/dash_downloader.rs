//! MPEG-DASH (.mpd) 原生流媒体下载器
//!
//! 支持：
//! - MPD 清单解析（SegmentTemplate / SegmentTimeline / SegmentList / SegmentBase）
//! - 多码率视频与多语言音轨自动选择（format_selector / preferred_language）
//! - fMP4 初始化分片去重缓存与拼接
//! - Range 字节分片请求（HTTP 206 校验）
//! - 原子写入（.seg.tmp -> .seg 与 .part 提交）、暂停分片复用、指数退避重试
//! - 独立音视频轨 FFmpeg 无损混流与可选单轨重封装

use crate::core::dash_parser::{
    parse_dash_manifest, select_dash_tracks, DashInitSegment, DashRepresentation,
};
use crate::core::downloader::{BandwidthController, DownloadStats};
use crate::core::ffmpeg_muxer::{mux_av_streams, remux_single_stream, resolve_ffmpeg_binary};
use crate::core::models::TaskStatus;
use crate::core::part_file::derive_part_path;
use anyhow::{anyhow, bail, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, RwLock, Semaphore};

#[derive(Debug)]
struct NonRetryableSegmentError(String);

impl std::fmt::Display for NonRetryableSegmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for NonRetryableSegmentError {}

/// MPEG-DASH 下载器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashDownloaderConfig {
    /// 最大并发分片下载数
    pub max_concurrent_segments: usize,
    /// 请求超时时间（秒）
    pub timeout: u64,
    /// 重试次数
    pub retry_attempts: usize,
    /// 文件合并缓冲区大小（字节）
    pub buffer_size: usize,
    /// 用户代理
    pub user_agent: String,
    /// 临时分片根目录
    pub temp_dir: PathBuf,
    /// 是否保留临时分片目录
    pub keep_temp_files: bool,
}

impl Default for DashDownloaderConfig {
    fn default() -> Self {
        Self {
            max_concurrent_segments: 8,
            timeout: 30,
            retry_attempts: 3,
            buffer_size: 64 * 1024,
            user_agent: "VideoDownloaderPro/1.0.0".to_string(),
            temp_dir: std::env::temp_dir().join("video_downloader_dash"),
            keep_temp_files: false,
        }
    }
}

/// 单任务作用域 DASH 下载上下文
#[derive(Clone, Default)]
pub struct DashDownloadContext {
    pub cancel_flag: Arc<AtomicBool>,
    pub pause_flag: Arc<AtomicBool>,
    pub progress_tx: Option<mpsc::UnboundedSender<(String, DownloadStats)>>,
    pub bandwidth_controller: Option<BandwidthController>,
    pub client_override: Option<Client>,
    pub format_selector: Option<String>,
    pub preferred_language: Option<String>,
    pub output_container: Option<String>,
    pub ffmpeg_path: Option<PathBuf>,
}

/// MPEG-DASH 下载引擎
pub struct DashDownloader {
    config: DashDownloaderConfig,
    client: Client,
    active_downloads: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    pause_flags: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
}

impl DashDownloader {
    pub fn new(config: DashDownloaderConfig) -> Result<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(config.timeout))
            .read_timeout(Duration::from_secs(config.timeout))
            .user_agent(&config.user_agent)
            .build()?;

        std::fs::create_dir_all(&config.temp_dir)?;

        Ok(Self {
            config,
            client,
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
            pause_flags: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    fn resolve_safe_task_temp_dir(base_dir: &Path, task_id: &str) -> Result<PathBuf> {
        let sanitized = crate::utils::file_utils::sanitize_filename(task_id);
        let candidate = Path::new(&sanitized);
        let mut components = candidate.components();
        match (components.next(), components.next()) {
            (Some(std::path::Component::Normal(_)), None) if !sanitized.is_empty() => {
                Ok(base_dir.join(sanitized))
            }
            _ => bail!("非法的 DASH 任务临时目录标识: {}", task_id),
        }
    }

    pub async fn download_dash(
        &self,
        task_id: &str,
        mpd_url: &str,
        output_path: &str,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<()> {
        self.download_dash_with_options(
            task_id,
            mpd_url,
            output_path,
            DashDownloadContext {
                pause_flag,
                ..Default::default()
            },
        )
        .await
    }

    pub async fn download_dash_with_options(
        &self,
        task_id: &str,
        mpd_url: &str,
        output_path: &str,
        ctx: DashDownloadContext,
    ) -> Result<()> {
        crate::utils::validation::assert_http_url(mpd_url)?;
        tracing::info!("开始下载 MPEG-DASH 流: {}", mpd_url);

        let task_temp_dir = Self::resolve_safe_task_temp_dir(&self.config.temp_dir, task_id)?;
        tokio::fs::create_dir_all(&task_temp_dir).await?;

        {
            let mut downloads = self.active_downloads.write().await;
            downloads.insert(task_id.to_string(), Arc::clone(&ctx.cancel_flag));
        }
        {
            let mut flags = self.pause_flags.write().await;
            flags.insert(task_id.to_string(), Arc::clone(&ctx.pause_flag));
        }

        let client = ctx
            .client_override
            .clone()
            .unwrap_or_else(|| self.client.clone());

        let pipeline_result: Result<()> = self
            .run_pipeline(task_id, mpd_url, output_path, &task_temp_dir, &client, &ctx)
            .await;

        {
            let mut downloads = self.active_downloads.write().await;
            downloads.remove(task_id);
        }
        {
            let mut flags = self.pause_flags.write().await;
            flags.remove(task_id);
        }

        match pipeline_result {
            Ok(()) => {
                if !self.config.keep_temp_files {
                    self.cleanup_temp_files(&task_temp_dir).await?;
                }
                tracing::info!("DASH 下载完成: {}", output_path);
                Ok(())
            }
            Err(err) => {
                let is_paused = err.to_string().contains("download_paused");
                if is_paused || self.config.keep_temp_files {
                    tracing::info!(
                        "保留 DASH 已下载分片以便后续恢复 ({}): {}",
                        if is_paused {
                            "paused"
                        } else {
                            "keep_temp_files"
                        },
                        task_temp_dir.display()
                    );
                } else {
                    self.cleanup_temp_files(&task_temp_dir).await.ok();
                }
                Err(err)
            }
        }
    }

    async fn run_pipeline(
        &self,
        task_id: &str,
        mpd_url: &str,
        output_path: &str,
        task_temp_dir: &Path,
        client: &Client,
        ctx: &DashDownloadContext,
    ) -> Result<()> {
        if ctx.cancel_flag.load(Ordering::Relaxed) || ctx.pause_flag.load(Ordering::Relaxed) {
            return Err(Self::interrupt_error(&ctx.cancel_flag));
        }

        let response = client.get(mpd_url).send().await?;
        let status = response.status();
        if !status.is_success() {
            bail!("获取 MPD 清单失败: HTTP {}", status);
        }
        let xml = response.text().await?;
        let manifest = parse_dash_manifest(mpd_url, &xml)?;

        let selection = select_dash_tracks(
            &manifest,
            ctx.format_selector.as_deref(),
            ctx.preferred_language.as_deref(),
        );

        match (selection.video, selection.audio) {
            (Some(video), Some(audio)) => {
                let video_temp = task_temp_dir.join("video");
                let audio_temp = task_temp_dir.join("audio");
                tokio::fs::create_dir_all(&video_temp).await?;
                tokio::fs::create_dir_all(&audio_temp).await?;

                let video_raw = task_temp_dir.join("video_track.raw");
                let audio_raw = task_temp_dir.join("audio_track.raw");

                let audio_ctx = DashDownloadContext {
                    progress_tx: None,
                    ..ctx.clone()
                };

                self.download_representation(
                    task_id,
                    video,
                    &video_raw.to_string_lossy(),
                    &video_temp,
                    client,
                    ctx,
                    false,
                )
                .await?;

                self.download_representation(
                    task_id,
                    audio,
                    &audio_raw.to_string_lossy(),
                    &audio_temp,
                    client,
                    &audio_ctx,
                    false,
                )
                .await?;

                let Some(ffmpeg) = resolve_ffmpeg_binary(ctx.ffmpeg_path.as_deref()).await else {
                    bail!("ffmpeg_missing: separate DASH video/audio muxing requires ffmpeg");
                };

                mux_av_streams(
                    &ffmpeg,
                    &video_raw,
                    &audio_raw,
                    Path::new(output_path),
                    ctx.output_container.as_deref(),
                )
                .await
            }
            (Some(track), None) | (None, Some(track)) => {
                self.download_representation(
                    task_id,
                    track,
                    output_path,
                    task_temp_dir,
                    client,
                    ctx,
                    true,
                )
                .await
            }
            (None, None) => {
                bail!("MPD 清单中未找到可下载的音视频轨道");
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn download_representation(
        &self,
        task_id: &str,
        rep: &DashRepresentation,
        output_path: &str,
        track_temp_dir: &Path,
        client: &Client,
        ctx: &DashDownloadContext,
        allow_remux: bool,
    ) -> Result<()> {
        if rep.segments.is_empty() {
            bail!("DASH 轨道 {} 不包含任何可下载分片", rep.id);
        }

        tokio::fs::create_dir_all(track_temp_dir).await?;
        let init_paths = self
            .download_unique_init_segments(
                rep,
                track_temp_dir,
                client,
                Arc::clone(&ctx.cancel_flag),
                Arc::clone(&ctx.pause_flag),
                ctx.bandwidth_controller.clone(),
            )
            .await?;

        let segment_files = self
            .download_segments(task_id, rep, track_temp_dir, client, ctx)
            .await?;

        self.merge_track_segments(
            rep,
            &segment_files,
            &init_paths,
            track_temp_dir,
            output_path,
            ctx.output_container.as_deref(),
            ctx.ffmpeg_path.as_deref(),
            allow_remux,
        )
        .await
    }

    async fn download_unique_init_segments(
        &self,
        rep: &DashRepresentation,
        track_temp_dir: &Path,
        client: &Client,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        bandwidth_controller: Option<BandwidthController>,
    ) -> Result<HashMap<DashInitSegment, PathBuf>> {
        let mut seen = HashSet::new();
        let mut init_list = Vec::new();

        if let Some(init) = &rep.init_segment {
            if seen.insert(init.clone()) {
                init_list.push(init.clone());
            }
        }
        for segment in &rep.segments {
            if let Some(init) = &segment.init_segment {
                if seen.insert(init.clone()) {
                    init_list.push(init.clone());
                }
            }
        }

        let mut resolved = HashMap::new();
        for (idx, init) in init_list.into_iter().enumerate() {
            let init_path = track_temp_dir.join(format!("init_{idx:03}.seg"));
            Self::download_segment_with_retries(
                client,
                &self.config,
                &init.url,
                &init_path,
                init.byte_range,
                cancel_flag.clone(),
                pause_flag.clone(),
                bandwidth_controller.clone(),
            )
            .await?;
            resolved.insert(init, init_path);
        }

        Ok(resolved)
    }

    async fn download_segments(
        &self,
        task_id: &str,
        rep: &DashRepresentation,
        track_temp_dir: &Path,
        client: &Client,
        ctx: &DashDownloadContext,
    ) -> Result<Vec<PathBuf>> {
        let total_segments = rep.segments.len();
        let downloaded_segments = Arc::new(AtomicU64::new(0));
        let total_bytes_downloaded = Arc::new(AtomicU64::new(0));
        let start_time = Instant::now();
        let semaphore = Arc::new(Semaphore::new(self.config.max_concurrent_segments.max(1)));

        let mut handles = Vec::with_capacity(total_segments);
        let mut segment_files = Vec::with_capacity(total_segments);

        for segment in &rep.segments {
            let segment_path = track_temp_dir.join(format!("segment_{:06}.seg", segment.index));
            segment_files.push(segment_path.clone());

            let sem = Arc::clone(&semaphore);
            let client = client.clone();
            let config = self.config.clone();
            let segment_url = segment.url.clone();
            let byte_range = segment.byte_range;
            let cancel_flag = Arc::clone(&ctx.cancel_flag);
            let pause_flag = Arc::clone(&ctx.pause_flag);
            let progress_tx = ctx.progress_tx.clone();
            let bandwidth_controller = ctx.bandwidth_controller.clone();
            let downloaded_segments = Arc::clone(&downloaded_segments);
            let total_bytes_downloaded = Arc::clone(&total_bytes_downloaded);
            let task_id = task_id.to_string();

            let handle = tokio::spawn(async move {
                let _permit = sem
                    .acquire()
                    .await
                    .map_err(|e| anyhow!("acquire permit failed: {}", e))?;

                if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                    return Err(Self::interrupt_error(&cancel_flag));
                }

                let bytes = Self::download_segment_with_retries(
                    &client,
                    &config,
                    &segment_url,
                    &segment_path,
                    byte_range,
                    cancel_flag,
                    pause_flag,
                    bandwidth_controller,
                )
                .await?;

                let done_count = downloaded_segments.fetch_add(1, Ordering::Relaxed) + 1;
                let total_written =
                    total_bytes_downloaded.fetch_add(bytes, Ordering::Relaxed) + bytes;

                if let Some(ref tx) = progress_tx {
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let speed = if elapsed > 0.0 {
                        total_written as f64 / elapsed
                    } else {
                        0.0
                    };
                    let raw_progress = done_count as f64 / total_segments as f64;
                    let is_committing = raw_progress >= 1.0;
                    let eta = if !is_committing && done_count > 0 && elapsed > 0.0 {
                        let remaining_segments = total_segments.saturating_sub(done_count as usize);
                        let secs_per_segment = elapsed / done_count as f64;
                        Some((remaining_segments as f64 * secs_per_segment).round() as u64)
                    } else {
                        None
                    };

                    let stats = DownloadStats {
                        speed: if is_committing { 0.0 } else { speed },
                        downloaded_bytes: total_written,
                        total_bytes: None,
                        progress: if is_committing { 0.999 } else { raw_progress },
                        eta,
                        status_hint: is_committing.then_some(TaskStatus::Committing),
                        start_time: chrono::Utc::now(),
                        last_update: chrono::Utc::now(),
                    };
                    let _ = tx.send((task_id, stats));
                }

                Ok::<(), anyhow::Error>(())
            });

            handles.push(handle);
        }

        let mut iter = handles.into_iter();
        while let Some(handle) = iter.next() {
            match handle.await {
                Ok(Ok(())) => {}
                Ok(Err(err)) => {
                    for remaining in iter {
                        remaining.abort();
                    }
                    return Err(err);
                }
                Err(join_err) => {
                    for remaining in iter {
                        remaining.abort();
                    }
                    return Err(join_err.into());
                }
            }
        }

        Ok(segment_files)
    }

    #[allow(clippy::too_many_arguments)]
    async fn download_segment_with_retries(
        client: &Client,
        config: &DashDownloaderConfig,
        segment_url: &str,
        output_file: &Path,
        byte_range: Option<(u64, u64)>,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        bandwidth_controller: Option<BandwidthController>,
    ) -> Result<u64> {
        // Reuse completed segment files after pause/resume
        if let Ok(meta) = tokio::fs::metadata(output_file).await {
            if meta.len() > 0 {
                return Ok(meta.len());
            }
        }

        let mut retry_count = 0usize;
        while retry_count <= config.retry_attempts {
            if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                return Err(Self::interrupt_error(&cancel_flag));
            }

            match Self::download_segment_attempt(
                client,
                segment_url,
                output_file,
                byte_range,
                cancel_flag.clone(),
                pause_flag.clone(),
                bandwidth_controller.as_ref(),
            )
            .await
            {
                Ok(bytes) => return Ok(bytes),
                Err(err) => {
                    if err.downcast_ref::<NonRetryableSegmentError>().is_some()
                        || err.to_string().contains("download_cancelled")
                        || err.to_string().contains("download_paused")
                    {
                        return Err(err);
                    }

                    retry_count += 1;
                    if retry_count > config.retry_attempts {
                        return Err(err);
                    }

                    let backoff_ms = (500u64 << (retry_count - 1).min(4)).min(8_000);
                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                }
            }
        }

        unreachable!("retry loop always returns before exit");
    }

    async fn download_segment_attempt(
        client: &Client,
        segment_url: &str,
        output_file: &Path,
        byte_range: Option<(u64, u64)>,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        bandwidth_controller: Option<&BandwidthController>,
    ) -> Result<u64> {
        let mut req = client.get(segment_url);
        if let Some((start, end)) = byte_range {
            req = req.header("Range", format!("bytes={start}-{end}"));
        }

        let response = req.send().await?;
        let status = response.status();
        if matches!(status.as_u16(), 401 | 403 | 404 | 410) {
            return Err(anyhow!(NonRetryableSegmentError(format!(
                "分片不可访问 HTTP {}: {}",
                status.as_u16(),
                segment_url
            ))));
        }
        if byte_range.is_some() && status != reqwest::StatusCode::PARTIAL_CONTENT {
            bail!(
                "DASH byte-range 分片期望 HTTP 206，实际返回 HTTP {}: {}",
                status.as_u16(),
                segment_url
            );
        }
        if !status.is_success() {
            bail!(
                "DASH 分片下载失败 HTTP {}: {}",
                status.as_u16(),
                segment_url
            );
        }

        let tmp_path = output_file.with_extension("seg.tmp");
        let write_result: Result<u64> = async {
            let mut file = File::create(&tmp_path).await?;
            let mut stream = response.bytes_stream();
            let mut written = 0u64;

            while let Some(chunk_res) = stream.next().await {
                if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                    return Err(Self::interrupt_error(&cancel_flag));
                }
                let chunk = chunk_res?;
                if let Some(bw) = bandwidth_controller {
                    bw.throttle(chunk.len() as u64).await;
                }
                file.write_all(&chunk).await?;
                written += chunk.len() as u64;
            }

            file.flush().await?;
            file.sync_all().await?;
            Ok(written)
        }
        .await;

        match write_result {
            Ok(written) => {
                tokio::fs::rename(&tmp_path, output_file).await?;
                Ok(written)
            }
            Err(err) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                Err(err)
            }
        }
    }

    fn looks_like_media_container(header: &[u8]) -> bool {
        if header.first() == Some(&0x47) {
            return true;
        }
        if header.len() >= 8 {
            let box_type = &header[4..8];
            if matches!(box_type, b"ftyp" | b"styp" | b"moof" | b"sidx" | b"moov") {
                return true;
            }
        }
        false
    }

    async fn append_file_bytes(
        source_path: &Path,
        output_file: &mut File,
        buffer: &mut [u8],
        first_header: &mut Vec<u8>,
    ) -> Result<()> {
        let mut handle = File::open(source_path).await?;
        loop {
            let bytes_read = handle.read(buffer).await?;
            if bytes_read == 0 {
                break;
            }
            if first_header.len() < 16 {
                let take = (16 - first_header.len()).min(bytes_read);
                first_header.extend_from_slice(&buffer[..take]);
            }
            output_file.write_all(&buffer[..bytes_read]).await?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn merge_track_segments(
        &self,
        rep: &DashRepresentation,
        segment_files: &[PathBuf],
        init_paths: &HashMap<DashInitSegment, PathBuf>,
        track_temp_dir: &Path,
        output_path: &str,
        explicit_container: Option<&str>,
        ffmpeg_override: Option<&Path>,
        allow_remux: bool,
    ) -> Result<()> {
        let output_file_path = Path::new(output_path);
        if let Some(parent) = output_file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let target_ext = output_file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());
        let wants_container_remux = allow_remux
            && matches!(
                target_ext.as_deref(),
                Some("mp4" | "m4v" | "mkv" | "mov" | "webm")
            );

        let part_path = if wants_container_remux {
            track_temp_dir.join("merged_track.raw")
        } else {
            derive_part_path(output_file_path)
        };

        let mut first_header = Vec::with_capacity(16);
        let merge_result: Result<()> = async {
            let mut output_file = File::create(&part_path).await?;
            let mut buffer = vec![0u8; self.config.buffer_size];
            let mut last_init: Option<&DashInitSegment> = None;

            for (idx, segment_file) in segment_files.iter().enumerate() {
                if !segment_file.exists() {
                    bail!("DASH 分片文件不存在: {:?}", segment_file);
                }

                let init_ref = rep
                    .segments
                    .get(idx)
                    .and_then(|seg| seg.init_segment.as_ref())
                    .or(rep.init_segment.as_ref());

                if let Some(init) = init_ref {
                    if last_init != Some(init) {
                        if let Some(init_path) = init_paths.get(init) {
                            Self::append_file_bytes(
                                init_path,
                                &mut output_file,
                                &mut buffer,
                                &mut first_header,
                            )
                            .await?;
                            last_init = Some(init);
                        }
                    }
                }

                Self::append_file_bytes(
                    segment_file,
                    &mut output_file,
                    &mut buffer,
                    &mut first_header,
                )
                .await?;
            }

            output_file.flush().await?;
            output_file.sync_all().await?;
            Ok(())
        }
        .await;

        if let Err(err) = merge_result {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(err);
        }

        if wants_container_remux && Self::looks_like_media_container(&first_header) {
            if let Some(ffmpeg) = resolve_ffmpeg_binary(ffmpeg_override).await {
                match remux_single_stream(&ffmpeg, &part_path, output_file_path, explicit_container)
                    .await
                {
                    Ok(()) => {
                        let _ = tokio::fs::remove_file(&part_path).await;
                        return Ok(());
                    }
                    Err(remux_err) => {
                        tracing::warn!(
                            "DASH FFmpeg 单轨重封装失败，回退至原子流提交: {}",
                            remux_err
                        );
                    }
                }
            }
        }

        if wants_container_remux {
            let final_part = derive_part_path(output_file_path);
            if tokio::fs::rename(&part_path, &final_part).await.is_err() {
                tokio::fs::copy(&part_path, &final_part).await?;
                let _ = tokio::fs::remove_file(&part_path).await;
            }
            tokio::fs::rename(&final_part, output_file_path).await?;
        } else {
            tokio::fs::rename(&part_path, output_file_path).await?;
        }

        Ok(())
    }

    fn interrupt_error(cancel_flag: &AtomicBool) -> anyhow::Error {
        if cancel_flag.load(Ordering::Relaxed) {
            anyhow!("download_cancelled")
        } else {
            anyhow!("download_paused")
        }
    }

    async fn cleanup_temp_files(&self, temp_dir: &Path) -> Result<()> {
        if temp_dir.exists() {
            tokio::fs::remove_dir_all(temp_dir).await?;
        }
        Ok(())
    }

    pub async fn pause_download(&self, task_id: &str) -> Result<()> {
        if let Some(flag) = self.pause_flags.read().await.get(task_id).cloned() {
            flag.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    pub async fn resume_download(&self, task_id: &str) -> Result<()> {
        if let Some(flag) = self.pause_flags.read().await.get(task_id).cloned() {
            flag.store(false, Ordering::Relaxed);
        }
        Ok(())
    }

    pub async fn cancel_download(&self, task_id: &str) -> Result<()> {
        if let Some(flag) = self.active_downloads.read().await.get(task_id).cloned() {
            flag.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};
    use std::sync::Mutex;
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    type RecordedRequests = Arc<Mutex<Vec<(String, HashMap<String, String>)>>>;

    #[derive(Clone, Default)]
    struct MockHttpState {
        requests: RecordedRequests,
        hit_counts: Arc<Mutex<HashMap<String, usize>>>,
        delay_ms: u64,
    }

    async fn read_http_request(
        socket: &mut tokio::net::TcpStream,
    ) -> Option<(String, HashMap<String, String>)> {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 2048];
        loop {
            let n = socket.read(&mut tmp).await.ok()?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() >= 16_384 {
                break;
            }
        }
        let raw = String::from_utf8_lossy(&buf);
        let mut lines = raw.split("\r\n");
        let first_line = lines.next()?;
        let path = first_line.split_whitespace().nth(1)?.to_string();
        let mut headers = HashMap::new();
        for line in lines {
            if line.is_empty() {
                break;
            }
            if let Some((k, v)) = line.split_once(':') {
                headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
            }
        }
        Some((path, headers))
    }

    async fn spawn_mock_server(
        routes: HashMap<String, (u16, Vec<u8>)>,
        state: MockHttpState,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let routes = Arc::new(routes);

        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let routes = Arc::clone(&routes);
                let state = state.clone();
                tokio::spawn(async move {
                    let Some((path, headers)) = read_http_request(&mut socket).await else {
                        return;
                    };

                    {
                        let mut reqs = state.requests.lock().unwrap();
                        reqs.push((path.clone(), headers.clone()));
                    }
                    {
                        let mut counts = state.hit_counts.lock().unwrap();
                        *counts.entry(path.clone()).or_insert(0) += 1;
                    }

                    if state.delay_ms > 0 && path.starts_with("/seg-") {
                        tokio::time::sleep(Duration::from_millis(state.delay_ms)).await;
                    }

                    if let Some((status, body)) = routes.get(&path) {
                        let (actual_status, payload): (u16, Vec<u8>) = if *status == 206 {
                            if let Some(range) = headers.get("range") {
                                if let Some(spec) = range.strip_prefix("bytes=") {
                                    if let Some((s, e)) = spec.split_once('-') {
                                        let start: usize = s.parse().unwrap_or(0);
                                        let end: usize = e
                                            .parse::<usize>()
                                            .unwrap_or(body.len().saturating_sub(1))
                                            .min(body.len().saturating_sub(1));
                                        (206, body[start..=end].to_vec())
                                    } else {
                                        (200, body.clone())
                                    }
                                } else {
                                    (200, body.clone())
                                }
                            } else {
                                (200, body.clone())
                            }
                        } else {
                            (*status, body.clone())
                        };

                        let reason = match actual_status {
                            200 => "OK",
                            206 => "Partial Content",
                            404 => "Not Found",
                            _ => "Error",
                        };
                        let resp_header = format!(
                            "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            actual_status,
                            reason,
                            payload.len()
                        );
                        let _ = socket.write_all(resp_header.as_bytes()).await;
                        let _ = socket.write_all(&payload).await;
                    } else {
                        let resp = b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found";
                        let _ = socket.write_all(resp).await;
                    }
                    let _ = socket.shutdown().await;
                });
            }
        });

        (format!("http://127.0.0.1:{}", addr.port()), handle)
    }

    #[tokio::test]
    async fn downloads_single_track_segment_template_merges_and_cleans_up() {
        let dir = tempdir().expect("tempdir");
        let temp_root = dir.path().join("dash_tmp");
        let out_file = dir.path().join("out").join("dash_video.mp4");

        let mpd_xml = r#"<?xml version="1.0" encoding="utf-8"?>
<MPD type="static" mediaPresentationDuration="PT6S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="1080p" bandwidth="4000000" width="1920" height="1080">
        <SegmentTemplate initialization="init.m4s" media="seg-$Number$.m4s" startNumber="1" timescale="1" duration="2" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#;

        let mut routes = HashMap::new();
        routes.insert(
            "/manifest.mpd".to_string(),
            (200, mpd_xml.as_bytes().to_vec()),
        );
        routes.insert("/init.m4s".to_string(), (200, b"[INIT]".to_vec()));
        routes.insert("/seg-1.m4s".to_string(), (200, b"[SEG1]".to_vec()));
        routes.insert("/seg-2.m4s".to_string(), (200, b"[SEG2]".to_vec()));
        routes.insert("/seg-3.m4s".to_string(), (200, b"[SEG3]".to_vec()));

        let state = MockHttpState::default();
        let (base_url, server) = spawn_mock_server(routes, state.clone()).await;

        let downloader = DashDownloader::new(DashDownloaderConfig {
            max_concurrent_segments: 2,
            temp_dir: temp_root.clone(),
            ..Default::default()
        })
        .expect("dash downloader");

        let (tx, mut rx) = mpsc::unbounded_channel();
        downloader
            .download_dash_with_options(
                "task-dash-1",
                &format!("{base_url}/manifest.mpd"),
                &out_file.to_string_lossy(),
                DashDownloadContext {
                    progress_tx: Some(tx),
                    ..Default::default()
                },
            )
            .await
            .expect("dash download succeeds");

        server.abort();

        let merged = tokio::fs::read(&out_file).await.expect("read output");
        assert_eq!(merged, b"[INIT][SEG1][SEG2][SEG3]");
        assert!(!temp_root.join("task-dash-1").exists());

        let mut updates = Vec::new();
        while let Ok((id, stats)) = rx.try_recv() {
            assert_eq!(id, "task-dash-1");
            updates.push(stats);
        }
        assert_eq!(updates.len(), 3);
    }

    #[tokio::test]
    async fn pause_preserves_segments_and_resume_reuses_completed_segments() {
        let dir = tempdir().expect("tempdir");
        let temp_root = dir.path().join("dash_tmp");
        let out_file = dir.path().join("paused_dash.mp4");
        let pause_flag = Arc::new(AtomicBool::new(false));

        let mpd_xml = r#"<?xml version="1.0" encoding="utf-8"?>
<MPD type="static" mediaPresentationDuration="PT6S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="720p" bandwidth="2000000" width="1280" height="720">
        <SegmentTemplate initialization="init.m4s" media="seg-$Number$.m4s" startNumber="1" timescale="1" duration="2" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#;

        let mut routes = HashMap::new();
        routes.insert(
            "/manifest.mpd".to_string(),
            (200, mpd_xml.as_bytes().to_vec()),
        );
        routes.insert("/init.m4s".to_string(), (200, b"INIT|".to_vec()));
        routes.insert("/seg-1.m4s".to_string(), (200, b"ONE|".to_vec()));
        routes.insert("/seg-2.m4s".to_string(), (200, b"TWO|".to_vec()));
        routes.insert("/seg-3.m4s".to_string(), (200, b"THREE".to_vec()));

        let state = MockHttpState {
            delay_ms: 40,
            ..Default::default()
        };
        let (base_url, server) = spawn_mock_server(routes, state.clone()).await;

        let downloader = DashDownloader::new(DashDownloaderConfig {
            max_concurrent_segments: 1,
            temp_dir: temp_root.clone(),
            ..Default::default()
        })
        .expect("dash downloader");

        let (tx, mut rx) = mpsc::unbounded_channel();
        let pause_signal = Arc::clone(&pause_flag);
        let watcher = tokio::spawn(async move {
            if rx.recv().await.is_some() {
                pause_signal.store(true, Ordering::Relaxed);
            }
        });

        let err = downloader
            .download_dash_with_options(
                "task-pause-dash",
                &format!("{base_url}/manifest.mpd"),
                &out_file.to_string_lossy(),
                DashDownloadContext {
                    pause_flag: Arc::clone(&pause_flag),
                    progress_tx: Some(tx),
                    ..Default::default()
                },
            )
            .await
            .expect_err("paused run must return download_paused");
        let _ = watcher.await;
        assert!(err.to_string().contains("download_paused"));

        let task_tmp = temp_root.join("task-pause-dash");
        assert!(task_tmp.exists());
        let mut completed_on_disk = 0usize;
        for entry in std::fs::read_dir(&task_tmp).expect("read dash task tmp") {
            let entry = entry.expect("dir entry");
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("segment_") && name.ends_with(".seg") {
                completed_on_disk += 1;
            }
        }
        assert!(
            (1..3).contains(&completed_on_disk),
            "expected 1 or 2 completed segments before pause, got {completed_on_disk}"
        );

        let seg_hits_before: usize = ["/seg-1.m4s", "/seg-2.m4s", "/seg-3.m4s"]
            .iter()
            .map(|p| {
                state
                    .hit_counts
                    .lock()
                    .unwrap()
                    .get(*p)
                    .copied()
                    .unwrap_or(0)
            })
            .sum();

        pause_flag.store(false, Ordering::Relaxed);
        let resumed_state = MockHttpState {
            hit_counts: Arc::clone(&state.hit_counts),
            requests: Arc::clone(&state.requests),
            delay_ms: 0,
        };
        server.abort();

        let mut routes2 = HashMap::new();
        routes2.insert(
            "/manifest.mpd".to_string(),
            (200, mpd_xml.as_bytes().to_vec()),
        );
        routes2.insert("/init.m4s".to_string(), (200, b"INIT|".to_vec()));
        routes2.insert("/seg-1.m4s".to_string(), (200, b"ONE|".to_vec()));
        routes2.insert("/seg-2.m4s".to_string(), (200, b"TWO|".to_vec()));
        routes2.insert("/seg-3.m4s".to_string(), (200, b"THREE".to_vec()));

        let (base_url2, server2) = spawn_mock_server(routes2, resumed_state).await;

        downloader
            .download_dash_with_options(
                "task-pause-dash",
                &format!("{base_url2}/manifest.mpd"),
                &out_file.to_string_lossy(),
                DashDownloadContext {
                    pause_flag,
                    ..Default::default()
                },
            )
            .await
            .expect("resumed dash download succeeds");
        server2.abort();

        let merged = tokio::fs::read(&out_file)
            .await
            .expect("read resumed output");
        assert_eq!(merged, b"INIT|ONE|TWO|THREE");

        let counts = state.hit_counts.lock().unwrap();
        assert_eq!(counts.get("/init.m4s").copied(), Some(1));
        let seg_hits_after: usize = ["/seg-1.m4s", "/seg-2.m4s", "/seg-3.m4s"]
            .iter()
            .map(|p| counts.get(*p).copied().unwrap_or(0))
            .sum();
        assert_eq!(seg_hits_after - seg_hits_before, 3 - completed_on_disk);
    }

    #[tokio::test]
    async fn forwards_custom_headers_via_scoped_client_override() {
        let dir = tempdir().expect("tempdir");
        let temp_root = dir.path().join("dash_tmp");
        let out_file = dir.path().join("headers_dash.mp4");

        let mpd_xml = r#"<?xml version="1.0" encoding="utf-8"?>
<MPD type="static" mediaPresentationDuration="PT2S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="main" bandwidth="1000000">
        <SegmentList>
          <SegmentURL media="part-0.m4s" mediaRange="2-6" />
        </SegmentList>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#;

        let mut routes = HashMap::new();
        routes.insert(
            "/manifest.mpd".to_string(),
            (200, mpd_xml.as_bytes().to_vec()),
        );
        routes.insert("/part-0.m4s".to_string(), (206, b"xxHELLOyy".to_vec()));

        let state = MockHttpState::default();
        let (base_url, server) = spawn_mock_server(routes, state.clone()).await;

        let mut headers = HeaderMap::new();
        headers.insert(
            "Referer",
            HeaderValue::from_static("https://origin.example/watch"),
        );
        headers.insert("X-Custom-Dash", HeaderValue::from_static("dash-token-42"));
        let scoped_client = Client::builder()
            .default_headers(headers)
            .build()
            .expect("scoped client");

        let downloader = DashDownloader::new(DashDownloaderConfig {
            temp_dir: temp_root,
            ..Default::default()
        })
        .expect("dash downloader");

        downloader
            .download_dash_with_options(
                "task-headers-dash",
                &format!("{base_url}/manifest.mpd"),
                &out_file.to_string_lossy(),
                DashDownloadContext {
                    client_override: Some(scoped_client),
                    ..Default::default()
                },
            )
            .await
            .expect("custom header dash download succeeds");

        server.abort();

        let merged = tokio::fs::read(&out_file).await.expect("read output");
        assert_eq!(merged, b"HELLO");

        let requests = state.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        for (path, req_headers) in requests.iter() {
            assert_eq!(
                req_headers.get("referer").map(String::as_str),
                Some("https://origin.example/watch"),
                "missing referer on {path}"
            );
            assert_eq!(
                req_headers.get("x-custom-dash").map(String::as_str),
                Some("dash-token-42"),
                "missing X-Custom-Dash on {path}"
            );
        }
    }
}
