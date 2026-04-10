# Video Downloader Pro 架构重设计与落地实施方案（2026-04-10）

> 目标：从第一性原理重建下载系统架构，不假设现有结构必须保留。本文作为后续迭代的基线方案，优先保障**一致性、可维护性、可扩展性、可交付性**。

---

## 1. 第一性原理与设计目标

围绕“下载任务系统”最小不可变事实：

1. 下载任务是一个有状态生命周期的实体（Pending → Downloading → Paused/Failed/Completed/Cancelled）。
2. 状态迁移必须可追溯、可验证、可重放，且只允许单一入口修改。
3. 前后端通信是跨边界契约，不是“随意 JSON”。
4. 外部依赖（yt-dlp、ffmpeg、文件系统、网络）不可靠，系统必须内建降级与恢复机制。

据此定义长期目标：

- **单一状态迁移通道**（Single Writer Principle）。
- **端到端协议化**（Versioned Contracts）。
- **能力模块化**（Downloader Provider Plug-in）。
- **可观测与可恢复**（Event log + Snapshot + Idempotent commands）。
- **面向交付**（可分阶段迁移，不中断现有功能）。

---

## 2. 结论：当前结构是否值得保留

结论：**不应在现状上持续“打补丁”**。现有实现可复用部分能力模块，但控制层和边界定义需要重构。

可保留：

- `core/downloader.rs`、`core/resume_downloader.rs`、`core/m3u8_downloader.rs` 的下载执行能力（作为 Provider）。
- 现有任务模型字段中的大部分业务数据（可逐步收敛）。
- 前端已验证的“进度回退保护”思路。

需重建：

- command 层职责（目前过重）。
- runtime/manager 的边界（目前仍有多入口状态修改）。
- 事件协议（缺少 version/envelope）。
- YouTube 与系统能力双轨路径（需统一服务层）。

---

## 3. 推荐目标架构（生产级）

采用分层与端口适配（Ports & Adapters）：

### 3.1 后端分层

1. **Interface Layer（Tauri Commands）**
   - 只做：参数校验、鉴权/能力检查、错误码映射、trace 注入。
   - 不做：状态机逻辑、下载编排。

2. **Application Layer（Use Cases）**
   - `TaskCommandService`：start/pause/resume/cancel/batch。
   - `TaskQueryService`：list/stats/detail。
   - `ImportService`：导入、去重、规范化。
   - `SystemService`：工具检测、监控控制、目录操作。

3. **Domain Layer（核心业务）**
   - `TaskAggregate`：状态机 + 不变量校验。
   - `TaskPolicy`：并发策略、重试策略、限速策略。
   - `DomainEvents`：TaskStarted/Progressed/Failed...

4. **Infrastructure Layer（适配器）**
   - `TaskRepository`（JSON/SQLite，可切换）。
   - `DownloaderProvider`（HTTP/M3U8/YouTube）。
   - `EventBus`（in-process + tauri emitter）。
   - `MonitorAgent`（CPU/Memory/Network 采样任务）。

### 3.2 单写入模型（关键）

- 引入 `TaskEngine`（Actor 模式）作为唯一写入口：
  - 所有命令都变成 `EngineCommand` 入队。
  - 只有 engine 能修改任务状态存储。
  - Provider 回调也只提交 `EngineEvent`，由 engine 统一应用。

这会替代“command 直连 manager + runtime 混合”模式。

---

## 4. 模块拆分建议（可直接落地）

建议目录（Rust）：

```text
src-tauri/src/
  application/
    task_command_service.rs
    task_query_service.rs
    import_service.rs
    system_service.rs
  domain/
    task_aggregate.rs
    task_state_machine.rs
    task_policy.rs
    events.rs
    errors.rs
  engine/
    task_engine.rs
    commands.rs
    event_applier.rs
  infra/
    repository/
      mod.rs
      json_repo.rs
    providers/
      mod.rs
      http_provider.rs
      m3u8_provider.rs
      youtube_provider.rs
    monitor/
      monitor_agent.rs
    bus/
      event_bus.rs
  interfaces/
    tauri_commands/
      download.rs
      import.rs
      system.rs
      config.rs
```

前端建议拆分（TypeScript）：

```text
src/
  features/downloads/
    api/downloadApi.ts
    state/downloadStore.ts
    state/taskMergePolicy.ts
    state/eventReducers.ts
    listeners/downloadEventSubscriber.ts
    model/contracts.ts
```

---

## 5. 核心接口/契约（强约束）

## 5.1 Engine Command（后端内部）

```rust
enum EngineCommand {
  StartTask { task_id: String, request_id: String },
  PauseTask { task_id: String, request_id: String },
  ResumeTask { task_id: String, request_id: String },
  CancelTask { task_id: String, request_id: String },
  StartAllPending { request_id: String },
  RetryFailed { request_id: String },
  RemoveTasks { task_ids: Vec<String>, request_id: String },
}
```

要求：

- 每个 command 带 `request_id`（幂等、追踪、审计）。
- command 执行结果结构化（成功数、失败列表、错误码）。

## 5.2 事件 envelope（前后端契约）

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "event_type": "task.progressed",
  "ts": "2026-04-10T12:00:00Z",
  "payload": { "...": "..." }
}
```

约束：

- `schema_version` 必填。
- `event_type` 采用命名空间：`task.*` / `system.*`。
- 前端按版本路由解析；不支持版本进入兼容分支并上报。

## 5.3 Provider Port

```rust
#[async_trait]
trait DownloaderProvider {
  async fn start(&self, task: DownloadTaskSpec, sink: ProgressSink) -> Result<ProviderHandle, ProviderError>;
  async fn pause(&self, provider_task_id: &str) -> Result<(), ProviderError>;
  async fn resume(&self, provider_task_id: &str) -> Result<(), ProviderError>;
  async fn cancel(&self, provider_task_id: &str) -> Result<(), ProviderError>;
}
```

说明：

- YouTube/HTTP/M3U8 统一此契约，command 层不再直接操作二进制工具。
- `ProgressSink` 仅上报事实，不允许直接改任务状态。

---

## 6. 数据流（端到端）

### 6.1 `start_download` 流程

1. 前端 `downloadApi.startTask(taskId)` 调 command。
2. command 转发到 `TaskCommandService.start_task()`。
3. service 发送 `EngineCommand::StartTask` 至 `TaskEngine`。
4. engine 校验状态机不变量，写入状态（Pending→Downloading），持久化 snapshot。
5. engine 调 provider 启动下载，并订阅 progress 回调。
6. provider 回调 → `EngineEvent::Progress` → engine 应用状态 → 发送 versioned UI event。

### 6.2 批量操作（start all pending/retry failed）

- 统一为 engine 内部批处理事务：
  - 收集候选任务；
  - 按并发策略分批推进；
  - 输出结构化结果（started/queued/failed_reasons）。

---

## 7. 关键边界与责任划分

- **Command**：输入输出边界。
- **Service**：用例编排，不直接持久化状态机细节。
- **Engine**：唯一状态写入口。
- **Domain**：状态机规则与策略。
- **Provider**：下载执行。
- **Repository**：持久化与恢复。

这能避免“command 文件臃肿 + store 全能化”的长期技术债。

---

## 8. 重点边界场景（必须覆盖）

1. 网络抖动/超时/连接中断：指数退避 + 最大重试次数 + 明确失败原因。
2. HTTP 429/403：区分“可重试/不可重试”错误码。
3. 下载目录无权限/磁盘满：立即失败并阻止自动重试风暴。
4. `.part` 文件损坏：支持 checksum 失败后的重建策略。
5. 进度倒退与乱序事件：基于 `event_id` + 单调字段保护。
6. 批量命令并发冲突：同一 task 的命令串行化与幂等去重。
7. 应用重启恢复：snapshot + 未完成任务恢复策略（自动/手动）。
8. 外部工具缺失（yt-dlp/ffmpeg）：能力探测 + UI 明确提示 + 降级路径。
9. Windows/macOS 差异：路径、命令、sidecar 可执行文件策略统一适配。
10. 监控服务重复启动/重复停止：幂等结果码。

---

## 9. 迁移与发布策略（避免大爆炸）

采用 **Strangler Fig** 渐进替换：

### Phase 0（准备）

- 增加事件 envelope v1 与前端兼容解析（保持旧事件兼容 1~2 个版本）。
- 引入 `TaskEngine` 空壳与 command 转发层（不接管核心逻辑）。

### Phase 1（单任务命令迁移）

- 迁移 `start/pause/resume/cancel` 到 engine 单写通道。
- 移除 command 直接 manager 写锁路径。

### Phase 2（批量命令迁移）

- 迁移 `start_all_pending/retry_failed/cancel_all/remove_tasks`。
- 增加批量操作一致性测试。

### Phase 3（Provider 统一）

- 将 YouTube 逻辑从 command 下沉到 provider。
- `get_video_info/get_youtube_info` 收敛成统一服务。

### Phase 4（System Monitor 实装）

- 增加 monitor agent 生命周期控制（start/stop/status）。
- 接入可观测事件与健康检查。

### Phase 5（清理）

- 删除旧 runtime/manager 旁路代码。
- 删除重复命令、重复事件、过期 fallback。

---

## 10. 推荐实施顺序（团队可执行）

按 6 个 PR 执行，每个 PR 可独立回滚：

1. **PR-1：契约层**
   - 新增 event envelope v1、错误码规范、前端兼容解析器。
2. **PR-2：Engine 骨架**
   - 引入 `TaskEngine` + `EngineCommand` + 基础测试。
3. **PR-3：单任务迁移**
   - start/pause/resume/cancel 全量切 engine。
4. **PR-4：批量与重试迁移**
   - start_all_pending/retry_failed/cancel_all/remove_tasks。
5. **PR-5：YouTube 与 System 统一**
   - provider 化 + monitor 生命周期落地。
6. **PR-6：技术债清理**
   - 删除旧路径、补文档、补监控指标与回归测试。

---

## 11. 测试策略（交付门槛）

1. **Domain 单元测试**
   - 状态机合法/非法迁移全覆盖。
2. **Engine 并发测试**
   - 并发命令乱序输入，验证最终一致性。
3. **Provider 适配测试**
   - 模拟网络错误、权限错误、二进制缺失。
4. **契约测试**
   - 后端事件 snapshot + 前端解析兼容测试。
5. **恢复测试**
   - 中断重启后任务恢复行为。
6. **跨平台验证**
   - Windows/macOS 两套 smoke case（路径、命令、sidecar）。

---

## 12. 决策记录（ADR）

- ADR-001：采用 engine 单写模型。
- ADR-002：采用 versioned event envelope。
- ADR-003：下载能力 provider 化（HTTP/M3U8/YouTube 一致契约）。
- ADR-004：command 保持薄层，业务编排进入 application service。

---

## 13. 交付定义（Definition of Done）

满足以下条件才视为重构完成：

1. 所有任务状态迁移仅通过 `TaskEngine`。
2. 所有前后端下载事件均为 `schema_version` 协议。
3. system monitor 不再是占位命令。
4. YouTube 能力仅保留一条实现路径。
5. 关键链路具备自动化测试与回归基线。

---

## 14. 本文档使用规则

1. 后续架构相关开发必须先对照本文档评审（PR 模板强制勾选）。
2. 偏离本文设计需新增 ADR 并说明取舍。
3. 每两周更新一次实施进展与风险。

> 本文档即后续下载系统重构与优化的基线计划。
