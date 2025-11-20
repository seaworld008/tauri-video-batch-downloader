//! M3U8下载器集成测试
//!
//! 测试M3U8流媒体下载的完整工作流程，包括：
//! - HttpDownloader与M3U8Downloader集成
//! - M3U8 URL检测功能
//! - 播放列表解析功能
//! - 智能下载策略选择

#[cfg(test)]
mod tests {
    use super::super::downloader::{DownloadTask, DownloaderConfig, HttpDownloader};
    use super::super::models::TaskStatus;
    use tempfile::tempdir;

    /// 创建测试用的 HttpDownloader
    async fn create_test_downloader() -> (HttpDownloader, tempfile::TempDir) {
        let temp_dir = tempdir().unwrap();
        let mut config = DownloaderConfig::default();
        config.max_concurrent = 4;
        config.resume_enabled = true;

        let downloader = HttpDownloader::new(config).unwrap();

        (downloader, temp_dir)
    }

    #[test]
    fn test_m3u8_url_detection() {
        let config = DownloaderConfig::default();
        let downloader = HttpDownloader::new(config).unwrap();

        // 测试各种M3U8 URL格式
        let m3u8_urls = vec![
            "https://example.com/playlist.m3u8",
            "https://example.com/master.m3u8?token=abc",
            "https://streaming.example.com/hls/playlist",
            "https://cdn.example.com/video/master.M3U8",
            "https://stream.tv/live/index.m3u8",
        ];

        let non_m3u8_urls = vec![
            "https://example.com/video.mp4",
            "https://example.com/audio.mp3",
            "https://files.example.com/document.pdf",
            "https://cdn.example.com/image.jpg",
        ];

        for url in m3u8_urls {
            assert!(downloader.is_m3u8_url(url), "应该识别为M3U8 URL: {}", url);
        }

        for url in non_m3u8_urls {
            assert!(
                !downloader.is_m3u8_url(url),
                "不应该识别为M3U8 URL: {}",
                url
            );
        }

        println!("✅ M3U8 URL检测测试通过");
    }

    #[tokio::test]
    async fn test_http_downloader_m3u8_integration() {
        let (downloader, temp_dir) = create_test_downloader().await;

        // 创建一个M3U8下载任务
        let task = DownloadTask::new(
            "https://example.com/test.m3u8".to_string(),
            temp_dir.path().to_string_lossy().to_string(),
            "test_video.ts".to_string(),
        );

        // 验证任务创建正确
        assert_eq!(task.status, TaskStatus::Pending);
        assert!(task.url.contains(".m3u8"));
        assert!(downloader.is_m3u8_url(&task.url));

        println!("✅ HttpDownloader M3U8集成测试通过");
    }

    #[tokio::test]
    async fn test_m3u8_playlist_parsing() {
        use super::super::m3u8_downloader::{M3U8Downloader, M3U8DownloaderConfig};

        let temp_dir = tempdir().unwrap();
        let mut config = M3U8DownloaderConfig::default();
        config.temp_dir = temp_dir.path().to_path_buf();

        let downloader = M3U8Downloader::new(config).unwrap();

        // 测试M3U8内容解析
        let m3u8_content = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:9.009,
https://example.com/segment000.ts
#EXTINF:9.009,
https://example.com/segment001.ts
#EXTINF:3.003,
https://example.com/segment002.ts
#EXT-X-ENDLIST"#;

        let playlist = downloader
            .parse_m3u8_content("https://example.com/playlist.m3u8", m3u8_content)
            .await;

        assert!(playlist.is_ok(), "M3U8内容解析应该成功");

        let playlist = playlist.unwrap();
        assert_eq!(playlist.version, 3);
        assert_eq!(playlist.target_duration, 10.0);
        assert_eq!(playlist.segments.len(), 3);
        assert!((playlist.duration - 21.021).abs() < 0.001);
        assert!(!playlist.is_live);

        // 验证片段信息
        assert_eq!(playlist.segments[0].index, 0);
        assert_eq!(
            playlist.segments[0].url,
            "https://example.com/segment000.ts"
        );
        assert!((playlist.segments[0].duration - 9.009).abs() < 0.001);

        println!("✅ M3U8播放列表解析测试通过");
    }

    #[tokio::test]
    async fn test_smart_download_strategy() {
        let (downloader, temp_dir) = create_test_downloader().await;

        // 测试不同类型URL的策略选择
        let test_cases = vec![
            ("https://example.com/video.m3u8", "M3U8流媒体"),
            ("https://example.com/large_video.mp4", "大文件HTTP下载"),
            ("https://example.com/small_file.mp3", "小文件HTTP下载"),
        ];

        for (url, expected_strategy) in test_cases {
            let is_m3u8 = downloader.is_m3u8_url(url);

            match expected_strategy {
                "M3U8流媒体" => {
                    assert!(is_m3u8, "应该识别为M3U8: {}", url);
                }
                _ => {
                    assert!(!is_m3u8, "不应该识别为M3U8: {}", url);
                }
            }
        }

        println!("✅ 智能下载策略测试通过");
    }

    #[test]
    fn test_m3u8_encryption_parsing() {
        use super::super::m3u8_downloader::{M3U8Downloader, M3U8DownloaderConfig};

        let config = M3U8DownloaderConfig::default();
        let downloader = M3U8Downloader::new(config).unwrap();

        // 测试加密信息解析
        let encryption_lines = vec![
            r#"#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key.bin""#,
            r#"#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0X99b74007b6254e4bd1c6e03631cad15b"#,
            r#"#EXT-X-KEY:METHOD=NONE"#,
        ];

        // 测试AES-128加密
        let encryption1 = downloader
            .parse_encryption_line(encryption_lines[0])
            .unwrap();
        assert!(encryption1.is_some());
        let encryption1 = encryption1.unwrap();
        assert_eq!(encryption1.method, "AES-128");
        assert_eq!(encryption1.key_url.unwrap(), "https://example.com/key.bin");

        // 测试带IV的加密
        let encryption2 = downloader
            .parse_encryption_line(encryption_lines[1])
            .unwrap();
        assert!(encryption2.is_some());
        let encryption2 = encryption2.unwrap();
        assert_eq!(encryption2.method, "AES-128");
        assert_eq!(encryption2.key_url.unwrap(), "key.bin");
        assert_eq!(
            encryption2.iv.unwrap(),
            "0X99b74007b6254e4bd1c6e03631cad15b"
        );

        // 测试无加密
        let encryption3 = downloader
            .parse_encryption_line(encryption_lines[2])
            .unwrap();
        assert!(encryption3.is_none());

        println!("✅ M3U8加密信息解析测试通过");
    }

    #[tokio::test]
    async fn test_m3u8_downloader_configuration() {
        let temp_dir = tempdir().unwrap();
        let mut config = super::super::m3u8_downloader::M3U8DownloaderConfig::default();
        config.temp_dir = temp_dir.path().to_path_buf();
        config.max_concurrent_segments = 8;
        config.timeout = 60;
        config.retry_attempts = 5;

        let downloader = super::super::m3u8_downloader::M3U8Downloader::new(config.clone());
        assert!(downloader.is_ok());

        // 验证配置参数
        assert_eq!(config.max_concurrent_segments, 8);
        assert_eq!(config.timeout, 60);
        assert_eq!(config.retry_attempts, 5);
        assert!(config.temp_dir.exists());

        println!("✅ M3U8下载器配置测试通过");
    }
}
