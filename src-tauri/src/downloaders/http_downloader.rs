//! Basic HTTP downloader implementation

use anyhow::Result;
use futures_util::StreamExt;
use reqwest::Client;
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

pub struct SimpleHttpDownloader {
    client: Client,
}

impl SimpleHttpDownloader {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn download(&self, url: &str, output_path: &Path) -> Result<u64> {
        let response = self.client.get(url).send().await?;
        let mut file = File::create(output_path).await?;
        let mut stream = response.bytes_stream();
        let mut total_size = 0u64;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            total_size += chunk.len() as u64;
            file.write_all(&chunk).await?;
        }

        file.flush().await?;
        Ok(total_size)
    }
}
