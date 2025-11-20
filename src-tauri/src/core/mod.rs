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

#[cfg(all(test, feature = "integration-tests"))]
mod manager_test;

#[cfg(all(test, feature = "integration-tests"))]
mod file_parser_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod resume_downloader_integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod m3u8_integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod file_parser_integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod progress_tracker_integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod error_handling_integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod monitoring_integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod youtube_downloader_integration_tests;

#[cfg(all(test, feature = "integration-tests"))]
mod system_integration_tests;

// Re-export commonly used types
pub use config::AppConfig;
pub use manager::DownloadManager;
