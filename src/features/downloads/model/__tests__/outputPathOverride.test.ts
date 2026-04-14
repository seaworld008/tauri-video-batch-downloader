import { describe, expect, it } from 'vitest';
import type { VideoTask } from '../../../../types';
import {
  buildTaskOutputPathPreview,
  buildTaskOutputPathUpdates,
  rebaseTaskOutputPath,
} from '../outputPathOverride';

const createTask = (id: string, output_path: string): VideoTask => ({
  id,
  url: 'https://example.com/video.mp4',
  title: 'Video',
  output_path,
  resolved_path: '/downloads/course-a/video.mp4',
  status: 'pending',
  progress: 0,
  downloaded_size: 0,
  speed: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
});

describe('outputPathOverride', () => {
  it('rebases paths under the default root while preserving the suffix', () => {
    expect(rebaseTaskOutputPath('/downloads/course-a', '/downloads', 'D:/Video')).toBe(
      'D:/Video/course-a'
    );
  });

  it('rebases relative task output paths under the override root', () => {
    expect(rebaseTaskOutputPath('./downloads', '/downloads', 'D:/Video')).toBe(
      'D:/Video/downloads'
    );
  });

  it('falls back to the leaf segment for absolute paths outside the default root', () => {
    expect(rebaseTaskOutputPath('E:/legacy/custom-folder', '/downloads', 'D:/Video')).toBe(
      'D:/Video/custom-folder'
    );
  });

  it('builds batch task output path updates', () => {
    const updates = buildTaskOutputPathUpdates(
      [createTask('task-1', '/downloads/course-a'), createTask('task-2', '/downloads/course-b')],
      '/downloads',
      'D:/Video'
    );

    expect(updates).toEqual([
      { task_id: 'task-1', output_path: 'D:/Video/course-a' },
      { task_id: 'task-2', output_path: 'D:/Video/course-b' },
    ]);
  });

  it('builds a preview path for the sample task', () => {
    const preview = buildTaskOutputPathPreview(
      createTask('task-1', '/downloads/course-a'),
      '/downloads',
      'D:/Video'
    );

    expect(preview).toBe('D:/Video/course-a/video.mp4');
  });

  it('prefers task title plus url extension for generic media filenames', () => {
    const preview = buildTaskOutputPathPreview(
      {
        ...createTask('task-2', '/downloads/course-a'),
        title: '2、阳台月季种植',
        resolved_path: undefined,
        url: 'https://example.com/playlist.f9.mp4',
      },
      '/downloads',
      'D:/Video'
    );

    expect(preview).toBe('D:/Video/course-a/2、阳台月季种植.mp4');
  });
});
