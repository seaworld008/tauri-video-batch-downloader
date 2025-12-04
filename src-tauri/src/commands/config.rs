//! Configuration command handlers
//!
//! This module provides commands for managing application configuration,
//! including getting, updating, resetting, and importing/exporting settings.

use tauri::{AppHandle, State};
use tracing::{error, info, warn};

use crate::core::{
    models::{AppError, AppResult},
    AppConfig,
};
use crate::AppState;

/// Get current application configuration
#[tauri::command]
pub async fn get_config(_app: AppHandle, state: State<'_, AppState>) -> Result<AppConfig, String> {
    info!("⚙️ Getting application configuration");

    let config = state.config.read().await;
    Ok(config.clone())
}

/// Update application configuration
#[tauri::command]
pub async fn update_config(
    _app: AppHandle,
    state: State<'_, AppState>,
    new_config: AppConfig,
) -> Result<(), String> {
    info!("🔧 Updating application configuration");

    match update_config_impl(&state, new_config).await {
        Ok(()) => {
            info!("✅ Configuration updated successfully");
            Ok(())
        }
        Err(e) => {
            error!("❌ Failed to update configuration: {}", e);
            Err(e.to_string())
        }
    }
}

/// Reset configuration to default values
#[tauri::command]
pub async fn reset_config(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppConfig, String> {
    info!("🔄 Resetting configuration to defaults");

    match reset_config_impl(&state).await {
        Ok(config) => {
            info!("✅ Configuration reset successfully");
            Ok(config)
        }
        Err(e) => {
            error!("❌ Failed to reset configuration: {}", e);
            Err(e.to_string())
        }
    }
}

/// Export configuration to file
#[tauri::command]
pub async fn export_config(
    _app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    info!("💾 Exporting configuration to: {}", file_path);

    match export_config_impl(&state, &file_path).await {
        Ok(()) => {
            info!("✅ Configuration exported successfully");
            Ok(())
        }
        Err(e) => {
            error!("❌ Failed to export configuration: {}", e);
            Err(e.to_string())
        }
    }
}

/// Import configuration from file
#[tauri::command]
pub async fn import_config(
    _app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<AppConfig, String> {
    info!("📂 Importing configuration from: {}", file_path);

    match import_config_impl(&state, &file_path).await {
        Ok(config) => {
            info!("✅ Configuration imported successfully");
            Ok(config)
        }
        Err(e) => {
            error!("❌ Failed to import configuration: {}", e);
            Err(e.to_string())
        }
    }
}

// Implementation functions

async fn update_config_impl(state: &State<'_, AppState>, new_config: AppConfig) -> AppResult<()> {
    // Validate configuration
    validate_config(&new_config)?;

    // Update in memory
    {
        let mut config = state.config.write().await;
        *config = new_config.clone();
    }

    // Save to disk
    new_config
        .save()
        .map_err(|e| AppError::Config(format!("Failed to save configuration: {}", e)))?;

    // Update download manager configuration
    {
        let mut download_manager = state.download_manager.write().await;
        download_manager
            .update_config(new_config.download.clone())
            .await
            .map_err(|e| AppError::Config(format!("Failed to update download manager: {}", e)))?;
    }

    Ok(())
}

async fn reset_config_impl(state: &State<'_, AppState>) -> AppResult<AppConfig> {
    let default_config = AppConfig::default();

    // Update in memory
    {
        let mut config = state.config.write().await;
        *config = default_config.clone();
    }

    // Save to disk
    default_config
        .save()
        .map_err(|e| AppError::Config(format!("Failed to save default configuration: {}", e)))?;

    // Update download manager configuration
    {
        let mut download_manager = state.download_manager.write().await;
        download_manager
            .update_config(default_config.download.clone())
            .await
            .map_err(|e| AppError::Config(format!("Failed to update download manager: {}", e)))?;
    }

    Ok(default_config)
}

async fn export_config_impl(state: &State<'_, AppState>, file_path: &str) -> AppResult<()> {
    let config = state.config.read().await;

    // Serialize configuration to JSON
    let json_data = serde_json::to_string_pretty(&*config)
        .map_err(|e| AppError::Config(format!("Failed to serialize configuration: {}", e)))?;

    // Write to file
    tokio::fs::write(file_path, json_data)
        .await
        .map_err(|e| AppError::Io(e))?;

    Ok(())
}

async fn import_config_impl(state: &State<'_, AppState>, file_path: &str) -> AppResult<AppConfig> {
    // Check if file exists
    if !tokio::fs::try_exists(file_path)
        .await
        .map_err(|e| AppError::Io(e))?
    {
        return Err(AppError::Config(format!(
            "Configuration file not found: {}",
            file_path
        )));
    }

    // Read file content
    let content = tokio::fs::read_to_string(file_path)
        .await
        .map_err(|e| AppError::Io(e))?;

    // Parse JSON
    let imported_config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| AppError::Config(format!("Failed to parse configuration: {}", e)))?;

    // Validate configuration
    validate_config(&imported_config)?;

    // Update in memory
    {
        let mut config = state.config.write().await;
        *config = imported_config.clone();
    }

    // Save to default location
    imported_config
        .save()
        .map_err(|e| AppError::Config(format!("Failed to save imported configuration: {}", e)))?;

    // Update download manager configuration
    {
        let mut download_manager = state.download_manager.write().await;
        download_manager
            .update_config(imported_config.download.clone())
            .await
            .map_err(|e| AppError::Config(format!("Failed to update download manager: {}", e)))?;
    }

    Ok(imported_config)
}

fn validate_config(config: &AppConfig) -> AppResult<()> {
    // Validate download configuration
    if config.download.concurrent_downloads == 0 {
        return Err(AppError::Config(
            "Concurrent downloads must be greater than 0".to_string(),
        ));
    }

    if config.download.concurrent_downloads > 10 {
        warn!(
            "⚠️ Concurrent downloads set to {} (recommended: 1-5)",
            config.download.concurrent_downloads
        );
    }

    if config.download.timeout_seconds == 0 {
        return Err(AppError::Config(
            "Timeout must be greater than 0".to_string(),
        ));
    }

    if config.download.timeout_seconds > 300 {
        warn!(
            "⚠️ Timeout set to {}s (recommended: 30-120s)",
            config.download.timeout_seconds
        );
    }

    if config.download.retry_attempts > 10 {
        warn!(
            "⚠️ Retry attempts set to {} (recommended: 1-5)",
            config.download.retry_attempts
        );
    }

    // Validate UI configuration
    if let Some(ref ui) = config.ui {
        if ui.window_width < 800 || ui.window_height < 600 {
            warn!(
                "⚠️ Small window size detected: {}x{}",
                ui.window_width, ui.window_height
            );
        }

        if ui.window_width > 3840 || ui.window_height > 2160 {
            warn!(
                "⚠️ Very large window size detected: {}x{}",
                ui.window_width, ui.window_height
            );
        }
    }

    // Validate system configuration
    if let Some(ref system) = config.system {
        if let Some(ref log_level) = system.log_level {
            match log_level.to_lowercase().as_str() {
                "error" | "warn" | "info" | "debug" | "trace" => {}
                _ => {
                    return Err(AppError::Config(format!(
                        "Invalid log level: {}",
                        log_level
                    )));
                }
            }
        }
    }

    // Validate YouTube configuration
    if let Some(ref youtube) = config.youtube {
        if let Some(ref quality) = youtube.default_quality {
            match quality.as_str() {
                "best" | "worst" | "720p" | "1080p" | "1440p" | "2160p" => {}
                _ => {
                    warn!("⚠️ Unusual YouTube quality setting: {}", quality);
                }
            }
        }

        if let Some(ref format) = youtube.default_format {
            match format.as_str() {
                "mp4" | "webm" | "mkv" | "avi" => {}
                _ => {
                    warn!("⚠️ Unusual YouTube format setting: {}", format);
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_validate_valid_config() {
        let config = AppConfig::default();
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn test_validate_invalid_config() {
        let mut config = AppConfig::default();
        config.download.concurrent_downloads = 0;
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn test_validate_config_warnings() {
        let mut config = AppConfig::default();
        config.download.concurrent_downloads = 15;
        config.download.timeout_seconds = 500;

        // Should not error, but would generate warnings in logs
        assert!(validate_config(&config).is_ok());
    }
}
