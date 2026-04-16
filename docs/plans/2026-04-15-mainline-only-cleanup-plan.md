# Mainline-Only Cleanup Plan

> **For Hermes:** This plan replaces the earlier “long-term compatibility” mindset with a **mainline-only cleanup** mindset. Keep the latest authoritative path, delete obsolete paths aggressively once their replacement is confirmed, and avoid preserving dead code just for history.

**Date:** 2026-04-15

**Goal:** 让仓库只保留当前最新、权威的一套前后端主链，系统性删除无用旧代码、历史兼容逻辑和长期未完成的过渡层。

**Architecture:** 以后只承认一套 authoritative mainline：前端 `src/main.tsx -> App.tsx -> UnifiedView -> downloadEventBridge/downloadStore/configStore`，后端 `main.rs -> commands -> runtime/task engine -> manager/runtime_* -> download.events`。凡是不再服务这条主链的代码，优先删除，而不是继续兼容共存。

**Tech Stack:** Tauri v2, Rust, React, Zustand, graphify, GSD planning workflow

---

## 1. Authoritative Mainline

### Frontend authoritative path
- `src/main.tsx`
- `src/App.tsx`
- `src/components/Unified/UnifiedView.tsx`
- `src/features/downloads/state/downloadEventBridge.ts`
- `src/features/downloads/state/eventReducers.ts`
- `src/stores/downloadStore.ts`
- `src/stores/configStore.ts`

### Backend authoritative path
- `src-tauri/src/main.rs`
- `src-tauri/src/commands/*.rs`
- `src-tauri/src/core/runtime.rs`
- `src-tauri/src/engine/task_engine.rs`
- `src-tauri/src/core/manager.rs`
- `src-tauri/src/infra/download_event_bridge.rs`
- `download.events`

### Cleanup rule
Only code that directly serves the authoritative path stays. Everything else must justify its existence or be removed.

---

## 2. What the audit already confirms

### Already non-authoritative / historical
- 旧前端/后端历史入口已经不属于主链，并将从当前仓库主表面移除
- `src/main-simple.tsx`, `src/main-minimal.tsx`, `vite.config.simple.ts`, `vite.config.minimal.ts`, `index-simple.html`, `index-minimal.html` 已从当前仓库主表面移除
- `src-tauri/src/main-simple.rs`, `main-minimal.rs`, `main-fixed.rs`, `main-original.rs`, `tauri-minimal.conf.json` 已从当前仓库主表面移除

### Frontend event mainline after cleanup
- `src/features/downloads/state/downloadEventBridge.ts` 已删除 legacy fallback 监听
- 当前前端唯一事件通道为 `download.events`
- envelope 版本通过 `schema_version` 管理，而不是写死在通道名中
- 事件通道命名已规范化为稳定语义名 `download.events`，符合生产环境长期演进习惯
- `task.status_changed` 已开始本地派生关键 stats
- `syncRuntimeState()` 已统一命令后 refresh / polling 补偿入口

### Transitional compatibility still in state layer
- `downloadStore.updateConfig/resetConfig` 兼容包装已移除，配置写路径已收敛到 `configStore`
- `downloadStore.ts` 仍然是巨型 runtime container，尚未彻底拆成 runtime / commands / bridge / import session 等独立模块

### Backend still likely has removable transitional surface
- placeholder system monitor control commands 已移除，不再保留无消费者的监控控制壳
- `manager.rs` 仍然过大，说明旧职责仍未彻底清空
- provider/capability/monitoring 等路径仍需继续判定是否真正服务主链
- 旧事件是否仍在后端发出，需要作为下一轮删除前审计项

---

## 3. Cleanup strategy

### Principle A — Keep latest, delete old
不再默认“保留兼容层以防万一”。如果最新主链已经存在且接线完成，旧路径应进入删除名单。

### Principle B — Delete in batches, not randomly
每批删除都必须有一个边界明确的主题，例如：
1. 入口历史残留批
2. legacy 事件协议批
3. config compatibility 批
4. giant store 拆分后遗留批
5. backend half-wired provider/monitoring 批

### Principle C — Docs and graph must be updated in the same turn
每次删除/清理都同步：
- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `docs/current-state.md`
- `docs/index.md`
- `./scripts/ai-workflow.sh sync`

### Principle D — No fake verification
当前环境缺少：
- `pnpm`
- `node_modules/`
- `cargo`

因此删除后只能做：
- 静态搜索验证
- graphify 刷新
- 文档/路径引用一致性检查

不能声称：
- frontend tests passed
- cargo tests passed
- build passed

---

## 4. Execution roadmap

## Batch 1 — Physically remove archived legacy entrypoints from active repo surface
**Objective:** 让仓库根目录和常规阅读路径中不再继续保留“只作历史参考”的多入口文件集合。

**Candidate targets:**
- 历史入口相关归档目录已决定移除，不再作为当前仓库表面保留
- 相关仍引用这些归档材料的 docs 说明

**Why now:**
这些文件对“全新开发”目标没有增益，只会继续污染图谱和认知。

**Verification:**
- `docs/entrypoints.md` / `docs/current-state.md` / `docs/index.md` 中不再把 archive 视为默认参考
- graphify 图谱不再被历史入口碎片污染

---

## Batch 2 — Remove frontend legacy event fallback
**Objective:** 前端只监听 `download.events`，彻底删除 legacy event compatibility。

**Files:**
- Modify: `src/features/downloads/state/downloadEventBridge.ts`
- Search/update references in docs and tests

**Delete:**
- `download_progress` listener
- `task_status_changed` fallback listener
- `hasVersionedEvents` / `legacyFallbackDetached` related compatibility state if no longer needed

**Keep:**
- `download.events`
- `task.progressed`
- `task.status_changed`
- `task.stats_updated`
- `syncRuntimeState()` polling compensation (only until event chain is strong enough to reduce further)

**Verification:**
- 搜索 `download_progress` / `task_status_changed` frontend listener 结果为 0
- `downloadEventBridge.ts` 只保留 v1 主链监听
- 本批已执行完成（静态验证 + graphify 刷新）

---

## Batch 3 — Remove downloadStore config compatibility wrappers
**Objective:** 不再允许 `downloadStore` 继续扮演配置更新兼容入口。

**Files:**
- Modify: `src/stores/downloadStore.ts`
- Modify: `src/stores/configStore.ts`
- Update call sites under `src/components/**`

**Delete or restrict:**
- `downloadStore.updateConfig`
- `downloadStore.resetConfig`

**Target state:**
- 配置读写只走 `configStore`
- `downloadStore` 最多保留只读镜像，最终也应继续收敛

**Verification:**
- 搜索 `useDownloadStore(...updateConfig/resetConfig...)` 结果为 0
- settings 等 UI 改为只依赖 `configStore`

---

## Batch 4 — Split and shrink downloadStore around mainline responsibilities
**Objective:** 只保留最新 runtime 主链需要的 store 责任，删除或迁出其余历史混杂职责。

**Possible extraction targets:**
- `downloadRuntimeStore.ts`
- `downloadCommands.ts`
- `importSessionStore.ts`

**Candidate removals after extraction:**
- 与 import session 强耦合但不属于 runtime state 的逻辑
- 仍然残留的 compatibility helpers
- 与 config 真源混杂的历史字段

**Verification:**
- `downloadStore.ts` 行数显著下降
- bridge / commands / config 职责不再混居同一文件

---

## Batch 5 — Backend mainline-only cleanup
**Objective:** 后端只保留真正服务现行主链的 service/runtime/provider/infra 代码。

**Audit targets before delete:**
- `src-tauri/src/infra/providers/*`
- `src-tauri/src/core/monitoring*.rs`
- `src-tauri/src/core/*integration_tests.rs` 中仍绑定旧路径的测试
- 是否仍发旧事件协议
- `src-tauri/src/bin/preview_cli.rs` 是否仍有实际价值

**Candidate removals:**
- 半接线 provider
- 无实际调用的 preview/debug binary
- 旧事件发射逻辑
- 不再匹配主链的测试与调试残留

**Verification:**
- 主链事件协议只剩 `download.events`
- commands/runtime/manager 的调用边界比当前更窄、更清晰

---

## 5. Recommended execution order

1. **先做 Batch 2**
   - 风险最可控
   - 与当前 Phase 3 完全连续
   - 能最快体现“只保留最新协议”

2. **再做 Batch 3**
   - 让 `configStore` 真正成为唯一配置入口

3. **然后决定 Batch 1 是否连 archive 一起删掉**
   - 这是最“干净”的方向
   - 但也最不可逆

4. **最后进入 Batch 4 / Batch 5**
   - 它们更大，适合在前面主链彻底收紧后继续做

---

## 6. Immediate next action

**Best next step:**
> 直接执行 **Batch 2 — Remove frontend legacy event fallback**

这是最符合“全新开发、只保留最新一套逻辑”的第一批清理动作：
- 删除前端对 `download_progress` / `task_status_changed` 的兼容监听
- 保留 `download.events` 作为唯一前端事件主链
- 继续保留 polling 作为最后一层补偿，避免一次删太猛

---

## 7. Verification checklist for every cleanup batch

- [ ] 删除目标已从代码中清零或降为单一入口
- [ ] 文档同步更新
- [ ] `./scripts/ai-workflow.sh sync` 成功
- [ ] 没有声称无法证明的测试通过
- [ ] graphify 图谱对主链的表达比清理前更简单
