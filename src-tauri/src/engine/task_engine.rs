use std::collections::{HashSet, VecDeque};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::{mpsc, oneshot};

use crate::core::runtime::DownloadRuntimeHandle;

use super::commands::{CommandAck, EngineCommand, TaskAction};

#[async_trait]
pub trait TaskRuntimeExecutor: Send + Sync {
    async fn run(&self, action: TaskAction, task_id: String) -> Result<(), String>;
}

#[async_trait]
impl TaskRuntimeExecutor for DownloadRuntimeHandle {
    async fn run(&self, action: TaskAction, task_id: String) -> Result<(), String> {
        let result = match action {
            TaskAction::Start => self.start_task(task_id).await,
            TaskAction::Pause => self.pause_task(task_id).await,
            TaskAction::Resume => self.resume_task(task_id).await,
            TaskAction::Cancel => self.cancel_task(task_id).await,
        };

        result.map_err(|err| err.to_string())
    }
}

#[derive(Clone)]
pub struct TaskEngineHandle {
    sender: mpsc::Sender<EngineCommand>,
}

impl TaskEngineHandle {
    pub fn new(sender: mpsc::Sender<EngineCommand>) -> Self {
        Self { sender }
    }

    async fn send_command(
        &self,
        build: impl FnOnce(oneshot::Sender<CommandAck>) -> EngineCommand,
    ) -> Result<CommandAck, String> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(build(tx))
            .await
            .map_err(|_| "TaskEngine unavailable".to_string())?;
        rx.await
            .map_err(|_| "TaskEngine dropped response".to_string())
    }

    pub async fn ping(&self) -> Result<CommandAck, String> {
        self.send_command(|respond_to| EngineCommand::Ping { respond_to })
            .await
    }

    async fn task_control(
        &self,
        action: TaskAction,
        task_id: String,
        request_id: String,
    ) -> Result<CommandAck, String> {
        self.send_command(|respond_to| EngineCommand::TaskControl {
            action,
            task_id,
            request_id,
            respond_to,
        })
        .await
    }

    pub async fn start_task(
        &self,
        task_id: String,
        request_id: String,
    ) -> Result<CommandAck, String> {
        self.task_control(TaskAction::Start, task_id, request_id)
            .await
    }

    pub async fn pause_task(
        &self,
        task_id: String,
        request_id: String,
    ) -> Result<CommandAck, String> {
        self.task_control(TaskAction::Pause, task_id, request_id)
            .await
    }

    pub async fn resume_task(
        &self,
        task_id: String,
        request_id: String,
    ) -> Result<CommandAck, String> {
        self.task_control(TaskAction::Resume, task_id, request_id)
            .await
    }

    pub async fn cancel_task(
        &self,
        task_id: String,
        request_id: String,
    ) -> Result<CommandAck, String> {
        self.task_control(TaskAction::Cancel, task_id, request_id)
            .await
    }
}

#[derive(Default)]
struct TaskEngineState {
    pending_queue: VecDeque<String>,
    seen_request_ids: HashSet<String>,
}

pub fn spawn_task_engine(runtime: Arc<dyn TaskRuntimeExecutor>) -> TaskEngineHandle {
    let (tx, mut rx) = mpsc::channel::<EngineCommand>(256);

    tauri::async_runtime::spawn(async move {
        let mut state = TaskEngineState::default();

        while let Some(command) = rx.recv().await {
            match command {
                EngineCommand::Ping { respond_to } => {
                    let _ = respond_to.send(CommandAck::accepted(Some("ping"), None));
                }
                EngineCommand::TaskControl {
                    action,
                    task_id,
                    request_id,
                    respond_to,
                } => {
                    if !state.seen_request_ids.insert(request_id.clone()) {
                        let _ = respond_to.send(CommandAck::rejected(
                            format!("Duplicate request_id: {}", request_id),
                            Some(action.as_str()),
                            Some(request_id),
                        ));
                        continue;
                    }

                    state.pending_queue.push_back(task_id.clone());
                    let action_name = action.as_str();
                    match runtime.run(action, task_id).await {
                        Ok(_) => {
                            let _ = state.pending_queue.pop_front();
                            let _ = respond_to
                                .send(CommandAck::accepted(Some(action_name), Some(request_id)));
                        }
                        Err(err) => {
                            let _ = state.pending_queue.pop_front();
                            let _ = respond_to.send(CommandAck::rejected(
                                err,
                                Some(action_name),
                                Some(request_id),
                            ));
                        }
                    }
                }
            }
        }
    });

    TaskEngineHandle::new(tx)
}

#[cfg(test)]
mod tests {
    use super::super::commands::TaskAction;
    use super::*;
    use tokio::sync::Mutex;
    use uuid::Uuid;

    struct MockRuntime;

    #[async_trait]
    impl TaskRuntimeExecutor for MockRuntime {
        async fn run(&self, _action: TaskAction, _task_id: String) -> Result<(), String> {
            Ok(())
        }
    }

    struct MockRuntimeFailFirst {
        failed_once: Mutex<bool>,
    }

    #[async_trait]
    impl TaskRuntimeExecutor for MockRuntimeFailFirst {
        async fn run(&self, _action: TaskAction, _task_id: String) -> Result<(), String> {
            let mut failed_once = self.failed_once.lock().await;
            if !*failed_once {
                *failed_once = true;
                return Err("Injected runtime failure".to_string());
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn accepts_first_start_request() {
        let engine = spawn_task_engine(Arc::new(MockRuntime));
        let request_id = Uuid::new_v4().to_string();
        let ack = engine
            .start_task("task-1".to_string(), request_id.clone())
            .await
            .expect("engine response");

        assert!(ack.accepted);
        assert_eq!(ack.request_id.as_deref(), Some(request_id.as_str()));
        assert_eq!(ack.action.as_deref(), Some("start"));
    }

    #[tokio::test]
    async fn rejects_duplicate_request_id() {
        let engine = spawn_task_engine(Arc::new(MockRuntime));
        let request_id = Uuid::new_v4().to_string();

        let first = engine
            .start_task("task-1".to_string(), request_id.clone())
            .await
            .expect("first response");
        let second = engine
            .start_task("task-1".to_string(), request_id)
            .await
            .expect("second response");

        assert!(first.accepted);
        assert!(!second.accepted);
        assert_eq!(second.action.as_deref(), Some("start"));
        assert!(second
            .reason
            .unwrap_or_default()
            .contains("Duplicate request_id"));
    }

    #[tokio::test]
    async fn runtime_failure_does_not_block_next_request() {
        let engine = spawn_task_engine(Arc::new(MockRuntimeFailFirst {
            failed_once: Mutex::new(false),
        }));

        let first = engine
            .start_task("task-1".to_string(), Uuid::new_v4().to_string())
            .await
            .expect("first response");
        let second = engine
            .start_task("task-1".to_string(), Uuid::new_v4().to_string())
            .await
            .expect("second response");

        assert!(!first.accepted);
        assert!(first
            .reason
            .unwrap_or_default()
            .contains("Injected runtime failure"));
        assert!(second.accepted);
    }
}
