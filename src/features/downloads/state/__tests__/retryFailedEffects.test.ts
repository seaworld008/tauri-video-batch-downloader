import { describe, expect, it, vi } from 'vitest';
import {
  buildNoFailedTasksMessage,
  buildRetryFailedSuccessMessage,
  executeRetryFailedTasks,
  retryFailedTaskIds,
  selectFailedTaskIds,
} from '../retryFailedEffects';

describe('retryFailedEffects helpers', () => {
  it('selects only failed task ids', () => {
    expect(
      selectFailedTaskIds([
        { id: 'task-1', status: 'failed' },
        { id: 'task-2', status: 'pending' },
        { id: 'task-3', status: 'failed' },
      ] as any)
    ).toEqual(['task-1', 'task-3']);
  });

  it('retries failed task ids sequentially through startDownload with suppressed concurrency toast', async () => {
    const startDownload = vi.fn().mockResolvedValue('started');

    await retryFailedTaskIds(['task-1', 'task-2'], startDownload);

    expect(startDownload.mock.calls).toEqual([
      ['task-1', { suppressConcurrencyToast: true }],
      ['task-2', { suppressConcurrencyToast: true }],
    ]);
  });

  it('executes retry-failed through shared helper and emits success feedback', async () => {
    const startDownload = vi.fn().mockResolvedValue('started');
    const toastApi = Object.assign(vi.fn(), {
      success: vi.fn(),
    });

    await executeRetryFailedTasks({
      tasks: [
        { id: 'task-1', status: 'failed' },
        { id: 'task-2', status: 'failed' },
      ] as any,
      startDownload,
      toastApi,
    });

    expect(startDownload.mock.calls).toEqual([
      ['task-1', { suppressConcurrencyToast: true }],
      ['task-2', { suppressConcurrencyToast: true }],
    ]);
    expect(toastApi.success).toHaveBeenCalledWith('已将 2 个失败任务重新提交到下载队列');
  });

  it('builds retry-failed feedback messages', () => {
    expect(buildNoFailedTasksMessage()).toBe('没有可重试的失败任务');
    expect(buildRetryFailedSuccessMessage(3)).toBe('已将 3 个失败任务重新提交到下载队列');
  });
});