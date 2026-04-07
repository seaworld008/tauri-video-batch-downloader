//! Utility modules and helper functions
//!
//! This module contains shared utilities and helper functions used across the application.

pub mod encoding;
pub mod file_utils;
pub mod logging;
pub mod network;
pub mod validation;

// Re-export commonly used utilities
pub use encoding::*;
pub use file_utils::*;
pub use logging::*;
pub use network::*;
pub use validation::*;
