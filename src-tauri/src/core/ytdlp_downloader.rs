//! Generic yt-dlp provider for public social/video webpages.

use anyhow::Result;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Instant;
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tokio::time::{interval, timeout, Duration};

use crate::core::downloader::{DownloadStats, DownloadTask};
use crate::core::models::{ExternalVideoInfo, SourcePlatform};
use crate::core::ytdlp_support::{
    build_download_args, build_probe_args, classify_error, detect_platform, emit_committing,
    emit_progress, env_path, external_info_from_json, sanitize_filename, sidecar_path,
    spawn_line_reader,
};
pub use crate::core::ytdlp_support::{parse_progress_line, YtDlpDownloaderConfig};
use crate::utils::process::hidden_command;

const PROBE_VIDEO_INFO_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone)]
pub struct YtDlpDownloader {
    config: YtDlpDownloaderConfig,
}

impl YtDlpDownloader {
    pub fn new(config: YtDlpDownloaderConfig) -> Self {
        Self { config }
    }

    pub fn default_with_user_agent(user_agent: String) -> Self {
        Self::new(YtDlpDownloaderConfig {
            user_agent,
            ..YtDlpDownloaderConfig::default()
        })
    }

    pub fn detect_platform(url: &str) -> SourcePlatform {
        detect_platform(url)
    }

    pub fn build_probe_args(url: &str) -> Vec<String> {
        build_probe_args(url, None)
    }

    pub fn build_download_args(
        url: &str,
        output_dir: &Path,
        output_template: &str,
        ffmpeg_path: Option<&Path>,
    ) -> Vec<String> {
        build_download_args(url, output_dir, output_template, ffmpeg_path, None)
    }

    pub async fn probe_video_info(&self, url: &str) -> Result<ExternalVideoInfo> {
        self.probe_video_info_with_timeout(url, PROBE_VIDEO_INFO_TIMEOUT)
            .await
    }

    pub(crate) async fn probe_video_info_with_timeout(
        &self,
        url: &str,
        probe_timeout: Duration,
    ) -> Result<ExternalVideoInfo> {
        crate::utils::validation::assert_http_url(url)?;
        let tool = self.resolve_ytdlp_command();
        let js_runtime = self.resolve_deno_command();
        let mut command = hidden_command(&tool);
        #[cfg(unix)]
        {
            command.process_group(0);
        }
        command
            .args(build_probe_args(url, js_runtime.as_deref()))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                anyhow::anyhow!("external_tool_missing: yt-dlp not found")
            } else {
                anyhow::anyhow!("external_tool_failed: {}", err)
            }
        })?;
        let mut stdout = child.stdout.take().expect("probe stdout pipe");
        let mut stderr = child.stderr.take().expect("probe stderr pipe");
        let stdout_task = tokio::spawn(async move {
            let mut buffer = Vec::new();
            stdout.read_to_end(&mut buffer).await.map(|_| buffer)
        });
        let stderr_task = tokio::spawn(async move {
            let mut buffer = Vec::new();
            stderr.read_to_end(&mut buffer).await.map(|_| buffer)
        });

        let exit_status = match timeout(probe_timeout, child.wait()).await {
            Err(_) => {
                terminate_external_child(&mut child).await;
                stdout_task.abort();
                stderr_task.abort();
                return Err(anyhow::anyhow!(
                    "probe_timeout: yt-dlp video info probe timed out"
                ));
            }
            Ok(Ok(status)) => status,
            Ok(Err(err)) => return Err(anyhow::anyhow!("external_tool_failed: {}", err)),
        };
        let stdout = stdout_task
            .await
            .map_err(|err| anyhow::anyhow!("external_tool_failed: {}", err))?
            .map_err(|err| anyhow::anyhow!("external_tool_failed: {}", err))?;
        let stderr = stderr_task
            .await
            .map_err(|err| anyhow::anyhow!("external_tool_failed: {}", err))?
            .map_err(|err| anyhow::anyhow!("external_tool_failed: {}", err))?;

        if !exit_status.success() {
            let stderr = String::from_utf8_lossy(&stderr);
            return Err(anyhow::anyhow!(classify_error(&stderr)));
        }
        let json: Value = serde_json::from_slice(&stdout)
            .map_err(|err| anyhow::anyhow!("json_parse_failed: {}", err))?;
        Ok(Self::external_info_from_json(&json, url))
    }

    pub async fn download(
        &self,
        task: &mut DownloadTask,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        progress_tx: Option<mpsc::UnboundedSender<(String, DownloadStats)>>,
    ) -> Result<()> {
        let ytdlp = self.resolve_ytdlp_command();
        let ffmpeg = self.resolve_ffmpeg_command().await?;
        let js_runtime = self.resolve_deno_command();
        tokio::fs::create_dir_all(&task.output_path).await?;

        let safe_name = sanitize_filename(
            Path::new(&task.filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("video"),
        );
        let use_extractor_title_template = should_use_extractor_title_template(&safe_name);
        let output_template = if use_extractor_title_template {
            "%(title).200B.%(ext)s".to_string()
        } else {
            format!("{}.%(ext)s", safe_name)
        };
        let args = build_download_args(
            &task.url,
            Path::new(&task.output_path),
            &output_template,
            Some(&ffmpeg),
            js_runtime.as_deref(),
        );

        let mut command = hidden_command(&ytdlp);
        #[cfg(unix)]
        {
            command.process_group(0);
        }
        let mut child = command
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| {
                if err.kind() == std::io::ErrorKind::NotFound {
                    anyhow::anyhow!("external_tool_missing: yt-dlp not found")
                } else {
                    anyhow::anyhow!("external_tool_failed: {}", err)
                }
            })?;

        let (line_tx, mut line_rx) = mpsc::unbounded_channel::<String>();
        spawn_line_reader(child.stdout.take(), line_tx.clone());
        spawn_line_reader(child.stderr.take(), line_tx);

        let started = Instant::now();
        let mut stderr = String::new();
        let mut final_path: Option<PathBuf> = None;
        let mut partial_name_prefix = (!use_extractor_title_template).then(|| safe_name.clone());
        let mut progress_tick = interval(Duration::from_millis(150));
        progress_tick.tick().await;
        let mut output_closed = false;
        let exit_status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }

            tokio::select! {
                maybe_line = line_rx.recv(), if !output_closed => {
                    if let Some(line) = maybe_line {
                        handle_ytdlp_line(
                            line,
                            task,
                            started,
                            progress_tx.as_ref(),
                            &mut final_path,
                            &mut partial_name_prefix,
                            &mut stderr,
                        );
                    } else {
                        output_closed = true;
                    }
                }
                _ = progress_tick.tick() => {
                    if let Some(prefix) = partial_name_prefix.as_deref() {
                        emit_filesystem_progress(task, prefix, started, progress_tx.as_ref());
                    }
                    if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                        terminate_external_child(&mut child).await;
                        return Err(if cancel_flag.load(Ordering::Relaxed) {
                            anyhow::anyhow!("download_cancelled")
                        } else {
                            anyhow::anyhow!("download_paused")
                        });
                    }
                }
            }
        };
        while let Ok(line) = line_rx.try_recv() {
            handle_ytdlp_line(
                line,
                task,
                started,
                progress_tx.as_ref(),
                &mut final_path,
                &mut partial_name_prefix,
                &mut stderr,
            );
        }
        while let Ok(Some(line)) = timeout(Duration::from_secs(1), line_rx.recv()).await {
            handle_ytdlp_line(
                line,
                task,
                started,
                progress_tx.as_ref(),
                &mut final_path,
                &mut partial_name_prefix,
                &mut stderr,
            );
        }

        if !exit_status.success() {
            return Err(anyhow::anyhow!(classify_error(&stderr)));
        }

        let expected_path = Path::new(&task.output_path).join(&task.filename);
        let final_path = final_path
            .filter(|path| path.exists())
            .or_else(|| discover_output_file(Path::new(&task.output_path), &safe_name))
            .or_else(|| {
                use_extractor_title_template
                    .then(|| discover_latest_output_file(Path::new(&task.output_path)))?
            })
            .or_else(|| expected_path.exists().then_some(expected_path));
        let Some(final_path) = final_path else {
            return Err(anyhow::anyhow!(
                "external_tool_failed: yt-dlp exited without final file"
            ));
        };
        if let Some(parent) = final_path.parent() {
            task.output_path = parent.to_string_lossy().to_string();
        }
        if let Some(name) = final_path.file_name().and_then(|name| name.to_str()) {
            task.filename = name.to_string();
        }
        emit_committing(task, progress_tx.as_ref());
        Ok(())
    }

    pub fn external_info_from_json(json: &Value, original_url: &str) -> ExternalVideoInfo {
        external_info_from_json(json, original_url)
    }

    pub fn classify_error(message: &str) -> String {
        classify_error(message)
    }

    fn resolve_ytdlp_command(&self) -> PathBuf {
        self.config
            .yt_dlp_path
            .clone()
            .or_else(|| env_path("VDP_YTDLP_PATH"))
            .or_else(|| sidecar_path("yt-dlp"))
            .unwrap_or_else(|| PathBuf::from(crate::core::ytdlp_support::exe_name("yt-dlp")))
    }

    fn resolve_deno_command(&self) -> Option<PathBuf> {
        self.config
            .deno_path
            .clone()
            .or_else(|| env_path("VDP_DENO_PATH"))
            .or_else(|| sidecar_path("deno"))
            .filter(|path| path.exists())
    }

    async fn resolve_ffmpeg_command(&self) -> Result<PathBuf> {
        let path = self
            .config
            .ffmpeg_path
            .clone()
            .or_else(|| env_path("VDP_FFMPEG_PATH"))
            .or_else(|| sidecar_path("ffmpeg"))
            .unwrap_or_else(|| PathBuf::from(crate::core::ytdlp_support::exe_name("ffmpeg")));
        match hidden_command(&path).arg("-version").output().await {
            Ok(output) if output.status.success() => Ok(path),
            Ok(_) => Err(anyhow::anyhow!(
                "ffmpeg_missing: ffmpeg version check failed"
            )),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                Err(anyhow::anyhow!("ffmpeg_missing: ffmpeg not found"))
            }
            Err(err) => Err(anyhow::anyhow!("external_tool_failed: {}", err)),
        }
    }
}

fn should_use_extractor_title_template(safe_name: &str) -> bool {
    let normalized = safe_name.trim();
    normalized.starts_with("任务_") || normalized.starts_with("任务-")
}

fn discover_output_file(output_dir: &Path, safe_name: &str) -> Option<PathBuf> {
    let prefix = format!("{safe_name}.");
    let mut matches = std::fs::read_dir(output_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let file_name = path.file_name()?.to_string_lossy();
            if file_name == safe_name || file_name.starts_with(&prefix) {
                let ignored = [".part", ".ytdl", ".tmp", ".temp"];
                if ignored.iter().any(|suffix| file_name.ends_with(suffix)) {
                    return None;
                }
                return Some((path, metadata.modified().ok()));
            }
            None
        })
        .collect::<Vec<_>>();

    matches.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    matches.into_iter().map(|(path, _)| path).next()
}

fn discover_latest_output_file(output_dir: &Path) -> Option<PathBuf> {
    let mut matches = std::fs::read_dir(output_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let file_name = path.file_name()?.to_string_lossy();
            let ignored = [".part", ".ytdl", ".tmp", ".temp", ".vdstate"];
            if ignored.iter().any(|suffix| file_name.ends_with(suffix)) {
                return None;
            }
            Some((path, metadata.modified().ok()))
        })
        .collect::<Vec<_>>();

    matches.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    matches.into_iter().map(|(path, _)| path).next()
}

fn handle_ytdlp_line(
    line: String,
    task: &mut DownloadTask,
    started: Instant,
    progress_tx: Option<&mpsc::UnboundedSender<(String, DownloadStats)>>,
    final_path: &mut Option<PathBuf>,
    partial_name_prefix: &mut Option<String>,
    stderr: &mut String,
) {
    if let Some(path_start) = line.find("filepath:") {
        let path = &line[path_start + "filepath:".len()..];
        *final_path = Some(PathBuf::from(path.trim()));
    } else if let Some(destination) = parse_destination_line(&line) {
        if let Some(file_name) = destination.file_name().and_then(|name| name.to_str()) {
            *partial_name_prefix = Some(file_name.to_string());
        }
    } else if let Some(total_bytes) = parse_filesize_line(&line) {
        emit_progress(
            task,
            &crate::core::ytdlp_support::ParsedYtDlpProgress {
                downloaded_bytes: task.stats.downloaded_bytes,
                total_bytes: Some(total_bytes),
                speed: task.stats.speed,
                eta: task.stats.eta,
                progress: (task.stats.downloaded_bytes > 0)
                    .then_some(task.stats.downloaded_bytes as f64 / total_bytes as f64),
                status_hint: None,
            },
            started,
            progress_tx,
        );
    } else if let Some(progress) = parse_progress_line(&line) {
        emit_progress(task, &progress, started, progress_tx);
    } else if !line.trim().is_empty() {
        stderr.push_str(&line);
        stderr.push('\n');
    }
}

fn parse_filesize_line(line: &str) -> Option<u64> {
    let payload = line.trim().strip_prefix("filesize:")?;
    payload.split('\t').find_map(parse_size_field)
}

fn parse_destination_line(line: &str) -> Option<PathBuf> {
    let (_, raw_path) = line.split_once("Destination:")?;
    let path = raw_path.trim().trim_matches('"');
    (!path.is_empty()).then(|| PathBuf::from(path))
}

fn parse_size_field(value: &str) -> Option<u64> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("NA") {
        return None;
    }
    value.parse::<u64>().ok().filter(|size| *size > 0)
}

fn emit_filesystem_progress(
    task: &mut DownloadTask,
    safe_name: &str,
    started: Instant,
    progress_tx: Option<&mpsc::UnboundedSender<(String, DownloadStats)>>,
) {
    let Some(downloaded_bytes) =
        discover_partial_download_size(Path::new(&task.output_path), safe_name)
    else {
        return;
    };

    if downloaded_bytes <= task.stats.downloaded_bytes {
        return;
    }

    let total_bytes = task.stats.total_bytes;
    emit_progress(
        task,
        &crate::core::ytdlp_support::ParsedYtDlpProgress {
            downloaded_bytes,
            total_bytes,
            speed: 0.0,
            eta: None,
            progress: total_bytes.map(|total| downloaded_bytes as f64 / total as f64),
            status_hint: None,
        },
        started,
        progress_tx,
    );
}

fn discover_partial_download_size(output_dir: &Path, safe_name: &str) -> Option<u64> {
    fs::read_dir(output_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name();
            let file_name = file_name.to_str()?;
            if !file_name.starts_with(safe_name) || !file_name.ends_with(".part") {
                return None;
            }
            entry.metadata().ok().map(|metadata| metadata.len())
        })
        .max()
}

async fn terminate_external_child(child: &mut tokio::process::Child) {
    let Some(pid) = child.id() else {
        let _ = child.kill().await;
        return;
    };

    #[cfg(windows)]
    {
        let _ = hidden_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .await;
    }

    #[cfg(unix)]
    {
        terminate_child_tree(pid, "-TERM").await;
        if timeout(Duration::from_secs(2), child.wait()).await.is_ok() {
            return;
        }
        terminate_child_tree(pid, "-KILL").await;
    }

    let _ = child.kill().await;
}

#[cfg(unix)]
async fn terminate_child_tree(root_pid: u32, signal: &str) {
    let mut stack = child_pids(root_pid).await;
    let mut descendants = Vec::new();
    while let Some(pid) = stack.pop() {
        stack.extend(child_pids(pid).await);
        descendants.push(pid);
    }
    for pid in descendants.into_iter().rev() {
        let _ = hidden_command("kill")
            .args([signal, &pid.to_string()])
            .output()
            .await;
    }
}

#[cfg(unix)]
async fn child_pids(pid: u32) -> Vec<u32> {
    let output = hidden_command("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
        .await;
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}
