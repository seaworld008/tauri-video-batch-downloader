# Download Engine Rearchitecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Re-architect the download pipeline so transfer, commit, lifecycle state, and frontend rendering are semantically correct and large-file completion latency is significantly reduced.

**Architecture:** Keep `DownloadManager` as the state machine owner, but split transport, storage commit, and progress semantics cleanly. Replace chunk-temp-file merge with direct writes into a single `.part` file, introduce a formal `committing` lifecycle stage, and make frontend rendering consume backend truth only.

**Tech Stack:** Rust, Tokio, Tauri v2, React 19, Zustand v5, Vitest v4, cargo test

---

### Task 1: Freeze the target state model in tests

**Files:**
- Modify: `src-tauri/src/core/models.rs`
- Modify: `src-tauri/src/core/manager.rs`
- Modify: `src-tauri/src/core/integration_tests.rs`
- Modify: `src/features/downloads/state/__tests__/eventReducers.test.ts`

**Step 1:** Add failing Rust tests for lifecycle rules.

Cover:
- `downloading` cannot reach `100%`
- `committing` can exist as a non-terminal state
- only `completed` can expose `100%`
- `committing` clears transfer speed and ETA

**Step 2:** Add failing frontend reducer tests for the same semantics.

Cover:
- `status_changed -> committing`
- transfer metrics clear in `committing`
- task row remains active but no longer shows transfer speed

**Step 3:** Run focused tests and verify they fail for the intended reason.

Run:
- `cargo test downloading_task_never_reaches_100_before_completion_event`
- `cargo test task_committing_*`
- `pnpm vitest run src/features/downloads/state/__tests__/eventReducers.test.ts`

### Task 2: Rename and formalize the lifecycle stage

**Files:**
- Modify: `src-tauri/src/core/models.rs`
- Modify: `src-tauri/src/core/manager.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/types/index.ts`
- Modify: `src/schemas/index.ts`
- Modify: `src/stores/downloadStore.ts`
- Modify: `src/utils/format.ts`
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`

**Step 1:** Replace the temporary `finalizing` naming with the formal state `committing`.

**Step 2:** Ensure status conversion tables and event bridge mappings include `Committing`.

**Step 3:** Ensure formatters and i18n map `committing` to user-facing copy.

Recommended copy:
- zh: `提交中` or `写入中`
- en: `Committing`

**Step 4:** Re-run focused type-check and serialization tests.

Run:
- `pnpm exec tsc --noEmit`
- `cargo test --no-run`

### Task 3: Introduce an explicit `.part` storage abstraction

**Files:**
- Create: `src-tauri/src/core/part_file.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/core/resume_downloader.rs`

**Step 1:** Add a `PartFileWriter` abstraction that owns:
- `.part` file path resolution
- file creation/opening
- optional preallocation
- positioned writes
- sync/commit/rename

**Step 2:** Keep platform-specific offset writing inside this module only.

The rest of the downloader should not know whether Windows/macOS use different APIs.

**Step 3:** Add unit tests for:
- preallocation
- offset write at multiple ranges
- overwrite/retry behavior
- commit rename behavior

### Task 4: Replace chunk temp file storage with direct offset writes

**Files:**
- Modify: `src-tauri/src/core/resume_downloader.rs`
- Modify: `src-tauri/src/core/resume_downloader_integration_tests.rs`

**Step 1:** Change chunk download execution to write directly into one `.part` file.

Remove dependence on:
- `*.chunk.N` temp files
- whole-file merge after all chunks complete

**Step 2:** Update resume metadata so chunks track logical completion only, not their own temp-file paths.

Suggested metadata fields:
- `schema_version`
- `part_file_path`
- `chunks[index].downloaded`
- `chunks[index].status`
- `downloaded_total`

**Step 3:** Preserve crash recovery and pause safety.

Before pause/cancel return:
- flush the active `.part` handle
- sync required data for recovery safety
- persist metadata

**Step 4:** Add integration tests for:
- interrupted large-file download resume
- all chunks completed without merge
- final file exists after commit
- no chunk temp files created in new schema path

### Task 5: Split transfer completion from file commit completion

**Files:**
- Modify: `src-tauri/src/core/downloader.rs`
- Modify: `src-tauri/src/core/manager.rs`
- Modify: `src-tauri/src/core/progress_tracker.rs`

**Step 1:** Ensure transfer code emits a lifecycle hint when transport has ended and commit begins.

**Step 2:** Ensure `committing`:
- does not report transfer speed
- does not report ETA
- does not emit `100%`

**Step 3:** Ensure only the successful commit path emits `TaskCompleted`.

**Step 4:** Add tests for:
- transport completed -> `committing`
- commit success -> `completed`
- commit failure -> `failed`

### Task 6: Version the event contract for lifecycle-safe rendering

**Files:**
- Modify: `src/features/downloads/model/contracts.ts`
- Modify: `src/features/downloads/model/__tests__/contracts.test.ts`
- Modify: `src/stores/downloadStore.ts`
- Modify: `src/features/downloads/state/eventReducers.ts`

**Step 1:** Extend the versioned event contract to support:
- `task.status_changed: Committing`
- optional `task.commit_progressed`

**Step 2:** Keep raw and display transport speed separate.

**Step 3:** Ensure frontend reducer logic does not infer lifecycle from numeric progress.

**Step 4:** Remove near-100 special-case dispatch logic that only exists to mask wrong semantics.

### Task 7: Refactor UI components to render lifecycle, not heuristics

**Files:**
- Modify: `src/components/Downloads/TaskItem.tsx`
- Modify: `src/components/Downloads/VideoTableItem.tsx`
- Modify: `src/components/Optimized/VirtualizedTaskList.tsx`
- Modify: `src/components/Downloads/TaskList.tsx`
- Modify: `src/components/Downloads/DashboardToolbar.tsx`
- Modify: `src/components/Downloads/OptimizedDownloadsView.tsx`
- Modify: `src/components/Unified/StatusBar.tsx`

**Step 1:** For `downloading`, show:
- progress
- transfer speed
- ETA

**Step 2:** For `committing`, show:
- status badge
- optional commit substage text
- no transfer speed
- no transfer ETA

**Step 3:** Count `committing` tasks as active work in high-level summaries, but exclude them from aggregate transfer speed.

**Step 4:** Add view tests for `committing` rendering behavior.

### Task 8: Add observability for tail latency

**Files:**
- Modify: `src-tauri/src/core/monitoring.rs`
- Modify: `src-tauri/src/core/manager.rs`
- Modify: `src-tauri/src/core/progress_tracker.rs`

**Step 1:** Record per-task timestamps for:
- transfer started
- transfer completed
- commit started
- commit completed

**Step 2:** Add derived metrics:
- transfer duration
- commit duration
- total end-to-end duration
- number of commit failures

**Step 3:** Emit warnings when commit duration crosses thresholds.

Suggested thresholds:
- warning at `> 2s`
- elevated warning at `> 5s`

### Task 9: Add resume metadata migration

**Files:**
- Modify: `src-tauri/src/core/resume_downloader.rs`
- Add tests in: `src-tauri/src/core/resume_downloader_integration_tests.rs`

**Step 1:** Add metadata schema versioning.

**Step 2:** Support reading legacy chunk-temp-file metadata.

**Step 3:** On successful load of a legacy task:
- translate to new in-memory model
- persist back in the new schema

**Step 4:** Add migration tests for:
- legacy metadata only
- legacy metadata plus chunk files
- corrupted legacy metadata

### Task 10: Verify the system end-to-end

**Files:**
- Modify tests as needed

**Step 1:** Run focused Rust tests.

Run at minimum:
- `cargo test downloading_task_never_reaches_100_before_completion_event`
- `cargo test committing`
- `cargo test resume_downloader`
- `cargo test manager`

**Step 2:** Run focused frontend tests.

Run:
- `pnpm vitest run src/features/downloads/state/__tests__/eventReducers.test.ts`
- `pnpm vitest run src/stores/__tests__/downloadStore.test.ts`
- `pnpm vitest run src/utils/__tests__/format.test.ts`

**Step 3:** Run static verification.

Run:
- `pnpm exec tsc --noEmit`
- `cargo test --no-run`

**Step 4:** Build a production package and do manual verification in Tauri.

Manual checks:
- large HTTP file
- resumed large HTTP file
- near-complete file
- pause during transfer
- restart and recover
- commit stage visible but short

### Task 11: Optional follow-up optimization after the core redesign

**Files:**
- Modify only if needed after measurements

**Step 1:** Decide whether M3U8 should reuse the new `.part` writer abstraction or keep its own path.

**Step 2:** If commit latency is still too high, investigate:
- `sync_data` vs `sync_all`
- commit batching
- staged metadata persistence

**Step 3:** Document final architectural conventions in code comments and developer docs.

## Implementation Notes

- Keep `DownloadManager` as the lifecycle owner.
- Keep `ProgressTracker` speed-only.
- Do not let the frontend infer lifecycle from percentages.
- Prefer introducing a new module boundary rather than adding more flags to existing structs.
- Keep new Rust files under the project’s size guideline by extracting storage concerns into focused modules.

## Acceptance Criteria

1. No task in `downloading` or `committing` ever renders `100%`.
2. Large-file segmented downloads no longer require whole-file merge after transfer completion.
3. `committing` is visible only when real commit work is in progress.
4. Commit stage duration is materially shorter for large files than the current baseline.
5. Frontend does not need near-100 heuristic patches.
6. Resume and crash recovery continue to work.

## Suggested Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9
10. Task 10
11. Task 11

Plan complete and saved to `docs/plans/2026-04-13-download-engine-rearchitecture-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
