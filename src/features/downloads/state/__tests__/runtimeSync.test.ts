import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../api/runtimeQueries', () => ({
  getDownloadTasksCommand: vi.fn(),
  getDownloadStatsCommand: vi.fn(),
}));

import { getDownloadStatsCommand, getDownloadTasksCommand } from '../../api/runtimeQueries';
import {
  fetchRuntimeTasks,
  fetchRuntimeTasksCommand,
  fetchRuntimeStats,
  fetchRuntimeStatsCommand,
  syncRuntimeStateWith,
} from '../runtimeSync';

describe('runtimeSync helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches task lists through the canonical runtime query seam', async () => {
    const queryTasks = vi.fn().mockResolvedValue([{ id: 'task-1' }]);

    await expect(fetchRuntimeTasks(queryTasks)).resolves.toEqual([{ id: 'task-1' }]);
    expect(queryTasks).toHaveBeenCalledTimes(1);
  });

  it('normalizes non-array task payloads to an empty list', async () => {
    const queryTasks = vi.fn().mockResolvedValue({ bad: true });

    await expect(fetchRuntimeTasks(queryTasks as any)).resolves.toEqual([]);
  });

  it('fetches stats through the canonical runtime query seam', async () => {
    const stats = { total_tasks: 1 };
    const queryStats = vi.fn().mockResolvedValue(stats);

    await expect(fetchRuntimeStats(queryStats)).resolves.toBe(stats);
    expect(queryStats).toHaveBeenCalledTimes(1);
  });

  it('provides command-backed runtime query helpers for store/runtime seams', async () => {
    vi.mocked(getDownloadTasksCommand).mockResolvedValue([{ id: 'task-1' }] as never);
    vi.mocked(getDownloadStatsCommand).mockResolvedValue({ total_tasks: 1 } as never);

    await expect(fetchRuntimeTasksCommand()).resolves.toEqual([{ id: 'task-1' }]);
    await expect(fetchRuntimeStatsCommand()).resolves.toEqual({ total_tasks: 1 });

    expect(getDownloadTasksCommand).toHaveBeenCalledTimes(1);
    expect(getDownloadStatsCommand).toHaveBeenCalledTimes(1);
  });

  it('runs task and stats refresh through the shared sync entrypoint', async () => {
    const refreshTasks = vi.fn().mockResolvedValue(undefined);
    const refreshStats = vi.fn().mockResolvedValue(undefined);

    await syncRuntimeStateWith(refreshTasks, refreshStats);

    expect(refreshTasks).toHaveBeenCalledTimes(1);
    expect(refreshStats).toHaveBeenCalledTimes(1);
  });
});
