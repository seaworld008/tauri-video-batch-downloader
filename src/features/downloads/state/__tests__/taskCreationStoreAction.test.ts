import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTaskCreationStoreAction } from '../taskCreationStoreAction';

const buildInputTask = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://example.com/video.mp4',
  title: 'Video',
  output_path: '/downloads/video.mp4',
  progress: 0,
  downloaded_size: 0,
  speed: 0,
  display_speed_bps: 0,
  ...overrides,
});

const buildRuntimeTask = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  url: 'https://example.com/video.mp4',
  title: 'Video',
  output_path: '/downloads/video.mp4',
  status: 'pending',
  progress: 0,
  downloaded_size: 0,
  speed: 0,
  display_speed_bps: 0,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  ...overrides,
});

describe('taskCreationStoreAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T09:00:00Z'));
  });

  it('applies validation patch, state update, success toast, and deferred validation', async () => {
    const recordValidation = vi.fn();
    const applyValidationPatch = vi.fn();
    const applyStateUpdate = vi.fn();
    const applyFailurePatch = vi.fn();
    const recordRecentImport = vi.fn();
    const refreshStats = vi.fn().mockResolvedValue(undefined);
    const validateAndSync = vi.fn().mockResolvedValue(true);
    const toastApi = { success: vi.fn() };

    const result = await executeTaskCreationStoreAction({
      newTasks: [buildInputTask(), { title: 'Missing URL' }],
      validationStartTime: performance.now(),
      convertTaskForBackend: task => ({ url: task.url, title: task.title }),
      addDownloadTasksCommand: async () => [buildRuntimeTask('task-1')],
      normalizeBackendTask: task => task as any,
      currentTasks: [buildRuntimeTask('existing-task') as any],
      recordValidation,
      getValidationStats: () => ({ total: 1 }),
      getValidationErrors: () => ['旧错误'],
      applyValidationPatch,
      applyStateUpdate,
      applyFailurePatch,
      recordRecentImport,
      refreshStats,
      validateAndSync,
      toastApi,
    });

    expect(result).toHaveLength(1);
    expect(recordValidation).toHaveBeenCalledWith(false, expect.any(Number));
    expect(applyValidationPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: [expect.stringContaining('任务[1]:')],
      })
    );
    expect(applyStateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: expect.arrayContaining([expect.objectContaining({ id: 'task-1' })]),
      }),
      expect.objectContaining({
        最终任务数: 2,
      })
    );
    expect(recordRecentImport).toHaveBeenCalledWith(['task-1'], [expect.objectContaining({ id: 'task-1' })]);
    expect(refreshStats).toHaveBeenCalledTimes(1);
    expect(toastApi.success).toHaveBeenCalledWith(expect.stringContaining('已添加 1/2 个任务'));

    expect(validateAndSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(validateAndSync).toHaveBeenCalledTimes(1);
    expect(applyFailurePatch).not.toHaveBeenCalled();
  });

  it('applies failure patch and rethrows when backend task creation fails', async () => {
    const error = new Error('backend boom');
    const recordValidation = vi.fn();
    const applyFailurePatch = vi.fn();

    await expect(
      executeTaskCreationStoreAction({
        newTasks: [buildInputTask()],
        validationStartTime: performance.now(),
        convertTaskForBackend: task => task,
        addDownloadTasksCommand: async () => {
          throw error;
        },
        normalizeBackendTask: task => task as any,
        currentTasks: [],
        recordValidation,
        getValidationStats: () => ({ total: 1 }),
        getValidationErrors: () => ['旧错误'],
        applyValidationPatch: vi.fn(),
        applyStateUpdate: vi.fn(),
        applyFailurePatch,
        recordRecentImport: vi.fn(),
        refreshStats: vi.fn(),
        validateAndSync: vi.fn(),
        toastApi: { success: vi.fn() },
      })
    ).rejects.toThrow('backend boom');

    expect(recordValidation).toHaveBeenCalledWith(false, expect.any(Number));
    expect(applyFailurePatch).toHaveBeenCalledWith({
      isLoading: false,
      validationErrors: ['旧错误', '任务添加失败: backend boom'],
      lastValidationTime: Date.now(),
    });
  });
});
