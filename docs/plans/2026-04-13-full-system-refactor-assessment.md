# Full System Refactor Assessment

**Date:** 2026-04-13

**Question:** Does the whole product need refactoring, or only specific domains?

## Executive Summary

No — the entire product does **not** need a full rewrite.

The system should be divided into three categories:

1. **Keep as-is with minor cleanup**
2. **Refactor locally**
3. **Systematically redesign**

The correct strategy is **targeted architectural refactoring around the download core**, not a repo-wide rewrite.

## Assessment Criteria

Each area is evaluated against:

- responsibility clarity
- correctness risk
- performance risk
- testability
- coupling
- user-facing pain

## Assessment By Functional Area

### 1. Download core

**Scope**
- `src-tauri/src/core/manager.rs`
- `src-tauri/src/core/downloader.rs`
- `src-tauri/src/core/resume_downloader.rs`
- `src-tauri/src/core/m3u8_downloader.rs`
- `src-tauri/src/core/progress_tracker.rs`
- `src-tauri/src/core/runtime.rs`

**Assessment**
- `manager.rs`: important and worth preserving as the orchestration center, but too much logic is currently concentrated there.
- `downloader.rs`: useful as protocol entry point, but lifecycle and storage concerns are mixed in.
- `resume_downloader.rs`: the most problematic module architecturally; current segmented temp-file + merge model is the main redesign target.
- `m3u8_downloader.rs`: acceptable directionally, but lifecycle semantics should be aligned with the core state machine.
- `progress_tracker.rs`: concept is good, responsibility should stay narrow.
- `runtime.rs`: sound; should be preserved.

**Decision**
- `manager.rs` — refactor locally
- `downloader.rs` — refactor locally
- `resume_downloader.rs` — redesign systematically
- `m3u8_downloader.rs` — local refactor after core redesign
- `progress_tracker.rs` — preserve with cleanup
- `runtime.rs` — preserve

### 2. Command layer

**Scope**
- `src-tauri/src/commands/*.rs`

**Assessment**
- Structure is conventional for Tauri.
- Responsibilities are mostly thin wrappers over backend services.
- Problems here are secondary and mostly inherited from core module semantics.

**Decision**
- Preserve overall structure
- Refactor only to align new lifecycle names and cleaner command contracts

### 3. Config and system integration

**Scope**
- `src-tauri/src/core/config.rs`
- `src-tauri/src/commands/config.rs`
- `src-tauri/src/commands/system.rs`

**Assessment**
- These modules are not the current source of product pain.
- They may need polish, but not architectural replacement.

**Decision**
- Preserve
- Clean up incrementally when adjacent work touches them

### 4. Import pipeline

**Scope**
- `src-tauri/src/commands/import.rs`
- file parser and encoding modules
- frontend import views

**Assessment**
- Import functionality is separate from the problematic download tail-latency issue.
- Some UX and validation cleanup may help, but the architecture is not fundamentally broken.

**Decision**
- Local refactor only
- Do not include in the first architecture rewrite wave

### 5. YouTube workflow

**Scope**
- `src-tauri/src/commands/youtube.rs`
- `src-tauri/src/core/youtube_downloader.rs`

**Assessment**
- Important capability, but currently a side branch rather than the primary architectural bottleneck.
- Main need is lifecycle alignment with the central task state model.

**Decision**
- Preserve overall design
- Refactor later for lifecycle consistency and observability

### 6. Frontend download store

**Scope**
- `src/stores/downloadStore.ts`

**Assessment**
- This is a high-value module but currently too broad.
- It owns too much normalization, fallback behavior, command orchestration, event handling, validation, and sync policy in one file.
- However, the existence of a central store is still correct for this app.

**Decision**
- Preserve the store concept
- Refactor systematically into smaller slices/helpers
- Do not rewrite state management technology

### 7. Frontend download views

**Scope**
- `src/components/Downloads/*`
- `src/components/Optimized/VirtualizedTaskList.tsx`
- `src/components/Unified/StatusBar.tsx`

**Assessment**
- The UI architecture is not fundamentally wrong.
- The main issue is inconsistency and duplicated status rendering logic across components.
- Several components contain lifecycle-specific behavior that should be centralized.

**Decision**
- Local refactor, not full redesign
- Consolidate status presentation and speed/ETA rendering into shared view helpers

### 8. Schemas, types, contracts

**Scope**
- `src/schemas/index.ts`
- `src/types/index.ts`
- `src/features/downloads/model/contracts.ts`

**Assessment**
- These are the right place for shared contracts, but they need stronger ownership boundaries.
- Current duplication between `schemas` and `types` adds friction.

**Decision**
- Refactor systematically
- Move toward one canonical source for task/event contracts

### 9. Tests and observability

**Scope**
- backend integration tests
- frontend reducer/store tests
- monitoring modules

**Assessment**
- The project already has a useful test base.
- The problem is not “lack of tests” but “missing tests around the true lifecycle boundaries”.
- Monitoring exists, which is a strong foundation.

**Decision**
- Preserve and expand
- Focus on adding architecture-aligned tests rather than replacing the whole test approach

## Final Classification Matrix

### Preserve

- Tauri command routing model
- runtime command queue
- global store concept
- monitoring foundation
- import/config/system high-level structure

### Refactor Locally

- `manager.rs`
- `downloader.rs`
- frontend download views
- toolbar/list/status rendering
- import UX cleanup
- YouTube lifecycle consistency

### Redesign Systematically

- `resume_downloader.rs`
- download storage/commit pipeline
- task lifecycle model around transfer vs commit
- contract ownership across backend events and frontend reducers

## Recommended Roadmap

### Wave 1 — Core architecture

- Redesign resumable storage path
- Introduce formal transfer vs commit lifecycle
- Simplify event semantics

### Wave 2 — Frontend alignment

- Split `downloadStore.ts`
- Centralize task-status presentation
- Remove view-specific lifecycle heuristics

### Wave 3 — Secondary domains

- YouTube lifecycle alignment
- import robustness improvements
- observability dashboards for tail-latency and retries

## What Should Not Be Done

1. Do not rewrite the entire product shell.
2. Do not replace Zustand or Tauri just because the download core needs redesign.
3. Do not refactor unrelated import/config modules in the same PR as the download-core rewrite.
4. Do not continue layering patches onto ambiguous lifecycle semantics.

## Final Recommendation

The software as a whole is worth preserving.

The **download engine domain** is the part that needs a real architectural reset.
Most other areas need cleanup and sharper boundaries, but not a rewrite.

The right move is:

- **do not rebuild everything**
- **do redesign the download core properly**
- **do refactor the frontend around the corrected backend semantics**
