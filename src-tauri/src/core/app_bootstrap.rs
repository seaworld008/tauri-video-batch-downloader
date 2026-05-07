use anyhow::Result;

use crate::core::config::{AppConfig, SystemConfig, UiConfig};
use crate::core::downloader::{DownloaderConfig, HttpDownloader};
use crate::core::models::DownloadConfig;

pub fn load_or_initialize_config() -> AppConfig {
    match AppConfig::load() {
        Ok(cfg) => {
            if let Err(err) = cfg.validate() {
                tracing::warn!(
                    "Invalid configuration detected ({}), falling back to defaults",
                    err
                );
                persist_default_config()
            } else {
                cfg
            }
        }
        Err(err) => {
            tracing::warn!(
                "Failed to load configuration from disk: {}. Using defaults",
                err
            );
            persist_default_config()
        }
    }
}

pub fn ensure_optional_config_defaults(config: &mut AppConfig) {
    if config.ui.is_none() {
        config.ui = Some(UiConfig::default());
    }
    if config.system.is_none() {
        config.system = Some(SystemConfig::default());
    }
}

pub fn downloader_config_from_download_config(
    download_config: &DownloadConfig,
) -> DownloaderConfig {
    DownloaderConfig {
        max_concurrent: download_config.concurrent_downloads.max(1),
        max_connections_per_download: 4,
        timeout: download_config.timeout_seconds,
        retry_attempts: download_config.retry_attempts,
        buffer_size: 64 * 1024,
        user_agent: download_config.user_agent.clone(),
        resume_enabled: true,
    }
}

pub fn fallback_downloader_config() -> DownloaderConfig {
    DownloaderConfig {
        max_concurrent: 1,
        max_connections_per_download: 1,
        timeout: 120,
        retry_attempts: 0,
        buffer_size: 16 * 1024,
        user_agent: "VideoDownloaderPro/1.0.0-fallback".to_string(),
        resume_enabled: false,
    }
}

pub fn create_http_downloader(config: DownloaderConfig) -> Result<HttpDownloader> {
    HttpDownloader::new(config)
}

fn persist_default_config() -> AppConfig {
    let default_cfg = AppConfig::default();
    if let Err(save_err) = default_cfg.save() {
        tracing::warn!("Failed to persist default configuration: {}", save_err);
    }
    default_cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_http_downloader_config_from_download_config() {
        let mut download = DownloadConfig::default();
        download.concurrent_downloads = 0;
        download.timeout_seconds = 42;
        download.retry_attempts = 7;
        download.user_agent = "test-agent".into();

        let config = downloader_config_from_download_config(&download);

        assert_eq!(config.max_concurrent, 1);
        assert_eq!(config.max_connections_per_download, 4);
        assert_eq!(config.timeout, 42);
        assert_eq!(config.retry_attempts, 7);
        assert_eq!(config.buffer_size, 64 * 1024);
        assert_eq!(config.user_agent, "test-agent");
        assert!(config.resume_enabled);
    }

    #[test]
    fn fallback_downloader_config_is_conservative() {
        let config = fallback_downloader_config();

        assert_eq!(config.max_concurrent, 1);
        assert_eq!(config.max_connections_per_download, 1);
        assert_eq!(config.retry_attempts, 0);
        assert!(!config.resume_enabled);
    }
}
