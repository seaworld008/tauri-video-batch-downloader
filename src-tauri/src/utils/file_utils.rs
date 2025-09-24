//! File system utilities

use anyhow::{anyhow, Result};
use std::fs;
use std::path::{Path, PathBuf};

/// Ensure directory exists
pub fn ensure_dir_exists(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::create_dir_all(path)
            .map_err(|e| anyhow!("Failed to create directory {}: {}", path.display(), e))?;
    }
    Ok(())
}

/// Get file extension
pub fn get_file_extension(filename: &str) -> Option<&str> {
    Path::new(filename).extension().and_then(|ext| ext.to_str())
}

/// Sanitize filename for filesystem
pub fn sanitize_filename(filename: &str) -> String {
    filename
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            '/' | '\\' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect()
}
