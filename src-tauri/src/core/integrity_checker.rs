//! File Integrity Checker Module
//!
//! This module provides comprehensive file integrity verification using multiple
//! cryptographic hash algorithms. It supports streaming operations for large files,
//! concurrent verification, and various hash formats.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::{mpsc, RwLock};
use tokio::task;
use tracing::{debug, error, info, warn};

// Hash algorithm imports from RustCrypto
use blake2::{Blake2b512, Blake2s256, Digest as Blake2Digest};
use digest::DynDigest;
use md5::Md5;
use sha1::Sha1;
use sha2::{Sha256, Sha512};

use crate::core::models::{AppError, AppResult};

/// Supported hash algorithms for file integrity checking
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum HashAlgorithm {
    /// SHA-256 (Recommended - secure and widely used)
    Sha256,
    /// SHA-512 (Recommended - highest security)
    Sha512,
    /// BLAKE2b-512 (Recommended - fastest secure hash)
    Blake2b512,
    /// BLAKE2s-256 (Recommended - optimized for 32-bit platforms)
    Blake2s256,
    /// MD5 (Legacy - use only for compatibility)
    Md5,
    /// SHA-1 (Legacy - use only for compatibility)
    Sha1,
}

impl HashAlgorithm {
    /// Get the name of the hash algorithm
    pub fn name(&self) -> &'static str {
        match self {
            HashAlgorithm::Sha256 => "SHA-256",
            HashAlgorithm::Sha512 => "SHA-512",
            HashAlgorithm::Blake2b512 => "BLAKE2b-512",
            HashAlgorithm::Blake2s256 => "BLAKE2s-256",
            HashAlgorithm::Md5 => "MD5",
            HashAlgorithm::Sha1 => "SHA-1",
        }
    }

    /// Get the expected output length in bytes
    pub fn output_length(&self) -> usize {
        match self {
            HashAlgorithm::Sha256 => 32,
            HashAlgorithm::Sha512 => 64,
            HashAlgorithm::Blake2b512 => 64,
            HashAlgorithm::Blake2s256 => 32,
            HashAlgorithm::Md5 => 16,
            HashAlgorithm::Sha1 => 20,
        }
    }

    /// Check if the algorithm is recommended for new applications
    pub fn is_recommended(&self) -> bool {
        matches!(
            self,
            HashAlgorithm::Sha256
                | HashAlgorithm::Sha512
                | HashAlgorithm::Blake2b512
                | HashAlgorithm::Blake2s256
        )
    }

    /// Get security level (higher is more secure)
    pub fn security_level(&self) -> u8 {
        match self {
            HashAlgorithm::Sha512 | HashAlgorithm::Blake2b512 => 10,
            HashAlgorithm::Sha256 | HashAlgorithm::Blake2s256 => 8,
            HashAlgorithm::Sha1 => 3,
            HashAlgorithm::Md5 => 1,
        }
    }

    /// Create a new hasher instance
    pub fn create_hasher(&self) -> Box<dyn DynDigest> {
        match self {
            HashAlgorithm::Sha256 => Box::new(Sha256::new()),
            HashAlgorithm::Sha512 => Box::new(Sha512::new()),
            HashAlgorithm::Blake2b512 => Box::new(Blake2b512::new()),
            HashAlgorithm::Blake2s256 => Box::new(Blake2s256::new()),
            HashAlgorithm::Md5 => Box::new(Md5::new()),
            HashAlgorithm::Sha1 => Box::new(Sha1::new()),
        }
    }

    /// Get all recommended algorithms for new applications
    pub fn recommended() -> Vec<HashAlgorithm> {
        vec![
            HashAlgorithm::Sha256,
            HashAlgorithm::Sha512,
            HashAlgorithm::Blake2b512,
            HashAlgorithm::Blake2s256,
        ]
    }

    /// Get all supported algorithms
    pub fn all() -> Vec<HashAlgorithm> {
        vec![
            HashAlgorithm::Sha256,
            HashAlgorithm::Sha512,
            HashAlgorithm::Blake2b512,
            HashAlgorithm::Blake2s256,
            HashAlgorithm::Md5,
            HashAlgorithm::Sha1,
        ]
    }
}

/// File integrity check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityResult {
    /// File path that was checked
    pub file_path: String,
    /// File size in bytes
    pub file_size: u64,
    /// Hash algorithm used
    pub algorithm: HashAlgorithm,
    /// Computed hash value (hex-encoded)
    pub computed_hash: String,
    /// Expected hash value (if provided)
    pub expected_hash: Option<String>,
    /// Whether the integrity check passed
    pub is_valid: bool,
    /// Time taken to compute hash
    pub computation_time: Duration,
    /// Timestamp when check was performed
    pub timestamp: SystemTime,
    /// Hash computation speed in bytes per second
    pub computation_speed: f64,
    /// Any errors encountered
    pub error: Option<String>,
}

/// Multiple hash results for a single file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiHashResult {
    /// File path that was checked
    pub file_path: String,
    /// File size in bytes
    pub file_size: u64,
    /// Results for each hash algorithm
    pub hash_results: HashMap<HashAlgorithm, IntegrityResult>,
    /// Overall validity (all hashes must pass)
    pub is_valid: bool,
    /// Total computation time
    pub total_time: Duration,
    /// Timestamp when check was performed
    pub timestamp: SystemTime,
}

/// Configuration for integrity checking
#[derive(Debug, Clone)]
pub struct IntegrityConfig {
    /// Buffer size for reading files (default: 64KB)
    pub buffer_size: usize,
    /// Whether to compute hashes concurrently
    pub concurrent: bool,
    /// Maximum number of concurrent hash computations
    pub max_concurrent: usize,
    /// Whether to verify file exists before hashing
    pub verify_exists: bool,
    /// Whether to emit progress events for large files
    pub emit_progress: bool,
    /// Minimum file size to emit progress events (default: 10MB)
    pub progress_threshold: u64,
}

impl Default for IntegrityConfig {
    fn default() -> Self {
        Self {
            buffer_size: 64 * 1024, // 64KB
            concurrent: true,
            max_concurrent: 4,
            verify_exists: true,
            emit_progress: true,
            progress_threshold: 10 * 1024 * 1024, // 10MB
        }
    }
}

/// Progress information for integrity checking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityProgress {
    /// File being processed
    pub file_path: String,
    /// Bytes processed so far
    pub bytes_processed: u64,
    /// Total file size
    pub total_size: u64,
    /// Progress percentage (0.0 - 100.0)
    pub progress_percent: f64,
    /// Processing speed in bytes per second
    pub speed: f64,
    /// Estimated time remaining
    pub eta_seconds: Option<u64>,
    /// Which algorithms are being computed
    pub algorithms: Vec<HashAlgorithm>,
}

/// File Integrity Checker
#[derive(Debug)]
pub struct IntegrityChecker {
    /// Configuration
    config: IntegrityConfig,
    /// Progress event sender
    progress_sender: Option<mpsc::UnboundedSender<IntegrityProgress>>,
    /// Active integrity checks
    active_checks: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

impl IntegrityChecker {
    /// Create a new integrity checker with default configuration
    pub fn new() -> Self {
        Self {
            config: IntegrityConfig::default(),
            progress_sender: None,
            active_checks: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a new integrity checker with custom configuration
    pub fn with_config(config: IntegrityConfig) -> Self {
        Self {
            config,
            progress_sender: None,
            active_checks: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Set progress callback for receiving progress updates
    pub fn set_progress_callback(&mut self, sender: mpsc::UnboundedSender<IntegrityProgress>) {
        self.progress_sender = Some(sender);
    }

    /// Compute hash of a file using a single algorithm
    pub async fn compute_hash(
        &self,
        file_path: &str,
        algorithm: HashAlgorithm,
    ) -> AppResult<IntegrityResult> {
        let start_time = SystemTime::now();
        let file_path_string = file_path.to_string();

        // Verify file exists
        if self.config.verify_exists && !Path::new(file_path).exists() {
            return Ok(IntegrityResult {
                file_path: file_path_string,
                file_size: 0,
                algorithm,
                computed_hash: String::new(),
                expected_hash: None,
                is_valid: false,
                computation_time: Duration::from_millis(0),
                timestamp: start_time,
                computation_speed: 0.0,
                error: Some(format!("File not found: {}", file_path)),
            });
        }

        // Get file size
        let file_size = match std::fs::metadata(file_path) {
            Ok(metadata) => metadata.len(),
            Err(e) => {
                return Ok(IntegrityResult {
                    file_path: file_path_string,
                    file_size: 0,
                    algorithm,
                    computed_hash: String::new(),
                    expected_hash: None,
                    is_valid: false,
                    computation_time: Duration::from_millis(0),
                    timestamp: start_time,
                    computation_speed: 0.0,
                    error: Some(format!("Failed to get file metadata: {}", e)),
                });
            }
        };

        // Perform hash computation
        let hash_result = if file_size > self.config.progress_threshold && self.config.emit_progress
        {
            self.compute_hash_with_progress(file_path, algorithm, file_size)
                .await
        } else {
            self.compute_hash_simple(file_path, algorithm, file_size)
                .await
        };

        let computation_time = start_time.elapsed().unwrap_or(Duration::from_millis(0));
        let computation_speed = if computation_time.as_secs_f64() > 0.0 {
            file_size as f64 / computation_time.as_secs_f64()
        } else {
            0.0
        };

        match hash_result {
            Ok(hash) => Ok(IntegrityResult {
                file_path: file_path_string,
                file_size,
                algorithm,
                computed_hash: hash,
                expected_hash: None,
                is_valid: true,
                computation_time,
                timestamp: start_time,
                computation_speed,
                error: None,
            }),
            Err(e) => Ok(IntegrityResult {
                file_path: file_path_string,
                file_size,
                algorithm,
                computed_hash: String::new(),
                expected_hash: None,
                is_valid: false,
                computation_time,
                timestamp: start_time,
                computation_speed: 0.0,
                error: Some(e.to_string()),
            }),
        }
    }

    /// Verify file integrity against expected hash
    pub async fn verify_integrity(
        &self,
        file_path: &str,
        expected_hash: &str,
        algorithm: HashAlgorithm,
    ) -> AppResult<IntegrityResult> {
        let mut result = self.compute_hash(file_path, algorithm).await?;

        result.expected_hash = Some(expected_hash.to_lowercase());
        result.is_valid = result.computed_hash.to_lowercase() == expected_hash.to_lowercase();

        if result.is_valid {
            info!(
                "✅ File integrity verified: {} ({})",
                file_path,
                algorithm.name()
            );
        } else {
            warn!(
                "❌ File integrity check failed: {} ({})",
                file_path,
                algorithm.name()
            );
            warn!("   Expected: {}", expected_hash);
            warn!("   Computed: {}", result.computed_hash);
        }

        Ok(result)
    }

    /// Compute multiple hashes for a file concurrently
    pub async fn compute_multi_hash(
        &self,
        file_path: &str,
        algorithms: Vec<HashAlgorithm>,
    ) -> AppResult<MultiHashResult> {
        let start_time = SystemTime::now();

        if algorithms.is_empty() {
            return Err(AppError::Config("No algorithms specified".to_string()));
        }

        let mut results = HashMap::new();
        let mut handles = Vec::new();

        // Get file metadata once
        let file_size = match std::fs::metadata(file_path) {
            Ok(metadata) => metadata.len(),
            Err(e) => {
                return Err(AppError::Io(e));
            }
        };

        if self.config.concurrent && algorithms.len() > 1 {
            // Concurrent computation
            let semaphore = Arc::new(tokio::sync::Semaphore::new(self.config.max_concurrent));

            for algorithm in algorithms.iter() {
                let file_path = file_path.to_string();
                let algorithm = *algorithm;
                let checker = self.clone_for_task();
                let permit =
                    semaphore.clone().acquire_owned().await.map_err(|e| {
                        AppError::System(format!("Failed to acquire semaphore: {}", e))
                    })?;

                let handle = task::spawn(async move {
                    let _permit = permit;
                    checker.compute_hash(&file_path, algorithm).await
                });

                handles.push((algorithm, handle));
            }

            // Collect results
            for (algorithm, handle) in handles {
                match handle.await {
                    Ok(Ok(result)) => {
                        results.insert(algorithm, result);
                    }
                    Ok(Err(e)) => {
                        error!("Hash computation failed for {}: {}", algorithm.name(), e);
                        results.insert(
                            algorithm,
                            IntegrityResult {
                                file_path: file_path.to_string(),
                                file_size,
                                algorithm,
                                computed_hash: String::new(),
                                expected_hash: None,
                                is_valid: false,
                                computation_time: Duration::from_millis(0),
                                timestamp: start_time,
                                computation_speed: 0.0,
                                error: Some(e.to_string()),
                            },
                        );
                    }
                    Err(e) => {
                        error!("Task join error for {}: {}", algorithm.name(), e);
                        results.insert(
                            algorithm,
                            IntegrityResult {
                                file_path: file_path.to_string(),
                                file_size,
                                algorithm,
                                computed_hash: String::new(),
                                expected_hash: None,
                                is_valid: false,
                                computation_time: Duration::from_millis(0),
                                timestamp: start_time,
                                computation_speed: 0.0,
                                error: Some(format!("Task execution failed: {}", e)),
                            },
                        );
                    }
                }
            }
        } else {
            // Sequential computation
            for algorithm in algorithms.iter() {
                match self.compute_hash(file_path, *algorithm).await {
                    Ok(result) => {
                        results.insert(*algorithm, result);
                    }
                    Err(e) => {
                        error!(
                            "Sequential hash computation failed for {}: {}",
                            algorithm.name(),
                            e
                        );
                        results.insert(
                            *algorithm,
                            IntegrityResult {
                                file_path: file_path.to_string(),
                                file_size,
                                algorithm: *algorithm,
                                computed_hash: String::new(),
                                expected_hash: None,
                                is_valid: false,
                                computation_time: Duration::from_millis(0),
                                timestamp: start_time,
                                computation_speed: 0.0,
                                error: Some(e.to_string()),
                            },
                        );
                    }
                }
            }
        }

        let total_time = start_time.elapsed().unwrap_or(Duration::from_millis(0));
        let is_valid = results.values().all(|r| r.is_valid);

        Ok(MultiHashResult {
            file_path: file_path.to_string(),
            file_size,
            hash_results: results,
            is_valid,
            total_time,
            timestamp: start_time,
        })
    }

    /// Simple hash computation without progress reporting
    async fn compute_hash_simple(
        &self,
        file_path: &str,
        algorithm: HashAlgorithm,
        _file_size: u64,
    ) -> AppResult<String> {
        let file = File::open(file_path).map_err(|e| AppError::Io(e))?;

        let mut reader = BufReader::with_capacity(self.config.buffer_size, file);
        let mut hasher = algorithm.create_hasher();
        let mut buffer = vec![0u8; self.config.buffer_size];

        loop {
            let bytes_read = reader.read(&mut buffer).map_err(|e| AppError::Io(e))?;

            if bytes_read == 0 {
                break;
            }

            hasher.update(&buffer[..bytes_read]);
        }

        let hash = hasher.finalize_reset();
        Ok(hex::encode(hash))
    }

    /// Hash computation with progress reporting
    async fn compute_hash_with_progress(
        &self,
        file_path: &str,
        algorithm: HashAlgorithm,
        file_size: u64,
    ) -> AppResult<String> {
        let file = File::open(file_path).map_err(|e| AppError::Io(e))?;

        let mut reader = BufReader::with_capacity(self.config.buffer_size, file);
        let mut hasher = algorithm.create_hasher();
        let mut buffer = vec![0u8; self.config.buffer_size];
        let mut bytes_processed = 0u64;
        let start_time = std::time::Instant::now();
        let mut last_progress_time = start_time;

        loop {
            let bytes_read = reader.read(&mut buffer).map_err(|e| AppError::Io(e))?;

            if bytes_read == 0 {
                break;
            }

            hasher.update(&buffer[..bytes_read]);
            bytes_processed += bytes_read as u64;

            // Emit progress every 100ms or 1MB, whichever comes first
            let now = std::time::Instant::now();
            if now.duration_since(last_progress_time).as_millis() >= 100
                || bytes_processed % (1024 * 1024) == 0
            {
                if let Some(sender) = &self.progress_sender {
                    let elapsed = now.duration_since(start_time).as_secs_f64();
                    let speed = if elapsed > 0.0 {
                        bytes_processed as f64 / elapsed
                    } else {
                        0.0
                    };
                    let progress_percent = (bytes_processed as f64 / file_size as f64) * 100.0;
                    let eta_seconds = if speed > 0.0 {
                        Some(((file_size - bytes_processed) as f64 / speed) as u64)
                    } else {
                        None
                    };

                    let progress = IntegrityProgress {
                        file_path: file_path.to_string(),
                        bytes_processed,
                        total_size: file_size,
                        progress_percent,
                        speed,
                        eta_seconds,
                        algorithms: vec![algorithm],
                    };

                    let _ = sender.send(progress);
                }

                last_progress_time = now;
            }
        }

        let hash = hasher.finalize_reset();
        Ok(hex::encode(hash))
    }

    /// Clone checker for use in async tasks (without progress sender)
    fn clone_for_task(&self) -> Self {
        Self {
            config: self.config.clone(),
            progress_sender: None,
            active_checks: Arc::clone(&self.active_checks),
        }
    }

    /// Get recommended algorithm based on file size and security requirements
    pub fn recommend_algorithm(file_size: u64, security_priority: bool) -> HashAlgorithm {
        if security_priority {
            // Prioritize security
            if file_size > 1_000_000_000 {
                // > 1GB, use faster secure algorithm
                HashAlgorithm::Blake2b512
            } else {
                HashAlgorithm::Sha512
            }
        } else {
            // Prioritize speed
            if file_size > 100_000_000 {
                // > 100MB, use fastest secure algorithm
                HashAlgorithm::Blake2s256
            } else {
                HashAlgorithm::Sha256
            }
        }
    }

    /// Cancel all active integrity checks
    pub async fn cancel_all(&self) {
        let mut active_checks = self.active_checks.write().await;
        for (file_path, handle) in active_checks.drain() {
            handle.abort();
            debug!("Cancelled integrity check for: {}", file_path);
        }
    }

    /// Get number of active checks
    pub async fn active_check_count(&self) -> usize {
        self.active_checks.read().await.len()
    }
}

/// Utility functions for common operations
pub mod utils {
    use super::*;

    /// Parse hash string and detect algorithm from length
    pub fn detect_algorithm_from_hash(hash: &str) -> Option<HashAlgorithm> {
        let clean_hash = hash.trim().to_lowercase();

        // Remove common prefixes
        let clean_hash = clean_hash
            .strip_prefix("md5:")
            .or_else(|| clean_hash.strip_prefix("sha1:"))
            .or_else(|| clean_hash.strip_prefix("sha256:"))
            .or_else(|| clean_hash.strip_prefix("sha512:"))
            .or_else(|| clean_hash.strip_prefix("blake2b:"))
            .or_else(|| clean_hash.strip_prefix("blake2s:"))
            .unwrap_or(&clean_hash);

        match clean_hash.len() {
            32 => Some(HashAlgorithm::Md5),     // MD5: 32 hex chars (128 bits)
            40 => Some(HashAlgorithm::Sha1),    // SHA-1: 40 hex chars (160 bits)
            64 => Some(HashAlgorithm::Sha256),  // SHA-256 or BLAKE2s-256: 64 hex chars (256 bits)
            128 => Some(HashAlgorithm::Sha512), // SHA-512 or BLAKE2b-512: 128 hex chars (512 bits)
            _ => None,
        }
    }

    /// Validate hash string format
    pub fn is_valid_hash(hash: &str) -> bool {
        let clean_hash = hash.trim().to_lowercase();
        !clean_hash.is_empty() && clean_hash.chars().all(|c| c.is_ascii_hexdigit())
    }

    /// Format hash result for display
    pub fn format_result(result: &IntegrityResult) -> String {
        if result.is_valid && result.error.is_none() {
            format!(
                "✅ {} ({}) - {} ({:.2} MB/s)",
                result.algorithm.name(),
                result.computed_hash,
                humanize_bytes(result.file_size),
                result.computation_speed / (1024.0 * 1024.0)
            )
        } else {
            format!(
                "❌ {} - {}",
                result.algorithm.name(),
                result
                    .error
                    .as_ref()
                    .unwrap_or(&"Unknown error".to_string())
            )
        }
    }

    /// Convert bytes to human readable format
    fn humanize_bytes(bytes: u64) -> String {
        const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
        let mut size = bytes as f64;
        let mut unit_index = 0;

        while size >= 1024.0 && unit_index < UNITS.len() - 1 {
            size /= 1024.0;
            unit_index += 1;
        }

        if size.fract() == 0.0 {
            format!("{:.0} {}", size, UNITS[unit_index])
        } else {
            format!("{:.1} {}", size, UNITS[unit_index])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use tokio::time::Duration;

    #[tokio::test]
    async fn test_hash_algorithms() {
        for algorithm in HashAlgorithm::all() {
            let hasher = algorithm.create_hasher();
            assert!(hasher.output_size() > 0);
            assert!(!algorithm.name().is_empty());
            println!(
                "Algorithm: {} ({})",
                algorithm.name(),
                algorithm.security_level()
            );
        }
    }

    #[tokio::test]
    async fn test_simple_file_hashing() -> AppResult<()> {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");

        // Create test file
        std::fs::write(&file_path, b"Hello, World!").unwrap();

        let checker = IntegrityChecker::new();
        let result = checker
            .compute_hash(file_path.to_str().unwrap(), HashAlgorithm::Sha256)
            .await?;

        assert!(result.is_valid);
        assert!(result.error.is_none());
        assert_eq!(result.file_size, 13);
        assert!(!result.computed_hash.is_empty());

        // Verify known hash
        assert_eq!(
            result.computed_hash,
            "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"
        );

        println!("✅ Simple hashing test passed");
        Ok(())
    }

    #[tokio::test]
    async fn test_integrity_verification() -> AppResult<()> {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");

        std::fs::write(&file_path, b"Hello, World!").unwrap();

        let checker = IntegrityChecker::new();

        // Test valid hash
        let expected_hash = "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f";
        let result = checker
            .verify_integrity(
                file_path.to_str().unwrap(),
                expected_hash,
                HashAlgorithm::Sha256,
            )
            .await?;

        assert!(result.is_valid);
        assert_eq!(result.expected_hash, Some(expected_hash.to_string()));

        // Test invalid hash
        let wrong_hash = "0000000000000000000000000000000000000000000000000000000000000000";
        let result = checker
            .verify_integrity(
                file_path.to_str().unwrap(),
                wrong_hash,
                HashAlgorithm::Sha256,
            )
            .await?;

        assert!(!result.is_valid);
        assert_eq!(result.expected_hash, Some(wrong_hash.to_string()));

        println!("✅ Integrity verification test passed");
        Ok(())
    }

    #[tokio::test]
    async fn test_multi_hash() -> AppResult<()> {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");

        std::fs::write(&file_path, b"Hello, World!").unwrap();

        let checker = IntegrityChecker::new();
        let algorithms = vec![
            HashAlgorithm::Sha256,
            HashAlgorithm::Blake2s256,
            HashAlgorithm::Md5,
        ];

        let result = checker
            .compute_multi_hash(file_path.to_str().unwrap(), algorithms.clone())
            .await?;

        assert!(result.is_valid);
        assert_eq!(result.hash_results.len(), algorithms.len());

        for algorithm in algorithms {
            assert!(result.hash_results.contains_key(&algorithm));
            let hash_result = &result.hash_results[&algorithm];
            assert!(hash_result.is_valid);
            assert!(!hash_result.computed_hash.is_empty());
        }

        println!("✅ Multi-hash test passed");
        Ok(())
    }

    #[tokio::test]
    async fn test_progress_reporting() -> AppResult<()> {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("large_test.txt");

        // Create a larger file (1MB) to trigger progress reporting
        let mut file = std::fs::File::create(&file_path).unwrap();
        let data = vec![0u8; 1024 * 1024]; // 1MB
        file.write_all(&data).unwrap();

        let (progress_tx, mut progress_rx) = mpsc::unbounded_channel();

        let mut checker = IntegrityChecker::with_config(IntegrityConfig {
            progress_threshold: 512 * 1024, // 512KB threshold
            ..IntegrityConfig::default()
        });

        checker.set_progress_callback(progress_tx);

        // Start hashing in background
        let file_path_clone = file_path.to_str().unwrap().to_string();
        let hash_handle = tokio::spawn(async move {
            checker
                .compute_hash(&file_path_clone, HashAlgorithm::Sha256)
                .await
        });

        // Collect progress updates
        let mut progress_updates = Vec::new();
        let mut timeout_count = 0;
        const MAX_TIMEOUTS: i32 = 10;

        while timeout_count < MAX_TIMEOUTS {
            match tokio::time::timeout(Duration::from_millis(100), progress_rx.recv()).await {
                Ok(Some(progress)) => {
                    progress_updates.push(progress);
                    timeout_count = 0; // Reset timeout count
                }
                Ok(None) => break, // Channel closed
                Err(_) => {
                    timeout_count += 1; // Timeout occurred
                    if hash_handle.is_finished() {
                        break;
                    }
                }
            }
        }

        let result = hash_handle.await.unwrap()?;

        assert!(result.is_valid);
        assert!(!progress_updates.is_empty());

        // Verify progress makes sense
        for progress in &progress_updates {
            assert!(progress.progress_percent >= 0.0 && progress.progress_percent <= 100.0);
            assert!(progress.bytes_processed <= progress.total_size);
        }

        println!(
            "✅ Progress reporting test passed (updates: {})",
            progress_updates.len()
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_algorithm_detection() {
        use utils::*;

        // Test hash detection
        assert_eq!(
            detect_algorithm_from_hash("d41d8cd98f00b204e9800998ecf8427e"),
            Some(HashAlgorithm::Md5)
        );
        assert_eq!(
            detect_algorithm_from_hash("da39a3ee5e6b4b0d3255bfef95601890afd80709"),
            Some(HashAlgorithm::Sha1)
        );
        assert_eq!(
            detect_algorithm_from_hash(
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            ),
            Some(HashAlgorithm::Sha256)
        );

        // Test with prefixes
        assert_eq!(
            detect_algorithm_from_hash("md5:d41d8cd98f00b204e9800998ecf8427e"),
            Some(HashAlgorithm::Md5)
        );
        assert_eq!(
            detect_algorithm_from_hash(
                "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            ),
            Some(HashAlgorithm::Sha256)
        );

        // Test invalid
        assert_eq!(detect_algorithm_from_hash("invalid"), None);
        assert_eq!(detect_algorithm_from_hash(""), None);

        // Test validation
        assert!(is_valid_hash("deadbeef"));
        assert!(is_valid_hash("DEADBEEF"));
        assert!(!is_valid_hash("hello"));
        assert!(!is_valid_hash(""));

        println!("✅ Algorithm detection test passed");
    }

    #[tokio::test]
    async fn test_concurrent_hashing() -> AppResult<()> {
        let dir = tempdir().unwrap();

        // Create multiple test files
        let files = vec![
            ("file1.txt", b"Content 1"),
            ("file2.txt", b"Content 2"),
            ("file3.txt", b"Content 3"),
        ];

        for (name, content) in &files {
            let file_path = dir.path().join(name);
            std::fs::write(&file_path, content).unwrap();
        }

        let checker = IntegrityChecker::with_config(IntegrityConfig {
            concurrent: true,
            max_concurrent: 2,
            ..IntegrityConfig::default()
        });

        let mut handles = Vec::new();

        for (name, _) in &files {
            let file_path = dir.path().join(name);
            let checker_clone = checker.clone_for_task();

            let handle = tokio::spawn(async move {
                checker_clone
                    .compute_hash(file_path.to_str().unwrap(), HashAlgorithm::Sha256)
                    .await
            });

            handles.push(handle);
        }

        // Wait for all to complete
        let mut results = Vec::new();
        for handle in handles {
            let result = handle.await.unwrap()?;
            results.push(result);
        }

        // Verify all succeeded
        for result in &results {
            assert!(result.is_valid);
            assert!(result.error.is_none());
            assert!(!result.computed_hash.is_empty());
        }

        // Verify all hashes are different (different content)
        let hashes: std::collections::HashSet<_> =
            results.iter().map(|r| &r.computed_hash).collect();
        assert_eq!(hashes.len(), files.len());

        println!("✅ Concurrent hashing test passed");
        Ok(())
    }

    #[tokio::test]
    async fn test_error_handling() -> AppResult<()> {
        let checker = IntegrityChecker::new();

        // Test non-existent file
        let result = checker
            .compute_hash("/non/existent/file.txt", HashAlgorithm::Sha256)
            .await?;

        assert!(!result.is_valid);
        assert!(result.error.is_some());
        assert_eq!(result.file_size, 0);
        assert!(result.computed_hash.is_empty());

        println!("✅ Error handling test passed");
        Ok(())
    }
}
