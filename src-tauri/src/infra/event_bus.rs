use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const DOWNLOAD_EVENT_V1: &str = "download_event_v1";
pub const EVENT_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize)]
pub struct EventEnvelope<T: Serialize + Clone> {
    pub schema_version: u16,
    pub event_id: String,
    pub event_type: String,
    pub ts: String,
    pub payload: T,
}

impl<T: Serialize + Clone> EventEnvelope<T> {
    pub fn new(event_type: impl Into<String>, payload: T) -> Self {
        Self {
            schema_version: EVENT_SCHEMA_VERSION,
            event_id: Uuid::new_v4().to_string(),
            event_type: event_type.into(),
            ts: Utc::now().to_rfc3339(),
            payload,
        }
    }
}

pub fn emit_download_event<T: Serialize + Clone>(
    app_handle: &AppHandle,
    event_type: &str,
    payload: &T,
) -> Result<(), tauri::Error> {
    let envelope = EventEnvelope::new(event_type, payload.clone());
    app_handle.emit(DOWNLOAD_EVENT_V1, envelope)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn event_envelope_has_required_fields() {
        let payload = json!({
            "task_id": "task-1",
            "status": "Downloading"
        });

        let envelope = EventEnvelope::new("task.status_changed", payload.clone());

        assert_eq!(envelope.schema_version, EVENT_SCHEMA_VERSION);
        assert_eq!(envelope.event_type, "task.status_changed");
        assert_eq!(envelope.payload, payload);
        assert!(!envelope.event_id.is_empty());
        assert!(!envelope.ts.is_empty());
    }
}
