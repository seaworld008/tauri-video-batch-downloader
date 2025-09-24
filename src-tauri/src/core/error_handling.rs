//! Advanced Error Handling and Retry Mechanism
//!
//! This module provides comprehensive error handling capabilities with sophisticated retry logic,
//! circuit breaker patterns, and contextual error reporting for the video downloader application.
//!
//! Key features:
//! - Exponential backoff with jitter
//! - Circuit breaker pattern for failing services
//! - Configurable retry policies per error type
//! - Rich error context and categorization
//! - Telemetry and metrics collection

use anyhow::{Context as AnyhowContext, Result as AnyhowResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::{Mutex, RwLock};
use tokio::time::sleep;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Maximum retry attempts allowed
pub const MAX_RETRY_ATTEMPTS: u32 = 10;

/// Default base delay for exponential backoff (100ms)
pub const DEFAULT_BASE_DELAY: Duration = Duration::from_millis(100);

/// Maximum delay cap for exponential backoff (30 seconds)
pub const MAX_DELAY_CAP: Duration = Duration::from_secs(30);

/// Circuit breaker failure threshold
pub const CIRCUIT_BREAKER_FAILURE_THRESHOLD: u32 = 5;

/// Circuit breaker recovery timeout (60 seconds)
pub const CIRCUIT_BREAKER_RECOVERY_TIMEOUT: Duration = Duration::from_secs(60);

/// Comprehensive error categories for the download system
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ErrorCategory {
    /// Network-related errors (DNS, connection, timeout)
    Network,
    /// Authentication and authorization errors
    Authentication,
    /// File system errors (permissions, disk space, IO)
    FileSystem,
    /// Protocol-specific errors (HTTP status codes, malformed responses)
    Protocol,
    /// Resource exhaustion (memory, bandwidth, concurrent limit)
    ResourceExhaustion,
    /// Configuration errors (invalid settings, missing parameters)
    Configuration,
    /// External service errors (server errors, rate limiting)
    ExternalService,
    /// Data integrity and validation errors
    DataIntegrity,
    /// Parsing and format errors
    Parsing,
    /// System-level errors (OS-specific issues)
    System,
}

/// Detailed error information with retry classification
#[derive(Debug, Clone, Error, serde::Serialize, serde::Deserialize)]
pub enum DownloadError {
    #[error("Network error: {message}")]
    Network {
        message: String,
        is_retryable: bool,
        category: ErrorCategory,
    },

    #[error("Authentication failed: {message}")]
    Authentication { message: String, is_retryable: bool },

    #[error("File system error: {message}")]
    FileSystem {
        message: String,
        is_retryable: bool,
        path: Option<String>,
    },

    #[error("Protocol error: {message} (code: {code:?})")]
    Protocol {
        message: String,
        code: Option<u16>,
        is_retryable: bool,
    },

    #[error("Resource exhaustion: {message}")]
    ResourceExhaustion {
        message: String,
        resource_type: String,
        is_retryable: bool,
    },

    #[error("Configuration error: {message}")]
    Configuration {
        message: String,
        parameter: Option<String>,
    },

    #[error("External service error: {message}")]
    ExternalService {
        message: String,
        service: String,
        is_retryable: bool,
        backoff_multiplier: f64,
    },

    #[error("Data integrity error: {message}")]
    DataIntegrity {
        message: String,
        expected: Option<String>,
        actual: Option<String>,
    },

    #[error("Parsing error: {message}")]
    Parsing {
        message: String,
        content_type: Option<String>,
        is_retryable: bool,
    },

    #[error("System error: {message}")]
    System {
        message: String,
        error_code: Option<i32>,
        is_retryable: bool,
    },
}

impl DownloadError {
    /// Determine if this error type should be retried
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Network { is_retryable, .. } => *is_retryable,
            Self::Authentication { is_retryable, .. } => *is_retryable,
            Self::FileSystem { is_retryable, .. } => *is_retryable,
            Self::Protocol { is_retryable, .. } => *is_retryable,
            Self::ResourceExhaustion { is_retryable, .. } => *is_retryable,
            Self::Configuration { .. } => false, // Configuration errors are not retryable
            Self::ExternalService { is_retryable, .. } => *is_retryable,
            Self::DataIntegrity { .. } => false, // Integrity errors are not retryable
            Self::Parsing { is_retryable, .. } => *is_retryable,
            Self::System { is_retryable, .. } => *is_retryable,
        }
    }

    /// Get the error category for this error
    pub fn category(&self) -> ErrorCategory {
        match self {
            Self::Network { category, .. } => category.clone(),
            Self::Authentication { .. } => ErrorCategory::Authentication,
            Self::FileSystem { .. } => ErrorCategory::FileSystem,
            Self::Protocol { .. } => ErrorCategory::Protocol,
            Self::ResourceExhaustion { .. } => ErrorCategory::ResourceExhaustion,
            Self::Configuration { .. } => ErrorCategory::Configuration,
            Self::ExternalService { .. } => ErrorCategory::ExternalService,
            Self::DataIntegrity { .. } => ErrorCategory::DataIntegrity,
            Self::Parsing { .. } => ErrorCategory::Parsing,
            Self::System { .. } => ErrorCategory::System,
        }
    }

    /// Get the backoff multiplier for this error type
    pub fn backoff_multiplier(&self) -> f64 {
        match self {
            Self::ExternalService {
                backoff_multiplier, ..
            } => *backoff_multiplier,
            Self::Network { .. } => 2.0, // Standard exponential backoff
            Self::ResourceExhaustion { .. } => 3.0, // Longer backoff for resource issues
            Self::Authentication { .. } => 1.5, // Shorter backoff for auth retries
            _ => 2.0,                    // Default exponential backoff
        }
    }
}

/// Retry strategy configuration
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Maximum number of retry attempts
    pub max_attempts: u32,
    /// Base delay for exponential backoff
    pub base_delay: Duration,
    /// Maximum delay cap
    pub max_delay: Duration,
    /// Backoff multiplier (typically 2.0 for exponential)
    pub backoff_multiplier: f64,
    /// Add random jitter to prevent thundering herd
    pub jitter_enabled: bool,
    /// Jitter factor (0.0 to 1.0)
    pub jitter_factor: f64,
    /// Error-specific retry policies
    pub category_policies: HashMap<ErrorCategory, CategoryRetryPolicy>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        let mut category_policies = HashMap::new();

        // Network errors: aggressive retry with exponential backoff
        category_policies.insert(
            ErrorCategory::Network,
            CategoryRetryPolicy {
                max_attempts: 5,
                base_delay: Duration::from_millis(200),
                backoff_multiplier: 2.0,
                circuit_breaker_enabled: true,
            },
        );

        // External service errors: moderate retry with longer delays
        category_policies.insert(
            ErrorCategory::ExternalService,
            CategoryRetryPolicy {
                max_attempts: 3,
                base_delay: Duration::from_secs(1),
                backoff_multiplier: 3.0,
                circuit_breaker_enabled: true,
            },
        );

        // Resource exhaustion: conservative retry
        category_policies.insert(
            ErrorCategory::ResourceExhaustion,
            CategoryRetryPolicy {
                max_attempts: 2,
                base_delay: Duration::from_secs(5),
                backoff_multiplier: 2.0,
                circuit_breaker_enabled: false,
            },
        );

        // Authentication: minimal retry to avoid account lockout
        category_policies.insert(
            ErrorCategory::Authentication,
            CategoryRetryPolicy {
                max_attempts: 1,
                base_delay: Duration::from_secs(2),
                backoff_multiplier: 1.0,
                circuit_breaker_enabled: false,
            },
        );

        Self {
            max_attempts: 3,
            base_delay: DEFAULT_BASE_DELAY,
            max_delay: MAX_DELAY_CAP,
            backoff_multiplier: 2.0,
            jitter_enabled: true,
            jitter_factor: 0.1,
            category_policies,
        }
    }
}

/// Category-specific retry policy
#[derive(Debug, Clone)]
pub struct CategoryRetryPolicy {
    pub max_attempts: u32,
    pub base_delay: Duration,
    pub backoff_multiplier: f64,
    pub circuit_breaker_enabled: bool,
}

/// Circuit breaker states
#[derive(Debug, Clone, PartialEq)]
pub enum CircuitBreakerState {
    /// Circuit is closed, allowing all requests
    Closed,
    /// Circuit is open, rejecting all requests
    Open,
    /// Circuit is half-open, allowing limited requests to test recovery
    HalfOpen,
}

/// Circuit breaker for preventing cascade failures
#[derive(Debug)]
pub struct CircuitBreaker {
    /// Current state of the circuit breaker
    state: Arc<RwLock<CircuitBreakerState>>,
    /// Failure count in current window
    failure_count: Arc<Mutex<u32>>,
    /// Success count since half-open state
    success_count: Arc<Mutex<u32>>,
    /// Timestamp of last state change
    last_failure_time: Arc<Mutex<Option<Instant>>>,
    /// Configuration
    config: CircuitBreakerConfig,
}

/// Circuit breaker configuration
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    /// Number of failures to trigger open state
    pub failure_threshold: u32,
    /// Number of successes needed to close from half-open
    pub success_threshold: u32,
    /// Timeout before attempting half-open state
    pub recovery_timeout: Duration,
    /// Time window for failure counting
    pub failure_window: Duration,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            success_threshold: 3,
            recovery_timeout: CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
            failure_window: Duration::from_secs(5 * 60),
        }
    }
}

impl CircuitBreaker {
    /// Create a new circuit breaker with the given configuration
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            state: Arc::new(RwLock::new(CircuitBreakerState::Closed)),
            failure_count: Arc::new(Mutex::new(0)),
            success_count: Arc::new(Mutex::new(0)),
            last_failure_time: Arc::new(Mutex::new(None)),
            config,
        }
    }

    /// Execute a function with circuit breaker protection
    pub async fn call<F, T, E>(&self, f: F) -> Result<T, CircuitBreakerError<E>>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: std::error::Error + Send + Sync + 'static,
    {
        // Check if circuit is open and should remain open
        let should_attempt = match self.should_attempt_call().await {
            Ok(should_attempt) => should_attempt,
            Err(CircuitBreakerError::CircuitOpen) => return Err(CircuitBreakerError::CircuitOpen),
            Err(CircuitBreakerError::CallFailed(_)) => {
                return Err(CircuitBreakerError::CircuitOpen)
            } // Map to circuit open
        };
        if !should_attempt {
            return Err(CircuitBreakerError::CircuitOpen);
        }

        // Execute the function
        match f.await {
            Ok(result) => {
                self.record_success().await;
                Ok(result)
            }
            Err(error) => {
                self.record_failure().await;
                Err(CircuitBreakerError::CallFailed(error))
            }
        }
    }

    /// Check if a call should be attempted
    async fn should_attempt_call(&self) -> Result<bool, CircuitBreakerError<()>> {
        let state = self.state.read().await;
        match *state {
            CircuitBreakerState::Closed => Ok(true),
            CircuitBreakerState::HalfOpen => Ok(true), // Allow limited calls in half-open
            CircuitBreakerState::Open => {
                drop(state); // Release read lock

                // Check if recovery timeout has passed
                let last_failure = self.last_failure_time.lock().await;
                if let Some(last_time) = *last_failure {
                    if last_time.elapsed() >= self.config.recovery_timeout {
                        drop(last_failure); // Release mutex

                        // Transition to half-open state
                        let mut state = self.state.write().await;
                        *state = CircuitBreakerState::HalfOpen;

                        // Reset success count
                        let mut success_count = self.success_count.lock().await;
                        *success_count = 0;

                        info!("Circuit breaker transitioning to half-open state");
                        return Ok(true);
                    }
                }
                Ok(false)
            }
        }
    }

    /// Record a successful call
    async fn record_success(&self) {
        let state = self.state.read().await;
        match *state {
            CircuitBreakerState::HalfOpen => {
                drop(state); // Release read lock

                let mut success_count = self.success_count.lock().await;
                *success_count += 1;

                if *success_count >= self.config.success_threshold {
                    // Transition to closed state
                    drop(success_count); // Release mutex

                    let mut state = self.state.write().await;
                    *state = CircuitBreakerState::Closed;

                    // Reset failure count
                    let mut failure_count = self.failure_count.lock().await;
                    *failure_count = 0;

                    info!("Circuit breaker transitioning to closed state after recovery");
                }
            }
            _ => {} // Success in closed state doesn't require action
        }
    }

    /// Record a failed call
    async fn record_failure(&self) {
        let mut failure_count = self.failure_count.lock().await;
        *failure_count += 1;

        let mut last_failure_time = self.last_failure_time.lock().await;
        *last_failure_time = Some(Instant::now());

        if *failure_count >= self.config.failure_threshold {
            drop(failure_count); // Release mutex
            drop(last_failure_time); // Release mutex

            // Transition to open state
            let mut state = self.state.write().await;
            if *state != CircuitBreakerState::Open {
                *state = CircuitBreakerState::Open;
                warn!(
                    "Circuit breaker opening due to {} failures",
                    self.config.failure_threshold
                );
            }
        }
    }

    /// Get current circuit breaker state
    pub async fn state(&self) -> CircuitBreakerState {
        self.state.read().await.clone()
    }

    /// Get current failure count
    pub async fn failure_count(&self) -> u32 {
        *self.failure_count.lock().await
    }
}

/// Circuit breaker error types
#[derive(Debug, Error)]
pub enum CircuitBreakerError<E> {
    #[error("Circuit breaker is open, rejecting calls")]
    CircuitOpen,

    #[error("Function call failed: {0}")]
    CallFailed(#[from] E),
}

/// Retry context information
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RetryContext {
    /// Unique identifier for this retry attempt
    pub attempt_id: String,
    /// Current attempt number (1-based)
    pub attempt_number: u32,
    /// Total elapsed time for all attempts
    pub total_elapsed: Duration,
    /// Delay before this attempt
    pub delay_before_attempt: Duration,
    /// Previous error (if any)
    pub previous_error: Option<String>,
    /// Error category being retried
    pub error_category: Option<ErrorCategory>,
}

/// Comprehensive retry executor with circuit breaker integration
pub struct RetryExecutor {
    /// Retry policy configuration
    policy: RetryPolicy,
    /// Circuit breakers per error category
    circuit_breakers: HashMap<ErrorCategory, Arc<CircuitBreaker>>,
    /// Retry statistics
    stats: Arc<RwLock<RetryStats>>,
}

/// Retry execution statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RetryStats {
    /// Total number of retry attempts made
    pub total_attempts: u64,
    /// Total number of successful executions after retries
    pub total_successes: u64,
    /// Total number of final failures (after all retries exhausted)
    pub total_failures: u64,
    /// Average number of attempts per execution
    pub average_attempts: f64,
    /// Statistics per error category
    pub category_stats: HashMap<ErrorCategory, CategoryRetryStats>,
}

/// Category-specific retry statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CategoryRetryStats {
    pub attempts: u64,
    pub successes: u64,
    pub failures: u64,
    pub circuit_breaker_opens: u64,
    pub average_delay: Duration,
}

impl RetryExecutor {
    /// Create a new retry executor with the given policy
    pub fn new(policy: RetryPolicy) -> Self {
        let mut circuit_breakers = HashMap::new();

        // Create circuit breakers for categories that have them enabled
        for (category, category_policy) in &policy.category_policies {
            if category_policy.circuit_breaker_enabled {
                let config = CircuitBreakerConfig {
                    failure_threshold: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
                    success_threshold: 3,
                    recovery_timeout: CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
                    failure_window: Duration::from_secs(5 * 60), // 5 minutes
                };
                circuit_breakers.insert(category.clone(), Arc::new(CircuitBreaker::new(config)));
            }
        }

        Self {
            policy,
            circuit_breakers,
            stats: Arc::new(RwLock::new(RetryStats::default())),
        }
    }

    /// Execute a function with full retry logic and circuit breaker protection
    pub async fn execute<F, T, E>(&self, mut f: F) -> AnyhowResult<T>
    where
        F: FnMut(
            RetryContext,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, DownloadError>> + Send>,
        >,
        T: Send + 'static,
        E: std::error::Error + Send + Sync + 'static,
    {
        let start_time = Instant::now();
        let attempt_id = Uuid::new_v4().to_string();
        let mut last_error: Option<DownloadError> = None;

        for attempt in 1..=self.policy.max_attempts {
            let retry_context = RetryContext {
                attempt_id: attempt_id.clone(),
                attempt_number: attempt,
                total_elapsed: start_time.elapsed(),
                delay_before_attempt: Duration::from_millis(0), // Will be set if delay occurs
                previous_error: last_error.as_ref().map(|e| e.to_string()),
                error_category: last_error.as_ref().map(|e| e.category()),
            };

            // Update attempt statistics
            self.update_attempt_stats().await;

            debug!("Executing attempt {} for {}", attempt, attempt_id);

            // Execute the function
            match f(retry_context.clone()).await {
                Ok(result) => {
                    // Success - update statistics and return
                    self.update_success_stats(last_error.as_ref().map(|e| e.category()))
                        .await;
                    info!(
                        "Execution succeeded on attempt {} for {}",
                        attempt, attempt_id
                    );
                    return Ok(result);
                }
                Err(error) => {
                    warn!("Attempt {} failed for {}: {}", attempt, attempt_id, error);

                    // Check if error is retryable
                    if !error.is_retryable() {
                        self.update_failure_stats(Some(error.category())).await;
                        return Err(anyhow::Error::from(error)).with_context(|| {
                            format!("Non-retryable error on attempt {}", attempt)
                        });
                    }

                    // If this is the last attempt, fail
                    if attempt >= self.policy.max_attempts {
                        self.update_failure_stats(Some(error.category())).await;
                        return Err(anyhow::Error::from(error.clone())).with_context(|| {
                            format!("All {} retry attempts exhausted", self.policy.max_attempts)
                        });
                    }

                    // Check circuit breaker for this error category
                    let error_category = error.category();
                    if let Some(circuit_breaker) = self.circuit_breakers.get(&error_category) {
                        if circuit_breaker.state().await == CircuitBreakerState::Open {
                            self.update_failure_stats(Some(error_category)).await;
                            return Err(anyhow::Error::from(error))
                                .with_context(|| "Circuit breaker is open, aborting retries");
                        }
                    }

                    // Calculate delay for next attempt
                    let delay = self.calculate_delay(&error, attempt).await;

                    info!(
                        "Retrying in {:?} (attempt {}/{})",
                        delay,
                        attempt + 1,
                        self.policy.max_attempts
                    );

                    // Apply delay
                    if delay > Duration::from_millis(0) {
                        sleep(delay).await;
                    }

                    last_error = Some(error);
                }
            }
        }

        // This should not be reached due to the loop logic above
        unreachable!("Retry loop should have returned or failed before reaching this point");
    }

    /// Calculate delay for the next retry attempt
    async fn calculate_delay(&self, error: &DownloadError, attempt: u32) -> Duration {
        let base_delay =
            if let Some(category_policy) = self.policy.category_policies.get(&error.category()) {
                category_policy.base_delay
            } else {
                self.policy.base_delay
            };

        let backoff_multiplier = error.backoff_multiplier();
        let delay_ms = base_delay.as_millis() as f64 * backoff_multiplier.powi(attempt as i32 - 1);
        let mut delay = Duration::from_millis(delay_ms as u64);

        // Apply maximum delay cap
        if delay > self.policy.max_delay {
            delay = self.policy.max_delay;
        }

        // Apply jitter if enabled
        if self.policy.jitter_enabled {
            let jitter = delay.as_millis() as f64
                * self.policy.jitter_factor
                * (rand::random::<f64>() - 0.5);
            let jittered_delay = delay.as_millis() as i64 + jitter as i64;
            delay = Duration::from_millis(jittered_delay.max(0) as u64);
        }

        delay
    }

    /// Update attempt statistics
    async fn update_attempt_stats(&self) {
        let mut stats = self.stats.write().await;
        stats.total_attempts += 1;
    }

    /// Update success statistics
    async fn update_success_stats(&self, category: Option<ErrorCategory>) {
        let mut stats = self.stats.write().await;
        stats.total_successes += 1;

        if let Some(cat) = category {
            let category_stats = stats.category_stats.entry(cat).or_default();
            category_stats.successes += 1;
        }
    }

    /// Update failure statistics
    async fn update_failure_stats(&self, category: Option<ErrorCategory>) {
        let mut stats = self.stats.write().await;
        stats.total_failures += 1;

        if let Some(cat) = category {
            let category_stats = stats.category_stats.entry(cat).or_default();
            category_stats.failures += 1;
        }
    }

    /// Get current retry statistics
    pub async fn get_stats(&self) -> RetryStats {
        self.stats.read().await.clone()
    }

    /// Reset retry statistics
    pub async fn reset_stats(&self) {
        let mut stats = self.stats.write().await;
        *stats = RetryStats::default();
    }

    /// Get circuit breaker state for a category
    pub async fn get_circuit_breaker_state(
        &self,
        category: &ErrorCategory,
    ) -> Option<CircuitBreakerState> {
        if let Some(breaker) = self.circuit_breakers.get(category) {
            Some(breaker.state().await)
        } else {
            None
        }
    }
}

/// Convenience functions for creating common error types
pub mod errors {
    use super::*;

    pub fn network_error(message: impl Into<String>, is_retryable: bool) -> DownloadError {
        DownloadError::Network {
            message: message.into(),
            is_retryable,
            category: ErrorCategory::Network,
        }
    }

    pub fn authentication_error(message: impl Into<String>, is_retryable: bool) -> DownloadError {
        DownloadError::Authentication {
            message: message.into(),
            is_retryable,
        }
    }

    pub fn filesystem_error(
        message: impl Into<String>,
        path: Option<String>,
        is_retryable: bool,
    ) -> DownloadError {
        DownloadError::FileSystem {
            message: message.into(),
            path,
            is_retryable,
        }
    }

    pub fn protocol_error(
        message: impl Into<String>,
        code: Option<u16>,
        is_retryable: bool,
    ) -> DownloadError {
        DownloadError::Protocol {
            message: message.into(),
            code,
            is_retryable,
        }
    }

    pub fn resource_exhaustion_error(
        message: impl Into<String>,
        resource_type: impl Into<String>,
        is_retryable: bool,
    ) -> DownloadError {
        DownloadError::ResourceExhaustion {
            message: message.into(),
            resource_type: resource_type.into(),
            is_retryable,
        }
    }

    pub fn external_service_error(
        message: impl Into<String>,
        service: impl Into<String>,
        is_retryable: bool,
        backoff_multiplier: f64,
    ) -> DownloadError {
        DownloadError::ExternalService {
            message: message.into(),
            service: service.into(),
            is_retryable,
            backoff_multiplier,
        }
    }

    pub fn data_integrity_error(
        message: impl Into<String>,
        expected: Option<String>,
        actual: Option<String>,
    ) -> DownloadError {
        DownloadError::DataIntegrity {
            message: message.into(),
            expected,
            actual,
        }
    }

    pub fn configuration_error(
        message: impl Into<String>,
        parameter: Option<String>,
    ) -> DownloadError {
        DownloadError::Configuration {
            message: message.into(),
            parameter,
        }
    }

    pub fn parsing_error(
        message: impl Into<String>,
        content_type: Option<String>,
        is_retryable: bool,
    ) -> DownloadError {
        DownloadError::Parsing {
            message: message.into(),
            content_type,
            is_retryable,
        }
    }

    pub fn system_error(
        message: impl Into<String>,
        error_code: Option<i32>,
        is_retryable: bool,
    ) -> DownloadError {
        DownloadError::System {
            message: message.into(),
            error_code,
            is_retryable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_circuit_breaker_states() {
        let config = CircuitBreakerConfig {
            failure_threshold: 2,
            success_threshold: 2,
            recovery_timeout: Duration::from_millis(100),
            failure_window: Duration::from_secs(60),
        };

        let breaker = CircuitBreaker::new(config);

        // Initially closed
        assert_eq!(breaker.state().await, CircuitBreakerState::Closed);

        // Simulate failures to open circuit
        let result1: Result<(), &str> = Err("error");
        let _ = breaker.call(async { result1 }).await;

        let result2: Result<(), &str> = Err("error");
        let _ = breaker.call(async { result2 }).await;

        // Should be open now
        assert_eq!(breaker.state().await, CircuitBreakerState::Open);

        // Wait for recovery timeout
        sleep(Duration::from_millis(150)).await;

        // Should allow call and transition to half-open
        let result3: Result<(), &str> = Ok(());
        let _ = breaker.call(async { result3 }).await;
        assert_eq!(breaker.state().await, CircuitBreakerState::HalfOpen);

        // Another success should close the circuit
        let result4: Result<(), &str> = Ok(());
        let _ = breaker.call(async { result4 }).await;
        assert_eq!(breaker.state().await, CircuitBreakerState::Closed);
    }

    #[tokio::test]
    async fn test_retry_executor_with_recoverable_errors() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay: Duration::from_millis(10),
            ..Default::default()
        };

        let executor = RetryExecutor::new(policy);
        let mut call_count = 0;

        let result = executor
            .execute(|_ctx| {
                call_count += 1;
                Box::pin(async move {
                    if call_count < 3 {
                        Err(errors::network_error("Temporary failure", true))
                    } else {
                        Ok("Success".to_string())
                    }
                })
            })
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Success");
        assert_eq!(call_count, 3);
    }

    #[tokio::test]
    async fn test_retry_executor_with_non_retryable_errors() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay: Duration::from_millis(10),
            ..Default::default()
        };

        let executor = RetryExecutor::new(policy);
        let mut call_count = 0;

        let result = executor
            .execute(|_ctx| {
                call_count += 1;
                Box::pin(async move { Err(errors::configuration_error("Invalid config", None)) })
            })
            .await;

        assert!(result.is_err());
        assert_eq!(call_count, 1); // Should not retry non-retryable errors
    }

    #[tokio::test]
    async fn test_error_categorization() {
        let network_err = errors::network_error("DNS failure", true);
        assert_eq!(network_err.category(), ErrorCategory::Network);
        assert!(network_err.is_retryable());

        let config_err =
            errors::configuration_error("Missing parameter", Some("api_key".to_string()));
        assert_eq!(config_err.category(), ErrorCategory::Configuration);
        assert!(!config_err.is_retryable());

        let integrity_err = errors::data_integrity_error(
            "Hash mismatch",
            Some("expected_hash".to_string()),
            Some("actual_hash".to_string()),
        );
        assert_eq!(integrity_err.category(), ErrorCategory::DataIntegrity);
        assert!(!integrity_err.is_retryable());
    }

    #[tokio::test]
    async fn test_backoff_calculation() {
        let policy = RetryPolicy::default();
        let executor = RetryExecutor::new(policy);

        let network_error = errors::network_error("Test error", true);
        let delay1 = executor.calculate_delay(&network_error, 1).await;
        let delay2 = executor.calculate_delay(&network_error, 2).await;

        // Second delay should be longer due to exponential backoff
        assert!(delay2 > delay1);
    }
}
