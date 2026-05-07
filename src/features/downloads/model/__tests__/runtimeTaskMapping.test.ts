import { describe, expect, it } from 'vitest';

import {
  convertTaskForBackend,
  fromBackendStatus,
  normalizeBackendTask,
} from '../runtimeTaskMapping';

describe('runtimeTaskMapping', () => {
  it('maps backend status values to frontend statuses', () => {
    expect(fromBackendStatus('Downloading')).toBe('downloading');
    expect(fromBackendStatus('paused')).toBe('paused');
    expect(fromBackendStatus('unknown')).toBe('pending');
    expect(fromBackendStatus(null)).toBe('pending');
  });

  it('converts frontend tasks to backend payload shape', () => {
    expect(
      convertTaskForBackend({
        id: 'task-1',
        url: 'https://example.com/video.mp4',
        title: 'Example',
        status: 'downloading',
        progress: 50,
        output_path: '/tmp/video.mp4',
        created_at: '2026-04-16T00:00:00.000Z',
        updated_at: '2026-04-16T00:00:00.000Z',
        downloader_type: 'ytdlp',
      } as any)
    ).toMatchObject({
      status: 'Downloading',
      downloader_type: 'YtDlp',
    });
  });

  it('normalizes legacy youtube downloader values to ytdlp', () => {
    expect(
      normalizeBackendTask({
        id: 'task-youtube',
        url: 'https://youtu.be/example',
        title: 'Example',
        status: 'Pending',
        progress: 0,
        output_path: '/tmp',
        created_at: '2026-04-16T00:00:00.000Z',
        updated_at: '2026-04-16T00:00:00.000Z',
        downloader_type: 'Youtube',
      })
    ).toMatchObject({
      downloader_type: 'ytdlp',
    });
  });

  it('normalizes backend tasks and drops empty video info', () => {
    expect(
      normalizeBackendTask({
        id: 'task-1',
        url: 'https://example.com/video.mp4',
        title: 'Example',
        status: 'Completed',
        progress: 100,
        output_path: '/tmp/video.mp4',
        created_at: '2026-04-16T00:00:00.000Z',
        updated_at: '2026-04-16T00:00:00.000Z',
        downloader_type: 'Http',
        file_size: 'bad',
        display_speed_bps: 2048,
        video_info: {
          title: '',
        },
      })
    ).toMatchObject({
      status: 'completed',
      downloader_type: 'http',
      file_size: undefined,
      display_speed_bps: 2048,
      video_info: undefined,
    });
  });

  it('keeps normalized video info when meaningful fields exist', () => {
    expect(
      normalizeBackendTask({
        id: 'task-2',
        url: 'https://example.com/video.m3u8',
        title: 'Stream',
        status: 'Pending',
        progress: 0,
        output_path: '/tmp/video.mp4',
        created_at: '2026-04-16T00:00:00.000Z',
        updated_at: '2026-04-16T00:00:00.000Z',
        video_info: {
          name: 'Stream title',
        },
      })
    ).toMatchObject({
      status: 'pending',
      video_info: {
        zl_name: 'Stream title',
      },
    });
  });
});
