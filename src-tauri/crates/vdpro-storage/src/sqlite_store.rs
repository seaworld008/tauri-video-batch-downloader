use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use tracing::{info, warn};
use vdpro_core::models::{AppError, AppResult, PersistedManagerState, TaskPriority, VideoTask};

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks (status, updated_at);
CREATE TABLE IF NOT EXISTS queue_items (
    task_id TEXT PRIMARY KEY,
    priority INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manager_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
PRAGMA user_version = 1;
"#;

pub fn resolve_storage_paths(state_path: &Path) -> (PathBuf, Option<PathBuf>) {
    let ext = state_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);

    if matches!(ext.as_deref(), Some("db" | "sqlite" | "sqlite3")) {
        (
            state_path.to_path_buf(),
            Some(state_path.with_file_name("download_state.json")),
        )
    } else {
        (
            state_path.with_extension("db"),
            Some(state_path.to_path_buf()),
        )
    }
}

fn storage_err(context: &str, err: impl std::fmt::Display) -> AppError {
    AppError::System(format!("{}: {}", context, err))
}

#[derive(Clone)]
pub struct SqliteStateStore {
    db_path: PathBuf,
    conn: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for SqliteStateStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqliteStateStore")
            .field("db_path", &self.db_path)
            .finish()
    }
}

impl SqliteStateStore {
    pub fn open_for_state_path(state_path: &Path) -> AppResult<Self> {
        let (db_path, legacy_json_path) = resolve_storage_paths(state_path);
        if let Some(parent) = db_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| storage_err("Failed to create SQLite state directory", e))?;
            }
        }

        let mut conn = Connection::open(&db_path)
            .map_err(|e| storage_err(&format!("Failed to open SQLite state {:?}", db_path), e))?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|e| storage_err("Failed to configure SQLite WAL pragmas", e))?;

        conn.execute_batch(SCHEMA_SQL)
            .map_err(|e| storage_err("Failed to initialize SQLite state schema", e))?;

        if let Some(legacy_path) = legacy_json_path.as_deref() {
            Self::migrate_legacy_json_if_needed(&mut conn, &db_path, legacy_path)?;
        }

        Ok(Self {
            db_path,
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn journal_mode(&self) -> AppResult<String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::System("SQLite state mutex poisoned".to_string()))?;
        conn.query_row("PRAGMA journal_mode;", [], |row| row.get::<_, String>(0))
            .map_err(|e| storage_err("Failed to query SQLite journal_mode", e))
    }

    fn migrate_legacy_json_if_needed(
        conn: &mut Connection,
        db_path: &Path,
        legacy_path: &Path,
    ) -> AppResult<()> {
        if !legacy_path.exists() {
            return Ok(());
        }

        let already_migrated: Option<String> = conn
            .query_row(
                "SELECT value FROM manager_meta WHERE key = 'migrated_from_json_at'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| storage_err("Failed to check migration metadata", e))?;
        if already_migrated.is_some() {
            return Ok(());
        }

        let task_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .map_err(|e| storage_err("Failed to count existing SQLite tasks", e))?;
        let queue_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM queue_items", [], |row| row.get(0))
            .map_err(|e| storage_err("Failed to count existing SQLite queue items", e))?;
        let queue_paused_present: Option<String> = conn
            .query_row(
                "SELECT value FROM manager_meta WHERE key = 'queue_paused'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| storage_err("Failed to inspect existing SQLite meta", e))?;

        if task_count > 0 || queue_count > 0 || queue_paused_present.is_some() {
            return Ok(());
        }

        let content = std::fs::read_to_string(legacy_path).map_err(|e| {
            storage_err(
                &format!("Failed to read persisted state {:?}", legacy_path),
                e,
            )
        })?;
        let state: PersistedManagerState = serde_json::from_str(&content).map_err(|e| {
            let backup_path =
                legacy_path.with_extension(format!("json.corrupt.{}", Utc::now().timestamp()));
            if let Err(backup_err) = std::fs::copy(legacy_path, &backup_path) {
                warn!(
                    "Failed to back up corrupt state file {:?} to {:?}: {}",
                    legacy_path, backup_path, backup_err
                );
            } else {
                warn!(
                    "Backed up corrupt persisted state file {:?} to {:?}",
                    legacy_path, backup_path
                );
            }
            AppError::System(format!(
                "Failed to parse persisted state {:?}: {}",
                legacy_path, e
            ))
        })?;

        let migrated_at = Utc::now().to_rfc3339();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| storage_err("Failed to begin JSON->SQLite migration transaction", e))?;
        Self::write_snapshot_in_tx(&tx, &state)?;
        tx.execute(
            "INSERT INTO manager_meta (key, value) VALUES ('migrated_from_json_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![migrated_at],
        )
        .map_err(|e| storage_err("Failed to record JSON->SQLite migration timestamp", e))?;
        tx.commit()
            .map_err(|e| storage_err("Failed to commit JSON->SQLite migration", e))?;

        let backup_path =
            legacy_path.with_extension(format!("json.migrated.{}.bak", Utc::now().timestamp()));
        if let Err(err) = std::fs::rename(legacy_path, &backup_path) {
            warn!(
                "Migrated {:?} into SQLite {:?}, but could not archive legacy JSON to {:?}: {}",
                legacy_path, db_path, backup_path, err
            );
        } else {
            info!(
                "Migrated legacy JSON state {:?} ({} tasks, {} queue items) into SQLite WAL {:?}",
                legacy_path,
                state.tasks.len(),
                state.queue.len(),
                db_path
            );
        }

        Ok(())
    }

    pub fn load_state_sync(&self) -> AppResult<PersistedManagerState> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::System("SQLite state mutex poisoned".to_string()))?;

        let mut stmt = conn
            .prepare("SELECT payload_json FROM tasks ORDER BY created_at ASC, id ASC")
            .map_err(|e| storage_err("Failed to prepare task load query", e))?;
        let task_rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| storage_err("Failed to query tasks from SQLite", e))?;

        let mut tasks = Vec::new();
        for row in task_rows {
            let json = row.map_err(|e| storage_err("Failed to read task row from SQLite", e))?;
            let task: VideoTask = serde_json::from_str(&json)
                .map_err(|e| storage_err("Failed to deserialize task payload from SQLite", e))?;
            tasks.push(task);
        }

        let mut q_stmt = conn
            .prepare("SELECT task_id, priority, created_at FROM queue_items")
            .map_err(|e| storage_err("Failed to prepare queue load query", e))?;
        let q_rows = q_stmt
            .query_map([], |row| {
                let task_id: String = row.get(0)?;
                let priority: i64 = row.get(1)?;
                let created_at_raw: String = row.get(2)?;
                Ok((task_id, priority, created_at_raw))
            })
            .map_err(|e| storage_err("Failed to query queue items from SQLite", e))?;

        let mut queue = Vec::new();
        for row in q_rows {
            let (task_id, priority, created_at_raw) =
                row.map_err(|e| storage_err("Failed to read queue item row from SQLite", e))?;
            let created_at = DateTime::parse_from_rfc3339(&created_at_raw)
                .map(|dt| dt.with_timezone(&Utc))
                .map_err(|e| storage_err("Failed to parse queue item timestamp", e))?;
            queue.push(TaskPriority {
                task_id,
                priority: priority.clamp(0, u8::MAX as i64) as u8,
                created_at,
            });
        }

        let queue_paused_raw: Option<String> = conn
            .query_row(
                "SELECT value FROM manager_meta WHERE key = 'queue_paused'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| storage_err("Failed to query queue_paused metadata", e))?;
        let queue_paused = matches!(queue_paused_raw.as_deref(), Some("true" | "1"));

        Ok(PersistedManagerState {
            tasks,
            queue,
            queue_paused,
        })
    }

    pub async fn upsert_task(&self, task: VideoTask) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| AppError::System("SQLite state mutex poisoned".to_string()))?;
            let tx = guard
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|e| storage_err("Failed to begin upsert_task transaction", e))?;
            Self::upsert_task_in_tx(&tx, &task)?;
            tx.commit()
                .map_err(|e| storage_err("Failed to commit upsert_task transaction", e))?;
            Ok(())
        })
        .await
        .map_err(|e| storage_err("SQLite upsert_task task panicked", e))?
    }

    pub async fn upsert_tasks_batch(&self, tasks: Vec<VideoTask>) -> AppResult<()> {
        if tasks.is_empty() {
            return Ok(());
        }
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| AppError::System("SQLite state mutex poisoned".to_string()))?;
            let tx = guard
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|e| storage_err("Failed to begin upsert_tasks_batch transaction", e))?;
            for task in &tasks {
                Self::upsert_task_in_tx(&tx, task)?;
            }
            tx.commit()
                .map_err(|e| storage_err("Failed to commit upsert_tasks_batch transaction", e))?;
            Ok(())
        })
        .await
        .map_err(|e| storage_err("SQLite upsert_tasks_batch task panicked", e))?
    }

    pub async fn delete_task(&self, task_id: String) -> AppResult<()> {
        self.delete_tasks_batch(vec![task_id]).await
    }

    pub async fn delete_tasks_batch(&self, task_ids: Vec<String>) -> AppResult<()> {
        if task_ids.is_empty() {
            return Ok(());
        }
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| AppError::System("SQLite state mutex poisoned".to_string()))?;
            let tx = guard
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|e| storage_err("Failed to begin delete_tasks_batch transaction", e))?;
            {
                let mut del_task = tx
                    .prepare("DELETE FROM tasks WHERE id = ?1")
                    .map_err(|e| storage_err("Failed to prepare delete task statement", e))?;
                let mut del_queue = tx
                    .prepare("DELETE FROM queue_items WHERE task_id = ?1")
                    .map_err(|e| storage_err("Failed to prepare delete queue statement", e))?;
                for id in &task_ids {
                    del_task
                        .execute(params![id])
                        .map_err(|e| storage_err("Failed to delete task from SQLite", e))?;
                    del_queue
                        .execute(params![id])
                        .map_err(|e| storage_err("Failed to delete queue item from SQLite", e))?;
                }
            }
            tx.commit()
                .map_err(|e| storage_err("Failed to commit delete_tasks_batch transaction", e))?;
            Ok(())
        })
        .await
        .map_err(|e| storage_err("SQLite delete_tasks_batch task panicked", e))?
    }

    pub async fn replace_queue_and_paused(
        &self,
        queue: Vec<TaskPriority>,
        queue_paused: bool,
    ) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| AppError::System("SQLite state mutex poisoned".to_string()))?;
            let tx = guard
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|e| storage_err("Failed to begin replace_queue transaction", e))?;
            Self::write_queue_and_paused_in_tx(&tx, &queue, queue_paused)?;
            tx.commit()
                .map_err(|e| storage_err("Failed to commit replace_queue transaction", e))?;
            Ok(())
        })
        .await
        .map_err(|e| storage_err("SQLite replace_queue task panicked", e))?
    }

    pub async fn save_snapshot(&self, state: PersistedManagerState) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| AppError::System("SQLite state mutex poisoned".to_string()))?;
            let tx = guard
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|e| storage_err("Failed to begin save_snapshot transaction", e))?;
            Self::write_snapshot_in_tx(&tx, &state)?;
            tx.commit()
                .map_err(|e| storage_err("Failed to commit save_snapshot transaction", e))?;
            Ok(())
        })
        .await
        .map_err(|e| storage_err("SQLite save_snapshot task panicked", e))?
    }

    fn upsert_task_in_tx(tx: &rusqlite::Transaction<'_>, task: &VideoTask) -> AppResult<()> {
        let status = format!("{:?}", task.status);
        let created_at = task.created_at.to_rfc3339();
        let updated_at = task.updated_at.to_rfc3339();
        let payload_json = serde_json::to_string(task)
            .map_err(|e| storage_err("Failed to serialize task payload", e))?;

        let mut stmt = tx
            .prepare(
                "INSERT INTO tasks (id, status, created_at, updated_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                     status = excluded.status,
                     created_at = excluded.created_at,
                     updated_at = excluded.updated_at,
                     payload_json = excluded.payload_json",
            )
            .map_err(|e| storage_err("Failed to prepare task upsert statement", e))?;
        stmt.execute(params![
            &task.id,
            &status,
            &created_at,
            &updated_at,
            &payload_json
        ])
        .map_err(|e| storage_err("Failed to upsert task in SQLite", e))?;
        Ok(())
    }

    fn write_queue_and_paused_in_tx(
        tx: &rusqlite::Transaction<'_>,
        queue: &[TaskPriority],
        queue_paused: bool,
    ) -> AppResult<()> {
        tx.execute("DELETE FROM queue_items", [])
            .map_err(|e| storage_err("Failed to clear SQLite queue_items", e))?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO queue_items (task_id, priority, created_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(task_id) DO UPDATE SET
                         priority = excluded.priority,
                         created_at = excluded.created_at",
                )
                .map_err(|e| storage_err("Failed to prepare queue insert statement", e))?;
            for item in queue {
                stmt.execute(params![
                    &item.task_id,
                    i64::from(item.priority),
                    item.created_at.to_rfc3339(),
                ])
                .map_err(|e| storage_err("Failed to insert queue item into SQLite", e))?;
            }
        }
        tx.execute(
            "INSERT INTO manager_meta (key, value) VALUES ('queue_paused', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![if queue_paused { "true" } else { "false" }],
        )
        .map_err(|e| storage_err("Failed to persist queue_paused in SQLite", e))?;
        Ok(())
    }

    fn write_snapshot_in_tx(
        tx: &rusqlite::Transaction<'_>,
        state: &PersistedManagerState,
    ) -> AppResult<()> {
        tx.execute("DELETE FROM tasks", [])
            .map_err(|e| storage_err("Failed to clear SQLite tasks table", e))?;
        for task in &state.tasks {
            Self::upsert_task_in_tx(tx, task)?;
        }
        Self::write_queue_and_paused_in_tx(tx, &state.queue, state.queue_paused)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use vdpro_core::models::TaskStatus;

    fn sample_task(id: &str, status: TaskStatus) -> VideoTask {
        let now = Utc::now();
        VideoTask {
            id: id.to_string(),
            url: format!("https://example.com/{}.mp4", id),
            title: format!("Task {}", id),
            output_path: "./downloads".to_string(),
            resolved_path: None,
            status,
            progress: 0.0,
            file_size: Some(1024),
            downloaded_size: 0,
            speed: 0.0,
            display_speed_bps: 0,
            eta: None,
            error_message: None,
            created_at: now,
            updated_at: now,
            paused_at: None,
            paused_from_active: false,
            downloader_type: None,
            video_info: None,
            external_info: None,
            request_options: None,
        }
    }

    #[tokio::test]
    async fn opens_in_wal_mode_and_persists_incremental_mutations() -> AppResult<()> {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("download_state.db");
        let store = SqliteStateStore::open_for_state_path(&db_path)?;

        assert_eq!(store.journal_mode()?.to_ascii_lowercase(), "wal");

        let t1 = sample_task("t1", TaskStatus::Pending);
        let mut t2 = sample_task("t2", TaskStatus::Downloading);
        t2.downloaded_size = 512;
        store.upsert_tasks_batch(vec![t1.clone(), t2]).await?;

        let mut t1_updated = t1;
        t1_updated.status = TaskStatus::Completed;
        t1_updated.progress = 100.0;
        store.upsert_task(t1_updated).await?;
        store.delete_task("t2".to_string()).await?;
        store
            .replace_queue_and_paused(
                vec![TaskPriority {
                    task_id: "t1".to_string(),
                    priority: 9,
                    created_at: Utc::now(),
                }],
                true,
            )
            .await?;

        drop(store);

        let reopened = SqliteStateStore::open_for_state_path(&db_path)?;
        let loaded = reopened.load_state_sync()?;
        assert!(loaded.queue_paused);
        assert_eq!(loaded.tasks.len(), 1);
        assert_eq!(loaded.tasks[0].id, "t1");
        assert_eq!(loaded.tasks[0].status, TaskStatus::Completed);
        assert_eq!(loaded.queue.len(), 1);
        assert_eq!(loaded.queue[0].priority, 9);
        Ok(())
    }

    #[tokio::test]
    async fn migrates_legacy_json_losslessly_and_archives_source_once() -> AppResult<()> {
        let dir = TempDir::new().unwrap();
        let legacy_json = dir.path().join("download_state.json");
        let state = PersistedManagerState {
            tasks: vec![
                sample_task("legacy-1", TaskStatus::Completed),
                sample_task("legacy-2", TaskStatus::Paused),
            ],
            queue: vec![TaskPriority {
                task_id: "legacy-2".to_string(),
                priority: 7,
                created_at: Utc::now(),
            }],
            queue_paused: true,
        };
        std::fs::write(&legacy_json, serde_json::to_string(&state).unwrap()).unwrap();

        let store = SqliteStateStore::open_for_state_path(&legacy_json)?;
        assert!(store.db_path().ends_with("download_state.db"));
        assert!(!legacy_json.exists());
        assert!(std::fs::read_dir(dir.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".migrated.")
        }));

        let loaded = store.load_state_sync()?;
        assert_eq!(loaded.tasks.len(), 2);
        assert_eq!(loaded.queue.len(), 1);
        assert!(loaded.queue_paused);

        store
            .delete_tasks_batch(vec!["legacy-1".to_string()])
            .await?;
        drop(store);

        // Re-opening must not overwrite or re-import even if another empty state file is checked
        let reopened = SqliteStateStore::open_for_state_path(&legacy_json)?;
        let loaded_after = reopened.load_state_sync()?;
        assert_eq!(loaded_after.tasks.len(), 1);
        assert_eq!(loaded_after.tasks[0].id, "legacy-2");
        Ok(())
    }

    #[test]
    fn backs_up_corrupt_legacy_json_before_returning_error() {
        let dir = TempDir::new().unwrap();
        let legacy_json = dir.path().join("download_state.json");
        std::fs::write(&legacy_json, "{not-valid-json").unwrap();

        let err = SqliteStateStore::open_for_state_path(&legacy_json).expect_err("corrupt json");
        assert!(err.to_string().contains("Failed to parse persisted state"));
        assert!(std::fs::read_dir(dir.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".corrupt.")
        }));
    }

    #[tokio::test]
    async fn handles_thousand_task_batch_and_point_mutations() -> AppResult<()> {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("scale_state.db");
        let store = SqliteStateStore::open_for_state_path(&db_path)?;

        let tasks: Vec<VideoTask> = (0..1000)
            .map(|idx| sample_task(&format!("task-{idx:04}"), TaskStatus::Pending))
            .collect();
        store.upsert_tasks_batch(tasks).await?;

        let mut modified = sample_task("task-0500", TaskStatus::Completed);
        modified.progress = 100.0;
        store.upsert_task(modified).await?;
        store
            .delete_tasks_batch(
                (0..5)
                    .map(|idx| format!("task-{idx:04}"))
                    .collect::<Vec<_>>(),
            )
            .await?;

        let loaded = store.load_state_sync()?;
        assert_eq!(loaded.tasks.len(), 995);
        let updated = loaded
            .tasks
            .iter()
            .find(|t| t.id == "task-0500")
            .expect("task-0500 present");
        assert_eq!(updated.status, TaskStatus::Completed);
        assert!((updated.progress - 100.0).abs() < f64::EPSILON);
        Ok(())
    }
}
