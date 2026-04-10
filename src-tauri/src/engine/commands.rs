use serde::Serialize;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize)]
pub struct CommandAck {
    pub accepted: bool,
    pub request_id: Option<String>,
    pub action: Option<String>,
    pub reason: Option<String>,
}

impl CommandAck {
    pub fn accepted(action: Option<&str>, request_id: Option<String>) -> Self {
        Self {
            accepted: true,
            request_id,
            action: action.map(ToString::to_string),
            reason: None,
        }
    }

    pub fn rejected(
        reason: impl Into<String>,
        action: Option<&str>,
        request_id: Option<String>,
    ) -> Self {
        Self {
            accepted: false,
            request_id,
            action: action.map(ToString::to_string),
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug)]
pub enum TaskAction {
    Start,
    Pause,
    Resume,
    Cancel,
}

impl TaskAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskAction::Start => "start",
            TaskAction::Pause => "pause",
            TaskAction::Resume => "resume",
            TaskAction::Cancel => "cancel",
        }
    }
}

#[derive(Debug)]
pub enum EngineCommand {
    Ping {
        respond_to: oneshot::Sender<CommandAck>,
    },
    TaskControl {
        action: TaskAction,
        task_id: String,
        request_id: String,
        respond_to: oneshot::Sender<CommandAck>,
    },
}
