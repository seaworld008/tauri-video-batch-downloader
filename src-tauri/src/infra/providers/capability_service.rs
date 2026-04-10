use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct ToolCapabilityService;

impl ToolCapabilityService {
    pub async fn is_available(tool_name: &str, args: &[&str]) -> Result<bool, String> {
        let output = Command::new(tool_name).args(args).output().await;

        match output {
            Ok(output) => Ok(output.status.success()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(err) => Err(format!("Failed to check {}: {}", tool_name, err)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ToolCapabilityService;

    #[tokio::test]
    async fn missing_tool_returns_false() {
        let available = ToolCapabilityService::is_available(
            "definitely-not-existing-tool-bin-123",
            &["--version"],
        )
        .await
        .expect("capability check should not crash");

        assert!(!available);
    }
}
