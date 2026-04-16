import { describe, expect, it } from 'vitest';
import {
  buildOutputPathOverridePatch,
  prepareOutputPathOverrideRequest,
  selectTasksForOutputOverride,
} from '../taskOutputPathEffects';

describe('taskOutputPathEffects helpers', () => {
  it('selects only tasks targeted for output override', () => {
    const selected = selectTasksForOutputOverride(
      ['task-2'],
      [
        { id: 'task-1', output_path: '/downloads/a.mp4' } as any,
        { id: 'task-2', output_path: '/downloads/b.mp4' } as any,
      ]
    );

    expect(selected).toEqual([{ id: 'task-2', output_path: '/downloads/b.mp4' }]);
  });

  it('builds output override request payload from targeted tasks only', () => {
    const taskUpdates = prepareOutputPathOverrideRequest({
      taskIds: ['task-2'],
      tasks: [
        {
          id: 'task-1',
          title: 'Task 1',
          url: 'https://example.com/a.mp4',
          output_path: '/downloads/a.mp4',
        },
        {
          id: 'task-2',
          title: 'Task 2',
          url: 'https://example.com/b.mp4',
          output_path: '/downloads/subdir/b.mp4',
        },
      ] as any,
      defaultOutputDirectory: '/downloads',
      overrideOutputDirectory: 'D:/Video',
    });

    expect(taskUpdates).toEqual([{ task_id: 'task-2', output_path: 'D:/Video/subdir/b.mp4' }]);
  });

  it('returns an empty output override request when no tasks are targeted', () => {
    expect(
      prepareOutputPathOverrideRequest({
        taskIds: ['missing-task'],
        tasks: [{ id: 'task-1', output_path: '/downloads/a.mp4' } as any],
        defaultOutputDirectory: '/downloads',
        overrideOutputDirectory: 'D:/Video',
      })
    ).toEqual([]);
  });

  it('merges normalized updated tasks back into current store state', () => {
    const patch = buildOutputPathOverridePatch(
      [
        { id: 'task-1', output_path: '/downloads/a.mp4' } as any,
        { id: 'task-2', output_path: '/downloads/b.mp4' } as any,
      ],
      [{ id: 'task-2', output_path: 'D:/Video/b.mp4' }],
      task => task as any
    );

    expect(patch.tasks).toEqual([
      { id: 'task-1', output_path: '/downloads/a.mp4' },
      { id: 'task-2', output_path: 'D:/Video/b.mp4' },
    ]);
  });
});