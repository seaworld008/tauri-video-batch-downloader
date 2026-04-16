import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeQueryMocks = vi.hoisted(() => ({
  getDownloadTasksCommand: vi.fn(),
  getDownloadStatsCommand: vi.fn(),
}));

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnostic: vi.fn(),
  reportFrontendDiagnosticIfEnabled: vi.fn(),
  reportFrontendIssue: vi.fn(),
}));

const errorHandlerMocks = vi.hoisted(() => ({
  handleError: vi.fn(),
}));

vi.mock('../../features/downloads/api/runtimeQueries', () => runtimeQueryMocks);
vi.mock('../frontendLogging', () => frontendLoggingMocks);
vi.mock('../errorHandler', () => errorHandlerMocks);

import { StateValidator } from '../stateValidator';

describe('StateValidator frontend logging seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports validation lifecycle through frontend logging', async () => {
    runtimeQueryMocks.getDownloadTasksCommand.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Task 1',
        status: 'pending',
        progress: 0,
        downloaded_size: 0,
      },
    ]);
    runtimeQueryMocks.getDownloadStatsCommand.mockResolvedValue({
      total_tasks: 1,
      completed_tasks: 0,
      failed_tasks: 0,
      active_downloads: 0,
      total_downloaded: 0,
      average_speed: 0,
      display_total_speed_bps: 0,
      queue_paused: false,
    });

    const result = await StateValidator.validateState(
      [
        {
          id: 'task-1',
          title: 'Task 1',
          status: 'pending',
          progress: 0,
          downloaded_size: 0,
        },
      ] as any,
      {
        total_tasks: 1,
        completed_tasks: 0,
        failed_tasks: 0,
        active_downloads: 0,
        total_downloaded: 0,
        average_speed: 0,
        display_total_speed_bps: 0,
        queue_paused: false,
      } as any
    );

    expect(result.isConsistent).toBe(true);
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'info',
      'state_validator:validate:start'
    );
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'info',
      'state_validator:validate:result',
      expect.objectContaining({
        isConsistent: true,
        issueCount: 0,
        taskIssueCount: 0,
        statsIssueCount: 0,
      })
    );
  });

  it('reports manual resolve sync conflicts through frontend issue logging', async () => {
    const synced = await StateValidator.syncStates(
      [{ type: 'DATA_CORRUPTION', description: 'conflict' }],
      'MANUAL_RESOLVE',
      {
        updateTasks: vi.fn(),
        updateStats: vi.fn(),
      }
    );

    expect(synced).toBe(false);
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'info',
      'state_validator:sync:start',
      expect.objectContaining({ strategy: 'MANUAL_RESOLVE', issueCount: 1 })
    );
    expect(frontendLoggingMocks.reportFrontendIssue).toHaveBeenCalledWith(
      'error',
      'state_validator:sync:manual_resolution_required',
      expect.objectContaining({ issueCount: 1 })
    );
  });
});
