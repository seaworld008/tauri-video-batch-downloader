use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

use crate::core::downloader::{DownloadStats, DownloadTask};
use crate::core::models::{ExternalVideoInfo, SourcePlatform, TaskStatus};
pub use crate::utils::file_utils::sanitize_filename;

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
    pub deno_path: Option<PathBuf>,
    pub user_agent: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedYtDlpProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed: f64,
    pub eta: Option<u64>,
    pub progress: Option<f64>,
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
            deno_path: None,
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
    let previous_downloaded = task.stats.downloaded_bytes;
    let previous_update = task.stats.last_update;
    let now = chrono::Utc::now();
    let elapsed_since_last = now
        .signed_duration_since(previous_update)
        .num_milliseconds()
        .max(0) as f64
        / 1000.0;
    let delta_bytes = progress
        .downloaded_bytes
        .saturating_sub(previous_downloaded);
    let fallback_speed = if progress.speed > 0.0 {
        progress.speed
    } else if delta_bytes > 0 && elapsed_since_last > 0.0 {
        delta_bytes as f64 / elapsed_since_last
    } else {
        task.stats.speed
    };

    task.stats.downloaded_bytes = progress.downloaded_bytes;
    task.stats.total_bytes = progress.total_bytes;
    task.stats.speed = fallback_speed;
    task.stats.eta = progress.eta;
    task.stats.progress = progress
        .progress
        .or_else(|| {
            progress
                .total_bytes
                .map(|total| progress.downloaded_bytes as f64 / total as f64)
        })
        .unwrap_or(0.0)
        .clamp(0.0, 0.999);
    task.stats.status_hint = progress.status_hint.clone();
    task.stats.last_update = now;
    task.stats.start_time = now - chrono::Duration::from_std(started.elapsed()).unwrap_or_default();
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
    let line = normalize_progress_line(line);
    parse_template_progress_line(&line)
        .or_else(|| parse_template_progress_line(&format!("download:{line}")))
        .or_else(|| parse_classic_progress_line(&line))
}

fn parse_template_progress_line(line: &str) -> Option<ParsedYtDlpProgress> {
    let marker = "download:";
    let marker_start = line.find(marker)?;
    let payload = &line[marker_start + marker.len()..];
    let parts: Vec<&str> = payload.split('\t').collect();
    if parts.len() < 5 {
        return None;
    }

    let downloaded_bytes = parse_u64(parts[0])?;
    let total_bytes = if parts.len() >= 7 {
        parse_u64(parts[1]).or_else(|| parse_u64(parts[2]))
    } else {
        parse_u64(parts[1])
    };
    let speed_index = if parts.len() >= 7 { 3 } else { 2 };
    let eta_index = if parts.len() >= 7 { 4 } else { 3 };
    let percent_index = if parts.len() >= 7 { Some(5) } else { None };
    let status_index = if parts.len() >= 7 { 6 } else { 4 };
    let speed = parse_f64(parts[speed_index]).unwrap_or(0.0);
    let eta = parse_u64(parts[eta_index]);
    let progress = percent_index
        .and_then(|index| parse_percent(parts[index]))
        .or_else(|| {
            total_bytes
                .filter(|total| *total > 0)
                .map(|total| downloaded_bytes as f64 / total as f64)
        });
    let status_hint = if parts[status_index].contains("finished")
        || parts[status_index].contains("post_process")
    {
        Some(TaskStatus::Committing)
    } else {
        None
    };
    Some(ParsedYtDlpProgress {
        downloaded_bytes,
        total_bytes,
        speed,
        eta,
        progress,
        status_hint,
    })
}

fn parse_classic_progress_line(line: &str) -> Option<ParsedYtDlpProgress> {
    if !line.contains("[download]") {
        return None;
    }

    let re = regex::Regex::new(
        r"(?i)\[download\]\s+(?P<percent>\d+(?:\.\d+)?)%\s+of\s+~?\s*(?P<total>\d+(?:\.\d+)?)\s*(?P<unit>[kmgtp]?i?b)(?:\s+at\s+(?P<speed>\d+(?:\.\d+)?)\s*(?P<speed_unit>[kmgtp]?i?b)/s)?(?:\s+ETA\s+(?P<eta>\d{1,2}:\d{2}(?::\d{2})?))?",
    )
    .ok()?;
    let captures = re.captures(line)?;
    let percent = parse_f64(captures.name("percent")?.as_str())?;
    let progress = (percent / 100.0).clamp(0.0, 1.0);
    let total_bytes = parse_byte_size(
        captures.name("total")?.as_str(),
        captures.name("unit")?.as_str(),
    );
    let downloaded_bytes = total_bytes
        .map(|total| ((total as f64) * progress).round() as u64)
        .unwrap_or(0);
    let speed = captures
        .name("speed")
        .zip(captures.name("speed_unit"))
        .and_then(|(value, unit)| parse_byte_size(value.as_str(), unit.as_str()))
        .map(|speed| speed as f64)
        .unwrap_or(0.0);
    let eta = captures
        .name("eta")
        .and_then(|eta| parse_eta_seconds(eta.as_str()));
    let status_hint = if progress >= 1.0 {
        Some(TaskStatus::Committing)
    } else {
        None
    };

    Some(ParsedYtDlpProgress {
        downloaded_bytes,
        total_bytes,
        speed,
        eta,
        progress: Some(progress),
        status_hint,
    })
}

fn normalize_progress_line(line: &str) -> String {
    let mut normalized = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }

        if ch != '\r' {
            normalized.push(ch);
        }
    }

    normalized.trim().to_string()
}

fn parse_byte_size(value: &str, unit: &str) -> Option<u64> {
    let value = parse_f64(value)?;
    let multiplier = match unit.trim().to_ascii_lowercase().as_str() {
        "b" => 1.0,
        "kb" => 1_000.0,
        "kib" => 1_024.0,
        "mb" => 1_000_000.0,
        "mib" => 1_048_576.0,
        "gb" => 1_000_000_000.0,
        "gib" => 1_073_741_824.0,
        "tb" => 1_000_000_000_000.0,
        "tib" => 1_099_511_627_776.0,
        "pb" => 1_000_000_000_000_000.0,
        "pib" => 1_125_899_906_842_624.0,
        _ => return None,
    };

    Some((value * multiplier).round() as u64)
}

fn parse_eta_seconds(value: &str) -> Option<u64> {
    let parts: Vec<u64> = value
        .split(':')
        .map(str::parse::<u64>)
        .collect::<Result<_, _>>()
        .ok()?;

    match parts.as_slice() {
        [minutes, seconds] => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600 + minutes * 60 + seconds),
        _ => None,
    }
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

pub fn build_probe_args(url: &str, js_runtime_path: Option<&Path>) -> Vec<String> {
    let mut args = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--dump-single-json".into(),
    ];
    append_js_runtime_args(&mut args, js_runtime_path);
    args.push(url.into());
    args
}

pub fn build_download_args(
    url: &str,
    output_dir: &Path,
    output_template: &str,
    ffmpeg_path: Option<&Path>,
    js_runtime_path: Option<&Path>,
) -> Vec<String> {
    let mut args = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--progress".into(),
        "--format".into(),
        "bv*+ba/b".into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "--paths".into(),
        output_dir.to_string_lossy().to_string(),
        "--output".into(),
        output_template.into(),
        "--progress-template".into(),
        "download:download:%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s\t%(progress._percent_str)s\t%(progress.status)s".into(),
        "--print".into(),
        "after_move:filepath:%(filepath)s".into(),
    ];
    if let Some(path) = ffmpeg_path {
        args.push("--ffmpeg-location".into());
        args.push(path.to_string_lossy().to_string());
    }
    append_js_runtime_args(&mut args, js_runtime_path);
    args.push(url.into());
    args
}

fn append_js_runtime_args(args: &mut Vec<String>, js_runtime_path: Option<&Path>) {
    if let Some(path) = js_runtime_path {
        args.push("--js-runtimes".into());
        args.push(format!("deno:{}", path.to_string_lossy()));
    }
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
    } else if normalized.contains("no supported javascript runtime")
        || normalized.contains("--js-runtimes")
        || normalized.contains("youtube extraction without a js runtime")
    {
        "js_runtime_missing: YouTube extraction requires the bundled Deno JavaScript runtime".into()
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

fn parse_percent(value: &str) -> Option<f64> {
    let trimmed = value.trim().trim_end_matches('%').trim();
    let percent = parse_f64(trimmed)?;
    Some((percent / 100.0).clamp(0.0, 0.999))
}
