pub mod capability_service;
pub mod http_provider;
pub mod m3u8_provider;
pub mod youtube_provider;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTaskSpec {
    pub task_id: String,
}

#[async_trait]
pub trait DownloaderProvider: Send + Sync {
    async fn start(&self, task: DownloadTaskSpec) -> Result<(), String>;
    async fn pause(&self, task_id: &str) -> Result<(), String>;
    async fn resume(&self, task_id: &str) -> Result<(), String>;
    async fn cancel(&self, task_id: &str) -> Result<(), String>;
}
