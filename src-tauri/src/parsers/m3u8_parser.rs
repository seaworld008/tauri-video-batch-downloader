//! M3U8 playlist parsing utilities

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct M3u8Segment {
    pub url: String,
    pub duration: Option<f64>,
    pub sequence: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct M3u8Playlist {
    pub segments: Vec<M3u8Segment>,
    pub is_live: bool,
    pub target_duration: Option<f64>,
}

/// Parse M3U8 playlist content
pub fn parse_m3u8_content(content: &str, base_url: Option<&str>) -> Result<M3u8Playlist> {
    let lines: Vec<&str> = content.lines().collect();
    let mut segments = Vec::new();
    let mut is_live = false;
    let mut target_duration = None;
    let mut current_duration = None;
    let mut sequence_counter = 0u64;

    for line in lines {
        let line = line.trim();

        if let Some(stripped) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            if let Ok(duration) = stripped.parse::<f64>() {
                target_duration = Some(duration);
            }
        } else if line.starts_with("#EXTINF:") {
            if let Some(duration_str) = line.strip_prefix("#EXTINF:") {
                if let Some(comma_pos) = duration_str.find(',') {
                    if let Ok(duration) = duration_str[..comma_pos].parse::<f64>() {
                        current_duration = Some(duration);
                    }
                }
            }
        } else if let Some(playlist_type) = line.strip_prefix("#EXT-X-PLAYLIST-TYPE:") {
            is_live = playlist_type != "VOD";
        } else if !line.starts_with('#') && !line.is_empty() {
            // This is a segment URL
            let segment_url = if let Some(base) = base_url {
                resolve_url(base, line)?
            } else {
                line.to_string()
            };

            segments.push(M3u8Segment {
                url: segment_url,
                duration: current_duration.take(),
                sequence: Some(sequence_counter),
            });

            sequence_counter += 1;
        }
    }

    Ok(M3u8Playlist {
        segments,
        is_live,
        target_duration,
    })
}

fn resolve_url(base: &str, relative: &str) -> Result<String> {
    let base_url = Url::parse(base).map_err(|e| anyhow!("Invalid base URL: {}", e))?;

    let resolved = base_url
        .join(relative)
        .map_err(|e| anyhow!("Failed to resolve URL: {}", e))?;

    Ok(resolved.to_string())
}
