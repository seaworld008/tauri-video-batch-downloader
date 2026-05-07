use crate::core::models::SourcePlatform;
use crate::core::ytdlp_support::{detect_platform, is_direct_media_url};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitialProviderDecision {
    M3u8,
    YtDlp,
    NeedsHead,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedProviderDecision {
    HttpSimple,
    HttpResumable,
    YtDlp,
}

#[derive(Debug, Clone)]
pub struct ContentMetadata {
    pub content_length: Option<u64>,
    pub content_type: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DownloadProviderRouter {
    large_file_threshold_bytes: u64,
}

impl DownloadProviderRouter {
    pub fn new(large_file_threshold_bytes: u64) -> Self {
        Self {
            large_file_threshold_bytes,
        }
    }

    pub fn initial_decision(&self, url: &str) -> InitialProviderDecision {
        if is_m3u8_url(url) {
            InitialProviderDecision::M3u8
        } else if is_known_external_video_url(url) {
            InitialProviderDecision::YtDlp
        } else {
            InitialProviderDecision::NeedsHead
        }
    }

    pub fn after_head(&self, url: &str, metadata: &ContentMetadata) -> ResolvedProviderDecision {
        if should_use_ytdlp_after_head(url, metadata.content_type.as_deref()) {
            return ResolvedProviderDecision::YtDlp;
        }

        match metadata.content_length {
            Some(size) if size >= self.large_file_threshold_bytes => {
                ResolvedProviderDecision::HttpResumable
            }
            Some(_) => ResolvedProviderDecision::HttpSimple,
            None => ResolvedProviderDecision::HttpResumable,
        }
    }
}

pub fn is_m3u8_url(url: &str) -> bool {
    url.contains(".m3u8")
        || url.to_lowercase().contains("m3u8")
        || url.contains("playlist") && url.contains("hls")
        || url.contains("master") && url.contains("m3u8")
}

pub fn is_known_external_video_url(url: &str) -> bool {
    !matches!(detect_platform(url), SourcePlatform::Generic)
}

pub fn should_use_ytdlp_after_head(url: &str, content_type: Option<&str>) -> bool {
    if is_known_external_video_url(url) {
        return true;
    }
    if is_direct_media_url(url) {
        return false;
    }
    content_type
        .map(|ct| {
            let normalized = ct.to_lowercase();
            normalized.contains("text/html") || normalized.contains("application/xhtml")
        })
        .unwrap_or(false)
}

pub fn should_probe_with_ytdlp_for_info(url: &str) -> bool {
    !is_m3u8_url(url) && (is_known_external_video_url(url) || !is_direct_media_url(url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_m3u8_before_head() {
        let router = DownloadProviderRouter::new(50 * 1024 * 1024);

        assert_eq!(
            router.initial_decision("https://cdn.example.com/master.m3u8"),
            InitialProviderDecision::M3u8
        );
    }

    #[test]
    fn routes_known_social_hosts_to_ytdlp_before_head() {
        let router = DownloadProviderRouter::new(50 * 1024 * 1024);

        assert_eq!(
            router.initial_decision("https://www.youtube.com/watch?v=abc"),
            InitialProviderDecision::YtDlp
        );
        assert_eq!(
            router.initial_decision("https://www.tiktok.com/@user/video/123"),
            InitialProviderDecision::YtDlp
        );
        assert_eq!(
            router.initial_decision("https://youtube.com.evil.example/watch?v=abc"),
            InitialProviderDecision::NeedsHead
        );
    }

    #[test]
    fn routes_html_pages_to_ytdlp_after_head_but_keeps_direct_media_http() {
        let router = DownloadProviderRouter::new(50 * 1024 * 1024);

        assert_eq!(
            router.after_head(
                "https://example.com/watch/abc",
                &ContentMetadata {
                    content_length: None,
                    content_type: Some("text/html; charset=utf-8".into()),
                },
            ),
            ResolvedProviderDecision::YtDlp
        );
        assert_eq!(
            router.after_head(
                "https://cdn.example.com/video.mp4",
                &ContentMetadata {
                    content_length: Some(1024),
                    content_type: Some("text/html".into()),
                },
            ),
            ResolvedProviderDecision::HttpSimple
        );
    }

    #[test]
    fn routes_http_by_size_after_head() {
        let router = DownloadProviderRouter::new(50 * 1024 * 1024);

        assert_eq!(
            router.after_head(
                "https://cdn.example.com/small.bin",
                &ContentMetadata {
                    content_length: Some(1024),
                    content_type: Some("application/octet-stream".into()),
                },
            ),
            ResolvedProviderDecision::HttpSimple
        );
        assert_eq!(
            router.after_head(
                "https://cdn.example.com/large.bin",
                &ContentMetadata {
                    content_length: Some(51 * 1024 * 1024),
                    content_type: Some("application/octet-stream".into()),
                },
            ),
            ResolvedProviderDecision::HttpResumable
        );
        assert_eq!(
            router.after_head(
                "https://cdn.example.com/stream.bin",
                &ContentMetadata {
                    content_length: None,
                    content_type: Some("application/octet-stream".into()),
                },
            ),
            ResolvedProviderDecision::HttpResumable
        );
    }

    #[test]
    fn info_probe_keeps_m3u8_and_direct_media_on_native_path() {
        assert!(!should_probe_with_ytdlp_for_info(
            "https://cdn.example.com/master.m3u8"
        ));
        assert!(!should_probe_with_ytdlp_for_info(
            "https://cdn.example.com/video.mp4"
        ));
        assert!(should_probe_with_ytdlp_for_info(
            "https://example.com/watch/abc"
        ));
    }
}
