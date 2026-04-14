# Download Engine Rearchitecture Design

**Date:** 2026-04-13

**Status:** Proposed

**Scope:** Backend download pipeline, task lifecycle state model, event contract, frontend download status presentation, observability, and migration strategy.

## Context

The current downloader stack is functionally rich but architecturally inconsistent:

- `DownloadManager` owns task lifecycle and stats, but several lower-level modules also imply lifecycle meaning.
- `HttpDownloader`, `ResumeDownloader`, and `M3U8Downloader` use different completion semantics.
- Frontend views historically inferred meaning from progress percentages instead of authoritative lifecycle state.
- Large-file segmented downloads write chunk temp files and then merge them into the final file, which creates avoidable end-of-download I/O and long “tail latency”.

These issues surfaced as a production-facing symptom:

- Tasks could show `100%` while still being logically incomplete.
- Speed values kept refreshing near completion even though transfer was effectively done.
- UI needed ad hoc rules to hide incorrect lifecycle transitions.

This design proposes a first-principles rearchitecture of the download core so the system becomes semantically correct, faster at completion, easier to reason about, and safer to evolve.

## Goals

1. Make task lifecycle state authoritative and semantically correct.
2. Eliminate the “Downloading + 100% but not completed” ambiguity.
3. Reduce large-file completion tail latency by removing whole-file merge work where possible.
4. Separate transport progress from file-commit progress.
5. Ensure frontend renders backend truth, not guessed state.
6. Preserve cross-platform support for Windows and macOS.
7. Make failures, retries, pause/resume, and recovery behavior observable and testable.

## Non-Goals

1. Rewriting the entire product shell, import UX, or settings system.
2. Replacing Tauri, Zustand, or the runtime command router.
3. Introducing external download binaries or a new storage engine.
4. Optimizing every unrelated module in the repo during this refactor.

## Requirements And Constraints

### Functional requirements

- Support existing task sources: direct HTTP, large-file resumable downloads, and M3U8/HLS.
- Preserve pause, resume, cancel, retry, and batch operations.
- Support persistence and restart recovery.
- Keep backend -> frontend progress streaming.

### Quality requirements

- The UI must never show `100%` before the task is truly completed.
- Finalization should be visible as a real lifecycle stage if it is not instantaneous.
- Disk write work after transfer completion should be minimized.
- State transitions must be test-first and deterministic.

### Constraints

- Tauri v2 backend commands and event bridge remain the integration surface.
- Windows and macOS parity matters.
- Current code already contains substantial logic in:
  - `src-tauri/src/core/manager.rs`
  - `src-tauri/src/core/downloader.rs`
  - `src-tauri/src/core/resume_downloader.rs`
  - `src-tauri/src/core/m3u8_downloader.rs`
  - `src/stores/downloadStore.ts`

## Root Cause Analysis

The current design has three foundational problems:

### 1. Lifecycle semantics are mixed with transport progress

The system implicitly treated “all bytes transferred” as almost equivalent to “task completed”, even though real completion also requires:

- flushing file buffers,
- syncing file contents,
- final commit/rename,
- persistence of task state,
- emission and application of completion lifecycle events.

This is a design flaw, not a presentation bug.

### 2. Segmented download storage is structurally expensive

`ResumeDownloader` currently:

1. downloads each segment to its own temp file,
2. stores resume metadata per chunk,
3. merges all chunks into the final file after transfer completes.

That means the final file is effectively written twice:

- once across all chunk temp files,
- once again during merge.

For large files this turns the completion phase into a disk-bound operation and is the primary reason “tail latency” is user-visible.

### 3. Responsibilities are not separated cleanly

- `ProgressTracker` computes speed smoothing but ends up influencing UI-visible semantics.
- `DownloadManager` owns lifecycle but currently depends on downstream stats events to reflect meaningful final states.
- Frontend reducers and views historically compensated for backend ambiguity.

The result is a fragile system that invites ad hoc patches.

## Design Principles

1. **Lifecycle first** — progress percentages never define lifecycle state.
2. **Single source of truth** — backend state machine defines task truth; frontend only renders it.
3. **Transport and commit are separate phases** — byte transfer completion is not file completion.
4. **No synthetic UI heuristics** — no frontend guessing based on `progress >= 100`.
5. **Optimize the expensive path** — remove whole-file merge work rather than masking its symptoms.
6. **Cross-platform by design** — platform-specific file I/O lives behind a narrow storage abstraction.
7. **Recoverability matters** — resume and crash recovery must remain first-class.

## Proposed Target Architecture

### Overview

The target system is organized into five clear layers:

1. `DownloadManager`
2. `TransferEngine`
3. `StorageCommitter`
4. `ProgressTracker`
5. `Frontend State Adapter`

### 1. DownloadManager

**Responsibility**

- Owns task records and lifecycle state machine.
- Owns queueing, concurrency bookkeeping, and aggregated stats.
- Emits domain events to the runtime bridge.

**Must not do**

- Raw segmented write coordination.
- Storage layout details for `.part` or chunk files.
- UI formatting decisions.

### 2. TransferEngine

This is a conceptual boundary; implementation may remain split across multiple files initially.

**Responsibility**

- Perform network transfer for a specific protocol:
  - HTTP single stream
  - resumable ranged HTTP
  - M3U8 segment fetching
- Report byte-level transfer progress.
- Respect pause, cancel, retry, and bandwidth limits.

**Output**

- Transport progress updates only.
- A completion signal meaning: “all intended bytes have been fetched”.

### 3. StorageCommitter

This is the key new architectural focus.

**Responsibility**

- Own the on-disk representation of in-progress downloads.
- Support preallocation and direct offset writes into a single `.part` file.
- Finalize the file by syncing and atomically renaming into place.
- Persist resume metadata in a format aligned with the new storage model.

**Target behavior**

- For ranged downloads, chunks write directly into offsets of one `.part` file.
- The final commit does not require whole-file merge.
- Commit phase becomes:
  - verify expected size / completion map,
  - `sync_data`,
  - atomic rename,
  - cleanup metadata.

### 4. ProgressTracker

**Responsibility**

- Compute smoothed transport speed.
- Compute ETA during active transfer.
- Aggregate transport stats for monitoring.

**Must not do**

- Infer lifecycle transitions.
- Keep transport speed visible during commit/finalization.

### 5. Frontend State Adapter

This includes event contracts, store reducers, and list/status views.

**Responsibility**

- Parse backend event payloads.
- Maintain client-side copies of backend task snapshots.
- Render lifecycle and display metrics exactly as received.

**Must not do**

- Infer completion from `progress`.
- Recompute total download speed from local rows when backend already provides it.

## Task State Model

### Current state problem

Current task statuses are:

- `pending`
- `downloading`
- `paused`
- `completed`
- `failed`
- `cancelled`

This is insufficient because it conflates active transfer and post-transfer commit work.

### Proposed state model

- `pending`
- `downloading`
- `committing`
- `paused`
- `completed`
- `failed`
- `cancelled`

### Why `committing`

`committing` is preferable to `finalizing` because it describes what the system is actually doing:

- writing final buffered state,
- syncing file contents,
- committing `.part` into final artifact,
- finalizing resume metadata.

It is also clearer for logs and metrics.

### Allowed transitions

- `pending -> downloading`
- `downloading -> paused`
- `downloading -> failed`
- `downloading -> cancelled`
- `downloading -> committing`
- `committing -> completed`
- `committing -> failed`
- `paused -> downloading`
- `failed -> pending` or `failed -> downloading`

### Transition rules

- `downloading` must never expose `progress = 100%`.
- `committing` must not expose transfer speed.
- Only `completed` may expose `progress = 100%`.
- Pause is allowed only during transfer, not during commit, unless a deliberate commit-interruption policy is designed later.

## Storage Model Redesign

### Current model

- Per-task chunk temp files: `task.chunk.N`
- Post-transfer merge into final file
- Resume info stores chunk-level progress

### Target model

- One `.part` file per task
- Resume metadata tracks:
  - target path
  - total size
  - chunk map / byte ranges
  - completed chunks
  - protocol metadata
  - schema version

### Write strategy

1. Create/open `.part`.
2. If total size is known, preallocate file length.
3. For each chunk, write directly to `[offset_start, offset_end]`.
4. Persist chunk completion markers incrementally.
5. When all chunks complete:
   - enter `committing`,
   - `sync_data`,
   - rename `.part` -> final path,
   - clean metadata,
   - emit `completed`.

### Platform strategy

We should hide random-access writing behind a small storage adapter:

- Windows: use platform-appropriate positioned writes
- Unix/macOS: use platform-appropriate offset writes

The high-level downloader should depend only on a `PartFileWriter` abstraction.

## Event And Interface Design

### Backend events

Keep versioned event envelopes, but expand lifecycle vocabulary:

- `task.progressed`
- `task.status_changed`
- `task.commit_progressed`
- `task.stats_updated`

### Task progress payload

Transport progress payload should include:

- `task_id`
- `downloaded_size`
- `total_size`
- `raw_speed_bps`
- `display_speed_bps`
- `eta_seconds`
- `progress_ratio`

### Commit progress payload

Commit progress payload should include:

- `task_id`
- `stage`
  - `syncing`
  - `renaming`
  - `cleaning`
- `progress_ratio` (optional)
- `detail` (optional diagnostic string)

### Task status payload

Task status changes should be authoritative and low-frequency:

- `Pending`
- `Downloading`
- `Committing`
- `Paused`
- `Completed`
- `Failed`
- `Cancelled`

### Frontend rendering contract

- Row cards render transfer metrics only in `downloading`.
- In `committing`, render stage text and optional commit progress.
- Status bar counts `downloading + committing` as active work, but only `downloading` contributes transfer speed.

## Module Boundary Changes

### `resume_downloader.rs`

Refactor from:

- chunk temp file manager + merge orchestrator

to:

- chunk scheduler + direct offset writer over a shared `.part` abstraction.

This file should own:

- chunk planning,
- offset write orchestration,
- resume metadata updates,
- commit readiness checks.

It should not own:

- user-facing lifecycle naming,
- global task stats,
- UI-tailored progress interpretation.

### `downloader.rs`

Refactor toward:

- protocol router,
- transfer-stage progress producer,
- commit entry-point trigger.

It should stop embedding completion semantics into final transport progress.

### `manager.rs`

Should remain the state machine owner.

It should:

- consume transfer events,
- transition to `committing`,
- transition to `completed`,
- compute global stats from lifecycle-aware task snapshots.

### `downloadStore.ts`

Should become thinner over time:

- no progress-derived lifecycle guesses,
- no special-case near-100 behavior,
- no local total-speed synthesis,
- only reducer logic that applies backend truth.

## Risks And Trade-Offs

### 1. Migration complexity

Moving from chunk temp files to a single `.part` file requires resume metadata migration.

Mitigation:

- introduce metadata schema version,
- support read-compatibility for old entries,
- write only new schema after migration.

### 2. Random-access write correctness

Concurrent writes into one file are more sensitive than isolated chunk files.

Mitigation:

- hide file writing behind a tested abstraction,
- add focused tests for overlapping ranges, resumed ranges, and crash recovery,
- verify on Windows and macOS.

### 3. Commit interruption semantics

If commit work is interruptible, the state machine becomes more complex.

Recommendation:

- phase 1 disallows pause during commit,
- cancel during commit becomes best-effort cleanup only if safe.

### 4. M3U8 parity

M3U8 may not immediately share the same storage path as ranged HTTP.

Recommendation:

- align lifecycle first,
- unify storage later only if it reduces complexity rather than forcing a brittle abstraction.

## Edge Cases

1. Unknown total size during transfer
2. Resume metadata exists but `.part` file is missing
3. `.part` exists but size is smaller/larger than expected
4. Rename fails because target file is locked on Windows
5. Disk full during commit
6. Crash during commit
7. Pause signal arrives after transport completion but before commit begins
8. Legacy chunk temp files remain after migration
9. M3U8 segment download completes but mux/merge stage fails
10. File already exists and matches expected size

## Recommended Implementation Path

### Phase 1 — Download core correctness and tail-latency reduction

- Introduce `committing` lifecycle state.
- Replace ranged-download chunk temp files with direct writes into a single `.part` file.
- Remove final merge step from large-file HTTP resume path.
- Add lifecycle-aware backend events.
- Update frontend store and task views to render `committing`.

### Phase 2 — Protocol alignment and UX consistency

- Align M3U8 lifecycle with the same transfer/commit model.
- Add commit-stage copy such as “写入磁盘中” / “提交文件中”.
- Unify list, toolbar, and stats presentation.

### Phase 3 — Observability and diagnostics

- Record transfer duration vs commit duration.
- Add metrics for:
  - average commit time
  - 95th percentile commit time
  - failed commit count
  - stale resume metadata count
- Add debug export for task lifecycle traces.

## Why This Is The Best Path

This path addresses the real architecture flaw instead of treating its symptoms:

- It removes an expensive storage pattern rather than hiding its latency.
- It restores semantic correctness to task state.
- It simplifies the frontend instead of making it smarter in the wrong places.
- It keeps the existing product shell and command router, so delivery risk stays manageable.

This is the highest-leverage path because it improves correctness, performance, maintainability, and UX at the same time.
