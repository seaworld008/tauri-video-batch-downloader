//! Cross-platform process helpers.

use std::ffi::OsStr;

const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn hidden_command(program: impl AsRef<OsStr>) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    hide_command_window(&mut command);
    command
}

pub fn hide_command_window(command: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(windows)]
    {
        command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = WINDOWS_CREATE_NO_WINDOW;
    }
    command
}

#[cfg(windows)]
pub fn hidden_std_command(program: impl AsRef<OsStr>) -> std::process::Command {
    use std::os::windows::process::CommandExt;

    let mut command = std::process::Command::new(program);
    command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_hidden_command() {
        let mut command = hidden_command("test-tool");
        command.arg("--version");
    }
}
