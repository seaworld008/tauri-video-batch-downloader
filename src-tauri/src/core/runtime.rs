//! Download runtime command router.
//!
//! A thin async command queue that serializes download control calls and keeps
//! the concurrency slots full without blocking UI threads.

use std::sync::Arc;

use tokio::runtime::Handle;
use tokio::sync::{mpsc, oneshot, RwLock};
use tracing::{debug, instrument};

use crate::core::manager::{DownloadEvent, DownloadManager};
use crate::core::models::{AppError, AppResult, DownloadConfig, VideoTask};

/// Commands understood by the runtime router.
#[derive(Debug)]
pub enum RuntimeCommand {
    AddTasks {
        tasks: Vec<VideoTask>,
        respond_to: oneshot::Sender<AppResult<Vec<VideoTask>>>,
    },
    UpdateTaskOutputPaths {
        updates: Vec<(String, String)>,
        respond_to: oneshot::Sender<AppResult<Vec<VideoTask>>>,
    },
    RemoveTasks {
        task_ids: Vec<String>,
        respond_to: oneshot::Sender<AppResult<usize>>,
    },
    ClearCompleted {
        respond_to: oneshot::Sender<AppResult<usize>>,
    },
    RetryFailed {
        respond_to: oneshot::Sender<AppResult<usize>>,
    },
    UpdateConfig {
        config: DownloadConfig,
        respond_to: oneshot::Sender<AppResult<()>>,
    },
    SetRateLimit {
        bytes_per_second: Option<u64>,
        respond_to: oneshot::Sender<AppResult<Option<u64>>>,
    },
    Start {
        task_id: String,
        respond_to: oneshot::Sender<AppResult<()>>,
    },
    Pause {
        task_id: String,
        respond_to: oneshot::Sender<AppResult<()>>,
    },
    Resume {
        task_id: String,
        respond_to: oneshot::Sender<AppResult<()>>,
    },
    Cancel {
        task_id: String,
        respond_to: oneshot::Sender<AppResult<()>>,
    },
    StartAll {
        respond_to: oneshot::Sender<AppResult<usize>>,
    },
    PauseAll {
        respond_to: oneshot::Sender<AppResult<usize>>,
    },
    ApplyEvent {
        event: Box<DownloadEvent>,
        respond_to: oneshot::Sender<AppResult<()>>,
    },
}

/// Handle exposed to Tauri commands and the rest of the backend.
#[derive(Clone)]
pub struct DownloadRuntimeHandle {
    sender: mpsc::Sender<RuntimeCommand>,
}

impl DownloadRuntimeHandle {
    pub fn new(sender: mpsc::Sender<RuntimeCommand>) -> Self {
        Self { sender }
    }

    async fn send_command<T>(
        &self,
        build: impl FnOnce(oneshot::Sender<AppResult<T>>) -> RuntimeCommand,
    ) -> AppResult<T> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(build(tx))
            .await
            .map_err(|e| AppError::System(format!("Download runtime unavailable: {}", e)))?;
        rx.await
            .map_err(|_| AppError::System("Download runtime dropped response".into()))?
    }

    pub async fn add_tasks(&self, tasks: Vec<VideoTask>) -> AppResult<Vec<VideoTask>> {
        self.send_command(|tx| RuntimeCommand::AddTasks {
            tasks,
            respond_to: tx,
        })
        .await
    }

    pub async fn update_task_output_paths(
        &self,
        updates: Vec<(String, String)>,
    ) -> AppResult<Vec<VideoTask>> {
        self.send_command(|tx| RuntimeCommand::UpdateTaskOutputPaths {
            updates,
            respond_to: tx,
        })
        .await
    }

    pub async fn remove_tasks(&self, task_ids: Vec<String>) -> AppResult<usize> {
        self.send_command(|tx| RuntimeCommand::RemoveTasks {
            task_ids,
            respond_to: tx,
        })
        .await
    }

    pub async fn clear_completed(&self) -> AppResult<usize> {
        self.send_command(|tx| RuntimeCommand::ClearCompleted { respond_to: tx })
            .await
    }

    pub async fn retry_failed(&self) -> AppResult<usize> {
        self.send_command(|tx| RuntimeCommand::RetryFailed { respond_to: tx })
            .await
    }

    pub async fn update_config(&self, config: DownloadConfig) -> AppResult<()> {
        self.send_command(|tx| RuntimeCommand::UpdateConfig {
            config,
            respond_to: tx,
        })
        .await
    }

    pub async fn set_rate_limit(&self, bytes_per_second: Option<u64>) -> AppResult<Option<u64>> {
        self.send_command(|tx| RuntimeCommand::SetRateLimit {
            bytes_per_second,
            respond_to: tx,
        })
        .await
    }

    pub async fn start_task(&self, task_id: String) -> AppResult<()> {
        self.send_command(|tx| RuntimeCommand::Start {
            task_id,
            respond_to: tx,
        })
        .await
    }

    pub async fn pause_task(&self, task_id: String) -> AppResult<()> {
        self.send_command(|tx| RuntimeCommand::Pause {
            task_id,
            respond_to: tx,
        })
        .await
    }

    pub async fn resume_task(&self, task_id: String) -> AppResult<()> {
        self.send_command(|tx| RuntimeCommand::Resume {
            task_id,
            respond_to: tx,
        })
        .await
    }

    pub async fn cancel_task(&self, task_id: String) -> AppResult<()> {
        self.send_command(|tx| RuntimeCommand::Cancel {
            task_id,
            respond_to: tx,
        })
        .await
    }

    pub async fn start_all(&self) -> AppResult<usize> {
        self.send_command(|tx| RuntimeCommand::StartAll { respond_to: tx })
            .await
    }

    pub async fn pause_all(&self) -> AppResult<usize> {
        self.send_command(|tx| RuntimeCommand::PauseAll { respond_to: tx })
            .await
    }

    pub async fn apply_event(&self, event: DownloadEvent) -> AppResult<()> {
        self.send_command(|tx| RuntimeCommand::ApplyEvent {
            event: Box::new(event),
            respond_to: tx,
        })
        .await
    }
}

/// Create a runtime handle without spawning the router loop yet.
/// Call `spawn_router` later when you have a tokio runtime available.
pub fn create_download_runtime_handle(
    _manager: Arc<RwLock<DownloadManager>>,
) -> (DownloadRuntimeHandle, mpsc::Receiver<RuntimeCommand>) {
    let (tx, rx) = mpsc::channel(256);
    tracing::info!("[RUNTIME] Created download runtime handle (router not yet spawned)");
    (DownloadRuntimeHandle::new(tx), rx)
}

/// Spawn the router loop. Call this from within a tokio runtime (e.g., tauri::async_runtime::spawn).
pub fn spawn_router_loop(
    manager: Arc<RwLock<DownloadManager>>,
    rx: mpsc::Receiver<RuntimeCommand>,
) {
    tracing::info!("[RUNTIME] Spawning router loop in current tokio runtime");

    let router_future = async move {
        router_loop(manager, rx).await;
    };

    // 使用 tauri::async_runtime::spawn 确保在 Tauri 的 runtime 中运行
    tauri::async_runtime::spawn(router_future);

    tracing::info!("[RUNTIME] Router loop spawned successfully");
}

/// Legacy function for backwards compatibility - creates and immediately spawns.
/// Prefer using create_download_runtime_handle + spawn_router_loop for better control.
pub fn spawn_download_runtime(manager: Arc<RwLock<DownloadManager>>) -> DownloadRuntimeHandle {
    let (tx, rx) = mpsc::channel(256);

    let router_manager = manager.clone();
    let router_future = async move {
        router_loop(router_manager, rx).await;
    };

    match Handle::try_current() {
        Ok(handle) => {
            tracing::info!("[RUNTIME] Spawning router in existing tokio runtime");
            handle.spawn(router_future);
        }
        Err(_) => {
            tracing::warn!(
                "[RUNTIME] No tokio runtime found, creating dedicated thread with new runtime"
            );
            std::thread::Builder::new()
                .name("download-runtime".into())
                .spawn(move || {
                    let runtime = tokio::runtime::Builder::new_multi_thread()
                        .enable_all()
                        .thread_name("download-runtime-worker")
                        .build()
                        .expect("download runtime");
                    runtime.block_on(router_future);
                })
                .expect("spawn download runtime thread");
        }
    }

    DownloadRuntimeHandle::new(tx)
}

async fn router_loop(
    manager: Arc<RwLock<DownloadManager>>,
    mut rx: mpsc::Receiver<RuntimeCommand>,
) {
    while let Some(cmd) = rx.recv().await {
        debug!("[RUNTIME] Processing user command: {:?}", cmd);
        handle_command(&manager, cmd).await;
    }
    debug!("Download runtime channel closed, exiting router loop");
}

#[instrument(skip(manager, command), fields(?command))]
async fn handle_command(manager: &Arc<RwLock<DownloadManager>>, command: RuntimeCommand) {
    match command {
        RuntimeCommand::AddTasks { tasks, respond_to } => {
            let result = DownloadManager::runtime_add_tasks(manager, tasks).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::UpdateTaskOutputPaths {
            updates,
            respond_to,
        } => {
            let result = DownloadManager::runtime_update_task_output_paths(manager, updates).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::RemoveTasks {
            task_ids,
            respond_to,
        } => {
            let result = DownloadManager::runtime_remove_tasks(manager, task_ids).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::ClearCompleted { respond_to } => {
            let result = DownloadManager::runtime_clear_completed(manager).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::RetryFailed { respond_to } => {
            let result = DownloadManager::runtime_retry_failed(manager).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::UpdateConfig { config, respond_to } => {
            let result = DownloadManager::runtime_update_config(manager, config).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::SetRateLimit {
            bytes_per_second,
            respond_to,
        } => {
            let result = DownloadManager::runtime_set_rate_limit(manager, bytes_per_second).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::Start {
            task_id,
            respond_to,
        } => {
            debug!("[RUNTIME_CMD] Processing Start for task: {}", task_id);
            let result = DownloadManager::runtime_start_download(manager, &task_id).await;
            debug!(
                "[RUNTIME_CMD] Start completed for task: {}, success: {}",
                task_id,
                result.is_ok()
            );
            let _ = respond_to.send(result);
        }
        RuntimeCommand::Pause {
            task_id,
            respond_to,
        } => {
            debug!("[RUNTIME_CMD] Processing Pause for task: {}", task_id);
            let result = DownloadManager::runtime_pause_download(manager, &task_id).await;
            debug!(
                "[RUNTIME_CMD] Pause completed for task: {}, success: {}",
                task_id,
                result.is_ok()
            );
            let _ = respond_to.send(result);
        }
        RuntimeCommand::Resume {
            task_id,
            respond_to,
        } => {
            let result = DownloadManager::runtime_resume_download(manager, &task_id).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::Cancel {
            task_id,
            respond_to,
        } => {
            let result = DownloadManager::runtime_cancel_download(manager, &task_id).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::StartAll { respond_to } => {
            let result = DownloadManager::runtime_start_all_downloads(manager).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::PauseAll { respond_to } => {
            let result = DownloadManager::runtime_pause_all_downloads(manager).await;
            let _ = respond_to.send(result);
        }
        RuntimeCommand::ApplyEvent { event, respond_to } => {
            let result =
                DownloadManager::runtime_apply_event_side_effects(manager, event.as_ref()).await;
            let _ = respond_to.send(result);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{DownloaderType, TaskStatus, VideoInfo};
    use chrono::Utc;
    use tempfile::TempDir;

    fn create_test_task(id: &str, url: &str, title: &str, output_path: &str) -> VideoTask {
        let now = Utc::now();
        VideoTask {
            id: id.to_string(),
            url: url.to_string(),
            title: title.to_string(),
            output_path: output_path.to_string(),
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
                zl_id: None,
                zl_name: None,
                record_url: Some(url.to_string()),
                kc_id: None,
                kc_name: None,
                id: None,
                name: Some(title.to_string()),
                url: Some(url.to_string()),
                course_id: None,
                course_name: None,
            }),
        }
    }

    fn create_runtime_handle() -> (DownloadRuntimeHandle, Arc<RwLock<DownloadManager>>, TempDir) {
        let temp_dir = TempDir::new().expect("temp dir");
        let state_path = temp_dir.path().join("download_state.json");
        let manager = Arc::new(RwLock::new(
            DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)
                .expect("manager"),
        ));
        let (runtime, rx) = create_download_runtime_handle(manager.clone());
        spawn_router_loop(manager.clone(), rx);
        (runtime, manager, temp_dir)
    }

    #[tokio::test]
    async fn runtime_add_tasks_routes_task_creation_through_runtime() {
        let (runtime, manager, _temp_dir) = create_runtime_handle();

        let added = runtime
            .add_tasks(vec![create_test_task(
                "task-1",
                "https://example.com/runtime-a.mp4",
                "runtime-a",
                "/downloads/runtime-a",
            )])
            .await
            .expect("add tasks");

        assert_eq!(added.len(), 1);
        let tasks = manager.read().await.get_tasks().await;
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "runtime-a");
    }

    #[tokio::test]
    async fn runtime_update_task_output_paths_routes_updates_through_runtime() {
        let (runtime, manager, _temp_dir) = create_runtime_handle();

        let added = runtime
            .add_tasks(vec![create_test_task(
                "task-2",
                "https://example.com/runtime-b.mp4",
                "runtime-b",
                "/downloads/original",
            )])
            .await
            .expect("seed task");

        let updated = runtime
            .update_task_output_paths(vec![(
                added[0].id.clone(),
                "/downloads/updated/runtime-b".to_string(),
            )])
            .await
            .expect("update paths");

        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].output_path, "/downloads/updated/runtime-b");
        let tasks = manager.read().await.get_tasks().await;
        assert_eq!(tasks[0].output_path, "/downloads/updated/runtime-b");
    }

    #[tokio::test]
    async fn runtime_set_rate_limit_routes_rate_limit_changes_through_runtime() {
        let (runtime, manager, _temp_dir) = create_runtime_handle();

        let applied = runtime
            .set_rate_limit(Some(512 * 1024))
            .await
            .expect("set rate limit");

        assert_eq!(applied, Some(512 * 1024));
        assert_eq!(
            manager.read().await.get_rate_limit().await,
            Some(512 * 1024)
        );
    }

    #[tokio::test]
    async fn runtime_remove_tasks_routes_removal_through_runtime() {
        let (runtime, manager, _temp_dir) = create_runtime_handle();

        let added = runtime
            .add_tasks(vec![create_test_task(
                "task-3",
                "https://example.com/runtime-c.mp4",
                "runtime-c",
                "/downloads/runtime-c",
            )])
            .await
            .expect("seed task");

        let removed = runtime
            .remove_tasks(vec![added[0].id.clone()])
            .await
            .expect("remove tasks");

        assert_eq!(removed, 1);
        let tasks = manager.read().await.get_tasks().await;
        assert!(tasks.is_empty());
    }

    #[tokio::test]
    async fn runtime_clear_completed_routes_cleanup_through_runtime() {
        let (runtime, manager, _temp_dir) = create_runtime_handle();

        let added = runtime
            .add_tasks(vec![create_test_task(
                "task-4",
                "https://example.com/runtime-d.mp4",
                "runtime-d",
                "/downloads/runtime-d",
            )])
            .await
            .expect("seed task");

        {
            let mut guard = manager.write().await;
            guard
                .update_task_status(&added[0].id, TaskStatus::Completed)
                .await
                .expect("mark completed");
        }

        let removed = runtime.clear_completed().await.expect("clear completed");
        assert_eq!(removed, 1);
        let tasks = manager.read().await.get_tasks().await;
        assert!(tasks.is_empty());
    }

    #[tokio::test]
    async fn runtime_retry_failed_routes_reset_through_runtime() {
        let (runtime, manager, _temp_dir) = create_runtime_handle();

        let added = runtime
            .add_tasks(vec![create_test_task(
                "task-5",
                "https://example.com/runtime-e.mp4",
                "runtime-e",
                "/downloads/runtime-e",
            )])
            .await
            .expect("seed task");

        {
            let mut guard = manager.write().await;
            guard
                .update_task_status(&added[0].id, TaskStatus::Failed)
                .await
                .expect("mark failed");
        }

        let reset = runtime.retry_failed().await.expect("retry failed");
        assert_eq!(reset, 1);
        let tasks = manager.read().await.get_tasks().await;
        assert_eq!(tasks[0].status, TaskStatus::Pending);
    }
}
