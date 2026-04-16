#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/hermes-auto-continue-config.sh"
TRIGGER_SCRIPT="$ROOT/scripts/hermes-auto-continue-trigger.sh"
LOG_DIR="$ROOT/.planning/logs"
CRON_TAG="# HERMES_AUTO_CONTINUE_TAURI_VIDEO_BATCH_DOWNLOADER"
CRON_LINE="*/15 * * * * cd $ROOT && /usr/bin/env bash $TRIGGER_SCRIPT cron >> $LOG_DIR/hermes-auto-continue.log 2>&1 $CRON_TAG"

mkdir -p "$LOG_DIR"
current_crontab="$(crontab -l 2>/dev/null || true)"
current_crontab="$(printf '%s\n' "$current_crontab" | grep -v "$CRON_TAG" || true)"

mode="${1:-install}"
case "$mode" in
  install)
    hermes_auto_continue_assert_execution_surface "$ROOT"
    {
      printf '%s\n' "$current_crontab"
      printf '%s\n' "$CRON_LINE"
    } | sed '/^$/N;/^\n$/D' | crontab -
    echo "installed"
    ;;
  uninstall)
    printf '%s\n' "$current_crontab" | sed '/^$/N;/^\n$/D' | crontab -
    echo "uninstalled"
    ;;
  *)
    echo "Usage: $0 {install|uninstall}" >&2
    exit 1
    ;;
esac
