use serde_json::json;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::core::{manager::DownloadEvent, runtime::DownloadRuntimeHandle};
use crate::infra::event_bus::emit_download_event;

pub fn spawn_download_event_bridge(
    app_handle: AppHandle,
    download_runtime: DownloadRuntimeHandle,
    mut receiver: mpsc::UnboundedReceiver<DownloadEvent>,
) {
    tauri::async_runtime::spawn(async move {
        info!("🔌 Event bridge started - listening for DownloadManager events");
        let mut progress_event_count = 0u64;

        while let Some(event) = receiver.recv().await {
            if let Err(sync_err) = download_runtime.apply_event(event.clone()).await {
                error!("[EVENT_BRIDGE] Failed to sync manager state: {}", sync_err);
            }

            match event {
                DownloadEvent::TaskProgress { task_id, progress } => {
                    progress_event_count += 1;
                    if progress_event_count <= 5 || progress_event_count.is_multiple_of(20) {
                        info!(
                            "[EVENT_BRIDGE] TaskProgress #{} for task {}: progress={:.1}%, speed={:.0} B/s, downloaded={}",
                            progress_event_count,
                            task_id,
                            progress.progress * 100.0,
                            progress.speed,
                            progress.downloaded_size
                        );
                    }
                    if let Err(e) = emit_download_event(&app_handle, "task.progressed", &progress) {
                        error!(
                            "[EVENT_BRIDGE] Failed to emit download.events(task.progressed): {}",
                            e
                        );
                    }
                }
                DownloadEvent::TaskStarted { task_id } => {
                    info!("[EVENT_BRIDGE] TaskStarted for task {}", task_id);
                    emit_status_change(&app_handle, task_id, "Downloading", None, true);
                }
                DownloadEvent::TaskCommitting { task_id } => {
                    emit_status_change(&app_handle, task_id, "Committing", None, false);
                }
                DownloadEvent::TaskCompleted { task_id, .. } => {
                    emit_status_change(&app_handle, task_id, "Completed", None, false);
                }
                DownloadEvent::TaskFailed { task_id, error } => {
                    emit_status_change(&app_handle, task_id, "Failed", Some(error), false);
                }
                DownloadEvent::TaskPaused { task_id } => {
                    emit_status_change(&app_handle, task_id, "Paused", None, false);
                }
                DownloadEvent::TaskResumed { task_id } => {
                    emit_status_change(&app_handle, task_id, "Downloading", None, false);
                }
                DownloadEvent::TaskCancelled { task_id } => {
                    emit_status_change(&app_handle, task_id, "Cancelled", None, false);
                }
                DownloadEvent::StatsUpdated { stats } => {
                    let _ = emit_download_event(&app_handle, "task.stats_updated", &stats);
                }
                _ => {}
            }
        }

        warn!("🔌 Event bridge stopped");
    });
}

fn emit_status_change(
    app_handle: &AppHandle,
    task_id: String,
    status: &str,
    error_message: Option<String>,
    strict_logging: bool,
) {
    let payload = json!({
        "task_id": task_id,
        "status": status,
        "error_message": error_message,
    });

    if strict_logging {
        if let Err(e) = emit_download_event(app_handle, "task.status_changed", &payload) {
            error!(
                "[EVENT_BRIDGE] Failed to emit download.events(task.status_changed): {}",
                e
            );
        }
    } else {
        let _ = emit_download_event(app_handle, "task.status_changed", &payload);
    }
}
