//! File system utilities

use anyhow::{anyhow, Result};
use std::fs;
use std::path::Path;

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
    let sanitized: String = filename
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            '/' | '\\' => '_',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('.').trim();
    let fallback = if trimmed.is_empty() {
        "download"
    } else {
        trimmed
    };
    let reserved_safe = if is_windows_reserved_filename(fallback) {
        format!("_{}", fallback)
    } else {
        fallback.to_string()
    };

    truncate_filename_chars(&reserved_safe, 180)
}

fn is_windows_reserved_filename(filename: &str) -> bool {
    let stem = filename
        .split('.')
        .next()
        .unwrap_or(filename)
        .trim()
        .to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn truncate_filename_chars(filename: &str, max_chars: usize) -> String {
    if filename.chars().count() <= max_chars {
        return filename.to_string();
    }

    filename.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn sanitize_filename_replaces_invalid_path_characters() {
        assert_eq!(
            sanitize_filename("a/b\\c:d*e?f\"g<h>i|j"),
            "a_b_c_d_e_f_g_h_i_j"
        );
    }

    #[test]
    fn sanitize_filename_uses_stable_fallback_for_empty_titles() {
        assert_eq!(sanitize_filename("   ...  "), "download");
        assert_eq!(sanitize_filename("\n\t"), "download");
    }

    #[test]
    fn sanitize_filename_prefixes_windows_reserved_names() {
        assert_eq!(sanitize_filename("CON"), "_CON");
        assert_eq!(sanitize_filename("nul.mp4"), "_nul.mp4");
        assert_eq!(sanitize_filename("LPT9.txt"), "_LPT9.txt");
    }

    #[test]
    fn sanitize_filename_caps_extreme_lengths() {
        let long_name = "视".repeat(240);
        let sanitized = sanitize_filename(&long_name);
        assert_eq!(sanitized.chars().count(), 180);
        assert!(sanitized.chars().all(|ch| ch == '视'));
    }
}
