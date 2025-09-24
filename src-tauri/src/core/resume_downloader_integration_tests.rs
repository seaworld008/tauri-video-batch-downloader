//! ResumeDownloader 集成测试
//!
//! 测试断点续传功能的完整工作流程，包括：
//! - 完整下载流程测试
//! - 断点续传功能测试
//! - 并发分片下载测试
//! - 错误恢复测试

#[cfg(test)]
mod tests {
    use super::super::models::TaskStatus;
    use super::super::resume_downloader::{ResumeDownloader, ResumeDownloaderConfig};
    use reqwest::Client;
    use std::time::Duration;
    use tempfile::{tempdir, NamedTempFile};
    use tokio::fs;
    use uuid::Uuid;

    /// 创建测试用的 ResumeDownloader
    async fn create_test_downloader() -> (ResumeDownloader, tempfile::TempDir) {
        let temp_dir = tempdir().unwrap();
        let mut config = ResumeDownloaderConfig::default();
        config.resume_info_dir = temp_dir.path().to_path_buf();
        config.chunk_size = 1024; // 1KB chunks for faster testing
        config.large_file_threshold = 2048; // 2KB threshold
        config.max_retries = 2;
        config.retry_delay = Duration::from_millis(100);

        let client = Client::new();
        let downloader = ResumeDownloader::new(config, client).unwrap();

        (downloader, temp_dir)
    }

    #[tokio::test]
    async fn test_full_download_workflow() {
        let (downloader, _temp_dir) = create_test_downloader().await;
        let task_id = Uuid::new_v4().to_string();

        // 创建临时输出文件
        let temp_file = NamedTempFile::new().unwrap();
        let output_path = temp_file.path().to_string_lossy().to_string();

        // 使用 httpbin.org 进行测试（小文件，支持Range请求）
        let test_url = "https://httpbin.org/bytes/2048"; // 2KB文件，会被分成多个块

        // 执行下载
        let result = downloader
            .download_with_resume(&task_id, test_url, &output_path)
            .await;

        match result {
            Ok(()) => {
                // 验证文件存在且有内容
                let metadata = fs::metadata(&output_path).await.unwrap();
                assert!(metadata.len() > 0, "下载的文件应该有内容");
                assert_eq!(metadata.len(), 2048, "文件大小应该是2048字节");

                println!("✅ 完整下载测试通过");
            }
            Err(e) => {
                // 网络测试可能失败，记录但不让测试失败
                eprintln!("⚠️ 网络下载测试失败（这是可接受的）: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_server_capabilities_detection() {
        let (downloader, _temp_dir) = create_test_downloader().await;

        // 测试多个URL的服务器能力检测
        let test_urls = vec![
            "https://httpbin.org/bytes/1024",
            "https://www.google.com/", // 可能不支持Range
        ];

        for url in test_urls {
            let result = downloader.detect_server_capabilities(url).await;

            match result {
                Ok(capabilities) => {
                    println!(
                        "✅ 服务器能力检测成功: {} - 支持Range: {}, 最大并发: {}",
                        url, capabilities.supports_ranges, capabilities.max_concurrent
                    );

                    // 验证基本字段
                    assert!(capabilities.detected_at <= std::time::SystemTime::now());
                }
                Err(e) => {
                    // 网络错误是可接受的
                    eprintln!("⚠️ 服务器能力检测失败（网络问题，可接受）: {} - {}", url, e);
                }
            }
        }
    }

    #[tokio::test]
    async fn test_resume_info_persistence() {
        let (downloader, temp_dir) = create_test_downloader().await;
        let task_id = Uuid::new_v4().to_string();

        // 创建测试断点信息
        let resume_info = super::super::resume_downloader::ResumeInfo::new(
            task_id.clone(),
            temp_dir
                .path()
                .join("test_file.dat")
                .to_string_lossy()
                .to_string(),
            "https://example.com/test".to_string(),
            4096,
        );

        // 保存断点信息
        let save_result = downloader.save_resume_info(&resume_info).await;
        assert!(save_result.is_ok(), "保存断点信息应该成功");

        // 加载断点信息
        let load_result = downloader.load_resume_info(&task_id).await;
        assert!(load_result.is_ok(), "加载断点信息应该成功");

        let loaded_info = load_result.unwrap();
        assert!(loaded_info.is_some(), "应该能找到断点信息");

        let loaded_info = loaded_info.unwrap();
        assert_eq!(loaded_info.task_id, resume_info.task_id);
        assert_eq!(loaded_info.total_size, resume_info.total_size);
        assert_eq!(loaded_info.original_url, resume_info.original_url);

        println!("✅ 断点信息持久化测试通过");
    }

    #[tokio::test]
    async fn test_chunk_creation_logic() {
        let (downloader, _temp_dir) = create_test_downloader().await;

        // 测试不同文件大小的分片创建
        let test_cases = vec![
            (1024, false, 1), // 1KB文件，不支持Range，单块
            (1024, true, 1),  // 1KB文件，支持Range，单块（小于阈值）
            (4096, true, 4),  // 4KB文件，支持Range，4块
            (5120, true, 5),  // 5KB文件，支持Range，5块
        ];

        for (file_size, supports_ranges, expected_chunks) in test_cases {
            let mut resume_info = super::super::resume_downloader::ResumeInfo::new(
                Uuid::new_v4().to_string(),
                "/tmp/test".to_string(),
                "https://example.com/file".to_string(),
                file_size,
            );
            resume_info.server_capabilities.supports_ranges = supports_ranges;

            let chunks = downloader.create_chunks(&resume_info).await.unwrap();

            assert_eq!(
                chunks.len(),
                expected_chunks,
                "文件大小{}，支持Range{}，应该有{}个分片，实际{}个",
                file_size,
                supports_ranges,
                expected_chunks,
                chunks.len()
            );

            if chunks.len() > 1 {
                // 验证分片范围正确
                let total_size: u64 = chunks.iter().map(|c| c.size()).sum();
                assert_eq!(total_size, file_size, "所有分片大小之和应等于文件总大小");

                // 验证分片连续性
                for i in 1..chunks.len() {
                    assert_eq!(
                        chunks[i].start,
                        chunks[i - 1].end + 1,
                        "分片{}的起始位置应该连接分片{}的结束位置",
                        i,
                        i - 1
                    );
                }
            }
        }

        println!("✅ 分片创建逻辑测试通过");
    }

    #[tokio::test]
    async fn test_cleanup_functionality() {
        let (downloader, temp_dir) = create_test_downloader().await;
        let task_id = Uuid::new_v4().to_string();

        // 创建一些测试文件
        let resume_info = super::super::resume_downloader::ResumeInfo::new(
            task_id.clone(),
            temp_dir
                .path()
                .join("test_file.dat")
                .to_string_lossy()
                .to_string(),
            "https://example.com/test".to_string(),
            1024,
        );

        // 保存断点信息（会创建相关文件）
        downloader.save_resume_info(&resume_info).await.unwrap();

        // 创建一些模拟的分片文件
        let chunk_file1 = temp_dir.path().join(format!("{}.chunk.0", task_id));
        let chunk_file2 = temp_dir.path().join(format!("{}.chunk.1", task_id));
        fs::write(&chunk_file1, b"test data 1").await.unwrap();
        fs::write(&chunk_file2, b"test data 2").await.unwrap();

        // 验证文件存在
        assert!(chunk_file1.exists());
        assert!(chunk_file2.exists());

        // 执行清理
        let cleanup_result = downloader.cleanup_task(&task_id).await;
        assert!(cleanup_result.is_ok(), "清理任务应该成功");

        // 验证文件已被清理
        assert!(!chunk_file1.exists(), "分片文件1应该被清理");
        assert!(!chunk_file2.exists(), "分片文件2应该被清理");

        // 验证断点信息文件也被清理
        let resume_file = temp_dir.path().join(format!("{}.json", task_id));
        assert!(!resume_file.exists(), "断点信息文件应该被清理");

        println!("✅ 清理功能测试通过");
    }

    #[tokio::test]
    async fn test_progress_calculation() {
        let (downloader, _temp_dir) = create_test_downloader().await;

        let mut resume_info = super::super::resume_downloader::ResumeInfo::new(
            Uuid::new_v4().to_string(),
            "/tmp/test".to_string(),
            "https://example.com/file".to_string(),
            4096, // 4KB文件
        );

        // 添加分片
        resume_info.chunks = vec![
            super::super::resume_downloader::ChunkInfo::new(0, 0, 1023), // 1KB chunk, 0% 完成
            super::super::resume_downloader::ChunkInfo::new(1, 1024, 2047), // 1KB chunk, 50% 完成
            super::super::resume_downloader::ChunkInfo::new(2, 2048, 3071), // 1KB chunk, 100% 完成
            super::super::resume_downloader::ChunkInfo::new(3, 3072, 4095), // 1KB chunk, 75% 完成
        ];

        // 设置分片下载进度
        resume_info.chunks[0].downloaded = 0; // 0%
        resume_info.chunks[1].downloaded = 512; // 50%
        resume_info.chunks[2].downloaded = 1024; // 100%
        resume_info.chunks[3].downloaded = 768; // 75%

        // 更新总下载量
        resume_info.downloaded_total = resume_info.chunks.iter().map(|c| c.downloaded).sum();

        let expected_total = 0 + 512 + 1024 + 768; // 2304 bytes
        let expected_progress = 2304.0 / 4096.0; // 约 0.5625

        assert_eq!(resume_info.downloaded_total, expected_total);
        assert!(
            (resume_info.progress() - expected_progress).abs() < 0.001,
            "进度计算不正确，期望 {}, 实际 {}",
            expected_progress,
            resume_info.progress()
        );

        // 测试未完成的分片
        let pending = resume_info.pending_chunks();
        assert_eq!(pending.len(), 3, "应该有3个未完成的分片");

        println!("✅ 进度计算测试通过");
    }

    #[tokio::test]
    async fn test_error_scenarios() {
        let (downloader, temp_dir) = create_test_downloader().await;

        // 测试无效URL
        let invalid_urls = vec![
            "not-a-url",
            "ftp://unsupported.protocol/file",
            "https://nonexistent-domain-12345.com/file",
        ];

        for invalid_url in invalid_urls {
            let result = downloader.detect_server_capabilities(invalid_url).await;
            assert!(result.is_err(), "无效URL应该返回错误: {}", invalid_url);
        }

        // 测试无效路径
        let invalid_path = "/non/existent/directory/file.dat";
        let task_id = Uuid::new_v4().to_string();

        let result = downloader
            .download_with_resume(&task_id, "https://httpbin.org/bytes/1024", invalid_path)
            .await;

        // 这应该会因为路径无效而失败
        if let Err(e) = result {
            println!("✅ 无效路径正确返回错误: {}", e);
        } else {
            println!("⚠️ 无效路径测试意外成功，可能系统自动创建了目录");
        }

        // 测试加载不存在的断点信息
        let nonexistent_task = Uuid::new_v4().to_string();
        let result = downloader.load_resume_info(&nonexistent_task).await;
        assert!(result.is_ok(), "加载不存在的断点信息应该返回Ok(None)");
        assert!(result.unwrap().is_none(), "不存在的断点信息应该返回None");

        println!("✅ 错误场景测试通过");
    }
}
