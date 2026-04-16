import { describe, expect, it, vi } from 'vitest';
import {
  buildNoStartableTasksMessage,
  buildPauseAllSuccessMessage,
  buildStartAllSuccessMessage,
  countDownloadingTasks,
  executePauseAllDownloads,
  executeStartAllDownloads,
  selectStartableTasks,
  startTasksSequentially,
  syncRuntimeAfterBatchControl,
} from '../batchControlEffects';

describe('batchControlEffects helpers', () => {
  it('selects startable tasks from current selection or the full list', () => {
    const tasks = [
      { id: 'task-1', status: 'pending' },
      { id: 'task-2', status: 'paused' },
      { id: 'task-3', status: 'completed' },
    ] as any;

    expect(selectStartableTasks(tasks, ['task-2', 'task-3'])).toEqual([
      { id: 'task-2', status: 'paused' },
    ]);
    expect(selectStartableTasks(tasks, [])).toEqual([
      { id: 'task-1', status: 'pending' },
      { id: 'task-2', status: 'paused' },
    ]);
  });

  it('starts selected tasks sequentially via startDownload with suppressed concurrency toast', async () => {
    const startDownload = vi.fn().mockResolvedValue('started');

    await startTasksSequentially(
      [
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'paused' },
      ] as any,
      startDownload
    );

    expect(startDownload.mock.calls).toEqual([
      ['task-1', { suppressConcurrencyToast: true }],
      ['task-2', { suppressConcurrencyToast: true }],
    ]);
  });

  it('counts downloading tasks for pause-all feedback', () => {
    expect(
      countDownloadingTasks([
        { id: 'task-1', status: 'downloading' },
        { id: 'task-2', status: 'paused' },
      ] as any)
    ).toBe(1);
  });

  it('executes start-all via backend when no explicit selection exists', async () => {
    const runStartAll = vi.fn().mockResolvedValue(2);
    const startDownload = vi.fn().mockResolvedValue('started');
    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);
    const toastApi = Object.assign(vi.fn(), {
      success: vi.fn(),
    });

    await executeStartAllDownloads({
      tasks: [
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'paused' },
      ] as any,
      selectedTaskIds: [],
      startDownload,
      runStartAll,
      syncRuntimeState,
      toastApi,
    });

    expect(runStartAll).toHaveBeenCalledTimes(1);
    expect(startDownload).not.toHaveBeenCalled();
    expect(toastApi.success).toHaveBeenCalledWith('已提交 2 个任务（已尝试处理 2 个）');
  });

  it('executes pause-all through shared helper and emits success feedback', async () => {
    const runPauseAll = vi.fn().mockResolvedValue(undefined);
    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);
    const toastApi = {
      success: vi.fn(),
    };

    await executePauseAllDownloads({
      tasks: [
        { id: 'task-1', status: 'downloading' },
        { id: 'task-2', status: 'paused' },
      ] as any,
      runPauseAll,
      syncRuntimeState,
      toastApi,
    });

    expect(runPauseAll).toHaveBeenCalledTimes(1);
    expect(toastApi.success).toHaveBeenCalledWith('已暂停 1 个下载任务');
  });

  it('fires runtime sync in background after batch control actions', async () => {
    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);

    syncRuntimeAfterBatchControl(syncRuntimeState, 'startAllDownloads');
    await Promise.resolve();

    expect(syncRuntimeState).toHaveBeenCalledWith('startAllDownloads');
  });

  it('builds batch control success messages', () => {
    expect(buildStartAllSuccessMessage(3, 2)).toBe('已提交 3 个任务（已尝试处理 2 个）');
    expect(buildPauseAllSuccessMessage(4)).toBe('已暂停 4 个下载任务');
  });
});