import type toast from 'react-hot-toast';
import type { VideoTask } from '../../../schemas';

export const buildRemoveTasksPatch = (
  currentTasks: VideoTask[],
  selectedTaskIds: string[],
  removedTaskIds: string[]
): {
  tasks: VideoTask[];
  selectedTasks: string[];
} => ({
  tasks: currentTasks.filter(task => !removedTaskIds.includes(task.id)),
  selectedTasks: selectedTaskIds.filter(id => !removedTaskIds.includes(id)),
});

export const buildClearCompletedTasksPatch = (
  currentTasks: VideoTask[],
  selectedTaskIds: string[]
): {
  tasks: VideoTask[];
  selectedTasks: string[];
} => {
  const remainingTasks = currentTasks.filter(task => task.status !== 'completed');
  const remainingTaskIds = new Set(remainingTasks.map(task => task.id));

  return {
    tasks: remainingTasks,
    selectedTasks: selectedTaskIds.filter(id => remainingTaskIds.has(id)),
  };
};

export const refreshStatsAfterMutation = async (
  refreshStats: () => Promise<unknown>
): Promise<void> => {
  await refreshStats();
};

export const buildRemoveTasksSuccessMessage = (removedCount: number): string =>
  `已删除 ${removedCount} 个任务`;

export const buildClearCompletedSuccessMessage = (): string => '已清除完成的任务';

export const executeRemoveTasksMutation = async ({
  taskIds,
  currentTasks,
  selectedTaskIds,
  removeTasks,
  refreshStats,
  applyPatch,
  toastApi,
}: {
  taskIds: string[];
  currentTasks: VideoTask[];
  selectedTaskIds: string[];
  removeTasks: (taskIds: string[]) => Promise<unknown>;
  refreshStats: () => Promise<unknown>;
  applyPatch: (patch: ReturnType<typeof buildRemoveTasksPatch>) => void;
  toastApi: Pick<typeof toast, 'success'>;
}): Promise<void> => {
  await removeTasks(taskIds);
  applyPatch(buildRemoveTasksPatch(currentTasks, selectedTaskIds, taskIds));
  await refreshStatsAfterMutation(refreshStats);
  toastApi.success(buildRemoveTasksSuccessMessage(taskIds.length));
};

export const executeClearCompletedTasksMutation = async ({
  currentTasks,
  selectedTaskIds,
  clearCompletedTasks,
  refreshStats,
  applyPatch,
  toastApi,
}: {
  currentTasks: VideoTask[];
  selectedTaskIds: string[];
  clearCompletedTasks: () => Promise<unknown>;
  refreshStats: () => Promise<unknown>;
  applyPatch: (patch: ReturnType<typeof buildClearCompletedTasksPatch>) => void;
  toastApi: Pick<typeof toast, 'success'>;
}): Promise<void> => {
  await clearCompletedTasks();
  applyPatch(buildClearCompletedTasksPatch(currentTasks, selectedTaskIds));
  await refreshStatsAfterMutation(refreshStats);
  toastApi.success(buildClearCompletedSuccessMessage());
};
