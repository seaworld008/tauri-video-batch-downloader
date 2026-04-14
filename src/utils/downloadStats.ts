import type { DownloadStats, VideoTask } from '../types';

export const DEFAULT_DOWNLOAD_STATS: DownloadStats = {
  total_tasks: 0,
  completed_tasks: 0,
  failed_tasks: 0,
  total_downloaded: 0,
  average_speed: 0,
  display_total_speed_bps: 0,
  active_downloads: 0,
  queue_paused: false,
  average_transfer_duration: 0,
  average_commit_duration: 0,
  p95_commit_duration: 0,
  failed_commit_count: 0,
  commit_warning_count: 0,
  commit_elevated_warning_count: 0,
};

export const createDefaultDownloadStats = (): DownloadStats => ({
  ...DEFAULT_DOWNLOAD_STATS,
});

export const ensureDownloadStats = (
  stats: Partial<DownloadStats> | null | undefined
): DownloadStats => ({
  ...DEFAULT_DOWNLOAD_STATS,
  ...(stats ?? {}),
});

export const calculateStatsFromTasks = (tasks: VideoTask[]): DownloadStats => {
  if (!tasks || tasks.length === 0) {
    return createDefaultDownloadStats();
  }

  let completed = 0;
  let failed = 0;
  let active = 0;
  let totalDownloaded = 0;

  tasks.forEach(task => {
    totalDownloaded += Number.isFinite(task.downloaded_size) ? task.downloaded_size : 0;

    switch (task.status) {
      case 'completed':
        completed += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'downloading':
      case 'committing':
        active += 1;
        break;
      default:
        break;
    }
  });

  return {
    total_tasks: tasks.length,
    completed_tasks: completed,
    failed_tasks: failed,
    active_downloads: active,
    total_downloaded: totalDownloaded,
    average_speed: 0,
    display_total_speed_bps: 0,
    queue_paused: false,
    average_transfer_duration: 0,
    average_commit_duration: 0,
    p95_commit_duration: 0,
    failed_commit_count: 0,
    commit_warning_count: 0,
    commit_elevated_warning_count: 0,
  };
};
