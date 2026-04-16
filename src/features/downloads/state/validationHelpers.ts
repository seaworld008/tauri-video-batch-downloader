import type { DownloadStats } from '../../../schemas';
import { checkDataIntegrity } from '../../../utils/dataValidator';
import { ensureDownloadStats } from '../../../utils/downloadStats';

import { fetchRuntimeStats, fetchRuntimeTasks } from './runtimeSync';

type NormalizeTask<TTask> = (task: any) => TTask;

export type ForceSyncResult<TTask> = {
  tasks: TTask[];
  stats: DownloadStats;
};

export const forceSyncWith = async <TTask>(
  fetchTasks: <TRawTask>() => Promise<TRawTask[]>,
  fetchStats: () => Promise<DownloadStats>,
  normalizeTask: NormalizeTask<TTask>
): Promise<ForceSyncResult<TTask>> => {
  const [rawTasks, stats] = await Promise.all([
    fetchRuntimeTasks(fetchTasks),
    fetchRuntimeStats(fetchStats),
  ]);

  return {
    tasks: rawTasks.map(normalizeTask),
    stats: ensureDownloadStats(stats),
  };
};

export const buildForceSyncPatch = <TTask>({
  tasks,
  stats,
}: ForceSyncResult<TTask>): ForceSyncResult<TTask> => ({
  tasks,
  stats,
});

export const buildForceSyncSummary = <TTask>({
  tasks,
  stats,
}: ForceSyncResult<TTask>) => ({
  totalTasks: tasks.length,
  stats,
});

export const runDataIntegrityCheckFor = <TTask>(tasks: TTask[]) => checkDataIntegrity(tasks as any);
