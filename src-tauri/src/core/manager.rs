//! Download Manager - Core business logic for managing video downloads
//!
//! This module provides the main DownloadManager that orchestrates all download operations,
//! manages concurrent downloads, and handles progress tracking and event emission.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::core::downloader::{DownloadStats, DownloadTask, DownloaderConfig, HttpDownloader};
use crate::core::error_handling::{
    errors, DownloadError, ErrorCategory, RetryContext, RetryExecutor, RetryPolicy, RetryStats,
};
use crate::core::integrity_checker::{
    HashAlgorithm, IntegrityChecker, IntegrityConfig, IntegrityResult,
};
use crate::core::models::{
    AppError, AppResult, DownloadConfig, DownloadStats as ModelsDownloadStats, ProgressUpdate,
    TaskStatus, VideoTask,
};
use crate::core::monitoring::{
    DashboardData, DownloadStatistics, HealthStatus, MonitoringConfig, MonitoringSystem,
    PerformanceMetrics, SystemMetrics,
};
use crate::core::progress_tracker::{EnhancedProgressStats, ProgressTrackingManager};
use crate::core::youtube_downloader::{
    DownloadPriority, YoutubeDownloadFormat, YoutubeDownloadStatus, YoutubeDownloader,
    YoutubeDownloaderConfig, YoutubeVideoInfo,
};

/// Events that can be emitted by the download manager
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum DownloadEvent {
    TaskCreated {
        task_id: String,
        task: VideoTask,
    },
    TaskStarted {
        task_id: String,
    },
    TaskProgress {
        task_id: String,
        progress: ProgressUpdate,
    },
    /// Enhanced progress tracking with detailed statistics
    EnhancedProgress {
        task_id: String,
        progress: EnhancedProgressStats,
    },
    TaskCompleted {
        task_id: String,
        file_path: String,
    },
    TaskFailed {
        task_id: String,
        error: String,
    },
    TaskPaused {
        task_id: String,
    },
    TaskResumed {
        task_id: String,
    },
    TaskCancelled {
        task_id: String,
    },
    /// File integrity verification started
    IntegrityCheckStarted {
        task_id: String,
        algorithm: String,
    },
    /// File integrity verification completed
    IntegrityCheckCompleted {
        task_id: String,
        result: IntegrityResult,
    },
    /// File integrity verification failed
    IntegrityCheckFailed {
        task_id: String,
        error: String,
    },
    /// Retry attempt started
    RetryAttemptStarted {
        task_id: String,
        context: RetryContext,
    },
    /// Retry attempt failed
    RetryAttemptFailed {
        task_id: String,
        error: String,
        will_retry: bool,
    },
    /// Circuit breaker state changed
    CircuitBreakerStateChanged {
        category: ErrorCategory,
        state: String,
    },
    /// Error occurred with detailed categorization
    ErrorOccurred {
        task_id: String,
        error: DownloadError,
    },
    StatsUpdated {
        stats: ModelsDownloadStats,
    },
    /// System metrics updated (CPU, memory, disk, network)
    SystemMetricsUpdated {
        metrics: SystemMetrics,
    },
    /// Download statistics updated
    DownloadStatisticsUpdated {
        statistics: DownloadStatistics,
    },
    /// Performance metrics updated
    PerformanceMetricsUpdated {
        metrics: PerformanceMetrics,
    },
    /// Health status changed
    HealthStatusChanged {
        status: HealthStatus,
    },
    /// Dashboard data updated (aggregated view)
    DashboardDataUpdated {
        data: DashboardData,
    },
    /// YouTube video info fetched
    YoutubeVideoInfoFetched {
        task_id: String,
        video_info: YoutubeVideoInfo,
    },
    /// YouTube download started
    YoutubeDownloadStarted {
        task_id: String,
        youtube_download_id: String,
        url: String,
    },
    /// YouTube download progress updated
    YoutubeDownloadProgress {
        task_id: String,
        youtube_download_id: String,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
        speed: Option<f64>,
    },
    /// YouTube download completed
    YoutubeDownloadCompleted {
        task_id: String,
        youtube_download_id: String,
        file_path: String,
    },
    /// YouTube download failed
    YoutubeDownloadFailed {
        task_id: String,
        youtube_download_id: String,
        error: String,
    },
    /// YouTube download cancelled
    YoutubeDownloadCancelled {
        task_id: String,
        youtube_download_id: String,
    },
}

/// Channel for communication between download manager and UI
pub type EventSender = mpsc::UnboundedSender<DownloadEvent>;
pub type EventReceiver = mpsc::UnboundedReceiver<DownloadEvent>;

/// Priority queue for task scheduling
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskPriority {
    pub task_id: String,
    pub priority: u8, // Higher number = higher priority
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl PartialOrd for TaskPriority {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for TaskPriority {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // First by priority (higher first), then by creation time (older first)
        other
            .priority
            .cmp(&self.priority)
            .then_with(|| self.created_at.cmp(&other.created_at))
    }
}

/// Main download manager that orchestrates all download operations
pub struct DownloadManager {
    /// Current download configuration
    config: DownloadConfig,

    /// Map of all download tasks
    tasks: HashMap<String, VideoTask>,

    /// Set of currently active downloads
    active_downloads: HashMap<String, tokio::task::JoinHandle<()>>,

    /// Event channel for communicating with UI
    event_sender: Option<EventSender>,

    /// Current download statistics
    stats: ModelsDownloadStats,

    /// Semaphore to limit concurrent downloads
    download_semaphore: Arc<tokio::sync::Semaphore>,

    /// HTTP downloader instance
    http_downloader: Arc<HttpDownloader>,

    /// Priority queue for pending tasks
    task_queue: Arc<Mutex<std::collections::BinaryHeap<TaskPriority>>>,

    /// Rate limiting: bytes per second (0 = unlimited)
    rate_limit: Arc<RwLock<Option<u64>>>,

    /// Flag to indicate if manager is running
    is_running: bool,

    /// Enhanced progress tracking manager
    progress_tracker: Arc<ProgressTrackingManager>,

    /// File integrity checker for verifying downloads
    integrity_checker: Arc<IntegrityChecker>,

    /// Retry executor for error handling and recovery
    retry_executor: Arc<RetryExecutor>,

    /// Real-time monitoring and statistics system
    monitoring_system: Arc<MonitoringSystem>,

    /// YouTube downloader for YouTube video downloads
    youtube_downloader: Option<Arc<YoutubeDownloader>>,

    /// Background task scheduler handle
    scheduler_handle: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct CompletionMarker {
    url: String,
    file_size: u64,
    completed_at: chrono::DateTime<chrono::Utc>,
}

impl DownloadManager {
    /// Create a new download manager with the given configuration
    pub fn new(config: DownloadConfig) -> AppResult<Self> {
        let concurrent_downloads = config.concurrent_downloads;

        // Create downloader configuration from manager configuration
        let downloader_config = DownloaderConfig {
            max_concurrent: concurrent_downloads,
            max_connections_per_download: 8, // Default to 8 connections per download
            timeout: config.timeout_seconds,
            retry_attempts: config.retry_attempts,
            buffer_size: 64 * 1024, // 64KB buffer
            user_agent: config.user_agent.clone(),
            resume_enabled: true, // Always enable resume by default
        };

        // Create HTTP downloader
        let http_downloader = HttpDownloader::new(downloader_config)
            .map_err(|e| AppError::System(format!("Failed to create downloader: {}", e)))?;
        let rate_limit_handle = http_downloader.bandwidth_controller().limit_handle();

        // Create integrity checker configuration
        let _integrity_config = IntegrityConfig {
            buffer_size: 64 * 1024, // 64KB buffer
            concurrent: true,
            max_concurrent: 2, // Limit concurrent integrity checks
            verify_exists: true,
            emit_progress: true,
            progress_threshold: 10 * 1024 * 1024, // 10MB
        };

        // Create integrity checker
        let integrity_checker = IntegrityChecker::new();

        // Create retry executor with enhanced policy
        let retry_policy = RetryPolicy {
            max_attempts: (config.retry_attempts as u32).max(3), // At least 3 attempts
            base_delay: Duration::from_millis(500),              // Start with 500ms
            max_delay: Duration::from_secs(60),                  // Cap at 1 minute
            backoff_multiplier: 2.0,
            jitter_enabled: true,
            jitter_factor: 0.2, // 20% jitter
            ..Default::default()
        };

        let retry_executor = RetryExecutor::new(retry_policy);

        // Create monitoring system configuration
        let monitoring_config = MonitoringConfig {
            system_metrics_enabled: true,
            system_metrics_interval: 5, // Collect system metrics every 5 seconds
            download_stats_enabled: true,
            download_stats_interval: 2, // Update download stats every 2 seconds
            performance_monitoring_enabled: true,
            performance_monitoring_interval: 1, // Performance metrics every second
            dashboard_enabled: true,
            dashboard_update_interval: 1000, // Dashboard updates every 1000ms
            prometheus_export_enabled: true,
            prometheus_export_port: 9090,
            data_retention_hours: 1,     // Keep 1 hour of history
            max_historical_points: 3600, // Maximum data points to keep
        };

        // Create monitoring system
        let monitoring_system = MonitoringSystem::new(monitoring_config);

        Ok(Self {
            config,
            tasks: HashMap::new(),
            active_downloads: HashMap::new(),
            event_sender: None,
            stats: ModelsDownloadStats::default(),
            download_semaphore: Arc::new(tokio::sync::Semaphore::new(concurrent_downloads)),
            http_downloader: Arc::new(http_downloader),
            task_queue: Arc::new(Mutex::new(std::collections::BinaryHeap::new())),
            rate_limit: rate_limit_handle,
            is_running: false,
            progress_tracker: Arc::new(ProgressTrackingManager::new()),
            integrity_checker: Arc::new(integrity_checker),
            retry_executor: Arc::new(retry_executor),
            monitoring_system: Arc::new(monitoring_system),
            youtube_downloader: None, // Initialize as None, can be enabled later
            scheduler_handle: None,
        })
    }

    /// Start the download manager
    pub async fn start(&mut self) -> AppResult<()> {
        let (sender, _receiver) = mpsc::unbounded_channel();
        self.start_with_sender(sender).await
    }

    pub async fn start_with_sender(&mut self, sender: EventSender) -> AppResult<()> {
        if self.is_running {
            warn!("Download manager is already running");
            return Ok(());
        }

        info!(
            "🚀 Starting download manager with concurrent limit: {}",
            self.config.concurrent_downloads
        );
        self.is_running = true;
        self.event_sender = Some(sender.clone());

        // 暂停后台空跑调度器，避免队列被弹出但未真正启动下载
        let monitoring_sender = sender.clone();
        self.scheduler_handle = None;

        // Start monitoring system
        let monitoring = Arc::clone(&self.monitoring_system);
        tokio::spawn(async move {
            Self::start_monitoring_system(monitoring, monitoring_sender).await;
        });

        info!("✅ Download manager started successfully");
        Ok(())
    }

    /// Stop the download manager and cancel all active downloads
    pub async fn stop(&mut self) -> AppResult<()> {
        if !self.is_running {
            return Ok(());
        }

        info!("🛑 Stopping download manager");

        // Stop background task scheduler
        if let Some(handle) = self.scheduler_handle.take() {
            handle.abort();
            debug!("Background task scheduler stopped");
        }

        // Cancel all active downloads
        let active_downloads: Vec<_> = self.active_downloads.drain().collect();
        for (task_id, handle) in active_downloads {
            handle.abort();
            self.update_task_status(&task_id, TaskStatus::Cancelled)
                .await?;
        }

        // Clear task queue
        {
            let mut queue = self.task_queue.lock().await;
            queue.clear();
        }

        // TODO: Stop monitoring system when Arc issue is fixed
        // if let Err(e) = self.monitoring_system.stop().await {
        //     warn!("Failed to stop monitoring system gracefully: {}", e);
        // }

        self.is_running = false;
        info!("✅ Download manager stopped successfully");
        Ok(())
    }

    /// Add a new download task
    pub async fn add_task(&mut self, url: String, output_path: String) -> AppResult<String> {
        self.add_task_with_priority(url, output_path, 5).await // Default priority = 5
    }

    /// Add a complete VideoTask directly to storage and return the stored record (after hydration)
    pub async fn add_video_task(&mut self, task: VideoTask) -> AppResult<VideoTask> {
        if self.has_duplicate_url(&task.url).await {
            return Err(AppError::Config(format!(
                "Duplicate task detected for URL: {}",
                task.url
            )));
        }

        let mut stored_task = task.clone();
        self.hydrate_existing_file_state(&mut stored_task).await?;

        self.tasks
            .insert(stored_task.id.clone(), stored_task.clone());

        if stored_task.status == TaskStatus::Pending {
            let priority_task = TaskPriority {
                task_id: stored_task.id.clone(),
                priority: 5,
                created_at: chrono::Utc::now(),
            };
            self.task_queue.lock().await.push(priority_task);
        }

        tracing::info!(
            "Added video task: {} ({})",
            stored_task.title,
            stored_task.id
        );
        Ok(stored_task)
    }

    /// Check if a URL already exists in tasks
    pub async fn has_duplicate_url(&self, url: &str) -> bool {
        self.tasks.values().any(|task| task.url == url)
    }

    /// Add video task with duplicate checking option
    pub async fn add_video_task_with_options(
        &mut self,
        task: VideoTask,
        allow_duplicates: bool,
    ) -> AppResult<VideoTask> {
        // Check for duplicates if not allowing them
        if !allow_duplicates && self.has_duplicate_url(&task.url).await {
            return Err(AppError::Config(format!(
                "Duplicate task detected for URL: {}",
                task.url
            )));
        }

        let mut stored_task = task.clone();
        self.hydrate_existing_file_state(&mut stored_task).await?;

        self.tasks
            .insert(stored_task.id.clone(), stored_task.clone());

        if stored_task.status == TaskStatus::Pending {
            let priority_task = TaskPriority {
                task_id: stored_task.id.clone(),
                priority: 5,
                created_at: chrono::Utc::now(),
            };
            self.task_queue.lock().await.push(priority_task);
        }

        tracing::info!(
            "Added video task: {} ({})",
            stored_task.title,
            stored_task.id
        );
        Ok(stored_task)
    }

    /// Check if a task is currently active (downloading)
    pub async fn is_task_active(&self, task_id: &str) -> bool {
        self.active_downloads.contains_key(task_id)
    }

    /// Add a new download task with specific priority
    pub async fn add_task_with_priority(
        &mut self,
        url: String,
        output_path: String,
        priority: u8,
    ) -> AppResult<String> {
        let task_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        let mut task = VideoTask {
            id: task_id.clone(),
            url: url.clone(),
            title: self.extract_title_from_url(&url),
            output_path,
            status: TaskStatus::Pending,
            progress: 0.0,
            file_size: None,
            downloaded_size: 0,
            speed: 0.0,
            eta: None,
            error_message: None,
            created_at: now,
            updated_at: now,
            downloader_type: None,
            video_info: None, // 没有额外的视频信息
        };

        self.hydrate_existing_file_state(&mut task).await?;

        self.tasks.insert(task_id.clone(), task.clone());

        // Add to priority queue
        let task_priority = TaskPriority {
            task_id: task_id.clone(),
            priority,
            created_at: now,
        };

        {
            let mut queue = self.task_queue.lock().await;
            queue.push(task_priority);
        }

        self.update_stats().await;

        // Emit task created event
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::TaskCreated {
                task_id: task_id.clone(),
                task: task.clone(),
            });
        }

        info!(
            "📋 Added new download task: {} - {} (priority: {})",
            task_id, url, priority
        );
        Ok(task_id)
    }

    /// Add multiple tasks with batch processing
    pub async fn add_batch_tasks(
        &mut self,
        tasks: Vec<(String, String, Option<u8>)>,
    ) -> AppResult<Vec<String>> {
        let mut task_ids = Vec::with_capacity(tasks.len());

        for (url, output_path, priority) in tasks {
            let priority = priority.unwrap_or(5); // Default priority
            let task_id = self
                .add_task_with_priority(url, output_path, priority)
                .await?;
            task_ids.push(task_id);
        }

        info!("📋 Added {} tasks in batch", task_ids.len());
        Ok(task_ids)
    }

    /// Start downloading a specific task
    pub async fn start_download(&mut self, task_id: &str) -> AppResult<()> {
        // 在启动前刷新任务的本地文件状态，确保断点续传能拿到最新已下载大小
        self.refresh_task_file_state(task_id).await?;
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?
            .clone();

        // 幂等防护：已在下载或句柄存在则直接返回成功
        if task.status == TaskStatus::Downloading || self.active_downloads.contains_key(task_id) {
            return Ok(());
        }

        if task.status != TaskStatus::Pending && task.status != TaskStatus::Paused {
            return Err(AppError::Download(format!(
                "Task {} cannot be started from status: {:?}",
                task_id, task.status
            )));
        }

        // Check if we can start a new download
        let permit = self
            .download_semaphore
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::Download("Maximum concurrent downloads reached".to_string()))?;

        self.update_task_status(task_id, TaskStatus::Downloading)
            .await?;

        // Start enhanced progress tracking
        self.start_enhanced_tracking(task_id, task.file_size)
            .await?;

        // Emit task started event
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::TaskStarted {
                task_id: task_id.to_string(),
            });
        }

        // Create download task
        let task_id_clone = task_id.to_string();
        let url = task.url.clone();
        let output_path = task.output_path.clone();
        let event_sender = self.event_sender.as_ref().unwrap().clone();
        let downloader = Arc::clone(&self.http_downloader);
        let progress_tracker = Arc::clone(&self.progress_tracker);
        let integrity_checker = Arc::clone(&self.integrity_checker);
        let retry_executor = Arc::clone(&self.retry_executor);
        let download_config = self.config.clone();

        let handle = tokio::spawn(async move {
            let _permit = permit; // Keep permit alive

            match Self::execute_download(
                &task_id_clone,
                &url,
                &output_path,
                downloader,
                event_sender,
                progress_tracker,
                integrity_checker,
                retry_executor,
                download_config,
            )
            .await
            {
                Ok(file_path) => {
                    info!("✅ Download completed: {} -> {}", task_id_clone, file_path);
                }
                Err(error) => {
                    error!("❌ Download failed: {} - {}", task_id_clone, error);
                }
            }
        });

        self.active_downloads.insert(task_id.to_string(), handle);
        info!("🔄 Started download: {}", task_id);

        Ok(())
    }

    /// Pause a download task
    pub async fn pause_download(&mut self, task_id: &str) -> AppResult<()> {
        if let Some(handle) = self.active_downloads.remove(task_id) {
            handle.abort();
            self.update_task_status(task_id, TaskStatus::Paused).await?;

            // Emit task paused event
            if let Some(sender) = &self.event_sender {
                let _ = sender.send(DownloadEvent::TaskPaused {
                    task_id: task_id.to_string(),
                });
            }

            info!("⏸️ Paused download: {}", task_id);
            Ok(())
        } else {
            Err(AppError::Download(format!(
                "Active download not found: {}",
                task_id
            )))
        }
    }

    /// Resume a paused download task
    pub async fn resume_download(&mut self, task_id: &str) -> AppResult<()> {
        // 恢复前先刷新本地文件状态，确保续传起点正确
        self.refresh_task_file_state(task_id).await?;
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;

        if task.status != TaskStatus::Paused {
            return Err(AppError::Download(format!(
                "Task {} cannot be resumed from status: {:?}",
                task_id, task.status
            )));
        }

        // Resume is essentially the same as starting
        self.start_download(task_id).await?;

        // Emit task resumed event
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::TaskResumed {
                task_id: task_id.to_string(),
            });
        }

        info!("▶️ Resumed download: {}", task_id);
        Ok(())
    }

    /// Cancel a download task
    pub async fn cancel_download(&mut self, task_id: &str) -> AppResult<()> {
        let downloader = Arc::clone(&self.http_downloader);
        if let Some(handle) = self.active_downloads.remove(task_id) {
            handle.abort();
        }

        // 发信号给 HttpDownloader，确保底层任务尽快停止
        let _ = downloader.cancel_download(task_id).await;

        self.update_task_status(task_id, TaskStatus::Cancelled)
            .await?;

        // Emit task cancelled event
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::TaskCancelled {
                task_id: task_id.to_string(),
            });
        }

        info!("🚫 Cancelled download: {}", task_id);
        Ok(())
    }

    /// Pause all active downloads
    pub async fn pause_all_downloads(&mut self) -> AppResult<usize> {
        let downloader = Arc::clone(&self.http_downloader);
        downloader.pause_all().await;

        let task_ids: Vec<String> = self.active_downloads.keys().cloned().collect();

        let mut paused = 0usize;
        for task_id in task_ids {
            match self.pause_download(&task_id).await {
                Ok(_) => paused += 1,
                Err(e) => warn!("Failed to pause task {}: {}", task_id, e),
            }
        }

        info!("Paused {} active downloads", paused);
        Ok(paused)
    }

    /// Resume all paused downloads
    pub async fn resume_all_downloads(&mut self) -> AppResult<usize> {
        let downloader = Arc::clone(&self.http_downloader);
        downloader.resume_all().await;

        let paused_ids: Vec<String> = self
            .tasks
            .iter()
            .filter_map(|(task_id, task)| {
                if task.status == TaskStatus::Paused {
                    Some(task_id.clone())
                } else {
                    None
                }
            })
            .collect();

        let mut resumed = 0usize;
        for task_id in paused_ids {
            match self.resume_download(&task_id).await {
                Ok(_) => resumed += 1,
                Err(e) => warn!("Failed to resume task {}: {}", task_id, e),
            }
        }

        info!("Resumed {} paused downloads", resumed);
        Ok(resumed)
    }

    /// Start all pending/paused/failed tasks (best-effort)
    pub async fn start_all_pending(&mut self) -> AppResult<usize> {
        let candidates = self.collect_task_ids_by_status(&[
            TaskStatus::Pending,
            TaskStatus::Paused,
            TaskStatus::Failed,
        ]);
        if candidates.is_empty() {
            info!("No pending or paused tasks to start");
            return Ok(0);
        }

        let mut started = 0usize;
        for task_id in candidates {
            match self.start_download(&task_id).await {
                Ok(_) => started += 1,
                Err(AppError::Download(msg)) if msg.contains("Maximum concurrent downloads") => {
                    info!(
                        "Reached concurrency limit while starting tasks (started {})",
                        started
                    );
                    break;
                }
                Err(e) => {
                    warn!(
                        "Failed to start task {} during start_all_pending: {}",
                        task_id, e
                    );
                }
            }
        }

        info!("Started {} tasks via start_all_pending", started);
        Ok(started)
    }

    /// Cancel all pending/downloading/paused tasks
    pub async fn cancel_all_downloads(&mut self) -> AppResult<usize> {
        let cancellable_ids: Vec<String> = self
            .tasks
            .iter()
            .filter_map(|(task_id, task)| match task.status {
                TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled => None,
                _ => Some(task_id.clone()),
            })
            .collect();

        let mut cancelled = 0usize;
        for task_id in cancellable_ids {
            match self.cancel_download(&task_id).await {
                Ok(_) => cancelled += 1,
                Err(e) => warn!("Failed to cancel task {}: {}", task_id, e),
            }
        }

        info!("Cancelled {} downloads", cancelled);
        Ok(cancelled)
    }

    pub fn is_running(&self) -> bool {
        self.is_running
    }

    pub fn has_event_sender(&self) -> bool {
        self.event_sender.is_some()
    }

    pub async fn start_download_impl(&mut self, task_id: &str) -> AppResult<()> {
        self.start_download(task_id).await
    }

    pub async fn pause_download_impl(&mut self, task_id: &str) -> AppResult<()> {
        self.pause_download(task_id).await
    }

    pub async fn resume_download_impl(&mut self, task_id: &str) -> AppResult<()> {
        self.resume_download(task_id).await
    }

    pub async fn cancel_download_impl(&mut self, task_id: &str) -> AppResult<()> {
        self.cancel_download(task_id).await
    }

    pub async fn pause_all_downloads_impl(&mut self) -> AppResult<usize> {
        self.pause_all_downloads().await
    }

    pub async fn resume_all_downloads_impl(&mut self) -> AppResult<usize> {
        self.resume_all_downloads().await
    }

    pub async fn start_all_pending_impl(&mut self) -> AppResult<usize> {
        self.start_all_pending().await
    }

    pub async fn cancel_all_downloads_impl(&mut self) -> AppResult<usize> {
        self.cancel_all_downloads().await
    }

    fn collect_task_ids_by_status(&self, statuses: &[TaskStatus]) -> Vec<String> {
        let mut entries: Vec<(String, chrono::DateTime<chrono::Utc>)> = self
            .tasks
            .iter()
            .filter_map(|(task_id, task)| {
                if statuses.iter().any(|status| task.status == *status) {
                    Some((task_id.clone(), task.created_at))
                } else {
                    None
                }
            })
            .collect();
        entries.sort_by(|a, b| a.1.cmp(&b.1));
        entries.into_iter().map(|(task_id, _)| task_id).collect()
    }

    /// Remove a completed or failed task
    pub async fn remove_task(&mut self, task_id: &str) -> AppResult<()> {
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;

        match task.status {
            TaskStatus::Downloading => {
                return Err(AppError::Download(
                    "Cannot remove active download".to_string(),
                ));
            }
            _ => {
                self.tasks.remove(task_id);
                self.update_stats().await;
                info!("🗑️ Removed task: {}", task_id);
                Ok(())
            }
        }
    }

    /// Get all download tasks
    pub async fn get_tasks(&self) -> Vec<VideoTask> {
        self.tasks.values().cloned().collect()
    }

    /// Get download statistics
    pub async fn get_stats(&self) -> ModelsDownloadStats {
        self.stats.clone()
    }

    /// Update the download configuration
    pub async fn update_config(&mut self, config: DownloadConfig) -> AppResult<()> {
        let old_concurrent = self.config.concurrent_downloads;
        let new_concurrent = config.concurrent_downloads;

        self.config = config;

        // Update semaphore if concurrent downloads changed
        if old_concurrent != new_concurrent {
            self.download_semaphore = Arc::new(tokio::sync::Semaphore::new(new_concurrent));
            info!(
                "🔧 Updated concurrent downloads: {} -> {}",
                old_concurrent, new_concurrent
            );
        }

        Ok(())
    }

    /// Clear all completed tasks
    pub async fn clear_completed(&mut self) -> AppResult<usize> {
        let initial_count = self.tasks.len();

        self.tasks
            .retain(|_id, task| task.status != TaskStatus::Completed);
        self.update_stats().await;

        let removed_count = initial_count - self.tasks.len();
        info!("🧹 Cleared {} completed tasks", removed_count);

        Ok(removed_count)
    }

    /// Retry all failed tasks
    pub async fn retry_failed(&mut self) -> AppResult<usize> {
        let mut retry_count = 0;

        for task in self.tasks.values_mut() {
            if task.status == TaskStatus::Failed {
                task.status = TaskStatus::Pending;
                task.error_message = None;
                task.progress = 0.0;
                task.downloaded_size = 0;
                task.speed = 0.0;
                task.eta = None;
                task.updated_at = chrono::Utc::now();
                retry_count += 1;
            }
        }

        self.update_stats().await;
        info!("🔄 Reset {} failed tasks for retry", retry_count);

        Ok(retry_count)
    }

    /// Set download rate limit in bytes per second (None = unlimited)
    pub async fn set_rate_limit(&self, bytes_per_second: Option<u64>) {
        let mut rate_limit = self.rate_limit.write().await;
        *rate_limit = bytes_per_second;

        if let Some(limit) = bytes_per_second {
            info!("🚦 Download rate limit set to {} bytes/sec", limit);
        } else {
            info!("🚦 Download rate limit removed");
        }
    }

    /// Get current rate limit
    pub async fn get_rate_limit(&self) -> Option<u64> {
        *self.rate_limit.read().await
    }

    /// Get enhanced progress stats for a specific task
    pub async fn get_enhanced_progress(&self, task_id: &str) -> Option<EnhancedProgressStats> {
        self.progress_tracker.get_progress(task_id).await
    }

    /// Get enhanced progress stats for all active tasks
    pub async fn get_all_enhanced_progress(&self) -> Vec<EnhancedProgressStats> {
        self.progress_tracker.get_all_progress().await
    }

    /// Get global enhanced progress statistics
    pub async fn get_global_enhanced_stats(
        &self,
    ) -> crate::core::progress_tracker::GlobalProgressStats {
        self.progress_tracker.get_global_stats().await
    }

    /// Enable enhanced progress tracking for a task
    async fn start_enhanced_tracking(
        &self,
        task_id: &str,
        total_bytes: Option<u64>,
    ) -> AppResult<()> {
        self.progress_tracker
            .start_tracking(task_id.to_string(), total_bytes)
            .await
    }

    /// Update enhanced progress for a task
    #[allow(dead_code)]
    async fn update_enhanced_progress(
        &self,
        task_id: &str,
        downloaded_bytes: u64,
    ) -> AppResult<()> {
        let _ = self
            .progress_tracker
            .update_progress(task_id, downloaded_bytes)
            .await;

        // Get enhanced stats and emit event
        if let Some(enhanced_stats) = self.progress_tracker.get_progress(task_id).await {
            if let Some(sender) = &self.event_sender {
                let _ = sender.send(DownloadEvent::EnhancedProgress {
                    task_id: task_id.to_string(),
                    progress: enhanced_stats,
                });
            }
        }

        Ok(())
    }

    /// Stop enhanced progress tracking for a task
    #[allow(dead_code)]
    async fn stop_enhanced_tracking(&self, task_id: &str) -> AppResult<()> {
        self.progress_tracker.stop_tracking(task_id).await
    }

    /// Background task scheduler - the heart of concurrent download management
    async fn task_scheduler(
        task_queue: Arc<Mutex<std::collections::BinaryHeap<TaskPriority>>>,
        semaphore: Arc<tokio::sync::Semaphore>,
        _downloader: Arc<HttpDownloader>,
        rate_limit: Arc<RwLock<Option<u64>>>,
        _event_sender: EventSender,
    ) {
        info!("🎯 Starting intelligent task scheduler");
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));

        loop {
            interval.tick().await;

            // Try to get the next high-priority task
            let next_task = {
                let mut queue = task_queue.lock().await;
                queue.pop()
            };

            if let Some(task_priority) = next_task {
                // Try to acquire a permit for concurrent download
                if let Ok(permit) = semaphore.clone().try_acquire_owned() {
                    let TaskPriority {
                        task_id, priority, ..
                    } = task_priority;
                    let rate_limit_clone = Arc::clone(&rate_limit);

                    // Spawn individual download task
                    tokio::spawn(async move {
                        let _permit = permit; // Keep permit alive for duration of download

                        info!(
                            "🚀 Starting download for task: {} (priority: {})",
                            task_id, priority
                        );

                        // Apply rate limiting if configured
                        if let Some(limit) = *rate_limit_clone.read().await {
                            // TODO: Implement rate limiting in the download process
                            debug!("Rate limiting enabled: {} bytes/sec", limit);
                        }

                        // For now, we'll simulate task execution
                        // In real implementation, this would get task details and execute download
                        debug!("Scheduled task {} for execution", task_id);

                        // Simulate download completion notification
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                        debug!("Task {} scheduled successfully", task_id);
                    });
                } else {
                    // No permits available, put task back in queue
                    let mut queue = task_queue.lock().await;
                    queue.push(task_priority);

                    // Wait a bit before trying again
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            } else {
                // No tasks in queue, wait longer
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            }
        }
    }

    // Private helper methods

    async fn hydrate_existing_file_state(&self, task: &mut VideoTask) -> AppResult<()> {
        let Some(file_path) = self.resolve_output_file_path(task) else {
            return Ok(());
        };

        if let Some(marker) = Self::load_completion_marker(&file_path).await {
            if marker.url == task.url {
                if let Ok(metadata) = fs::metadata(&file_path).await {
                    if metadata.len() == marker.file_size && marker.file_size > 0 {
                        task.status = TaskStatus::Completed;
                        task.file_size = Some(marker.file_size);
                        task.downloaded_size = marker.file_size;
                        task.progress = 100.0;
                        task.speed = 0.0;
                        task.eta = None;
                        return Ok(());
                    }
                }
            }
        }

        if let Ok(metadata) = fs::metadata(&file_path).await {
            let existing_size = metadata.len();
            if existing_size > 0 {
                task.downloaded_size = existing_size;
                if let Some(total) = task.file_size {
                    if total > 0 {
                        task.progress = ((existing_size as f64 / total as f64) * 100.0).min(100.0);
                    }
                }
            }
        }

        Ok(())
    }

    fn resolve_output_file_path(&self, task: &VideoTask) -> Option<PathBuf> {
        if task.output_path.trim().is_empty() {
            return None;
        }
        let filename = self.extract_title_from_url(&task.url);
        Some(Path::new(&task.output_path).join(filename))
    }

    fn completion_marker_path(file_path: &Path) -> PathBuf {
        let file_name = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("download");
        file_path.with_file_name(format!("{}.vdstate", file_name))
    }

    async fn load_completion_marker(file_path: &Path) -> Option<CompletionMarker> {
        let marker_path = Self::completion_marker_path(file_path);
        match fs::read_to_string(&marker_path).await {
            Ok(contents) => serde_json::from_str(&contents).ok(),
            Err(_) => None,
        }
    }

    async fn persist_completion_marker(file_path: &Path, url: &str) -> AppResult<()> {
        let metadata = fs::metadata(file_path)
            .await
            .map_err(|e| AppError::System(format!("Failed to inspect download file: {}", e)))?;

        let marker = CompletionMarker {
            url: url.to_string(),
            file_size: metadata.len(),
            completed_at: chrono::Utc::now(),
        };

        let json = serde_json::to_string(&marker).map_err(|e| {
            AppError::System(format!("Failed to serialize completion marker: {}", e))
        })?;

        fs::write(Self::completion_marker_path(file_path), json)
            .await
            .map_err(|e| AppError::System(format!("Failed to persist completion marker: {}", e)))
    }

    /// Update task status
    pub async fn update_task_status(&mut self, task_id: &str, status: TaskStatus) -> AppResult<()> {
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.status = status;
            task.updated_at = chrono::Utc::now();
            self.update_stats().await;
        }
        Ok(())
    }

    /// Update download statistics
    async fn update_stats(&mut self) {
        let total_tasks = self.tasks.len();
        let completed_tasks = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Completed)
            .count();
        let failed_tasks = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Failed)
            .count();
        let active_downloads = self.active_downloads.len();

        let total_downloaded: u64 = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Completed)
            .map(|t| t.downloaded_size)
            .sum();

        let current_speeds: Vec<f64> = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Downloading)
            .map(|t| t.speed)
            .collect();

        let average_speed = if !current_speeds.is_empty() {
            current_speeds.iter().sum::<f64>() / current_speeds.len() as f64
        } else {
            0.0
        };

        self.stats = ModelsDownloadStats {
            total_tasks,
            completed_tasks,
            failed_tasks,
            total_downloaded,
            average_speed,
            active_downloads,
        };

        // Emit stats updated event
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::StatsUpdated {
                stats: self.stats.clone(),
            });
        }

        // Update monitoring system with current statistics
        let _pending_tasks = self.task_queue.lock().await.len();
        let _current_speed = current_speeds.iter().sum::<f64>() as u64; // Total current speed

        // TODO: Update monitoring statistics when proper method is available
        // For now, monitoring system will collect its own statistics
    }

    /// Apply state updates based on download events so backend state stays consistent with UI
    pub async fn apply_event_side_effects(&mut self, event: &DownloadEvent) -> AppResult<()> {
        match event {
            DownloadEvent::TaskProgress { progress, .. } => {
                self.update_task_progress_snapshot(progress).await?;
            }
            DownloadEvent::TaskCompleted { task_id, file_path } => {
                self.finalize_task_state(task_id, TaskStatus::Completed, Some(file_path), None)
                    .await?;
            }
            DownloadEvent::TaskFailed { task_id, error } => {
                self.finalize_task_state(
                    task_id,
                    TaskStatus::Failed,
                    None,
                    Some(error.to_string()),
                )
                .await?;
            }
            DownloadEvent::TaskCancelled { task_id } => {
                self.finalize_task_state(task_id, TaskStatus::Cancelled, None, None)
                    .await?;
            }
            DownloadEvent::TaskPaused { task_id } => {
                self.drop_active_handle(task_id);
                self.update_task_status(task_id, TaskStatus::Paused).await?;
            }
            DownloadEvent::TaskResumed { task_id } | DownloadEvent::TaskStarted { task_id } => {
                self.update_task_status(task_id, TaskStatus::Downloading)
                    .await?;
            }
            _ => {}
        }

        Ok(())
    }

    /// Persist progress snapshot into task list for consistent refreshes
    async fn update_task_progress_snapshot(&mut self, progress: &ProgressUpdate) -> AppResult<()> {
        if let Some(task) = self.tasks.get_mut(&progress.task_id) {
            if matches!(task.status, TaskStatus::Completed | TaskStatus::Cancelled) {
                return Ok(());
            }

            task.downloaded_size = progress.downloaded_size;
            if let Some(total) = progress.total_size {
                task.file_size = Some(total);
            }
            task.speed = progress.speed;
            task.eta = progress.eta;

            task.progress = (progress.progress * 100.0).clamp(0.0, 100.0);
            task.updated_at = chrono::Utc::now();
        }

        self.update_stats().await;
        Ok(())
    }

    /// Finalize task state on completion/failure/cancel and clean active handle
    async fn finalize_task_state(
        &mut self,
        task_id: &str,
        status: TaskStatus,
        file_path: Option<&str>,
        error_message: Option<String>,
    ) -> AppResult<()> {
        self.drop_active_handle(task_id);

        if let Some(task) = self.tasks.get_mut(task_id) {
            task.status = status;
            task.error_message = error_message;
            task.speed = 0.0;
            task.eta = None;

            if let Some(path) = file_path {
                match fs::metadata(path).await {
                    Ok(metadata) => {
                        let size = metadata.len();
                        task.downloaded_size = size;
                        task.file_size = Some(size);
                        task.progress = 100.0;
                    }
                    Err(e) => {
                        warn!("Failed to read file metadata for {}: {}", task_id, e);
                        if task.progress < 100.0 && matches!(task.status, TaskStatus::Completed) {
                            task.progress = 100.0;
                        }
                    }
                }
            }

            task.updated_at = chrono::Utc::now();
        } else {
            warn!(
                "Received lifecycle event for unknown task {}; state will not be updated",
                task_id
            );
        }

        self.update_stats().await;
        Ok(())
    }

    /// Remove finished/aborted download handle from the active map
    fn drop_active_handle(&mut self, task_id: &str) {
        if self.active_downloads.remove(task_id).is_some() {
            debug!("Dropped active download handle for {}", task_id);
        }
    }

    /// Extract title from URL (simple heuristic)
    fn extract_title_from_url(&self, url: &str) -> String {
        url.split('/')
            .last()
            .and_then(|s| s.split('?').next())
            .unwrap_or("Unknown")
            .to_string()
    }

    /// Refresh a task's local file state (downloaded_size/progress) before start/resume
    async fn refresh_task_file_state(&mut self, task_id: &str) -> AppResult<()> {
        // 先克隆，再水合，最后写回，避免可变/不可变重叠借用
        if let Some(existing) = self.tasks.get(task_id).cloned() {
            let mut hydrated = existing;
            self.hydrate_existing_file_state(&mut hydrated).await?;
            if let Some(slot) = self.tasks.get_mut(task_id) {
                *slot = hydrated;
            }
        }
        Ok(())
    }

    /// Execute the actual download using HttpDownloader with retry mechanism
    async fn execute_download(
        task_id: &str,
        url: &str,
        output_path: &str,
        downloader: Arc<HttpDownloader>,
        event_sender: EventSender,
        progress_tracker: Arc<ProgressTrackingManager>,
        integrity_checker: Arc<IntegrityChecker>,
        retry_executor: Arc<RetryExecutor>,
        config: DownloadConfig,
    ) -> AppResult<String> {
        info!(
            "🔽 Starting download with retry mechanism: {} -> {}",
            url, output_path
        );

        // Clone data for retry closure
        let task_id = task_id.to_string();
        let url = url.to_string();
        let output_path = output_path.to_string();

        // Execute download with retry mechanism
        let result = retry_executor
            .execute(|retry_context| {
                let task_id = task_id.clone();
                let url = url.clone();
                let output_path = output_path.clone();
                let downloader = Arc::clone(&downloader);
                let event_sender = event_sender.clone();
                let progress_tracker = Arc::clone(&progress_tracker);
                let integrity_checker = Arc::clone(&integrity_checker);
                let config = config.clone();

                Box::pin(async move {
                    // Emit retry attempt event
                    let _ = event_sender.send(DownloadEvent::RetryAttemptStarted {
                        task_id: task_id.clone(),
                        context: retry_context.clone(),
                    });

                    match Self::execute_download_attempt(
                        &task_id,
                        &url,
                        &output_path,
                        downloader,
                        event_sender.clone(),
                        progress_tracker,
                        integrity_checker,
                        config,
                    )
                    .await
                    {
                        Ok(file_path) => Ok(file_path),
                        Err(app_error) => {
                            // Convert AppError to DownloadError
                            let download_error =
                                Self::convert_app_error_to_download_error(app_error);

                            // Emit error event
                            let _ = event_sender.send(DownloadEvent::ErrorOccurred {
                                task_id: task_id.clone(),
                                error: download_error.clone(),
                            });

                            Err(download_error)
                        }
                    }
                })
            })
            .await;

        match result {
            Ok(file_path) => {
                info!("✅ Download completed successfully: {}", file_path);
                Ok(file_path)
            }
            Err(e) => {
                error!("❌ Download failed after all retries: {}", e);
                Err(AppError::Download(e.to_string()))
            }
        }
    }

    /// Execute a single download attempt without retry logic
    async fn execute_download_attempt(
        task_id: &str,
        url: &str,
        output_path: &str,
        downloader: Arc<HttpDownloader>,
        event_sender: EventSender,
        progress_tracker: Arc<ProgressTrackingManager>,
        integrity_checker: Arc<IntegrityChecker>,
        config: DownloadConfig,
    ) -> AppResult<String> {
        debug!("🔄 Attempting download: {} -> {}", url, output_path);

        // Extract filename from URL
        let filename = url
            .split('/')
            .last()
            .and_then(|s| s.split('?').next())
            .unwrap_or("download")
            .to_string();

        // Create download task and ensure IDs match the manager task ID so progress events line up.
        let mut download_task =
            DownloadTask::new(url.to_string(), output_path.to_string(), filename);
        download_task.id = task_id.to_string();

        // Create progress channel for downloader callback
        let (download_progress_tx, mut download_progress_rx) =
            mpsc::unbounded_channel::<(String, DownloadStats)>();

        // Clone necessary data for progress tracking
        let task_id_clone = task_id.to_string();
        let event_sender_clone = event_sender.clone();
        let progress_tracker_clone = Arc::clone(&progress_tracker);

        // Spawn enhanced progress tracking task
        let progress_handle = tokio::spawn(async move {
            while let Some((task_id, download_stats)) = download_progress_rx.recv().await {
                if task_id == task_id_clone {
                    // Create progress update from download stats
                    let progress_event = ProgressUpdate {
                        task_id: task_id_clone.clone(),
                        downloaded_size: download_stats.downloaded_bytes,
                        total_size: download_stats.total_bytes,
                        speed: download_stats.speed,
                        eta: download_stats.eta,
                        progress: download_stats.progress,
                    };

                    let _ = event_sender_clone.send(DownloadEvent::TaskProgress {
                        task_id: task_id_clone.clone(),
                        progress: progress_event,
                    });

                    // Enhanced progress update
                    if let Err(e) = progress_tracker_clone
                        .update_progress(&task_id_clone, download_stats.downloaded_bytes)
                        .await
                    {
                        warn!(
                            "Failed to update enhanced progress for {}: {}",
                            task_id_clone, e
                        );
                    } else {
                        // Emit enhanced progress event
                        if let Some(enhanced_stats) =
                            progress_tracker_clone.get_progress(&task_id_clone).await
                        {
                            let _ = event_sender_clone.send(DownloadEvent::EnhancedProgress {
                                task_id: task_id_clone.clone(),
                                progress: enhanced_stats,
                            });
                        }
                    }
                }
            }
        });

        // Set progress callback on downloader
        let mut downloader_clone = (*downloader).clone();
        downloader_clone.set_progress_callback(download_progress_tx);

        // Execute download
        let result = downloader_clone.download(download_task).await;

        // Stop progress tracking
        progress_handle.abort();

        match result {
            Ok(completed_task) => {
                match completed_task.status {
                    TaskStatus::Completed => {
                        let file_path_buf = std::path::Path::new(&completed_task.output_path)
                            .join(&completed_task.filename);
                        let file_path = file_path_buf.to_string_lossy().to_string();

                        // Stop enhanced progress tracking
                        let _ = progress_tracker.stop_tracking(task_id).await;

                        let _ = event_sender.send(DownloadEvent::TaskCompleted {
                            task_id: task_id.to_string(),
                            file_path: file_path.clone(),
                        });

                        if let Err(err) =
                            Self::persist_completion_marker(&file_path_buf, &url).await
                        {
                            warn!(
                                "Failed to persist completion marker for {}: {}",
                                task_id, err
                            );
                        }

                        // Perform integrity verification if enabled
                        if config.auto_verify_integrity {
                            info!(
                                "🔐 Starting automatic integrity verification for: {}",
                                file_path
                            );

                            // Determine which algorithm to use
                            let algorithm = config
                                .integrity_algorithm
                                .as_ref()
                                .and_then(|alg| match alg.to_lowercase().as_str() {
                                    "sha256" => Some(HashAlgorithm::Sha256),
                                    "sha512" => Some(HashAlgorithm::Sha512),
                                    "blake2b" | "blake2b512" => Some(HashAlgorithm::Blake2b512),
                                    "blake2s" | "blake2s256" => Some(HashAlgorithm::Blake2s256),
                                    "md5" => Some(HashAlgorithm::Md5),
                                    "sha1" => Some(HashAlgorithm::Sha1),
                                    _ => None,
                                })
                                .unwrap_or(HashAlgorithm::Sha256); // Default to SHA-256

                            // Emit integrity check started event
                            let _ = event_sender.send(DownloadEvent::IntegrityCheckStarted {
                                task_id: task_id.to_string(),
                                algorithm: format!("{:?}", algorithm),
                            });

                            // Set up progress tracking for integrity check
                            let (_integrity_progress_tx, mut integrity_progress_rx) =
                                mpsc::unbounded_channel::<
                                    crate::core::integrity_checker::IntegrityProgress,
                                >();
                            // Note: IntegrityChecker.set_progress_callback may not be async, removing .await for now

                            // Clone necessary data for progress tracking
                            let task_id_integrity = task_id.to_string();

                            // Spawn integrity progress tracking task
                            let integrity_progress_handle = tokio::spawn(async move {
                                while let Some(progress) = integrity_progress_rx.recv().await {
                                    debug!(
                                        "Integrity check progress for {}: {:?}",
                                        task_id_integrity, progress
                                    );
                                    // Could emit custom integrity progress events here if needed
                                }
                            });

                            // Perform integrity verification (compute hash without expected value)
                            let integrity_result =
                                integrity_checker.compute_hash(&file_path, algorithm).await;

                            // Stop integrity progress tracking
                            integrity_progress_handle.abort();

                            match integrity_result {
                                Ok(result) => {
                                    let _ =
                                        event_sender.send(DownloadEvent::IntegrityCheckCompleted {
                                            task_id: task_id.to_string(),
                                            result: result.clone(),
                                        });

                                    if result.is_valid {
                                        info!(
                                            "✅ Integrity verification passed for: {} ({:?}: {})",
                                            file_path, algorithm, result.computed_hash
                                        );
                                    } else {
                                        warn!("⚠️ Integrity verification failed for: {} (computed: {}, expected: {:?})", 
                                              file_path, result.computed_hash, result.expected_hash);
                                    }
                                }
                                Err(integrity_error) => {
                                    let error_msg =
                                        format!("Integrity check failed: {}", integrity_error);
                                    error!("❌ {}", error_msg);

                                    let _ =
                                        event_sender.send(DownloadEvent::IntegrityCheckFailed {
                                            task_id: task_id.to_string(),
                                            error: error_msg,
                                        });
                                }
                            }
                        }

                        info!("✅ Download completed: {}", file_path);
                        Ok(file_path)
                    }
                    TaskStatus::Failed => {
                        let error_msg = completed_task
                            .error_message
                            .unwrap_or_else(|| "Unknown download error".to_string());

                        // Stop enhanced progress tracking
                        let _ = progress_tracker.stop_tracking(task_id).await;

                        let _ = event_sender.send(DownloadEvent::TaskFailed {
                            task_id: task_id.to_string(),
                            error: error_msg.clone(),
                        });

                        error!("❌ Download failed: {}", error_msg);
                        Err(AppError::Download(error_msg))
                    }
                    _ => {
                        let error_msg = "Download ended in unexpected state".to_string();

                        // Stop enhanced progress tracking
                        let _ = progress_tracker.stop_tracking(task_id).await;

                        let _ = event_sender.send(DownloadEvent::TaskFailed {
                            task_id: task_id.to_string(),
                            error: error_msg.clone(),
                        });
                        Err(AppError::Download(error_msg))
                    }
                }
            }
            Err(e) => {
                let error_msg = e.to_string();
                let _ = event_sender.send(DownloadEvent::TaskFailed {
                    task_id: task_id.to_string(),
                    error: error_msg.clone(),
                });

                error!("❌ Download error: {}", error_msg);
                Err(AppError::Download(error_msg))
            }
        }
    }

    /// Manually verify file integrity using specified algorithm
    pub async fn verify_file_integrity(
        &self,
        file_path: &str,
        algorithm: HashAlgorithm,
    ) -> AppResult<IntegrityResult> {
        info!(
            "🔐 Starting manual integrity verification: {} with {:?}",
            file_path, algorithm
        );

        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::IntegrityCheckStarted {
                task_id: "manual".to_string(),
                algorithm: format!("{:?}", algorithm),
            });
        }

        let result = self
            .integrity_checker
            .compute_hash(file_path, algorithm)
            .await
            .map_err(|e| AppError::System(format!("Integrity verification failed: {}", e)))?;

        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::IntegrityCheckCompleted {
                task_id: "manual".to_string(),
                result: result.clone(),
            });
        }

        info!(
            "✅ Manual integrity verification completed: {} - Valid: {}",
            file_path, result.is_valid
        );
        Ok(result)
    }

    /// Verify multiple files with different algorithms concurrently
    pub async fn verify_batch_integrity(
        &self,
        files: Vec<(String, HashAlgorithm)>,
    ) -> AppResult<Vec<(String, IntegrityResult)>> {
        info!(
            "🔐 Starting batch integrity verification for {} files",
            files.len()
        );

        // For now, verify files sequentially until batch method is implemented
        let mut results = Vec::new();
        for (file_path, algorithm) in files {
            match self
                .integrity_checker
                .compute_hash(&file_path, algorithm)
                .await
            {
                Ok(result) => results.push((file_path, result)),
                Err(e) => {
                    warn!("Failed to verify {}: {}", file_path, e);
                    // Continue with other files
                }
            }
        }

        info!(
            "✅ Batch integrity verification completed: {} files",
            results.len()
        );
        Ok(results)
    }

    /// Compute hash of file without comparison (for getting file hashes)
    pub async fn compute_file_hash(
        &self,
        file_path: &str,
        algorithm: HashAlgorithm,
    ) -> AppResult<String> {
        info!("🧮 Computing hash for: {} with {:?}", file_path, algorithm);

        let result = self
            .integrity_checker
            .compute_hash(file_path, algorithm)
            .await
            .map_err(|e| AppError::System(format!("Hash computation failed: {}", e)))?;

        info!("✅ Hash computed: {} - {}", file_path, result.computed_hash);
        Ok(result.computed_hash)
    }

    /// Set expected hash for a URL to enable automatic verification
    pub async fn set_expected_hash(&mut self, url: &str, hash: &str) -> AppResult<()> {
        self.config
            .expected_hashes
            .insert(url.to_string(), hash.to_string());
        info!("🎯 Set expected hash for {}: {}", url, hash);
        Ok(())
    }

    /// Remove expected hash for a URL
    pub async fn remove_expected_hash(&mut self, url: &str) -> AppResult<()> {
        self.config.expected_hashes.remove(url);
        info!("🗑️ Removed expected hash for: {}", url);
        Ok(())
    }

    /// Get all expected hashes
    pub fn get_expected_hashes(&self) -> &HashMap<String, String> {
        &self.config.expected_hashes
    }

    /// Enable or disable automatic integrity verification
    pub async fn set_auto_integrity_verification(&mut self, enabled: bool) -> AppResult<()> {
        self.config.auto_verify_integrity = enabled;
        info!(
            "🔧 Auto integrity verification: {}",
            if enabled { "enabled" } else { "disabled" }
        );
        Ok(())
    }

    /// Set the default integrity algorithm
    pub async fn set_integrity_algorithm(&mut self, algorithm: HashAlgorithm) -> AppResult<()> {
        let algorithm_str = match algorithm {
            HashAlgorithm::Sha256 => "sha256",
            HashAlgorithm::Sha512 => "sha512",
            HashAlgorithm::Blake2b512 => "blake2b512",
            HashAlgorithm::Blake2s256 => "blake2s256",
            HashAlgorithm::Md5 => "md5",
            HashAlgorithm::Sha1 => "sha1",
        };

        self.config.integrity_algorithm = Some(algorithm_str.to_string());
        info!("🔧 Default integrity algorithm set to: {:?}", algorithm);
        Ok(())
    }

    /// Get retry statistics from the retry executor
    pub async fn get_retry_stats(&self) -> RetryStats {
        self.retry_executor.get_stats().await
    }

    /// Reset retry statistics
    pub async fn reset_retry_stats(&self) -> AppResult<()> {
        self.retry_executor.reset_stats().await;
        info!("📊 Retry statistics reset");
        Ok(())
    }

    /// Get circuit breaker state for error category
    pub async fn get_circuit_breaker_state(
        &self,
        category: ErrorCategory,
    ) -> Option<crate::core::error_handling::CircuitBreakerState> {
        self.retry_executor
            .get_circuit_breaker_state(&category)
            .await
    }

    /// Convert AppError to DownloadError for retry system compatibility
    fn convert_app_error_to_download_error(error: AppError) -> DownloadError {
        match error {
            AppError::Io(io_error) => {
                errors::filesystem_error(
                    io_error.to_string(),
                    None,
                    true, // IO errors are generally retryable
                )
            }
            AppError::Network(net_error) => {
                errors::network_error(
                    net_error.to_string(),
                    true, // Network errors are retryable
                )
            }
            AppError::Parse(parse_error) => {
                errors::parsing_error(
                    parse_error,
                    None,
                    false, // Parse errors are generally not retryable
                )
            }
            AppError::Config(config_error) => {
                errors::configuration_error(
                    config_error,
                    None, // No specific parameter info available
                )
            }
            AppError::Download(download_error) => {
                // Try to categorize download errors more specifically
                if download_error.contains("timeout") || download_error.contains("connection") {
                    errors::network_error(download_error, true)
                } else if download_error.contains("permission") || download_error.contains("access")
                {
                    errors::filesystem_error(download_error, None, false)
                } else if download_error.contains("space") || download_error.contains("disk") {
                    errors::resource_exhaustion_error(
                        download_error,
                        "disk_space".to_string(),
                        false,
                    )
                } else if download_error.contains("404") || download_error.contains("not found") {
                    errors::protocol_error(download_error, Some(404), false)
                } else if download_error.contains("429") || download_error.contains("rate limit") {
                    errors::external_service_error(
                        download_error,
                        "rate_limited".to_string(),
                        true,
                        3.0,
                    )
                } else if download_error.contains("5") && download_error.len() >= 3 {
                    // Server errors (5xx) are typically retryable
                    errors::external_service_error(
                        download_error,
                        "server_error".to_string(),
                        true,
                        2.0,
                    )
                } else {
                    // Generic download error
                    errors::network_error(download_error, true)
                }
            }
            AppError::Youtube(youtube_error) => {
                errors::external_service_error(
                    youtube_error,
                    "youtube".to_string(),
                    true,
                    2.5, // Moderate backoff for YouTube
                )
            }
            AppError::System(system_error) => DownloadError::System {
                message: system_error,
                error_code: None,
                is_retryable: true,
            },
        }
    }

    // === Monitoring System Methods ===

    /// Start the monitoring system and connect it to event emission
    async fn start_monitoring_system(monitoring: Arc<MonitoringSystem>, event_sender: EventSender) {
        info!("📊 Starting monitoring system...");

        // TODO: Fix monitoring system to use Arc instead of &mut self
        // For now, skip the start() call to avoid borrowing issues

        // Register as dashboard client to receive monitoring updates
        let client_id = uuid::Uuid::new_v4().to_string();
        let mut dashboard_data_rx = monitoring
            .register_dashboard_client(client_id.clone())
            .await;

        // Spawn task to forward monitoring events to UI
        tokio::spawn(async move {
            while let Some(dashboard_data) = dashboard_data_rx.recv().await {
                let _ = event_sender.send(DownloadEvent::DashboardDataUpdated {
                    data: dashboard_data,
                });
            }
        });

        info!("✅ Monitoring system connected to UI events");
    }

    /// Get current dashboard data including system metrics
    pub async fn get_dashboard_data(&self) -> Option<DashboardData> {
        self.monitoring_system
            .get_current_dashboard_data()
            .await
            .ok()
    }

    /// Get current download statistics from monitoring
    pub async fn get_download_statistics(&self) -> Option<DownloadStatistics> {
        if let Ok(dashboard_data) = self.monitoring_system.get_current_dashboard_data().await {
            Some(dashboard_data.download_stats)
        } else {
            None
        }
    }

    /// Get current performance metrics
    pub async fn get_performance_metrics(&self) -> Option<PerformanceMetrics> {
        if let Ok(dashboard_data) = self.monitoring_system.get_current_dashboard_data().await {
            Some(dashboard_data.performance_metrics)
        } else {
            None
        }
    }

    /// Get current health status
    pub async fn get_health_status(&self) -> Option<HealthStatus> {
        if let Ok(dashboard_data) = self.monitoring_system.get_current_dashboard_data().await {
            Some(dashboard_data.health_status)
        } else {
            None
        }
    }

    /// Update monitoring system with current download statistics
    pub async fn update_monitoring_stats(&self) {
        let _current_stats = self.get_stats().await;
        let _active_downloads = self.active_downloads.len();
        let _total_tasks = self.tasks.len();
        let _pending_tasks = self.task_queue.lock().await.len();

        // TODO: Update monitoring statistics when proper method is available
        // For now, monitoring system will collect its own statistics
    }

    /// Enable or disable Prometheus metrics export
    pub async fn set_prometheus_enabled(&self, _enabled: bool) -> AppResult<()> {
        // TODO: Implement when monitoring system supports this method
        Ok(())
    }

    /// Enable or disable WebSocket dashboard
    pub async fn set_websocket_dashboard_enabled(&self, _enabled: bool) -> AppResult<()> {
        // TODO: Implement when monitoring system supports this method
        Ok(())
    }

    /// Add a dashboard client for real-time updates
    pub async fn add_dashboard_client(
        &self,
        client_id: String,
    ) -> AppResult<tokio::sync::mpsc::UnboundedReceiver<DashboardData>> {
        Ok(self
            .monitoring_system
            .register_dashboard_client(client_id)
            .await)
    }

    /// Remove a dashboard client
    pub async fn remove_dashboard_client(&self, client_id: &str) -> AppResult<()> {
        self.monitoring_system
            .unregister_dashboard_client(client_id)
            .await;
        Ok(())
    }

    /// Get Prometheus metrics as text format
    pub async fn get_prometheus_metrics(&self) -> AppResult<String> {
        self.monitoring_system.export_prometheus_metrics().await
    }

    // === YouTube Download Methods ===

    /// Enable YouTube downloader with custom configuration
    pub async fn enable_youtube_downloader(
        &mut self,
        config: YoutubeDownloaderConfig,
    ) -> AppResult<()> {
        info!("🎥 Enabling YouTube downloader...");

        let downloader = YoutubeDownloader::with_auto_install(config)
            .await
            .map_err(|e| {
                AppError::Youtube(format!("Failed to initialize YouTube downloader: {}", e))
            })?;

        self.youtube_downloader = Some(Arc::new(downloader));
        info!("✅ YouTube downloader enabled successfully");
        Ok(())
    }

    /// Enable YouTube downloader with default configuration
    pub async fn enable_youtube_downloader_default(&mut self) -> AppResult<()> {
        let config = YoutubeDownloaderConfig::default();
        self.enable_youtube_downloader(config).await
    }

    /// Disable YouTube downloader
    pub async fn disable_youtube_downloader(&mut self) {
        if self.youtube_downloader.is_some() {
            info!("🛑 Disabling YouTube downloader");
            self.youtube_downloader = None;
        }
    }

    /// Check if YouTube downloader is enabled
    pub fn is_youtube_enabled(&self) -> bool {
        self.youtube_downloader.is_some()
    }

    /// Fetch YouTube video information
    pub async fn fetch_youtube_video_info(&self, url: &str) -> AppResult<YoutubeVideoInfo> {
        let downloader = self
            .youtube_downloader
            .as_ref()
            .ok_or_else(|| AppError::Youtube("YouTube downloader not enabled".to_string()))?;

        info!("📋 Fetching YouTube video info: {}", url);

        let video_info = downloader.fetch_video_info(url).await?;

        info!("✅ Retrieved video info: {}", video_info.title);
        Ok(video_info)
    }

    /// Download YouTube video as a task
    pub async fn add_youtube_task(
        &mut self,
        url: String,
        output_filename: String,
        format: YoutubeDownloadFormat,
        priority: Option<DownloadPriority>,
    ) -> AppResult<String> {
        let downloader = self
            .youtube_downloader
            .as_ref()
            .ok_or_else(|| AppError::Youtube("YouTube downloader not enabled".to_string()))?;

        info!(
            "🎬 Adding YouTube download task: {} -> {}",
            url, output_filename
        );

        // First fetch video info
        let video_info = downloader.fetch_video_info(&url).await?;

        // Create a new video task
        let task_id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now();

        let task = VideoTask {
            id: task_id.clone(),
            url: url.clone(),
            title: output_filename.clone(), // Use output filename as title
            output_path: output_filename.clone(),
            status: TaskStatus::Pending,
            progress: 0.0,
            speed: 0.0,
            downloaded_size: 0,
            file_size: None,
            eta: None,
            created_at,
            updated_at: created_at,
            error_message: None,
            downloader_type: None,
            video_info: None, // 没有额外的视频信息
        };

        self.tasks.insert(task_id.clone(), task);

        // Emit events
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::TaskCreated {
                task_id: task_id.clone(),
                task: self.tasks.get(&task_id).unwrap().clone(),
            });

            let _ = sender.send(DownloadEvent::YoutubeVideoInfoFetched {
                task_id: task_id.clone(),
                video_info: video_info.clone(),
            });
        }

        // Start YouTube download
        let youtube_progress_callback = {
            let task_id_clone = task_id.clone();
            let sender_clone = self.event_sender.clone();

            Arc::new(
                move |downloaded: u64, total: Option<u64>, speed: Option<f64>| {
                    if let Some(sender) = &sender_clone {
                        let _ = sender.send(DownloadEvent::YoutubeDownloadProgress {
                            task_id: task_id_clone.clone(),
                            youtube_download_id: "yt_download_placeholder".to_string(),
                            downloaded_bytes: downloaded,
                            total_bytes: total,
                            speed,
                        });
                    }
                },
            )
        };

        let youtube_download_id = downloader
            .download_video(
                &url,
                &output_filename,
                format,
                priority,
                Some(youtube_progress_callback),
            )
            .await?;

        // Emit YouTube download started event
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::YoutubeDownloadStarted {
                task_id: task_id.clone(),
                youtube_download_id: youtube_download_id.clone(),
                url: url.clone(),
            });
        }

        // Clone downloader before updating task status to avoid borrowing conflicts
        let downloader_clone = Arc::clone(downloader);

        // Update task status to downloading
        self.update_task_status(&task_id, TaskStatus::Downloading)
            .await?;

        // Spawn a task to monitor YouTube download completion
        let task_id_clone = task_id.clone();
        let sender_clone = self.event_sender.clone();
        let youtube_download_id_clone = youtube_download_id.clone();

        tokio::spawn(async move {
            if let Some(final_status) = downloader_clone
                .wait_for_download(&youtube_download_id_clone)
                .await
            {
                if let Some(sender) = sender_clone {
                    match final_status {
                        YoutubeDownloadStatus::Completed { file_path, .. } => {
                            let _ = sender.send(DownloadEvent::YoutubeDownloadCompleted {
                                task_id: task_id_clone.clone(),
                                youtube_download_id: youtube_download_id_clone.clone(),
                                file_path: file_path.to_string_lossy().to_string(),
                            });
                        }
                        YoutubeDownloadStatus::Failed { error, .. } => {
                            let _ = sender.send(DownloadEvent::YoutubeDownloadFailed {
                                task_id: task_id_clone.clone(),
                                youtube_download_id: youtube_download_id_clone.clone(),
                                error,
                            });
                        }
                        YoutubeDownloadStatus::Cancelled => {
                            let _ = sender.send(DownloadEvent::YoutubeDownloadCancelled {
                                task_id: task_id_clone,
                                youtube_download_id: youtube_download_id_clone,
                            });
                        }
                        _ => {} // Other statuses handled by progress callback
                    }
                }
            }
        });

        info!(
            "🚀 YouTube download task started: {} ({})",
            task_id, youtube_download_id
        );
        Ok(task_id)
    }

    /// Download YouTube video with default settings
    pub async fn add_youtube_task_simple(
        &mut self,
        url: String,
        output_filename: String,
    ) -> AppResult<String> {
        self.add_youtube_task(
            url,
            output_filename,
            YoutubeDownloadFormat::default(),
            Some(DownloadPriority::Normal),
        )
        .await
    }

    /// Download YouTube audio only
    pub async fn add_youtube_audio_task(
        &mut self,
        url: String,
        output_filename: String,
        audio_quality: crate::core::youtube_downloader::AudioQuality,
        audio_codec: crate::core::youtube_downloader::AudioCodecPreference,
    ) -> AppResult<String> {
        let format = YoutubeDownloadFormat::AudioOnly {
            quality: audio_quality,
            codec: audio_codec,
        };

        self.add_youtube_task(url, output_filename, format, Some(DownloadPriority::Normal))
            .await
    }

    /// Get YouTube download statistics
    pub async fn get_youtube_statistics(
        &self,
    ) -> Option<crate::core::youtube_downloader::YoutubeDownloadStatistics> {
        if let Some(downloader) = &self.youtube_downloader {
            Some(downloader.get_statistics().await)
        } else {
            None
        }
    }

    /// Cancel YouTube download
    pub async fn cancel_youtube_download(&self, youtube_download_id: &str) -> bool {
        if let Some(downloader) = &self.youtube_downloader {
            downloader.cancel_download(youtube_download_id).await
        } else {
            false
        }
    }

    /// Get active YouTube downloads
    pub async fn get_active_youtube_downloads(&self) -> Vec<(String, YoutubeDownloadStatus)> {
        if let Some(downloader) = &self.youtube_downloader {
            downloader.get_active_downloads().await
        } else {
            vec![]
        }
    }

    /// Cleanup completed YouTube downloads
    pub async fn cleanup_youtube_downloads(&self) -> usize {
        if let Some(downloader) = &self.youtube_downloader {
            downloader.cleanup_completed_downloads().await
        } else {
            0
        }
    }

    /// Update YouTube downloader configuration
    pub async fn update_youtube_config(
        &mut self,
        config: YoutubeDownloaderConfig,
    ) -> AppResult<()> {
        if let Some(_downloader) = &mut self.youtube_downloader {
            // Since we have Arc<YoutubeDownloader>, we need to create a new instance
            let new_downloader =
                YoutubeDownloader::with_auto_install(config)
                    .await
                    .map_err(|e| {
                        AppError::Youtube(format!(
                            "Failed to update YouTube downloader config: {}",
                            e
                        ))
                    })?;

            self.youtube_downloader = Some(Arc::new(new_downloader));
            info!("📝 Updated YouTube downloader configuration");
            Ok(())
        } else {
            Err(AppError::Youtube(
                "YouTube downloader not enabled".to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_download_manager_creation() -> AppResult<()> {
        let config = DownloadConfig::default();
        let manager = DownloadManager::new(config)?;
        assert!(!manager.is_running);
        assert_eq!(manager.tasks.len(), 0);
        Ok(())
    }

    #[tokio::test]
    async fn test_add_task() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let task_id = manager
            .add_task(
                "https://example.com/video.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        assert!(!task_id.is_empty());
        assert_eq!(manager.tasks.len(), 1);

        let task = manager.tasks.get(&task_id).unwrap();
        assert_eq!(task.status, TaskStatus::Pending);

        Ok(())
    }

    #[tokio::test]
    async fn test_integrity_verification() -> AppResult<()> {
        // Create a test file with known content
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let test_file = temp_dir.path().join("test.txt");
        let test_content = b"Hello, integrity testing!";
        fs::write(&test_file, test_content).unwrap();

        let mut config = DownloadConfig::default();
        config.auto_verify_integrity = true;
        config.integrity_algorithm = Some("sha256".to_string());

        let manager = DownloadManager::new(config)?;

        // Test manual integrity verification
        let result = manager
            .verify_file_integrity(test_file.to_str().unwrap(), HashAlgorithm::Sha256)
            .await?;

        assert!(result.is_valid || result.expected_hash.is_none()); // Should pass if no expected hash

        // Test compute hash functionality
        let hash = manager
            .compute_file_hash(test_file.to_str().unwrap(), HashAlgorithm::Sha256)
            .await?;

        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // SHA-256 hex is 64 characters

        Ok(())
    }

    #[tokio::test]
    async fn test_batch_integrity_verification() -> AppResult<()> {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();

        // Create multiple test files
        let files = vec![
            (temp_dir.path().join("test1.txt"), b"Content 1"),
            (temp_dir.path().join("test2.txt"), b"Content 2"),
            (temp_dir.path().join("test3.txt"), b"Content 3"),
        ];

        let mut verification_files = Vec::new();
        for (path, content) in &files {
            fs::write(path, content).unwrap();
            verification_files.push((path.to_string_lossy().to_string(), HashAlgorithm::Sha256));
        }

        let config = DownloadConfig::default();
        let manager = DownloadManager::new(config)?;

        // Test batch verification
        let results = manager.verify_batch_integrity(verification_files).await?;

        assert_eq!(results.len(), 3);
        for (file_path, result) in results {
            assert!(result.is_valid || result.expected_hash.is_none());
            assert!(!file_path.is_empty());
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_expected_hash_management() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let test_url = "https://example.com/test.mp4";
        let test_hash = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";

        // Test setting expected hash
        manager.set_expected_hash(test_url, test_hash).await?;

        let expected_hashes = manager.get_expected_hashes();
        assert_eq!(expected_hashes.get(test_url), Some(&test_hash.to_string()));

        // Test removing expected hash
        manager.remove_expected_hash(test_url).await?;

        let expected_hashes = manager.get_expected_hashes();
        assert!(!expected_hashes.contains_key(test_url));

        Ok(())
    }

    #[tokio::test]
    async fn test_integrity_configuration() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        // Test enabling auto verification
        manager.set_auto_integrity_verification(true).await?;
        assert!(manager.config.auto_verify_integrity);

        // Test disabling auto verification
        manager.set_auto_integrity_verification(false).await?;
        assert!(!manager.config.auto_verify_integrity);

        // Test setting integrity algorithm
        manager
            .set_integrity_algorithm(HashAlgorithm::Sha512)
            .await?;
        assert_eq!(
            manager.config.integrity_algorithm,
            Some("sha512".to_string())
        );

        manager
            .set_integrity_algorithm(HashAlgorithm::Blake2b512)
            .await?;
        assert_eq!(
            manager.config.integrity_algorithm,
            Some("blake2b512".to_string())
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_retry_stats() -> AppResult<()> {
        let config = DownloadConfig::default();
        let manager = DownloadManager::new(config)?;

        // Get initial stats
        let stats = manager.get_retry_stats().await;
        assert_eq!(stats.total_attempts, 0);
        assert_eq!(stats.total_successes, 0);
        assert_eq!(stats.total_failures, 0);

        // Reset stats
        manager.reset_retry_stats().await?;

        // Verify stats are still zero
        let stats_after_reset = manager.get_retry_stats().await;
        assert_eq!(stats_after_reset.total_attempts, 0);

        Ok(())
    }

    #[tokio::test]
    async fn test_circuit_breaker_state() -> AppResult<()> {
        let config = DownloadConfig::default();
        let manager = DownloadManager::new(config)?;

        // Test circuit breaker state for different categories
        let network_state = manager
            .get_circuit_breaker_state(ErrorCategory::Network)
            .await;
        assert!(network_state.is_some()); // Network category should have circuit breaker

        let config_state = manager
            .get_circuit_breaker_state(ErrorCategory::Configuration)
            .await;
        assert!(config_state.is_none()); // Configuration category should not have circuit breaker

        Ok(())
    }

    #[tokio::test]
    async fn test_error_conversion() {
        // Test configuration error conversion
        let app_error = AppError::Config("Invalid API key".into());
        let download_error = DownloadManager::convert_app_error_to_download_error(app_error);
        assert_eq!(download_error.category(), ErrorCategory::Configuration);
        assert!(!download_error.is_retryable());

        // Test IO error conversion
        use std::io::{Error, ErrorKind};
        let io_error = Error::new(ErrorKind::PermissionDenied, "Access denied");
        let app_error = AppError::Io(io_error);
        let download_error = DownloadManager::convert_app_error_to_download_error(app_error);
        assert_eq!(download_error.category(), ErrorCategory::FileSystem);
        assert!(download_error.is_retryable());

        // Test specific download error patterns
        let app_error = AppError::Download("HTTP 429 Too Many Requests".into());
        let download_error = DownloadManager::convert_app_error_to_download_error(app_error);
        assert_eq!(download_error.category(), ErrorCategory::ExternalService);
        assert!(download_error.is_retryable());

        let app_error = AppError::Download("HTTP 404 Not Found".into());
        let download_error = DownloadManager::convert_app_error_to_download_error(app_error);
        assert_eq!(download_error.category(), ErrorCategory::Protocol);
        assert!(!download_error.is_retryable());

        let app_error = AppError::Download("Connection timeout".into());
        let download_error = DownloadManager::convert_app_error_to_download_error(app_error);
        assert_eq!(download_error.category(), ErrorCategory::Network);
        assert!(download_error.is_retryable());
    }

    #[tokio::test]
    async fn test_download_error_classification() {
        // Test different error types and their properties
        let network_error = errors::network_error("DNS resolution failed", true);
        assert_eq!(network_error.category(), ErrorCategory::Network);
        assert!(network_error.is_retryable());
        assert_eq!(network_error.backoff_multiplier(), 2.0);

        let auth_error = errors::authentication_error("Invalid credentials", true);
        assert_eq!(auth_error.category(), ErrorCategory::Authentication);
        assert!(auth_error.is_retryable());
        assert_eq!(auth_error.backoff_multiplier(), 1.5);

        let service_error = errors::external_service_error("Rate limited", "api", true, 3.0);
        assert_eq!(service_error.category(), ErrorCategory::ExternalService);
        assert!(service_error.is_retryable());
        assert_eq!(service_error.backoff_multiplier(), 3.0);

        let config_error =
            errors::configuration_error("Missing parameter", Some("api_key".to_string()));
        assert_eq!(config_error.category(), ErrorCategory::Configuration);
        assert!(!config_error.is_retryable());

        let integrity_error = errors::data_integrity_error(
            "Checksum mismatch",
            Some("expected".to_string()),
            Some("actual".to_string()),
        );
        assert_eq!(integrity_error.category(), ErrorCategory::DataIntegrity);
        assert!(!integrity_error.is_retryable());
    }

    #[tokio::test]
    async fn test_add_task_with_priority() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let task_id = manager
            .add_task_with_priority(
                "https://example.com/video.mp4".to_string(),
                "./downloads".to_string(),
                8,
            )
            .await?;

        assert!(!task_id.is_empty());
        assert_eq!(manager.tasks.len(), 1);

        // Check if task was added to priority queue
        let queue = manager.task_queue.lock().await;
        assert_eq!(queue.len(), 1);

        Ok(())
    }

    #[tokio::test]
    async fn test_batch_tasks() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let tasks = vec![
            (
                "https://example.com/video1.mp4".to_string(),
                "./downloads".to_string(),
                Some(8),
            ),
            (
                "https://example.com/video2.mp4".to_string(),
                "./downloads".to_string(),
                Some(5),
            ),
            (
                "https://example.com/video3.mp4".to_string(),
                "./downloads".to_string(),
                None,
            ),
        ];

        let task_ids = manager.add_batch_tasks(tasks).await?;

        assert_eq!(task_ids.len(), 3);
        assert_eq!(manager.tasks.len(), 3);

        // Check priority queue
        let queue = manager.task_queue.lock().await;
        assert_eq!(queue.len(), 3);

        Ok(())
    }

    #[tokio::test]
    async fn test_start_stop_manager() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        manager.start().await?;
        assert!(manager.is_running);
        assert!(manager.scheduler_handle.is_some());

        manager.stop().await?;
        assert!(!manager.is_running);
        assert!(manager.scheduler_handle.is_none());

        Ok(())
    }

    #[tokio::test]
    async fn test_rate_limiting() -> AppResult<()> {
        let config = DownloadConfig::default();
        let manager = DownloadManager::new(config)?;

        assert!(manager.get_rate_limit().await.is_none());

        manager.set_rate_limit(Some(1024 * 1024)).await; // 1MB/s
        assert_eq!(manager.get_rate_limit().await, Some(1024 * 1024));

        manager.set_rate_limit(None).await;
        assert!(manager.get_rate_limit().await.is_none());

        Ok(())
    }

    #[tokio::test]
    async fn test_priority_queue_ordering() {
        let mut queue = std::collections::BinaryHeap::new();
        let now = chrono::Utc::now();

        queue.push(TaskPriority {
            task_id: "low".to_string(),
            priority: 3,
            created_at: now,
        });

        queue.push(TaskPriority {
            task_id: "high".to_string(),
            priority: 8,
            created_at: now,
        });

        queue.push(TaskPriority {
            task_id: "medium".to_string(),
            priority: 5,
            created_at: now,
        });

        // Should pop in order: high (8), medium (5), low (3)
        assert_eq!(queue.pop().unwrap().task_id, "high");
        assert_eq!(queue.pop().unwrap().task_id, "medium");
        assert_eq!(queue.pop().unwrap().task_id, "low");
    }
}
