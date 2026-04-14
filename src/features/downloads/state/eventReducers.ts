import type { TaskStatus, VideoTask } from '../../../schemas';

export interface ProgressEventPayload {
  task_id: string;
  downloaded_size: number;
  total_size?: number | null;
  speed?: number;
  display_speed_bps?: number;
  eta?: number | null;
  progress?: number;
}

export interface StatusEventPayload {
  task_id: string;
  status: TaskStatus;
  error_message?: string | null;
}

export const reduceTasksWithStatusUpdate = (
  tasks: VideoTask[],
  payload: StatusEventPayload
): VideoTask[] =>
  tasks.map(task => {
    if (task.id !== payload.task_id) {
      return task;
    }

    const isNonTransferringStatus =
      payload.status === 'committing' ||
      payload.status === 'completed' ||
      payload.status === 'failed' ||
      payload.status === 'cancelled';

    return {
      ...task,
      status: payload.status,
      error_message: payload.error_message,
      speed: isNonTransferringStatus ? 0 : task.speed,
      display_speed_bps: isNonTransferringStatus ? 0 : task.display_speed_bps,
      eta: isNonTransferringStatus ? undefined : task.eta,
      progress: task.progress,
      updated_at: new Date().toISOString(),
    };
  });

export const reduceTasksWithProgressUpdate = (
  tasks: VideoTask[],
  update: ProgressEventPayload
): VideoTask[] => {
  const totalSize =
    typeof update.total_size === 'number' && Number.isFinite(update.total_size)
      ? update.total_size
      : undefined;
  const etaValue =
    typeof update.eta === 'number' && Number.isFinite(update.eta) ? update.eta : undefined;
  const normalizedSpeed = Math.max(
    0,
    typeof update.speed === 'number' && Number.isFinite(update.speed) ? update.speed : 0
  );
  const normalizedDisplaySpeed = Math.max(
    0,
    typeof update.display_speed_bps === 'number' && Number.isFinite(update.display_speed_bps)
      ? update.display_speed_bps
      : normalizedSpeed
  );
  const normalizedProgress =
    typeof update.progress === 'number' && Number.isFinite(update.progress)
      ? Math.min(Math.max(update.progress * 100, 0), 100)
      : undefined;

  return tasks.map(task => {
    if (task.id !== update.task_id) {
      return task;
    }

    let progress = normalizedProgress ?? task.progress;
    const fallbackTotal = totalSize ?? task.file_size;
    const hasDownloaded = update.downloaded_size > 0;

    if (progress === 0 && fallbackTotal && fallbackTotal > 0 && update.downloaded_size > 0) {
      progress = Math.min((update.downloaded_size / fallbackTotal) * 100, 100);
    }

    if (progress === 0 && hasDownloaded && !fallbackTotal) {
      progress = task.progress < 100 ? task.progress : 0;
    }

    if (
      update.downloaded_size >= task.downloaded_size &&
      progress > 0 &&
      progress < task.progress &&
      task.progress < 100
    ) {
      progress = task.progress;
    }

    return {
      ...task,
      downloaded_size: update.downloaded_size,
      file_size: totalSize ?? task.file_size,
      speed: normalizedSpeed,
      display_speed_bps: normalizedDisplaySpeed,
      eta: etaValue,
      progress,
      updated_at: new Date().toISOString(),
    };
  });
};
