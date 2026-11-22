//! Pluggable provider routing, video platform URL classification, MPEG-DASH
//! MPD parsing, and FFmpeg lossless remuxing/muxing utilities.

pub mod dash_parser;
pub mod ffmpeg_muxer;
pub mod platform;
pub mod registry;

pub use platform::{detect_platform, is_direct_media_url, platform_host_rules, PlatformHostRule};
pub use registry::{
    ContentMetadata, DashProviderSpec, DownloadProviderRouter, DownloadProviderSpec,
    HlsProviderSpec, HttpResumableProviderSpec, HttpSimpleProviderSpec, InitialProviderDecision,
    ProviderRegistry, ResolvedProviderDecision, YtDlpProviderSpec,
};
