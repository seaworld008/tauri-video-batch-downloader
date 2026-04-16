# Backend Write-Path Boundary Map

**Date:** 2026-04-15

**Purpose:** 在进入 Phase 2 之前，把当前后端命令按 `query / control / mutation / bridge side effects` 分类，明确哪些路径已经走统一控制链，哪些仍然直接修改 `DownloadManager`，以及第一波收敛应该从哪里下手。

---

## 1. Executive Summary

当前后端已经有一条明确的控制主链：

```text
command -> TaskEngine -> DownloadRuntime -> DownloadManager::runtime_* -> DownloadEvent -> main.rs bridge
```

但这条链只覆盖了“开始 / 暂停 / 恢复 / 取消 / 批量控制”等一部分动作。与此同时，`commands/config.rs`、`commands/import.rs`、`commands/download.rs` 中仍然存在一批**直接 `download_manager.write().await`** 的 mutation，这使系统目前仍处于**双写路径并存**状态。

这份边界图的结论是：

1. **query 可以继续直接读 manager / config**，这不是当前首要矛盾。
2. **control 已基本走 TaskEngine / Runtime**，但批量控制和事件回写仍有边角不一致。
3. **mutation 尚未统一**，这是 Phase 2 的第一目标。
4. **`main.rs` 的 event bridge 还承担了 `apply_event()` 的状态回写职责**，说明 bridge 目前不只是投递层。

---

## 2. Current Backend Command Taxonomy

## 2.1 Query commands

这些命令以读取为主，不是当前首要收敛对象：

- `commands/download.rs`
  - `get_download_tasks()`
  - `get_download_stats()`
  - `get_rate_limit()`
- `commands/config.rs`
  - `get_config()`
- `commands/import.rs`
  - `preview_import_data()` / `get_supported_formats()` / `detect_file_encoding()` / 其它预览类命令

### Current read source
- `state.download_manager.read().await`
- `state.config.read().await`

### Phase 2 judgement
- 这些读取路径可以先保留。
- 真正需要优先统一的是 mutation，不是 query。

---

## 2.2 Control commands already on the new chain

以下命令已经基本遵循统一控制通道：

- `start_download()`
- `pause_download()`
- `resume_download()`
- `cancel_download()`
- `pause_all_downloads()`
- `resume_all_downloads()`
- `start_all_downloads()`
- `start_all_pending_downloads()`（查询 task id 后逐个交给 `task_engine.start_task()`）
- `cancel_all_downloads()`（查询 task id 后逐个交给 `task_engine.cancel_task()`）

### Current path

```text
commands/download.rs
  -> TaskEngineHandle::{start,pause,resume,cancel}_task()
  -> DownloadRuntimeHandle::{start,pause,resume,cancel}_task()
  -> RuntimeCommand
  -> core/runtime.rs::handle_command()
  -> DownloadManager::runtime_*
```

### Evidence
- `src-tauri/src/commands/download.rs`
- `src-tauri/src/engine/task_engine.rs`
- `src-tauri/src/core/runtime.rs`
- `src-tauri/src/core/manager.rs`

### Phase 2 judgement
- 这条链已经是目标雏形。
- 后续不应再新增绕过这条链的下载生命周期写操作。

---

## 2.3 Mutation commands still writing manager directly

以下命令目前仍直接获取 `download_manager.write().await` 并修改状态：

### In `commands/download.rs`
- `add_download_tasks()`
- `update_task_output_paths()`
- `remove_download()`
- `remove_download_tasks()`
- `clear_completed_tasks()`
- `retry_failed_tasks()` 的 reset 阶段（`manager.retry_failed()`）
- `set_rate_limit()`（虽然是配置型 mutation，但仍直达 manager）

### In `commands/config.rs`
- `update_config_impl()`
- `reset_config_impl()`
- `import_config_impl()`

### In `commands/import.rs`
- （历史）`import_tasks_and_enqueue()`；当前该 compat command 已按 mainline-only cleanup 删除

### Current path

```text
command -> state.download_manager.write().await -> manager method
```

### Problem
这意味着当前至少同时存在三条写路径：

```text
A. commands -> TaskEngine -> Runtime -> manager
B. commands -> Runtime -> manager
C. commands -> manager
```

这会带来几个具体问题：

1. **顺序语义不一致**：有的 mutation 被 runtime 串行化，有的没有。
2. **可观测性不一致**：有的动作天然产生 runtime trace / ack，有的直接落进 manager。
3. **测试边界不一致**：难以定义“统一写入口”的回归测试。
4. **职责边界漂移**：commands 一旦可以随手直写 manager，service/runtime 就难以稳定成型。

---

## 2.4 Bridge side effects still mixed into `main.rs`

当前 `main.rs` 的事件桥不只是把领域事件发给前端，它还做了这一步：

```rust
if let Err(sync_err) = download_runtime_for_events.apply_event(event.clone()).await
```

也就是说当前链路是：

```text
DownloadManager emits DownloadEvent
  -> main.rs event bridge
  -> download_runtime.apply_event(event.clone())
  -> runtime_apply_event_side_effects(...)
  -> 再 emit 到前端
```

### Phase 2 judgement
- 这说明 event bridge 仍参与后端状态闭环。
- Phase 2 不一定立刻移除它，但需要把它明确标注为“过渡期 side-effect bridge”，不能默认当成纯桥接层。

---

## 3. File-by-File Boundary Assessment

## 3.1 `src-tauri/src/commands/download.rs`

### Current role
- 同时承担 query、control、mutation 三类职责。

### Boundary issue
- 一个文件里既有 `start_download()` 这种走 engine/runtime 的命令，
- 也有 `remove_download()` / `clear_completed_tasks()` 这种直接写 manager 的命令。

### Refactor target
- 保留为 Tauri command adapter。
- 不再允许这里直接持有 manager 写锁来做领域 mutation。

---

## 3.2 `src-tauri/src/commands/config.rs`

### Current role
- 配置读写 + 保存磁盘 + 反向同步下载 manager。

### Boundary issue
- `config` 的 source of truth 和 `download_manager` 的 runtime config 目前通过 command 层手工双写维持。

### Refactor target
- 引入单一 config mutation service / runtime command。
- command 层只做参数校验、错误映射、调用 use-case。

---

## 3.3 `src-tauri/src/commands/import.rs`

### Current role
- 文件解析预览 + 导入转换 + 任务创建。

### Boundary issue
- （历史）`import_tasks_and_enqueue()` 曾直接把 build 出来的任务塞进 manager。
- 当前该 compat command 已删除；导入主链已转为 parser/import command + 前端 store/addTasks/runtime 路径。

### Refactor target
- 保持文件解析在 import command / parser 层。
- 把“创建任务并入队”切到统一的 backend mutation facade。

---

## 3.4 `src-tauri/src/core/runtime.rs`

### Current role
- 当前是下载生命周期控制路由器。

### Boundary issue
- 只支持 `Start/Pause/Resume/Cancel/.../ApplyEvent`。
- 还没有承接 `AddTasks / RemoveTasks / UpdateOutputPaths / RetryFailed / UpdateConfig / SetRateLimit` 等 mutation。

### Refactor target
- 扩展为真正的 backend mutation runtime facade，或者在 runtime 前增加 application service，再由 service 投递 runtime command。

---

## 3.5 `src-tauri/src/core/manager.rs`

### Current role
- 状态机、任务仓储、调度、并发、事件、配置同步、批量操作、部分统计等几乎全部压在这里。

### Boundary issue
- 任何上层只要拿到写锁，就能越过应用层直接修改核心状态。

### Refactor target
- Phase 2 不追求一次性肢解。
- 第一波目标应是：
  - 固定外部 mutation 入口；
  - 开始拆出 event/scheduler/state-store seams；
  - 缩减 command 对 manager 具体方法的直接依赖面。

---

## 4. Recommended Target Boundary

## 4.1 Command layer

只负责：
- 参数校验
- request_id / tracing metadata
- 错误映射
- 调用 application service / runtime facade

不负责：
- 直接 `download_manager.write()`
- 组合多步 manager mutation

---

## 4.2 Application mutation facade

建议新增一层，例如：

- `src-tauri/src/application/download_mutation_service.rs`
- 或 `src-tauri/src/core/runtime_mutations.rs`

它负责：
- 把 command intent 转换为统一 mutation command
- 对批量动作做 use-case 级编排
- 隔离 `commands/*` 对 `DownloadManager` 细节的感知

---

## 4.3 Runtime / engine

### TaskEngine
继续负责：
- 用户控制意图（start/pause/resume/cancel）的 request 去重与 ack

### DownloadRuntime
扩大职责到：
- 串行执行关键 mutation
- 成为 manager 写路径的主通道
- 为后续测试提供稳定的“backend write-path contract”

---

## 4.4 DownloadManager

聚焦：
- 领域状态机
- 下载生命周期
- 并发/调度
- 领域事件生产

逐步弱化：
- 直接对外暴露的大量 mutation API
- 由 command 层直接驱动的跨领域编排

---

## 5. Phase 2 Execution Order

### 02-01
先建立 mutation facade / runtime 扩展，定义统一入口和命令模型。

### 02-02
把 `add / remove / clear / retry reset / update output / import enqueue / config sync / rate limit` 迁移进统一入口。

### 02-03
在统一入口稳定后，再拆 `DownloadManager` 第一波职责边界（优先 event + scheduler seams）。

### 02-04
补统一写路径测试，覆盖：
- command 不再直接持有 manager 写锁
- runtime / facade 是 mutation 主入口
- 关键 mutation 能维持事件与状态一致性

---

## 6. Final Conclusion

Phase 2 的关键不是“把 manager 改得更漂亮”，而是先让**写路径语义一致**。

只有当下列事情成立后，后续拆 `DownloadManager` 才不会变成一边拆一边继续从命令层绕过：

1. commands 不再直写 manager 进行核心 mutation；
2. runtime / facade 成为统一 mutation 入口；
3. bridge 的 side-effect 角色被显式识别而不是继续隐式膨胀。

换句话说：

> **先统一入口，再拆中心。**
