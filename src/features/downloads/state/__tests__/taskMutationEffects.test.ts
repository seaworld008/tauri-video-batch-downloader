import { describe, expect, it, vi } from 'vitest';

import {
  buildClearCompletedTasksPatch,
  buildRemoveTasksPatch,
  executeClearCompletedTasksMutation,
  executeRemoveTasksMutation,
} from '../taskMutationEffects';

const buildTask = (id: string, status: 'pending' | 'completed' = 'pending') =>
  ({ id, status, output_path: `/downloads/${id}.mp4` }) as any;

describe('taskMutationEffects', () => {
  it('buildRemoveTasksPatch removes tasks and clears removed selections', () => {
    expect(
      buildRemoveTasksPatch(
        [buildTask('task-1'), buildTask('task-2'), buildTask('task-3')],
        ['task-1', 'task-2'],
        ['task-1', 'task-2']
      )
    ).toEqual({
      tasks: [buildTask('task-3')],
      selectedTasks: [],
    });
  });

  it('buildClearCompletedTasksPatch keeps only non-completed tasks and valid selections', () => {
    expect(
      buildClearCompletedTasksPatch(
        [buildTask('task-1'), buildTask('task-2', 'completed')],
        ['task-1', 'task-2']
      )
    ).toEqual({
      tasks: [buildTask('task-1')],
      selectedTasks: ['task-1'],
    });
  });

  it('executeRemoveTasksMutation applies patch, refreshes stats, and shows success toast', async () => {
    const removeTasks = vi.fn().mockResolvedValue(undefined);
    const refreshStats = vi.fn().mockResolvedValue(undefined);
    const applyPatch = vi.fn();
    const toastApi = { success: vi.fn() };

    await executeRemoveTasksMutation({
      taskIds: ['task-1', 'task-2'],
      currentTasks: [buildTask('task-1'), buildTask('task-2'), buildTask('task-3')],
      selectedTaskIds: ['task-1', 'task-2'],
      removeTasks,
      refreshStats,
      applyPatch,
      toastApi,
    });

    expect(removeTasks).toHaveBeenCalledWith(['task-1', 'task-2']);
    expect(applyPatch).toHaveBeenCalledWith({
      tasks: [buildTask('task-3')],
      selectedTasks: [],
    });
    expect(refreshStats).toHaveBeenCalledOnce();
    expect(toastApi.success).toHaveBeenCalledWith('已删除 2 个任务');
  });

  it('executeClearCompletedTasksMutation applies patch, refreshes stats, and shows success toast', async () => {
    const clearCompletedTasks = vi.fn().mockResolvedValue(undefined);
    const refreshStats = vi.fn().mockResolvedValue(undefined);
    const applyPatch = vi.fn();
    const toastApi = { success: vi.fn() };

    await executeClearCompletedTasksMutation({
      currentTasks: [buildTask('task-1'), buildTask('task-2', 'completed')],
      selectedTaskIds: ['task-1', 'task-2'],
      clearCompletedTasks,
      refreshStats,
      applyPatch,
      toastApi,
    });

    expect(clearCompletedTasks).toHaveBeenCalledOnce();
    expect(applyPatch).toHaveBeenCalledWith({
      tasks: [buildTask('task-1')],
      selectedTasks: ['task-1'],
    });
    expect(refreshStats).toHaveBeenCalledOnce();
    expect(toastApi.success).toHaveBeenCalledWith('已清除完成的任务');
  });
});
