use super::*;
use crate::core::models::{DownloaderType, ExternalVideoInfo, SourcePlatform, VideoTask};

fn task_for_target(
    downloader_type: Option<DownloaderType>,
    output_path: &str,
    resolved_path: Option<&str>,
    title: &str,
) -> VideoTask {
    let now = chrono::Utc::now();
    VideoTask {
        id: "task-ytdlp-target".to_string(),
        url: "https://www.youtube.com/watch?v=rYGpQwTKUcI".to_string(),
        title: title.to_string(),
        output_path: output_path.to_string(),
        resolved_path: resolved_path.map(str::to_string),
        status: TaskStatus::Pending,
        progress: 0.0,
        file_size: None,
        downloaded_size: 0,
        speed: 0.0,
        display_speed_bps: 0,
        eta: None,
        error_message: None,
        created_at: now,
        updated_at: now,
        paused_at: None,
        paused_from_active: false,
        downloader_type,
        video_info: None,
        external_info: None,
    }
}

fn youtube_info(title: &str) -> ExternalVideoInfo {
    ExternalVideoInfo {
        source_platform: SourcePlatform::Youtube,
        extractor: Some("youtube".to_string()),
        webpage_url: Some("https://www.youtube.com/watch?v=rYGpQwTKUcI".to_string()),
        title: Some(title.to_string()),
        thumbnail: None,
        duration_seconds: None,
        format_id: None,
        format_note: None,
        requires_auth: false,
    }
}

#[test]
fn ytdlp_target_uses_directory_and_title_not_extensionless_resolved_path() {
    let task = task_for_target(
        Some(DownloaderType::YtDlp),
        r"C:\Users\admin\Downloads",
        Some(r"C:\Users\admin\Downloads\Long Youtube Title"),
        "Long Youtube Title",
    );

    let target = DownloadManager::effective_download_target(&task);

    assert_eq!(target.output_path, r"C:\Users\admin\Downloads");
    assert_eq!(
        target.preferred_title.as_deref(),
        Some("Long Youtube Title")
    );
}

#[test]
fn http_target_preserves_resolved_file_path() {
    let task = task_for_target(
        Some(DownloaderType::Http),
        r"C:\Users\admin\Downloads",
        Some(r"C:\Users\admin\Downloads\video.mp4"),
        "video",
    );

    let target = DownloadManager::effective_download_target(&task);

    assert_eq!(target.output_path, r"C:\Users\admin\Downloads\video.mp4");
    assert_eq!(target.preferred_title.as_deref(), Some("video"));
}

#[test]
fn ytdlp_target_prefers_provider_title_over_manual_placeholder() {
    let mut task = task_for_target(
        Some(DownloaderType::YtDlp),
        r"C:\Users\admin\Downloads",
        None,
        "任务_1",
    );
    task.external_info = Some(youtube_info("Provider Video Title #tag"));

    let target = DownloadManager::effective_download_target(&task);
    let (_, filename) = DownloadManager::split_output_path(
        &task.url,
        &target.output_path,
        target.preferred_title.as_deref(),
    );

    assert_eq!(
        target.preferred_title.as_deref(),
        Some("Provider Video Title #tag")
    );
    assert_eq!(filename, "Provider Video Title");
}

#[test]
fn ytdlp_target_keeps_imported_table_title_over_provider_title() {
    let mut task = task_for_target(
        Some(DownloaderType::YtDlp),
        r"C:\Users\admin\Downloads",
        None,
        "表格中的课程名称",
    );
    task.external_info = Some(youtube_info("Provider Video Title"));

    let target = DownloadManager::effective_download_target(&task);
    let (_, filename) = DownloadManager::split_output_path(
        &task.url,
        &target.output_path,
        target.preferred_title.as_deref(),
    );

    assert_eq!(target.preferred_title.as_deref(), Some("表格中的课程名称"));
    assert_eq!(filename, "表格中的课程名称");
}

#[test]
fn ytdlp_target_uses_provider_title_when_table_title_is_missing_placeholder() {
    let mut task = task_for_target(
        Some(DownloaderType::YtDlp),
        r"C:\Users\admin\Downloads",
        None,
        "视频_12",
    );
    task.external_info = Some(youtube_info("Provider Video Title"));

    let target = DownloadManager::effective_download_target(&task);

    assert_eq!(
        target.preferred_title.as_deref(),
        Some("Provider Video Title")
    );
}
