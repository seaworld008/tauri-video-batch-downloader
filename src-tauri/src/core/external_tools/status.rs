use anyhow::{anyhow, Result};
use std::path::Path;

use crate::core::external_tool_compat::validate_tool_contract;
use crate::utils::process::hidden_command;

use super::registry::{
    display_name, ExternalToolSource, ExternalToolStatus, ExternalToolStatusKind,
};
use super::resolver::{managed_backup_path, resolve_tool_path};

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

pub(crate) async fn read_tool_version(path: &Path, tool_id: &str) -> Result<String> {
    let arg = if tool_id == "ffmpeg" {
        "-version"
    } else {
        "--version"
    };
    let output = hidden_command(path).arg(arg).output().await?;
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
