use super::*;

impl DownloadManager {
    pub(super) async fn enqueue_task(&self, task_id: &str, priority: u8) -> bool {
        let inserted = {
            let mut queue = self.task_queue.lock().await;
            if queue.iter().any(|item| item.task_id == task_id) {
                return false;
            }

            queue.push(TaskPriority {
                task_id: task_id.to_string(),
                priority,
                created_at: chrono::Utc::now(),
            });
            true
        };

        if inserted {
            if let Err(err) = self.persist_state().await {
                warn!("Failed to persist state after enqueue: {}", err);
            }
        }
        inserted
    }

    pub(super) async fn remove_task_from_queue(&self, task_id: &str) -> bool {
        let removed = {
            let mut queue = self.task_queue.lock().await;
            if queue.is_empty() {
                return false;
            }

            let mut items = Vec::with_capacity(queue.len());
            while let Some(item) = queue.pop() {
                items.push(item);
            }

            let before = items.len();
            items.retain(|item| item.task_id != task_id);
            let removed = items.len() != before;

            *queue = items.into_iter().collect();
            removed
        };

        if removed {
            if let Err(err) = self.persist_state().await {
                warn!("Failed to persist state after dequeue: {}", err);
            }
        }
        removed
    }

    pub(super) async fn process_task_queue(&mut self) {
        if self.queue_paused {
            return;
        }
        loop {
            self.settle_pending_semaphore_reduction();
            self.reap_finished_active_downloads();
            if self.active_downloads.len() >= self.config.concurrent_downloads {
                break;
            }
            if self.download_semaphore.available_permits() == 0 {
                break;
            }

            let next_task = {
                let mut queue = self.task_queue.lock().await;
                queue.pop()
            };

            let Some(task_priority) = next_task else {
                break;
            };

            let task_id = task_priority.task_id.clone();
            let task = match self.tasks.get(&task_id).cloned() {
                Some(task) => task,
                None => continue,
            };

            if task.status != TaskStatus::Pending
                && task.status != TaskStatus::Paused
                && task.status != TaskStatus::Failed
            {
                continue;
            }

            self.refresh_task_file_state(&task_id).await.ok();

            let permit = match self.download_semaphore.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => {
                    let _ = self.enqueue_task(&task_id, task_priority.priority).await;
                    break;
                }
            };

            if let Err(err) = self
                .start_download_with_permit(&task_id, task, permit)
                .await
            {
                warn!("Failed to start queued task {}: {}", task_id, err);
            }
        }
    }

    pub(super) fn settle_pending_semaphore_reduction(&mut self) {
        if self.pending_semaphore_reduction == 0 {
            return;
        }

        let available = self.download_semaphore.available_permits();
        if available == 0 {
            return;
        }

        let to_forget = available.min(self.pending_semaphore_reduction);
        let forgotten = self.download_semaphore.forget_permits(to_forget);

        if forgotten > 0 {
            self.pending_semaphore_reduction -= forgotten;
            self.semaphore_capacity = self.semaphore_capacity.saturating_sub(forgotten);
            debug!(
                "Settled semaphore reduction: forgotten={}, pending={}, capacity={}",
                forgotten, self.pending_semaphore_reduction, self.semaphore_capacity
            );
        }
    }
}
