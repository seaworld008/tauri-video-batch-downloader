use serde_json::json;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc};

use crate::core::models::{SourcePlatform, TaskStatus};
use crate::core::{
    downloader::DownloadTask,
    ytdlp_downloader::{parse_progress_line, YtDlpDownloader, YtDlpDownloaderConfig},
    ytdlp_support::platform_host_rules,
};

#[test]
fn detects_supported_social_platforms() {
    assert_eq!(
        YtDlpDownloader::detect_platform("https://www.youtube.com/watch?v=abc"),
        SourcePlatform::Youtube
    );
    assert_eq!(
        YtDlpDownloader::detect_platform("https://www.tiktok.com/@user/video/123"),
        SourcePlatform::Tiktok
    );
    assert_eq!(
        YtDlpDownloader::detect_platform("https://www.instagram.com/reel/abc/"),
        SourcePlatform::Instagram
    );
    assert_eq!(
        YtDlpDownloader::detect_platform("https://fb.watch/abc/"),
        SourcePlatform::Facebook
    );
    assert_eq!(
        YtDlpDownloader::detect_platform("https://example.com/watch/abc"),
        SourcePlatform::Generic
    );
    assert_eq!(
        YtDlpDownloader::detect_platform("https://youtube.com.evil.example/watch?v=abc"),
        SourcePlatform::Generic
    );
}

#[test]
fn exposes_platform_host_registry_for_future_provider_expansion() {
    let rules = platform_host_rules();
    assert!(rules.iter().any(
        |rule| rule.platform == SourcePlatform::Youtube && rule.hosts.contains(&"youtube.com")
    ));
    assert!(rules
        .iter()
        .any(|rule| rule.platform == SourcePlatform::Facebook && rule.hosts.contains(&"fb.watch")));
}

#[test]
fn maps_legacy_youtube_downloader_type_to_ytdlp() {
    let value: crate::core::models::DownloaderType =
        serde_json::from_str("\"Youtube\"").expect("legacy Youtube must deserialize");
    assert_eq!(serde_json::to_string(&value).unwrap(), "\"YtDlp\"");
}

#[test]
fn builds_safe_probe_and_download_args() {
    let probe = YtDlpDownloader::build_probe_args("https://youtu.be/abc");
    assert!(probe.contains(&"--dump-single-json".to_string()));
    assert!(probe.contains(&"--no-playlist".to_string()));

    let download = YtDlpDownloader::build_download_args(
        "https://youtu.be/abc",
        Path::new("/tmp/out"),
        "video.%(ext)s",
        Some(Path::new("/tmp/ffmpeg")),
    );
    assert!(download
        .windows(2)
        .any(|pair| pair == ["--format", "bv*+ba/b"]));
    assert!(download
        .windows(2)
        .any(|pair| pair == ["--merge-output-format", "mp4"]));
    assert!(download
        .windows(2)
        .any(|pair| pair == ["--ffmpeg-location", "/tmp/ffmpeg"]));
}

#[test]
fn parses_ytdlp_progress_template_lines() {
    let parsed =
        parse_progress_line("download:1024\t2048\t512.5\t2\tdownloading").expect("progress");
    assert_eq!(parsed.downloaded_bytes, 1024);
    assert_eq!(parsed.total_bytes, Some(2048));
    assert_eq!(parsed.speed, 512.5);
    assert_eq!(parsed.eta, Some(2));
    assert_eq!(parsed.status_hint, None);

    let committing =
        parse_progress_line("download:2048\t2048\t0\tNA\tfinished").expect("finished progress");
    assert_eq!(committing.status_hint, Some(TaskStatus::Committing));
}

#[test]
fn classifies_external_tool_errors() {
    assert!(
        YtDlpDownloader::classify_error("ERROR: Sign in to confirm your age")
            .starts_with("authentication_required")
    );
    assert!(
        YtDlpDownloader::classify_error("Video not available in your country")
            .starts_with("geo_or_policy_restricted")
    );
    assert!(YtDlpDownloader::classify_error("ERROR: Unsupported URL")
        .starts_with("unsupported_extractor"));
    assert!(YtDlpDownloader::classify_error("ffmpeg not found").starts_with("ffmpeg_missing"));
    assert!(YtDlpDownloader::classify_error("HTTP Error 429").starts_with("rate_limited"));
}

#[test]
fn maps_probe_json_to_external_info() {
    let info = YtDlpDownloader::external_info_from_json(
        &json!({
            "extractor": "Youtube",
            "webpage_url": "https://www.youtube.com/watch?v=abc",
            "title": "Example",
            "thumbnail": "https://example.com/thumb.jpg",
            "duration": 12.5,
            "format_id": "137+140",
            "format_note": "1080p"
        }),
        "https://youtu.be/abc",
    );
    assert_eq!(info.source_platform, SourcePlatform::Youtube);
    assert_eq!(info.title.as_deref(), Some("Example"));
    assert_eq!(info.duration_seconds, Some(12.5));
    assert!(!info.requires_auth);
}

#[cfg(unix)]
#[tokio::test]
async fn fake_sidecar_download_reports_final_path() {
    use tempfile::tempdir;
    use tokio::sync::mpsc;

    let temp_dir = tempdir().expect("temp dir");
    let bin_dir = temp_dir.path().join("bin");
    let out_dir = temp_dir.path().join("out");
    std::fs::create_dir_all(&bin_dir).unwrap();
    std::fs::create_dir_all(&out_dir).unwrap();

    let ytdlp = bin_dir.join("yt-dlp");
    let ffmpeg = bin_dir.join("ffmpeg");
    write_executable(
        &ytdlp,
        r#"#!/usr/bin/env sh
outdir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --paths) shift; outdir="$1" ;;
  esac
  shift
done
mkdir -p "$outdir"
outfile="$outdir/fake-video.mp4"
echo "download:5	10	1	5	downloading"
printf "0123456789" > "$outfile"
echo "download:10	10	0	0	finished"
echo "filepath:$outfile"
"#,
    );
    write_executable(
        &ffmpeg,
        r#"#!/usr/bin/env sh
echo "ffmpeg fake"
"#,
    );

    let downloader = YtDlpDownloader::new(YtDlpDownloaderConfig {
        yt_dlp_path: Some(ytdlp),
        ffmpeg_path: Some(ffmpeg),
        user_agent: "test".to_string(),
    });
    let mut task = DownloadTask::new(
        "https://www.youtube.com/watch?v=abc".to_string(),
        out_dir.to_string_lossy().to_string(),
        "Example Video.mp4".to_string(),
    );
    let (tx, mut rx) = mpsc::unbounded_channel();

    downloader
        .download(
            &mut task,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            Some(tx),
        )
        .await
        .expect("fake sidecar download");

    assert_eq!(task.filename, "fake-video.mp4");
    assert!(PathBuf::from(&task.output_path)
        .join(&task.filename)
        .exists());
    let progress = rx.recv().await.expect("progress event");
    assert_eq!(progress.1.total_bytes, Some(10));
}

#[cfg(unix)]
#[tokio::test]
async fn fake_sidecar_download_discovers_file_when_final_path_is_not_printed() {
    use tempfile::tempdir;

    let temp_dir = tempdir().expect("temp dir");
    let bin_dir = temp_dir.path().join("bin");
    let out_dir = temp_dir.path().join("out");
    std::fs::create_dir_all(&bin_dir).unwrap();
    std::fs::create_dir_all(&out_dir).unwrap();

    let ytdlp = bin_dir.join("yt-dlp");
    let ffmpeg = bin_dir.join("ffmpeg");
    write_executable(
        &ytdlp,
        r#"#!/usr/bin/env sh
outdir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --paths) shift; outdir="$1" ;;
  esac
  shift
done
mkdir -p "$outdir"
outfile="$outdir/Fallback Video.webm"
printf "0123456789" > "$outfile"
echo "download:10	10	0	0	finished"
"#,
    );
    write_executable(
        &ffmpeg,
        r#"#!/usr/bin/env sh
echo "ffmpeg fake"
"#,
    );

    let downloader = YtDlpDownloader::new(YtDlpDownloaderConfig {
        yt_dlp_path: Some(ytdlp),
        ffmpeg_path: Some(ffmpeg),
        user_agent: "test".to_string(),
    });
    let mut task = DownloadTask::new(
        "https://www.youtube.com/watch?v=abc".to_string(),
        out_dir.to_string_lossy().to_string(),
        "Fallback Video.mp4".to_string(),
    );

    downloader
        .download(
            &mut task,
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
            None,
        )
        .await
        .expect("fake sidecar download should discover file");

    assert_eq!(task.filename, "Fallback Video.webm");
    assert!(PathBuf::from(&task.output_path)
        .join(&task.filename)
        .exists());
}

#[cfg(unix)]
fn write_executable(path: &Path, content: &str) {
    std::fs::write(path, content).unwrap();
    let mut permissions = std::fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions).unwrap();
}
