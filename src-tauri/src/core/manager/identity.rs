use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use super::DownloadManager;
use crate::core::models::VideoTask;
use crate::utils::file_utils::sanitize_filename;

impl DownloadManager {
    pub(super) fn resolve_output_file_path(&self, task: &VideoTask) -> Option<PathBuf> {
        if let Some(resolved) = task.resolved_path.as_ref() {
            if !resolved.trim().is_empty() {
                return Some(PathBuf::from(resolved));
            }
        }

        if task.output_path.trim().is_empty() {
            return None;
        }

        let (output_dir, filename) =
            Self::split_output_path(&task.url, &task.output_path, Some(&task.title));
        if output_dir.trim().is_empty() {
            return Some(PathBuf::from(filename));
        }

        Some(Path::new(&output_dir).join(filename))
    }

    pub(super) fn normalize_output_path(output_path: &str) -> String {
        output_path.trim_end_matches(['/', '\\']).to_string()
    }

    pub(super) fn split_output_path(
        url: &str,
        output_path: &str,
        preferred_title: Option<&str>,
    ) -> (String, String) {
        let trimmed = output_path.trim();
        let default_filename = Self::derive_output_filename(url, preferred_title);
        if trimmed.is_empty() {
            return (String::new(), default_filename);
        }

        let ends_with_sep = trimmed.ends_with('/') || trimmed.ends_with('\\');
        if ends_with_sep {
            return (Self::normalize_output_path(trimmed), default_filename);
        }

        let path = Path::new(trimmed);
        if path.extension().is_some() && path.file_name().is_some() {
            let dir = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let filename = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or(default_filename);
            return (Self::normalize_output_path(&dir), filename);
        }

        (Self::normalize_output_path(trimmed), default_filename)
    }

    pub(super) fn identity_parts_from_task(&self, task: &VideoTask) -> (String, String) {
        if let Some(resolved) = task.resolved_path.as_ref() {
            let path = Path::new(resolved);
            let dir = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let filename = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| Self::extract_title_from_url(&task.url));
            return (Self::normalize_output_path(&dir), filename);
        }

        Self::split_output_path(&task.url, &task.output_path, Some(&task.title))
    }

    pub(super) fn build_identity_key(&self, url: &str, output_path: &str) -> String {
        let (output_dir, filename) = Self::split_output_path(url, output_path, None);
        format!("url:{}|dir:{}|file:{}", url, output_dir, filename)
    }

    pub(super) fn build_identity_key_for_task(&self, task: &VideoTask) -> String {
        let (output_dir, filename) = self.identity_parts_from_task(task);
        format!("url:{}|dir:{}|file:{}", task.url, output_dir, filename)
    }

    pub(super) fn business_identity_key_for_task(&self, task: &VideoTask) -> Option<String> {
        let info = task.video_info.as_ref()?;
        let zl_id = info
            .zl_id
            .as_ref()
            .or(info.id.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())?;
        let record_url = info
            .record_url
            .as_ref()
            .or(info.url.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())?;
        Some(format!("biz:{}|{}", zl_id, record_url))
    }

    pub(super) fn identity_keys_for_task(&self, task: &VideoTask) -> Vec<String> {
        let mut keys = Vec::new();
        if let Some(business_key) = self.business_identity_key_for_task(task) {
            keys.push(business_key);
        }
        keys.push(self.build_identity_key_for_task(task));
        keys.sort();
        keys.dedup();
        keys
    }

    pub(super) fn find_task_by_task_identity(&self, task: &VideoTask) -> Option<String> {
        let keys = self.identity_keys_for_task(task);
        if keys.is_empty() {
            return None;
        }
        self.tasks
            .values()
            .find(|existing| {
                let existing_keys = self.identity_keys_for_task(existing);
                existing_keys.iter().any(|key| keys.contains(key))
            })
            .map(|task| task.id.clone())
    }

    pub(super) fn find_task_by_identity(&self, url: &str, output_path: &str) -> Option<String> {
        let identity = self.build_identity_key(url, output_path);
        self.tasks
            .values()
            .find(|task| {
                self.identity_keys_for_task(task)
                    .iter()
                    .any(|key| key == &identity)
            })
            .map(|task| task.id.clone())
    }

    pub(super) fn extract_title_from_url(url: &str) -> String {
        url.split('/')
            .next_back()
            .and_then(|s| s.split('?').next())
            .unwrap_or("Unknown")
            .to_string()
    }

    fn derive_output_filename(url: &str, preferred_title: Option<&str>) -> String {
        let fallback = Self::extract_title_from_url(url);
        let url_path = url.split('?').next().unwrap_or(url);
        let url_file_name = Path::new(url_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&fallback);
        let extension = Path::new(url_file_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");

        let sanitized_title = preferred_title
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(sanitize_filename)
            .map(|title| title.trim().trim_matches('.').to_string())
            .filter(|title| !title.is_empty())
            .filter(|title| title.to_lowercase() != "unknown");

        if let Some(title) = sanitized_title {
            if extension.is_empty() {
                return title;
            }

            let lowercase_title = title.to_lowercase();
            let lowercase_extension = extension.to_lowercase();
            if lowercase_title.ends_with(&format!(".{lowercase_extension}")) {
                return title;
            }

            return format!("{title}.{extension}");
        }

        fallback
    }

    pub(super) fn build_resume_key(&self, task: &VideoTask) -> Option<String> {
        if task.output_path.trim().is_empty()
            && task
                .resolved_path
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return None;
        }
        let (output_dir, filename) = self.identity_parts_from_task(task);
        let identity = format!("{}|{}|{}", task.url, output_dir, filename);
        let mut hasher = Sha256::new();
        hasher.update(identity.as_bytes());
        Some(hex::encode(hasher.finalize()))
    }
}
