import type { VideoTask } from '../../../schemas';

import { buildTaskOutputPathUpdates, type TaskOutputPathUpdate } from '../model/outputPathOverride';

export const selectTasksForOutputOverride = (
  taskIds: string[],
  tasks: VideoTask[]
): VideoTask[] => tasks.filter(task => taskIds.includes(task.id));

export const prepareOutputPathOverrideRequest = ({
  taskIds,
  tasks,
  defaultOutputDirectory,
  overrideOutputDirectory,
}: {
  taskIds: string[];
  tasks: VideoTask[];
  defaultOutputDirectory: string;
  overrideOutputDirectory: string;
}): TaskOutputPathUpdate[] => {
  const targetTasks = selectTasksForOutputOverride(taskIds, tasks);
  if (targetTasks.length === 0) {
    return [];
  }

  return buildTaskOutputPathUpdates(
    targetTasks,
    defaultOutputDirectory,
    overrideOutputDirectory
  );
};

export const buildOutputPathOverridePatch = (
  currentTasks: VideoTask[],
  updatedTasks: unknown[],
  normalizeTask: (task: unknown) => VideoTask
): { tasks: VideoTask[] } => {
  const updatedTaskMap = new Map(updatedTasks.map(task => {
    const normalized = normalizeTask(task);
    return [normalized.id, normalized] as const;
  }));

  return {
    tasks: currentTasks.map(task => updatedTaskMap.get(task.id) ?? task),
  };
};