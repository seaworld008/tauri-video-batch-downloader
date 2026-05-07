use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

use crate::core::downloader::{DownloadStats, DownloadTask};
use crate::core::models::{ExternalVideoInfo, SourcePlatform, TaskStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ToolCapabilityStatus {
    Available,
    Missing,
    Failed,
    VersionUnsupported,
}

#[derive(Debug, Clone)]
pub struct YtDlpDownloaderConfig {
    pub yt_dlp_path: Option<PathBuf>,
    pub ffmpeg_path: Option<PathBuf>,
    pub user_agent: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedYtDlpProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed: f64,
    pub eta: Option<u64>,
    pub status_hint: Option<TaskStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformHostRule {
    pub platform: SourcePlatform,
    pub hosts: &'static [&'static str],
}

const PLATFORM_HOST_RULES: &[PlatformHostRule] = &[
    PlatformHostRule {
        platform: SourcePlatform::Youtube,
        hosts: &["youtube.com", "youtu.be", "youtube-nocookie.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Tiktok,
        hosts: &["tiktok.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Instagram,
        hosts: &["instagram.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Facebook,
        hosts: &["facebook.com", "fb.watch", "fb.com"],
    },
];

impl Default for YtDlpDownloaderConfig {
    fn default() -> Self {
        Self {
            yt_dlp_path: None,
            ffmpeg_path: None,
            user_agent: "VideoDownloaderPro/1.0.0".to_string(),
        }
    }
}

pub fn emit_progress(
    task: &mut DownloadTask,
    progress: &ParsedYtDlpProgress,
    started: Instant,
    tx: Option<&mpsc::UnboundedSender<(String, DownloadStats)>>,
) {
    task.stats.downloaded_bytes = progress.downloaded_bytes;
    task.stats.total_bytes = progress.total_bytes;
    task.stats.speed = progress.speed;
    task.stats.eta = progress.eta;
    task.stats.progress = progress
        .total_bytes
        .map(|total| progress.downloaded_bytes as f64 / total as f64)
        .unwrap_or(0.0)
        .clamp(0.0, 0.999);
    task.stats.status_hint = progress.status_hint.clone();
    task.stats.last_update = chrono::Utc::now();
    task.stats.start_time =
        chrono::Utc::now() - chrono::Duration::from_std(started.elapsed()).unwrap_or_default();
    if let Some(tx) = tx {
        let _ = tx.send((task.id.clone(), task.stats.clone()));
    }
}

pub fn emit_committing(
    task: &mut DownloadTask,
    tx: Option<&mpsc::UnboundedSender<(String, DownloadStats)>>,
) {
    task.stats.status_hint = Some(TaskStatus::Committing);
    task.stats.speed = 0.0;
    task.stats.eta = None;
    if let Some(tx) = tx {
        let _ = tx.send((task.id.clone(), task.stats.clone()));
    }
}

pub fn parse_progress_line(line: &str) -> Option<ParsedYtDlpProgress> {
    let payload = line.strip_prefix("download:")?;
    let parts: Vec<&str> = payload.split('\t').collect();
    if parts.len() < 5 {
        return None;
    }
    let downloaded_bytes = parse_u64(parts[0])?;
    let total_bytes = parse_u64(parts[1]);
    let speed = parse_f64(parts[2]).unwrap_or(0.0);
    let eta = parse_u64(parts[3]);
    let status_hint = if parts[4].contains("finished") || parts[4].contains("post_process") {
        Some(TaskStatus::Committing)
    } else {
        None
    };
    Some(ParsedYtDlpProgress {
        downloaded_bytes,
        total_bytes,
        speed,
        eta,
        status_hint,
    })
}

pub fn spawn_line_reader<R>(reader: Option<R>, tx: mpsc::UnboundedSender<String>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    if let Some(reader) = reader {
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(line);
            }
        });
    }
}

pub fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|ch| {
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('.');
    let bounded = trimmed.chars().take(160).collect::<String>();
    if bounded.is_empty() {
        "video".to_string()
    } else {
        bounded
    }
}

pub fn platform_host_rules() -> &'static [PlatformHostRule] {
    PLATFORM_HOST_RULES
}

pub fn detect_platform(url: &str) -> SourcePlatform {
    let host = url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_lowercase()))
        .unwrap_or_default();

    platform_host_rules()
        .iter()
        .find(|rule| {
            rule.hosts
                .iter()
                .any(|candidate| host_matches(&host, candidate))
        })
        .map(|rule| rule.platform.clone())
        .unwrap_or(SourcePlatform::Generic)
}

fn host_matches(host: &str, candidate: &str) -> bool {
    host == candidate || host.ends_with(&format!(".{candidate}"))
}

pub fn is_direct_media_url(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .map(|parsed| {
            let path = parsed.path().to_lowercase();
            [
                ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".flv", ".wmv", ".mp3", ".m4a",
                ".aac", ".wav", ".ogg",
            ]
            .iter()
            .any(|ext| path.ends_with(ext))
        })
        .unwrap_or(false)
}

pub fn build_probe_args(url: &str) -> Vec<String> {
    vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--dump-single-json".into(),
        url.into(),
    ]
}

pub fn build_download_args(
    url: &str,
    output_dir: &Path,
    output_template: &str,
    ffmpeg_path: Option<&Path>,
) -> Vec<String> {
    let mut args = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--format".into(),
        "bv*+ba/b".into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "--paths".into(),
        output_dir.to_string_lossy().to_string(),
        "--output".into(),
        output_template.into(),
        "--progress-template".into(),
        "download:%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.speed)s\t%(progress.eta)s\t%(progress.status)s".into(),
        "--print".into(),
        "after_move:filepath:%(filepath)s".into(),
    ];
    if let Some(path) = ffmpeg_path {
        args.push("--ffmpeg-location".into());
        args.push(path.to_string_lossy().to_string());
    }
    args.push(url.into());
    args
}

pub fn external_info_from_json(json: &Value, original_url: &str) -> ExternalVideoInfo {
    ExternalVideoInfo {
        source_platform: detect_platform(
            json.get("webpage_url")
                .and_then(Value::as_str)
                .unwrap_or(original_url),
        ),
        extractor: json
            .get("extractor")
            .and_then(Value::as_str)
            .map(str::to_string),
        webpage_url: json
            .get("webpage_url")
            .and_then(Value::as_str)
            .map(str::to_string),
        title: json
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string),
        thumbnail: json
            .get("thumbnail")
            .and_then(Value::as_str)
            .map(str::to_string),
        duration_seconds: json.get("duration").and_then(Value::as_f64),
        format_id: json
            .get("format_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        format_note: json
            .get("format_note")
            .and_then(Value::as_str)
            .map(str::to_string),
        requires_auth: false,
    }
}

pub fn classify_error(message: &str) -> String {
    let normalized = message.to_lowercase();
    if normalized.contains("ffmpeg")
        && (normalized.contains("not found") || normalized.contains("not installed"))
    {
        "ffmpeg_missing: ffmpeg sidecar or PATH fallback not available".into()
    } else if normalized.contains("sign in")
        || normalized.contains("login")
        || normalized.contains("private")
        || normalized.contains("age-restricted")
    {
        "authentication_required: public-only downloads do not use cookies or login state".into()
    } else if normalized.contains("not available in your country")
        || normalized.contains("geo")
        || normalized.contains("copyright")
        || normalized.contains("policy")
    {
        "geo_or_policy_restricted: this public URL is blocked by platform policy or region".into()
    } else if normalized.contains("unsupported url") || normalized.contains("no suitable extractor")
    {
        "unsupported_extractor: yt-dlp has no extractor for this URL".into()
    } else if normalized.contains("429")
        || normalized.contains("too many requests")
        || normalized.contains("rate limit")
    {
        "rate_limited: source is rate limiting yt-dlp".into()
    } else if normalized.contains("update") && normalized.contains("yt-dlp") {
        "ytdlp_update_recommended: bundled yt-dlp may be too old for this site".into()
    } else {
        format!("external_tool_failed: {}", message.trim())
    }
}

pub fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

pub fn sidecar_path(name: &str) -> Option<PathBuf> {
    let (path, _) = crate::core::external_tools::resolve_tool_path(name);
    path.exists().then_some(path)
}

pub fn exe_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    }
}

fn parse_u64(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .map(|num| num.max(0.0) as u64)
}

fn parse_f64(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok()
}
