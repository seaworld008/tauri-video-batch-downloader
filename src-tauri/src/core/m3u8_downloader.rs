//! M3U8/HLS 流媒体下载器
//!
//! 基于Go项目的M3U8Downloader实现，支持：
//! - .m3u8 播放列表解析
//! - .ts 片段并发下载
//! - 自动合并为完整视频文件
//! - 支持AES加密的HLS流
//! - 实时进度跟踪

use crate::core::downloader::DownloadStats;
use aes::Aes128;
use anyhow::{anyhow, bail, Result};
use cbc::Decryptor;
use cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use hex;
use parking_lot::RwLock as ParkingRwLock;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    /// 加密信息
    pub encryption: Option<M3U8Encryption>,
}

/// M3U8片段信息
#[derive(Debug, Clone)]
pub struct M3U8Segment {
    /// 片段索引
    pub index: usize,
    /// 片段URL
    pub url: String,
    /// 时长（秒）
    pub duration: f64,
    /// 字节范围（可选）
    pub byte_range: Option<(u64, u64)>,
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
    progress_tx: Arc<ParkingRwLock<Option<mpsc::UnboundedSender<(String, DownloadStats)>>>>,
    semaphore: Arc<Semaphore>,
    is_paused: Arc<AtomicBool>,
}

impl M3U8Downloader {
    /// 创建新的M3U8下载器实例
    pub fn new(config: M3U8DownloaderConfig) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout))
            .user_agent(&config.user_agent)
            .build()?;

        let semaphore = Arc::new(Semaphore::new(config.max_concurrent_segments));

        // 确保临时目录存在
        std::fs::create_dir_all(&config.temp_dir)?;

        Ok(Self {
            config,
            client,
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
            progress_tx: Arc::new(ParkingRwLock::new(None)),
            semaphore,
            is_paused: Arc::new(AtomicBool::new(false)),
        })
    }

    /// 设置进度回调
    pub fn set_progress_callback(&self, tx: mpsc::UnboundedSender<(String, DownloadStats)>) {
        *self.progress_tx.write() = Some(tx);
    }

    /// 下载M3U8流
    pub async fn download_m3u8(
        &self,
        task_id: &str,
        m3u8_url: &str,
        output_path: &str,
    ) -> Result<()> {
        tracing::info!("开始下载M3U8流: {}", m3u8_url);
        // 解析M3U8播放列表
        let playlist = self.parse_m3u8_playlist(m3u8_url).await?;
        tracing::info!(
            "解析到 {} 个片段，总时长: {:.2}秒",
            playlist.segments.len(),
            playlist.duration
        );

        if playlist.segments.is_empty() {
            bail!("M3U8播放列表为空");
        }

        // 创建任务临时目录
        let task_temp_dir = self.config.temp_dir.join(task_id);
        tokio::fs::create_dir_all(&task_temp_dir).await?;

        // 处理加密（如果有）
        let mut playlist = playlist;
        if let Some(ref mut encryption) = playlist.encryption {
            if encryption.method.to_uppercase() != "NONE" {
                if let Some(key) = self.fetch_encryption_key(encryption).await? {
                    encryption.key_data = Some(key.clone());
                    for segment in &mut playlist.segments {
                        if let Some(ref mut seg_enc) = segment.encryption {
                            if seg_enc.method.to_uppercase() != "NONE" {
                                seg_enc.key_data = Some(key.clone());
                            }
                        }
                    }
                    tracing::info!("已获取 AES-128 密钥并同步到所有片段");
                }
            }
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut downloads = self.active_downloads.write().await;
            downloads.insert(task_id.to_string(), cancel_flag.clone());
        }

        // 下载所有片段
        let result = self
            .download_segments(
                task_id,
                &playlist,
                &task_temp_dir,
                cancel_flag.clone(),
                Arc::clone(&self.is_paused),
            )
            .await;

        // 清理活跃下载记录
        {
            let mut downloads = self.active_downloads.write().await;
            downloads.remove(task_id);
        }

        match result {
            Ok(segment_files) => {
                tracing::info!("分片下载完成，开始合并");

                self.merge_segments(&segment_files, output_path).await?;

                if !self.config.keep_temp_files {
                    self.cleanup_temp_files(&task_temp_dir).await?;
                } else {
                    tracing::info!("根据配置保留临时分片目录: {}", task_temp_dir.display());
                }

                tracing::info!("M3U8下载完成: {}", output_path);
                Ok(())
            }
            Err(e) => {
                if !self.config.keep_temp_files {
                    self.cleanup_temp_files(&task_temp_dir).await.ok();
                } else {
                    tracing::warn!("下载失败，临时分片保留在: {}", task_temp_dir.display());
                }
                Err(e)
            }
        }
    }

    /// 解析M3U8播放列表
    async fn parse_m3u8_playlist(&self, m3u8_url: &str) -> Result<M3U8Playlist> {
        tracing::debug!("获取M3U8播放列表: {}", m3u8_url);

        let response = self.client.get(m3u8_url).send().await?;

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
            encryption: None,
        };

        let lines: Vec<&str> = content.lines().collect();

        // 验证是否为有效的M3U8文件
        if !lines.first().unwrap_or(&"").starts_with("#EXTM3U") {
            bail!("无效的M3U8文件格式");
        }

        let mut i = 0;
        let mut segment_index = 0;
        let mut current_segment_duration = 0.0;
        let mut pending_byte_range: Option<(u64, u64)> = None;
        let mut last_byte_range_end: Option<u64> = None;
        let mut current_encryption: Option<M3U8Encryption> = None;

        while i < lines.len() {
            let line = lines[i].trim();

            if line.is_empty() || line.starts_with('#') {
                if line.starts_with("#EXT-X-VERSION:") {
                    playlist.version = line
                        .replace("#EXT-X-VERSION:", "")
                        .parse::<u32>()
                        .unwrap_or(1);
                } else if line.starts_with("#EXT-X-TARGETDURATION:") {
                    playlist.target_duration = line
                        .replace("#EXT-X-TARGETDURATION:", "")
                        .parse::<f64>()
                        .unwrap_or(0.0);
                } else if line.starts_with("#EXTINF:") {
                    // 解析片段时长
                    let line_without_prefix = line.replace("#EXTINF:", "");
                    let duration_str = line_without_prefix.split(',').next().unwrap_or("0");
                    current_segment_duration = duration_str.parse::<f64>().unwrap_or(0.0);
                } else if line.starts_with("#EXT-X-KEY:") {
                    // 解析加密信息
                    current_encryption = self.parse_encryption_line(line)?;
                    playlist.encryption = current_encryption.clone();
                } else if line.starts_with("#EXT-X-BYTERANGE:") {
                    let value = line.replace("#EXT-X-BYTERANGE:", "");
                    let mut parts = value.split('@');
                    let length = parts
                        .next()
                        .unwrap_or("0")
                        .trim()
                        .parse::<u64>()
                        .unwrap_or(0);
                    if length == 0 {
                        tracing::warn!("检测到长度为 0 的 EXT-X-BYTERANGE: {}", line);
                        pending_byte_range = None;
                    } else {
                        let start = parts
                            .next()
                            .map(|s| s.trim().parse::<u64>().unwrap_or(0))
                            .or_else(|| last_byte_range_end.map(|end| end + 1))
                            .unwrap_or(0);
                        let end = start.saturating_add(length.saturating_sub(1));
                        pending_byte_range = Some((start, end));
                    }
                } else if line.contains("#EXT-X-ENDLIST") {
                    // 非Live流
                    playlist.is_live = false;
                }
                i += 1;
                continue;
            }

            // 处理片段URL
            let segment_url = if line.starts_with("http") {
                line.to_string()
            } else {
                self.resolve_relative_url(&playlist.base_url, line)?
            };

            let byte_range = pending_byte_range.take();
            if let Some((_, end)) = byte_range {
                last_byte_range_end = Some(end);
            }

            let segment = M3U8Segment {
                index: segment_index,
                url: segment_url,
                duration: current_segment_duration,
                byte_range,
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

        tracing::debug!(
            "解析完成: {} 个片段, 总时长: {:.2}秒",
            playlist.segments.len(),
            playlist.duration
        );

        Ok(playlist)
    }

    /// 解析加密行信息
    fn parse_encryption_line(&self, line: &str) -> Result<Option<M3U8Encryption>> {
        let key_line = line.replace("#EXT-X-KEY:", "");
        let parts: Vec<&str> = key_line.split(',').collect();

        let mut method = String::new();
        let mut key_url = None;
        let mut iv = None;

        for part in parts {
            let kv: Vec<&str> = part.split('=').collect();
            if kv.len() != 2 {
                continue;
            }

            let key = kv[0].trim();
            let value = kv[1].trim().trim_matches('"');

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

    /// 获取基础URL
    fn get_base_url(&self, m3u8_url: &str) -> Result<String> {
        let url = Url::parse(m3u8_url)?;
        let mut base_url = url.clone();
        base_url.set_path("");
        base_url.set_query(None);
        Ok(base_url.to_string())
    }

    /// 解析相对URL
    fn resolve_relative_url(&self, base_url: &str, relative_url: &str) -> Result<String> {
        let base = Url::parse(base_url)?;
        let resolved = base.join(relative_url)?;
        Ok(resolved.to_string())
    }

    /// 获取加密密钥
    async fn fetch_encryption_key(&self, encryption: &M3U8Encryption) -> Result<Option<Vec<u8>>> {
        if let Some(ref key_url) = encryption.key_url {
            tracing::debug!("获取加密密钥: {}", key_url);

            let response = self.client.get(key_url).send().await?;
            if !response.status().is_success() {
                bail!("获取加密密钥失败: {}", response.status());
            }

            let key_data = response.bytes().await?;
            Ok(Some(key_data.to_vec()))
        } else {
            Ok(None)
        }
    }

    /// 下载所有片段
    async fn download_segments(
        &self,
        task_id: &str,
        playlist: &M3U8Playlist,
        temp_dir: &Path,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<Vec<PathBuf>> {
        tracing::info!("开始下载 {} 个片段", playlist.segments.len());

        let mut segment_files = Vec::with_capacity(playlist.segments.len());
        let mut handles = Vec::new();

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
                return Err(anyhow::anyhow!("下载被取消"));
            }
            let segment_file = temp_dir.join(format!("segment_{:06}.ts", index));
            segment_files.push(segment_file.clone());

            let semaphore = Arc::clone(&self.semaphore);
            let client = self.client.clone();
            let segment_url = segment.url.clone();
            let config = self.config.clone();
            let cancel_flag = Arc::clone(&cancel_flag);
            let downloaded_count = Arc::clone(&downloaded_count);
            let downloaded_bytes = Arc::clone(&downloaded_bytes);
            let task_id = task_id.to_string();
            let progress_tx: Option<mpsc::UnboundedSender<(String, DownloadStats)>> =
                { self.progress_tx.read().clone() };
            let byte_range = segment.byte_range;
            let encryption = segment.encryption.clone();
            let segment_index = segment.index;
            let total_bytes_hint = total_bytes_hint;
            let start_time = start_time;
            let pause_flag = Arc::clone(&pause_flag);

            let handle = tokio::spawn(async move {
                let _permit = semaphore.acquire().await.unwrap();

                if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                    return Err(anyhow::anyhow!("下载被取消"));
                }

                tracing::debug!(
                    "开始下载片段 #{}/{}: {}",
                    segment_index,
                    total_segments,
                    segment_url
                );

                let bytes_written = Self::download_segment_static(
                    &client,
                    &config,
                    &segment_url,
                    &segment_file,
                    byte_range,
                    segment_index,
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
                    let stats = DownloadStats {
                        speed,
                        downloaded_bytes: total_written,
                        total_bytes: total_bytes_stat,
                        progress,
                        eta,
                        start_time: chrono::Utc::now(),
                        last_update: chrono::Utc::now(),
                    };
                    let _ = tx.send((task_id.clone(), stats));
                }

                tracing::debug!(
                    "片段 {}/{} 下载完成 (累计 {} bytes)",
                    current_downloaded,
                    total_segments,
                    total_written
                );

                Ok(())
            });

            handles.push(handle);
        }

        for handle in handles {
            handle.await??;
        }

        tracing::info!("所有片段下载完成");
        Ok(segment_files)
    }

    /// 静态方法下载单个片段
    async fn download_segment_static(
        client: &Client,
        config: &M3U8DownloaderConfig,
        segment_url: &str,
        output_file: &Path,
        byte_range: Option<(u64, u64)>,
        segment_index: usize,
        encryption: Option<M3U8Encryption>,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<u64> {
        let mut retry_count = 0;

        while retry_count <= config.retry_attempts {
            if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                return Err(anyhow::anyhow!("下载被取消"));
            }
            match Self::download_segment_attempt(
                client,
                segment_url,
                output_file,
                byte_range,
                segment_index,
                encryption.clone(),
                cancel_flag.clone(),
                pause_flag.clone(),
            )
            .await
            {
                Ok(bytes) => return Ok(bytes),
                Err(e) => {
                    retry_count += 1;
                    if retry_count <= config.retry_attempts {
                        tracing::warn!(
                            "片段下载失败，第 {} 次重试: {} - {}",
                            retry_count,
                            segment_url,
                            e
                        );
                        tokio::time::sleep(Duration::from_millis(1000)).await;
                    } else {
                        return Err(e);
                    }
                }
            }
        }

        unreachable!()
    }

    /// 单次片段下载尝试
    async fn download_segment_attempt(
        client: &Client,
        segment_url: &str,
        output_file: &Path,
        byte_range: Option<(u64, u64)>,
        segment_index: usize,
        encryption: Option<M3U8Encryption>,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
    ) -> Result<u64> {
        if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
            bail!("下载被取消");
        }
        let mut request = client.get(segment_url);
        if let Some((start, end)) = byte_range {
            request = request.header("Range", format!("bytes={}-{}", start, end));
        }

        let response = request.send().await?;

        if !response.status().is_success() {
            if let Some((start, end)) = byte_range {
                tracing::error!(
                    "片段请求失败: {} [{}-{}] - {}",
                    segment_url,
                    start,
                    end,
                    response.status()
                );
            } else {
                tracing::error!("片段请求失败: {} - {}", segment_url, response.status());
            }
            bail!("下载片段失败: {} - {}", segment_url, response.status());
        }

        let mut data = response.bytes().await?.to_vec();
        if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
            bail!("下载被取消");
        }
        if let Some(enc) = encryption {
            if enc.method.to_uppercase() == "AES-128" {
                Self::decrypt_segment_data(&mut data, &enc, segment_index)?;
            }
        }

        let mut file = File::create(output_file).await?;
        file.write_all(&data).await?;
        file.flush().await?;
        file.sync_all().await?;

        Ok(data.len() as u64)
    }

    /// 解密单个 TS 片段
    fn decrypt_segment_data(
        data: &mut Vec<u8>,
        encryption: &M3U8Encryption,
        segment_index: usize,
    ) -> Result<()> {
        let key = encryption
            .key_data
            .as_ref()
            .ok_or_else(|| anyhow!("片段解密缺少 AES-128 密钥数据"))?;
        if key.len() != 16 {
            bail!("AES-128 密钥长度必须为 16 字节，当前为 {}", key.len());
        }

        let iv = Self::derive_iv_bytes(encryption, segment_index)?;
        let decryptor =
            Decryptor::<Aes128>::new_from_slices(key, &iv).map_err(|e| anyhow!(e.to_string()))?;
        let decrypted = decryptor
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map_err(|_| anyhow!("AES-128 解密失败"))?;
        data.clear();
        data.extend_from_slice(&decrypted);
        Ok(())
    }

    /// 计算 AES-128 IV
    fn derive_iv_bytes(encryption: &M3U8Encryption, segment_index: usize) -> Result<[u8; 16]> {
        if let Some(ref iv) = encryption.iv {
            if let Some(parsed) = Self::parse_iv(iv) {
                return Ok(parsed);
            }
            tracing::warn!("IV 格式解析失败，自动使用默认值");
        }

        let mut iv = [0u8; 16];
        iv[8..].copy_from_slice(&(segment_index as u64).to_be_bytes());
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

    /// 合并片段为最终文件
    async fn merge_segments(&self, segment_files: &[PathBuf], output_path: &str) -> Result<()> {
        tracing::info!("合并 {} 个片段到: {}", segment_files.len(), output_path);

        let output_file_path = Path::new(output_path);
        if let Some(parent) = output_file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut output_file = File::create(output_file_path).await?;

        for (index, segment_file) in segment_files.iter().enumerate() {
            if !segment_file.exists() {
                bail!("片段文件不存在: {:?}", segment_file);
            }

            tracing::debug!(
                "合并片段 {}/{}: {:?}",
                index + 1,
                segment_files.len(),
                segment_file
            );

            let mut segment_file_handle = File::open(segment_file).await?;
            let mut buffer = vec![0u8; self.config.buffer_size];

            loop {
                let bytes_read = segment_file_handle.read(&mut buffer).await?;
                if bytes_read == 0 {
                    break;
                }
                output_file.write_all(&buffer[..bytes_read]).await?;
            }
        }

        output_file.flush().await?;
        output_file.sync_all().await?;

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
        self.is_paused.store(true, Ordering::Relaxed);
        tracing::info!("M3U8下载已暂停: {}", task_id);
        Ok(())
    }

    /// 恢复下载
    pub async fn resume_download(&self, task_id: &str) -> Result<()> {
        self.is_paused.store(false, Ordering::Relaxed);
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
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_m3u8_downloader_creation() {
        let temp_dir = tempdir().unwrap();
        let mut config = M3U8DownloaderConfig::default();
        config.temp_dir = temp_dir.path().to_path_buf();

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
}
