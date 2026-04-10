use async_trait::async_trait;

use super::{DownloadTaskSpec, DownloaderProvider};

#[derive(Clone, Default)]
pub struct M3u8DownloadProvider;

#[async_trait]
impl DownloaderProvider for M3u8DownloadProvider {
    async fn start(&self, _task: DownloadTaskSpec) -> Result<(), String> {
        Err("M3U8 provider is not wired yet".to_string())
    }

    async fn pause(&self, _task_id: &str) -> Result<(), String> {
        Err("M3U8 provider is not wired yet".to_string())
    }

    async fn resume(&self, _task_id: &str) -> Result<(), String> {
        Err("M3U8 provider is not wired yet".to_string())
    }

    async fn cancel(&self, _task_id: &str) -> Result<(), String> {
        Err("M3U8 provider is not wired yet".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn returns_not_wired_error() {
        let provider = M3u8DownloadProvider;
        let result = provider
            .start(DownloadTaskSpec {
                task_id: "task-1".to_string(),
            })
            .await;

        assert!(result.is_err());
        assert!(result.err().unwrap_or_default().contains("not wired yet"));
    }
}
