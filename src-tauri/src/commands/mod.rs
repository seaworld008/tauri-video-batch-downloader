//! Tauri command handlers
//!
//! This module contains all the command handlers that can be invoked from the frontend.
//! Commands are organized into different modules based on their functionality.

pub mod config;
pub mod download;
pub mod import;
pub mod system;
pub mod youtube;

// Re-export all command functions for easy access
pub use config::*;
pub use download::*;
pub use import::*;
pub use system::*;
pub use youtube::*;
