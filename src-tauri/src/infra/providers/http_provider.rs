use async_trait::async_trait;

use crate::core::runtime::DownloadRuntimeHandle;

use super::{DownloadTaskSpec, DownloaderProvider};

#[derive(Clone)]
pub struct HttpDownloadProvider {
    runtime: DownloadRuntimeHandle,
}

impl HttpDownloadProvider {
    pub fn new(runtime: DownloadRuntimeHandle) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl DownloaderProvider for HttpDownloadProvider {
    async fn start(&self, task: DownloadTaskSpec) -> Result<(), String> {
        self.runtime
            .start_task(task.task_id)
            .await
            .map_err(|err| err.to_string())
    }

    async fn pause(&self, task_id: &str) -> Result<(), String> {
        self.runtime
            .pause_task(task_id.to_string())
            .await
            .map_err(|err| err.to_string())
    }

    async fn resume(&self, task_id: &str) -> Result<(), String> {
        self.runtime
            .resume_task(task_id.to_string())
            .await
            .map_err(|err| err.to_string())
    }

    async fn cancel(&self, task_id: &str) -> Result<(), String> {
        self.runtime
            .cancel_task(task_id.to_string())
            .await
            .map_err(|err| err.to_string())
    }
}
