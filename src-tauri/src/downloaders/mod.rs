//! Download engines and implementations
//!
//! Contains specialized downloaders for different protocols and sources.

pub mod http_downloader;
pub mod m3u8_downloader_impl;
pub mod youtube_downloader_impl;

// Re-export downloaders
pub use http_downloader::*;
pub use m3u8_downloader_impl::*;
pub use youtube_downloader_impl::*;
