//! System command handlers
//!
//! This module provides commands for system monitoring, file operations,
//! and system utilities like opening folders and checking tool availability.

use std::path::Path;
use tauri::{AppHandle, State};
use tracing::{error, info};

use crate::core::models::{AppError, AppResult};
use crate::infra::capability_service::ToolCapabilityService;
use crate::utils::logging;
use crate::AppState;

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

// Implementation functions

async fn open_folder_impl(folder_path: &str) -> AppResult<()> {
    // Create directory if it doesn't exist
    if !Path::new(folder_path).exists() {
        tokio::fs::create_dir_all(folder_path)
            .await
            .map_err(AppError::Io)?;
    }

    #[cfg(target_os = "windows")]
    {
        tokio::process::Command::new("explorer.exe")
            .arg(folder_path)
            .spawn()
            .map_err(|e| AppError::System(format!("Failed to open folder: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        tokio::process::Command::new("open")
            .arg(folder_path)
            .spawn()
            .map_err(|e| AppError::System(format!("Failed to open folder: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("xdg-open")
            .arg(folder_path)
            .spawn()
            .map_err(|e| AppError::System(format!("Failed to open folder: {}", e)))?;
    }

    Ok(())
}

async fn check_tool_availability(tool_name: &str, args: &[&str]) -> AppResult<bool> {
    ToolCapabilityService::is_available(tool_name, args)
        .await
        .map_err(AppError::System)
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

    if is_youtube_url(url) {
        let youtube_info = crate::commands::youtube::get_youtube_info_internal(url).await?;
        return serde_json::to_value(youtube_info)
            .map_err(|e| AppError::System(format!("Failed to serialize YouTube info: {}", e)));
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

fn is_youtube_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("youtube.com/") || lower.contains("youtu.be/")
}

async fn get_video_info_with_ytdlp(url: &str) -> AppResult<serde_json::Value> {
    let output = tokio::process::Command::new("yt-dlp")
        .args(["--dump-json", "--no-download", url])
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
        .args(["--dump-json", "--no-download", url])
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
    if let Some(filename) = path.split('/').next_back() {
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
    _app: AppHandle,
    level: Option<String>,
    message: String,
) -> Result<(), String> {
    logging::append_frontend_log_entry(level.as_deref(), &message)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_tool_availability() {
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
