#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV_FILE="$ROOT/.planning/auto-continue.env"
if [ "${HERMES_AUTO_CONTINUE_IGNORE_LOCAL_ENV:-0}" != "1" ] && [ -f "$LOCAL_ENV_FILE" ]; then
  # shellcheck source=/dev/null
  source "$LOCAL_ENV_FILE"
fi

export HERMES_AUTO_CONTINUE_ROOT="$ROOT"
export HERMES_AUTO_CONTINUE_SENTINEL="$ROOT/.planning/auto-continue-complete.json"
export HERMES_AUTO_CONTINUE_EVIDENCE_DOC="$ROOT/docs/auto-continue-completion-evidence.md"
export HERMES_AUTO_CONTINUE_FULL_VERIFY_CMD='~/.hermes/node/bin/corepack pnpm lint && ~/.hermes/node/bin/corepack pnpm type-check && ~/.hermes/node/bin/corepack pnpm exec vitest run && ~/.hermes/node/bin/corepack pnpm exec vitest run --config vitest.config.integration.ts && ~/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml --all --check && ~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml && ~/.cargo/bin/cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings'
export HERMES_AUTO_CONTINUE_SUMMARY_FILE="$ROOT/.planning/auto-continue-last-summary.md"
export HERMES_AUTO_CONTINUE_BLOCKED_FILE="$ROOT/.planning/auto-continue-last-blocked.json"
export HERMES_AUTO_CONTINUE_HANDOFF_FILE="$ROOT/.planning/auto-continue-handoff.json"
export HERMES_AUTO_CONTINUE_NOTIFY_ENV_FILE="$LOCAL_ENV_FILE"
export HERMES_AUTO_CONTINUE_NOTIFY_DELIVER="${HERMES_AUTO_CONTINUE_NOTIFY_DELIVER:-}"
export HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE="${HERMES_AUTO_CONTINUE_NOTIFY_SCHEDULE:-1m}"
export HERMES_AUTO_CONTINUE_NOTIFY_NAME_PREFIX="${HERMES_AUTO_CONTINUE_NOTIFY_NAME_PREFIX:-auto-continue-notify}"
export HERMES_AUTO_CONTINUE_PROGRESS_LINES="${HERMES_AUTO_CONTINUE_PROGRESS_LINES:-40}"
export HERMES_AUTO_CONTINUE_PROJECT_KEY="${HERMES_AUTO_CONTINUE_PROJECT_KEY:-$(basename "$ROOT")}"
export HERMES_AUTO_CONTINUE_STATE_DIR="${HERMES_AUTO_CONTINUE_STATE_DIR:-/data/ai-coding/.hermes-auto-continue}"
export HERMES_AUTO_CONTINUE_GLOBAL_LOCK_FILE="$HERMES_AUTO_CONTINUE_STATE_DIR/${HERMES_AUTO_CONTINUE_PROJECT_KEY}.writer.lock"
export HERMES_AUTO_CONTINUE_GLOBAL_LEASE_FILE="$HERMES_AUTO_CONTINUE_STATE_DIR/${HERMES_AUTO_CONTINUE_PROJECT_KEY}.writer.json"
export HERMES_AUTO_CONTINUE_GLOBAL_STATE_FILE="$HERMES_AUTO_CONTINUE_STATE_DIR/${HERMES_AUTO_CONTINUE_PROJECT_KEY}.state.json"
export HERMES_AUTO_CONTINUE_GLOBAL_HANDOFF_FILE="$HERMES_AUTO_CONTINUE_STATE_DIR/${HERMES_AUTO_CONTINUE_PROJECT_KEY}.handoff.json"
export HERMES_AUTO_CONTINUE_PLANNING_STATE_FILE="$ROOT/.planning/auto-continue-workflow-state.json"
export HERMES_AUTO_CONTINUE_PRIMARY_ROOT="${HERMES_AUTO_CONTINUE_PRIMARY_ROOT:-/data/ai-coding/tauri-video-batch-downloader}"
export HERMES_AUTO_CONTINUE_ALLOW_INCOMPLETE_ROOT="${HERMES_AUTO_CONTINUE_ALLOW_INCOMPLETE_ROOT:-0}"

hermes_auto_continue_check_execution_surface() {
  local target_root="${1:-$ROOT}"
  local issues=()

  [ -f "$target_root/package.json" ] || issues+=("missing package.json")
  [ -f "$target_root/pnpm-lock.yaml" ] || issues+=("missing pnpm-lock.yaml")
  [ -d "$target_root/src-tauri" ] || issues+=("missing src-tauri/")
  [ -f "$target_root/.planning/STATE.md" ] || issues+=("missing .planning/STATE.md")
  [ -x "$target_root/scripts/graphify-sync.sh" ] || issues+=("missing executable scripts/graphify-sync.sh")

  if [ ${#issues[@]} -eq 0 ]; then
    printf 'ready\n'
    return 0
  fi

  printf 'incomplete: %s\n' "$(IFS='; '; echo "${issues[*]}")"
  return 1
}

hermes_auto_continue_assert_execution_surface() {
  local target_root="${1:-$ROOT}"
  local result
  result="$(hermes_auto_continue_check_execution_surface "$target_root")" || true
  if [ "$result" = "ready" ]; then
    return 0
  fi
  if [ "$HERMES_AUTO_CONTINUE_ALLOW_INCOMPLETE_ROOT" = "1" ]; then
    echo "[auto-continue] WARNING: overriding incomplete execution surface for $target_root ($result) because HERMES_AUTO_CONTINUE_ALLOW_INCOMPLETE_ROOT=1" >&2
    return 0
  fi
  echo "[auto-continue] ERROR: refusing to use incomplete execution surface: $target_root ($result)" >&2
  echo "[auto-continue] Hint: run from the main project repo, or explicitly set HERMES_AUTO_CONTINUE_ALLOW_INCOMPLETE_ROOT=1 for temporary experiments." >&2
  return 1
}

hermes_auto_continue_writer_surface_status() {
  local target_root="${1:-$ROOT}"
  local surface_result
  local eligible="no"
  local recommended="no"
  local primary_match="no"

  surface_result="$(hermes_auto_continue_check_execution_surface "$target_root")" || true
  if [ "$surface_result" = "ready" ]; then
    eligible="yes"
  fi
  if [ "$target_root" = "$HERMES_AUTO_CONTINUE_PRIMARY_ROOT" ]; then
    primary_match="yes"
  fi
  if [ "$eligible" = "yes" ] && [ "$primary_match" = "yes" ]; then
    recommended="yes"
  fi

  printf 'root=%s\n' "$target_root"
  printf 'primary_root=%s\n' "$HERMES_AUTO_CONTINUE_PRIMARY_ROOT"
  printf 'execution_surface=%s\n' "$surface_result"
  printf 'writer_eligible=%s\n' "$eligible"
  printf 'primary_root_match=%s\n' "$primary_match"
  printf 'writer_recommended=%s\n' "$recommended"
}
