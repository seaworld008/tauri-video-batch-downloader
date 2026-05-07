use anyhow::{anyhow, Result};
use std::path::Path;
use tokio::process::Command;

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
    let output = Command::new(path).arg("--help").output().await?;
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
    let output = Command::new(path).arg("-version").output().await?;
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
}
