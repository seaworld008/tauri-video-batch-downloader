import type { VideoTask } from '../../../schemas';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

export const selectStartableTasks = (
  tasks: VideoTask[],
  selectedTaskIds: string[]
): VideoTask[] => {
  const targetTasks =
    selectedTaskIds.length > 0 ? tasks.filter(task => selectedTaskIds.includes(task.id)) : tasks;

  return targetTasks.filter(task => ['pending', 'paused'].includes(task.status));
};

export const startTasksSequentially = async (
  tasks: VideoTask[],
  startDownload: (
    taskId: string,
    options?: {
      suppressConcurrencyToast?: boolean;
    }
  ) => Promise<unknown>
): Promise<void> => {
  for (const task of tasks) {
    await startDownload(task.id, { suppressConcurrencyToast: true });
  }
};

export const countDownloadingTasks = (tasks: VideoTask[]): number =>
  tasks.filter(task => task.status === 'downloading').length;

export const executeStartAllDownloads = async ({
  tasks,
  selectedTaskIds,
  startDownload,
  runStartAll,
  syncRuntimeState,
  toastApi,
}: {
  tasks: VideoTask[];
  selectedTaskIds: string[];
  startDownload: (
    taskId: string,
    options?: {
      suppressConcurrencyToast?: boolean;
    }
  ) => Promise<unknown>;
  runStartAll: () => Promise<number>;
  syncRuntimeState: (source: string) => Promise<unknown>;
  toastApi: ((message: string) => void) & {
    success: (message: string) => void;
  };
}): Promise<void> => {
  const startableTasks = selectStartableTasks(tasks, selectedTaskIds);

  if (startableTasks.length === 0) {
    toastApi(buildNoStartableTasksMessage());
    return;
  }

  if (selectedTaskIds.length > 0) {
    await startTasksSequentially(startableTasks, startDownload);
    return;
  }

  const started = await runStartAll();
  syncRuntimeAfterBatchControl(syncRuntimeState, 'startAllDownloads');
  toastApi.success(buildStartAllSuccessMessage(startableTasks.length, started));
};

export const executePauseAllDownloads = async ({
  tasks,
  runPauseAll,
  syncRuntimeState,
  toastApi,
}: {
  tasks: VideoTask[];
  runPauseAll: () => Promise<unknown>;
  syncRuntimeState: (source: string) => Promise<unknown>;
  toastApi: {
    success: (message: string) => void;
  };
}): Promise<void> => {
  const downloadingTaskCount = countDownloadingTasks(tasks);

  await runPauseAll();
  syncRuntimeAfterBatchControl(syncRuntimeState, 'pauseAllDownloads');
  toastApi.success(buildPauseAllSuccessMessage(downloadingTaskCount));
};

export const syncRuntimeAfterBatchControl = (
  syncRuntimeState: (source: string) => Promise<unknown>,
  source: string
): void => {
  void syncRuntimeState(source).catch(err =>
    reportFrontendDiagnosticIfEnabled('warn', `[${source}] runtime sync failed`, err)
  );
};

export const buildNoStartableTasksMessage = (): string => '没有可开始的下载任务';

export const buildStartAllSuccessMessage = (
  requestedCount: number,
  startedCount: number
): string => `已提交 ${requestedCount} 个任务（已尝试处理 ${startedCount} 个）`;

export const buildPauseAllSuccessMessage = (pausedCount: number): string =>
  `已暂停 ${pausedCount} 个下载任务`;
