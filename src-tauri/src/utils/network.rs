//! Network utilities and helpers

use anyhow::Result;
use std::time::Duration;

/// Default request timeout
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Get user agent string
pub fn get_user_agent() -> &'static str {
    "VideoDownloaderPro/1.0.0 (Production)"
}

/// Check network connectivity
pub async fn check_connectivity(url: &str) -> Result<bool> {
    match reqwest::Client::new()
        .head(url)
        .timeout(DEFAULT_TIMEOUT)
        .send()
        .await
    {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}
