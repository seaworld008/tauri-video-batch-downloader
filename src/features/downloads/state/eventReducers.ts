import type { TaskStatus, VideoTask } from '../../../schemas';

export interface ProgressEventPayload {
  task_id: string;
  downloaded_size: number;
  total_size?: number | null;
  speed?: number;
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

    return {
      ...task,
      status: payload.status,
      error_message: payload.error_message,
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

    if (task.status === 'downloading' && progress >= 100) {
      if (fallbackTotal && fallbackTotal > 0 && update.downloaded_size < fallbackTotal) {
        progress = Math.min((update.downloaded_size / fallbackTotal) * 100, 99);
      } else if (!fallbackTotal && hasDownloaded) {
        progress = 99;
      }
    }

    return {
      ...task,
      downloaded_size: update.downloaded_size,
      file_size: totalSize ?? task.file_size,
      speed: normalizedSpeed,
      eta: etaValue,
      progress,
      updated_at: new Date().toISOString(),
    };
  });
};
