import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import type { VideoTask } from '../../../../types';

const buildTask = (id: string, status: VideoTask['status']): VideoTask => ({
  id,
  url: 'https://example.com/video.mp4',
  title: `Task ${id}`,
  output_path: '/downloads/video.mp4',
  status,
  progress: 0,
  downloaded_size: 0,
  speed: 128,
  display_speed_bps: 128,
  eta: 10,
  error_message: undefined,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

describe('downloadEventBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers only the canonical download.events listener', async () => {
    vi.resetModules();

    const unlisten = (() => {}) as () => void;
    vi.mocked(listen).mockResolvedValue(unlisten);

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');

    await initializeDownloadEventBridge();

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith('download.events', expect.any(Function));
  });

  it('derives task stats locally from task.status_changed events', async () => {
    vi.resetModules();

    let downloadEventsHandler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
      if (eventName === 'download.events') {
        downloadEventsHandler = handler;
      }
      return (() => {}) as () => void;
    });

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');
    const { useDownloadStore } = await import('../../../../stores/downloadStore');

    useDownloadStore.setState({
      tasks: [buildTask('task-1', 'downloading')],
      stats: {
        ...useDownloadStore.getState().stats,
        total_tasks: 1,
        active_downloads: 1,
      },
    });

    await initializeDownloadEventBridge();
    expect(downloadEventsHandler).toBeDefined();

    downloadEventsHandler?.({
      payload: {
        schema_version: 1,
        event_id: 'evt-1',
        event_type: 'task.status_changed',
        ts: '2026-04-16T00:00:00Z',
        payload: {
          task_id: 'task-1',
          status: 'Completed',
          error_message: null,
        },
      },
    });

    const state = useDownloadStore.getState();
    expect(state.tasks[0]?.status).toBe('completed');
    expect(state.tasks[0]?.speed).toBe(0);
    expect(state.stats.total_tasks).toBe(1);
    expect(state.stats.completed_tasks).toBe(1);
    expect(state.stats.active_downloads).toBe(0);
  });

  it('uses polling only as a runtime sync compensator when work is active', async () => {
    vi.resetModules();

    vi.mocked(listen).mockResolvedValue((() => {}) as () => void);

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');
    const { useDownloadStore } = await import('../../../../stores/downloadStore');

    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);
    useDownloadStore.setState({
      tasks: [buildTask('task-1', 'pending')],
      syncRuntimeState,
    } as Partial<ReturnType<typeof useDownloadStore.getState>>);

    await initializeDownloadEventBridge();
    await vi.advanceTimersByTimeAsync(1500);

    expect(syncRuntimeState).toHaveBeenCalledWith('downloadEventBridge:polling');
  });
});
