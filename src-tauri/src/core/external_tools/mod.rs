use anyhow::{anyhow, Result};
use std::path::PathBuf;

use crate::core::external_tool_compat::validate_tool_contract;

mod config_store;
pub mod registry;
mod resolver;
mod status;
mod update;

pub use registry::ExternalToolStatus;
pub use resolver::resolve_tool_path;
pub use status::{status_for_all, status_for_tool};
pub use update::{check_updates, rollback_tool, update_tool};

use config_store::{load_config, save_config};
use registry::validate_tool_id;
use status::read_tool_version;

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
