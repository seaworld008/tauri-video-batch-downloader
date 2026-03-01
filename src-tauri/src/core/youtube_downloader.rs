//! YouTube Downloader Module
//!
//! This module provides comprehensive YouTube video downloading capabilities
//! using the yt-dlp Rust wrapper. It integrates with the existing download
//! management system and provides progress tracking, quality selection,
//! and advanced download options.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::fs;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info};
use yt_dlp::fetcher::deps::Libraries;
use yt_dlp::fetcher::download_manager::{
    DownloadManager as YtDownloadManager, DownloadPriority as YtInternalPriority,
    DownloadStatus as YtManagerStatus, ManagerConfig as YtManagerConfig,
};
use yt_dlp::model::{self, format::Format, format_selector as ytdl_selector};
use yt_dlp::Youtube as YtDlpClient;

use crate::core::models::{AppError, AppResult};

/// YouTube downloader configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YoutubeDownloaderConfig {
    /// Path to libraries directory for yt-dlp and ffmpeg binaries
    pub libraries_dir: PathBuf,
    /// Output directory for downloaded videos
    pub output_dir: PathBuf,
    /// Custom yt-dlp executable path
    pub yt_dlp_path: Option<PathBuf>,
    /// Custom ffmpeg executable path
    pub ffmpeg_path: Option<PathBuf>,
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
            yt_dlp_path: None,
            ffmpeg_path: None,
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
#[allow(clippy::upper_case_acronyms)]
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
#[derive(Clone)]
struct DownloadTaskHandle {
    manager: Arc<YtDownloadManager>,
    manager_id: u64,
}

pub struct YoutubeDownloader {
    config: YoutubeDownloaderConfig,
    active_downloads: Arc<RwLock<HashMap<String, YoutubeDownloadStatus>>>,
    download_handles: Arc<RwLock<HashMap<String, DownloadTaskHandle>>>,
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
        std::fs::create_dir_all(&config.output_dir).map_err(AppError::Io)?;

        info!(
            "🎥 Initialized YouTube downloader with config: {:?}",
            config
        );

        Ok(Self {
            config,
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
            download_handles: Arc::new(RwLock::new(HashMap::new())),
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

        let target = Libraries::new(self.resolved_yt_dlp_path(), self.resolved_ffmpeg_path());
        match target.install_dependencies().await {
            Ok(installed) => {
                info!(
                    "✅ yt-dlp installed at {}, ffmpeg installed at {}",
                    installed.youtube.display(),
                    installed.ffmpeg.display()
                );
                Ok(())
            }
            Err(err) => Err(AppError::Youtube(format!(
                "Failed to install yt-dlp/ffmpeg binaries: {}",
                err
            ))),
        }
    }

    /// Update yt-dlp and ffmpeg binaries to latest versions
    pub async fn update_binaries(&self) -> AppResult<()> {
        info!("🔄 Updating YouTube downloader binaries...");

        let libs = Libraries::new(self.resolved_yt_dlp_path(), self.resolved_ffmpeg_path());
        if libs.youtube.exists() {
            let _ = fs::remove_file(&libs.youtube).await;
        }
        if libs.ffmpeg.exists() {
            let _ = fs::remove_file(&libs.ffmpeg).await;
        }

        match libs.install_dependencies().await {
            Ok(updated) => {
                info!(
                    "✅ yt-dlp updated at {}, ffmpeg updated at {}",
                    updated.youtube.display(),
                    updated.ffmpeg.display()
                );
                Ok(())
            }
            Err(err) => Err(AppError::Youtube(format!(
                "Failed to update yt-dlp/ffmpeg binaries: {}",
                err
            ))),
        }
    }

    /// Fetch video information from YouTube URL
    pub async fn fetch_video_info(&self, url: &str) -> AppResult<YoutubeVideoInfo> {
        debug!("🔍 Fetching video info for URL: {}", url);

        // Validate YouTube URL
        if !self.is_youtube_url(url) {
            return Err(AppError::Youtube(format!("Invalid YouTube URL: {}", url)));
        }

        let libraries = self.prepare_libraries().await?;
        let manager_config = self.build_manager_config();
        let fetcher = Self::build_fetcher(libraries, &self.config.output_dir, manager_config)?;

        let video = fetcher
            .fetch_video_infos(url.to_string())
            .await
            .map_err(|err| AppError::Youtube(format!("Failed to fetch video info: {}", err)))?;

        let video_info = Self::map_video_info(video, url);
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

        if !self.is_youtube_url(url) {
            return Err(AppError::Youtube(format!("Invalid YouTube URL: {}", url)));
        }

        std::fs::create_dir_all(&self.config.output_dir).map_err(AppError::Io)?;

        let download_id = self.generate_download_id().await;
        self.set_download_status(&download_id, YoutubeDownloadStatus::Pending)
            .await;

        let libraries = self.prepare_libraries().await?;
        let manager_config = self.build_manager_config();
        let url_string = url.to_string();
        let file_name = output_filename.to_string();
        let chosen_format = format.clone();
        let chosen_priority = priority.unwrap_or(DownloadPriority::Normal);
        let output_dir = self.config.output_dir.clone();
        let active_downloads = Arc::clone(&self.active_downloads);
        let download_handles = Arc::clone(&self.download_handles);
        let callback = progress_callback.clone();

        let download_id_for_task = download_id.clone();

        tokio::spawn(async move {
            if let Err(err) = YoutubeDownloader::run_download_job(
                download_id_for_task.clone(),
                url_string,
                file_name,
                chosen_format,
                chosen_priority,
                callback,
                active_downloads.clone(),
                download_handles,
                output_dir,
                libraries,
                manager_config,
            )
            .await
            {
                error!("YouTube download {} failed: {}", download_id_for_task, err);
                let mut downloads = active_downloads.write().await;
                downloads.insert(
                    download_id_for_task,
                    YoutubeDownloadStatus::Failed {
                        error: err.to_string(),
                        retry_count: 0,
                    },
                );
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

        let video_info = self.fetch_video_info(url).await?;
        let thumbnail_url = video_info
            .thumbnail
            .ok_or_else(|| AppError::Youtube("Video thumbnail URL unavailable".to_string()))?;

        let response = reqwest::get(&thumbnail_url)
            .await
            .map_err(AppError::Network)?;
        let bytes = response.bytes().await.map_err(AppError::Network)?;

        let output_path = self.config.output_dir.join(output_filename);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(&output_path, bytes).await?;

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

        let handle = {
            let mut handles = self.download_handles.write().await;
            handles.remove(download_id)
        };

        if let Some(handle) = handle {
            let cancelled = handle.manager.cancel(handle.manager_id).await;
            Self::update_status_map(
                &self.active_downloads,
                download_id,
                YoutubeDownloadStatus::Cancelled,
            )
            .await;
            cancelled
        } else {
            let mut downloads = self.active_downloads.write().await;
            if downloads.contains_key(download_id) {
                downloads.insert(download_id.to_string(), YoutubeDownloadStatus::Cancelled);
                true
            } else {
                false
            }
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
        let mut removed = Vec::new();
        for (id, status) in downloads.iter() {
            if matches!(
                status,
                YoutubeDownloadStatus::Completed { .. }
                    | YoutubeDownloadStatus::Failed { .. }
                    | YoutubeDownloadStatus::Cancelled
            ) {
                removed.push(id.clone());
            }
        }

        for id in &removed {
            downloads.remove(id);
        }

        drop(downloads);

        if !removed.is_empty() {
            let mut handles = self.download_handles.write().await;
            for id in &removed {
                handles.remove(id);
            }
        }

        let removed_count = removed.len();
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

    fn resolved_yt_dlp_path(&self) -> PathBuf {
        self.config.yt_dlp_path.clone().unwrap_or_else(|| {
            self.config
                .libraries_dir
                .join(Self::executable_name("yt-dlp"))
        })
    }

    fn resolved_ffmpeg_path(&self) -> PathBuf {
        self.config.ffmpeg_path.clone().unwrap_or_else(|| {
            self.config
                .libraries_dir
                .join(Self::executable_name("ffmpeg"))
        })
    }

    fn executable_name(name: &str) -> String {
        if cfg!(windows) {
            format!("{}.exe", name)
        } else {
            name.to_string()
        }
    }

    async fn prepare_libraries(&self) -> AppResult<Libraries> {
        std::fs::create_dir_all(&self.config.libraries_dir).map_err(AppError::Io)?;
        let base = Libraries::new(self.resolved_yt_dlp_path(), self.resolved_ffmpeg_path());

        if self.config.auto_install_binaries {
            base.install_dependencies().await.map_err(|err| {
                AppError::Youtube(format!("Failed to prepare yt-dlp binaries: {}", err))
            })
        } else {
            Self::ensure_executable(&base.youtube, "yt-dlp")?;
            Self::ensure_executable(&base.ffmpeg, "ffmpeg")?;
            Ok(base)
        }
    }

    fn build_manager_config(&self) -> YtManagerConfig {
        YtManagerConfig {
            max_concurrent_downloads: self.config.max_concurrent_downloads,
            segment_size: self.config.segment_size,
            parallel_segments: self.config.parallel_segments,
            retry_attempts: self.config.retry_attempts,
            max_buffer_size: self.config.max_buffer_size,
        }
    }

    fn ensure_executable(path: &Path, label: &str) -> AppResult<()> {
        if path.exists() {
            Ok(())
        } else {
            Err(AppError::Youtube(format!(
                "{} binary not found at {}",
                label,
                path.display()
            )))
        }
    }

    fn build_fetcher(
        libraries: Libraries,
        output_dir: &Path,
        manager_config: YtManagerConfig,
    ) -> AppResult<YtDlpClient> {
        YtDlpClient::with_download_manager_config(libraries, output_dir, manager_config)
            .map_err(|err| AppError::Youtube(format!("Failed to initialize yt-dlp: {}", err)))
    }

    fn map_video_info(video: model::Video, original_url: &str) -> YoutubeVideoInfo {
        let description = if video.description.trim().is_empty() {
            None
        } else {
            Some(video.description.clone())
        };

        let uploader = if video.channel.trim().is_empty() {
            None
        } else {
            Some(video.channel.clone())
        };

        let view_count = (video.view_count >= 0).then_some(video.view_count as u64);
        let upload_date = Some(video.upload_date.to_string());

        let formats = video
            .formats
            .iter()
            .map(|format| YoutubeFormat {
                format_id: format.format_id.clone(),
                ext: format.download_info.ext.to_string(),
                vcodec: format.codec_info.video_codec.clone(),
                acodec: format.codec_info.audio_codec.clone(),
                resolution: format.video_resolution.resolution.clone().or_else(|| {
                    match (
                        format.video_resolution.width,
                        format.video_resolution.height,
                    ) {
                        (Some(w), Some(h)) => Some(format!("{}x{}", w, h)),
                        _ => None,
                    }
                }),
                vbr: format.rates_info.video_rate.map(|rate| rate.0),
                abr: format.rates_info.audio_rate.map(|rate| rate.0),
                filesize: format
                    .file_info
                    .filesize
                    .or(format.file_info.filesize_approx)
                    .and_then(|size| (size >= 0).then_some(size as u64)),
                format_note: format.format_note.clone(),
            })
            .collect();

        YoutubeVideoInfo {
            id: video.id,
            title: video.title,
            description,
            duration: None,
            uploader,
            upload_date,
            view_count,
            thumbnail: Some(video.thumbnail),
            formats,
            webpage_url: original_url.to_string(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_download_job(
        download_id: String,
        url: String,
        output_filename: String,
        format_pref: YoutubeDownloadFormat,
        priority: DownloadPriority,
        progress_callback: Option<YoutubeProgressCallback>,
        active_downloads: Arc<RwLock<HashMap<String, YoutubeDownloadStatus>>>,
        download_handles: Arc<RwLock<HashMap<String, DownloadTaskHandle>>>,
        output_dir: PathBuf,
        libraries: Libraries,
        manager_config: YtManagerConfig,
    ) -> AppResult<()> {
        let fetcher = Self::build_fetcher(libraries, &output_dir, manager_config)?;
        let video = fetcher
            .fetch_video_infos(url.clone())
            .await
            .map_err(|err| AppError::Youtube(format!("Failed to fetch video metadata: {}", err)))?;

        let format = Self::select_format(&video, &format_pref)?;
        let download_url = format.download_info.url.clone().ok_or_else(|| {
            AppError::Youtube(format!(
                "Format {} is missing a downloadable URL",
                format.format_id
            ))
        })?;

        let output_path = output_dir.join(output_filename);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let (progress_tx, mut progress_rx) = mpsc::unbounded_channel::<(u64, u64)>();
        let progress_pipe = Arc::new(Mutex::new(progress_tx));
        let sender = progress_pipe.clone();

        let priority_internal = Self::map_priority(priority);
        let manager = fetcher.download_manager.clone();
        let manager_id = manager
            .enqueue_with_progress(
                download_url,
                &output_path,
                Some(priority_internal),
                move |downloaded, total| {
                    let _ = sender.lock().send((downloaded, total));
                },
            )
            .await;

        {
            let mut handles = download_handles.write().await;
            handles.insert(
                download_id.clone(),
                DownloadTaskHandle {
                    manager: manager.clone(),
                    manager_id,
                },
            );
        }

        let start_time = Instant::now();
        let progress_task = {
            let active = Arc::clone(&active_downloads);
            let download_id = download_id.clone();
            let user_callback = progress_callback.clone();
            tokio::spawn(async move {
                while let Some((downloaded, total_hint)) = progress_rx.recv().await {
                    let total_bytes = if total_hint == 0 {
                        None
                    } else {
                        Some(total_hint)
                    };

                    let elapsed = start_time.elapsed().as_secs_f64().max(f64::EPSILON);
                    let speed = downloaded as f64 / elapsed;
                    let eta = total_bytes.and_then(|total| {
                        if downloaded < total && speed > 0.0 {
                            Some(((total - downloaded) as f64 / speed) as u64)
                        } else {
                            None
                        }
                    });

                    YoutubeDownloader::update_status_map(
                        &active,
                        &download_id,
                        YoutubeDownloadStatus::Downloading {
                            downloaded_bytes: downloaded,
                            total_bytes,
                            speed_bytes_per_sec: Some(speed),
                            eta_seconds: eta,
                        },
                    )
                    .await;

                    if let Some(callback) = &user_callback {
                        callback(downloaded, total_bytes, Some(speed));
                    }
                }
            })
        };

        let final_status = manager.wait_for_completion(manager_id).await;
        drop(progress_pipe);
        let _ = progress_task.await;

        {
            let mut handles = download_handles.write().await;
            handles.remove(&download_id);
        }

        match final_status {
            Some(YtManagerStatus::Completed) => {
                let final_size = fs::metadata(&output_path)
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0);
                Self::update_status_map(
                    &active_downloads,
                    &download_id,
                    YoutubeDownloadStatus::Completed {
                        file_path: output_path,
                        final_size,
                    },
                )
                .await;
                Ok(())
            }
            Some(YtManagerStatus::Failed { reason }) => {
                Self::update_status_map(
                    &active_downloads,
                    &download_id,
                    YoutubeDownloadStatus::Failed {
                        error: reason.clone(),
                        retry_count: 0,
                    },
                )
                .await;
                Err(AppError::Download(reason))
            }
            Some(YtManagerStatus::Canceled) => {
                Self::update_status_map(
                    &active_downloads,
                    &download_id,
                    YoutubeDownloadStatus::Cancelled,
                )
                .await;
                Ok(())
            }
            _ => Err(AppError::Youtube(
                "Download finished with unknown status".to_string(),
            )),
        }
    }

    async fn update_status_map(
        downloads: &Arc<RwLock<HashMap<String, YoutubeDownloadStatus>>>,
        download_id: &str,
        status: YoutubeDownloadStatus,
    ) {
        let mut guard = downloads.write().await;
        guard.insert(download_id.to_string(), status);
    }

    fn map_priority(priority: DownloadPriority) -> YtInternalPriority {
        match priority {
            DownloadPriority::Low => YtInternalPriority::Low,
            DownloadPriority::Normal => YtInternalPriority::Normal,
            DownloadPriority::High => YtInternalPriority::High,
            DownloadPriority::Urgent => YtInternalPriority::Critical,
        }
    }

    fn select_format<'a>(
        video: &'a model::Video,
        preference: &YoutubeDownloadFormat,
    ) -> AppResult<&'a Format> {
        match preference {
            YoutubeDownloadFormat::BestAvailable => {
                Self::select_muxed_format(video, ytdl_selector::VideoQuality::Best)
                    .or_else(|| video.best_video_format())
                    .ok_or_else(|| AppError::Youtube("No suitable format found".to_string()))
            }
            YoutubeDownloadFormat::CompleteVideo { video_quality, .. } => {
                Self::select_muxed_format(video, Self::map_video_quality(*video_quality))
                    .or_else(|| video.best_video_format())
                    .ok_or_else(|| AppError::Youtube("Unable to find muxed format".to_string()))
            }
            YoutubeDownloadFormat::VideoOnly { quality, codec } => video
                .select_video_format(
                    Self::map_video_quality(*quality),
                    Self::map_video_codec(*codec),
                )
                .ok_or_else(|| AppError::Youtube("Unable to find video-only format".to_string())),
            YoutubeDownloadFormat::AudioOnly { quality, codec } => video
                .select_audio_format(
                    Self::map_audio_quality(*quality),
                    Self::map_audio_codec(*codec),
                )
                .ok_or_else(|| AppError::Youtube("Unable to find audio-only format".to_string())),
            YoutubeDownloadFormat::SpecificFormat { format_id } => video
                .formats
                .iter()
                .find(|f| f.format_id == *format_id)
                .ok_or_else(|| {
                    AppError::Youtube(format!("Format {} not available in playlist", format_id))
                }),
        }
    }

    fn select_muxed_format(
        video: &model::Video,
        quality: ytdl_selector::VideoQuality,
    ) -> Option<&Format> {
        let muxed: Vec<&Format> = video
            .formats
            .iter()
            .filter(|format| format.format_type().is_audio_and_video())
            .collect();

        if muxed.is_empty() {
            return None;
        }

        let (target_height, prefer_highest, prefer_lowest) = match quality {
            ytdl_selector::VideoQuality::Best => (None, true, false),
            ytdl_selector::VideoQuality::Worst => (None, false, true),
            ytdl_selector::VideoQuality::High => (Some(1080), false, false),
            ytdl_selector::VideoQuality::Medium => (Some(720), false, false),
            ytdl_selector::VideoQuality::Low => (Some(480), false, false),
            ytdl_selector::VideoQuality::CustomHeight(h) => (Some(h), false, false),
            ytdl_selector::VideoQuality::CustomWidth(_) => (None, true, false),
        };

        if let Some(height) = target_height {
            muxed
                .into_iter()
                .min_by(|a, b| Self::compare_height_to_target(a, b, height))
        } else if prefer_highest {
            muxed.into_iter().max_by(|a, b| Self::compare_height(a, b))
        } else if prefer_lowest {
            muxed.into_iter().min_by(|a, b| Self::compare_height(a, b))
        } else {
            muxed.into_iter().max_by(|a, b| Self::compare_height(a, b))
        }
    }

    fn compare_height(a: &Format, b: &Format) -> Ordering {
        Self::format_height(a).cmp(&Self::format_height(b))
    }

    fn compare_height_to_target(a: &Format, b: &Format, target: u32) -> Ordering {
        let a_diff = Self::format_height(a).abs_diff(target);
        let b_diff = Self::format_height(b).abs_diff(target);
        a_diff
            .cmp(&b_diff)
            .then_with(|| Self::compare_height(a, b).reverse())
    }

    fn format_height(format: &Format) -> u32 {
        format.video_resolution.height.unwrap_or(0)
    }

    fn map_video_quality(quality: VideoQuality) -> ytdl_selector::VideoQuality {
        match quality {
            VideoQuality::Low => ytdl_selector::VideoQuality::Low,
            VideoQuality::Medium => ytdl_selector::VideoQuality::Medium,
            VideoQuality::High => ytdl_selector::VideoQuality::High,
            VideoQuality::Best => ytdl_selector::VideoQuality::Best,
            VideoQuality::Worst => ytdl_selector::VideoQuality::Worst,
        }
    }

    fn map_video_codec(codec: VideoCodecPreference) -> ytdl_selector::VideoCodecPreference {
        match codec {
            VideoCodecPreference::AVC1 => ytdl_selector::VideoCodecPreference::AVC1,
            VideoCodecPreference::VP9 => ytdl_selector::VideoCodecPreference::VP9,
            VideoCodecPreference::AV01 => ytdl_selector::VideoCodecPreference::AV1,
            VideoCodecPreference::Any => ytdl_selector::VideoCodecPreference::Any,
        }
    }

    fn map_audio_quality(quality: AudioQuality) -> ytdl_selector::AudioQuality {
        match quality {
            AudioQuality::Low => ytdl_selector::AudioQuality::Low,
            AudioQuality::Medium => ytdl_selector::AudioQuality::Medium,
            AudioQuality::High => ytdl_selector::AudioQuality::High,
            AudioQuality::Best => ytdl_selector::AudioQuality::Best,
            AudioQuality::Worst => ytdl_selector::AudioQuality::Worst,
        }
    }

    fn map_audio_codec(codec: AudioCodecPreference) -> ytdl_selector::AudioCodecPreference {
        match codec {
            AudioCodecPreference::AAC => ytdl_selector::AudioCodecPreference::AAC,
            AudioCodecPreference::MP3 => ytdl_selector::AudioCodecPreference::MP3,
            AudioCodecPreference::Opus => ytdl_selector::AudioCodecPreference::Opus,
            AudioCodecPreference::FLAC => {
                ytdl_selector::AudioCodecPreference::Custom("flac".to_string())
            }
            AudioCodecPreference::Any => ytdl_selector::AudioCodecPreference::Any,
        }
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
        std::fs::create_dir_all(&new_config.output_dir).map_err(AppError::Io)?;

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
    use serde_json::{json, Value};
    use yt_dlp::model;

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

    #[test]
    fn test_map_video_info_from_json() {
        let video = sample_video(vec![
            format_entry("muxed_1080", Some(1920), Some(1080), true, true),
            format_entry("audio_140", None, None, true, false),
        ]);

        let info = YoutubeDownloader::map_video_info(video, "https://example.com/watch?v=video123");
        assert_eq!(info.id, "video_id");
        assert_eq!(info.uploader.as_deref(), Some("Sample Channel"));
        assert_eq!(info.formats.len(), 2);
        assert_eq!(
            info.formats
                .iter()
                .find(|f| f.format_id == "muxed_1080")
                .and_then(|f| f.resolution.clone()),
            Some("1920x1080".to_string())
        );
        assert!(info
            .formats
            .iter()
            .any(|f| f.format_id == "audio_140" && f.acodec.as_deref() == Some("aac")));
    }

    #[test]
    fn test_select_format_variants() {
        let video = sample_video(vec![
            format_entry("muxed_best", Some(1920), Some(1080), true, true),
            format_entry("video_only_720", Some(1280), Some(720), false, true),
            format_entry("audio_only", None, None, true, false),
        ]);

        let best = YoutubeDownloader::select_format(&video, &YoutubeDownloadFormat::BestAvailable)
            .expect("best format available");
        assert_eq!(best.format_id, "muxed_best");

        let video_only = YoutubeDownloader::select_format(
            &video,
            &YoutubeDownloadFormat::VideoOnly {
                quality: VideoQuality::Medium,
                codec: VideoCodecPreference::AVC1,
            },
        )
        .expect("video only format");
        assert_eq!(video_only.format_id, "video_only_720");

        let audio_only = YoutubeDownloader::select_format(
            &video,
            &YoutubeDownloadFormat::AudioOnly {
                quality: AudioQuality::High,
                codec: AudioCodecPreference::AAC,
            },
        )
        .expect("audio only format");
        assert_eq!(audio_only.format_id, "audio_only");

        let missing = YoutubeDownloader::select_format(
            &video,
            &YoutubeDownloadFormat::SpecificFormat {
                format_id: "not_exists".to_string(),
            },
        );
        assert!(missing.is_err());
    }

    fn sample_video(formats: Vec<Value>) -> model::Video {
        let video_json = json!({
            "id": "video_id",
            "title": "Sample Title",
            "thumbnail": "https://example.com/thumb.jpg",
            "description": "Sample Description",
            "availability": "public",
            "timestamp": 1_700_000_000,
            "view_count": 123,
            "like_count": 10,
            "comment_count": 5,
            "channel": "Sample Channel",
            "channel_id": "channel_123",
            "channel_url": "https://youtube.com/channel/channel_123",
            "channel_follower_count": 2048,
            "http_headers": {
                "User-Agent": "Mozilla/5.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Mode": "navigate"
            },
            "formats": formats,
            "thumbnails": [],
            "automatic_captions": {},
            "tags": [],
            "categories": [],
            "age_limit": 0,
            "_has_drm": false,
            "live_status": "none",
            "playable_in_embed": true,
            "extractor": "youtube",
            "extractor_key": "Youtube",
            "_version": {
                "version": "2024.10.10",
                "current_git_head": null,
                "release_git_head": null,
                "repository": "yt-dlp/yt-dlp"
            }
        });

        serde_json::from_value(video_json).expect("valid video json")
    }

    fn format_entry(
        format_id: &str,
        width: Option<u32>,
        height: Option<u32>,
        has_audio: bool,
        has_video: bool,
    ) -> Value {
        let resolution = match (width, height) {
            (Some(w), Some(h)) => Some(format!("{}x{}", w, h)),
            _ => None,
        };

        json!({
            "format": format_id,
            "format_id": format_id,
            "format_note": format!("note-{}", format_id),
            "protocol": "https",
            "language": null,
            "has_drm": false,
            "container": null,
            "acodec": if has_audio { Value::from("aac") } else { Value::Null },
            "vcodec": if has_video { Value::from("h264") } else { Value::Null },
            "width": width,
            "height": height,
            "resolution": resolution,
            "fps": if has_video { Value::from(30) } else { Value::Null },
            "tbr": 1200,
            "vbr": if has_video { Value::from(1200) } else { Value::Null },
            "abr": if has_audio { Value::from(128) } else { Value::Null },
            "ext": if has_audio && !has_video { "m4a" } else { "mp4" },
            "filesize": 1024,
            "filesize_approx": 1024,
            "url": format!("https://cdn.example.com/{}.mp4", format_id),
            "http_headers": {
                "User-Agent": "Mozilla/5.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Mode": "navigate"
            },
            "audio_channels": if has_audio { Value::from(2) } else { Value::Null },
            "asr": if has_audio { Value::from(48000) } else { Value::Null },
        })
    }
}
