#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/hermes-auto-continue-config.sh"
LOG_DIR="$ROOT/.planning/logs"
LOCK_FILE="$ROOT/.planning/.hermes-auto-continue.lock"
STATUS_SCRIPT="$ROOT/scripts/hermes-auto-continue-status.sh"
INSTALL_SCRIPT="$ROOT/scripts/install-hermes-auto-continue-cron.sh"
MARK_COMPLETE_SCRIPT="$ROOT/scripts/hermes-auto-continue-mark-complete.sh"
SUMMARY_SCRIPT="$ROOT/scripts/hermes-auto-continue-summary.sh"
NOTIFY_SCRIPT="$ROOT/scripts/hermes-auto-continue-notify.sh"

hermes_auto_continue_assert_execution_surface "$ROOT"

mkdir -p "$LOG_DIR" "$HERMES_AUTO_CONTINUE_STATE_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[auto-continue] repo-local runner already active; skipping"
  exit 0
fi

write_lease() {
  local phase="$1"
  local status_before_value="${2:-}"
  local status_after_value="${3:-}"
  python3 - <<'PY' \
    "$HERMES_AUTO_CONTINUE_GLOBAL_LEASE_FILE" \
    "$phase" \
    "$ROOT" \
    "$source_name" \
    "$status_before_value" \
    "$status_after_value" \
    "$HERMES_AUTO_CONTINUE_PROJECT_KEY" \
    "$$" \
    "${HERMES_AUTO_CONTINUE_NOTIFY_DELIVER:-}" \
    "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
from pathlib import Path
from datetime import datetime, timezone
import json, sys
lease_path = Path(sys.argv[1])
phase, root, source_name, status_before, status_after, project_key, pid, deliver, branch, head = sys.argv[2:12]
now = datetime.now(timezone.utc).isoformat()
payload = {}
if lease_path.exists():
    try:
        payload = json.loads(lease_path.read_text())
    except Exception:
        payload = {}
payload.update({
    "project_key": project_key,
    "repo_root": root,
    "pid": int(pid),
    "source": source_name,
    "branch": branch,
    "head": head,
    "notify_deliver": deliver or "none",
    "phase": phase,
})
if phase == "running":
    payload["started_at"] = now
    payload["status_before"] = status_before
    payload.pop("finished_at", None)
    payload.pop("status_after", None)
else:
    payload["finished_at"] = now
    payload["status_after"] = status_after
lease_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
PY
}

write_runner_state() {
  local state="$1"
  local reason="${2:-}"
  local detail="${3:-}"
  python3 - <<'PY' \
    "$HERMES_AUTO_CONTINUE_GLOBAL_STATE_FILE" \
    "$HERMES_AUTO_CONTINUE_PROJECT_KEY" \
    "$ROOT" \
    "$source_name" \
    "$state" \
    "$reason" \
    "$detail" \
    "${status_line:-unknown}" \
    "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
from pathlib import Path
from datetime import datetime, timezone
import json, sys
path = Path(sys.argv[1])
project_key, repo_root, source_name, state, reason, detail, status_line, branch, head = sys.argv[2:11]
now = datetime.now(timezone.utc).isoformat()
payload = {}
if path.exists():
    try:
        payload = json.loads(path.read_text())
    except Exception:
        payload = {}
payload.update({
    "time": now,
    "project_key": project_key,
    "repo_root": repo_root,
    "source": source_name,
    "state": state,
    "reason": reason or "none",
    "detail": detail or "",
    "status": status_line,
    "branch": branch,
    "head": head,
})
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
PY
}

write_handoff_event() {
  local reason="$1"
  local detail="$2"
  python3 - <<'PY' \
    "$HERMES_AUTO_CONTINUE_HANDOFF_FILE" \
    "$HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE" \
    "$HERMES_AUTO_CONTINUE_PROJECT_KEY" \
    "$ROOT" \
    "$reason" \
    "$detail"
from pathlib import Path
from datetime import datetime, timezone
import json, sys
local_path = Path(sys.argv[1])
global_path = Path(sys.argv[2])
project_key, repo_root, reason, detail = sys.argv[3:7]
payload = {
    "time": datetime.now(timezone.utc).isoformat(),
    "project_key": project_key,
    "repo_root": repo_root,
    "reason": reason,
    "detail": detail,
}
local_path.parent.mkdir(parents=True, exist_ok=True)
global_path.parent.mkdir(parents=True, exist_ok=True)
content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
local_path.write_text(content)
global_path.write_text(content)
PY
}

read_handoff_event() {
  python3 - <<'PY' "$HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE" "$HERMES_AUTO_CONTINUE_HANDOFF_FILE"
from pathlib import Path
import json, sys
paths = [Path(p) for p in sys.argv[1:]]
for path in paths:
    if path.exists():
        data = json.loads(path.read_text())
        print(f"reason={data.get('reason', 'unknown')} detail={data.get('detail', '')} requested_input={data.get('requested_input', '')} resume_condition={data.get('resume_condition', '')} next_action={data.get('next_action', '')} time={data.get('time', 'unknown')}")
        raise SystemExit(0)
raise SystemExit(1)
PY
}

write_planning_mirror() {
  local runtime_state="$1"
  local reason="${2:-}"
  local detail="${3:-}"
  local requested_input="${4:-}"
  local resume_condition="${5:-}"
  local next_action="${6:-}"
  python3 - <<'PY' \
    "$HERMES_AUTO_CONTINUE_PLANNING_STATE_FILE" \
    "$HERMES_AUTO_CONTINUE_PROJECT_KEY" \
    "$ROOT" \
    "$source_name" \
    "$runtime_state" \
    "$reason" \
    "$detail" \
    "$requested_input" \
    "$resume_condition" \
    "$next_action" \
    "${status_line:-unknown}" \
    "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
from pathlib import Path
from datetime import datetime, timezone
import json, sys
path = Path(sys.argv[1])
project_key, repo_root, source_name, runtime_state, reason, detail, requested_input, resume_condition, next_action, status_line, branch, head = sys.argv[2:14]
path.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "time": datetime.now(timezone.utc).isoformat(),
    "project_key": project_key,
    "repo_root": repo_root,
    "source": source_name,
    "runtime_state": runtime_state,
    "reason": reason or "none",
    "detail": detail or "",
    "requested_input": requested_input or "",
    "resume_condition": resume_condition or "",
    "next_action": next_action or "",
    "status": status_line,
    "branch": branch,
    "head": head,
    "state_file": str(Path(repo_root) / '.planning' / 'auto-continue-workflow-state.json'),
}
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
PY
}

read_planning_mirror_context() {
  python3 - <<'PY' "$HERMES_AUTO_CONTINUE_PLANNING_STATE_FILE" "$HERMES_AUTO_CONTINUE_PROJECT_KEY"
from pathlib import Path
import json, sys

path = Path(sys.argv[1])
project_key = sys.argv[2]
if not path.exists():
    raise SystemExit(0)

try:
    data = json.loads(path.read_text())
except Exception:
    raise SystemExit(0)

if str(data.get("project_key", "")) not in {"", project_key}:
    raise SystemExit(0)

fields = [
    ("time", data.get("time", "unknown")),
    ("runtime_state", data.get("runtime_state", "unknown")),
    ("reason", data.get("reason", "none")),
    ("detail", data.get("detail", "")),
    ("requested_input", data.get("requested_input", "")),
    ("resume_condition", data.get("resume_condition", "")),
    ("next_action", data.get("next_action", "")),
    ("source", data.get("source", "unknown")),
    ("branch", data.get("branch", "unknown")),
    ("head", data.get("head", "unknown")),
    ("status", data.get("status", "unknown")),
]
for key, value in fields:
    print(f"- {key}: {value}")
PY
}

active_writer_summary() {
  python3 - <<'PY' "$HERMES_AUTO_CONTINUE_GLOBAL_LEASE_FILE"
from pathlib import Path
import json, sys
lease = Path(sys.argv[1])
if not lease.exists():
    print("unknown holder")
    raise SystemExit(0)
try:
    data = json.loads(lease.read_text())
except Exception:
    print(f"unreadable lease: {lease}")
    raise SystemExit(0)
parts = [
    f"repo={data.get('repo_root', 'unknown')}",
    f"pid={data.get('pid', 'unknown')}",
    f"source={data.get('source', 'unknown')}",
    f"branch={data.get('branch', 'unknown')}",
    f"head={data.get('head', 'unknown')}",
    f"phase={data.get('phase', 'unknown')}",
    f"started_at={data.get('started_at', 'unknown')}",
]
print(" ".join(parts))
PY
}

write_blocked_event() {
  local reason="$1"
  local detail="$2"
  python3 - <<'PY' \
    "$HERMES_AUTO_CONTINUE_BLOCKED_FILE" \
    "$HERMES_AUTO_CONTINUE_PROJECT_KEY" \
    "$ROOT" \
    "$source_name" \
    "$reason" \
    "$detail" \
    "$status_line"
from pathlib import Path
from datetime import datetime, timezone
import json, sys
path = Path(sys.argv[1])
project_key, repo_root, source_name, reason, detail, status_line = sys.argv[2:8]
payload = {
    "time": datetime.now(timezone.utc).isoformat(),
    "project_key": project_key,
    "repo_root": repo_root,
    "source": source_name,
    "reason": reason,
    "detail": detail,
    "status": status_line,
}
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
PY
}

export PATH="/root/.local/bin:/root/.hermes/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

source_name="${1:-manual}"
status_line="$(bash "$STATUS_SCRIPT")"
echo "[auto-continue] source=$source_name status=$status_line project_key=$HERMES_AUTO_CONTINUE_PROJECT_KEY"

if [ -f "$HERMES_AUTO_CONTINUE_HANDOFF_FILE" ]; then
  handoff_summary="$(read_handoff_event)"
  write_runner_state "handoff" "awaiting_human" "$handoff_summary"
  write_planning_mirror "handoff" "awaiting_human" "$handoff_summary"
  summary_file="$(bash "$SUMMARY_SCRIPT" "$source_name" "$status_line" "$status_line" "handoff" "$handoff_summary")"
  if [ -f "$summary_file" ]; then
    bash "$NOTIFY_SCRIPT" "$summary_file" "$(basename "$ROOT")-handoff" >/dev/null 2>&1 || true
  fi
  echo "[auto-continue] handoff active; $handoff_summary"
  exit 0
fi

exec 8>"$HERMES_AUTO_CONTINUE_GLOBAL_LOCK_FILE"
if ! flock -n 8; then
  busy_summary="$(active_writer_summary)"
  write_runner_state "blocked" "global_writer_busy" "$busy_summary"
  write_planning_mirror "blocked" "global_writer_busy" "$busy_summary"
  write_blocked_event "global_writer_busy" "$busy_summary"
  summary_file="$(bash "$SUMMARY_SCRIPT" "$source_name" "$status_line" "$status_line" "blocked" "$busy_summary")"
  if [ -f "$summary_file" ]; then
    bash "$NOTIFY_SCRIPT" "$summary_file" "$(basename "$ROOT")-blocked" >/dev/null 2>&1 || true
  fi
  echo "[auto-continue] global writer busy; $busy_summary"
  exit 0
fi
rm -f "$HERMES_AUTO_CONTINUE_BLOCKED_FILE"
write_runner_state "running" "none" "writer lease acquired"
write_planning_mirror "running" "none" "writer lease acquired"
write_lease running "$status_line" ""

if [[ "$status_line" == COMPLETE* ]]; then
  write_lease finished "$status_line" "$status_line"
  write_runner_state "complete" "completion_gate_satisfied" "status.sh returned COMPLETE before run"
  write_planning_mirror "complete" "completion_gate_satisfied" "status.sh returned COMPLETE before run"
  bash "$INSTALL_SCRIPT" uninstall >/dev/null 2>&1 || true
  echo "[auto-continue] project complete; cron removed"
  exit 0
fi

read -r -d '' PROMPT <<'EOF' || true
你正在仓库 /data/ai-coding/tauri-video-batch-downloader 中自动继续当前开发任务。

请先阅读并以这些文件作为事实源：
- .planning/STATE.md
- .planning/ROADMAP.md
- docs/current-state.md
- docs/plans/2026-04-16-phase3-closeout-checklist.md
- docs/plans/2026-04-16-phase3-phase4-stepwise-execution-plan.md
- docs/auto-continue-workflow.md
- graphify-out/GRAPH_REPORT.md（如果存在）

当前自动检查状态：__STATUS_LINE__
触发来源：__SOURCE_NAME__

执行要求：
1. 根据你的判断和我们的工作流继续执行。
2. 默认继续，不默认停止；绝对不要因为某个小 task 完成、某个 checklist 局部清空、或某一轮 focused tests 通过就宣布结束。
3. 你当前运行在持有 writer lease 的主项目执行面上；允许你修改代码、文档和 planning 状态。不要假定存在独立 sandbox writer，也不要把 sandbox 当成默认长期执行面。
4. 如果你决定并行调用额外 agent，它们默认只能承担 read-only 的调研 / 审查 / 规划 / diff 建议任务；不要把真实文件写入职责下放给未持有 writer lease 的并行 agent。
5. 只有当你判断“这个项目当前范围内全部任务已经开发完成”时，才允许进入最终完成判定。
6. 最终完成判定必须通过运行：
   bash scripts/hermes-auto-continue-mark-complete.sh
7. 上面的脚本会亲自执行全量验证命令并写 completion sentinel；只有它成功写入 sentinel，当前自动循环才会停止。
8. 在 mark-complete 成功之前，继续按 brownfield 小步收敛推进，并做真实验证；不要声称全仓通过，除非你真的跑了全量验证命令并成功。
9. 完成当前一轮后，同步 .planning/STATE.md、.planning/ROADMAP.md、docs/current-state.md、docs/index.md，并运行 bash ./scripts/graphify-sync.sh smart。
EOF

PROMPT="${PROMPT/__STATUS_LINE__/$status_line}"
PROMPT="${PROMPT/__SOURCE_NAME__/$source_name}"

planning_mirror_context="$(read_planning_mirror_context || true)"
if [ -n "$planning_mirror_context" ]; then
  PROMPT+="

planning mirror（上一轮/当前 planning 控制面快照，仅作恢复与决策参考，不替代 global lock / handoff / completion gate）：
$planning_mirror_context

当 planning mirror 提供 requested_input / resume_condition / next_action 时：
- 先判断这些条件是否已经满足，再决定是否继续真实写入。
- 如果尚未满足且仍需要人工/外部输入，优先写入 handoff，而不是盲目前进。
- 如果条件已满足，优先从 next_action 指示的恢复步骤继续，而不是重新发散规划。
"
fi

cd "$ROOT"
hermes chat -q "$PROMPT" >> "$LOG_DIR/hermes-auto-continue.log" 2>&1 || true

status_after="$(bash "$STATUS_SCRIPT")"
write_lease finished "$status_line" "$status_after"
if [[ "$status_after" == COMPLETE* ]]; then
  write_runner_state "complete" "completion_gate_satisfied" "post-run status reached COMPLETE"
  write_planning_mirror "complete" "completion_gate_satisfied" "post-run status reached COMPLETE"
else
  write_runner_state "inactive" "run_finished" "writer released after run"
  write_planning_mirror "inactive" "run_finished" "writer released after run"
fi
echo "[auto-continue] post-run status=$status_after"

summary_file="$(bash "$SUMMARY_SCRIPT" "$source_name" "$status_line" "$status_after")"

if [ -f "$summary_file" ]; then
  bash "$NOTIFY_SCRIPT" "$summary_file" "$(basename "$ROOT")" >/dev/null 2>&1 || true
fi

if [[ "$status_after" == COMPLETE* ]]; then
  bash "$INSTALL_SCRIPT" uninstall >/dev/null 2>&1 || true
  echo "[auto-continue] project complete after run; cron removed"
fi
