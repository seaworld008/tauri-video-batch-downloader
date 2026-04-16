#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GRAPH_SCRIPT="$ROOT/scripts/graphify-sync.sh"
GRAPH_DIR="$ROOT/graphify-out"
PLAN_DIR="$ROOT/.planning"
REPORT_MD="$GRAPH_DIR/GRAPH_REPORT.md"
STATE_MD="$PLAN_DIR/STATE.md"
ROADMAP_MD="$PLAN_DIR/ROADMAP.md"
PROJECT_MD="$PLAN_DIR/PROJECT.md"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

show_doctor() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  local execution_surface_status
  execution_surface_status="$(hermes_auto_continue_check_execution_surface "$ROOT")" || true
  echo "[ai-workflow] repo: $ROOT"
  echo "[ai-workflow] branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo
  echo "[ai-workflow] tools"
  if have_cmd hermes; then
    echo "  hermes: $(command -v hermes)"
    hermes --version | sed -n '1p' | sed 's/^/    /'
  else
    echo "  hermes: MISSING"
  fi
  if have_cmd graphify; then
    echo "  graphify: $(command -v graphify)"
    graphify --help >/dev/null 2>&1 && echo "    wrapper ok"
  else
    echo "  graphify: MISSING"
  fi
  if have_cmd gsd-sdk; then
    echo "  gsd-sdk: $(command -v gsd-sdk)"
    gsd-sdk --version | sed 's/^/    /'
  else
    echo "  gsd-sdk: MISSING"
  fi
  echo
  echo "[ai-workflow] repo artifacts"
  [ -d "$GRAPH_DIR" ] && echo "  graphify-out/: present" || echo "  graphify-out/: missing"
  [ -d "$PLAN_DIR" ] && echo "  .planning/: present" || echo "  .planning/: missing"
  [ -d "$ROOT/.codex" ] && echo "  .codex/: present" || echo "  .codex/: missing"
  [ -x "$GRAPH_SCRIPT" ] && echo "  scripts/graphify-sync.sh: executable" || echo "  scripts/graphify-sync.sh: missing or not executable"
  echo "  execution surface: $execution_surface_status"
}

show_execution_surface() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  while IFS='=' read -r key value; do
    echo "[auto-execution-surface] ${key}: ${value}"
  done < <(hermes_auto_continue_writer_surface_status "$ROOT")
}

show_context() {
  echo "[ai-workflow] recommended reading order"
  [ -f "$REPORT_MD" ] && echo "  1. $REPORT_MD"
  [ -f "$STATE_MD" ] && echo "  2. $STATE_MD"
  [ -f "$ROADMAP_MD" ] && echo "  3. $ROADMAP_MD"
  [ -f "$PROJECT_MD" ] && echo "  4. $PROJECT_MD"
  echo
  if [ -x "$GRAPH_SCRIPT" ]; then
    "$GRAPH_SCRIPT" status
  fi
}

sync_graph() {
  if [ ! -x "$GRAPH_SCRIPT" ]; then
    echo "[ai-workflow] ERROR: $GRAPH_SCRIPT missing or not executable" >&2
    exit 1
  fi
  "$GRAPH_SCRIPT" smart
}

force_graph() {
  if [ ! -x "$GRAPH_SCRIPT" ]; then
    echo "[ai-workflow] ERROR: $GRAPH_SCRIPT missing or not executable" >&2
    exit 1
  fi
  "$GRAPH_SCRIPT" force
}

show_next() {
  echo "[ai-workflow] standard loop"
  echo "  1. ./scripts/ai-workflow.sh sync"
  echo "  2. 读 graphify-out/GRAPH_REPORT.md"
  echo "  3. 读 .planning/STATE.md 和 .planning/ROADMAP.md"
  echo "  4. 用 GSD 推进当前 phase/plan"
  echo "  5. 改代码 / 跑测试"
  echo "  6. ./scripts/ai-workflow.sh sync"
}

show_upgrade_contract() {
  cat <<'EOF'
[ai-workflow] non-invasive upgrade contract
- 不修改 Hermes 上游仓库源码
- 不修改 graphify Python 包源码
- 不修改 get-shit-done 上游仓库源码
- 仅依赖稳定入口：
  - hermes CLI
  - python -m graphify
  - node <get-shit-done/sdk/dist/cli.js>
- 若上游更新，只需保证这些入口仍存在；wrapper 与本项目脚本无需跟随大改
- 若入口变化，优先改 wrapper，不改上游仓库
EOF
}

auto_status() {
  bash "$ROOT/scripts/hermes-auto-continue-status.sh"
}

auto_trigger() {
  bash "$ROOT/scripts/hermes-auto-continue-trigger.sh" "${1:-manual}"
}

auto_checkpoint() {
  shift || true
  bash "$ROOT/scripts/hermes-auto-continue-checkpoint.sh" "$@"
}

auto_summary() {
  bash "$ROOT/scripts/hermes-auto-continue-summary.sh" "${1:-manual}" "${2:-unknown}" "${3:-unknown}"
}

write_auto_continue_env() {
  mkdir -p "$ROOT/.planning"
  python3 - <<'PY' "$ROOT/.planning/auto-continue.env" "$@"
from pathlib import Path
import sys
path = Path(sys.argv[1])
updates = {}
for arg in sys.argv[2:]:
    if "=" not in arg:
        continue
    key, value = arg.split("=", 1)
    updates[key] = value
existing = {}
if path.exists():
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line.startswith("export ") or "=" not in line:
            continue
        key, value = line[len("export "):].split("=", 1)
        existing[key] = value.strip().strip("'\"")
existing.update(updates)
content = "".join(f"export {key}={value!r}\n" for key, value in sorted(existing.items()))
path.write_text(content)
print(path)
PY
}

show_planning_mirror() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  echo "[auto-workflow-state] file: ${HERMES_AUTO_CONTINUE_PLANNING_STATE_FILE}"
  if [ -f "$HERMES_AUTO_CONTINUE_PLANNING_STATE_FILE" ]; then
    python3 - <<'PY' "$HERMES_AUTO_CONTINUE_PLANNING_STATE_FILE"
from pathlib import Path
import json, sys
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception as exc:
    print(f"[auto-workflow-state] parse error: {exc}")
    raise SystemExit(0)
for key in ["time", "runtime_state", "reason", "detail", "requested_input", "resume_condition", "next_action", "repo_root", "source", "branch", "head", "status"]:
    print(f"[auto-workflow-state] {key}: {data.get(key, 'unknown')}")
PY
  else
    echo "[auto-workflow-state] missing"
  fi
}

show_handoff_event() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  echo "[auto-handoff] file: ${HERMES_AUTO_CONTINUE_HANDOFF_FILE}"
  echo "[auto-handoff] global_file: ${HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE}"
  if [ -f "$HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE" ]; then
    python3 - <<'PY' "$HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE"
from pathlib import Path
import json, sys
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception as exc:
    print(f"[auto-handoff] parse error: {exc}")
    raise SystemExit(0)
for key in ["time", "reason", "detail", "requested_input", "resume_condition", "next_action", "repo_root"]:
    print(f"[auto-handoff] {key}: {data.get(key, 'unknown')}")
PY
  elif [ -f "$HERMES_AUTO_CONTINUE_HANDOFF_FILE" ]; then
    python3 - <<'PY' "$HERMES_AUTO_CONTINUE_HANDOFF_FILE"
from pathlib import Path
import json, sys
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception as exc:
    print(f"[auto-handoff] parse error: {exc}")
    raise SystemExit(0)
for key in ["time", "reason", "detail", "requested_input", "resume_condition", "next_action", "repo_root"]:
    print(f"[auto-handoff] {key}: {data.get(key, 'unknown')}")
PY
  else
    echo "[auto-handoff] missing"
  fi
}

auto_handoff_set() {
  local reason="${2:-awaiting_human}"
  local detail="${3:-manual handoff requested}"
  local requested_input="${4:-provide explicit human decision}"
  local resume_condition="${5:-required human input is provided}"
  local next_action="${6:-resume the next planned mutation step}"
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  python3 - <<'PY' \
    "$HERMES_AUTO_CONTINUE_HANDOFF_FILE" \
    "$HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE" \
    "$HERMES_AUTO_CONTINUE_GLOBAL_STATE_FILE" \
    "$HERMES_AUTO_CONTINUE_PROJECT_KEY" \
    "$ROOT" \
    "$reason" \
    "$detail" \
    "$requested_input" \
    "$resume_condition" \
    "$next_action" \
    "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
from pathlib import Path
from datetime import datetime, timezone
import json, sys
local_handoff_path = Path(sys.argv[1])
global_handoff_path = Path(sys.argv[2])
state_path = Path(sys.argv[3])
project_key, repo_root, reason, detail, requested_input, resume_condition, next_action, branch, head = sys.argv[4:13]
now = datetime.now(timezone.utc).isoformat()
handoff_payload = {
    'time': now,
    'project_key': project_key,
    'repo_root': repo_root,
    'reason': reason,
    'detail': detail,
    'requested_input': requested_input,
    'resume_condition': resume_condition,
    'next_action': next_action,
}
state_payload = {}
if state_path.exists():
    try:
        state_payload = json.loads(state_path.read_text())
    except Exception:
        state_payload = {}
state_payload.update({
    'time': now,
    'project_key': project_key,
    'repo_root': repo_root,
    'source': 'operator',
    'state': 'handoff',
    'reason': reason,
    'detail': detail,
    'requested_input': requested_input,
    'resume_condition': resume_condition,
    'next_action': next_action,
    'status': 'HANDOFF awaiting_human',
    'branch': branch,
    'head': head,
})
workflow_state_path = Path(repo_root) / '.planning' / 'auto-continue-workflow-state.json'
workflow_state = {
    'time': now,
    'project_key': project_key,
    'repo_root': repo_root,
    'source': 'operator',
    'runtime_state': 'handoff',
    'reason': reason,
    'detail': detail,
    'requested_input': requested_input,
    'resume_condition': resume_condition,
    'next_action': next_action,
    'status': 'HANDOFF awaiting_human',
    'branch': branch,
    'head': head,
    'state_file': str(workflow_state_path),
}
local_handoff_path.parent.mkdir(parents=True, exist_ok=True)
global_handoff_path.parent.mkdir(parents=True, exist_ok=True)
state_path.parent.mkdir(parents=True, exist_ok=True)
workflow_state_path.parent.mkdir(parents=True, exist_ok=True)
content = json.dumps(handoff_payload, ensure_ascii=False, indent=2) + '\n'
local_handoff_path.write_text(content)
global_handoff_path.write_text(content)
state_path.write_text(json.dumps(state_payload, ensure_ascii=False, indent=2) + '\n')
workflow_state_path.write_text(json.dumps(workflow_state, ensure_ascii=False, indent=2) + '\n')
print(local_handoff_path)
PY
}

auto_handoff_clear() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  rm -f "$ROOT/.planning/auto-continue-handoff.json" "$HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE"
  python3 - <<'PY' \
    "$HERMES_AUTO_CONTINUE_PLANNING_STATE_FILE" \
    "$HERMES_AUTO_CONTINUE_PROJECT_KEY" \
    "$ROOT" \
    "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
from pathlib import Path
from datetime import datetime, timezone
import json, sys
path = Path(sys.argv[1])
project_key, root, branch, head = sys.argv[2:6]
payload = {}
if path.exists():
    try:
        payload = json.loads(path.read_text())
    except Exception:
        payload = {}
payload.update({
    'time': datetime.now(timezone.utc).isoformat(),
    'project_key': project_key,
    'repo_root': root,
    'source': 'operator',
    'runtime_state': 'inactive',
    'reason': 'handoff_cleared',
    'detail': 'handoff cleared by operator',
    'requested_input': '',
    'resume_condition': '',
    'next_action': 'resume normal auto-continue flow on next trigger',
    'status': 'INACTIVE handoff_cleared',
    'branch': branch,
    'head': head,
    'state_file': str(path),
})
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
PY
  echo "[auto-handoff] cleared $ROOT/.planning/auto-continue-handoff.json and $HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE"
}

show_effective_runner_state() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  mkdir -p "$HERMES_AUTO_CONTINUE_STATE_DIR"
  local active_state="inactive"
  exec 6>"$HERMES_AUTO_CONTINUE_GLOBAL_LOCK_FILE"
  if flock -n 6; then
    active_state="inactive"
    flock -u 6
  else
    active_state="active"
  fi
  python3 - <<'PY' "$HERMES_AUTO_CONTINUE_GLOBAL_STATE_FILE" "$active_state" "$HERMES_AUTO_CONTINUE_HANDOFF_FILE"
from pathlib import Path
import json, sys
path = Path(sys.argv[1])
active_state = sys.argv[2]
handoff_path = Path(sys.argv[3])
file_state = "missing"
reason = "none"
if path.exists():
    try:
        data = json.loads(path.read_text())
        file_state = str(data.get("state", "missing") or "missing")
        reason = str(data.get("reason", "none") or "none")
    except Exception:
        file_state = "unreadable"
        reason = "parse_error"
if active_state == "active":
    effective_state = "running"
elif handoff_path.exists():
    effective_state = "handoff"
elif file_state == "complete":
    effective_state = "complete"
elif file_state == "handoff":
    effective_state = "handoff"
elif file_state == "blocked":
    effective_state = "blocked"
else:
    effective_state = "inactive"
state_note = "aligned"
if active_state == "active" and file_state != "running":
    state_note = f"lock-active overrides file-state={file_state}"
elif active_state == "inactive" and handoff_path.exists() and file_state != "handoff":
    state_note = f"handoff-file overrides file-state={file_state}"
elif active_state == "inactive" and file_state == "running":
    state_note = "lock-inactive overrides stale file-state=running"
print(f"[auto-runner-state] effective_state: {effective_state}")
print(f"[auto-runner-state] file_state: {file_state}")
print(f"[auto-runner-state] state_note: {state_note}")
print(f"[auto-runner-state] state_reason: {reason}")
PY
}

show_runner_state() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  echo "[auto-runner-state] file: ${HERMES_AUTO_CONTINUE_GLOBAL_STATE_FILE}"
  if [ -f "$HERMES_AUTO_CONTINUE_GLOBAL_STATE_FILE" ]; then
    python3 - <<'PY' "$HERMES_AUTO_CONTINUE_GLOBAL_STATE_FILE"
from pathlib import Path
import json, sys
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception as exc:
    print(f"[auto-runner-state] parse error: {exc}")
    raise SystemExit(0)
for key in ["time", "state", "reason", "detail", "requested_input", "resume_condition", "next_action", "repo_root", "source", "branch", "head", "status"]:
    print(f"[auto-runner-state] {key}: {data.get(key, 'unknown')}")
PY
  else
    echo "[auto-runner-state] missing"
  fi
}

show_runner_lease() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  echo "[auto-runner] project key: ${HERMES_AUTO_CONTINUE_PROJECT_KEY}"
  echo "[auto-runner] state dir: ${HERMES_AUTO_CONTINUE_STATE_DIR}"
  echo "[auto-runner] lock file: ${HERMES_AUTO_CONTINUE_GLOBAL_LOCK_FILE}"
  echo "[auto-runner] lease file: ${HERMES_AUTO_CONTINUE_GLOBAL_LEASE_FILE}"

  mkdir -p "$HERMES_AUTO_CONTINUE_STATE_DIR"
  local active_state="inactive"
  exec 7>"$HERMES_AUTO_CONTINUE_GLOBAL_LOCK_FILE"
  if flock -n 7; then
    active_state="inactive"
    flock -u 7
  else
    active_state="active"
  fi
  echo "[auto-runner] writer state: ${active_state}"
  if [ -f "$HERMES_AUTO_CONTINUE_GLOBAL_LEASE_FILE" ]; then
    python3 - <<'PY' "$HERMES_AUTO_CONTINUE_GLOBAL_LEASE_FILE"
from pathlib import Path
import json, sys
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception as exc:
    print(f"[auto-runner] lease parse error: {exc}")
    raise SystemExit(0)
for key in ["repo_root", "pid", "source", "branch", "head", "phase", "started_at", "finished_at", "status_before", "status_after", "notify_deliver"]:
    print(f"[auto-runner] {key}: {data.get(key, 'unknown')}")
PY
  else
    echo "[auto-runner] lease: missing"
  fi
}

auto_progress() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  local lines="${1:-${HERMES_AUTO_CONTINUE_PROGRESS_LINES:-40}}"
  local status_line
  status_line="$(bash "$ROOT/scripts/hermes-auto-continue-status.sh")"

  echo "[auto-progress] repo: $ROOT"
  echo "[auto-progress] status: $status_line"
  echo "[auto-progress] notify deliver: ${HERMES_AUTO_CONTINUE_NOTIFY_DELIVER:-none}"
  echo "[auto-progress] notify schedule: ${HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE:-1m}"
  echo "[auto-progress] summary file: ${HERMES_AUTO_CONTINUE_SUMMARY_FILE}"
  echo
  show_execution_surface
  echo
  show_runner_state
  echo
  show_planning_mirror
  echo
  show_effective_runner_state
  echo
  show_runner_lease
  echo

  if [ -f "$HERMES_AUTO_CONTINUE_HANDOFF_FILE" ]; then
    echo "[auto-progress] active handoff"
    show_handoff_event
    echo
  fi

  if [ -f "$HERMES_AUTO_CONTINUE_BLOCKED_FILE" ]; then
    echo "[auto-progress] latest blocked event"
    python3 - <<'PY' "$HERMES_AUTO_CONTINUE_BLOCKED_FILE"
from pathlib import Path
import json, sys
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except Exception as exc:
    print(f"[auto-progress] blocked parse error: {exc}")
    raise SystemExit(0)
for key in ["time", "reason", "detail", "source", "status"]:
    print(f"[auto-progress] blocked_{key}: {data.get(key, 'unknown')}")
PY
    echo
  fi

  if [ -f "$HERMES_AUTO_CONTINUE_SUMMARY_FILE" ]; then
    echo "[auto-progress] latest summary"
    cat "$HERMES_AUTO_CONTINUE_SUMMARY_FILE"
  else
    echo "[auto-progress] latest summary: missing"
  fi

  echo
  echo "[auto-progress] recent log tail (${lines} lines)"
  if [ -f "$ROOT/.planning/logs/hermes-auto-continue.log" ]; then
    tail -n "$lines" "$ROOT/.planning/logs/hermes-auto-continue.log"
  else
    echo "(no auto-continue log yet)"
  fi
}

auto_notify_show() {
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  echo "[auto-notify] env file: ${HERMES_AUTO_CONTINUE_NOTIFY_ENV_FILE}"
  echo "[auto-notify] deliver: ${HERMES_AUTO_CONTINUE_NOTIFY_DELIVER:-none}"
  echo "[auto-notify] schedule: ${HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE:-1m}"
  echo "[auto-notify] name prefix: ${HERMES_AUTO_CONTINUE_NOTIFY_NAME_PREFIX:-auto-continue-notify}"
}

auto_notify_set() {
  local deliver="${2:-}"
  local schedule="${3:-1m}"
  local prefix="${4:-auto-continue-notify}"
  if [ -z "$deliver" ]; then
    echo "Usage: $0 auto-notify-set <deliver> [schedule] [name_prefix]" >&2
    exit 1
  fi
  write_auto_continue_env \
    "HERMES_AUTO_CONTINUE_NOTIFY_DELIVER=$deliver" \
    "HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE=$schedule" \
    "HERMES_AUTO_CONTINUE_NOTIFY_NAME_PREFIX=$prefix"
}

auto_runner_bind() {
  local project_key="${2:-}"
  local state_dir="${3:-/data/ai-coding/.hermes-auto-continue}"
  # shellcheck source=/dev/null
  source "$ROOT/scripts/hermes-auto-continue-config.sh"
  if [ -z "$project_key" ]; then
    echo "Usage: $0 auto-runner-bind <project_key> [state_dir]" >&2
    exit 1
  fi
  local writer_recommended
  writer_recommended="$(hermes_auto_continue_writer_surface_status "$ROOT" | awk -F= '/^writer_recommended=/{print $2}')"
  if [ "$writer_recommended" != "yes" ]; then
    echo "[auto-runner-bind] ERROR: current repo is not the recommended writer execution surface." >&2
    show_execution_surface >&2
    echo "[auto-runner-bind] Refusing to bind runtime metadata here. Use the main project repo, or temporarily override policy only for controlled experiments." >&2
    exit 1
  fi
  write_auto_continue_env \
    "HERMES_AUTO_CONTINUE_PROJECT_KEY=$project_key" \
    "HERMES_AUTO_CONTINUE_STATE_DIR=$state_dir"
}

auto_runner_show() {
  show_execution_surface
  echo
  show_runner_state
  echo
  show_planning_mirror
  echo
  show_effective_runner_state
  echo
  show_runner_lease
}

auto_notify_unset() {
  python3 - <<'PY' "$ROOT/.planning/auto-continue.env"
from pathlib import Path
import sys
path = Path(sys.argv[1])
if not path.exists():
    print(f"[auto-notify] no env file at {path}")
    raise SystemExit(0)
remove = {
    "HERMES_AUTO_CONTINUE_NOTIFY_DELIVER",
    "HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE",
    "HERMES_AUTO_CONTINUE_NOTIFY_NAME_PREFIX",
}
kept = {}
for raw_line in path.read_text().splitlines():
    line = raw_line.strip()
    if not line.startswith("export ") or "=" not in line:
        continue
    key, value = line[len("export "):].split("=", 1)
    if key not in remove:
        kept[key] = value.strip().strip("'\"")
if kept:
    path.write_text("".join(f"export {k}={v!r}\n" for k, v in sorted(kept.items())))
    print(f"[auto-notify] removed notify config from {path}")
else:
    path.unlink(missing_ok=True)
    print(f"[auto-notify] removed {path}")
PY
}

auto_notify_test() {
  bash "$ROOT/scripts/hermes-auto-continue-summary.sh" "manual-test" "$(bash "$ROOT/scripts/hermes-auto-continue-status.sh")" "$(bash "$ROOT/scripts/hermes-auto-continue-status.sh")" >/dev/null
  bash "$ROOT/scripts/hermes-auto-continue-notify.sh" "$ROOT/.planning/auto-continue-last-summary.md" "$(basename "$ROOT")-manual-test"
}

auto_mark_complete() {
  bash "$ROOT/scripts/hermes-auto-continue-mark-complete.sh"
}

auto_install() {
  bash "$ROOT/scripts/install-hermes-auto-continue-cron.sh" install
}

auto_uninstall() {
  bash "$ROOT/scripts/install-hermes-auto-continue-cron.sh" uninstall
}

cmd="${1:-doctor}"
case "$cmd" in
  doctor) show_doctor ;;
  context) show_context ;;
  sync) sync_graph ;;
  force) force_graph ;;
  next) show_next ;;
  contract) show_upgrade_contract ;;
  auto-status) auto_status ;;
  auto-trigger) auto_trigger "${2:-manual}" ;;
  auto-checkpoint) auto_checkpoint "$@" ;;
  auto-summary) auto_summary "${2:-manual}" "${3:-unknown}" "${4:-unknown}" ;;
  auto-progress) auto_progress "${2:-}" ;;
  auto-runner-show) auto_runner_show ;;
  auto-runner-bind) auto_runner_bind "$@" ;;
  auto-execution-surface-show) show_execution_surface ;;
  auto-workflow-state-show) show_planning_mirror ;;
  auto-handoff-show) show_handoff_event ;;
  auto-handoff-set) auto_handoff_set "$@" ;;
  auto-handoff-clear) auto_handoff_clear ;;
  auto-notify-show) auto_notify_show ;;
  auto-notify-set) auto_notify_set "$@" ;;
  auto-notify-unset) auto_notify_unset ;;
  auto-notify-test) auto_notify_test ;;
  auto-mark-complete) auto_mark_complete ;;
  auto-install) auto_install ;;
  auto-uninstall) auto_uninstall ;;
  *)
    echo "Usage: $0 {doctor|context|sync|force|next|contract|auto-status|auto-trigger [source]|auto-checkpoint [message]|auto-summary [source] [status_before] [status_after]|auto-progress [lines]|auto-runner-show|auto-runner-bind <project_key> [state_dir]|auto-execution-surface-show|auto-workflow-state-show|auto-handoff-show|auto-handoff-set [reason] [detail] [requested_input] [resume_condition] [next_action]|auto-handoff-clear|auto-notify-show|auto-notify-set <deliver> [schedule] [name_prefix]|auto-notify-unset|auto-notify-test|auto-mark-complete|auto-install|auto-uninstall}" >&2
    exit 1
    ;;
esac
