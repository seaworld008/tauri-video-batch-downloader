import { describe, expect, it, vi } from 'vitest';
import {
  buildInitializeStoreFailurePatch,
  buildInitializeStoreSuccessSummary,
  buildInitializeStorePatch,
  fetchInitialRuntimeSnapshot,
  prepareInitializeStoreSuccess,
  validateInitialRuntimeSnapshot,
} from '../initializeStoreBootstrap';

describe('initializeStoreBootstrap helpers', () => {
  it('fetches initial runtime tasks and stats in parallel', async () => {
    const queryTasks = vi.fn().mockResolvedValue([{ id: 'task-1' }]);
    const queryStats = vi.fn().mockResolvedValue({ total_tasks: 1 });

    await expect(fetchInitialRuntimeSnapshot(queryTasks as any, queryStats)).resolves.toEqual({
      rawTasks: [{ id: 'task-1' }],
      rawStats: { total_tasks: 1 },
    });
  });

  it('validates snapshot and falls back when config/stats are invalid', () => {
    const result = validateInitialRuntimeSnapshot({
      normalizedTasks: [] as any,
      normalizedConfig: {} as any,
      rawStats: {} as any,
      fallbackConfig: { output_directory: '/downloads' } as any,
      fallbackStats: { total_tasks: 0 } as any,
    });

    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.validatedConfig).toEqual({ output_directory: '/downloads' });
    expect(result.validatedStats).toEqual({ total_tasks: 0 });
  });

  it('prepares initialize-store success patch and summary through one seam', async () => {
    const queryTasks = vi.fn().mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
    const queryStats = vi.fn().mockResolvedValue({
      total_tasks: 1,
      completed_tasks: 0,
      failed_tasks: 0,
      total_downloaded: 0,
      average_speed: 0,
      display_total_speed_bps: 0,
      active_downloads: 0,
      queue_paused: false,
    });

    const result = await prepareInitializeStoreSuccess({
      queryTasks: queryTasks as any,
      queryStats,
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
      ensureStats: stats => ({ ...stats, normalized: true } as any),
    });

    expect(result.validatedTasks).toMatchObject([
      {
        id: 'task-1',
        status: 'pending',
        output_path: '/downloads/video.mp4',
      },
    ]);
    expect((result.patch.stats as any).normalized).toBe(true);

    const summary = buildInitializeStoreSuccessSummary({
      validatedTasks: result.validatedTasks,
      validations: result.validations,
      durationMs: 12.34,
    });

    expect(summary).toMatchObject({
      任务数: 1,
      配置状态: '有效',
      统计状态: '有效',
      数据质量: '100%',
    });
    expect(summary.验证耗时).toBe('12.34ms');
  });

  it('builds initialize-store success and failure patches', () => {
    const patch = buildInitializeStorePatch({
      tasks: [{ id: 'task-1' } as any],
      config: { output_directory: '/downloads' } as any,
      stats: { total_tasks: 1 } as any,
      validationErrors: [],
      ensureStats: stats => ({ ...stats, normalized: true } as any),
    });

    expect(patch.tasks).toEqual([{ id: 'task-1' }]);
    expect((patch.stats as any).normalized).toBe(true);
    expect(patch.isLoading).toBe(false);

    const failurePatch = buildInitializeStoreFailurePatch(['旧错误'], new Error('boom'));
    expect(failurePatch.validationErrors).toEqual(['旧错误', '初始化失败: boom']);
  });
});
