//! Download management commands
use tauri::Emitter;

use tauri::{command, State};

use crate::{core::models::*, AppState};

/// 调试命令：测试下载系统是否工作
#[command]
pub async fn debug_download_test(
    task_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    tracing::info!("🧪 [DEBUG_TEST] Starting debug test for task: {}", task_id);

    // 1. 检查 manager 是否可访问
    let manager_check = {
        let manager = state.download_manager.read().await;
        format!("Manager is_running: {}", manager.is_running())
    };
    tracing::info!("🧪 [DEBUG_TEST] {}", manager_check);

    // 2. 检查 event_sender 是否设置
    let event_sender_check = {
        let manager = state.download_manager.read().await;
        if manager.has_event_sender() {
            "event_sender: SET ✅".to_string()
        } else {
            "event_sender: NOT SET ❌".to_string()
        }
    };
    tracing::info!("🧪 [DEBUG_TEST] {}", event_sender_check);

    // 3. 检查任务是否存在
    let task_check = {
        let manager = state.download_manager.read().await;
        let tasks = manager.get_tasks().await;
        match tasks.iter().find(|t| t.id == task_id) {
            Some(task) => format!("Task found: status={:?}, url={}", task.status, task.url),
            None => format!("Task NOT FOUND ❌ (total tasks: {})", tasks.len()),
        }
    };
    tracing::info!("🧪 [DEBUG_TEST] {}", task_check);

    // 4. 尝试发送一个测试事件到前端
    let emit_result = app_handle.emit(
        "debug_test_event",
        serde_json::json!({
            "message": "Debug test from backend",
            "task_id": task_id
        }),
    );
    let emit_check = match emit_result {
        Ok(_) => "Emit test: SUCCESS ✅".to_string(),
        Err(e) => format!("Emit test: FAILED ❌ - {}", e),
    };
    tracing::info!("🧪 [DEBUG_TEST] {}", emit_check);

    // 返回所有检查结果
    let result = format!(
        "Debug Results:\n{}\n{}\n{}\n{}",
        manager_check, event_sender_check, task_check, emit_check
    );

    Ok(result)
}

#[command]
pub async fn add_download_tasks(
    tasks: Vec<VideoTask>,
    state: State<'_, AppState>,
) -> Result<Vec<VideoTask>, String> {
    let mut manager = state.download_manager.write().await;

    let mut created_tasks = Vec::new();
    let mut reused_tasks = Vec::new();
    let mut failed_tasks = Vec::new();

    for task in tasks {
        // 尝试添加任务到管理器，处理重复项
        match manager.add_video_task(task.clone()).await {
            Ok(result) => {
                if result.created {
                    created_tasks.push(result.task);
                } else {
                    reused_tasks.push(result.task);
                }
            }
            Err(e) => {
                failed_tasks.push(format!("{}: {}", task.title, e));
                tracing::error!("Failed to add task {}: {}", task.title, e);
            }
        }
    }

    // 创建详细的日志信息
    if !reused_tasks.is_empty() {
        tracing::info!("Reused {} existing tasks", reused_tasks.len());
    }
    if !failed_tasks.is_empty() {
        tracing::warn!(
            "Failed to add {} tasks: {:?}",
            failed_tasks.len(),
            failed_tasks
        );
    }

    tracing::info!(
        "Successfully created {} download tasks (reused {}, {} failed)",
        created_tasks.len(),
        reused_tasks.len(),
        failed_tasks.len()
    );

    // 即使有一些失败或重复，也返回成功创建的任务
    created_tasks.extend(reused_tasks);
    Ok(created_tasks)
}

#[command]
pub async fn start_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!(
        "[START_DOWNLOAD_CMD] Starting download for task: {}",
        task_id
    );

    // 统一走 runtime 命令队列，避免在 Tauri 命令线程中持有写锁跨 await。
    let result = state.download_runtime.start_task(task_id.clone()).await;

    match result {
        Ok(_) => {
            tracing::info!(
                "[START_DOWNLOAD_CMD] ✅ Download started successfully for task: {}",
                task_id
            );
            Ok(())
        }
        Err(e) => {
            tracing::error!(
                "[START_DOWNLOAD_CMD] ❌ Failed to start download for {}: {}",
                task_id,
                e
            );
            Err(format!("Failed to start download: {}", e))
        }
    }
}

#[command]
pub async fn pause_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("[PAUSE_CMD] Received pause request for task: {}", task_id);

    // 统一走 runtime 命令队列，避免在 Tauri 命令线程中持有写锁跨 await。
    let result = state.download_runtime.pause_task(task_id.clone()).await;

    match result {
        Ok(_) => {
            tracing::info!("[PAUSE_CMD] ✅ Successfully paused task: {}", task_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("[PAUSE_CMD] ❌ Failed to pause task {}: {}", task_id, e);
            Err(format!("Failed to pause download: {}", e))
        }
    }
}

#[command]
pub async fn resume_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("[RESUME_CMD] Resuming download for task: {}", task_id);

    // 统一走 runtime 命令队列，避免在 Tauri 命令线程中持有写锁跨 await。
    let result = state.download_runtime.resume_task(task_id.clone()).await;

    match result {
        Ok(_) => {
            tracing::info!("[RESUME_CMD] ✅ Download resumed for task: {}", task_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("[RESUME_CMD] ❌ Failed to resume download: {}", e);
            Err(format!("Failed to resume download: {}", e))
        }
    }
}

#[command]
pub async fn cancel_download(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    tracing::info!("[CANCEL_CMD] Cancelling download for task: {}", task_id);

    // 统一走 runtime 命令队列，避免在 Tauri 命令线程中持有写锁跨 await。
    let result = state.download_runtime.cancel_task(task_id.clone()).await;

    match result {
        Ok(_) => {
            tracing::info!("[CANCEL_CMD] ✅ Download cancelled for task: {}", task_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to cancel download: {}", e);
            Err(format!("Failed to cancel download: {}", e))
        }
    }
}

#[command]
pub async fn pause_all_downloads(state: State<'_, AppState>) -> Result<usize, String> {
    tracing::info!("[PAUSE_ALL_CMD] Pausing all active downloads");
    state.download_runtime.pause_all().await.map_err(|e| {
        tracing::error!("[PAUSE_ALL_CMD] ❌ Failed to pause all downloads: {}", e);
        e.to_string()
    })
}

#[command]
pub async fn resume_all_downloads(state: State<'_, AppState>) -> Result<usize, String> {
    tracing::info!("[RESUME_ALL_CMD] Resuming all paused downloads");
    state.download_runtime.resume_all().await.map_err(|e| {
        tracing::error!("[RESUME_ALL_CMD] ❌ Failed to resume all downloads: {}", e);
        e.to_string()
    })
}

/// Start all downloads (backend decides resume paused vs start pending)
#[command]
pub async fn start_all_downloads(state: State<'_, AppState>) -> Result<usize, String> {
    tracing::info!("[START_ALL_CMD] Starting downloads with backend policy");
    state.download_runtime.start_all().await.map_err(|e| {
        tracing::error!("[START_ALL_CMD] ❌ Failed to start all downloads: {}", e);
        e.to_string()
    })
}

/// Start all pending/failed downloads respecting concurrency limit
#[command]
pub async fn start_all_pending_downloads(state: State<'_, AppState>) -> Result<usize, String> {
    tracing::info!("[START_ALL_CMD] Starting all pending/failed downloads");
    let mut manager = state.download_manager.write().await;
    manager.start_all_pending_impl().await.map_err(|e| {
        tracing::error!(
            "[START_ALL_CMD] ❌ Failed to start all pending downloads: {}",
            e
        );
        e.to_string()
    })
}

#[command]
pub async fn cancel_all_downloads(state: State<'_, AppState>) -> Result<usize, String> {
    tracing::info!("[CANCEL_ALL_CMD] Cancelling all in-flight downloads");
    state.download_runtime.cancel_all().await.map_err(|e| {
        tracing::error!("[CANCEL_ALL_CMD] ❌ Failed to cancel all downloads: {}", e);
        e.to_string()
    })
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
    let mut removed_count = 0;

    for task_id in task_ids {
        // 每个任务独立短持锁，避免批量删除时长时间阻塞其它命令。
        let removed = {
            let mut manager = state.download_manager.write().await;

            // 取消正在进行的下载
            if manager.is_task_active(&task_id).await {
                if let Err(e) = manager.cancel_download(&task_id).await {
                    tracing::warn!("Failed to cancel active download {}: {}", task_id, e);
                }
            }

            // 从任务存储中移除
            match manager.remove_task(&task_id).await {
                Ok(()) => {
                    tracing::info!("Successfully removed task: {}", task_id);
                    true
                }
                Err(e) => {
                    tracing::warn!("Failed to remove task {}: {}", task_id, e);
                    false
                }
            }
        };

        if removed {
            removed_count += 1;
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
    let mut manager = state.download_manager.write().await;

    let failed_task_ids: Vec<String> = manager
        .get_tasks()
        .await
        .into_iter()
        .filter(|task| task.status == TaskStatus::Failed)
        .map(|task| task.id.clone())
        .collect();

    if failed_task_ids.is_empty() {
        tracing::info!("No failed tasks to retry");
        return Ok(());
    }

    tracing::info!("Retrying {} failed tasks", failed_task_ids.len());

    manager
        .retry_failed()
        .await
        .map_err(|e| format!("Failed to reset failed tasks: {}", e))?;

    let mut started = 0usize;
    let mut start_errors = Vec::new();

    for task_id in failed_task_ids {
        match manager.start_download(&task_id).await {
            Ok(_) => {
                started += 1;
                tracing::info!("Restarted download for task: {}", task_id);
            }
            Err(err) => {
                tracing::warn!("Failed to restart task {}: {}", task_id, err);
                start_errors.push(format!("{}: {}", task_id, err));
            }
        }
    }

    if !start_errors.is_empty() {
        return Err(format!(
            "Restarted {} tasks, but {} failed to start: {}",
            started,
            start_errors.len(),
            start_errors.join(", ")
        ));
    }

    Ok(())
}

#[command]
pub async fn set_rate_limit(
    bytes_per_second: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Option<u64>, String> {
    const MIN_LIMIT: u64 = 64 * 1024; // 64KB/s
    const MAX_LIMIT: u64 = 10 * 1024 * 1024 * 1024; // 10GB/s

    if let Some(limit) = bytes_per_second {
        if !(MIN_LIMIT..=MAX_LIMIT).contains(&limit) {
            return Err(format!(
                "Rate limit must be between {} and {} bytes/sec",
                MIN_LIMIT, MAX_LIMIT
            ));
        }
    }

    let manager = state.download_manager.read().await;
    manager.set_rate_limit(bytes_per_second).await;
    let applied = manager.get_rate_limit().await;
    Ok(applied)
}

#[command]
pub async fn get_rate_limit(state: State<'_, AppState>) -> Result<Option<u64>, String> {
    let manager = state.download_manager.read().await;
    Ok(manager.get_rate_limit().await)
}
