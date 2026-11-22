//! Core data models for the video downloader application

use serde::{Deserialize, Deserializer, Serialize};

use std::collections::HashMap;
use std::path::Path;

/// Task status enumeration

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskStatus {
    Pending,

    Downloading,

    Committing,

    Paused,

    Completed,

    Failed,

    Cancelled,
}

/// Downloader type enumeration

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum DownloaderType {
    Http,

    M3u8,

    Dash,

    YtDlp,
}

impl<'de> Deserialize<'de> for DownloaderType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "Http" | "http" => Ok(Self::Http),
            "M3u8" | "m3u8" | "Hls" | "hls" => Ok(Self::M3u8),
            "Dash" | "dash" | "Mpd" | "mpd" => Ok(Self::Dash),
            "YtDlp" | "ytdlp" | "Youtube" | "youtube" => Ok(Self::YtDlp),
            other => Err(serde::de::Error::custom(format!(
                "unknown downloader type: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourcePlatform {
    Youtube,
    Tiktok,
    Instagram,
    Facebook,
    Bilibili,
    Twitter,
    Vimeo,
    Twitch,
    Generic,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRequestOptions {
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub cookies: Option<String>,
    #[serde(default)]
    pub cookies_from_browser: Option<String>,
    #[serde(default)]
    pub referer: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub proxy: Option<String>,
    #[serde(default)]
    pub format_selector: Option<String>,
    #[serde(default)]
    pub preferred_language: Option<String>,
    #[serde(default)]
    pub output_container: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EffectiveRequestOptions {
    pub headers: HashMap<String, String>,
    pub cookies_from_browser: Option<String>,
    pub user_agent: String,
    pub proxy: Option<String>,
    pub format_selector: Option<String>,
    pub preferred_language: Option<String>,
    pub output_container: Option<String>,
}

fn non_empty_trimmed(value: Option<&String>) -> Option<String> {
    value
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn has_header_case_insensitive(headers: &HashMap<String, String>, target: &str) -> bool {
    headers
        .keys()
        .any(|key| key.trim().eq_ignore_ascii_case(target))
}

fn set_header_case_insensitive(headers: &mut HashMap<String, String>, name: &str, value: String) {
    headers.retain(|k, _| !k.trim().eq_ignore_ascii_case(name));
    headers.insert(name.to_string(), value);
}

impl TaskRequestOptions {
    pub fn merge_with_config(
        task_opts: Option<&TaskRequestOptions>,
        config: &DownloadConfig,
    ) -> EffectiveRequestOptions {
        Self::merge_with_defaults(
            task_opts,
            &config.headers,
            config.proxy.as_deref(),
            &config.user_agent,
        )
    }

    pub fn merge_with_defaults(
        task_opts: Option<&TaskRequestOptions>,
        default_headers: &HashMap<String, String>,
        default_proxy: Option<&str>,
        default_user_agent: &str,
    ) -> EffectiveRequestOptions {
        let mut headers: HashMap<String, String> = default_headers
            .iter()
            .filter_map(|(k, v)| {
                let key = k.trim();
                let val = v.trim();
                (!key.is_empty() && !val.is_empty()).then(|| (key.to_string(), val.to_string()))
            })
            .collect();

        if let Some(opts) = task_opts {
            for (k, v) in &opts.headers {
                let key = k.trim();
                let val = v.trim();
                if !key.is_empty() && !val.is_empty() {
                    set_header_case_insensitive(&mut headers, key, val.to_string());
                }
            }

            if !has_header_case_insensitive(&opts.headers, "referer") {
                if let Some(referer) = non_empty_trimmed(opts.referer.as_ref()) {
                    set_header_case_insensitive(&mut headers, "Referer", referer);
                }
            }

            if !has_header_case_insensitive(&opts.headers, "cookie") {
                if let Some(cookies) = non_empty_trimmed(opts.cookies.as_ref()) {
                    set_header_case_insensitive(&mut headers, "Cookie", cookies);
                }
            }
        }

        let user_agent = task_opts
            .and_then(|opts| non_empty_trimmed(opts.user_agent.as_ref()))
            .or_else(|| {
                headers
                    .iter()
                    .find(|(k, _)| k.trim().eq_ignore_ascii_case("user-agent"))
                    .map(|(_, v)| v.clone())
            })
            .unwrap_or_else(|| default_user_agent.trim().to_string());

        headers.retain(|k, _| !k.trim().eq_ignore_ascii_case("user-agent"));

        let proxy = task_opts
            .and_then(|opts| non_empty_trimmed(opts.proxy.as_ref()))
            .or_else(|| {
                default_proxy
                    .map(str::trim)
                    .filter(|p| !p.is_empty())
                    .map(str::to_string)
            });

        EffectiveRequestOptions {
            headers,
            cookies_from_browser: task_opts
                .and_then(|opts| non_empty_trimmed(opts.cookies_from_browser.as_ref())),
            user_agent,
            proxy,
            format_selector: task_opts
                .and_then(|opts| non_empty_trimmed(opts.format_selector.as_ref())),
            preferred_language: task_opts
                .and_then(|opts| non_empty_trimmed(opts.preferred_language.as_ref())),
            output_container: task_opts
                .and_then(|opts| non_empty_trimmed(opts.output_container.as_ref())),
        }
    }

    pub fn with_config_fallback(
        task_opts: Option<TaskRequestOptions>,
        config: &DownloadConfig,
    ) -> Option<TaskRequestOptions> {
        let has_config_overrides = !config.headers.is_empty()
            || config
                .proxy
                .as_deref()
                .map(str::trim)
                .is_some_and(|p| !p.is_empty());

        if task_opts.is_none() && !has_config_overrides {
            return None;
        }

        let effective = Self::merge_with_config(task_opts.as_ref(), config);
        let original = task_opts.unwrap_or_default();
        Some(TaskRequestOptions {
            headers: effective.headers,
            cookies: original.cookies,
            cookies_from_browser: effective.cookies_from_browser,
            referer: original.referer,
            user_agent: if effective.user_agent.is_empty() {
                None
            } else {
                Some(effective.user_agent)
            },
            proxy: effective.proxy,
            format_selector: effective.format_selector,
            preferred_language: effective.preferred_language,
            output_container: effective.output_container,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExternalVideoInfo {
    pub source_platform: SourcePlatform,
    pub extractor: Option<String>,
    pub webpage_url: Option<String>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub duration_seconds: Option<f64>,
    pub format_id: Option<String>,
    pub format_note: Option<String>,
    #[serde(default)]
    pub requires_auth: bool,
}

/// Main video download task structure

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct VideoTask {
    pub id: String,

    pub url: String,

    pub title: String,

    pub output_path: String,

    /// Fully resolved file path for this task (optional, backend-derived)
    #[serde(default)]
    pub resolved_path: Option<String>,

    pub status: TaskStatus,

    pub progress: f64,

    pub file_size: Option<u64>,

    pub downloaded_size: u64,

    pub speed: f64,

    /// Smoothed task speed for UI display (bytes per second)
    #[serde(default)]
    pub display_speed_bps: u64,

    pub eta: Option<u64>,

    pub error_message: Option<String>,

    pub created_at: chrono::DateTime<chrono::Utc>,

    pub updated_at: chrono::DateTime<chrono::Utc>,

    /// When the task was paused (used for resume ordering)
    #[serde(default)]
    pub paused_at: Option<chrono::DateTime<chrono::Utc>>,

    /// Whether the task was actively downloading when it was paused
    #[serde(default)]
    pub paused_from_active: bool,

    pub downloader_type: Option<DownloaderType>,

    // 保存完整的视频信息供后续使用
    pub video_info: Option<VideoInfo>,

    /// Metadata discovered by external providers such as yt-dlp.
    #[serde(default)]
    pub external_info: Option<ExternalVideoInfo>,

    /// Optional per-task request overrides (headers, cookies, proxy, format, language).
    #[serde(default)]
    pub request_options: Option<TaskRequestOptions>,
}

/// Progress update information

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct ProgressUpdate {
    pub task_id: String,

    pub downloaded_size: u64,

    pub total_size: Option<u64>,

    pub speed: f64,

    /// Smoothed task speed for UI display (bytes per second)
    #[serde(default)]
    pub display_speed_bps: u64,

    pub eta: Option<u64>,

    pub progress: f64,
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

            output_directory: default_download_directory(),

            auto_verify_integrity: false, // Disabled by default for performance

            integrity_algorithm: Some("sha256".to_string()), // Default to SHA-256

            expected_hashes: HashMap::new(),
        }
    }
}

fn default_download_directory() -> String {
    if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE")
            .map(|profile| Path::new(&profile).join("Downloads"))
            .unwrap_or_else(|_| Path::new(".").join("downloads"))
            .to_string_lossy()
            .to_string()
    } else {
        std::env::var("HOME")
            .map(|home| Path::new(&home).join("Downloads"))
            .unwrap_or_else(|_| Path::new(".").join("downloads"))
            .to_string_lossy()
            .to_string()
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

    /// Aggregate display speed for UI status bars (bytes per second)
    #[serde(default)]
    pub display_total_speed_bps: u64,

    pub active_downloads: usize,

    pub queue_paused: bool,

    /// Average transfer duration in seconds for completed downloads
    #[serde(default)]
    pub average_transfer_duration: f64,

    /// Average commit duration in seconds for completed downloads
    #[serde(default)]
    pub average_commit_duration: f64,

    /// 95th percentile commit duration in seconds
    #[serde(default)]
    pub p95_commit_duration: f64,

    /// Number of failures that happened after entering commit stage
    #[serde(default)]
    pub failed_commit_count: u64,

    /// Number of completed commits slower than warning threshold
    #[serde(default)]
    pub commit_warning_count: u64,

    /// Number of completed commits slower than elevated threshold
    #[serde(default)]
    pub commit_elevated_warning_count: u64,
}

impl Default for DownloadStats {
    fn default() -> Self {
        Self {
            total_tasks: 0,

            completed_tasks: 0,

            failed_tasks: 0,

            total_downloaded: 0,

            average_speed: 0.0,

            display_total_speed_bps: 0,

            active_downloads: 0,

            queue_paused: false,

            average_transfer_duration: 0.0,

            average_commit_duration: 0.0,

            p95_commit_duration: 0.0,

            failed_commit_count: 0,

            commit_warning_count: 0,

            commit_elevated_warning_count: 0,
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

/// Priority queue item for task scheduling
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskPriority {
    pub task_id: String,
    pub priority: u8,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl PartialOrd for TaskPriority {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for TaskPriority {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.created_at.cmp(&self.created_at))
    }
}

/// Persisted snapshot of DownloadManager tasks, queue ordering, and global pause flag
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PersistedManagerState {
    pub tasks: Vec<VideoTask>,
    pub queue: Vec<TaskPriority>,
    pub queue_paused: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloader_type_deserializes_dash_and_aliases() {
        let dash: DownloaderType = serde_json::from_str("\"dash\"").expect("dash");
        assert_eq!(dash, DownloaderType::Dash);
        let mpd: DownloaderType = serde_json::from_str("\"mpd\"").expect("mpd");
        assert_eq!(mpd, DownloaderType::Dash);
        let m3u8: DownloaderType = serde_json::from_str("\"hls\"").expect("hls");
        assert_eq!(m3u8, DownloaderType::M3u8);
    }

    #[test]
    fn merge_with_config_applies_precedence_and_case_insensitive_headers() {
        let mut config = DownloadConfig::default();
        config
            .headers
            .insert("referer".to_string(), "https://global.example".to_string());
        config
            .headers
            .insert("X-Global".to_string(), "1".to_string());
        config.proxy = Some("http://127.0.0.1:8080".to_string());

        let mut task_headers = HashMap::new();
        task_headers.insert("X-Global".to_string(), "override".to_string());
        task_headers.insert("User-Agent".to_string(), "CustomUA/2.0".to_string());

        let task_opts = TaskRequestOptions {
            headers: task_headers,
            cookies: Some("sid=abc".to_string()),
            cookies_from_browser: Some("chrome".to_string()),
            referer: Some("https://task.example".to_string()),
            user_agent: None,
            proxy: Some("socks5://127.0.0.1:1080".to_string()),
            format_selector: Some("720p".to_string()),
            preferred_language: Some("en".to_string()),
            output_container: Some("mp4".to_string()),
        };

        let effective = TaskRequestOptions::merge_with_config(Some(&task_opts), &config);
        assert_eq!(effective.user_agent, "CustomUA/2.0");
        assert_eq!(effective.proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
        assert_eq!(
            effective.headers.get("X-Global").map(String::as_str),
            Some("override")
        );
        assert_eq!(
            effective.headers.get("Referer").map(String::as_str),
            Some("https://task.example")
        );
        assert_eq!(
            effective.headers.get("Cookie").map(String::as_str),
            Some("sid=abc")
        );
        assert!(!effective
            .headers
            .keys()
            .any(|k| k.eq_ignore_ascii_case("user-agent")));
        assert_eq!(effective.cookies_from_browser.as_deref(), Some("chrome"));
        assert_eq!(effective.format_selector.as_deref(), Some("720p"));
        assert_eq!(effective.preferred_language.as_deref(), Some("en"));
        assert_eq!(effective.output_container.as_deref(), Some("mp4"));
    }
}
