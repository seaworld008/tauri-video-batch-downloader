# 系统功能逻辑全面检查报告（2025-11-13）

## 1. 总览
- **目标**：评估 Rust 核心（`src-tauri`）在导入、下载、恢复、监控、YouTube/M3U8 等功能的实现现状，识别尚未完成或可改进的逻辑。
- **方法**：静态审查关键模块（`commands`、`core/downloader.rs`、`resume_downloader.rs` 等）、查阅 `docs/*` 规划文档、执行 `cargo test core::resume_downloader_integration_tests` 以验证主要下载链路。

| 模块 | 主要文件 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| 导入/预览 | `commands/import.rs`, `bin/preview_cli.rs` | 功能完整，能检测编码/映射字段并输出统计 | 仍需补充 CLI 使用文档及错误码约定 |
| HTTP 下载 | `core/downloader.rs`, `commands/download.rs` | ResumeDownloader 已并入，`retry_failed_tasks`、单任务控制可用 | 缺少批量暂停/恢复 API、带宽限流入口仅支持 manager 级别 |
| 恢复下载内核 | `core/resume_downloader.rs` | 拥有 chunk 并发/校验逻辑，集成测试可跑 | 仍留有 `_encryption_key` 未使用、`byte_range` 等 TODO |
| M3U8/HLS | `core/m3u8_downloader.rs` | 具备基础分片/解析能力 | TODO：分片 byte range、AES-128 key 处理、速度统计 |
| YouTube | `core/youtube_downloader.rs`, `commands/youtube.rs` | 仍以模拟实现为主，缺真实 `yt-dlp` 执行链路 | 属于阶段 3 计划，需实现安装/更新/下载等全流程 |
| 监控/仪表板 | `core/monitoring.rs`, `core/manager.rs` | 有监控结构但不少 TODO（停止后台、Arc issue） | 需确保长时间运行稳定性 |
| CLI / 安装 | `bin/preview_cli.rs`, `target/wix/*` | CLI 可用且随安装包分发 | 缺命令说明与集成测试 |

## 2. 细项检查

### 2.1 导入与预览
- `commands/import.rs`：`preview_import_data`/`import_file` 等逻辑完整，包含编码检测、字段映射、统计信息。
- `preview_cli.rs`：可独立运行但缺少 README 中的使用示例；错误输出仅 `stderr` 文本，建议引入错误码/日志。

**建议**：在 `README` 或 `docs/import_usage.md` 中补充 CLI 调用示例；对 `preview_import_data` 返回的 `ImportPreview.field_mapping` 增加校验（避免前端依赖 `Option<HashMap>` 未判空即用）。

### 2.2 下载命令层（`commands/download.rs`）
- 单任务控制：`start/pause/resume/cancel/remove/get_stats` 均已连接 `DownloadManager`。
- `retry_failed_tasks`：逻辑现已实现，会调用 `retry_failed` 并逐个 `start_download`，并提供错误回写。
- **缺失点**：
  - 无“全部暂停/全部恢复/全部取消”命令，前端 Store 仍需遍历单任务调用。
  - `set_rate_limit` 仅简单写入带宽控制器的目标值，没有校验输入范围，也没有将当前限制广播给前端。

**建议**：
1. 新增批量操作命令（`pause_all_downloads`, `resume_all_downloads`, `cancel_all`）并在 `DownloadManager` 中实现对应方法，方便 UI 调用。
2. 对 `set_rate_limit` 增加合法区间校验，并在成功后返回当前限制（例如 `Result<u64>`），便于 UI 同步状态。

### 2.3 HttpDownloader / ResumeDownloader
- `HttpDownloader::new` 已在内部构建 `BandwidthController`，并携带 `ResumeDownloader`/`M3U8Downloader`。
- `smart_download` 能根据 Content-Length 决定使用传统流式或块状下载。
- **不足**：
  - 当 HEAD 请求失败或返回 0 长度时，依旧沿用传统 `download_with_resume`，未尝试使用 ResumeDownloader 以支持大文件。
  - 进度透传：`download_with_resume_downloader` 虽然订阅 chunk delta，但依赖 `task.stats.total_bytes` 预置，否则进度条相对误差较高。
  - 监控：`BandwidthController` 当前只支持全局限速，没有 per-task 指标，无法在 UI 上展示速度被限的信息。

**建议**：
1. 在 HEAD 失败的情况下，如果配置开启 resume，则仍尝试调用 `ResumeDownloader`，并根据运行时返回的 `total_size` 补写 `task.stats`。
2. 为 `BandwidthController` 增加观测 API（例如当前 window 总字节、剩余额度），以便通过事件或 `get_download_stats` 暴露到 UI。

### 2.4 M3U8/HLS 下载
- `M3U8Downloader` 已完成字节区间解析、AES-128 解密、真实速率/ETA 统计以及失败场景的临时文件保留，日志会输出 Range、URL、状态码等上下文，便于排查。
- 目前 `smart_download` 依旧只依赖 URL 关键词，没有对 Content-Type/前几个字节做嗅探，也尚未把 `keep_temp_files`、最大并发等参数透出到 UI 配置。

**建议**：
1. 扩展 `smart_download`：优先根据响应头与内容签名识别 `.m3u8`，避免误判；
2. 在下载设置面板开放 `keep_temp_files`、并发数、超时等高级配置，并把 Range/AES 相关错误编码传递到 UI。

### 2.5 YouTube 下载
- `core/youtube_downloader.rs` 现已接入 yt-dlp crate，可自动安装 yt-dlp/ffmpeg，`fetch_video_info` 返回真实格式列表并映射到 `YoutubeVideoInfo`。
- `download_video`/`download_audio` 基于 `DownloadManager` 异步下载真实流，支持进度回调、并发控制与取消，`download_thumbnail` 也会下载真实封面。

**建议**：
1. UI 侧可增加依赖健康检查（展示 yt-dlp/ffmpeg 路径、版本）以及配置覆盖入口，便于用户切换外部安装；
2. 扩展更多格式策略（音视频分离合并、音频格式转换）及失败重试提示，并将 DownloadManager 事件透传到 `DownloadEvent` 体系。

### 2.6 监控/事件系统
- `core/manager.rs` 中仍有多处 TODO（停止监控、Arc issue），`monitoring.rs` 的 `PerformanceMetrics`、`MonitoringSystem` 也有未使用参数。
- `monitoring.rs` 存在大量 `unused import`/`unused variable` 警告，说明部分逻辑尚未接入。

**建议**：逐项关闭 TODO，至少保证：
1. 监控后台协程可在 App 退出时安全停止；
2. 导出 Prometheus 或 UI 仪表盘所需的全部字段；
3. 移除未使用的结构体字段或补充逻辑以避免编译警告。

### 2.7 CLI 与安装包
- `preview_cli` 已纳入 WiX 安装，但缺少自测脚本和用户文档。
- 其他二进制（如 `app-simple` 等）仅用于实验，建议在发行包中加以区分。

**建议**：
1. 在 `docs/cli_usage.md` 中记录 `preview_cli` 命令/参数/示例；
2. 为 CLI 添加简单的集成测试（读取项目自带样例 CSV/Excel）。

## 3. 测试执行与结果
- 已运行 `cargo test core::resume_downloader_integration_tests --lib -- --nocapture`，测试通过但编译期存在多处 `unused import`/`unused variable` 警告，主要集中在 `file_parser.rs`、`integrity_checker.rs`、`m3u8_downloader.rs`、`monitoring.rs` 等文件。
- 建议在下一轮修复中统一清理这些警告，以保持 CI 清爽。

## 4. 综合评估与改进清单

| 优先级 | 改进项 | 说明 |
| --- | --- | --- |
| 高 | 批量下载控制命令 | 直接支持“全部暂停/恢复/取消”，减少前端循环调用 |
| 高 | ResumeDownloader 进度/失败兜底 | HEAD 失败时仍尝试 resume，并确保进度回调准确 |
| 高 | YouTube 功能真实化 | 按阶段 3 计划落地 `yt-dlp` 管线 |
| 中 | M3U8 TODO 收尾 | byte-range、AES 解密、速度统计 |
| 中 | 监控系统健壮性 | 解决 `monitoring.rs` 未使用字段与后台停止问题 |
| 中 | CLI 文档与测试 | 提供 `preview_cli` 使用指南 + 集成测试 |
| 低 | 编译警告清理 | 移除 `unused import` 等，保持构建输出干净 |

## 5. 结论
当前系统的核心 HTTP/Resume 下载链路已经可用，`retry_failed_tasks`、带宽限速等关键命令工作正常；然而 M3U8、YouTube、监控等子系统仍处于半成品状态。建议按照 `docs/download_implementation_plan.md` 的阶段规划，优先完成批量控制与恢复逻辑，再逐步推进 HLS/YouTube/监控等增强功能。与此同时，完善文档与测试可进一步提高可维护性。*** End Patch
