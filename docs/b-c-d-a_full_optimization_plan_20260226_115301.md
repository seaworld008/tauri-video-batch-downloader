# B-C-D-A 全量优化修复计划（仓库持久备份）

> 备份时间：2026-02-26 11:53:01  
> 备份目的：避免会话关闭导致计划丢失，作为项目内长期可追溯基线文档。  
> 适用范围：Tauri v2 升级后的主线优化与重构推进（B → C → D → A）。

---

## 1. 总目标与执行顺序

本轮主线严格按以下顺序推进，不跳步：

**B → C → D → A**

- **B（后端）**：并发、暂停/恢复、冷启动恢复一致性
- **C（前端）**：状态同步去“破坏性乐观更新”，以后端事件为准
- **D（工程）**：命令链路可观测性与 CI 评审闭环
- **A（验证）**：回归矩阵、E2E、最终收口与文档清理

补充约束：

- `docs/code_review.md` 中问题暂不提前处理，待主线 B-C-D-A 完成后统一收尾。

---

## 2. 当前已完成进度

### 2.1 B 阶段：`b-runtime-lock-split`（已完成）

- 对 `DownloadManager` 关键 runtime 路径做锁拆分，缩短写锁持有时间，减少 `await` 跨锁。
- 修复 `runtime_start_download` / `runtime_resume_download` 互调导致的异步递归编译问题（`E0733`）。
- 验证通过：`cargo check`、`cargo test`。

### 2.2 B 阶段：`b-active-handle-lifecycle`（已完成）

- 新增并接入 `reap_finished_active_downloads`。
- 在任务启动、调度、取消、队列处理路径主动回收已完成 `JoinHandle`。
- 效果：避免并发槽位被“假占用”。

### 2.3 B 阶段：`b-pause-resume-consistency`（进行中，已落地关键修复）

已完成修复：

1. **事件回放防回退（`apply_event_side_effects`）**
   - 阻止 `TaskPaused` 覆盖终态（Completed/Cancelled/Failed）。
   - 阻止 `TaskStarted/TaskResumed` 覆盖暂停态与终态。
   - 防御“迟到 `TaskPaused`”导致恢复后误回滚。

2. **进度单调性（`update_task_progress_snapshot`）**
   - `downloaded_size` 保证单调不减。
   - 增加 `Failed` 的终态保护。
   - 保证进度不超过 `total_size`。

3. **恢复后状态清理（`runtime_resume_download`）**
   - 明确清理 `paused_at = None`。
   - 明确清理 `paused_from_active = false`。

4. **磁盘优先同步（`resume_downloader.rs`）**
   - `sync_chunks_with_temp_files` 由“仅磁盘更大时同步”改为“有差异就同步”。
   - 文件缺失/空文件时重置 chunk 到 `Pending` + `downloaded=0`。

5. **单分片 Range 续传语义修复**
   - 单 chunk 且已有进度时强制 Range 请求。
   - 若发起 Range 但服务端未返回 `206`，立即报错防止脏写。

6. **并发分片失败时进度保全**
   - `download_with_resume` 不再首错即退。
   - 改为收敛所有分片结果、同步磁盘与持久化后再返回错误。
   - 避免“部分成功进度丢失”。

---

## 3. 当前接手点（Now）

当前重点：

- 继续完成 `b-pause-resume-consistency` 的收尾复核，确认是否还存在“提前返回导致进度未落盘”的遗漏分支。

重点代码范围：

- `src-tauri/src/core/resume_downloader.rs`
- `src-tauri/src/core/manager.rs`
- `src-tauri/src/core/models.rs`

---

## 4. 剩余任务清单

### 4.1 B 阶段剩余

- `b-pause-resume-consistency`：全链路边界收口与回归验证
- `b-startup-recovery-batch`：冷启动恢复批处理与 `paused_from_active` 收口

### 4.2 C 阶段

- `c-store-deoptimistic`：移除前端破坏性乐观更新，改为后端确认驱动

### 4.3 D 阶段

- `d-command-path-observe`：补命令路径可观测性
- `d-ci-review-loop`：建立 CI 回归/审查循环

### 4.4 A 阶段

- `a-regression-matrix`：B-C-D-A 全链路回归矩阵
- `a-e2e-tests`：关键链路 E2E 补齐
- `a-docs-regression`：主线完成后对照 `docs/code_review.md` 统一清理

---

## 5. 风险与注意事项

1. **工作区较脏**：存在历史改动与构建产物，提交前需谨慎隔离“本次变更”。
2. **暂停/恢复链路复杂**：状态机 + 并发 + 事件乱序 + 磁盘状态 + HTTP 语义，必须小步提交与强回归。
3. **计划文档丢失风险**：本文件即为针对该风险的仓库内持久备份。

---

## 6. 推荐执行策略（给后续 AI/开发者）

1. 先完成 B，不提前切 C/D/A。  
2. `resume_downloader.rs` 优先复核：
   - chunk 状态落盘时机；
   - pause/cancel 与分片收敛顺序；
   - resume info 与实际文件系统一致性。
3. 每次仅做最小补丁，并立刻验证：
   - `cargo check -q`
   - `cargo test -q`
4. B 完成后按顺序推进 C → D → A。
5. 全部主线完成后再处理 `docs/code_review.md`。

---

## 7. 回归命令

```bash
cargo check -q
cargo test -q
```

如进入 C 阶段涉及前端，再补：

```bash
pnpm test
pnpm build
```

---

## 8. 接续提示词（可复制）

```text
你现在接手一个 Tauri v2 升级后的重构项目，请严格遵循：

1) 顺序必须是 B → C → D → A，不允许跳步。
2) docs/code_review.md 暂不处理，主线完成后统一收尾。
3) 已完成：
   - b-runtime-lock-split
   - b-active-handle-lifecycle
   - b-pause-resume-consistency 的关键修复（事件防回退、进度单调、resume 清理、磁盘优先同步、单chunk Range 206 校验、并发失败进度保全）
4) 当前进行中：b-pause-resume-consistency 收尾，重点排查“提前返回导致进度未落盘”遗漏分支。
5) 重点文件：
   - src-tauri/src/core/resume_downloader.rs
   - src-tauri/src/core/manager.rs
   - src-tauri/src/core/models.rs
6) 工作方式：
   - 只做最小补丁，避免大重构
   - 每次改动后必须跑 cargo check -q && cargo test -q
   - 不确定行为先读代码再改，不做猜测
7) B 收尾后推进 C、D、A。
8) 每轮输出：改动内容、改动原因、验证结果、风险点（中文）。
```

---

## 9. 相关文件索引

- `src-tauri/src/core/manager.rs`
- `src-tauri/src/core/resume_downloader.rs`
- `src-tauri/src/core/models.rs`
- `docs/code_review.md`
- `docs/task_handoff_20260226_114332.md`
- `AGENTS.md`

