# Current State

**Updated:** 2026-04-16

这份文档描述的是**当前真实状态**，不是目标架构，也不是历史设计草案。

---

## 1. 项目定位

Video Downloader Pro 是一个基于 **Tauri v2 + Rust + React** 的跨平台桌面批量视频下载器，核心关注点是：

- 批量任务导入与管理
- 多协议下载（HTTP / M3U8 / YouTube 相关能力）
- 断点续传与失败恢复
- 前后端状态同步
- 为后续持续演进保留可观测性与规划能力

当前项目**不是从零开始的新项目**，而是一个已经具备主链路、但正在进行架构收敛的 brownfield 仓库。

---

## 2. 当前正式主路径

### Frontend
当前正式主入口：
- `src/main.tsx`
- `src/App.tsx`（启动链已收敛为 `initializeDownloadEventBridge()` + `configStore.loadConfig()` + `downloadStore.initializeStore()`；不再把 `get_system_info` 当作前端 bootstrap 探针，也不再复活独立 bootstrap error screen 来分叉正式主视图）

当前正式主视图路径：
- `src/App.tsx`
- `src/components/Unified/UnifiedView.tsx`
- `src/components/Unified/StatusBar.tsx`

### Backend
当前正式 Rust/Tauri 入口：
- `src-tauri/src/main.rs`

### 下载控制主链
当前下载主控制链大致为：

```text
commands/download.rs
-> TaskEngine
-> DownloadRuntime
-> DownloadManager(runtime_*)
-> downloader / resume / m3u8 / youtube
-> DownloadEvent
-> main.rs event bridge
-> frontend listener/store
```

---

## 3. 当前主要结构问题

### 已移除的历史入口
以下历史入口/调试入口已不再保留在当前仓库主表面：

- `src/main-simple.tsx`
- `src/main-minimal.tsx`
- `vite.config.simple.ts`
- `vite.config.minimal.ts`
- `index-simple.html`
- `index-minimal.html`
- `src-tauri/src/main-simple.rs`
- `src-tauri/src/main-minimal.rs`
- `src-tauri/src/main-fixed.rs`
- `src-tauri/src/main-original.rs`
- `src-tauri/tauri-minimal.conf.json`

这些文件属于历史排障/试验路径，已不再作为当前仓库的一部分维护。

### 3.2 后端写路径第一阶段收敛已完成
当前 `commands/*` 层的核心 mutation 已统一收进 `DownloadRuntime`，包括：

- 任务新增
- 输出路径更新
- 配置同步到下载核心
- 速率限制
- 导入后入队
- 单任务/批量删除
- 已完成任务清理
- failed -> pending 的 retry reset

另外，`main.rs` 中原本内联的大段下载事件桥接逻辑，已经抽出到：
- `src-tauri/src/infra/download_event_bridge.rs`

这意味着 Phase 2 的第一波目标已经完成：
- command 层不再直接 `download_manager.write().await` 执行核心 mutation
- backend mutation 主链已统一到 runtime
- event bridge 已从 `main.rs` 中拆出一个明确 seam


### 3.3 前端状态同步仍是三轨并存，但 Phase 3 已开始收敛
当前前端同步主链已经进一步收紧为：

- `download.events`
- invoke 后主动 refresh（作为补偿）
- 条件轮询（作为补偿）

目前已完成的第一批前端收敛包括：
- 从 `downloadStore.ts` 中抽出 `src/features/downloads/state/downloadEventBridge.ts`
- 去掉 `main.tsx` 与 `App.tsx` 的重复 listener 初始化
- `downloadStore.initializeStore()` 不再重复调用 `get_config`，启动配置链优先由 `configStore.loadConfig()` 驱动
- `downloadStore.updateConfig/resetConfig` 兼容包装已删除，配置写路径现在只保留 `configStore`
- `configStore` 当前又通过 `src/features/downloads/api/configCommands.ts` 统一封装 `get_config` / `update_config` / `reset_config` / `export_config` / `import_config`，不再在 store 内零散直连 Tauri；同时修复了此前 `export_config` 前端误传 `configData`、而 Rust 命令实际要求 `file_path` 的契约漂移，并新增 `src/stores/__tests__/configStore.test.ts` + `src/features/downloads/api/__tests__/configCommands.test.ts` 锁定该配置主链
- `downloadStore` 的 runtime query 当前又通过 `src/features/downloads/api/runtimeQueries.ts` 统一封装 `get_download_tasks` / `get_download_stats`，`runtimeSync.ts`、`validationHelpers.ts`、`initializeStoreBootstrap.ts`、`initializeStoreStoreAction.ts`、`stateValidator.ts` 与 `downloadStore.ts` 已统一复用该 query seam，不再在 store / validator 主体中直接持有这组命令名；围绕这层收敛的 fresh focused verification 为 `src/features/downloads/api/__tests__/commands.test.ts` + `src/features/downloads/state/__tests__/runtimeSync.test.ts` + `src/features/downloads/state/__tests__/validationHelpers.test.ts` + `src/features/downloads/state/__tests__/initializeStoreBootstrap.test.ts` + `src/features/downloads/state/__tests__/initializeStoreStoreAction.test.ts` + `src/stores/__tests__/downloadStore.test.ts`（6 个测试文件、52 个测试通过）与 `pnpm type-check`
- `DashboardToolbar` 这条当前正式 control/observability toolbar 主链也已补 focused test：新增 `src/components/Downloads/__tests__/DashboardToolbar.test.tsx`，锁定“打开下载目录必须经 `openDownloadFolderCommand()` 共享 seam”“设置入口必须走 `onOpenSettings -> UnifiedView.settings-drawer` 主链”“清理残留任务必须先经过确认对话框再批量删除 inactive tasks” 3 条 contract；对应 fresh 验证为 `DashboardToolbar` + `UnifiedView` targeted suite（2 个测试文件、4 个测试通过）与 `pnpm type-check`
- `downloadStore` 新增 `syncRuntimeState()`，命令动作后的 refresh 补偿与 `downloadEventBridge` 的 polling 补偿开始收口到统一 runtime sync 入口
- `start/pause/resume/cancel/startAll/pauseAll` 的 Tauri 调用已抽到 `src/features/downloads/api/downloadCommands.ts`，`downloadStore` 对控制命令的直接 invoke 细节开始减少
- Phase 4 又继续把当前前端仍在用的非下载系统能力收敛到 `src/features/downloads/api/systemCommands.ts`：当前统一封装 `get_video_info` / `open_download_folder` / `log_frontend_event` 这组仍经后端命令暴露的能力，同时把 `selectOutputDirectoryCommand()` 收敛到真正的前端 dialog 主链 —— 直接使用 `@tauri-apps/plugin-dialog` 选择目录，而不再经后端 `select_output_directory` placeholder 兜一个假 system command；`DashboardToolbar` / `ManualInputPanel` / `FileImportPanel` / `SettingsView` 以及 `main.tsx` 的 frontend bootstrap logging 也因此逐步不再在组件内零散直连 `invoke(...)` 这些能力。最新一轮 fresh verification 又真实发现该 seam 中的 `open(...)` 调用会被 TypeScript 误判到 DOM `window.open` 签名，因此现已进一步改为显式 `dialog.open(...)` 命名空间调用，并以 `pnpm type-check` + 当前主链 focused Vitest 重新确认目录选择主链稳定。本轮又继续把 `ManualInputPanel.tsx` 与 `SettingsView.tsx` 中残留的直接 `plugin-dialog` 调用收口到这条共享 seam，同时把 `ManualInputPanel` 内零散 `get_video_info` 直连一并迁入 `getVideoInfoCommand()`，并新增 `src/components/Unified/__tests__/ManualInputPanel.test.tsx` 与 `src/components/Settings/__tests__/SettingsView.test.tsx` 锁定“目录选择必须经 `selectOutputDirectoryCommand()`”这条 contract。随后再继续沿同一方向收敛，`DashboardToolbar.tsx` 的“本次更改位置”与 `FileImportPanel.tsx` 的输出目录选择也都统一复用 `selectOutputDirectoryCommand({ defaultPath, title })`，并以 `src/components/Downloads/__tests__/DashboardToolbar.test.tsx` + `src/components/Unified/__tests__/FileImportPanel.test.tsx` + `src/features/downloads/api/__tests__/commands.test.ts` 做 fresh verification，进一步防止组件层回退为零散 dialog 直连。继续做 live audit 后又确认旧 `src/components/Youtube/YoutubeUrlInput.tsx` 在当前正式主链中已无任何 import/consumer，因此已按 mainline-only cleanup 从工作树删除，避免仓库继续保留一条未接入 `UnifiedView`、也未被当前前端真实消费的 YouTube 旧入口死路径。 [truncated]
- 本轮继续把 Phase 4 observability 主链从 store/action seam 延伸到更靠近应用兜底层的正式表面：`src/utils/stateValidator.ts`、`src/utils/errorHandler.ts` 与 `src/components/Common/ErrorBoundary.tsx` 中原先残留的 `console.*` 已统一改经 `src/utils/frontendLogging.ts` 的 `reportFrontendDiagnostic*()` / `reportFrontendIssue()` 上报；同时补入 `src/utils/__tests__/stateValidator.test.ts`、`src/utils/__tests__/errorHandler.test.ts` 与 `src/components/Common/__tests__/ErrorBoundary.test.tsx`，并 fresh 跑通 `~/.hermes/node/bin/corepack pnpm type-check` + targeted Vitest（6 files / 16 tests），从而把 frontend logging contract 从前端下载 state seam 继续推进到运行时校验、共享错误处理与顶层 React error boundary。最新一轮又继续把 `src/utils/stateValidator.ts` 的 placeholder sync strategy 表面收薄到真实语义：移除未实现且无消费者的 `USE_FRONTEND` / `MERGE`，统一为 `USE_BACKEND` / `MANUAL_RESOLVE` 两档，并以 `src/utils/__tests__/stateValidator.test.ts` + `src/features/downloads/state/__tests__/validationFlow.test.ts` + `src/features/downloads/state/__tests__/validationResultFlow.test.ts` + `src/features/downloads/state/__tests__/validationStoreAction.test.ts`（4 files / 12 tests）及 `pnpm type-check` 做 fresh verification，避免前端继续暴露不存在的 merge/frontend-authoritative contract
- 本轮继续把 Phase 3 抽出的 `src/features/downloads/state/` helpers 全面纳入同一套 observability 主链：`downloadEventBridge.ts`、`commandControlEffects.ts`、`batchControlEffects.ts`、`validationStoreAction.ts`、`initializeStoreStoreAction.ts`、`taskCreation*` / `importFile*` / `importOrchestration.ts` 等文件中残留的 35 处 `console.*` 已统一改经 `reportFrontendDiagnostic()` / `reportFrontendDiagnosticIfEnabled()` / `reportFrontendIssue()` 上报，不再让 extracted store/action seams 各自保留本地 console 语义；随后又继续把 `downloadStore.ts` 剩余 9 处 info-level `console.*` 与 `FileImportPanel.tsx` 的 `refreshTasks().catch(console.warn)` 收口到同一套 seam；围绕这两轮收敛的 fresh focused verification 分别为 14 个 state helper/store seam 测试文件（46 tests 通过）以及 `downloadStore.test.ts` / `FileImportPanel.test.tsx` / `commands.test.ts` 等 6 个测试文件（48 tests 通过），并都再次跑通 `pnpm type-check`
- 最新一轮又继续沿正式 UI/runtime 链路做 consumer audit：此前已把 `src/i18n/hooks.ts` 与 `src/i18n/index.ts` 中残留的 `console.*` 统一改经 shared frontend logging seam，上报为稳定的 `i18n:*` 事件名，并删除 `LanguageSelector.tsx` 上层冗余 catch；本轮再继续确认 `src/hooks/useAutoSync.ts`、`src/components/Performance/PerformanceDashboard.tsx`、`src/utils/performanceMonitor.tsx`、`src/hooks/useOptimization.ts`、`src/components/Downloads/VideoTableItem.tsx`，以及只服务旧导入壳层的 `src/hooks/useImportGuide.ts` 在当前 `src/` 正式主链内已无生产消费者，因此已按 mainline-only cleanup 从工作树删除；同时把 `src/utils/dataValidator.ts` 中残留的 validation failure `console.error` 收口到共享 `src/utils/frontendLogging.ts` seam。围绕这轮收口的 fresh 验证为 `~/.hermes/node/bin/corepack pnpm type-check`；fresh 内容搜索同时确认 `src/` 生产代码里的 `console.*` 残留已从 47 处进一步降到 24 处，当前仅剩 `src/main.tsx` 的有意 console interception 与测试 setup 覆盖逻辑
- 最新一轮再继续做前端主链 consumer audit，确认 `src/components/Downloads/ImportSuccessGuide.tsx`、`src/components/Common/WorkflowTips.tsx` 与 `src/components/Common/EmptyState.tsx` 在当前 `UnifiedView` 正式入口链路中已无任何生产消费者，因此已按 mainline-only cleanup 从工作树删除。对应 fresh 验证为 `~/.hermes/node/bin/corepack pnpm type-check`、`~/.hermes/node/bin/corepack pnpm exec vitest run src/components/Downloads/__tests__/DashboardToolbar.test.tsx src/components/Unified/__tests__/UnifiedView.test.tsx`（2 files / 6 tests）以及 `~/.hermes/node/bin/corepack pnpm exec vitest run --config vitest.config.integration.ts src/__tests__/integration/i18n.integration.test.tsx`（1 file / 5 tests）
- 配置命令边界也已进一步收口到 `src/features/downloads/api/configCommands.ts`：`configStore.ts` 当前通过共享 seam 统一调用 `get_config` / `update_config` / `reset_config` / `export_config` / `import_config`，不再直接 `invoke(...)`；围绕该 seam 的 fresh focused verification 为 `src/stores/__tests__/configStore.test.ts` + `src/features/downloads/api/__tests__/commands.test.ts`（2 个测试文件、12 个测试通过）与 `pnpm type-check`
- `removeTasks/clearCompletedTasks/applyOutputDirectoryOverride` 的 Tauri 调用已抽到 `src/features/downloads/api/taskMutations.ts`，`downloadStore` 对 mutation invoke 的直接依赖继续减少
- `removeTasks()` / `clearCompletedTasks()` 的 command→patch→refresh-stats→success feedback 已进一步真收口到 `src/features/downloads/state/taskMutationEffects.ts` 的 store-level seam（`executeRemoveTasksMutation()` / `executeClearCompletedTasksMutation()`），让 `downloadStore` 对 mutation-after-effects 的职责继续从“半内联实现”收敛到“读取 state + 调共享 helper + 统一 error handling”
- `applyOutputDirectoryOverride()` 的 target-task selection / output-path update request 组装 / merge patch 已先抽到 `src/features/downloads/state/taskOutputPathEffects.ts`，本轮又继续新增 `src/features/downloads/state/taskOutputPathStoreAction.ts`：把 request 准备、后端调用与 patch 应用进一步统一进 output-path store seam；与此同时，`startAllDownloads()` / `pauseAllDownloads()` 的 batch-control runtime sync / feedback 已进一步抽到 `src/features/downloads/state/batchControlEffects.ts`，`retryFailedTasks()` 的 failed-task selection / sequential retry / success feedback 已进一步抽到 `src/features/downloads/state/retryFailedEffects.ts`；此前把 no-op feedback 与逐任务重试时的 suppressed concurrency toast 统一收进 retry seam，本轮又进一步新增 `executeStartAllDownloads()` / `executePauseAllDownloads()` / `executeRetryFailedTasks()` 三个 shared executor helper，使 `downloadStore` 对 batch/retry orchestration 的职责继续从“内联分支 + toast + backend command 调度”收敛到“读取 state 后调用 helper facade”
- `add_download_tasks` 的 Tauri 调用已抽到 `src/features/downloads/api/taskCreation.ts`，`addTasks/addTask/importFromUrls` 对创建侧 invoke 的直接依赖继续减少；本轮进一步删除其中残留的 `import_csv_file` 旧 seam，使 `taskCreation.ts` 只承接任务创建主链
- 进一步地，当前导入 UI 与 store 侧共用的 `preview_import_data` / raw-file import / structured-file import 已统一收进 `src/features/downloads/api/importCommands.ts`：`src/components/Unified/FileImportPanel.tsx` 与 `src/stores/downloadStore.ts` 现统一复用 `previewImportDataCommand()` / `importRawFileCommand()` / `importStructuredFileCommand()`，不再维持多套导入命令边界；此前补入的 `selectImportFileCommand()` 也让 `FileImportPanel` 的文件选择 dialog 细节统一收口到同一 seam，不再在组件内直连 `plugin-dialog`。本轮继续做 contract audit 后又确认当前正式 UI 并不存在 sheet 选择能力，但 import seam 曾短暂对 Excel 假装暴露 `sheetName` 参数；现已按 authoritative mainline 删除前端 `sheetName` 与 Rust `sheet_name` 这组未被真实消费、且后端也未真正实现的伪契约，并以 `src/features/downloads/api/__tests__/commands.test.ts` + `pnpm type-check` + `cargo check` 锁定“structured import command surface 不再暴露不存在的 Excel sheet 选择能力”。随后又继续做 live consumer audit，确认旧 `src/components/Import/ImportView.tsx` 与 `src/hooks/useImportGuide.ts` 已无任何生产消费者，仅剩自身与测试引用，因此已按 mainline-only cleanup 从工作树删除，进一步把“正式导入 UI”收紧为 `UnifiedView -> FileImportPanel` 主链。围绕当前仍在位的导入 API 主链，本轮 fresh focused verification 为 `src/features/downloads/api/__tests__/commands.test.ts` + `src/components/Unified/__tests__/FileImportPanel.test.tsx` + `src/stores/__tests__/downloadStore.test.ts` 与 `pnpm type-check`；与此同时，当前正式下载视图已明确收敛为 `UnifiedView` + `VirtualizedTaskList`，而历史 `DownloadsView` / `OptimizedDownloadsView` / `TaskList` / `TaskItem` 因无生产消费者已按 mainline-only cleanup 从仓库删除。
- 进一步审计后确认 `downloadStore.ts` 已基本进入 thin orchestrator 区间，当前前端 `src/` 生产代码中对 Tauri 的调用也已全部经 feature-local API seam 收口；内容搜索显示剩余 `invoke(...)` 仅存在于测试 setup bridge 中，不再有生产 TS/TSX 零散直连
- `downloadCommands` / `taskMutations` / `taskCreation` / `downloadEventBridge` 已补 focused Vitest 覆盖，前端 seam 收敛不再只靠文档声明
- 本轮发现并补回 `downloadStore` 中一组实际缺失的 action：UI selection/filter/sort 以及 `refreshTasks` / `refreshStats` / `syncRuntimeState`，避免 Phase 3 的 runtime compensation 主链继续停留在“文档存在、实现缺失”的假收敛状态
- 在此基础上，selection/filter/sort 这组纯前端本地 view-state 已进一步抽到 `src/features/downloads/state/downloadViewState.ts`，`downloadStore.ts` 开始从“巨型运行时容器”向更清晰的 orchestration 容器继续收缩
- recent import session 这组本地状态（`recentImportTaskIds` / `recentImportSnapshot`）已进一步抽到 `src/features/downloads/state/importSessionState.ts`，把 import 后 UI session 记忆从核心 runtime store 里继续剥离
- `enqueueDownloads` / `importFromUrls` / validated import rows → task drafts 这组轻量 import orchestration 已进一步抽到 `src/features/downloads/state/importOrchestration.ts`，让 `downloadStore` 对导入编排的职责继续从“内联实现”收敛到“调用 helper orchestration”
- `importFromFile()` 中 raw import rows 的 normalize / validate / error-summary aggregation 已进一步抽到 `src/features/downloads/state/importValidation.ts`，让 `downloadStore` 对导入校验的职责继续从“内联实现”收敛到“调用共享 import validation helper”
- 在此基础上，`importFromFile()` 的 empty-import guard、validated rows → task drafts 编排、success summary / feedback message、warning summary、validation error payload，以及 failure patch / failure context logging 又进一步抽到 `src/features/downloads/state/importFileFlow.ts`，使 store 侧更接近 thin import facade；随后 live verify 又确认 `importFromFile()` 进一步接入 `src/features/downloads/state/importFileAction.ts`，把 validate-result → `addTasks()` → validation-error patch / success toast 这段 action orchestration 也收进独立 seam
- 本轮又把 `importFromFile()` 的 warning summary、validation error payload、success summary 与 toast message 统一收进 `src/features/downloads/state/importFileFlow.ts`，让 `downloadStore.importFromFile()` 进一步收薄为“日志 + state set + `addTasks()` + error handling”的 orchestrator
- 在此基础上，先新增 `src/features/downloads/state/importFileAction.ts`：继续承接 `importFromFile()` 成功路径里的 validation record、warning patch、`addTasks()` 调用、toast feedback，以及 validation completion / task preview artifacts 组装，使 store 侧更接近 thin import facade；围绕这条 seam 的 fresh targeted suite 为 `importFileAction` / `importFileFlow` / `downloadStore`：3 个测试文件、35 个测试通过
- 本轮又继续新增 `src/features/downloads/state/importFileStoreAction.ts`：进一步承接 `importFromFile()` 剩余的 raw import fetch、validation duration 计时、success-path action 委托，以及 failure patch / context logging，使 `downloadStore.importFromFile()` 进一步收薄为“启动 import 状态 + 调 seam + 统一 error handling + finally 清理”；围绕该 seam 的 fresh targeted suite 为 `importFileStoreAction` / `importFileAction` / `importFileFlow` / `downloadStore`：4 个测试文件、37 个测试通过；随后又修复旧 integration test 对已删除 `updateConfig` 的漂移，以及 `downloadEventBridge` 测试里 `listen` mock 的 `UnlistenFn` 类型不匹配，fresh 跑通 `pnpm type-check` 与 `vitest --config vitest.config.integration.ts src/__tests__/integration/DownloadWorkflow.integration.test.tsx`（1 个测试文件、9 个测试通过）
- `addTasks()` 中输入校验/错误汇总与后端响应 normalize/fallback 已进一步抽到 `src/features/downloads/state/taskCreationFlow.ts`，让 `downloadStore` 对创建链路的职责继续从“直接内联实现”收敛到“调用共享 task creation flow helper”
- `addTasks()` 中 validation warning summary、backend request/response preview，以及 completion summary / success message artifacts 已进一步统一收进 `src/features/downloads/state/taskCreationOrchestration.ts`；其后又把 validated-input / success-artifacts 聚合 helper（`prepareTaskCreationValidatedInput()` / `prepareTaskCreationSuccessArtifacts()`）并入同一 seam，让 `downloadStore.addTasks()` 对创建链路日志与完成反馈的职责继续从“直接内联实现”收敛到“调用共享 orchestration helper”
- `addTasks()` 中 request→response→state-update/completion 这段高密度 orchestration 已进一步抽到 `src/features/downloads/state/taskCreationAction.ts`，并直接复用 `taskCreationOrchestration.ts` 的聚合 helper；本轮又继续新增 `src/features/downloads/state/taskCreationStoreAction.ts`，把 `addTasks()` 成功/失败路径里剩余的 validation record、warning patch、state-update patch、recent-import/refresh-stats/delayed-validate side effects，以及 failure patch/context logging 继续收进 store-level action seam，使 `downloadStore.addTasks()` 更接近 thin creation facade（本轮函数体已从约 88 行进一步压到约 38 行，store 侧主要只剩日志、loading patch、seam 调用与统一 error handling）
- `addTasks()` 中 integrity-check / store merge / success feedback 已进一步抽到 `src/features/downloads/state/taskCreationState.ts`，让 `downloadStore` 对创建结果落库与用户反馈的职责继续从“直接内联实现”收敛到“调用共享 task creation state helper”
- `addTasks()` 中 recent-import 记录 / refresh-stats / delayed-validate side effects 已进一步抽到 `src/features/downloads/state/taskCreationEffects.ts`，失败 patch / failure context logging 已进一步抽到 `src/features/downloads/state/taskCreationError.ts`，让 `downloadStore` 对创建后收尾与错误路径的职责继续从“直接内联实现”收敛到“调用共享 helper”
- `startDownload()` / `pauseDownload()` / `resumeDownload()` / `cancelDownload()` 的 runtime-sync scheduling 与并发队列提示逻辑已进一步抽到 `src/features/downloads/state/commandControlEffects.ts`；此前又新增 `runControlCommandWithRuntimeSync()` / `runQueuedControlCommand()` 两层共享 facade，让 `downloadStore` 对单任务控制链的职责继续从“每个 action 内联 try/catch + sync/queue 分支”收敛到“调用共享 command-control seam”
- `startAllDownloads()` 的 selected-task sequential-start / no-op feedback 已进一步抽到 `src/features/downloads/state/batchControlEffects.ts`，让 `downloadStore` 对 batch-control 分支的职责继续从“内联 loop + toast 分支”收敛到“调用共享 helper”
- backend status/downloader-type 映射、task payload conversion 与 runtime task normalization 已进一步抽到 `src/features/downloads/model/runtimeTaskMapping.ts`，并让 `downloadEventBridge.ts` 直接依赖该 model seam，而不是反向从 `downloadStore.ts` 取 `fromBackendStatus`，继续收紧前端事件桥与模型边界
- `initializeStore()` 的 runtime snapshot fetch / related-data validation-fallback / success-failure patch 构造已进一步抽到 `src/features/downloads/state/initializeStoreBootstrap.ts`，本轮又继续把 config merge / task normalization / success-summary formatting 收进同一 seam；随后再新增 `src/features/downloads/state/initializeStoreStoreAction.ts`，把 validation duration 计时、recordValidation、success/failure patch 应用与完成/失败日志统一收进 store-level seam，使 `downloadStore.initializeStore()` 进一步收薄为“loading patch + seam 调用 + 统一 error handling”的 facade；本轮又继续修复此前 helper 参数与 store/test 调用签名漂移，当前已统一通过 `runtimeQueries` query seam 获取 bootstrap snapshot，不再依赖失配的 `invokeFn` 假接口
- `refreshTasks` / `refreshStats` / `syncRuntimeState` 这组 runtime sync helper 已进一步抽到 `src/features/downloads/state/runtimeSync.ts`，让 `downloadStore` 对运行时补偿同步的职责继续从“直接内联实现”收敛到“调用共享 runtime sync helper”
- `forceSync` / `runDataIntegrityCheck` 已进一步抽到 `src/features/downloads/state/validationHelpers.ts`，让 `downloadStore` 对强制同步与完整性检查的职责继续从“直接内联实现”收敛到“调用共享 validation helper”；此前又把 `forceSyncWith()` 的调用签名与 `downloadStore.forceSync()` 对齐到 `runtimeQueries` 主链
- 在此基础上，本轮再新增 `src/features/downloads/state/validationStoreAction.ts`：把 `validateAndSync()` / `forceSync()` 的 store-level orchestration、日志与 patch 应用统一收进同一层 seam，使 `downloadStore` 对 runtime validation/sync 分支进一步收薄为“读取 state + 调 seam + 统一 error handling”的 facade；围绕该 seam 的 fresh targeted suite 为 `validationHelpers` / `validationFlow` / `validationStoreAction` / `downloadStore`：4 个测试文件、43 个测试通过，并再次 fresh 跑通 `pnpm type-check`
- `validateAndSync` 已先抽出 `src/features/downloads/state/validationFlow.ts`：最初承接 validation gate 与 store-updater 构造；本轮进一步承接 tasks/stats 进入后的 validation→branch→sync orchestration，`downloadStore` 内剩余主体继续收薄
- 在此基础上，`validateAndSync` 还复用 `src/features/downloads/state/validationResultFlow.ts`：把 consistency 判断与 sync execution wrapper 从 store 主函数里继续剥离，使 store 侧更接近薄 facade
- 这一轮 focused Vitest 已验证 `validationFlow` / `validationResultFlow` / `importOrchestration` / `importValidation` / `taskCreationFlow` / `taskCreationState` / `taskCreationEffects` / `taskCreationError` / `downloadStore` / `downloadEventBridge` / commands / runtimeSync / validationHelpers` 等 Phase 3 seams；其中最新一轮围绕新增 `validationStoreAction` 的 targeted suite 为 `validationHelpers` / `validationFlow` / `validationStoreAction` / `downloadStore`：4 个测试文件、43 个测试通过，并再次 fresh 跑通 `pnpm type-check`；此前针对签名漂移的 targeted suite 为 `initializeStoreBootstrap` / `initializeStoreStoreAction` / `validationHelpers`：3 个测试文件、9 个测试通过，并再次 fresh 跑通 `pnpm type-check`；此前最近一轮 initialization seam focused suite 为 `downloadStore` / `initializeStoreBootstrap` / `initializeStoreStoreAction`：3 个测试文件、37 个测试通过，并再次 fresh 跑通 `pnpm type-check`；此前 mutation-focused subset 为 7 个测试文件、46 个测试通过，上一轮覆盖前端主链的 targeted suite 为 10 个测试文件、56 个测试通过，validation/runtime seam 的 fresh targeted suite 为 `downloadStore` / `validationHelpers` / `runtimeSync` / `validationFlow` / `validationResultFlow`：5 个测试文件、41 个测试通过；围绕 import facade 的 fresh targeted suite 为 `downloadStore` / `importFileFlow` / `importValidation` / `importOrchestration`：4 个测试文件、36 个测试通过；随后围绕 import action seam 的 fresh targeted suite 为 `importFileAction` / `importFileFlow` / `downloadStore`：3 个测试文件、35 个测试通过；围绕 task-creation orchestration seam 的 fresh targeted suite 为 `downloadStore` / `taskCreationOrchestration` / `taskCreationFlow` / `taskCreationState` / `taskCreationEffects` / `taskCreationError`：6 个测试文件、43 个测试通过；围绕新增 `taskCreationAction` seam 的 fresh targeted suite 为 `taskCreationAction` / `taskCreationFlow` / `downloadStore`：3 个测试文件、34 个测试通过；本轮围绕 `taskCreationOrchestration` + `taskCreationAction` 聚合收敛的 fresh targeted suite 为 `taskCreationOrchestration` / `taskCreationAction` / `taskCreationFlow` / `downloadStore`：4 个测试文件、39 个测试通过；同时覆盖当前前端主链的 fresh targeted suite 为 `runtimeTaskMapping` / `contracts` / `batchControlEffects` / `downloadEventBridge` / `taskCreationF... [truncated]
- `downloadEventBridge` 的 `task.status_changed` 已改为优先本地派生关键 stats，而不是立刻直连 `refreshStats()`
- 自动循环开发的可见性已进一步补齐：当前除 `.planning/logs/hermes-auto-continue.log` 与 `.planning/auto-continue-last-summary.md` 外，还新增 `scripts/hermes-auto-continue-notify.sh` 与 `./scripts/ai-workflow.sh auto-progress` / `auto-notify-show` / `auto-notify-set` / `auto-notify-unset` / `auto-notify-test` 入口；通知目标支持以 `.planning/auto-continue.env` 做 repo-local 持久化配置，从而让主仓库 auto-continue 结束后可自动经 `discord`/`local`/显式平台目标回投递摘要，而不必每次手工 export 环境变量
- 自动循环开发的并发治理已进一步补齐：当前 workflow 继续通过统一 `project key` 共享 `/data/ai-coding/.hermes-auto-continue/tauri-video-batch-downloader.writer.lock` 与对应 lease/state/handoff 文件，但长期最佳实践已从“sandbox 作为 canonical writer”收敛为“主仓库单写者”。fresh 审计已确认历史 sandbox 缺失完整项目代码环境与图谱/脚本产物，不适合作为长期 writer 面；与此同时 `hermes cron list --all` 当前返回 `No scheduled jobs.`。这意味着当前最稳妥的长期模式是：多 agent 可分析，但真实写入与后台续跑默认只在主仓库执行
- 为了把这个长期原则从“文档约定”推进到“脚本级保护”，当前 `scripts/hermes-auto-continue-config.sh` 已新增 execution-surface guard：至少要求 `package.json`、`pnpm-lock.yaml`、`src-tauri/`、`.planning/STATE.md` 与可执行 `scripts/graphify-sync.sh`。fresh 验证已确认主仓库 `./scripts/ai-workflow.sh doctor` 当前显示 `execution surface: ready`；而对历史 sandbox 执行同一检查会返回 `incomplete: missing package.json; missing pnpm-lock.yaml; missing src-tauri/; missing .planning/STATE.md; missing executable scripts/graphify-sync.sh`，并被 `hermes_auto_continue_assert_execution_surface` 明确拒绝。与此同时，`scripts/install-hermes-auto-continue-cron.sh install` 与 `scripts/hermes-auto-continue-trigger.sh` 也已接入同一 guard；仅保留 `HERMES_AUTO_CONTINUE_ALLOW_INCOMPLETE_ROOT=1` 作为短期实验 override
- 在此基础上，当前又把“谁有资格当 writer”继续收口成显式 contract：`scripts/hermes-auto-continue-config.sh` 现新增 `HERMES_AUTO_CONTINUE_PRIMARY_ROOT` 与 `hermes_auto_continue_writer_surface_status()`；`./scripts/ai-workflow.sh auto-execution-surface-show` 会直接展示 `primary_root`、`writer_eligible`、`primary_root_match` 与 `writer_recommended`。fresh 验证已确认主仓库当前显示 `writer_recommended=yes`；历史 sandbox 则显示 `writer_recommended=no`。与此同时，`auto-runner-bind` 现在只允许在 `writer_recommended=yes` 的执行面上写 runtime 绑定，且负向验证已确认：当把当前 repo 伪装成非 primary root 时，该命令会明确拒绝绑定
- 在统一 operator 观察面的 fresh 回归中，又发现并清理了一个真实遗留：系统 `crontab` 里仍残留 `# HERMES_AUTO_CONTINUE_SANDBOX` 条目，且正以 `bash /data/ai-coding/auto-continue-sandbox/scripts/hermes-auto-continue-trigger.sh cron` 持续占用 project-level writer lease。现已实际移除该 crontab 条目、终止旧 trigger 进程（PID `184368`），并把 `/data/ai-coding/.hermes-auto-continue/tauri-video-batch-downloader.state.json` 与 `.writer.json` 校正回主仓库 `main@bfe6e4a...`、`state=inactive` / `phase=inactive`。对应 fresh 结果是：`auto-runner-show` 与 `auto-progress` 当前都已显示 `writer state: inactive`，且仍保留 `reason=stale_sandbox_writer_cleared` 的 operator 痕迹
- 回到项目主线后，本轮又继续做了一刀低 blast-radius 的前端 observability cleanup：fresh 内容搜索确认当前生产 `src/` 内残余的 `console.*` 已只剩 `src/main.tsx` 对 `console.error` 的 monkey patch，而正式 diagnostics 主链早已收敛到 `utils/frontendLogging.ts` + `window error/unhandledrejection` 监听 + 显式 `reportFrontendEventIfEnabled/reportFrontendIssue` 调用。因此本轮已按 mainline-only cleanup 删除 `src/main.tsx` 中最后一个生产 `console.error` monkey patch，使生产 `src/` 下 `console.*` 残余仅剩测试 setup 控制逻辑。对应 fresh 验证已跑通 `~/.hermes/node/bin/corepack pnpm type-check`，以及 `~/.hermes/node/bin/corepack pnpm exec vitest run src/App.test.tsx src/features/downloads/api/__tests__/commands.test.ts src/components/Unified/__tests__/FileImportPanel.test.tsx src/stores/__tests__/downloadStore.test.ts`（4 files / 45 tests）
- 正式切回 Rust 侧 Phase 4 后，本轮又继续完成一刀低 blast-radius 的 command-surface 收口：fresh 内容搜索确认前端当前正式主链并无 `get_youtube_info` / `get_youtube_formats` / `download_youtube_playlist` 的 TS/TSX 消费者；因此已先把这三条 YouTube Tauri commands 从 `src-tauri/src/main.rs` 的 `invoke_handler` 正式暴露面移除。随后继续把 `src-tauri/src/commands/youtube.rs` 中仅服务这三条已下线 command 的 wrapper、playlist 分支、playlist parser/helper，以及 `src-tauri/src/commands/mod.rs` 里的 `pub use youtube::*` 一并删除，仅保留仍被 `commands/system.rs::get_video_info_impl()` 复用的 `get_youtube_info_internal()` 与其必要 helper。对应 fresh Rust 证据为 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 与 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 均通过，说明这不是纯文档判断，而是已在当前生产编译面与 test compile surface 上成立
- 在此基础上，busy/skip 已不再只是瞬时终端输出：`scripts/hermes-auto-continue-trigger.sh` 现在会在拿不到全局 writer lock 时写入 `.planning/auto-continue-last-blocked.json`，并把 `auto-continue-last-summary.md` 标记为 `Mode: blocked`；`./scripts/ai-workflow.sh auto-progress` 也会直接展示最近一次 blocked event（time / reason / detail / source / status），从而把“被谁挡住、为什么挡住、现在是否已恢复可写”变成稳定可见状态，而不必靠人手翻临时日志
- 最新一轮又继续把这套 runner 语义推进到机器可读状态镜像：全局状态目录现新增 `/data/ai-coding/.hermes-auto-continue/tauri-video-batch-downloader.state.json`，由 trigger 在 `running / blocked / complete / inactive` 路径写入统一 `state / reason / detail / repo_root / source / branch / head / status`。fresh 复现场景已确认主仓手动触发在 writer busy 时会把该文件写成 `state=blocked` / `reason=global_writer_busy`，而 `auto-runner-show` / `auto-progress` 会直接展示同一份 state 文件内容；这让后续 queue/lease 状态机可以基于单一事实源继续演化，而不是分别从 lock/lease/summary 猜状态
- 在此基础上，operator 输出又进一步收口到统一状态语言：`auto-runner-show` / `auto-progress` 现在会额外展示 `effective_state`、`file_state` 与 `state_note`。fresh synthetic verification 已真实证明：当 state 文件仍是 `blocked`、但 lock 仍被占用时，会显示 `effective_state=running` 与 `state_note=lock-active overrides file-state=blocked`；锁释放后，同一份 state 文件则回落为 `effective_state=blocked` / `state_note=aligned`。这意味着后续即使 state 文件和实时锁短暂不同步，operator 视图也不会再误导人
- 这轮还顺手补了一个低风险但实用的调试能力：`scripts/hermes-auto-continue-config.sh` 现支持 `HERMES_AUTO_CONTINUE_IGNORE_LOCAL_ENV=1`，允许运维排查、synthetic 验证或临时检查其它 `project key` 时跳过 `.planning/auto-continue.env` 的 repo-local 覆盖；这使得 workflow 的隔离测试与 operator 诊断不再被当前仓库默认绑定的 project key/state dir 干扰
- 这轮还继续补齐了真正缺失的 `handoff / awaiting_human` 状态：当前已新增 `.planning/auto-continue-handoff.json`、project-level `/data/ai-coding/.hermes-auto-continue/tauri-video-batch-downloader.handoff.json` 与 `auto-handoff-set/show/clear` 运维入口；fresh 验证已确认手动执行 `auto-handoff-set awaiting_human "need explicit user decision before next mutation"` 后，`auto-runner-show` 会把全局 state 文件写成 `state=handoff`、`reason=awaiting_human`，`auto-progress` 会直接展示 active handoff，而 `scripts/hermes-auto-continue-trigger.sh manual` 也会命中 handoff gate 并输出 `handoff active; ...`，不再继续自动写。由于 handoff 已升级为 project-level gate，它约束的是当前项目 key 下的真实 writer，而不是依赖额外 sandbox 才成立；执行 `auto-handoff-clear` 后，全局与本地 handoff 文件均被清除，trigger 恢复到正常的 lock/busy 或正常 run 语义。这意味着状态机已不再只覆盖并发冲突，还能表达“当前明确等待人工/外部条件”的自治 workflow 停泊态
- 最新一轮又把 handoff 从简单 reason/detail 升级成结构化交接包：fresh 验证已确认 `auto-handoff-set awaiting_human 'need product decision on cleanup boundary' 'confirm whether to delete remaining legacy compatibility surfaces' 'user provides explicit keep/delete decision' 'resume phase-4 cleanup with chosen boundary'` 会把 `requested_input`、`resume_condition` 与 `next_action` 一并写入 handoff 文件、全局 state 文件与 trigger 输出；`auto-handoff-show` / `auto-runner-show` 现都能直接展示这组结构化字段，使 handoff 不再只是“等人”，而是能明确告诉操作者要提供什么输入、满足什么条件后恢复、恢复后下一步做什么
- 本轮再继续把 runtime state 正式联动进 planning 视角：当前已新增 `.planning/auto-continue-workflow-state.json` 作为 planning mirror，trigger 在 `running / blocked / handoff / complete / inactive` 路径都会同步写这份文件，`auto-workflow-state-show` / `auto-runner-show` / `auto-progress` 也会直接展示其内容。fresh 验证已确认执行结构化 `auto-handoff-set` 后，planning mirror 会写出 `runtime_state=handoff`、`reason`、`detail`、`requested_input`、`resume_condition` 与 `next_action`，从而让 GSD / `.planning` 视角不再只能从日志猜自治运行时状态，而能读取一份明确的 machine-readable mirror
- 与此同时，background writer prompt 现已显式固化 writer-only mutation rule：持有 writer lease 的主项目执行面才能真实修改文件；若未来并行调用额外 agent，它们默认只承担 read-only 的调研 / 审查 / 规划 / diff 建议任务，不得下放真实文件写入职责。这为后续多 agent 编排提供了最小但关键的权限边界
- 事件总线命名已从带版本后缀的通道名改为稳定语义名 `download.events`，版本兼容通过 envelope `schema_version` 管理
- 无前端消费者的 `system.events` / `system_info_updated` 已删除；占位型 `start/stop/get_system_monitor_status` 命令也已从正式主链移除

这仍然是一种过渡状态，但前端事件主链已经收紧到 `download.events`，配置真源边界以及 refresh/polling 的补偿入口也比之前清晰。

### 3.4 超大核心文件仍然存在，但第一波 seam 已启动
当前两个最重要的中心模块仍偏大：

- `src-tauri/src/core/manager.rs`
- `downloadStore.ts`（当前约 673 行，已继续向 thin orchestrator 收缩；最新 live audit 中 `importFromFile()` 约 30 行、`initializeStore()` 约 25 行、`validateAndSync()` 约 21 行、`forceSync()` 约 16 行、`addTasks()` 约 38 行）

其中后端已经开始做第一波职责拆分：

- `main.rs` 的下载事件桥已经移入 `src-tauri/src/infra/download_event_bridge.rs`
- `ToolCapabilityService` 已从误导性的 `src-tauri/src/infra/providers/capability_service.rs` 迁到 `src-tauri/src/infra/capability_service.rs`，空壳 `infra/providers` 模块表面已删除
- `core/monitoring.rs` 与 `monitoring_integration_tests.rs` 已在此前的 mainline-only cleanup 中从源码树删除，说明这套 monitoring observability 子系统已经实质退出当前仓库主线，而不是继续以 cfg/feature 形式占据编译面
- 在用户明确要求“不要历史包袱”后，Rust 侧剩余旧测试分区也已整体清退：`src-tauri/src/core/` 下 7 个仅服务旧分区的测试文件全部删除，`core/mod.rs` 中对应模块接线已移除，`file_parser.rs` 中仅供这些旧测试使用的 helper seam 已删除，`src-tauri/Cargo.toml` 里对应的旧测试 feature 也已移除。当前仓库结构中已不再保留独立 legacy test partition
- 最新一轮继续清理遗留测试叙事漂移：对 `src-tauri/src/core/system_integration_tests.rs` 做内容审计后，已删除其中所有对 `get_system_metrics()` / `get_download_statistics()` / `get_health_status()` / `get_dashboard_data()` 以及 monitoring/dashboard 文案的历史断言；当前内容搜索对这些 monitoring façade 在该文件内已返回 0 命中，说明 legacy test debt 已开始从“仍引用已删除后端 façade”收敛为“仅保留尚能代表现有主链的集成测试语义”
- 最新一轮继续做 legacy test compile-surface 收口：fresh 方法真存在性审计确认 `src-tauri/src/core/integration_tests.rs` 大量调用当前 `DownloadManager` 已不存在的方法（如 `get_current_stats()`、`get_all_tasks()`、`update_task_progress()`、`reset_task()`），属于整体停留在更旧 API 世界的漂移测试文件，而不是值得逐段修补的现行集成语义；因此本轮已直接删除该文件，并同步移除 `core/mod.rs` 中对应的 legacy test module 接线
- 在切换到 mainline-only 策略前，仓库曾经用 compile-driven cleanup 把这批旧测试从“成批报错”压到“可编译通过”；但在当前策略下，这批文件已经不再被视为值得继续保留的回归资产，而是作为历史分区整体退出源码树
- 最新一轮继续对 `resume_downloader_integration_tests.rs` 做同类分层收口：fresh 审计确认 `detect_server_capabilities()` / `load_resume_info()` / `cleanup_task()` 与 `ResumeInfo::new()` / `ChunkInfo::new()` 仍锚定公开契约，但 `test_full_download_workflow`、`test_resume_info_persistence`、`test_chunk_creation_logic` 以及相关旧 `download_with_resume(..., &String/&str)` / `save_resume_info()` / `create_chunks()` 调用则属于旧签名或私有 helper 直测，因此已删除这些坏块，只保留公开契约相关测试
- 最新一轮又继续把 `m3u8_integration_tests.rs` 从“私有 helper 直测合集”压缩到最小公开面：`is_m3u8_url`、`parse_m3u8_content`、`parse_encryption_line` 相关测试均已确认命中私有方法，因此整批删除；当前该文件只保留 `M3U8DownloaderConfig` + `M3U8Downloader::new(...)` 的公开配置/构造测试
- 最新一轮继续对 `error_handling_integration_tests.rs` 做同类分层收口：保留仍围绕公开 `RetryPolicy` / `CircuitBreaker` / `RetryExecutor` / manager retry stats / circuit breaker state 的契约测试，同时把私有 `calculate_delay()` 与私有 `convert_app_error_to_download_error()` 直测块删除，并把 `CircuitBreaker::call` 的旧 `Result<_, &str>` 错误类型假设修正为符合当前签名约束的 `anyhow::Error`
- 最新一轮继续对 `youtube_downloader_integration_tests.rs` 做混合文件收口：删除对私有 `is_youtube_url()` 的整块直测，并修正公开测试里的两类真实 Rust 问题——`unwrap_err()` 后复用结果值，以及 `&format!(...)` 形成的临时值借用生命周期；保留其余围绕 `YoutubeDownloader::new(...)`、`fetch_video_info(...)`、`download_*`、statistics、active downloads、manager YouTube 集成与 config update 的公开契约测试
- 此前为打通旧测试分区而删除的 `manager.rs::test_download_statistics_capture_transfer_and_commit_metrics()` 现也已随整块旧测试分区退出，而不再作为仓库内的特殊例外继续存在
- 最新一轮再次活体验证确认：`DownloadEvent::SystemMetricsUpdated` / `DownloadStatisticsUpdated` / `HealthStatusChanged` 在后端无 emitter、在前端无 consumer，因此已从 `src-tauri/src/core/manager.rs` 删除；这意味着 monitoring 相关类型不再因为历史事件壳层而泄漏进生产事件协议表面
- `commands/system.rs` 与 `commands/download.rs` 中几条已不再暴露、也无正式前端消费者的 dead command wrapper（`get_system_info`、`resume_all_downloads`、`start_all_pending_downloads`、`cancel_all_downloads`）已按 mainline-only cleanup 删除，避免“主链已切换但旧 command 壳仍滞留源码”继续制造误导
- 本轮又进一步删除了后端 `select_output_directory` 与 `select_output_directory_impl()`：目录选择现以前端 `plugin-dialog` 为唯一正式主链，不再保留“真正由前端完成、却仍假装由后端 system command 提供”的 placeholder fallback
- 最新一轮继续把这组三个已脱离正式 command surface 的批量控制残余死路径向内收口：`src-tauri/src/core/runtime.rs` 中无人调用的 `ResumeAll` / `CancelAll` runtime command 与 `DownloadRuntimeHandle.resume_all()/cancel_all()` 已删除，`src-tauri/src/core/manager.rs` 中对应的 `runtime_resume_all_downloads()` / `runtime_cancel_all_downloads()` 以及仅作透传的 `resume_all_downloads_impl()` / `start_all_pending_impl()` / `cancel_all_downloads_impl()` 也已删除；对应 fresh Rust 证据为 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 与 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 均通过，说明这轮 cleanup 不只是文档层判断，而已在生产编译面与 test compile surface 上成立
- 本轮又继续把同一组已脱离正式 command/runtime surface 的批量控制残余死路径进一步向 authoritative manager mainline 内收口：对 `src-tauri/src/core/manager.rs` 做 live consumer audit 后，已确认 `resume_all_downloads()` / `start_all_pending()` / `cancel_all_downloads()` 本身也已无 Rust 主链调用者，因此已按 mainline-only cleanup 真删除这三个 dead manager façade；对应 fresh 证据为内容搜索对 `resume_all_downloads(` / `start_all_pending(` / `cancel_all_downloads(` 返回 0 命中，以及再次 fresh 跑通 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 与 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests`
- 最新一轮又继续把 `DownloadManager` 内两处不再代表真实 observability contract 的 monitoring 残留假语义删除：`stop()` 中注释掉的 `monitoring_system.stop()` TODO 壳、以及 `update_stats()` 中无效的 `_pending_tasks` / `_current_speed` 与“稍后接 monitoring”占位注释都已移除；对应 fresh Rust 证据为 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 通过，且内容搜索确认这些残留字符串已从 `src-tauri/src/core/manager.rs` 消失
- queue scheduler 已从 `manager.rs` 抽到 `src-tauri/src/core/queue_scheduler.rs`

后续阶段仍需要继续拆 `DownloadManager`，而不是继续在其上叠加更多职责。

---

## 4. 当前规划与分析基线

### GSD 规划上下文
当前项目已建立 `.planning/`：

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/config.json`
- `.planning/codebase/CODEBASE-MAP.md`

### graphify 图谱上下文
当前项目已建立 `graphify-out/`：

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/graph.html`

截止 2026-04-16 本轮 fresh 基线验证又再次确认：
- `~/.hermes/node/bin/corepack pnpm type-check` 通过
- `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` 通过
- `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 通过
- `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests --features integration-tests` 通过
- `~/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml --all --check` 通过
- `~/.cargo/bin/cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` 通过
- `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml` 通过（`src/lib.rs` 112 tests、`src/main.rs` 111 tests，均 0 failed）
- `~/.hermes/node/bin/corepack pnpm lint` 通过
- `~/.hermes/node/bin/corepack pnpm exec vitest run --config vitest.config.integration.ts` 通过（2 个测试文件、14 个测试）
- `~/.hermes/node/bin/corepack pnpm exec vitest run` 通过（50 个测试文件、257 个测试）
- `~/.hermes/node/bin/corepack pnpm test:all` 通过
- `bash ./scripts/graphify-sync.sh smart` 通过（1421 nodes / 2534 edges / 146 communities）

这说明当前 Phase 3 closeout 与 Phase 4 low-risk cleanup 的主链事实在现有工作树上仍成立，而且仓库级 completion gate 也已经在当前环境被真实打通：Rust 侧旧测试分区已从结构上删除，`clippy` / `rustfmt` 工具链缺口已补齐，前端 lint 对 `.codex/**` 的误扫描也已修正，仓库自带的 `pnpm test:all` 已能 fresh 通过。进一步用仓库自己的 auto-continue 完成判定脚本验证，`./scripts/hermes-auto-continue-status.sh` 当前返回 `INCOMPLETE reason=missing_sentinel ... dirty=1`，且 `.planning/auto-continue-complete.json` 尚不存在；因此此时若仍不宣告项目完成，原因已经收敛为 worktree clean + completion sentinel/evidence 语义，而不再是验证链本身跑不通。

### 当前最重要的分析文档
- `docs/plans/2026-04-15-system-architecture-optimization-plan.md`
- `docs/plans/2026-04-15-download-core-call-chain-analysis.md`
- `docs/plans/2026-04-15-backend-write-path-boundary-map.md`
- `docs/gsd-graphify-workflow.md`

---

## 5. 当前工作流基线

### graphify
推荐在代码变更后运行：

```bash
./scripts/graphify-sync.sh smart
```

### GSD
本仓库已安装本地 Codex runtime：
- `./.codex/`

后续规划/执行建议以 GSD phase 工作流推进。

### 当前路线图阶段
当前已经完成：
- **Phase 0: Foundation Alignment**
- **Phase 1: Entry and Legacy Cleanup**
- **Phase 2: Backend Write Path Convergence**

当前 focus 已进入：
- **Phase 3: Frontend State and Event Convergence**（已进入 closeout review：`downloadStore.ts` 当前主要热点已收敛到 thin facade 区间，下一轮默认转向 Phase 4 audit-first 主线）

同时，Phase 4 已形成 audit-first 基线：
- 最新一轮后端收口又进一步确认：`core/monitoring.rs` / `monitoring_integration_tests.rs` 已从源码树删除，Rust 侧剩余旧测试分区也已整体移除，因此当前 observability 的工作重点不再是“继续把历史测试面往 feature 后面塞”，而是只围绕仍真实存在的主链命令、runtime、manager 与前端消费者继续收口。对应 fresh 验证已跑通 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`、`~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 与 `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests --features integration-tests`；最新 graphify 也已同步到 1422 nodes / 2534 edges / 145 communities。
- `docs/plans/2026-04-16-phase4-provider-observability-audit.md` 已持续记录 Phase 4 audit-first 事实源：当前正式前端主链不消费 `MonitoringSystem`；在前几轮已删除 monitoring 内无消费者的历史 helper、fake config、placeholder metrics 采集层、dashboard push surface、manager snapshot façade与结构级残余壳层后，本轮又进一步确认 `DownloadStatistics`、`download_stats_history` 与 `HealthStatus.download_health` 也只剩 download residue，因此现已从快照结构、health 聚合与 cleanup 残留中继续删除；当前 `get_current_dashboard_data()` 已收窄为仅返回 `system_metrics + recent_errors + health_status` 的极简 snapshot，而 `export_prometheus_metrics()` 保持 system metrics only。fresh `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml` + `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests` 通过。

这意味着当前优先级不是继续加功能，而是先：
- 在新的 mainline-only cleanup 策略下，逐批删除不再服务当前主链的旧代码，而不是长期保留兼容层
- 把前端事件桥、store 职责和 config 真源继续收敛
- 让 `download.events` 成为更明确的前端主同步链
- 为后续 Provider / Observability / Hardening 做准备

---

## 6. 什么是“现在已经成立的”，什么不是

### 已成立
- 项目主链路存在
- 下载主控制流已初步成型
- GSD 与 graphify 已经接入当前仓库
- 已有系统优化计划与调用链分析

### 尚未完全成立
- 单一后端写入口（当前正进入 Phase 2 收敛）
- 单一前端状态同步模型
- 文档与实现完全一致
- provider / observability 层全面收敛

---

## 7. 使用建议

如果你是新进入这个仓库的开发者或 AI agent，推荐阅读顺序：

1. `README.md`
2. `docs/current-state.md`
3. `.planning/ROADMAP.md`
4. `graphify-out/GRAPH_REPORT.md`
5. `docs/plans/2026-04-15-system-architecture-optimization-plan.md`
6. `docs/plans/2026-04-15-download-core-call-chain-analysis.md`

这样可以先建立**当前事实认知**，再进入规划或代码实现。
