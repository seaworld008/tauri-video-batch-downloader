use std::path::PathBuf;

use directories::ProjectDirs;

use super::config_store::load_config;
use super::registry::{exe_name, target_triple_name, ExternalToolSource};

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

pub(crate) fn managed_tool_path(tool_id: &str) -> Option<PathBuf> {
    tool_data_dir().map(|dir| dir.join("managed").join(exe_name(tool_id)))
}

pub(crate) fn managed_backup_path(tool_id: &str) -> Option<PathBuf> {
    managed_tool_path(tool_id).map(|path| path.with_extension("previous"))
}

pub(crate) fn tool_data_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "video-downloader", "VideoDownloaderPro")
        .map(|dirs| dirs.data_local_dir().join("tools"))
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
