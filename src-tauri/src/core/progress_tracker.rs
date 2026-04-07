//! Enhanced Progress Tracking and Speed Statistics Module
//!
//! This module provides sophisticated progress tracking with advanced speed calculation,
//! ETA estimation, and performance statistics using high-performance time measurements
//! and statistical algorithms.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, info, warn};

use crate::core::models::AppResult;

/// Enhanced progress statistics with detailed metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnhancedProgressStats {
    /// Task identifier
    pub task_id: String,
    /// Total bytes to download
    pub total_bytes: Option<u64>,
    /// Currently downloaded bytes
    pub downloaded_bytes: u64,
    /// Current progress percentage (0.0 - 100.0)
    pub progress_percent: f64,
    /// Current download speed in bytes per second
    pub current_speed: f64,
    /// Average speed in bytes per second over entire download
    pub average_speed: f64,
    /// Smoothed speed using exponential moving average
    pub smoothed_speed: f64,
    /// Estimated time to completion in seconds
    pub eta_seconds: Option<u64>,
    /// Download start time (Unix timestamp)
    pub start_time: u64,
    /// Last update time (Unix timestamp)
    pub last_update: u64,
    /// Time elapsed since download start in seconds
    pub elapsed_time: f64,
    /// Speed history for analysis (last 30 measurements)
    pub speed_history: Vec<f64>,
    /// Statistical metrics
    pub statistics: ProgressStatistics,
}

/// Statistical analysis of progress data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressStatistics {
    /// Peak download speed observed
    pub peak_speed: f64,
    /// Minimum download speed observed (non-zero)
    pub min_speed: f64,
    /// Speed variance for stability analysis
    pub speed_variance: f64,
    /// Speed standard deviation
    pub speed_std_dev: f64,
    /// Number of speed measurements taken
    pub measurement_count: u64,
    /// Connection stability score (0.0-1.0, higher is more stable)
    pub stability_score: f64,
    /// Throughput efficiency (actual vs theoretical maximum)
    pub throughput_efficiency: f64,
}

impl Default for ProgressStatistics {
    fn default() -> Self {
        Self {
            peak_speed: 0.0,
            min_speed: f64::MAX,
            speed_variance: 0.0,
            speed_std_dev: 0.0,
            measurement_count: 0,
            stability_score: 1.0,
            throughput_efficiency: 0.0,
        }
    }
}

/// Speed measurement with timestamp for calculations
#[derive(Debug, Clone)]
struct SpeedMeasurement {
    /// Timestamp in nanoseconds (using coarsetime)
    _timestamp_nanos: u64,
    /// Downloaded bytes at this measurement
    bytes: u64,
    /// Calculated speed in bytes per second
    speed: f64,
}

/// Individual task progress tracker
#[derive(Debug)]
pub struct TaskProgressTracker {
    /// Task identifier
    task_id: String,
    /// Total bytes expected (if known)
    total_bytes: Option<u64>,
    /// Download start time
    start_time: Instant,
    /// Start time as Unix timestamp
    start_timestamp: u64,
    /// Last measurement time
    last_measurement: Instant,
    /// Speed measurements history (circular buffer)
    speed_measurements: VecDeque<SpeedMeasurement>,
    /// Exponential moving average alpha for speed smoothing
    ema_alpha: f64,
    /// Current smoothed speed
    smoothed_speed: f64,
    /// Statistical calculator
    statistics: ProgressStatistics,
    /// Maximum history size for speed measurements
    max_history_size: usize,
}

impl TaskProgressTracker {
    /// Create a new task progress tracker
    pub fn new(task_id: String, total_bytes: Option<u64>) -> Self {
        let now = Instant::now();
        let start_timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            task_id,
            total_bytes,
            start_time: now,
            start_timestamp,
            last_measurement: now,
            speed_measurements: VecDeque::with_capacity(50),
            ema_alpha: 0.2, // 20% weight for new measurements
            smoothed_speed: 0.0,
            statistics: ProgressStatistics::default(),
            max_history_size: 50,
        }
    }

    /// Update progress with new downloaded bytes
    pub fn update_progress(&mut self, downloaded_bytes: u64) -> AppResult<EnhancedProgressStats> {
        let now = Instant::now();
        let duration_since_last = now.duration_since(self.last_measurement);
        let duration_nanos = duration_since_last.as_nanos() as u64;

        // Calculate instantaneous speed
        let current_speed = if !self.speed_measurements.is_empty() {
            let last_measurement = self.speed_measurements.back().unwrap();
            let bytes_diff = downloaded_bytes.saturating_sub(last_measurement.bytes);
            let time_diff_secs = duration_nanos as f64 / 1_000_000_000.0;

            if time_diff_secs > 0.0 {
                bytes_diff as f64 / time_diff_secs
            } else {
                0.0
            }
        } else {
            0.0
        };

        // Add new measurement
        let timestamp_nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        let measurement = SpeedMeasurement {
            _timestamp_nanos: timestamp_nanos,
            bytes: downloaded_bytes,
            speed: current_speed,
        };

        self.speed_measurements.push_back(measurement);

        // Maintain history size
        if self.speed_measurements.len() > self.max_history_size {
            self.speed_measurements.pop_front();
        }

        // Update smoothed speed using exponential moving average
        if current_speed > 0.0 {
            if self.smoothed_speed == 0.0 {
                self.smoothed_speed = current_speed;
            } else {
                self.smoothed_speed =
                    self.ema_alpha * current_speed + (1.0 - self.ema_alpha) * self.smoothed_speed;
            }
        }

        // Calculate average speed over entire download
        let total_elapsed = now.duration_since(self.start_time).as_secs_f64();
        let average_speed = if total_elapsed > 0.0 {
            downloaded_bytes as f64 / total_elapsed
        } else {
            0.0
        };

        // Calculate progress percentage
        let progress_percent = if let Some(total) = self.total_bytes {
            if total > 0 {
                (downloaded_bytes as f64 / total as f64 * 100.0).min(100.0)
            } else {
                0.0
            }
        } else {
            0.0 // Unknown total size
        };

        // Calculate ETA
        let eta_seconds = if let Some(total) = self.total_bytes {
            if self.smoothed_speed > 0.0 && downloaded_bytes < total {
                let remaining_bytes = total - downloaded_bytes;
                Some((remaining_bytes as f64 / self.smoothed_speed) as u64)
            } else {
                None
            }
        } else {
            None
        };

        // Update statistics
        self.update_statistics(current_speed);

        // Update last measurement time
        self.last_measurement = now;

        // Create progress stats
        let speed_history: Vec<f64> = self
            .speed_measurements
            .iter()
            .rev()
            .take(30)
            .map(|m| m.speed)
            .collect();

        let current_timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let stats = EnhancedProgressStats {
            task_id: self.task_id.clone(),
            total_bytes: self.total_bytes,
            downloaded_bytes,
            progress_percent,
            current_speed,
            average_speed,
            smoothed_speed: self.smoothed_speed,
            eta_seconds,
            start_time: self.start_timestamp,
            last_update: current_timestamp,
            elapsed_time: total_elapsed,
            speed_history,
            statistics: self.statistics.clone(),
        };

        debug!(
            "📊 Progress update for {}: {:.1}% at {:.2} KB/s",
            self.task_id,
            progress_percent,
            current_speed / 1024.0
        );

        Ok(stats)
    }

    /// Update statistical measurements
    fn update_statistics(&mut self, current_speed: f64) {
        if current_speed <= 0.0 {
            return;
        }

        self.statistics.measurement_count += 1;

        // Update peak and minimum speeds
        self.statistics.peak_speed = self.statistics.peak_speed.max(current_speed);
        self.statistics.min_speed = self.statistics.min_speed.min(current_speed);

        // Calculate speed variance and standard deviation
        if self.speed_measurements.len() >= 2 {
            let speeds: Vec<f64> = self
                .speed_measurements
                .iter()
                .map(|m| m.speed)
                .filter(|&s| s > 0.0)
                .collect();

            if !speeds.is_empty() {
                let mean = speeds.iter().sum::<f64>() / speeds.len() as f64;
                let variance =
                    speeds.iter().map(|&s| (s - mean).powi(2)).sum::<f64>() / speeds.len() as f64;

                self.statistics.speed_variance = variance;
                self.statistics.speed_std_dev = variance.sqrt();

                // Calculate stability score (inverse of coefficient of variation)
                if mean > 0.0 {
                    let cv = self.statistics.speed_std_dev / mean;
                    self.statistics.stability_score = (1.0 / (1.0 + cv)).min(1.0);
                }
            }
        }

        // Calculate throughput efficiency (simplified - could be enhanced with connection info)
        if self.statistics.peak_speed > 0.0 {
            self.statistics.throughput_efficiency =
                self.smoothed_speed / self.statistics.peak_speed;
        }
    }

    /// Get current progress stats
    pub fn get_stats(&self) -> EnhancedProgressStats {
        let now = Instant::now();
        let total_elapsed = now.duration_since(self.start_time).as_secs_f64();
        let current_timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let downloaded_bytes = self.speed_measurements.back().map(|m| m.bytes).unwrap_or(0);

        let progress_percent = if let Some(total) = self.total_bytes {
            if total > 0 {
                (downloaded_bytes as f64 / total as f64 * 100.0).min(100.0)
            } else {
                0.0
            }
        } else {
            0.0
        };

        let average_speed = if total_elapsed > 0.0 {
            downloaded_bytes as f64 / total_elapsed
        } else {
            0.0
        };

        let eta_seconds = if let Some(total) = self.total_bytes {
            if self.smoothed_speed > 0.0 && downloaded_bytes < total {
                let remaining_bytes = total - downloaded_bytes;
                Some((remaining_bytes as f64 / self.smoothed_speed) as u64)
            } else {
                None
            }
        } else {
            None
        };

        let speed_history: Vec<f64> = self
            .speed_measurements
            .iter()
            .rev()
            .take(30)
            .map(|m| m.speed)
            .collect();

        let current_speed = self
            .speed_measurements
            .back()
            .map(|m| m.speed)
            .unwrap_or(0.0);

        EnhancedProgressStats {
            task_id: self.task_id.clone(),
            total_bytes: self.total_bytes,
            downloaded_bytes,
            progress_percent,
            current_speed,
            average_speed,
            smoothed_speed: self.smoothed_speed,
            eta_seconds,
            start_time: self.start_timestamp,
            last_update: current_timestamp,
            elapsed_time: total_elapsed,
            speed_history,
            statistics: self.statistics.clone(),
        }
    }
}

/// Global progress tracking manager
#[derive(Debug)]
pub struct ProgressTrackingManager {
    /// Active task trackers
    trackers: Arc<RwLock<HashMap<String, TaskProgressTracker>>>,
    /// Progress update channel
    progress_sender: mpsc::UnboundedSender<EnhancedProgressStats>,
    /// Progress receiver for external consumption
    progress_receiver: Arc<RwLock<Option<mpsc::UnboundedReceiver<EnhancedProgressStats>>>>,
}

impl ProgressTrackingManager {
    /// Create new progress tracking manager
    pub fn new() -> Self {
        let (progress_sender, progress_receiver) = mpsc::unbounded_channel();

        Self {
            trackers: Arc::new(RwLock::new(HashMap::new())),
            progress_sender,
            progress_receiver: Arc::new(RwLock::new(Some(progress_receiver))),
        }
    }

    /// Start tracking progress for a task
    pub async fn start_tracking(&self, task_id: String, total_bytes: Option<u64>) -> AppResult<()> {
        let tracker = TaskProgressTracker::new(task_id.clone(), total_bytes);

        let mut trackers = self.trackers.write().await;
        trackers.insert(task_id.clone(), tracker);

        info!("📊 Started progress tracking for task: {}", task_id);
        Ok(())
    }

    /// Update progress for a task
    pub async fn update_progress(&self, task_id: &str, downloaded_bytes: u64) -> AppResult<()> {
        let mut trackers = self.trackers.write().await;

        if let Some(tracker) = trackers.get_mut(task_id) {
            let stats = tracker.update_progress(downloaded_bytes)?;

            // Send update through channel
            if let Err(e) = self.progress_sender.send(stats) {
                warn!("Failed to send progress update for task {}: {}", task_id, e);
            }
        } else {
            warn!("Progress tracker not found for task: {}", task_id);
        }

        Ok(())
    }

    /// Get current progress stats for a task
    pub async fn get_progress(&self, task_id: &str) -> Option<EnhancedProgressStats> {
        let trackers = self.trackers.read().await;
        trackers.get(task_id).map(|t| t.get_stats())
    }

    /// Get progress stats for all active tasks
    pub async fn get_all_progress(&self) -> Vec<EnhancedProgressStats> {
        let trackers = self.trackers.read().await;
        trackers.values().map(|t| t.get_stats()).collect()
    }

    /// Stop tracking a task
    pub async fn stop_tracking(&self, task_id: &str) -> AppResult<()> {
        let mut trackers = self.trackers.write().await;

        if trackers.remove(task_id).is_some() {
            info!("🔚 Stopped progress tracking for task: {}", task_id);
        } else {
            warn!("Attempted to stop tracking non-existent task: {}", task_id);
        }

        Ok(())
    }

    /// Get progress receiver for consuming updates
    pub async fn take_progress_receiver(
        &self,
    ) -> Option<mpsc::UnboundedReceiver<EnhancedProgressStats>> {
        self.progress_receiver.write().await.take()
    }

    /// Get global download statistics
    pub async fn get_global_stats(&self) -> GlobalProgressStats {
        let trackers = self.trackers.read().await;
        let all_stats: Vec<EnhancedProgressStats> =
            trackers.values().map(|t| t.get_stats()).collect();

        let total_tasks = all_stats.len() as u64;
        let active_tasks = all_stats
            .iter()
            .filter(|s| s.progress_percent < 100.0)
            .count() as u64;

        let completed_tasks = total_tasks - active_tasks;

        let total_downloaded_bytes = all_stats.iter().map(|s| s.downloaded_bytes).sum::<u64>();

        let total_size_bytes = all_stats.iter().filter_map(|s| s.total_bytes).sum::<u64>();

        let aggregate_speed = all_stats
            .iter()
            .filter(|s| s.progress_percent < 100.0)
            .map(|s| s.smoothed_speed)
            .sum::<f64>();

        let average_speed_all_tasks = if !all_stats.is_empty() {
            all_stats.iter().map(|s| s.average_speed).sum::<f64>() / all_stats.len() as f64
        } else {
            0.0
        };

        GlobalProgressStats {
            total_tasks,
            active_tasks,
            completed_tasks,
            total_downloaded_bytes,
            total_size_bytes,
            aggregate_current_speed: aggregate_speed,
            average_speed_all_tasks,
            global_throughput_efficiency: if total_size_bytes > 0 {
                total_downloaded_bytes as f64 / total_size_bytes as f64
            } else {
                0.0
            },
        }
    }
}

impl Default for ProgressTrackingManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Global progress statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalProgressStats {
    /// Total number of tasks being tracked
    pub total_tasks: u64,
    /// Number of currently active (downloading) tasks
    pub active_tasks: u64,
    /// Number of completed tasks
    pub completed_tasks: u64,
    /// Total bytes downloaded across all tasks
    pub total_downloaded_bytes: u64,
    /// Total size of all tasks (if known)
    pub total_size_bytes: u64,
    /// Aggregate current download speed of all active tasks
    pub aggregate_current_speed: f64,
    /// Average speed across all tasks
    pub average_speed_all_tasks: f64,
    /// Global throughput efficiency
    pub global_throughput_efficiency: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn test_task_progress_tracker() {
        let mut tracker = TaskProgressTracker::new("test_task".to_string(), Some(1000000));

        // Test initial state
        let initial_stats = tracker.get_stats();
        assert_eq!(initial_stats.task_id, "test_task");
        assert_eq!(initial_stats.downloaded_bytes, 0);
        assert_eq!(initial_stats.progress_percent, 0.0);

        // Simulate progress updates
        sleep(Duration::from_millis(100)).await;
        let stats1 = tracker.update_progress(10000).unwrap();
        assert_eq!(stats1.downloaded_bytes, 10000);
        assert_eq!(stats1.progress_percent, 1.0);
        assert!(stats1.current_speed >= 0.0);

        sleep(Duration::from_millis(100)).await;
        let stats2 = tracker.update_progress(50000).unwrap();
        assert_eq!(stats2.downloaded_bytes, 50000);
        assert_eq!(stats2.progress_percent, 5.0);
        assert!(stats2.current_speed > 0.0);
        assert!(stats2.smoothed_speed > 0.0);
    }

    #[tokio::test]
    async fn test_progress_tracking_manager() {
        let manager = ProgressTrackingManager::new();

        // Start tracking
        manager
            .start_tracking("test_task".to_string(), Some(100000))
            .await
            .unwrap();

        // Update progress
        manager.update_progress("test_task", 10000).await.unwrap();

        // Get progress
        let stats = manager.get_progress("test_task").await.unwrap();
        assert_eq!(stats.downloaded_bytes, 10000);
        assert_eq!(stats.progress_percent, 10.0);

        // Stop tracking
        manager.stop_tracking("test_task").await.unwrap();

        // Should not exist anymore
        assert!(manager.get_progress("test_task").await.is_none());
    }

    #[tokio::test]
    async fn test_speed_statistics() {
        let mut tracker = TaskProgressTracker::new("speed_test".to_string(), Some(1000000));

        // Simulate variable speed download
        let speeds = vec![100000, 150000, 120000, 180000, 90000];
        let mut cumulative_bytes = 0u64;
        for (i, &bytes) in speeds.iter().enumerate() {
            sleep(Duration::from_millis(50)).await;
            cumulative_bytes += bytes;
            let stats = tracker.update_progress(cumulative_bytes).unwrap();

            if i > 0 {
                assert!(stats.current_speed > 0.0);
                assert!(stats.smoothed_speed > 0.0);
                assert!(stats.statistics.measurement_count > 0);
            }
        }

        let final_stats = tracker.get_stats();
        assert!(final_stats.statistics.peak_speed > 0.0);
        assert!(final_stats.statistics.stability_score <= 1.0);
    }
}
