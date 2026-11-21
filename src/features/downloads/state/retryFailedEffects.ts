import type { VideoTask } from '../../../schemas';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';
import { runWithDeferredRuntimeSync } from './commandControlEffects';

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
): Promise<number> => {
  let submittedCount = 0;

  await runWithDeferredRuntimeSync(async () => {
    for (const taskId of taskIds) {
      try {
        await startDownload(taskId, { suppressConcurrencyToast: true });
        submittedCount += 1;
      } catch (error) {
        reportFrontendDiagnosticIfEnabled('warn', '[retryFailed] task retry failed', {
          taskId,
          error,
        });
      }
    }
  });

  return submittedCount;
};

export const executeRetryFailedTasks = async ({
  tasks,
  startDownload,
  syncRuntimeState,
  toastApi,
}: {
  tasks: VideoTask[];
  startDownload: (
    taskId: string,
    options?: {
      suppressConcurrencyToast?: boolean;
    }
  ) => Promise<unknown>;
  syncRuntimeState?: (source: string) => Promise<unknown>;
  toastApi: ((message: string) => void) & {
    success: (message: string) => void;
  };
}): Promise<void> => {
  const failedTaskIds = selectFailedTaskIds(tasks);

  if (failedTaskIds.length === 0) {
    toastApi(buildNoFailedTasksMessage());
    return;
  }

  const submittedCount = await retryFailedTaskIds(failedTaskIds, startDownload);
  if (syncRuntimeState) {
    void syncRuntimeState('retryFailedTasks').catch(err =>
      reportFrontendDiagnosticIfEnabled('warn', '[retryFailedTasks] runtime sync failed', err)
    );
  }
  toastApi.success(buildRetryFailedSuccessMessage(submittedCount));
};

export const buildNoFailedTasksMessage = (): string => '没有可重试的失败任务';

export const buildRetryFailedSuccessMessage = (count: number): string =>
  `已将 ${count} 个失败任务重新提交到下载队列`;
