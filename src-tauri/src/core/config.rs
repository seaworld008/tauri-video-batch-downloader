//! Application configuration management

use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use super::models::DownloadConfig;

/// Main application configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub download: DownloadConfig,
    pub ui: Option<UiConfig>,
    pub system: Option<SystemConfig>,
    pub youtube: Option<YoutubeConfig>,
    pub advanced: AdvancedConfig,
}

/// UI-related configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub theme: String, // "light", "dark", "system"
    pub language: String,
    pub window_width: u32,
    pub window_height: u32,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub show_completed_tasks: bool,
    pub auto_start_downloads: bool,
    pub show_notifications: bool,
    pub notification_sound: bool,
    pub minimize_to_tray: bool,
    pub start_minimized: bool,
}

/// System-related configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemConfig {
    pub auto_update: bool,
    pub check_update_on_startup: bool,
    pub hardware_acceleration: bool,
    pub max_memory_usage_mb: Option<u64>,
    pub temp_directory: Option<String>,
    pub log_level: Option<String>, // "error", "warn", "info", "debug", "trace"
}

/// YouTube-specific configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoutubeConfig {
    pub default_quality: Option<String>, // "best", "worst", "720p", "1080p", etc.
    pub default_format: Option<String>,  // "mp4", "webm", "mkv", etc.
    pub extract_audio: bool,
    pub audio_format: Option<String>, // "mp3", "aac", "opus", etc.
    pub download_subtitles: bool,
    pub subtitle_languages: Vec<String>,
    pub download_thumbnail: bool,
    pub download_description: bool,
    pub playlist_reverse: bool,
    pub playlist_max_items: Option<usize>,
}

/// Advanced configuration options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedConfig {
    pub enable_logging: bool,
    pub log_level: String, // "error", "warn", "info", "debug"
    pub max_log_files: usize,
    pub cleanup_on_exit: bool,
    pub enable_proxy: bool,
    pub proxy_type: String, // "http", "socks5"
    pub proxy_host: Option<String>,
    pub proxy_port: Option<u16>,
    pub proxy_username: Option<String>,
    pub proxy_password: Option<String>,
    pub custom_user_agents: HashMap<String, String>,
    pub rate_limit_mbps: Option<f64>,
    pub enable_statistics: bool,
    pub statistics_retention_days: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            download: DownloadConfig::default(),
            ui: Some(UiConfig::default()),
            system: Some(SystemConfig::default()),
            youtube: Some(YoutubeConfig::default()),
            advanced: AdvancedConfig::default(),
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: "zh-CN".to_string(),
            window_width: 1200,
            window_height: 800,
            window_x: None,
            window_y: None,
            show_completed_tasks: true,
            auto_start_downloads: false,
            show_notifications: true,
            notification_sound: true,
            minimize_to_tray: false,
            start_minimized: false,
        }
    }
}

impl Default for SystemConfig {
    fn default() -> Self {
        Self {
            auto_update: true,
            check_update_on_startup: true,
            hardware_acceleration: true,
            max_memory_usage_mb: None,
            temp_directory: None,
            log_level: Some("info".to_string()),
        }
    }
}

impl Default for YoutubeConfig {
    fn default() -> Self {
        Self {
            default_quality: Some("720p".to_string()),
            default_format: Some("mp4".to_string()),
            extract_audio: false,
            audio_format: Some("mp3".to_string()),
            download_subtitles: false,
            subtitle_languages: vec!["zh-CN".to_string(), "en".to_string()],
            download_thumbnail: true,
            download_description: true,
            playlist_reverse: false,
            playlist_max_items: None,
        }
    }
}

impl Default for AdvancedConfig {
    fn default() -> Self {
        Self {
            enable_logging: true,
            log_level: "info".to_string(),
            max_log_files: 10,
            cleanup_on_exit: true,
            enable_proxy: false,
            proxy_type: "http".to_string(),
            proxy_host: None,
            proxy_port: None,
            proxy_username: None,
            proxy_password: None,
            custom_user_agents: HashMap::new(),
            rate_limit_mbps: None,
            enable_statistics: true,
            statistics_retention_days: 30,
        }
    }
}

impl AppConfig {
    /// Load configuration from file, creating default if not exists
    pub fn load() -> Result<Self> {
        let config_path = Self::get_config_path()?;

        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)
                .with_context(|| format!("Failed to read config file: {:?}", config_path))?;

            let config: AppConfig =
                serde_json::from_str(&content).with_context(|| "Failed to parse config file")?;

            tracing::info!("Loaded configuration from: {:?}", config_path);
            Ok(config)
        } else {
            let config = Self::default();
            config.save()?;
            tracing::info!("Created default configuration at: {:?}", config_path);
            Ok(config)
        }
    }

    /// Save configuration to file
    pub fn save(&self) -> Result<()> {
        let config_path = Self::get_config_path()?;

        // Ensure parent directory exists
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create config directory: {:?}", parent))?;
        }

        let content =
            serde_json::to_string_pretty(self).with_context(|| "Failed to serialize config")?;

        std::fs::write(&config_path, content)
            .with_context(|| format!("Failed to write config file: {:?}", config_path))?;

        tracing::info!("Saved configuration to: {:?}", config_path);
        Ok(())
    }

    /// Get the path to the configuration file
    pub fn get_config_path() -> Result<PathBuf> {
        let project_dirs = ProjectDirs::from("com", "videodownloader", "pro")
            .with_context(|| "Failed to get project directories")?;

        let config_dir = project_dirs.config_dir();
        Ok(config_dir.join("config.json"))
    }

    /// Get the application data directory
    pub fn get_data_dir() -> Result<PathBuf> {
        let project_dirs = ProjectDirs::from("com", "videodownloader", "pro")
            .with_context(|| "Failed to get project directories")?;

        Ok(project_dirs.data_dir().to_path_buf())
    }

    /// Get the logs directory
    pub fn get_logs_dir() -> Result<PathBuf> {
        let data_dir = Self::get_data_dir()?;
        Ok(data_dir.join("logs"))
    }

    /// Reset configuration to defaults
    pub fn reset() -> Result<Self> {
        let config = Self::default();
        config.save()?;
        tracing::info!("Reset configuration to defaults");
        Ok(config)
    }

    /// Export configuration as JSON string
    pub fn export(&self) -> Result<String> {
        serde_json::to_string_pretty(self).with_context(|| "Failed to export configuration")
    }

    /// Import configuration from JSON string
    pub fn import(json: &str) -> Result<Self> {
        let config: AppConfig =
            serde_json::from_str(json).with_context(|| "Failed to parse imported configuration")?;

        // Validate before saving
        config
            .validate()
            .with_context(|| "Imported configuration is invalid")?;

        config.save()?;
        tracing::info!("Imported and validated configuration from JSON");
        Ok(config)
    }

    /// Merge with another configuration, keeping non-None values from other
    pub fn merge(&mut self, other: &AppConfig) {
        // Merge download config
        if other.download.concurrent_downloads != 0 {
            self.download.concurrent_downloads = other.download.concurrent_downloads;
        }
        if other.download.retry_attempts != 0 {
            self.download.retry_attempts = other.download.retry_attempts;
        }
        if other.download.timeout_seconds != 0 {
            self.download.timeout_seconds = other.download.timeout_seconds;
        }
        if !other.download.user_agent.is_empty() {
            self.download.user_agent = other.download.user_agent.clone();
        }
        if other.download.proxy.is_some() {
            self.download.proxy = other.download.proxy.clone();
        }
        if !other.download.headers.is_empty() {
            self.download.headers = other.download.headers.clone();
        }
        if !other.download.output_directory.is_empty() {
            self.download.output_directory = other.download.output_directory.clone();
        }

        // Merge UI config
        if let Some(ref other_ui) = other.ui {
            if let Some(ref mut self_ui) = self.ui {
                if !other_ui.theme.is_empty() {
                    self_ui.theme = other_ui.theme.clone();
                }
                if !other_ui.language.is_empty() {
                    self_ui.language = other_ui.language.clone();
                }
                if other_ui.window_width != 1200 {
                    self_ui.window_width = other_ui.window_width;
                }
                if other_ui.window_height != 800 {
                    self_ui.window_height = other_ui.window_height;
                }
                if other_ui.window_x.is_some() {
                    self_ui.window_x = other_ui.window_x;
                }
                if other_ui.window_y.is_some() {
                    self_ui.window_y = other_ui.window_y;
                }
                self_ui.show_completed_tasks = other_ui.show_completed_tasks;
                self_ui.auto_start_downloads = other_ui.auto_start_downloads;
                self_ui.show_notifications = other_ui.show_notifications;
                self_ui.notification_sound = other_ui.notification_sound;
                self_ui.minimize_to_tray = other_ui.minimize_to_tray;
                self_ui.start_minimized = other_ui.start_minimized;
            } else {
                self.ui = other.ui.clone();
            }
        }

        // Merge system config
        if other.system.is_some() {
            self.system = other.system.clone();
        }

        // Merge YouTube config
        if other.youtube.is_some() {
            self.youtube = other.youtube.clone();
        }

        // Merge advanced config (always present)
        if !other.advanced.log_level.is_empty() {
            self.advanced.log_level = other.advanced.log_level.clone();
        }
        if other.advanced.max_log_files != 10 {
            self.advanced.max_log_files = other.advanced.max_log_files;
        }
        self.advanced.enable_logging = other.advanced.enable_logging;
        self.advanced.cleanup_on_exit = other.advanced.cleanup_on_exit;
        self.advanced.enable_proxy = other.advanced.enable_proxy;
        if !other.advanced.proxy_type.is_empty() {
            self.advanced.proxy_type = other.advanced.proxy_type.clone();
        }
        if other.advanced.proxy_host.is_some() {
            self.advanced.proxy_host = other.advanced.proxy_host.clone();
        }
        if other.advanced.proxy_port.is_some() {
            self.advanced.proxy_port = other.advanced.proxy_port;
        }
        if other.advanced.proxy_username.is_some() {
            self.advanced.proxy_username = other.advanced.proxy_username.clone();
        }
        if other.advanced.proxy_password.is_some() {
            self.advanced.proxy_password = other.advanced.proxy_password.clone();
        }
        if !other.advanced.custom_user_agents.is_empty() {
            self.advanced.custom_user_agents = other.advanced.custom_user_agents.clone();
        }
        if other.advanced.rate_limit_mbps.is_some() {
            self.advanced.rate_limit_mbps = other.advanced.rate_limit_mbps;
        }
        self.advanced.enable_statistics = other.advanced.enable_statistics;
        if other.advanced.statistics_retention_days != 30 {
            self.advanced.statistics_retention_days = other.advanced.statistics_retention_days;
        }
    }

    /// Create a backup of the current configuration
    pub fn backup(&self) -> Result<PathBuf> {
        let config_path = Self::get_config_path()?;
        let backup_path = config_path.with_extension(format!(
            "backup.{}.json",
            chrono::Utc::now().format("%Y%m%d_%H%M%S")
        ));

        let content = self.export()?;
        std::fs::write(&backup_path, content)
            .with_context(|| format!("Failed to create backup: {:?}", backup_path))?;

        tracing::info!("Created configuration backup: {:?}", backup_path);
        Ok(backup_path)
    }

    /// Restore configuration from a backup file
    pub fn restore_from_backup(backup_path: &PathBuf) -> Result<Self> {
        let content = std::fs::read_to_string(backup_path)
            .with_context(|| format!("Failed to read backup file: {:?}", backup_path))?;

        let config = Self::import(&content)?;
        tracing::info!("Restored configuration from backup: {:?}", backup_path);
        Ok(config)
    }

    /// Get configuration as environment variables (for debugging)
    pub fn to_env_vars(&self) -> HashMap<String, String> {
        let mut env_vars = HashMap::new();

        // Download config
        env_vars.insert(
            "DOWNLOAD_CONCURRENT".to_string(),
            self.download.concurrent_downloads.to_string(),
        );
        env_vars.insert(
            "DOWNLOAD_RETRY".to_string(),
            self.download.retry_attempts.to_string(),
        );
        env_vars.insert(
            "DOWNLOAD_TIMEOUT".to_string(),
            self.download.timeout_seconds.to_string(),
        );
        env_vars.insert(
            "DOWNLOAD_USER_AGENT".to_string(),
            self.download.user_agent.clone(),
        );
        env_vars.insert(
            "DOWNLOAD_OUTPUT_DIR".to_string(),
            self.download.output_directory.clone(),
        );

        // UI config
        if let Some(ref ui) = self.ui {
            env_vars.insert("UI_THEME".to_string(), ui.theme.clone());
            env_vars.insert("UI_LANGUAGE".to_string(), ui.language.clone());
            env_vars.insert("UI_WINDOW_WIDTH".to_string(), ui.window_width.to_string());
            env_vars.insert("UI_WINDOW_HEIGHT".to_string(), ui.window_height.to_string());
        }

        // Advanced config
        env_vars.insert(
            "ADVANCED_LOG_LEVEL".to_string(),
            self.advanced.log_level.clone(),
        );
        env_vars.insert(
            "ADVANCED_ENABLE_LOGGING".to_string(),
            self.advanced.enable_logging.to_string(),
        );
        env_vars.insert(
            "ADVANCED_ENABLE_PROXY".to_string(),
            self.advanced.enable_proxy.to_string(),
        );

        env_vars
    }

    /// Validate configuration values
    pub fn validate(&self) -> Result<()> {
        // Validate download config
        if self.download.concurrent_downloads == 0 {
            anyhow::bail!("Concurrent downloads must be greater than 0");
        }

        if self.download.concurrent_downloads > 20 {
            anyhow::bail!("Concurrent downloads should not exceed 20");
        }

        if self.download.retry_attempts > 10 {
            anyhow::bail!("Retry attempts should not exceed 10");
        }

        if self.download.timeout_seconds == 0 || self.download.timeout_seconds > 300 {
            anyhow::bail!("Timeout should be between 1 and 300 seconds");
        }

        // Validate UI config
        if let Some(ref ui) = self.ui {
            if !["light", "dark", "system"].contains(&ui.theme.as_str()) {
                anyhow::bail!("Invalid theme: must be 'light', 'dark', or 'system'");
            }

            if ui.window_width < 800 || ui.window_width > 4000 {
                anyhow::bail!("Window width should be between 800 and 4000 pixels");
            }

            if ui.window_height < 600 || ui.window_height > 3000 {
                anyhow::bail!("Window height should be between 600 and 3000 pixels");
            }
        }

        // Validate system config
        if let Some(ref system) = self.system {
            if let Some(ref log_level) = system.log_level {
                if !["error", "warn", "info", "debug", "trace"].contains(&log_level.as_str()) {
                    anyhow::bail!("Invalid system log level: must be 'error', 'warn', 'info', 'debug', or 'trace'");
                }
            }

            if let Some(max_memory) = system.max_memory_usage_mb {
                if !(512..=32768).contains(&max_memory) {
                    anyhow::bail!("Max memory usage should be between 512MB and 32GB");
                }
            }
        }

        // Validate YouTube config
        if let Some(ref youtube) = self.youtube {
            if let Some(ref quality) = youtube.default_quality {
                let valid_qualities = [
                    "best", "worst", "144p", "240p", "360p", "480p", "720p", "1080p", "1440p",
                    "2160p",
                ];
                if !valid_qualities.contains(&quality.as_str()) {
                    anyhow::bail!("Invalid YouTube quality: {}", quality);
                }
            }

            if let Some(ref format) = youtube.default_format {
                let valid_formats = ["mp4", "webm", "mkv", "avi", "flv"];
                if !valid_formats.contains(&format.as_str()) {
                    anyhow::bail!("Invalid YouTube format: {}", format);
                }
            }

            if let Some(ref audio_format) = youtube.audio_format {
                let valid_audio_formats = ["mp3", "aac", "opus", "m4a", "wav"];
                if !valid_audio_formats.contains(&audio_format.as_str()) {
                    anyhow::bail!("Invalid audio format: {}", audio_format);
                }
            }

            if let Some(max_items) = youtube.playlist_max_items {
                if max_items == 0 || max_items > 1000 {
                    anyhow::bail!("Playlist max items should be between 1 and 1000");
                }
            }
        }

        // Validate advanced config
        if !["error", "warn", "info", "debug", "trace"].contains(&self.advanced.log_level.as_str())
        {
            anyhow::bail!(
                "Invalid log level: must be 'error', 'warn', 'info', 'debug', or 'trace'"
            );
        }

        if self.advanced.max_log_files == 0 || self.advanced.max_log_files > 100 {
            anyhow::bail!("Max log files should be between 1 and 100");
        }

        if self.advanced.enable_proxy {
            if !["http", "https", "socks4", "socks5"].contains(&self.advanced.proxy_type.as_str()) {
                anyhow::bail!("Invalid proxy type: must be 'http', 'https', 'socks4', or 'socks5'");
            }

            if self.advanced.proxy_host.is_none() {
                anyhow::bail!("Proxy host must be specified when proxy is enabled");
            }

            if let Some(port) = self.advanced.proxy_port {
                if port == 0 {
                    anyhow::bail!("Proxy port should be between 1 and 65535");
                }
            }
        }

        if let Some(rate_limit) = self.advanced.rate_limit_mbps {
            if rate_limit <= 0.0 || rate_limit > 10000.0 {
                anyhow::bail!("Rate limit should be between 0.1 and 10000 Mbps");
            }
        }

        if self.advanced.statistics_retention_days == 0
            || self.advanced.statistics_retention_days > 365
        {
            anyhow::bail!("Statistics retention should be between 1 and 365 days");
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_validation() {
        let config = AppConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_config_serialization() {
        let config = AppConfig::default();
        let json = config.export().unwrap();
        let parsed_config = AppConfig::import(&json).unwrap();

        // Compare serialized forms since the structs contain floats
        assert_eq!(config.export().unwrap(), parsed_config.export().unwrap());
    }

    #[test]
    fn test_invalid_config_validation() {
        let mut config = AppConfig::default();

        // Test invalid concurrent downloads
        config.download.concurrent_downloads = 0;
        assert!(config.validate().is_err());

        config.download.concurrent_downloads = 25;
        assert!(config.validate().is_err());

        // Reset and test invalid theme
        config = AppConfig::default();
        if let Some(ref mut ui) = config.ui {
            ui.theme = "invalid".to_string();
        }
        assert!(config.validate().is_err());

        // Reset and test invalid log level
        config = AppConfig::default();
        config.advanced.log_level = "invalid".to_string();
        assert!(config.validate().is_err());

        // Test invalid YouTube quality
        config = AppConfig::default();
        if let Some(ref mut youtube) = config.youtube {
            youtube.default_quality = Some("invalid_quality".to_string());
        }
        assert!(config.validate().is_err());

        // Test invalid proxy configuration
        config = AppConfig::default();
        config.advanced.enable_proxy = true;
        config.advanced.proxy_host = None;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_config_merge() {
        let mut base_config = AppConfig::default();
        let mut other_config = AppConfig::default();

        // Modify other config
        other_config.download.concurrent_downloads = 5;
        if let Some(ref mut ui) = other_config.ui {
            ui.theme = "dark".to_string();
            ui.window_width = 1920;
        }

        // Merge
        base_config.merge(&other_config);

        // Verify merge results
        assert_eq!(base_config.download.concurrent_downloads, 5);
        if let Some(ref ui) = base_config.ui {
            assert_eq!(ui.theme, "dark");
            assert_eq!(ui.window_width, 1920);
        }
    }

    #[test]
    fn test_env_vars_generation() {
        let config = AppConfig::default();
        let env_vars = config.to_env_vars();

        assert!(env_vars.contains_key("DOWNLOAD_CONCURRENT"));
        assert!(env_vars.contains_key("UI_THEME"));
        assert!(env_vars.contains_key("ADVANCED_LOG_LEVEL"));
    }
}
