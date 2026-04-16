#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/hermes-auto-continue-config.sh"

SOURCE_NAME="${1:-manual}"
STATUS_BEFORE="${2:-unknown}"
STATUS_AFTER="${3:-unknown}"
SUMMARY_MODE="${4:-run}"
SUMMARY_DETAIL="${5:-}"

cd "$ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
LATEST_CHECKPOINT="$(find "$ROOT/.planning/checkpoints" -maxdepth 1 -type f 2>/dev/null | sort | tail -n 1 || true)"
if [ -n "$LATEST_CHECKPOINT" ]; then
  LATEST_CHECKPOINT="${LATEST_CHECKPOINT#$ROOT/}"
else
  LATEST_CHECKPOINT="none"
fi

RECENT_LOG="$(tail -n 20 "$ROOT/.planning/logs/hermes-auto-continue.log" 2>/dev/null || true)"
if [ -z "$RECENT_LOG" ]; then
  RECENT_LOG="(no log output yet)"
fi

cat > "$HERMES_AUTO_CONTINUE_SUMMARY_FILE" <<EOF
# Auto Continue Last Run

- Time: $(date -Is)
- Mode: $SUMMARY_MODE
- Source: $SOURCE_NAME
- Repo: $ROOT
- Branch: $BRANCH
- HEAD: $HEAD_SHA
- Status before: $STATUS_BEFORE
- Status after: $STATUS_AFTER
- Latest checkpoint: $LATEST_CHECKPOINT
- Notify deliver configured: ${HERMES_AUTO_CONTINUE_NOTIFY_DELIVER:-none}
EOF

if [ -n "$SUMMARY_DETAIL" ]; then
cat >> "$HERMES_AUTO_CONTINUE_SUMMARY_FILE" <<EOF
- Detail: $SUMMARY_DETAIL
EOF
fi

cat >> "$HERMES_AUTO_CONTINUE_SUMMARY_FILE" <<EOF

## Recent log tail

EOF
printf '%s\n' '```text' >> "$HERMES_AUTO_CONTINUE_SUMMARY_FILE"
printf '%s\n' "$RECENT_LOG" >> "$HERMES_AUTO_CONTINUE_SUMMARY_FILE"
printf '%s\n' '```' >> "$HERMES_AUTO_CONTINUE_SUMMARY_FILE"

echo "$HERMES_AUTO_CONTINUE_SUMMARY_FILE"