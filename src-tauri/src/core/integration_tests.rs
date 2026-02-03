//! 集成测试模块
//! 测试核心模块之间的交互和完整工作流程

#[cfg(test)]
mod tests {
    use crate::core::{
        manager::DownloadManager,
        models::{DownloadConfig, DownloaderType, ProgressUpdate, TaskStatus, VideoTask},
    };
    use std::collections::HashMap;
    use uuid::Uuid;

    /// 创建测试用的下载配置
    fn create_test_config() -> DownloadConfig {
        DownloadConfig {
            concurrent_downloads: 2,
            retry_attempts: 2,
            timeout_seconds: 5,
            user_agent: "TestAgent/1.0".to_string(),
            proxy: None,
            headers: HashMap::new(),
            output_directory: "/tmp/test_downloads".to_string(),
        }
    }

    /// 创建测试用的下载任务
    fn create_test_task(url: &str, title: &str) -> VideoTask {
        VideoTask {
            id: Uuid::new_v4().to_string(),
            url: url.to_string(),
            title: title.to_string(),
            output_path: format!("/tmp/test_downloads/{}.mp4", title),
            resolved_path: None,
            status: TaskStatus::Pending,
            progress: 0.0,
            downloaded_size: 0,
            file_size: None,
            speed: 0.0,
            eta: None,
            error_message: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            downloader_type: Some(DownloaderType::Http),
            video_info: None,
        }
    }

    #[tokio::test]
    async fn test_download_manager_initialization() {
        let config = create_test_config();
        let manager = DownloadManager::new(config.clone());

        // 验证管理器创建成功
        assert!(manager.is_ok());

        let manager = manager.unwrap();

        // 验证初始状态
        let stats = manager.get_current_stats().await;
        assert_eq!(stats.total_tasks, 0);
        assert_eq!(stats.active_downloads, 0);
        assert_eq!(stats.completed_tasks, 0);
        assert_eq!(stats.failed_tasks, 0);
    }

    #[tokio::test]
    async fn test_task_lifecycle_management() {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config).unwrap();

        // 1. 测试添加任务
        let task1 = create_test_task("https://httpbin.org/delay/1", "test_video_1");
        let task2 = create_test_task("https://httpbin.org/delay/2", "test_video_2");

        let task1_id = task1.id.clone();
        let task2_id = task2.id.clone();

        // 添加任务到管理器
        let result1 = manager.add_task(task1).await;
        let result2 = manager.add_task(task2).await;

        assert!(result1.is_ok());
        assert!(result2.is_ok());

        // 验证任务计数
        let stats = manager.get_current_stats().await;
        assert_eq!(stats.total_tasks, 2);

        // 验证任务状态
        let tasks = manager.get_all_tasks().await;
        assert_eq!(tasks.len(), 2);
        assert!(tasks
            .iter()
            .any(|t| t.id == task1_id && t.status == TaskStatus::Pending));
        assert!(tasks
            .iter()
            .any(|t| t.id == task2_id && t.status == TaskStatus::Pending));

        // 2. 测试任务状态更新
        let update_result = manager
            .update_task_progress(
                &task1_id,
                ProgressUpdate {
                    task_id: task1_id.clone(),
                    downloaded_size: 1024,
                    total_size: Some(4096),
                    speed: 512.0,
                    eta: Some(6),
                    progress: 0.25,
                },
            )
            .await;

        assert!(update_result.is_ok());

        // 验证进度更新
        let tasks = manager.get_all_tasks().await;
        let updated_task = tasks.iter().find(|t| t.id == task1_id).unwrap();
        assert_eq!(updated_task.downloaded_size, 1024);
        assert_eq!(updated_task.speed, 512.0);
        assert_eq!(updated_task.progress, 25.0); // 1024/4096 * 100

        // 3. 测试任务移除
        let remove_result = manager.remove_task(&task2_id).await;
        assert!(remove_result.is_ok());

        let stats_after_remove = manager.get_current_stats().await;
        assert_eq!(stats_after_remove.total_tasks, 1);

        // 验证任务确实被移除
        let tasks_after_remove = manager.get_all_tasks().await;
        assert_eq!(tasks_after_remove.len(), 1);
        assert!(!tasks_after_remove.iter().any(|t| t.id == task2_id));
    }

    #[tokio::test]
    async fn test_concurrent_downloads_limit() {
        let config = DownloadConfig {
            concurrent_downloads: 2, // 限制并发数为2
            ..create_test_config()
        };

        let mut manager = DownloadManager::new(config).unwrap();

        // 添加3个任务
        let mut task_ids = Vec::new();
        for i in 1..=3 {
            let task = create_test_task(
                &format!("https://httpbin.org/delay/{}", i),
                &format!("concurrent_test_{}", i),
            );
            task_ids.push(task.id.clone());
            let result = manager.add_task(task).await;
            assert!(result.is_ok());
        }

        // 验证所有任务都已添加
        let stats = manager.get_current_stats().await;
        assert_eq!(stats.total_tasks, 3);

        // 尝试开始所有下载（在实际实现中会受并发限制）
        for task_id in &task_ids {
            let _result = manager.start_download(task_id).await;
            // 在实际实现中，这里会处理并发限制
        }

        // 验证管理器状态保持一致
        let tasks = manager.get_all_tasks().await;
        assert_eq!(tasks.len(), 3);
    }

    #[tokio::test]
    async fn test_error_handling_and_recovery() {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config).unwrap();

        // 添加一个任务并设置为失败状态
        let mut task = create_test_task(
            "https://invalid-url-that-will-fail.com/video.mp4",
            "error_test",
        );
        let task_id = task.id.clone();

        // 模拟失败状态
        task.status = TaskStatus::Failed;
        task.error_message = Some("Network timeout".to_string());

        let result = manager.add_task(task).await;
        assert!(result.is_ok());

        // 验证错误状态
        let tasks = manager.get_all_tasks().await;
        let failed_task = tasks.iter().find(|t| t.id == task_id).unwrap();
        assert_eq!(failed_task.status, TaskStatus::Failed);
        assert!(failed_task.error_message.is_some());

        // 统计信息应该反映失败的任务
        let stats = manager.get_current_stats().await;
        assert_eq!(stats.failed_tasks, 1);

        // 测试任务重置（为重试做准备）
        let reset_result = manager.reset_task(&task_id).await;
        assert!(reset_result.is_ok());

        let tasks_after_reset = manager.get_all_tasks().await;
        let reset_task = tasks_after_reset.iter().find(|t| t.id == task_id).unwrap();
        assert_eq!(reset_task.status, TaskStatus::Pending);
        assert!(reset_task.error_message.is_none());
    }

    #[tokio::test]
    async fn test_statistics_calculation() {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config).unwrap();

        // 添加不同状态的任务
        let statuses_and_sizes = vec![
            (TaskStatus::Pending, 0, None),
            (TaskStatus::Downloading, 5242880, Some(10485760)), // 5MB/10MB
            (TaskStatus::Completed, 10485760, Some(10485760)),  // 10MB/10MB
            (TaskStatus::Failed, 0, None),
            (TaskStatus::Paused, 2621440, Some(10485760)), // 2.5MB/10MB
        ];

        for (i, (status, downloaded_size, file_size)) in statuses_and_sizes.iter().enumerate() {
            let mut task = create_test_task(
                &format!("https://example.com/video{}.mp4", i),
                &format!("test_video_{}", i),
            );

            task.status = status.clone();
            task.downloaded_size = *downloaded_size;
            task.file_size = *file_size;

            if *status == TaskStatus::Downloading {
                task.speed = 1048576.0; // 1MB/s
                task.progress = (*downloaded_size as f64 / file_size.unwrap() as f64) * 100.0;
            } else if *status == TaskStatus::Completed {
                task.progress = 100.0;
            } else if *status == TaskStatus::Paused {
                task.progress = (*downloaded_size as f64 / file_size.unwrap() as f64) * 100.0;
            }

            let result = manager.add_task(task).await;
            assert!(result.is_ok());
        }

        // 验证统计信息
        let stats = manager.get_current_stats().await;

        assert_eq!(stats.total_tasks, 5);
        assert_eq!(stats.completed_tasks, 1);
        assert_eq!(stats.failed_tasks, 1);
        assert_eq!(stats.active_downloads, 1); // 只有一个在下载

        // 总下载量应该是所有已下载的字节数之和
        let expected_total_downloaded = 5242880 + 10485760 + 2621440; // 5MB + 10MB + 2.5MB
        assert_eq!(stats.total_downloaded, expected_total_downloaded);

        // 平均速度应该基于活跃下载
        assert!(stats.average_speed > 0.0);
    }

    #[tokio::test]
    async fn test_task_filtering_by_status() {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config).unwrap();

        // 添加不同状态的任务
        let test_statuses = vec![
            TaskStatus::Pending,
            TaskStatus::Downloading,
            TaskStatus::Completed,
            TaskStatus::Failed,
            TaskStatus::Paused,
        ];

        let mut task_ids = Vec::new();
        for (i, status) in test_statuses.iter().enumerate() {
            let mut task = create_test_task(
                &format!("https://example.com/video{}.mp4", i),
                &format!("filter_test_{}", i),
            );
            task.status = status.clone();
            task_ids.push(task.id.clone());

            let result = manager.add_task(task).await;
            assert!(result.is_ok());
        }

        // 测试获取所有任务
        let all_tasks = manager.get_all_tasks().await;
        assert_eq!(all_tasks.len(), 5);

        // 测试按状态筛选（这里需要假设有这样的方法）
        let completed_tasks = manager.get_tasks_by_status(TaskStatus::Completed).await;
        assert_eq!(completed_tasks.len(), 1);
        assert_eq!(completed_tasks[0].status, TaskStatus::Completed);

        let pending_tasks = manager.get_tasks_by_status(TaskStatus::Pending).await;
        assert_eq!(pending_tasks.len(), 1);
        assert_eq!(pending_tasks[0].status, TaskStatus::Pending);

        let downloading_tasks = manager.get_tasks_by_status(TaskStatus::Downloading).await;
        assert_eq!(downloading_tasks.len(), 1);
        assert_eq!(downloading_tasks[0].status, TaskStatus::Downloading);
    }

    #[tokio::test]
    async fn test_batch_task_operations() {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config).unwrap();

        // 添加多个任务
        let mut task_ids = Vec::new();
        for i in 1..=5 {
            let task = create_test_task(
                &format!("https://example.com/batch{}.mp4", i),
                &format!("batch_test_{}", i),
            );
            task_ids.push(task.id.clone());
            let result = manager.add_task(task).await;
            assert!(result.is_ok());
        }

        // 验证所有任务都已添加
        assert_eq!(manager.get_current_stats().await.total_tasks, 5);

        // 测试批量状态更新（选择前3个任务）
        let selected_ids = &task_ids[0..3];

        for task_id in selected_ids {
            let result = manager
                .update_task_status(task_id, TaskStatus::Downloading)
                .await;
            assert!(result.is_ok());
        }

        // 验证批量操作结果
        let tasks = manager.get_all_tasks().await;
        let downloading_count = tasks
            .iter()
            .filter(|t| selected_ids.contains(&t.id) && t.status == TaskStatus::Downloading)
            .count();
        assert_eq!(downloading_count, 3);

        // 验证未选择的任务状态未改变
        let unchanged_count = tasks
            .iter()
            .filter(|t| !selected_ids.contains(&t.id) && t.status == TaskStatus::Pending)
            .count();
        assert_eq!(unchanged_count, 2);

        // 测试批量移除（移除后2个任务）
        let remove_ids = &task_ids[3..];

        for task_id in remove_ids {
            let result = manager.remove_task(task_id).await;
            assert!(result.is_ok());
        }

        // 验证任务数量和状态
        let final_stats = manager.get_current_stats().await;
        assert_eq!(final_stats.total_tasks, 3);

        let final_tasks = manager.get_all_tasks().await;
        assert_eq!(final_tasks.len(), 3);

        // 确保移除的任务不再存在
        for task_id in remove_ids {
            assert!(!final_tasks.iter().any(|t| t.id == *task_id));
        }
    }

    #[tokio::test]
    async fn test_configuration_updates() {
        let initial_config = create_test_config();
        let mut manager = DownloadManager::new(initial_config).unwrap();

        // 验证初始配置
        let current_config = manager.get_config().await;
        assert_eq!(current_config.concurrent_downloads, 2);
        assert_eq!(current_config.retry_attempts, 2);

        // 创建新的配置
        let new_config = DownloadConfig {
            concurrent_downloads: 4,
            retry_attempts: 5,
            timeout_seconds: 60,
            user_agent: "UpdatedAgent/2.0".to_string(),
            output_directory: "/tmp/updated_downloads".to_string(),
            ..current_config
        };

        // 更新配置
        let update_result = manager.update_config(new_config.clone()).await;
        assert!(update_result.is_ok());

        // 验证配置已更新
        let updated_config = manager.get_config().await;
        assert_eq!(updated_config.concurrent_downloads, 4);
        assert_eq!(updated_config.retry_attempts, 5);
        assert_eq!(updated_config.timeout_seconds, 60);
        assert_eq!(updated_config.user_agent, "UpdatedAgent/2.0");
        assert_eq!(updated_config.output_directory, "/tmp/updated_downloads");
    }

    #[tokio::test]
    async fn test_progress_update_integration() {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config).unwrap();

        // 添加一个下载中的任务
        let mut task = create_test_task(
            "https://example.com/progress_test.mp4",
            "progress_integration_test",
        );
        task.status = TaskStatus::Downloading;
        task.file_size = Some(10485760); // 10MB
        let task_id = task.id.clone();

        let result = manager.add_task(task).await;
        assert!(result.is_ok());

        // 模拟一系列进度更新
        let progress_updates = vec![
            (1048576, 10.0),   // 1MB - 10%
            (2621440, 25.0),   // 2.5MB - 25%
            (5242880, 50.0),   // 5MB - 50%
            (7864320, 75.0),   // 7.5MB - 75%
            (10485760, 100.0), // 10MB - 100%
        ];

        for (downloaded_size, expected_progress) in progress_updates {
            let progress_update = ProgressUpdate {
                task_id: task_id.clone(),
                downloaded_size,
                total_size: Some(10485760),
                speed: 1048576.0, // 1MB/s
                eta: Some(if downloaded_size < 10485760 {
                    (10485760 - downloaded_size) / 1048576
                } else {
                    0
                }),
                progress: expected_progress / 100.0,
            };

            let result = manager
                .update_task_progress(&task_id, progress_update)
                .await;
            assert!(result.is_ok());

            // 验证任务状态更新
            let tasks = manager.get_all_tasks().await;
            let updated_task = tasks.iter().find(|t| t.id == task_id).unwrap();

            assert_eq!(updated_task.downloaded_size, downloaded_size);
            assert_eq!(updated_task.progress, expected_progress);
            assert_eq!(updated_task.speed, 1048576.0);

            // 完成时状态应该改变
            if expected_progress >= 100.0 {
                assert_eq!(updated_task.status, TaskStatus::Completed);
            } else {
                assert_eq!(updated_task.status, TaskStatus::Downloading);
            }
        }

        // 验证最终统计信息
        let final_stats = manager.get_current_stats().await;
        assert_eq!(final_stats.completed_tasks, 1);
        assert_eq!(final_stats.active_downloads, 0);
        assert_eq!(final_stats.total_downloaded, 10485760);
    }
}
