//! Download runtime command router.
//!
//! A thin async command queue that serializes download control calls and keeps
//! the concurrency slots full without blocking UI threads.

use std::sync::Arc;

use tokio::runtime::Handle;
use tokio::sync::{mpsc, oneshot, RwLock};
use tracing::{debug, instrument};

use crate::core::manager::DownloadManager;
use crate::core::models::{AppError, AppResult};

/// Commands understood by the runtime router.
#[derive(Debug)]
pub enum RuntimeCommand {
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
    ResumeAll {
        respond_to: oneshot::Sender<AppResult<usize>>,
    },
    CancelAll {
        respond_to: oneshot::Sender<AppResult<usize>>,
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

    pub async fn resume_all(&self) -> AppResult<usize> {
        self.send_command(|tx| RuntimeCommand::ResumeAll { respond_to: tx })
            .await
    }

    pub async fn cancel_all(&self) -> AppResult<usize> {
        self.send_command(|tx| RuntimeCommand::CancelAll { respond_to: tx })
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
        RuntimeCommand::Start {
            task_id,
            respond_to,
        } => {
            debug!("[RUNTIME_CMD] Processing Start for task: {}", task_id);
            let result = {
                let mut guard = manager.write().await;
                guard.start_download_impl(&task_id).await
            };
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
            let result = {
                debug!("[RUNTIME_CMD] Acquiring write lock for Pause...");
                let mut guard = manager.write().await;
                debug!(
                    "[RUNTIME_CMD] Write lock acquired for Pause, executing pause_download_impl..."
                );
                guard.pause_download_impl(&task_id).await
            };
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
            let result = {
                let mut guard = manager.write().await;
                guard.resume_download_impl(&task_id).await
            };
            let _ = respond_to.send(result);
        }
        RuntimeCommand::Cancel {
            task_id,
            respond_to,
        } => {
            let result = {
                let mut guard = manager.write().await;
                guard.cancel_download_impl(&task_id).await
            };
            let _ = respond_to.send(result);
        }
        RuntimeCommand::StartAll { respond_to } => {
            let result = {
                let mut guard = manager.write().await;
                guard.start_all_downloads_impl().await
            };
            let _ = respond_to.send(result);
        }
        RuntimeCommand::PauseAll { respond_to } => {
            let result = {
                let mut guard = manager.write().await;
                guard.pause_all_downloads_impl().await
            };
            let _ = respond_to.send(result);
        }
        RuntimeCommand::ResumeAll { respond_to } => {
            let result = {
                let mut guard = manager.write().await;
                guard.resume_all_downloads_impl().await
            };
            let _ = respond_to.send(result);
        }
        RuntimeCommand::CancelAll { respond_to } => {
            let result = {
                let mut guard = manager.write().await;
                guard.cancel_all_downloads_impl().await
            };
            let _ = respond_to.send(result);
        }
    }
}
