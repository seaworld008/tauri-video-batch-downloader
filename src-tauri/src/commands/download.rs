//! Download management commands
use serde::{Deserialize, Serialize};

use tauri::{command, State};
use uuid::Uuid;

use crate::infra::command_error::CommandError;
use crate::{core::models::*, AppState};

fn map_runtime_error(prefix: &str, error: impl std::fmt::Display) -> CommandError {
    let message = format!("{}: {}", prefix, error);
    if message
        .to_lowercase()
        .contains("maximum concurrent downloads")
    {
        return CommandError::concurrency_limit(message);
    }
    CommandError::internal(message)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TaskOutputPathUpdate {
    pub task_id: String,
    pub output_path: String,
}

#[command]
pub async fn add_download_tasks(
    tasks: Vec<VideoTask>,
    state: State<'_, AppState>,
) -> Result<Vec<VideoTask>, String> {
    state
        .download_runtime
        .add_tasks(tasks)
        .await
        .map_err(|error| error.to_string())
}

#[command]
pub async fn update_task_output_paths(
    task_updates: Vec<TaskOutputPathUpdate>,
    state: State<'_, AppState>,
) -> Result<Vec<VideoTask>, String> {
    let updates: Vec<(String, String)> = task_updates
        .into_iter()
        .map(|item| (item.task_id, item.output_path))
        .collect();

    state
        .download_runtime
        .update_task_output_paths(updates)
        .await
        .map_err(|error| error.to_string())
}

#[command]
pub async fn start_download(
    task_id: String,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    tracing::info!(
        "[START_DOWNLOAD_CMD] Starting download for task: {}",
        task_id
    );

    let request_id = request_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let result = state
        .task_engine
        .start_task(task_id.clone(), request_id)
        .await;

    match result {
        Ok(ack) if ack.accepted => {
            tracing::info!(
                "[START_DOWNLOAD_CMD] ✅ Download started successfully for task: {}",
                task_id
            );
            Ok(())
        }
        Ok(ack) => {
            Err(CommandError::internal(ack.reason.unwrap_or_else(|| {
                "TaskEngine rejected start request".to_string()
            })))
        }
        Err(e) => {
            tracing::error!(
                "[START_DOWNLOAD_CMD] ❌ Failed to start download for {}: {}",
                task_id,
                e
            );
            Err(map_runtime_error("Failed to start download", e))
        }
    }
}

#[command]
pub async fn pause_download(
    task_id: String,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    tracing::info!("[PAUSE_CMD] Received pause request for task: {}", task_id);

    let request_id = request_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let result = state
        .task_engine
        .pause_task(task_id.clone(), request_id)
        .await;

    match result {
        Ok(ack) if ack.accepted => {
            tracing::info!("[PAUSE_CMD] ✅ Successfully paused task: {}", task_id);
            Ok(())
        }
        Ok(ack) => {
            Err(CommandError::internal(ack.reason.unwrap_or_else(|| {
                "TaskEngine rejected pause request".to_string()
            })))
        }
        Err(e) => {
            tracing::error!("[PAUSE_CMD] ❌ Failed to pause task {}: {}", task_id, e);
            Err(map_runtime_error("Failed to pause download", e))
        }
    }
}

#[command]
pub async fn resume_download(
    task_id: String,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    tracing::info!("[RESUME_CMD] Resuming download for task: {}", task_id);

    let request_id = request_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let result = state
        .task_engine
        .resume_task(task_id.clone(), request_id)
        .await;

    match result {
        Ok(ack) if ack.accepted => {
            tracing::info!("[RESUME_CMD] ✅ Download resumed for task: {}", task_id);
            Ok(())
        }
        Ok(ack) => {
            Err(CommandError::internal(ack.reason.unwrap_or_else(|| {
                "TaskEngine rejected resume request".to_string()
            })))
        }
        Err(e) => {
            tracing::error!("[RESUME_CMD] ❌ Failed to resume download: {}", e);
            Err(map_runtime_error("Failed to resume download", e))
        }
    }
}

#[command]
pub async fn cancel_download(
    task_id: String,
    request_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    tracing::info!("[CANCEL_CMD] Cancelling download for task: {}", task_id);

    let request_id = request_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let result = state
        .task_engine
        .cancel_task(task_id.clone(), request_id)
        .await;

    match result {
        Ok(ack) if ack.accepted => {
            tracing::info!("[CANCEL_CMD] ✅ Download cancelled for task: {}", task_id);
            Ok(())
        }
        Ok(ack) => {
            Err(CommandError::internal(ack.reason.unwrap_or_else(|| {
                "TaskEngine rejected cancel request".to_string()
            })))
        }
        Err(e) => {
            tracing::error!("Failed to cancel download: {}", e);
            Err(map_runtime_error("Failed to cancel download", e))
        }
    }
}

#[command]
pub async fn pause_all_downloads(state: State<'_, AppState>) -> Result<usize, CommandError> {
    tracing::info!("[PAUSE_ALL_CMD] Pausing all active downloads");
    state
        .download_runtime
        .pause_all()
        .await
        .map_err(|e| map_runtime_error("Failed to pause all downloads", e))
}

/// Start all downloads (backend decides resume paused vs start pending)
#[command]
pub async fn start_all_downloads(state: State<'_, AppState>) -> Result<usize, CommandError> {
    tracing::info!("[START_ALL_CMD] Starting downloads with backend policy");
    state
        .download_runtime
        .start_all()
        .await
        .map_err(|e| map_runtime_error("Failed to start all downloads", e))
}

#[command]
pub async fn remove_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .download_runtime
        .remove_tasks(vec![task_id])
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[command]
pub async fn remove_download_tasks(
    task_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .download_runtime
        .remove_tasks(task_ids)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[command]
pub async fn get_download_tasks(state: State<'_, AppState>) -> Result<Vec<VideoTask>, String> {
    let manager = state.download_manager.read().await;

    // 获取所有任务
    let tasks = manager.get_tasks().await;
    Ok(tasks)
}

#[command]
pub async fn get_download_stats(state: State<'_, AppState>) -> Result<DownloadStats, String> {
    let manager = state.download_manager.read().await;

    // 获取实际统计数据
    let stats = manager.get_stats().await;
    Ok(stats)
}

#[command]
pub async fn clear_completed_tasks(state: State<'_, AppState>) -> Result<(), String> {
    state
        .download_runtime
        .clear_completed()
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[command]
pub async fn retry_failed_tasks(state: State<'_, AppState>) -> Result<(), CommandError> {
    let failed_task_ids: Vec<String> = {
        let manager = state.download_manager.read().await;
        manager
            .get_tasks()
            .await
            .into_iter()
            .filter(|task| task.status == TaskStatus::Failed)
            .map(|task| task.id.clone())
            .collect()
    };

    if failed_task_ids.is_empty() {
        tracing::info!("No failed tasks to retry");
        return Ok(());
    }

    tracing::info!("Retrying {} failed tasks", failed_task_ids.len());

    let reset_count = state
        .download_runtime
        .retry_failed()
        .await
        .map_err(|e| map_runtime_error("Failed to reset failed tasks", e))?;

    if reset_count == 0 {
        tracing::info!("No failed tasks were reset for retry");
        return Ok(());
    }

    let mut started = 0usize;
    let mut start_errors = Vec::new();

    for task_id in failed_task_ids {
        let request_id = Uuid::new_v4().to_string();
        match state
            .task_engine
            .start_task(task_id.clone(), request_id)
            .await
        {
            Ok(ack) if ack.accepted => {
                started += 1;
                tracing::info!("Restarted download for task: {}", task_id);
            }
            Ok(ack) => {
                let reason = ack
                    .reason
                    .unwrap_or_else(|| "TaskEngine rejected retry request".to_string());
                tracing::warn!("Failed to restart task {}: {}", task_id, reason);
                start_errors.push(format!("{}: {}", task_id, reason));
            }
            Err(err) => {
                tracing::warn!("Failed to restart task {}: {}", task_id, err);
                start_errors.push(format!("{}: {}", task_id, err));
            }
        }
    }

    if !start_errors.is_empty() {
        return Err(CommandError::internal(format!(
            "Restarted {} tasks, but {} failed to start: {}",
            started,
            start_errors.len(),
            start_errors.join(", ")
        )));
    }

    Ok(())
}

#[command]
pub async fn set_rate_limit(
    bytes_per_second: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Option<u64>, CommandError> {
    const MIN_LIMIT: u64 = 64 * 1024; // 64KB/s
    const MAX_LIMIT: u64 = 10 * 1024 * 1024 * 1024; // 10GB/s

    if let Some(limit) = bytes_per_second {
        if !(MIN_LIMIT..=MAX_LIMIT).contains(&limit) {
            return Err(CommandError::validation(format!(
                "Rate limit must be between {} and {} bytes/sec",
                MIN_LIMIT, MAX_LIMIT
            )));
        }
    }

    state
        .download_runtime
        .set_rate_limit(bytes_per_second)
        .await
        .map_err(|error| map_runtime_error("Failed to set rate limit", error))
}

#[command]
pub async fn get_rate_limit(state: State<'_, AppState>) -> Result<Option<u64>, String> {
    let manager = state.download_manager.read().await;
    Ok(manager.get_rate_limit().await)
}
