//! Download management commands

use serde::Deserialize;
use tauri::{command, State};
use uuid::Uuid;

use crate::{core::models::*, AppState};

#[command]
pub async fn add_download_tasks(
    tasks: Vec<VideoTask>,
    state: State<'_, AppState>,
) -> Result<Vec<VideoTask>, String> {
    let mut manager = state.download_manager.write().await;

    let mut created_tasks = Vec::new();
    let mut skipped_duplicates = Vec::new();
    let mut failed_tasks = Vec::new();

    for task in tasks {
        // 尝试添加任务到管理器，处理重复项
        match manager.add_video_task(task.clone()).await {
            Ok(()) => {
                created_tasks.push(task);
            }
            Err(AppError::Config(msg)) if msg.contains("Duplicate task") => {
                skipped_duplicates.push(task.title.clone());
                tracing::warn!("Skipped duplicate task: {} ({})", task.title, task.url);
            }
            Err(e) => {
                failed_tasks.push(format!("{}: {}", task.title, e));
                tracing::error!("Failed to add task {}: {}", task.title, e);
            }
        }
    }

    // 创建详细的日志信息
    if !skipped_duplicates.is_empty() {
        tracing::info!(
            "Skipped {} duplicate tasks: {:?}",
            skipped_duplicates.len(),
            skipped_duplicates
        );
    }
    if !failed_tasks.is_empty() {
        tracing::warn!(
            "Failed to add {} tasks: {:?}",
            failed_tasks.len(),
            failed_tasks
        );
    }

    tracing::info!(
        "Successfully created {} download tasks (skipped {} duplicates, {} failed)",
        created_tasks.len(),
        skipped_duplicates.len(),
        failed_tasks.len()
    );

    // 即使有一些失败或重复，也返回成功创建的任务
    Ok(created_tasks)
}

#[command]
pub async fn start_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Starting download for task: {}", task_id);

    // 使用DownloadManager的异步start_download方法
    let mut manager = state.download_manager.write().await;

    match manager.start_download(&task_id).await {
        Ok(_) => {
            tracing::info!("Download started for task: {}", task_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to start download: {}", e);
            Err(format!("Failed to start download: {}", e))
        }
    }
}

#[command]
pub async fn pause_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Pausing download for task: {}", task_id);

    let mut manager = state.download_manager.write().await;

    match manager.pause_download(&task_id).await {
        Ok(_) => {
            tracing::info!("Download paused for task: {}", task_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to pause download: {}", e);
            Err(format!("Failed to pause download: {}", e))
        }
    }
}

#[command]
pub async fn resume_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Resuming download for task: {}", task_id);

    let mut manager = state.download_manager.write().await;

    match manager.resume_download(&task_id).await {
        Ok(_) => {
            tracing::info!("Download resumed for task: {}", task_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to resume download: {}", e);
            Err(format!("Failed to resume download: {}", e))
        }
    }
}

#[command]
pub async fn cancel_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("Cancelling download for task: {}", task_id);

    let mut manager = state.download_manager.write().await;

    match manager.cancel_download(&task_id).await {
        Ok(_) => {
            tracing::info!("Download cancelled for task: {}", task_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to cancel download: {}", e);
            Err(format!("Failed to cancel download: {}", e))
        }
    }
}

#[command]
pub async fn remove_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut manager = state.download_manager.write().await;

    // 取消正在进行的下载
    if manager.is_task_active(&task_id).await {
        manager
            .cancel_download(&task_id)
            .await
            .map_err(|e| format!("Failed to cancel active download: {}", e))?;
    }

    // 从任务存储中移除
    manager
        .remove_task(&task_id)
        .await
        .map_err(|e| format!("Failed to remove task: {}", e))?;

    tracing::info!("Successfully removed task: {}", task_id);

    Ok(())
}

#[command]
pub async fn remove_download_tasks(
    task_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut manager = state.download_manager.write().await;

    let mut removed_count = 0;

    for task_id in task_ids {
        // 取消正在进行的下载
        if manager.is_task_active(&task_id).await {
            if let Err(e) = manager.cancel_download(&task_id).await {
                tracing::warn!("Failed to cancel active download {}: {}", task_id, e);
            }
        }

        // 从任务存储中移除
        match manager.remove_task(&task_id).await {
            Ok(()) => {
                removed_count += 1;
                tracing::info!("Successfully removed task: {}", task_id);
            }
            Err(e) => {
                tracing::warn!("Failed to remove task {}: {}", task_id, e);
            }
        }
    }

    tracing::info!("Successfully removed {} tasks", removed_count);
    Ok(())
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
    let mut manager = state.download_manager.write().await;

    // 获取所有已完成的任务ID
    let completed_task_ids: Vec<String> = manager
        .get_tasks()
        .await
        .into_iter()
        .filter(|task| task.status == TaskStatus::Completed)
        .map(|task| task.id)
        .collect();

    // 批量删除已完成的任务
    for task_id in &completed_task_ids {
        manager
            .remove_task(task_id)
            .await
            .map_err(|e| format!("Failed to remove completed task {}: {}", task_id, e))?;
    }

    tracing::info!(
        "Successfully cleared {} completed tasks",
        completed_task_ids.len()
    );

    Ok(())
}

#[command]
pub async fn retry_failed_tasks(state: State<'_, AppState>) -> Result<(), String> {
    let _manager = state.download_manager.write().await;

    // TODO: Restart failed tasks
    tracing::info!("Retrying failed tasks");

    Ok(())
}

/// Request structure for creating new download tasks
#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub url: String,
    pub title: String,
    pub output_path: String,

    // 保存完整的视频信息供后续使用
    pub video_info: Option<crate::core::models::VideoInfo>,
}
