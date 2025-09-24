//! Integration tests for enhanced progress tracking system
//!
//! These tests validate the complete progress tracking and speed statistics
//! system including real-time updates, statistical analysis, and event emission.

#[cfg(test)]
mod tests {
    use super::super::manager::{DownloadEvent, DownloadManager};
    use super::super::models::{AppResult, DownloadConfig, TaskStatus, VideoTask};
    use super::super::progress_tracker::{EnhancedProgressStats, ProgressTrackingManager};
    use std::sync::Arc;
    use tokio::time::{sleep, Duration};

    /// Test enhanced progress tracking integration with DownloadManager
    #[tokio::test]
    async fn test_progress_tracking_manager_integration() -> AppResult<()> {
        let config = DownloadConfig::default();
        let mut manager = DownloadManager::new(config)?;

        // Start the manager
        manager.start().await?;

        // Test enhanced progress tracking methods
        let stats = manager.get_global_enhanced_stats().await;
        assert_eq!(stats.total_tasks, 0);
        assert_eq!(stats.active_tasks, 0);

        // Test getting enhanced progress for non-existent task
        let progress = manager.get_enhanced_progress("non_existent").await;
        assert!(progress.is_none());

        // Test getting all enhanced progress (should be empty)
        let all_progress = manager.get_all_enhanced_progress().await;
        assert!(all_progress.is_empty());

        manager.stop().await?;

        println!("✅ Progress tracking manager integration test passed");
        Ok(())
    }

    /// Test progress tracking with simulated download
    #[tokio::test]
    async fn test_enhanced_progress_simulation() -> AppResult<()> {
        let manager = ProgressTrackingManager::new();
        let task_id = "test_download_simulation";
        let total_size = 1_000_000u64; // 1MB

        // Start tracking
        manager
            .start_tracking(task_id.to_string(), Some(total_size))
            .await?;

        // Simulate progressive download
        let mut downloaded = 0u64;
        let chunk_size = 50_000u64; // 50KB chunks

        for i in 1..=20 {
            downloaded += chunk_size;
            manager.update_progress(task_id, downloaded).await?;

            // Get current stats
            let stats = manager.get_progress(task_id).await.unwrap();

            // Validate basic stats
            assert_eq!(stats.task_id, task_id);
            assert_eq!(stats.downloaded_bytes, downloaded);
            assert_eq!(stats.total_bytes, Some(total_size));

            // Check progress percentage
            let expected_percent = (downloaded as f64 / total_size as f64) * 100.0;
            assert!((stats.progress_percent - expected_percent).abs() < 0.1);

            // Check that speed is calculated (should be > 0 after first update)
            if i > 1 {
                assert!(stats.current_speed > 0.0);
                assert!(stats.smoothed_speed > 0.0);
                assert!(stats.average_speed > 0.0);
            }

            // Check ETA calculation
            if downloaded < total_size {
                assert!(stats.eta_seconds.is_some());
            }

            // Check statistics
            assert!(stats.statistics.measurement_count > 0);
            assert!(stats.elapsed_time > 0.0);

            // Small delay to simulate real download timing
            sleep(Duration::from_millis(10)).await;
        }

        // Check final stats
        let final_stats = manager.get_progress(task_id).await.unwrap();
        assert_eq!(final_stats.progress_percent, 100.0);
        assert!(final_stats.statistics.peak_speed > 0.0);
        assert!(final_stats.statistics.stability_score <= 1.0);

        // Stop tracking
        manager.stop_tracking(task_id).await?;
        assert!(manager.get_progress(task_id).await.is_none());

        println!("✅ Enhanced progress simulation test passed");
        Ok(())
    }

    /// Test global statistics aggregation
    #[tokio::test]
    async fn test_global_statistics() -> AppResult<()> {
        let manager = ProgressTrackingManager::new();

        // Start tracking multiple tasks
        let tasks = vec![
            ("task_1", 1_000_000u64),
            ("task_2", 2_000_000u64),
            ("task_3", 500_000u64),
        ];

        for (task_id, size) in &tasks {
            manager
                .start_tracking(task_id.to_string(), Some(*size))
                .await?;
            manager.update_progress(task_id, size / 2).await?; // 50% complete
        }

        // Check global stats
        let global_stats = manager.get_global_stats().await;
        assert_eq!(global_stats.total_tasks, 3);
        assert_eq!(global_stats.active_tasks, 3); // All still downloading
        assert_eq!(global_stats.completed_tasks, 0);

        // Total downloaded should be sum of 50% of each task
        let expected_downloaded = 500_000 + 1_000_000 + 250_000;
        assert_eq!(global_stats.total_downloaded_bytes, expected_downloaded);

        // Total size should be sum of all task sizes
        let expected_total_size = 1_000_000 + 2_000_000 + 500_000;
        assert_eq!(global_stats.total_size_bytes, expected_total_size);

        // Complete one task
        manager.update_progress("task_1", 1_000_000).await?;

        // Check updated global stats
        let updated_stats = manager.get_global_stats().await;
        assert_eq!(updated_stats.active_tasks, 2); // One task completed

        // Cleanup
        for (task_id, _) in &tasks {
            manager.stop_tracking(task_id).await?;
        }

        println!("✅ Global statistics test passed");
        Ok(())
    }

    /// Test speed statistics calculation
    #[tokio::test]
    async fn test_speed_statistics() -> AppResult<()> {
        let manager = ProgressTrackingManager::new();
        let task_id = "speed_test";

        manager
            .start_tracking(task_id.to_string(), Some(1_000_000))
            .await?;

        // Simulate variable speed download
        let download_points = vec![
            (0, 0u64),         // Start
            (50, 100_000u64),  // Fast initial speed
            (100, 150_000u64), // Slower
            (150, 250_000u64), // Faster again
            (200, 300_000u64), // Consistent
            (250, 400_000u64), // Consistent
        ];

        for (delay_ms, bytes) in download_points {
            if delay_ms > 0 {
                sleep(Duration::from_millis(delay_ms)).await;
            }
            manager.update_progress(task_id, bytes).await?;

            let stats = manager.get_progress(task_id).await.unwrap();

            // After first update, speed should be calculated
            if bytes > 0 {
                assert!(stats.current_speed >= 0.0); // Can be 0 if very fast
                assert!(stats.average_speed > 0.0);
                assert!(stats.statistics.measurement_count > 0);
            }
        }

        // Check final statistics
        let final_stats = manager.get_progress(task_id).await.unwrap();
        assert!(final_stats.statistics.peak_speed > 0.0);
        assert!(final_stats.statistics.min_speed < f64::MAX);
        assert!(final_stats.statistics.stability_score <= 1.0);
        assert!(!final_stats.speed_history.is_empty());

        manager.stop_tracking(task_id).await?;

        println!("✅ Speed statistics test passed");
        Ok(())
    }

    /// Test error conditions and edge cases
    #[tokio::test]
    async fn test_edge_cases() -> AppResult<()> {
        let manager = ProgressTrackingManager::new();
        let task_id = "edge_case_test";

        // Test updating progress without starting tracking
        manager.update_progress("non_existent_task", 1000).await?; // Should not panic

        // Test with unknown total size
        manager.start_tracking(task_id.to_string(), None).await?;
        manager.update_progress(task_id, 1000).await?;

        let stats = manager.get_progress(task_id).await.unwrap();
        assert_eq!(stats.total_bytes, None);
        assert_eq!(stats.progress_percent, 0.0); // Unknown progress
        assert!(stats.eta_seconds.is_none()); // Can't calculate ETA

        // Test with zero bytes
        manager.update_progress(task_id, 0).await?;
        let zero_stats = manager.get_progress(task_id).await.unwrap();
        assert_eq!(zero_stats.downloaded_bytes, 0);

        // Test stopping non-existent task
        manager.stop_tracking("non_existent").await?; // Should not panic

        manager.stop_tracking(task_id).await?;

        println!("✅ Edge cases test passed");
        Ok(())
    }

    /// Test concurrent access and thread safety
    #[tokio::test]
    async fn test_concurrent_access() -> AppResult<()> {
        let manager = Arc::new(ProgressTrackingManager::new());

        // Start multiple concurrent tracking tasks
        let mut handles = vec![];

        for i in 0..5 {
            let task_id = format!("concurrent_task_{}", i);
            let manager_clone = Arc::clone(&manager);

            let handle = tokio::spawn(async move {
                let _ = manager_clone
                    .start_tracking(task_id.clone(), Some(1_000_000))
                    .await;

                // Simulate concurrent updates
                for j in 1..=10 {
                    let bytes = j * 100_000;
                    let _ = manager_clone.update_progress(&task_id, bytes).await;
                    sleep(Duration::from_millis(1)).await; // Small delay
                }

                let _ = manager_clone.stop_tracking(&task_id).await;
            });

            handles.push(handle);
        }

        // Wait for all concurrent tasks to complete
        for handle in handles {
            handle.await.unwrap();
        }

        // Verify no tasks remain
        let final_stats = manager.get_global_stats().await;
        assert_eq!(final_stats.total_tasks, 0);

        println!("✅ Concurrent access test passed");
        Ok(())
    }

    /// Benchmark performance of progress tracking
    #[tokio::test]
    async fn test_performance_benchmark() -> AppResult<()> {
        let manager = ProgressTrackingManager::new();
        let task_id = "performance_test";

        manager
            .start_tracking(task_id.to_string(), Some(100_000_000))
            .await?; // 100MB

        let start_time = std::time::Instant::now();

        // Simulate high-frequency updates (like a very fast download)
        for i in 1..=1000 {
            let bytes = i * 100_000; // 100KB increments
            manager.update_progress(task_id, bytes).await?;
        }

        let elapsed = start_time.elapsed();
        let updates_per_second = 1000.0 / elapsed.as_secs_f64();

        println!("📊 Performance: {:.0} updates/second", updates_per_second);

        // Verify final state
        let final_stats = manager.get_progress(task_id).await.unwrap();
        assert_eq!(final_stats.downloaded_bytes, 100_000_000);
        assert!(final_stats.statistics.measurement_count > 0);

        manager.stop_tracking(task_id).await?;

        // Performance should be at least 100 updates/second
        assert!(
            updates_per_second > 100.0,
            "Performance too low: {} updates/second",
            updates_per_second
        );

        println!(
            "✅ Performance benchmark passed: {:.0} updates/second",
            updates_per_second
        );
        Ok(())
    }
}
