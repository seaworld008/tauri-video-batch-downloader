//! Headless Companion CLI (`vdpro-cli`) sharing Video Downloader Pro's Rust core.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use tokio::sync::Semaphore;

use crate::core::download_provider::{ContentMetadata, DownloadProviderRouter};
use crate::core::downloader::{DownloadTask, DownloaderConfig, HttpDownloader};
use crate::core::external_tools::status_for_all;
use crate::core::file_parser::FileParser;
use crate::core::models::{TaskRequestOptions, TaskStatus};
use crate::core::ytdlp_downloader::YtDlpDownloader;
use crate::utils::file_utils::sanitize_filename;
use crate::utils::validation::assert_http_url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadCliArgs {
    pub urls: Vec<String>,
    pub input_files: Vec<PathBuf>,
    pub output_dir: PathBuf,
    pub concurrent: usize,
    pub headers: HashMap<String, String>,
    pub cookies: Option<String>,
    pub cookies_from_browser: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
    pub proxy: Option<String>,
    pub format_selector: Option<String>,
    pub preferred_language: Option<String>,
    pub output_container: Option<String>,
    pub rate_limit_bps: Option<u64>,
    pub json: bool,
}

impl Default for DownloadCliArgs {
    fn default() -> Self {
        Self {
            urls: Vec::new(),
            input_files: Vec::new(),
            output_dir: PathBuf::from("./downloads"),
            concurrent: 3,
            headers: HashMap::new(),
            cookies: None,
            cookies_from_browser: None,
            referer: None,
            user_agent: None,
            proxy: None,
            format_selector: None,
            preferred_language: None,
            output_container: None,
            rate_limit_bps: None,
            json: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeCliArgs {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub proxy: Option<String>,
    pub json: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Help,
    Version,
    Download(Box<DownloadCliArgs>),
    Probe(ProbeCliArgs),
    Doctor { json: bool },
}

#[derive(Debug, Clone)]
struct CliInputItem {
    url: String,
    preferred_title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadTaskOutcome {
    url: String,
    output_file: String,
    status: String,
    downloaded_bytes: u64,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProbeOutcome {
    url: String,
    platform: String,
    initial_provider: String,
    resolved_provider: Option<String>,
    http_status: Option<u16>,
    content_length: Option<u64>,
    content_type: Option<String>,
}

pub fn help_text() -> String {
    format!(
        "Video Downloader Pro CLI (vdpro-cli) v{version}\n\
         \n\
         USAGE:\n\
         \x20 vdpro-cli download [OPTIONS] [URL...]\n\
         \x20 vdpro-cli probe [OPTIONS] <URL>\n\
         \x20 vdpro-cli doctor [--json]\n\
         \x20 vdpro-cli --help | --version\n\
         \n\
         DOWNLOAD OPTIONS:\n\
         \x20 -o, --output <DIR>                Output directory (default: ./downloads)\n\
         \x20 -f, --file <PATH>                 Import URLs from .txt, .csv, or .xlsx/.xls (repeatable)\n\
         \x20 -c, --concurrent <N>              Max concurrent downloads, 1..=16 (default: 3)\n\
         \x20 --header \"Key: Value\"             Custom HTTP header (repeatable)\n\
         \x20 --cookie <COOKIE>                 Cookie header string\n\
         \x20 --cookies-from-browser <SPEC>     Browser cookies spec for yt-dlp (e.g. chrome)\n\
         \x20 --referer <URL>                   Referer header URL\n\
         \x20 --user-agent <UA>                 Override User-Agent string\n\
         \x20 --proxy <URL>                     Proxy URL (http/https/socks5/socks5h)\n\
         \x20 --format <SELECTOR>               Quality preset/selector (best, 1080p, 720p, audio, etc.)\n\
         \x20 --lang <LANG>                     Preferred audio/subtitle language\n\
         \x20 --container <EXT>                 Target container (mp4, mkv, webm, mov, m4a, mp3, opus)\n\
         \x20 --rate-limit <RATE>               Bandwidth cap (e.g. 512K, 2M, 1048576)\n\
         \x20 --json                            Emit machine-readable JSON output\n",
        version = crate::VERSION
    )
}

pub fn parse_rate_limit(raw: &str) -> Result<u64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        bail!("--rate-limit cannot be empty");
    }

    let split_idx = trimmed
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(trimmed.len());
    let (digits, unit) = trimmed.split_at(split_idx);
    if digits.is_empty() {
        bail!("Invalid --rate-limit value: {}", raw);
    }

    let base: u64 = digits
        .parse()
        .with_context(|| format!("Invalid numeric rate limit: {}", raw))?;

    let multiplier: u64 = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "k" | "kb" => 1024,
        "m" | "mb" => 1024 * 1024,
        "g" | "gb" => 1024 * 1024 * 1024,
        other => bail!(
            "Unsupported rate-limit unit '{}': use B, K/KB, M/MB, or G/GB",
            other
        ),
    };

    let bytes = base
        .checked_mul(multiplier)
        .ok_or_else(|| anyhow!("Rate-limit overflows u64: {}", raw))?;
    if bytes == 0 {
        bail!("--rate-limit must be greater than 0");
    }
    Ok(bytes)
}

fn parse_header_pair(raw: &str) -> Result<(String, String)> {
    if raw.contains('\r') || raw.contains('\n') || raw.contains('\0') {
        bail!("HTTP header contains illegal control characters");
    }
    let Some((key, value)) = raw.split_once(':') else {
        bail!("Invalid --header '{}': expected \"Key: Value\"", raw);
    };
    let key = key.trim();
    let value = value.trim();
    if key.is_empty() || value.is_empty() {
        bail!("Invalid --header '{}': key and value cannot be empty", raw);
    }
    Ok((key.to_string(), value.to_string()))
}

fn next_flag_value<I>(iter: &mut std::iter::Peekable<I>, flag: &str) -> Result<String>
where
    I: Iterator<Item = String>,
{
    iter.next()
        .ok_or_else(|| anyhow!("Flag {} requires a value", flag))
}

pub fn parse_cli_args<I, S>(args: I) -> Result<CliCommand>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let raw_args: Vec<String> = args.into_iter().map(Into::into).collect();
    if raw_args.is_empty() {
        return Ok(CliCommand::Help);
    }

    let first = raw_args[0].as_str();
    match first {
        "-h" | "--help" | "help" => return Ok(CliCommand::Help),
        "-V" | "--version" | "version" => return Ok(CliCommand::Version),
        "doctor" => {
            let mut json = false;
            for arg in raw_args.iter().skip(1) {
                match arg.as_str() {
                    "--json" => json = true,
                    "-h" | "--help" => return Ok(CliCommand::Help),
                    other => bail!("Unknown doctor flag: {}", other),
                }
            }
            return Ok(CliCommand::Doctor { json });
        }
        "probe" => {
            let mut probe = ProbeCliArgs {
                url: String::new(),
                headers: HashMap::new(),
                proxy: None,
                json: false,
            };
            let mut iter = raw_args.into_iter().skip(1).peekable();
            while let Some(arg) = iter.next() {
                match arg.as_str() {
                    "-h" | "--help" => return Ok(CliCommand::Help),
                    "--json" => probe.json = true,
                    "--proxy" => probe.proxy = Some(next_flag_value(&mut iter, "--proxy")?),
                    "--header" => {
                        let raw = next_flag_value(&mut iter, "--header")?;
                        let (k, v) = parse_header_pair(&raw)?;
                        probe.headers.insert(k, v);
                    }
                    "--" => {
                        let rest: Vec<String> = iter.collect();
                        if rest.len() != 1 || !probe.url.is_empty() {
                            bail!("probe requires exactly one <URL>");
                        }
                        probe.url = rest.into_iter().next().unwrap_or_default();
                        break;
                    }
                    other if other.starts_with('-') => bail!("Unknown probe option: {}", other),
                    url if probe.url.is_empty() => probe.url = url.to_string(),
                    extra => bail!("Unexpected extra argument for probe: {}", extra),
                }
            }
            if probe.url.is_empty() {
                bail!("probe requires a <URL>");
            }
            assert_http_url(&probe.url)?;
            return Ok(CliCommand::Probe(probe));
        }
        _ => {}
    }

    let skip_subcommand = usize::from(first == "download");
    let mut dl = DownloadCliArgs::default();
    let mut iter = raw_args.into_iter().skip(skip_subcommand).peekable();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(CliCommand::Help),
            "-V" | "--version" => return Ok(CliCommand::Version),
            "-o" | "--output" => {
                dl.output_dir = PathBuf::from(next_flag_value(&mut iter, &arg)?);
            }
            "-f" | "--file" => {
                dl.input_files
                    .push(PathBuf::from(next_flag_value(&mut iter, &arg)?));
            }
            "-c" | "--concurrent" => {
                let raw = next_flag_value(&mut iter, &arg)?;
                let parsed: usize = raw
                    .parse()
                    .with_context(|| format!("Invalid concurrency '{}'", raw))?;
                if !(1..=16).contains(&parsed) {
                    bail!("--concurrent must be between 1 and 16 (got {})", parsed);
                }
                dl.concurrent = parsed;
            }
            "--header" => {
                let raw = next_flag_value(&mut iter, "--header")?;
                let (k, v) = parse_header_pair(&raw)?;
                dl.headers.insert(k, v);
            }
            "--cookie" => dl.cookies = Some(next_flag_value(&mut iter, "--cookie")?),
            "--cookies-from-browser" => {
                dl.cookies_from_browser =
                    Some(next_flag_value(&mut iter, "--cookies-from-browser")?)
            }
            "--referer" => dl.referer = Some(next_flag_value(&mut iter, "--referer")?),
            "--user-agent" => dl.user_agent = Some(next_flag_value(&mut iter, "--user-agent")?),
            "--proxy" => dl.proxy = Some(next_flag_value(&mut iter, "--proxy")?),
            "--format" => dl.format_selector = Some(next_flag_value(&mut iter, "--format")?),
            "--lang" => dl.preferred_language = Some(next_flag_value(&mut iter, "--lang")?),
            "--container" => dl.output_container = Some(next_flag_value(&mut iter, "--container")?),
            "--rate-limit" => {
                let raw = next_flag_value(&mut iter, "--rate-limit")?;
                dl.rate_limit_bps = Some(parse_rate_limit(&raw)?);
            }
            "--json" => dl.json = true,
            "--" => {
                for url in iter.by_ref() {
                    assert_http_url(&url)?;
                    dl.urls.push(url);
                }
            }
            other if other.starts_with('-') => bail!("Unknown option: {}", other),
            url => {
                assert_http_url(url)?;
                dl.urls.push(url.to_string());
            }
        }
    }

    if dl.urls.is_empty() && dl.input_files.is_empty() {
        bail!("Provide at least one <URL> or -f/--file batch list");
    }

    Ok(CliCommand::Download(Box::new(dl)))
}

async fn load_items_from_file(path: &Path) -> Result<Vec<CliInputItem>> {
    if !tokio::fs::try_exists(path).await? {
        bail!("Input file does not exist: {}", path.display());
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if matches!(ext.as_str(), "csv" | "xlsx" | "xls") {
        let parser = FileParser::new();
        let (records, _) = parser.parse_file(path).await?;
        let mut items = Vec::with_capacity(records.len());
        for record in records {
            let trimmed = record.video_url.trim();
            if trimmed.is_empty() {
                continue;
            }
            assert_http_url(trimmed)?;
            let preferred_title = (!record.course_name.trim().is_empty())
                .then(|| record.course_name.trim().to_string());
            items.push(CliInputItem {
                url: trimmed.to_string(),
                preferred_title,
            });
        }
        return Ok(items);
    }

    let content = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("Failed to read URL list file: {}", path.display()))?;
    let mut items = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim().trim_start_matches('\u{feff}');
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        assert_http_url(trimmed)?;
        items.push(CliInputItem {
            url: trimmed.to_string(),
            preferred_title: None,
        });
    }
    Ok(items)
}

fn infer_cli_filename(
    item: &CliInputItem,
    index: usize,
    output_container: Option<&str>,
    used_names: &mut HashSet<String>,
) -> String {
    let preferred_ext = output_container
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase());

    let url_leaf = url::Url::parse(&item.url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segs| segs.rfind(|s| !s.is_empty()).map(str::to_string))
        })
        .unwrap_or_default();

    let url_path = Path::new(&url_leaf);
    let url_ext = url_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !matches!(e.as_str(), "m3u8" | "mpd"));

    let raw_stem = item
        .preferred_title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            url_path
                .file_stem()
                .and_then(|s| s.to_str())
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| format!("video_{}", index + 1));

    let safe_stem = {
        let s = sanitize_filename(&raw_stem);
        if s.is_empty() {
            format!("video_{}", index + 1)
        } else {
            s
        }
    };
    let ext = preferred_ext
        .or(url_ext)
        .unwrap_or_else(|| "mp4".to_string());

    let mut candidate = format!("{safe_stem}.{ext}");
    let mut counter = 2usize;
    while !used_names.insert(candidate.to_ascii_lowercase()) {
        candidate = format!("{safe_stem}_{counter}.{ext}");
        counter += 1;
    }
    candidate
}

fn build_request_options(args: &DownloadCliArgs) -> Option<TaskRequestOptions> {
    if args.headers.is_empty()
        && args.cookies.is_none()
        && args.cookies_from_browser.is_none()
        && args.referer.is_none()
        && args.user_agent.is_none()
        && args.proxy.is_none()
        && args.format_selector.is_none()
        && args.preferred_language.is_none()
        && args.output_container.is_none()
    {
        return None;
    }

    Some(TaskRequestOptions {
        headers: args.headers.clone(),
        cookies: args.cookies.clone(),
        cookies_from_browser: args.cookies_from_browser.clone(),
        referer: args.referer.clone(),
        user_agent: args.user_agent.clone(),
        proxy: args.proxy.clone(),
        format_selector: args.format_selector.clone(),
        preferred_language: args.preferred_language.clone(),
        output_container: args.output_container.clone(),
    })
}

pub async fn run_cli(command: CliCommand) -> Result<i32> {
    match command {
        CliCommand::Help => {
            println!("{}", help_text());
            Ok(0)
        }
        CliCommand::Version => {
            println!("vdpro-cli {}", crate::VERSION);
            Ok(0)
        }
        CliCommand::Doctor { json } => {
            let statuses = status_for_all().await;
            if json {
                println!("{}", serde_json::to_string_pretty(&statuses)?);
            } else {
                for tool in &statuses {
                    let version = tool.current_version.as_deref().unwrap_or("-");
                    let path = tool.path.as_deref().unwrap_or("-");
                    println!(
                        "{:<10} {:<18} version={:<12} path={}",
                        tool.display_name,
                        format!("{:?}", tool.status),
                        version,
                        path
                    );
                }
            }
            Ok(0)
        }
        CliCommand::Probe(args) => run_probe(args).await,
        CliCommand::Download(args) => run_download(*args, true).await,
    }
}

async fn run_probe(args: ProbeCliArgs) -> Result<i32> {
    let router = DownloadProviderRouter::new(50 * 1024 * 1024);
    let initial = router.initial_decision(&args.url);
    let platform = YtDlpDownloader::detect_platform(&args.url);

    let config = DownloaderConfig {
        headers: args.headers.clone(),
        proxy: args.proxy.clone(),
        ..DownloaderConfig::default()
    };
    let downloader = HttpDownloader::new(config)?;
    let probe_task = DownloadTask::new(args.url.clone(), ".".to_string(), "probe.bin".to_string());
    let effective = downloader.effective_request_options(&probe_task);
    let client = downloader.build_client_for_request(&effective)?;

    let mut http_status = None;
    let mut content_length = None;
    let mut content_type = None;
    let mut resolved_provider = None;

    if let Ok(resp) = client.head(&args.url).send().await {
        http_status = Some(resp.status().as_u16());
        content_length = resp.content_length();
        content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(ToOwned::to_owned);
        let decision = router.after_head(
            &args.url,
            &ContentMetadata {
                content_length,
                content_type: content_type.clone(),
            },
        );
        resolved_provider = Some(format!("{decision:?}"));
    }

    let outcome = ProbeOutcome {
        url: args.url,
        platform: format!("{platform:?}"),
        initial_provider: format!("{initial:?}"),
        resolved_provider,
        http_status,
        content_length,
        content_type,
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&outcome)?);
    } else {
        println!("URL: {}", outcome.url);
        println!("Platform: {}", outcome.platform);
        println!("Initial Provider: {}", outcome.initial_provider);
        if let Some(ref resolved) = outcome.resolved_provider {
            println!("Resolved Provider: {}", resolved);
        }
        if let Some(status) = outcome.http_status {
            println!("HTTP Status: {}", status);
        }
        if let Some(len) = outcome.content_length {
            println!("Content-Length: {} bytes", len);
        }
        if let Some(ref ct) = outcome.content_type {
            println!("Content-Type: {}", ct);
        }
    }
    Ok(0)
}

async fn run_download(args: DownloadCliArgs, install_ctrl_c: bool) -> Result<i32> {
    let mut items: Vec<CliInputItem> = args
        .urls
        .iter()
        .map(|u| CliInputItem {
            url: u.clone(),
            preferred_title: None,
        })
        .collect();

    for file_path in &args.input_files {
        items.extend(load_items_from_file(file_path).await?);
    }

    if items.is_empty() {
        bail!("No valid download URLs found");
    }

    tokio::fs::create_dir_all(&args.output_dir).await?;

    let mut config = DownloaderConfig {
        max_concurrent: args.concurrent,
        headers: args.headers.clone(),
        proxy: args.proxy.clone(),
        ..DownloaderConfig::default()
    };
    if let Some(ref ua) = args.user_agent {
        config.user_agent = ua.clone();
    }

    let downloader = Arc::new(HttpDownloader::new(config)?);
    if let Some(limit) = args.rate_limit_bps {
        *downloader
            .bandwidth_controller()
            .limit_handle()
            .write()
            .await = Some(limit);
    }

    let shared_opts = build_request_options(&args);
    let output_dir_str = args.output_dir.to_string_lossy().to_string();
    let mut used_names = HashSet::new();
    let mut tasks = Vec::with_capacity(items.len());
    let mut task_ids = Vec::with_capacity(items.len());

    for (idx, item) in items.iter().enumerate() {
        let filename =
            infer_cli_filename(item, idx, args.output_container.as_deref(), &mut used_names);
        let mut task = DownloadTask::new(item.url.clone(), output_dir_str.clone(), filename);
        task.request_options = shared_opts.clone();
        task_ids.push(task.id.clone());
        tasks.push(task);
    }

    let ctrl_c_handle = install_ctrl_c.then(|| {
        let downloader_ref = Arc::clone(&downloader);
        let ids = task_ids.clone();
        tokio::spawn(async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                for id in ids {
                    let _ = downloader_ref.cancel_download(&id).await;
                }
            }
        })
    });

    let sem = Arc::new(Semaphore::new(args.concurrent.max(1)));
    let mut handles = Vec::with_capacity(tasks.len());
    for task in tasks {
        let sem = Arc::clone(&sem);
        let downloader = Arc::clone(&downloader);
        let out_dir = args.output_dir.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem
                .acquire()
                .await
                .map_err(|err| anyhow!("Failed to acquire download permit: {}", err))?;
            let url = task.url.clone();
            let full_out = out_dir.join(&task.filename).to_string_lossy().to_string();
            match downloader.download(task).await {
                Ok(finished) => Ok(DownloadTaskOutcome {
                    url: finished.url,
                    output_file: full_out,
                    status: format!("{:?}", finished.status),
                    downloaded_bytes: finished.stats.downloaded_bytes,
                    error: finished.error_message,
                }),
                Err(err) => Ok::<_, anyhow::Error>(DownloadTaskOutcome {
                    url,
                    output_file: full_out,
                    status: format!("{:?}", TaskStatus::Failed),
                    downloaded_bytes: 0,
                    error: Some(err.to_string()),
                }),
            }
        }));
    }

    let mut outcomes = Vec::with_capacity(handles.len());
    for handle in handles {
        outcomes.push(handle.await??);
    }

    if let Some(handle) = ctrl_c_handle {
        handle.abort();
    }

    let all_succeeded = outcomes
        .iter()
        .all(|o| o.status == format!("{:?}", TaskStatus::Completed));

    if args.json {
        println!("{}", serde_json::to_string_pretty(&outcomes)?);
    } else {
        for item in &outcomes {
            match &item.error {
                Some(err) => eprintln!(
                    "[{}] {} -> {} ({})",
                    item.status, item.url, item.output_file, err
                ),
                None => println!(
                    "[{}] {} -> {} ({} bytes)",
                    item.status, item.url, item.output_file, item.downloaded_bytes
                ),
            }
        }
    }

    Ok(i32::from(!all_succeeded))
}

pub async fn run_from_env() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match parse_cli_args(args) {
        Ok(cmd) => match run_cli(cmd).await {
            Ok(code) => code,
            Err(err) => {
                eprintln!("Error: {err}");
                1
            }
        },
        Err(err) => {
            eprintln!("Error: {err}\n\n{}", help_text());
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn parses_cli_subcommands_and_flags() {
        assert_eq!(parse_cli_args(["--help"]).unwrap(), CliCommand::Help);
        assert_eq!(parse_cli_args(["-V"]).unwrap(), CliCommand::Version);
        assert_eq!(
            parse_cli_args(["doctor", "--json"]).unwrap(),
            CliCommand::Doctor { json: true }
        );

        let cmd = parse_cli_args([
            "download",
            "-o",
            "/tmp/out",
            "-c",
            "4",
            "--proxy",
            "socks5://127.0.0.1:1080",
            "--header",
            "Referer: https://example.com/",
            "--format",
            "1080p",
            "--rate-limit",
            "2M",
            "--json",
            "https://example.com/video.mp4",
        ])
        .unwrap();

        match cmd {
            CliCommand::Download(dl) => {
                assert_eq!(dl.output_dir, PathBuf::from("/tmp/out"));
                assert_eq!(dl.concurrent, 4);
                assert_eq!(dl.proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
                assert_eq!(
                    dl.headers.get("Referer").map(String::as_str),
                    Some("https://example.com/")
                );
                assert_eq!(dl.format_selector.as_deref(), Some("1080p"));
                assert_eq!(dl.rate_limit_bps, Some(2 * 1024 * 1024));
                assert!(dl.json);
                assert_eq!(dl.urls, vec!["https://example.com/video.mp4"]);
            }
            other => panic!("unexpected command: {other:?}"),
        }

        assert!(parse_cli_args(["download", "--header", "NoColon"]).is_err());
        assert!(parse_cli_args(["download", "-c", "99", "https://example.com/a.mp4"]).is_err());
        assert!(parse_cli_args(["download", "ftp://example.com/a.mp4"]).is_err());
        assert!(parse_cli_args([
            "probe",
            "--proxy",
            "http://127.0.0.1:8080",
            "https://example.com/a.m3u8"
        ])
        .is_ok());
    }

    #[test]
    fn parses_human_rate_limits() {
        assert_eq!(parse_rate_limit("512").unwrap(), 512);
        assert_eq!(parse_rate_limit("100K").unwrap(), 100 * 1024);
        assert_eq!(parse_rate_limit("2M").unwrap(), 2 * 1024 * 1024);
        assert_eq!(parse_rate_limit("1GB").unwrap(), 1024 * 1024 * 1024);
        assert!(parse_rate_limit("0").is_err());
        assert!(parse_rate_limit("abc").is_err());
        assert!(parse_rate_limit("10TB").is_err());
    }

    #[tokio::test]
    async fn loads_batch_urls_from_txt_and_csv() {
        let dir = tempdir().expect("tempdir");

        let txt_path = dir.path().join("urls.txt");
        tokio::fs::write(
            &txt_path,
            "# comment\n\nhttps://example.com/one.mp4\nhttps://example.com/two.m3u8\n",
        )
        .await
        .expect("write txt");
        let txt_items = load_items_from_file(&txt_path).await.expect("load txt");
        assert_eq!(txt_items.len(), 2);
        assert_eq!(txt_items[0].url, "https://example.com/one.mp4");

        let csv_path = dir.path().join("courses.csv");
        tokio::fs::write(
            &csv_path,
            "title,url\nLesson One,https://example.com/lesson1.mp4\n",
        )
        .await
        .expect("write csv");
        let csv_items = load_items_from_file(&csv_path).await.expect("load csv");
        assert_eq!(csv_items.len(), 1);
        assert_eq!(csv_items[0].preferred_title.as_deref(), Some("Lesson One"));
        assert_eq!(csv_items[0].url, "https://example.com/lesson1.mp4");
    }

    #[tokio::test]
    async fn cli_download_fetches_http_file_into_output_dir() {
        let dir = tempdir().expect("tempdir");
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let body = b"CLI-VIDEO-PAYLOAD";

        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = socket.read(&mut buf).await;
                    let req = String::from_utf8_lossy(&buf);
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: video/mp4\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(header.as_bytes()).await;
                    if !req.starts_with("HEAD ") {
                        let _ = socket.write_all(body).await;
                    }
                    let _ = socket.shutdown().await;
                });
            }
        });

        let out_dir = dir.path().join("downloads");
        let code = run_download(
            DownloadCliArgs {
                urls: vec![format!("http://127.0.0.1:{}/sample.mp4", addr.port())],
                output_dir: out_dir.clone(),
                ..Default::default()
            },
            false,
        )
        .await
        .expect("cli download run");
        server.abort();

        assert_eq!(code, 0);
        let downloaded = tokio::fs::read(out_dir.join("sample.mp4"))
            .await
            .expect("read downloaded file");
        assert_eq!(downloaded, body);
    }
}
