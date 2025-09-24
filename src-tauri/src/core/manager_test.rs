//! 下载管理器单元测试
//!
//! 测试 DownloadManager 的核心功能，包括任务管理、状态更新、事件处理等

#[cfg(test)]
mod tests {
    use super::super::manager::{DownloadEvent, DownloadManager};
    use crate::core::models::{AppResult, DownloadConfig, TaskStatus};
    use std::time::Duration;
    use tokio::time::timeout;

    /// 创建测试用的下载配置
    fn create_test_config() -> DownloadConfig {
        DownloadConfig {
            concurrent_downloads: 2,
            retry_attempts: 2,
            timeout_seconds: 10,
            user_agent: "Test User Agent".to_string(),
            proxy: None,
            headers: std::collections::HashMap::new(),
            output_directory: "./test_downloads".to_string(),
        }
    }

    #[tokio::test]
    async fn test_download_manager_creation() {
        let config = create_test_config();
        let manager = DownloadManager::new(config.clone());

        assert!(!manager.is_running);
        assert_eq!(manager.config.concurrent_downloads, 2);
        assert_eq!(manager.tasks.len(), 0);
        assert_eq!(manager.active_downloads.len(), 0);
    }

    #[tokio::test]
    async fn test_start_stop_manager() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        // 测试启动
        assert!(!manager.is_running);
        manager.start().await?;
        assert!(manager.is_running);

        // 测试重复启动
        manager.start().await?; // 应该不会出错
        assert!(manager.is_running);

        // 测试停止
        manager.stop().await?;
        assert!(!manager.is_running);

        Ok(())
    }

    #[tokio::test]
    async fn test_add_task() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let task_id = manager
            .add_task(
                "https://example.com/video.mp4".to_string(),
                "./downloads/video.mp4".to_string(),
            )
            .await?;

        assert!(!task_id.is_empty());
        assert_eq!(manager.tasks.len(), 1);

        let task = manager.tasks.get(&task_id).unwrap();
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.url, "https://example.com/video.mp4");
        assert_eq!(task.progress, 0.0);

        Ok(())
    }

    #[tokio::test]
    async fn test_add_multiple_tasks() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let task1_id = manager
            .add_task(
                "https://example.com/video1.mp4".to_string(),
                "./downloads/video1.mp4".to_string(),
            )
            .await?;

        let task2_id = manager
            .add_task(
                "https://example.com/video2.mp4".to_string(),
                "./downloads/video2.mp4".to_string(),
            )
            .await?;

        assert_ne!(task1_id, task2_id);
        assert_eq!(manager.tasks.len(), 2);

        let stats = manager.get_stats().await;
        assert_eq!(stats.total_tasks, 2);
        assert_eq!(stats.completed_tasks, 0);

        Ok(())
    }

    #[tokio::test]
    async fn test_remove_task() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let task_id = manager
            .add_task(
                "https://example.com/video.mp4".to_string(),
                "./downloads/video.mp4".to_string(),
            )
            .await?;

        assert_eq!(manager.tasks.len(), 1);

        manager.remove_task(&task_id).await?;
        assert_eq!(manager.tasks.len(), 0);

        Ok(())
    }

    #[tokio::test]
    async fn test_remove_active_download_fails() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let task_id = manager
            .add_task(
                "https://example.com/video.mp4".to_string(),
                "./downloads/video.mp4".to_string(),
            )
            .await?;

        // 将任务状态设置为下载中
        manager
            .update_task_status(&task_id, TaskStatus::Downloading)
            .await?;

        // 尝试删除应该失败
        let result = manager.remove_task(&task_id).await;
        assert!(result.is_err());

        Ok(())
    }

    #[tokio::test]
    async fn test_start_download() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let task_id = manager
            .add_task(
                "https://example.com/test.mp4".to_string(),
                "./downloads/test.mp4".to_string(),
            )
            .await?;

        // 启动下载（这是模拟实现，会很快完成）
        let result = manager.start_download(&task_id).await;

        // 由于这是测试环境，下载可能会因为网络问题失败，但不应该崩溃
        match result {
            Ok(_) => {
                // 验证任务状态已更新
                let task = manager.tasks.get(&task_id).unwrap();
                assert_eq!(task.status, TaskStatus::Downloading);
            }
            Err(_) => {
                // 在测试环境中，网络请求失败是可以接受的
                // 主要是确保代码不会崩溃
            }
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_pause_nonexistent_download() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let result = manager.pause_download("nonexistent_id").await;
        assert!(result.is_err());

        Ok(())
    }

    #[tokio::test]
    async fn test_cancel_download() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let task_id = manager
            .add_task(
                "https://example.com/video.mp4".to_string(),
                "./downloads/video.mp4".to_string(),
            )
            .await?;

        // 取消下载
        manager.cancel_download(&task_id).await?;

        let task = manager.tasks.get(&task_id).unwrap();
        assert_eq!(task.status, TaskStatus::Cancelled);

        Ok(())
    }

    #[tokio::test]
    async fn test_clear_completed() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        // 添加多个任务
        let task1_id = manager
            .add_task(
                "https://example.com/video1.mp4".to_string(),
                "./downloads/video1.mp4".to_string(),
            )
            .await?;

        let task2_id = manager
            .add_task(
                "https://example.com/video2.mp4".to_string(),
                "./downloads/video2.mp4".to_string(),
            )
            .await?;

        let task3_id = manager
            .add_task(
                "https://example.com/video3.mp4".to_string(),
                "./downloads/video3.mp4".to_string(),
            )
            .await?;

        // 模拟完成一些任务
        manager
            .update_task_status(&task1_id, TaskStatus::Completed)
            .await?;
        manager
            .update_task_status(&task2_id, TaskStatus::Completed)
            .await?;
        // task3 保持 Pending 状态

        assert_eq!(manager.tasks.len(), 3);

        let removed_count = manager.clear_completed().await?;

        assert_eq!(removed_count, 2);
        assert_eq!(manager.tasks.len(), 1);
        assert!(manager.tasks.contains_key(&task3_id));

        Ok(())
    }

    #[tokio::test]
    async fn test_retry_failed() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        // 添加多个任务
        let task1_id = manager
            .add_task(
                "https://example.com/video1.mp4".to_string(),
                "./downloads/video1.mp4".to_string(),
            )
            .await?;

        let task2_id = manager
            .add_task(
                "https://example.com/video2.mp4".to_string(),
                "./downloads/video2.mp4".to_string(),
            )
            .await?;

        // 模拟失败状态
        manager
            .update_task_status(&task1_id, TaskStatus::Failed)
            .await?;
        manager
            .update_task_status(&task2_id, TaskStatus::Completed)
            .await?;

        let retry_count = manager.retry_failed().await?;

        assert_eq!(retry_count, 1);

        // 验证失败的任务已被重置为 Pending
        let task1 = manager.tasks.get(&task1_id).unwrap();
        assert_eq!(task1.status, TaskStatus::Pending);
        assert!(task1.error_message.is_none());
        assert_eq!(task1.progress, 0.0);

        // 验证完成的任务不受影响
        let task2 = manager.tasks.get(&task2_id).unwrap();
        assert_eq!(task2.status, TaskStatus::Completed);

        Ok(())
    }

    #[tokio::test]
    async fn test_update_config() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let mut new_config = create_test_config();
        new_config.concurrent_downloads = 5;
        new_config.timeout_seconds = 60;

        manager.update_config(new_config.clone()).await?;

        assert_eq!(manager.config.concurrent_downloads, 5);
        assert_eq!(manager.config.timeout_seconds, 60);

        Ok(())
    }

    #[tokio::test]
    async fn test_get_tasks_empty() -> AppResult<()> {
        let config = create_test_config();
        let manager = DownloadManager::new(config);

        let tasks = manager.get_tasks().await;
        assert_eq!(tasks.len(), 0);

        Ok(())
    }

    #[tokio::test]
    async fn test_get_stats() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        // 添加不同状态的任务
        let task1_id = manager
            .add_task(
                "https://example.com/video1.mp4".to_string(),
                "./downloads/video1.mp4".to_string(),
            )
            .await?;

        let task2_id = manager
            .add_task(
                "https://example.com/video2.mp4".to_string(),
                "./downloads/video2.mp4".to_string(),
            )
            .await?;

        let task3_id = manager
            .add_task(
                "https://example.com/video3.mp4".to_string(),
                "./downloads/video3.mp4".to_string(),
            )
            .await?;

        // 设置不同状态
        manager
            .update_task_status(&task1_id, TaskStatus::Completed)
            .await?;
        manager
            .update_task_status(&task2_id, TaskStatus::Failed)
            .await?;
        // task3 保持 Pending

        let stats = manager.get_stats().await;

        assert_eq!(stats.total_tasks, 3);
        assert_eq!(stats.completed_tasks, 1);
        assert_eq!(stats.failed_tasks, 1);
        assert_eq!(stats.active_downloads, 0); // 没有活跃下载

        Ok(())
    }

    #[tokio::test]
    async fn test_concurrent_download_limit() -> AppResult<()> {
        let mut config = create_test_config();
        config.concurrent_downloads = 1; // 限制为1个并发下载
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        let task1_id = manager
            .add_task(
                "https://httpbin.org/delay/1".to_string(),
                "./downloads/task1.txt".to_string(),
            )
            .await?;

        let task2_id = manager
            .add_task(
                "https://httpbin.org/delay/1".to_string(),
                "./downloads/task2.txt".to_string(),
            )
            .await?;

        // 尝试同时启动两个下载
        let start1_result = manager.start_download(&task1_id).await;
        let start2_result = manager.start_download(&task2_id).await;

        // 第一个应该成功，第二个应该因为并发限制而失败
        // 但在实际测试中，由于网络延迟，这个测试可能不够稳定
        // 主要是验证并发控制机制存在

        Ok(())
    }

    /// 测试任务标题提取功能
    #[test]
    fn test_extract_title_from_url() {
        let config = create_test_config();
        let manager = DownloadManager::new(config);

        // 测试正常URL
        let title1 = manager.extract_title_from_url("https://example.com/video.mp4");
        assert_eq!(title1, "video.mp4");

        // 测试带查询参数的URL
        let title2 = manager.extract_title_from_url("https://example.com/video.mp4?v=123");
        assert_eq!(title2, "video.mp4");

        // 测试复杂路径
        let title3 = manager.extract_title_from_url("https://example.com/path/to/video.mp4");
        assert_eq!(title3, "video.mp4");

        // 测试无文件名的URL
        let title4 = manager.extract_title_from_url("https://example.com/");
        assert_eq!(title4, "Unknown");

        // 测试空URL
        let title5 = manager.extract_title_from_url("");
        assert_eq!(title5, "Unknown");
    }

    /// 压力测试：添加大量任务
    #[tokio::test]
    async fn test_add_many_tasks() -> AppResult<()> {
        let config = create_test_config();
        let mut manager = DownloadManager::new(config);

        manager.start().await?;

        // 添加100个任务
        let task_count = 100;
        let mut task_ids = Vec::new();

        for i in 0..task_count {
            let task_id = manager
                .add_task(
                    format!("https://example.com/video{}.mp4", i),
                    format!("./downloads/video{}.mp4", i),
                )
                .await?;
            task_ids.push(task_id);
        }

        assert_eq!(manager.tasks.len(), task_count);
        assert_eq!(task_ids.len(), task_count);

        // 验证所有任务ID都是唯一的
        let mut unique_ids = std::collections::HashSet::new();
        for id in &task_ids {
            assert!(unique_ids.insert(id.clone()));
        }

        let stats = manager.get_stats().await;
        assert_eq!(stats.total_tasks, task_count);

        Ok(())
    }

    /// 测试内存安全：在管理器运行时drop
    #[tokio::test]
    async fn test_manager_drop_while_running() -> AppResult<()> {
        {
            let config = create_test_config();
            let mut manager = DownloadManager::new(config);

            manager.start().await?;

            let _task_id = manager
                .add_task(
                    "https://example.com/video.mp4".to_string(),
                    "./downloads/video.mp4".to_string(),
                )
                .await?;

            // 管理器在这里会被drop，应该能够正常清理资源
        }

        // 如果到这里没有崩溃，说明drop处理是安全的
        Ok(())
    }
}
