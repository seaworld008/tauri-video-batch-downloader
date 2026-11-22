# Changelog

All notable changes to **Video Downloader Pro** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-22

### Added

- **Pluggable `ProviderRegistry` Architecture**: Refactored
  `DownloadProviderRouter` around a priority-sorted `DownloadProviderSpec` trait
  registry (`HlsProviderSpec`, `DashProviderSpec`, `YtDlpProviderSpec`,
  `HttpResumableProviderSpec`, `HttpSimpleProviderSpec`), decoupling URL/HEAD
  protocol routing across native streaming engines and `yt-dlp`.
- **Native MPEG-DASH (`.mpd`) Engine**:
  - Added `dash_parser.rs` (`quick-xml`) supporting MPD inheritance, `BaseURL`,
    ISO-8601 durations, `SegmentTemplate` (duration & `SegmentTimeline`),
    `SegmentList`, `SegmentBase`, initialization ranges, and bitrate/language
    track selection.
  - Added `dash_downloader.rs` (`DashDownloader`) with concurrent segment
    downloads, `.seg.tmp -> .seg` atomic writes, pause/resume segment reuse,
    HTTP `206` byte-range verification, scoped client overrides, and automatic
    FFmpeg audio/video muxing.
- **Shared FFmpeg Lossless Remux/Mux Layer**: Added `ffmpeg_muxer.rs` supporting
  sidecar/env/PATH resolution (`resolve_ffmpeg_binary`), single-track remux
  (`remux_single_stream`), and separate audio/video muxing (`mux_av_streams`)
  for HLS and DASH streams.
- **Unified Per-Task Request Options (`TaskRequestOptions`)**: Added per-task
  `headers`, `cookies`, `cookies_from_browser`, `referer`, `user_agent`, `proxy`
  (`http`/`https`/`socks5`/`socks5h`), `format_selector`, `preferred_language`,
  and `output_container` across frontend schemas, `ManualInputPanel` advanced
  options, `HttpDownloader`, `M3U8Downloader`, `DashDownloader`, and
  `YtDlpDownloader`.
- **Expanded Social/Video Platform Support**: Added `Bilibili` (`bilibili.com`,
  `b23.tv`), `Twitter` (`twitter.com`, `x.com`), `Vimeo` (`vimeo.com`), and
  `Twitch` (`twitch.tv`) platform detection alongside enhanced `yt-dlp` error
  classification (`drm_protected`, `proxy_error`).

### Changed

- **HLS Master Playlist & Encryption Upgrade**: Upgraded `M3U8Downloader` with
  `M3U8DownloadContext`, Master Playlist (`#EXT-X-STREAM-INF` / `#EXT-X-MEDIA`)
  variant & audio track selection, separate A/V FFmpeg muxing, `#EXT-X-MAP` fMP4
  init segment caching, `#EXT-X-MEDIA-SEQUENCE` default AES-128 IV derivation,
  non-retryable HTTP fast-fail (`401`/`403`/`404`/`410`), and bounded
  exponential backoff.
- **Request-Scoped HTTP & `yt-dlp` Option Forwarding**: Added `with_client`
  support in `ResumeDownloader`, CRLF/scheme validation in
  `build_client_for_request`, safe CLI flag sanitization/allowlisting in
  `ytdlp_support.rs`, and full request-option wiring in `DownloadManager` and
  `HttpDownloader`.
- **Security Dependency Update**: Upgraded `url` crate to `2.5.9` to remediate
  `RUSTSEC-2026-0592` and enabled `reqwest` SOCKS proxy support.

## [1.1.0] - 2026-11-22

### Added

- **MIT License & Open-Source Community Kit**: Added root `LICENSE` (MIT),
  `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `README.zh-CN.md`, and rewrote
  `README.md` with bilingual navigation and cross-platform setup.
- **Per-Row Task Controls & Inline Error Surface**: Added
  start/pause/resume/retry and delete action buttons directly on each task row
  in `TaskListItem` with accessible `focus-visible:ring-*` indicators and inline
  error reasons for failed tasks.
- **Dynamic Status Badge**: Upgraded `StatusBar` from a static "Ready" indicator
  to a live state badge reflecting paused queue, active transfers/commits,
  failures, pending queue items, and ready states.
- **Per-Task M3U8 Context Isolation & Segment Resume**: Added
  `download_m3u8_with_context` with per-task cancellation, pause directory
  preservation, atomic `.ts.tmp` segment writes, existing segment reuse on
  resume, bandwidth throttling, and sibling task abort on failure.
- **Graceful Window Close**: Intercepted Tauri `CloseRequested` events to
  cleanly stop active downloads and flush state with a 5-second timeout before
  destroying the window.

### Changed

- **Backend Reliability & Atomicity**:
  - Switched `AppConfig::save()` to atomic temporary-file write + `sync_all()` +
    rename.
  - Staged single-stream `download_with_resume` transfers through `.part`
    files + `sync_all()` before atomic rename to final destination.
  - Replaced fixed-window `BandwidthController` with a monotonic token-bucket
    limiter (`Instant`-based).
  - Moved SHA-256/MD5 integrity hashing off async executor threads via
    `tokio::task::spawn_blocking`.
  - Wired `RetryExecutor` with `circuit_breaker.record_failure()` /
    `record_success()`.
  - Unified `tool_data_dir()` and `resolve_resume_dir()` to canonical
    `com.videodownloader.pro` paths with legacy read fallback.
  - Delegated `validate_config` Tauri command directly to
    `AppConfig::validate()`.
  - Fixed `DownloadProviderRouter` `None` Content-Length fallback to
    `HttpSimple`, stopped internal stats event loopback in
    `DownloadRuntimeHandle`, stopped shared `m3u8_downloader.progress_tx`
    mutation, gated `ProgressTracker` buffering behind an explicit consumer
    flag, throttled `ResumeDownloader` progress deltas to 200ms intervals, and
    replaced heuristic `"5"` substring checks with exact 5xx status parsing.
- **Frontend Preferences & Performance**:
  - Wired `config.ui.theme` into `ThemeProvider`, `config.ui.language` into
    `i18next` and `document.documentElement.lang`,
    `config.ui.show_completed_tasks` into `VirtualizedTaskList`,
    `config.ui.auto_start_downloads` into `FileImportPanel` and
    `ManualInputPanel`, and `config.ui.show_notifications` into `notify`.
  - Debounced burst terminal `refreshTasks()` calls by 250ms and removed idle
    `pending` polling in `downloadEventBridge`.
  - Removed duplicate toast notifications on settings save/reset, redundant
    `refreshStats()` in `DashboardToolbar`, and `updated_at` noise from
    `isTaskSnapshotUnchanged`.
  - Throttled `VirtualizedTaskList` scroll updates with `requestAnimationFrame`.
  - Normalized backend task payloads inside `StateValidator` before task
    comparison and replaced the missing `/vite.svg` favicon with an inline SVG
    data URI.
- **Workspace Hygiene & CI Config**:
  - Bumped crate, package, and Tauri configuration versions cleanly from
    `1.0.27` to `1.1.0`.
  - Fixed `.github/dependabot.yml` v2 schema compliance and removed stale
    personal/legacy scripts.

## [1.0.27] - 2026-11-21

### Fixed

- Hardened Tauri cross-platform release CI/CD workflows, sidecar validation,
  external tool update/rollback flows, duplicate import reconciliation, and
  download boundary test coverage (`429`, Range `416`, ignored Range, truncated
  `.part`, and M3U8 byte-range validation).
