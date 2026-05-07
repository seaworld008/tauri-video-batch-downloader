//! Generic yt-dlp provider for public social/video webpages.

use anyhow::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Instant;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Duration};

use crate::core::downloader::{DownloadStats, DownloadTask};
use crate::core::models::{ExternalVideoInfo, SourcePlatform};
use crate::core::ytdlp_support::{
    build_download_args, build_probe_args, classify_error, detect_platform, emit_committing,
    emit_progress, env_path, exe_name, external_info_from_json, sanitize_filename, sidecar_path,
    spawn_line_reader,
};
pub use crate::core::ytdlp_support::{parse_progress_line, YtDlpDownloaderConfig};

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
        build_probe_args(url)
    }

    pub fn build_download_args(
        url: &str,
        output_dir: &Path,
        output_template: &str,
        ffmpeg_path: Option<&Path>,
    ) -> Vec<String> {
        build_download_args(url, output_dir, output_template, ffmpeg_path)
    }

    pub async fn probe_video_info(&self, url: &str) -> Result<ExternalVideoInfo> {
        crate::utils::validation::assert_http_url(url)?;
        let tool = self.resolve_ytdlp_command();
        let output = Command::new(&tool)
            .args(Self::build_probe_args(url))
            .output()
            .await;
        let output = match output {
            Ok(output) => output,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(anyhow::anyhow!("external_tool_missing: yt-dlp not found"));
            }
            Err(err) => return Err(anyhow::anyhow!("external_tool_failed: {}", err)),
        };
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!(classify_error(&stderr)));
        }
        let json: Value = serde_json::from_slice(&output.stdout)
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
        tokio::fs::create_dir_all(&task.output_path).await?;

        let safe_name = sanitize_filename(
            Path::new(&task.filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("video"),
        );
        let args = Self::build_download_args(
            &task.url,
            Path::new(&task.output_path),
            &format!("{}.%(ext)s", safe_name),
            Some(&ffmpeg),
        );

        let mut child = Command::new(&ytdlp)
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
        let mut handle_line = |line: String, task: &mut DownloadTask| {
            if let Some(path) = line.strip_prefix("filepath:") {
                final_path = Some(PathBuf::from(path.trim()));
            } else if let Some(progress) = parse_progress_line(&line) {
                emit_progress(task, &progress, started, progress_tx.as_ref());
            } else if !line.trim().is_empty() {
                stderr.push_str(&line);
                stderr.push('\n');
            }
        };
        let exit_status = loop {
            tokio::select! {
                maybe_line = line_rx.recv() => {
                    if let Some(line) = maybe_line {
                        handle_line(line, task);
                    }
                }
                status = child.wait() => {
                    let status = status?;
                    break status;
                }
                _ = sleep(Duration::from_millis(150)) => {
                    if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                        let _ = child.kill().await;
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
            handle_line(line, task);
        }
        while let Ok(Some(line)) = timeout(Duration::from_secs(1), line_rx.recv()).await {
            handle_line(line, task);
        }

        if !exit_status.success() {
            return Err(anyhow::anyhow!(classify_error(&stderr)));
        }

        let final_path =
            final_path.unwrap_or_else(|| Path::new(&task.output_path).join(&task.filename));
        if !final_path.exists() {
            return Err(anyhow::anyhow!(
                "external_tool_failed: yt-dlp exited without final file"
            ));
        }
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
            .unwrap_or_else(|| PathBuf::from(exe_name("yt-dlp")))
    }

    async fn resolve_ffmpeg_command(&self) -> Result<PathBuf> {
        let path = self
            .config
            .ffmpeg_path
            .clone()
            .or_else(|| env_path("VDP_FFMPEG_PATH"))
            .or_else(|| sidecar_path("ffmpeg"))
            .unwrap_or_else(|| PathBuf::from(exe_name("ffmpeg")));
        match Command::new(&path).arg("-version").output().await {
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
