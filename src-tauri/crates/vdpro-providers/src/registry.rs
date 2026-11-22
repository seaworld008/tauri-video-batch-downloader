use std::sync::Arc;

use crate::platform::{detect_platform, is_direct_media_url};
use vdpro_core::models::{DownloaderType, SourcePlatform};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitialProviderDecision {
    M3u8,
    Dash,
    YtDlp,
    NeedsHead,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedProviderDecision {
    HttpSimple,
    HttpResumable,
    M3u8,
    Dash,
    YtDlp,
}

#[derive(Debug, Clone)]
pub struct ContentMetadata {
    pub content_length: Option<u64>,
    pub content_type: Option<String>,
}

/// Pluggable provider matcher specification evaluated by `ProviderRegistry`.
pub trait DownloadProviderSpec: Send + Sync {
    fn id(&self) -> &'static str;
    fn downloader_type(&self) -> DownloaderType;
    fn priority(&self) -> u16;
    fn matches_before_head(&self, url: &str) -> bool;
    fn matches_after_head(&self, url: &str, metadata: &ContentMetadata) -> bool;
}

/// Priority-ordered registry of `DownloadProviderSpec` implementations.
#[derive(Clone, Default)]
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn DownloadProviderSpec>>,
}

impl std::fmt::Debug for ProviderRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let ids: Vec<&'static str> = self.providers.iter().map(|spec| spec.id()).collect();
        f.debug_struct("ProviderRegistry")
            .field("providers", &ids)
            .finish()
    }
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: Vec::new(),
        }
    }

    pub fn register(&mut self, spec: Arc<dyn DownloadProviderSpec>) {
        self.providers.push(spec);
        self.providers
            .sort_by_key(|spec| std::cmp::Reverse(spec.priority()));
    }

    pub fn default_registry(large_file_threshold_bytes: u64) -> Self {
        let mut registry = Self::new();
        registry.register(Arc::new(HlsProviderSpec));
        registry.register(Arc::new(DashProviderSpec));
        registry.register(Arc::new(YtDlpProviderSpec));
        registry.register(Arc::new(HttpResumableProviderSpec {
            large_file_threshold_bytes,
        }));
        registry.register(Arc::new(HttpSimpleProviderSpec));
        registry
    }

    pub fn providers(&self) -> &[Arc<dyn DownloadProviderSpec>] {
        &self.providers
    }

    pub fn resolve_before_head(&self, url: &str) -> Option<Arc<dyn DownloadProviderSpec>> {
        self.providers
            .iter()
            .find(|spec| spec.matches_before_head(url))
            .cloned()
    }

    pub fn resolve_after_head(
        &self,
        url: &str,
        metadata: &ContentMetadata,
    ) -> Arc<dyn DownloadProviderSpec> {
        self.providers
            .iter()
            .find(|spec| spec.matches_after_head(url, metadata))
            .cloned()
            .unwrap_or_else(|| Arc::new(HttpSimpleProviderSpec))
    }
}

pub struct HlsProviderSpec;

impl DownloadProviderSpec for HlsProviderSpec {
    fn id(&self) -> &'static str {
        "hls"
    }

    fn downloader_type(&self) -> DownloaderType {
        DownloaderType::M3u8
    }

    fn priority(&self) -> u16 {
        100
    }

    fn matches_before_head(&self, url: &str) -> bool {
        is_m3u8_url(url)
    }

    fn matches_after_head(&self, url: &str, metadata: &ContentMetadata) -> bool {
        is_m3u8_url(url) || is_hls_content_type(metadata.content_type.as_deref())
    }
}

pub struct DashProviderSpec;

impl DownloadProviderSpec for DashProviderSpec {
    fn id(&self) -> &'static str {
        "dash"
    }

    fn downloader_type(&self) -> DownloaderType {
        DownloaderType::Dash
    }

    fn priority(&self) -> u16 {
        95
    }

    fn matches_before_head(&self, url: &str) -> bool {
        is_dash_url(url)
    }

    fn matches_after_head(&self, url: &str, metadata: &ContentMetadata) -> bool {
        is_dash_url(url) || is_dash_content_type(metadata.content_type.as_deref())
    }
}

pub struct YtDlpProviderSpec;

impl DownloadProviderSpec for YtDlpProviderSpec {
    fn id(&self) -> &'static str {
        "ytdlp"
    }

    fn downloader_type(&self) -> DownloaderType {
        DownloaderType::YtDlp
    }

    fn priority(&self) -> u16 {
        80
    }

    fn matches_before_head(&self, url: &str) -> bool {
        is_known_external_video_url(url)
    }

    fn matches_after_head(&self, url: &str, metadata: &ContentMetadata) -> bool {
        should_use_ytdlp_after_head(url, metadata.content_type.as_deref())
    }
}

pub struct HttpResumableProviderSpec {
    pub large_file_threshold_bytes: u64,
}

impl DownloadProviderSpec for HttpResumableProviderSpec {
    fn id(&self) -> &'static str {
        "http-resumable"
    }

    fn downloader_type(&self) -> DownloaderType {
        DownloaderType::Http
    }

    fn priority(&self) -> u16 {
        50
    }

    fn matches_before_head(&self, _url: &str) -> bool {
        false
    }

    fn matches_after_head(&self, _url: &str, metadata: &ContentMetadata) -> bool {
        metadata
            .content_length
            .is_some_and(|size| size >= self.large_file_threshold_bytes)
    }
}

pub struct HttpSimpleProviderSpec;

impl DownloadProviderSpec for HttpSimpleProviderSpec {
    fn id(&self) -> &'static str {
        "http-simple"
    }

    fn downloader_type(&self) -> DownloaderType {
        DownloaderType::Http
    }

    fn priority(&self) -> u16 {
        10
    }

    fn matches_before_head(&self, _url: &str) -> bool {
        false
    }

    fn matches_after_head(&self, _url: &str, _metadata: &ContentMetadata) -> bool {
        true
    }
}

#[derive(Debug, Clone)]
pub struct DownloadProviderRouter {
    registry: ProviderRegistry,
}

impl DownloadProviderRouter {
    pub fn new(large_file_threshold_bytes: u64) -> Self {
        Self::with_registry(ProviderRegistry::default_registry(
            large_file_threshold_bytes,
        ))
    }

    pub fn with_registry(registry: ProviderRegistry) -> Self {
        Self { registry }
    }

    pub fn registry(&self) -> &ProviderRegistry {
        &self.registry
    }

    pub fn initial_decision(&self, url: &str) -> InitialProviderDecision {
        match self
            .registry
            .resolve_before_head(url)
            .map(|spec| spec.downloader_type())
        {
            Some(DownloaderType::M3u8) => InitialProviderDecision::M3u8,
            Some(DownloaderType::Dash) => InitialProviderDecision::Dash,
            Some(DownloaderType::YtDlp) => InitialProviderDecision::YtDlp,
            Some(DownloaderType::Http) | None => InitialProviderDecision::NeedsHead,
        }
    }

    pub fn after_head(&self, url: &str, metadata: &ContentMetadata) -> ResolvedProviderDecision {
        let matched = self.registry.resolve_after_head(url, metadata);
        match (matched.id(), matched.downloader_type()) {
            ("hls", _) | (_, DownloaderType::M3u8) => ResolvedProviderDecision::M3u8,
            ("dash", _) | (_, DownloaderType::Dash) => ResolvedProviderDecision::Dash,
            ("ytdlp", _) | (_, DownloaderType::YtDlp) => ResolvedProviderDecision::YtDlp,
            ("http-resumable", _) => ResolvedProviderDecision::HttpResumable,
            _ => ResolvedProviderDecision::HttpSimple,
        }
    }
}

pub fn is_m3u8_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    url.contains(".m3u8")
        || lower.contains("m3u8")
        || (lower.contains("playlist") && lower.contains("hls"))
        || (lower.contains("master") && lower.contains("m3u8"))
}

pub fn is_dash_url(url: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(url) {
        let path = parsed.path().to_lowercase();
        if path.ends_with(".mpd") || path.ends_with("/manifest.mpd") {
            return true;
        }
        if let Some(query) = parsed.query() {
            let query_lower = query.to_lowercase();
            if query_lower.contains("format=mpd") || query_lower.contains(".mpd") {
                return true;
            }
        }
        return false;
    }

    let lower = url.to_lowercase();
    lower.contains(".mpd") || lower.contains("format=mpd")
}

pub fn is_hls_content_type(content_type: Option<&str>) -> bool {
    content_type
        .map(|ct| {
            let normalized = ct.to_lowercase();
            normalized.contains("application/vnd.apple.mpegurl")
                || normalized.contains("application/x-mpegurl")
                || normalized.contains("audio/mpegurl")
                || normalized.contains("audio/x-mpegurl")
        })
        .unwrap_or(false)
}

pub fn is_dash_content_type(content_type: Option<&str>) -> bool {
    content_type
        .map(|ct| {
            let normalized = ct.to_lowercase();
            normalized.contains("application/dash+xml")
                || normalized.contains("video/vnd.mpeg.dash.mpd")
        })
        .unwrap_or(false)
}

pub fn is_known_external_video_url(url: &str) -> bool {
    !matches!(detect_platform(url), SourcePlatform::Generic)
}

pub fn should_use_ytdlp_after_head(url: &str, content_type: Option<&str>) -> bool {
    if is_known_external_video_url(url) {
        return true;
    }
    if is_direct_media_url(url) || is_m3u8_url(url) || is_dash_url(url) {
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
    !is_m3u8_url(url)
        && !is_dash_url(url)
        && (is_known_external_video_url(url) || !is_direct_media_url(url))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CustomPrioritySpec;

    impl DownloadProviderSpec for CustomPrioritySpec {
        fn id(&self) -> &'static str {
            "custom-high-priority"
        }

        fn downloader_type(&self) -> DownloaderType {
            DownloaderType::Dash
        }

        fn priority(&self) -> u16 {
            250
        }

        fn matches_before_head(&self, url: &str) -> bool {
            url.contains("custom-stream")
        }

        fn matches_after_head(&self, url: &str, _metadata: &ContentMetadata) -> bool {
            url.contains("custom-stream")
        }
    }

    #[test]
    fn routes_m3u8_and_dash_before_head() {
        let router = DownloadProviderRouter::new(50 * 1024 * 1024);

        assert_eq!(
            router.initial_decision("https://cdn.example.com/master.m3u8"),
            InitialProviderDecision::M3u8
        );
        assert_eq!(
            router.initial_decision("https://cdn.example.com/live/manifest.mpd?token=abc"),
            InitialProviderDecision::Dash
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
            router.initial_decision("https://www.bilibili.com/video/BV1xx411c7mD"),
            InitialProviderDecision::YtDlp
        );
        assert_eq!(
            router.initial_decision("https://youtube.com.evil.example/watch?v=abc"),
            InitialProviderDecision::NeedsHead
        );
    }

    #[test]
    fn routes_content_type_for_hls_dash_and_html_after_head() {
        let router = DownloadProviderRouter::new(50 * 1024 * 1024);

        assert_eq!(
            router.after_head(
                "https://cdn.example.com/stream/playlist",
                &ContentMetadata {
                    content_length: None,
                    content_type: Some("application/vnd.apple.mpegurl".into()),
                },
            ),
            ResolvedProviderDecision::M3u8
        );
        assert_eq!(
            router.after_head(
                "https://cdn.example.com/stream/manifest",
                &ContentMetadata {
                    content_length: None,
                    content_type: Some("application/dash+xml; charset=utf-8".into()),
                },
            ),
            ResolvedProviderDecision::Dash
        );
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
            ResolvedProviderDecision::HttpSimple
        );
    }

    #[test]
    fn provider_registry_orders_by_descending_priority() {
        let mut registry = ProviderRegistry::default_registry(1024);
        registry.register(Arc::new(CustomPrioritySpec));

        let ids: Vec<&str> = registry.providers().iter().map(|s| s.id()).collect();
        assert_eq!(ids[0], "custom-high-priority");

        let router = DownloadProviderRouter::with_registry(registry);
        assert_eq!(
            router.initial_decision("https://cdn.example.com/custom-stream/playlist.m3u8"),
            InitialProviderDecision::Dash
        );
    }

    #[test]
    fn info_probe_keeps_m3u8_dash_and_direct_media_on_native_path() {
        assert!(!should_probe_with_ytdlp_for_info(
            "https://cdn.example.com/master.m3u8"
        ));
        assert!(!should_probe_with_ytdlp_for_info(
            "https://cdn.example.com/manifest.mpd"
        ));
        assert!(!should_probe_with_ytdlp_for_info(
            "https://cdn.example.com/video.mp4"
        ));
        assert!(should_probe_with_ytdlp_for_info(
            "https://example.com/watch/abc"
        ));
    }
}
