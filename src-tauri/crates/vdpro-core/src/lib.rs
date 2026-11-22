//! Core domain models, configuration, retry/circuit-breaker error handling,
//! path/URL validation, cross-platform process helpers, progress tracking,
//! and file integrity verification for Video Downloader Pro.

pub mod config;
pub mod error_handling;
pub mod file_utils;
pub mod integrity_checker;
pub mod models;
pub mod process;
pub mod progress_tracker;
pub mod validation;

pub use config::AppConfig;
pub use models::{
    AppError, AppResult, DownloadConfig, DownloadStats, DownloaderType, EffectiveRequestOptions,
    PersistedManagerState, ProgressUpdate, SourcePlatform, TaskPriority, TaskRequestOptions,
    TaskStatus, VideoTask,
};
