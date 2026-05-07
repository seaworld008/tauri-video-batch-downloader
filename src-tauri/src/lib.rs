//! Video Downloader Pro - Core Library
//!
//! This library provides the core functionality for the video downloader application,
//! including download management, file parsing, and system utilities.

// TODO(code-quality): roll out crate-wide
// #![warn(clippy::unwrap_used, clippy::expect_used)] once each pre-existing
// call site has been audited (~150 unwraps across core/*). Doing it crate-wide
// today would be denied by `cargo clippy -- -D warnings` in CI. Until that
// audit lands, *new* modules in safety-critical paths should opt in locally
// via `#![deny(clippy::unwrap_used, clippy::expect_used)]` at the top of the
// file, and tests within those modules should `#[allow(...)]` the same lint.

pub mod commands;
pub mod core;
pub mod engine;
pub mod infra;
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

use engine::task_engine::{spawn_task_engine, TaskEngineHandle};

/// Application state shared between Tauri commands
#[derive(Clone)]
pub struct AppState {
    pub download_manager: Arc<tokio::sync::RwLock<DownloadManager>>,
    pub http_downloader: Arc<tokio::sync::RwLock<HttpDownloader>>,
    pub config: Arc<tokio::sync::RwLock<AppConfig>>,
    pub download_runtime: DownloadRuntimeHandle,
    pub task_engine: TaskEngineHandle,
}

impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let mut config = core::app_bootstrap::load_or_initialize_config();
        let download_config = config.download.clone();

        let downloader_config =
            core::app_bootstrap::downloader_config_from_download_config(&download_config);
        let http_downloader = core::app_bootstrap::create_http_downloader(downloader_config)
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP downloader: {}", e))?;

        core::app_bootstrap::ensure_optional_config_defaults(&mut config);

        let download_manager = Arc::new(tokio::sync::RwLock::new(DownloadManager::new(
            download_config,
        )?));
        let download_runtime = spawn_download_runtime(download_manager.clone());
        let task_engine = spawn_task_engine(Arc::new(download_runtime.clone()));

        Ok(Self {
            download_manager,
            http_downloader: Arc::new(tokio::sync::RwLock::new(http_downloader)),
            config: Arc::new(tokio::sync::RwLock::new(config)),
            download_runtime,
            task_engine,
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
        std::env::set_var("RUST_LOG", "off");
        assert!(init().is_ok());
    }

    #[test]
    fn test_version() {
        assert!(!VERSION.is_empty());
        assert!(!NAME.is_empty());
    }
}
