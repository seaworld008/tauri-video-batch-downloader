//! Integration tests for the error handling and retry mechanism
//!
//! This module contains comprehensive integration tests to verify that the error handling
//! and retry system works correctly with the entire download management system.

#[cfg(test)]
mod tests {
    use super::super::error_handling::*;
    use super::super::manager::*;
    use super::super::models::*;
    use std::time::Duration;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_retry_policy_configuration() {
        // Test default retry policy
        let default_policy = RetryPolicy::default();
        assert_eq!(default_policy.max_attempts, 3);
        assert_eq!(default_policy.backoff_multiplier, 2.0);
        assert!(default_policy.jitter_enabled);

        // Verify category-specific policies
        assert!(default_policy
            .category_policies
            .contains_key(&ErrorCategory::Network));
        assert!(default_policy
            .category_policies
            .contains_key(&ErrorCategory::ExternalService));
        assert!(default_policy
            .category_policies
            .contains_key(&ErrorCategory::ResourceExhaustion));
        assert!(default_policy
            .category_policies
            .contains_key(&ErrorCategory::Authentication));

        // Test network policy specifics
        let network_policy = default_policy
            .category_policies
            .get(&ErrorCategory::Network)
            .unwrap();
        assert_eq!(network_policy.max_attempts, 5);
        assert!(network_policy.circuit_breaker_enabled);
    }

    #[tokio::test]
    async fn test_circuit_breaker_functionality() {
        let config = CircuitBreakerConfig {
            failure_threshold: 2,
            success_threshold: 1,
            recovery_timeout: Duration::from_millis(50),
            failure_window: Duration::from_secs(10),
        };

        let breaker = CircuitBreaker::new(config);

        // Initially closed
        assert_eq!(breaker.state().await, CircuitBreakerState::Closed);

        // Simulate failures
        let result1: Result<(), &str> = Err("failure 1");
        let _ = breaker.call(async { result1 }).await;
        assert_eq!(breaker.state().await, CircuitBreakerState::Closed);

        let result2: Result<(), &str> = Err("failure 2");
        let _ = breaker.call(async { result2 }).await;
        assert_eq!(breaker.state().await, CircuitBreakerState::Open);

        // Should reject calls while open
        let result3: Result<(), &str> = Ok(());
        match breaker.call(async { result3 }).await {
            Err(CircuitBreakerError::CircuitOpen) => {
                // Expected behavior
            }
            _ => panic!("Expected circuit breaker to be open"),
        }

        // Wait for recovery timeout
        sleep(Duration::from_millis(60)).await;

        // Should allow call and transition to half-open
        let result4: Result<(), &str> = Ok(());
        let _ = breaker.call(async { result4 }).await;
        assert_eq!(breaker.state().await, CircuitBreakerState::Closed);
    }

    #[tokio::test]
    async fn test_error_categorization_and_retry_logic() {
        // Test network error - should be retryable
        let network_error = errors::network_error("DNS timeout", true);
        assert_eq!(network_error.category(), ErrorCategory::Network);
        assert!(network_error.is_retryable());
        assert_eq!(network_error.backoff_multiplier(), 2.0);

        // Test authentication error - should have limited retries
        let auth_error = errors::authentication_error("Invalid token", true);
        assert_eq!(auth_error.category(), ErrorCategory::Authentication);
        assert!(auth_error.is_retryable());
        assert_eq!(auth_error.backoff_multiplier(), 1.5);

        // Test configuration error - should not be retryable
        let config_error =
            errors::configuration_error("Missing API key", Some("api_key".to_string()));
        assert_eq!(config_error.category(), ErrorCategory::Configuration);
        assert!(!config_error.is_retryable());

        // Test external service error - should have aggressive backoff
        let service_error =
            errors::external_service_error("Rate limited", "api_service", true, 3.0);
        assert_eq!(service_error.category(), ErrorCategory::ExternalService);
        assert!(service_error.is_retryable());
        assert_eq!(service_error.backoff_multiplier(), 3.0);

        // Test resource exhaustion - should be retryable with longer delays
        let resource_error = errors::resource_exhaustion_error("Out of memory", "memory", true);
        assert_eq!(resource_error.category(), ErrorCategory::ResourceExhaustion);
        assert!(resource_error.is_retryable());

        // Test data integrity error - should not be retryable
        let integrity_error = errors::data_integrity_error(
            "Hash mismatch",
            Some("expected_hash".to_string()),
            Some("actual_hash".to_string()),
        );
        assert_eq!(integrity_error.category(), ErrorCategory::DataIntegrity);
        assert!(!integrity_error.is_retryable());

        // Test file system error
        let fs_error = errors::filesystem_error(
            "Permission denied",
            Some("/path/to/file".to_string()),
            false,
        );
        assert_eq!(fs_error.category(), ErrorCategory::FileSystem);
        assert!(!fs_error.is_retryable());

        // Test parsing error
        let parse_error =
            errors::parsing_error("Invalid JSON", Some("application/json".to_string()), false);
        assert_eq!(parse_error.category(), ErrorCategory::Parsing);
        assert!(!parse_error.is_retryable());

        // Test system error
        let sys_error = errors::system_error("System call failed", Some(-1), true);
        assert_eq!(sys_error.category(), ErrorCategory::System);
        assert!(sys_error.is_retryable());
    }

    #[tokio::test]
    async fn test_retry_executor_success_after_failures() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay: Duration::from_millis(10),
            max_delay: Duration::from_secs(1),
            backoff_multiplier: 2.0,
            jitter_enabled: false, // Disable jitter for predictable testing
            jitter_factor: 0.0,
            category_policies: Default::default(),
        };

        let executor = RetryExecutor::new(policy);
        let mut attempt_count = 0;

        let result = executor
            .execute(|ctx| {
                attempt_count += 1;
                Box::pin(async move {
                    if ctx.attempt_number < 3 {
                        Err(errors::network_error(
                            format!("Attempt {}", ctx.attempt_number),
                            true,
                        ))
                    } else {
                        Ok(format!("Success on attempt {}", ctx.attempt_number))
                    }
                })
            })
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Success on attempt 3");
        assert_eq!(attempt_count, 3);
    }

    #[tokio::test]
    async fn test_retry_executor_immediate_failure_on_non_retryable() {
        let policy = RetryPolicy {
            max_attempts: 3,
            base_delay: Duration::from_millis(10),
            ..Default::default()
        };

        let executor = RetryExecutor::new(policy);
        let mut attempt_count = 0;

        let result = executor
            .execute(|_ctx| {
                attempt_count += 1;
                Box::pin(
                    async move { Err(errors::configuration_error("Invalid configuration", None)) },
                )
            })
            .await;

        assert!(result.is_err());
        assert_eq!(attempt_count, 1); // Should not retry non-retryable errors
    }

    #[tokio::test]
    async fn test_retry_executor_statistics() {
        let executor = RetryExecutor::new(RetryPolicy::default());

        // Initial stats should be zero
        let stats = executor.get_stats().await;
        assert_eq!(stats.total_attempts, 0);
        assert_eq!(stats.total_successes, 0);
        assert_eq!(stats.total_failures, 0);

        // Execute a successful operation
        let _result = executor
            .execute(|_ctx| Box::pin(async move { Ok("success".to_string()) }))
            .await;

        // Verify stats updated
        let stats_after = executor.get_stats().await;
        assert_eq!(stats_after.total_attempts, 1);
        assert_eq!(stats_after.total_successes, 1);

        // Execute a failing operation
        let _result = executor
            .execute(|_ctx| {
                Box::pin(async move { Err(errors::network_error("Permanent failure", false)) })
            })
            .await;

        // Verify failure stats
        let stats_final = executor.get_stats().await;
        assert_eq!(stats_final.total_attempts, 2);
        assert_eq!(stats_final.total_successes, 1);
        assert_eq!(stats_final.total_failures, 1);

        // Reset stats
        executor.reset_stats().await;
        let stats_reset = executor.get_stats().await;
        assert_eq!(stats_reset.total_attempts, 0);
        assert_eq!(stats_reset.total_successes, 0);
        assert_eq!(stats_reset.total_failures, 0);
    }

    #[tokio::test]
    async fn test_backoff_delay_calculation() {
        let policy = RetryPolicy {
            max_attempts: 5,
            base_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(2),
            backoff_multiplier: 2.0,
            jitter_enabled: false,
            jitter_factor: 0.0,
            category_policies: Default::default(),
        };

        let executor = RetryExecutor::new(policy);

        // Test delay calculation for different error types
        let network_error = errors::network_error("Test error", true);

        let delay1 = executor.calculate_delay(&network_error, 1).await;
        let delay2 = executor.calculate_delay(&network_error, 2).await;
        let delay3 = executor.calculate_delay(&network_error, 3).await;

        // Delays should increase exponentially
        assert!(delay2 > delay1);
        assert!(delay3 > delay2);

        // Test that delays respect the maximum cap
        let delay_large = executor.calculate_delay(&network_error, 10).await;
        assert!(delay_large <= Duration::from_secs(2));
    }

    #[tokio::test]
    async fn test_download_manager_error_integration() -> AppResult<()> {
        // Create a download manager with retry configuration
        let mut config = DownloadConfig::default();
        config.retry_attempts = 3;

        let manager = DownloadManager::new(config)?;

        // Test retry stats access
        let stats = manager.get_retry_stats().await;
        assert_eq!(stats.total_attempts, 0);

        // Test circuit breaker state access
        let network_state = manager
            .get_circuit_breaker_state(ErrorCategory::Network)
            .await;
        assert!(network_state.is_some());

        let config_state = manager
            .get_circuit_breaker_state(ErrorCategory::Configuration)
            .await;
        assert!(config_state.is_none());

        // Test error conversion functionality
        let app_error = AppError::Network("Connection failed".to_string());
        let download_error = DownloadManager::convert_app_error_to_download_error(app_error);
        assert_eq!(download_error.category(), ErrorCategory::Network);
        assert!(download_error.is_retryable());

        Ok(())
    }

    #[tokio::test]
    async fn test_error_pattern_recognition() {
        // Test various error patterns that should be converted correctly
        let test_cases = vec![
            (
                AppError::Download("HTTP 429 Too Many Requests".to_string()),
                ErrorCategory::ExternalService,
                true,
            ),
            (
                AppError::Download("HTTP 404 Not Found".to_string()),
                ErrorCategory::Protocol,
                false,
            ),
            (
                AppError::Download("HTTP 500 Internal Server Error".to_string()),
                ErrorCategory::ExternalService,
                true,
            ),
            (
                AppError::Download("Connection timeout".to_string()),
                ErrorCategory::Network,
                true,
            ),
            (
                AppError::Download("DNS resolution failed".to_string()),
                ErrorCategory::Network,
                true,
            ),
            (
                AppError::Download("Permission denied".to_string()),
                ErrorCategory::FileSystem,
                false,
            ),
            (
                AppError::Download("No space left on device".to_string()),
                ErrorCategory::ResourceExhaustion,
                false,
            ),
            (
                AppError::Config("Invalid API key".to_string()),
                ErrorCategory::Configuration,
                false,
            ),
            (
                AppError::Parse("Invalid JSON format".to_string()),
                ErrorCategory::Parsing,
                false,
            ),
        ];

        for (app_error, expected_category, expected_retryable) in test_cases {
            let download_error = DownloadManager::convert_app_error_to_download_error(app_error);
            assert_eq!(
                download_error.category(),
                expected_category,
                "Category mismatch for error: {:?}",
                download_error
            );
            assert_eq!(
                download_error.is_retryable(),
                expected_retryable,
                "Retryable mismatch for error: {:?}",
                download_error
            );
        }
    }
}
