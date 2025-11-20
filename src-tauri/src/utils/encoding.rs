//! Encoding detection and conversion utilities
//!
//! Provides utilities for character encoding detection and conversion.

use encoding_rs::{Encoding, GBK, UTF_8};

/// Detect video type from URL
pub fn detect_video_type(url: &str) -> &str {
    if url.contains("m3u8") {
        "m3u8"
    } else if url.contains("youtube") || url.contains("youtu.be") {
        "youtube"
    } else {
        "http"
    }
}

/// Basic encoding detection
pub fn detect_encoding(data: &[u8]) -> &'static Encoding {
    // Simple heuristic-based detection
    if data.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return UTF_8;
    }

    // Try to detect Chinese encodings
    if data.iter().any(|&b| b > 127) {
        GBK // Default to GBK for Chinese content
    } else {
        UTF_8
    }
}
