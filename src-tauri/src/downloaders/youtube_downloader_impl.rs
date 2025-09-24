//! YouTube downloader implementation stub

use anyhow::{anyhow, Result};
use std::path::Path;

pub struct SimpleYoutubeDownloader;

impl SimpleYoutubeDownloader {
    pub fn new() -> Self {
        Self
    }

    pub async fn download(&self, _url: &str, _output_path: &Path) -> Result<()> {
        // TODO: Implement YouTube downloading using yt-dlp
        Err(anyhow!("YouTube downloading not yet implemented"))
    }
}
