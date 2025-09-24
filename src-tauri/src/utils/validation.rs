//! URL and input validation utilities

use anyhow::{anyhow, Result};
use url::Url;

/// Validate if URL is accessible
pub fn validate_url(url: &str) -> Result<Url> {
    Url::parse(url).map_err(|e| anyhow!("Invalid URL format: {}", e))
}

/// Check if URL is a valid video URL
pub fn is_valid_video_url(url: &str) -> bool {
    if let Ok(parsed) = Url::parse(url) {
        let scheme = parsed.scheme();
        scheme == "http" || scheme == "https"
    } else {
        false
    }
}
