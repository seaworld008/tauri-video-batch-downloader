use anyhow::{anyhow, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::process::Command;

use crate::core::external_tool_compat::validate_tool_contract;

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ExternalToolConfig {
    overrides: HashMap<String, String>,
}

pub fn resolve_tool_path(tool_id: &str) -> (PathBuf, ExternalToolSource) {
    if let Some(path) = load_config()
        .ok()
        .and_then(|config| config.overrides.get(tool_id).cloned())
        .map(PathBuf::from)
        .filter(|path| path.exists())
    {
        return (path, ExternalToolSource::UserOverride);
    }

    if let Some(path) = managed_tool_path(tool_id).filter(|path| path.exists()) {
        return (path, ExternalToolSource::Managed);
    }

    if let Some(path) = bundled_sidecar_path(tool_id) {
        return (path, ExternalToolSource::BundledSidecar);
    }

    (
        PathBuf::from(exe_name(tool_id)),
        ExternalToolSource::PathFallback,
    )
}

pub async fn status_for_all() -> Vec<ExternalToolStatus> {
    let mut statuses = Vec::new();
    for tool in ["yt-dlp", "ffmpeg"] {
        statuses.push(status_for_tool(tool, None).await);
    }
    statuses
}

pub async fn status_for_tool(tool_id: &str, latest_version: Option<String>) -> ExternalToolStatus {
    let (path, source) = resolve_tool_path(tool_id);
    let version_result = read_tool_version(&path, tool_id).await;
    let (status, current_version, last_error) = match version_result {
        Ok(version) => match validate_tool_contract(&path, tool_id).await {
            Ok(()) => (ExternalToolStatusKind::Available, Some(version), None),
            Err(err) => (
                ExternalToolStatusKind::VersionUnsupported,
                Some(version),
                Some(err.to_string()),
            ),
        },
        Err(err) if matches!(source, ExternalToolSource::PathFallback) => {
            (ExternalToolStatusKind::Missing, None, Some(err.to_string()))
        }
        Err(err) => (ExternalToolStatusKind::Failed, None, Some(err.to_string())),
    };
    let update_available = matches!(tool_id, "yt-dlp")
        && current_version.is_some()
        && latest_version.is_some()
        && current_version != latest_version;

    ExternalToolStatus {
        id: tool_id.to_string(),
        display_name: display_name(tool_id).to_string(),
        status,
        source: Some(source),
        path: Some(path.to_string_lossy().to_string()),
        current_version,
        latest_version,
        update_available,
        can_auto_update: tool_id == "yt-dlp",
        can_rollback: managed_backup_path(tool_id)
            .map(|path| path.exists())
            .unwrap_or(false),
        last_error,
    }
}

pub async fn check_updates(tool: Option<String>) -> Result<Vec<ExternalToolStatus>> {
    crate::core::external_tool_update::check_updates(tool).await
}

pub async fn update_tool(tool_id: &str) -> Result<ExternalToolStatus> {
    crate::core::external_tool_update::update_tool(tool_id).await
}

pub async fn rollback_tool(tool_id: &str) -> Result<ExternalToolStatus> {
    crate::core::external_tool_update::rollback_tool(tool_id).await
}

pub async fn set_override(tool_id: &str, path: &str) -> Result<ExternalToolStatus> {
    validate_tool_id(tool_id)?;
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err(anyhow!(
            "external_tool_missing: selected file does not exist"
        ));
    }
    read_tool_version(&path_buf, tool_id).await?;
    validate_tool_contract(&path_buf, tool_id).await?;

    let mut config = load_config().unwrap_or_default();
    config
        .overrides
        .insert(tool_id.to_string(), path_buf.to_string_lossy().to_string());
    save_config(&config).await?;
    Ok(status_for_tool(tool_id, None).await)
}

pub async fn clear_override(tool_id: &str) -> Result<ExternalToolStatus> {
    validate_tool_id(tool_id)?;
    let mut config = load_config().unwrap_or_default();
    config.overrides.remove(tool_id);
    save_config(&config).await?;
    Ok(status_for_tool(tool_id, None).await)
}

pub(crate) async fn read_tool_version(path: &Path, tool_id: &str) -> Result<String> {
    let arg = if tool_id == "ffmpeg" {
        "-version"
    } else {
        "--version"
    };
    let output = Command::new(path).arg(arg).output().await?;
    if !output.status.success() {
        return Err(anyhow!("external_tool_failed: version check failed"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("").trim();
    if tool_id == "ffmpeg" {
        Ok(first_line
            .split_whitespace()
            .nth(2)
            .unwrap_or(first_line)
            .to_string())
    } else {
        Ok(first_line.to_string())
    }
}

pub(crate) fn managed_tool_path(tool_id: &str) -> Option<PathBuf> {
    tool_data_dir().map(|dir| dir.join("managed").join(exe_name(tool_id)))
}

pub(crate) fn managed_backup_path(tool_id: &str) -> Option<PathBuf> {
    managed_tool_path(tool_id).map(|path| path.with_extension("previous"))
}

fn bundled_sidecar_path(tool_id: &str) -> Option<PathBuf> {
    let current = std::env::current_exe().ok()?;
    let dir = current.parent()?;
    [
        dir.join(exe_name(tool_id)),
        dir.join("binaries")
            .join(format!("{}-{}", tool_id, target_triple_name())),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn load_config() -> Result<ExternalToolConfig> {
    let Some(path) = config_path() else {
        return Ok(ExternalToolConfig::default());
    };
    if !path.exists() {
        return Ok(ExternalToolConfig::default());
    }
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

async fn save_config(config: &ExternalToolConfig) -> Result<()> {
    let Some(path) = config_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(path, serde_json::to_vec_pretty(config)?).await?;
    Ok(())
}

fn config_path() -> Option<PathBuf> {
    tool_data_dir().map(|dir| dir.join("external_tools.json"))
}

pub(crate) fn tool_data_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "video-downloader", "VideoDownloaderPro")
        .map(|dirs| dirs.data_local_dir().join("tools"))
}

fn validate_tool_id(tool_id: &str) -> Result<()> {
    if matches!(tool_id, "yt-dlp" | "ffmpeg") {
        Ok(())
    } else {
        Err(anyhow!("unsupported_external_tool: {}", tool_id))
    }
}

fn display_name(tool_id: &str) -> &str {
    match tool_id {
        "yt-dlp" => "yt-dlp",
        "ffmpeg" => "FFmpeg",
        other => other,
    }
}

fn exe_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    }
}

fn target_triple_name() -> String {
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
