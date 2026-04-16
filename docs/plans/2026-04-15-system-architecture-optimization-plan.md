# System Architecture Optimization Plan

> **For Hermes:** This is a repo-level optimization plan, not a rewrite plan. Execute incrementally, verify each phase with tests/docs updates, and remove old paths as soon as replacement paths become authoritative.

**Date:** 2026-04-15

**Goal:** 从全局角度收敛当前仓库中“多入口、多控制路径、多套文档口径并存”的问题，建立一致的前后端架构边界、状态流与演进路线。

**Strategy:** 采用 **渐进式重构（incremental refactoring）**，优先解决权威入口、命令写路径、事件协议、巨型 Store 与文档漂移问题；避免全仓库推倒重来。

**Scope:**
- Backend: `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/*`, `src-tauri/src/core/*`, `src-tauri/src/engine/*`, `src-tauri/src/infra/*`
- Frontend: `src/App.tsx`, `src/stores/*`, `src/components/*`, `src/features/downloads/*`, `src/utils/*`
- Docs: `README.md`, `docs/index.md`, `docs/architecture-v2-*.md`, `docs/development.md`, `docs/troubleshooting.md`

---

## 1. Executive Summary

当前项目的主要问题不是“功能缺失”，而是 **演进过程中的架构收敛没有完成**。从代码、graphify 图谱和文档交叉观察，现状可以概括为：

1. **正式架构与历史残留并存**
   - Rust 端存在多个 `main*.rs`
   - Frontend 存在多个 `main*.tsx`、多个 Vite config、多个 HTML 入口
   - 旧视图与现行 `UnifiedView` 并存

2. **写路径不唯一**
   - 命令层同时直接操作 `DownloadManager`、`TaskEngine`、`DownloadRuntime`
   - 文档中宣称的“TaskEngine 单写入口”尚未完全落地

3. **状态同步策略过重**
   - Frontend 同时依赖事件、命令后刷新、周期轮询
   - 新旧事件协议共存

4. **核心模块过度膨胀**
   - `src-tauri/src/core/manager.rs` 超大
   - `src/stores/downloadStore.ts` 超大

5. **文档口径超前于代码**
   - backlog/设计文档中多个事项标记 DONE，但代码仍处于半接线或双轨状态
   - `docs/index.md` 无法覆盖当前文档集合

**结论：** 该项目不应该重写；应该通过 5 个阶段完成系统收敛：
- Phase 0：事实对齐与口径收敛
- Phase 1：删除历史残留入口
- Phase 2：后端单写模型收敛
- Phase 3：前端状态与桥接收敛
- Phase 4：测试与文档治理闭环

---

## 2. Repo-Level Diagnosis

### 2.1 当前已经暴露出的结构性问题

#### A. 入口过多，权威路径不明确
- Rust:
  - `src-tauri/src/main.rs`
  - `src-tauri/src/main-fixed.rs`
  - `src-tauri/src/main-simple.rs`
  - `src-tauri/src/main-minimal.rs`
  - `src-tauri/src/main-original.rs`
- Frontend:
  - `src/main.tsx`
  - `src/main-simple.tsx`
  - `src/main-minimal.tsx`
  - `vite.config.ts`
  - `vite.config.simple.ts`
  - `vite.config.minimal.ts`
  - `index.html`
  - `index-simple.html`
  - `index-minimal.html`

**影响：** 新人难以判断真实入口，旧方案容易继续被误用。

#### B. 核心控制流并未真正单一化
- 单任务动作部分走 `TaskEngine`
- 批量/删除/导入/配置等仍有大量操作直接触达 `DownloadManager`
- `DownloadRuntime` 仍独立承接一部分批量动作

**影响：** 状态语义与并发语义难以统一，后续重构成本不断增加。

#### C. 事件与同步策略双轨并存
- 历史上 Backend 曾同时发旧事件与统一下载事件通道；Frontend 也曾同时监听旧事件、新事件，并辅以 `refreshTasks/refreshStats` 与轮询补偿。
- 当前主链已删除旧前端 listener 与旧后端 emit，只保留 `download.events`。

**影响：** 同一状态可能被多个来源重复覆盖，UI 一致性依赖补丁逻辑而非架构保证。

#### D. 巨型模块是主要维护风险
- `src-tauri/src/core/manager.rs`
- `src/stores/downloadStore.ts`
- `src/components/Import/ImportView.tsx`

**影响：** 改一个点容易引发广泛副作用，测试也难以精准覆盖。

#### E. 文档与代码状态不一致
- `docs/architecture-v2-execution-backlog.md` 多项 DONE 需要回收为 PARTIAL / IN PROGRESS
- `docs/index.md` 未能作为真实文档总导航
- `README.md` 项目结构描述过于理想化

**影响：** 决策依据失真，后续维护者会基于错误假设继续编码。

---

## 3. Optimization Principles

### Principle 1 — 不重写，只收敛
优先保留已有价值高的能力：
- Tauri 命令模型
- Rust 下载核心
- Zustand 全局状态思路
- contracts / reducer 化尝试
- graphify 与现有文档资产

### Principle 2 — 单一权威路径
每个关键问题必须收敛到一个权威答案：
- 正式入口只有一个
- 写路径只有一个
- 事件协议只有一个
- 配置源只有一个
- 文档导航只有一个

### Principle 3 — 先删旧，再扩新
替代路径稳定后，要尽快删除旧路径，而不是长期共存。

### Principle 4 — 先架构边界，后功能优化
优先解决职责分配、模块边界、状态流与事件协议；不要先在坏边界上叠加更多功能。

### Principle 5 — 以可验证成果为阶段结束标准
每个 phase 必须有：
- 代码变更
- 测试/验证
- 文档更新
- 删除旧路径或明确标注 deprecated

---

## 4. Target Architecture

### 4.1 Backend Target Shape

#### Composition Root
- `src-tauri/src/lib.rs` 或 `src-tauri/src/bootstrap.rs` 成为唯一装配根
- `src-tauri/src/main.rs` 只保留 Tauri 启动与 bootstrap 调用

#### Application Layer
新增/强化：
- `application/download_service.rs`
- `application/import_service.rs`
- `application/config_service.rs`
- `application/system_service.rs`

**职责：** 命令层只调用 service，不直接碰 manager/runtime/engine。

#### Write Path
统一为：
`commands -> application service -> TaskEngine/Runtime -> DownloadManager/domain state`

#### Core Layer
把 `manager.rs` 拆为：
- `task_registry.rs`
- `scheduler.rs`
- `execution_coordinator.rs`
- `state_store.rs`
- `metrics_facade.rs`
- `events.rs`

#### Infra Layer
保留真正接线的基础设施，删除或完成半成品：
- event bridge
- capability service
- providers（要么正式接线，要么先移除未完成 provider）

---

### 4.2 Frontend Target Shape

#### Entry
- 唯一正式入口：`src/main.tsx`
- 唯一正式主视图：`src/App.tsx` -> `src/components/Unified/UnifiedView.tsx`

#### State Model
将 `downloadStore.ts` 拆分为：
- `downloadRuntimeStore.ts` — tasks/stats/selection/filter
- `downloadCommands.ts` — invoke 封装
- `downloadEventBridge.ts` — listen / reconnect（legacy fallback 已移除）
- `importSessionStore.ts` — 最近导入、导入快照
- `configStore.ts` — 唯一配置源

#### Feature Layer
强化已有方向：
- `src/features/downloads/model/contracts.ts`
- `src/features/downloads/state/eventReducers.ts`
- 补充 `src/features/downloads/api/*`

#### UI Layer
- 统一使用 `UnifiedView`
- 导入流程、批量操作、状态展示逻辑下沉为 feature hooks / helpers
- 清除旧视图并停止双实现

---

## 5. Phased Optimization Roadmap

## Phase 0 — Facts Alignment（先统一事实与口径）

**Objective:** 先把“项目真实现状”讲清楚，再动架构。

### Tasks
1. 新增 `docs/current-state.md`
   - 记录当前正式入口
   - 记录历史入口/旧方案/实验路径
   - 记录哪些 backlog 项仍为部分完成
2. 重写 `docs/index.md`
   - 拆成：guide / architecture / plans / archive
3. 修订 `README.md`
   - 项目结构改为真实目录结构
   - 标记 `engine/infra/features/downloads` 等真实模块
4. 修订 `docs/architecture-v2-execution-backlog.md`
   - 将与代码不一致的 DONE 改为 `PARTIAL` 或 `IN PROGRESS`

### Exit Criteria
- 新人只读 `README.md + docs/index.md + docs/current-state.md` 就能判断当前正式架构
- 没有再把未接线能力标成 DONE

---

## Phase 1 — Entry & Legacy Cleanup（入口与历史残留清理）

**Objective:** 确立唯一正式入口，降低认知噪音。

### Tasks
1. 后端确立唯一入口
   - 保留：`src-tauri/src/main.rs`
   - 删除：
     - `main-fixed.rs`
     - `main-simple.rs`
     - `main-minimal.rs`
     - `main-original.rs`
2. 前端确立唯一入口
   - 保留：`src/main.tsx`
   - 删除：
     - `main-simple.tsx`
     - `main-minimal.tsx`
     - `index-simple.html`
     - `index-minimal.html`
     - `vite.config.simple.ts`
     - `vite.config.minimal.ts`
3. 清理陈旧测试配置/构建配置
   - 确认 `vitest.config.ts` / `vitest.config.integration.ts` 为唯一测试入口
   - 删除 `vite.config.ts` 内陈旧 test 设置

### Exit Criteria
- 构建入口只剩一套
- 仓库顶层不再存在多套“看起来能启动但并非正式”的入口文件

---

## Phase 2 — Backend Control Flow Convergence（后端单写模型收敛）

**Objective:** 让状态变更真正走统一通道。

### Tasks
1. 统一 composition root
   - 合并 `src-tauri/src/lib.rs` 与 `src-tauri/src/main.rs` 的装配逻辑
2. 在 `commands/*` 与 `core/*` 之间引入 application service 层
3. 把仍直接操作 `DownloadManager` 的写操作逐步迁移进统一通道：
   - `add_download_tasks`
   - `remove_download`
   - `remove_download_tasks`
   - `clear_completed_tasks`
   - `retry_failed_tasks`
   - import/config 相关状态变更
4. 评估 `engine/` 去留
   - 若保留：让它承担真正的唯一写入口职责
   - 若不保留：将其收敛进 runtime
5. 拆分 `manager.rs`
   - 第一波只抽 `events`、`scheduler`、`state_store`

### Exit Criteria
- 所有状态迁移从同一入口发生
- `commands/*` 不再同时直连 manager/runtime/engine 三层
- `manager.rs` 不再继续膨胀

---

## Phase 3 — Event & Frontend State Convergence（事件与前端状态收敛）

**Objective:** 收敛前端同步策略与 store 边界。

### Tasks
1. 以 `download.events` 为唯一正式下载事件协议
2. Backend 删除旧下载事件发射逻辑，或先加明确 deprecated 期限
3. Frontend 提取：
   - `downloadEventBridge.ts`
   - `downloadCommands.ts`
   - `downloadRuntimeStore.ts`
4. 配置源收敛
   - `configStore.ts` 成为唯一配置源
   - `downloadStore` 不再自持完整配置生命周期
5. 收敛同步策略
   - 保留 bootstrap refresh
   - 保留 reconnect 补偿
   - 移除长期轮询作为默认主链路
6. 旧视图/旧导入路径清理
   - 明确 `UnifiedView` 为唯一主路径
   - 归档/删除 `ImportViewOriginal`、无效壳层视图

### Exit Criteria
- 前端状态只由“事件主链路 + 有限补偿刷新”驱动
- 配置不再双写
- 活跃 UI 只剩一条主视图路径

---

## Phase 4 — Test, Contract, and Observability Hardening（测试/契约/观测加固）

**Objective:** 让重构有真实质量门槛。

### Tasks
1. 统一合同模型来源
   - `schemas` / `types` / `contracts` 归一
2. 测试重组
   - Rust 单元测试 vs 集成测试明确分层
   - 修复未接线测试文件
   - Frontend 新增 bridge/reducer/store 集成测试
3. 监控与 system 事件收敛
   - 用真实 capability 替代伪数据
   - system monitor 统一协议输出
4. 文档与代码一起验收
   - 每一阶段完成时同步更新 `README` / `docs/current-state.md` / backlog

### Exit Criteria
- 测试覆盖围绕真实架构边界，而不是围绕历史路径
- 契约只有一个权威来源
- 监控与 system 数据不再依赖 placeholder 语义

---

## 6. Priority Matrix

### P0 — 必须先做
1. 文档事实收敛（README / docs/index / current-state）
2. 单一正式入口收敛（main / main.tsx）
3. 后端写路径收敛（commands -> service -> engine/runtime）
4. `download.events` 成为唯一正式事件协议
5. `configStore` 成为唯一配置源

### P1 — 高收益但可分批做
1. `manager.rs` 模块拆分
2. `downloadStore.ts` 模块拆分
3. 旧视图和旧入口归档/删除
4. provider 半成品清理

### P2 — 第二波治理
1. tests 分层重组
2. 监控/system 观测真实化
3. YouTube / import / config 的 service 化统一

---

## 7. Non-Goals

这次优化计划 **不包括**：
- 状态管理技术替换（不从 Zustand 换到 Redux/XState）
- 桌面技术栈替换（不从 Tauri 换 Electron）
- 全量 UI 改版
- 完整下载内核重写
- 一次性移除全部历史代码而不做过渡验证

---

## 8. Risks and Mitigations

### 风险 1：迁移过程中前后端协议短期不兼容
**缓解：** 先引入 adapter 与 contract tests，再逐步移除旧事件。

### 风险 2：删除旧入口后影响排障方式
**缓解：** 先归档到 `archive/` 或 `examples/`，不要直接不可逆删除。

### 风险 3：`manager.rs` 拆分引发大范围回归
**缓解：** 按“抽类型 -> 抽 façade -> 抽状态 -> 抽调度”顺序小步进行。

### 风险 4：Store 拆分后前端行为不一致
**缓解：** 先保持公开 action API 不变，只做内部重组；用 reducer/store tests 锁住行为。

---

## 9. Recommended First 30% Work Package

如果只做最值得的前 30%，建议按这个顺序：

1. `docs/current-state.md`
2. 重写 `docs/index.md`
3. README 结构图更新
4. 清理多余 `main*` / `main-*.tsx` / `vite.config.*` / `index-*.html`
5. 把后端旧下载事件桥标记 deprecated
6. 抽出 `downloadEventBridge.ts`
7. 把 `configStore` 设为唯一配置源
8. 新增 `application/download_service.rs`
9. 迁移 `remove/clear/retry/add` 等关键写操作到统一入口
10. 为统一入口补 integration tests

这部分完成后，项目会先从“复杂且漂移”进入“复杂但可控”。

---

## 10. Success Criteria

当下面 10 条都成立时，可以认为系统优化计划第一轮成功：

1. 只有一套正式前端入口
2. 只有一套正式后端入口
3. 文档能准确描述当前结构
4. Backlog 不再把半成品标成 DONE
5. 下载状态变更只走一个写入口
6. Frontend 下载同步只依赖一套正式事件协议
7. `configStore` 是唯一配置源
8. `manager.rs` 和 `downloadStore.ts` 开始实质拆分
9. 历史入口和旧视图已归档或删除
10. 对这些架构边界有对应测试保护

---

## 11. Recommendation

**建议立即开始，不建议继续在当前双轨架构上叠加新功能。**

最优先的不是“继续加功能”，而是先做：
- 文档口径对齐
- 入口收敛
- 后端写路径收敛
- 前端事件/配置收敛

只要这四件事收住，后续下载内核、YouTube、导入、监控、性能优化都会容易很多。
