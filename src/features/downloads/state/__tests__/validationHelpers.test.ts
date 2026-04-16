import { describe, expect, it, vi } from 'vitest';
import {
  buildForceSyncPatch,
  buildForceSyncSummary,
  forceSyncWith,
  runDataIntegrityCheckFor,
} from '../validationHelpers';

describe('validationHelpers', () => {
  it('forceSyncWith fetches tasks and stats through runtime query seams', async () => {
    const fetchTasks = vi.fn().mockResolvedValue([{ id: 'task-1', status: 'Pending' }]);
    const fetchStats = vi.fn().mockResolvedValue({ total_tasks: 1, completed_tasks: 0 });
    const normalizeTask = vi.fn(task => ({ ...task, normalized: true }));

    const result = await forceSyncWith(fetchTasks as any, fetchStats, normalizeTask);

    expect(fetchTasks).toHaveBeenCalledTimes(1);
    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(normalizeTask).toHaveBeenCalledTimes(1);
    expect(result.tasks).toEqual([{ id: 'task-1', status: 'Pending', normalized: true }]);
    expect(result.stats.total_tasks).toBe(1);
  });

  it('buildForceSyncPatch and buildForceSyncSummary keep forceSync state patching/logging thin', () => {
    const result = {
      tasks: [{ id: 'task-1', normalized: true }],
      stats: { total_tasks: 1, completed_tasks: 0 },
    } as any;

    expect(buildForceSyncPatch(result)).toEqual(result);
    expect(buildForceSyncSummary(result)).toEqual({
      totalTasks: 1,
      stats: result.stats,
    });
  });

  it('runDataIntegrityCheckFor delegates to shared integrity checker', () => {
    const result = runDataIntegrityCheckFor([
      { id: 'task-1', title: 'one' },
      { id: 'task-1', title: 'duplicate' },
    ] as any);

    expect(result.duplicates).toContain('task-1');
  });
});
