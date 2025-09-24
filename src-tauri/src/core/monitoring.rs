//! Real-time Monitoring and Statistics Dashboard
//!
//! This module provides comprehensive real-time monitoring capabilities for the video downloader,
//! including system metrics, download statistics, performance monitoring, and dashboard functionality.
//!
//! Key features:
//! - Real-time system resource monitoring (CPU, Memory, Network, Disk)
//! - Download performance metrics and statistics
//! - Error tracking and analysis
//! - Live dashboard with WebSocket streaming
//! - Prometheus-compatible metrics export
//! - Historical data aggregation and analysis

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{CpuExt, DiskExt, NetworkExt, System, SystemExt};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::{interval, sleep};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::core::error_handling::{ErrorCategory, RetryStats};
use crate::core::models::{AppError, AppResult, TaskStatus};
use crate::core::progress_tracker::{EnhancedProgressStats, GlobalProgressStats};

/// Monitoring system configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringConfig {
    /// Enable system metrics collection
    pub system_metrics_enabled: bool,
    /// System metrics collection interval in seconds
    pub system_metrics_interval: u64,
    /// Enable download statistics collection
    pub download_stats_enabled: bool,
    /// Download statistics update interval in seconds
    pub download_stats_interval: u64,
    /// Enable performance monitoring
    pub performance_monitoring_enabled: bool,
    /// Performance monitoring interval in seconds
    pub performance_monitoring_interval: u64,
    /// Enable real-time dashboard
    pub dashboard_enabled: bool,
    /// Dashboard update interval in milliseconds
    pub dashboard_update_interval: u64,
    /// Enable Prometheus metrics export
    pub prometheus_export_enabled: bool,
    /// Prometheus export port
    pub prometheus_export_port: u16,
    /// Historical data retention period in hours
    pub data_retention_hours: u64,
    /// Maximum number of historical data points to keep
    pub max_historical_points: usize,
}

impl Default for MonitoringConfig {
    fn default() -> Self {
        Self {
            system_metrics_enabled: true,
            system_metrics_interval: 5, // 5 seconds
            download_stats_enabled: true,
            download_stats_interval: 1, // 1 second
            performance_monitoring_enabled: true,
            performance_monitoring_interval: 2, // 2 seconds
            dashboard_enabled: true,
            dashboard_update_interval: 500, // 500ms
            prometheus_export_enabled: true,
            prometheus_export_port: 9090,
            data_retention_hours: 24,    // 24 hours
            max_historical_points: 1440, // 1 minute intervals for 24 hours
        }
    }
}

/// System resource metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    /// Timestamp when metrics were collected
    pub timestamp: u64,
    /// CPU usage percentage (0.0-100.0)
    pub cpu_usage: f32,
    /// Memory usage in bytes
    pub memory_used: u64,
    /// Total available memory in bytes
    pub memory_total: u64,
    /// Memory usage percentage (0.0-100.0)
    pub memory_usage: f32,
    /// Disk usage in bytes
    pub disk_used: u64,
    /// Total disk space in bytes
    pub disk_total: u64,
    /// Disk usage percentage (0.0-100.0)
    pub disk_usage: f32,
    /// Network bytes received
    pub network_rx_bytes: u64,
    /// Network bytes transmitted
    pub network_tx_bytes: u64,
    /// Network bytes received per second
    pub network_rx_rate: f64,
    /// Network bytes transmitted per second
    pub network_tx_rate: f64,
    /// Number of active network connections
    pub active_connections: u32,
}

/// Download statistics snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatistics {
    /// Timestamp when statistics were collected
    pub timestamp: u64,
    /// Total number of download tasks
    pub total_tasks: usize,
    /// Number of pending tasks
    pub pending_tasks: usize,
    /// Number of active downloads
    pub active_downloads: usize,
    /// Number of completed downloads
    pub completed_downloads: usize,
    /// Number of failed downloads
    pub failed_downloads: usize,
    /// Number of paused downloads
    pub paused_downloads: usize,
    /// Number of cancelled downloads
    pub cancelled_downloads: usize,
    /// Total bytes downloaded
    pub total_bytes_downloaded: u64,
    /// Current aggregate download speed (bytes/sec)
    pub current_speed: f64,
    /// Average download speed over time (bytes/sec)
    pub average_speed: f64,
    /// Peak download speed recorded (bytes/sec)
    pub peak_speed: f64,
    /// Success rate percentage (0.0-100.0)
    pub success_rate: f32,
    /// Average download duration in seconds
    pub average_duration: f64,
    /// Download statistics by file size ranges
    pub size_distribution: FileSizeDistribution,
    /// Download statistics by error category
    pub error_distribution: HashMap<ErrorCategory, u64>,
}

/// File size distribution statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSizeDistribution {
    /// Files < 1MB
    pub small_files: u64,
    /// Files 1MB - 10MB
    pub medium_files: u64,
    /// Files 10MB - 100MB
    pub large_files: u64,
    /// Files > 100MB
    pub huge_files: u64,
}

/// Performance monitoring metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    /// Timestamp when metrics were collected
    pub timestamp: u64,
    /// Download throughput in downloads per second
    pub download_throughput: f64,
    /// Task processing rate
    pub task_processing_rate: f64,
    /// Average task queue length
    pub average_queue_length: f32,
    /// Memory usage by the application in bytes
    pub app_memory_usage: u64,
    /// Number of active threads
    pub active_threads: u32,
    /// CPU usage by the application percentage
    pub app_cpu_usage: f32,
    /// Database operation latency in milliseconds
    pub db_latency: f64,
    /// File I/O operations per second
    pub io_operations_per_sec: f64,
    /// Network latency in milliseconds
    pub network_latency: f64,
}

/// Historical data point for time-series analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoricalDataPoint<T> {
    /// Timestamp of the data point
    pub timestamp: u64,
    /// The actual data value
    pub value: T,
}

/// Time-series data container
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSeries<T> {
    /// Data points in chronological order
    pub data_points: Vec<HistoricalDataPoint<T>>,
    /// Maximum number of points to retain
    pub max_points: usize,
}

impl<T> TimeSeries<T> {
    pub fn new(max_points: usize) -> Self {
        Self {
            data_points: Vec::with_capacity(max_points),
            max_points,
        }
    }

    pub fn add_point(&mut self, timestamp: u64, value: T) {
        self.data_points
            .push(HistoricalDataPoint { timestamp, value });

        // Remove oldest points if we exceed the limit
        if self.data_points.len() > self.max_points {
            self.data_points.remove(0);
        }
    }

    pub fn get_latest(&self) -> Option<&HistoricalDataPoint<T>> {
        self.data_points.last()
    }

    pub fn get_range(
        &self,
        start_timestamp: u64,
        end_timestamp: u64,
    ) -> Vec<&HistoricalDataPoint<T>> {
        self.data_points
            .iter()
            .filter(|point| point.timestamp >= start_timestamp && point.timestamp <= end_timestamp)
            .collect()
    }

    pub fn clear_old_data(&mut self, cutoff_timestamp: u64) {
        self.data_points
            .retain(|point| point.timestamp > cutoff_timestamp);
    }
}

/// Live dashboard data aggregating all monitoring information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardData {
    /// Current system metrics
    pub system_metrics: SystemMetrics,
    /// Current download statistics
    pub download_stats: DownloadStatistics,
    /// Current performance metrics
    pub performance_metrics: PerformanceMetrics,
    /// Retry mechanism statistics
    pub retry_stats: RetryStats,
    /// Global progress statistics
    pub global_progress: GlobalProgressStats,
    /// Active download details
    pub active_downloads: Vec<EnhancedProgressStats>,
    /// Recent error events
    pub recent_errors: Vec<ErrorEvent>,
    /// System health status
    pub health_status: HealthStatus,
}

/// Error event information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    /// Unique error event ID
    pub id: String,
    /// Timestamp when error occurred
    pub timestamp: u64,
    /// Task ID associated with the error
    pub task_id: String,
    /// Error category
    pub category: ErrorCategory,
    /// Error message
    pub message: String,
    /// Whether the error was retried
    pub was_retried: bool,
    /// Number of retry attempts made
    pub retry_attempts: u32,
}

/// System health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    /// Overall system health score (0.0-1.0)
    pub overall_health: f32,
    /// CPU health status
    pub cpu_health: ComponentHealth,
    /// Memory health status
    pub memory_health: ComponentHealth,
    /// Disk health status
    pub disk_health: ComponentHealth,
    /// Network health status
    pub network_health: ComponentHealth,
    /// Download system health status
    pub download_health: ComponentHealth,
}

/// Individual component health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentHealth {
    /// Health status
    pub status: HealthLevel,
    /// Health score (0.0-1.0)
    pub score: f32,
    /// Description or warning message
    pub message: Option<String>,
}

/// Health level enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HealthLevel {
    /// Everything is operating normally
    Healthy,
    /// Minor issues, still functional
    Warning,
    /// Significant issues affecting performance
    Critical,
    /// System is failing or non-functional
    Failure,
}

/// Real-time monitoring system manager
pub struct MonitoringSystem {
    /// Configuration for the monitoring system
    config: MonitoringConfig,
    /// Historical system metrics
    system_metrics_history: Arc<RwLock<TimeSeries<SystemMetrics>>>,
    /// Historical download statistics
    download_stats_history: Arc<RwLock<TimeSeries<DownloadStatistics>>>,
    /// Historical performance metrics
    performance_metrics_history: Arc<RwLock<TimeSeries<PerformanceMetrics>>>,
    /// Recent error events
    recent_errors: Arc<RwLock<Vec<ErrorEvent>>>,
    /// WebSocket clients for live dashboard updates
    dashboard_clients: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<DashboardData>>>>,
    /// Background monitoring tasks
    monitoring_tasks: Vec<tokio::task::JoinHandle<()>>,
    /// System information provider
    system_info: Arc<Mutex<sysinfo::System>>,
    /// Network statistics baseline
    network_baseline: Arc<RwLock<Option<(u64, u64, Instant)>>>, // rx_bytes, tx_bytes, timestamp
    /// Performance baseline for calculations
    performance_baseline: Arc<RwLock<Option<PerformanceBaseline>>>,
    /// Running flag
    is_running: Arc<RwLock<bool>>,
}

/// Performance calculation baseline
#[derive(Debug, Clone)]
struct PerformanceBaseline {
    timestamp: Instant,
    total_downloads: u64,
    total_tasks_processed: u64,
    total_bytes: u64,
}

impl MonitoringSystem {
    /// Create a new monitoring system with the given configuration
    pub fn new(config: MonitoringConfig) -> Self {
        let max_points = config.max_historical_points;

        Self {
            config,
            system_metrics_history: Arc::new(RwLock::new(TimeSeries::new(max_points))),
            download_stats_history: Arc::new(RwLock::new(TimeSeries::new(max_points))),
            performance_metrics_history: Arc::new(RwLock::new(TimeSeries::new(max_points))),
            recent_errors: Arc::new(RwLock::new(Vec::new())),
            dashboard_clients: Arc::new(RwLock::new(HashMap::new())),
            monitoring_tasks: Vec::new(),
            system_info: Arc::new(Mutex::new(sysinfo::System::new_all())),
            network_baseline: Arc::new(RwLock::new(None)),
            performance_baseline: Arc::new(RwLock::new(None)),
            is_running: Arc::new(RwLock::new(false)),
        }
    }

    /// Start the monitoring system
    pub async fn start(&mut self) -> AppResult<()> {
        let mut is_running = self.is_running.write().await;
        if *is_running {
            warn!("Monitoring system is already running");
            return Ok(());
        }

        info!("🔍 Starting real-time monitoring system");
        *is_running = true;

        // Initialize system info
        {
            let mut sys = self.system_info.lock().await;
            sys.refresh_all();
        }

        // Start system metrics monitoring
        if self.config.system_metrics_enabled {
            let task = self.start_system_metrics_monitoring().await;
            self.monitoring_tasks.push(task);
        }

        // Start download statistics monitoring
        if self.config.download_stats_enabled {
            let task = self.start_download_stats_monitoring().await;
            self.monitoring_tasks.push(task);
        }

        // Start performance monitoring
        if self.config.performance_monitoring_enabled {
            let task = self.start_performance_monitoring().await;
            self.monitoring_tasks.push(task);
        }

        // Start dashboard update broadcasting
        if self.config.dashboard_enabled {
            let task = self.start_dashboard_broadcasting().await;
            self.monitoring_tasks.push(task);
        }

        // Start data cleanup task
        let cleanup_task = self.start_data_cleanup_task().await;
        self.monitoring_tasks.push(cleanup_task);

        info!("✅ Monitoring system started successfully");
        Ok(())
    }

    /// Stop the monitoring system
    pub async fn stop(&mut self) -> AppResult<()> {
        let mut is_running = self.is_running.write().await;
        if !*is_running {
            return Ok(());
        }

        info!("🛑 Stopping monitoring system");
        *is_running = false;

        // Cancel all background tasks
        for task in self.monitoring_tasks.drain(..) {
            task.abort();
        }

        // Clear dashboard clients
        {
            let mut clients = self.dashboard_clients.write().await;
            clients.clear();
        }

        info!("✅ Monitoring system stopped");
        Ok(())
    }

    /// Start system metrics monitoring task
    async fn start_system_metrics_monitoring(&self) -> tokio::task::JoinHandle<()> {
        let interval_duration = Duration::from_secs(self.config.system_metrics_interval);
        let system_info = Arc::clone(&self.system_info);
        let metrics_history = Arc::clone(&self.system_metrics_history);
        let network_baseline = Arc::clone(&self.network_baseline);
        let is_running = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let mut interval_timer = interval(interval_duration);

            loop {
                interval_timer.tick().await;

                if !*is_running.read().await {
                    break;
                }

                match Self::collect_system_metrics(&system_info, &network_baseline).await {
                    Ok(metrics) => {
                        let mut history = metrics_history.write().await;
                        history.add_point(metrics.timestamp, metrics);
                        debug!("System metrics collected and stored");
                    }
                    Err(e) => {
                        error!("Failed to collect system metrics: {}", e);
                    }
                }
            }
        })
    }

    /// Start download statistics monitoring task
    async fn start_download_stats_monitoring(&self) -> tokio::task::JoinHandle<()> {
        let interval_duration = Duration::from_secs(self.config.download_stats_interval);
        let stats_history = Arc::clone(&self.download_stats_history);
        let is_running = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let mut interval_timer = interval(interval_duration);

            loop {
                interval_timer.tick().await;

                if !*is_running.read().await {
                    break;
                }

                // This would typically interface with the DownloadManager
                // For now, we create a placeholder implementation
                match Self::collect_download_statistics().await {
                    Ok(stats) => {
                        let mut history = stats_history.write().await;
                        history.add_point(stats.timestamp, stats);
                        debug!("Download statistics collected and stored");
                    }
                    Err(e) => {
                        error!("Failed to collect download statistics: {}", e);
                    }
                }
            }
        })
    }

    /// Start performance monitoring task
    async fn start_performance_monitoring(&self) -> tokio::task::JoinHandle<()> {
        let interval_duration = Duration::from_secs(self.config.performance_monitoring_interval);
        let performance_history = Arc::clone(&self.performance_metrics_history);
        let performance_baseline = Arc::clone(&self.performance_baseline);
        let is_running = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let mut interval_timer = interval(interval_duration);

            loop {
                interval_timer.tick().await;

                if !*is_running.read().await {
                    break;
                }

                match Self::collect_performance_metrics(&performance_baseline).await {
                    Ok(metrics) => {
                        let mut history = performance_history.write().await;
                        history.add_point(metrics.timestamp, metrics);
                        debug!("Performance metrics collected and stored");
                    }
                    Err(e) => {
                        error!("Failed to collect performance metrics: {}", e);
                    }
                }
            }
        })
    }

    /// Start dashboard broadcasting task
    async fn start_dashboard_broadcasting(&self) -> tokio::task::JoinHandle<()> {
        let interval_duration = Duration::from_millis(self.config.dashboard_update_interval);
        let system_metrics_history = Arc::clone(&self.system_metrics_history);
        let download_stats_history = Arc::clone(&self.download_stats_history);
        let performance_metrics_history = Arc::clone(&self.performance_metrics_history);
        let recent_errors = Arc::clone(&self.recent_errors);
        let dashboard_clients = Arc::clone(&self.dashboard_clients);
        let is_running = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let mut interval_timer = interval(interval_duration);

            loop {
                interval_timer.tick().await;

                if !*is_running.read().await {
                    break;
                }

                // Collect latest data from all sources
                let dashboard_data = Self::compile_dashboard_data(
                    &system_metrics_history,
                    &download_stats_history,
                    &performance_metrics_history,
                    &recent_errors,
                )
                .await;

                match dashboard_data {
                    Ok(data) => {
                        // Broadcast to all connected dashboard clients
                        let clients = dashboard_clients.read().await;
                        let mut disconnected_clients = Vec::new();
                        let client_count = clients.len(); // Store count before potential drop

                        for (client_id, sender) in clients.iter() {
                            if sender.send(data.clone()).is_err() {
                                disconnected_clients.push(client_id.clone());
                            }
                        }

                        // Remove disconnected clients
                        if !disconnected_clients.is_empty() {
                            drop(clients); // Release read lock
                            let mut clients_mut = dashboard_clients.write().await;
                            for client_id in disconnected_clients {
                                clients_mut.remove(&client_id);
                                debug!("Removed disconnected dashboard client: {}", client_id);
                            }
                        }

                        debug!("Dashboard data broadcasted to {} clients", client_count);
                    }
                    Err(e) => {
                        error!("Failed to compile dashboard data: {}", e);
                    }
                }
            }
        })
    }

    /// Start data cleanup task
    async fn start_data_cleanup_task(&self) -> tokio::task::JoinHandle<()> {
        let cleanup_interval = Duration::from_secs(3600); // Clean up every hour
        let retention_hours = self.config.data_retention_hours;
        let system_metrics_history = Arc::clone(&self.system_metrics_history);
        let download_stats_history = Arc::clone(&self.download_stats_history);
        let performance_metrics_history = Arc::clone(&self.performance_metrics_history);
        let recent_errors = Arc::clone(&self.recent_errors);
        let is_running = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let mut interval_timer = interval(cleanup_interval);

            loop {
                interval_timer.tick().await;

                if !*is_running.read().await {
                    break;
                }

                let cutoff_time = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    - (retention_hours * 3600);

                // Clean up historical data
                {
                    let mut sys_history = system_metrics_history.write().await;
                    sys_history.clear_old_data(cutoff_time);
                }

                {
                    let mut dl_history = download_stats_history.write().await;
                    dl_history.clear_old_data(cutoff_time);
                }

                {
                    let mut perf_history = performance_metrics_history.write().await;
                    perf_history.clear_old_data(cutoff_time);
                }

                // Clean up old error events
                {
                    let mut errors = recent_errors.write().await;
                    errors.retain(|error| error.timestamp > cutoff_time);
                }

                info!(
                    "Data cleanup completed, removed data older than {} hours",
                    retention_hours
                );
            }
        })
    }

    /// Collect system metrics
    async fn collect_system_metrics(
        system_info: &Arc<Mutex<sysinfo::System>>,
        network_baseline: &Arc<RwLock<Option<(u64, u64, Instant)>>>,
    ) -> AppResult<SystemMetrics> {
        let mut sys = system_info.lock().await;
        sys.refresh_all();

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Get CPU usage - simplified approach
        sys.refresh_cpu();
        let cpu_usage = sys.global_cpu_info().cpu_usage();

        // Get memory usage
        let memory_used = sys.used_memory();
        let memory_total = sys.total_memory();
        let memory_usage = if memory_total > 0 {
            (memory_used as f32 / memory_total as f32) * 100.0
        } else {
            0.0
        };

        // Get disk usage (for the root filesystem)
        let mut disk_used = 0;
        let mut disk_total = 0;

        // Get disk usage - simplified approach
        sys.refresh_disks();
        for disk in sys.disks() {
            disk_total += disk.total_space();
            disk_used += (disk.total_space() - disk.available_space());
        }
        // Fallback to placeholder values if no disks found
        if disk_total == 0 {
            disk_total = 1000000000000; // 1TB placeholder
            disk_used = 500000000000; // 500GB placeholder
        }
        let disk_usage = if disk_total > 0 {
            (disk_used as f32 / disk_total as f32) * 100.0
        } else {
            0.0
        };

        // Calculate network rates
        let mut network_rx_bytes: u64 = 0;
        let mut network_tx_bytes: u64 = 0;
        let mut active_connections = 0;

        // Get network usage - simplified approach
        sys.refresh_networks();
        for (_, data) in sys.networks() {
            network_rx_bytes += data.received();
            network_tx_bytes += data.transmitted();
        }

        // Calculate network rates
        let (network_rx_rate, network_tx_rate) = {
            let mut baseline = network_baseline.write().await;
            match baseline.as_ref() {
                Some((prev_rx, prev_tx, prev_time)) => {
                    let time_diff = prev_time.elapsed().as_secs_f64();
                    if time_diff > 0.0 {
                        let rx_rate =
                            (network_rx_bytes.saturating_sub(*prev_rx) as f64) / time_diff;
                        let tx_rate =
                            (network_tx_bytes.saturating_sub(*prev_tx) as f64) / time_diff;
                        *baseline = Some((network_rx_bytes, network_tx_bytes, Instant::now()));
                        (rx_rate, tx_rate)
                    } else {
                        (0.0, 0.0)
                    }
                }
                None => {
                    *baseline = Some((network_rx_bytes, network_tx_bytes, Instant::now()));
                    (0.0, 0.0)
                }
            }
        };

        // Estimate active connections (simplified)
        sys.refresh_processes();
        active_connections = sys.processes().len() as u32;

        Ok(SystemMetrics {
            timestamp,
            cpu_usage,
            memory_used,
            memory_total,
            memory_usage,
            disk_used,
            disk_total,
            disk_usage,
            network_rx_bytes,
            network_tx_bytes,
            network_rx_rate,
            network_tx_rate,
            active_connections,
        })
    }

    /// Collect download statistics (placeholder implementation)
    async fn collect_download_statistics() -> AppResult<DownloadStatistics> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // This would typically interface with the actual DownloadManager
        // For now, we provide placeholder values
        Ok(DownloadStatistics {
            timestamp,
            total_tasks: 0,
            pending_tasks: 0,
            active_downloads: 0,
            completed_downloads: 0,
            failed_downloads: 0,
            paused_downloads: 0,
            cancelled_downloads: 0,
            total_bytes_downloaded: 0,
            current_speed: 0.0,
            average_speed: 0.0,
            peak_speed: 0.0,
            success_rate: 100.0,
            average_duration: 0.0,
            size_distribution: FileSizeDistribution {
                small_files: 0,
                medium_files: 0,
                large_files: 0,
                huge_files: 0,
            },
            error_distribution: HashMap::new(),
        })
    }

    /// Collect performance metrics (placeholder implementation)
    async fn collect_performance_metrics(
        performance_baseline: &Arc<RwLock<Option<PerformanceBaseline>>>,
    ) -> AppResult<PerformanceMetrics> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Initialize baseline if not exists
        {
            let mut baseline = performance_baseline.write().await;
            if baseline.is_none() {
                *baseline = Some(PerformanceBaseline {
                    timestamp: Instant::now(),
                    total_downloads: 0,
                    total_tasks_processed: 0,
                    total_bytes: 0,
                });
            }
        }

        // This would typically calculate real performance metrics
        // For now, we provide placeholder values
        Ok(PerformanceMetrics {
            timestamp,
            download_throughput: 0.0,
            task_processing_rate: 0.0,
            average_queue_length: 0.0,
            app_memory_usage: 0,
            active_threads: 1,
            app_cpu_usage: 0.0,
            db_latency: 0.0,
            io_operations_per_sec: 0.0,
            network_latency: 0.0,
        })
    }

    /// Compile dashboard data from all sources
    async fn compile_dashboard_data(
        system_metrics_history: &Arc<RwLock<TimeSeries<SystemMetrics>>>,
        download_stats_history: &Arc<RwLock<TimeSeries<DownloadStatistics>>>,
        performance_metrics_history: &Arc<RwLock<TimeSeries<PerformanceMetrics>>>,
        recent_errors: &Arc<RwLock<Vec<ErrorEvent>>>,
    ) -> AppResult<DashboardData> {
        // Get latest data from each source
        let system_metrics = {
            let history = system_metrics_history.read().await;
            history
                .get_latest()
                .map(|p| p.value.clone())
                .unwrap_or_else(|| SystemMetrics {
                    timestamp: 0,
                    cpu_usage: 0.0,
                    memory_used: 0,
                    memory_total: 0,
                    memory_usage: 0.0,
                    disk_used: 0,
                    disk_total: 0,
                    disk_usage: 0.0,
                    network_rx_bytes: 0,
                    network_tx_bytes: 0,
                    network_rx_rate: 0.0,
                    network_tx_rate: 0.0,
                    active_connections: 0,
                })
        };

        let download_stats = {
            let history = download_stats_history.read().await;
            history
                .get_latest()
                .map(|p| p.value.clone())
                .unwrap_or_else(|| DownloadStatistics {
                    timestamp: 0,
                    total_tasks: 0,
                    pending_tasks: 0,
                    active_downloads: 0,
                    completed_downloads: 0,
                    failed_downloads: 0,
                    paused_downloads: 0,
                    cancelled_downloads: 0,
                    total_bytes_downloaded: 0,
                    current_speed: 0.0,
                    average_speed: 0.0,
                    peak_speed: 0.0,
                    success_rate: 100.0,
                    average_duration: 0.0,
                    size_distribution: FileSizeDistribution {
                        small_files: 0,
                        medium_files: 0,
                        large_files: 0,
                        huge_files: 0,
                    },
                    error_distribution: HashMap::new(),
                })
        };

        let performance_metrics = {
            let history = performance_metrics_history.read().await;
            history
                .get_latest()
                .map(|p| p.value.clone())
                .unwrap_or_else(|| PerformanceMetrics {
                    timestamp: 0,
                    download_throughput: 0.0,
                    task_processing_rate: 0.0,
                    average_queue_length: 0.0,
                    app_memory_usage: 0,
                    active_threads: 1,
                    app_cpu_usage: 0.0,
                    db_latency: 0.0,
                    io_operations_per_sec: 0.0,
                    network_latency: 0.0,
                })
        };

        let errors = recent_errors.read().await.clone();

        // Calculate health status
        let health_status =
            Self::calculate_health_status(&system_metrics, &download_stats, &performance_metrics);

        Ok(DashboardData {
            system_metrics,
            download_stats,
            performance_metrics,
            retry_stats: RetryStats::default(), // Would be injected from DownloadManager
            global_progress: GlobalProgressStats {
                total_tasks: 0,
                active_tasks: 0,
                completed_tasks: 0,
                total_downloaded_bytes: 0,
                total_size_bytes: 0,
                aggregate_current_speed: 0.0,
                average_speed_all_tasks: 0.0,
                global_throughput_efficiency: 0.0,
            }, // Would be injected from ProgressTracker
            active_downloads: Vec::new(),       // Would be injected from ProgressTracker
            recent_errors: errors,
            health_status,
        })
    }

    /// Calculate system health status
    fn calculate_health_status(
        system_metrics: &SystemMetrics,
        download_stats: &DownloadStatistics,
        performance_metrics: &PerformanceMetrics,
    ) -> HealthStatus {
        // Calculate component health scores
        let cpu_health = Self::calculate_component_health(
            system_metrics.cpu_usage as f32,
            80.0,
            95.0,
            "CPU usage",
        );

        let memory_health = Self::calculate_component_health(
            system_metrics.memory_usage,
            85.0,
            95.0,
            "Memory usage",
        );

        let disk_health =
            Self::calculate_component_health(system_metrics.disk_usage, 90.0, 98.0, "Disk usage");

        let network_health = ComponentHealth {
            status: HealthLevel::Healthy,
            score: 1.0,
            message: None,
        };

        let download_health = if download_stats.total_tasks > 0 {
            ComponentHealth {
                status: if download_stats.success_rate >= 90.0 {
                    HealthLevel::Healthy
                } else if download_stats.success_rate >= 70.0 {
                    HealthLevel::Warning
                } else {
                    HealthLevel::Critical
                },
                score: download_stats.success_rate / 100.0,
                message: Some(format!("Success rate: {:.1}%", download_stats.success_rate)),
            }
        } else {
            ComponentHealth {
                status: HealthLevel::Healthy,
                score: 1.0,
                message: Some("No active downloads".to_string()),
            }
        };

        // Calculate overall health
        let overall_health = (cpu_health.score
            + memory_health.score
            + disk_health.score
            + network_health.score
            + download_health.score)
            / 5.0;

        HealthStatus {
            overall_health,
            cpu_health,
            memory_health,
            disk_health,
            network_health,
            download_health,
        }
    }

    /// Calculate individual component health
    fn calculate_component_health(
        usage: f32,
        warning_threshold: f32,
        critical_threshold: f32,
        component_name: &str,
    ) -> ComponentHealth {
        let (status, message) = if usage >= critical_threshold {
            (
                HealthLevel::Critical,
                Some(format!(
                    "{} is critically high: {:.1}%",
                    component_name, usage
                )),
            )
        } else if usage >= warning_threshold {
            (
                HealthLevel::Warning,
                Some(format!("{} is elevated: {:.1}%", component_name, usage)),
            )
        } else {
            (HealthLevel::Healthy, None)
        };

        let score = if usage >= critical_threshold {
            0.2
        } else if usage >= warning_threshold {
            0.6
        } else {
            1.0 - (usage / 100.0) * 0.4 // Gradually decrease score as usage increases
        };

        ComponentHealth {
            status,
            score,
            message,
        }
    }

    /// Register a dashboard client for real-time updates
    pub async fn register_dashboard_client(
        &self,
        client_id: String,
    ) -> mpsc::UnboundedReceiver<DashboardData> {
        let (sender, receiver) = mpsc::unbounded_channel();

        {
            let mut clients = self.dashboard_clients.write().await;
            clients.insert(client_id.clone(), sender);
        }

        info!("Dashboard client registered: {}", client_id);
        receiver
    }

    /// Unregister a dashboard client
    pub async fn unregister_dashboard_client(&self, client_id: &str) {
        let mut clients = self.dashboard_clients.write().await;
        clients.remove(client_id);
        info!("Dashboard client unregistered: {}", client_id);
    }

    /// Add an error event to the monitoring system
    pub async fn record_error_event(
        &self,
        task_id: String,
        category: ErrorCategory,
        message: String,
        was_retried: bool,
        retry_attempts: u32,
    ) {
        let error_event = ErrorEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            task_id,
            category,
            message,
            was_retried,
            retry_attempts,
        };

        let mut errors = self.recent_errors.write().await;
        errors.push(error_event);

        // Keep only the last 1000 error events to prevent memory growth
        if errors.len() > 1000 {
            errors.remove(0);
        }

        debug!("Error event recorded: {} retries", retry_attempts);
    }

    /// Get historical system metrics within a time range
    pub async fn get_system_metrics_history(
        &self,
        start_timestamp: u64,
        end_timestamp: u64,
    ) -> Vec<HistoricalDataPoint<SystemMetrics>> {
        let history = self.system_metrics_history.read().await;
        history
            .get_range(start_timestamp, end_timestamp)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Get historical download statistics within a time range
    pub async fn get_download_stats_history(
        &self,
        start_timestamp: u64,
        end_timestamp: u64,
    ) -> Vec<HistoricalDataPoint<DownloadStatistics>> {
        let history = self.download_stats_history.read().await;
        history
            .get_range(start_timestamp, end_timestamp)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Get historical performance metrics within a time range
    pub async fn get_performance_metrics_history(
        &self,
        start_timestamp: u64,
        end_timestamp: u64,
    ) -> Vec<HistoricalDataPoint<PerformanceMetrics>> {
        let history = self.performance_metrics_history.read().await;
        history
            .get_range(start_timestamp, end_timestamp)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Get current dashboard data
    pub async fn get_current_dashboard_data(&self) -> AppResult<DashboardData> {
        Self::compile_dashboard_data(
            &self.system_metrics_history,
            &self.download_stats_history,
            &self.performance_metrics_history,
            &self.recent_errors,
        )
        .await
    }

    /// Export metrics in Prometheus format
    pub async fn export_prometheus_metrics(&self) -> AppResult<String> {
        let dashboard_data = self.get_current_dashboard_data().await?;

        let mut prometheus_output = String::new();

        // System metrics
        prometheus_output.push_str(&format!(
            "# HELP system_cpu_usage CPU usage percentage\n# TYPE system_cpu_usage gauge\nsystem_cpu_usage {}\n",
            dashboard_data.system_metrics.cpu_usage
        ));

        prometheus_output.push_str(&format!(
            "# HELP system_memory_usage Memory usage percentage\n# TYPE system_memory_usage gauge\nsystem_memory_usage {}\n",
            dashboard_data.system_metrics.memory_usage
        ));

        prometheus_output.push_str(&format!(
            "# HELP system_disk_usage Disk usage percentage\n# TYPE system_disk_usage gauge\nsystem_disk_usage {}\n",
            dashboard_data.system_metrics.disk_usage
        ));

        // Download metrics
        prometheus_output.push_str(&format!(
            "# HELP download_success_rate Download success rate percentage\n# TYPE download_success_rate gauge\ndownload_success_rate {}\n",
            dashboard_data.download_stats.success_rate
        ));

        prometheus_output.push_str(&format!(
            "# HELP download_active_count Number of active downloads\n# TYPE download_active_count gauge\ndownload_active_count {}\n",
            dashboard_data.download_stats.active_downloads
        ));

        prometheus_output.push_str(&format!(
            "# HELP download_speed_current Current download speed in bytes per second\n# TYPE download_speed_current gauge\ndownload_speed_current {}\n",
            dashboard_data.download_stats.current_speed
        ));

        Ok(prometheus_output)
    }

    /// Get monitoring system configuration
    pub fn get_config(&self) -> &MonitoringConfig {
        &self.config
    }

    /// Update monitoring system configuration
    pub async fn update_config(&mut self, new_config: MonitoringConfig) -> AppResult<()> {
        let was_running = *self.is_running.read().await;

        if was_running {
            self.stop().await?;
        }

        self.config = new_config;

        if was_running {
            self.start().await?;
        }

        info!("Monitoring system configuration updated");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn test_monitoring_system_creation() {
        let config = MonitoringConfig::default();
        let monitoring = MonitoringSystem::new(config);
        assert!(!(*monitoring.is_running.read().await));
    }

    #[tokio::test]
    async fn test_time_series() {
        let mut ts: TimeSeries<u32> = TimeSeries::new(3);

        ts.add_point(1000, 100);
        ts.add_point(1001, 200);
        ts.add_point(1002, 300);

        assert_eq!(ts.data_points.len(), 3);
        assert_eq!(ts.get_latest().unwrap().value, 300);

        // Test overflow behavior
        ts.add_point(1003, 400);
        assert_eq!(ts.data_points.len(), 3);
        assert_eq!(ts.data_points[0].value, 200); // First item should be removed
    }

    #[tokio::test]
    async fn test_health_calculation() {
        let system_metrics = SystemMetrics {
            timestamp: 0,
            cpu_usage: 50.0,
            memory_used: 0,
            memory_total: 0,
            memory_usage: 60.0,
            disk_used: 0,
            disk_total: 0,
            disk_usage: 30.0,
            network_rx_bytes: 0,
            network_tx_bytes: 0,
            network_rx_rate: 0.0,
            network_tx_rate: 0.0,
            active_connections: 0,
        };

        let download_stats = DownloadStatistics {
            timestamp: 0,
            total_tasks: 100,
            pending_tasks: 0,
            active_downloads: 0,
            completed_downloads: 95,
            failed_downloads: 5,
            paused_downloads: 0,
            cancelled_downloads: 0,
            total_bytes_downloaded: 0,
            current_speed: 0.0,
            average_speed: 0.0,
            peak_speed: 0.0,
            success_rate: 95.0,
            average_duration: 0.0,
            size_distribution: FileSizeDistribution {
                small_files: 0,
                medium_files: 0,
                large_files: 0,
                huge_files: 0,
            },
            error_distribution: HashMap::new(),
        };

        let performance_metrics = PerformanceMetrics {
            timestamp: 0,
            download_throughput: 0.0,
            task_processing_rate: 0.0,
            average_queue_length: 0.0,
            app_memory_usage: 0,
            active_threads: 1,
            app_cpu_usage: 0.0,
            db_latency: 0.0,
            io_operations_per_sec: 0.0,
            network_latency: 0.0,
        };

        let health = MonitoringSystem::calculate_health_status(
            &system_metrics,
            &download_stats,
            &performance_metrics,
        );

        assert_eq!(health.cpu_health.status, HealthLevel::Healthy);
        assert_eq!(health.memory_health.status, HealthLevel::Healthy);
        assert_eq!(health.disk_health.status, HealthLevel::Healthy);
        assert_eq!(health.download_health.status, HealthLevel::Healthy);
        assert!(health.overall_health > 0.8);
    }

    #[tokio::test]
    async fn test_error_event_recording() -> AppResult<()> {
        let config = MonitoringConfig::default();
        let monitoring = MonitoringSystem::new(config);

        monitoring
            .record_error_event(
                "test_task".to_string(),
                ErrorCategory::Network,
                "Connection timeout".to_string(),
                true,
                3,
            )
            .await;

        let errors = monitoring.recent_errors.read().await;
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].task_id, "test_task");
        assert_eq!(errors[0].category, ErrorCategory::Network);
        assert!(errors[0].was_retried);
        assert_eq!(errors[0].retry_attempts, 3);

        Ok(())
    }

    #[tokio::test]
    async fn test_dashboard_client_registration() -> AppResult<()> {
        let config = MonitoringConfig::default();
        let monitoring = MonitoringSystem::new(config);

        let client_id = "test_client".to_string();
        let _receiver = monitoring
            .register_dashboard_client(client_id.clone())
            .await;

        {
            let clients = monitoring.dashboard_clients.read().await;
            assert!(clients.contains_key(&client_id));
        }

        monitoring.unregister_dashboard_client(&client_id).await;

        {
            let clients = monitoring.dashboard_clients.read().await;
            assert!(!clients.contains_key(&client_id));
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_prometheus_export() -> AppResult<()> {
        let config = MonitoringConfig::default();
        let monitoring = MonitoringSystem::new(config);

        let prometheus_output = monitoring.export_prometheus_metrics().await?;

        assert!(prometheus_output.contains("system_cpu_usage"));
        assert!(prometheus_output.contains("system_memory_usage"));
        assert!(prometheus_output.contains("download_success_rate"));
        assert!(prometheus_output.contains("# HELP"));
        assert!(prometheus_output.contains("# TYPE"));

        Ok(())
    }

    #[tokio::test]
    async fn test_monitoring_system_lifecycle() -> AppResult<()> {
        let config = MonitoringConfig {
            dashboard_update_interval: 100, // Fast updates for testing
            ..MonitoringConfig::default()
        };
        let mut monitoring = MonitoringSystem::new(config);

        assert!(!(*monitoring.is_running.read().await));

        monitoring.start().await?;
        assert!(*monitoring.is_running.read().await);

        // Let it run briefly
        sleep(Duration::from_millis(200)).await;

        monitoring.stop().await?;
        assert!(!(*monitoring.is_running.read().await));

        Ok(())
    }
}

/// Alert rule configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub name: String,
    pub condition: String,
    pub level: AlertLevel,
    pub enabled: bool,
}

/// Alert severity levels
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum AlertLevel {
    Info,
    Warning,
    Error,
    Critical,
}

/// Prometheus metrics exporter
pub struct PrometheusExporter {
    monitoring_system: Arc<MonitoringSystem>,
}

impl PrometheusExporter {
    pub fn new(monitoring_system: Arc<MonitoringSystem>) -> Self {
        Self { monitoring_system }
    }

    pub async fn export_metrics(&self) -> AppResult<String> {
        self.monitoring_system.export_prometheus_metrics().await
    }
}
