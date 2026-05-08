use anyhow::{anyhow, Result};
use std::path::Path;
use std::time::Duration;
use tokio::time::timeout;

use crate::utils::process::hidden_command;

const TOOL_CONTRACT_TIMEOUT: Duration = Duration::from_secs(60);

const YTDLP_REQUIRED_FLAGS: &[&str] = &[
    "--dump-single-json",
    "--ffmpeg-location",
    "--merge-output-format",
    "--newline",
    "--no-playlist",
    "--progress-template",
];

pub(crate) async fn validate_tool_contract(path: &Path, tool_id: &str) -> Result<()> {
    match tool_id {
        "yt-dlp" => validate_ytdlp_contract(path).await,
        "ffmpeg" => validate_ffmpeg_contract(path).await,
        other => Err(anyhow!("unsupported_external_tool: {}", other)),
    }
}

async fn validate_ytdlp_contract(path: &Path) -> Result<()> {
    validate_ytdlp_contract_with_timeout(path, TOOL_CONTRACT_TIMEOUT).await
}

async fn validate_ytdlp_contract_with_timeout(
    path: &Path,
    contract_timeout: Duration,
) -> Result<()> {
    let mut command = hidden_command(path);
    command.arg("--help").kill_on_drop(true);
    let output = timeout(contract_timeout, command.output())
        .await
        .map_err(|_| anyhow!("version_unsupported: yt-dlp compatibility probe timed out"))??;
    if !output.status.success() {
        return Err(anyhow!(
            "version_unsupported: yt-dlp compatibility probe failed"
        ));
    }

    let help_text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    validate_ytdlp_help_text(&help_text)
}

async fn validate_ffmpeg_contract(path: &Path) -> Result<()> {
    let mut command = hidden_command(path);
    command.arg("-version").kill_on_drop(true);
    let output = timeout(TOOL_CONTRACT_TIMEOUT, command.output())
        .await
        .map_err(|_| anyhow!("version_unsupported: ffmpeg compatibility probe timed out"))??;
    if !output.status.success() {
        return Err(anyhow!(
            "version_unsupported: ffmpeg compatibility probe failed"
        ));
    }

    let version_text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .to_lowercase();

    if !version_text.contains("ffmpeg version") {
        return Err(anyhow!(
            "version_unsupported: selected file does not look like ffmpeg"
        ));
    }
    Ok(())
}

pub(crate) fn validate_ytdlp_help_text(help_text: &str) -> Result<()> {
    let missing: Vec<&str> = YTDLP_REQUIRED_FLAGS
        .iter()
        .copied()
        .filter(|flag| !help_text.contains(flag))
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(anyhow!(
            "version_unsupported: yt-dlp is missing required options ({})",
            missing.join(", ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ytdlp_help_with_required_flags() {
        let help = YTDLP_REQUIRED_FLAGS.join("\n");
        validate_ytdlp_help_text(&help).expect("required flags should pass");
    }

    #[test]
    fn rejects_ytdlp_help_missing_required_flags() {
        let err = validate_ytdlp_help_text("--newline\n--no-playlist").unwrap_err();
        assert!(err.to_string().contains("version_unsupported"));
        assert!(err.to_string().contains("--dump-single-json"));
        assert!(err.to_string().contains("--progress-template"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_hanging_ytdlp_contract_probe() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::tempdir;

        let temp = tempdir().unwrap();
        let ytdlp = temp.path().join("yt-dlp");
        std::fs::write(
            &ytdlp,
            r#"#!/usr/bin/env sh
exec sleep 30
"#,
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&ytdlp).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&ytdlp, permissions).unwrap();

        let err = validate_ytdlp_contract_with_timeout(&ytdlp, Duration::from_millis(100))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("timed out"));
    }
}
