//! System command handlers
//!
//! This module provides commands for system monitoring, file operations,
//! and system utilities like opening folders and checking tool availability.

use chrono::Local;
use directories::ProjectDirs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, State};
use tracing::{error, info, warn};

use crate::core::models::{AppError, AppResult, SystemInfo};
use crate::AppState;

/// Get current system information
#[tauri::command]
pub async fn get_system_info(
    _app: AppHandle,
    _state: State<'_, AppState>,
) -> Result<SystemInfo, String> {
    info!("📊 Getting system information");

    match get_system_info_impl().await {
        Ok(info) => Ok(info),
        Err(e) => {
            error!("❌ Failed to get system info: {}", e);
            Err(e.to_string())
        }
    }
}

/// Start system monitoring
#[tauri::command]
pub async fn start_system_monitor(
    _app: AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    info!("🔍 Starting system monitor");

    // System monitoring is handled in the main setup function
    // This command is for UI to request monitoring start
    Ok(())
}

/// Stop system monitoring
#[tauri::command]
pub async fn stop_system_monitor(
    _app: AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    info!("⏹️ Stopping system monitor");

    // This is a placeholder - real implementation would stop the monitoring task
    Ok(())
}

/// Open the downloads folder
#[tauri::command]
pub async fn open_download_folder(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let config = state.config.read().await;
    let folder_path = &config.download.output_directory;

    info!("📁 Opening download folder: {}", folder_path);

    match open_folder_impl(folder_path).await {
        Ok(()) => {
            info!("✅ Successfully opened download folder");
            Ok(())
        }
        Err(e) => {
            error!("❌ Failed to open download folder: {}", e);
            Err(e.to_string())
        }
    }
}

/// Show a specific file in its containing folder
#[tauri::command]
pub async fn show_in_folder(
    _app: AppHandle,
    _state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    info!("📂 Showing file in folder: {}", file_path);

    match show_in_folder_impl(&file_path).await {
        Ok(()) => {
            info!("✅ Successfully showed file in folder");
            Ok(())
        }
        Err(e) => {
            error!("❌ Failed to show file in folder: {}", e);
            Err(e.to_string())
        }
    }
}

/// Check if FFmpeg is available
#[tauri::command]
pub async fn check_ffmpeg() -> Result<bool, String> {
    info!("🎬 Checking FFmpeg availability");

    match check_tool_availability("ffmpeg", &["-version"]).await {
        Ok(available) => {
            if available {
                info!("✅ FFmpeg is available");
            } else {
                warn!("⚠️ FFmpeg is not available");
            }
            Ok(available)
        }
        Err(e) => {
            error!("❌ Failed to check FFmpeg: {}", e);
            Err(e.to_string())
        }
    }
}

/// Check if yt-dlp is available
#[tauri::command]
pub async fn check_yt_dlp() -> Result<bool, String> {
    info!("📺 Checking yt-dlp availability");

    match check_tool_availability("yt-dlp", &["--version"]).await {
        Ok(available) => {
            if available {
                info!("✅ yt-dlp is available");
            } else {
                warn!("⚠️ yt-dlp is not available");
            }
            Ok(available)
        }
        Err(e) => {
            error!("❌ Failed to check yt-dlp: {}", e);
            Err(e.to_string())
        }
    }
}

/// Validate if a URL is valid for video downloading
#[tauri::command]
pub async fn validate_url(url: String) -> Result<bool, String> {
    info!("🔍 Validating URL: {}", url);

    match validate_url_impl(&url).await {
        Ok(valid) => {
            if valid {
                info!("✅ URL is valid for downloading");
            } else {
                warn!("⚠️ URL is not valid for downloading");
            }
            Ok(valid)
        }
        Err(e) => {
            error!("❌ Failed to validate URL: {}", e);
            Err(e.to_string())
        }
    }
}

/// Get video information from URL
#[tauri::command]
pub async fn get_video_info(url: String) -> Result<serde_json::Value, String> {
    info!("📹 Getting video info for URL: {}", url);

    match get_video_info_impl(&url).await {
        Ok(info) => {
            info!("✅ Successfully retrieved video information");
            Ok(info)
        }
        Err(e) => {
            error!("❌ Failed to get video info: {}", e);
            Err(e.to_string())
        }
    }
}

/// Select output directory via file dialog
#[tauri::command]
pub async fn select_output_directory() -> Result<String, String> {
    info!("📁 Opening directory selection dialog");

    match select_output_directory_impl().await {
        Ok(path) => {
            info!("✅ Directory selected: {}", path);
            Ok(path)
        }
        Err(e) => {
            error!("❌ Failed to select directory: {}", e);
            Err(e.to_string())
        }
    }
}

// Implementation functions

async fn get_system_info_impl() -> AppResult<SystemInfo> {
    use crate::core::models::NetworkSpeed;

    // Get CPU usage (placeholder implementation)
    let cpu_usage = get_cpu_usage().await.unwrap_or(0.0);

    // Get memory usage
    let memory_usage = get_memory_usage().await.unwrap_or(0.0);

    // Get disk usage
    let disk_usage = get_disk_usage().await.unwrap_or(0.0);

    // Get network speed (placeholder)
    let network_speed = NetworkSpeed {
        download: 0.0,
        upload: 0.0,
    };

    // Get active downloads count (placeholder)
    let active_downloads = 0;

    Ok(SystemInfo {
        cpu_usage,
        memory_usage,
        disk_usage,
        network_speed,
        active_downloads,
    })
}

async fn open_folder_impl(folder_path: &str) -> AppResult<()> {
    // Create directory if it doesn't exist
    if !Path::new(folder_path).exists() {
        tokio::fs::create_dir_all(folder_path)
            .await
            .map_err(|e| AppError::Io(e))?;
    }

    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("explorer")
            .arg(folder_path)
            .output()
            .await
            .map_err(|e| AppError::System(format!("Failed to open folder: {}", e)))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::System(format!(
                "Explorer command failed: {}",
                error
            )));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let output = tokio::process::Command::new("open")
            .arg(folder_path)
            .output()
            .await
            .map_err(|e| AppError::System(format!("Failed to open folder: {}", e)))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::System(format!("Open command failed: {}", error)));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = tokio::process::Command::new("xdg-open")
            .arg(folder_path)
            .output()
            .await
            .map_err(|e| AppError::System(format!("Failed to open folder: {}", e)))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::System(format!(
                "xdg-open command failed: {}",
                error
            )));
        }
    }

    Ok(())
}

async fn show_in_folder_impl(file_path: &str) -> AppResult<()> {
    let path = Path::new(file_path);

    if !path.exists() {
        return Err(AppError::System(format!(
            "File does not exist: {}",
            file_path
        )));
    }

    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("explorer")
            .arg("/select,")
            .arg(file_path)
            .output()
            .await
            .map_err(|e| AppError::System(format!("Failed to show file: {}", e)))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::System(format!(
                "Explorer select command failed: {}",
                error
            )));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let output = tokio::process::Command::new("open")
            .arg("-R")
            .arg(file_path)
            .output()
            .await
            .map_err(|e| AppError::System(format!("Failed to show file: {}", e)))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::System(format!(
                "Open reveal command failed: {}",
                error
            )));
        }
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, open the containing directory
        if let Some(parent) = path.parent() {
            open_folder_impl(parent.to_str().unwrap()).await?;
        } else {
            return Err(AppError::System(
                "Cannot determine parent directory".to_string(),
            ));
        }
    }

    Ok(())
}

async fn check_tool_availability(tool_name: &str, args: &[&str]) -> AppResult<bool> {
    let output = tokio::process::Command::new(tool_name)
        .args(args)
        .output()
        .await;

    match output {
        Ok(output) => Ok(output.status.success()),
        Err(e) => match e.kind() {
            std::io::ErrorKind::NotFound => Ok(false),
            _ => Err(AppError::System(format!(
                "Failed to check {}: {}",
                tool_name, e
            ))),
        },
    }
}

async fn validate_url_impl(url: &str) -> AppResult<bool> {
    use url::Url;

    // First check if URL is parseable
    match Url::parse(url) {
        Ok(parsed_url) => {
            let scheme = parsed_url.scheme();

            // Check if scheme is supported
            if !matches!(scheme, "http" | "https") {
                return Ok(false);
            }

            // Check for common video domains or patterns
            let host = parsed_url.host_str().unwrap_or("");

            // Common video hosting domains
            let video_domains = [
                "youtube.com",
                "youtu.be",
                "vimeo.com",
                "dailymotion.com",
                "twitch.tv",
                "bilibili.com",
                "nicovideo.jp",
                "facebook.com",
                "instagram.com",
                "twitter.com",
                "tiktok.com",
                "reddit.com",
            ];

            // Check if it's a direct video file URL
            let path = parsed_url.path().to_lowercase();
            let video_extensions = [
                ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v",
            ];

            // Validate if URL contains video patterns or known domains
            let is_video_domain = video_domains.iter().any(|domain| host.contains(domain));
            let is_video_file = video_extensions.iter().any(|ext| path.ends_with(ext));
            let is_m3u8 = path.contains(".m3u8") || url.contains("m3u8");

            Ok(is_video_domain || is_video_file || is_m3u8)
        }
        Err(_) => Ok(false),
    }
}

async fn get_video_info_impl(url: &str) -> AppResult<serde_json::Value> {
    use serde_json::json;

    // First validate the URL
    if !validate_url_impl(url).await? {
        return Err(AppError::System(
            "Invalid URL for video extraction".to_string(),
        ));
    }

    // Try using yt-dlp if available
    if check_tool_availability("yt-dlp", &["--version"])
        .await
        .unwrap_or(false)
    {
        return get_video_info_with_ytdlp(url).await;
    }

    // Try using youtube-dl as fallback
    if check_tool_availability("youtube-dl", &["--version"])
        .await
        .unwrap_or(false)
    {
        return get_video_info_with_youtubedl(url).await;
    }

    // Basic info extraction without external tools
    let parsed_url = url::Url::parse(url)
        .map_err(|e| AppError::System(format!("Failed to parse URL: {}", e)))?;

    let title = extract_title_from_url(&parsed_url);
    let duration = None::<String>;

    Ok(json!({
        "title": title,
        "url": url,
        "duration": duration,
        "extractor": "basic",
        "available": true
    }))
}

async fn get_video_info_with_ytdlp(url: &str) -> AppResult<serde_json::Value> {
    let output = tokio::process::Command::new("yt-dlp")
        .args(&["--dump-json", "--no-download", url])
        .output()
        .await
        .map_err(|e| AppError::System(format!("Failed to execute yt-dlp: {}", e)))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::System(format!("yt-dlp failed: {}", error)));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let info: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::System(format!("Failed to parse yt-dlp JSON: {}", e)))?;

    Ok(info)
}

async fn get_video_info_with_youtubedl(url: &str) -> AppResult<serde_json::Value> {
    let output = tokio::process::Command::new("youtube-dl")
        .args(&["--dump-json", "--no-download", url])
        .output()
        .await
        .map_err(|e| AppError::System(format!("Failed to execute youtube-dl: {}", e)))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::System(format!("youtube-dl failed: {}", error)));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let info: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::System(format!("Failed to parse youtube-dl JSON: {}", e)))?;

    Ok(info)
}

fn extract_title_from_url(url: &url::Url) -> String {
    let host = url.host_str().unwrap_or("unknown");
    let path = url.path();

    // Try to extract meaningful title from URL
    if host.contains("youtube") {
        if let Some(video_id) = extract_youtube_video_id(url) {
            return format!("YouTube Video - {}", video_id);
        }
    }

    // Extract filename from path if it looks like a video file
    if let Some(filename) = path.split('/').last() {
        if filename.contains('.') {
            return filename.to_string();
        }
    }

    format!("Video from {}", host)
}

fn extract_youtube_video_id(url: &url::Url) -> Option<String> {
    // Handle youtube.com/watch?v=VIDEO_ID
    if let Some(query) = url.query() {
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if key == "v" {
                return Some(value.to_string());
            }
        }
    }

    // Handle youtu.be/VIDEO_ID
    if url.host_str()? == "youtu.be" {
        let path = url.path();
        if path.len() > 1 {
            return Some(path[1..].to_string());
        }
    }

    None
}

/// Append frontend log entries to the persistent log file
#[tauri::command]
pub async fn log_frontend_event(
    app: AppHandle,
    level: Option<String>,
    message: String,
) -> Result<(), String> {
    let log_root = if let Some(mut dir) = app.path_resolver().app_config_dir() {
        dir.push("logs");
        dir
    } else if let Some(mut dir) = app.path_resolver().app_data_dir() {
        dir.push("logs");
        dir
    } else if let Some(mut dir) = app.path_resolver().app_local_data_dir() {
        dir.push("logs");
        dir
    } else {
        let dirs = ProjectDirs::from("com", "videodownloader", "pro")
            .ok_or_else(|| "Failed to resolve application data directory".to_string())?;
        dirs.config_dir().join("logs")
    };

    std::fs::create_dir_all(&log_root)
        .map_err(|e| format!("Failed to create log directory: {e}"))?;

    let log_path = log_root.join("frontend.log");
    info!("Frontend log path: {}", log_path.display());
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {e}"))?;

    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let level = level.unwrap_or_else(|| "info".to_string());
    let entry = format!("[{timestamp}][{level}] {message}\n");

    file.write_all(entry.as_bytes())
        .map_err(|e| format!("Failed to write log entry: {e}"))?;

    Ok(())
}
// System monitoring helper functions

async fn get_cpu_usage() -> Option<f32> {
    // Placeholder implementation
    // In a real implementation, use a crate like `sysinfo` or `heim`

    #[cfg(target_os = "windows")]
    {
        // Windows-specific CPU usage detection
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        // macOS-specific CPU usage detection
        return None;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux-specific CPU usage detection
        // Could parse /proc/stat
        return None;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    None
}

async fn get_memory_usage() -> Option<f32> {
    // Placeholder implementation
    // In a real implementation, use a crate like `sysinfo` or `heim`

    #[cfg(target_os = "windows")]
    {
        // Windows-specific memory usage detection
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        // macOS-specific memory usage detection
        return None;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux-specific memory usage detection
        // Could parse /proc/meminfo
        return None;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    None
}

async fn get_disk_usage() -> Option<f32> {
    // Placeholder implementation
    // In a real implementation, use a crate like `sysinfo` or `heim`

    #[cfg(target_os = "windows")]
    {
        // Windows-specific disk usage detection
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        // macOS-specific disk usage detection
        return None;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux-specific disk usage detection
        // Could use statvfs system call
        return None;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    None
}

async fn select_output_directory_impl() -> AppResult<String> {
    // The directory selection should be handled by the frontend using Tauri's dialog API
    // This backend command is kept for compatibility but should not be used
    // Frontend should use: import { open } from '@tauri-apps/api/dialog'

    // Return a sensible default path for fallback scenarios
    let default_dir = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE")
            .map(|profile| std::path::Path::new(&profile).join("Downloads"))
            .unwrap_or_else(|_| std::path::PathBuf::from("./downloads"))
    } else {
        std::env::var("HOME")
            .map(|home| std::path::Path::new(&home).join("Downloads"))
            .unwrap_or_else(|_| std::path::PathBuf::from("./downloads"))
    };

    let downloads_dir = default_dir.to_string_lossy().to_string();
    info!("Returning default downloads directory: {}", downloads_dir);

    Ok(downloads_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_tool_availability() {
        // Test with a command that should always exist
        #[cfg(target_os = "windows")]
        let result = check_tool_availability("cmd", &["/?"]).await;

        #[cfg(not(target_os = "windows"))]
        let result = check_tool_availability("echo", &["test"]).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_check_nonexistent_tool() {
        let result = check_tool_availability("nonexistent_tool_12345", &["--version"]).await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }
}
