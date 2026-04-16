import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeForceSyncStoreAction,
  executeValidateAndSyncStoreAction,
} from '../validationStoreAction';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnostic: vi.fn(),
  reportFrontendDiagnosticIfEnabled: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('validationStoreAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates validate-and-sync orchestration while keeping logging local to the store seam', async () => {
    frontendLoggingMocks.reportFrontendDiagnostic.mockReset();
    frontendLoggingMocks.reportFrontendDiagnosticIfEnabled.mockReset();
    const validateStateFn = vi.fn().mockResolvedValue({
      isConsistent: false,
      issues: ['stats drift'],
      syncSuggestion: {
        tasks: [
          {
            id: 'task-1',
            status: 'pending',
            url: 'https://example.com/video.mp4',
            title: 'Task 1',
            output_path: '/downloads/video.mp4',
            progress: 0,
            downloaded_size: 0,
            speed: 0,
            display_speed_bps: 0,
            created_at: new Date(0).toISOString(),
            updated_at: new Date(0).toISOString(),
          },
        ],
        stats: {
          total_tasks: 1,
          completed_tasks: 0,
          failed_tasks: 0,
          total_downloaded: 0,
          average_speed: 0,
          display_total_speed_bps: 0,
          active_downloads: 0,
          queue_paused: false,
        },
      },
    });
    const syncStatesFn = vi.fn().mockResolvedValue(true);

    const result = await executeValidateAndSyncStoreAction({
      tasks: [
        {
          id: 'task-1',
          status: 'pending',
          url: 'https://example.com/video.mp4',
          title: 'Task 1',
          output_path: '/downloads/video.mp4',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
          display_speed_bps: 0,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        },
      ] as any,
      stats: {
        total_tasks: 1,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        active_downloads: 0,
        queue_paused: false,
      } as any,
      shouldValidateFn: () => true,
      validateStateFn,
      set: vi.fn(),
      normalizeTask: task => task,
      ensureStatsFn: stats => stats,
      syncStatesFn,
    });

    expect(result).toBe(true);
    expect(validateStateFn).toHaveBeenCalledTimes(1);
    expect(syncStatesFn).toHaveBeenCalledTimes(1);
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'info',
      'validation_store_action:validate_and_sync:start'
    );
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'warn',
      'validation_store_action:state_inconsistent',
      ['stats drift']
    );
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'info',
      'validation_store_action:validate_and_sync:success'
    );
  });

  it('applies force-sync patch through the extracted store seam', async () => {
    frontendLoggingMocks.reportFrontendDiagnosticIfEnabled.mockReset();
    const applyPatch = vi.fn();
    const fetchTasks = vi.fn().mockResolvedValue([
      {
        id: 'task-force-1',
        status: 'pending',
        url: 'https://example.com/video.mp4',
        title: 'Task 1',
        output_path: '/downloads/video.mp4',
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        display_speed_bps: 0,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
    ]);
    const fetchStats = vi.fn().mockResolvedValue({
      total_tasks: 1,
      completed_tasks: 0,
      failed_tasks: 0,
      total_downloaded: 0,
      average_speed: 0,
      display_total_speed_bps: 0,
      active_downloads: 1,
      queue_paused: false,
    });

    const result = await executeForceSyncStoreAction({
      fetchTasks: fetchTasks as any,
      fetchStats,
      normalizeTask: task => ({ ...task, normalized: true }) as any,
      applyPatch,
    });

    expect(fetchTasks).toHaveBeenCalledTimes(1);
    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(applyPatch).toHaveBeenCalledWith({
      tasks: [expect.objectContaining({ id: 'task-force-1', normalized: true })],
      stats: expect.objectContaining({ total_tasks: 1, active_downloads: 1 }),
    });
    expect(result.summary).toEqual({
      totalTasks: 1,
      stats: expect.objectContaining({ total_tasks: 1, active_downloads: 1 }),
    });
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'info',
      'validation_store_action:force_sync:start'
    );
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'info',
      'validation_store_action:force_sync:result',
      result.summary
    );
  });
});
