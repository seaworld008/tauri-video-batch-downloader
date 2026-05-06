use super::*;

impl DownloadManager {
    pub(super) fn recompute_stats(&mut self) {
        let total_tasks = self.tasks.len();
        let completed_tasks = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Completed)
            .count();
        let failed_tasks = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Failed)
            .count();
        let active_downloads = self.active_downloads.len();

        let total_downloaded: u64 = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Completed)
            .map(|t| t.downloaded_size)
            .sum();

        let current_speeds: Vec<f64> = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Downloading)
            .map(|t| t.speed)
            .collect();

        let average_speed = if current_speeds.is_empty() {
            0.0
        } else {
            current_speeds.iter().sum::<f64>() / current_speeds.len() as f64
        };
        let display_total_speed_bps = self
            .tasks
            .values()
            .filter(|t| t.status == TaskStatus::Downloading)
            .map(|t| t.display_speed_bps)
            .sum();
        let average_transfer_duration =
            Self::average_metric(&self.lifecycle_metrics.transfer_duration_secs);
        let average_commit_duration =
            Self::average_metric(&self.lifecycle_metrics.commit_duration_secs);
        let p95_commit_duration =
            Self::percentile_metric(&self.lifecycle_metrics.commit_duration_secs, 0.95);

        self.stats = ModelsDownloadStats {
            total_tasks,
            completed_tasks,
            failed_tasks,
            total_downloaded,
            average_speed,
            display_total_speed_bps,
            active_downloads,
            queue_paused: self.queue_paused,
            average_transfer_duration,
            average_commit_duration,
            p95_commit_duration,
            failed_commit_count: self.lifecycle_metrics.failed_commit_count,
            commit_warning_count: self.lifecycle_metrics.commit_warning_count,
            commit_elevated_warning_count: self.lifecycle_metrics.commit_elevated_warning_count,
        };
    }

    pub(super) async fn update_stats(&mut self) {
        self.recompute_stats();
        self.emit_event(DownloadEvent::StatsUpdated {
            stats: self.stats.clone(),
        });
    }

    pub(super) fn note_transfer_started(&mut self, task_id: &str) {
        let should_reset = self
            .task_lifecycle_timings
            .get(task_id)
            .and_then(|timing| timing.final_status.as_ref())
            .is_some();

        if should_reset || !self.task_lifecycle_timings.contains_key(task_id) {
            self.task_lifecycle_timings.insert(
                task_id.to_string(),
                TaskLifecycleTiming {
                    transfer_started_at: chrono::Utc::now(),
                    commit_started_at: None,
                    finished_at: None,
                    final_status: None,
                },
            );
        }
    }

    pub(super) fn note_commit_started(&mut self, task_id: &str) {
        let now = chrono::Utc::now();
        let entry = self
            .task_lifecycle_timings
            .entry(task_id.to_string())
            .or_insert(TaskLifecycleTiming {
                transfer_started_at: now,
                commit_started_at: None,
                finished_at: None,
                final_status: None,
            });

        if entry.commit_started_at.is_none() {
            entry.commit_started_at = Some(now);
        }
        entry.final_status = None;
        entry.finished_at = None;
    }

    pub(super) fn note_terminal_status(&mut self, task_id: &str, final_status: &TaskStatus) {
        let now = chrono::Utc::now();
        let (transfer_started_at, commit_started_at) = {
            let timing = self
                .task_lifecycle_timings
                .entry(task_id.to_string())
                .or_insert(TaskLifecycleTiming {
                    transfer_started_at: now,
                    commit_started_at: None,
                    finished_at: None,
                    final_status: None,
                });
            (timing.transfer_started_at, timing.commit_started_at)
        };

        if let Some(commit_started_at) = commit_started_at {
            let commit_duration = (now - commit_started_at)
                .to_std()
                .unwrap_or_default()
                .as_secs_f64();

            if *final_status == TaskStatus::Completed {
                Self::push_metric_sample(
                    &mut self.lifecycle_metrics.commit_duration_secs,
                    commit_duration,
                );

                if commit_duration > 2.0 {
                    self.lifecycle_metrics.commit_warning_count += 1;
                    warn!(
                        "Commit stage exceeded warning threshold for task {}: {:.3}s",
                        task_id, commit_duration
                    );
                }
                if commit_duration > 5.0 {
                    self.lifecycle_metrics.commit_elevated_warning_count += 1;
                    warn!(
                        "Commit stage exceeded elevated threshold for task {}: {:.3}s",
                        task_id, commit_duration
                    );
                }
            } else if *final_status == TaskStatus::Failed {
                self.lifecycle_metrics.failed_commit_count += 1;
                warn!(
                    "Task {} failed after entering commit stage; commit duration before failure {:.3}s",
                    task_id, commit_duration
                );
            }
        }

        if *final_status == TaskStatus::Completed {
            let transfer_end = commit_started_at.unwrap_or(now);
            let transfer_duration = (transfer_end - transfer_started_at)
                .to_std()
                .unwrap_or_default()
                .as_secs_f64();
            let total_duration = (now - transfer_started_at)
                .to_std()
                .unwrap_or_default()
                .as_secs_f64();

            Self::push_metric_sample(
                &mut self.lifecycle_metrics.transfer_duration_secs,
                transfer_duration,
            );
            Self::push_metric_sample(
                &mut self.lifecycle_metrics.total_duration_secs,
                total_duration,
            );
        }

        if let Some(timing) = self.task_lifecycle_timings.get_mut(task_id) {
            timing.finished_at = Some(now);
            timing.final_status = Some(final_status.clone());
        }
    }

    pub(super) fn note_peak_download_speed(&mut self, speed_bps: f64) {
        if speed_bps.is_finite() && speed_bps > self.lifecycle_metrics.peak_download_speed_bps {
            self.lifecycle_metrics.peak_download_speed_bps = speed_bps;
        }
    }

    fn push_metric_sample(samples: &mut Vec<f64>, value: f64) {
        if !value.is_finite() || value < 0.0 {
            return;
        }

        samples.push(value);
        const MAX_SAMPLES: usize = 512;
        if samples.len() > MAX_SAMPLES {
            let overflow = samples.len() - MAX_SAMPLES;
            samples.drain(0..overflow);
        }
    }

    fn average_metric(samples: &[f64]) -> f64 {
        if samples.is_empty() {
            0.0
        } else {
            samples.iter().sum::<f64>() / samples.len() as f64
        }
    }

    fn percentile_metric(samples: &[f64], percentile: f64) -> f64 {
        if samples.is_empty() {
            return 0.0;
        }

        let mut values = samples.to_vec();
        values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let clamped = percentile.clamp(0.0, 1.0);
        let idx = ((values.len().saturating_sub(1)) as f64 * clamped).round() as usize;
        values[idx]
    }
}
