# 2026-05-06 系统全面优化执行记录

本记录对应“下载核心稳定性优先的激进重构”第一轮实施。目标不是一次性完成所有大型拆分，而是先把下载状态机的测试护栏和第一层内部边界建立起来，再继续推进后续拆分。

## 已完成

- 后端新增
  `src-tauri/src/core/manager/state.rs`，把单任务 start/pause/resume/cancel 的状态决策从
  `DownloadManager` runtime 方法中抽出。
- 新增内部类型：
  - `TaskTransitionDecision`
  - `QueueAdmissionResult`
  - `WorkerLifecycleAction`
- `runtime_start_download()`
  现在通过状态决策 helper 统一拒绝 active/terminal 状态，并通过
  `QueueAdmissionResult` 判断并发排队。
- `runtime_pause_download()`、`runtime_resume_download()`、`runtime_cancel_download()`
  复用状态 helper 修改任务状态，减少内联状态分支。
- 新增后端 focused 测试，覆盖：
  - start 拒绝 `Downloading` / `Committing` / `Completed` / `Cancelled`
  - failed task 在并发满时入队并清理 error
  - pause 拒绝 terminal/committing 状态
  - pending task pause 后标记 paused 并发出事件
  - resume 拒绝 terminal/committing 状态
  - paused task 在并发满时进入队列
  - queued task cancel 后移出队列并发出事件
- 前端新增
  `src/features/downloads/model/downloadDiagnostics.ts`，提供用户可见下载诊断分类：
  - 最大并发
  - 权限不足
  - HTTP 429 / rate limit
  - yt-dlp/youtube-dl 缺失或执行失败
  - JSON 解析失败
  - `.part` 文件异常
  - 网络异常
- `commandControlEffects.ts`
  已改为通过下载诊断模型识别并发排队，并在本地日志开启时记录结构化诊断。
- `downloadStore.ts`
  的并发排队 toast 文案已改为更准确描述“进入等待/恢复队列，下载槽空出后自动继续”。

## 已验证

- `pnpm type-check`
- `pnpm exec vitest run src/features/downloads/model/__tests__/downloadDiagnostics.test.ts src/features/downloads/state/__tests__/commandControlEffects.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
- `cargo test --manifest-path src-tauri/Cargo.toml runtime_start`
- `cargo test --manifest-path src-tauri/Cargo.toml runtime_pause`
- `cargo test --manifest-path src-tauri/Cargo.toml runtime_resume`
- `cargo test --manifest-path src-tauri/Cargo.toml runtime_cancel`

## 下一轮建议

- 继续从 `DownloadManager` 中拆 `manager_persistence`，优先移动
  `load_persisted_state()`、`persist_state()`、hydration snapshot 相关逻辑。
- 再拆 `queue_policy`，把 `TaskPriority`、enqueue/remove/process
  queue 的策略与 manager facade 分开。
- 在拆 worker 生命周期前，先补 active handle abort、pause flush、completion
  event ordering 的 focused 测试。
- 前端下一步把诊断模型接入任务行/详情面板，而不是只用于 toast 与日志。
