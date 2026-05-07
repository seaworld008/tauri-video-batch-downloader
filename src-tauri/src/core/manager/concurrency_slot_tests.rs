use tempfile::TempDir;

use super::*;

#[tokio::test]
async fn finished_handle_does_not_free_slot_before_terminal_event_updates_status() -> AppResult<()>
{
    let temp_dir = TempDir::new().unwrap();
    let state_path = temp_dir.path().join("download_state.json");
    let mut config = DownloadConfig::default();
    config.concurrent_downloads = 1;
    config.output_directory = temp_dir.path().to_string_lossy().to_string();

    let mut manager = DownloadManager::new_with_state_path(config, state_path)?;
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    manager.start_with_sender(sender).await?;

    let active_id = manager
        .add_task(
            "https://example.com/active.mp4".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
        )
        .await?;
    let queued_id = manager
        .add_task(
            "https://example.com/queued.mp4".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
        )
        .await?;

    if let Some(task) = manager.tasks.get_mut(&active_id) {
        task.status = TaskStatus::Downloading;
    }
    assert!(
        manager
            .enqueue_task(&queued_id, QUEUE_PRIORITY_DEFAULT)
            .await
    );

    let finished_handle = tokio::spawn(async {});
    tokio::task::yield_now().await;
    manager
        .active_downloads
        .insert(active_id.clone(), finished_handle);

    while receiver.try_recv().is_ok() {}

    assert!(manager.scheduler_tick().await);
    assert_eq!(
        manager.tasks.get(&active_id).map(|task| &task.status),
        Some(&TaskStatus::Downloading)
    );
    assert_eq!(
        manager.tasks.get(&queued_id).map(|task| &task.status),
        Some(&TaskStatus::Pending)
    );
    assert!(manager.active_downloads.contains_key(&active_id));
    {
        let queue = manager.task_queue.lock().await;
        assert!(queue.iter().any(|item| item.task_id == queued_id));
    }

    let completed_path = temp_dir.path().join("active.mp4");
    tokio::fs::write(&completed_path, b"done").await.unwrap();
    manager
        .apply_event_side_effects(&DownloadEvent::TaskCompleted {
            task_id: active_id.clone(),
            file_path: completed_path.to_string_lossy().to_string(),
        })
        .await?;

    assert_eq!(
        manager.tasks.get(&active_id).map(|task| &task.status),
        Some(&TaskStatus::Completed)
    );
    assert_eq!(
        manager.tasks.get(&queued_id).map(|task| &task.status),
        Some(&TaskStatus::Downloading)
    );
    assert!(!manager.active_downloads.contains_key(&active_id));
    assert!(manager.active_downloads.contains_key(&queued_id));

    if let Some(handle) = manager.active_downloads.remove(&queued_id) {
        handle.abort();
    }

    Ok(())
}
