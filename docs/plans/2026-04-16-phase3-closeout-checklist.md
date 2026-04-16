# Phase 3 Closeout Checklist

> 用于判断 `Frontend State and Event Convergence` 是否真正达到可收口状态，而不是只完成局部 seam 抽离。

## 当前已确认完成的收敛项
- [x] `downloadEventBridge.ts` 已从 `downloadStore.ts` 中抽出，`main.tsx` 重复初始化已去掉
- [x] `configStore` 成为配置写路径真源；`downloadStore.updateConfig/resetConfig` 已移除
- [x] `runtimeSync.ts` 已承接 `refreshTasks` / `refreshStats` / `syncRuntimeState`
- [x] `validationHelpers.ts` / `validationFlow.ts` / `validationResultFlow.ts` 已承接 `forceSync` / `validateAndSync` 的主要编排逻辑
- [x] `taskCreation.ts` / `importValidation.ts` / `importOrchestration.ts` / `taskCreationFlow.ts` / `taskCreationState.ts` / `taskCreationEffects.ts` / `taskCreationError.ts` 已覆盖创建/导入主链
- [x] `taskMutationEffects.ts` 已覆盖 `removeTasks()` / `clearCompletedTasks()` 的 mutation-after-effects（本轮进一步补齐 `executeRemoveTasksMutation()` / `executeClearCompletedTasksMutation()` store-level seam，`downloadStore` 不再内联 command→patch→refresh→toast 编排）
- [x] `taskOutputPathEffects.ts` 已覆盖 `applyOutputDirectoryOverride()` 的 target-task selection / merge patch
- [x] `batchControlEffects.ts` 已覆盖 `startAllDownloads()` / `pauseAllDownloads()` 的 batch-control side effects
- [x] `retryFailedEffects.ts` 已覆盖 `retryFailedTasks()` 的 failed-task selection / sequential retry / success feedback

## 仍需确认的收口项

### A. `downloadStore.ts` 是否已成为 thin orchestrator
- [x] `startDownload()` / `pauseDownload()` / `resumeDownload()` / `cancelDownload()` 的重复 command-after-effects 模式已进一步抽到 `features/downloads/state/commandControlEffects.ts`
- [x] `importFromFile()` 已进一步把 success/failure orchestration 抽到 `features/downloads/state/importFileFlow.ts`，再经 `importFileAction.ts` / `importFileStoreAction.ts` 承接 validation record、warning patch、`addTasks()` 委托、raw import fetch、duration 计时与 failure context logging；live audit 量化当前函数体仅约 30 行，已达到 thin import facade 目标
- [x] `addTasks()` 已进一步把 request→response→state-update/completion 这段高密度 orchestration 抽到 `features/downloads/state/taskCreationAction.ts`，随后又继续把 validation record、warning patch、state-update patch、recent-import/refresh-stats/delayed-validate side effects，以及 failure patch/context logging 抽到 `features/downloads/state/taskCreationStoreAction.ts`，store 侧已进一步收薄为 thin creation facade
- [x] live audit 量化当前其余热点也已进入 thin facade 区间：`initializeStore()` 约 25 行、`validateAndSync()` 约 21 行、`forceSync()` 约 16 行、`addTasks()` 约 38 行；当前 `downloadStore.ts` 剩余职责已以 facade/orchestrator 为主
- [x] `initializeStore()` 已不再是 `downloadStore.ts` 中最厚的单块之一；initial bootstrap helper 已拆到 `features/downloads/state/initializeStoreBootstrap.ts`，且已进一步收进 config merge / task normalization / success-summary formatting；本轮又新增 `features/downloads/state/initializeStoreStoreAction.ts`，把 validation duration 计时、recordValidation、success/failure patch 应用与完成/失败日志统一收进 store seam
- [x] `forceSync()` 现在已经较薄：`forceSyncWith()` 之外的 fetch-result patch 与 log summary 已统一进 `features/downloads/state/validationHelpers.ts`；本轮又继续新增 `features/downloads/state/validationStoreAction.ts`，把 store-level orchestration 进一步收口为共享 seam，store 侧只剩 facade 调用 + 统一 error handling
- [x] `validateAndSync()` 当前已接近 thin facade：此前已收敛为读取 tasks/stats -> 调 `runValidationAndSync(...)` -> store 侧日志 / error handling / 布尔返回；本轮再通过 `features/downloads/state/validationStoreAction.ts` 把 warning / logging / sync-executor 委托一起收进 store-level seam，`downloadStore.ts` 只剩 facade 调用 + 统一 error handling

### B. Phase 3 关闭前的验证要求
- [x] 为最近新增的 helper 维持 focused Vitest
- [x] 至少跑一组覆盖当前前端主链的 targeted suite
- [x] 更新 `.planning/STATE.md`
- [x] 更新 `.planning/ROADMAP.md`
- [x] 更新 `docs/current-state.md`
- [x] 更新 `docs/index.md`
- [x] 运行 `./scripts/graphify-sync.sh smart`

### C. Phase 4 准备条件
- [x] provider / capability 路径审计输入已初步收集（已确认 backend 仍以 `DownloadRuntime` + `DownloadManager` 为核心，commands 已基本经 runtime）
- [x] observability / monitoring / system event 语义审计输入已初步收集（前端 dead system events 已删除；后续仍需集中审计 Phase 4 相关语义）
- [x] 明确 Phase 4 是“审计优先”，不是直接大改（已形成 `docs/plans/2026-04-16-phase4-provider-observability-audit.md`，确认 provider stub / capability service / `get_system_info` / `MonitoringSystem` 的真实消费者与 placeholder 现状）

## 当前判断
当前 `downloadStore.ts` 已明显从 giant implementation file 转向 orchestration store，并且最新 live audit 显示主要热点已收敛到 thin facade 区间；**当前可把 Phase 3 状态推进到“进入收尾评审”**，而不是继续默认追加新的 store seam。

当前剩余热点优先级建议：
1. 以本轮 live audit + focused verification 为证据，把 Phase 3 标记为**进入收尾评审**
2. 在不破坏当前验证面的前提下，后续默认转向 Phase 4 的 provider / observability / hardening 审计与实施
3. 如后续评审中发现新的前端主链漂移，再回补最小 seam，而不是预设继续大拆 store
4. 在有 Rust 验证环境之前，不对 provider stub / monitoring 大表面做高风险删除宣告

因此，建议顺序为：
1. 先以最新 live audit + targeted suite 完成 Phase 3 收尾评审同步
2. 立即补齐并勾掉文档同步项与 graphify 刷新项
3. 将 Phase 3 明确标记为**进入收尾评审**
4. 然后再切换到 Phase 4 的 provider / observability / hardening 审计与实施
