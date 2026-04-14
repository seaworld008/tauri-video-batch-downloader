# Download Directory UX Design

**Date:** 2026-04-13

**Context**

The app currently exposes download directory control in multiple places:
- Settings page edits the global default directory.
- Dashboard toolbar exposes another directory change action.
- Start-download confirmation dialog also changes directory.

This creates unclear ownership and a broken user expectation: changing the directory in the confirmation dialog updates global config, but existing pending tasks already have fixed `output_path` values, so the current batch may still save to the old location.

## Decision

Adopt a two-level model:

1. **Global default download directory**
   - Managed only in Settings.
   - Represents the default root directory used when creating/importing tasks.

2. **Per-start temporary override**
   - Managed only inside the start-download confirmation dialog.
   - Applies only to the tasks being started in that action.
   - Does not modify global Settings.

## UX Rules

### Settings page

- Owns the single editable default directory setting.
- Shows the full current path clearly.
- Uses an explicit “Select directory” action instead of a bare icon-only control.
- Explains that this value is the default for future downloads/imports.

### Dashboard toolbar

- Shows the current default directory for quick awareness.
- May allow opening the folder.
- Must not be another place that edits the global setting.

### Start-download confirmation dialog

- Reframed as “confirm save location”, not “change global setting”.
- Shows:
  - the default directory
  - the effective directory for this start action
  - a sample resolved save path for one selected task
- “Change location” means **this time only**.
- “Start” applies the override to the selected/pending tasks before dispatching the actual start commands.

## Technical Design

### Separation of responsibilities

- `configStore`
  - Stores the global default directory only.

- `DashboardToolbar`
  - Owns transient confirmation-dialog state for one start action:
    - target task ids
    - transient override directory
    - pending start callback

- `downloadStore`
  - Exposes one explicit action to apply a directory override to a task batch before start.

- Backend command layer
  - Adds a dedicated command to update output paths for a set of non-active tasks.
  - Persists the updated tasks before start execution.

### Path rebasing strategy

When applying a temporary directory override:
- Preserve each task’s existing filename / leaf path identity.
- If a task path was rooted under the current default directory, rebase that relative suffix under the new override directory.
- If the current task path is relative, join it under the new override directory.
- If the current task path is absolute but outside the default root, preserve the leaf name under the new override directory.

This keeps the design compatible with future batch-level folders and resolved filenames.

## Why this scales well

- Future “recent folders” support can be added only to the confirmation dialog state.
- Future “per-batch directory” support can reuse the same backend update command.
- Settings remain clean and predictable because they only define defaults.
- We avoid hidden coupling where modal UI changes global config with side effects outside the current action.
