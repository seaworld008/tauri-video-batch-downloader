use url::Url;
use vdpro_core::models::SourcePlatform;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformHostRule {
    pub platform: SourcePlatform,
    pub hosts: &'static [&'static str],
}

const PLATFORM_HOST_RULES: &[PlatformHostRule] = &[
    PlatformHostRule {
        platform: SourcePlatform::Youtube,
        hosts: &["youtube.com", "youtu.be", "youtube-nocookie.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Bilibili,
        hosts: &["bilibili.com", "b23.tv"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Tiktok,
        hosts: &["tiktok.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Instagram,
        hosts: &["instagram.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Facebook,
        hosts: &["facebook.com", "fb.watch", "fb.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Twitter,
        hosts: &["twitter.com", "x.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Vimeo,
        hosts: &["vimeo.com"],
    },
    PlatformHostRule {
        platform: SourcePlatform::Twitch,
        hosts: &["twitch.tv"],
    },
];

pub fn platform_host_rules() -> &'static [PlatformHostRule] {
    PLATFORM_HOST_RULES
}

pub fn detect_platform(url: &str) -> SourcePlatform {
    let host = Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_lowercase()))
        .unwrap_or_default();

    platform_host_rules()
        .iter()
        .find(|rule| {
            rule.hosts
                .iter()
                .any(|candidate| host_matches(&host, candidate))
        })
        .map(|rule| rule.platform.clone())
        .unwrap_or(SourcePlatform::Generic)
}

fn host_matches(host: &str, candidate: &str) -> bool {
    host == candidate || host.ends_with(&format!(".{candidate}"))
}

pub fn is_direct_media_url(url: &str) -> bool {
    Url::parse(url)
        .ok()
        .map(|parsed| {
            let path = parsed.path().to_lowercase();
            [
                ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".flv", ".wmv", ".mp3", ".m4a",
                ".aac", ".wav", ".ogg",
            ]
            .iter()
            .any(|ext| path.ends_with(ext))
        })
        .unwrap_or(false)
}
