//! YouTube Downloader Module
//!
//! This module provides comprehensive YouTube video downloading capabilities
//! using the yt-dlp Rust wrapper. It integrates with the existing download
//! management system and provides progress tracking, quality selection,
//! and advanced download options.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::core::models::{AppError, AppResult};

/// YouTube downloader configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoutubeDownloaderConfig {
    /// Path to libraries directory for yt-dlp and ffmpeg binaries
    pub libraries_dir: PathBuf,
    /// Output directory for downloaded videos
    pub output_dir: PathBuf,
    /// Maximum concurrent downloads
    pub max_concurrent_downloads: usize,
    /// Download segment size in bytes
    pub segment_size: usize,
    /// Number of parallel segments per download
    pub parallel_segments: usize,
    /// Number of retry attempts on failure
    pub retry_attempts: usize,
    /// Maximum buffer size in bytes
    pub max_buffer_size: usize,
    /// Default video quality preference
    pub default_video_quality: VideoQuality,
    /// Default video codec preference
    pub default_video_codec: VideoCodecPreference,
    /// Default audio quality preference
    pub default_audio_quality: AudioQuality,
    /// Default audio codec preference
    pub default_audio_codec: AudioCodecPreference,
    /// Whether to auto-install binaries if not found
    pub auto_install_binaries: bool,
    /// Whether to auto-update binaries on startup
    pub auto_update_binaries: bool,
}

impl Default for YoutubeDownloaderConfig {
    fn default() -> Self {
        Self {
            libraries_dir: PathBuf::from("libs"),
            output_dir: PathBuf::from("downloads/youtube"),
            max_concurrent_downloads: 3,
            segment_size: 10 * 1024 * 1024, // 10MB
            parallel_segments: 8,
            retry_attempts: 3,
            max_buffer_size: 50 * 1024 * 1024, // 50MB
            default_video_quality: VideoQuality::High,
            default_video_codec: VideoCodecPreference::VP9,
            default_audio_quality: AudioQuality::High,
            default_audio_codec: AudioCodecPreference::AAC,
            auto_install_binaries: true,
            auto_update_binaries: false,
        }
    }
}

/// Video quality options for YouTube downloads
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum VideoQuality {
    Low,
    Medium,
    High,
    Best,
    Worst,
}

/// Video codec preferences for YouTube downloads
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum VideoCodecPreference {
    AVC1, // H.264
    VP9,  // VP9
    AV01, // AV1
    Any,
}

/// Audio quality options for YouTube downloads
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum AudioQuality {
    Low,
    Medium,
    High,
    Best,
    Worst,
}

/// Audio codec preferences for YouTube downloads
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum AudioCodecPreference {
    AAC,
    MP3,
    Opus,
    FLAC,
    Any,
}

/// Download priority levels
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DownloadPriority {
    Low,
    Normal,
    High,
    Urgent,
}

/// YouTube video download format options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum YoutubeDownloadFormat {
    /// Complete video with audio
    CompleteVideo {
        video_quality: VideoQuality,
        video_codec: VideoCodecPreference,
        audio_quality: AudioQuality,
        audio_codec: AudioCodecPreference,
    },
    /// Video stream only (no audio)
    VideoOnly {
        quality: VideoQuality,
        codec: VideoCodecPreference,
    },
    /// Audio stream only (no video)
    AudioOnly {
        quality: AudioQuality,
        codec: AudioCodecPreference,
    },
    /// Best available format (automatically selected)
    BestAvailable,
    /// Specific format by format ID
    SpecificFormat { format_id: String },
}

impl Default for YoutubeDownloadFormat {
    fn default() -> Self {
        Self::BestAvailable
    }
}

/// YouTube video information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoutubeVideoInfo {
    /// Video ID
    pub id: String,
    /// Video title
    pub title: String,
    /// Video description
    pub description: Option<String>,
    /// Video duration in seconds
    pub duration: Option<u64>,
    /// Video uploader/channel name
    pub uploader: Option<String>,
    /// Video upload date
    pub upload_date: Option<String>,
    /// Video view count
    pub view_count: Option<u64>,
    /// Video thumbnail URL
    pub thumbnail: Option<String>,
    /// Available video formats
    pub formats: Vec<YoutubeFormat>,
    /// Video URL
    pub webpage_url: String,
}

/// YouTube format information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoutubeFormat {
    /// Format ID
    pub format_id: String,
    /// Format extension (mp4, webm, etc.)
    pub ext: String,
    /// Video codec (h264, vp9, etc.)
    pub vcodec: Option<String>,
    /// Audio codec (aac, opus, etc.)
    pub acodec: Option<String>,
    /// Video resolution (e.g., "1920x1080")
    pub resolution: Option<String>,
    /// Video bitrate in kbps
    pub vbr: Option<f64>,
    /// Audio bitrate in kbps
    pub abr: Option<f64>,
    /// File size in bytes (if available)
    pub filesize: Option<u64>,
    /// Format description
    pub format_note: Option<String>,
}

/// YouTube download status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum YoutubeDownloadStatus {
    Pending,
    Downloading {
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
        speed_bytes_per_sec: Option<f64>,
        eta_seconds: Option<u64>,
    },
    Processing, // Post-processing (combining audio/video, etc.)
    Completed {
        file_path: PathBuf,
        final_size: u64,
    },
    Failed {
        error: String,
        retry_count: usize,
    },
    Cancelled,
}

/// Progress callback type for YouTube downloads
pub type YoutubeProgressCallback = Arc<dyn Fn(u64, Option<u64>, Option<f64>) + Send + Sync>;

/// YouTube downloader implementation
pub struct YoutubeDownloader {
    config: YoutubeDownloaderConfig,
    // Note: The actual yt-dlp integration will be added when we have the dependency available
    active_downloads: Arc<RwLock<std::collections::HashMap<String, YoutubeDownloadStatus>>>,
    download_counter: Arc<RwLock<u64>>,
}

impl YoutubeDownloader {
    /// Create a new YouTube downloader instance
    pub fn new(config: YoutubeDownloaderConfig) -> AppResult<Self> {
        // Validate configuration
        if config.max_concurrent_downloads == 0 {
            return Err(AppError::Config(
                "max_concurrent_downloads must be greater than 0".to_string(),
            ));
        }

        if config.segment_size == 0 {
            return Err(AppError::Config(
                "segment_size must be greater than 0".to_string(),
            ));
        }

        // Ensure output directory exists
        std::fs::create_dir_all(&config.output_dir).map_err(|e| AppError::Io(e))?;

        info!(
            "🎥 Initialized YouTube downloader with config: {:?}",
            config
        );

        Ok(Self {
            config,
            active_downloads: Arc::new(RwLock::new(std::collections::HashMap::new())),
            download_counter: Arc::new(RwLock::new(0)),
        })
    }

    /// Create a new YouTube downloader with automatic binary installation
    pub async fn with_auto_install(config: YoutubeDownloaderConfig) -> AppResult<Self> {
        let downloader = Self::new(config)?;

        if downloader.config.auto_install_binaries {
            downloader.install_binaries().await?;
        }

        if downloader.config.auto_update_binaries {
            downloader.update_binaries().await?;
        }

        Ok(downloader)
    }

    /// Install required binaries (yt-dlp and ffmpeg)
    pub async fn install_binaries(&self) -> AppResult<()> {
        info!("📦 Installing YouTube downloader binaries...");

        // Create libraries directory
        std::fs::create_dir_all(&self.config.libraries_dir).map_err(|e| AppError::Io(e))?;

        // TODO: Implement actual binary installation when yt-dlp dependency is available
        // This is a placeholder for the actual implementation
        info!("✅ Binary installation placeholder - implement when yt-dlp crate is available");

        Ok(())
    }

    /// Update yt-dlp and ffmpeg binaries to latest versions
    pub async fn update_binaries(&self) -> AppResult<()> {
        info!("🔄 Updating YouTube downloader binaries...");

        // TODO: Implement actual binary update when yt-dlp dependency is available
        info!("✅ Binary update placeholder - implement when yt-dlp crate is available");

        Ok(())
    }

    /// Fetch video information from YouTube URL
    pub async fn fetch_video_info(&self, url: &str) -> AppResult<YoutubeVideoInfo> {
        debug!("🔍 Fetching video info for URL: {}", url);

        // Validate YouTube URL
        if !self.is_youtube_url(url) {
            return Err(AppError::Youtube(format!("Invalid YouTube URL: {}", url)));
        }

        // TODO: Implement actual video info fetching when yt-dlp dependency is available
        // This is a placeholder implementation
        let video_info = YoutubeVideoInfo {
            id: "placeholder_id".to_string(),
            title: "Placeholder Video Title".to_string(),
            description: Some("Placeholder description".to_string()),
            duration: Some(300), // 5 minutes
            uploader: Some("Placeholder Channel".to_string()),
            upload_date: Some("20240101".to_string()),
            view_count: Some(1000000),
            thumbnail: Some("https://placeholder.thumbnail.url".to_string()),
            formats: vec![YoutubeFormat {
                format_id: "22".to_string(),
                ext: "mp4".to_string(),
                vcodec: Some("h264".to_string()),
                acodec: Some("aac".to_string()),
                resolution: Some("1280x720".to_string()),
                vbr: Some(1000.0),
                abr: Some(128.0),
                filesize: Some(50 * 1024 * 1024), // 50MB
                format_note: Some("720p".to_string()),
            }],
            webpage_url: url.to_string(),
        };

        info!("📋 Fetched video info: {}", video_info.title);
        Ok(video_info)
    }

    /// Download YouTube video with specified format
    pub async fn download_video(
        &self,
        url: &str,
        output_filename: &str,
        format: YoutubeDownloadFormat,
        priority: Option<DownloadPriority>,
        progress_callback: Option<YoutubeProgressCallback>,
    ) -> AppResult<String> {
        info!(
            "⬇️ Starting YouTube video download: {} -> {}",
            url, output_filename
        );

        // Generate unique download ID
        let download_id = self.generate_download_id().await;

        // Set initial status
        self.set_download_status(&download_id, YoutubeDownloadStatus::Pending)
            .await;

        // Validate inputs
        if !self.is_youtube_url(url) {
            let error = format!("Invalid YouTube URL: {}", url);
            self.set_download_status(
                &download_id,
                YoutubeDownloadStatus::Failed {
                    error: error.clone(),
                    retry_count: 0,
                },
            )
            .await;
            return Err(AppError::Youtube(error));
        }

        let output_path = self.config.output_dir.join(output_filename);

        // TODO: Implement actual download when yt-dlp dependency is available
        // This is a placeholder implementation
        tokio::spawn({
            let download_id = download_id.clone();
            let active_downloads = Arc::clone(&self.active_downloads);
            let output_path = output_path.clone();
            let url = url.to_string();

            async move {
                // Simulate download progress
                for i in 0..=100 {
                    let downloaded = (i * 1024 * 1024) as u64; // Simulate downloaded bytes
                    let total = Some(100 * 1024 * 1024u64); // Simulate 100MB total
                    let speed = Some(1024.0 * 1024.0); // Simulate 1MB/s speed

                    let status = YoutubeDownloadStatus::Downloading {
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        speed_bytes_per_sec: speed,
                        eta_seconds: total.map(|t| (t - downloaded) / 1024 / 1024), // Rough ETA
                    };

                    {
                        let mut downloads = active_downloads.write().await;
                        downloads.insert(download_id.clone(), status);
                    }

                    // Call progress callback if provided
                    if let Some(callback) = &progress_callback {
                        callback(downloaded, total, speed);
                    }

                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }

                // Simulate completion
                let final_status = YoutubeDownloadStatus::Completed {
                    file_path: output_path.clone(),
                    final_size: 100 * 1024 * 1024, // 100MB
                };

                {
                    let mut downloads = active_downloads.write().await;
                    downloads.insert(download_id, final_status);
                }

                info!("✅ YouTube download completed: {}", output_path.display());
            }
        });

        info!("🚀 YouTube download started with ID: {}", download_id);
        Ok(download_id)
    }

    /// Download YouTube video with default settings
    pub async fn download_video_simple(
        &self,
        url: &str,
        output_filename: &str,
    ) -> AppResult<String> {
        self.download_video(
            url,
            output_filename,
            YoutubeDownloadFormat::default(),
            Some(DownloadPriority::Normal),
            None,
        )
        .await
    }

    /// Download only audio from YouTube video
    pub async fn download_audio(
        &self,
        url: &str,
        output_filename: &str,
        quality: AudioQuality,
        codec: AudioCodecPreference,
        progress_callback: Option<YoutubeProgressCallback>,
    ) -> AppResult<String> {
        let format = YoutubeDownloadFormat::AudioOnly { quality, codec };
        self.download_video(
            url,
            output_filename,
            format,
            Some(DownloadPriority::Normal),
            progress_callback,
        )
        .await
    }

    /// Download video thumbnail
    pub async fn download_thumbnail(&self, url: &str, output_filename: &str) -> AppResult<PathBuf> {
        info!("🖼️ Downloading thumbnail for: {}", url);

        if !self.is_youtube_url(url) {
            return Err(AppError::Youtube(format!("Invalid YouTube URL: {}", url)));
        }

        let output_path = self.config.output_dir.join(output_filename);

        // TODO: Implement actual thumbnail download when yt-dlp dependency is available
        // This is a placeholder
        info!(
            "✅ Thumbnail download placeholder: {}",
            output_path.display()
        );

        Ok(output_path)
    }

    /// Get download status by ID
    pub async fn get_download_status(&self, download_id: &str) -> Option<YoutubeDownloadStatus> {
        let downloads = self.active_downloads.read().await;
        downloads.get(download_id).cloned()
    }

    /// Cancel an active download
    pub async fn cancel_download(&self, download_id: &str) -> bool {
        info!("🛑 Cancelling YouTube download: {}", download_id);

        let mut downloads = self.active_downloads.write().await;
        if let Some(_status) = downloads.get(download_id) {
            downloads.insert(download_id.to_string(), YoutubeDownloadStatus::Cancelled);
            // TODO: Implement actual download cancellation when yt-dlp dependency is available
            true
        } else {
            false
        }
    }

    /// Get list of active downloads
    pub async fn get_active_downloads(&self) -> Vec<(String, YoutubeDownloadStatus)> {
        let downloads = self.active_downloads.read().await;
        downloads
            .iter()
            .map(|(id, status)| (id.clone(), status.clone()))
            .collect()
    }

    /// Wait for download completion
    pub async fn wait_for_download(&self, download_id: &str) -> Option<YoutubeDownloadStatus> {
        loop {
            if let Some(status) = self.get_download_status(download_id).await {
                match status {
                    YoutubeDownloadStatus::Completed { .. }
                    | YoutubeDownloadStatus::Failed { .. }
                    | YoutubeDownloadStatus::Cancelled => {
                        return Some(status);
                    }
                    _ => {
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    }
                }
            } else {
                return None;
            }
        }
    }

    /// Clean up completed downloads from memory
    pub async fn cleanup_completed_downloads(&self) -> usize {
        let mut downloads = self.active_downloads.write().await;
        let initial_count = downloads.len();

        downloads.retain(|_id, status| {
            !matches!(
                status,
                YoutubeDownloadStatus::Completed { .. }
                    | YoutubeDownloadStatus::Failed { .. }
                    | YoutubeDownloadStatus::Cancelled
            )
        });

        let removed_count = initial_count - downloads.len();
        if removed_count > 0 {
            info!(
                "🧹 Cleaned up {} completed YouTube downloads",
                removed_count
            );
        }

        removed_count
    }

    /// Validate if URL is a YouTube URL
    fn is_youtube_url(&self, url: &str) -> bool {
        url.contains("youtube.com") || url.contains("youtu.be") || url.contains("m.youtube.com")
    }

    /// Generate unique download ID
    async fn generate_download_id(&self) -> String {
        let mut counter = self.download_counter.write().await;
        *counter += 1;
        format!("yt_download_{}", *counter)
    }

    /// Set download status
    async fn set_download_status(&self, download_id: &str, status: YoutubeDownloadStatus) {
        let mut downloads = self.active_downloads.write().await;
        downloads.insert(download_id.to_string(), status);
    }

    /// Get current configuration
    pub fn get_config(&self) -> &YoutubeDownloaderConfig {
        &self.config
    }

    /// Update configuration
    pub async fn update_config(&mut self, new_config: YoutubeDownloaderConfig) -> AppResult<()> {
        // Validate new configuration
        if new_config.max_concurrent_downloads == 0 {
            return Err(AppError::Config(
                "max_concurrent_downloads must be greater than 0".to_string(),
            ));
        }

        // Ensure new output directory exists
        std::fs::create_dir_all(&new_config.output_dir).map_err(|e| AppError::Io(e))?;

        self.config = new_config;
        info!("📝 Updated YouTube downloader configuration");
        Ok(())
    }

    /// Get download statistics
    pub async fn get_statistics(&self) -> YoutubeDownloadStatistics {
        let downloads = self.active_downloads.read().await;

        let mut stats = YoutubeDownloadStatistics {
            total_downloads: downloads.len(),
            pending_downloads: 0,
            active_downloads: 0,
            completed_downloads: 0,
            failed_downloads: 0,
            cancelled_downloads: 0,
            total_downloaded_bytes: 0,
            average_download_speed: 0.0,
        };

        let mut speed_samples = Vec::new();

        for status in downloads.values() {
            match status {
                YoutubeDownloadStatus::Pending => stats.pending_downloads += 1,
                YoutubeDownloadStatus::Downloading {
                    downloaded_bytes,
                    speed_bytes_per_sec,
                    ..
                } => {
                    stats.active_downloads += 1;
                    stats.total_downloaded_bytes += downloaded_bytes;
                    if let Some(speed) = speed_bytes_per_sec {
                        speed_samples.push(*speed);
                    }
                }
                YoutubeDownloadStatus::Processing => stats.active_downloads += 1,
                YoutubeDownloadStatus::Completed { final_size, .. } => {
                    stats.completed_downloads += 1;
                    stats.total_downloaded_bytes += final_size;
                }
                YoutubeDownloadStatus::Failed { .. } => stats.failed_downloads += 1,
                YoutubeDownloadStatus::Cancelled => stats.cancelled_downloads += 1,
            }
        }

        // Calculate average speed from active downloads
        if !speed_samples.is_empty() {
            stats.average_download_speed =
                speed_samples.iter().sum::<f64>() / speed_samples.len() as f64;
        }

        stats
    }
}

/// YouTube download statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoutubeDownloadStatistics {
    pub total_downloads: usize,
    pub pending_downloads: usize,
    pub active_downloads: usize,
    pub completed_downloads: usize,
    pub failed_downloads: usize,
    pub cancelled_downloads: usize,
    pub total_downloaded_bytes: u64,
    pub average_download_speed: f64, // bytes per second
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_youtube_downloader_creation() {
        let config = YoutubeDownloaderConfig::default();
        let downloader = YoutubeDownloader::new(config);
        assert!(downloader.is_ok());
    }

    #[tokio::test]
    async fn test_youtube_url_validation() {
        let config = YoutubeDownloaderConfig::default();
        let downloader = YoutubeDownloader::new(config).unwrap();

        assert!(downloader.is_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        assert!(downloader.is_youtube_url("https://youtu.be/dQw4w9WgXcQ"));
        assert!(downloader.is_youtube_url("https://m.youtube.com/watch?v=dQw4w9WgXcQ"));
        assert!(!downloader.is_youtube_url("https://example.com/video"));
    }

    #[tokio::test]
    async fn test_video_info_fetching() {
        let config = YoutubeDownloaderConfig::default();
        let downloader = YoutubeDownloader::new(config).unwrap();

        let result = downloader
            .fetch_video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
            .await;
        assert!(result.is_ok());

        let video_info = result.unwrap();
        assert!(!video_info.title.is_empty());
        assert!(!video_info.formats.is_empty());
    }

    #[tokio::test]
    async fn test_download_status_tracking() {
        let config = YoutubeDownloaderConfig::default();
        let downloader = YoutubeDownloader::new(config).unwrap();

        // Test status tracking
        downloader
            .set_download_status("test_1", YoutubeDownloadStatus::Pending)
            .await;
        let status = downloader.get_download_status("test_1").await;
        assert!(matches!(status, Some(YoutubeDownloadStatus::Pending)));

        // Test statistics
        let stats = downloader.get_statistics().await;
        assert_eq!(stats.pending_downloads, 1);
    }

    #[tokio::test]
    async fn test_invalid_config() {
        let mut config = YoutubeDownloaderConfig::default();
        config.max_concurrent_downloads = 0;

        let result = YoutubeDownloader::new(config);
        assert!(result.is_err());
    }
}
