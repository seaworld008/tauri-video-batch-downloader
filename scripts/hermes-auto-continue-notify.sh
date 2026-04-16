#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/hermes-auto-continue-config.sh"

SUMMARY_FILE="${1:-${HERMES_AUTO_CONTINUE_SUMMARY_FILE:-}}"
RUN_LABEL="${2:-auto-continue}"

if [ -z "${HERMES_AUTO_CONTINUE_NOTIFY_DELIVER:-}" ]; then
  echo "[auto-notify] skipped: HERMES_AUTO_CONTINUE_NOTIFY_DELIVER is not configured" >&2
  exit 0
fi

if [ -z "$SUMMARY_FILE" ] || [ ! -f "$SUMMARY_FILE" ]; then
  echo "[auto-notify] ERROR: summary file not found: ${SUMMARY_FILE:-<empty>}" >&2
  exit 1
fi

summary_text="$(python3 - <<'PY' "$SUMMARY_FILE"
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
limit = 6000
print(text[:limit])
PY
)"

notify_prompt="你在汇报一个仓库自动续跑器刚完成的一次运行。请严格基于下面摘要，用中文写一条简洁更新，包含：1) 当前是在继续进行、已完成还是卡住；2) 本轮触发来源；3) 最新验证/状态变化；4) 若有阻塞或注意事项就直接点出。不要编造摘要里没有的事实。\n\n${summary_text}"

hermes cron create \
  --name "${HERMES_AUTO_CONTINUE_NOTIFY_NAME_PREFIX}-${RUN_LABEL}" \
  --deliver "$HERMES_AUTO_CONTINUE_NOTIFY_DELIVER" \
  --repeat 1 \
  "${HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE}" \
  "$notify_prompt"
