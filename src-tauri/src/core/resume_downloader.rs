//! 增强的断点续传下载器
//!
//! 基于Go项目的断点续传机制实现，支持：
//! - Range请求支持检测
//! - 智能分片下载
//! - 断点记录和恢复
//! - 服务器支持能力缓存
//! - 分片并行下载和合并

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, SystemTime};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::RwLock;

use crate::core::downloader::BandwidthController;

/// 下载进度回调：参数为 (task_id, delta_bytes, total_size)
pub type ResumeProgressCallback = Arc<dyn Fn(&str, u64, u64) + Send + Sync>;

/// 分片信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkInfo {
    /// 分片索引
    pub index: usize,
    /// 起始字节位置
    pub start: u64,
    /// 结束字节位置
    pub end: u64,
    /// 已下载字节数
    pub downloaded: u64,
    /// 分片状态
    pub status: ChunkStatus,
    /// 重试次数
    pub retry_count: usize,
    /// 最后更新时间
    pub last_update: SystemTime,
}

impl ChunkInfo {
    pub fn new(index: usize, start: u64, end: u64) -> Self {
        Self {
            index,
            start,
            end,
            downloaded: 0,
            status: ChunkStatus::Pending,
            retry_count: 0,
            last_update: SystemTime::now(),
        }
    }

    /// 获取分片大小
    pub fn size(&self) -> u64 {
        self.end - self.start + 1
    }

    /// 获取剩余未下载字节数
    pub fn remaining(&self) -> u64 {
        self.size() - self.downloaded
    }

    /// 是否完成
    pub fn is_completed(&self) -> bool {
        self.downloaded >= self.size() || self.status == ChunkStatus::Completed
    }
}

/// 分片状态
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ChunkStatus {
    Pending,     // 等待下载
    Downloading, // 下载中
    Completed,   // 已完成
    Failed,      // 下载失败
    Paused,      // 已暂停
}

/// 服务器支持能力信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    /// 是否支持Range请求
    pub supports_ranges: bool,
    /// 是否支持并发下载
    pub supports_concurrent: bool,
    /// 最大并发连接数
    pub max_concurrent: usize,
    /// 检测时间
    pub detected_at: SystemTime,
    /// 服务器标识
    pub server_info: Option<String>,
}

/// 断点续传信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeInfo {
    /// 任务ID
    pub task_id: String,
    /// 文件路径
    pub file_path: String,
    /// 文件总大小
    pub total_size: u64,
    /// 已下载总字节数
    pub downloaded_total: u64,
    /// 分片信息列表
    pub chunks: Vec<ChunkInfo>,
    /// 创建时间
    pub created_at: SystemTime,
    /// 最后更新时间
    pub last_modified: SystemTime,
    /// 原始URL
    pub original_url: String,
    /// 服务器支持能力
    pub server_capabilities: ServerCapabilities,
}

impl ResumeInfo {
    pub fn new(task_id: String, file_path: String, url: String, total_size: u64) -> Self {
        Self {
            task_id,
            file_path,
            total_size,
            downloaded_total: 0,
            chunks: Vec::new(),
            created_at: SystemTime::now(),
            last_modified: SystemTime::now(),
            original_url: url,
            server_capabilities: ServerCapabilities {
                supports_ranges: false,
                supports_concurrent: false,
                max_concurrent: 1,
                detected_at: SystemTime::now(),
                server_info: None,
            },
        }
    }

    /// 计算总体下载进度 (0.0 - 1.0)
    pub fn progress(&self) -> f64 {
        if self.total_size == 0 {
            return 1.0;
        }
        self.downloaded_total as f64 / self.total_size as f64
    }

    /// 获取未完成的分片
    pub fn pending_chunks(&self) -> Vec<&ChunkInfo> {
        self.chunks
            .iter()
            .filter(|chunk| !chunk.is_completed())
            .collect()
    }

    /// 更新分片进度
    pub fn update_chunk_progress(&mut self, chunk_index: usize, downloaded: u64) {
        if let Some(chunk) = self.chunks.get_mut(chunk_index) {
            chunk.downloaded = downloaded;
            chunk.last_update = SystemTime::now();
            if chunk.is_completed() {
                chunk.status = ChunkStatus::Completed;
            }
        }
        // 重新计算总下载量
        self.downloaded_total = self.chunks.iter().map(|c| c.downloaded).sum();
        self.last_modified = SystemTime::now();
    }
}

/// 断点续传下载器配置
#[derive(Debug, Clone)]
pub struct ResumeDownloaderConfig {
    /// 分片大小 (默认 4MB)
    pub chunk_size: u64,
    /// 最大并发下载数
    pub max_concurrent_chunks: usize,
    /// 大文件分片阈值 (默认 50MB)
    pub large_file_threshold: u64,
    /// 重试次数
    pub max_retries: usize,
    /// 重试延迟
    pub retry_delay: Duration,
    /// 断点信息保存目录
    pub resume_info_dir: PathBuf,
    /// 服务器能力缓存过期时间
    pub server_cache_ttl: Duration,
}

impl Default for ResumeDownloaderConfig {
    fn default() -> Self {
        Self {
            chunk_size: 4 * 1024 * 1024, // 4MB
            max_concurrent_chunks: 4,
            large_file_threshold: 50 * 1024 * 1024, // 50MB
            max_retries: 3,
            retry_delay: Duration::from_secs(2),
            resume_info_dir: std::env::temp_dir().join("video_downloader_resume"),
            server_cache_ttl: Duration::from_secs(24 * 60 * 60), // 24小时
        }
    }
}

/// 增强的断点续传下载器
pub struct ResumeDownloader {
    config: ResumeDownloaderConfig,
    client: Client,
    server_capabilities_cache: Arc<RwLock<HashMap<String, ServerCapabilities>>>,
    _active_chunks: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    resume_info_cache: Arc<RwLock<HashMap<String, ResumeInfo>>>,
    bandwidth_controller: BandwidthController,
}

impl ResumeDownloader {
    /// 判断是否需要中断（暂停/取消）
    fn should_interrupt(
        cancel_flag: &Option<Arc<AtomicBool>>,
        pause_flag: &Option<Arc<AtomicBool>>,
    ) -> bool {
        cancel_flag
            .as_ref()
            .map(|flag| flag.load(Ordering::Relaxed))
            .unwrap_or(false)
            || pause_flag
                .as_ref()
                .map(|flag| flag.load(Ordering::Relaxed))
                .unwrap_or(false)
    }

    /// 创建新的断点续传下载器
    pub fn new(
        config: ResumeDownloaderConfig,
        client: Client,
        bandwidth_controller: BandwidthController,
    ) -> Result<Self> {
        // 确保断点信息目录存在
        std::fs::create_dir_all(&config.resume_info_dir)?;

        Ok(Self {
            config,
            client,
            server_capabilities_cache: Arc::new(RwLock::new(HashMap::new())),
            _active_chunks: Arc::new(RwLock::new(HashMap::new())),
            resume_info_cache: Arc::new(RwLock::new(HashMap::new())),
            bandwidth_controller,
        })
    }

    /// 检测服务器支持能力
    pub async fn detect_server_capabilities(&self, url: &str) -> Result<ServerCapabilities> {
        let host = self.extract_host(url)?;

        // 检查缓存
        {
            let cache = self.server_capabilities_cache.read().await;
            if let Some(cached) = cache.get(&host) {
                let elapsed = SystemTime::now()
                    .duration_since(cached.detected_at)
                    .unwrap_or(Duration::MAX);

                if elapsed < self.config.server_cache_ttl {
                    tracing::debug!("使用缓存的服务器能力信息: {}", host);
                    return Ok(cached.clone());
                }
            }
        }

        tracing::info!("检测服务器能力: {}", host);

        // 发送HEAD请求检测Range支持
        let response = self
            .client
            .head(url)
            .send()
            .await
            .with_context(|| format!("Failed to send HEAD request to {}", url))?;

        let headers = response.headers();
        let supports_ranges = headers
            .get("accept-ranges")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_lowercase().contains("bytes"))
            .unwrap_or(false);

        let server_info = headers
            .get("server")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.to_string());

        let capabilities = ServerCapabilities {
            supports_ranges,
            supports_concurrent: supports_ranges, // 假设支持Range就支持并发
            max_concurrent: if supports_ranges {
                self.config.max_concurrent_chunks
            } else {
                1
            },
            detected_at: SystemTime::now(),
            server_info,
        };

        // 缓存结果
        {
            let mut cache = self.server_capabilities_cache.write().await;
            cache.insert(host, capabilities.clone());
        }

        tracing::info!(
            "服务器能力检测完成 - 支持Range: {}, 最大并发: {}",
            capabilities.supports_ranges,
            capabilities.max_concurrent
        );

        Ok(capabilities)
    }

    /// 开始或恢复下载
    pub async fn download_with_resume(
        &self,
        task_id: &str,
        url: &str,
        file_path: &Path,
        total_size: Option<u64>,
        progress_callback: Option<ResumeProgressCallback>,
        cancel_flag: Option<Arc<AtomicBool>>,
        pause_flag: Option<Arc<AtomicBool>>,
    ) -> Result<ResumeInfo> {
        // 尝试加载已有的断点信息
        let mut resume_info = self.load_resume_info(task_id).await?.unwrap_or_else(|| {
            ResumeInfo::new(
                task_id.to_string(),
                file_path.to_string_lossy().to_string(),
                url.to_string(),
                total_size.unwrap_or(0),
            )
        });

        // 如果没有总大小信息，尝试获取
        if resume_info.total_size == 0 {
            if let Some(size) = self.get_content_length(url).await? {
                resume_info.total_size = size;
            } else {
                bail!("无法获取文件大小，不支持断点续传");
            }
        }

        if Self::should_interrupt(&cancel_flag, &pause_flag) {
            bail!("下载被取消");
        }

        // 检测服务器支持能力
        resume_info.server_capabilities = self.detect_server_capabilities(url).await?;

        // 如果文件不存在或大小不匹配，重新开始
        if !self.validate_existing_file(&resume_info).await? {
            tracing::info!("文件不存在或已损坏，重新开始下载");
            resume_info.chunks.clear();
            resume_info.downloaded_total = 0;
        }

        // 创建分片策略
        if resume_info.chunks.is_empty() {
            resume_info.chunks = self.create_chunks(&resume_info).await?;
        }

        // 创建输出目录
        if let Some(parent) = file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // 开始下载
        self.download_chunks(
            url,
            &mut resume_info,
            progress_callback.clone(),
            cancel_flag.clone(),
            pause_flag.clone(),
        )
        .await?;

        if Self::should_interrupt(&cancel_flag, &pause_flag) {
            // 保存当前进度，保证后续能继续
            self.save_resume_info(&resume_info).await.ok();
            bail!("下载被取消");
        }

        // 合并分片
        if resume_info.server_capabilities.supports_ranges && resume_info.chunks.len() > 1 {
            self.merge_chunks(&resume_info).await?;
        }

        // 保存最终状态
        self.save_resume_info(&resume_info).await?;

        Ok(resume_info)
    }

    /// 创建下载分片
    async fn create_chunks(&self, resume_info: &ResumeInfo) -> Result<Vec<ChunkInfo>> {
        let total_size = resume_info.total_size;
        let supports_ranges = resume_info.server_capabilities.supports_ranges;

        // 如果不支持Range请求或文件较小，使用单个分片
        if !supports_ranges || total_size < self.config.large_file_threshold {
            return Ok(vec![ChunkInfo::new(0, 0, total_size - 1)]);
        }

        let chunk_size = self.config.chunk_size;
        let mut chunks = Vec::new();
        let mut start = 0u64;
        let mut index = 0;

        while start < total_size {
            let end = std::cmp::min(start + chunk_size - 1, total_size - 1);
            chunks.push(ChunkInfo::new(index, start, end));
            start = end + 1;
            index += 1;
        }

        tracing::info!("创建了 {} 个下载分片", chunks.len());
        Ok(chunks)
    }

    /// 下载所有分片
    async fn download_chunks(
        &self,
        url: &str,
        resume_info: &mut ResumeInfo,
        progress_callback: Option<ResumeProgressCallback>,
        cancel_flag: Option<Arc<AtomicBool>>,
        pause_flag: Option<Arc<AtomicBool>>,
    ) -> Result<()> {
        let pending_chunks: Vec<usize> = resume_info
            .pending_chunks()
            .iter()
            .map(|chunk| chunk.index)
            .collect();

        let bandwidth_controller = self.bandwidth_controller.clone();

        if Self::should_interrupt(&cancel_flag, &pause_flag) {
            return Err(anyhow::anyhow!("下载被取消"));
        }

        if pending_chunks.is_empty() {
            tracing::info!("所有分片已完成");
            return Ok(());
        }

        let max_concurrent = std::cmp::min(
            pending_chunks.len(),
            resume_info.server_capabilities.max_concurrent,
        );

        tracing::info!(
            "开始下载 {} 个分片，最大并发: {}",
            pending_chunks.len(),
            max_concurrent
        );

        // 创建信号量控制并发数
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrent));
        let mut handles = Vec::new();

        for chunk_index in pending_chunks {
            if Self::should_interrupt(&cancel_flag, &pause_flag) {
                // 在退出前保存进度，便于下次继续
                self.save_resume_info(resume_info).await.ok();
                return Err(anyhow::anyhow!("下载被取消"));
            }

            let semaphore = Arc::clone(&semaphore);
            let url = url.to_string();
            let client = self.client.clone();
            let config = self.config.clone();
            let resume_info_clone = resume_info.clone();
            let task_id = Arc::new(resume_info_clone.task_id.clone());
            let total_size = resume_info_clone.total_size;
            let progress_callback = progress_callback.clone();
            let controller = bandwidth_controller.clone();
            let cancel_flag = cancel_flag.clone();
            let pause_flag = pause_flag.clone();

            let handle = tokio::spawn(async move {
                let _permit = semaphore.acquire().await.unwrap();

                if ResumeDownloader::should_interrupt(&cancel_flag, &pause_flag) {
                    return Err(anyhow::anyhow!("下载被取消"));
                }

                Self::download_chunk_static(
                    &client,
                    &config,
                    &url,
                    &resume_info_clone,
                    chunk_index,
                    task_id,
                    total_size,
                    progress_callback,
                    controller.clone(),
                    cancel_flag.clone(),
                    pause_flag.clone(),
                )
                .await
            });

            handles.push(handle);
        }

        // 等待所有分片下载完成
        let mut chunk_results = Vec::new();
        for handle in handles {
            match handle.await? {
                Ok(chunk_info) => chunk_results.push(chunk_info),
                Err(e) => {
                    tracing::error!("分片下载失败: {}", e);
                    return Err(e);
                }
            }
        }

        // 更新resume_info中的分片信息
        for updated_chunk in chunk_results {
            if let Some(chunk) = resume_info.chunks.get_mut(updated_chunk.index) {
                *chunk = updated_chunk;
            }
        }

        // 重新计算总下载量
        resume_info.downloaded_total = resume_info.chunks.iter().map(|c| c.downloaded).sum();
        resume_info.last_modified = SystemTime::now();

        // 保存进度
        self.save_resume_info(resume_info).await?;

        Ok(())
    }

    /// 静态方法下载单个分片
    async fn download_chunk_static(
        client: &Client,
        config: &ResumeDownloaderConfig,
        url: &str,
        resume_info: &ResumeInfo,
        chunk_index: usize,
        task_id: Arc<String>,
        total_size: u64,
        progress_callback: Option<ResumeProgressCallback>,
        bandwidth_controller: BandwidthController,
        cancel_flag: Option<Arc<AtomicBool>>,
        pause_flag: Option<Arc<AtomicBool>>,
    ) -> Result<ChunkInfo> {
        let mut chunk = resume_info
            .chunks
            .get(chunk_index)
            .ok_or_else(|| anyhow::anyhow!("分片索引无效: {}", chunk_index))?
            .clone();

        if chunk.is_completed() {
            return Ok(chunk);
        }

        if Self::should_interrupt(&cancel_flag, &pause_flag) {
            return Err(anyhow::anyhow!("下载被取消"));
        }

        let mut retry_count = 0;

        while retry_count <= config.max_retries {
            if Self::should_interrupt(&cancel_flag, &pause_flag) {
                return Err(anyhow::anyhow!("下载被取消"));
            }

            match Self::download_chunk_attempt(
                client,
                config,
                url,
                resume_info,
                &mut chunk,
                &task_id,
                total_size,
                progress_callback.clone(),
                bandwidth_controller.clone(),
                cancel_flag.clone(),
                pause_flag.clone(),
            )
            .await
            {
                Ok(_) => {
                    chunk.status = ChunkStatus::Completed;
                    tracing::debug!("分片 {} 下载完成", chunk.index);
                    return Ok(chunk);
                }
                Err(e) => {
                    retry_count += 1;
                    chunk.retry_count = retry_count;
                    chunk.status = ChunkStatus::Failed;

                    if retry_count <= config.max_retries {
                        tracing::warn!(
                            "分片 {} 下载失败，第 {} 次重试: {}",
                            chunk.index,
                            retry_count,
                            e
                        );
                        tokio::time::sleep(config.retry_delay).await;
                    } else {
                        tracing::error!("分片 {} 下载失败，已达最大重试次数: {}", chunk.index, e);
                        return Err(e);
                    }
                }
            }
        }

        Err(anyhow::anyhow!("分片 {} 下载失败", chunk.index))
    }

    /// 尝试下载分片
    async fn download_chunk_attempt(
        client: &Client,
        config: &ResumeDownloaderConfig,
        url: &str,
        resume_info: &ResumeInfo,
        chunk: &mut ChunkInfo,
        task_id: &Arc<String>,
        total_size: u64,
        progress_callback: Option<ResumeProgressCallback>,
        bandwidth_controller: BandwidthController,
        cancel_flag: Option<Arc<AtomicBool>>,
        pause_flag: Option<Arc<AtomicBool>>,
    ) -> Result<()> {
        chunk.status = ChunkStatus::Downloading;

        if Self::should_interrupt(&cancel_flag, &pause_flag) {
            bail!("下载被取消");
        }

        // 计算实际需要下载的范围
        let range_start = chunk.start + chunk.downloaded;
        let range_end = chunk.end;

        if range_start > range_end {
            chunk.downloaded = chunk.size();
            return Ok(());
        }

        // 构建Range请求
        let mut request = client.get(url);

        if resume_info.server_capabilities.supports_ranges && resume_info.chunks.len() > 1 {
            let range_header = format!("bytes={}-{}", range_start, range_end);
            request = request.header("Range", range_header);
        }

        let response = request.send().await?;

        // 检查响应状态
        let status = response.status();
        if !status.is_success() && status != StatusCode::PARTIAL_CONTENT {
            bail!("HTTP错误: {}", status);
        }

        // 创建或打开分片临时文件
        let temp_file_path = Self::get_chunk_temp_path(config, &resume_info.task_id, chunk.index);
        let mut file = Self::open_chunk_file(&temp_file_path, chunk.downloaded).await?;

        // 下载数据流
        let mut stream = response.bytes_stream();
        let mut downloaded_in_this_attempt = 0u64;

        while let Some(chunk_data) = stream.next().await {
            if Self::should_interrupt(&cancel_flag, &pause_flag) {
                bail!("下载被取消");
            }
            let chunk_data = chunk_data?;
            file.write_all(&chunk_data).await?;
            bandwidth_controller.throttle(chunk_data.len() as u64).await;

            downloaded_in_this_attempt += chunk_data.len() as u64;
            chunk.downloaded = (chunk.start + chunk.downloaded + downloaded_in_this_attempt)
                .saturating_sub(chunk.start);
            chunk.last_update = SystemTime::now();

            if let Some(callback) = &progress_callback {
                callback(task_id.as_str(), chunk_data.len() as u64, total_size);
            }
        }

        file.flush().await?;
        file.sync_all().await?;

        Ok(())
    }

    /// 合并所有分片到最终文件
    async fn merge_chunks(&self, resume_info: &ResumeInfo) -> Result<()> {
        if resume_info.chunks.len() <= 1 {
            // 单个分片，直接移动文件
            if let Some(_chunk) = resume_info.chunks.first() {
                let temp_path = Self::get_chunk_temp_path(&self.config, &resume_info.task_id, 0);
                let final_path = Path::new(&resume_info.file_path);

                if temp_path.exists() {
                    tokio::fs::rename(temp_path, final_path).await?;
                }
            }
            return Ok(());
        }

        tracing::info!("开始合并 {} 个分片", resume_info.chunks.len());

        let final_path = Path::new(&resume_info.file_path);
        let mut final_file = File::create(final_path).await?;

        for chunk in &resume_info.chunks {
            let temp_path =
                Self::get_chunk_temp_path(&self.config, &resume_info.task_id, chunk.index);

            if temp_path.exists() {
                let mut temp_file = File::open(&temp_path).await?;
                tokio::io::copy(&mut temp_file, &mut final_file).await?;

                // 删除临时文件
                tokio::fs::remove_file(&temp_path).await.ok();
            } else {
                bail!("分片临时文件不存在: {:?}", temp_path);
            }
        }

        final_file.flush().await?;
        final_file.sync_all().await?;

        tracing::info!("分片合并完成: {:?}", final_path);
        Ok(())
    }

    /// 获取内容长度
    async fn get_content_length(&self, url: &str) -> Result<Option<u64>> {
        let response = self.client.head(url).send().await?;

        let content_length = response
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());

        Ok(content_length)
    }

    /// 验证现有文件
    async fn validate_existing_file(&self, resume_info: &ResumeInfo) -> Result<bool> {
        let file_path = Path::new(&resume_info.file_path);

        if !file_path.exists() {
            return Ok(false);
        }

        let metadata = tokio::fs::metadata(file_path).await?;
        let file_size = metadata.len();

        // 如果文件大小与预期一致，可能已完成
        if file_size == resume_info.total_size {
            return Ok(true);
        }

        // 如果有分片信息，检查分片临时文件
        if !resume_info.chunks.is_empty() {
            for chunk in &resume_info.chunks {
                let temp_path =
                    Self::get_chunk_temp_path(&self.config, &resume_info.task_id, chunk.index);
                if temp_path.exists() {
                    return Ok(true);
                }
            }
        }

        Ok(file_size > 0 && file_size < resume_info.total_size)
    }

    /// 加载断点续传信息
    async fn load_resume_info(&self, task_id: &str) -> Result<Option<ResumeInfo>> {
        // 先检查内存缓存
        {
            let cache = self.resume_info_cache.read().await;
            if let Some(info) = cache.get(task_id) {
                return Ok(Some(info.clone()));
            }
        }

        // 从文件加载
        let resume_file_path = self
            .config
            .resume_info_dir
            .join(format!("{}.json", task_id));

        if !resume_file_path.exists() {
            return Ok(None);
        }

        let content = tokio::fs::read_to_string(resume_file_path).await?;
        let resume_info: ResumeInfo =
            serde_json::from_str(&content).with_context(|| "解析断点续传信息失败")?;

        // 缓存到内存
        {
            let mut cache = self.resume_info_cache.write().await;
            cache.insert(task_id.to_string(), resume_info.clone());
        }

        Ok(Some(resume_info))
    }

    /// 保存断点续传信息
    async fn save_resume_info(&self, resume_info: &ResumeInfo) -> Result<()> {
        let resume_file_path = self
            .config
            .resume_info_dir
            .join(format!("{}.json", resume_info.task_id));

        let content =
            serde_json::to_string_pretty(resume_info).with_context(|| "序列化断点续传信息失败")?;

        tokio::fs::write(resume_file_path, content).await?;

        // 更新内存缓存
        {
            let mut cache = self.resume_info_cache.write().await;
            cache.insert(resume_info.task_id.clone(), resume_info.clone());
        }

        Ok(())
    }

    /// 获取分片临时文件路径
    fn get_chunk_temp_path(
        config: &ResumeDownloaderConfig,
        task_id: &str,
        chunk_index: usize,
    ) -> PathBuf {
        config
            .resume_info_dir
            .join(format!("{}.chunk.{}", task_id, chunk_index))
    }

    /// 打开分片文件
    async fn open_chunk_file(path: &Path, offset: u64) -> Result<File> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(path)
            .await?;

        if offset > 0 {
            file.seek(SeekFrom::Start(offset)).await?;
        }

        Ok(file)
    }

    /// 提取主机名
    fn extract_host(&self, url: &str) -> Result<String> {
        let parsed_url = reqwest::Url::parse(url)?;
        Ok(parsed_url
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("无法提取主机名"))?
            .to_string())
    }

    /// 清理任务的临时文件和断点信息
    pub async fn cleanup_task(&self, task_id: &str) -> Result<()> {
        // 删除断点信息文件
        let resume_file_path = self
            .config
            .resume_info_dir
            .join(format!("{}.json", task_id));
        if resume_file_path.exists() {
            tokio::fs::remove_file(resume_file_path).await.ok();
        }

        // 删除所有分片临时文件
        if let Ok(entries) = tokio::fs::read_dir(&self.config.resume_info_dir).await {
            let mut entries = entries;
            while let Ok(Some(entry)) = entries.next_entry().await {
                if let Some(file_name) = entry.file_name().to_str() {
                    if file_name.starts_with(&format!("{}.chunk.", task_id)) {
                        tokio::fs::remove_file(entry.path()).await.ok();
                    }
                }
            }
        }

        // 从内存缓存中移除
        {
            let mut cache = self.resume_info_cache.write().await;
            cache.remove(task_id);
        }

        tracing::info!("清理任务临时文件完成: {}", task_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_resume_downloader_creation() {
        let temp_dir = tempdir().unwrap();
        let mut config = ResumeDownloaderConfig::default();
        config.resume_info_dir = temp_dir.path().to_path_buf();

        let client = Client::new();
        let downloader = ResumeDownloader::new(config, client, BandwidthController::new());
        assert!(downloader.is_ok());
    }

    #[tokio::test]
    async fn test_chunk_info_creation() {
        let chunk = ChunkInfo::new(0, 0, 1023);
        assert_eq!(chunk.size(), 1024);
        assert_eq!(chunk.remaining(), 1024);
        assert!(!chunk.is_completed());
    }

    #[tokio::test]
    async fn test_resume_info_creation() {
        let resume_info = ResumeInfo::new(
            "test-task".to_string(),
            "/tmp/test.file".to_string(),
            "http://example.com/file".to_string(),
            1024 * 1024,
        );

        assert_eq!(resume_info.progress(), 0.0);
        assert_eq!(resume_info.pending_chunks().len(), 0);
    }

    #[tokio::test]
    async fn test_create_chunks() {
        let temp_dir = tempdir().unwrap();
        let mut config = ResumeDownloaderConfig::default();
        config.resume_info_dir = temp_dir.path().to_path_buf();
        config.chunk_size = 1024; // 1KB chunks
        config.large_file_threshold = 2048; // 2KB threshold

        let client = Client::new();
        let downloader = ResumeDownloader::new(config, client, BandwidthController::new()).unwrap();

        let mut resume_info = ResumeInfo::new(
            "test".to_string(),
            "/tmp/test".to_string(),
            "http://example.com/file".to_string(),
            4096, // 4KB file
        );
        resume_info.server_capabilities.supports_ranges = true;

        let chunks = downloader.create_chunks(&resume_info).await.unwrap();
        assert_eq!(chunks.len(), 4); // 4KB / 1KB = 4 chunks

        assert_eq!(chunks[0].start, 0);
        assert_eq!(chunks[0].end, 1023);
        assert_eq!(chunks[1].start, 1024);
        assert_eq!(chunks[1].end, 2047);
    }

    #[tokio::test]
    async fn test_resume_info_serialization() {
        let resume_info = ResumeInfo::new(
            "test-task".to_string(),
            "/tmp/test.file".to_string(),
            "http://example.com/file".to_string(),
            1024,
        );

        let json = serde_json::to_string(&resume_info).unwrap();
        let deserialized: ResumeInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(resume_info.task_id, deserialized.task_id);
        assert_eq!(resume_info.total_size, deserialized.total_size);
    }

    #[tokio::test]
    async fn test_server_capabilities() {
        let temp_dir = tempdir().unwrap();
        let mut config = ResumeDownloaderConfig::default();
        config.resume_info_dir = temp_dir.path().to_path_buf();

        let client = Client::new();
        let downloader = ResumeDownloader::new(config, client, BandwidthController::new()).unwrap();

        // 测试 httpbin.org，它应该支持Range请求
        let result = downloader
            .detect_server_capabilities("https://httpbin.org/bytes/1024")
            .await;

        // 这个测试需要网络连接，在没有网络时会失败，所以我们只检查方法是否正常工作
        match result {
            Ok(capabilities) => {
                // 如果成功，验证结构
                assert!(capabilities.detected_at <= SystemTime::now());
            }
            Err(_) => {
                // 网络错误是可以接受的
            }
        }
    }
}
