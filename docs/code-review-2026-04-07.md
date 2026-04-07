# Video Downloader Pro 全局 Code Review（2026-04-07）

> 审查目标：从全局架构、关键链路、并发安全、状态一致性、可维护性、可扩展性角度进行全面评估，并给出可执行的重构优先级。

## 一、总体结论

项目核心方向正确，特别是：

- 已有 `runtime router` 思路来减少下载控制命令对 `DownloadManager` 的直接锁竞争。
- 前端 store 已有较强的数据验证与“进度回退保护”机制。
- 下载能力（HTTP / Resume / M3U8 / YouTube）模块边界基本清晰。

但当前距离“稳定可持续扩展”的目标还有明显差距，主要集中在：

1. **并发控制路径仍不完全统一**（部分命令仍直接走 manager 写锁逻辑）；
2. **命令层职责偏重**（业务控制与编排散落在 command）；
3. **系统能力与 YouTube 能力存在双轨实现倾向**（命令层 fallback 与 core 实现并存）；
4. **测试覆盖与环境依赖耦合较高**（CI/本地一致性风险）。

---

## 二、关键问题清单（按优先级）

## P0（必须优先）

### 1) 下载控制路径不统一，存在锁竞争与状态偏移风险

- 现状：`start/pause/resume/cancel` 已走 runtime；但 `start_all_pending_downloads`、`retry_failed_tasks` 等命令仍有直接 manager 访问路径。
- 风险：未来继续扩展批量操作时，容易出现“同一状态机多入口修改”。
- 建议：
  - 统一约束：所有“会触发状态迁移的操作”只走 runtime 命令。
  - command 层仅做参数校验和错误翻译。

### 2) 后端事件桥与前端合并策略仍需协议化

- 现状：前端虽有 progress regression guard，但事件载荷无版本号，字段演进风险高。
- 风险：后续新增状态字段时，旧前端可能误判覆盖。
- 建议：
  - 为 `task_status_changed` / `download_progress` 增加 `schema_version`。
  - 在前端按版本分支兼容处理。

## P1（高收益）

### 3) `system.rs` 部分命令仍为占位

- `start_system_monitor` / `stop_system_monitor` 目前返回成功但缺少实际控制逻辑。
- 建议：最少实现“后台任务句柄 + 状态位 + 幂等调用语义”。

### 4) YouTube 能力存在“命令层简化实现”与“core/youtube_downloader”双路径

- 风险：能力升级时逻辑分叉、行为不一致。
- 建议：统一由 core 层提供能力，命令层只做代理。

## P2（结构优化）

### 5) command 文件体积偏大，建议拆分服务化

- 例如 `commands/download.rs` 承载任务控制、批量操作、重试、统计、速率限制等。
- 建议拆分：
  - `download_control_service`
  - `download_query_service`
  - command 保持薄层。

### 6) 前端 `downloadStore.ts` 复杂度过高

- 目前聚合了数据校验、invoke 调度、UI 提示、状态管理、同步策略。
- 建议：
  - 抽出 `downloadApi.ts`（纯桥接）
  - 抽出 `taskMergePolicy.ts`（合并策略）
  - store 专注状态与 action 编排。

---

## 三、本次已执行优化

## 1) `retry_failed_tasks` 改为“短锁 + runtime 启动”策略

已完成调整：

- 先读锁收集 failed 任务 id；
- 用短写锁执行 `retry_failed()` 状态重置；
- 实际启动任务改用 `state.download_runtime.start_task(...)`。

收益：

- 避免在 command 层长时间持有 manager 写锁并执行下载启动链路；
- 与 runtime router 的总体并发策略保持一致。

---

## 四、建议的三阶段重构路线

## 阶段 A（稳定性）

1. 统一所有状态迁移命令到 runtime。
2. 事件协议加版本字段，补兼容测试。
3. 为批量操作补并发回归测试（pause-all / resume-all / retry-failed）。

## 阶段 B（可维护性）

1. command 层服务化拆分。
2. store 拆分 API / merge policy / notifications。
3. YouTube 路径统一到 core。

## 阶段 C（可观测性与运维）

1. 完成 system monitor 控制命令。
2. 统一日志上下文（task_id、command_id、event_seq）。
3. 增加“状态机快照导出”用于问题复盘。

---

## 五、验证建议

建议在可用环境执行：

1. `pnpm exec vitest run`
2. `pnpm exec vitest run --config vitest.config.integration.ts`
3. `cargo test --manifest-path src-tauri/Cargo.toml`

若在 Linux 容器中遇到 `glib-2.0` 缺失导致 Rust 测试失败，应在 CI 镜像补齐系统依赖后再做全量验证。

