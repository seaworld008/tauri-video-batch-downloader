//! M3U8/HLS 流媒体下载器
//!
//! 支持：
//! - Master Playlist (#EXT-X-STREAM-INF / #EXT-X-MEDIA) 自动选流与独立音视频轨 FFmpeg 无损混流
//! - Media Playlist 解析、相对路径解析、#EXT-X-MEDIA-SEQUENCE 默认 IV 计算
//! - fMP4 (#EXT-X-MAP) 初始化分片与 byte-range 分片下载合并
//! - AES-128 解密（显式 IV 与默认 sequence IV + 同清单多密钥缓存）
//! - 原子写入、暂停恢复分片复用、指数退避重试、每任务作用域上下文隔离

use crate::core::downloader::{BandwidthController, DownloadStats};
use crate::core::ffmpeg_muxer::{mux_av_streams, remux_single_stream, resolve_ffmpeg_binary};
use crate::core::models::TaskStatus;
use crate::core::part_file::derive_part_path;
use aes::Aes128;
use anyhow::{anyhow, bail, Result};
use cbc::Decryptor;
use cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use hex;
use parking_lot::RwLock as ParkingRwLock;
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
use url::Url;

type ProgressSender = Arc<ParkingRwLock<Option<mpsc::UnboundedSender<(String, DownloadStats)>>>>;

#[derive(Debug)]
struct NonRetryableSegmentError(String);

impl std::fmt::Display for NonRetryableSegmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for NonRetryableSegmentError {}

/// M3U8下载器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct M3U8DownloaderConfig {
    /// 最大并发片段下载数
    pub max_concurrent_segments: usize,
    /// 请求超时时间（秒）
    pub timeout: u64,
    /// 重试次数
    pub retry_attempts: usize,
    /// 缓冲区大小（字节）
    pub buffer_size: usize,
    /// 用户代理
    pub user_agent: String,
    /// 临时文件目录
    pub temp_dir: PathBuf,
    /// 是否保留临时片段文件
    pub keep_temp_files: bool,
}

impl Default for M3U8DownloaderConfig {
    fn default() -> Self {
        Self {
            max_concurrent_segments: 8,
            timeout: 30,
            retry_attempts: 3,
            buffer_size: 64 * 1024, // 64KB
            user_agent: "VideoDownloaderPro/1.0.0".to_string(),
            temp_dir: std::env::temp_dir().join("video_downloader_m3u8"),
            keep_temp_files: false,
        }
    }
}

#[derive(Clone, Default)]
pub struct M3U8DownloadContext {
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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct M3U8InitMap {
    pub url: String,
    pub byte_range: Option<(u64, u64)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct M3U8Variant {
    pub url: String,
    pub bandwidth: u64,
    pub resolution: Option<(u32, u32)>,
    pub codecs: Option<String>,
    pub audio_group: Option<String>,
    pub subtitle_group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct M3U8MediaTrack {
    pub media_type: String,
    pub group_id: String,
    pub name: String,
    pub language: Option<String>,
    pub uri: Option<String>,
    pub is_default: bool,
    pub autoselect: bool,
}

/// M3U8播放列表信息
#[derive(Debug, Clone)]
pub struct M3U8Playlist {
    /// 播放列表URL
    pub url: String,
    /// 基础URL（用于解析相对路径）
    pub base_url: String,
    /// 片段列表
    pub segments: Vec<M3U8Segment>,
    /// 总时长（秒）
    pub duration: f64,
    /// 是否为Live流
    pub is_live: bool,
    /// 目标时长
    pub target_duration: f64,
    /// 版本
    pub version: u32,
    /// Media sequence base number (#EXT-X-MEDIA-SEQUENCE)
    pub media_sequence: u64,
    /// 加密信息
    pub encryption: Option<M3U8Encryption>,
    /// 是否为 Master Playlist
    pub is_master: bool,
    /// Master 清晰度流列表
    pub variants: Vec<M3U8Variant>,
    /// Master 音视频/字幕附加轨
    pub media_tracks: Vec<M3U8MediaTrack>,
}

/// M3U8片段信息
#[derive(Debug, Clone)]
pub struct M3U8Segment {
    /// 片段索引
    pub index: usize,
    /// RFC 8216 sequence number used for default AES-128 IV calculation
    pub media_sequence: u64,
    /// 片段URL
    pub url: String,
    /// 时长（秒）
    pub duration: f64,
    /// 字节范围（可选）
    pub byte_range: Option<(u64, u64)>,
    /// fMP4 初始化片段 (#EXT-X-MAP)
    pub init_map: Option<M3U8InitMap>,
    /// 是否已下载
    pub downloaded: bool,
    /// 本地文件路径
    pub local_path: Option<PathBuf>,
    /// 片段加密信息
    pub encryption: Option<M3U8Encryption>,
}

/// M3U8加密信息
#[derive(Debug, Clone)]
pub struct M3U8Encryption {
    /// 加密方法
    pub method: String,
    /// 密钥URL
    pub key_url: Option<String>,
    /// 初始化向量
    pub iv: Option<String>,
    /// 密钥数据
    pub key_data: Option<Vec<u8>>,
}

/// M3U8下载器
pub struct M3U8Downloader {
    config: M3U8DownloaderConfig,
    client: Client,
    active_downloads: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    pause_flags: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    progress_tx: ProgressSender,
    semaphore: Arc<Semaphore>,
}

impl M3U8Downloader {
    /// 创建新的M3U8下载器实例
    pub fn new(config: M3U8DownloaderConfig) -> Result<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(config.timeout))
            .read_timeout(Duration::from_secs(config.timeout))
            .user_agent(&config.user_agent)
            .build()?;

        let semaphore = Arc::new(Semaphore::new(config.max_concurrent_segments));
        std::fs::create_dir_all(&config.temp_dir)?;

        Ok(Self {
            config,
            client,
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
            pause_flags: Arc::new(RwLock::new(HashMap::new())),
            progress_tx: Arc::new(ParkingRwLock::new(None)),
            semaphore,
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
            _ => bail!("非法的任务临时目录标识: {}", task_id),
        }
    }

    /// 设置默认进度回调（兼容旧测试调用，推荐改用 download_m3u8_with_options）
    pub fn set_progress_callback(&self, tx: mpsc::UnboundedSender<(String, DownloadStats)>) {
        *self.progress_tx.write() = Some(tx);
    }

    /// 下载M3U8流
    pub async fn download_m3u8(
        &self,
        task_id: &str,
        m3u8_url: &str,
        output_path: &str,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<()> {
        let fallback_progress_tx = self.progress_tx.read().clone();
        self.download_m3u8_with_context(
            task_id,
            m3u8_url,
            output_path,
            Arc::new(AtomicBool::new(false)),
            pause_flag,
            fallback_progress_tx,
            None,
        )
        .await
    }

    /// 使用每任务上下文下载 M3U8 流
    #[allow(clippy::too_many_arguments)]
    pub async fn download_m3u8_with_context(
        &self,
        task_id: &str,
        m3u8_url: &str,
        output_path: &str,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        progress_tx: Option<mpsc::UnboundedSender<(String, DownloadStats)>>,
        bandwidth_controller: Option<BandwidthController>,
    ) -> Result<()> {
        self.download_m3u8_with_options(
            task_id,
            m3u8_url,
            output_path,
            M3U8DownloadContext {
                cancel_flag,
                pause_flag,
                progress_tx,
                bandwidth_controller,
                ..Default::default()
            },
        )
        .await
    }

    /// 使用完整上下文与请求选项下载 HLS 流（支持 Master Playlist、fMP4 INIT 与 FFmpeg 混流）
    pub async fn download_m3u8_with_options(
        &self,
        task_id: &str,
        m3u8_url: &str,
        output_path: &str,
        ctx: M3U8DownloadContext,
    ) -> Result<()> {
        crate::utils::validation::assert_http_url(m3u8_url)?;
        tracing::info!("开始下载M3U8流: {}", m3u8_url);

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

        let pipeline_result: Result<()> = async {
            let entry_playlist = self
                .parse_m3u8_playlist_with_client(&client, m3u8_url)
                .await?;
            if entry_playlist.is_master {
                self.download_master_playlist(
                    task_id,
                    &entry_playlist,
                    output_path,
                    &task_temp_dir,
                    &client,
                    &ctx,
                )
                .await
            } else {
                self.download_media_playlist_to_output(
                    task_id,
                    entry_playlist,
                    output_path,
                    &task_temp_dir,
                    &client,
                    &ctx,
                    true,
                )
                .await
            }
        }
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
                } else {
                    tracing::info!("根据配置保留临时分片目录: {}", task_temp_dir.display());
                }

                tracing::info!("M3U8下载完成: {}", output_path);
                Ok(())
            }
            Err(e) => {
                let is_paused = e.to_string().contains("download_paused");
                if is_paused || self.config.keep_temp_files {
                    tracing::info!(
                        "保留 M3U8 已下载分片以便后续恢复 ({}): {}",
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
                Err(e)
            }
        }
    }

    async fn download_master_playlist(
        &self,
        task_id: &str,
        master: &M3U8Playlist,
        output_path: &str,
        task_temp_dir: &Path,
        client: &Client,
        ctx: &M3U8DownloadContext,
    ) -> Result<()> {
        let variant = Self::select_hls_variant(&master.variants, ctx.format_selector.as_deref())
            .ok_or_else(|| anyhow!("Master playlist 中未找到可下载的清晰度流"))?;

        let selected_audio = Self::select_hls_audio_track(
            &master.media_tracks,
            variant.audio_group.as_deref(),
            ctx.preferred_language.as_deref(),
        );

        let audio_only = ctx
            .format_selector
            .as_deref()
            .is_some_and(|sel| sel.trim().eq_ignore_ascii_case("audio"));

        if audio_only {
            if let Some(audio_uri) = selected_audio.and_then(|track| track.uri.as_deref()) {
                let audio_playlist = self
                    .parse_m3u8_playlist_with_client(client, audio_uri)
                    .await?;
                return self
                    .download_media_playlist_to_output(
                        task_id,
                        audio_playlist,
                        output_path,
                        &task_temp_dir.join("audio"),
                        client,
                        ctx,
                        true,
                    )
                    .await;
            }
        }

        let video_playlist = self
            .parse_m3u8_playlist_with_client(client, &variant.url)
            .await?;
        if video_playlist.is_master {
            bail!("不支持多层嵌套 Master Playlist: {}", variant.url);
        }

        if let Some(audio_track) = selected_audio {
            if let Some(audio_uri) = audio_track.uri.as_deref() {
                let audio_playlist = self
                    .parse_m3u8_playlist_with_client(client, audio_uri)
                    .await?;
                if audio_playlist.is_master {
                    bail!("不支持嵌套 Master Audio Playlist: {}", audio_uri);
                }

                let video_temp = task_temp_dir.join("video");
                let audio_temp = task_temp_dir.join("audio");
                tokio::fs::create_dir_all(&video_temp).await?;
                tokio::fs::create_dir_all(&audio_temp).await?;

                let video_raw = task_temp_dir.join("video_track.raw");
                let audio_raw = task_temp_dir.join("audio_track.raw");

                let video_raw_str = video_raw.to_string_lossy().to_string();
                let audio_raw_str = audio_raw.to_string_lossy().to_string();

                let audio_ctx = M3U8DownloadContext {
                    progress_tx: None,
                    ..ctx.clone()
                };

                self.download_media_playlist_to_output(
                    task_id,
                    video_playlist,
                    &video_raw_str,
                    &video_temp,
                    client,
                    ctx,
                    false,
                )
                .await?;
                self.download_media_playlist_to_output(
                    task_id,
                    audio_playlist,
                    &audio_raw_str,
                    &audio_temp,
                    client,
                    &audio_ctx,
                    false,
                )
                .await?;

                let Some(ffmpeg) = resolve_ffmpeg_binary(ctx.ffmpeg_path.as_deref()).await else {
                    bail!("ffmpeg_missing: separate HLS audio/video muxing requires ffmpeg");
                };

                return mux_av_streams(
                    &ffmpeg,
                    &video_raw,
                    &audio_raw,
                    Path::new(output_path),
                    ctx.output_container.as_deref(),
                )
                .await;
            }
        }

        self.download_media_playlist_to_output(
            task_id,
            video_playlist,
            output_path,
            task_temp_dir,
            client,
            ctx,
            true,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn download_media_playlist_to_output(
        &self,
        task_id: &str,
        mut playlist: M3U8Playlist,
        output_path: &str,
        temp_dir: &Path,
        client: &Client,
        ctx: &M3U8DownloadContext,
        allow_remux: bool,
    ) -> Result<()> {
        if playlist.segments.is_empty() {
            bail!("M3U8播放列表为空");
        }
        tokio::fs::create_dir_all(temp_dir).await?;

        self.hydrate_segment_encryption_keys_with_client(client, &mut playlist)
            .await?;
        let init_paths = self
            .download_init_maps_with_client(
                client,
                &playlist,
                temp_dir,
                Arc::clone(&ctx.cancel_flag),
                Arc::clone(&ctx.pause_flag),
            )
            .await?;
        let segment_files = self
            .download_segments(
                task_id,
                client,
                &playlist,
                temp_dir,
                Arc::clone(&ctx.cancel_flag),
                Arc::clone(&ctx.pause_flag),
                ctx.progress_tx.clone(),
                ctx.bandwidth_controller.clone(),
            )
            .await?;

        tracing::info!("分片下载完成，开始合并");
        self.merge_segments_with_options(
            &playlist,
            &segment_files,
            &init_paths,
            temp_dir,
            output_path,
            ctx.output_container.as_deref(),
            ctx.ffmpeg_path.as_deref(),
            allow_remux,
        )
        .await?;
        Ok(())
    }

    async fn parse_m3u8_playlist_with_client(
        &self,
        client: &Client,
        m3u8_url: &str,
    ) -> Result<M3U8Playlist> {
        tracing::debug!("获取M3U8播放列表: {}", m3u8_url);

        let response = client.get(m3u8_url).send().await?;

        if !response.status().is_success() {
            bail!("获取M3U8播放列表失败: {}", response.status());
        }

        let content = response.text().await?;
        self.parse_m3u8_content(m3u8_url, &content).await
    }

    /// 解析M3U8内容
    async fn parse_m3u8_content(&self, m3u8_url: &str, content: &str) -> Result<M3U8Playlist> {
        let base_url = self.get_base_url(m3u8_url)?;
        let mut playlist = M3U8Playlist {
            url: m3u8_url.to_string(),
            base_url,
            segments: Vec::new(),
            duration: 0.0,
            is_live: false,
            target_duration: 0.0,
            version: 1,
            media_sequence: 0,
            encryption: None,
            is_master: false,
            variants: Vec::new(),
            media_tracks: Vec::new(),
        };

        let content = content.strip_prefix('\u{feff}').unwrap_or(content);
        let lines: Vec<&str> = content.lines().collect();

        if !lines
            .first()
            .unwrap_or(&"")
            .trim_start()
            .starts_with("#EXTM3U")
        {
            bail!("无效的M3U8文件格式");
        }

        let mut i = 0;
        let mut segment_index = 0usize;
        let mut current_segment_duration = 0.0;
        let mut pending_byte_range: Option<(u64, u64)> = None;
        let mut last_byte_range_end: Option<u64> = None;
        let mut current_encryption: Option<M3U8Encryption> = None;
        let mut current_init_map: Option<M3U8InitMap> = None;
        let mut pending_stream_inf: Option<M3U8Variant> = None;
        let mut has_endlist = false;

        while i < lines.len() {
            let line = lines[i].trim();

            if line.is_empty() || line.starts_with('#') {
                if let Some(version_str) = line.strip_prefix("#EXT-X-VERSION:") {
                    playlist.version = version_str.trim().parse::<u32>().unwrap_or(1);
                } else if let Some(target_str) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
                    playlist.target_duration = target_str.trim().parse::<f64>().unwrap_or(0.0);
                } else if let Some(seq_str) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
                    playlist.media_sequence = seq_str.trim().parse::<u64>().unwrap_or(0);
                } else if let Some(extinf_str) = line.strip_prefix("#EXTINF:") {
                    let duration_str = extinf_str.split(',').next().unwrap_or("0");
                    current_segment_duration = duration_str.trim().parse::<f64>().unwrap_or(0.0);
                } else if line.starts_with("#EXT-X-KEY:") {
                    current_encryption = self.parse_encryption_line(line)?;
                    if let Some(ref mut encryption) = current_encryption {
                        self.resolve_encryption_key_url(&playlist.base_url, encryption)?;
                    }
                    playlist.encryption = current_encryption.clone();
                } else if let Some(map_line) = line.strip_prefix("#EXT-X-MAP:") {
                    current_init_map = self.parse_map_line(&playlist.base_url, map_line)?;
                } else if let Some(br_line) = line.strip_prefix("#EXT-X-BYTERANGE:") {
                    let parsed = Self::parse_byte_range_spec(br_line, last_byte_range_end);
                    if parsed.is_none() {
                        tracing::warn!("检测到长度为 0 的 EXT-X-BYTERANGE: {}", line);
                    }
                    pending_byte_range = parsed;
                } else if let Some(media_line) = line.strip_prefix("#EXT-X-MEDIA:") {
                    if let Some(track) =
                        self.parse_media_track_line(&playlist.base_url, media_line)?
                    {
                        playlist.media_tracks.push(track);
                    }
                } else if let Some(stream_line) = line.strip_prefix("#EXT-X-STREAM-INF:") {
                    pending_stream_inf = Some(Self::parse_stream_inf_line(stream_line));
                } else if line.contains("#EXT-X-ENDLIST") {
                    has_endlist = true;
                }
                i += 1;
                continue;
            }

            let resolved_url = self.resolve_entry_url(&playlist.base_url, line)?;
            crate::utils::validation::assert_http_url(&resolved_url)?;

            if let Some(mut variant) = pending_stream_inf.take() {
                variant.url = resolved_url;
                playlist.variants.push(variant);
                playlist.is_master = true;
                i += 1;
                continue;
            }

            let byte_range = pending_byte_range.take();
            if let Some((_, end)) = byte_range {
                last_byte_range_end = Some(end);
            }

            let segment = M3U8Segment {
                index: segment_index,
                media_sequence: playlist.media_sequence.saturating_add(segment_index as u64),
                url: resolved_url,
                duration: current_segment_duration,
                byte_range,
                init_map: current_init_map.clone(),
                downloaded: false,
                local_path: None,
                encryption: current_encryption.clone(),
            };

            playlist.segments.push(segment);
            playlist.duration += current_segment_duration;
            segment_index += 1;
            current_segment_duration = 0.0;

            i += 1;
        }

        playlist.is_live = !playlist.is_master && !has_endlist && !playlist.segments.is_empty();
        // Fix up media_sequence if #EXT-X-MEDIA-SEQUENCE appeared (it precedes segments per spec,
        // and assigning sequentially ensures consistency).
        for segment in &mut playlist.segments {
            segment.media_sequence = playlist.media_sequence.saturating_add(segment.index as u64);
        }

        tracing::debug!(
            "解析完成: master={}, {} 个片段, {} 个清晰度流, 总时长: {:.2}秒",
            playlist.is_master,
            playlist.segments.len(),
            playlist.variants.len(),
            playlist.duration
        );

        Ok(playlist)
    }

    fn parse_byte_range_spec(raw: &str, last_end: Option<u64>) -> Option<(u64, u64)> {
        let mut parts = raw.trim().trim_matches('"').split('@');
        let length = parts.next()?.trim().parse::<u64>().ok()?;
        if length == 0 {
            return None;
        }
        let start = parts
            .next()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .or_else(|| last_end.map(|end| end + 1))
            .unwrap_or(0);
        let end = start.saturating_add(length.saturating_sub(1));
        Some((start, end))
    }

    fn parse_map_line(&self, base_url: &str, map_line: &str) -> Result<Option<M3U8InitMap>> {
        let parts = Self::split_attribute_list(map_line);
        let mut uri: Option<String> = None;
        let mut byte_range: Option<(u64, u64)> = None;

        for part in parts {
            let Some((raw_key, raw_val)) = part.split_once('=') else {
                continue;
            };
            let key = raw_key.trim().to_ascii_uppercase();
            let val = raw_val.trim().trim_matches('"');
            match key.as_str() {
                "URI" if !val.is_empty() => uri = Some(val.to_string()),
                "BYTERANGE" => byte_range = Self::parse_byte_range_spec(val, None),
                _ => {}
            }
        }

        let Some(raw_uri) = uri else {
            return Ok(None);
        };
        let resolved_url = self.resolve_entry_url(base_url, &raw_uri)?;
        crate::utils::validation::assert_http_url(&resolved_url)?;

        Ok(Some(M3U8InitMap {
            url: resolved_url,
            byte_range,
        }))
    }

    fn parse_media_track_line(
        &self,
        base_url: &str,
        media_line: &str,
    ) -> Result<Option<M3U8MediaTrack>> {
        let parts = Self::split_attribute_list(media_line);
        let mut media_type = String::new();
        let mut group_id = String::new();
        let mut name = String::new();
        let mut language = None;
        let mut uri = None;
        let mut is_default = false;
        let mut autoselect = false;

        for part in parts {
            let Some((raw_key, raw_val)) = part.split_once('=') else {
                continue;
            };
            let key = raw_key.trim().to_ascii_uppercase();
            let val = raw_val.trim().trim_matches('"');
            match key.as_str() {
                "TYPE" => media_type = val.to_ascii_uppercase(),
                "GROUP-ID" => group_id = val.to_string(),
                "NAME" => name = val.to_string(),
                "LANGUAGE" => language = Some(val.to_string()),
                "URI" if !val.is_empty() => {
                    let resolved = self.resolve_entry_url(base_url, val)?;
                    crate::utils::validation::assert_http_url(&resolved)?;
                    uri = Some(resolved);
                }
                "DEFAULT" => is_default = val.eq_ignore_ascii_case("YES"),
                "AUTOSELECT" => autoselect = val.eq_ignore_ascii_case("YES"),
                _ => {}
            }
        }

        if media_type.is_empty() || group_id.is_empty() {
            return Ok(None);
        }

        Ok(Some(M3U8MediaTrack {
            media_type,
            group_id,
            name,
            language,
            uri,
            is_default,
            autoselect,
        }))
    }

    fn parse_stream_inf_line(stream_line: &str) -> M3U8Variant {
        let parts = Self::split_attribute_list(stream_line);
        let mut bandwidth = 0u64;
        let mut resolution = None;
        let mut codecs = None;
        let mut audio_group = None;
        let mut subtitle_group = None;

        for part in parts {
            let Some((raw_key, raw_val)) = part.split_once('=') else {
                continue;
            };
            let key = raw_key.trim().to_ascii_uppercase();
            let val = raw_val.trim().trim_matches('"');
            match key.as_str() {
                "BANDWIDTH" => bandwidth = val.parse::<u64>().unwrap_or(0),
                "RESOLUTION" => {
                    if let Some((w, h)) = val.split_once('x').or_else(|| val.split_once('X')) {
                        if let (Ok(width), Ok(height)) = (w.parse::<u32>(), h.parse::<u32>()) {
                            resolution = Some((width, height));
                        }
                    }
                }
                "CODECS" => codecs = Some(val.to_string()),
                "AUDIO" => audio_group = Some(val.to_string()),
                "SUBTITLES" => subtitle_group = Some(val.to_string()),
                _ => {}
            }
        }

        M3U8Variant {
            url: String::new(),
            bandwidth,
            resolution,
            codecs,
            audio_group,
            subtitle_group,
        }
    }

    pub fn select_hls_variant<'a>(
        variants: &'a [M3U8Variant],
        format_selector: Option<&str>,
    ) -> Option<&'a M3U8Variant> {
        if variants.is_empty() {
            return None;
        }

        let target_height = format_selector.and_then(|sel| {
            let lower = sel.trim().to_ascii_lowercase();
            lower
                .strip_suffix('p')
                .and_then(|digits| digits.parse::<u32>().ok())
        });

        if let Some(max_h) = target_height {
            let under_cap = variants
                .iter()
                .filter(|v| v.resolution.is_some_and(|(_, h)| h <= max_h))
                .max_by_key(|v| (v.resolution.map(|(_, h)| h).unwrap_or(0), v.bandwidth));
            if let Some(best) = under_cap {
                return Some(best);
            }
            if let Some(smallest) = variants
                .iter()
                .filter(|v| v.resolution.is_some())
                .min_by_key(|v| {
                    (
                        v.resolution.map(|(_, h)| h).unwrap_or(u32::MAX),
                        v.bandwidth,
                    )
                })
            {
                return Some(smallest);
            }
        }

        variants.iter().max_by_key(|v| v.bandwidth)
    }

    pub fn select_hls_audio_track<'a>(
        tracks: &'a [M3U8MediaTrack],
        audio_group: Option<&str>,
        preferred_language: Option<&str>,
    ) -> Option<&'a M3U8MediaTrack> {
        let group = audio_group?;
        let candidates: Vec<&'a M3U8MediaTrack> = tracks
            .iter()
            .filter(|track| {
                track.media_type == "AUDIO" && track.group_id == group && track.uri.is_some()
            })
            .collect();

        if let Some(pref) = preferred_language
            .map(str::trim)
            .filter(|lang| !lang.is_empty())
        {
            let pref_lower = pref.to_ascii_lowercase();
            if let Some(exact) = candidates.iter().find(|track| {
                track
                    .language
                    .as_deref()
                    .is_some_and(|lang| lang.to_ascii_lowercase() == pref_lower)
                    || track.name.to_ascii_lowercase() == pref_lower
            }) {
                return Some(*exact);
            }
            if let Some(prefix) = candidates.iter().find(|track| {
                track.language.as_deref().is_some_and(|lang| {
                    let lower = lang.to_ascii_lowercase();
                    lower.starts_with(&pref_lower) || pref_lower.starts_with(&lower)
                })
            }) {
                return Some(*prefix);
            }
        }

        candidates
            .iter()
            .find(|track| track.is_default)
            .or_else(|| candidates.iter().find(|track| track.autoselect))
            .or_else(|| candidates.first())
            .copied()
    }

    fn resolve_entry_url(&self, base_url: &str, raw_url: &str) -> Result<String> {
        if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
            Ok(raw_url.to_string())
        } else {
            self.resolve_relative_url(base_url, raw_url)
        }
    }

    fn split_attribute_list(input: &str) -> Vec<&str> {
        let mut attributes = Vec::new();
        let mut in_quotes = false;
        let mut start = 0usize;

        for (idx, ch) in input.char_indices() {
            match ch {
                '"' => in_quotes = !in_quotes,
                ',' if !in_quotes => {
                    attributes.push(input[start..idx].trim());
                    start = idx + 1;
                }
                _ => {}
            }
        }

        let tail = input[start..].trim();
        if !tail.is_empty() {
            attributes.push(tail);
        }

        attributes
    }

    /// 解析加密行信息
    fn parse_encryption_line(&self, line: &str) -> Result<Option<M3U8Encryption>> {
        let key_line = line.strip_prefix("#EXT-X-KEY:").unwrap_or(line);
        let parts = Self::split_attribute_list(key_line);

        let mut method = String::new();
        let mut key_url = None;
        let mut iv = None;

        for part in parts {
            let Some((raw_key, raw_value)) = part.split_once('=') else {
                continue;
            };

            let key = raw_key.trim();
            let value = raw_value.trim().trim_matches('"');

            match key {
                "METHOD" => method = value.to_string(),
                "URI" => key_url = Some(value.to_string()),
                "IV" => iv = Some(value.to_string()),
                _ => {}
            }
        }

        if method == "NONE" {
            return Ok(None);
        }

        Ok(Some(M3U8Encryption {
            method,
            key_url,
            iv,
            key_data: None,
        }))
    }

    fn resolve_encryption_key_url(
        &self,
        base_url: &str,
        encryption: &mut M3U8Encryption,
    ) -> Result<()> {
        let Some(key_url) = encryption.key_url.as_deref() else {
            return Ok(());
        };

        let resolved = if Url::parse(key_url).is_ok() {
            key_url.to_string()
        } else {
            Url::parse(base_url)?.join(key_url)?.to_string()
        };
        crate::utils::validation::assert_http_url(&resolved)?;
        encryption.key_url = Some(resolved);
        Ok(())
    }

    /// 获取基础URL
    fn get_base_url(&self, m3u8_url: &str) -> Result<String> {
        let url = Url::parse(m3u8_url)?;
        Ok(url.to_string())
    }

    /// 解析相对URL
    fn resolve_relative_url(&self, base_url: &str, relative_url: &str) -> Result<String> {
        let base = Url::parse(base_url)?;
        let resolved = base.join(relative_url)?;
        Ok(resolved.to_string())
    }

    /// 获取加密密钥
    async fn fetch_encryption_key(
        &self,
        client: &Client,
        encryption: &M3U8Encryption,
    ) -> Result<Option<Vec<u8>>> {
        if let Some(ref key_url) = encryption.key_url {
            tracing::debug!("获取加密密钥: {}", key_url);

            let response = client.get(key_url).send().await?;
            if !response.status().is_success() {
                bail!("获取加密密钥失败: {}", response.status());
            }

            let key_data = response.bytes().await?;
            Ok(Some(key_data.to_vec()))
        } else {
            Ok(None)
        }
    }

    async fn hydrate_segment_encryption_keys_with_client(
        &self,
        client: &Client,
        playlist: &mut M3U8Playlist,
    ) -> Result<()> {
        let mut key_cache: HashMap<String, Vec<u8>> = HashMap::new();

        for segment in &mut playlist.segments {
            let Some(encryption) = segment.encryption.as_mut() else {
                continue;
            };

            if encryption.method.to_uppercase() == "NONE" || encryption.key_data.is_some() {
                continue;
            }

            let Some(key_url) = encryption.key_url.clone() else {
                continue;
            };

            let key = if let Some(cached) = key_cache.get(&key_url) {
                cached.clone()
            } else {
                let fetched = self
                    .fetch_encryption_key(client, encryption)
                    .await?
                    .ok_or_else(|| anyhow!("AES-128 加密片段缺少密钥 URL"))?;
                key_cache.insert(key_url.clone(), fetched.clone());
                fetched
            };

            encryption.key_data = Some(key);
        }

        if !key_cache.is_empty() {
            tracing::info!("已获取 {} 个 HLS AES-128 密钥", key_cache.len());
        }

        Ok(())
    }

    async fn download_init_maps_with_client(
        &self,
        client: &Client,
        playlist: &M3U8Playlist,
        temp_dir: &Path,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<HashMap<M3U8InitMap, PathBuf>> {
        let mut seen = HashSet::new();
        let mut result = HashMap::new();
        let mut idx = 0usize;

        for segment in &playlist.segments {
            let Some(ref init_map) = segment.init_map else {
                continue;
            };
            if !seen.insert(init_map.clone()) {
                continue;
            }
            let init_path = temp_dir.join(format!("init_{:04}.bin", idx));
            idx += 1;

            let already_valid = tokio::fs::metadata(&init_path)
                .await
                .map(|m| m.is_file() && m.len() > 0)
                .unwrap_or(false);
            if !already_valid {
                Self::download_segment_static(
                    client,
                    &self.config,
                    &init_map.url,
                    &init_path,
                    init_map.byte_range,
                    0,
                    None,
                    cancel_flag.clone(),
                    pause_flag.clone(),
                )
                .await?;
            }

            result.insert(init_map.clone(), init_path);
        }

        Ok(result)
    }

    /// 下载所有片段
    #[allow(clippy::too_many_arguments)]
    async fn download_segments(
        &self,
        task_id: &str,
        client: &Client,
        playlist: &M3U8Playlist,
        temp_dir: &Path,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        progress_tx: Option<mpsc::UnboundedSender<(String, DownloadStats)>>,
        bandwidth_controller: Option<BandwidthController>,
    ) -> Result<Vec<PathBuf>> {
        tracing::info!("开始下载 {} 个片段", playlist.segments.len());

        let mut segment_files = Vec::with_capacity(playlist.segments.len());
        let mut handles: Vec<tokio::task::JoinHandle<Result<()>>> = Vec::new();

        let total_segments = playlist.segments.len();
        let downloaded_count = Arc::new(AtomicU64::new(0));
        let downloaded_bytes = Arc::new(AtomicU64::new(0));
        let total_bytes_hint = if playlist.segments.iter().all(|seg| seg.byte_range.is_some()) {
            let mut sum = 0u64;
            for segment in &playlist.segments {
                if let Some((start, end)) = segment.byte_range {
                    sum = sum.saturating_add(end.saturating_sub(start).saturating_add(1));
                }
            }
            Some(sum)
        } else {
            None
        };
        let start_time = Instant::now();

        for (index, segment) in playlist.segments.iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                for handle in handles {
                    handle.abort();
                }
                return Err(if cancel_flag.load(Ordering::Relaxed) {
                    anyhow::anyhow!("download_cancelled")
                } else {
                    anyhow::anyhow!("download_paused")
                });
            }
            let segment_file = temp_dir.join(format!("segment_{:06}.ts", index));
            segment_files.push(segment_file.clone());

            let semaphore = Arc::clone(&self.semaphore);
            let client = client.clone();
            let segment_url = segment.url.clone();
            let config = self.config.clone();
            let cancel_flag = Arc::clone(&cancel_flag);
            let downloaded_count = Arc::clone(&downloaded_count);
            let downloaded_bytes = Arc::clone(&downloaded_bytes);
            let task_id = task_id.to_string();
            let progress_tx = progress_tx.clone();
            let bandwidth_controller = bandwidth_controller.clone();
            let byte_range = segment.byte_range;
            let encryption = segment.encryption.clone();
            let segment_index = segment.index;
            let media_sequence = segment.media_sequence;
            let pause_flag = Arc::clone(&pause_flag);

            let handle = tokio::spawn(async move {
                let bytes_written = if let Ok(meta) = tokio::fs::metadata(&segment_file).await {
                    if meta.is_file() && meta.len() > 0 {
                        tracing::debug!(
                            "复用已下载片段 #{}/{}: {}",
                            segment_index,
                            total_segments,
                            segment_file.display()
                        );
                        meta.len()
                    } else {
                        let _permit = semaphore
                            .acquire()
                            .await
                            .map_err(|_| anyhow::anyhow!("segment semaphore closed"))?;
                        if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed)
                        {
                            return Err(if cancel_flag.load(Ordering::Relaxed) {
                                anyhow::anyhow!("download_cancelled")
                            } else {
                                anyhow::anyhow!("download_paused")
                            });
                        }
                        let written = Self::download_segment_static(
                            &client,
                            &config,
                            &segment_url,
                            &segment_file,
                            byte_range,
                            media_sequence,
                            encryption,
                            cancel_flag.clone(),
                            pause_flag.clone(),
                        )
                        .await
                        .map_err(|e| {
                            anyhow::anyhow!(
                                "片段 #{}/{} ({}) 下载失败: {}",
                                segment_index,
                                total_segments,
                                segment_url,
                                e
                            )
                        })?;
                        if let Some(ref bw) = bandwidth_controller {
                            bw.throttle(written).await;
                        }
                        written
                    }
                } else {
                    let _permit = semaphore
                        .acquire()
                        .await
                        .map_err(|_| anyhow::anyhow!("segment semaphore closed"))?;

                    if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                        return Err(if cancel_flag.load(Ordering::Relaxed) {
                            anyhow::anyhow!("download_cancelled")
                        } else {
                            anyhow::anyhow!("download_paused")
                        });
                    }

                    tracing::debug!(
                        "开始下载片段 #{}/{}: {}",
                        segment_index,
                        total_segments,
                        segment_url
                    );

                    let written = Self::download_segment_static(
                        &client,
                        &config,
                        &segment_url,
                        &segment_file,
                        byte_range,
                        media_sequence,
                        encryption,
                        cancel_flag.clone(),
                        pause_flag.clone(),
                    )
                    .await
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "片段 #{}/{} ({}) 下载失败: {}",
                            segment_index,
                            total_segments,
                            segment_url,
                            e
                        )
                    })?;
                    if let Some(ref bw) = bandwidth_controller {
                        bw.throttle(written).await;
                    }
                    written
                };

                let current_downloaded = downloaded_count.fetch_add(1, Ordering::Relaxed) + 1;
                let total_written =
                    downloaded_bytes.fetch_add(bytes_written, Ordering::Relaxed) + bytes_written;
                let elapsed = start_time.elapsed();
                let speed = if elapsed.as_secs_f64() > 0.0 {
                    total_written as f64 / elapsed.as_secs_f64()
                } else {
                    0.0
                };

                let (progress, total_bytes_stat, eta) = if let Some(total_hint) = total_bytes_hint {
                    let mut pct = (total_written as f64 / total_hint as f64).min(1.0);
                    let mut remaining_eta = if speed > 0.0 && total_written < total_hint {
                        Some(((total_hint - total_written) as f64 / speed) as u64)
                    } else {
                        None
                    };
                    let mut total_for_event = total_hint;
                    if total_written > total_hint {
                        total_for_event = total_written;
                        pct = 1.0;
                        remaining_eta = None;
                    }
                    (pct, Some(total_for_event), remaining_eta)
                } else {
                    (
                        current_downloaded as f64 / total_segments as f64,
                        None,
                        None,
                    )
                };

                if let Some(ref tx) = progress_tx {
                    let is_committing = progress >= 1.0;
                    let stats = DownloadStats {
                        speed: if is_committing { 0.0 } else { speed },
                        downloaded_bytes: total_written,
                        total_bytes: total_bytes_stat,
                        progress: if is_committing { 0.999 } else { progress },
                        eta: if is_committing { None } else { eta },
                        status_hint: if is_committing {
                            Some(TaskStatus::Committing)
                        } else {
                            None
                        },
                        start_time: chrono::Utc::now(),
                        last_update: chrono::Utc::now(),
                    };
                    let _ = tx.send((task_id.clone(), stats));
                }

                Ok(())
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

        tracing::info!("所有片段下载完成");
        Ok(segment_files)
    }

    /// 静态方法下载单个片段（指数退避重试，非重试 HTTP 状态立即失败）
    #[allow(clippy::too_many_arguments)]
    async fn download_segment_static(
        client: &Client,
        config: &M3U8DownloaderConfig,
        segment_url: &str,
        output_file: &Path,
        byte_range: Option<(u64, u64)>,
        media_sequence: u64,
        encryption: Option<M3U8Encryption>,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<u64> {
        let mut retry_count = 0usize;

        while retry_count <= config.retry_attempts {
            if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                return Err(if cancel_flag.load(Ordering::Relaxed) {
                    anyhow::anyhow!("download_cancelled")
                } else {
                    anyhow::anyhow!("download_paused")
                });
            }
            match Self::download_segment_attempt(
                client,
                segment_url,
                output_file,
                byte_range,
                media_sequence,
                encryption.clone(),
                cancel_flag.clone(),
                pause_flag.clone(),
            )
            .await
            {
                Ok(bytes) => return Ok(bytes),
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("download_cancelled")
                        || msg.contains("download_paused")
                        || e.downcast_ref::<NonRetryableSegmentError>().is_some()
                    {
                        return Err(e);
                    }
                    retry_count += 1;
                    if retry_count <= config.retry_attempts {
                        let backoff_ms =
                            (500u64.saturating_mul(1u64 << (retry_count - 1).min(4))).min(8000);
                        tracing::warn!(
                            "片段下载失败，{}ms 后第 {} 次重试: {} - {}",
                            backoff_ms,
                            retry_count,
                            segment_url,
                            e
                        );
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                    } else {
                        return Err(e);
                    }
                }
            }
        }

        unreachable!()
    }

    /// 单次片段下载尝试
    #[allow(clippy::too_many_arguments)]
    async fn download_segment_attempt(
        client: &Client,
        segment_url: &str,
        output_file: &Path,
        byte_range: Option<(u64, u64)>,
        media_sequence: u64,
        encryption: Option<M3U8Encryption>,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<u64> {
        if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
            if cancel_flag.load(Ordering::Relaxed) {
                bail!("download_cancelled");
            } else {
                bail!("download_paused");
            }
        }
        let mut request = client.get(segment_url);
        if let Some((start, end)) = byte_range {
            request = request.header("Range", format!("bytes={}-{}", start, end));
        }

        let response = request.send().await?;
        let response_status = response.status();

        if !response_status.is_success() {
            let status_code = response_status.as_u16();
            if matches!(status_code, 401 | 403 | 404 | 410) {
                return Err(NonRetryableSegmentError(format!(
                    "下载片段失败(不可重试 {}): {} - {}",
                    status_code, segment_url, response_status
                ))
                .into());
            }
            bail!("下载片段失败: {} - {}", segment_url, response_status);
        }

        if byte_range.is_some() && response_status.as_u16() != 206 {
            return Err(NonRetryableSegmentError(format!(
                "服务器未返回 M3U8 byte-range 分片响应(206)，无法安全写入片段: {}",
                response_status
            ))
            .into());
        }

        let mut data = response.bytes().await?.to_vec();
        if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
            if cancel_flag.load(Ordering::Relaxed) {
                bail!("download_cancelled");
            } else {
                bail!("download_paused");
            }
        }
        if let Some(enc) = encryption {
            if enc.method.to_uppercase() == "AES-128" {
                Self::decrypt_segment_data(&mut data, &enc, media_sequence)?;
            }
        }

        let temp_file = output_file.with_extension("ts.tmp");
        let write_result: Result<()> = async {
            let mut file = File::create(&temp_file).await?;
            file.write_all(&data).await?;
            file.flush().await?;
            Ok(())
        }
        .await;
        if let Err(err) = write_result {
            let _ = tokio::fs::remove_file(&temp_file).await;
            return Err(err);
        }
        tokio::fs::rename(&temp_file, output_file).await?;

        Ok(data.len() as u64)
    }

    /// 解密单个 TS/fMP4 片段
    fn decrypt_segment_data(
        data: &mut Vec<u8>,
        encryption: &M3U8Encryption,
        media_sequence: u64,
    ) -> Result<()> {
        let key = encryption
            .key_data
            .as_ref()
            .ok_or_else(|| anyhow!("片段解密缺少 AES-128 密钥数据"))?;
        if key.len() != 16 {
            bail!("AES-128 密钥长度必须为 16 字节，当前为 {}", key.len());
        }

        let iv = Self::derive_iv_bytes(encryption, media_sequence)?;
        let decryptor =
            Decryptor::<Aes128>::new_from_slices(key, &iv).map_err(|e| anyhow!(e.to_string()))?;
        let decrypted = decryptor
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map_err(|_| anyhow!("AES-128 解密失败"))?;
        data.clear();
        data.extend_from_slice(&decrypted);
        Ok(())
    }

    /// 计算 RFC 8216 AES-128 IV（默认使用 media sequence）
    fn derive_iv_bytes(encryption: &M3U8Encryption, media_sequence: u64) -> Result<[u8; 16]> {
        if let Some(ref iv) = encryption.iv {
            if let Some(parsed) = Self::parse_iv(iv) {
                return Ok(parsed);
            }
            tracing::warn!("IV 格式解析失败，自动使用 media_sequence 默认值");
        }

        let mut iv = [0u8; 16];
        iv[8..].copy_from_slice(&media_sequence.to_be_bytes());
        Ok(iv)
    }

    fn parse_iv(iv: &str) -> Option<[u8; 16]> {
        let mut trimmed = iv.trim();
        if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
            trimmed = &trimmed[2..];
        }
        let decoded = hex::decode(trimmed).ok()?;
        if decoded.len() != 16 {
            return None;
        }
        let mut arr = [0u8; 16];
        arr.copy_from_slice(&decoded);
        Some(arr)
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

    /// 合并片段与 fMP4 初始化块为最终文件（优先原子 .part 提交，如为 MP4/MKV 且存在 FFmpeg 且为真实流媒体帧则无损重封装）
    #[allow(clippy::too_many_arguments)]
    async fn merge_segments_with_options(
        &self,
        playlist: &M3U8Playlist,
        segment_files: &[PathBuf],
        init_paths: &HashMap<M3U8InitMap, PathBuf>,
        temp_dir: &Path,
        output_path: &str,
        explicit_container: Option<&str>,
        ffmpeg_override: Option<&Path>,
        allow_remux: bool,
    ) -> Result<()> {
        tracing::info!("合并 {} 个片段到: {}", segment_files.len(), output_path);

        let output_file_path = Path::new(output_path);
        if let Some(parent) = output_file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let target_ext = output_file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        let wants_container_remux = allow_remux
            && matches!(
                target_ext.as_deref(),
                Some("mp4" | "m4v" | "mkv" | "mov" | "webm")
            );

        let part_path = if wants_container_remux {
            temp_dir.join("merged_stream.raw")
        } else {
            derive_part_path(output_file_path)
        };

        let mut first_header = Vec::with_capacity(16);
        let merge_result: Result<()> = async {
            let mut output_file = File::create(&part_path).await?;
            let mut buffer = vec![0u8; self.config.buffer_size];
            let mut last_init_map: Option<&M3U8InitMap> = None;

            for (index, segment_file) in segment_files.iter().enumerate() {
                if !segment_file.exists() {
                    bail!("片段文件不存在: {:?}", segment_file);
                }

                if let Some(init_map) = playlist
                    .segments
                    .get(index)
                    .and_then(|s| s.init_map.as_ref())
                {
                    if last_init_map != Some(init_map) {
                        if let Some(init_path) = init_paths.get(init_map) {
                            Self::append_file_bytes(
                                init_path,
                                &mut output_file,
                                &mut buffer,
                                &mut first_header,
                            )
                            .await?;
                            last_init_map = Some(init_map);
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
                if let Err(remux_err) =
                    remux_single_stream(&ffmpeg, &part_path, output_file_path, explicit_container)
                        .await
                {
                    tracing::warn!("FFmpeg 重封装失败，回退至原子流提交: {}", remux_err);
                } else {
                    let _ = tokio::fs::remove_file(&part_path).await;
                    tracing::info!("片段合并并重封装完成");
                    return Ok(());
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

        tracing::info!("片段合并完成");
        Ok(())
    }

    /// 清理临时文件
    async fn cleanup_temp_files(&self, temp_dir: &Path) -> Result<()> {
        if temp_dir.exists() {
            tracing::debug!("清理临时目录: {:?}", temp_dir);
            tokio::fs::remove_dir_all(temp_dir).await?;
        }
        Ok(())
    }

    /// 暂停下载
    pub async fn pause_download(&self, task_id: &str) -> Result<()> {
        if let Some(flag) = {
            let flags = self.pause_flags.read().await;
            flags.get(task_id).cloned()
        } {
            flag.store(true, Ordering::Relaxed);
        }
        tracing::info!("M3U8下载已暂停: {}", task_id);
        Ok(())
    }

    /// 恢复下载
    pub async fn resume_download(&self, task_id: &str) -> Result<()> {
        if let Some(flag) = {
            let flags = self.pause_flags.read().await;
            flags.get(task_id).cloned()
        } {
            flag.store(false, Ordering::Relaxed);
        }
        tracing::info!("M3U8下载已恢复: {}", task_id);
        Ok(())
    }

    /// 取消下载
    pub async fn cancel_download(&self, task_id: &str) -> Result<()> {
        if let Some(cancel_flag) = {
            let downloads = self.active_downloads.read().await;
            downloads.get(task_id).cloned()
        } {
            cancel_flag.store(true, Ordering::Relaxed);
        }
        tracing::info!("M3U8下载已取消: {}", task_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cbc::Encryptor;
    use cipher::BlockEncryptMut;
    use std::sync::atomic::AtomicUsize;
    use tempfile::tempdir;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn test_m3u8_downloader_creation() {
        let temp_dir = tempdir().unwrap();
        let config = M3U8DownloaderConfig {
            temp_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let downloader = M3U8Downloader::new(config);
        assert!(downloader.is_ok());
    }

    #[test]
    fn test_m3u8_content_parsing() {
        let m3u8_content = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:9.009,
http://example.com/segment000.ts
#EXTINF:9.009,
http://example.com/segment001.ts
#EXTINF:3.003,
http://example.com/segment002.ts
#EXT-X-ENDLIST"#;

        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();

        let playlist = runtime.block_on(async {
            downloader
                .parse_m3u8_content("http://example.com/playlist.m3u8", m3u8_content)
                .await
        });

        assert!(playlist.is_ok());
        let playlist = playlist.unwrap();

        assert_eq!(playlist.version, 3);
        assert_eq!(playlist.target_duration, 10.0);
        assert_eq!(playlist.segments.len(), 3);
        assert!((playlist.duration - 21.021).abs() < 0.001);
        assert!(!playlist.is_live);
        assert!(!playlist.is_master);
    }

    #[test]
    fn test_relative_url_resolution() {
        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();

        let base_url = "https://example.com/videos/";
        let relative_url = "segment000.ts";

        let resolved = downloader.resolve_relative_url(base_url, relative_url);
        assert!(resolved.is_ok());
        assert_eq!(
            resolved.unwrap(),
            "https://example.com/videos/segment000.ts"
        );
    }

    #[tokio::test]
    async fn test_m3u8_relative_segments_use_playlist_directory() {
        let m3u8_content = r#"#EXTM3U
#EXT-X-VERSION:3
#EXTINF:9.009,
segment000.ts
#EXT-X-ENDLIST"#;

        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();
        let playlist = downloader
            .parse_m3u8_content("https://example.com/videos/hls/master.m3u8", m3u8_content)
            .await
            .unwrap();

        assert_eq!(
            playlist.segments[0].url,
            "https://example.com/videos/hls/segment000.ts"
        );
    }

    #[tokio::test]
    async fn test_m3u8_relative_key_uri_uses_playlist_directory() {
        let m3u8_content = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin",IV=0X00000000000000000000000000000000
#EXTINF:9.009,
segment000.ts
#EXT-X-ENDLIST"#;

        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();
        let playlist = downloader
            .parse_m3u8_content("https://example.com/videos/hls/master.m3u8", m3u8_content)
            .await
            .unwrap();

        assert_eq!(
            playlist.segments[0]
                .encryption
                .as_ref()
                .and_then(|enc| enc.key_url.as_deref()),
            Some("https://example.com/videos/keys/key.bin")
        );
    }

    #[tokio::test]
    async fn test_master_playlist_variant_and_audio_track_selection() {
        let master_content = r#"#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",DEFAULT=NO,AUTOSELECT=YES,URI="audio/ja.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.4d401f",AUDIO="aud"
video/480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,CODECS="avc1.4d401f",AUDIO="aud"
video/720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028",AUDIO="aud"
video/1080p.m3u8
"#;

        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();
        let parsed = downloader
            .parse_m3u8_content("https://cdn.example.com/hls/master.m3u8", master_content)
            .await
            .unwrap();

        assert!(parsed.is_master);
        assert_eq!(parsed.variants.len(), 3);
        assert_eq!(parsed.media_tracks.len(), 2);

        let cap_720 = M3U8Downloader::select_hls_variant(&parsed.variants, Some("720p")).unwrap();
        assert_eq!(cap_720.resolution, Some((1280, 720)));
        assert_eq!(cap_720.url, "https://cdn.example.com/hls/video/720p.m3u8");

        let best = M3U8Downloader::select_hls_variant(&parsed.variants, None).unwrap();
        assert_eq!(best.resolution, Some((1920, 1080)));

        let ja_audio =
            M3U8Downloader::select_hls_audio_track(&parsed.media_tracks, Some("aud"), Some("ja"))
                .unwrap();
        assert_eq!(
            ja_audio.uri.as_deref(),
            Some("https://cdn.example.com/hls/audio/ja.m3u8")
        );

        let default_audio =
            M3U8Downloader::select_hls_audio_track(&parsed.media_tracks, Some("aud"), None)
                .unwrap();
        assert_eq!(
            default_audio.uri.as_deref(),
            Some("https://cdn.example.com/hls/audio/en.m3u8")
        );
    }

    #[tokio::test]
    async fn test_media_sequence_default_iv_and_fmp4_init_map_download() {
        fn encrypt_segment(data: &[u8], key: &[u8; 16], iv: &[u8; 16]) -> Vec<u8> {
            Encryptor::<Aes128>::new_from_slices(key, iv)
                .unwrap()
                .encrypt_padded_vec_mut::<Pkcs7>(data)
        }

        let key = *b"0123456789abcdef";
        let mut iv_seq42 = [0u8; 16];
        iv_seq42[8..].copy_from_slice(&42u64.to_be_bytes());
        let plain_seg = b"fmp4-payload-seq42";
        let encrypted_seg = encrypt_segment(plain_seg, &key, &iv_seq42);
        let init_bytes = b"INIT-FTYP-MOOV".to_vec();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let saw_custom_header = Arc::new(AtomicBool::new(false));
        let saw_header_clone = Arc::clone(&saw_custom_header);

        let server = tokio::spawn(async move {
            for _ in 0..4 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = [0u8; 2048];
                let n = socket.read(&mut buffer).await.unwrap();
                let req = String::from_utf8_lossy(&buffer[..n]);
                if req.to_ascii_lowercase().contains("x-custom-hls: ok") {
                    saw_header_clone.store(true, Ordering::Relaxed);
                }
                let path = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/");
                let (status, body) = match path {
                    "/media.m3u8" => (
                        "200 OK",
                        b"#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA-SEQUENCE:42\n#EXT-X-MAP:URI=\"/init.mp4\",BYTERANGE=\"14@0\"\n#EXT-X-KEY:METHOD=AES-128,URI=\"/key.bin\"\n#EXTINF:4.0,\n/seg42.m4s\n#EXT-X-ENDLIST\n".to_vec(),
                    ),
                    "/key.bin" => ("200 OK", key.to_vec()),
                    "/init.mp4" => ("206 Partial Content", init_bytes.clone()),
                    "/seg42.m4s" => ("200 OK", encrypted_seg.clone()),
                    _ => ("404 Not Found", Vec::new()),
                };
                let resp = format!(
                    "HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    status,
                    body.len()
                );
                socket.write_all(resp.as_bytes()).await.unwrap();
                socket.write_all(&body).await.unwrap();
                socket.shutdown().await.unwrap();
            }
        });

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("X-Custom-Hls", "ok".parse().unwrap());
        let custom_client = Client::builder().default_headers(headers).build().unwrap();

        let temp_dir = tempdir().unwrap();
        let config = M3U8DownloaderConfig {
            temp_dir: temp_dir.path().join("segments"),
            ..Default::default()
        };
        let downloader = M3U8Downloader::new(config).unwrap();
        let output = temp_dir.path().join("fmp4_output.ts");

        downloader
            .download_m3u8_with_options(
                "fmp4-seq42",
                &format!("http://{}/media.m3u8", addr),
                &output.to_string_lossy(),
                M3U8DownloadContext {
                    client_override: Some(custom_client),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        server.await.unwrap();
        assert!(saw_custom_header.load(Ordering::Relaxed));
        let merged = tokio::fs::read(&output).await.unwrap();
        assert_eq!(
            merged,
            [b"INIT-FTYP-MOOV".as_slice(), plain_seg.as_slice()].concat()
        );
    }

    #[tokio::test]
    async fn test_segment_retries_503_once_and_fails_fast_on_404() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let hits_clone = Arc::clone(&hits);

        let server = tokio::spawn(async move {
            for _ in 0..3 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = [0u8; 1024];
                let n = socket.read(&mut buffer).await.unwrap();
                let req = String::from_utf8_lossy(&buffer[..n]);
                let path = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/");
                if path == "/flaky.ts" {
                    let count = hits_clone.fetch_add(1, Ordering::Relaxed);
                    if count == 0 {
                        let resp = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        socket.write_all(resp.as_bytes()).await.unwrap();
                    } else {
                        let body = b"recovered";
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        socket.write_all(resp.as_bytes()).await.unwrap();
                        socket.write_all(body).await.unwrap();
                    }
                } else {
                    hits_clone.fetch_add(1, Ordering::Relaxed);
                    let resp =
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    socket.write_all(resp.as_bytes()).await.unwrap();
                }
                socket.shutdown().await.unwrap();
            }
        });

        let temp_dir = tempdir().unwrap();
        let cfg = M3U8DownloaderConfig {
            retry_attempts: 2,
            temp_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };
        let client = Client::new();

        let ok_len = M3U8Downloader::download_segment_static(
            &client,
            &cfg,
            &format!("http://{}/flaky.ts", addr),
            &temp_dir.path().join("flaky.ts"),
            None,
            0,
            None,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        assert_eq!(ok_len, 9);
        assert_eq!(hits.load(Ordering::Relaxed), 2);

        let err_404 = M3U8Downloader::download_segment_static(
            &client,
            &cfg,
            &format!("http://{}/missing.ts", addr),
            &temp_dir.path().join("missing.ts"),
            None,
            1,
            None,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        assert!(err_404.is_err());
        // 404 must fail on the very first attempt without consuming retries (total hits 2 + 1 = 3).
        assert_eq!(hits.load(Ordering::Relaxed), 3);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn test_m3u8_download_uses_distinct_keys_per_segment() {
        fn encrypt_segment(data: &[u8], key: &[u8; 16], iv: &[u8; 16]) -> Vec<u8> {
            Encryptor::<Aes128>::new_from_slices(key, iv)
                .unwrap()
                .encrypt_padded_vec_mut::<Pkcs7>(data)
        }

        let key_a = *b"0123456789abcdef";
        let key_b = *b"abcdef0123456789";
        let iv_a = [0u8; 16];
        let mut iv_b = [0u8; 16];
        iv_b[15] = 1;
        let segment_a_plain = b"first segment payload";
        let segment_b_plain = b"second segment payload";
        let segment_a = encrypt_segment(segment_a_plain, &key_a, &iv_a);
        let segment_b = encrypt_segment(segment_b_plain, &key_b, &iv_b);

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..5 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = [0u8; 1024];
                let bytes_read = socket.read(&mut buffer).await.unwrap();
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");

                let (body, content_type): (Vec<u8>, &str) = match path {
                    "/master.m3u8" => (
                        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI=\"/key-a.bin\",IV=0X00000000000000000000000000000000\n#EXTINF:1.0,\n/seg-a.ts\n#EXT-X-KEY:METHOD=AES-128,URI=\"/key-b.bin\",IV=0X00000000000000000000000000000001\n#EXTINF:1.0,\n/seg-b.ts\n#EXT-X-ENDLIST\n".to_string()
                        .into_bytes(),
                        "application/vnd.apple.mpegurl",
                    ),
                    "/key-a.bin" => (key_a.to_vec(), "application/octet-stream"),
                    "/key-b.bin" => (key_b.to_vec(), "application/octet-stream"),
                    "/seg-a.ts" => (segment_a.clone(), "video/mp2t"),
                    "/seg-b.ts" => (segment_b.clone(), "video/mp2t"),
                    _ => (Vec::new(), "text/plain"),
                };

                let status = if body.is_empty() {
                    "404 Not Found"
                } else {
                    "200 OK"
                };
                let response = format!(
                    "HTTP/1.1 {}\r\nContent-Length: {}\r\nContent-Type: {}\r\nConnection: close\r\n\r\n",
                    status,
                    body.len(),
                    content_type
                );
                socket.write_all(response.as_bytes()).await.unwrap();
                socket.write_all(&body).await.unwrap();
                socket.shutdown().await.unwrap();
            }
        });

        let temp_dir = tempdir().unwrap();
        let config = M3U8DownloaderConfig {
            temp_dir: temp_dir.path().join("segments"),
            ..Default::default()
        };
        let downloader = M3U8Downloader::new(config).unwrap();
        let output = temp_dir.path().join("output.ts");

        downloader
            .download_m3u8(
                "multi-key-task",
                &format!("http://{}/master.m3u8", addr),
                &output.to_string_lossy(),
                Arc::new(AtomicBool::new(false)),
            )
            .await
            .unwrap();

        let merged = tokio::fs::read(&output).await.unwrap();
        assert_eq!(
            merged,
            [segment_a_plain.as_slice(), segment_b_plain.as_slice()].concat()
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn test_byte_range_segment_rejects_ignored_range() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 1024];
            let _ = socket.read(&mut buffer).await.unwrap();
            let body = b"full segment";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
            socket.write_all(body).await.unwrap();
            socket.shutdown().await.unwrap();
        });

        let temp_dir = tempdir().unwrap();
        let output_file = temp_dir.path().join("segment.ts");
        let result = M3U8Downloader::download_segment_attempt(
            &Client::new(),
            &format!("http://{}", addr),
            &output_file,
            Some((0, 3)),
            0,
            None,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("206"));
        server.await.unwrap();
    }

    #[test]
    fn test_encryption_parsing() {
        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();

        let encryption_line = r#"#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key.bin",IV=0X99b74007b6254e4bd1c6e03631cad15b"#;

        let encryption = downloader.parse_encryption_line(encryption_line).unwrap();
        assert!(encryption.is_some());

        let encryption = encryption.unwrap();
        assert_eq!(encryption.method, "AES-128");
        assert_eq!(encryption.key_url.unwrap(), "https://example.com/key.bin");
        assert_eq!(encryption.iv.unwrap(), "0X99b74007b6254e4bd1c6e03631cad15b");
    }

    #[test]
    fn test_encryption_parsing_preserves_equals_and_commas_in_uri() {
        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();
        let encryption_line = r#"#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key?token=abc==&a=1,2",IV=0X99b74007b6254e4bd1c6e03631cad15b"#;

        let encryption = downloader
            .parse_encryption_line(encryption_line)
            .unwrap()
            .unwrap();
        assert_eq!(encryption.method, "AES-128");
        assert_eq!(
            encryption.key_url.as_deref(),
            Some("https://example.com/key?token=abc==&a=1,2")
        );
    }

    #[tokio::test]
    async fn test_bom_playlist_and_safe_temp_dir_sanitization() {
        let downloader = M3U8Downloader::new(M3U8DownloaderConfig::default()).unwrap();
        let bom_playlist = "\u{feff}#EXTM3U\n#EXTINF:2.0,\nseg0.ts\n#EXT-X-ENDLIST\n";
        let parsed = downloader
            .parse_m3u8_content("https://example.com/live/index.m3u8", bom_playlist)
            .await
            .unwrap();
        assert_eq!(parsed.segments.len(), 1);
        assert_eq!(parsed.segments[0].url, "https://example.com/live/seg0.ts");

        let base = Path::new("/tmp/m3u8");
        let resolved =
            M3U8Downloader::resolve_safe_task_temp_dir(base, "../../etc/passwd").unwrap();
        assert!(resolved.starts_with(base));
    }

    #[tokio::test]
    async fn test_concurrent_m3u8_tasks_do_not_cross_contaminate_progress_channels() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            for _ in 0..4 {
                let (mut socket, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req
                        .lines()
                        .next()
                        .and_then(|l| l.split_whitespace().nth(1))
                        .unwrap_or("/");
                    let (ctype, body): (&str, Vec<u8>) = if path.ends_with(".m3u8") {
                        let seg_name = if path.contains("a.m3u8") {
                            "seg_a.ts"
                        } else {
                            "seg_b.ts"
                        };
                        (
                            "application/vnd.apple.mpegurl",
                            format!("#EXTM3U\n#EXTINF:1.0,\n{}\n#EXT-X-ENDLIST\n", seg_name)
                                .into_bytes(),
                        )
                    } else {
                        ("video/mp2t", vec![0x47; 64])
                    };
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        ctype,
                        body.len()
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    let _ = socket.write_all(&body).await;
                });
            }
        });

        let temp = tempfile::tempdir().unwrap();
        let cfg = M3U8DownloaderConfig {
            temp_dir: temp.path().join("tmp"),
            keep_temp_files: false,
            ..Default::default()
        };
        let downloader = Arc::new(M3U8Downloader::new(cfg).unwrap());

        let (tx_a, mut rx_a) = mpsc::unbounded_channel();
        let (tx_b, mut rx_b) = mpsc::unbounded_channel();

        let out_a = temp.path().join("a.ts");
        let out_b = temp.path().join("b.ts");

        let d1 = Arc::clone(&downloader);
        let d2 = Arc::clone(&downloader);
        let url_a = format!("http://{}/a.m3u8", addr);
        let url_b = format!("http://{}/b.m3u8", addr);
        let oa = out_a.to_string_lossy().to_string();
        let ob = out_b.to_string_lossy().to_string();

        let (res_a, res_b) = tokio::join!(
            d1.download_m3u8_with_context(
                "task-a",
                &url_a,
                &oa,
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicBool::new(false)),
                Some(tx_a),
                None,
            ),
            d2.download_m3u8_with_context(
                "task-b",
                &url_b,
                &ob,
                Arc::new(AtomicBool::new(false)),
                Arc::new(AtomicBool::new(false)),
                Some(tx_b),
                None,
            ),
        );

        res_a.unwrap();
        res_b.unwrap();
        server.await.unwrap();

        let mut a_ids = Vec::new();
        while let Ok((id, _)) = rx_a.try_recv() {
            a_ids.push(id);
        }
        let mut b_ids = Vec::new();
        while let Ok((id, _)) = rx_b.try_recv() {
            b_ids.push(id);
        }

        assert!(!a_ids.is_empty());
        assert!(!b_ids.is_empty());
        assert!(a_ids.iter().all(|id| id == "task-a"));
        assert!(b_ids.iter().all(|id| id == "task-b"));
    }
}
