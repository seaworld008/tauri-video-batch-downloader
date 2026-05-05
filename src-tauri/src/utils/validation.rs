//! URL and input validation utilities

use anyhow::{anyhow, Result};
use url::Url;

use crate::core::models::{AppError, AppResult};

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

/// Assert that the input parses as a URL with an http(s) scheme.
///
/// Used as a hard gate before passing a URL to external subprocesses
/// (yt-dlp, youtube-dl, ffmpeg). Rejects `file://`, `javascript:`,
/// `ftp://`, and any other scheme even if upstream validators were
/// bypassed or removed.
pub fn assert_http_url(url: &str) -> AppResult<()> {
    let parsed = Url::parse(url).map_err(|e| AppError::System(format!("invalid URL: {}", e)))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        other => Err(AppError::System(format!(
            "unsupported URL scheme `{}`: only http/https are allowed",
            other
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assert_http_url_accepts_http_and_https() {
        assert!(assert_http_url("http://example.com/video.mp4").is_ok());
        assert!(assert_http_url("https://youtu.be/dQw4w9WgXcQ").is_ok());
    }

    #[test]
    fn assert_http_url_rejects_dangerous_schemes() {
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "ftp://example.com/x",
            "ssh://attacker/x",
        ] {
            let err = assert_http_url(bad).expect_err(bad);
            assert!(matches!(err, AppError::System(_)), "{}", bad);
        }
    }

    #[test]
    fn assert_http_url_rejects_unparseable_input() {
        assert!(assert_http_url("not a url").is_err());
        assert!(assert_http_url("").is_err());
    }
}
