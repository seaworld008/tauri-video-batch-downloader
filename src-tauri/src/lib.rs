//! Video Downloader Pro - Core Library
//!
//! This library provides the core functionality for the video downloader application,
//! including download management, file parsing, and system utilities.

pub mod commands;
pub mod core;
pub mod downloaders;
pub mod parsers;
pub mod utils;

// Re-export commonly used types
pub use core::{
    config::AppConfig,
    downloader::HttpDownloader,
    file_parser::FileParser,
    m3u8_downloader::M3U8Downloader,
    manager::DownloadManager,
    models::{DownloadConfig, ImportedData, ProgressUpdate, TaskStatus, VideoTask},
    youtube_downloader::YoutubeDownloader,
};

pub use utils::encoding::detect_encoding;

use std::sync::Arc;

/// Application state shared between Tauri commands
#[derive(Clone)]
pub struct AppState {
    pub download_manager: Arc<tokio::sync::RwLock<DownloadManager>>,
    pub http_downloader: Arc<tokio::sync::RwLock<HttpDownloader>>,
    pub config: Arc<tokio::sync::RwLock<AppConfig>>,
}

impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let config = core::models::DownloadConfig::default();

        // 创建HTTP下载器配置
        let downloader_config = core::downloader::DownloaderConfig {
            max_concurrent: config.concurrent_downloads,
            max_connections_per_download: 4,
            timeout: config.timeout_seconds,
            retry_attempts: config.retry_attempts,
            buffer_size: 64 * 1024, // 64KB
            user_agent: config.user_agent.clone(),
            resume_enabled: true,
        };

        let http_downloader = HttpDownloader::new(downloader_config)
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP downloader: {}", e))?;

        Ok(Self {
            download_manager: Arc::new(tokio::sync::RwLock::new(DownloadManager::new(config)?)),
            http_downloader: Arc::new(tokio::sync::RwLock::new(http_downloader)),
            config: Arc::new(tokio::sync::RwLock::new(AppConfig::default())),
        })
    }
}

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Library name
pub const NAME: &str = env!("CARGO_PKG_NAME");

/// Initialize the library with default settings
pub fn init() -> anyhow::Result<()> {
    // 初始化日志系统（如果还没有初始化）
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "video_downloader_pro=info");
    }

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init()
        .ok(); // 忽略重复初始化错误

    tracing::info!("📚 {} v{} initialized", NAME, VERSION);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init() {
        assert!(init().is_ok());
    }

    #[test]
    fn test_version() {
        assert!(!VERSION.is_empty());
        assert!(!NAME.is_empty());
    }
}
