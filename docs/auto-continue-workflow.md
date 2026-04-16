# Hermes Auto Continue Workflow

## Goal

让仓库在本地形成一套稳定的自动续跑机制：

- `post-commit` 触发一次自动继续执行
- `post-merge` 在合并/同步代码后也会触发一次自动继续执行
- 系统 `cron` 每 15 分钟兜底巡检一次
- 也支持通过 checkpoint 手动触发，不必依赖 commit
- 每轮自动续跑结束后会生成 `.planning/auto-continue-last-summary.md` 摘要；若显式配置 delivery target，还可自动创建一次性 Hermes 通知 job 回投递摘要
- 新增 repo-local 可见进度入口：`./scripts/ai-workflow.sh auto-progress`
- 新增 repo-local runner 管理入口：`auto-runner-show` / `auto-runner-bind`
- 新增 repo-local 通知配置入口：`auto-notify-show` / `auto-notify-set` / `auto-notify-unset` / `auto-notify-test`

## Adopted Best Practices

### 1. Event trigger + periodic reconciliation
- Git hook 负责轻量触发
- Cron 负责兜底巡检
- 不把长时间执行逻辑直接塞进 hook

### 2. Single runner + lock
- 同一仓库同一时间只允许一个自动续跑实例
- 使用锁文件避免并发冲突

### 3. Completion sentinel
- 自动续跑**不会**根据单个 task 完成而停止
- 停止条件只认：`.planning/auto-continue-complete.json`
- 该 sentinel 只能通过 `scripts/hermes-auto-continue-mark-complete.sh` 生成

### 4. Evidence before completion
- `mark-complete.sh` 会先执行全量验证命令
- 只有验证成功、工作树干净，才写入 sentinel
- 同时生成 `docs/auto-continue-completion-evidence.md`

## Current Stop Rule

当前仓库的自动续跑结束条件为：

1. Agent 判断项目全部任务已经开发完成
2. Agent 显式运行：

```bash
bash scripts/hermes-auto-continue-mark-complete.sh
```

3. 该脚本执行全量验证命令：

```bash
~/.hermes/node/bin/corepack pnpm lint && ~/.hermes/node/bin/corepack pnpm type-check && ~/.hermes/node/bin/corepack pnpm exec vitest run && ~/.hermes/node/bin/corepack pnpm exec vitest run --config vitest.config.integration.ts && cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

4. 只有命令成功且工作树干净，才会写入：
- `.planning/auto-continue-complete.json`
- `docs/auto-continue-completion-evidence.md`

5. 此后 `status.sh` 才会返回 `COMPLETE`，cron 自动卸载自己

## Operational Files

- `scripts/hermes-auto-continue-config.sh`
- `scripts/hermes-auto-continue-status.sh`
- `scripts/hermes-auto-continue-trigger.sh`
- `scripts/hermes-auto-continue-checkpoint.sh`
- `scripts/hermes-auto-continue-mark-complete.sh`
- `scripts/hermes-auto-continue-summary.sh`
- `scripts/hermes-auto-continue-notify.sh`
- `scripts/install-hermes-auto-continue-cron.sh`
- `scripts/ai-workflow.sh`（统一入口：`auto-status` / `auto-trigger` / `auto-checkpoint` / `auto-summary` / `auto-progress` / `auto-runner-show` / `auto-runner-bind` / `auto-workflow-state-show` / `auto-handoff-show` / `auto-handoff-set` / `auto-handoff-clear` / `auto-notify-show` / `auto-notify-set` / `auto-notify-unset` / `auto-notify-test` / `auto-mark-complete` / `auto-install` / `auto-uninstall`）
- `.husky/post-commit`
- `.husky/post-merge`

## Handy Commands

```bash
./scripts/ai-workflow.sh auto-status
./scripts/ai-workflow.sh auto-trigger manual
./scripts/ai-workflow.sh auto-checkpoint "阶段小结：刚完成 import facade 收敛"
./scripts/ai-workflow.sh auto-summary
./scripts/ai-workflow.sh auto-progress
./scripts/ai-workflow.sh auto-runner-show
./scripts/ai-workflow.sh auto-runner-bind tauri-video-batch-downloader /data/ai-coding/.hermes-auto-continue
./scripts/ai-workflow.sh auto-handoff-show
./scripts/ai-workflow.sh auto-handoff-set awaiting_human "need explicit user decision before next mutation"
./scripts/ai-workflow.sh auto-handoff-clear
./scripts/ai-workflow.sh auto-notify-show
./scripts/ai-workflow.sh auto-notify-set discord 1m auto-continue-progress
./scripts/ai-workflow.sh auto-notify-test
./scripts/ai-workflow.sh auto-notify-unset
./scripts/ai-workflow.sh auto-mark-complete
./scripts/ai-workflow.sh auto-install
./scripts/ai-workflow.sh auto-uninstall
```

## Optional chat delivery relay

默认自动续跑会把输出写到：
- `.planning/logs/hermes-auto-continue.log`
- `.planning/auto-continue-last-summary.md`
- `.planning/auto-continue.env`（repo-local 通知配置，默认不提交）

如果想让自动续跑结果继续回投递到聊天目标，可以直接写入 repo-local 配置：

```bash
./scripts/ai-workflow.sh auto-notify-set discord 1m auto-continue-progress
./scripts/ai-workflow.sh auto-notify-show
```

也可以手工 export：

```bash
export HERMES_AUTO_CONTINUE_NOTIFY_DELIVER="discord"
export HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE="1m"
```

说明：
- `discord` 会投递到 Hermes 配置的 Discord Home channel
- `local` 会只生成本地通知 job，适合测试链路
- 也支持显式平台目标，如 `platform:chat_id`
- 仓库脚本运行在本地 shell，不天然知道“当前这条聊天会话”的 origin 上下文
- 因此要稳定自动回传，必须配置可解析的 delivery target，而不是假设脚本知道当前 DM

## Handoff / awaiting_human

当自动开发不应继续自动写、而是需要等待人工决策 / 外部输入 / 前置条件时，可显式进入 handoff：

```bash
./scripts/ai-workflow.sh auto-handoff-set awaiting_human "need explicit user decision before next mutation"
./scripts/ai-workflow.sh auto-handoff-show
./scripts/ai-workflow.sh auto-handoff-clear
```

行为约定：
- handoff 信息会同时写入 repo-local `.planning/auto-continue-handoff.json` 与 project-level 全局文件 `/data/ai-coding/.hermes-auto-continue/<project_key>.handoff.json`
- handoff payload 当前至少包含：`reason`、`detail`、`requested_input`、`resume_condition`、`next_action`
- handoff 文件存在时，`scripts/hermes-auto-continue-trigger.sh` 会命中 handoff gate，写入 `state=handoff`，生成 `Mode: handoff` 摘要，并停止本轮自动续跑
- `auto-runner-show` / `auto-progress` 会展示 handoff 文件内容与 handoff 状态
- 由于 handoff 已升级为 project-level gate，当前项目 key 下的 writer 会被同一 handoff 挡住，而不是只影响当前 worktree
- 清除 handoff 后，trigger 会恢复到正常的 lock / blocked / running 语义

## Writer lease 与默认执行面

当前长期推荐模式是：

- 主仓库 `/data/ai-coding/tauri-video-batch-downloader` 作为 **默认且唯一推荐的 writer 执行面**
- 不再把 `/data/ai-coding/auto-continue-sandbox` 视为 canonical background writer；除非未来先把它重建为完整 worktree 并补齐依赖、脚本、planning 与图谱产物，否则不应承担长期自动续跑职责
- 同一项目的多个 worktree 通过统一的 `project key` 绑定到同一把 writer lock

执行面 guard：
- `scripts/hermes-auto-continue-config.sh` 现在会检查 execution surface 是否完整
- 当前默认要求至少具备：`package.json`、`pnpm-lock.yaml`、`src-tauri/`、`.planning/STATE.md` 与可执行 `scripts/graphify-sync.sh`
- `./scripts/ai-workflow.sh doctor` 会显示 `execution surface: ready|incomplete: ...`
- `./scripts/ai-workflow.sh auto-execution-surface-show` 会进一步显示 `primary_root`、`writer_eligible`、`primary_root_match` 与 `writer_recommended`
- `scripts/install-hermes-auto-continue-cron.sh install` 与 `scripts/hermes-auto-continue-trigger.sh` 会拒绝在不完整执行面上运行
- `auto-runner-bind` 现在只允许在 `writer_recommended=yes` 的执行面上写 runtime 绑定；若当前 repo 不是 primary writer root，会直接拒绝
- 如确有临时实验需要，可显式设置 `HERMES_AUTO_CONTINUE_ALLOW_INCOMPLETE_ROOT=1` 覆盖；该变量仅用于短期实验，不是长期推荐路径

可用命令：

```bash
./scripts/ai-workflow.sh auto-runner-show
./scripts/ai-workflow.sh auto-runner-bind tauri-video-batch-downloader /data/ai-coding/.hermes-auto-continue
./scripts/ai-workflow.sh auto-execution-surface-show
./scripts/ai-workflow.sh auto-workflow-state-show
```

`auto-runner-show` 会显示：
- project key
- global state dir
- writer lock file
- lease file
- 当前 writer state（active / inactive）
- 最近 writer 的 repo/source/branch/head/phase/time/status

这样即使允许多 agent 并行分析 / 审查，也仍能保证**单项目同一时刻只有一个 writer 修改代码**。

最新已完成的真实治理动作：
- 当前项目继续通过 `project key = tauri-video-batch-downloader` 绑定到统一 writer lease / state / handoff / planning mirror 目录 `/data/ai-coding/.hermes-auto-continue`
- fresh 审计已确认：历史 sandbox 目录缺失完整项目代码环境（如 `package.json`、`pnpm-lock.yaml`、`src-tauri/`、`graphify-out/`、可执行 `scripts/graphify-sync.sh`），因此不再适合作为长期 canonical writer
- fresh 审计已确认：当前 `hermes cron list --all` 返回 `No scheduled jobs.`，所以后续若恢复后台调度，应直接以主仓库为单写者执行面，不再恢复 sandbox-only 策略
- fresh 验证已确认：`auto-runner-show` / `auto-progress` 会展示 project-level writer lease、全局 state 文件与 planning mirror，因此即使只保留主仓库单写者，也仍能维持可见进度与并发治理
- fresh 验证已确认：execution-surface guard 已接入 `doctor`、`cron install` 与 `trigger`；主仓库 `doctor` 当前显示 `execution surface: ready`，而对历史 sandbox 执行同一检查会返回 `incomplete: missing package.json; missing pnpm-lock.yaml; missing src-tauri/; missing .planning/STATE.md; missing executable scripts/graphify-sync.sh`
- fresh 验证已确认：`auto-execution-surface-show` 当前会在主仓库显示 `writer_eligible=yes`、`primary_root_match=yes`、`writer_recommended=yes`；同一套检查对历史 sandbox 会显示 `writer_eligible=no`、`primary_root_match=no`、`writer_recommended=no`。此外，对 `auto-runner-bind` 的负向验证也已确认：当通过环境变量把当前 repo 伪装成非 primary root 时，该命令会明确拒绝绑定 runtime metadata
- fresh 验证已确认：系统 `crontab` 中残留的 `# HERMES_AUTO_CONTINUE_SANDBOX` 条目已被移除，旧 sandbox trigger 进程（PID `184368`）已终止；随后已将 project-level lease/state 从旧 sandbox writer 校正回主仓库并回落为 `inactive`，因此当前单写者 contract 不再被历史 sandbox 进程破坏

## 可见进度查看

当自动续跑在后台运行、但聊天里还没收到回传时，可直接执行：

```bash
./scripts/ai-workflow.sh auto-progress
```

它会统一输出：
- 当前 `auto-status`
- 当前通知目标与调度
- 当前 / 最近 writer lease 信息
- 最近一次 blocked event（如果上一轮因 writer busy 或其它 gate 被挡住）
- 统一 runner state 文件（`/data/ai-coding/.hermes-auto-continue/<project_key>.state.json`）里的 `running / blocked / complete / inactive` 状态镜像
- `.planning/auto-continue-workflow-state.json` 里的 planning mirror（供 GSD / planning 视角查看当前自治运行态）
- `auto-runner-show` / `auto-progress` 里的 `effective_state`、`file_state` 与 `state_note`（当锁状态与 state 文件不一致时，用于解释当前为何显示为 running/blocked/complete/inactive）
- 支持 `HERMES_AUTO_CONTINUE_IGNORE_LOCAL_ENV=1`：运维排查、synthetic 测试或临时检查其它 `project key` 时，可跳过 `.planning/auto-continue.env` 的 repo-local 覆盖
- 最新摘要（如果已有）
- 最近一段 `hermes-auto-continue.log` tail

这样即使自动通知还没投递回来，也能用一个命令直接看后台最近做到哪。

## E2E-verified behavior

这套自动循环开发能力已经做过真实端到端测试，已验证：
- `auto-checkpoint` 会真实写 checkpoint 并拉起 Hermes 自动继续执行
- `post-merge` 会真实触发自动继续执行
- missing sentinel 时 `status.sh` 会返回 `INCOMPLETE`
- `mark-complete.sh` 成功后会写 sentinel + evidence
- dirty worktree / HEAD mismatch 会使 `status.sh` 回退到 `INCOMPLETE`
- `trigger.sh` 在 `COMPLETE` 状态下会自动卸载 cron 条目

已在真实测试中发现并修复的缺陷：
- completion gate 临时验证日志不能写在仓库内，否则会把工作树误弄脏
- `status.sh` 必须忽略 sentinel / evidence / logs / checkpoints / lock 这类运行时产物


- 如果之后有新的提交或新的未提交改动，completion sentinel 会自动失效（HEAD 不匹配或工作树变脏）
- 这套机制的哲学是：**默认继续，不默认停止**
