<div align="center">

# Video Downloader Pro

**English** | [简体中文](README.zh-CN.md)

**High-reliability, cross-platform batch desktop video downloader built with
Rust, Tauri v2, React 19, and TypeScript.**

[![Continuous Integration](https://github.com/seaworld008/tauri-video-batch-downloader/actions/workflows/ci.yml/badge.svg)](https://github.com/seaworld008/tauri-video-batch-downloader/actions/workflows/ci.yml)
[![Security Audit](https://github.com/seaworld008/tauri-video-batch-downloader/actions/workflows/security.yml/badge.svg)](https://github.com/seaworld008/tauri-video-batch-downloader/actions/workflows/security.yml)
[![Release](https://github.com/seaworld008/tauri-video-batch-downloader/actions/workflows/release.yml/badge.svg)](https://github.com/seaworld008/tauri-video-batch-downloader/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111111)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)

</div>

---

**Video Downloader Pro** turns messy spreadsheet course lists, batch URLs,
direct HTTP streams, HLS (`.m3u8`), MPEG-DASH (`.mpd`), and supported public
video pages into an observable, pause/resume-safe desktop download queue powered
by a Rust core.

## Table of Contents

- [Why Video Downloader Pro](#why-video-downloader-pro)
- [Core Capabilities](#core-capabilities)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Quality Gates & Testing](#quality-gates--testing)
- [Documentation Hub](#documentation-hub)
- [Roadmap](#roadmap)
- [Contributing & Security](#contributing--security)
- [License](#license)

---

## Why Video Downloader Pro

- **Rust Download Core**: Queue priority scheduling, Tokio semaphore
  concurrency, HTTP Range/resumption, rate limiting, and atomic `.part` file
  commits run natively in Rust.
- **Real Batch Import**: Import large CSV / Excel spreadsheets with encoding
  detection, interactive header mapping, row previews, and duplicate task
  reconciliation (`completed`, `resumable`, `pending`, `failed`).
- **Explainable Crash & Restart Recovery**: Persisted sessions restore tasks and
  local `.part`/`.vdstate` markers cleanly without silently auto-starting
  background network transfers.
- **Per-Task Protocol Isolation**: Isolated task cancellation, pause state
  preservation, segment reuse on HLS `.m3u8` resume, monotonic token-bucket
  throttling, and per-row support diagnostic bundles.
- **Event-Driven React 19 UI**: Typed Tauri v2 `download-events` envelope feeds
  a Zustand store and virtualized task list without blocking UI threads.

---

## Core Capabilities

| Area                       | Current Capabilities (`v2.0.0`)                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modular Rust Workspace** | 5-crate Cargo Workspace (`vdpro-core`, `vdpro-storage`, `vdpro-providers`, `video-downloader-pro`, `vdpro-cli`) with decoupled domain, persistence, routing, desktop IPC, and CLI boundaries               |
| **Batch Input**            | Excel (`.xlsx`/`.xls`), CSV encoding auto-detection, field mapping, clipboard batch paste, single/multi-URL validation, collapsible advanced request options (`Referer`, `Cookie`, `Proxy`, etc.)          |
| **Queue & Controls**       | Global Start/Pause/Retry/Clear, per-row Start/Pause/Resume/Retry/Delete, batch selection & output directory override, global keyboard shortcuts (`?` modal)                                                |
| **Protocols & Providers**  | Pluggable `ProviderRegistry`: HTTP/HTTPS (`ResumeDownloader`), HLS (`.m3u8` Master Playlist, fMP4, AES-128, FFmpeg mux), native MPEG-DASH (`.mpd`), `yt-dlp` (YouTube, Bilibili, TikTok, X, Vimeo, Twitch) |
| **Desktop UX & i18n**      | 100% `zh-CN` / `en-US` parity with live header switcher, native system tray (`minimize_to_tray`, `start_minimized`, Start/Pause/Quit), notification chime & hidden-window desktop notifications            |
| **Headless CLI**           | Companion `vdpro-cli` binary sharing the Rust core (`download` from URLs or `.txt`/`.csv`/`.xlsx`/`.xls`, `probe`, `doctor`, `--json`, `--rate-limit`, request options)                                    |
| **Reliability & Storage**  | SQLite WAL (`download_state.db`) incremental persistence with automatic legacy JSON migration, atomic `.part` / `.seg` commits (`sync_all` + rename), `RetryExecutor` circuit breaker, SHA-256/MD5 checks  |
| **Observability**          | Live per-task speed & ETA, queue overview status badge, `average_commit_duration` / `p95_commit_duration`, 500ms coalesced terminal alerts, one-click task diagnostic copy                                 |
| **Cross-Platform**         | Tauri v2 desktop builds for Windows (`nsis`), macOS (`universal` `.dmg`), and Linux                                                                                                                        |

---

## Architecture

```mermaid
flowchart LR
  Input["CSV / Excel / Batch URLs + Request Options"] --> UI["React 19 UnifiedView"]
  UI --> Store["Zustand Stores & Validation"]
  Store --> API["Feature-local Tauri Wrappers"]
  API --> Commands["Tauri v2 Commands + TaskEngine"]
  Commands --> Runtime["DownloadRuntimeHandle"]
  Runtime --> Manager["DownloadManager (Queue + Semaphore)"]
  Manager --> Router["ProviderRegistry (Priority DownloadProviderSpec)"]
  Router --> HTTP["HttpDownloader (Single .part)"]
  Router --> Resume["ResumeDownloader (Chunked Range)"]
  Router --> HLS["M3U8Downloader (Master Playlist / fMP4 / AES-128)"]
  Router --> DASH["DashDownloader (MPD / Multi-Track)"]
  Router --> YtDlp["YtDlp External Provider"]
  HLS --> Mux["vdpro-providers::ffmpeg_muxer"]
  DASH --> Mux
  HTTP --> Storage["vdpro-storage (SQLite WAL + Atomic .part)"]
  Resume --> Storage
  Mux --> Storage
  YtDlp --> Storage
  Manager --> EventBus["download-events Envelope"]
  EventBus --> Bridge["downloadEventBridge (Debounced Sync)"]
  Bridge --> Store
```

---

## Quick Start

### Prerequisites

| Tool             | Minimum Version      | Notes                                                                                          |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| **Node.js**      | `>= 20.x`            | Declared in `package.json#engines`                                                             |
| **pnpm**         | `>= 9.15.0`          | Enable via `corepack enable`                                                                   |
| **Rust**         | `stable` (`>= 1.78`) | Verified on `rustc 1.89.0`                                                                     |
| **Platform SDK** | OS-specific          | **Windows**: WebView2 + MSVC; **macOS**: Xcode CLI Tools; **Linux**: `webkit2gtk` & `libgtk-3` |

### Install & Run (Development)

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile

# Launch full desktop Tauri app in development mode
pnpm dev
```

### Headless CLI (`vdpro-cli`)

Build and run the headless companion binary directly against the Rust core for
servers, scripts, and batch automation:

```bash
cargo build --manifest-path src-tauri/Cargo.toml -p vdpro-cli --bin vdpro-cli

# Inspect resolved provider & media headers
./src-tauri/target/debug/vdpro-cli probe "https://example.com/video.mp4" --json

# Check yt-dlp / ffmpeg / deno availability
./src-tauri/target/debug/vdpro-cli doctor

# Batch download from CSV/Excel/TXT with concurrency & bandwidth cap
./src-tauri/target/debug/vdpro-cli download -f courses.xlsx -o ./downloads -c 4 --rate-limit 2M
```

### Build Production Bundles

Production builds require real external sidecars (`yt-dlp`, `ffmpeg`, `deno`)
inside `src-tauri/binaries/` matching your target triple:

```bash
# 1. Fetch/prepare platform sidecars and verify strict release policy
pnpm sidecars:prepare
pnpm sidecars:check

# 2. Build production installer / app bundle
pnpm build
```

For local desktop smoke builds without production sidecars:

```bash
pnpm build:local
```

---

## Quality Gates & Testing

```bash
# Frontend static checks & tests
pnpm type-check
pnpm lint
pnpm exec vitest run
pnpm exec vitest run --config vitest.config.integration.ts
pnpm exec vite build

# Backend Rust checks & tests
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml

# Sidecar & dependency audits
pnpm sidecars:check:local
pnpm audit --prod --audit-level moderate
```

---

## Documentation Hub

| Topic                        | Document                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Full Architecture & Design   | [docs/architecture-functional-design.md](docs/architecture-functional-design.md) |
| Live System State (`v2.0.0`) | [docs/current-state.md](docs/current-state.md)                                   |
| Documentation Index          | [docs/index.md](docs/index.md)                                                   |
| Build & Release Guide        | [docs/build-release.md](docs/build-release.md)                                   |
| Contributing Guide           | [CONTRIBUTING.md](CONTRIBUTING.md)                                               |
| Changelog                    | [CHANGELOG.md](CHANGELOG.md)                                                     |
| Security Policy              | [SECURITY.md](SECURITY.md)                                                       |
| AI Agent Protocol            | [AGENTS.md](AGENTS.md)                                                           |

---

## Roadmap

- **`v1.1.0` (Completed)**: Core reliability hardening, per-task M3U8 isolation,
  atomic `.part` / config writes, UI settings wiring, per-row controls, and OSS
  foundation.
- **`v1.2.0` (Completed)**: Pluggable `DownloadProviderSpec` /
  `ProviderRegistry`, native HLS Master Playlist (variant/audio selection +
  fMP4 + FFmpeg remux), native MPEG-DASH (`.mpd`) downloader, and per-task
  custom headers / cookies / proxy parity with `yt-dlp` (including Bilibili,
  X/Twitter, Vimeo, Twitch).
- **`v1.3.0` (Completed)**: Full frontend `zh-CN` / `en-US` i18n parity with
  header switcher, native system tray (`minimize_to_tray`, `start_minimized`),
  notification chimes & hidden-window desktop alerts, global keyboard shortcuts,
  and headless companion CLI (`vdpro-cli`).
- **`v2.0.0` (Current)**: Modular 5-crate Cargo Workspace (`vdpro-core`,
  `vdpro-providers`, `vdpro-storage`, `video-downloader-pro`, `vdpro-cli`),
  SQLite WAL persistent state storage (`download_state.db`) with automatic
  lossless migration from legacy JSON snapshots, and release pipeline polish.

See [docs/roadmap.md](docs/roadmap.md) for detailed milestones.

---

## Contributing & Security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) and our
  [Code of Conduct](CODE_OF_CONDUCT.md) before opening a PR.
- Report security issues privately via [SECURITY.md](SECURITY.md) — never open
  public issues for security vulnerabilities.

## License

Released under the [MIT License](LICENSE).
