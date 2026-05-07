use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalToolSource {
    UserOverride,
    Managed,
    BundledSidecar,
    PathFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalToolStatusKind {
    Available,
    Missing,
    Failed,
    VersionUnsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalToolStatus {
    pub id: String,
    pub display_name: String,
    pub status: ExternalToolStatusKind,
    pub source: Option<ExternalToolSource>,
    pub path: Option<String>,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub can_auto_update: bool,
    pub can_rollback: bool,
    pub last_error: Option<String>,
}

pub(crate) fn validate_tool_id(tool_id: &str) -> Result<()> {
    if matches!(tool_id, "yt-dlp" | "ffmpeg") {
        Ok(())
    } else {
        Err(anyhow!("unsupported_external_tool: {}", tool_id))
    }
}

pub(crate) fn display_name(tool_id: &str) -> &str {
    match tool_id {
        "yt-dlp" => "yt-dlp",
        "ffmpeg" => "FFmpeg",
        other => other,
    }
}

pub(crate) fn exe_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    }
}

pub(crate) fn target_triple_name() -> String {
    let base = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else {
        std::env::consts::ARCH
    };
    if cfg!(target_os = "windows") {
        format!("{}.exe", base)
    } else {
        base.to_string()
    }
}
