# Hermes-graphify-GSD Autonomous Workflow Implementation Plan

> **For Hermes:** Use this as the canonical implementation plan for evolving the repo-local autonomous development loop from a single-repo auto-continue script into a visible, multi-agent-capable, single-writer workflow.

**Goal:** 把当前仓库的自动续跑机制升级为一套“多 agent 可并行分析 / 审查 / 规划，但单项目同一时刻只允许一个 writer 修改代码，并且进度、锁持有者、阻塞原因都清晰可见”的 Hermes + graphify + GSD 工作流。

**Architecture:** 保留 Hermes 作为编排器、graphify 作为结构化上下文与 repo graph 记忆、GSD 作为显式 plan-state。后台自动循环由 repo-local scripts 驱动，但从“每个 worktree 自己 cron + 自己锁”升级为“单项目 writer lease + visible runner state + 主仓库单写者执行面 + machine-readable completion gates”。

**Tech Stack:** Hermes CLI / cron, bash scripts, git worktree policy, graphify, GSD planning docs, JSON lease metadata, repo-local `.planning/` state.

---

## Scope and Constraints

### In scope
- 单项目单 writer lease
- 多 agent 并行分析/审查/规划的调度策略
- 主仓库单写者执行面约定（不默认依赖 sandbox）
- visible progress / runner owner / blocked reason
- completion gates 与 plan-state 绑定
- graph-first retrieval 接入 auto-continue loop

### Out of scope (for now)
- 完整数据库/服务化队列系统
- 跨机器分布式锁
- 自动 PR 创建/合并流水线
- 生产级 merge queue 服务

### Non-goals
- 不替换 Hermes / graphify / GSD
- 不引入重型平台依赖，只做 repo-local、upgrade-safe 增强

---

## Target Operating Model

### Modes
1. **Ask mode**
   - 只读分析，不拿 writer lease
2. **Task mode**
   - 当前交互上下文里的有限任务，可人工触发
3. **Background mode**
   - cron / checkpoint / hook 驱动的自动续跑
   - 需要显式 writer lease 才能进入 mutate path

### Agent roles
1. **Planner / Reviewer agents**
   - 可并行运行
   - 只读
   - 负责检索、审查、提出 patch 建议、更新计划建议
2. **Writer agent**
   - 同项目唯一
   - 只能在持有 writer lease 时修改文件
   - 负责实际 edit / validate / docs sync / graph sync

### Mutable scope rule
- many readers / planners allowed
- single writer per project key
- 如果未来进一步细化，可在 project-level writer 之上叠加 path-scope serialization

---

## Phase A — Consolidate the current single-writer baseline

### Objective
把当前 workflow 收敛为“主仓库单写者”的明确执行面，并把 writer owner 状态做成可见事实源。

### Files
- Modify: `scripts/hermes-auto-continue-config.sh`
- Modify: `scripts/hermes-auto-continue-trigger.sh`
- Modify: `scripts/ai-workflow.sh`
- Modify: `docs/auto-continue-workflow.md`
- Modify: `.planning/STATE.md`
- Modify: `docs/current-state.md`

### Tasks

#### Task A1: Main-repo single-writer policy
**Objective:** 把主仓库固定为默认且唯一推荐的 writer 执行面，不再把 sandbox 作为长期默认策略。

**Steps:**
1. 在 docs 中明确：
   - `/data/ai-coding/tauri-video-batch-downloader` = 默认 writer 执行面
   - sandbox 仅可用于临时实验，且必须先重建为完整 worktree 才能考虑进入 runtime
2. 记录默认只允许主仓库安装 auto cron。
3. 禁止主仓与任何额外 sandbox/worktree 同时安装 auto cron。

**Verification:**
- `crontab -l` 若启用调度，应只出现主仓库的 auto-continue 条目

#### Task A2: Project-level writer lease metadata
**Objective:** 用 project key + global state dir 代替单仓私有锁语义。

**Steps:**
1. 在 config 中定义：
   - `HERMES_AUTO_CONTINUE_PROJECT_KEY`
   - `HERMES_AUTO_CONTINUE_STATE_DIR`
   - `HERMES_AUTO_CONTINUE_GLOBAL_LOCK_FILE`
   - `HERMES_AUTO_CONTINUE_GLOBAL_LEASE_FILE`
2. trigger 启动时先拿 repo-local lock，再拿 project-level writer lock。
3. 获得 writer lock 后写 lease metadata：
   - repo_root
   - pid
   - source
   - branch
   - head
   - phase
   - started_at / finished_at
   - status_before / status_after
   - notify_deliver

**Verification:**
- `./scripts/ai-workflow.sh auto-runner-show` 能显示 lease 文件中的状态

#### Task A3: Visible skip instead of silent skip
**Objective:** 冲突时不再悄悄退出，而要明确记录“当前已有 writer 在跑”。

**Steps:**
1. trigger 拿不到 project-level writer lock 时：
   - 输出 `global writer busy`
   - 输出 active writer 摘要
2. 后续升级中，再把该事件写入 summary / optional relay

**Verification:**
- 同 project key 下双触发时，后到者日志明确显示 active writer 信息

---

## Phase B — Introduce a lightweight autonomous workflow state machine

### Objective
把当前 auto-continue 从“单个 prompt + 一次 chat”升级为更稳定的有限状态机。

### Target states
- `triage`
- `retrieve-context`
- `plan`
- `edit`
- `validate`
- `summarize`
- `gate-complete`
- `blocked`

### Files
- Modify: `scripts/hermes-auto-continue-trigger.sh`
- Modify: `scripts/hermes-auto-continue-summary.sh`
- Modify: `.planning/STATE.md`
- Modify: `.planning/ROADMAP.md`
- Create: `.planning/autonomous-workflow-state.json` (optional machine-readable mirror)

### Tasks

#### Task B1: Encode loop state in summary/lease
**Objective:** summary 和 lease 都要知道当前 loop state，而不是只有 source/status。

#### Task B2: Teach auto-summary to be a decision memo
**Objective:** 摘要从 log tail 升级为：
- decision made
- evidence
- changed scope
- blocker
- next best action

#### Task B3: Add blocked/handoff semantics
**Objective:** 如果拿不到 writer lease / 缺验证条件 / 需要人工时，明确进入 blocked/handoff，而不是继续“看起来像在跑”。

**Verification:**
- 手动构造 blocked 情况时，summary 与 progress 输出都清晰说明 blocker

---

## Phase C — Make progress and ownership first-class

### Objective
让用户随时看见：谁在跑、跑到哪、为什么没继续、下一步是什么。

### Files
- Modify: `scripts/ai-workflow.sh`
- Modify: `docs/auto-continue-workflow.md`
- Optional create: `.planning/auto-continue-status.json`

### Tasks

#### Task C1: Upgrade `auto-progress`
**Objective:** `auto-progress` 统一显示：
- auto-status
- project key
- writer state
- lease owner
- latest summary
- recent log tail
- notify target

#### Task C2: Add runner management commands
**Objective:** 文档化并稳定暴露：
- `auto-runner-show`
- `auto-runner-bind <project_key> [state_dir]`

#### Task C3: Expose reasoned skips
**Objective:** 被 writer busy / blocked 时，进度页能看到原因，而不是只有日志里一行。

**Verification:**
- `./scripts/ai-workflow.sh auto-progress` 在 running / inactive / blocked 三种状态都可读

---

## Phase D — Separate readers/planners from writer agent

### Objective
允许多 agent 并行工作，但把写权限控制在唯一 writer agent 手中。

### Files
- Modify: `scripts/hermes-auto-continue-trigger.sh`
- Optional create: `scripts/hermes-auto-continue-dispatch.sh`
- Optional create: `docs/plans/2026-04-16-autonomous-agent-role-split.md`

### Tasks

#### Task D1: Define two agent classes
**Objective:**
- planner/reviewer agents = read-only
- writer agent = write-capable only with lease

#### Task D2: Read-only delegation policy
**Objective:** 当 background loop 想并行化时，只允许 delegate_task 执行：
- graph retrieval
- code audit
- test failure analysis
- plan critique
而不允许子 agent 直接对主 worktree 落盘。

#### Task D3: Writer-only mutation policy
**Objective:** 任何 patch / file write / docs sync / graph sync / mark-complete 都只能由 writer agent 执行。

**Verification:**
- policy 文档清楚描述角色边界
- trigger/prompt 中显式声明 writer-only mutation rule

---

## Phase E — Integrate graph-first retrieval into the autonomous loop

### Objective
把 graphify 从“事后刷新工具”提升为 auto-continue 的正式前置检索层。

### Files
- Modify: `scripts/hermes-auto-continue-trigger.sh`
- Modify: `scripts/graphify-sync.sh` (if needed)
- Modify: `docs/auto-continue-workflow.md`
- Modify: `.planning/STATE.md`

### Tasks

#### Task E1: Retrieval order contract
**Objective:** 在 prompt/loop 中固定顺序：
1. graph report / graph artifacts
2. plan-state docs
3. target files / tests
4. summary/compression only after graph narrowing

#### Task E2: Graph refresh policy
**Objective:** 规定何时跑 `graphify-sync.sh smart`：
- run end of successful mutate loop
- optionally before a large plan revision

#### Task E3: Graph-linked hotspot notes
**Objective:** 对 recurring hotspots（如 `downloadStore`, `ImportView`, `systemCommands`, `manager.rs`）建立 graph-aware recall policy。

**Verification:**
- auto-continue docs 明确 graph-first retrieval contract

---

## Phase F — Machine-readable completion gates

### Objective
让“完成”变成计划和验证共同定义的条件，而不是 agent 自我感觉。

### Files
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Modify: `scripts/hermes-auto-continue-mark-complete.sh`
- Modify: `docs/auto-continue-workflow.md`
- Optional create: `.planning/completion-gates.json`

### Tasks

#### Task F1: Define required checks explicitly
**Objective:** completion gates 至少列出：
- required validation commands
- docs sync required
- graph sync required
- clean worktree required
- sentinel/head consistency required

#### Task F2: Link gates to current phase/plan
**Objective:** gate 不只是“全仓通过”，还要与当前 scope/plan 的 completion condition 对齐。

#### Task F3: Record waivers explicitly
**Objective:** 如果某些历史测试面暂时无法纳入 gate，必须写 waiver，而不是沉默忽略。

**Verification:**
- `mark-complete` 仍是唯一写 sentinel 的入口
- docs 中能清楚看到 gate contract

---

## Phase G — Optional future queue/merge discipline

### Objective
为未来真正的多 writer branch/worktree experimentation 预留设计，但当前不立即实现。

### Later additions
- task queue file / JSONL queue
- path-scope serialization
- explicit work item ownership
- merge queue style integration
- rebase + verify before mainline integration

---

## Immediate next actions (recommended order)

1. **收口当前基线文档**
   - 把 `auto-runner-bind/show`、project-level writer lease、canonical sandbox writer 写进 `docs/auto-continue-workflow.md`
2. **完成 Phase A/B/C 的剩余实现与验证**
   - 优先让 progress / owner / blocked reason 可见
3. **把 writer-only mutation policy 写进 auto-continue prompt**
4. **把 completion gates machine-readable 化**
5. **再考虑多 agent read-only delegation 的自动化**

---

## Verification checklist for this implementation plan

### Must verify after each workflow change
- `bash -n scripts/hermes-auto-continue-config.sh`
- `bash -n scripts/hermes-auto-continue-trigger.sh`
- `bash -n scripts/ai-workflow.sh`
- `./scripts/ai-workflow.sh auto-runner-show`
- `./scripts/ai-workflow.sh auto-progress`
- `crontab -l`

### Must verify before claiming concurrency fix complete
- main repo cron removed
- sandbox cron retained as canonical writer
- both worktrees share same `project key`
- competing trigger shows explicit `global writer busy`
- progress output reveals writer owner / lease status
- notify config still works after runner binding

---

## Done definition for this plan

This plan is complete only when all of the following are true:

1. main-repo single-writer execution surface is documented and enforced
2. project-level writer lease is visible through `auto-progress` / `auto-runner-show`
3. conflict skips are explicit and user-visible
4. writer-only mutation rule is documented
5. graph-first retrieval and completion gate contracts are documented
6. real verification commands have been run and recorded

---

## Recommended follow-up document

After Phase A/B/C implementation lands, create a shorter operator-facing runbook:
- `docs/auto-continue-operator-runbook.md`

It should answer:
- Who is currently writing?
- Why is my background loop blocked?
- Which execution surface currently owns writer authority?
- How do I rebind project key?
- How do I move notify target?
- When is it safe to resume or uninstall cron?
