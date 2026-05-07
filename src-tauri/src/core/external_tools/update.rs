use anyhow::{anyhow, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::io::AsyncWriteExt;

use crate::core::external_tool_compat::validate_tool_contract;

use super::registry::ExternalToolStatus;
use super::resolver::{managed_backup_path, managed_tool_path, tool_data_dir};
use super::status::{read_tool_version, status_for_tool};

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

pub async fn check_updates(tool: Option<String>) -> Result<Vec<ExternalToolStatus>> {
    let tools: Vec<&str> = match tool.as_deref() {
        Some("yt-dlp") => vec!["yt-dlp"],
        Some("ffmpeg") => vec!["ffmpeg"],
        Some(other) => return Err(anyhow!("unsupported_external_tool: {}", other)),
        None => vec!["yt-dlp", "ffmpeg"],
    };

    let mut results = Vec::new();
    let latest_ytdlp = if tools.contains(&"yt-dlp") {
        Some(fetch_latest_ytdlp_release().await?.tag_name)
    } else {
        None
    };

    for tool_id in tools {
        let latest = if tool_id == "yt-dlp" {
            latest_ytdlp.clone()
        } else {
            None
        };
        results.push(status_for_tool(tool_id, latest).await);
    }
    Ok(results)
}

pub async fn update_tool(tool_id: &str) -> Result<ExternalToolStatus> {
    if tool_id != "yt-dlp" {
        return Err(anyhow!(
            "manual_update_only: ffmpeg requires a user-selected trusted binary"
        ));
    }

    let release = fetch_latest_ytdlp_release().await?;
    let asset = select_ytdlp_asset(&release)?;
    let target = managed_tool_path(tool_id)
        .ok_or_else(|| anyhow!("external_tool_failed: cannot resolve managed tool directory"))?;
    let temp = target.with_extension("download");
    let backup = target.with_extension("previous");

    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    download_file(&asset.browser_download_url, &temp).await?;
    verify_asset_checksum(&release, &asset.name, &temp).await?;
    make_executable(&temp).await?;
    let version = read_tool_version(&temp, tool_id).await?;
    validate_tool_contract(&temp, tool_id).await?;

    replace_managed_tool(&target, &temp, &backup).await?;
    save_managed_metadata(tool_id, &release.tag_name, &version).await?;
    Ok(status_for_tool(tool_id, Some(release.tag_name)).await)
}

pub async fn rollback_tool(tool_id: &str) -> Result<ExternalToolStatus> {
    if tool_id != "yt-dlp" {
        return Err(anyhow!(
            "manual_update_only: ffmpeg does not have App-managed rollback"
        ));
    }

    let target = managed_tool_path(tool_id)
        .ok_or_else(|| anyhow!("external_tool_failed: cannot resolve managed tool directory"))?;
    let backup = managed_backup_path(tool_id)
        .ok_or_else(|| anyhow!("external_tool_failed: cannot resolve managed backup path"))?;
    if !backup.exists() {
        return Err(anyhow!(
            "external_tool_missing: no previous managed version is available"
        ));
    }

    let current = target.with_extension("rollback-current");
    if target.exists() {
        let _ = tokio::fs::remove_file(&current).await;
        tokio::fs::rename(&target, &current).await?;
    }

    tokio::fs::rename(&backup, &target).await?;
    let version_result = read_tool_version(&target, tool_id).await;
    let contract_result = match version_result {
        Ok(version) => validate_tool_contract(&target, tool_id)
            .await
            .map(|_| version),
        Err(err) => Err(err),
    };
    let version = match contract_result {
        Ok(version) => version,
        Err(err) => {
            let _ = tokio::fs::rename(&target, &backup).await;
            if current.exists() {
                let _ = tokio::fs::rename(&current, &target).await;
            }
            return Err(err);
        }
    };

    if current.exists() {
        tokio::fs::rename(&current, &backup).await?;
    }
    save_managed_metadata(tool_id, "rollback", &version).await?;
    Ok(status_for_tool(tool_id, None).await)
}

async fn fetch_latest_ytdlp_release() -> Result<GitHubRelease> {
    let client = reqwest::Client::builder()
        .user_agent("VideoDownloaderPro/1.0 external-tool-updater")
        .build()?;
    let release = client
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
        .send()
        .await?
        .error_for_status()?
        .json::<GitHubRelease>()
        .await?;
    Ok(release)
}

fn select_ytdlp_asset(release: &GitHubRelease) -> Result<&GitHubReleaseAsset> {
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["yt-dlp.exe"]
    } else if cfg!(target_os = "macos") {
        &["yt-dlp_macos", "yt-dlp"]
    } else {
        &["yt-dlp_linux", "yt-dlp"]
    };
    candidates
        .iter()
        .find_map(|name| release.assets.iter().find(|asset| asset.name == *name))
        .ok_or_else(|| anyhow!("external_tool_failed: no suitable yt-dlp asset for this platform"))
}

async fn download_file(url: &str, path: &Path) -> Result<()> {
    let bytes = reqwest::Client::builder()
        .user_agent("VideoDownloaderPro/1.0 external-tool-updater")
        .build()?
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let mut file = tokio::fs::File::create(path).await?;
    file.write_all(&bytes).await?;
    file.flush().await?;
    Ok(())
}

async fn verify_asset_checksum(
    release: &GitHubRelease,
    asset_name: &str,
    path: &Path,
) -> Result<()> {
    let sums = release
        .assets
        .iter()
        .find(|asset| asset.name == "SHA2-256SUMS")
        .ok_or_else(|| anyhow!("external_tool_failed: release checksum file missing"))?;
    let text = reqwest::Client::builder()
        .user_agent("VideoDownloaderPro/1.0 external-tool-updater")
        .build()?
        .get(&sums.browser_download_url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let expected = text
        .lines()
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            let hash = parts.next()?;
            let name = parts.next()?.trim_start_matches("./");
            (name == asset_name).then(|| hash.to_string())
        })
        .ok_or_else(|| anyhow!("external_tool_failed: checksum for asset not found"))?;
    let bytes = tokio::fs::read(path).await?;
    let actual = hex::encode(Sha256::digest(&bytes));
    if actual != expected {
        return Err(anyhow!("external_tool_failed: checksum mismatch"));
    }
    Ok(())
}

async fn make_executable(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = tokio::fs::metadata(path).await?.permissions();
        permissions.set_mode(0o755);
        tokio::fs::set_permissions(path, permissions).await?;
    }
    Ok(())
}

async fn replace_managed_tool(target: &Path, temp: &Path, backup: &Path) -> Result<()> {
    let had_target = target.exists();
    if had_target {
        let _ = tokio::fs::remove_file(backup).await;
        tokio::fs::rename(target, backup).await?;
    }

    match tokio::fs::rename(temp, target).await {
        Ok(()) => Ok(()),
        Err(replace_err) => {
            if had_target && backup.exists() {
                let _ = tokio::fs::remove_file(target).await;
                if let Err(restore_err) = tokio::fs::rename(backup, target).await {
                    return Err(anyhow!(
                        "external_tool_failed: replace failed ({replace_err}); restore failed ({restore_err})"
                    ));
                }
            }
            Err(replace_err.into())
        }
    }
}

async fn save_managed_metadata(tool_id: &str, latest: &str, installed: &str) -> Result<()> {
    let Some(path) = tool_data_dir().map(|dir| dir.join(format!("{}.managed.json", tool_id)))
    else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let payload = serde_json::json!({
        "latest_version": latest,
        "installed_version": installed,
        "updated_at": chrono::Utc::now(),
    });
    tokio::fs::write(path, serde_json::to_vec_pretty(&payload)?).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn restores_previous_managed_tool_when_final_replace_fails() {
        let dir = tempdir().expect("tempdir");
        let target = dir.path().join("yt-dlp");
        let temp = dir.path().join("yt-dlp.download");
        let backup = dir.path().join("yt-dlp.previous");

        tokio::fs::write(&target, b"previous-version")
            .await
            .expect("write previous target");
        let missing_temp = temp;

        let err = replace_managed_tool(&target, &missing_temp, &backup)
            .await
            .expect_err("missing temp should fail final replace");

        assert!(err.to_string().contains("No such file") || err.to_string().contains("not found"));
        assert_eq!(
            tokio::fs::read_to_string(&target).await.unwrap(),
            "previous-version"
        );
    }
}
