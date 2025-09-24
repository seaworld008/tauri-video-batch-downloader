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
pub mod monitoring;
pub mod progress_tracker;
pub mod resume_downloader;
pub mod youtube_downloader;

#[cfg(test)]
mod manager_test;

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod resume_downloader_integration_tests;

#[cfg(test)]
mod m3u8_integration_tests;

#[cfg(test)]
mod file_parser_tests;

#[cfg(test)]
mod file_parser_integration_tests;

#[cfg(test)]
mod progress_tracker_integration_tests;

#[cfg(test)]
mod error_handling_integration_tests;

#[cfg(test)]
mod monitoring_integration_tests;

#[cfg(test)]
mod youtube_downloader_integration_tests;

#[cfg(test)]
mod system_integration_tests;

// Re-export commonly used types
pub use config::AppConfig;
pub use manager::DownloadManager;
