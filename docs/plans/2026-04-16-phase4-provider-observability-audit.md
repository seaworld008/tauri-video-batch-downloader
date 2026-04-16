# Phase 4 Provider / Observability Audit

Updated: 2026-04-16
Status: audit-first baseline

## Goal

在进入 Phase 4 的代码清理前，先把 provider / capability / monitoring / system-info 当前真实状态盘清，避免对着历史命名做错误重构。

## Evidence Summary

### 1. Provider surface 现状

审计文件：
- `src-tauri/src/infra/providers/mod.rs`
- `src-tauri/src/infra/providers/http_provider.rs`
- `src-tauri/src/infra/providers/m3u8_provider.rs`
- `src-tauri/src/infra/providers/youtube_provider.rs`

结论：
- `DownloaderProvider` trait 当前仅存在于 `infra/providers/*` 自身模块表面，未发现生产调用方把它作为正式调度主链使用。
- `HttpDownloadProvider` 只是 `DownloadRuntimeHandle` 的薄代理，并未出现在当前正式命令主链里。
- `M3u8DownloadProvider` / `YoutubeDownloadProvider` 仍是明确的 stub，所有 `start/pause/resume/cancel` 都直接返回 `"not wired yet"`。
- 这些 provider stub 更像“未启用的半成品接口层”，不是当前系统真实工作路径。

风险判断：
- 这块表面很可能属于 Phase 4 的 mainline-only cleanup 候选。
- 当前环境已有 Rust toolchain，可做 `cargo check` / `cargo test` / `cargo clippy` 级别验证；但受 Tauri test 链接 OOM 约束影响，仍应优先选择低 blast-radius 清理并以 `cargo check` 作为本轮最可靠证据。

### 2. Capability path 现状

审计文件：
- `src-tauri/src/infra/capability_service.rs`
- `src-tauri/src/commands/system.rs`

结论：
- `ToolCapabilityService::is_available()` 是真实被 `check_ffmpeg` / `check_yt_dlp` / `get_video_info` 复用的能力探测入口。
- 本轮活体验证再次确认：`commands/system.rs` 中 `check_tool_availability()` 直接调用 `ToolCapabilityService::is_available(tool_name, args)`，而 `capability_service.rs` 自身只是基于 `tokio::process::Command` 的小型工具探测封装。
- 此前 capability service 与 provider stub 同处 `infra/providers/` 目录、语义混杂；本轮已完成 mainline-only cleanup：将其迁到 `src-tauri/src/infra/capability_service.rs`，并删除空壳 `infra/providers` 模块命名空间。
- 因此当前能力探测主链已与已删除 provider stub 目录表面解耦，但 capability service 仍应继续视为正式主链基础设施，而不是 provider abstraction 的一部分。

后续建议：
- Phase 4 后续可继续围绕 capability probe 语义与测试覆盖做收敛，但“从 providers 命名空间迁出”这一目录语义修复已经完成。

### 3. System info / observability 现状

审计文件：
- `src-tauri/src/commands/system.rs`
- `src/components/Unified/StatusBar.tsx`
- `src-tauri/src/core/monitoring.rs`
- （历史已删除）`src/hooks/useSystemInfo.ts`
- （历史已删除）`src/components/Layout/StatusBar.tsx`

结论：
- 此前前端 `useSystemInfo()` 每 5 秒轮询一次 `get_system_info`，且只服务旧 `Layout/StatusBar` 的 CPU / 内存 / 网络信息展示；本轮在确认这条表面已完全脱离当前 `src/` 主链后，已按 mainline-only cleanup 直接删除 `useSystemInfo` 与整组 `Layout/*` 壳层，因此当前前端正式主链不再直接消费 `get_system_info`。
- 经过前两轮最小真实收敛后，`get_system_info()` 当前语义为：
  - CPU 使用率：实时
  - 内存使用率：实时
  - 磁盘使用率：实时
  - 网络速度下载侧：复用 `DownloadManager.get_stats().display_total_speed_bps`
  - 网络速度上传侧：placeholder（固定 `0.0`）
  - active_downloads：复用 `DownloadManager.get_stats().active_downloads`
- 在删除旧 Layout 表面前，`Layout/StatusBar` / `Sidebar` 的“活跃任务数”就已活体验证为使用 `downloadStore.stats.active_downloads` 作为 UI 真源，而不是 `get_system_info`；本轮删除只是在此基础上把这条非主链 observability 表面真正移除，而不是改变正式 UI 真源。
- 因此前端当前真正成立的 observability 主链是：`Unified/StatusBar` 读取 `downloadStore`；`get_system_info` 已不再被正式前端主链消费。
- 本轮继续活体验证后确认：前端 `src/` 内对 `get_system_info` 的最后一个调用点原本是 `src/App.tsx` 的启动探测；该探测结果并不驱动正式 UI，因此已按 mainline-only cleanup 删除，并把 `App.tsx` 启动链收敛为 `initializeDownloadEventBridge() -> loadConfig() -> initializeStore()`，同时补上 `src/App.test.tsx` focused 契约测试。随后再次做内容搜索确认 `src/` 中生产代码已无 `get_system_info`、`show_in_folder`、`validate_url`、`check_ffmpeg`、`check_yt_dlp` 调用方；其中 `get_system_info` 早已不在 `main.rs` 的 Tauri `invoke_handler` 正式暴露面，本轮又继续把其余 4 个无正式前端消费者的旧 system/tool commands 从 `invoke_handler` 移除，因此这组命令现已不再属于当前正式 command surface。
- 因此，当前 observability 里真正仍不可信/未收口的重点已进一步收缩为网络上传速度语义，以及 `MonitoringSystem` 与真实消费者的边界。
- 当时的结论是：大型 `core/monitoring.rs` / `MonitoringSystem` 既无正式前端消费者，也不再属于 authoritative mainline，因此随后已按 mainline-only cleanup 从源码树删除；当前 observability 审计已不再以这套历史模块为中心。

风险判断：
- 当前 observability 仍存在“双表面”，但消费边界需要更细地拆开：
  1. CPU / 内存 / 磁盘 / 下载速度等 system info 当前只剩后端命令表面，并未被正式前端主链消费
  2. 活跃任务数当前走 `downloadStore.stats.active_downloads`
  3. 代码体量最大的却是 `MonitoringSystem`
- 若不先审计真实消费者，直接围绕 `MonitoringSystem` 大改，容易做成对 UI 无效的重构。
- 本轮继续活体内容搜索确认：`DownloadManager` 暴露的 monitoring facade（`get_dashboard_data` / `get_download_statistics` / `get_health_status` / `add_dashboard_client` / `remove_dashboard_client` / `get_prometheus_metrics`，以及当时尚未清理的 `get_performance_metrics` / `set_prometheus_enabled` / `set_websocket_dashboard_enabled`）在 `src-tauri/src/commands/*` 与正式前端中均无生产调用，命中仅存在于 `core/*integration_tests.rs`。
- 基于该证据，已继续做低风险 production-surface cleanup：先前把上述 manager methods 用 `#[cfg(all(test, feature = "integration-tests"))]` 收回 integration-test 编译面并删除 `update_monitoring_stats()`；最新几轮又进一步删除 test-only placeholder `set_prometheus_enabled()` / `set_websocket_dashboard_enabled()`、删除无人调用的 `get_performance_metrics()` / `build_performance_metrics_snapshot()` 与 `DownloadEvent::PerformanceMetricsUpdated`，并把 `DashboardData` / `MonitoringConfig` / `MonitoringSystem` import、`monitoring_system` bootstrap 字段及整块 `core/monitoring.rs` 模块导出继续压回当时的旧测试债务面；与此同时，又把 frontend diagnostics 落盘逻辑抽到 `utils/logging.rs::append_frontend_log_entry()`，让 `commands/system.rs::log_frontend_event` 与 `main.rs` setup 共享同一内部 helper，避免后端 bootstrap 再经 tauri command 自调用自己写 `frontend.log`；本轮又继续删除 `main.rs` 中无正式前端消费者的 `app_ready` / `download_manager_ready` / `download_manager_error` bootstrap event emit，进一步收口后端 setup 的旧事件表面。对应 fresh Rust 证据为 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`、`~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 与 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests --features integration-tests` 通过。
- 本轮再继续做了一刀前端 observability 主线收口：fresh 内容搜索确认当前生产 `src/` 中的 `console.*` 残余只剩 `src/main.tsx` 对 `console.error` 的 monkey patch，而正式 diagnostics 主链早已收敛到 `utils/frontendLogging.ts` + `window error/unhandledrejection` 监听 + 显式 `reportFrontendEventIfEnabled/reportFrontendIssue` 调用。基于该证据，已按 mainline-only cleanup 删除 `src/main.tsx` 的 `console.error` monkey patch，使生产主链不再通过 monkey patch 隐式拦截 console error；测试控制逻辑仍仅保留在 `src/test/setup.ts` 与 `src/__tests__/setup/integration.setup.ts`。对应 fresh 前端证据为 `~/.hermes/node/bin/corepack pnpm type-check` 通过，以及 `~/.hermes/node/bin/corepack pnpm exec vitest run src/App.test.tsx src/features/downloads/api/__tests__/commands.test.ts src/components/Unified/__tests__/FileImportPanel.test.tsx src/stores/__tests__/downloadStore.test.ts` 通过（4 files / 45 tests）
- 当前执行环境已可用 `~/.cargo/bin/cargo`，因此本轮已补上 fresh Rust 证据：`~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 通过；但 `cargo test --manifest-path src-tauri/Cargo.toml --features integration-tests ...` 仍被大量历史失配测试阻塞，所以当前只能宣称“生产编译面收口 + 调用面搜索验证 + cargo check 通过”，不能宣称 Rust 测试面已通过。

### 4. Download command surface 现状

审计文件：
- `src-tauri/src/commands/download.rs`
- `src-tauri/src/main.rs`
- `src` 下命令调用搜索结果

结论：
- 在本轮收口前，`resume_all_downloads` / `start_all_pending_downloads` / `cancel_all_downloads` 仍注册在 Tauri command 表面。
- 本轮再次对前端 `src/` 做内容搜索，`resume_all_downloads|start_all_pending_downloads|cancel_all_downloads` 命中数为 `0`，未发现 TS/TSX 调用方。
- 当前前端主链实际使用的是：
  - `start_all_downloads`
  - `pause_all_downloads`
  - 单任务 start/pause/resume/cancel
- 同一轮继续对 YouTube command surface 做 live consumer audit，前端 `src/` 中 `get_youtube_info|get_youtube_formats|download_youtube_playlist` 命中数为 `0`，未发现 TS/TSX 正式调用方；与此同时，当前前端真正走的是 `features/downloads/api/systemCommands.ts::getVideoInfoCommand -> invoke('get_video_info') -> commands/system.rs::get_video_info_impl()`，其 YouTube 分支只复用 `commands::youtube::get_youtube_info_internal()`。

风险判断：
- 由于前端 `src/` 内容搜索仍为 0 命中，本轮已先把这三个命令从 `src-tauri/src/main.rs` 的 Tauri `invoke_handler` 正式注册面移除，避免继续暴露当前正式主链不用的批量控制入口。
- 随后在具备 Rust 编译验证能力的当前环境里，又继续完成 live consumer audit：`runtime` 与透传 wrapper 删除后，`DownloadManager` 内 `resume_all_downloads()` / `start_all_pending()` / `cancel_all_downloads()` 也已无任何 Rust 主链调用者。因此这组三个 manager 内部 dead façade 已进一步按 mainline-only cleanup 真删除，并以 fresh `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo check --manifest-path src-tauri/Cargo.toml --tests` 作为低风险通过证据。
- 基于同样的“无正式消费者”证据，本轮也已对 YouTube command surface 做第二刀 mainline-only cleanup：`src-tauri/src/main.rs` 里 `get_youtube_info` / `get_youtube_formats` / `download_youtube_playlist` 的 Tauri command 注册已移除；随后又删除 `src-tauri/src/commands/youtube.rs` 中仅服务这三条已下线 command 的 wrapper、playlist 分支、playlist parser/helper，以及 `commands/mod.rs` 中已失效的 `pub use youtube::*`，仅保留仍被 `commands/system.rs::get_video_info_impl()` 复用的 `get_youtube_info_internal()` 与必要 helper。对应 fresh Rust 证据同样是 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 与 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 通过。
- 但这仍不等于 Phase 4 完成：更深的 monitoring / dashboard / prometheus 表面仍需继续基于真实消费者和可验证编译面逐步审计，不能跳过后续全量验证。
- 最新一轮继续按同一原则向下审计 `MonitoringSystem` 深层表面：fresh 内容搜索确认 `register_dashboard_client` / `unregister_dashboard_client` / `get_current_dashboard_data` / `export_prometheus_metrics` 仍被 `DownloadManager` 的 legacy façade 间接复用，因此这批核心方法暂不动；但 `core/monitoring.rs` 中 `get_system_metrics_history` / `get_download_stats_history` / `get_performance_metrics_history` 与 `PrometheusExporter` 在当前仓库内已无任何正式或测试消费者。此外，`prometheus_export_enabled` / `prometheus_export_port` 也已只剩结构体字段、默认值与 manager bootstrap 赋值，而没有任何行为消费点。本轮已据此继续做最小 dead-surface cleanup，删除这些 helper/exporter 与 fake config 字段，并再次以 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` + `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 通过作为 fresh 证据。
- 最新一轮继续按同一原则向下审计底层 snapshot base：在删除 `PerformanceMetrics` / `performance_metrics_history` 后，fresh 内容搜索又确认 `DownloadStatistics`、`download_stats_history` 与 `HealthStatus.download_health` 在现行主干里也只剩模块内部残留和 legacy test 漂移面，因此本轮继续将这条 download residue 从快照结构、health 聚合与 cleanup 残留中移除。当前 `get_current_dashboard_data()` 已进一步收窄为仅返回 `system_metrics + recent_errors + health_status` 的极简 snapshot，而 `export_prometheus_metrics()` 继续保持 system metrics only。对应 fresh Rust 证据仍为 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 与 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 通过。
- 最新一轮再继续做整块退出判定：fresh 内容搜索确认 `core/monitoring.rs` 的剩余 consumer 已不再是现行 frontend / commands / runtime / manager authoritative mainline，而只剩旧测试债务；同时 `manager.rs` 对 `MonitoringSystem` 的接线也只剩 cfg import/field/bootstrap、没有任何真实使用。因此本轮已直接删除 `src-tauri/src/core/monitoring.rs` 与 `src-tauri/src/core/monitoring_integration_tests.rs`，并同步删掉 `core/mod.rs` 的模块接线与 `manager.rs` 中仅服务该模块的 cfg 残留。新结论是：`MonitoringSystem` 已不再是“legacy debt compile surface”，而是已经实质退出当前源码树。
- 随后的方向变化也已经明确：用户要求“当前仓库就是最新重构版本，不要历史包袱”，因此 Rust 侧剩余旧测试分区已整体删除，而不是继续保留为单独 feature。当前事实是：`src-tauri/src/core/` 下仅服务旧分区的 7 个测试文件已删除，`core/mod.rs` 中对应模块接线已移除，`file_parser.rs` 中仅供旧测试使用的 helper seam 已删除，`src-tauri/Cargo.toml` 中对应的旧测试 feature 也已移除。对应 fresh 证据为 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`、`~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests`、`~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests --features integration-tests` 全部通过，`bash ./scripts/graphify-sync.sh smart` 也再次通过。新的事实基线是：Phase 4 不再需要为历史 Rust test partition 预留空间，下一步应转向 completion gate 所需的更高层验证与工具链缺口（尤其 `cargo-clippy` / `rustfmt` 缺失）的根因治理。

## Recommended Execution Order

1. 先做 Observability audit-first 收口
   - 明确 `get_system_info` 哪些字段是真实、哪些是 placeholder
   - 明确 `MonitoringSystem` 是否有当前 UI 消费者
   - 在拿到 Rust 编译验证能力后，再决定是否继续删除 `MonitoringSystem` / dashboard / prometheus 深层表面

2. 再做 Provider surface cleanup 决策
   - 若确认 `DownloaderProvider` / `M3u8DownloadProvider` / `YoutubeDownloadProvider` 无生产入口，可在有 Rust 验证环境时做 mainline-only 删除
   - capability service 已保留并完成迁出 `providers/` 命名空间；后续重点转为测试与语义命名的持续收敛

3. 最后处理未消费 command surface
   - 已完成 `resume_all_downloads` / `start_all_pending_downloads` / `cancel_all_downloads` 的调用者审计与 command/runtime/manager 三层 mainline-only 删除
   - 后续转为继续审计 monitoring / dashboard / prometheus 深层表面，而不是回退保留这组三个 dead batch façade

## Current Decision

Phase 4 现在应视为：
- 不是“直接大改 provider / monitoring”
- 而是“基于真实消费者和真实协议的 audit-first convergence”
