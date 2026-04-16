import type { DownloadStats } from '../../../schemas';

import { getDownloadStatsCommand, getDownloadTasksCommand } from '../api/runtimeQueries';

export const fetchRuntimeTasks = async (
  queryTasks: <TTask>() => Promise<TTask[]>
): Promise<any[]> => {
  const rawTasks = await queryTasks<any>();
  return Array.isArray(rawTasks) ? rawTasks : [];
};

export const fetchRuntimeStats = async (
  queryStats: () => Promise<DownloadStats>
): Promise<DownloadStats> => queryStats();

export const fetchRuntimeTasksCommand = (): Promise<any[]> => fetchRuntimeTasks(getDownloadTasksCommand);

export const fetchRuntimeStatsCommand = (): Promise<DownloadStats> =>
  fetchRuntimeStats(getDownloadStatsCommand);

export const syncRuntimeStateWith = async (
  refreshTasks: () => Promise<void>,
  refreshStats: () => Promise<void>
): Promise<void> => {
  await Promise.all([refreshTasks(), refreshStats()]);
};
