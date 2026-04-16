# Auto-Continue E2E Test Record

**Date:** 2026-04-16

## Goal

真实测试当前仓库里的自动循环开发能力，而不是只检查脚本存在性。

## Test Scope

### Current repo (live repo)
验证：
- `auto-checkpoint` 触发链路
- `post-merge` 触发链路
- `auto-status` 在缺失 sentinel 时返回 `INCOMPLETE`
- 单 runner 锁是否阻止重复触发

### Isolated sandbox repo
验证：
- missing sentinel -> `INCOMPLETE`
- `mark-complete` 成功后写 sentinel / evidence
- `status` 在 sentinel 有效时返回 `COMPLETE`
- dirty worktree 会让 status 回退到 `INCOMPLETE`
- HEAD 变化会让 status 回退到 `INCOMPLETE`
- 重新 `mark-complete` 后恢复 `COMPLETE`
- `trigger.sh` 在 `COMPLETE` 状态下会自动卸载 cron 条目

## Real Findings

### Verified working behaviors
1. `./scripts/ai-workflow.sh auto-checkpoint "..."` 会真实写入 checkpoint，并拉起 Hermes 自动继续执行。
2. `.husky/post-merge` 会真实触发自动继续执行。
3. 单 runner 锁有效：重复触发时会输出 `another run is in progress; skipping`。
4. 在 clean sandbox 中：
   - missing sentinel -> `INCOMPLETE`
   - `mark-complete` -> 成功写入 `.planning/auto-continue-complete.json`
   - 同时写入 `docs/auto-continue-completion-evidence.md`
   - `status.sh` -> `COMPLETE`
   - 脏工作树 -> `INCOMPLETE reason=dirty_worktree`
   - HEAD 变化 -> `INCOMPLETE reason=head_mismatch`
   - 再次 `mark-complete` -> 恢复 `COMPLETE`
   - `trigger.sh manual` 在 `COMPLETE` 下会移除 sandbox cron 条目

## Bugs Found and Fixed During E2E

### Bug 1 — temp verify log polluted worktree
**Symptom:** `mark-complete.sh` 把临时验证日志写到仓库内 `.planning/`，导致它自己把工作树弄脏，永远无法通过 clean-worktree gate。

**Fix:**
- 改为把临时验证日志写到 `/tmp/hermes-auto-verify.XXXXXX.log`
- 已同步修复：
  - 当前仓库脚本
  - sandbox 测试副本
  - skill 模板 `templates/hermes-auto-continue-mark-complete.sh`

### Bug 2 — sentinel / evidence 被 status 误判为脏工作树
**Symptom:** `mark-complete` 成功写出 sentinel 和 evidence 后，`status.sh` 又把这些文件当成 dirty worktree，导致无法返回 `COMPLETE`。

**Fix:**
`status.sh` 现在会忽略这些运行时/完成态产物：
- `.planning/auto-continue-complete.json`
- `docs/auto-continue-completion-evidence.md`
- `.planning/logs/`
- `.planning/checkpoints/`
- `.planning/.hermes-auto-continue.lock`

并已同步修复到：
- 当前仓库脚本
- sandbox 测试副本
- skill 模板 `templates/hermes-auto-continue-status.sh`

## Final Assessment

当前这套自动循环开发能力已经通过了真实端到端测试，且不是一次就过，而是在真实测试中发现并修掉了两个 completion-gate 相关 bug。

当前可以较有信心地认为：
- 触发链路可用
- completion gate 语义正确
- partial completion 不会误停
- `COMPLETE` 后能自动卸载 cron

## Suggested Next Step

把这次 E2E 结论作为 workflow 事实，后续让当前仓库继续自动推进真实开发任务，而不是继续停留在自动化基础设施打磨。
