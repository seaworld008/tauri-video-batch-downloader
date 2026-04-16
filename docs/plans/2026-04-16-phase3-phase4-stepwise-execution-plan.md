# Phase 3 → Phase 4 Stepwise Execution Plan

> **For Hermes:** follow this plan in order; keep using brownfield + graphify + GSD workflow, run targeted verification after each seam extraction, and sync `.planning/`, docs, and graphify outputs after meaningful progress.

**Goal:** 完成 `downloadStore.ts` 的剩余高密度职责收敛，收口 Phase 3 的前端状态与事件主链；随后进入 Phase 4，对 provider / observability / hardening 做系统化清理。

**Architecture:** 延续当前 brownfield seam-first 策略：先把前端 giant store 中的 command-after-effects、mutation-after-effects、runtime-after-effects 抽成 feature-local helpers，再用 focused Vitest 锁住行为；等前端主链边界稳定后，再进入 Phase 4 的 provider 与可观测性治理，最后评估是否重新打开后端 `DownloadManager` 深拆。

**Verified current baseline (2026-04-16):**
- `downloadStore.ts` 已从 1500+ 行持续压到约 718 行
- 已抽出：`downloadEventBridge`、`runtimeSync`、`validationFlow`、`validationResultFlow`、`downloadViewState`、`importSessionState`、`importValidation`、`importOrchestration`、`taskCreationFlow`、`taskCreationOrchestration`、`taskCreationAction`、`taskCreationStoreAction`、`taskCreationState`、`taskCreationEffects`、`taskCreationError`、`taskMutationEffects`、`taskOutputPathStoreAction`、`initializeStoreStoreAction`
- 近期 targeted Vitest 已达到：`3 files / 37 tests`（本轮 initialize-store seam）+ 多轮 Phase 3 focused suites 持续通过；并已 fresh 跑通 `pnpm type-check`
- graphify 最新摘要：`1801 nodes / 3054 edges / 164 communities`
- 后端最大热点仍是 `src-tauri/src/core/manager.rs`（约 5374 行）

---

## A. 当前剩余任务全景（按执行顺序）

### Track P3-A — 继续收薄 `downloadStore.ts` 的 command-after-effects
- [x] `applyOutputDirectoryOverride()` 的 state merge / target-task selection / output-path update request 组装已进一步抽到 `features/downloads/state/taskOutputPathEffects.ts`
2. 抽离 `startAllDownloads()` 的 runtime-sync + success feedback helper
3. 抽离 `pauseAllDownloads()` 的 runtime-sync + success feedback helper
4. 抽离 `retryFailedTasks()` 的 task selection + sequential orchestration helper
5. 复审 `startDownload()` / `pauseDownload()` / `resumeDownload()` / `cancelDownload()` 是否还存在可进一步共享的 command-after-effects 模式

### Track P3-B — 继续收薄 import / initialization / validation 邻接热点
6. 评估 `importFromFile()` 是否还需要一层 facade helper（当前已较薄，可放低优先级）
7. 评估 `initializeStore()` 是否可以拆出 `initialRuntimeBootstrap` helper（tasks/stats fetch + validation + state patch）
8. 评估 `forceSync()` 是否可以和 `runtimeSync` / `validationHelpers` 再统一一层 facade
9. 评估 `validateAndSync()` 是否已经达到 thin facade 目标；若未达到，则只允许继续做最小一层 orchestration helper，不做重写

### Track P3-C — Phase 3 收口与通过标准
10. 汇总 `downloadStore.ts` 中残余大块职责，确认是否还存在明显未抽离的 command/mutation/runtime side-effects
11. 补充 focused Vitest 缺口，尤其是新抽 helper 对应的 store-level orchestration tests
12. 更新 `.planning/STATE.md` / `.planning/ROADMAP.md` / `docs/current-state.md` / `docs/index.md`
13. 运行 `./scripts/graphify-sync.sh smart`
14. 当 `downloadStore.ts` 只剩 orchestration + 少量 store-local mapping 时，标记 Phase 3 可进入收尾评审

### Track P4-A — Provider / Observability / Hardening（Phase 4）
15. 审计 provider 与 capability 探测路径：梳理未完成接线、占位接口、重复判断
16. 审计 monitoring / system event 语义：确认已删除死路径后，剩余 system info / monitoring 命令是否仍存在 placeholder 语义
17. 对关键前后端边界补测试：command seams、runtime sync、event bridge、provider 接线、monitoring 输出
18. 清理文档漂移，形成 Phase 4 的真实状态文档与关闭条件

### Track P4-B — 后端深热点回访（条件性）
19. 在 Phase 3/4 稳定后，重新评估 `src-tauri/src/core/manager.rs` 是否需要进入下一轮拆分
20. 如果进入，则优先从“职责分层明确、blast radius 最小”的子域开始，而不是直接大重构

---

## B. 本轮开始执行的任务计划（Step-by-step）

### Task 1: 收敛 `applyOutputDirectoryOverride()`
**Objective:** 把输出路径 override 的结果归并逻辑从 `downloadStore.ts` 抽到 helper，继续压缩 store 中 mutation-after-effects 旁支。

**Files:**
- Modify: `src/stores/downloadStore.ts`
- Create/Modify: `src/features/downloads/state/taskOutputPathEffects.ts`（如命名更合适可微调）
- Modify/Test: `src/stores/__tests__/downloadStore.test.ts`
- Create/Test: `src/features/downloads/state/__tests__/taskOutputPathEffects.test.ts`

**Verification:**
- `corepack pnpm exec vitest run src/stores/__tests__/downloadStore.test.ts src/features/downloads/state/__tests__/taskOutputPathEffects.test.ts`

### Task 2: 收敛 `startAllDownloads()` / `pauseAllDownloads()`
**Objective:** 把 batch-control 的 runtime-sync + success feedback 模式抽成 helper，减少 store 中命令后副作用模板代码。

**Files:**
- Modify: `src/stores/downloadStore.ts`
- Create: `src/features/downloads/state/batchControlEffects.ts`
- Tests: `src/features/downloads/state/__tests__/batchControlEffects.test.ts`, `src/stores/__tests__/downloadStore.test.ts`

**Verification:**
- `corepack pnpm exec vitest run src/stores/__tests__/downloadStore.test.ts src/features/downloads/state/__tests__/batchControlEffects.test.ts`

### Task 3: 审计并收敛 `retryFailedTasks()`
**Objective:** 决定它是否保留在 store 作为薄 facade，或抽出 failed-task selection / enqueue orchestration helper。

### Task 4: 形成 Phase 3 收口检查表
**Objective:** 把剩余 `downloadStore.ts` 大块职责列成 checklist，作为 Phase 3 关闭条件。

### Task 5: 进入 Phase 4 审计计划
**Objective:** 当前端主链足够薄后，启动 provider / observability / hardening 审计。

---

## C. 执行策略
- 每次只做一刀小收敛
- 每刀必须跑 targeted Vitest
- 每刀后必须更新 docs/planning/graphify（至少在有意义进展后）
- 不提交，除非用户明确要求
- 不把 Phase 4 与当前前端 store 收敛混做；Phase 4 先审计后实施

---

## D. 当前决策
**`applyOutputDirectoryOverride()`、`initializeStore()` 以及本轮新增的 `validateAndSync()` / `forceSync()` store-level seam 已完成并完成 focused verification；下一轮应继续审计 `downloadStore.ts` 剩余 orchestration 热点，若已无明显厚段，则转入 Phase 3 收尾评审与 Phase 4 audit-first 实施。**
