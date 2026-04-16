use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::core::manager::DownloadManager;

pub fn spawn_queue_scheduler(manager: Arc<RwLock<DownloadManager>>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            interval.tick().await;
            // Avoid blocking other command handlers when scheduler tick collides with
            // long-running write operations. If lock is busy, skip this tick.
            let mut guard = match manager.try_write() {
                Ok(guard) => guard,
                Err(_) => continue,
            };

            if !guard.scheduler_tick().await {
                break;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::DownloadConfig;

    #[tokio::test]
    async fn scheduler_tick_returns_false_when_manager_not_running() {
        let mut manager = DownloadManager::new(DownloadConfig::default()).expect("manager");
        let should_continue = manager.scheduler_tick().await;
        assert!(!should_continue);
    }

    #[tokio::test]
    async fn scheduler_tick_returns_true_when_manager_running() {
        let mut manager = DownloadManager::new(DownloadConfig::default()).expect("manager");
        manager.start().await.expect("start manager");
        let should_continue = manager.scheduler_tick().await;
        assert!(should_continue);
    }
}
