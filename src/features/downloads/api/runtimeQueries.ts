import type { DownloadStats } from '../../../schemas';
import { invokeTauri } from '../../../utils/tauriBridge';

export const getDownloadTasksCommand = async <TTask>(): Promise<TTask[]> => {
  const tasks = await invokeTauri<unknown>('get_download_tasks');
  return Array.isArray(tasks) ? (tasks as TTask[]) : [];
};

export const getDownloadStatsCommand = async (): Promise<DownloadStats> =>
  invokeTauri<DownloadStats>('get_download_stats');
