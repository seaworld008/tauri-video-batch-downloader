#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.planning/logs"
CHECKPOINT_DIR="$ROOT/.planning/checkpoints"
TRIGGER_SCRIPT="$ROOT/scripts/hermes-auto-continue-trigger.sh"

mkdir -p "$LOG_DIR" "$CHECKPOINT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
CHECKPOINT_FILE="$CHECKPOINT_DIR/${STAMP}.md"
MESSAGE="${*:-manual-checkpoint}"

cat > "$CHECKPOINT_FILE" <<EOF
# Auto Continue Checkpoint

- Time: $(date -Is)
- Repo: $ROOT
- Trigger: manual checkpoint
- Message: $MESSAGE
EOF

nohup bash "$TRIGGER_SCRIPT" checkpoint >> "$LOG_DIR/hermes-auto-continue.log" 2>&1 &

echo "checkpoint_written=$CHECKPOINT_FILE"
echo "triggered=checkpoint"
