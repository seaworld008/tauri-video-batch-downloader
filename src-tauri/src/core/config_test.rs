//! 配置管理系统单元测试
//!
//! 测试 AppConfig 的核心功能，包括序列化、反序列化、验证、备份等

#[cfg(test)]
mod tests {
    use super::super::config::{AppConfig, UiConfig, SystemConfig, YoutubeConfig, AdvancedConfig};
    use crate::core::models::DownloadConfig;
    use std::collections::HashMap;
    use tempfile::tempdir;

    /// 创建测试用的完整配置
    fn create_test_config() -> AppConfig {
        AppConfig {
            download: DownloadConfig {
                concurrent_downloads: 3,
                retry_attempts: 3,
                timeout_seconds: 30,
                user_agent: "Test Agent".to_string(),
                proxy: Some("http://proxy:8080".to_string()),
                headers: {
                    let mut headers = HashMap::new();
                    headers.insert("Authorization".to_string(), "Bearer token".to_string());
                    headers
                },
                output_directory: "/test/downloads".to_string(),
            },
            ui: Some(UiConfig {
                theme: "dark".to_string(),
                language: "zh-CN".to_string(),
                window_width: 1200,
                window_height: 800,
                window_x: Some(100),
                window_y: Some(100),
                show_completed_tasks: true,
                auto_start_downloads: false,
                show_notifications: true,
                notification_sound: true,
                minimize_to_tray: false,
                start_minimized: false,
            }),
            system: Some(SystemConfig {
                auto_update: true,
                check_update_on_startup: true,
                hardware_acceleration: true,
                max_memory_usage_mb: Some(2048),
                temp_directory: Some("/tmp".to_string()),
                log_level: Some("info".to_string()),
            }),
            youtube: Some(YoutubeConfig {
                default_quality: Some("720p".to_string()),
                default_format: Some("mp4".to_string()),
                extract_audio: false,
                audio_format: Some("mp3".to_string()),
                download_subtitles: true,
                subtitle_languages: vec!["zh-CN".to_string(), "en".to_string()],
                download_thumbnail: true,
                download_description: true,
                playlist_reverse: false,
                playlist_max_items: Some(50),
            }),
            advanced: AdvancedConfig {
                enable_logging: true,
                log_level: "debug".to_string(),
                max_log_files: 10,
                cleanup_on_exit: true,
                enable_proxy: true,
                proxy_type: "http".to_string(),
                proxy_host: Some("proxy.example.com".to_string()),
                proxy_port: Some(8080),
                proxy_username: Some("user".to_string()),
                proxy_password: Some("pass".to_string()),
                custom_user_agents: {
                    let mut agents = HashMap::new();
                    agents.insert("youtube".to_string(), "YouTube Downloader".to_string());
                    agents
                },
                rate_limit_mbps: Some(10.0),
                enable_statistics: true,
                statistics_retention_days: 30,
            },
        }
    }

    #[test]
    fn test_default_config_creation() {
        let config = AppConfig::default();
        
        // 验证默认值
        assert_eq!(config.download.concurrent_downloads, 3);
        assert_eq!(config.download.retry_attempts, 3);
        assert_eq!(config.download.timeout_seconds, 30);
        
        assert!(config.ui.is_some());
        let ui = config.ui.as_ref().unwrap();
        assert_eq!(ui.theme, "system");
        assert_eq!(ui.language, "zh-CN");
        assert_eq!(ui.window_width, 1200);
        assert_eq!(ui.window_height, 800);
        
        assert!(config.system.is_some());
        let system = config.system.as_ref().unwrap();
        assert!(system.auto_update);
        assert!(system.hardware_acceleration);
        
        assert!(config.youtube.is_some());
        let youtube = config.youtube.as_ref().unwrap();
        assert_eq!(youtube.default_quality, Some("720p".to_string()));
        assert_eq!(youtube.default_format, Some("mp4".to_string()));
        
        assert!(config.advanced.enable_logging);
        assert_eq!(config.advanced.log_level, "info");
    }

    #[test]
    fn test_config_serialization() {
        let config = create_test_config();
        
        // 测试序列化
        let json = config.export().unwrap();
        assert!(!json.is_empty());
        assert!(json.contains("concurrent_downloads"));
        assert!(json.contains("theme"));
        assert!(json.contains("auto_update"));
        
        // 测试反序列化
        let parsed_config = AppConfig::import(&json).unwrap();
        
        // 验证核心字段
        assert_eq!(parsed_config.download.concurrent_downloads, 3);
        assert_eq!(parsed_config.ui.as_ref().unwrap().theme, "dark");
        assert_eq!(parsed_config.system.as_ref().unwrap().auto_update, true);
        assert_eq!(parsed_config.youtube.as_ref().unwrap().default_quality, Some("720p".to_string()));
        assert_eq!(parsed_config.advanced.log_level, "debug");
    }

    #[test]
    fn test_config_validation_valid() {
        let config = create_test_config();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_config_validation_invalid_download() {
        let mut config = create_test_config();
        
        // 测试无效的并发下载数
        config.download.concurrent_downloads = 0;
        assert!(config.validate().is_err());
        
        config.download.concurrent_downloads = 25;
        assert!(config.validate().is_err());
        
        // 测试无效的重试次数
        config = create_test_config();
        config.download.retry_attempts = 15;
        assert!(config.validate().is_err());
        
        // 测试无效的超时时间
        config = create_test_config();
        config.download.timeout_seconds = 0;
        assert!(config.validate().is_err());
        
        config.download.timeout_seconds = 400;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_invalid_ui() {
        let mut config = create_test_config();
        
        // 测试无效的主题
        if let Some(ref mut ui) = config.ui {
            ui.theme = "invalid_theme".to_string();
        }
        assert!(config.validate().is_err());
        
        // 测试无效的窗口大小
        config = create_test_config();
        if let Some(ref mut ui) = config.ui {
            ui.window_width = 500; // 太小
        }
        assert!(config.validate().is_err());
        
        config = create_test_config();
        if let Some(ref mut ui) = config.ui {
            ui.window_height = 5000; // 太大
        }
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_invalid_system() {
        let mut config = create_test_config();
        
        // 测试无效的日志级别
        if let Some(ref mut system) = config.system {
            system.log_level = Some("invalid_level".to_string());
        }
        assert!(config.validate().is_err());
        
        // 测试无效的内存限制
        config = create_test_config();
        if let Some(ref mut system) = config.system {
            system.max_memory_usage_mb = Some(100); // 太小
        }
        assert!(config.validate().is_err());
        
        config = create_test_config();
        if let Some(ref mut system) = config.system {
            system.max_memory_usage_mb = Some(100000); // 太大
        }
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_invalid_youtube() {
        let mut config = create_test_config();
        
        // 测试无效的质量设置
        if let Some(ref mut youtube) = config.youtube {
            youtube.default_quality = Some("invalid_quality".to_string());
        }
        assert!(config.validate().is_err());
        
        // 测试无效的格式
        config = create_test_config();
        if let Some(ref mut youtube) = config.youtube {
            youtube.default_format = Some("invalid_format".to_string());
        }
        assert!(config.validate().is_err());
        
        // 测试无效的音频格式
        config = create_test_config();
        if let Some(ref mut youtube) = config.youtube {
            youtube.audio_format = Some("invalid_audio".to_string());
        }
        assert!(config.validate().is_err());
        
        // 测试无效的播放列表限制
        config = create_test_config();
        if let Some(ref mut youtube) = config.youtube {
            youtube.playlist_max_items = Some(0);
        }
        assert!(config.validate().is_err());
        
        config = create_test_config();
        if let Some(ref mut youtube) = config.youtube {
            youtube.playlist_max_items = Some(2000);
        }
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_validation_invalid_advanced() {
        let mut config = create_test_config();
        
        // 测试无效的日志级别
        config.advanced.log_level = "invalid".to_string();
        assert!(config.validate().is_err());
        
        // 测试无效的日志文件数量
        config = create_test_config();
        config.advanced.max_log_files = 0;
        assert!(config.validate().is_err());
        
        config.advanced.max_log_files = 200;
        assert!(config.validate().is_err());
        
        // 测试启用代理但缺少主机
        config = create_test_config();
        config.advanced.enable_proxy = true;
        config.advanced.proxy_host = None;
        assert!(config.validate().is_err());
        
        // 测试无效的代理类型
        config = create_test_config();
        config.advanced.enable_proxy = true;
        config.advanced.proxy_type = "invalid".to_string();
        assert!(config.validate().is_err());
        
        // 测试无效的代理端口
        config = create_test_config();
        config.advanced.enable_proxy = true;
        config.advanced.proxy_port = Some(0);
        assert!(config.validate().is_err());
        
        // 测试无效的速率限制
        config = create_test_config();
        config.advanced.rate_limit_mbps = Some(-1.0);
        assert!(config.validate().is_err());
        
        config.advanced.rate_limit_mbps = Some(20000.0);
        assert!(config.validate().is_err());
        
        // 测试无效的统计保留天数
        config = create_test_config();
        config.advanced.statistics_retention_days = 0;
        assert!(config.validate().is_err());
        
        config.advanced.statistics_retention_days = 400;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_merge() {
        let mut base_config = AppConfig::default();
        let other_config = create_test_config();
        
        // 合并配置
        base_config.merge(&other_config);
        
        // 验证合并结果
        assert_eq!(base_config.download.concurrent_downloads, 3);
        assert_eq!(base_config.download.user_agent, "Test Agent");
        assert_eq!(base_config.ui.as_ref().unwrap().theme, "dark");
        assert_eq!(base_config.system.as_ref().unwrap().max_memory_usage_mb, Some(2048));
        assert_eq!(base_config.youtube.as_ref().unwrap().default_quality, Some("720p".to_string()));
        assert_eq!(base_config.advanced.log_level, "debug");
    }

    #[test]
    fn test_config_merge_partial() {
        let mut base_config = create_test_config();
        let mut partial_config = AppConfig::default();
        
        // 只修改部分字段
        partial_config.download.concurrent_downloads = 5;
        if let Some(ref mut ui) = partial_config.ui {
            ui.theme = "light".to_string();
        }
        
        base_config.merge(&partial_config);
        
        // 验证只有修改的字段被合并
        assert_eq!(base_config.download.concurrent_downloads, 5);
        assert_eq!(base_config.ui.as_ref().unwrap().theme, "light");
        
        // 其他字段应该保持原值
        assert_eq!(base_config.download.user_agent, "Test Agent");
        assert_eq!(base_config.advanced.log_level, "debug");
    }

    #[test]
    fn test_config_backup_restore() {
        let temp_dir = tempdir().unwrap();
        let config_path = temp_dir.path().join("test_config.json");
        
        // 设置临时环境变量以便测试
        std::env::set_var("CARGO_MANIFEST_DIR", temp_dir.path());
        
        let original_config = create_test_config();
        
        // 创建备份
        let backup_path = original_config.backup().unwrap();
        assert!(backup_path.exists());
        
        // 验证备份文件名格式
        let filename = backup_path.file_name().unwrap().to_string_lossy();
        assert!(filename.starts_with("config.backup."));
        assert!(filename.ends_with(".json"));
        
        // 从备份恢复
        let restored_config = AppConfig::restore_from_backup(&backup_path).unwrap();
        
        // 验证恢复的配置与原配置相同
        let original_json = original_config.export().unwrap();
        let restored_json = restored_config.export().unwrap();
        assert_eq!(original_json, restored_json);
        
        // 清理
        let _ = std::fs::remove_file(backup_path);
    }

    #[test]
    fn test_config_to_env_vars() {
        let config = create_test_config();
        let env_vars = config.to_env_vars();
        
        // 验证环境变量生成
        assert_eq!(env_vars.get("DOWNLOAD_CONCURRENT"), Some(&"3".to_string()));
        assert_eq!(env_vars.get("DOWNLOAD_USER_AGENT"), Some(&"Test Agent".to_string()));
        assert_eq!(env_vars.get("UI_THEME"), Some(&"dark".to_string()));
        assert_eq!(env_vars.get("UI_WINDOW_WIDTH"), Some(&"1200".to_string()));
        assert_eq!(env_vars.get("ADVANCED_LOG_LEVEL"), Some(&"debug".to_string()));
        assert_eq!(env_vars.get("ADVANCED_ENABLE_LOGGING"), Some(&"true".to_string()));
        
        // 验证环境变量数量
        assert!(env_vars.len() >= 8); // 至少应该有这些基本字段
    }

    #[test]
    fn test_config_import_invalid_json() {
        let invalid_json = "{ invalid json }";
        let result = AppConfig::import(invalid_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_config_import_valid_but_invalid_config() {
        // JSON格式正确但配置内容无效
        let invalid_config_json = r#"{
            "download": {
                "concurrent_downloads": 0,
                "retry_attempts": 3,
                "timeout_seconds": 30,
                "user_agent": "Test",
                "proxy": null,
                "headers": {},
                "output_directory": "/test"
            },
            "ui": {
                "theme": "invalid_theme",
                "language": "en",
                "window_width": 1200,
                "window_height": 800,
                "window_x": null,
                "window_y": null,
                "show_completed_tasks": true,
                "auto_start_downloads": false,
                "show_notifications": true,
                "notification_sound": true,
                "minimize_to_tray": false,
                "start_minimized": false
            },
            "system": null,
            "youtube": null,
            "advanced": {
                "enable_logging": true,
                "log_level": "info",
                "max_log_files": 10,
                "cleanup_on_exit": true,
                "enable_proxy": false,
                "proxy_type": "http",
                "proxy_host": null,
                "proxy_port": null,
                "proxy_username": null,
                "proxy_password": null,
                "custom_user_agents": {},
                "rate_limit_mbps": null,
                "enable_statistics": true,
                "statistics_retention_days": 30
            }
        }"#;
        
        let result = AppConfig::import(invalid_config_json);
        assert!(result.is_err()); // 应该因为验证失败而失败
    }

    /// 基准测试：序列化性能
    #[test]
    fn test_serialization_performance() {
        let config = create_test_config();
        
        let start = std::time::Instant::now();
        for _ in 0..1000 {
            let _json = config.export().unwrap();
        }
        let duration = start.elapsed();
        
        // 1000次序列化应该在100ms内完成
        assert!(duration.as_millis() < 100, "Serialization too slow: {:?}", duration);
    }

    /// 基准测试：反序列化性能
    #[test]
    fn test_deserialization_performance() {
        let config = create_test_config();
        let json = config.export().unwrap();
        
        let start = std::time::Instant::now();
        for _ in 0..1000 {
            let _config = AppConfig::import(&json).unwrap();
        }
        let duration = start.elapsed();
        
        // 1000次反序列化应该在200ms内完成
        assert!(duration.as_millis() < 200, "Deserialization too slow: {:?}", duration);
    }

    #[test]
    fn test_config_reset() {
        // 这个测试需要模拟文件系统操作，在实际环境中可能需要更复杂的设置
        let default_config = AppConfig::default();
        
        // 验证重置配置的默认值
        assert_eq!(default_config.download.concurrent_downloads, 3);
        assert_eq!(default_config.ui.as_ref().unwrap().theme, "system");
        assert_eq!(default_config.advanced.log_level, "info");
    }
}