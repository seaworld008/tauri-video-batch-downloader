import { describe, expect, it, vi } from 'vitest';
import { createValidationStoreUpdater, runValidationAndSync, shouldRunValidation } from '../validationFlow';

describe('validationFlow helpers', () => {
  it('delegates validation gate decision to the supplied predicate', () => {
    expect(shouldRunValidation(() => true)).toBe(true);
    expect(shouldRunValidation(() => false)).toBe(false);
  });

  it('creates store updaters that normalize tasks and stats before applying them', () => {
    const set = vi.fn();
    const normalizeTask = vi.fn(task => ({ ...task, normalized: true }));
    const ensureStats = vi.fn(stats => ({ ...stats, normalized: true }));

    const updater = createValidationStoreUpdater(set, normalizeTask, ensureStats);

    updater.updateTasks([{ id: 'task-1' } as any]);
    updater.updateStats({ total_tasks: 1 } as any);

    expect(normalizeTask).toHaveBeenCalledTimes(1);
    expect(ensureStats).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenNthCalledWith(1, {
      tasks: [{ id: 'task-1', normalized: true }],
    });
    expect(set).toHaveBeenNthCalledWith(2, {
      stats: { total_tasks: 1, normalized: true },
    });
  });

  it('short-circuits when validation is skipped', async () => {
    const validateStateFn = vi.fn();
    const syncStatesFn = vi.fn();

    await expect(
      runValidationAndSync({
        tasks: [],
        stats: { total_tasks: 0 } as any,
        shouldValidateFn: () => false,
        validateStateFn,
        set: vi.fn(),
        normalizeTask: task => task,
        ensureStatsFn: stats => stats,
        syncStatesFn,
      })
    ).resolves.toBe(true);

    expect(validateStateFn).not.toHaveBeenCalled();
    expect(syncStatesFn).not.toHaveBeenCalled();
  });

  it('returns true without syncing when validation reports consistency', async () => {
    const validateStateFn = vi.fn().mockResolvedValue({
      isConsistent: true,
      issues: [],
      syncSuggestion: 'USE_BACKEND',
    });
    const syncStatesFn = vi.fn();

    await expect(
      runValidationAndSync({
        tasks: [{ id: 'task-1' } as any],
        stats: { total_tasks: 1 } as any,
        shouldValidateFn: () => true,
        validateStateFn,
        set: vi.fn(),
        normalizeTask: task => task,
        ensureStatsFn: stats => stats,
        syncStatesFn,
      })
    ).resolves.toBe(true);

    expect(validateStateFn).toHaveBeenCalledTimes(1);
    expect(syncStatesFn).not.toHaveBeenCalled();
  });

  it('syncs through the supplied executor when validation finds inconsistencies', async () => {
    const set = vi.fn();
    const normalizeTask = vi.fn(task => ({ ...task, normalized: true }));
    const ensureStatsFn = vi.fn(stats => ({ ...stats, normalized: true }));
    const validationResult = {
      isConsistent: false,
      issues: [{ type: 'MISSING_TASK', description: 'missing task' }],
      syncSuggestion: 'USE_BACKEND',
    } as any;
    const validateStateFn = vi.fn().mockResolvedValue(validationResult);
    const syncStatesFn = vi.fn().mockImplementation(async (_result, storeUpdater) => {
      storeUpdater.updateTasks([{ id: 'task-2' } as any]);
      storeUpdater.updateStats({ total_tasks: 2 } as any);
      return true;
    });

    await expect(
      runValidationAndSync({
        tasks: [{ id: 'task-1' } as any],
        stats: { total_tasks: 1 } as any,
        shouldValidateFn: () => true,
        validateStateFn,
        set,
        normalizeTask,
        ensureStatsFn,
        syncStatesFn,
      })
    ).resolves.toBe(true);

    expect(syncStatesFn).toHaveBeenCalledTimes(1);
    expect(syncStatesFn.mock.calls[0][0]).toEqual(validationResult);
    expect(normalizeTask.mock.calls[0]?.[0]).toEqual({ id: 'task-2' });
    expect(ensureStatsFn).toHaveBeenCalledWith({ total_tasks: 2 });
    expect(set).toHaveBeenNthCalledWith(1, {
      tasks: [{ id: 'task-2', normalized: true }],
    });
    expect(set).toHaveBeenNthCalledWith(2, {
      stats: { total_tasks: 2, normalized: true },
    });
  });
});
