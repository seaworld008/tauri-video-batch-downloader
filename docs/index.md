# 文档导航

这份索引只描述当前仓库中真实存在且应持续维护的文档，并优先反映 2026-04-16 当前工作树上的主链事实。

---

## 1. 首先看这些

如果你第一次接手这个项目，建议按下面顺序阅读：

1. `README.md` — 项目总览、真实结构、当前开发方式
2. `current-state.md` — 当前真实状态、正式入口、主链收敛结果
3. `entrypoints.md` — 正式入口与历史入口清单
4. `gsd-graphify-workflow.md` — 持续迭代开发工作流（GSD + graphify）
5. `.planning/ROADMAP.md` — 当前阶段路线图与 closeout / hardening 进度
6. `../graphify-out/GRAPH_REPORT.md` — 本地代码图谱摘要

---

## 2. 项目基础文档

- `overview.md`：项目介绍与适用场景
- `features.md`：功能说明（偏使用者视角）
- `architecture.md`：基础架构说明
- `development.md`：本地开发与测试
- `build-release.md`：构建、打包与发布
- `integration.md`：导入/对接相关说明
- `troubleshooting.md`：排查指南与日志说明

---

## 3. 当前架构与演进文档

这些文档主要用于理解“项目为什么要收敛、该怎么收敛”：

- `current-state.md`：当前真实状态，不等同于目标架构
- `architecture-v2-delivery-plan-2026-04-10.md`：下载系统重构基线方案
- `architecture-v2-execution-backlog.md`：架构 V2 执行任务拆解（需结合当前实现判断完成度）
- `plans/2026-04-15-system-architecture-optimization-plan.md`：当前系统优化计划
- `plans/2026-04-15-mainline-only-cleanup-plan.md`：mainline-only cleanup 策略说明
- `plans/2026-04-15-download-core-call-chain-analysis.md`：后端核心链路 + 前端交互链分析
- `plans/2026-04-15-backend-write-path-boundary-map.md`：Phase 2 写路径边界与统一入口基线
- `plans/2026-04-16-phase3-closeout-checklist.md`：Phase 3 收尾检查表
- `plans/2026-04-16-phase3-phase4-stepwise-execution-plan.md`：Phase 3 → Phase 4 顺序化执行计划
- `plans/2026-04-16-phase4-provider-observability-audit.md`：Phase 4 audit-first 基线

### 当前主链代码/边界文档要点

- `src-tauri/src/infra/download_event_bridge.rs`：Rust 下载事件桥 seam
- `src-tauri/src/infra/capability_service.rs`：正式能力探测入口；已与历史 providers 命名空间解耦
- `src-tauri/src/core/queue_scheduler.rs`：从 `DownloadManager` 抽出的队列调度 seam
- `src/features/downloads/api/*.ts`：前端 feature-local API seams（download/config/import/system/runtimeQueries）
- `src/features/downloads/state/*.ts`：前端 state/orchestration seams（runtimeSync、validation、taskCreation、taskMutation、batch/retry 等）
- `src/utils/frontendLogging.ts`：共享 frontend logging seam
- `src/stores/downloadStore.ts`：当前前端运行时容器，已进入 thin orchestrator 区间
- `src/stores/configStore.ts`：当前前端配置真源
- `src/stores/uiStore.ts`：当前已收敛为 notifications-only store

### 当前重要事实（2026-04-16）

- 正式前端主视图已收敛到 `UnifiedView`
- 旧 `DownloadsView` / `OptimizedDownloadsView` / `TaskList` / `TaskItem` 已删除
- 现行前端主链 consumer audit 又确认 `ImportSuccessGuide.tsx` / `WorkflowTips.tsx` / `EmptyState.tsx` 已无生产消费者并已删除
- 本轮继续确认旧 `ImportView.tsx` / `useImportGuide.ts` 已无生产消费者并已删除，正式导入 UI 继续收敛为 `UnifiedView -> FileImportPanel`
- 本轮又继续把正式导入 command surface 的假契约删掉：由于当前 UI 并无 Excel sheet 选择能力，`importCommands.ts` 与 Rust `commands/import.rs` 中伪存在的 `sheetName/sheet_name` 参数已被移除，避免主链继续暴露未实现的导入能力
- 前端生产代码里的零散 `invoke(...)` 已收口到 feature-local API seam
- Rust 侧 `resume_all_downloads` / `start_all_pending` / `cancel_all_downloads` 的 command/runtime/manager dead paths 已删除
- Rust monitoring observability compile surface 已完成进一步 mainline-only cleanup：在确认 `core/monitoring.rs` / `monitoring_integration_tests.rs` 只剩历史债务意义后，这整块 monitoring 模块与测试已从源码树删除，manager 中仅服务该模块的 cfg 挂件也已一并摘除
- 最新一轮又把 Rust 侧剩余旧测试分区整体清退：`src-tauri/src/core/` 下 7 个仅服务旧分区的测试文件、`core/mod.rs` 中对应模块接线、`file_parser.rs` 中仅供旧测试使用的 helper seam，以及 `Cargo.toml` 中对应的旧测试 feature 都已删除。仓库当前已不再保留独立 legacy test partition。
- fresh 验证已跑通：
  - `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml`
  - `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests`
  - `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --tests --features integration-tests`
  - `~/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
  - `~/.cargo/bin/cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
  - `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`
  - `~/.hermes/node/bin/corepack pnpm lint`
  - `~/.hermes/node/bin/corepack pnpm exec vitest run`
  - `bash ./scripts/graphify-sync.sh smart`
  - `~/.hermes/node/bin/corepack pnpm exec vitest run --config vitest.config.integration.ts`
- 这说明 Rust 侧当前完成的已经不只是 integration-only compile-surface 收口，而是历史测试分区本身也已从仓库结构删除；与此同时，前后端主质量门现在也已在当前环境跑通，仓库级 `pnpm test:all` 已能作为真实 completion gate 使用。当前剩余未闭合项只剩 auto-continue 语义下的 clean worktree + completion sentinel。

---

## 4. 工作流文档

- `gsd-graphify-workflow.md`：本项目推荐的 GSD + graphify 联合工作流
- `auto-continue-workflow.md`：仓库自动续跑说明，包含 `auto-progress`、handoff、writer lease 与 completion sentinel
- `plans/2026-04-16-ai-auto-dev-best-practices-survey.md`：AI 自动开发工作流最佳实践调研
- `plans/2026-04-16-hermes-graphify-gsd-autonomous-workflow-implementation-plan.md`：将调研结论转成可执行实施方案
- `.planning/STATE.md`：当前轮次执行状态与 blocker
- `.planning/ROADMAP.md`：阶段路线图与 Phase 4 进展

---

## 5. 历史计划 / 评审 / 交接文档

以下文档仍有参考价值，但不应默认视为当前唯一事实源：

- `ai-agent-technical-guide.md`
- `code-review-2026-04-07.md`
- `code_review.md`
- `task_handoff_20260226_114332.md`
- `b-c-d-a_full_optimization_plan_20260226_115301.md`
- `plans/2026-02-04-download-queue-pause-design.md`
- `plans/2026-04-13-download-directory-ux-design.md`
- `plans/2026-04-13-download-directory-ux-implementation.md`
- `plans/2026-04-13-download-engine-rearchitecture-design.md`
- `plans/2026-04-13-download-engine-rearchitecture-implementation.md`
- `plans/2026-04-13-full-system-refactor-assessment.md`

使用这些文档时，应优先与以下文件交叉验证：

- `current-state.md`
- `.planning/ROADMAP.md`
- `../graphify-out/GRAPH_REPORT.md`

---

## 6. 维护规则

1. `README.md` 负责对外总览，不能写成理想化宣传页。
2. `current-state.md` 负责当前事实，目标方案不要直接覆盖当前状态说明。
3. `.planning/` 负责当前迭代计划与执行状态。
4. `graphify-out/` 是本地分析产物，用于辅助理解与规划，不默认入库。
5. 历史设计文档若与当前实现不一致，必须在文档或索引中明确说明。
