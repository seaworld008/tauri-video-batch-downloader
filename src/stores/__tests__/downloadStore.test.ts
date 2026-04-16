import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDownloadStore } from '../downloadStore';
import { invoke } from '@tauri-apps/api/core';
import type { TaskStatus, VideoTask } from '../../types';
import { createDefaultDownloadStats } from '../../utils/downloadStats';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: toastMock,
}));

describe('downloadStore', () => {
  const buildTask = (id: string, status: TaskStatus): VideoTask => ({
    id,
    url: 'https://example.com/video.mp4',
    title: `Task ${id}`,
    output_path: '/downloads/video.mp4',
    status,
    progress: 0,
    downloaded_size: 0,
    speed: 0,
    display_speed_bps: 0,
    eta: undefined,
    error_message: undefined,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    toastMock.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    vi.mocked(invoke).mockResolvedValue([]);

    // Reset store state between tests
    useDownloadStore.setState({
      tasks: [],
      selectedTasks: [],
      searchQuery: '',
      filterStatus: 'all',
      isLoading: false,
      isImporting: false,
      sortBy: 'created_at',
      sortDirection: 'desc',
    });
  });

  describe('initial state', () => {
    it('has correct initial state', () => {
      const { result } = renderHook(() => useDownloadStore());

      expect(result.current.tasks).toEqual([]);
      expect(result.current.searchQuery).toBe('');
      expect(result.current.filterStatus).toBe('all');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.selectedTasks).toEqual([]);
      expect(result.current.isImporting).toBe(false);
    });

    it('has correct initial stats', () => {
      const { result } = renderHook(() => useDownloadStore());

      expect(result.current.stats).toEqual({
        total_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        active_downloads: 0,
        queue_paused: false,
        average_transfer_duration: 0,
        average_commit_duration: 0,
        p95_commit_duration: 0,
        failed_commit_count: 0,
        commit_warning_count: 0,
        commit_elevated_warning_count: 0,
      });
    });

    it('has correct initial config', () => {
      const { result } = renderHook(() => useDownloadStore());

      expect(result.current.config).toBeDefined();
      expect(result.current.config.concurrent_downloads).toBe(3);
      expect(result.current.config.retry_attempts).toBe(3);
      expect(result.current.config.timeout_seconds).toBe(30);
    });
  });

  describe('UI state management', () => {
    it('updates search query', () => {
      const { result } = renderHook(() => useDownloadStore());

      act(() => {
        result.current.setSearchQuery('test query');
      });

      expect(result.current.searchQuery).toBe('test query');
    });

    it('records and clears recent import session state', () => {
      const { result } = renderHook(() => useDownloadStore());
      const snapshot = [buildTask('task-import-1', 'pending')];

      act(() => {
        result.current.recordRecentImport(['task-import-1'], snapshot);
      });

      expect(result.current.recentImportTaskIds).toEqual(['task-import-1']);
      expect(result.current.recentImportSnapshot).toEqual(snapshot);

      act(() => {
        result.current.clearRecentImport();
      });

      expect(result.current.recentImportTaskIds).toEqual([]);
      expect(result.current.recentImportSnapshot).toEqual([]);
    });

    it('enqueues only existing tasks for download orchestration', async () => {
      const { result } = renderHook(() => useDownloadStore());

      useDownloadStore.setState({
        tasks: [buildTask('task-1', 'pending')],
      });

      const startDownload = vi.fn().mockResolvedValue('started');
      useDownloadStore.setState({ startDownload } as Partial<ReturnType<typeof useDownloadStore.getState>>);

      act(() => {
        result.current.enqueueDownloads(['task-1', 'missing-task']);
      });

      await vi.waitFor(() => {
        expect(startDownload).toHaveBeenCalledTimes(1);
      });

      expect(startDownload).toHaveBeenCalledWith('task-1', { suppressConcurrencyToast: true });
    });

    it('builds import tasks from urls via shared import orchestration helper', async () => {
      const { result } = renderHook(() => useDownloadStore());
      const addTasks = vi.fn().mockResolvedValue([]);

      useDownloadStore.setState({
        config: {
          ...useDownloadStore.getState().config,
          output_directory: '/downloads/imported',
        },
        addTasks,
      } as Partial<ReturnType<typeof useDownloadStore.getState>>);

      await act(async () => {
        await result.current.importFromUrls(['https://example.com/a.mp4']);
      });

      expect(addTasks).toHaveBeenCalledWith([
        expect.objectContaining({
          url: 'https://example.com/a.mp4',
          title: 'https://example.com/a.mp4',
          output_path: '/downloads/imported',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
          display_speed_bps: 0,
        }),
      ]);
    });

    it('validates imported rows through shared importValidation/importOrchestration helpers', async () => {
      const { result } = renderHook(() => useDownloadStore());
      const addTasks = vi.fn().mockResolvedValue([]);

      useDownloadStore.setState({
        config: {
          ...useDownloadStore.getState().config,
          output_directory: '/downloads/imported',
        },
        addTasks,
      } as Partial<ReturnType<typeof useDownloadStore.getState>>);

      vi.mocked(invoke).mockResolvedValueOnce([
        {
          record_url: 'https://example.com/video-1.m3u8',
          zl_name: '专栏A',
          kc_name: '课程A',
        },
        {
          zl_name: '缺少链接',
        },
      ] as never);

      await act(async () => {
        await result.current.importFromFile('/tmp/tasks.csv');
      });

      expect(invoke).toHaveBeenCalledWith('import_csv_file', {
        filePath: '/tmp/tasks.csv',
      });
      expect(addTasks).toHaveBeenCalledWith([
        expect.objectContaining({
          url: 'https://example.com/video-1.m3u8',
          title: '课程A',
          output_path: '/downloads/imported/专栏A',
        }),
      ]);
      expect(useDownloadStore.getState().validationErrors).toEqual([
        '第2行: 导入数据必须包含有效的视频URL',
      ]);
      expect(useDownloadStore.getState().isImporting).toBe(false);
    });

    it('updates filter status', () => {
      const { result } = renderHook(() => useDownloadStore());

      act(() => {
        result.current.setFilterStatus('downloading');
      });

      expect(result.current.filterStatus).toBe('downloading');
    });

    it('manages selected tasks', () => {
      const { result } = renderHook(() => useDownloadStore());

      act(() => {
        result.current.setSelectedTasks(['task1', 'task2']);
      });

      expect(result.current.selectedTasks).toEqual(['task1', 'task2']);
    });

    it('toggles task selection', () => {
      const { result } = renderHook(() => useDownloadStore());

      // Start with no selections
      expect(result.current.selectedTasks).toEqual([]);

      // Add first task
      act(() => {
        result.current.toggleTaskSelection('task1');
      });

      expect(result.current.selectedTasks).toEqual(['task1']);

      // Add second task
      act(() => {
        result.current.toggleTaskSelection('task2');
      });

      expect(result.current.selectedTasks).toEqual(['task1', 'task2']);

      // Remove first task
      act(() => {
        result.current.toggleTaskSelection('task1');
      });

      expect(result.current.selectedTasks).toEqual(['task2']);

      // Remove second task
      act(() => {
        result.current.toggleTaskSelection('task2');
      });

      expect(result.current.selectedTasks).toEqual([]);
    });

    it('clears selection', () => {
      const { result } = renderHook(() => useDownloadStore());

      act(() => {
        result.current.setSelectedTasks(['task1', 'task2']);
        result.current.clearSelection();
      });

      expect(result.current.selectedTasks).toEqual([]);
    });
  });

  describe('sorting configuration', () => {
    it('sets sort by field', () => {
      const { result } = renderHook(() => useDownloadStore());

      act(() => {
        result.current.setSortBy('title');
      });

      expect(result.current.sortBy).toBe('title');
      expect(result.current.sortDirection).toBe('asc');
    });

    it('toggles sort direction when setting same field', () => {
      const { result } = renderHook(() => useDownloadStore());

      act(() => {
        result.current.setSortBy('title', 'asc');
      });

      expect(result.current.sortBy).toBe('title');
      expect(result.current.sortDirection).toBe('asc');

      act(() => {
        result.current.setSortBy('title');
      });

      expect(result.current.sortDirection).toBe('desc');
    });
  });

  describe('async operations', () => {
    it('delegates task creation to the extracted taskCreation seam', async () => {
      const { result } = renderHook(() => useDownloadStore());
      const mockTasks = [
        {
          url: 'https://example.com/video.mp4',
          title: 'Test Video',
          output_path: '/downloads/video.mp4',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
          eta: undefined,
          error_message: undefined,
        },
      ];

      const addDownloadTasksCommand = vi.fn().mockResolvedValue([]);
      useDownloadStore.setState({ addTasks: result.current.addTasks } as any);
      vi.mocked(invoke).mockResolvedValue([]);

      await act(async () => {
        await result.current.addTasks(mockTasks);
      });

      expect(invoke).not.toHaveBeenCalledWith('add_download_tasks', expect.anything());
    });

    it('calls correct Tauri command for removing tasks and applies the extracted mutation seam', async () => {
      const { result } = renderHook(() => useDownloadStore());
      const taskIds = ['task1', 'task2'];

      useDownloadStore.setState({
        tasks: [buildTask('task1', 'pending'), buildTask('task2', 'completed'), buildTask('task3', 'failed')],
        selectedTasks: ['task1', 'task2'],
      });

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'remove_download_tasks') {
          return Promise.resolve(undefined);
        }
        if (command === 'get_download_stats') {
          return Promise.resolve({
            total_tasks: 1,
            completed_tasks: 0,
            failed_tasks: 1,
            total_downloaded: 0,
            average_speed: 0,
            display_total_speed_bps: 0,
            active_downloads: 0,
            queue_paused: false,
          });
        }
        return Promise.resolve([]);
      });

      await act(async () => {
        await result.current.removeTasks(taskIds);
      });

      expect(invoke).toHaveBeenCalledWith(
        'remove_download_tasks',
        expect.objectContaining({ task_ids: taskIds, taskIds })
      );
      expect(useDownloadStore.getState().tasks.map(task => task.id)).toEqual(['task3']);
      expect(useDownloadStore.getState().selectedTasks).toEqual([]);
      expect(toastMock.success).toHaveBeenCalledWith('已删除 2 个任务');
    });

    it('clears completed tasks through the extracted mutation seam', async () => {
      const { result } = renderHook(() => useDownloadStore());

      useDownloadStore.setState({
        tasks: [buildTask('task1', 'pending'), buildTask('task2', 'completed')],
        selectedTasks: ['task1', 'task2'],
      });

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'clear_completed_tasks') {
          return Promise.resolve(undefined);
        }
        if (command === 'get_download_stats') {
          return Promise.resolve({
            total_tasks: 1,
            completed_tasks: 0,
            failed_tasks: 0,
            total_downloaded: 0,
            average_speed: 0,
            display_total_speed_bps: 0,
            active_downloads: 0,
            queue_paused: false,
          });
        }
        return Promise.resolve([]);
      });

      await act(async () => {
        await result.current.clearCompletedTasks();
      });

      expect(invoke).toHaveBeenCalledWith('clear_completed_tasks');
      expect(useDownloadStore.getState().tasks.map(task => task.id)).toEqual(['task1']);
      expect(useDownloadStore.getState().selectedTasks).toEqual(['task1']);
      expect(toastMock.success).toHaveBeenCalledWith('已清除完成的任务');
    });

    it('delegates download control through extracted command seams', async () => {
      const { result } = renderHook(() => useDownloadStore());
      const taskId = 'test-task-id';

      await expect(result.current.startDownload(taskId)).resolves.toBe('started');

      await act(async () => {
        await result.current.pauseDownload(taskId);
      });

      await act(async () => {
        await result.current.resumeDownload(taskId);
      });
    });

    it('does not optimistically mutate status for control actions', async () => {
      const { result } = renderHook(() => useDownloadStore());

      useDownloadStore.setState({
        tasks: [
          buildTask('pending-task', 'pending'),
          buildTask('paused-task', 'paused'),
          buildTask('downloading-task', 'downloading'),
        ],
      });

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (
          command === 'start_download' ||
          command === 'resume_download' ||
          command === 'cancel_download' ||
          command === 'pause_all_downloads'
        ) {
          return Promise.resolve(undefined);
        }
        if (command === 'get_download_tasks') {
          return Promise.resolve([
            buildTask('pending-task', 'pending'),
            buildTask('paused-task', 'paused'),
            buildTask('downloading-task', 'downloading'),
          ]);
        }
        if (command === 'get_download_stats') {
          return Promise.resolve({
            total_tasks: 3,
            completed_tasks: 0,
            failed_tasks: 0,
            total_downloaded: 0,
            average_speed: 0,
            display_total_speed_bps: 0,
            active_downloads: 1,
            queue_paused: false,
          });
        }
        return Promise.resolve([]);
      });

      await act(async () => {
        await result.current.startDownload('pending-task');
      });
      expect(
        useDownloadStore.getState().tasks.find(task => task.id === 'pending-task')?.status
      ).toBe('pending');

      await act(async () => {
        await result.current.resumeDownload('paused-task');
      });
      expect(
        useDownloadStore.getState().tasks.find(task => task.id === 'paused-task')?.status
      ).toBe('paused');

      await act(async () => {
        await result.current.cancelDownload('downloading-task');
      });
      expect(
        useDownloadStore.getState().tasks.find(task => task.id === 'downloading-task')?.status
      ).toBe('downloading');

      await act(async () => {
        await result.current.pauseAllDownloads();
      });
      expect(
        useDownloadStore.getState().tasks.find(task => task.id === 'downloading-task')?.status
      ).toBe('downloading');
    });

    it('handles initialization correctly', async () => {
      const { result } = renderHook(() => useDownloadStore());

      const mockTasks = [];
      const mockStats = { total_tasks: 0 };

      vi.mocked(invoke)
        .mockResolvedValueOnce(mockTasks)
        .mockResolvedValueOnce(mockStats);

      await act(async () => {
        await result.current.initializeStore();
      });

      expect(invoke).toHaveBeenCalledWith('get_download_tasks');
      expect(invoke).not.toHaveBeenCalledWith('get_config');
      expect(invoke).toHaveBeenCalledWith('get_download_stats');
    });

    it('refreshes data correctly', async () => {
      const { result } = renderHook(() => useDownloadStore());

      await act(async () => {
        await result.current.refreshTasks();
      });

      expect(invoke).toHaveBeenCalledWith('get_download_tasks');

      await act(async () => {
        await result.current.refreshStats();
      });

      expect(invoke).toHaveBeenCalledWith('get_download_stats');
    });

    it('syncs runtime state through the shared refresh entrypoint', async () => {
      const { result } = renderHook(() => useDownloadStore());

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'get_download_tasks') {
          return Promise.resolve([buildTask('task-1', 'downloading')]);
        }
        if (command === 'get_download_stats') {
          return Promise.resolve({
            total_tasks: 1,
            completed_tasks: 0,
            failed_tasks: 0,
            total_downloaded: 0,
            average_speed: 0,
            display_total_speed_bps: 0,
            active_downloads: 1,
            queue_paused: false,
          });
        }
        return Promise.resolve([]);
      });

      await act(async () => {
        await result.current.syncRuntimeState('test-sync');
      });

      expect(invoke).toHaveBeenCalledWith('get_download_tasks');
      expect(invoke).toHaveBeenCalledWith('get_download_stats');
      expect(useDownloadStore.getState().tasks).toHaveLength(1);
      expect(useDownloadStore.getState().stats.total_tasks).toBe(1);
    });

    it('validateAndSync returns true when frontend/backend snapshots are already consistent', async () => {
      const { result } = renderHook(() => useDownloadStore());
      const futureNow = Date.now() + 60_000;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(futureNow);
      const task = buildTask('task-validate-1', 'pending');
      const stats = {
        total_tasks: 1,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        active_downloads: 0,
        queue_paused: false,
      };

      useDownloadStore.setState({
        tasks: [task],
        stats,
      });

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'get_download_tasks') {
          return Promise.resolve([task]);
        }
        if (command === 'get_download_stats') {
          return Promise.resolve(stats);
        }
        return Promise.resolve([]);
      });

      let syncResult = false;
      await act(async () => {
        syncResult = await result.current.validateAndSync();
      });

      expect(syncResult).toBe(true);
      expect(invoke).toHaveBeenCalledWith('get_download_tasks');
      expect(invoke).toHaveBeenCalledWith('get_download_stats');
      expect(useDownloadStore.getState().tasks).toEqual([task]);
      expect(useDownloadStore.getState().stats.total_tasks).toBe(1);
      nowSpy.mockRestore();
    });

    it('validateAndSync pulls backend truth back into the store when validation finds drift', async () => {
      const { result } = renderHook(() => useDownloadStore());
      const futureNow = Date.now() + 120_000;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(futureNow);
      const backendTask = buildTask('task-validate-2', 'downloading');
      const backendStats = {
        total_tasks: 1,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        active_downloads: 1,
        queue_paused: false,
      };

      useDownloadStore.setState({
        tasks: [],
        stats: createDefaultDownloadStats(),
      });

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'get_download_tasks') {
          return Promise.resolve([backendTask]);
        }
        if (command === 'get_download_stats') {
          return Promise.resolve(backendStats);
        }
        return Promise.resolve([]);
      });

      let syncResult = false;
      await act(async () => {
        syncResult = await result.current.validateAndSync();
      });

      expect(syncResult).toBe(true);
      expect(invoke).toHaveBeenCalledWith('get_download_tasks');
      expect(invoke).toHaveBeenCalledWith('get_download_stats');
      expect(useDownloadStore.getState().tasks).toHaveLength(1);
      expect(useDownloadStore.getState().tasks[0]?.id).toBe('task-validate-2');
      expect(useDownloadStore.getState().stats.active_downloads).toBe(1);
      nowSpy.mockRestore();
    });

    it('forceSync refreshes tasks/stats through extracted validation helpers', async () => {
      const { result } = renderHook(() => useDownloadStore());

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'get_download_tasks') {
          return Promise.resolve([buildTask('task-force-1', 'downloading')]);
        }
        if (command === 'get_download_stats') {
          return Promise.resolve({
            total_tasks: 1,
            completed_tasks: 0,
            failed_tasks: 0,
            total_downloaded: 0,
            average_speed: 0,
            display_total_speed_bps: 0,
            active_downloads: 1,
            queue_paused: false,
          });
        }
        return Promise.resolve([]);
      });

      await act(async () => {
        await result.current.forceSync();
      });

      expect(invoke).toHaveBeenCalledWith('get_download_tasks');
      expect(invoke).toHaveBeenCalledWith('get_download_stats');
      expect(useDownloadStore.getState().tasks).toHaveLength(1);
      expect(useDownloadStore.getState().tasks[0]?.id).toBe('task-force-1');
      expect(useDownloadStore.getState().stats.total_tasks).toBe(1);
    });

    it('applies a temporary output directory override to target tasks', async () => {
      const { result } = renderHook(() => useDownloadStore());

      useDownloadStore.setState({
        tasks: [buildTask('task-1', 'pending')],
        config: {
          ...useDownloadStore.getState().config,
          output_directory: '/downloads',
        },
      });

      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'update_task_output_paths') {
          return Promise.resolve([
            {
              ...buildTask('task-1', 'pending'),
              output_path: 'D:/Video/video.mp4',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      await act(async () => {
        await result.current.applyOutputDirectoryOverride(['task-1'], 'D:/Video');
      });

      expect(invoke).toHaveBeenCalledWith(
        'update_task_output_paths',
        expect.objectContaining({
          task_updates: [{ task_id: 'task-1', output_path: 'D:/Video/video.mp4' }],
        })
      );
      expect(useDownloadStore.getState().tasks[0]?.output_path).toBe('D:/Video/video.mp4');
    });
  });

  describe('error handling', () => {
    it('handles add tasks error gracefully', async () => {
      const { result } = renderHook(() => useDownloadStore());

      vi.mocked(invoke).mockRejectedValue(new Error('Failed to add tasks'));

      await act(async () => {
        await result.current.addTasks([]);
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('handles initialization error gracefully', async () => {
      const { result } = renderHook(() => useDownloadStore());

      vi.mocked(invoke).mockRejectedValue(new Error('Initialization failed'));

      await act(async () => {
        await result.current.initializeStore();
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('retryFailedTasks', () => {
    it('shows a no-op toast when there is no failed task', async () => {
      useDownloadStore.setState({
        tasks: [buildTask('task-1', 'completed')],
      });

      const startDownload = vi.fn().mockResolvedValue('started');
      useDownloadStore.setState({ startDownload } as Partial<ReturnType<typeof useDownloadStore.getState>>);

      const { result } = renderHook(() => useDownloadStore());

      await act(async () => {
        await result.current.retryFailedTasks();
      });

      expect(startDownload).not.toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith('没有可重试的失败任务');
      expect(toastMock.success).not.toHaveBeenCalled();
    });

    it('retries failed tasks through the extracted helper path', async () => {
      useDownloadStore.setState({
        tasks: [buildTask('task-1', 'failed'), buildTask('task-2', 'failed')],
      });

      const startDownload = vi.fn().mockResolvedValue('started');
      useDownloadStore.setState({ startDownload } as Partial<ReturnType<typeof useDownloadStore.getState>>);

      const { result } = renderHook(() => useDownloadStore());

      await act(async () => {
        await result.current.retryFailedTasks();
      });

      expect(startDownload.mock.calls).toEqual([
        ['task-1', { suppressConcurrencyToast: true }],
        ['task-2', { suppressConcurrencyToast: true }],
      ]);
      expect(toastMock.success).toHaveBeenCalledWith('已将 2 个失败任务重新提交到下载队列');
    });
  });

  describe('startAllDownloads', () => {
    it('delegates start-all decision to backend without branching', async () => {
      vi.mocked(invoke).mockImplementation((command: any) => {
        if (command === 'start_all_downloads') return Promise.resolve(2);
        if (command === 'get_download_tasks') return Promise.resolve([]);
        if (command === 'get_download_stats') {
          return Promise.resolve({
            total_tasks: 0,
            completed_tasks: 0,
            failed_tasks: 0,
            total_downloaded: 0,
            average_speed: 0,
            display_total_speed_bps: 0,
            active_downloads: 0,
            queue_paused: false,
          });
        }
        return Promise.resolve([]);
      });

      useDownloadStore.setState({
        tasks: [buildTask('task-1', 'paused'), buildTask('task-2', 'pending')],
        selectedTasks: [],
      });

      const { result } = renderHook(() => useDownloadStore());

      await act(async () => {
        await result.current.startAllDownloads();
      });

      expect(invoke).toHaveBeenCalledWith('start_all_downloads');
    });

    it('starts selected tasks sequentially through the extracted helper path', async () => {
      useDownloadStore.setState({
        tasks: [buildTask('task-1', 'pending'), buildTask('task-2', 'paused')],
        selectedTasks: ['task-1', 'task-2'],
      });

      const startDownload = vi.fn().mockResolvedValue('started');
      useDownloadStore.setState({ startDownload } as Partial<ReturnType<typeof useDownloadStore.getState>>);

      const { result } = renderHook(() => useDownloadStore());

      await act(async () => {
        await result.current.startAllDownloads();
      });

      expect(startDownload.mock.calls).toEqual([
        ['task-1', { suppressConcurrencyToast: true }],
        ['task-2', { suppressConcurrencyToast: true }],
      ]);
      expect(invoke).not.toHaveBeenCalledWith('start_all_downloads');
    });

    it('shows a no-op toast when there is no startable task', async () => {
      useDownloadStore.setState({
        tasks: [buildTask('task-1', 'completed')],
        selectedTasks: [],
      });

      const { result } = renderHook(() => useDownloadStore());

      await act(async () => {
        await result.current.startAllDownloads();
      });

      expect(toastMock).toHaveBeenCalledWith('没有可开始的下载任务');
    });
  });
});
