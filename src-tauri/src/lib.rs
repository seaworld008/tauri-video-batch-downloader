//! Video Downloader Pro - Core Library
//!
//! This library provides the core functionality for the video downloader application,
//! including download management, file parsing, and system utilities.

pub mod commands;
pub mod core;
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
    runtime::{spawn_download_runtime, DownloadRuntimeHandle},
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
    pub download_runtime: DownloadRuntimeHandle,
}

impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let mut config = Self::load_or_initialize_config();
        let download_config = config.download.clone();

        // 创建HTTP下载器配置
        let downloader_config = core::downloader::DownloaderConfig {
            max_concurrent: download_config.concurrent_downloads.max(1),
            max_connections_per_download: 4,
            timeout: download_config.timeout_seconds,
            retry_attempts: download_config.retry_attempts,
            buffer_size: 64 * 1024, // 64KB
            user_agent: download_config.user_agent.clone(),
            resume_enabled: true,
        };

        let http_downloader = HttpDownloader::new(downloader_config)
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP downloader: {}", e))?;

        if config.ui.is_none() {
            config.ui = Some(core::config::UiConfig::default());
        }
        if config.system.is_none() {
            config.system = Some(core::config::SystemConfig::default());
        }

        let download_manager = Arc::new(tokio::sync::RwLock::new(DownloadManager::new(
            download_config,
        )?));
        let download_runtime = spawn_download_runtime(download_manager.clone());

        Ok(Self {
            download_manager,
            http_downloader: Arc::new(tokio::sync::RwLock::new(http_downloader)),
            config: Arc::new(tokio::sync::RwLock::new(config)),
            download_runtime,
        })
    }

    fn load_or_initialize_config() -> AppConfig {
        match AppConfig::load() {
            Ok(cfg) => {
                if let Err(err) = cfg.validate() {
                    tracing::warn!(
                        "Invalid configuration detected ({}), falling back to defaults",
                        err
                    );
                    let default_cfg = AppConfig::default();
                    if let Err(save_err) = default_cfg.save() {
                        tracing::warn!("Failed to persist default configuration: {}", save_err);
                    }
                    default_cfg
                } else {
                    cfg
                }
            }
            Err(err) => {
                tracing::warn!(
                    "Failed to load configuration from disk: {}. Using defaults",
                    err
                );
                let default_cfg = AppConfig::default();
                if let Err(save_err) = default_cfg.save() {
                    tracing::warn!("Failed to persist default configuration: {}", save_err);
                }
                default_cfg
            }
        }
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
