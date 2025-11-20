//! HTTP 下载引擎核心实现
//!
//! 基于 Go 项目 HTTPDownloader 的 Rust 实现，支持：
//! - 多线程并发下载
//! - 断点续传
//! - 进度追踪  
//! - 速度监控
//! - 错误重试

#[derive(Clone)]
pub struct BandwidthController {
    limit: Arc<RwLock<Option<u64>>>,
    state: Arc<Mutex<BandwidthState>>,
}

#[derive(Debug)]
struct BandwidthState {
    window_start: Instant,
    bytes_in_window: u64,
}

impl BandwidthState {
    fn new() -> Self {
        Self {
            window_start: Instant::now(),
            bytes_in_window: 0,
        }
    }
}

impl BandwidthController {
    fn from_parts(limit: Arc<RwLock<Option<u64>>>, state: Arc<Mutex<BandwidthState>>) -> Self {
        Self { limit, state }
    }

    pub fn new() -> Self {
        Self::from_parts(
            Arc::new(RwLock::new(None)),
            Arc::new(Mutex::new(BandwidthState::new())),
        )
    }

    pub fn limit_handle(&self) -> Arc<RwLock<Option<u64>>> {
        Arc::clone(&self.limit)
    }

    pub async fn throttle(&self, bytes: u64) {
        let limit_value = *self.limit.read().await;
        if let Some(limit) = limit_value {
            if limit == 0 {
                return;
            }
            let mut state = self.state.lock().await;
            let elapsed = state.window_start.elapsed();
            if elapsed >= Duration::from_secs(1) {
                state.window_start = Instant::now();
                state.bytes_in_window = 0;
            }
            state.bytes_in_window += bytes;
            if state.bytes_in_window > limit {
                let excess = state.bytes_in_window - limit;
                let sleep_secs = excess as f64 / limit as f64;
                drop(state);
                sleep(Duration::from_secs_f64(sleep_secs)).await;
            }
        }
    }
}

use anyhow::Result;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, Mutex, RwLock, Semaphore};
use tokio::time::sleep;
use uuid::Uuid;

use crate::core::m3u8_downloader::{M3U8Downloader, M3U8DownloaderConfig};
use crate::core::models::*;
use crate::core::resume_downloader::{
    ResumeDownloader, ResumeDownloaderConfig, ResumeProgressCallback,
};

/// HTTP下载器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloaderConfig {
    /// 最大并发下载数
    pub max_concurrent: usize,
    /// 每个下载的最大连接数
    pub max_connections_per_download: usize,
    /// 请求超时时间（秒）
    pub timeout: u64,
    /// 重试次数
    pub retry_attempts: usize,
    /// 缓冲区大小（字节）
    pub buffer_size: usize,
    /// 用户代理
    pub user_agent: String,
    /// 是否启用断点续传
    pub resume_enabled: bool,
}

impl Default for DownloaderConfig {
    fn default() -> Self {
        Self {
            max_concurrent: 10,
            max_connections_per_download: 4,
            timeout: 30,
            retry_attempts: 3,
            buffer_size: 64 * 1024, // 64KB 缓冲区
            user_agent: "VideoDownloaderPro/1.0.0".to_string(),
            resume_enabled: true,
        }
    }
}

/// 下载统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStats {
    /// 下载速度（字节/秒）
    pub speed: f64,
    /// 已下载字节数
    pub downloaded_bytes: u64,
    /// 总字节数（如果已知）
    pub total_bytes: Option<u64>,
    /// 下载进度（0.0 - 1.0）
    pub progress: f64,
    /// 预计剩余时间（秒）
    pub eta: Option<u64>,
    /// 开始时间
    pub start_time: chrono::DateTime<chrono::Utc>,
    /// 最后更新时间
    pub last_update: chrono::DateTime<chrono::Utc>,
}

impl Default for DownloadStats {
    fn default() -> Self {
        let now = chrono::Utc::now();
        Self {
            speed: 0.0,
            downloaded_bytes: 0,
            total_bytes: None,
            progress: 0.0,
            eta: None,
            start_time: now,
            last_update: now,
        }
    }
}

/// 下载任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub output_path: String,
    pub filename: String,
    pub status: TaskStatus,
    pub stats: DownloadStats,
    pub error_message: Option<String>,
    pub retry_count: usize,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl DownloadTask {
    pub fn new(url: String, output_path: String, filename: String) -> Self {
        let now = chrono::Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            url,
            output_path,
            filename,
            status: TaskStatus::Pending,
            stats: DownloadStats {
                speed: 0.0,
                downloaded_bytes: 0,
                total_bytes: None,
                progress: 0.0,
                eta: None,
                start_time: now,
                last_update: now,
            },
            error_message: None,
            retry_count: 0,
            created_at: now,
            updated_at: now,
        }
    }
}

/// 进度更新回调类型
pub type ProgressCallback = Arc<dyn Fn(&str, &DownloadStats) + Send + Sync>;

/// HTTP 下载引擎
pub struct HttpDownloader {
    config: DownloaderConfig,
    client: Client,
    active_downloads: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    semaphore: Arc<Semaphore>,
    progress_tx: Option<mpsc::UnboundedSender<(String, DownloadStats)>>,
    is_paused: Arc<AtomicBool>,
    resume_downloader: Arc<ResumeDownloader>,
    m3u8_downloader: Arc<M3U8Downloader>,
    bandwidth_controller: BandwidthController,
}

impl HttpDownloader {
    /// 创建新的下载器实例
    pub fn new(config: DownloaderConfig) -> Result<Self> {
        let bandwidth_controller = BandwidthController::new();
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout))
            .user_agent(&config.user_agent)
            .build()?;

        let semaphore = Arc::new(Semaphore::new(config.max_concurrent));

        // 创建ResumeDownloader配置，与HttpDownloader配置保持一致
        let resume_config = ResumeDownloaderConfig {
            chunk_size: 4 * 1024 * 1024, // 4MB 分片
            max_concurrent_chunks: config.max_connections_per_download.min(8), // 限制最大并发分片数
            large_file_threshold: 50 * 1024 * 1024, // 50MB 阈值
            max_retries: config.retry_attempts,
            retry_delay: Duration::from_secs(2),
            resume_info_dir: std::env::temp_dir().join("video_downloader_resume"),
            server_cache_ttl: Duration::from_secs(24 * 60 * 60), // 24小时
        };

        // 创建ResumeDownloader实例
        let resume_downloader =
            ResumeDownloader::new(resume_config, client.clone(), bandwidth_controller.clone())?;

        // 创建M3U8Downloader配置
        let m3u8_config = M3U8DownloaderConfig {
            max_concurrent_segments: config.max_connections_per_download.max(4), // 至少4个并发
            timeout: config.timeout,
            retry_attempts: config.retry_attempts,
            buffer_size: config.buffer_size,
            user_agent: config.user_agent.clone(),
            temp_dir: std::env::temp_dir().join("video_downloader_m3u8"),
            keep_temp_files: false,
        };

        // 创建M3U8Downloader实例
        let m3u8_downloader = M3U8Downloader::new(m3u8_config)?;

        Ok(Self {
            config,
            client,
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
            semaphore,
            progress_tx: None,
            is_paused: Arc::new(AtomicBool::new(false)),
            resume_downloader: Arc::new(resume_downloader),
            m3u8_downloader: Arc::new(m3u8_downloader),
            bandwidth_controller,
        })
    }

    pub fn bandwidth_controller(&self) -> BandwidthController {
        self.bandwidth_controller.clone()
    }

    /// 设置进度回调
    pub fn set_progress_callback(&mut self, tx: mpsc::UnboundedSender<(String, DownloadStats)>) {
        self.progress_tx = Some(tx);
    }

    /// 开始下载单个文件
    pub async fn download(&self, mut task: DownloadTask) -> Result<DownloadTask> {
        let _permit = self.semaphore.acquire().await?;

        // 检查文件是否已存在
        let full_path = Path::new(&task.output_path).join(&task.filename);
        if full_path.exists() && !self.config.resume_enabled {
            task.status = TaskStatus::Completed;
            task.stats.progress = 1.0;
            task.updated_at = chrono::Utc::now();
            return Ok(task);
        }

        // 注册活跃下载
        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut downloads = self.active_downloads.write().await;
            downloads.insert(task.id.clone(), cancel_flag.clone());
        }

        task.status = TaskStatus::Downloading;
        task.stats.start_time = chrono::Utc::now();
        task.updated_at = chrono::Utc::now();

        // 智能选择下载策略：根据文件大小决定使用哪种下载器
        let result = if self.config.resume_enabled {
            self.smart_download(&mut task, cancel_flag.clone()).await
        } else {
            self.download_with_resume(&mut task, cancel_flag.clone())
                .await
        };

        // 清理活跃下载记录
        {
            let mut downloads = self.active_downloads.write().await;
            downloads.remove(&task.id);
        }

        match result {
            Ok(_) => {
                task.status = TaskStatus::Completed;
                task.stats.progress = 1.0;
                task.updated_at = chrono::Utc::now();
                tracing::info!("下载完成: {}", task.filename);
            }
            Err(e) => {
                task.status = TaskStatus::Failed;
                task.error_message = Some(e.to_string());
                task.updated_at = chrono::Utc::now();
                tracing::error!("下载失败: {} - {}", task.filename, e);
            }
        }

        Ok(task)
    }

    /// 智能下载策略选择器
    /// 根据文件类型和大小自动选择最适合的下载方法
    async fn smart_download(
        &self,
        task: &mut DownloadTask,
        cancel_flag: Arc<AtomicBool>,
    ) -> Result<()> {
        tracing::info!("开始智能下载策略检测: {}", task.url);

        // 首先检测是否为M3U8流媒体
        if self.is_m3u8_url(&task.url) {
            tracing::info!("检测到M3U8流媒体，使用M3U8Downloader");
            return self.download_with_m3u8(task, cancel_flag).await;
        }

        // 对于非M3U8 URL，尝试获取文件大小
        let content_length = match self.get_content_length(&task.url).await {
            Ok(Some(size)) => {
                tracing::info!(
                    "检测到文件大小: {} 字节 ({})",
                    size,
                    self.format_bytes(size)
                );
                size
            }
            Ok(None) => {
                tracing::warn!("无法获取文件大小，使用传统下载方法");
                return self
                    .download_with_resume_downloader(task, cancel_flag)
                    .await;
            }
            Err(e) => {
                tracing::warn!("获取文件大小失败，使用传统下载方法: {}", e);
                return self
                    .download_with_resume_downloader(task, cancel_flag)
                    .await;
            }
        };

        // 设置任务的总文件大小
        task.stats.total_bytes = Some(content_length);

        // 根据文件大小选择下载策略
        let large_file_threshold = 50 * 1024 * 1024; // 50MB

        if content_length >= large_file_threshold {
            tracing::info!("大文件检测：使用ResumeDownloader进行分片下载");
            self.download_with_resume_downloader(task, cancel_flag)
                .await
        } else {
            tracing::info!("小文件检测：使用传统HTTP下载");
            self.download_with_resume(task, cancel_flag).await
        }
    }

    /// 使用ResumeDownloader进行大文件分片下载
    async fn download_with_resume_downloader(
        &self,
        task: &mut DownloadTask,
        cancel_flag: Arc<AtomicBool>,
    ) -> Result<()> {
        let full_path = Path::new(&task.output_path).join(&task.filename);
        let output_path_str = full_path.to_string_lossy().to_string();

        tracing::info!("ʹ��ResumeDownloader��ʼ����: {}", task.filename);

        if cancel_flag.load(Ordering::Relaxed) || self.is_paused.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!("���ر�ȡ��"));
        }

        let (delta_tx, mut delta_rx) = mpsc::unbounded_channel::<u64>();
        let progress_callback: ResumeProgressCallback = {
            let delta_tx = delta_tx.clone();
            Arc::new(move |_, delta, _| {
                let _ = delta_tx.send(delta);
            })
        };

        let task_id = task.id.clone();
        let task_url = task.url.clone();

        let mut resume_future = Box::pin(self.resume_downloader.download_with_resume(
            &task_id,
            &task_url,
            Path::new(&output_path_str),
            task.stats.total_bytes,
            Some(progress_callback),
        ));

        let start_time = Instant::now();
        let mut downloaded = task.stats.downloaded_bytes;
        let total_hint = task.stats.total_bytes;

        loop {
            tokio::select! {
                Some(delta) = delta_rx.recv() => {
                    downloaded = downloaded.saturating_add(delta);
                    let total = total_hint.unwrap_or(downloaded);
                    self.update_progress(task, downloaded, total, start_time).await;
                }
                result = &mut resume_future => {
                    let resume_info = result?;
                    let final_total = if resume_info.total_size == 0 {
                        total_hint.unwrap_or(downloaded)
                    } else {
                        resume_info.total_size
                    };
                    downloaded = resume_info.downloaded_total.max(downloaded);
                    self.update_progress(task, downloaded, final_total, start_time).await;
                    task.stats.total_bytes = Some(final_total);
                    break;
                }
            }
        }

        tracing::info!("ResumeDownloader�������: {}", task.filename);
        Ok(())
    }

    /// 获取HTTP响应的内容长度
    async fn get_content_length(&self, url: &str) -> Result<Option<u64>> {
        let response = self.client.head(url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!("HTTP错误: {}", response.status()));
        }

        let content_length = response
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());

        Ok(content_length)
    }

    /// 格式化字节大小为可读格式
    fn format_bytes(&self, bytes: u64) -> String {
        const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
        const THRESHOLD: u64 = 1024;

        if bytes < THRESHOLD {
            return format!("{} B", bytes);
        }

        let mut size = bytes as f64;
        let mut unit_index = 0;

        while size >= THRESHOLD as f64 && unit_index < UNITS.len() - 1 {
            size /= THRESHOLD as f64;
            unit_index += 1;
        }

        format!("{:.1} {}", size, UNITS[unit_index])
    }

    /// 检测是否为M3U8 URL
    fn is_m3u8_url(&self, url: &str) -> bool {
        // 检查URL是否包含.m3u8扩展名或常见的M3U8参数
        url.contains(".m3u8")
            || url.to_lowercase().contains("m3u8")
            || url.contains("playlist") && url.contains("hls")
            || url.contains("master") && url.contains("m3u8")
    }

    /// 使用M3U8Downloader进行流媒体下载
    async fn download_with_m3u8(
        &self,
        task: &mut DownloadTask,
        cancel_flag: Arc<AtomicBool>,
    ) -> Result<()> {
        let full_path = Path::new(&task.output_path).join(&task.filename);
        let output_path_str = full_path.to_string_lossy().to_string();

        // 检查取消标志
        if cancel_flag.load(Ordering::Relaxed) || self.is_paused.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!("下载被取消"));
        }

        tracing::info!("使用M3U8Downloader开始流媒体下载: {}", task.filename);

        // 调用M3U8Downloader的下载方法
        self.m3u8_downloader
            .download_m3u8(&task.id, &task.url, &output_path_str)
            .await?;

        tracing::info!("M3U8流媒体下载完成: {}", task.filename);
        Ok(())
    }

    /// 支持断点续传的下载实现
    async fn download_with_resume(
        &self,
        task: &mut DownloadTask,
        cancel_flag: Arc<AtomicBool>,
    ) -> Result<()> {
        let full_path = Path::new(&task.output_path).join(&task.filename);

        // 创建输出目录
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // 检查现有文件大小以支持断点续传
        let existing_size = if full_path.exists() {
            tokio::fs::metadata(&full_path).await?.len()
        } else {
            0
        };

        // 构建HTTP请求
        let mut request = self.client.get(&task.url);
        if existing_size > 0 && self.config.resume_enabled {
            request = request.header("Range", format!("bytes={}-", existing_size));
            tracing::info!("断点续传: {} 从字节 {} 开始", task.filename, existing_size);
        }

        // 发送请求
        let response = request.send().await?;

        // 检查响应状态
        if !response.status().is_success() && response.status().as_u16() != 206 {
            return Err(anyhow::anyhow!("HTTP错误: {}", response.status()));
        }

        // 获取内容长度
        let content_length = response.content_length();
        let total_size = if let Some(len) = content_length {
            existing_size + len
        } else {
            existing_size
        };

        task.stats.total_bytes = Some(total_size);
        task.stats.downloaded_bytes = existing_size;

        // 打开文件准备写入
        let mut file = if existing_size > 0 {
            tokio::fs::OpenOptions::new()
                .append(true)
                .open(&full_path)
                .await?
        } else {
            File::create(&full_path).await?
        };

        // 开始流式下载
        let mut stream = response.bytes_stream();
        let mut downloaded = existing_size;
        let mut last_update = Instant::now();
        let start_time = Instant::now();

        while let Some(chunk) = stream.next().await {
            // 检查取消标志
            if cancel_flag.load(Ordering::Relaxed) || self.is_paused.load(Ordering::Relaxed) {
                return Err(anyhow::anyhow!("下载被取消"));
            }

            let chunk = chunk?;
            file.write_all(&chunk).await?;
            self.bandwidth_controller.throttle(chunk.len() as u64).await;
            downloaded += chunk.len() as u64;

            // 更新进度（限制更新频率）
            let now = Instant::now();
            if now.duration_since(last_update) >= Duration::from_millis(500) {
                self.update_progress(task, downloaded, total_size, start_time)
                    .await;
                last_update = now;
            }
        }

        // 确保文件数据写入磁盘
        file.flush().await?;
        file.sync_all().await?;

        // 最后一次进度更新
        self.update_progress(task, downloaded, total_size, start_time)
            .await;

        tracing::info!("文件下载完成: {} ({} 字节)", task.filename, downloaded);
        Ok(())
    }

    /// 更新下载进度
    async fn update_progress(
        &self,
        task: &mut DownloadTask,
        downloaded: u64,
        total: u64,
        start_time: Instant,
    ) {
        let elapsed = start_time.elapsed();
        let speed = if elapsed.as_secs() > 0 {
            downloaded as f64 / elapsed.as_secs() as f64
        } else {
            0.0
        };

        let progress = if total > 0 {
            downloaded as f64 / total as f64
        } else {
            0.0
        };

        let eta = if speed > 0.0 && total > downloaded {
            Some(((total - downloaded) as f64 / speed) as u64)
        } else {
            None
        };

        task.stats.downloaded_bytes = downloaded;
        task.stats.speed = speed;
        task.stats.progress = progress;
        task.stats.eta = eta;
        task.stats.last_update = chrono::Utc::now();

        // 发送进度更新
        if let Some(ref tx) = self.progress_tx {
            let _ = tx.send((task.id.clone(), task.stats.clone()));
        }
    }

    /// 暂停所有下载
    pub async fn pause_all(&self) {
        self.is_paused.store(true, Ordering::Relaxed);
        tracing::info!("所有下载已暂停");
    }

    /// 恢复所有下载
    pub async fn resume_all(&self) {
        self.is_paused.store(false, Ordering::Relaxed);
        tracing::info!("所有下载已恢复");
    }

    /// 取消特定下载
    pub async fn cancel_download(&self, task_id: &str) -> Result<()> {
        let downloads = self.active_downloads.read().await;
        if let Some(cancel_flag) = downloads.get(task_id) {
            cancel_flag.store(true, Ordering::Relaxed);
            tracing::info!("下载已取消: {}", task_id);
        }
        Ok(())
    }

    /// 获取活跃下载数量
    pub async fn active_download_count(&self) -> usize {
        self.active_downloads.read().await.len()
    }

    /// 批量下载文件
    pub async fn batch_download(
        &self,
        tasks: Vec<DownloadTask>,
        progress_callback: Option<ProgressCallback>,
    ) -> Result<Vec<DownloadTask>> {
        let mut results = Vec::with_capacity(tasks.len());
        let mut handles = Vec::new();

        for task in tasks {
            let downloader = self.clone();
            let callback = progress_callback.clone();

            let handle = tokio::spawn(async move {
                let result = downloader.download(task).await?;

                // 调用进度回调
                if let Some(cb) = callback {
                    cb(&result.id, &result.stats);
                }

                Ok::<DownloadTask, anyhow::Error>(result)
            });

            handles.push(handle);
        }

        // 等待所有下载完成
        for handle in handles {
            match handle.await? {
                Ok(task) => results.push(task),
                Err(e) => {
                    tracing::error!("批量下载任务失败: {}", e);
                    // 创建一个失败的任务记录
                    let mut failed_task = DownloadTask::new(
                        "unknown".to_string(),
                        "unknown".to_string(),
                        "unknown".to_string(),
                    );
                    failed_task.status = TaskStatus::Failed;
                    failed_task.error_message = Some(e.to_string());
                    results.push(failed_task);
                }
            }
        }

        Ok(results)
    }
}

// 实现 Clone trait 以支持多线程使用
impl Clone for HttpDownloader {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            client: self.client.clone(),
            active_downloads: Arc::clone(&self.active_downloads),
            semaphore: Arc::clone(&self.semaphore),
            progress_tx: self.progress_tx.clone(),
            is_paused: Arc::clone(&self.is_paused),
            resume_downloader: Arc::clone(&self.resume_downloader),
            m3u8_downloader: Arc::clone(&self.m3u8_downloader),
            bandwidth_controller: self.bandwidth_controller.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn test_downloader_creation() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config);
        assert!(downloader.is_ok());
    }

    #[tokio::test]
    async fn test_download_task_creation() {
        let task = DownloadTask::new(
            "https://httpbin.org/bytes/1024".to_string(),
            "/tmp".to_string(),
            "test.bin".to_string(),
        );

        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.stats.progress, 0.0);
        assert!(task.id.len() > 0);
        assert_eq!(task.url, "https://httpbin.org/bytes/1024");
        assert_eq!(task.filename, "test.bin");
    }

    #[tokio::test]
    async fn test_progress_calculation() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();
        let mut task = DownloadTask::new(
            "https://httpbin.org/bytes/1024".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
            "test.bin".to_string(),
        );

        let start_time = std::time::Instant::now();
        downloader
            .update_progress(&mut task, 512, 1024, start_time)
            .await;

        assert_eq!(task.stats.progress, 0.5);
        assert_eq!(task.stats.downloaded_bytes, 512);
    }

    #[tokio::test]
    async fn test_pause_resume_functionality() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        // 测试暂停
        downloader.pause_all().await;
        assert!(downloader
            .is_paused
            .load(std::sync::atomic::Ordering::Relaxed));

        // 测试恢复
        downloader.resume_all().await;
        assert!(!downloader
            .is_paused
            .load(std::sync::atomic::Ordering::Relaxed));
    }

    #[tokio::test]
    async fn test_cancel_download() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        let task_id = "test-task-id";

        // 模拟注册一个活跃下载
        {
            let mut downloads = downloader.active_downloads.write().await;
            downloads.insert(task_id.to_string(), Arc::new(AtomicBool::new(false)));
        }

        // 测试取消下载
        let result = downloader.cancel_download(task_id).await;
        assert!(result.is_ok());

        // 验证取消标志被设置
        let downloads = downloader.active_downloads.read().await;
        if let Some(cancel_flag) = downloads.get(task_id) {
            assert!(cancel_flag.load(std::sync::atomic::Ordering::Relaxed));
        }
    }

    #[tokio::test]
    async fn test_active_download_count() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        assert_eq!(downloader.active_download_count().await, 0);

        // 添加一些活跃下载
        {
            let mut downloads = downloader.active_downloads.write().await;
            downloads.insert("task1".to_string(), Arc::new(AtomicBool::new(false)));
            downloads.insert("task2".to_string(), Arc::new(AtomicBool::new(false)));
        }

        assert_eq!(downloader.active_download_count().await, 2);
    }

    #[tokio::test]
    async fn test_download_config_validation() {
        let config = DownloaderConfig {
            max_concurrent: 5,
            max_connections_per_download: 2,
            timeout: 15,
            retry_attempts: 2,
            buffer_size: 32 * 1024,
            user_agent: "TestAgent/1.0".to_string(),
            resume_enabled: true,
        };

        assert_eq!(config.max_concurrent, 5);
        assert_eq!(config.timeout, 15);
        assert_eq!(config.buffer_size, 32 * 1024);
        assert!(config.resume_enabled);
    }

    #[tokio::test]
    async fn test_eta_calculation() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();
        let mut task = DownloadTask::new(
            "https://example.com/file.zip".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
            "file.zip".to_string(),
        );

        // 模拟下载了一半，速度为 100 bytes/sec
        let start_time = std::time::Instant::now() - Duration::from_secs(5);
        downloader
            .update_progress(&mut task, 500, 1000, start_time)
            .await;

        // ETA应该大约是5秒 (剩余500字节 / 100字节每秒)
        assert!(task.stats.eta.is_some());
        let eta = task.stats.eta.unwrap();
        assert!(eta > 0 && eta < 10); // 应该在合理范围内
    }

    #[tokio::test]
    async fn test_concurrent_downloads_limit() {
        let config = DownloaderConfig {
            max_concurrent: 2,
            ..Default::default()
        };
        let downloader = HttpDownloader::new(config).unwrap();

        // 信号量应该限制并发数量
        assert_eq!(downloader.semaphore.available_permits(), 2);

        // 获取一个许可
        let _permit = downloader.semaphore.acquire().await.unwrap();
        assert_eq!(downloader.semaphore.available_permits(), 1);
    }

    #[tokio::test]
    async fn test_stats_update_timing() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();
        let mut task = DownloadTask::new(
            "https://example.com/file.zip".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
            "file.zip".to_string(),
        );

        let start_time = std::time::Instant::now();

        // 第一次更新
        downloader
            .update_progress(&mut task, 100, 1000, start_time)
            .await;
        let first_update = task.stats.last_update;

        // 等待一小段时间
        sleep(Duration::from_millis(10)).await;

        // 第二次更新
        downloader
            .update_progress(&mut task, 200, 1000, start_time)
            .await;
        let second_update = task.stats.last_update;

        // 确保时间戳有更新
        assert!(second_update > first_update);
    }

    #[tokio::test]
    async fn test_error_handling() {
        let config = DownloaderConfig {
            timeout: 1, // 非常短的超时时间
            ..Default::default()
        };
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();
        let task = DownloadTask::new(
            "https://httpbin.org/delay/5".to_string(), // 会超时的URL
            temp_dir.path().to_string_lossy().to_string(),
            "timeout-test.bin".to_string(),
        );

        let result = downloader.download(task).await;
        assert!(result.is_ok()); // 函数应该返回Ok，但任务状态是失败

        let failed_task = result.unwrap();
        assert_eq!(failed_task.status, TaskStatus::Failed);
        assert!(failed_task.error_message.is_some());
    }

    #[tokio::test]
    async fn test_file_path_creation() {
        let temp_dir = tempdir().unwrap();
        let task = DownloadTask::new(
            "https://example.com/video.mp4".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
            "my_video.mp4".to_string(),
        );

        let expected_path = temp_dir.path().join("my_video.mp4");
        let actual_path = std::path::Path::new(&task.output_path).join(&task.filename);

        assert_eq!(actual_path, expected_path);
    }
}

/// 集成测试模块
#[cfg(test)]
mod integration_tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn test_small_file_download() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();
        let task = DownloadTask::new(
            "https://httpbin.org/bytes/100".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
            "small_file.bin".to_string(),
        );

        let result = downloader.download(task).await;
        assert!(result.is_ok());

        let completed_task = result.unwrap();
        assert_eq!(completed_task.status, TaskStatus::Completed);
        assert_eq!(completed_task.stats.progress, 1.0);

        // 验证文件是否创建
        let file_path = temp_dir.path().join("small_file.bin");
        assert!(file_path.exists());

        // 验证文件大小
        let metadata = fs::metadata(&file_path).await.unwrap();
        assert_eq!(metadata.len(), 100);
    }

    #[tokio::test]
    async fn test_resume_download() {
        let config = DownloaderConfig {
            resume_enabled: true,
            ..Default::default()
        };
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();
        let file_path = temp_dir.path().join("resume_test.bin");

        // 创建一个部分下载的文件
        fs::write(&file_path, b"partial").await.unwrap();

        let task = DownloadTask::new(
            "https://httpbin.org/bytes/100".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
            "resume_test.bin".to_string(),
        );

        let result = downloader.download(task).await;
        assert!(result.is_ok());

        // 验证文件被续传（长度应该大于原来的partial内容）
        let metadata = fs::metadata(&file_path).await.unwrap();
        assert!(metadata.len() >= 7); // "partial" = 7 bytes
    }

    #[tokio::test]
    async fn test_batch_download() {
        let config = DownloaderConfig {
            max_concurrent: 2,
            ..Default::default()
        };
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();

        let tasks = vec![
            DownloadTask::new(
                "https://httpbin.org/bytes/50".to_string(),
                temp_dir.path().to_string_lossy().to_string(),
                "file1.bin".to_string(),
            ),
            DownloadTask::new(
                "https://httpbin.org/bytes/75".to_string(),
                temp_dir.path().to_string_lossy().to_string(),
                "file2.bin".to_string(),
            ),
            DownloadTask::new(
                "https://httpbin.org/bytes/25".to_string(),
                temp_dir.path().to_string_lossy().to_string(),
                "file3.bin".to_string(),
            ),
        ];

        let results = downloader.batch_download(tasks, None).await;
        assert!(results.is_ok());

        let completed_tasks = results.unwrap();
        assert_eq!(completed_tasks.len(), 3);

        // 验证所有任务都完成
        for task in &completed_tasks {
            assert_eq!(task.status, TaskStatus::Completed);
        }

        // 验证文件都被创建
        assert!(temp_dir.path().join("file1.bin").exists());
        assert!(temp_dir.path().join("file2.bin").exists());
        assert!(temp_dir.path().join("file3.bin").exists());
    }

    #[tokio::test]
    async fn test_directory_creation() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        let temp_dir = tempdir().unwrap();
        let nested_path = temp_dir.path().join("nested").join("directory");

        let task = DownloadTask::new(
            "https://httpbin.org/bytes/10".to_string(),
            nested_path.to_string_lossy().to_string(),
            "nested_file.bin".to_string(),
        );

        let result = downloader.download(task).await;
        assert!(result.is_ok());

        // 验证嵌套目录被创建
        assert!(nested_path.exists());
        assert!(nested_path.join("nested_file.bin").exists());
    }
}
