# Roadmap

更新日期：2026-11-22

这份路线图记录 **Video Downloader Pro** 从 `v1.1.0` 到 `v2.0.0`
的多阶段演进规划。已完成项会合并回 `docs/current-state.md` 与 `CHANGELOG.md`。

---

## Phase 1 (`v1.1.0`) — 核心可靠性加固与开源基线（已完成）

- 原子性落盘：`AppConfig::save()` 与单流 `download_with_resume` 通过临时 `.tmp`
  / `.part` + `sync_all()` + 原子重命名提交。
- HLS/M3U8 任务隔离：`download_m3u8_with_context`
  隔离每任务的取消、暂停、进度与令牌桶限速通道，暂停时保留并复用分片文件。
- 并发与窗口安全：Tauri `CloseRequested` 优雅退出（5s 超时）、`spawn_blocking`
  异步卸载哈希计算、`RetryExecutor` 熔断器闭环、去除事件总线内部统计回环与无效
  `5` 状态误判。
- 前端全链路闭环：主题 `theme`、语言
  `language`、`show_completed_tasks`、`auto_start_downloads`、`show_notifications`、行级开始/暂停/重试/删除操作与错误原因展示、实时队列徽标、250ms 终态刷新防抖与
  `rAF` 虚拟滚动节流。
- 开源社区体系：MIT `LICENSE`、双语 README (`README.md` /
  `README.zh-CN.md`)、`CHANGELOG.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`
  与合规的 `.github/dependabot.yml`。

---

## Phase 2 (`v1.2.0`) — 可插拔多流媒体引擎（下一阶段）

- **Trait 化 `DownloadProvider` 注册中心**：将硬编码的 `DownloadProviderRouter`
  重构为基于优先级匹配与插件注册表的 `DownloadProvider` /
  `ProviderRegistry`，解耦 HTTP / Range / HLS / DASH / `yt-dlp`。
- **完整 HLS Master Playlist + fMP4 + FFmpeg 无损混流**：
  - 支持 `#EXT-X-STREAM-INF` / `#EXT-X-MEDIA` 码率与音视频/字幕轨选择。
  - 支持 `#EXT-X-MAP` (fMP4 init segment)、AES-128 默认 Media Sequence
    IV 推导与自动 FFmpeg 无损封装为 `.mp4` / `.mkv`。
  - 支持分片级指数退避重试与直播滑窗拉流支持。
- **原生 MPEG-DASH (`.mpd`) 下载器**：原生解析 MPD Manifest / `SegmentTemplate`
  / `SegmentList` / `BaseURL`，并发拉取音频与视频表示轨并用 FFmpeg 无损混流。
- **单任务协议参数与 `yt-dlp` 深度对齐**：支持任务级 `headers` / `cookies` /
  `referer` / `proxy` 透传，统一 HTTP、HLS、DASH 与 `yt-dlp`
  字幕/封面/音质参数策略，支持用户覆盖格式选择器与网络异常分类增强。

---

## Phase 3 (`v1.3.0`) — 全球化 UX 抛光、桌面融合与 CLI

- **全量国际化覆盖**：消除硬编码中文文案，打通 Settings / Toolbar / UnifiedView
  / Dialogs / 状态文案的完整 `zh-CN` 与 `en-US`
  双语覆盖，并向社区开放多语言贡献。
- **桌面原生体验深化**：真正接入系统托盘最小化（`minimize_to_tray`）、系统级下载完成/失败通知（`notification_sound`）与可访问性键盘快捷键体系（`Ctrl/Cmd+V`、全选、空格暂停/恢复、焦点管理）。
- **无头伴生 CLI
  (`vdpro-cli`)**：复用同一 Rust 下载引擎核心，提供面向脚本与服务器批处理的命令行模式。

---

## Phase 4 (`v2.0.0`) — Cargo Workspace 分层与 SQLite WAL 存储

- **Cargo Workspace 多 Crate 架构**：拆分为
  `vdpro-core`（模型、配置、错误、事件）、`vdpro-providers`（HTTP / Range / HLS
  / DASH / yt-dlp）、`vdpro-storage`（状态持久化与文件原子提交）与
  `src-tauri`（IPC 与桌面壳），提升编译增量速度与第三方嵌入式复用度。
- **SQLite (WAL) 存储替代全量 JSON 快照**：通过带自动迁移的路径将旧
  `download_manager_state.json` 无损升级至 SQLite
  WAL，消除上万任务下的全量序列化 O(N) 瓶颈。
- **产品 showcase 与录制指南**：补充各平台实机截图 /
  GIF 演示，并完善贡献者测试矩阵。

---

## 执行原则

1. 下载核心行为必须 test-first。
2. 涉及事件契约时，Rust / TypeScript schema 和前端 reducer 测试必须同步更新。
3. 涉及持久化或断点续传时，必须覆盖关闭重开和本地文件不一致场景。
4. 涉及 UI 状态时，前端不抢写后端真相状态。
5. 每轮完成后同步更新
   `README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`docs/index.md`、`docs/current-state.md`
   和本路线图。
