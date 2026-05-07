use std::sync::Arc;

use tempfile::TempDir;
use tokio::sync::RwLock;

use super::*;

#[tokio::test]
async fn runtime_start_rejects_non_startable_statuses() -> AppResult<()> {
    for status in [
        TaskStatus::Downloading,
        TaskStatus::Committing,
        TaskStatus::Completed,
        TaskStatus::Cancelled,
    ] {
        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let mut manager =
            DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)?;
        let task_id = manager
            .add_task(
                format!("https://example.com/{:?}.mp4", status),
                "./downloads".to_string(),
            )
            .await?;

        if let Some(task) = manager.tasks.get_mut(&task_id) {
            task.status = status.clone();
        }

        let manager = Arc::new(RwLock::new(manager));
        let result = DownloadManager::runtime_start_download(&manager, &task_id).await;
        assert!(
            result.is_err(),
            "status {:?} must not be directly startable",
            status
        );
    }

    Ok(())
}

#[tokio::test]
async fn runtime_start_queues_failed_task_and_clears_error_when_full() -> AppResult<()> {
    let temp_dir = TempDir::new().unwrap();
    let state_path = temp_dir.path().join("download_state.json");
    let mut config = DownloadConfig::default();
    config.concurrent_downloads = 0;
    let mut manager = DownloadManager::new_with_state_path(config, state_path)?;

    let task_id = manager
        .add_task(
            "https://example.com/retry-me.mp4".to_string(),
            "./downloads".to_string(),
        )
        .await?;
    if let Some(task) = manager.tasks.get_mut(&task_id) {
        task.status = TaskStatus::Failed;
        task.error_message = Some("temporary network failure".to_string());
    }

    let manager = Arc::new(RwLock::new(manager));
    let result = DownloadManager::runtime_start_download(&manager, &task_id).await;
    assert!(
        matches!(result, Err(AppError::Download(message)) if message.contains("Maximum concurrent downloads"))
    );

    let guard = manager.read().await;
    let task = guard.tasks.get(&task_id).expect("task must exist");
    assert_eq!(task.status, TaskStatus::Pending);
    assert_eq!(task.error_message, None);

    let queue = guard.task_queue.lock().await;
    assert!(queue.iter().any(|queued| queued.task_id == task_id));

    Ok(())
}

#[tokio::test]
async fn runtime_pause_rejects_terminal_and_committing_statuses() -> AppResult<()> {
    for status in [
        TaskStatus::Committing,
        TaskStatus::Completed,
        TaskStatus::Cancelled,
    ] {
        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let mut manager =
            DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)?;
        let task_id = manager
            .add_task(
                format!("https://example.com/pause-{:?}.mp4", status),
                "./downloads".to_string(),
            )
            .await?;
        if let Some(task) = manager.tasks.get_mut(&task_id) {
            task.status = status.clone();
        }

        let manager = Arc::new(RwLock::new(manager));
        let result = DownloadManager::runtime_pause_download(&manager, &task_id).await;
        assert!(result.is_err(), "status {:?} must not be pausable", status);
    }

    Ok(())
}

#[tokio::test]
async fn runtime_pause_pending_task_marks_paused_and_emits_event() -> AppResult<()> {
    let temp_dir = TempDir::new().unwrap();
    let state_path = temp_dir.path().join("download_state.json");
    let mut manager = DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)?;
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    manager.event_sender = Some(sender);

    let task_id = manager
        .add_task(
            "https://example.com/pending-pause.mp4".to_string(),
            "./downloads".to_string(),
        )
        .await?;
    while receiver.try_recv().is_ok() {}

    let manager = Arc::new(RwLock::new(manager));
    DownloadManager::runtime_pause_download(&manager, &task_id).await?;

    let guard = manager.read().await;
    let task = guard.tasks.get(&task_id).expect("task must exist");
    assert_eq!(task.status, TaskStatus::Paused);
    assert!(!task.paused_from_active);
    assert!(task.paused_at.is_some());
    drop(guard);

    assert!(matches!(
        receiver.try_recv(),
        Ok(DownloadEvent::TaskPaused { task_id: emitted }) if emitted == task_id
    ));

    Ok(())
}

#[tokio::test]
async fn runtime_resume_rejects_terminal_and_committing_statuses() -> AppResult<()> {
    for status in [
        TaskStatus::Committing,
        TaskStatus::Completed,
        TaskStatus::Cancelled,
    ] {
        let temp_dir = TempDir::new().unwrap();
        let state_path = temp_dir.path().join("download_state.json");
        let mut manager =
            DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)?;
        let task_id = manager
            .add_task(
                format!("https://example.com/resume-{:?}.mp4", status),
                "./downloads".to_string(),
            )
            .await?;
        if let Some(task) = manager.tasks.get_mut(&task_id) {
            task.status = status.clone();
        }

        let manager = Arc::new(RwLock::new(manager));
        let result = DownloadManager::runtime_resume_download(&manager, &task_id).await;
        assert!(result.is_err(), "status {:?} must not be resumable", status);
    }

    Ok(())
}

#[tokio::test]
async fn runtime_resume_paused_task_queues_when_slots_full() -> AppResult<()> {
    let temp_dir = TempDir::new().unwrap();
    let state_path = temp_dir.path().join("download_state.json");
    let mut config = DownloadConfig::default();
    config.concurrent_downloads = 0;
    let mut manager = DownloadManager::new_with_state_path(config, state_path)?;

    let task_id = manager
        .add_task(
            "https://example.com/paused-resume.mp4".to_string(),
            "./downloads".to_string(),
        )
        .await?;
    if let Some(task) = manager.tasks.get_mut(&task_id) {
        task.status = TaskStatus::Paused;
        task.paused_at = Some(chrono::Utc::now());
        task.paused_from_active = true;
    }

    let manager = Arc::new(RwLock::new(manager));
    let result = DownloadManager::runtime_resume_download(&manager, &task_id).await;
    assert!(
        matches!(result, Err(AppError::Download(message)) if message.contains("Maximum concurrent downloads"))
    );

    let guard = manager.read().await;
    assert_eq!(
        guard.tasks.get(&task_id).map(|task| &task.status),
        Some(&TaskStatus::Paused)
    );
    let queue = guard.task_queue.lock().await;
    assert!(queue.iter().any(|queued| queued.task_id == task_id));

    Ok(())
}

#[tokio::test]
async fn runtime_start_paused_active_task_resumes_existing_worker() -> AppResult<()> {
    let temp_dir = TempDir::new().unwrap();
    let state_path = temp_dir.path().join("download_state.json");
    let mut manager = DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)?;

    let task_id = manager
        .add_task(
            "https://example.com/paused-active.mp4".to_string(),
            "./downloads".to_string(),
        )
        .await?;
    if let Some(task) = manager.tasks.get_mut(&task_id) {
        task.status = TaskStatus::Paused;
        task.paused_at = Some(chrono::Utc::now());
        task.paused_from_active = true;
    }

    let handle = tokio::spawn(async {
        std::future::pending::<()>().await;
    });
    manager.active_downloads.insert(task_id.clone(), handle);

    let manager = Arc::new(RwLock::new(manager));
    DownloadManager::runtime_start_download(&manager, &task_id).await?;

    let mut guard = manager.write().await;
    let task = guard.tasks.get(&task_id).expect("task must exist");
    assert_eq!(task.status, TaskStatus::Downloading);
    assert_eq!(task.paused_at, None);
    assert!(!task.paused_from_active);

    if let Some(handle) = guard.active_downloads.remove(&task_id) {
        handle.abort();
    }

    Ok(())
}

#[tokio::test]
async fn runtime_cancel_queued_task_removes_queue_entry_and_emits_event() -> AppResult<()> {
    let temp_dir = TempDir::new().unwrap();
    let state_path = temp_dir.path().join("download_state.json");
    let mut manager = DownloadManager::new_with_state_path(DownloadConfig::default(), state_path)?;
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    manager.event_sender = Some(sender);

    let task_id = manager
        .add_task(
            "https://example.com/queued-cancel.mp4".to_string(),
            "./downloads".to_string(),
        )
        .await?;
    assert!(manager.enqueue_task(&task_id, 5).await);
    while receiver.try_recv().is_ok() {}

    let manager = Arc::new(RwLock::new(manager));
    DownloadManager::runtime_cancel_download(&manager, &task_id).await?;

    let guard = manager.read().await;
    assert_eq!(
        guard.tasks.get(&task_id).map(|task| &task.status),
        Some(&TaskStatus::Cancelled)
    );
    let queue = guard.task_queue.lock().await;
    assert!(!queue.iter().any(|queued| queued.task_id == task_id));
    drop(queue);
    drop(guard);

    assert!(matches!(
        receiver.try_recv(),
        Ok(DownloadEvent::TaskCancelled { task_id: emitted }) if emitted == task_id
    ));

    Ok(())
}
