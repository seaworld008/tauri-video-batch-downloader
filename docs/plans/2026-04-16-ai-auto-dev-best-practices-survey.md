# 2026-04-16 AI 自动开发工作流最佳实践调研与 Hermes-graphify-GSD 融合建议

## 目标

基于当前主流 AI coding agent / autonomous software engineering 工作流的共识实践，收敛出一套适配本仓库的 **Hermes + graphify + GSD** 自动开发策略，避免继续局部自造轮子。

## 调研范围

本轮重点参考了三类实践：

1. **AI coding agents / background agents**
   - Claude Code
   - OpenAI Codex / Codex CLI
   - Cursor background agents
   - Aider
   - OpenHands / OpenDevin
   - SWE-agent

2. **多 agent 并发与集成治理**
   - Git worktree / branch isolation
   - GitHub Actions concurrency
   - GitHub merge queue
   - task queue / lease / heartbeat / fencing token 模式

3. **计划 / 记忆 / 图谱 / completion gate**
   - MemGPT / hierarchical memory
   - Reflexion / Self-Refine / CRITIC
   - GraphRAG / RepoCoder
   - Voyager / explicit skill library

> 注：本轮结论用于 workflow 设计借鉴，不作为逐字逐句“官方能力承诺”复述。真正落地时以本地可验证行为为准。
>
> 更新说明（后续实仓审计）：早期 survey 曾把 sandbox 视为候选 canonical writer，但后续对 `/data/ai-coding/auto-continue-sandbox` 的 fresh 审计确认其缺失完整项目代码环境与图谱/脚本产物，因此当前长期落地基线已改为“主仓库单写者执行面”，sandbox 不再作为默认最佳实践。

---

## 一、主流最佳实践的共识模式

### 1. 明确区分 3 类运行模式

行业里比较成熟的 agent 工作流，通常不会把所有请求都当成同一种自动化：

1. **Ask / Read-only mode**
   - 只分析、检索、规划，不落盘写代码
2. **Agent task mode**
   - 有边界的多步任务，在当前 repo/worktree 内推进
3. **Background mode**
   - 异步长任务，运行数分钟到数十分钟，有状态追踪和回传

### 2. 标准循环是 Plan -> Act -> Verify，而不是直接写代码

共识主线：

1. inspect repo / context
2. 形成轻量计划
3. 定位目标文件 / 代码路径
4. 小步编辑
5. 跑测试 / lint / type-check / targeted verification
6. 输出进度与 blocker
7. 继续下一轮，直到完成门满足

### 3. “可见进度”是第一等公民

成熟产品/系统基本都会暴露：

- 当前任务状态
- 当前步骤 / 子目标
- 触达了哪些文件
- 执行了哪些命令
- 最近一轮验证结果
- 当前 blocker / 是否等待人工
- 最终 diff / summary

### 4. 自动化不是全-or-无，而是分级审批

常见分层：

- 自动允许：读文件 / 检索 / 图谱刷新 / diff 生成
- 条件允许：写文件 / 跑命令 / 安装依赖 / 大规模改动
- 强制确认：破坏性操作 / push / deploy / secrets / 迁移生产资源

### 5. 后台任务默认应在隔离环境运行

主流实践越来越强调：

- 独立 worktree
- 独立 branch
- 独立 sandbox / container
- 与主工作树分离的异步运行目录

### 6. “完成”必须依赖验证门，而不是 agent 主观判断

共识 completion gate：

- patch 存在
- 相关验证命令通过
- 无关键报错
- 计划 / 文档 / 状态同步完成
- 输出明确的完成摘要与剩余风险

---

## 二、多 agent 的最佳实践：允许并行，但禁止共享写入

这部分和当前仓库最相关。

### 1. Many readers, single writer per mutable scope

最稳的模型不是“只允许一个 agent”，而是：

- **允许多个 agent 并发分析 / 规划 / 审查 / 检索**
- **同一可变范围（repo/worktree/path-scope）同一时刻只允许一个 writer**

### 2. 并发边界应该靠 worktree / branch / path scope，而不是靠运气

推荐边界：

- 每个写任务拥有独立 branch
- 每个写任务拥有独立 worktree
- 对高风险共享区（lockfile、schema、CI config、shared config）进一步加 path-scope 串行

### 3. 应通过 scheduler / queue / lease 控制写权限

正确模式不是：多个后台 agent 各自看到 repo 就开始写。

而是：

1. task 先进入 queue
2. scheduler 判断影响范围
3. 如果 scope 未被占用，则发放写 lease
4. agent 获得 lease 后才能进入 edit / mutate 阶段
5. lease 失效或冲突时，agent 自动降级为 read-only / wait / requeue

### 4. 集成应该串行化

即使多个 agent 在不同 worktree/branch 工作，最终也不应直接同时落入主线。

需要类似 merge queue 的阶段：

- rebase/update
- run required checks
- serialize final integration

---

## 三、计划 / 记忆 / 图谱最佳实践对我们的启发

### 1. 记忆最好分三层

1. **Working memory**
   - 当前子任务、当前假设、当前验证命令、当前 blocker
2. **Episodic memory**
   - 上一轮做了什么、失败过什么、为什么改方向
3. **Structural / semantic memory**
   - repo 图谱、模块关系、测试邻域、调用链、架构约束

### 2. 计划必须外显，不应只存在 agent 的临时上下文里

应有明确状态：

- goal
- current step
- selected files / symbols
- validation commands
- completion gates
- blocked_on
- checkpoint / rollback point

### 3. checkpoint 不只是快照，而是“决策边界”

一个好的 checkpoint 要说明：

- 这轮决定了什么
- 用什么证据支撑
- 改了哪些文件
- 下一轮应该沿什么方向继续
- 如果回滚该回到哪里

### 4. graph-first, text-second 是 repo 任务的更优策略

适合代码仓的检索顺序：

1. graphify 先缩小相关符号 / 模块 / tests / config 邻域
2. 再读目标文本
3. 最后再做自然语言摘要/压缩

### 5. completion sentinel 是正确方向，但还应和 plan-state 绑定

sentinel 不应只表示“结束”，还应该和以下条件绑定：

- GSD plan 中所有 required steps 已完成/明确 defer
- required validation commands 全部通过
- graph/docs/state 已同步
- 当前 HEAD / worktree 与 evidence 一致

---

## 四、对 Hermes + graphify + GSD 的融合建议

## 推荐目标架构

### 层 1：Hermes = Orchestrator / Scheduler / Executor

职责：

- 接收任务
- 判断任务类型（ask / task / background）
- 驱动 loop state machine
- 管理 subagents
- 执行验证门
- 产出摘要 / 回传

### 层 2：GSD = Canonical plan-state

职责：

- 当前目标
- 当前阶段 / 子任务
- completion gates
- blocked_on
- checkpoint log
- 最近决策与下一步

### 层 3：graphify = Canonical structural memory

职责：

- repo graph
- symbol/module/test/config 邻域
- 图谱刷新
- 为 Hermes 提供 graph-first retrieval

### 层 4：auto-continue runtime = Queue + lease + visible status

职责：

- cron/hook/checkpoint 触发
- 维护单项目 writer lease
- 后台摘要回传
- 可见 runner 状态
- 只允许安全的后台写入

---

## 五、建议直接吸收进当前仓库的 8 条策略

### 策略 A：单项目单 writer，允许多 reader / 多 planner

对本仓库的含义：

- 允许 Hermes 在后台使用多个 agent 做分析 / review / 计划
- 但只允许一个 agent 持有 writer lease，对代码真正落盘

### 策略 B：后台默认只在一个受控执行面写入

当前最合理做法：

- 主仓库 = 默认且唯一推荐的 writer 执行面
- sandbox/worktree 仅可用于临时实验；只有在被重建为完整项目环境后，才可重新评估是否进入 runtime

### 策略 C：所有自动续跑都必须显示 active writer / last writer

至少暴露：

- project key
- current writer state
- current writer repo/worktree
- source
- started_at / finished_at
- branch / head
- status_before / status_after

### 策略 D：冲突时不再“悄悄运行”，而是明确 downgrade

冲突时允许的行为：

- skip with explicit reason
- downgrade to read-only summary mode
- requeue / wait
- 回传“当前已有 writer 在跑”

不允许：

- 在未拿到 lease 的情况下继续写

### 策略 E：把 auto-progress 升级成统一观测入口

未来它不只是 tail log，而应包含：

- current auto-status
- current writer lease
- latest summary
- pending / recent jobs
- blocked reason
- last verification snapshot

### 策略 F：completion gate machine-readable

建议让 GSD / planning 文档显式声明：

- required checks
- docs sync required?
- graph sync required?
- what counts as done?
- what invalidates sentinel?

### 策略 G：summary 采用 decision memo，而不是流水账

每轮自动摘要优先写：

- 本轮做出的关键判断
- 对应证据
- 本轮改动范围
- 当前 blocker
- 下一轮唯一最优推进方向

### 策略 H：最终集成串行化

如果未来真要多 writer branch/worktree 并发探索：

- 不直接同时回写主线
- 必须经过 serial integration / merge queue / explicit rebase+verify

---

## 六、对当前仓库的推荐落地顺序

### Phase 1（立即）
- 保留单后台 writer（sandbox）
- 主仓库不再装 auto cron
- 加 project-level writer lease
- `auto-progress` 暴露 active writer / last writer
- busy 时显式 skip，而不是静默并发

### Phase 2（短期）
- 引入 queue / task table 概念
- 区分 read-only subagents 与 write-capable agent
- 对 writer lease 增加 heartbeat / stale detection
- 对高风险共享区加 path-scope serialization

### Phase 3（中期）
- 把 completion gates machine-readable 化
- 把 summary 升级为 decision memo
- 把 graphify 邻域检索正式接入 auto-continue 检索链
- 支持 merge-queue 风格的多 branch 集成策略

---

## 七、结论

最值得借鉴的不是某一个产品的 UI，而是下面这个**组合范式**：

- **显式任务触发**
- **轻量计划驱动**
- **graph-first context retrieval**
- **可见进度与摘要回传**
- **多 agent 可并行分析，但单项目单 writer**
- **严格 completion gate**
- **最终集成串行化**

这套组合与 Hermes + graphify + GSD 的天然契合度很高，应该优先走“融合成熟模式”，而不是继续局部发明新的后台自动开发机制。
