use chrono::{DateTime, Utc};

use crate::core::models::{TaskStatus, VideoTask};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TaskTransitionDecision {
    Allow,
    Reject(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QueueAdmissionResult {
    StartNow,
    QueueForConcurrency,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkerLifecycleAction {
    SignalActiveWorker,
    EmitSyntheticEvent,
}

pub(crate) fn decide_start_transition(
    task_id: &str,
    status: &TaskStatus,
) -> TaskTransitionDecision {
    match status {
        TaskStatus::Downloading | TaskStatus::Committing => {
            TaskTransitionDecision::Reject(format!("Task is already active: {}", task_id))
        }
        TaskStatus::Completed => {
            TaskTransitionDecision::Reject(format!("Task already completed: {}", task_id))
        }
        TaskStatus::Cancelled => {
            TaskTransitionDecision::Reject(format!("Task cancelled: {}", task_id))
        }
        TaskStatus::Pending | TaskStatus::Paused | TaskStatus::Failed => {
            TaskTransitionDecision::Allow
        }
    }
}

pub(crate) fn decide_pause_transition(status: &TaskStatus) -> TaskTransitionDecision {
    match status {
        TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Committing => {
            TaskTransitionDecision::Reject(format!("Cannot pause task in status: {:?}", status))
        }
        TaskStatus::Pending | TaskStatus::Downloading | TaskStatus::Paused | TaskStatus::Failed => {
            TaskTransitionDecision::Allow
        }
    }
}

pub(crate) fn decide_resume_transition(status: &TaskStatus) -> TaskTransitionDecision {
    match status {
        TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Committing => {
            TaskTransitionDecision::Reject(format!("Cannot resume task in status: {:?}", status))
        }
        TaskStatus::Pending | TaskStatus::Downloading | TaskStatus::Paused | TaskStatus::Failed => {
            TaskTransitionDecision::Allow
        }
    }
}

pub(crate) fn decide_queue_admission(
    active_downloads: usize,
    concurrent_downloads: usize,
) -> QueueAdmissionResult {
    if active_downloads >= concurrent_downloads {
        QueueAdmissionResult::QueueForConcurrency
    } else {
        QueueAdmissionResult::StartNow
    }
}

pub(crate) fn mark_queued_start_side_effect(task: &mut VideoTask, now: DateTime<Utc>) {
    if task.status == TaskStatus::Failed {
        task.status = TaskStatus::Pending;
        task.error_message = None;
        task.updated_at = now;
    }
}

pub(crate) fn mark_paused(task: &mut VideoTask, is_active: bool, now: DateTime<Utc>) {
    task.paused_at = Some(now);
    task.paused_from_active = is_active || task.status == TaskStatus::Downloading;
    if task.status != TaskStatus::Paused {
        task.status = TaskStatus::Paused;
        task.updated_at = now;
    }
}

pub(crate) fn mark_resumed_active(task: &mut VideoTask, now: DateTime<Utc>) {
    task.status = TaskStatus::Downloading;
    task.paused_at = None;
    task.paused_from_active = false;
    task.updated_at = now;
}

pub(crate) fn mark_cancelled(task: &mut VideoTask, now: DateTime<Utc>) {
    task.status = TaskStatus::Cancelled;
    task.updated_at = now;
}

pub(crate) fn worker_action_for_activity(is_active: bool) -> WorkerLifecycleAction {
    if is_active {
        WorkerLifecycleAction::SignalActiveWorker
    } else {
        WorkerLifecycleAction::EmitSyntheticEvent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_transition_allows_startable_statuses() {
        for status in [TaskStatus::Pending, TaskStatus::Paused, TaskStatus::Failed] {
            assert_eq!(
                decide_start_transition("task", &status),
                TaskTransitionDecision::Allow
            );
        }
    }

    #[test]
    fn start_transition_rejects_terminal_and_active_statuses() {
        for status in [
            TaskStatus::Downloading,
            TaskStatus::Committing,
            TaskStatus::Completed,
            TaskStatus::Cancelled,
        ] {
            assert!(matches!(
                decide_start_transition("task", &status),
                TaskTransitionDecision::Reject(_)
            ));
        }
    }

    #[test]
    fn queue_admission_queues_when_active_count_reaches_limit() {
        assert_eq!(
            decide_queue_admission(2, 2),
            QueueAdmissionResult::QueueForConcurrency
        );
        assert_eq!(decide_queue_admission(1, 2), QueueAdmissionResult::StartNow);
    }
}
