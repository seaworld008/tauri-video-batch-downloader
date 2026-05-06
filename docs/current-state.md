# Current State

更新日期：2026-05-06

当前基线：`main` / `822f387 docs: polish architecture and community onboarding`

这份文档是当前仓库的事实源摘要。它只描述现在仍应维护的主链行为，不再承载历史计划、旧评审记录或已完成阶段的流水账。

---

## 1. 项目定位

Video Downloader Pro 是一个基于 **Tauri v2 + Rust + React 19 + TypeScript**
的跨平台桌面批量视频下载工具。它面向真实批量任务场景：

- 从 Excel/CSV 导入大量视频链接
- 管理可暂停、可恢复、可重试的下载队列
- 支持 HTTP/HTTPS、M3U8/HLS、YouTube 信息与格式相关能力
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

| 场景                               | 当前行为                                     |
| ---------------------------------- | -------------------------------------------- |
| 上次退出时仍为 `Downloading`       | 启动后恢复为 `Paused`，不自动继续下载        |
| 存在 `.part` 或 resume 快照        | 保留已下载字节和可续传状态                   |
| 存在最终文件和 `.vdstate` 完成标记 | 识别为 `Completed`                           |
| 任务文件缺失或损坏                 | 保留任务并给出可诊断状态，等待用户重试或清理 |

重复导入同一 Excel/CSV 时，前端任务创建 reconciliation 会区分：

- 新增任务
- 已存在任务
- 已完成任务
- 可续传任务
- 等待/失败任务

这能避免用户导入同一下载表后丢失已完成或下载到一半的进度。

---

## 5. 当前架构热点

Graphify 当前报告：

- 1520 nodes
- 2743 edges
- 67 communities

最核心节点：

1. `DownloadManager`
2. `YoutubeDownloader`
3. `HttpDownloader`
4. `PerformanceBenchmark`
5. `FileParser`
6. `ResumeDownloader`
7. `M3U8Downloader`
8. `DeploymentVerifier`
9. `EncodingDetector`
10. `DownloadRuntimeHandle`

GitNexus 当前索引摘要：

- 4795 symbols
- 9139 relationships
- 300 execution flows

修改以下区域前应优先做影响分析和测试：

- `src-tauri/src/core/manager.rs`
- `src-tauri/src/core/runtime.rs`
- `src-tauri/src/engine/task_engine.rs`
- `src-tauri/src/infra/download_event_bridge.rs`
- `src/features/downloads/state/downloadEventBridge.ts`
- `src/features/downloads/state/taskCreation*`
- `src/features/downloads/model/*`
- `src-tauri/src/core/file_parser.rs`

---

## 6. 已完成的重要收敛

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

---

## 7. 当前质量门禁

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

---

## 8. 当前仍值得继续优化

优先级见 `docs/roadmap.md`。当前最重要的方向是：

- 强化 429、断网、无 Range、磁盘权限、`.part` 损坏等下载边界测试。
- 为“上次会话恢复”增加更明确的 UI 提示和批量恢复入口。
- 扩展 M3U8 加密、`yt-dlp`、`ffmpeg` sidecar 的跨平台发布验证。
- 增加真实演示截图/短视频和 License，让社区展示更完整。
- 定期刷新 Graphify/GitNexus 摘要，避免大型代码库文档再次漂移。

---

## 9. 推荐阅读顺序

1. `README.md`
2. `docs/index.md`
3. `docs/architecture-functional-design.md`
4. `docs/current-state.md`
5. `docs/large-codebase-ai-handoff-analysis-2026-05-06.md`
6. `docs/app-regression-test-plan-2026-05-06.md`
7. `docs/roadmap.md`
