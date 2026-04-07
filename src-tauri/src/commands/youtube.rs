//! YouTube command handlers
//!
//! This module provides commands for YouTube-specific operations including
//! getting video information, available formats, and playlist handling.

use tauri::{AppHandle, State};
use tracing::{debug, error, info, warn};

use crate::core::models::{
    AppError, AppResult, ImportedData, SubtitleTrack, VideoFormat, YoutubeVideoInfo,
};
use crate::AppState;

/// Get YouTube video information
#[tauri::command]
pub async fn get_youtube_info(
    _app: AppHandle,
    _state: State<'_, AppState>,
    url: String,
) -> Result<YoutubeVideoInfo, String> {
    info!("📺 Getting YouTube video info for: {}", url);

    match get_youtube_info_impl(&url).await {
        Ok(info) => {
            info!(
                "✅ Successfully retrieved YouTube info for video: {}",
                info.title
            );
            Ok(info)
        }
        Err(e) => {
            error!("❌ Failed to get YouTube info: {}", e);
            Err(e.to_string())
        }
    }
}

/// Get available formats for a YouTube video
#[tauri::command]
pub async fn get_youtube_formats(
    _app: AppHandle,
    _state: State<'_, AppState>,
    url: String,
) -> Result<Vec<VideoFormat>, String> {
    info!("🎬 Getting YouTube formats for: {}", url);

    match get_youtube_formats_impl(&url).await {
        Ok(formats) => {
            info!("✅ Successfully retrieved {} formats", formats.len());
            Ok(formats)
        }
        Err(e) => {
            error!("❌ Failed to get YouTube formats: {}", e);
            Err(e.to_string())
        }
    }
}

/// Download YouTube playlist and extract individual video URLs
#[tauri::command]
pub async fn download_youtube_playlist(
    _app: AppHandle,
    _state: State<'_, AppState>,
    playlist_url: String,
    max_videos: Option<usize>,
) -> Result<Vec<ImportedData>, String> {
    info!(
        "📋 Processing YouTube playlist: {} (max: {:?})",
        playlist_url, max_videos
    );

    match download_youtube_playlist_impl(&playlist_url, max_videos).await {
        Ok(videos) => {
            info!(
                "✅ Successfully processed playlist with {} videos",
                videos.len()
            );
            Ok(videos)
        }
        Err(e) => {
            error!("❌ Failed to process YouTube playlist: {}", e);
            Err(e.to_string())
        }
    }
}

// Implementation functions

async fn get_youtube_info_impl(url: &str) -> AppResult<YoutubeVideoInfo> {
    // Validate YouTube URL
    if !is_valid_youtube_url(url) {
        return Err(AppError::Youtube(format!("Invalid YouTube URL: {}", url)));
    }

    // Extract video ID
    let video_id = extract_youtube_id(url)
        .ok_or_else(|| AppError::Youtube("Could not extract video ID from URL".to_string()))?;

    debug!("Extracted YouTube video ID: {}", video_id);

    // Use yt-dlp to get video information
    match get_video_info_with_ytdlp(url).await {
        Ok(info) => Ok(info),
        Err(e) => {
            warn!("yt-dlp failed, trying fallback method: {}", e);
            get_video_info_fallback(url, &video_id).await
        }
    }
}

async fn get_youtube_formats_impl(url: &str) -> AppResult<Vec<VideoFormat>> {
    // Validate YouTube URL
    if !is_valid_youtube_url(url) {
        return Err(AppError::Youtube(format!("Invalid YouTube URL: {}", url)));
    }

    // Use yt-dlp to get format information
    match get_formats_with_ytdlp(url).await {
        Ok(formats) => Ok(formats),
        Err(e) => {
            warn!("yt-dlp failed, returning default formats: {}", e);
            Ok(get_default_formats())
        }
    }
}

async fn download_youtube_playlist_impl(
    playlist_url: &str,
    max_videos: Option<usize>,
) -> AppResult<Vec<ImportedData>> {
    // Validate playlist URL
    if !is_valid_youtube_playlist_url(playlist_url) {
        return Err(AppError::Youtube(format!(
            "Invalid YouTube playlist URL: {}",
            playlist_url
        )));
    }

    // Extract playlist ID
    let playlist_id = extract_playlist_id(playlist_url)
        .ok_or_else(|| AppError::Youtube("Could not extract playlist ID from URL".to_string()))?;

    debug!("Extracted YouTube playlist ID: {}", playlist_id);

    // Use yt-dlp to get playlist information
    match get_playlist_with_ytdlp(playlist_url, max_videos).await {
        Ok(videos) => Ok(videos),
        Err(e) => {
            warn!("yt-dlp failed, trying fallback method: {}", e);
            get_playlist_fallback(playlist_url, &playlist_id, max_videos).await
        }
    }
}

// Helper functions using yt-dlp

async fn get_video_info_with_ytdlp(url: &str) -> AppResult<YoutubeVideoInfo> {
    let output = tokio::process::Command::new("yt-dlp")
        .args(["--dump-json", "--no-warnings", "--no-playlist", url])
        .output()
        .await
        .map_err(|e| AppError::Youtube(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Youtube(format!("yt-dlp failed: {}", error)));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json_value: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Youtube(format!("Failed to parse yt-dlp output: {}", e)))?;

    parse_youtube_info_from_json(json_value)
}

async fn get_formats_with_ytdlp(url: &str) -> AppResult<Vec<VideoFormat>> {
    let output = tokio::process::Command::new("yt-dlp")
        .args(["--list-formats", "--no-warnings", "--no-playlist", url])
        .output()
        .await
        .map_err(|e| AppError::Youtube(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Youtube(format!("yt-dlp failed: {}", error)));
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    parse_formats_from_ytdlp_output(&output_str)
}

async fn get_playlist_with_ytdlp(
    playlist_url: &str,
    max_videos: Option<usize>,
) -> AppResult<Vec<ImportedData>> {
    let mut args = vec![
        "--dump-json",
        "--no-warnings",
        "--flat-playlist",
        playlist_url,
    ];

    // Add playlist-end argument if max_videos is specified
    let playlist_end_str;
    if let Some(max) = max_videos {
        playlist_end_str = max.to_string();
        args.extend(&["--playlist-end", &playlist_end_str]);
    }

    let output = tokio::process::Command::new("yt-dlp")
        .args(&args)
        .output()
        .await
        .map_err(|e| AppError::Youtube(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Youtube(format!("yt-dlp failed: {}", error)));
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    parse_playlist_from_ytdlp_output(&output_str)
}

// Fallback methods (when yt-dlp is not available)

async fn get_video_info_fallback(_url: &str, video_id: &str) -> AppResult<YoutubeVideoInfo> {
    warn!("Using fallback method for YouTube video info");

    // This is a very basic fallback that creates minimal video info
    // In a real implementation, you might use YouTube API or web scraping

    Ok(YoutubeVideoInfo {
        id: video_id.to_string(),
        title: format!("YouTube Video {}", video_id),
        description: "Description not available (fallback mode)".to_string(),
        duration: 0,
        thumbnail: format!("https://img.youtube.com/vi/{}/maxresdefault.jpg", video_id),
        formats: get_default_formats(),
        subtitles: vec![],
    })
}

async fn get_playlist_fallback(
    _playlist_url: &str,
    _playlist_id: &str,
    _max_videos: Option<usize>,
) -> AppResult<Vec<ImportedData>> {
    warn!("Using fallback method for YouTube playlist");

    // This is a placeholder fallback
    // In a real implementation, you might use YouTube API or web scraping

    Ok(vec![])
}

// Parsing functions

fn parse_youtube_info_from_json(json: serde_json::Value) -> AppResult<YoutubeVideoInfo> {
    let id = json["id"]
        .as_str()
        .ok_or_else(|| AppError::Youtube("Missing video ID in yt-dlp output".to_string()))?
        .to_string();

    let title = json["title"]
        .as_str()
        .unwrap_or("Unknown Title")
        .to_string();

    let description = json["description"]
        .as_str()
        .unwrap_or("No description available")
        .to_string();

    let duration = json["duration"].as_u64().unwrap_or(0);

    let thumbnail = json["thumbnail"]
        .as_str()
        .unwrap_or(&format!(
            "https://img.youtube.com/vi/{}/maxresdefault.jpg",
            id
        ))
        .to_string();

    // Parse formats
    let formats = if let Some(formats_array) = json["formats"].as_array() {
        parse_formats_from_json_array(formats_array)
    } else {
        get_default_formats()
    };

    // Parse subtitles
    let subtitles = if let Some(subtitles_obj) = json["subtitles"].as_object() {
        parse_subtitles_from_json(subtitles_obj)
    } else {
        vec![]
    };

    Ok(YoutubeVideoInfo {
        id,
        title,
        description,
        duration,
        thumbnail,
        formats,
        subtitles,
    })
}

fn parse_formats_from_json_array(formats_array: &[serde_json::Value]) -> Vec<VideoFormat> {
    let mut formats = Vec::new();

    for format_json in formats_array {
        if let Ok(format) = parse_single_format_from_json(format_json) {
            formats.push(format);
        }
    }

    formats
}

fn parse_single_format_from_json(json: &serde_json::Value) -> AppResult<VideoFormat> {
    let format_id = json["format_id"]
        .as_str()
        .ok_or_else(|| AppError::Youtube("Missing format_id".to_string()))?
        .to_string();

    let ext = json["ext"].as_str().unwrap_or("mp4").to_string();
    let width = json["width"].as_u64().map(|w| w as u32);
    let height = json["height"].as_u64().map(|h| h as u32);
    let fps = json["fps"].as_f64().map(|f| f as f32);
    let vbr = json["vbr"].as_f64().map(|v| v as f32);
    let abr = json["abr"].as_f64().map(|a| a as f32);
    let filesize = json["filesize"].as_u64();

    let quality = determine_quality_string(width, height, &format_id);

    Ok(VideoFormat {
        format_id,
        ext,
        width,
        height,
        fps,
        vbr,
        abr,
        filesize,
        quality,
    })
}

fn parse_subtitles_from_json(
    subtitles_obj: &serde_json::Map<String, serde_json::Value>,
) -> Vec<SubtitleTrack> {
    let mut subtitles = Vec::new();

    for (language_code, subtitle_data) in subtitles_obj {
        if let Some(subtitle_array) = subtitle_data.as_array() {
            for subtitle_json in subtitle_array {
                if let Ok(subtitle) = parse_single_subtitle_from_json(language_code, subtitle_json)
                {
                    subtitles.push(subtitle);
                }
            }
        }
    }

    subtitles
}

fn parse_single_subtitle_from_json(
    language_code: &str,
    json: &serde_json::Value,
) -> AppResult<SubtitleTrack> {
    let url = json["url"]
        .as_str()
        .ok_or_else(|| AppError::Youtube("Missing subtitle URL".to_string()))?
        .to_string();

    let ext = json["ext"].as_str().unwrap_or("vtt").to_string();
    let language = language_code.to_string();

    Ok(SubtitleTrack {
        language: language.clone(),
        language_code: language_code.to_string(),
        url,
        ext,
    })
}

fn parse_formats_from_ytdlp_output(output: &str) -> AppResult<Vec<VideoFormat>> {
    let mut formats = Vec::new();

    for line in output.lines() {
        if let Some(format) = parse_format_line(line) {
            formats.push(format);
        }
    }

    Ok(formats)
}

fn parse_format_line(line: &str) -> Option<VideoFormat> {
    // This is a simplified parser for yt-dlp format output
    // Real implementation would be more robust

    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }

    let format_id = parts[0].to_string();
    let ext = parts.get(1).unwrap_or(&"mp4").to_string();
    let quality = parts.get(2).unwrap_or(&"unknown").to_string();

    Some(VideoFormat {
        format_id,
        ext,
        width: None,
        height: None,
        fps: None,
        vbr: None,
        abr: None,
        filesize: None,
        quality,
    })
}

fn parse_playlist_from_ytdlp_output(output: &str) -> AppResult<Vec<ImportedData>> {
    let mut videos = Vec::new();

    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(video) = parse_playlist_entry_from_json(&json_value) {
                videos.push(video);
            }
        }
    }

    Ok(videos)
}

fn parse_playlist_entry_from_json(json: &serde_json::Value) -> Option<ImportedData> {
    let id = json["id"].as_str()?.to_string();
    let title = json["title"]
        .as_str()
        .unwrap_or("Unknown Title")
        .to_string();
    let url = format!("https://www.youtube.com/watch?v={}", id);

    Some(ImportedData {
        // 使用Go版本的标准字段名
        zl_id: Some(id.clone()),
        zl_name: Some("YouTube".to_string()),
        record_url: Some(url.clone()),
        kc_id: Some(id.clone()),
        kc_name: Some(title.clone()),

        // 兼容旧版本字段
        id: Some(id.clone()),
        name: Some(title),
        url: Some(url),
        course_id: Some(id),
        course_name: None,
    })
}

// Utility functions

fn is_valid_youtube_url(url: &str) -> bool {
    url.contains("youtube.com/watch")
        || url.contains("youtu.be/")
        || url.contains("youtube.com/embed/")
}

fn is_valid_youtube_playlist_url(url: &str) -> bool {
    url.contains("youtube.com/playlist")
        || url.contains("youtube.com/watch") && url.contains("list=")
}

fn extract_youtube_id(url: &str) -> Option<String> {
    // Handle different YouTube URL formats
    if let Some(start) = url.find("v=") {
        let id_start = start + 2;
        let id_part = &url[id_start..];
        let id_end = id_part.find('&').unwrap_or(id_part.len());
        return Some(id_part[..id_end].to_string());
    }

    if let Some(start) = url.find("youtu.be/") {
        let id_start = start + 9;
        let id_part = &url[id_start..];
        let id_end = id_part.find('?').unwrap_or(id_part.len());
        return Some(id_part[..id_end].to_string());
    }

    if let Some(start) = url.find("embed/") {
        let id_start = start + 6;
        let id_part = &url[id_start..];
        let id_end = id_part.find('?').unwrap_or(id_part.len());
        return Some(id_part[..id_end].to_string());
    }

    None
}

fn extract_playlist_id(url: &str) -> Option<String> {
    if let Some(start) = url.find("list=") {
        let id_start = start + 5;
        let id_part = &url[id_start..];
        let id_end = id_part.find('&').unwrap_or(id_part.len());
        return Some(id_part[..id_end].to_string());
    }

    None
}

fn determine_quality_string(_width: Option<u32>, height: Option<u32>, format_id: &str) -> String {
    if let Some(h) = height {
        match h {
            2160 => "4K".to_string(),
            1440 => "1440p".to_string(),
            1080 => "1080p".to_string(),
            720 => "720p".to_string(),
            480 => "480p".to_string(),
            360 => "360p".to_string(),
            240 => "240p".to_string(),
            144 => "144p".to_string(),
            _ => format!("{}p", h),
        }
    } else {
        format_id.to_string()
    }
}

fn get_default_formats() -> Vec<VideoFormat> {
    vec![
        VideoFormat {
            format_id: "best".to_string(),
            ext: "mp4".to_string(),
            width: None,
            height: None,
            fps: None,
            vbr: None,
            abr: None,
            filesize: None,
            quality: "Best Quality".to_string(),
        },
        VideoFormat {
            format_id: "worst".to_string(),
            ext: "mp4".to_string(),
            width: None,
            height: None,
            fps: None,
            vbr: None,
            abr: None,
            filesize: None,
            quality: "Worst Quality".to_string(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_youtube_url() {
        assert!(is_valid_youtube_url(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        ));
        assert!(is_valid_youtube_url("https://youtu.be/dQw4w9WgXcQ"));
        assert!(is_valid_youtube_url(
            "https://www.youtube.com/embed/dQw4w9WgXcQ"
        ));
        assert!(!is_valid_youtube_url("https://example.com/video"));
    }

    #[test]
    fn test_extract_youtube_id() {
        assert_eq!(
            extract_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_youtube_id("https://youtu.be/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_youtube_id("https://www.youtube.com/embed/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(extract_youtube_id("https://example.com/video"), None);
    }

    #[test]
    fn test_extract_playlist_id() {
        assert_eq!(
            extract_playlist_id(
                "https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMfCnAp7xfXLPd3BgB"
            ),
            Some("PLrAXtmRdnEQy6nuLMfCnAp7xfXLPd3BgB".to_string())
        );
        assert_eq!(extract_playlist_id("https://example.com/video"), None);
    }

    #[test]
    fn test_determine_quality_string() {
        assert_eq!(
            determine_quality_string(Some(1920), Some(1080), "22"),
            "1080p"
        );
        assert_eq!(determine_quality_string(None, None, "best"), "best");
        assert_eq!(
            determine_quality_string(Some(3840), Some(2160), "137"),
            "4K"
        );
    }
}
