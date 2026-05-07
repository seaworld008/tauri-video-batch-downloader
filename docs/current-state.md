# Current State

更新日期：2026-05-07

当前基线：`main` 加当前未提交多平台下载兼容优化工作树

这份文档是当前仓库的事实源摘要。它只描述现在仍应维护的主链行为，不再承载历史计划、旧评审记录或已完成阶段的流水账。

---

## 1. 项目定位

Video Downloader Pro 是一个基于 **Tauri v2 + Rust + React 19 + TypeScript**
的跨平台桌面批量视频下载工具。它面向真实批量任务场景：

- 从 Excel/CSV 导入大量视频链接
- 管理可暂停、可恢复、可重试的下载队列
- 支持 HTTP/HTTPS、M3U8/HLS，并通过统一 `yt-dlp` provider 探测和下载公开视频网页
- 通过 `.part`、resume 快照和完成 marker 保留本地文件状态
- 在 App 重启后恢复任务状态，但不自动偷跑下载
- 通过 Tauri 事件桥把后端真实状态同步给前端

---

## 2. 当前正式入口

### 前端

```text
src/main.tsx
-> src/App.tsx
-> src/components/Unified/UnifiedView.tsx
-> src/stores/downloadStore.ts / src/stores/configStore.ts
-> src/features/downloads/api/*
-> src/features/downloads/state/*
```

正式主视图集中在
`UnifiedView`，导入、手动添加、任务列表、批量控制、保存位置确认和设置入口都围绕同一工作台组织。

### 后端

```text
src-tauri/src/main.rs
-> src-tauri/src/commands/*
-> src-tauri/src/engine/task_engine.rs
-> src-tauri/src/core/runtime.rs
-> src-tauri/src/core/manager.rs
-> downloader / resume / m3u8 / youtube
```

后端任务状态、并发调度、文件写入、断点恢复和事件投递以 Rust 侧为真相源。

---

## 3. 下载主链

当前下载控制链：

```text
User action
-> React component
-> feature-local state/action helper
-> feature-local Tauri API wrapper
-> Tauri command
-> TaskEngine request de-duplication
-> DownloadRuntimeHandle router
-> DownloadManager runtime_* method
-> concrete downloader
-> local file state
-> DownloadEvent
-> download_event_bridge
-> download-events
-> downloadEventBridge.ts
-> Zustand store
```

关键约束：

- 前端发起命令后应等待后端事件或 runtime refresh，不应破坏性乐观改写下载状态。
- 当前唯一下载事件信道是 `download-events`。
- 旧的 `download.events` 不是当前合法信道，只能作为历史背景出现。
- 修改事件 payload 时必须同步 Rust envelope、TypeScript
  contract 和事件 reducer 测试。

---

## 4. 启动恢复与重复导入

当前启动恢复策略：

| 场景                               | 当前行为                                         |
| ---------------------------------- | ------------------------------------------------ |
| 上次退出时仍为 `Downloading`       | 启动后恢复为 `Paused`，不自动继续下载            |
| 存在 `.part` 或 resume 快照        | 保留已下载字节和可续传状态                       |
| `.part` 大于预期总大小             | 隔离为 `.corrupt-*` 并重新开始，避免提交损坏文件 |
| `.part` 被截断                     | 按实际文件长度回收分片进度，再从缺口继续         |
| 存在最终文件和 `.vdstate` 完成标记 | 识别为 `Completed`                               |
| 任务文件缺失或损坏                 | 保留任务并给出可诊断状态，等待用户重试或清理     |

前端启动后会记录本次从后端恢复出的任务 ID，并在主工作台显示“上次会话已恢复”状态条：

- 显示可继续、等待、失败和已完成任务数量。
- “继续”调用现有批量开始入口，不抢写前端状态。
- “重试失败”调用现有失败重试入口。
- “清理完成”调用现有完成任务清理入口。
- 用户可以暂时隐藏提示。

重复导入同一 Excel/CSV 时，前端任务创建 reconciliation 会区分：

- 新增任务
- 已存在任务
- 已完成任务
- 可续传任务
- 等待/失败任务

这能避免用户导入同一下载表后丢失已完成或下载到一半的进度。

---

## 5. 多平台视频与外部工具

当前未提交工作树已经把复杂站点统一收敛到 `YtDlp` provider：

- 直连媒体文件仍走原生 HTTP/resume 下载器。
- `.m3u8` URL 仍走原生 M3U8/HLS 下载器。
- M3U8/HLS 已支持相对 key URI 解析，并能按 segment 读取和缓存不同 AES-128 key。
- YouTube、TikTok、Instagram、Facebook 和未知复杂网页走 `yt-dlp`。
- 旧 `youtube` / `Youtube` 下载器类型导入时映射到前端 `ytdlp` 和后端 `YtDlp`。
- 任务新增 `external_info`，用于保存外部平台元信息，不复用课程导入的
  `video_info`。
- 平台 host 识别已收敛到 `platform_host_rules()` registry，并使用精确 host
  / 子域匹配，避免 `youtube.com.evil.example` 这类误判。

外部工具解析优先级：

```text
用户指定路径
-> App 管理版本
-> 随包 sidecar
-> PATH fallback
```

当前工具管理能力：

- 设置页显示 `yt-dlp` / `ffmpeg` 状态、来源、当前版本和最新版本。
- `yt-dlp`
  支持 App 管理更新：下载 release、校验 checksum、校验兼容性契约、替换前备份上一版。
- `yt-dlp` App 管理更新在最终替换失败时会自动恢复上一版，避免工具链断档。
- `yt-dlp` 支持 App 管理版本回退。
- `ffmpeg` 暂不做自动在线更新，要求用户选择可信本地二进制。
- 设置页会明确提示 `yt-dlp` 的 checksum/兼容性探测/回退保护，以及 `ffmpeg`
  的可信本地文件手动更新流程。
- App 启动后会对外部工具做后台更新检查，并用 24 小时节流避免打扰。

发布注意：

- `src-tauri/binaries/` 当前包含 target
  triple 占位结构，真实发布前必须替换为真实 `yt-dlp` / `ffmpeg` 二进制。
- `pnpm build` / `pnpm build:prod`
  会先运行严格 sidecar 预检，拒绝占位文件进入生产包。
- `pnpm build:local` 使用允许占位的预检，保留本地桌面壳和 IPC smoke 的便利性。
- `pnpm sidecars:prepare` 会为当前平台准备真实 sidecar：`yt-dlp`
  下载官方 release 并校验 checksum，`ffmpeg` 默认复制 `ffmpeg-static` 或使用
  `VDP_FFMPEG_BINARY`。
- GitHub Actions release matrix 会按当前 Rust target 在打包前运行
  `scripts/prepare-sidecars.mjs` 和 `scripts/validate-sidecars.mjs`。
- 普通浏览器测试不能替代 Tauri
  IPC 和 sidecar 进程回归；涉及外部工具的验收必须跑真实桌面 App。
- 最近一次真实 Tauri dev App 冒烟记录见 `docs/tauri-smoke-2026-05-07.md`。
- 真实 Tauri MCP Bridge smoke 已固化为 `pnpm test:tauri-smoke`，运行方式见
  `docs/tauri-e2e.md`。

## 6. 当前架构热点

Graphify 当前报告：

- 3543 nodes
- 6836 edges
- 233 communities

最核心节点：

1. `DownloadManager`
2. `YoutubeDownloader`
3. `invokeTauri()`
4. `HttpDownloader`
5. `reportFrontendDiagnosticIfEnabled()`
6. `PerformanceBenchmark`

GitNexus 对当前未提交工作树的影响检查：

- changed symbols：216
- affected symbols/processes：69
- risk level：critical

修改以下区域前应优先做影响分析和测试：

- `src-tauri/src/core/manager.rs`
- `src-tauri/src/core/runtime.rs`
- `src-tauri/src/engine/task_engine.rs`
- `src-tauri/src/infra/download_event_bridge.rs`
- `src/features/downloads/state/downloadEventBridge.ts`
- `src/features/downloads/state/taskCreation*`
- `src/features/downloads/model/*`
- `src-tauri/src/core/downloader.rs`
- `src-tauri/src/core/ytdlp_downloader.rs`
- `src-tauri/src/core/external_tools.rs`
- `src-tauri/src/core/external_tool_update.rs`
- `scripts/validate-sidecars.mjs`

---

## 7. 已完成的重要收敛

- README、文档导航、架构设计、AI handoff 文档已统一到 2026-05-06 当前状态。
- GitHub 仓库 description、homepage、topics、Issues、Discussions、Wiki、labels、issue
  templates、PR template 已完成社区化配置。
- `package.json#engines` 已声明 Node.js >= 20、pnpm >= 9。
- 主 Tauri CSP 已移除生产配置中的
  `'unsafe-eval'`，仅本地测试配置保留开发所需放行。
- `event_sender.unwrap()` 潜在 panic 已改为显式错误返回。
- 启动恢复已避免自动继续上次未完成的下载。
- 事件信道已规范为 Tauri v2 合法的 `download-events`。
- 前端下载命令、导入、配置、runtime query、系统能力已基本收敛到 feature-local
  API wrappers。
- 当前文档库已清理为“最新事实源 + 当前路线 + 当前测试/质量说明”，历史计划和过期评审不再作为默认阅读材料。
- HTTP Range 被服务端忽略时会安全重下，避免把 200 响应追加到旧 `.part`
  导致文件损坏。
- 下载边界测试已覆盖 429、输出路径冲突、截断响应、Range 416、Range
  ignored、`.part` 过大/截断恢复和 M3U8 byte-range ignored。
- M3U8 相对 segment、相对 key
  URI、byte-range 和同一 playlist 多 key 加密处理已补强。
- 多平台公开视频下载已经统一进入 `yt-dlp`
  provider，不再把 YouTube 当作特殊前端拦截。
- 外部工具已经具备检测、手动更新、用户 override、兼容性契约检查、最终替换失败恢复和回退链路。
- sidecar 发布链已增加严格预检，覆盖 `externalBin`、capability、target
  triple 文件、可执行权限和占位文件拦截。
- 真实 Tauri E2E smoke 已增加 MCP
  Bridge 脚本，覆盖后端状态、窗口注册/可见性和原生截图。
- 上次会话恢复 UX 已增加主工作台状态条，提供批量继续、重试失败和清理完成入口。
- 任务列表提供复制诊断入口，诊断文本包含任务 ID、URL、状态、下载器、平台 extractor、进度、文件路径、错误分类和日志位置。
- `yt-dlp` 平台识别已预留 registry 入口，后续新增平台只需扩展规则和必要 schema。

---

## 8. 当前质量门禁

常规提交前建议运行：

```bash
pnpm type-check
pnpm lint
pnpm exec vitest run
pnpm exec vitest run --config vitest.config.integration.ts
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

如果改动涉及下载核心、恢复、导入或事件契约，应再跑对应 focused
tests，并用 GitNexus `detect_changes` 看影响面。

2026-05-07 当前未提交工作树最近一次已确认通过：

- `pnpm type-check`
- `pnpm lint`
- `pnpm exec vitest run`：52 个测试文件，280 个测试
- `pnpm exec vitest run --config vitest.config.integration.ts`：2 个测试文件，14 个测试
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`：lib 152 个测试，main
  151 个测试
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- `pnpm sidecars:check:local`：允许占位文件的本地 smoke 预检通过
- `git diff --check`

真实 App 冒烟：

- `pnpm tauri info`
- `pnpm tauri dev` 冷启动和重启
- `pnpm test:tauri-smoke` 真实 MCP Bridge smoke
- MCP Bridge backend/window 状态读取
- MCP Bridge 原生截图

尚未通过真实 App 验收的阻塞项：

- 真实 `yt-dlp` / `ffmpeg`
  sidecar 二进制仍未替换占位文件；严格发布预检会拦截生产构建。
- `pnpm sidecars:check` 严格发布预检当前按预期失败，原因是本机 target 的
  `yt-dlp` / `ffmpeg` 仍为占位文件。
- 公开视频下载、合并、取消链路需在真实 sidecar 发布链完成后补跑。
- MCP Bridge `execute_js` 当前受 `withGlobalTauri=false` 限制，真实 E2E
  smoke 默认不依赖 JS 注入结果。

---

## 9. 当前仍值得继续优化

优先级见 `docs/roadmap.md`。当前最重要的方向是：

- 强化 429、断网、磁盘权限、`.part` 损坏、最终文件冲突等下载边界测试。
- 为“上次会话恢复”增加更明确的 UI 提示和批量恢复入口。
- 扩展 M3U8 加密、长 playlist、失败 segment retry、`yt-dlp` / `ffmpeg`
  sidecar 的跨平台发布验证。
- 增加真实演示截图/短视频和 License，让社区展示更完整。
- 定期刷新 Graphify/GitNexus 摘要，避免大型代码库文档再次漂移。

---

## 10. 推荐阅读顺序

1. `README.md`
2. `docs/index.md`
3. `docs/architecture-functional-design.md`
4. `docs/current-state.md`
5. `docs/large-codebase-ai-handoff-analysis-2026-05-06.md`
6. `docs/app-regression-test-plan-2026-05-06.md`
7. `docs/roadmap.md`
