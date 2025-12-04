# Download Runtime Rearchitecture Plan

## 1. Context & Current Symptoms

- The desktop UI shows every task stuck at `0% / 0 B/s`, and pause buttons have no effect even though `start_download` is invoked (see screenshot plus `start_download` implementation in `src-tauri/src/core/manager.rs:574`).
- Backend flow today:
  1. UI invokes a Tauri command (e.g. `start_all_pending_downloads`).
  2. `DownloadManager::start_download` clones task state, tries to `try_acquire_owned` a semaphore permit, then spawns an ad‑hoc `tokio::spawn` per task.
  3. Each spawned future wires a one‑off `mpsc` channel between `HttpDownloader::download` and a progress forwarding task (`manager.rs:1573-1762`).
  4. Progress events are bridged to the renderer via only **two** event types in `src-tauri/src/main.rs:221-309` (`download_progress` + `task_status_changed`).
- Frontend store listens to those events (`src/stores/downloadStore.ts:1730-1792`) and revalidates every payload with Zod before mutating Zustand state.

This design mixes scheduling, execution, progress aggregation, and UI translation inside a single struct and relies on many per-task channels. Under load (hundreds of tasks) this produces lock contention (multiple `RwLock<HashMap<...>>` writes and `Semaphore::try_acquire` spins) and makes it hard to guarantee that pause/cancel signals beat the scheduler’s auto-fill loop (`fill_concurrency_slots` at `manager.rs:729`). It also explains the “0% forever” symptom: if the progress forwarding future stalls or is dropped before any `tx.send` occurs, the UI never sees non-zero updates even though the worker is busy.

## 2. Design Goals

1. **Deterministic task lifecycle** – every task is in exactly one of `{Pending, Scheduled, Running, Pausing, Paused, Completing, Failed}` with auditable transitions.
2. **Single orchestration loop** – no more ad-hoc spawns; all work flows through a command + event pipeline to make backpressure visible.
3. **First-class pause/resume** – pausing should quiesce the worker, persist resume metadata, and keep the slot reserved until either resumed or cancelled.
4. **Observable progress** – UI receives monotonic `download_progress` (raw) plus enriched `download_metrics` events at a predictable cadence.
5. **Extensibility** – HTTP, M3U8, YouTube, or future protocols must plug into the same runtime.

## 3. Proposed Architecture

```
┌─────────────┐   Commands   ┌────────────────┐   Work Units   ┌────────────────┐
│  Tauri CMD  │────────────►│ Command Router │───────────────►│ Scheduler Core │
└─────────────┘             └────────────────┘                └──────┬─────────┘
      ▲                               ▲                                  │
      │                               │                                  │assigned TaskHandles
      │ UI Events                     │ metrics                           ▼
┌─────┴─────┐                   ┌─────┴─────┐                   ┌────────────────┐
│ UI Bridge │◄──────────────────│ Event Bus │◄──────────────────│ Worker Pool    │
└───────────┘    download_*     └───────────┘    progress/diag  │ (TransferEng.) │
                                                                └────────────────┘
                      ┌──────────────────────────────────────────────────┐
                      │  Task Repository (SQLite + in-mem caches)        │
                      └──────────────────────────────────────────────────┘
```

Key points:

- **Command Router** – a bounded `mpsc::Sender<DownloadCommand>` that serializes mutations (start, pause, cancel, config changes) and ensures idempotency.
- **Scheduler Core** – owns the concurrency semaphore, picks the next runnable task based on priority + fairness, and hands out `TaskHandle`s to the worker pool.
- **Worker Pool** – limited set of long-lived async tasks that execute transfers via the `TransferEngine` trait. Workers report incremental progress through a `watch::Sender` and accept `CancellationToken`s for pause/resume.
- **Event Bus** – `tokio::sync::broadcast` with typed payloads (`TaskStatusEvent`, `ProgressSnapshot`, `RuntimeMetrics`, …) to decouple downstream consumers (UI bridge, monitoring, CLI).
- **Task Repository** – persists metadata, resume offsets, integrity hashes, and aggregates stats so that restarts do not drop progress.

## 4. Components in Detail

### 4.1 Task Repository & Persistence

- Replace the ad-hoc `HashMap<String, VideoTask>` (`manager.rs:252`) with a `TaskStore` that wraps SQLite via `sqlx`:
  - Tables: `tasks`, `task_chunks` (for resume info), `events` (append-only for audit).
  - In-memory cache (`DashMap` or `ArcSwap<Vec<TaskSummary>>`) for fast reads.
- Repository exposes methods:
  - `fn insert_tasks(&self, tasks: &[NewTask]) -> Result<Vec<TaskId>>`
  - `async fn update_status(&self, id, status, reason?)`
  - `async fn persist_progress(&self, id, bytes_downloaded, total_bytes, speed_sample)`
- Benefits: crash-safe resume, ability to rebuild UI state from disk without calling Tauri commands repeatedly.

### 4.2 Command Plane

- Define `enum DownloadCommand` (start, start_all, pause, resume, cancel, remove, apply_config, ingest_metrics).
- Provide one async task (`command_loop`) that owns the `Scheduler` instance and processes commands sequentially. This eliminates data races between `start_download`, `pause_download`, and the fill loop.
- Each public Tauri command simply enqueues a `DownloadCommand` and awaits a oneshot response, instead of making direct `DownloadManager` calls at `src-tauri/src/commands/download.rs:64-234`.

### 4.3 Scheduler & Concurrency Management

- Scheduler maintains three priority queues:
  1. **Interactive** (user-initiated start/pause/resume),
  2. **Automatic** (auto-fill backlog),
  3. **Retry** (exponential backoff, fed by RetryExecutor).
- When a worker slot is free, scheduler chooses the highest priority task, transitions it to `Scheduled`, and hands it to the worker pool along with a `CancellationToken`.
- Instead of `try_acquire_owned()` (which drops requests when limit reached), use `semaphore.acquire().await` inside scheduler—callers never see “Maximum concurrent downloads reached” because backpressure exists inside the command loop.

### 4.4 Worker Pool & Transfer Engine

- Introduce `TransferEngine` trait implemented by HTTP/M3U8/YouTube downloaders. Each implementation accepts a `ProgressSink` callback and a `CancellationToken`.
- Workers run in a bounded pool (e.g. `FuturesUnordered<TaskFuture>`). Each worker:
  1. Opens / resumes destination file (range requests, verifying partial size).
  2. Streams bytes via `reqwest` or protocol-specific connectors.
  3. Emits `ProgressFrame { downloaded, total, instantaneous_speed, smoothed_speed }` at 200 ms cadence using a lightweight `watch::Sender`.
  4. Honors pause by awaiting `token.cancelled()` and persisting final byte offset before returning control to scheduler.
- For per-chunk resume data, reuse the existing `ResumeDownloader` but expose a clean API rather than cloning entire `HttpDownloader` (`downloader.rs:315`).

### 4.5 Progress & Metrics Pipeline

- Replace the per-task `mpsc` channel (`manager.rs:1601`) with shared instrumentation:
  - Each worker owns a `watch::Sender<ProgressSnapshot>`.
  - Scheduler registers these senders with a `ProgressHub` (a `DashMap<TaskId, watch::Receiver<_>>`).
  - `ProgressHub` aggregates updates (throttled to ~15 Hz) and publishes `DownloadEvent::ProgressSnapshot` over the broadcast bus.
- UI Bridge now listens to:
  - `download_progress` – raw size/speed updates per task (JSON friendly).
  - `download_metrics` – aggregated stats (total active downloads, throughput, top offenders).
  - `task_status_changed` – unchanged semantics but guaranteed order thanks to command loop sequencing.

### 4.6 Pause & Resume Semantics

- Every task obtains a `TaskHandle { cancellation_token, resume_key }`.
- `pause_download` enqueues a `DownloadCommand::Pause(id)`; command loop:
  1. Marks task status `Pausing`.
  2. Signals token, waits for worker acknowledgement (bounded wait: 5s).
  3. Persists resume offset (resume key + chunk map).
  4. Moves task back to `Paused` queue.
- Resume simply moves it into interactive queue; scheduler ensures we reuse the saved resume metadata.

### 4.7 UI Contract & Event Schema

| Event | Payload | Notes |
|-------|---------|-------|
| `download_progress` | `{ task_id, downloaded, total, instantaneous_speed, smoothed_speed, eta_secs }` | Emitted max 15 Hz per task. |
| `download_metrics` | `{ active, queued, avg_speed, per_protocol }` | Aggregated counters replacing the current `download_stats` poller. |
| `task_status_changed` | `{ task_id, from, to, error? }` | Always emitted after repository commit to keep Zustand store consistent. |
| `runtime_warning` | `{ code, message, task_id? }` | For surfacing retry exhaustion, disk errors, etc. |

Frontend updates:
- Simplify `initializeProgressListener` (`downloadStore.ts:1730`) to consume the richer payload directly; no need to recompute percentages or guess totals.
- Replace the 1.5 s polling loop with a `watchEffect` that only calls `refreshTasks` when `runtime_warning` indicates a drift or when a start/pause command fails.

### 4.8 Observability & Resilience

- Emit span-scoped tracing events for every lifecycle transition (start, chunk downloaded, paused, resumed, cancelled).
- Integrate RetryExecutor stats into the event bus so the UI can show “retrying (2/5)”.
- Provide a `/health` command returning scheduler queue depths, worker utilization, and disk throughput to aid debugging.

## 5. API & Code Changes Overview

| Area | Change |
|------|--------|
| `src-tauri/src/commands/download.rs` | Replace direct `DownloadManager` access with `CommandRouter::send(cmd)` and unify error messages. |
| `src-tauri/src/main.rs` | Wire new broadcast events to the UI, remove bespoke `download_stats` polling, expose `download_runtime_state` command for diagnostics. |
| `src-tauri/src/core/manager.rs` | Shrink to a façade that owns `TaskRepository`, `Scheduler`, `ProgressHub`, and `EventBus`. Legacy helper methods become thin wrappers that enqueue commands. |
| `src-tauri/src/core/downloader.rs` | Factor low-level transfer logic into `TransferEngine`; reuse existing resume + bandwidth code but decouple from global mutexes. |
| Frontend `downloadStore` | Align with the new event payloads, drop redundant revalidation for every event, keep optimistic UI updates tied to command responses. |

## 6. Migration Plan

1. **Instrumentation Sprint**
   - Add `DownloadEvent::RuntimeWarning` and log every time a task stays in `Downloading` for >30 s without progress (helps reproduce current bug before rewriting everything).
   - Surface scheduler state via a temporary `/debug_runtime_dump` command.
2. **Phase 1 – Command Router & Scheduler**
   - Introduce command loop + new queues while still using existing `HttpDownloader` per-task spawns.
   - Ensure pause/resume operations flow through router; remove `auto_fill_enabled` flag hacks.
3. **Phase 2 – Worker Pool & ProgressHub**
   - Replace per-task `mpsc` with `watch::Sender`, implement aggregated events, update UI.
   - Add guardrails: when UI unsubscribes, event stream keeps running (no dropping senders).
4. **Phase 3 – Persistence Upgrade**
   - Back tasks by SQLite; migrate existing JSON/task storage via one-time import.
5. **Phase 4 – Protocol unification**
   - Implement `TransferEngine` trait for HTTP and YouTube downloaders; move M3U8 + resume logic under that umbrella.

Each phase must ship behind a feature flag (`download_runtime_v2`) so we can dogfood gradually.

## 7. Validation Strategy

- **Unit tests**: state machine transitions, scheduler fairness, pause/resume ack deadlines.
- **Integration tests**: start 3 downloads, pause/resume individual/all, verify progress monotonicity (extend `src-tauri/src/core/youtube_downloader_integration_tests.rs` style).
- **Load tests**: synthetic 200-task import, measure event latency and UI responsiveness.
- **User acceptance**: add a developer-only panel in the UI to show runtime metrics and detect regressions quickly.

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Increased complexity of scheduler | Provide thorough docs + diagrams (this doc) and keep APIs small (command + event). |
| SQLite contention on Windows network drives | Use WAL mode + batching writes (persist progress every 1 MB or 3 s, whichever first). |
| UI drift due to new payload shapes | Build TS types directly from Rust schemas (e.g., via `tauri-specta`) to guarantee parity. |

---

This plan elevates download management from a grab-bag of async tasks into a well-defined runtime. By serializing control flow, reusing worker pools, and broadcasting structured metrics, we simultaneously solve the “0% progress” bug, make pause/resume reliable, and create room for future protocol support without rewiring the UI yet again.
