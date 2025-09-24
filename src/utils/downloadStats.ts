import type { DownloadStats } from '../types';

export const DEFAULT_DOWNLOAD_STATS: DownloadStats = {
  total_tasks: 0,
  completed_tasks: 0,
  failed_tasks: 0,
  total_downloaded: 0,
  average_speed: 0,
  active_downloads: 0,
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
