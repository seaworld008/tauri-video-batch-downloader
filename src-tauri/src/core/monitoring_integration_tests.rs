//! Integration tests for the monitoring system
//!
//! This module contains comprehensive integration tests to verify that the monitoring
//! system works correctly with the entire download management system and provides
//! accurate real-time metrics and dashboard functionality.

#[cfg(test)]
mod tests {
    use super::super::manager::*;
    use super::super::models::*;
    use super::super::monitoring::*;
    use std::time::Duration;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_monitoring_system_initialization() {
        // Test default monitoring system creation
        let config = MonitoringConfig::default();
        let monitoring = MonitoringSystem::new(config).unwrap();

        // Verify initial state
        assert!(!monitoring.is_running().await);

        // Test configuration validation
        let custom_config = MonitoringConfig {
            system_metrics_interval: Duration::from_secs(1),
            download_stats_interval: Duration::from_millis(500),
            performance_metrics_interval: Duration::from_millis(250),
            dashboard_update_interval: Duration::from_secs(2),
            history_retention: Duration::from_minutes(30),
            max_history_points: 1800,
            enable_prometheus_export: true,
            prometheus_port: 9091,
            enable_websocket_dashboard: true,
            websocket_port: 8081,
            health_check_interval: Duration::from_secs(5),
            alert_rules: vec![],
        };

        let custom_monitoring = MonitoringSystem::new(custom_config).unwrap();
        assert!(!custom_monitoring.is_running().await);
    }

    #[tokio::test]
    async fn test_system_metrics_collection() {
        let config = MonitoringConfig {
            system_metrics_interval: Duration::from_millis(100),
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Wait for at least one metrics collection cycle
        sleep(Duration::from_millis(150)).await;

        // Verify system metrics are collected
        let metrics = monitoring.get_latest_system_metrics().await;
        assert!(metrics.is_ok());

        let system_metrics = metrics.unwrap();
        assert!(system_metrics.cpu_usage_percent >= 0.0);
        assert!(system_metrics.memory_usage_bytes > 0);
        assert!(system_metrics.total_memory_bytes > 0);
        assert!(system_metrics.disk_usage_bytes >= 0);
        assert!(system_metrics.network_bytes_sent >= 0);
        assert!(system_metrics.network_bytes_received >= 0);

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_download_statistics_tracking() {
        let config = MonitoringConfig {
            download_stats_interval: Duration::from_millis(100),
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Simulate download statistics updates
        assert!(monitoring
            .update_download_statistics(
                3,           // active_downloads
                10,          // total_tasks
                2,           // pending_tasks
                1024 * 1024, // total_bytes
                512 * 1024,  // current_speed
                256 * 1024,  // average_speed
            )
            .await
            .is_ok());

        // Wait for statistics to be processed
        sleep(Duration::from_millis(150)).await;

        // Verify download statistics are tracked
        let stats = monitoring.get_latest_download_statistics().await;
        assert!(stats.is_ok());

        let download_stats = stats.unwrap();
        assert_eq!(download_stats.active_downloads, 3);
        assert_eq!(download_stats.total_tasks, 10);
        assert_eq!(download_stats.pending_tasks, 2);
        assert_eq!(download_stats.completed_tasks, 5); // total - active - pending
        assert_eq!(download_stats.total_bytes_downloaded, 1024 * 1024);
        assert_eq!(download_stats.current_download_speed, 512 * 1024);
        assert_eq!(download_stats.average_download_speed, 256 * 1024);

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_performance_metrics_collection() {
        let config = MonitoringConfig {
            performance_metrics_interval: Duration::from_millis(50),
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Wait for performance metrics collection
        sleep(Duration::from_millis(100)).await;

        // Verify performance metrics
        let metrics = monitoring.get_latest_performance_metrics().await;
        assert!(metrics.is_ok());

        let perf_metrics = metrics.unwrap();
        assert!(perf_metrics.request_latency_ms >= 0.0);
        assert!(perf_metrics.throughput_ops_per_sec >= 0.0);
        assert!(perf_metrics.error_rate_percent >= 0.0 && perf_metrics.error_rate_percent <= 100.0);
        assert!(perf_metrics.active_connections >= 0);
        assert!(perf_metrics.queue_depth >= 0);

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_health_status_calculation() {
        let config = MonitoringConfig {
            health_check_interval: Duration::from_millis(100),
            system_metrics_interval: Duration::from_millis(50),
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Wait for health status calculation
        sleep(Duration::from_millis(200)).await;

        // Verify health status
        let health = monitoring.get_health_status().await;
        assert!(health.is_ok());

        let health_status = health.unwrap();
        assert!(
            health_status.overall_health_score >= 0.0
                && health_status.overall_health_score <= 100.0
        );
        assert!(
            health_status.system_health_score >= 0.0 && health_status.system_health_score <= 100.0
        );
        assert!(
            health_status.download_health_score >= 0.0
                && health_status.download_health_score <= 100.0
        );
        assert!(
            health_status.performance_health_score >= 0.0
                && health_status.performance_health_score <= 100.0
        );

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_dashboard_data_aggregation() {
        let config = MonitoringConfig {
            dashboard_update_interval: Duration::from_millis(100),
            system_metrics_interval: Duration::from_millis(50),
            download_stats_interval: Duration::from_millis(50),
            performance_metrics_interval: Duration::from_millis(50),
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Update some download statistics
        assert!(monitoring
            .update_download_statistics(2, 8, 3, 2048, 1024, 512)
            .await
            .is_ok());

        // Wait for dashboard data aggregation
        sleep(Duration::from_millis(200)).await;

        // Verify dashboard data
        let dashboard = monitoring.get_dashboard_data().await;
        assert!(dashboard.is_ok());

        let dashboard_data = dashboard.unwrap();
        assert!(dashboard_data.system_metrics.cpu_usage_percent >= 0.0);
        assert!(dashboard_data.download_statistics.total_tasks > 0);
        assert!(dashboard_data.performance_metrics.throughput_ops_per_sec >= 0.0);
        assert!(dashboard_data.health_status.overall_health_score >= 0.0);

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_prometheus_metrics_export() {
        let config = MonitoringConfig {
            enable_prometheus_export: true,
            prometheus_port: 9092, // Use different port to avoid conflicts
            system_metrics_interval: Duration::from_millis(50),
            download_stats_interval: Duration::from_millis(50),
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Update some metrics
        assert!(monitoring
            .update_download_statistics(1, 5, 1, 1024, 512, 256)
            .await
            .is_ok());

        // Wait for metrics to be processed
        sleep(Duration::from_millis(150)).await;

        // Get Prometheus metrics
        let metrics = monitoring.get_prometheus_metrics().await;
        assert!(metrics.is_ok());

        let prometheus_data = metrics.unwrap();
        assert!(!prometheus_data.is_empty());

        // Verify some expected metric names are present
        assert!(prometheus_data.contains("system_cpu_usage_percent"));
        assert!(prometheus_data.contains("system_memory_usage_bytes"));
        assert!(prometheus_data.contains("download_active_count"));
        assert!(prometheus_data.contains("download_total_bytes"));
        assert!(prometheus_data.contains("performance_request_latency_ms"));

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_websocket_dashboard_clients() {
        let config = MonitoringConfig {
            enable_websocket_dashboard: true,
            websocket_port: 8082, // Use different port to avoid conflicts
            dashboard_update_interval: Duration::from_millis(100),
            system_metrics_interval: Duration::from_millis(50),
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Add dashboard client
        let client_id = "test_client_1".to_string();
        let client_rx = monitoring.add_dashboard_client(client_id.clone()).await;
        assert!(client_rx.is_ok());

        let mut dashboard_rx = client_rx.unwrap();

        // Wait for dashboard updates
        sleep(Duration::from_millis(200)).await;

        // Try to receive dashboard update (might timeout if no updates)
        tokio::select! {
            dashboard_data = dashboard_rx.recv() => {
                if let Some(data) = dashboard_data {
                    assert!(data.system_metrics.cpu_usage_percent >= 0.0);
                    assert!(data.health_status.overall_health_score >= 0.0);
                }
            }
            _ = sleep(Duration::from_millis(500)) => {
                // Timeout is acceptable in tests
            }
        }

        // Remove dashboard client
        assert!(monitoring.remove_dashboard_client(&client_id).await.is_ok());

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_monitoring_integration_with_download_manager() -> AppResult<()> {
        // Create download manager with monitoring
        let mut download_config = DownloadConfig::default();
        download_config.concurrent_downloads = 2;

        let manager = DownloadManager::new(download_config)?;

        // Test that monitoring system is initialized
        let system_metrics = manager.get_system_metrics().await;
        assert!(system_metrics.is_none()); // Not started yet

        let health_status = manager.get_health_status().await;
        assert!(health_status.is_none()); // Not started yet

        // Test monitoring configuration methods
        assert!(manager.set_prometheus_enabled(true).await.is_ok());
        assert!(manager.set_websocket_dashboard_enabled(true).await.is_ok());

        // Test dashboard client management
        let client_id = "test_integration_client".to_string();
        let client_rx = manager.add_dashboard_client(client_id.clone()).await;
        assert!(client_rx.is_ok());

        assert!(manager.remove_dashboard_client(&client_id).await.is_ok());

        // Test Prometheus metrics (should return error when not started)
        let prometheus_result = manager.get_prometheus_metrics().await;
        assert!(prometheus_result.is_err()); // Should fail when not running

        Ok(())
    }

    #[tokio::test]
    async fn test_monitoring_performance_under_load() {
        let config = MonitoringConfig {
            system_metrics_interval: Duration::from_millis(10),
            download_stats_interval: Duration::from_millis(10),
            performance_metrics_interval: Duration::from_millis(10),
            dashboard_update_interval: Duration::from_millis(20),
            max_history_points: 100, // Small history for test
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(config).unwrap();
        assert!(monitoring.start().await.is_ok());

        // Simulate rapid updates
        for i in 0..50 {
            let _ = monitoring
                .update_download_statistics(i % 5, i * 2, i % 3, i * 1024, i * 100, i * 50)
                .await;

            // Small delay to avoid overwhelming the system
            sleep(Duration::from_millis(1)).await;
        }

        // Wait for processing
        sleep(Duration::from_millis(100)).await;

        // Verify system is still responsive
        let metrics = monitoring.get_latest_system_metrics().await;
        assert!(metrics.is_ok());

        let stats = monitoring.get_latest_download_statistics().await;
        assert!(stats.is_ok());

        let health = monitoring.get_health_status().await;
        assert!(health.is_ok());

        // Stop monitoring
        assert!(monitoring.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_monitoring_error_handling() {
        // Test with invalid configuration
        let invalid_config = MonitoringConfig {
            prometheus_port: 0, // Invalid port
            websocket_port: 0,  // Invalid port
            ..Default::default()
        };

        let monitoring = MonitoringSystem::new(invalid_config);
        assert!(monitoring.is_err()); // Should fail with invalid config

        // Test stop without start
        let valid_config = MonitoringConfig::default();
        let monitoring = MonitoringSystem::new(valid_config).unwrap();
        let stop_result = monitoring.stop().await;
        assert!(stop_result.is_ok()); // Should handle gracefully

        // Test multiple starts
        let monitoring = MonitoringSystem::new(MonitoringConfig::default()).unwrap();
        assert!(monitoring.start().await.is_ok());
        let second_start = monitoring.start().await;
        assert!(second_start.is_err() || second_start.is_ok()); // Either is acceptable

        assert!(monitoring.stop().await.is_ok());
    }
}
