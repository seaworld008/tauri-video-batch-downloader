use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use super::resolver::tool_data_dir;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct ExternalToolConfig {
    pub overrides: HashMap<String, String>,
}

pub(crate) fn load_config() -> Result<ExternalToolConfig> {
    let Some(path) = config_path() else {
        return Ok(ExternalToolConfig::default());
    };
    if !path.exists() {
        return Ok(ExternalToolConfig::default());
    }
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

pub(crate) async fn save_config(config: &ExternalToolConfig) -> Result<()> {
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
