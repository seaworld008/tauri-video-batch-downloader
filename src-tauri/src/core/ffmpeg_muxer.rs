use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

use crate::core::part_file::derive_part_path;
use crate::core::ytdlp_support::{env_path, exe_name, sidecar_path};
use crate::utils::process::hidden_command;

pub async fn resolve_ffmpeg_binary(override_path: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = override_path {
        candidates.push(path.to_path_buf());
    }
    if let Some(path) = env_path("VDP_FFMPEG_PATH") {
        candidates.push(path);
    }
    if let Some(path) = sidecar_path("ffmpeg") {
        candidates.push(path);
    }
    candidates.push(PathBuf::from(exe_name("ffmpeg")));

    for candidate in candidates {
        if let Ok(output) = hidden_command(&candidate).arg("-version").output().await {
            if output.status.success() {
                return Some(candidate);
            }
        }
    }

    None
}

pub fn infer_ffmpeg_container(output: &Path, explicit_container: Option<&str>) -> String {
    let normalize = |raw: &str| -> Option<String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "mp4" | "m4v" => Some("mp4".to_string()),
            "mkv" | "matroska" => Some("matroska".to_string()),
            "webm" => Some("webm".to_string()),
            "mov" => Some("mov".to_string()),
            "ts" | "mpegts" => Some("mpegts".to_string()),
            _ => None,
        }
    };

    if let Some(explicit) = explicit_container.and_then(normalize) {
        return explicit;
    }

    output
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(normalize)
        .unwrap_or_else(|| "mp4".to_string())
}

pub fn build_remux_args(input: &Path, part_output: &Path, container: &str) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-c".to_string(),
        "copy".to_string(),
    ];

    if container == "mp4" || container == "mov" {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    args.push("-f".to_string());
    args.push(container.to_string());
    args.push(part_output.to_string_lossy().to_string());
    args
}

pub fn build_mux_av_args(
    video: &Path,
    audio: &Path,
    part_output: &Path,
    container: &str,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-i".to_string(),
        video.to_string_lossy().to_string(),
        "-i".to_string(),
        audio.to_string_lossy().to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "1:a:0".to_string(),
    ];

    if container == "mp4" || container == "mov" {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    args.push("-f".to_string());
    args.push(container.to_string());
    args.push(part_output.to_string_lossy().to_string());
    args
}

pub async fn remux_single_stream(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    explicit_container: Option<&str>,
) -> Result<()> {
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let container = infer_ffmpeg_container(output, explicit_container);
    let part_output = derive_part_path(output);
    let args = build_remux_args(input, &part_output, &container);

    let run = run_ffmpeg(ffmpeg, &args).await;
    if let Err(err) = run {
        let _ = tokio::fs::remove_file(&part_output).await;
        return Err(err);
    }

    tokio::fs::rename(&part_output, output)
        .await
        .with_context(|| format!("提交 FFmpeg 封装文件失败: {}", output.display()))?;
    Ok(())
}

pub async fn mux_av_streams(
    ffmpeg: &Path,
    video: &Path,
    audio: &Path,
    output: &Path,
    explicit_container: Option<&str>,
) -> Result<()> {
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let container = infer_ffmpeg_container(output, explicit_container);
    let part_output = derive_part_path(output);
    let args = build_mux_av_args(video, audio, &part_output, &container);

    let run = run_ffmpeg(ffmpeg, &args).await;
    if let Err(err) = run {
        let _ = tokio::fs::remove_file(&part_output).await;
        return Err(err);
    }

    tokio::fs::rename(&part_output, output)
        .await
        .with_context(|| format!("提交 FFmpeg 音视频混流文件失败: {}", output.display()))?;
    Ok(())
}

async fn run_ffmpeg(ffmpeg: &Path, args: &[String]) -> Result<()> {
    let output = hidden_command(ffmpeg)
        .args(args)
        .output()
        .await
        .with_context(|| format!("启动 FFmpeg 失败: {}", ffmpeg.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("FFmpeg 混流失败 ({}): {}", output.status, stderr.trim());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_normalized_containers_with_safe_fallback() {
        assert_eq!(infer_ffmpeg_container(Path::new("out.mp4"), None), "mp4");
        assert_eq!(
            infer_ffmpeg_container(Path::new("out.mkv"), None),
            "matroska"
        );
        assert_eq!(infer_ffmpeg_container(Path::new("out.ts"), None), "mpegts");
        assert_eq!(infer_ffmpeg_container(Path::new("out.webm"), None), "webm");
        assert_eq!(
            infer_ffmpeg_container(Path::new("out.mp4"), Some("mkv")),
            "matroska"
        );
        assert_eq!(
            infer_ffmpeg_container(Path::new("out.bin"), Some("invalid")),
            "mp4"
        );
    }

    #[test]
    fn builds_remux_and_av_mux_args_with_container_specific_faststart() {
        let mp4_args = build_remux_args(
            Path::new("/tmp/in.ts"),
            Path::new("/tmp/out.mp4.part"),
            "mp4",
        );
        assert!(mp4_args
            .windows(2)
            .any(|w| w == ["-movflags", "+faststart"]));
        assert!(mp4_args.windows(2).any(|w| w == ["-f", "mp4"]));

        let mkv_args = build_mux_av_args(
            Path::new("/tmp/v.mp4"),
            Path::new("/tmp/a.m4a"),
            Path::new("/tmp/out.mkv.part"),
            "matroska",
        );
        assert!(!mkv_args.iter().any(|arg| arg == "-movflags"));
        assert!(mkv_args.windows(2).any(|w| w == ["-map", "0:v:0"]));
        assert!(mkv_args.windows(2).any(|w| w == ["-map", "1:a:0"]));
        assert!(mkv_args.windows(2).any(|w| w == ["-f", "matroska"]));
    }
}
