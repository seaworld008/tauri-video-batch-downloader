import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeInitializeStoreStoreAction } from '../initializeStoreStoreAction';

describe('initializeStoreStoreAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('records validation, applies success patch, and returns summary', async () => {
    const recordValidation = vi.fn();
    const applySuccessPatch = vi.fn();
    const applyFailurePatch = vi.fn();

    const result = await executeInitializeStoreStoreAction({
      validationStartTime: performance.now(),
      queryTasks: vi.fn().mockResolvedValue([{ id: 'task-1', status: 'pending' }]) as any,
      queryStats: vi.fn().mockResolvedValue({
        total_tasks: 1,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        active_downloads: 0,
        queue_paused: false,
      }) as any,
      currentConfig: {
        concurrent_downloads: 3,
        retry_attempts: 3,
        timeout_seconds: 30,
        user_agent: 'ua',
        proxy: undefined,
        headers: {},
        output_directory: '/downloads',
        auto_verify_integrity: false,
        integrity_algorithm: 'sha256',
        expected_hashes: {},
      } as any,
      currentStats: {
        total_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        active_downloads: 0,
        queue_paused: false,
      } as any,
      normalizeTask: task =>
        ({
          url: 'https://example.com/video.mp4',
          title: 'Task task-1',
          output_path: '/downloads/video.mp4',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
          display_speed_bps: 0,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
          ...((task as Record<string, unknown>) ?? {}),
        }) as any,
      mergeConfig: config => config as any,
      ensureStats: stats => stats as any,
      recordValidation,
      getValidationErrors: () => [],
      applySuccessPatch,
      applyFailurePatch,
    });

    expect(recordValidation).toHaveBeenCalledWith(true, expect.any(Number));
    expect(applyFailurePatch).not.toHaveBeenCalled();
    expect(applySuccessPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: 'task-1' })],
        isLoading: false,
      })
    );
    expect(result.summary).toMatchObject({
      任务数: 1,
      配置状态: '有效',
      统计状态: '有效',
      数据质量: '100%',
    });
  });

  it('records failed validation and applies failure patch when initialization throws', async () => {
    const recordValidation = vi.fn();
    const applySuccessPatch = vi.fn();
    const applyFailurePatch = vi.fn();

    const error = new Error('boom');

    await expect(
      executeInitializeStoreStoreAction({
        validationStartTime: performance.now(),
        queryTasks: vi.fn().mockRejectedValue(error) as any,
        queryStats: vi.fn().mockRejectedValue(error),

        currentConfig: { output_directory: '/downloads' } as any,
        currentStats: { total_tasks: 0 } as any,
        normalizeTask: task => task as any,
        mergeConfig: config => config as any,
        ensureStats: stats => stats as any,
        recordValidation,
        getValidationErrors: () => ['旧错误'],
        applySuccessPatch,
        applyFailurePatch,
      })
    ).rejects.toThrow('boom');

    expect(recordValidation).toHaveBeenCalledWith(false, expect.any(Number));
    expect(applySuccessPatch).not.toHaveBeenCalled();
    expect(applyFailurePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        isLoading: false,
        validationErrors: ['旧错误', '初始化失败: boom'],
      })
    );
  });
});
