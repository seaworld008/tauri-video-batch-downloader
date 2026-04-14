# Download Directory UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate global default download directory management from per-start temporary overrides, and make the download confirmation flow predictable and user-friendly.

**Architecture:** Settings owns the default directory. The start-download dialog owns a transient override for the current action only. A dedicated backend command updates task output paths before start so the UI and actual save location stay consistent.

**Tech Stack:** React, Zustand, Tauri commands, Rust backend manager, Vitest

---

### Task 1: Add pure frontend path-rebasing helpers

**Files:**
- Create: `src/features/downloads/model/outputPathOverride.ts`
- Create: `src/features/downloads/model/__tests__/outputPathOverride.test.ts`

**Step 1:** Add pure helper functions for rebasing task output paths and generating a display preview.

**Step 2:** Add tests for:
- relative path rebasing
- absolute path under default root
- absolute path outside default root
- empty path fallback

### Task 2: Add backend batch output-path update command

**Files:**
- Modify: `src-tauri/src/core/manager.rs`
- Modify: `src-tauri/src/commands/download.rs`
- Modify: `src-tauri/src/commands/mod.rs`

**Step 1:** Add manager methods to update output paths for non-active tasks while preserving filename identity.

**Step 2:** Add a new Tauri command for batch updating task output paths.

**Step 3:** Persist updated manager state after path mutation.

**Step 4:** Add manager-level tests for the rebasing/update behavior.

### Task 3: Add store action for per-start output override

**Files:**
- Modify: `src/stores/downloadStore.ts`
- Modify: `src/stores/__tests__/downloadStore.test.ts`

**Step 1:** Add a store action that invokes the backend batch update command and refreshes tasks.

**Step 2:** Add store test coverage for the new action.

### Task 4: Refactor toolbar confirmation dialog UX

**Files:**
- Modify: `src/components/Downloads/DashboardToolbar.tsx`

**Step 1:** Remove toolbar-level global directory editing.

**Step 2:** Replace current confirmation dialog state with:
- target task ids
- transient override directory
- sample preview path

**Step 3:** Make “Change location” update only the transient override.

**Step 4:** Before executing start, apply override to the target tasks if the transient directory differs from Settings.

### Task 5: Clarify Settings page ownership of default directory

**Files:**
- Modify: `src/components/Settings/SettingsView.tsx`

**Step 1:** Convert the default directory field into a clearer settings card row.

**Step 2:** Show full path text clearly and add a labeled action button.

**Step 3:** Add helper copy explaining this is the default for future downloads/imports.

### Task 6: Verify the end-to-end behavior

**Files:**
- Modify as needed: related tests

**Step 1:** Run focused frontend tests.

**Step 2:** Run focused Rust tests.

**Step 3:** Run frontend type-check / lint relevant to touched files.

**Step 4:** Summarize resulting UX behavior and note future extension points.
