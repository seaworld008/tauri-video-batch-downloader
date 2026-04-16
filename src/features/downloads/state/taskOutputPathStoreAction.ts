import type { VideoTask } from '../../../schemas';

import {
  buildOutputPathOverridePatch,
  prepareOutputPathOverrideRequest,
} from './taskOutputPathEffects';

export interface ExecuteOutputPathStoreActionParams {
  taskIds: string[];
  currentTasks: VideoTask[];
  defaultOutputDirectory: string;
  overrideOutputDirectory: string;
  updateTaskOutputPaths: (taskUpdates: unknown[]) => Promise<unknown[]>;
  normalizeTask: (task: unknown) => VideoTask;
  applyPatch: (patch: { tasks: VideoTask[] }) => void;
}

export const executeOutputPathOverrideStoreAction = async ({
  taskIds,
  currentTasks,
  defaultOutputDirectory,
  overrideOutputDirectory,
  updateTaskOutputPaths,
  normalizeTask,
  applyPatch,
}: ExecuteOutputPathStoreActionParams): Promise<void> => {
  const taskUpdates = prepareOutputPathOverrideRequest({
    taskIds,
    tasks: currentTasks,
    defaultOutputDirectory,
    overrideOutputDirectory,
  });

  if (taskUpdates.length === 0) {
    return;
  }

  const updatedTasks = await updateTaskOutputPaths(taskUpdates);
  if (updatedTasks.length === 0) {
    return;
  }

  applyPatch(buildOutputPathOverridePatch(currentTasks, updatedTasks, normalizeTask));
};
