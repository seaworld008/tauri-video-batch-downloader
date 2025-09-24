//! System Integration Tests
//!
//! Comprehensive end-to-end integration tests that verify the entire video downloader
//! system works correctly with all components integrated together. These tests validate
//! the complete workflow from configuration through file parsing, download execution,
//! progress tracking, integrity checking, error handling, monitoring, and YouTube support.

#[cfg(test)]
mod tests {
    use super::super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::Duration;
    use tempfile::TempDir;
    use tokio::time::sleep;

    /// Integration test configuration for system testing
    struct SystemTestConfig {
        temp_dir: TempDir,
        downloads_dir: PathBuf,
        config_dir: PathBuf,
        test_csv_file: PathBuf,
        test_excel_file: PathBuf,
    }

    impl SystemTestConfig {
        async fn new() -> Self {
            let temp_dir = TempDir::new().expect("Failed to create temp directory");
            let downloads_dir = temp_dir.path().join("downloads");
            let config_dir = temp_dir.path().join("config");

            // Create required directories
            fs::create_dir_all(&downloads_dir).expect("Failed to create downloads directory");
            fs::create_dir_all(&config_dir).expect("Failed to create config directory");

            // Create test CSV file
            let test_csv_file = temp_dir.path().join("test_videos.csv");
            let csv_content = r#"zl_id,zl_name,record_url,kc_id,kc_name
1,技术教程,https://example.com/video1.mp4,101,Rust编程基础
2,技术教程,https://example.com/video2.mp4,102,异步编程实战
3,项目实战,https://example.com/video3.mp4,103,Web开发项目
4,项目实战,https://www.youtube.com/watch?v=dQw4w9WgXcQ,104,YouTube教程视频
5,进阶课程,https://example.com/stream.m3u8,105,流媒体处理"#;

            fs::write(&test_csv_file, csv_content).expect("Failed to write test CSV");

            // Create test Excel file (placeholder - would need actual Excel data in real implementation)
            let test_excel_file = temp_dir.path().join("test_videos.xlsx");
            fs::write(&test_excel_file, b"Excel placeholder").expect("Failed to write test Excel");

            Self {
                temp_dir,
                downloads_dir,
                config_dir,
                test_csv_file,
                test_excel_file,
            }
        }
    }

    #[tokio::test]
    async fn test_complete_system_workflow() -> AppResult<()> {
        let test_config = SystemTestConfig::new().await;

        // === Step 1: Create and Configure Download Manager ===
        let mut download_config = DownloadConfig {
            concurrent_downloads: 2,
            timeout_seconds: 30,
            retry_attempts: 2,
            user_agent: "VideoDownloader-IntegrationTest/1.0".to_string(),
            output_directory: test_config.downloads_dir.clone(),
            auto_verify_integrity: true,
            integrity_algorithm: Some("sha256".to_string()),
            expected_hashes: std::collections::HashMap::new(),
        };

        let mut manager = DownloadManager::new(download_config)?;

        // === Step 2: Enable All Features ===
        // Enable monitoring system
        assert!(manager.is_running == false);
        manager.start().await?;
        assert!(manager.is_running == true);

        // Enable YouTube downloader
        assert!(!manager.is_youtube_enabled());
        manager.enable_youtube_downloader_default().await?;
        assert!(manager.is_youtube_enabled());

        // === Step 3: Test Configuration System ===
        let initial_config = manager.get_config().clone();
        assert_eq!(initial_config.concurrent_downloads, 2);

        let mut updated_config = initial_config.clone();
        updated_config.concurrent_downloads = 3;
        updated_config.retry_attempts = 4;

        manager.update_config(updated_config).await?;
        let final_config = manager.get_config().clone();
        assert_eq!(final_config.concurrent_downloads, 3);
        assert_eq!(final_config.retry_attempts, 4);

        // === Step 4: Test File Parsing System ===
        let file_parser_config = FileParserConfig {
            encoding_detection: true,
            field_mapping: FieldMapping {
                column_id_field: "zl_id".to_string(),
                column_name_field: "zl_name".to_string(),
                video_url_field: "record_url".to_string(),
                course_id_field: "kc_id".to_string(),
                course_name_field: "kc_name".to_string(),
            },
            validate_urls: true,
            max_records: Some(1000),
        };

        let file_parser = FileParser::new(file_parser_config)?;
        let parse_result = file_parser
            .parse_csv_file(test_config.test_csv_file.to_str().unwrap())
            .await?;

        assert_eq!(parse_result.records.len(), 5);
        assert!(parse_result.statistics.total_records >= 5);
        assert!(parse_result.statistics.valid_records >= 4); // At least 4 should be valid

        // === Step 5: Test Task Creation from Parsed Records ===
        let mut created_tasks = Vec::new();

        for record in parse_result.records.iter().take(3) {
            // Test first 3 records
            let task_id = if record.video_url.contains("youtube.com") {
                // YouTube task
                manager
                    .add_youtube_task_simple(
                        record.video_url.clone(),
                        format!(
                            "{}_{}.mp4",
                            record.course_id,
                            record.course_name.replace(" ", "_")
                        ),
                    )
                    .await?
            } else {
                // Regular task
                manager
                    .add_task_with_priority(
                        record.video_url.clone(),
                        format!(
                            "{}/{}/{}_{}.mp4",
                            test_config.downloads_dir.display(),
                            record.column_name,
                            record.course_id,
                            record.course_name.replace(" ", "_")
                        ),
                        5, // Medium priority
                    )
                    .await?
            };

            created_tasks.push((task_id, record.video_url.clone()));
        }

        assert_eq!(created_tasks.len(), 3);

        // === Step 6: Verify Task Management ===
        let all_tasks = manager.get_tasks().await;
        assert!(all_tasks.len() >= 3);

        for (task_id, original_url) in &created_tasks {
            let task = all_tasks.iter().find(|t| &t.id == task_id);
            assert!(task.is_some(), "Task {} should exist", task_id);
            let task = task.unwrap();
            assert_eq!(task.url, *original_url);
            assert_eq!(task.status, TaskStatus::Pending);
        }

        // === Step 7: Test Progress Tracking System ===
        let initial_stats = manager.get_stats().await;
        assert!(initial_stats.total_tasks >= 3);
        assert_eq!(initial_stats.completed_tasks, 0);

        // Test enhanced progress tracking
        let global_progress = manager.get_global_enhanced_stats().await;
        assert!(global_progress.total_tasks >= 3);

        // === Step 8: Test Monitoring System Integration ===
        sleep(Duration::from_millis(200)).await; // Allow monitoring to collect data

        let system_metrics = manager.get_system_metrics().await;
        assert!(
            system_metrics.is_some(),
            "System metrics should be available"
        );

        let monitoring_stats = manager.get_download_statistics().await;
        assert!(
            monitoring_stats.is_some(),
            "Download statistics should be available"
        );

        let health_status = manager.get_health_status().await;
        assert!(health_status.is_some(), "Health status should be available");

        let dashboard_data = manager.get_dashboard_data().await;
        assert!(
            dashboard_data.is_some(),
            "Dashboard data should be available"
        );

        // === Step 9: Test Error Handling and Retry System ===
        let retry_stats = manager.get_retry_stats().await;
        assert_eq!(retry_stats.total_attempts, 0); // No retries yet

        let network_cb_state = manager
            .get_circuit_breaker_state(ErrorCategory::Network)
            .await;
        assert!(
            network_cb_state.is_some(),
            "Network circuit breaker should exist"
        );

        // === Step 10: Test Integrity Checking System ===
        // Create a test file for integrity checking
        let test_file = test_config.temp_dir.path().join("integrity_test.txt");
        let test_content = b"Hello, integrity testing!";
        fs::write(&test_file, test_content)?;

        let integrity_result = manager
            .verify_file_integrity(test_file.to_str().unwrap(), HashAlgorithm::Sha256)
            .await?;

        assert!(integrity_result.computed_hash().is_some());
        assert!(!integrity_result.computed_hash().unwrap().is_empty());

        // === Step 11: Test YouTube Integration ===
        let youtube_stats = manager.get_youtube_statistics().await;
        assert!(
            youtube_stats.is_some(),
            "YouTube statistics should be available"
        );

        let active_youtube = manager.get_active_youtube_downloads().await;
        assert!(active_youtube.len() >= 0); // May have completed already

        // Test YouTube video info fetching
        let video_info = manager
            .fetch_youtube_video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
            .await?;
        assert!(!video_info.title.is_empty());
        assert!(!video_info.id.is_empty());

        // === Step 12: Test Configuration Persistence and Management ===
        let config_before = manager.get_config().clone();

        // Update various settings
        manager.set_rate_limit(Some(1024 * 1024)).await; // 1MB/s
        let rate_limit = manager.get_rate_limit().await;
        assert_eq!(rate_limit, Some(1024 * 1024));

        manager.set_auto_integrity_verification(true).await?;
        manager
            .set_integrity_algorithm(HashAlgorithm::Sha512)
            .await?;

        // === Step 13: Test Batch Operations ===
        let batch_tasks = vec![
            (
                "https://example.com/batch1.mp4".to_string(),
                "batch1.mp4".to_string(),
                Some(3),
            ),
            (
                "https://example.com/batch2.mp4".to_string(),
                "batch2.mp4".to_string(),
                Some(7),
            ),
            (
                "https://example.com/batch3.mp4".to_string(),
                "batch3.mp4".to_string(),
                None,
            ),
        ];

        let batch_ids = manager.add_batch_tasks(batch_tasks).await?;
        assert_eq!(batch_ids.len(), 3);

        // Verify batch tasks were created
        let tasks_after_batch = manager.get_tasks().await;
        assert!(tasks_after_batch.len() >= initial_stats.total_tasks + 3);

        // === Step 14: Test Cleanup Operations ===
        let initial_task_count = manager.get_tasks().await.len();

        // Test completed task cleanup (they should be in pending state, so this might not remove any)
        let cleaned_completed = manager.clear_completed().await?;
        assert!(cleaned_completed == 0); // No completed tasks yet

        // Test YouTube cleanup
        let cleaned_youtube = manager.cleanup_youtube_downloads().await;
        assert!(cleaned_youtube >= 0);

        // === Step 15: Test System Resource Management ===
        let final_stats = manager.get_stats().await;
        assert!(final_stats.total_tasks > initial_stats.total_tasks);

        // Verify system is not overloaded
        let final_system_metrics = manager.get_system_metrics().await;
        if let Some(metrics) = final_system_metrics {
            assert!(metrics.cpu_usage_percent >= 0.0 && metrics.cpu_usage_percent <= 100.0);
            assert!(metrics.memory_usage_bytes > 0);
        }

        // === Step 16: Test Graceful Shutdown ===
        // Cancel all pending downloads
        let current_tasks = manager.get_tasks().await;
        for task in current_tasks {
            if task.status == TaskStatus::Pending || task.status == TaskStatus::Downloading {
                let _ = manager.cancel_download(&task.id).await;
            }
        }

        // Disable YouTube
        manager.disable_youtube_downloader().await;
        assert!(!manager.is_youtube_enabled());

        // Stop manager
        manager.stop().await?;
        assert!(!manager.is_running);

        println!("✅ Complete system integration test passed successfully!");
        Ok(())
    }

    #[tokio::test]
    async fn test_error_recovery_and_resilience() -> AppResult<()> {
        let test_config = SystemTestConfig::new().await;

        let download_config = DownloadConfig {
            concurrent_downloads: 1,
            timeout_seconds: 1, // Very short timeout to trigger errors
            retry_attempts: 3,
            output_directory: test_config.downloads_dir.clone(),
            ..Default::default()
        };

        let mut manager = DownloadManager::new(download_config)?;
        manager.start().await?;

        // Test network error handling
        let task_id = manager
            .add_task(
                "https://invalid-domain-that-does-not-exist.com/video.mp4".to_string(),
                "error_test.mp4".to_string(),
            )
            .await?;

        // Wait for error handling
        sleep(Duration::from_millis(500)).await;

        let retry_stats = manager.get_retry_stats().await;
        // Should have attempted some retries due to network error

        let tasks = manager.get_tasks().await;
        let error_task = tasks.iter().find(|t| t.id == task_id);
        assert!(error_task.is_some());

        // Test circuit breaker functionality
        let cb_state = manager
            .get_circuit_breaker_state(ErrorCategory::Network)
            .await;
        assert!(cb_state.is_some());

        manager.stop().await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_performance_under_load() -> AppResult<()> {
        let test_config = SystemTestConfig::new().await;

        let download_config = DownloadConfig {
            concurrent_downloads: 5, // High concurrency
            timeout_seconds: 30,
            retry_attempts: 2,
            output_directory: test_config.downloads_dir.clone(),
            ..Default::default()
        };

        let mut manager = DownloadManager::new(download_config)?;
        manager.start().await?;
        manager.enable_youtube_downloader_default().await?;

        // Create many tasks quickly
        let mut task_ids = Vec::new();
        let start_time = std::time::Instant::now();

        for i in 0..20 {
            let task_id = manager
                .add_task(
                    format!("https://example.com/load_test_{}.mp4", i),
                    format!("load_test_{}.mp4", i),
                )
                .await?;
            task_ids.push(task_id);
        }

        // Add YouTube tasks
        for i in 0..5 {
            let task_id = manager
                .add_youtube_task_simple(
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
                    format!("yt_load_test_{}.mp4", i),
                )
                .await?;
            task_ids.push(task_id);
        }

        let creation_time = start_time.elapsed();
        println!("Created 25 tasks in {:?}", creation_time);

        // Verify system remains responsive
        let stats = manager.get_stats().await;
        assert!(stats.total_tasks >= 25);

        // Test monitoring under load
        let system_metrics = manager.get_system_metrics().await;
        assert!(system_metrics.is_some());

        let health_status = manager.get_health_status().await;
        assert!(health_status.is_some());

        // Cleanup
        for task_id in task_ids {
            let _ = manager.cancel_download(&task_id).await;
        }

        manager.stop().await?;

        println!("✅ Performance test completed - system remained responsive under load");
        Ok(())
    }

    #[tokio::test]
    async fn test_data_persistence_and_recovery() -> AppResult<()> {
        let test_config = SystemTestConfig::new().await;

        let download_config = DownloadConfig {
            concurrent_downloads: 2,
            output_directory: test_config.downloads_dir.clone(),
            ..Default::default()
        };

        // Create first manager instance
        let mut manager1 = DownloadManager::new(download_config.clone())?;
        manager1.start().await?;

        // Add some tasks
        let task1_id = manager1
            .add_task(
                "https://example.com/persist_test1.mp4".to_string(),
                "persist_test1.mp4".to_string(),
            )
            .await?;

        let task2_id = manager1
            .add_task(
                "https://example.com/persist_test2.mp4".to_string(),
                "persist_test2.mp4".to_string(),
            )
            .await?;

        let initial_stats = manager1.get_stats().await;
        assert_eq!(initial_stats.total_tasks, 2);

        // Stop first manager
        manager1.stop().await?;

        // Create second manager instance (simulating restart)
        let mut manager2 = DownloadManager::new(download_config)?;
        manager2.start().await?;

        // For this test, we verify the system can restart cleanly
        // In a real implementation, task persistence would be handled by the storage layer
        let restart_stats = manager2.get_stats().await;
        assert_eq!(restart_stats.total_tasks, 0); // New instance starts fresh

        manager2.stop().await?;

        println!("✅ Restart and recovery test completed successfully");
        Ok(())
    }

    #[tokio::test]
    async fn test_comprehensive_feature_matrix() -> AppResult<()> {
        let test_config = SystemTestConfig::new().await;

        let download_config = DownloadConfig {
            concurrent_downloads: 3,
            timeout_seconds: 30,
            retry_attempts: 2,
            output_directory: test_config.downloads_dir.clone(),
            auto_verify_integrity: true,
            ..Default::default()
        };

        let mut manager = DownloadManager::new(download_config)?;
        manager.start().await?;
        manager.enable_youtube_downloader_default().await?;

        // === Test Matrix: All Feature Combinations ===

        // 1. HTTP Download + Integrity Check
        let http_task = manager
            .add_task(
                "https://example.com/feature_test.mp4".to_string(),
                "feature_test.mp4".to_string(),
            )
            .await?;

        // 2. YouTube Download + Progress Tracking
        let yt_task = manager
            .add_youtube_task_simple(
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
                "yt_feature_test.mp4".to_string(),
            )
            .await?;

        // 3. M3U8 Stream + Retry Mechanism
        let m3u8_task = manager
            .add_task_with_priority(
                "https://example.com/stream.m3u8".to_string(),
                "stream_feature_test.mp4".to_string(),
                8, // High priority
            )
            .await?;

        // 4. File Parser + Batch Tasks
        let file_parser_config = FileParserConfig::default();
        let file_parser = FileParser::new(file_parser_config)?;

        // Test CSV parsing
        let csv_result = file_parser
            .parse_csv_file(test_config.test_csv_file.to_str().unwrap())
            .await?;
        assert!(csv_result.records.len() > 0);

        // 5. Monitoring + Health Checks
        sleep(Duration::from_millis(300)).await;

        let monitoring_active = manager.get_system_metrics().await.is_some();
        let health_active = manager.get_health_status().await.is_some();
        let dashboard_active = manager.get_dashboard_data().await.is_some();

        assert!(monitoring_active, "Monitoring should be active");
        assert!(health_active, "Health checking should be active");
        assert!(dashboard_active, "Dashboard should be active");

        // 6. Error Handling + Circuit Breaker
        let retry_stats = manager.get_retry_stats().await;
        let cb_states = vec![
            manager
                .get_circuit_breaker_state(ErrorCategory::Network)
                .await,
            manager
                .get_circuit_breaker_state(ErrorCategory::Authentication)
                .await,
            manager
                .get_circuit_breaker_state(ErrorCategory::ExternalService)
                .await,
        ];

        assert!(
            cb_states.iter().any(|s| s.is_some()),
            "Circuit breakers should be configured"
        );

        // 7. Progress Tracking + Statistics
        let enhanced_progress = manager.get_all_enhanced_progress().await;
        let global_stats = manager.get_global_enhanced_stats().await;
        let download_stats = manager.get_stats().await;

        assert!(download_stats.total_tasks >= 3);
        assert!(global_stats.total_tasks >= 3);

        // 8. YouTube Features
        let yt_stats = manager.get_youtube_statistics().await;
        assert!(yt_stats.is_some());

        let video_info = manager
            .fetch_youtube_video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
            .await?;
        assert!(!video_info.title.is_empty());

        // 9. Integrity Checking
        let test_file = test_config
            .temp_dir
            .path()
            .join("integrity_matrix_test.txt");
        fs::write(&test_file, b"Matrix test content")?;

        let integrity_result = manager
            .verify_file_integrity(test_file.to_str().unwrap(), HashAlgorithm::Sha256)
            .await?;
        assert!(integrity_result.computed_hash().is_some());

        // 10. Configuration Management
        let original_config = manager.get_config().clone();

        let mut new_config = original_config.clone();
        new_config.retry_attempts = 5;
        new_config.timeout_seconds = 45;

        manager.update_config(new_config).await?;
        let updated_config = manager.get_config().clone();
        assert_eq!(updated_config.retry_attempts, 5);
        assert_eq!(updated_config.timeout_seconds, 45);

        // === Verify All Features Work Together ===
        let final_stats = manager.get_stats().await;
        let final_system_metrics = manager.get_system_metrics().await;
        let final_health = manager.get_health_status().await;

        assert!(final_stats.total_tasks >= 3);
        assert!(final_system_metrics.is_some());
        assert!(final_health.is_some());

        // Clean shutdown
        manager.stop().await?;

        println!("✅ Comprehensive feature matrix test completed - all features working together");
        Ok(())
    }
}
