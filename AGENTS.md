# [AGENTS.md](AGENTS.md)

Shared instructions for all AI agents (Claude, Codex, Antigravity, Gemini, etc.).

- You are an AI assistant working on the **Video Downloader Pro** project.

- Use Chinese unless another language is explicitly requested by the user, as the primary audience/comments are predominantly in Chinese.

- Follow the working agreement:

  - Run `git status -sb` at session start when managing Git workflows.

  - Read relevant files before editing. Do not overwrite blindly.

  - Keep diffs focused; avoid drive-by refactors unless asked.

  - Do not commit unless explicitly requested.

  - Keep code files under ~300 lines. Proactively split UI components or complex Rust modules logic if they grow too large.

  - Do not destructure Zustand stores in React components; always use selectors or shallow mapping to prevent unnecessary re-renders.

  - Prefer `useDownloadStore.getState()` inside callbacks and async handlers (e.g. Tauri event listeners) rather than closing over reactive hooks.

  - Keep features local; avoid cross-feature imports unless truly shared. Co-locate tests.

  - **Research before building**: For new features (e.g., adding aria2 support, specific M3U8 decryptors), search for industry best practices, established conventions, and documented APIs (Tauri v2 docs, Rust ecosystem, shadcn/ui). Don't invent when a well-tested pattern exists.

  - **Edge cases are not optional**: Brainstorm as many edge cases as possible for downloading — network failures, HTTP 429 Rate Limits, permissions denied to the download folder, corrupted local `.part` files, empty video titles, concurrent queue overflows. Provide fallback UI and retry states.

  - **Test-first is mandatory** for new core behavior (especially in Rust `manager.rs`, `resume_downloader.rs`):
    - Write a failing test (RED), implement minimally (GREEN), refactor (REFACTOR).
    - Ensure robust unit coverage for state machine transitions (Downloading -> Paused -> Completed).

  - No pure dev server for IPC; you must ask the user to test interactive desktop flows, or run `npm run tauri dev` automatically if appropriate.

  - For E2E tests, utilize **Tauri MCP** tools (via `@hypothesi/tauri-mcp-server` configured in `.cursor/mcp.json`). **Never use Chrome DevTools MCP**, since this is exclusively a Tauri app.

- Tech stack reference:

  - Framework: **Tauri v2** (Rust Backend, Plugin Architecture)
  - UI: **React 19**, **Vite v7**, **Tailwind CSS v4**, **shadcn/ui v4**
  - State: **Zustand v5**
  - Testing: **Vitest v4** (Frontend), `cargo test` (Backend)
  - Package Manager: **pnpm**

- Tauri bridge patterns (v2):

  - Rust -> Webview: standard `window.emit()` or `app_handle.emit()` using typed payloads (like `DownloadEvent::TaskProgress`), received by frontend `@tauri-apps/plugin-event` or similar `listen("event-name")`.
  - Webview -> Rust: `@tauri-apps/plugin-core` `invoke()`. Always sync frontend types (e.g., `TaskStatus`) with backend Rust enums.

- Writing style:

  - **Em-dash spacing**: Always use spaces around em-dashes: `word — word` not `word—word` (applicable for English or Chinese Markdown).

- Styling rules:

  - **Tokens first**: Emulate shadcn/ui v4 behavior; use CSS variables (`--background`, `--primary`, `--accent`) over hardcoded hex values.

  - **Selection states**: Apply appropriate focus-visible rings using Tailwind's `focus-visible:ring-*`.

  - **Focus indicators**: Ensure keyboard navigation is accessible, especially for pause/resume queue buttons or dialog interactions.

  - **Dark theme**: The app heavily prefers modern dark modes. Use `.dark` standard from Tailwind v4.

  - **Border radius**: Standardize on `rounded-md` (6px) or `rounded-lg` (8px) for major panels and dialogs as dictated by shadcn defaults.

- Cross-platform policy:

  - **Windows and macOS are equal priorities.** All command spawns must accommodate Windows `.cmd` or `.exe` logic alongside macOS/Linux shell environments.
  - When utilizing external binaries (like `yt-dlp` or `ffmpeg`), ensure sidecar configurations in `tauri.conf.json` perfectly match target triples for multiple platforms.

- Key architectural patterns:

  - **Concurrency Manager**: `manager.rs` holds the active Tokio semaphores and download tracking lock (`active_downloads`). You MUST avoid asynchronous deadlocks. Never `await` inside a synchronous `RwLock` guard without using Tokio's async RwLock properly or decoupling locks.
  - **Graceful Pausing**: When intercepting a cancel or pause signal, the backend `resume_downloader.rs` MUST synchronously `flush()` and `sync_all()` local `.part` buffers to the file system before exiting the task.
  - **Frontend State Delay**: The React UI should never destructively mutate `status: "paused"` on an explicit user action. Trigger `invoke()`, then rely on backend state synchronization (via `refreshTasks` or streaming Events) to determine truth, preventing sudden progress bar resets.
  - **Adding a Tauri plugin (v2)**: 
    1. Add to `Cargo.toml`.
    2. Register `builder.plugin(...)` in `src-tauri/src/lib.rs`.
    3. Update `src-tauri/capabilities/default.json` for whitelist permissions.
