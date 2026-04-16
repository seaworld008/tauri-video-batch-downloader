import { describe, expect, it, vi } from 'vitest';

import { executeOutputPathOverrideStoreAction } from '../taskOutputPathStoreAction';

const buildTask = (id: string, outputPath: string) =>
  ({
    id,
    title: `Task ${id}`,
    url: `https://example.com/${id}.mp4`,
    output_path: outputPath,
  }) as any;

describe('taskOutputPathStoreAction', () => {
  it('skips backend call when there are no matching tasks', async () => {
    const updateTaskOutputPaths = vi.fn();
    const applyPatch = vi.fn();

    await executeOutputPathOverrideStoreAction({
      taskIds: ['missing-task'],
      currentTasks: [buildTask('task-1', '/downloads/video.mp4')],
      defaultOutputDirectory: '/downloads',
      overrideOutputDirectory: 'D:/Video',
      updateTaskOutputPaths,
      normalizeTask: task => task as any,
      applyPatch,
    });

    expect(updateTaskOutputPaths).not.toHaveBeenCalled();
    expect(applyPatch).not.toHaveBeenCalled();
  });

  it('applies normalized backend updates to current tasks', async () => {
    const updateTaskOutputPaths = vi.fn().mockResolvedValue([
      buildTask('task-1', 'D:/Video/video.mp4'),
    ]);
    const applyPatch = vi.fn();

    await executeOutputPathOverrideStoreAction({
      taskIds: ['task-1'],
      currentTasks: [buildTask('task-1', '/downloads/video.mp4')],
      defaultOutputDirectory: '/downloads',
      overrideOutputDirectory: 'D:/Video',
      updateTaskOutputPaths,
      normalizeTask: task => task as any,
      applyPatch,
    });

    expect(updateTaskOutputPaths).toHaveBeenCalledWith([
      { task_id: 'task-1', output_path: 'D:/Video/video.mp4' },
    ]);
    expect(applyPatch).toHaveBeenCalledWith({
      tasks: [buildTask('task-1', 'D:/Video/video.mp4')],
    });
  });
});
