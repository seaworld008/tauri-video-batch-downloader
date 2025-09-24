//! Core data models for the video downloader application

use serde::{Deserialize, Serialize};

use std::collections::HashMap;

/// Task status enumeration

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskStatus {
    Pending,

    Downloading,

    Paused,

    Completed,

    Failed,

    Cancelled,
}

/// Downloader type enumeration

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DownloaderType {
    Http,

    M3u8,

    Youtube,
}

/// Main video download task structure

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct VideoTask {
    pub id: String,

    pub url: String,

    pub title: String,

    pub output_path: String,

    pub status: TaskStatus,

    pub progress: f64,

    pub file_size: Option<u64>,

    pub downloaded_size: u64,

    pub speed: f64,

    pub eta: Option<u64>,

    pub error_message: Option<String>,

    pub created_at: chrono::DateTime<chrono::Utc>,

    pub updated_at: chrono::DateTime<chrono::Utc>,

    pub downloader_type: Option<DownloaderType>,

    // 保存完整的视频信息供后续使用
    pub video_info: Option<VideoInfo>,
}

/// Progress update information

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct ProgressUpdate {
    pub task_id: String,

    pub downloaded_size: u64,

    pub total_size: Option<u64>,

    pub speed: f64,

    pub eta: Option<u64>,
}

/// Video information structure matching Go version

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct VideoInfo {
    pub zl_id: Option<String>, // 专栏ID

    pub zl_name: Option<String>, // 专栏名称

    pub record_url: Option<String>, // 视频URL

    pub kc_id: Option<String>, // 课程ID

    pub kc_name: Option<String>, // 课程名称

    // 兼容旧版本字段
    pub id: Option<String>,

    pub name: Option<String>,

    pub url: Option<String>,

    pub course_id: Option<String>,

    pub course_name: Option<String>,
}

/// Imported data from CSV/Excel files (Go version compatible)

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct ImportedData {
    pub zl_id: Option<String>, // 专栏ID (对应Go版本的ZlID)

    pub zl_name: Option<String>, // 专栏名称 (对应Go版本的ZlName)

    pub record_url: Option<String>, // 视频链接 (对应Go版本的RecordURL)

    pub kc_id: Option<String>, // 课程ID (对应Go版本的KcID)

    pub kc_name: Option<String>, // 课程名称 (对应Go版本的KcName)

    // 兼容旧版本字段
    pub id: Option<String>,

    pub name: Option<String>,

    pub url: Option<String>,

    pub course_id: Option<String>,

    pub course_name: Option<String>,
}

/// Download configuration

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct DownloadConfig {
    pub concurrent_downloads: usize,

    pub retry_attempts: usize,

    pub timeout_seconds: u64,

    pub user_agent: String,

    pub proxy: Option<String>,

    pub headers: HashMap<String, String>,

    pub output_directory: String,

    /// Whether to automatically verify file integrity after download
    pub auto_verify_integrity: bool,

    /// Hash algorithm to use for integrity verification
    pub integrity_algorithm: Option<String>, // "sha256", "blake2b", etc.

    /// Expected hash values for files (URL -> hash)
    pub expected_hashes: HashMap<String, String>,
}

impl Default for DownloadConfig {
    fn default() -> Self {
        Self {
            concurrent_downloads: 3,

            retry_attempts: 3,

            timeout_seconds: 30,

            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),

            proxy: None,

            headers: HashMap::new(),

            output_directory: "downloads".to_string(),

            auto_verify_integrity: false, // Disabled by default for performance

            integrity_algorithm: Some("sha256".to_string()), // Default to SHA-256

            expected_hashes: HashMap::new(),
        }
    }
}

/// Download statistics

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct DownloadStats {
    pub total_tasks: usize,

    pub completed_tasks: usize,

    pub failed_tasks: usize,

    pub total_downloaded: u64,

    pub average_speed: f64,

    pub active_downloads: usize,
}

impl Default for DownloadStats {
    fn default() -> Self {
        Self {
            total_tasks: 0,

            completed_tasks: 0,

            failed_tasks: 0,

            total_downloaded: 0,

            average_speed: 0.0,

            active_downloads: 0,
        }
    }
}

/// System information

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct SystemInfo {
    pub cpu_usage: f32,

    pub memory_usage: f32,

    pub disk_usage: f32,

    pub network_speed: NetworkSpeed,

    pub active_downloads: usize,
}

/// Network speed information

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct NetworkSpeed {
    pub download: f64,

    pub upload: f64,
}

/// YouTube video information

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct YoutubeVideoInfo {
    pub id: String,

    pub title: String,

    pub description: String,

    pub duration: u64,

    pub thumbnail: String,

    pub formats: Vec<VideoFormat>,

    pub subtitles: Vec<SubtitleTrack>,
}

/// Video format information

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct VideoFormat {
    pub format_id: String,

    pub ext: String,

    pub width: Option<u32>,

    pub height: Option<u32>,

    pub fps: Option<f32>,

    pub vbr: Option<f32>,

    pub abr: Option<f32>,

    pub filesize: Option<u64>,

    pub quality: String,
}

/// Subtitle track information

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct SubtitleTrack {
    pub language: String,

    pub language_code: String,

    pub url: String,

    pub ext: String,
}

/// File encoding detection result

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct EncodingDetection {
    pub encoding: String,

    pub confidence: f32,

    pub language: Option<String>,
}

/// Import preview data

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct ImportPreview {
    pub headers: Vec<String>,

    pub rows: Vec<Vec<String>>,

    pub total_rows: usize,

    pub encoding: String,

    pub field_mapping: HashMap<String, String>,
}

/// Application error types

#[derive(Debug, thiserror::Error)]

pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Parsing error: {0}")]
    Parse(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Download error: {0}")]
    Download(String),

    #[error("YouTube error: {0}")]
    Youtube(String),

    #[error("System error: {0}")]
    System(String),
}

/// Result type alias for application operations

pub type AppResult<T> = Result<T, AppError>;
