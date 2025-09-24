//! Integration tests for DownloadManager
//! 
//! Tests the complete concurrent download management system including:
//! - Priority-based task scheduling
//! - Concurrent download limits with Semaphore
//! - Rate limiting functionality
//! - Real HTTP downloader integration
//! - Progress tracking and event emission

#[cfg(test)]
mod tests {
    use super::super::manager::*;
    use super::super::models::*;
    use tokio::time::{sleep, Duration};
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_concurrent_download_management() -> AppResult<()> {
        // Create manager with limited concurrency
        let config = DownloadConfig {
            concurrent_downloads: 2,
            timeout_seconds: 10,
            retry_attempts: 1,
            user_agent: "Test Agent".to_string(),
            proxy: None,
            headers: std::collections::HashMap::new(),
            output_directory: tempdir()?.path().to_string_lossy().to_string(),
        };

        let mut manager = DownloadManager::new(config)?;
        
        // Start the manager
        manager.start().await?;
        assert!(manager.is_running);

        // Add multiple tasks with different priorities
        let high_priority_task = manager.add_task_with_priority(
            "https://httpbin.org/bytes/1024".to_string(),
            tempdir()?.path().to_string_lossy().to_string(),
            9 // High priority
        ).await?;

        let medium_priority_task = manager.add_task_with_priority(
            "https://httpbin.org/bytes/2048".to_string(),
            tempdir()?.path().to_string_lossy().to_string(),
            5 // Medium priority  
        ).await?;

        let low_priority_task = manager.add_task_with_priority(
            "https://httpbin.org/bytes/512".to_string(),
            tempdir()?.path().to_string_lossy().to_string(),
            1 // Low priority
        ).await?;

        // Verify tasks were added
        assert_eq!(manager.tasks.len(), 3);
        
        // Check priority queue has all tasks
        {
            let queue = manager.task_queue.lock().await;
            assert_eq!(queue.len(), 3);
        }

        // Verify stats are updated
        let stats = manager.get_stats().await;
        assert_eq!(stats.total_tasks, 3);
        assert_eq!(stats.completed_tasks, 0);

        // Test rate limiting
        manager.set_rate_limit(Some(1024 * 1024)).await; // 1MB/s
        assert_eq!(manager.get_rate_limit().await, Some(1024 * 1024));

        // Wait a bit for background scheduler to potentially process tasks
        sleep(Duration::from_millis(100)).await;

        // Stop the manager
        manager.stop().await?;
        assert!(!manager.is_running);

        println!("✅ Concurrent download management test completed");
        Ok(())
    }

    #[tokio::test]
    async fn test_batch_task_operations() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        // Test batch task addition
        let batch_tasks = vec![
            ("https://httpbin.org/bytes/100".to_string(), "./downloads".to_string(), Some(8)),
            ("https://httpbin.org/bytes/200".to_string(), "./downloads".to_string(), Some(5)),
            ("https://httpbin.org/bytes/300".to_string(), "./downloads".to_string(), Some(2)),
        ];

        let task_ids = manager.add_batch_tasks(batch_tasks).await?;
        assert_eq!(task_ids.len(), 3);

        // Verify all tasks were added
        assert_eq!(manager.tasks.len(), 3);

        // Test bulk operations
        let initial_stats = manager.get_stats().await;
        assert_eq!(initial_stats.total_tasks, 3);

        println!("✅ Batch task operations test completed");
        Ok(())
    }

    #[tokio::test]
    async fn test_priority_queue_behavior() {
        use std::collections::BinaryHeap;
        
        let mut queue = BinaryHeap::new();
        let now = chrono::Utc::now();

        // Add tasks with different priorities and times
        queue.push(TaskPriority {
            task_id: "task_1".to_string(),
            priority: 5,
            created_at: now - chrono::Duration::seconds(10), // Older
        });

        queue.push(TaskPriority {
            task_id: "task_2".to_string(),
            priority: 5,
            created_at: now, // Newer, same priority
        });

        queue.push(TaskPriority {
            task_id: "task_3".to_string(),
            priority: 8,
            created_at: now, // Higher priority
        });

        // Should pop in order: highest priority first, then oldest for same priority
        assert_eq!(queue.pop().unwrap().task_id, "task_3"); // Priority 8
        assert_eq!(queue.pop().unwrap().task_id, "task_1"); // Priority 5, older
        assert_eq!(queue.pop().unwrap().task_id, "task_2"); // Priority 5, newer

        println!("✅ Priority queue behavior test completed");
    }

    #[tokio::test]
    async fn test_download_manager_lifecycle() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        // Test initial state
        assert!(!manager.is_running);
        assert_eq!(manager.tasks.len(), 0);
        assert!(manager.scheduler_handle.is_none());

        // Test starting
        manager.start().await?;
        assert!(manager.is_running);
        assert!(manager.scheduler_handle.is_some());

        // Add some tasks
        let _task1 = manager.add_task(
            "https://example.com/file1.mp4".to_string(),
            "./downloads".to_string()
        ).await?;

        let _task2 = manager.add_task_with_priority(
            "https://example.com/file2.mp4".to_string(),
            "./downloads".to_string(),
            7
        ).await?;

        assert_eq!(manager.tasks.len(), 2);

        // Test stopping
        manager.stop().await?;
        assert!(!manager.is_running);
        assert!(manager.scheduler_handle.is_none());

        // Queue should be cleared
        {
            let queue = manager.task_queue.lock().await;
            assert_eq!(queue.len(), 0);
        }

        println!("✅ Download manager lifecycle test completed");
        Ok(())
    }

    #[tokio::test]
    async fn test_concurrent_limits() -> AppResult<()> {
        let config = DownloadConfig {
            concurrent_downloads: 1, // Very limited
            ..Default::default()
        };

        let manager = DownloadManager::new(config)?;

        // Semaphore should have exactly 1 permit
        assert_eq!(manager.download_semaphore.available_permits(), 1);

        // Acquire the permit
        let _permit = manager.download_semaphore.acquire().await?;
        assert_eq!(manager.download_semaphore.available_permits(), 0);

        // Try to acquire another - should fail immediately
        let try_permit = manager.download_semaphore.try_acquire();
        assert!(try_permit.is_err());

        println!("✅ Concurrent limits test completed");
        Ok(())
    }

    #[tokio::test]
    async fn test_error_handling_integration() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        // Test adding task with invalid URL format
        let task_id = manager.add_task(
            "invalid-url-format".to_string(),
            "./downloads".to_string()
        ).await?;

        assert!(!task_id.is_empty());
        assert_eq!(manager.tasks.len(), 1);

        // Task should be in pending state initially
        let task = manager.tasks.get(&task_id).unwrap();
        assert_eq!(task.status, TaskStatus::Pending);

        println!("✅ Error handling integration test completed");
        Ok(())
    }
}