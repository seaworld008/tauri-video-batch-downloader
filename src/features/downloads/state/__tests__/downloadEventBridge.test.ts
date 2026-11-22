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

  it('registers only the canonical download-events listener', async () => {
    vi.resetModules();

    const unlisten = (() => {}) as () => void;
    vi.mocked(listen).mockResolvedValue(unlisten);

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');

    await initializeDownloadEventBridge();

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith('download-events', expect.any(Function));
  });

  it('derives task stats locally from task.status_changed events', async () => {
    vi.resetModules();

    let downloadEventsHandler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
      if (eventName === 'download-events') {
        downloadEventsHandler = handler;
      }
      return (() => {}) as () => void;
    });

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');
    const { useDownloadStore } = await import('../../../../stores/downloadStore');

    const refreshTasks = vi.fn().mockResolvedValue(undefined);
    useDownloadStore.setState({
      tasks: [buildTask('task-1', 'downloading')],
      refreshTasks,
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
    expect(refreshTasks).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(refreshTasks).toHaveBeenCalledTimes(1);
  });

  it('coalesces burst terminal status events into a single refreshTasks call', async () => {
    vi.resetModules();

    let downloadEventsHandler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
      if (eventName === 'download-events') {
        downloadEventsHandler = handler;
      }
      return (() => {}) as () => void;
    });

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');
    const { useDownloadStore } = await import('../../../../stores/downloadStore');

    const refreshTasks = vi.fn().mockResolvedValue(undefined);
    useDownloadStore.setState({
      tasks: [buildTask('task-1', 'downloading'), buildTask('task-2', 'downloading')],
      refreshTasks,
    });

    await initializeDownloadEventBridge();

    for (const [idx, taskId] of ['task-1', 'task-2'].entries()) {
      downloadEventsHandler?.({
        payload: {
          schema_version: 1,
          event_id: `evt-burst-${idx}`,
          event_type: 'task.status_changed',
          ts: '2026-04-16T00:00:00Z',
          payload: {
            task_id: taskId,
            status: 'Completed',
            error_message: null,
          },
        },
      });
    }

    expect(refreshTasks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(refreshTasks).toHaveBeenCalledTimes(1);
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
    expect(syncRuntimeState).not.toHaveBeenCalled();

    useDownloadStore.setState({
      tasks: [buildTask('task-1', 'downloading')],
      syncRuntimeState,
    } as Partial<ReturnType<typeof useDownloadStore.getState>>);

    await vi.advanceTimersByTimeAsync(1500);
    expect(syncRuntimeState).toHaveBeenCalledWith('downloadEventBridge:polling');
  });

  it('bounds listener retries and does not start polling timer when initialization fails', async () => {
    vi.resetModules();

    vi.mocked(listen).mockRejectedValue(new Error('ipc unavailable'));

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');
    const { useDownloadStore } = await import('../../../../stores/downloadStore');

    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);
    useDownloadStore.setState({
      tasks: [buildTask('task-1', 'pending')],
      syncRuntimeState,
    } as Partial<ReturnType<typeof useDownloadStore.getState>>);

    await initializeDownloadEventBridge();
    expect(listen).toHaveBeenCalledTimes(1);

    // Advance past 5 exponential retries (1s + 2s + 4s + 8s + 16s = 31s) and beyond
    await vi.advanceTimersByTimeAsync(60000);

    // 1 initial attempt + 5 retries = 6 total attempts max, and polling timer never ran
    expect(listen).toHaveBeenCalledTimes(6);
    expect(syncRuntimeState).not.toHaveBeenCalled();
  });

  it('coalesces burst terminal status events into summary notifications after 500ms', async () => {
    vi.resetModules();

    let downloadEventsHandler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (eventName: string, handler: any) => {
      if (eventName === 'download-events') {
        downloadEventsHandler = handler;
      }
      return (() => {}) as () => void;
    });

    const { initializeDownloadEventBridge } = await import('../downloadEventBridge');
    const { useDownloadStore } = await import('../../../../stores/downloadStore');
    const { useUIStore } = await import('../../../../stores/uiStore');
    const { useConfigStore } = await import('../../../../stores/configStore');

    useUIStore.setState({ notifications: [] });
    const currentConfig = useConfigStore.getState().config;
    useConfigStore.setState({
      config: {
        ...currentConfig,
        ui: {
          ...currentConfig.ui,
          show_notifications: true,
        },
      },
    });

    const refreshTasks = vi.fn().mockResolvedValue(undefined);
    useDownloadStore.setState({
      tasks: [
        buildTask('task-1', 'downloading'),
        buildTask('task-2', 'downloading'),
        buildTask('task-3', 'downloading'),
      ],
      refreshTasks,
    });

    await initializeDownloadEventBridge();

    downloadEventsHandler?.({
      payload: {
        schema_version: 1,
        event_id: 'evt-c1',
        event_type: 'task.status_changed',
        ts: '2026-04-16T00:00:00Z',
        payload: { task_id: 'task-1', status: 'Completed', error_message: null },
      },
    });
    downloadEventsHandler?.({
      payload: {
        schema_version: 1,
        event_id: 'evt-c2',
        event_type: 'task.status_changed',
        ts: '2026-04-16T00:00:00Z',
        payload: { task_id: 'task-2', status: 'Completed', error_message: null },
      },
    });
    downloadEventsHandler?.({
      payload: {
        schema_version: 1,
        event_id: 'evt-f3',
        event_type: 'task.status_changed',
        ts: '2026-04-16T00:00:00Z',
        payload: { task_id: 'task-3', status: 'Failed', error_message: 'timeout' },
      },
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(useUIStore.getState().notifications).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    const notifications = useUIStore.getState().notifications;
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      type: 'success',
      title: '下载完成',
      message: '已完成 2 个下载任务',
    });
    expect(notifications[1]).toMatchObject({
      type: 'error',
      title: '下载失败',
      message: 'Task task-3：timeout',
    });
  });
});
