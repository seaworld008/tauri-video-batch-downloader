use super::*;

impl DownloadManager {
    pub(super) fn emit_event(&self, event: DownloadEvent) {
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(event);
        }
    }
}
