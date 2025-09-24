//! M3U8 downloader implementation stub

use anyhow::{anyhow, Result};
use std::path::Path;

pub struct SimpleM3u8Downloader;

impl SimpleM3u8Downloader {
    pub fn new() -> Self {
        Self
    }

    pub async fn download(&self, _url: &str, _output_path: &Path) -> Result<()> {
        // TODO: Implement M3U8 downloading
        Err(anyhow!("M3U8 downloading not yet implemented"))
    }
}
