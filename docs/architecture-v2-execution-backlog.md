# Architecture V2 执行任务拆解（可直接开工版）

> 基于 `architecture-v2-delivery-plan-2026-04-10.md` 的工程执行清单。  
> 目标：把“架构方案”转成团队可分配、可追踪、可验收的任务系统。  
> 维护规则：每个任务状态仅能在 PR 合并后更新，避免“口头完成”。

---

## 0. 执行原则（强约束）

1. 每个任务必须有：
   - 可交付物（代码/文档/测试）；
   - 验收标准（可执行命令）；
   - 回滚策略。
2. 每个 PR 只做一类能力，避免混合改动。
3. 任何偏离基线架构的改动必须补 ADR。
4. 先契约后实现：先定接口与 schema，再迁移逻辑。

---

## 1. 里程碑总览（建议 6~8 周）

- **M1（第 1 周）**：契约层完成（事件 envelope + 错误码 + 兼容层）。
- **M2（第 2~3 周）**：TaskEngine 骨架与单任务命令迁移。
- **M3（第 4~5 周）**：批量命令迁移 + 一致性测试补齐。
- **M4（第 6 周）**：Provider 统一（YouTube/HTTP/M3U8 路径收敛）。
- **M5（第 7 周）**：System Monitor 真正落地（start/stop/status）。
- **M6（第 8 周）**：旧路径清理 + 全链路回归 + 发布评审。

---

## 2. 工作分解结构（WBS）

## Epic A — 契约与兼容层

### A1. 定义事件 envelope v1

- 交付物：
  - 新增后端统一事件结构体（含 `schema_version/event_id/event_type/ts/payload`）。
  - 事件发射器统一走 `EventBus` 封装。
- 影响模块：
  - `src-tauri/src/infra/bus/`（新增）
  - `src-tauri/src/main.rs`（桥接替换）
- 验收标准：
  - 前端可同时解析旧事件与新 envelope 事件；
  - 随机 1000 条进度事件无解析错误。
- 回滚：
  - 保留旧事件 emit 开关，支持 feature flag 回退。

### A2. 统一错误码模型

- 交付物：
  - `ErrorCode` 枚举（可重试/不可重试/用户操作错误/环境错误）。
  - command 层统一错误映射。
- 验收标准：
  - 所有 command 返回结构化错误（非裸字符串）；
  - 前端 toast 可按错误码做策略展示。

### A3. 前端契约解析器

- 交付物：
  - `contracts.ts` + `eventParsers.ts`；
  - 未知版本兼容分支与 telemetry 上报。
- 验收标准：
  - schema_version=1 全通过；
  - schema_version=99 可降级且不崩溃。

---

## Epic B — TaskEngine 单写模型

### B1. Engine 基础骨架

- 交付物：
  - `engine/commands.rs`
  - `engine/task_engine.rs`
  - `engine/event_applier.rs`
- 验收标准：
  - command 入队、串行执行、结果可 await；
  - 并发 1000 次 start/pause/cancel 无 panic。

### B2. 迁移单任务命令

- 交付物：
  - `start/pause/resume/cancel` 全量改为 engine 路径。
- 验收标准：
  - 删除 command 直连 manager 的状态写路径；
  - 原有集成测试通过。

### B3. 幂等与 request_id

- 交付物：
  - command 增加 `request_id`；
  - engine 去重缓存（短 TTL）。
- 验收标准：
  - 重复请求不会造成重复状态迁移。

---

## Epic C — 批量操作与状态一致性

### C1. 批量命令统一迁移

- 范围：
  - `start_all_pending`
  - `retry_failed`
  - `cancel_all`
  - `remove_tasks`
- 验收标准：
  - 批量命令只通过 engine；
  - 输出结构化统计（成功、排队、失败原因列表）。

### C2. 状态机不变量测试

- 交付物：
  - 非法迁移测试（Completed→Downloading、Cancelled→Resume 等）。
- 验收标准：
  - 状态机测试覆盖关键迁移分支 ≥ 90%（domain 层）。

### C3. 恢复一致性

- 交付物：
  - snapshot 恢复策略；
  - 崩溃重启后任务恢复规则。
- 验收标准：
  - 人工注入崩溃后可恢复，且状态不倒退。

---

## Epic D — Provider 统一（下载能力收敛）

### D1. `DownloaderProvider` 抽象层

- 交付物：
  - `infra/providers/mod.rs`；
  - `http_provider.rs` / `m3u8_provider.rs` / `youtube_provider.rs`。
- 验收标准：
  - engine 只依赖 trait，不依赖具体下载器实现。

### D2. YouTube 路径收敛

- 交付物：
  - 命令层不再直接跑 yt-dlp 细节；
  - `get_video_info` / `get_youtube_info` 合并为统一服务入口。
- 验收标准：
  - 同一 URL 在统一路径下行为一致；
  - 错误语义一致。

### D3. 外部依赖健康探测

- 交付物：
  - ffmpeg/yt-dlp 检测进入 capability service。
- 验收标准：
  - 缺依赖时 UI 得到结构化提示并可引导安装。

---

## Epic E — System Monitor 真实落地

### E1. MonitorAgent 生命周期管理

- 交付物：
  - `start/stop/status` 三命令真实实现；
  - 后台任务句柄与状态位。
- 验收标准：
  - start/stop 幂等；
  - status 可反映真实运行状态。

### E2. 监控事件协议化

- 交付物：
  - `system.metrics.updated` 事件（走 envelope）。
- 验收标准：
  - 前端可稳定展示 CPU/内存/网络指标。

---

## Epic F — 前端架构收敛

### F1. Store 解耦

- 交付物：
  - `downloadApi.ts`（仅桥接）
  - `taskMergePolicy.ts`（纯函数）
  - `downloadEventSubscriber.ts`（监听生命周期）
- 验收标准：
  - `downloadStore.ts` 行数显著下降；
  - 业务逻辑单元测试可独立运行。

### F2. 事件 reducer 化

- 交付物：
  - 事件驱动 reducer（替代分散 setState map）。
- 验收标准：
  - 乱序/重复事件不会破坏 UI 状态。

---

## 3. PR 切分模板（每个 PR 必填）

1. 本 PR 对应任务编号（如 A1、B2）。
2. 涉及模块与风险点。
3. 向后兼容策略。
4. 回滚步骤。
5. 验收命令与结果截图/日志。

---

## 4. 测试与验收矩阵

## 4.1 后端

- 单元测试：状态机、策略、错误码映射。
- 集成测试：engine 命令流、provider 交互、重启恢复。
- 并发测试：批量命令竞争、重复 request_id。

## 4.2 前端

- 契约测试：envelope 解析、版本降级。
- 状态测试：progress 回退保护、乱序事件保护。
- E2E（Tauri）：核心流程 smoke（导入→下载→暂停→恢复→完成）。

---

## 5. 风险清单与缓解

1. **迁移期间双路径并存**  
   - 缓解：feature flag + 统一日志埋点 + 每阶段删旧路径。
2. **事件协议升级导致兼容问题**  
   - 缓解：保留兼容解析 2 个版本周期。
3. **Provider 统一后性能回退**  
   - 缓解：在 D1 阶段引入基准测试并锁性能阈值。
4. **跨平台行为差异扩大**  
   - 缓解：Windows/macOS 双 smoke gate 作为发布前置。

---

## 6. 推荐实施顺序（可执行）

1. A1 → A2 → A3
2. B1 → B2 → B3
3. C1 → C2 → C3
4. D1 → D2 → D3
5. E1 → E2
6. F1 → F2
7. 清理旧路径 + 最终回归发布

---

## 7. 执行进度看板（由团队持续维护）

| 任务 | 状态 | 负责人 | PR | 计划完成 |
|---|---|---|---|---|
| A1 事件 envelope v1 | DONE | Codex | 当前 PR | Week 1 |
| A2 错误码统一 | DONE | Codex | 当前 PR | Week 1 |
| A3 前端契约解析器 | DONE | Codex | 当前 PR | Week 1 |
| B1 Engine 骨架 | DONE | Codex | 当前 PR | Week 2 |
| B2 单任务命令迁移 | DONE | Codex | 当前 PR | Week 3 |
| B3 request_id 幂等 | DONE | Codex | 当前 PR | Week 3 |
| C1 批量命令迁移 | DONE | Codex | 当前 PR | Week 4 |
| C2 状态机覆盖补齐 | DONE | Codex | 当前 PR | Week 4 |
| C3 重启恢复一致性 | DONE | Codex | 当前 PR | Week 5 |
| D1 Provider 抽象 | DONE | Codex | 当前 PR | Week 5 |
| D2 YouTube 路径收敛 | DONE | Codex | 当前 PR | Week 6 |
| D3 能力探测收敛 | DONE | Codex | 当前 PR | Week 6 |
| E1 Monitor 生命周期 | DONE | Codex | 当前 PR | Week 7 |
| E2 监控事件协议化 | DONE | Codex | 当前 PR | Week 7 |
| F1 Store 解耦 | TODO | 待分配 | - | Week 8 |
| F2 事件 reducer 化 | TODO | 待分配 | - | Week 8 |

---

## 8. 交付口径

当且仅当以下条件都满足，才算“任务全部完成”：

1. 基线文档中的 DoD 全满足；
2. 看板任务全部为 DONE；
3. 回归测试（前后端 + Tauri E2E）全部通过；
4. 旧路径代码删除并通过发布评审。

> 本文是执行层“真任务单”，用于日常开发推进与周会追踪。
