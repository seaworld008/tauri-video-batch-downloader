//! Core business logic module
//!
//! This module contains the core domain models, managers, and business logic
//! for the video downloader application.

pub mod config;
pub mod downloader;
pub mod error_handling;
pub mod file_parser;
pub mod integrity_checker;
pub mod m3u8_downloader;
pub mod manager;
pub mod models;

pub mod part_file;
pub mod progress_tracker;
pub mod queue_scheduler;
pub mod resume_downloader;
pub mod runtime;
pub mod youtube_downloader;

// Re-export commonly used types
pub use config::AppConfig;
pub use manager::DownloadManager;
