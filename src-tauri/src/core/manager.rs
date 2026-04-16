//! Download Manager - Core business logic for managing video downloads
//!
//! This module provides the main DownloadManager that orchestrates all download operations,
//! manages concurrent downloads, and handles progress tracking and event emission.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::core::config::AppConfig;
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

use crate::core::progress_tracker::{EnhancedProgressStats, ProgressTrackingManager};
use crate::core::youtube_downloader::{
    DownloadPriority, YoutubeDownloadFormat, YoutubeDownloadStatus, YoutubeDownloader,
    YoutubeDownloaderConfig, YoutubeVideoInfo,
};
use crate::utils::file_utils::sanitize_filename;

/// Events that can be emitted by the download manager
#[allow(clippy::large_enum_variant)]
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
    TaskCommitting {
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

#[derive(Debug, Clone)]
pub struct AddVideoTaskResult {
    pub task: VideoTask,
    pub created: bool,
}

#[derive(Debug)]
enum DownloadOutcome {
    Completed(String),
    Paused,
    Cancelled,
}

/// Channel for communication between download manager and UI
pub type EventSender = mpsc::UnboundedSender<DownloadEvent>;
pub type EventReceiver = mpsc::UnboundedReceiver<DownloadEvent>;

/// Priority queue for task scheduling
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.created_at.cmp(&self.created_at))
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
    /// Current logical semaphore capacity (total permits)
    semaphore_capacity: usize,
    /// Deferred reductions that could not be applied immediately
    pending_semaphore_reduction: usize,

    /// HTTP downloader instance
    http_downloader: Arc<HttpDownloader>,

    /// Priority queue for pending tasks
    task_queue: Arc<Mutex<std::collections::BinaryHeap<TaskPriority>>>,
    /// Whether queue processing is paused (global pause)
    queue_paused: bool,
    /// Persisted state file path
    state_path: PathBuf,
    /// Whether persistence is enabled for this manager instance
    persistence_enabled: bool,

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

    /// Per-task lifecycle timing snapshots for transfer/commit observability
    task_lifecycle_timings: HashMap<String, TaskLifecycleTiming>,

    /// Aggregated lifecycle metrics derived from completed/failed tasks
    lifecycle_metrics: DownloadLifecycleMetrics,

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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PersistedManagerState {
    tasks: Vec<VideoTask>,
    queue: Vec<TaskPriority>,
    queue_paused: bool,
}

#[derive(Debug, Clone)]
struct TaskLifecycleTiming {
    transfer_started_at: chrono::DateTime<chrono::Utc>,
    commit_started_at: Option<chrono::DateTime<chrono::Utc>>,
    finished_at: Option<chrono::DateTime<chrono::Utc>>,
    final_status: Option<TaskStatus>,
}

#[derive(Debug, Clone, Default)]
struct DownloadLifecycleMetrics {
    transfer_duration_secs: Vec<f64>,
    commit_duration_secs: Vec<f64>,
    total_duration_secs: Vec<f64>,
    peak_download_speed_bps: f64,
    failed_commit_count: u64,
    commit_warning_count: u64,
    commit_elevated_warning_count: u64,
}

impl DownloadManager {
    /// Create a new download manager with the given configuration
    pub fn new(config: DownloadConfig) -> AppResult<Self> {
        let state_path = Self::default_state_path()?;
        let persistence_enabled = !cfg!(test);
        Self::new_with_state_path_and_persistence(config, state_path, persistence_enabled)
    }

    /// Create a new download manager with an explicit state path (useful for tests)
    pub fn new_with_state_path(config: DownloadConfig, state_path: PathBuf) -> AppResult<Self> {
        Self::new_with_state_path_and_persistence(config, state_path, true)
    }

    fn new_with_state_path_and_persistence(
        config: DownloadConfig,
        state_path: PathBuf,
        persistence_enabled: bool,
    ) -> AppResult<Self> {
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

        let mut manager = Self {
            config,
            tasks: HashMap::new(),
            active_downloads: HashMap::new(),
            event_sender: None,
            stats: ModelsDownloadStats::default(),
            download_semaphore: Arc::new(tokio::sync::Semaphore::new(concurrent_downloads)),
            semaphore_capacity: concurrent_downloads,
            pending_semaphore_reduction: 0,
            http_downloader: Arc::new(http_downloader),
            task_queue: Arc::new(Mutex::new(std::collections::BinaryHeap::new())),
            queue_paused: false,
            state_path,
            persistence_enabled,
            rate_limit: rate_limit_handle,
            is_running: false,
            progress_tracker: Arc::new(ProgressTrackingManager::new()),
            integrity_checker: Arc::new(integrity_checker),
            retry_executor: Arc::new(retry_executor),
            task_lifecycle_timings: HashMap::new(),
            lifecycle_metrics: DownloadLifecycleMetrics::default(),
            youtube_downloader: None, // Initialize as None, can be enabled later
            scheduler_handle: None,
        };

        if let Err(err) = manager.load_persisted_state() {
            warn!("Failed to load persisted manager state: {}", err);
        }

        Ok(manager)
    }

    fn default_state_path() -> AppResult<PathBuf> {
        let data_dir = AppConfig::get_data_dir()
            .map_err(|e| AppError::System(format!("Failed to get data dir: {}", e)))?;
        Ok(data_dir.join("download_state.json"))
    }

    fn load_persisted_state(&mut self) -> AppResult<()> {
        if !self.persistence_enabled {
            return Ok(());
        }
        if !self.state_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&self.state_path).map_err(|e| {
            AppError::System(format!(
                "Failed to read persisted state {:?}: {}",
                self.state_path, e
            ))
        })?;
        let mut state: PersistedManagerState = serde_json::from_str(&content).map_err(|e| {
            AppError::System(format!(
                "Failed to parse persisted state {:?}: {}",
                self.state_path, e
            ))
        })?;

        self.tasks = state
            .tasks
            .drain(..)
            .map(|task| (task.id.clone(), task))
            .collect();

        // Convert downloading -> pending on startup so it can be resumed
        let mut queue = std::collections::BinaryHeap::new();
        for (_, task) in self.tasks.iter_mut() {
            if task.status == TaskStatus::Downloading {
                // To avoid API storms on startup, do not downgrade to pending and auto-queue.
                // Safely mark as paused instead.
                task.status = TaskStatus::Paused;
                task.paused_from_active = true;
                task.updated_at = chrono::Utc::now();
            }
        }

        for item in state.queue.into_iter() {
            if let Some(task) = self.tasks.get(&item.task_id) {
                if task.status == TaskStatus::Pending {
                    queue.push(item);
                }
            }
        }

        // Ensure all pending tasks are queued at least once
        for task_id in self
            .tasks
            .iter()
            .filter(|(_, task)| task.status == TaskStatus::Pending)
            .map(|(id, _)| id.clone())
        {
            if !queue.iter().any(|item| item.task_id == task_id) {
                queue.push(TaskPriority {
                    task_id,
                    priority: 5,
                    created_at: chrono::Utc::now(),
                });
            }
        }
        let queued_count = queue.len();

        if let Ok(mut queue_guard) = self.task_queue.try_lock() {
            *queue_guard = queue;
        } else {
            let mut queue_guard = self.task_queue.blocking_lock();
            *queue_guard = queue;
        }

        self.queue_paused = state.queue_paused;
        self.recompute_stats();
        info!(
            "Loaded persisted manager state from {:?}: total={}, pending={}, paused={}, failed={}, completed={}, queued={}, queue_paused={}",
            self.state_path,
            self.tasks.len(),
            self.tasks
                .values()
                .filter(|task| task.status == TaskStatus::Pending)
                .count(),
            self.tasks
                .values()
                .filter(|task| task.status == TaskStatus::Paused)
                .count(),
            self.tasks
                .values()
                .filter(|task| task.status == TaskStatus::Failed)
                .count(),
            self.tasks
                .values()
                .filter(|task| task.status == TaskStatus::Completed)
                .count(),
            queued_count,
            self.queue_paused
        );
        Ok(())
    }

    async fn persist_state(&self) -> AppResult<()> {
        if !self.persistence_enabled {
            return Ok(());
        }

        if let Some(parent) = self.state_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::System(format!("Failed to create data dir: {}", e)))?;
        }

        let queue_items = {
            let queue = self.task_queue.lock().await;
            queue.iter().cloned().collect::<Vec<_>>()
        };

        let state = PersistedManagerState {
            tasks: self.tasks.values().cloned().collect(),
            queue: queue_items,
            queue_paused: self.queue_paused,
        };

        let json = serde_json::to_string_pretty(&state)
            .map_err(|e| AppError::System(format!("Failed to serialize persisted state: {}", e)))?;

        fs::write(&self.state_path, json)
            .await
            .map_err(|e| AppError::System(format!("Failed to write persisted state: {}", e)))
    }

    fn recompute_stats(&mut self) {
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

        let average_speed = if current_speeds.is_empty() {
            0.0
        } else {
            current_speeds.iter().sum::<f64>() / current_speeds.len() as f64
        };
        let display_total_speed_bps = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Downloading)
            .map(|t| t.display_speed_bps)
            .sum();
        let average_transfer_duration =
            Self::average_metric(&self.lifecycle_metrics.transfer_duration_secs);
        let average_commit_duration =
            Self::average_metric(&self.lifecycle_metrics.commit_duration_secs);
        let p95_commit_duration =
            Self::percentile_metric(&self.lifecycle_metrics.commit_duration_secs, 0.95);

        self.stats = ModelsDownloadStats {
            total_tasks,
            completed_tasks,
            failed_tasks,
            total_downloaded,
            average_speed,
            display_total_speed_bps,
            active_downloads,
            queue_paused: self.queue_paused,
            average_transfer_duration,
            average_commit_duration,
            p95_commit_duration,
            failed_commit_count: self.lifecycle_metrics.failed_commit_count,
            commit_warning_count: self.lifecycle_metrics.commit_warning_count,
            commit_elevated_warning_count: self.lifecycle_metrics.commit_elevated_warning_count,
        };
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

        // Scheduler handle is managed by the app bootstrap.
        self.scheduler_handle = None;

        // Monitoring event forwarding is intentionally disabled for now.
        // The current frontend mainline does not consume dashboard broadcasts,
        // and the monitoring runtime itself is not started from this seam yet.

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
            self.update_task_status(&task_id, TaskStatus::Pending)
                .await?;
            let _ = self.enqueue_task(&task_id, 10).await;
        }

        self.queue_paused = false;

        self.is_running = false;
        info!("✅ Download manager stopped successfully");
        Ok(())
    }

    /// Add a new download task
    pub async fn add_task(&mut self, url: String, output_path: String) -> AppResult<String> {
        self.add_task_with_priority(url, output_path, 5).await // Default priority = 5
    }

    pub async fn update_task_output_paths(
        &mut self,
        updates: &[(String, String)],
    ) -> AppResult<Vec<VideoTask>> {
        let mut updated_tasks = Vec::with_capacity(updates.len());

        for (task_id, next_output_path) in updates {
            if self.active_downloads.contains_key(task_id) {
                return Err(AppError::Download(format!(
                    "Cannot update output path for active task: {}",
                    task_id
                )));
            }

            let task = self
                .tasks
                .get_mut(task_id)
                .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;

            if matches!(
                task.status,
                TaskStatus::Downloading
                    | TaskStatus::Committing
                    | TaskStatus::Completed
                    | TaskStatus::Cancelled
            ) {
                return Err(AppError::Download(format!(
                    "Task output path can only be changed before start or while paused/failed: {}",
                    task_id
                )));
            }

            let (output_dir, filename) =
                Self::split_output_path(&task.url, next_output_path, Some(&task.title));
            task.output_path = output_dir.clone();
            task.resolved_path = if output_dir.trim().is_empty() {
                None
            } else {
                Some(
                    Path::new(&output_dir)
                        .join(&filename)
                        .to_string_lossy()
                        .to_string(),
                )
            };
            task.updated_at = chrono::Utc::now();
            updated_tasks.push(task.clone());
        }

        if !updated_tasks.is_empty() {
            if let Err(err) = self.persist_state().await {
                warn!(
                    "Failed to persist state after updating output paths: {}",
                    err
                );
            }
        }

        Ok(updated_tasks)
    }

    pub async fn runtime_add_tasks(
        manager: &Arc<RwLock<Self>>,
        tasks: Vec<VideoTask>,
    ) -> AppResult<Vec<VideoTask>> {
        let mut manager = manager.write().await;

        let mut stored_tasks = Vec::with_capacity(tasks.len());
        for task in tasks {
            let result = manager.add_video_task(task).await?;
            stored_tasks.push(result.task);
        }

        Ok(stored_tasks)
    }

    pub async fn runtime_update_task_output_paths(
        manager: &Arc<RwLock<Self>>,
        updates: Vec<(String, String)>,
    ) -> AppResult<Vec<VideoTask>> {
        let mut manager = manager.write().await;
        manager.update_task_output_paths(&updates).await
    }

    pub async fn runtime_remove_tasks(
        manager: &Arc<RwLock<Self>>,
        task_ids: Vec<String>,
    ) -> AppResult<usize> {
        let mut manager = manager.write().await;
        let mut removed = 0usize;

        for task_id in task_ids {
            if manager.is_task_active(&task_id).await {
                manager.cancel_download(&task_id).await?;
            }
            manager.remove_task(&task_id).await?;
            removed += 1;
        }

        Ok(removed)
    }

    /// Add a complete VideoTask directly to storage and return the stored record (after hydration)
    pub async fn add_video_task(&mut self, task: VideoTask) -> AppResult<AddVideoTaskResult> {
        let mut normalized_task = task.clone();
        if let Some(resolved) = normalized_task.resolved_path.clone() {
            let resolved_path = Path::new(&resolved);
            let dir = resolved_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            normalized_task.output_path = Self::normalize_output_path(&dir);
            normalized_task.resolved_path = Some(resolved);
        } else {
            let (output_dir, filename) = Self::split_output_path(
                &normalized_task.url,
                &normalized_task.output_path,
                Some(&normalized_task.title),
            );
            normalized_task.output_path = output_dir.clone();
            normalized_task.resolved_path = if output_dir.trim().is_empty() {
                None
            } else {
                Some(
                    Path::new(&output_dir)
                        .join(&filename)
                        .to_string_lossy()
                        .to_string(),
                )
            };
        }

        if let Some(existing_id) = self.find_task_by_task_identity(&normalized_task) {
            self.refresh_task_file_state(&existing_id).await?;
            let existing =
                self.tasks.get(&existing_id).cloned().ok_or_else(|| {
                    AppError::Download("Duplicate task lookup failed".to_string())
                })?;
            return Ok(AddVideoTaskResult {
                task: existing,
                created: false,
            });
        }

        let mut stored_task = normalized_task;
        self.hydrate_existing_file_state(&mut stored_task).await?;

        self.tasks
            .insert(stored_task.id.clone(), stored_task.clone());

        if let Err(err) = self.persist_state().await {
            warn!("Failed to persist state after adding task: {}", err);
        }

        tracing::info!(
            "Added video task: {} ({})",
            stored_task.title,
            stored_task.id
        );
        Ok(AddVideoTaskResult {
            task: stored_task,
            created: true,
        })
    }

    /// Check if a URL already exists in tasks
    pub async fn has_duplicate_task(&self, url: &str, output_path: &str) -> bool {
        self.find_task_by_identity(url, output_path).is_some()
    }

    /// Add video task with duplicate checking option
    pub async fn add_video_task_with_options(
        &mut self,
        task: VideoTask,
        allow_duplicates: bool,
    ) -> AppResult<AddVideoTaskResult> {
        let mut normalized_task = task.clone();
        if let Some(resolved) = normalized_task.resolved_path.clone() {
            let resolved_path = Path::new(&resolved);
            let dir = resolved_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            normalized_task.output_path = Self::normalize_output_path(&dir);
            normalized_task.resolved_path = Some(resolved);
        } else {
            let (output_dir, filename) = Self::split_output_path(
                &normalized_task.url,
                &normalized_task.output_path,
                Some(&normalized_task.title),
            );
            normalized_task.output_path = output_dir.clone();
            normalized_task.resolved_path = if output_dir.trim().is_empty() {
                None
            } else {
                Some(
                    Path::new(&output_dir)
                        .join(&filename)
                        .to_string_lossy()
                        .to_string(),
                )
            };
        }

        // Check for duplicates if not allowing them
        if !allow_duplicates {
            if let Some(existing_id) = self.find_task_by_task_identity(&normalized_task) {
                self.refresh_task_file_state(&existing_id).await?;
                let existing = self.tasks.get(&existing_id).cloned().ok_or_else(|| {
                    AppError::Download("Duplicate task lookup failed".to_string())
                })?;
                return Ok(AddVideoTaskResult {
                    task: existing,
                    created: false,
                });
            }
        }

        let mut stored_task = normalized_task;
        self.hydrate_existing_file_state(&mut stored_task).await?;

        self.tasks
            .insert(stored_task.id.clone(), stored_task.clone());

        if let Err(err) = self.persist_state().await {
            warn!("Failed to persist state after adding task: {}", err);
        }

        tracing::info!(
            "Added video task: {} ({})",
            stored_task.title,
            stored_task.id
        );
        Ok(AddVideoTaskResult {
            task: stored_task,
            created: true,
        })
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
        let inferred_title = Self::extract_title_from_url(&url);
        let (output_dir, filename) =
            Self::split_output_path(&url, &output_path, Some(&inferred_title));
        let resolved_path = if output_dir.trim().is_empty() {
            None
        } else {
            Some(
                Path::new(&output_dir)
                    .join(&filename)
                    .to_string_lossy()
                    .to_string(),
            )
        };

        let mut task = VideoTask {
            id: task_id.clone(),
            url: url.clone(),
            title: inferred_title,
            output_path: output_dir,
            resolved_path,
            status: TaskStatus::Pending,
            progress: 0.0,
            file_size: None,
            downloaded_size: 0,
            speed: 0.0,
            display_speed_bps: 0,
            eta: None,
            error_message: None,
            created_at: now,
            updated_at: now,
            paused_at: None,
            paused_from_active: false,
            downloader_type: None,
            video_info: None, // 没有额外的视频信息
        };

        self.hydrate_existing_file_state(&mut task).await?;

        self.tasks.insert(task_id.clone(), task.clone());

        self.update_stats().await;
        if let Err(err) = self.persist_state().await {
            warn!("Failed to persist state after adding task: {}", err);
        }

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
        self.settle_pending_semaphore_reduction();
        self.reap_finished_active_downloads();
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?
            .clone();

        // 幂等防护：已在下载或句柄存在则直接返回成功
        if matches!(
            task.status,
            TaskStatus::Downloading | TaskStatus::Committing
        ) || self.active_downloads.contains_key(task_id)
        {
            let _ = self.remove_task_from_queue(task_id).await;
            return Ok(());
        }

        if task.status != TaskStatus::Pending
            && task.status != TaskStatus::Paused
            && task.status != TaskStatus::Failed
        {
            return Err(AppError::Download(format!(
                "Task {} cannot be started from status: {:?}",
                task_id, task.status
            )));
        }

        // 即使 semaphore 仍有可用 permit，也要遵守当前并发配置，避免降配后短时间超发。
        if self.active_downloads.len() >= self.config.concurrent_downloads {
            self.enqueue_task(task_id, 5).await;
            if let Some(task) = self.tasks.get_mut(task_id) {
                if task.status == TaskStatus::Failed {
                    task.status = TaskStatus::Pending;
                    task.error_message = None;
                    task.updated_at = chrono::Utc::now();
                    self.update_stats().await;
                    if let Err(err) = self.persist_state().await {
                        warn!("Failed to persist state after queueing task: {}", err);
                    }
                }
            }
            return Err(AppError::Download(
                "Maximum concurrent downloads reached".to_string(),
            ));
        }

        // Check if we can start a new download
        let permit = match self.download_semaphore.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                self.enqueue_task(task_id, 5).await;
                if let Some(task) = self.tasks.get_mut(task_id) {
                    if task.status == TaskStatus::Failed {
                        task.status = TaskStatus::Pending;
                        task.error_message = None;
                        task.updated_at = chrono::Utc::now();
                        self.update_stats().await;
                        if let Err(err) = self.persist_state().await {
                            warn!("Failed to persist state after queueing task: {}", err);
                        }
                    }
                }
                return Err(AppError::Download(
                    "Maximum concurrent downloads reached".to_string(),
                ));
            }
        };

        self.remove_task_from_queue(task_id).await;
        self.start_download_with_permit(task_id, task, permit).await
    }

    async fn start_download_with_permit(
        &mut self,
        task_id: &str,
        task: VideoTask,
        permit: tokio::sync::OwnedSemaphorePermit,
    ) -> AppResult<()> {
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.error_message = None;
            task.paused_at = None;
            task.paused_from_active = false;
            // Fresh starts with no local bytes should never carry stale 100% progress.
            if task.downloaded_size == 0 {
                task.progress = 0.0;
                task.speed = 0.0;
                task.eta = None;
            }
        }
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
        let output_path = task
            .resolved_path
            .clone()
            .unwrap_or_else(|| task.output_path.clone());
        let initial_downloaded_size = task.downloaded_size;
        let initial_file_size = task.file_size;
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
                initial_downloaded_size,
                initial_file_size,
                downloader,
                event_sender,
                progress_tracker,
                integrity_checker,
                retry_executor,
                download_config,
            )
            .await
            {
                Ok(DownloadOutcome::Completed(file_path)) => {
                    info!("✅ Download completed: {} -> {}", task_id_clone, file_path);
                }
                Ok(DownloadOutcome::Paused) => {
                    info!("⏸️ Download paused: {}", task_id_clone);
                }
                Ok(DownloadOutcome::Cancelled) => {
                    info!("🚫 Download cancelled: {}", task_id_clone);
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
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?
            .clone();

        if matches!(
            task.status,
            TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Committing
        ) {
            return Err(AppError::Download(format!(
                "Task {} cannot be paused from status: {:?}",
                task_id, task.status
            )));
        }

        let _ = self.remove_task_from_queue(task_id).await;
        let is_active = self.active_downloads.contains_key(task_id);
        if is_active {
            let _ = self.http_downloader.pause_task(task_id).await;
        }

        if let Some(task) = self.tasks.get_mut(task_id) {
            task.paused_at = Some(chrono::Utc::now());
            task.paused_from_active = is_active || task.status == TaskStatus::Downloading;
        }

        if task.status != TaskStatus::Paused {
            self.update_task_status(task_id, TaskStatus::Paused).await?;
        }

        // Emit task paused event only when there is no active worker to emit it.
        if !is_active {
            if let Some(sender) = &self.event_sender {
                let _ = sender.send(DownloadEvent::TaskPaused {
                    task_id: task_id.to_string(),
                });
            }
        }

        info!("⏸️ Paused download: {}", task_id);
        Ok(())
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

        let _ = self.remove_task_from_queue(task_id).await;

        if self.active_downloads.contains_key(task_id) {
            let _ = self.http_downloader.resume_task(task_id).await;
            self.update_task_status(task_id, TaskStatus::Downloading)
                .await?;
            if let Some(task) = self.tasks.get_mut(task_id) {
                task.paused_at = None;
                task.paused_from_active = false;
            }
        } else {
            // Resume is essentially the same as starting
            self.start_download(task_id).await?;
            if let Some(task) = self.tasks.get_mut(task_id) {
                task.paused_at = None;
                task.paused_from_active = false;
            }
            if let Err(err) = self.persist_state().await {
                warn!("Failed to persist state after resume download: {}", err);
            }
        }

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
        let is_active = self.active_downloads.contains_key(task_id);
        // 发信号给 HttpDownloader，确保底层任务尽快停止
        let _ = downloader.cancel_download(task_id).await;
        let _ = self.remove_task_from_queue(task_id).await;

        self.update_task_status(task_id, TaskStatus::Cancelled)
            .await?;

        // Emit task cancelled event only if there is no active worker to emit it.
        if !is_active {
            if let Some(sender) = &self.event_sender {
                let _ = sender.send(DownloadEvent::TaskCancelled {
                    task_id: task_id.to_string(),
                });
            }
        }

        info!("🚫 Cancelled download: {}", task_id);
        Ok(())
    }

    /// Pause all active downloads
    pub async fn pause_all_downloads(&mut self) -> AppResult<usize> {
        let downloader = Arc::clone(&self.http_downloader);

        self.queue_paused = true;
        let pause_moment = chrono::Utc::now();

        let task_ids: Vec<String> = self.active_downloads.keys().cloned().collect();
        for task_id in &task_ids {
            let _ = downloader.pause_task(task_id).await;
            if let Some(task) = self.tasks.get_mut(task_id) {
                // 使用同一批次时间戳，避免 HashMap 遍历顺序导致恢复顺序随机。
                task.paused_at = Some(pause_moment);
                task.paused_from_active = true;
            }
            let _ = self.update_task_status(task_id, TaskStatus::Paused).await;
        }

        info!(
            "Paused {} active downloads (queue remains pending)",
            task_ids.len()
        );
        if let Err(err) = self.persist_state().await {
            warn!("Failed to persist state after pause-all: {}", err);
        }
        Ok(task_ids.len())
    }

    /// Start all downloads with backend-controlled policy.
    /// First resume paused tasks, then fill remaining slots with pending tasks.
    /// Failed tasks should be retried explicitly to avoid repeatedly replaying hard failures.
    pub async fn start_all_downloads(&mut self) -> AppResult<usize> {
        let paused_ids = self.collect_paused_task_ids_preferred();

        // Clear global pause and allow queue to run.
        self.queue_paused = false;
        self.http_downloader.resume_all().await;

        let mut resumed = 0usize;
        if !paused_ids.is_empty() {
            resumed = self.resume_task_list(&paused_ids, 9).await;
            info!("Start-all resumed {} paused downloads", resumed);
            if let Err(err) = self.persist_state().await {
                warn!("Failed to persist state after start-all (resume): {}", err);
            }
        }

        // Fill remaining slots with pending tasks only.
        let started_pending = self
            .start_tasks_by_status(&[TaskStatus::Pending], "start_all")
            .await?;
        if resumed > 0 || started_pending > 0 {
            info!(
                "Start-all summary: resumed {}, started pending {}",
                resumed, started_pending
            );
        }

        Ok(resumed + started_pending)
    }

    async fn start_tasks_by_status(
        &mut self,
        statuses: &[TaskStatus],
        context: &str,
    ) -> AppResult<usize> {
        self.queue_paused = false;
        self.http_downloader.resume_all().await;
        let candidates = self.collect_task_ids_by_status(statuses);
        if candidates.is_empty() {
            info!(
                "[{}] No tasks to start for statuses: {:?}",
                context, statuses
            );
            return Ok(0);
        }

        info!(
            "[{}] Starting tasks by statuses {:?}: candidates={}",
            context,
            statuses,
            candidates.len()
        );

        let mut started = 0usize;
        let mut queued = 0usize;
        let mut normalized_pending = false;
        for (idx, task_id) in candidates.iter().enumerate() {
            match self.start_download(task_id).await {
                Ok(_) => started += 1,
                Err(AppError::Download(msg)) if msg.contains("Maximum concurrent downloads") => {
                    info!(
                        "Reached concurrency limit while starting tasks (started {})",
                        started
                    );
                    for remaining_id in candidates.iter().skip(idx + 1) {
                        if let Some(task) = self.tasks.get_mut(remaining_id) {
                            if task.status == TaskStatus::Failed {
                                task.status = TaskStatus::Pending;
                                task.error_message = None;
                                task.updated_at = chrono::Utc::now();
                                normalized_pending = true;
                            }
                        }
                        if self.enqueue_task(remaining_id, 5).await {
                            queued += 1;
                        }
                    }
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

        if normalized_pending {
            self.update_stats().await;
        }

        info!(
            "[{}] Start summary: started={}, queued={}, total_candidates={}",
            context,
            started,
            queued,
            candidates.len()
        );
        if let Err(err) = self.persist_state().await {
            warn!("Failed to persist state after {}: {}", context, err);
        }
        Ok(started)
    }

    pub fn is_running(&self) -> bool {
        self.is_running
    }

    pub fn has_event_sender(&self) -> bool {
        self.event_sender.is_some()
    }

    pub async fn start_download_impl(&mut self, task_id: &str) -> AppResult<()> {
        let status = self
            .tasks
            .get(task_id)
            .map(|task| task.status.clone())
            .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;

        match status {
            TaskStatus::Paused => self.resume_download(task_id).await,
            _ => self.start_download(task_id).await,
        }
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

    pub async fn start_all_downloads_impl(&mut self) -> AppResult<usize> {
        self.start_all_downloads().await
    }

    async fn runtime_remove_task_from_queue(manager: &Arc<RwLock<Self>>, task_id: &str) -> bool {
        let guard = manager.read().await;
        guard.remove_task_from_queue(task_id).await
    }

    async fn runtime_persist_state_best_effort(manager: &Arc<RwLock<Self>>, context: &str) {
        let persist_result = {
            let guard = manager.read().await;
            guard.persist_state().await
        };
        if let Err(err) = persist_result {
            warn!("Failed to persist state after {}: {}", context, err);
        }
    }

    async fn runtime_event_sender(
        manager: &Arc<RwLock<Self>>,
    ) -> Option<mpsc::UnboundedSender<DownloadEvent>> {
        let guard = manager.read().await;
        guard.event_sender.clone()
    }

    /// Runtime command entry: apply download-event side effects in serialized runtime lane.
    pub async fn runtime_apply_event_side_effects(
        manager: &Arc<RwLock<Self>>,
        event: &DownloadEvent,
    ) -> AppResult<()> {
        let mut guard = manager.write().await;
        guard.apply_event_side_effects(event).await
    }

    async fn runtime_hydrate_task_file_state(
        manager: &Arc<RwLock<Self>>,
        task_id: &str,
    ) -> AppResult<VideoTask> {
        let mut hydrated = {
            let guard = manager.read().await;
            guard
                .tasks
                .get(task_id)
                .cloned()
                .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?
        };

        {
            let guard = manager.read().await;
            guard.hydrate_existing_file_state(&mut hydrated).await?;
        }

        {
            let mut guard = manager.write().await;
            let slot = guard
                .tasks
                .get_mut(task_id)
                .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;
            *slot = hydrated.clone();
        }

        Ok(hydrated)
    }

    async fn runtime_enqueue_task(
        manager: &Arc<RwLock<Self>>,
        task_id: &str,
        priority: u8,
    ) -> bool {
        let guard = manager.read().await;
        guard.enqueue_task(task_id, priority).await
    }

    async fn runtime_start_with_permit(
        manager: &Arc<RwLock<Self>>,
        task_id: &str,
        task: VideoTask,
        permit: tokio::sync::OwnedSemaphorePermit,
    ) -> AppResult<()> {
        let (
            downloader,
            event_sender,
            progress_tracker,
            integrity_checker,
            retry_executor,
            download_config,
            url,
            output_path,
            initial_downloaded_size,
            initial_file_size,
        ) = {
            let mut guard = manager.write().await;
            let (effective_output_path, current_downloaded_size, current_file_size, current_url) = {
                let task_mut = guard
                    .tasks
                    .get_mut(task_id)
                    .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;

                task_mut.error_message = None;
                task_mut.paused_at = None;
                task_mut.paused_from_active = false;
                task_mut.status = TaskStatus::Downloading;
                task_mut.updated_at = chrono::Utc::now();
                task_mut.speed = 0.0;
                if task_mut.downloaded_size == 0 {
                    task_mut.progress = 0.0;
                    task_mut.speed = 0.0;
                    task_mut.eta = None;
                }

                (
                    task_mut
                        .resolved_path
                        .clone()
                        .unwrap_or_else(|| task.output_path.clone()),
                    task_mut.downloaded_size,
                    task_mut.file_size,
                    task_mut.url.clone(),
                )
            };

            guard.recompute_stats();

            let sender = guard
                .event_sender
                .clone()
                .ok_or_else(|| AppError::Download("Event sender not initialized".to_string()))?;

            (
                guard.http_downloader.clone(),
                sender,
                Arc::clone(&guard.progress_tracker),
                Arc::clone(&guard.integrity_checker),
                Arc::clone(&guard.retry_executor),
                guard.config.clone(),
                current_url,
                effective_output_path,
                current_downloaded_size,
                current_file_size,
            )
        };

        progress_tracker
            .start_tracking(task_id.to_string(), initial_file_size)
            .await?;

        let _ = event_sender.send(DownloadEvent::TaskStarted {
            task_id: task_id.to_string(),
        });

        let task_id_clone = task_id.to_string();
        let handle = tokio::spawn(async move {
            let _permit = permit; // Keep permit alive

            match Self::execute_download(
                &task_id_clone,
                &url,
                &output_path,
                initial_downloaded_size,
                initial_file_size,
                downloader,
                event_sender,
                progress_tracker,
                integrity_checker,
                retry_executor,
                download_config,
            )
            .await
            {
                Ok(DownloadOutcome::Completed(file_path)) => {
                    info!("✅ Download completed: {} -> {}", task_id_clone, file_path);
                }
                Ok(DownloadOutcome::Paused) => {
                    info!("⏸️ Download paused: {}", task_id_clone);
                }
                Ok(DownloadOutcome::Cancelled) => {
                    info!("🚫 Download cancelled: {}", task_id_clone);
                }
                Err(error) => {
                    error!("❌ Download failed: {} - {}", task_id_clone, error);
                }
            }
        });

        {
            let mut guard = manager.write().await;
            guard.active_downloads.insert(task_id.to_string(), handle);
        }
        info!("🔄 Started download: {}", task_id);

        Ok(())
    }

    /// Runtime command entry: start one task.
    pub async fn runtime_start_download(
        manager: &Arc<RwLock<Self>>,
        task_id: &str,
    ) -> AppResult<()> {
        let task = Self::runtime_hydrate_task_file_state(manager, task_id).await?;

        let (hit_concurrency_limit, semaphore, task_for_start) = {
            let mut guard = manager.write().await;

            guard.settle_pending_semaphore_reduction();
            guard.reap_finished_active_downloads();

            let task_snapshot = guard
                .tasks
                .get(task_id)
                .cloned()
                .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;

            if matches!(
                task_snapshot.status,
                TaskStatus::Downloading | TaskStatus::Committing
            ) {
                return Err(AppError::Download(format!(
                    "Task is already active: {}",
                    task_id
                )));
            }

            if task_snapshot.status == TaskStatus::Completed {
                return Err(AppError::Download(format!(
                    "Task already completed: {}",
                    task_id
                )));
            }

            if task_snapshot.status == TaskStatus::Cancelled {
                return Err(AppError::Download(format!("Task cancelled: {}", task_id)));
            }

            if guard.active_downloads.contains_key(task_id) {
                return Err(AppError::Download(format!(
                    "Task is already running: {}",
                    task_id
                )));
            }

            (
                guard.active_downloads.len() >= guard.config.concurrent_downloads,
                Arc::clone(&guard.download_semaphore),
                task,
            )
        };

        if hit_concurrency_limit {
            let _ = Self::runtime_enqueue_task(manager, task_id, 5).await;
            {
                let mut guard = manager.write().await;
                if let Some(task) = guard.tasks.get_mut(task_id) {
                    if task.status == TaskStatus::Failed {
                        task.status = TaskStatus::Pending;
                        task.error_message = None;
                        task.updated_at = chrono::Utc::now();
                    }
                }
                guard.recompute_stats();
            }
            Self::runtime_persist_state_best_effort(
                manager,
                "persist state after queueing (runtime start limit)",
            )
            .await;
            return Err(AppError::Download(
                "Maximum concurrent downloads reached".to_string(),
            ));
        }

        let permit = match semaphore.try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                let _ = Self::runtime_enqueue_task(manager, task_id, 5).await;
                {
                    let mut guard = manager.write().await;
                    if let Some(task) = guard.tasks.get_mut(task_id) {
                        if task.status == TaskStatus::Failed {
                            task.status = TaskStatus::Pending;
                            task.error_message = None;
                            task.updated_at = chrono::Utc::now();
                        }
                    }
                    guard.recompute_stats();
                }
                Self::runtime_persist_state_best_effort(
                    manager,
                    "persist state after queueing (runtime start semaphore)",
                )
                .await;
                return Err(AppError::Download(
                    "Maximum concurrent downloads reached".to_string(),
                ));
            }
        };

        let _ = Self::runtime_remove_task_from_queue(manager, task_id).await;

        Self::runtime_start_with_permit(manager, task_id, task_for_start, permit).await
    }

    /// Runtime command entry: pause one task.
    pub async fn runtime_pause_download(
        manager: &Arc<RwLock<Self>>,
        task_id: &str,
    ) -> AppResult<()> {
        let (is_active, should_emit_paused_event) = {
            let mut guard = manager.write().await;
            let task = guard
                .tasks
                .get(task_id)
                .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?
                .clone();

            if matches!(
                task.status,
                TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Committing
            ) {
                return Err(AppError::Download(format!(
                    "Cannot pause task in status: {:?}",
                    task.status
                )));
            }

            let is_active = guard.active_downloads.contains_key(task_id);
            if let Some(task_mut) = guard.tasks.get_mut(task_id) {
                task_mut.paused_at = Some(chrono::Utc::now());
                task_mut.paused_from_active =
                    is_active || task_mut.status == TaskStatus::Downloading;
                if task_mut.status != TaskStatus::Paused {
                    task_mut.status = TaskStatus::Paused;
                    task_mut.updated_at = chrono::Utc::now();
                }
            }
            guard.recompute_stats();
            (is_active, !is_active)
        };

        let _ = Self::runtime_remove_task_from_queue(manager, task_id).await;

        if is_active {
            let downloader = {
                let guard = manager.read().await;
                guard.http_downloader.clone()
            };
            let _ = downloader.pause_task(task_id).await;
        }

        Self::runtime_persist_state_best_effort(manager, "runtime_pause_download").await;

        if should_emit_paused_event {
            if let Some(sender) = Self::runtime_event_sender(manager).await {
                let _ = sender.send(DownloadEvent::TaskPaused {
                    task_id: task_id.to_string(),
                });
            }
        }

        info!("⏸️ Paused download: {}", task_id);
        Ok(())
    }

    /// Runtime command entry: resume one task.
    pub async fn runtime_resume_download(
        manager: &Arc<RwLock<Self>>,
        task_id: &str,
    ) -> AppResult<()> {
        let mut hydrated_task = {
            let guard = manager.read().await;
            guard
                .tasks
                .get(task_id)
                .cloned()
                .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?
        };
        {
            let guard = manager.read().await;
            guard
                .hydrate_existing_file_state(&mut hydrated_task)
                .await?;
        }
        let is_active = {
            let mut guard = manager.write().await;
            if let Some(task_mut) = guard.tasks.get_mut(task_id) {
                *task_mut = hydrated_task.clone();
            }
            guard.reap_finished_active_downloads();

            if hydrated_task.status == TaskStatus::Completed
                || hydrated_task.status == TaskStatus::Cancelled
                || hydrated_task.status == TaskStatus::Committing
            {
                return Err(AppError::Download(format!(
                    "Cannot resume task in status: {:?}",
                    hydrated_task.status
                )));
            }
            guard.active_downloads.contains_key(task_id)
        };

        if is_active {
            let downloader = {
                let guard = manager.read().await;
                guard.http_downloader.clone()
            };
            downloader
                .resume_task(task_id)
                .await
                .map_err(|err| AppError::Download(format!("Failed to resume task: {}", err)))?;

            {
                let mut guard = manager.write().await;
                if let Some(task_mut) = guard.tasks.get_mut(task_id) {
                    task_mut.status = TaskStatus::Downloading;
                    task_mut.paused_at = None;
                    task_mut.paused_from_active = false;
                    task_mut.updated_at = chrono::Utc::now();
                }
                guard.recompute_stats();
            }
            Self::runtime_persist_state_best_effort(manager, "runtime_resume_download").await;
        } else {
            return Self::runtime_start_download(manager, task_id).await;
        }

        if let Some(sender) = Self::runtime_event_sender(manager).await {
            let _ = sender.send(DownloadEvent::TaskResumed {
                task_id: task_id.to_string(),
            });
        }

        info!("▶️ Resumed download: {}", task_id);
        Ok(())
    }

    /// Runtime command entry: cancel one task.
    pub async fn runtime_cancel_download(
        manager: &Arc<RwLock<Self>>,
        task_id: &str,
    ) -> AppResult<()> {
        let is_active = {
            let mut guard = manager.write().await;
            guard.reap_finished_active_downloads();
            guard.active_downloads.contains_key(task_id)
        };

        if is_active {
            let downloader = {
                let guard = manager.read().await;
                guard.http_downloader.clone()
            };
            let _ = downloader.cancel_download(task_id).await;
        }
        let _ = Self::runtime_remove_task_from_queue(manager, task_id).await;

        {
            let mut guard = manager.write().await;
            if let Some(task_mut) = guard.tasks.get_mut(task_id) {
                task_mut.status = TaskStatus::Cancelled;
                task_mut.updated_at = chrono::Utc::now();
            }
            guard.recompute_stats();
        }
        Self::runtime_persist_state_best_effort(manager, "runtime_cancel_download").await;

        if !is_active {
            if let Some(sender) = Self::runtime_event_sender(manager).await {
                let _ = sender.send(DownloadEvent::TaskCancelled {
                    task_id: task_id.to_string(),
                });
            }
        }

        info!("🚫 Cancelled download: {}", task_id);
        Ok(())
    }

    /// Runtime command entry: start all tasks.
    pub async fn runtime_start_all_downloads(manager: &Arc<RwLock<Self>>) -> AppResult<usize> {
        let mut guard = manager.write().await;
        guard.start_all_downloads().await
    }

    /// Runtime command entry: pause all tasks.
    pub async fn runtime_pause_all_downloads(manager: &Arc<RwLock<Self>>) -> AppResult<usize> {
        let mut guard = manager.write().await;
        guard.pause_all_downloads().await
    }

    fn collect_task_ids_by_status(&self, statuses: &[TaskStatus]) -> Vec<String> {
        let mut entries: Vec<(String, chrono::DateTime<chrono::Utc>)> = self
            .tasks
            .iter()
            .filter_map(|(task_id, task)| {
                if statuses.contains(&task.status) {
                    Some((task_id.clone(), task.created_at))
                } else {
                    None
                }
            })
            .collect();
        entries.sort_by(|a, b| a.1.cmp(&b.1));
        entries.into_iter().map(|(task_id, _)| task_id).collect()
    }

    fn collect_paused_task_ids_preferred(&self) -> Vec<String> {
        let paused_entries: Vec<(String, VideoTask)> = self
            .tasks
            .iter()
            .filter_map(|(task_id, task)| {
                if task.status == TaskStatus::Paused {
                    Some((task_id.clone(), task.clone()))
                } else {
                    None
                }
            })
            .collect();

        if paused_entries.is_empty() {
            return Vec::new();
        }

        let mut preferred: Vec<(String, VideoTask)> = paused_entries
            .iter()
            .filter(|(_, task)| task.paused_from_active)
            .cloned()
            .collect();

        if preferred.is_empty() {
            preferred = paused_entries;
        }

        preferred.sort_by(|a, b| {
            let a_time = a.1.paused_at.unwrap_or(a.1.updated_at);
            let b_time = b.1.paused_at.unwrap_or(b.1.updated_at);
            // 优先恢复“最近一次暂停”的任务，才能稳定接续用户刚暂停的并发集合。
            b_time
                .cmp(&a_time)
                .then_with(|| a.1.created_at.cmp(&b.1.created_at))
        });

        preferred.into_iter().map(|(id, _)| id).collect()
    }

    async fn resume_task_list(&mut self, task_ids: &[String], priority: u8) -> usize {
        let mut resumed = 0usize;
        for (idx, task_id) in task_ids.iter().enumerate() {
            match self.resume_download(task_id).await {
                Ok(_) => resumed += 1,
                Err(AppError::Download(msg)) if msg.contains("Maximum concurrent downloads") => {
                    info!(
                        "Reached concurrency limit while resuming tasks (resumed {})",
                        resumed
                    );
                    for remaining_id in task_ids.iter().skip(idx) {
                        let _ = self.enqueue_task(remaining_id, priority).await;
                    }
                    break;
                }
                Err(e) => warn!("Failed to resume task {}: {}", task_id, e),
            }
        }
        resumed
    }

    async fn enqueue_task(&self, task_id: &str, priority: u8) -> bool {
        let inserted = {
            let mut queue = self.task_queue.lock().await;
            if queue.iter().any(|item| item.task_id == task_id) {
                return false;
            }

            queue.push(TaskPriority {
                task_id: task_id.to_string(),
                priority,
                created_at: chrono::Utc::now(),
            });
            true
        };

        if inserted {
            if let Err(err) = self.persist_state().await {
                warn!("Failed to persist state after enqueue: {}", err);
            }
        }
        inserted
    }

    async fn remove_task_from_queue(&self, task_id: &str) -> bool {
        let removed = {
            let mut queue = self.task_queue.lock().await;
            if queue.is_empty() {
                return false;
            }

            let mut items = Vec::with_capacity(queue.len());
            while let Some(item) = queue.pop() {
                items.push(item);
            }

            let before = items.len();
            items.retain(|item| item.task_id != task_id);
            let removed = items.len() != before;

            *queue = items.into_iter().collect();
            removed
        };

        if removed {
            if let Err(err) = self.persist_state().await {
                warn!("Failed to persist state after dequeue: {}", err);
            }
        }
        removed
    }

    async fn process_task_queue(&mut self) {
        if self.queue_paused {
            return;
        }
        loop {
            self.settle_pending_semaphore_reduction();
            self.reap_finished_active_downloads();
            if self.active_downloads.len() >= self.config.concurrent_downloads {
                break;
            }
            if self.download_semaphore.available_permits() == 0 {
                break;
            }

            let next_task = {
                let mut queue = self.task_queue.lock().await;
                queue.pop()
            };

            let Some(task_priority) = next_task else {
                break;
            };

            let task_id = task_priority.task_id.clone();
            let task = match self.tasks.get(&task_id).cloned() {
                Some(task) => task,
                None => continue,
            };

            if task.status != TaskStatus::Pending
                && task.status != TaskStatus::Paused
                && task.status != TaskStatus::Failed
            {
                continue;
            }

            self.refresh_task_file_state(&task_id).await.ok();

            let permit = match self.download_semaphore.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => {
                    let _ = self.enqueue_task(&task_id, task_priority.priority).await;
                    break;
                }
            };

            if let Err(err) = self
                .start_download_with_permit(&task_id, task, permit)
                .await
            {
                warn!("Failed to start queued task {}: {}", task_id, err);
            }
        }
    }

    /// Apply deferred semaphore reductions when permits become available.
    /// This keeps effective concurrency aligned with runtime config updates.
    fn settle_pending_semaphore_reduction(&mut self) {
        if self.pending_semaphore_reduction == 0 {
            return;
        }

        let available = self.download_semaphore.available_permits();
        if available == 0 {
            return;
        }

        let to_forget = available.min(self.pending_semaphore_reduction);
        let forgotten = self.download_semaphore.forget_permits(to_forget);

        if forgotten > 0 {
            self.pending_semaphore_reduction -= forgotten;
            self.semaphore_capacity = self.semaphore_capacity.saturating_sub(forgotten);
            debug!(
                "Settled semaphore reduction: forgotten={}, pending={}, capacity={}",
                forgotten, self.pending_semaphore_reduction, self.semaphore_capacity
            );
        }
    }

    pub(crate) async fn scheduler_tick(&mut self) -> bool {
        if !self.is_running {
            return false;
        }

        self.reap_finished_active_downloads();
        self.process_task_queue().await;
        true
    }

    pub fn set_scheduler_handle(&mut self, handle: tokio::task::JoinHandle<()>) {
        self.scheduler_handle = Some(handle);
    }

    /// Remove a completed or failed task
    pub async fn remove_task(&mut self, task_id: &str) -> AppResult<()> {
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| AppError::Download(format!("Task not found: {}", task_id)))?;

        if self.active_downloads.contains_key(task_id) {
            return Err(AppError::Download(
                "Cannot remove task while download worker is still active".to_string(),
            ));
        }

        match task.status {
            TaskStatus::Downloading | TaskStatus::Committing => Err(AppError::Download(
                "Cannot remove active download".to_string(),
            )),
            _ => {
                let _ = self.remove_task_from_queue(task_id).await;
                self.tasks.remove(task_id);
                self.update_stats().await;
                if let Err(err) = self.persist_state().await {
                    warn!("Failed to persist state after removing task: {}", err);
                }
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
        // First settle any deferred changes so bookkeeping starts from latest real capacity.
        self.settle_pending_semaphore_reduction();

        let old_target = self
            .semaphore_capacity
            .saturating_sub(self.pending_semaphore_reduction);

        self.config = config;
        let new_target = self.config.concurrent_downloads.max(1);

        if new_target > old_target {
            // Grow target: cancel deferred reductions first, then add new permits if needed.
            let mut grow_by = new_target - old_target;
            if self.pending_semaphore_reduction > 0 {
                let cancelled = grow_by.min(self.pending_semaphore_reduction);
                self.pending_semaphore_reduction -= cancelled;
                grow_by -= cancelled;
            }

            if grow_by > 0 {
                self.download_semaphore.add_permits(grow_by);
                self.semaphore_capacity += grow_by;
            }
        } else if new_target < old_target {
            // Shrink target: schedule deferred reduction and settle immediately when possible.
            let reduce_by = old_target - new_target;
            self.pending_semaphore_reduction =
                self.pending_semaphore_reduction.saturating_add(reduce_by);
            self.settle_pending_semaphore_reduction();
        }

        info!(
            "🔧 Updated concurrent downloads: target {} -> {}, capacity={}, pending_reduction={}",
            old_target, new_target, self.semaphore_capacity, self.pending_semaphore_reduction
        );

        // If queue is active, immediately attempt to fill newly available slots.
        if !self.queue_paused {
            self.process_task_queue().await;
        }
        Ok(())
    }

    pub async fn runtime_update_config(
        manager: &Arc<RwLock<Self>>,
        config: DownloadConfig,
    ) -> AppResult<()> {
        let mut manager = manager.write().await;
        manager.update_config(config).await
    }

    pub async fn runtime_clear_completed(manager: &Arc<RwLock<Self>>) -> AppResult<usize> {
        let mut manager = manager.write().await;
        manager.clear_completed().await
    }

    pub async fn runtime_retry_failed(manager: &Arc<RwLock<Self>>) -> AppResult<usize> {
        let mut manager = manager.write().await;
        manager.retry_failed().await
    }

    /// Clear all completed tasks
    pub async fn clear_completed(&mut self) -> AppResult<usize> {
        let initial_count = self.tasks.len();

        self.tasks
            .retain(|_id, task| task.status != TaskStatus::Completed);
        self.update_stats().await;
        if let Err(err) = self.persist_state().await {
            warn!("Failed to persist state after clear_completed: {}", err);
        }

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

    pub async fn runtime_set_rate_limit(
        manager: &Arc<RwLock<Self>>,
        bytes_per_second: Option<u64>,
    ) -> AppResult<Option<u64>> {
        let manager = manager.write().await;
        manager.set_rate_limit(bytes_per_second).await;
        Ok(manager.get_rate_limit().await)
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

    // Private helper methods

    async fn hydrate_existing_file_state(&self, task: &mut VideoTask) -> AppResult<()> {
        let Some(file_path) = self.resolve_output_file_path(task) else {
            return Ok(());
        };
        if task.resolved_path.as_deref().unwrap_or("").is_empty() {
            task.resolved_path = Some(file_path.to_string_lossy().to_string());
        }

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
            }
        }

        if let Some((resume_downloaded, resume_total)) = self.load_resume_snapshot(task).await {
            if resume_total > 0 && task.file_size.is_none() {
                task.file_size = Some(resume_total);
            }
            if resume_downloaded > 0 {
                task.downloaded_size = task.downloaded_size.max(resume_downloaded);
            }
        }

        if task.downloaded_size > 0 {
            if let Some(total) = task.file_size {
                if total > 0 && task.downloaded_size >= total {
                    task.status = TaskStatus::Completed;
                    task.downloaded_size = total;
                    task.progress = 100.0;
                    task.speed = 0.0;
                    task.eta = None;
                    return Ok(());
                }
            }

            if let Some(total) = task.file_size {
                if total > 0 {
                    task.progress =
                        ((task.downloaded_size as f64 / total as f64) * 100.0).min(100.0);
                }
            }

            // Keep pending tasks in pending state even if partial files exist.
            // This matches "等待中" semantics: tasks haven't been explicitly paused yet.
        }

        Ok(())
    }

    fn resolve_output_file_path(&self, task: &VideoTask) -> Option<PathBuf> {
        if let Some(resolved) = task.resolved_path.as_ref() {
            if !resolved.trim().is_empty() {
                return Some(PathBuf::from(resolved));
            }
        }

        if task.output_path.trim().is_empty() {
            return None;
        }

        let (output_dir, filename) =
            Self::split_output_path(&task.url, &task.output_path, Some(&task.title));
        if output_dir.trim().is_empty() {
            return Some(PathBuf::from(filename));
        }

        Some(Path::new(&output_dir).join(filename))
    }

    fn normalize_output_path(output_path: &str) -> String {
        output_path.trim_end_matches(['/', '\\']).to_string()
    }

    fn split_output_path(
        url: &str,
        output_path: &str,
        preferred_title: Option<&str>,
    ) -> (String, String) {
        let trimmed = output_path.trim();
        let default_filename = Self::derive_output_filename(url, preferred_title);
        if trimmed.is_empty() {
            return (String::new(), default_filename);
        }

        let ends_with_sep = trimmed.ends_with('/') || trimmed.ends_with('\\');
        if ends_with_sep {
            return (Self::normalize_output_path(trimmed), default_filename);
        }

        let path = Path::new(trimmed);
        if path.extension().is_some() && path.file_name().is_some() {
            let dir = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let filename = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or(default_filename);
            return (Self::normalize_output_path(&dir), filename);
        }

        (Self::normalize_output_path(trimmed), default_filename)
    }

    fn identity_parts_from_task(&self, task: &VideoTask) -> (String, String) {
        if let Some(resolved) = task.resolved_path.as_ref() {
            let path = Path::new(resolved);
            let dir = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let filename = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| Self::extract_title_from_url(&task.url));
            return (Self::normalize_output_path(&dir), filename);
        }

        Self::split_output_path(&task.url, &task.output_path, Some(&task.title))
    }

    fn build_identity_key(&self, url: &str, output_path: &str) -> String {
        let (output_dir, filename) = Self::split_output_path(url, output_path, None);
        format!("url:{}|dir:{}|file:{}", url, output_dir, filename)
    }

    fn build_identity_key_for_task(&self, task: &VideoTask) -> String {
        let (output_dir, filename) = self.identity_parts_from_task(task);
        format!("url:{}|dir:{}|file:{}", task.url, output_dir, filename)
    }

    fn business_identity_key_for_task(&self, task: &VideoTask) -> Option<String> {
        let info = task.video_info.as_ref()?;
        let zl_id = info
            .zl_id
            .as_ref()
            .or(info.id.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())?;
        let record_url = info
            .record_url
            .as_ref()
            .or(info.url.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())?;
        Some(format!("biz:{}|{}", zl_id, record_url))
    }

    fn identity_keys_for_task(&self, task: &VideoTask) -> Vec<String> {
        let mut keys = Vec::new();
        if let Some(business_key) = self.business_identity_key_for_task(task) {
            keys.push(business_key);
        }
        keys.push(self.build_identity_key_for_task(task));
        keys.sort();
        keys.dedup();
        keys
    }

    fn find_task_by_task_identity(&self, task: &VideoTask) -> Option<String> {
        let keys = self.identity_keys_for_task(task);
        if keys.is_empty() {
            return None;
        }
        self.tasks
            .values()
            .find(|existing| {
                let existing_keys = self.identity_keys_for_task(existing);
                existing_keys.iter().any(|key| keys.contains(key))
            })
            .map(|task| task.id.clone())
    }

    fn find_task_by_identity(&self, url: &str, output_path: &str) -> Option<String> {
        let identity = self.build_identity_key(url, output_path);
        self.tasks
            .values()
            .find(|task| {
                self.identity_keys_for_task(task)
                    .iter()
                    .any(|key| key == &identity)
            })
            .map(|task| task.id.clone())
    }

    async fn load_resume_snapshot(&self, task: &VideoTask) -> Option<(u64, u64)> {
        let resume_key = self.build_resume_key(task)?;
        self.http_downloader
            .load_resume_info(&resume_key)
            .await
            .map(|info| (info.downloaded_total, info.total_size))
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

    fn note_transfer_started(&mut self, task_id: &str) {
        let should_reset = self
            .task_lifecycle_timings
            .get(task_id)
            .and_then(|timing| timing.final_status.as_ref())
            .is_some();

        if should_reset || !self.task_lifecycle_timings.contains_key(task_id) {
            self.task_lifecycle_timings.insert(
                task_id.to_string(),
                TaskLifecycleTiming {
                    transfer_started_at: chrono::Utc::now(),
                    commit_started_at: None,
                    finished_at: None,
                    final_status: None,
                },
            );
        }
    }

    fn note_commit_started(&mut self, task_id: &str) {
        let now = chrono::Utc::now();
        let entry = self
            .task_lifecycle_timings
            .entry(task_id.to_string())
            .or_insert(TaskLifecycleTiming {
                transfer_started_at: now,
                commit_started_at: None,
                finished_at: None,
                final_status: None,
            });

        if entry.commit_started_at.is_none() {
            entry.commit_started_at = Some(now);
        }
        entry.final_status = None;
        entry.finished_at = None;
    }

    fn note_terminal_status(&mut self, task_id: &str, final_status: &TaskStatus) {
        let now = chrono::Utc::now();
        let (transfer_started_at, commit_started_at) = {
            let timing = self
                .task_lifecycle_timings
                .entry(task_id.to_string())
                .or_insert(TaskLifecycleTiming {
                    transfer_started_at: now,
                    commit_started_at: None,
                    finished_at: None,
                    final_status: None,
                });
            (timing.transfer_started_at, timing.commit_started_at)
        };

        if let Some(commit_started_at) = commit_started_at {
            let commit_duration = (now - commit_started_at)
                .to_std()
                .unwrap_or_default()
                .as_secs_f64();

            if *final_status == TaskStatus::Completed {
                Self::push_metric_sample(
                    &mut self.lifecycle_metrics.commit_duration_secs,
                    commit_duration,
                );

                if commit_duration > 2.0 {
                    self.lifecycle_metrics.commit_warning_count += 1;
                    warn!(
                        "Commit stage exceeded warning threshold for task {}: {:.3}s",
                        task_id, commit_duration
                    );
                }
                if commit_duration > 5.0 {
                    self.lifecycle_metrics.commit_elevated_warning_count += 1;
                    warn!(
                        "Commit stage exceeded elevated threshold for task {}: {:.3}s",
                        task_id, commit_duration
                    );
                }
            } else if *final_status == TaskStatus::Failed {
                self.lifecycle_metrics.failed_commit_count += 1;
                warn!(
                    "Task {} failed after entering commit stage; commit duration before failure {:.3}s",
                    task_id, commit_duration
                );
            }
        }

        if *final_status == TaskStatus::Completed {
            let transfer_end = commit_started_at.unwrap_or(now);
            let transfer_duration = (transfer_end - transfer_started_at)
                .to_std()
                .unwrap_or_default()
                .as_secs_f64();
            let total_duration = (now - transfer_started_at)
                .to_std()
                .unwrap_or_default()
                .as_secs_f64();

            Self::push_metric_sample(
                &mut self.lifecycle_metrics.transfer_duration_secs,
                transfer_duration,
            );
            Self::push_metric_sample(
                &mut self.lifecycle_metrics.total_duration_secs,
                total_duration,
            );
        }

        if let Some(timing) = self.task_lifecycle_timings.get_mut(task_id) {
            timing.finished_at = Some(now);
            timing.final_status = Some(final_status.clone());
        }
    }

    fn note_peak_download_speed(&mut self, speed_bps: f64) {
        if speed_bps.is_finite() && speed_bps > self.lifecycle_metrics.peak_download_speed_bps {
            self.lifecycle_metrics.peak_download_speed_bps = speed_bps;
        }
    }

    fn push_metric_sample(samples: &mut Vec<f64>, value: f64) {
        if !value.is_finite() || value < 0.0 {
            return;
        }

        samples.push(value);
        const MAX_SAMPLES: usize = 512;
        if samples.len() > MAX_SAMPLES {
            let overflow = samples.len() - MAX_SAMPLES;
            samples.drain(0..overflow);
        }
    }

    fn average_metric(samples: &[f64]) -> f64 {
        if samples.is_empty() {
            0.0
        } else {
            samples.iter().sum::<f64>() / samples.len() as f64
        }
    }

    fn percentile_metric(samples: &[f64], percentile: f64) -> f64 {
        if samples.is_empty() {
            return 0.0;
        }

        let mut values = samples.to_vec();
        values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let clamped = percentile.clamp(0.0, 1.0);
        let idx = ((values.len().saturating_sub(1)) as f64 * clamped).round() as usize;
        values[idx]
    }

    /// Update task status
    pub async fn update_task_status(&mut self, task_id: &str, status: TaskStatus) -> AppResult<()> {
        if let Some(task) = self.tasks.get_mut(task_id) {
            task.status = status;
            if matches!(task.status, TaskStatus::Committing) {
                task.speed = 0.0;
                task.display_speed_bps = 0;
                task.eta = None;
                if task.progress >= 100.0 {
                    task.progress = 99.9;
                }
            }
            task.updated_at = chrono::Utc::now();
            self.update_stats().await;
        }
        if let Err(err) = self.persist_state().await {
            warn!("Failed to persist state after status update: {}", err);
        }
        Ok(())
    }

    /// Update download statistics
    async fn update_stats(&mut self) {
        self.recompute_stats();

        // Emit stats updated event
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(DownloadEvent::StatsUpdated {
                stats: self.stats.clone(),
            });
        }
    }

    /// Apply state updates based on download events so backend state stays consistent with UI
    pub async fn apply_event_side_effects(&mut self, event: &DownloadEvent) -> AppResult<()> {
        let mut should_replenish_queue = false;
        match event {
            DownloadEvent::TaskProgress { progress, .. } => {
                self.update_task_progress_snapshot(progress).await?;
            }
            DownloadEvent::TaskCommitting { task_id } => {
                self.note_commit_started(task_id);
                if let Some(task) = self.tasks.get_mut(task_id) {
                    if !matches!(
                        task.status,
                        TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Failed
                    ) {
                        task.status = TaskStatus::Committing;
                        task.speed = 0.0;
                        task.display_speed_bps = 0;
                        task.eta = None;
                        if task.progress >= 100.0 {
                            task.progress = 99.9;
                        }
                        task.updated_at = chrono::Utc::now();
                    }
                }
                self.update_stats().await;
            }
            DownloadEvent::TaskCompleted { task_id, file_path } => {
                self.finalize_task_state(task_id, TaskStatus::Completed, Some(file_path), None)
                    .await?;
                should_replenish_queue = true;
            }
            DownloadEvent::TaskFailed { task_id, error } => {
                self.finalize_task_state(
                    task_id,
                    TaskStatus::Failed,
                    None,
                    Some(error.to_string()),
                )
                .await?;
                should_replenish_queue = true;
            }
            DownloadEvent::TaskCancelled { task_id } => {
                self.finalize_task_state(task_id, TaskStatus::Cancelled, None, None)
                    .await?;
                should_replenish_queue = true;
            }
            DownloadEvent::TaskPaused { task_id } => {
                let _ = self.remove_task_from_queue(task_id).await;
                self.drop_active_handle(task_id);
                // 避免晚到的 paused 事件覆盖已终态任务
                let should_mark_paused = self.tasks.get(task_id).is_some_and(|task| {
                    if matches!(
                        task.status,
                        TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Failed
                    ) {
                        return false;
                    }
                    // 若任务已恢复为 Downloading 且没有 pause 意图标记，
                    // 则把晚到的 TaskPaused 视作旧事件，避免状态回退。
                    !(task.status == TaskStatus::Downloading && task.paused_at.is_none())
                });
                if should_mark_paused {
                    self.update_task_status(task_id, TaskStatus::Paused).await?;
                }
                should_replenish_queue = true;
            }
            DownloadEvent::TaskResumed { task_id } | DownloadEvent::TaskStarted { task_id } => {
                self.note_transfer_started(task_id);
                // 避免旧 started/resumed 事件把用户刚设置的 Paused 或终态任务覆盖回 Downloading
                let should_mark_downloading = self.tasks.get(task_id).is_some_and(|task| {
                    matches!(task.status, TaskStatus::Pending | TaskStatus::Downloading)
                });
                if should_mark_downloading {
                    self.update_task_status(task_id, TaskStatus::Downloading)
                        .await?;
                }
            }
            _ => {}
        }

        if should_replenish_queue {
            self.process_task_queue().await;
        }

        Ok(())
    }

    /// Persist progress snapshot into task list for consistent refreshes
    async fn update_task_progress_snapshot(&mut self, progress: &ProgressUpdate) -> AppResult<()> {
        let mut speed_for_peak = None;
        if let Some(task) = self.tasks.get_mut(&progress.task_id) {
            if matches!(
                task.status,
                TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Failed
            ) {
                return Ok(());
            }

            let previous_downloaded = task.downloaded_size;
            let previous_progress = task.progress;
            let incoming_total = progress.total_size.or(task.file_size);
            let mut next_downloaded = progress.downloaded_size;

            // 对于非 Pending 状态，避免晚到旧事件导致 downloaded_size 回退。
            if next_downloaded < previous_downloaded && task.status != TaskStatus::Pending {
                next_downloaded = previous_downloaded;
            }
            if let Some(total) = incoming_total {
                next_downloaded = next_downloaded.min(total);
                task.file_size = Some(total);
            } else if let Some(total) = progress.total_size {
                task.file_size = Some(total);
            }

            task.downloaded_size = next_downloaded;
            task.speed = progress.speed;
            task.display_speed_bps = progress.display_speed_bps;
            task.eta = progress.eta;
            speed_for_peak = Some(progress.speed);

            let mut next_progress = (progress.progress * 100.0).clamp(0.0, 100.0);
            let total_unknown = progress.total_size.is_none();
            if total_unknown && progress.downloaded_size > 0 && next_progress == 0.0 {
                // 续传时服务端未返回 total，避免把已有进度清零。
                // 但不要保留到 100%，否则会出现“下载中显示 100%”。
                if previous_progress > 0.0 && previous_progress < 100.0 {
                    next_progress = previous_progress;
                }
            }

            if next_downloaded >= previous_downloaded
                && next_progress > 0.0
                && next_progress < previous_progress
                && previous_progress < 100.0
            {
                // 防止进度倒退（仅在下载量不回退时）
                next_progress = previous_progress;
            }

            // 未进入 Completed 之前，传输进度不允许在活跃态显示成 100%。
            if matches!(
                task.status,
                TaskStatus::Downloading | TaskStatus::Committing
            ) {
                if next_progress >= 100.0 && next_downloaded > 0 {
                    next_progress = 99.9;
                }

                if task.status == TaskStatus::Committing {
                    task.speed = 0.0;
                    task.display_speed_bps = 0;
                    task.eta = None;
                }
            }

            task.progress = next_progress;
            task.updated_at = chrono::Utc::now();
        }

        if let Some(speed) = speed_for_peak {
            self.note_peak_download_speed(speed);
        }

        // Progress events are high frequency; keep this path lightweight to avoid lock contention.
        self.recompute_stats();
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
        let _ = self.remove_task_from_queue(task_id).await;
        self.drop_active_handle(task_id);
        self.note_terminal_status(task_id, &status);

        if let Some(task) = self.tasks.get_mut(task_id) {
            task.status = status;
            task.error_message = error_message;
            task.speed = 0.0;
            task.display_speed_bps = 0;
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

    /// Eagerly reap finished handles to avoid short-lived "phantom occupied" slots.
    fn reap_finished_active_downloads(&mut self) -> usize {
        let before = self.active_downloads.len();
        self.active_downloads
            .retain(|_, handle| !handle.is_finished());
        before.saturating_sub(self.active_downloads.len())
    }

    /// Extract title from URL (simple heuristic)
    fn extract_title_from_url(url: &str) -> String {
        url.split('/')
            .next_back()
            .and_then(|s| s.split('?').next())
            .unwrap_or("Unknown")
            .to_string()
    }

    fn derive_output_filename(url: &str, preferred_title: Option<&str>) -> String {
        let fallback = Self::extract_title_from_url(url);
        let url_path = url.split('?').next().unwrap_or(url);
        let url_file_name = Path::new(url_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&fallback);
        let extension = Path::new(url_file_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");

        let sanitized_title = preferred_title
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(sanitize_filename)
            .map(|title| title.trim().trim_matches('.').to_string())
            .filter(|title| !title.is_empty())
            .filter(|title| title.to_lowercase() != "unknown");

        if let Some(title) = sanitized_title {
            if extension.is_empty() {
                return title;
            }

            let lowercase_title = title.to_lowercase();
            let lowercase_extension = extension.to_lowercase();
            if lowercase_title.ends_with(&format!(".{lowercase_extension}")) {
                return title;
            }

            return format!("{title}.{extension}");
        }

        fallback
    }

    fn build_resume_key(&self, task: &VideoTask) -> Option<String> {
        if task.output_path.trim().is_empty()
            && task
                .resolved_path
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return None;
        }
        let (output_dir, filename) = self.identity_parts_from_task(task);
        let identity = format!("{}|{}|{}", task.url, output_dir, filename);
        let mut hasher = Sha256::new();
        hasher.update(identity.as_bytes());
        Some(hex::encode(hasher.finalize()))
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
    #[allow(clippy::too_many_arguments)]
    async fn execute_download(
        task_id: &str,
        url: &str,
        output_path: &str,
        initial_downloaded_size: u64,
        initial_file_size: Option<u64>,
        downloader: Arc<HttpDownloader>,
        event_sender: EventSender,
        progress_tracker: Arc<ProgressTrackingManager>,
        integrity_checker: Arc<IntegrityChecker>,
        retry_executor: Arc<RetryExecutor>,
        config: DownloadConfig,
    ) -> AppResult<DownloadOutcome> {
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
                        initial_downloaded_size,
                        initial_file_size,
                        downloader,
                        event_sender.clone(),
                        progress_tracker,
                        integrity_checker,
                        config,
                    )
                    .await
                    {
                        Ok(outcome) => Ok(outcome),
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
            Ok(outcome) => {
                match &outcome {
                    DownloadOutcome::Completed(file_path) => {
                        info!("✅ Download completed successfully: {}", file_path);
                    }
                    DownloadOutcome::Paused => {
                        info!("⏸️ Download paused");
                    }
                    DownloadOutcome::Cancelled => {
                        info!("🚫 Download cancelled");
                    }
                }
                Ok(outcome)
            }
            Err(e) => {
                error!("❌ Download failed after all retries: {}", e);
                Err(AppError::Download(e.to_string()))
            }
        }
    }

    /// Execute a single download attempt without retry logic
    #[allow(clippy::too_many_arguments)]
    async fn execute_download_attempt(
        task_id: &str,
        url: &str,
        output_path: &str,
        initial_downloaded_size: u64,
        initial_file_size: Option<u64>,
        downloader: Arc<HttpDownloader>,
        event_sender: EventSender,
        progress_tracker: Arc<ProgressTrackingManager>,
        integrity_checker: Arc<IntegrityChecker>,
        config: DownloadConfig,
    ) -> AppResult<DownloadOutcome> {
        debug!("🔄 Attempting download: {} -> {}", url, output_path);

        // Resolve output directory and filename (supports full file path inputs).
        let (output_dir, filename) = Self::split_output_path(url, output_path, None);

        // Create download task and ensure IDs match the manager task ID so progress events line up.
        let mut download_task =
            DownloadTask::new(url.to_string(), output_dir.to_string(), filename);
        download_task.id = task_id.to_string();
        download_task.stats.downloaded_bytes = initial_downloaded_size;
        download_task.stats.total_bytes = initial_file_size;
        if let Some(total) = initial_file_size {
            if total > 0 {
                download_task.stats.progress =
                    (initial_downloaded_size as f64 / total as f64).clamp(0.0, 1.0);
            }
        }

        // Create progress channel for downloader callback
        let (download_progress_tx, mut download_progress_rx) =
            mpsc::unbounded_channel::<(String, DownloadStats)>();

        // Clone necessary data for progress tracking
        let task_id_clone = task_id.to_string();
        let event_sender_clone = event_sender.clone();
        let progress_tracker_clone = Arc::clone(&progress_tracker);

        // Spawn enhanced progress tracking task
        let progress_handle = tokio::spawn(async move {
            let mut committing_emitted = false;
            while let Some((task_id, download_stats)) = download_progress_rx.recv().await {
                if task_id == task_id_clone {
                    if matches!(download_stats.status_hint, Some(TaskStatus::Committing))
                        && !committing_emitted
                    {
                        let _ = event_sender_clone.send(DownloadEvent::TaskCommitting {
                            task_id: task_id_clone.clone(),
                        });
                        committing_emitted = true;
                    }
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
                            let is_committing =
                                matches!(download_stats.status_hint, Some(TaskStatus::Committing));
                            let progress_event = ProgressUpdate {
                                task_id: task_id_clone.clone(),
                                downloaded_size: download_stats.downloaded_bytes,
                                total_size: download_stats.total_bytes,
                                speed: download_stats.speed,
                                display_speed_bps: if is_committing {
                                    0
                                } else if enhanced_stats.smoothed_speed > 0.0 {
                                    enhanced_stats.smoothed_speed.round() as u64
                                } else {
                                    download_stats.speed.max(0.0).round() as u64
                                },
                                eta: if is_committing {
                                    None
                                } else {
                                    enhanced_stats.eta_seconds.or(download_stats.eta)
                                },
                                progress: download_stats.progress,
                            };

                            let _ = event_sender_clone.send(DownloadEvent::TaskProgress {
                                task_id: task_id_clone.clone(),
                                progress: progress_event,
                            });

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
            Ok(completed_task) => match completed_task.status {
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

                    if let Err(err) = Self::persist_completion_marker(&file_path_buf, url).await {
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
                                let _ = event_sender.send(DownloadEvent::IntegrityCheckCompleted {
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

                                let _ = event_sender.send(DownloadEvent::IntegrityCheckFailed {
                                    task_id: task_id.to_string(),
                                    error: error_msg,
                                });
                            }
                        }
                    }

                    info!("✅ Download completed: {}", file_path);
                    Ok(DownloadOutcome::Completed(file_path))
                }
                TaskStatus::Paused => {
                    let _ = progress_tracker.stop_tracking(task_id).await;
                    let _ = event_sender.send(DownloadEvent::TaskPaused {
                        task_id: task_id.to_string(),
                    });
                    info!("⏸️ Download paused: {}", task_id);
                    Ok(DownloadOutcome::Paused)
                }
                TaskStatus::Cancelled => {
                    let _ = progress_tracker.stop_tracking(task_id).await;
                    let _ = event_sender.send(DownloadEvent::TaskCancelled {
                        task_id: task_id.to_string(),
                    });
                    info!("🚫 Download cancelled: {}", task_id);
                    Ok(DownloadOutcome::Cancelled)
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
            },
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
            resolved_path: None,
            status: TaskStatus::Pending,
            progress: 0.0,
            speed: 0.0,
            display_speed_bps: 0,
            downloaded_size: 0,
            file_size: None,
            eta: None,
            created_at,
            updated_at: created_at,
            error_message: None,
            paused_at: None,
            paused_from_active: false,
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
    use crate::core::models::{DownloaderType, VideoInfo};

    #[tokio::test]
    async fn test_download_manager_creation() -> AppResult<()> {
        let config = DownloadConfig::default();
        let manager = DownloadManager::new(config)?;
        assert!(!manager.is_running);
        assert_eq!(manager.tasks.len(), 0);
        Ok(())
    }

    #[tokio::test]
    async fn test_persisted_state_converts_downloading_to_paused() -> AppResult<()> {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let config = DownloadConfig::default();

        let mut manager = DownloadManager::new_with_state_path(config.clone(), state_path.clone())?;

        let task_id_1 = manager
            .add_task(
                "https://example.com/video1.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;
        let task_id_2 = manager
            .add_task(
                "https://example.com/video2.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        manager
            .update_task_status(&task_id_1, TaskStatus::Downloading)
            .await?;

        drop(manager);

        let manager = DownloadManager::new_with_state_path(config, state_path)?;

        let task = manager.tasks.get(&task_id_1).unwrap();
        assert_eq!(task.status, TaskStatus::Paused);
        assert!(task.paused_from_active);

        let queue = manager.task_queue.lock().await;
        let queued_ids: Vec<String> = queue.iter().map(|item| item.task_id.clone()).collect();
        assert!(!queued_ids.contains(&task_id_1));
        assert!(queued_ids.contains(&task_id_2));

        Ok(())
    }

    #[tokio::test]
    async fn test_persisted_state_keeps_queue_paused() -> AppResult<()> {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let config = DownloadConfig::default();

        let mut manager = DownloadManager::new_with_state_path(config.clone(), state_path.clone())?;

        let _task_id = manager
            .add_task(
                "https://example.com/video3.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        manager.pause_all_downloads().await?;

        drop(manager);

        let manager = DownloadManager::new_with_state_path(config, state_path)?;
        assert!(manager.queue_paused);

        Ok(())
    }

    #[tokio::test]
    async fn test_runtime_pause_all_only_pauses_active_downloads() -> AppResult<()> {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let mut manager =
            DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)?;

        let active_task_id = manager
            .add_task(
                "https://example.com/active.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;
        let pending_task_id = manager
            .add_task(
                "https://example.com/pending.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        manager
            .update_task_status(&active_task_id, TaskStatus::Downloading)
            .await?;
        manager
            .active_downloads
            .insert(active_task_id.clone(), tokio::spawn(async {}));

        let manager = Arc::new(RwLock::new(manager));
        let paused = DownloadManager::runtime_pause_all_downloads(&manager).await?;
        assert_eq!(paused, 1);

        let guard = manager.read().await;
        assert_eq!(
            guard.tasks.get(&active_task_id).map(|task| &task.status),
            Some(&TaskStatus::Paused)
        );
        assert_eq!(
            guard.tasks.get(&pending_task_id).map(|task| &task.status),
            Some(&TaskStatus::Pending)
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_runtime_start_all_keeps_failed_outside_queue_when_slots_full() -> AppResult<()> {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let mut config = DownloadConfig::default();
        config.concurrent_downloads = 1;
        let mut manager = DownloadManager::new_with_state_path(config, state_path)?;
        let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
        manager.event_sender = Some(sender);

        let paused_task_id = manager
            .add_task(
                "https://example.com/paused.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;
        let pending_task_id = manager
            .add_task(
                "https://example.com/pending-2.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;
        let failed_task_id = manager
            .add_task(
                "https://example.com/failed.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        if let Some(task) = manager.tasks.get_mut(&paused_task_id) {
            task.status = TaskStatus::Paused;
            task.paused_from_active = true;
            task.paused_at = Some(chrono::Utc::now());
        }
        if let Some(task) = manager.tasks.get_mut(&failed_task_id) {
            task.status = TaskStatus::Failed;
            task.error_message = Some("boom".to_string());
        }

        manager.active_downloads.insert(
            "occupy".to_string(),
            tokio::spawn(std::future::pending::<()>()),
        );

        let manager = Arc::new(RwLock::new(manager));
        let started = DownloadManager::runtime_start_all_downloads(&manager).await?;
        assert_eq!(started, 0);

        let guard = manager.read().await;
        let queue = guard.task_queue.lock().await;
        let queued_ids: Vec<String> = queue.iter().map(|item| item.task_id.clone()).collect();
        assert!(queued_ids.contains(&paused_task_id));
        assert!(queued_ids.contains(&pending_task_id));
        assert!(!queued_ids.contains(&failed_task_id));
        assert_eq!(
            guard.tasks.get(&failed_task_id).map(|task| &task.status),
            Some(&TaskStatus::Failed)
        );
        drop(queue);
        drop(guard);

        if let Some(handle) = manager.write().await.active_downloads.remove("occupy") {
            handle.abort();
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_update_task_output_paths_updates_pending_task_paths() -> AppResult<()> {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new_with_state_path(config, state_path)?;

        let task_id = manager
            .add_task(
                "https://example.com/video-a.mp4".to_string(),
                "/downloads/course-a".to_string(),
            )
            .await?;

        let updated = manager
            .update_task_output_paths(&[(task_id.clone(), "D:/Video/course-a".to_string())])
            .await?;

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].id, task_id);
        assert_eq!(updated[0].output_path, "D:/Video/course-a");
        assert_eq!(
            updated[0]
                .resolved_path
                .as_deref()
                .map(|path| path.replace('\\', "/")),
            Some("D:/Video/course-a/video-a.mp4".to_string())
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_collect_paused_task_ids_prefers_recent_batch() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let old_id = manager
            .add_task(
                "https://example.com/old.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;
        let new_id = manager
            .add_task(
                "https://example.com/new.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        let now = chrono::Utc::now();
        if let Some(task) = manager.tasks.get_mut(&old_id) {
            task.status = TaskStatus::Paused;
            task.paused_from_active = true;
            task.paused_at = Some(now - chrono::Duration::minutes(5));
        }
        if let Some(task) = manager.tasks.get_mut(&new_id) {
            task.status = TaskStatus::Paused;
            task.paused_from_active = true;
            task.paused_at = Some(now);
        }

        let ordered = manager.collect_paused_task_ids_preferred();
        assert_eq!(ordered, vec![new_id, old_id]);
        Ok(())
    }

    #[tokio::test]
    async fn test_business_identity_deduplication() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;
        let now = chrono::Utc::now();

        let base_task = VideoTask {
            id: "task-1".to_string(),
            url: "https://example.com/video.mp4".to_string(),
            title: "Test Video".to_string(),
            output_path: "./downloads".to_string(),
            resolved_path: None,
            status: TaskStatus::Pending,
            progress: 0.0,
            file_size: None,
            downloaded_size: 0,
            speed: 0.0,
            display_speed_bps: 0,
            eta: None,
            error_message: None,
            created_at: now,
            updated_at: now,
            paused_at: None,
            paused_from_active: false,
            downloader_type: Some(DownloaderType::Http),
            video_info: Some(VideoInfo {
                zl_id: Some("zl-123".to_string()),
                zl_name: None,
                record_url: Some("https://example.com/record.mp4".to_string()),
                kc_id: None,
                kc_name: None,
                id: None,
                name: None,
                url: None,
                course_id: None,
                course_name: None,
            }),
        };

        let duplicate_task = VideoTask {
            id: "task-2".to_string(),
            url: "https://example.com/another.mp4".to_string(),
            title: "Duplicate Video".to_string(),
            output_path: "./other".to_string(),
            resolved_path: None,
            status: TaskStatus::Pending,
            progress: 0.0,
            file_size: None,
            downloaded_size: 0,
            speed: 0.0,
            display_speed_bps: 0,
            eta: None,
            error_message: None,
            created_at: now,
            updated_at: now,
            paused_at: None,
            paused_from_active: false,
            downloader_type: Some(DownloaderType::Http),
            video_info: Some(VideoInfo {
                zl_id: Some("zl-123".to_string()),
                zl_name: None,
                record_url: Some("https://example.com/record.mp4".to_string()),
                kc_id: None,
                kc_name: None,
                id: None,
                name: None,
                url: None,
                course_id: None,
                course_name: None,
            }),
        };

        let first = manager.add_video_task(base_task).await?;
        let second = manager.add_video_task(duplicate_task).await?;

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(manager.tasks.len(), 1);

        Ok(())
    }

    #[tokio::test]
    async fn test_recompute_stats_keeps_raw_average_and_display_total_separate() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let first_task_id = manager
            .add_task(
                "https://example.com/raw-a.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;
        let second_task_id = manager
            .add_task(
                "https://example.com/raw-b.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        if let Some(task) = manager.tasks.get_mut(&first_task_id) {
            task.status = TaskStatus::Downloading;
            task.speed = 1400.0;
            task.display_speed_bps = 900;
        }

        if let Some(task) = manager.tasks.get_mut(&second_task_id) {
            task.status = TaskStatus::Downloading;
            task.speed = 600.0;
            task.display_speed_bps = 500;
        }

        manager.recompute_stats();

        assert_eq!(manager.stats.average_speed, 1000.0);
        assert_eq!(manager.stats.display_total_speed_bps, 1400);

        Ok(())
    }

    #[tokio::test]
    async fn test_downloading_task_never_reaches_100_before_completion_event() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let task_id = manager
            .add_task(
                "https://example.com/almost-done.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        if let Some(task) = manager.tasks.get_mut(&task_id) {
            task.status = TaskStatus::Downloading;
            task.file_size = Some(100);
            task.downloaded_size = 90;
            task.progress = 90.0;
        }

        manager
            .apply_event_side_effects(&DownloadEvent::TaskProgress {
                task_id: task_id.clone(),
                progress: ProgressUpdate {
                    task_id: task_id.clone(),
                    downloaded_size: 100,
                    total_size: Some(100),
                    speed: 1024.0,
                    display_speed_bps: 1024,
                    eta: None,
                    progress: 1.0,
                },
            })
            .await?;

        let task = manager.tasks.get(&task_id).expect("task must exist");
        assert_eq!(task.status, TaskStatus::Downloading);
        assert!(task.progress < 100.0);

        Ok(())
    }

    #[tokio::test]
    async fn test_task_committing_event_sets_non_terminal_active_state() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let task_id = manager
            .add_task(
                "https://example.com/committing.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        if let Some(task) = manager.tasks.get_mut(&task_id) {
            task.status = TaskStatus::Downloading;
            task.file_size = Some(100);
            task.downloaded_size = 100;
            task.progress = 100.0;
            task.speed = 2048.0;
            task.display_speed_bps = 2048;
            task.eta = Some(1);
        }

        manager
            .apply_event_side_effects(&DownloadEvent::TaskCommitting {
                task_id: task_id.clone(),
            })
            .await?;

        let task = manager.tasks.get(&task_id).expect("task must exist");
        assert_eq!(task.status, TaskStatus::Committing);
        assert_eq!(task.speed, 0.0);
        assert_eq!(task.display_speed_bps, 0);
        assert_eq!(task.eta, None);
        assert!(task.progress < 100.0);

        Ok(())
    }

    #[tokio::test]
    async fn test_add_video_task_uses_title_based_filename_for_generic_media_path() -> AppResult<()>
    {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;
        let now = chrono::Utc::now();

        let task = VideoTask {
            id: "task-generic-filename".to_string(),
            url: "https://example.com/playlist.f9.mp4".to_string(),
            title: "2、阳台月季种植".to_string(),
            output_path: "F:/temp/downloads".to_string(),
            resolved_path: None,
            status: TaskStatus::Pending,
            progress: 0.0,
            file_size: None,
            downloaded_size: 0,
            speed: 0.0,
            display_speed_bps: 0,
            eta: None,
            error_message: None,
            created_at: now,
            updated_at: now,
            paused_at: None,
            paused_from_active: false,
            downloader_type: Some(DownloaderType::Http),
            video_info: None,
        };

        let stored = manager.add_video_task(task).await?;

        assert!(stored.created);
        assert_eq!(
            stored
                .task
                .resolved_path
                .as_deref()
                .map(|path| path.replace('\\', "/")),
            Some("F:/temp/downloads/2、阳台月季种植.mp4".to_string())
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_remove_task_rejects_when_active_handle_exists() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        let task_id = manager
            .add_task(
                "https://example.com/active.mp4".to_string(),
                "./downloads".to_string(),
            )
            .await?;

        manager.active_downloads.insert(
            task_id.clone(),
            tokio::spawn(async {
                std::future::pending::<()>().await;
            }),
        );

        let remove_result = manager.remove_task(&task_id).await;
        assert!(remove_result.is_err());
        assert!(manager.tasks.contains_key(&task_id));

        if let Some(handle) = manager.active_downloads.remove(&task_id) {
            handle.abort();
        }

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

        // Tasks should not be auto-queued without an explicit start request
        let queue = manager.task_queue.lock().await;
        assert_eq!(queue.len(), 0);

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

        // Tasks should not be auto-queued without an explicit start request
        let queue = manager.task_queue.lock().await;
        assert_eq!(queue.len(), 0);

        Ok(())
    }

    #[tokio::test]
    async fn test_start_stop_manager() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        manager.start().await?;
        assert!(manager.is_running);
        assert!(manager.scheduler_handle.is_none());

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
