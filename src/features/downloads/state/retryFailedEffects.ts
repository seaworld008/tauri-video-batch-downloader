import type { VideoTask } from '../../../schemas';

export const selectFailedTaskIds = (tasks: VideoTask[]): string[] =>
  tasks.filter(task => task.status === 'failed').map(task => task.id);

export const retryFailedTaskIds = async (
  taskIds: string[],
  startDownload: (
    taskId: string,
    options?: {
      suppressConcurrencyToast?: boolean;
    }
  ) => Promise<unknown>
): Promise<void> => {
  for (const taskId of taskIds) {
    await startDownload(taskId, { suppressConcurrencyToast: true });
  }
};

export const executeRetryFailedTasks = async ({
  tasks,
  startDownload,
  toastApi,
}: {
  tasks: VideoTask[];
  startDownload: (
    taskId: string,
    options?: {
      suppressConcurrencyToast?: boolean;
    }
  ) => Promise<unknown>;
  toastApi: ((message: string) => void) & {
    success: (message: string) => void;
  };
}): Promise<void> => {
  const failedTaskIds = selectFailedTaskIds(tasks);

  if (failedTaskIds.length === 0) {
    toastApi(buildNoFailedTasksMessage());
    return;
  }

  await retryFailedTaskIds(failedTaskIds, startDownload);
  toastApi.success(buildRetryFailedSuccessMessage(failedTaskIds.length));
};

export const buildNoFailedTasksMessage = (): string => '没有可重试的失败任务';

export const buildRetryFailedSuccessMessage = (count: number): string =>
  `已将 ${count} 个失败任务重新提交到下载队列`;