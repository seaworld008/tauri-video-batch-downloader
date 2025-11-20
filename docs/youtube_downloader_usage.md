# YouTube 下载器使用指南

> 适用于 `src-tauri` 中的 `YoutubeDownloader` / `commands/youtube.rs`，帮助你在开发、测试、部署阶段正确集成 yt-dlp/ffmpeg 依赖。

## 功能概览

- 通过 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 获取真实的格式、清晰度、封面等元数据。
- 自动或手动管理 yt-dlp/ffmpeg 可执行文件，并缓存到 `libs/` 目录。
- `download_video` / `download_audio` 直接使用 yt-dlp 的下载管理器，支持并行片段、断点续传、实时进度回调与取消。
- `download_thumbnail` 可单独拉取封面，供 UI 预览或导出使用。

## 依赖准备

| 类型 | 说明 |
| --- | --- |
| yt-dlp | 用于获取 YouTube 元数据与真实下载链接，默认安装到 `libs/yt-dlp(.exe)` |
| ffmpeg | 部分视频/音频需要转封装，默认安装到 `libs/ffmpeg(.exe)` |

### 自动安装

1. 保证 `YoutubeDownloaderConfig::auto_install_binaries = true`（默认值）。
2. 首次调用 `YoutubeDownloader::with_auto_install` 或 `YoutubeDownloader::download_*` 时，会检测 `libs/` 下是否存在可执行文件；若缺失则自动下载官方发行版。
3. 设置 `auto_update_binaries = true` 时，可在应用启动时强制重新获取最新二进制。

> **提示**：自动安装需要能够访问 GitHub Release，如需自建镜像，可在外部脚本下载后直接放入 `libraries_dir`。

### 手动指定

若需要内置或系统级的二进制，配置以下字段即可跳过自动安装：

```rust
YoutubeDownloaderConfig {
    yt_dlp_path: Some(PathBuf::from("/opt/yt-dlp")),
    ffmpeg_path: Some(PathBuf::from("C:/ffmpeg/bin/ffmpeg.exe")),
    ..Default::default()
}
```

当 `auto_install_binaries = false` 且指定路径不存在时，`YoutubeDownloader` 会返回 `AppError::Youtube`，提醒用户修复依赖。

## 核心配置速查

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `libraries_dir` | `libs` | 自动安装二进制的目标目录 |
| `output_dir` | `downloads/youtube` | 视频/音频保存路径 |
| `max_concurrent_downloads` | `3` | 同时运行的下载任务数，对应 yt-dlp 的 DownloadManager 并发数 |
| `segment_size` / `parallel_segments` | `10MB` / `8` | 高级性能参数，控制分段大小与并行片段数 |
| `retry_attempts` | `3` | 失败段重试次数 |
| `default_video_quality` | `VideoQuality::High` | UI 未指定格式时的兜底值 |
| `auto_install_binaries` | `true` | 控制是否自动下载 yt-dlp/ffmpeg |

## 常见操作

### 获取视频信息

```rust
let downloader = YoutubeDownloader::with_auto_install(YoutubeDownloaderConfig::default()).await?;
let info = downloader.fetch_video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ").await?;
println!("可用格式: {}", info.formats.len());
```

- `YoutubeVideoInfo.formats` 与 yt-dlp 输出保持一致，包含分辨率、码率、大小等字段。
- 可在 UI 中直接渲染 `format_note`、`resolution` 或 `ext` 供用户选择。

### 下载视频/音频

```rust
let download_id = downloader
    .download_video(
        url,
        "my-video.mp4",
        YoutubeDownloadFormat::CompleteVideo {
            video_quality: VideoQuality::High,
            video_codec: VideoCodecPreference::AVC1,
            audio_quality: AudioQuality::High,
            audio_codec: AudioCodecPreference::AAC,
        },
        Some(DownloadPriority::Normal),
        None,
    )
    .await?;

// 监听状态
if let Some(status) = downloader.get_download_status(&download_id).await {
    println!("当前状态: {:?}", status);
}
```

- `YoutubeDownloadFormat` 支持完整视频、音频/视频分离或直接指定 format_id。
- 设置 `progress_callback` 可实时接收 `(downloaded_bytes, total_bytes, speed)`，并推送到前端。
- `cancel_download` 会调用 yt-dlp DownloadManager 的 `cancel`，可以安全中断任务。

### Thumbnail 下载

```rust
let cover = downloader
    .download_thumbnail(url, "covers/video-thumb.jpg")
    .await?;
println!("封面已保存: {}", cover.display());
```

## 并发与进度

- 每个下载任务都对应一个 `DownloadTaskHandle`，包含 DownloadManager 的内部 ID，确保可以取消与清理。
- 通过 `YoutubeDownloadStatus` 可区分 `Pending` / `Downloading` / `Processing` / `Completed` / `Failed` / `Cancelled`。
- `Downloading` 状态提供真实 `speed_bytes_per_sec` 与估算 `eta_seconds`，UI 可直接渲染进度条。

## 故障排查

| 现象 | 排查步骤 |
| --- | --- |
| `Failed to prepare yt-dlp binaries` | 检查网络是否可访问 GitHub，或将 `auto_install_binaries` 设为 `false` 并手动放置可执行文件 |
| `Download finished with unknown status` | 通常为磁盘写入异常，可查看 `tracing` 日志或确保输出目录存在 |
| YouTube URL 被判定为无效 | 确认 URL 包含 `youtube.com`/`youtu.be`/`m.youtube.com`，短链建议保留 `https://` 前缀 |
| 下载速度始终为 0 | 多发生在下载立即完成或 chunk 太小，可适当增大 `segment_size` 并检查网络代理 |

## 测试建议

- 单元测试可使用 `serde_json` 构造模拟的 yt-dlp JSON（无需真实请求），详见 `core/youtube_downloader.rs` 中的示例。
- 集成测试如需真实请求，可在 CI 中标记为 `#[ignore]`，或在本地运行 `cargo test youtube_real -- --ignored`。
- 若要测试自动安装逻辑，可在构建前删除 `libs/` 目录并观察日志（`tracing` 会打印下载进度）。

---

如需扩展更多场景（例如登录、字幕、播放列表下载），可参考 yt-dlp 官方文档并在本指南基础上调整配置。祝使用愉快！
