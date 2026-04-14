import { describe, expect, it } from 'vitest';
import type { VideoTask } from '../../../../schemas';
import { reduceTasksWithProgressUpdate, reduceTasksWithStatusUpdate } from '../eventReducers';

const buildTask = (overrides: Partial<VideoTask> = {}): VideoTask => ({
  id: 'task-1',
  url: 'https://example.com/video.mp4',
  title: 'Video',
  output_path: '/tmp/video.mp4',
  status: 'downloading',
  progress: 20,
  downloaded_size: 200,
  speed: 10,
  display_speed_bps: 8,
  eta: 100,
  error_message: undefined,
  created_at: '2026-04-10T00:00:00.000Z',
  updated_at: '2026-04-10T00:00:00.000Z',
  ...overrides,
});

describe('eventReducers', () => {
  it('updates task status by task id', () => {
    const tasks = [buildTask(), buildTask({ id: 'task-2', status: 'pending' })];

    const updated = reduceTasksWithStatusUpdate(tasks, {
      task_id: 'task-2',
      status: 'failed',
      error_message: 'network error',
    });

    expect(updated[0].status).toBe('downloading');
    expect(updated[1].status).toBe('failed');
    expect(updated[1].error_message).toBe('network error');
  });

  it('clears transfer metrics when task enters committing state', () => {
    const tasks = [buildTask({ progress: 100, speed: 64, display_speed_bps: 64, eta: 5 })];

    const updated = reduceTasksWithStatusUpdate(tasks, {
      task_id: 'task-1',
      status: 'committing',
      error_message: null,
    });

    expect(updated[0].status).toBe('committing');
    expect(updated[0].speed).toBe(0);
    expect(updated[0].display_speed_bps).toBe(0);
    expect(updated[0].eta).toBeUndefined();
    expect(updated[0].progress).toBe(100);
  });

  it('normalizes progressed event into percentage', () => {
    const tasks = [buildTask({ progress: 30, downloaded_size: 300, file_size: 1000 })];

    const updated = reduceTasksWithProgressUpdate(tasks, {
      task_id: 'task-1',
      downloaded_size: 500,
      total_size: 1000,
      progress: 0.5,
      speed: 64,
      display_speed_bps: 48,
    });

    expect(updated[0].progress).toBe(50);
    expect(updated[0].downloaded_size).toBe(500);
    expect(updated[0].file_size).toBe(1000);
    expect(updated[0].speed).toBe(64);
    expect(updated[0].display_speed_bps).toBe(48);
  });

  it('guards progress from regressing when downloaded bytes do not regress', () => {
    const tasks = [buildTask({ progress: 80, downloaded_size: 800, file_size: 1000 })];

    const updated = reduceTasksWithProgressUpdate(tasks, {
      task_id: 'task-1',
      downloaded_size: 900,
      total_size: 1000,
      progress: 0.2,
    });

    expect(updated[0].progress).toBe(80);
    expect(updated[0].downloaded_size).toBe(900);
  });

  it('applies backend progress verbatim instead of inferring lifecycle from percentage', () => {
    const tasks = [buildTask({ progress: 90, downloaded_size: 900, file_size: 1000 })];

    const updated = reduceTasksWithProgressUpdate(tasks, {
      task_id: 'task-1',
      downloaded_size: 980,
      total_size: 1000,
      progress: 1,
    });

    expect(updated[0].progress).toBe(100);
  });
});
