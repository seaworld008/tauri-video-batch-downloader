import { describe, expect, it, vi } from 'vitest';
import {
  recordTaskCreationImport,
  refreshStatsAfterTaskCreation,
  scheduleTaskCreationValidation,
} from '../taskCreationEffects';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnosticIfEnabled: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('taskCreationEffects helpers', () => {
  it('records recent import ids and snapshot from created tasks', () => {
    const recordRecentImport = vi.fn();
    const tasks = [{ id: 'task-1' }, { id: 'task-2' }] as any;

    recordTaskCreationImport(recordRecentImport, tasks);

    expect(recordRecentImport).toHaveBeenCalledWith(['task-1', 'task-2'], tasks);
  });

  it('swallows refreshStats failures while warning', async () => {
    frontendLoggingMocks.reportFrontendDiagnosticIfEnabled.mockReset();
    const refreshStats = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(refreshStatsAfterTaskCreation(refreshStats)).resolves.toBeUndefined();
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'warn',
      'task_creation_effects:refresh_stats:failed',
      expect.any(Error)
    );
  });

  it('schedules validation using the provided callback and delay', async () => {
    vi.useFakeTimers();
    const validateAndSync = vi.fn().mockResolvedValue(true);

    scheduleTaskCreationValidation(validateAndSync, 25);
    await vi.advanceTimersByTimeAsync(25);

    expect(validateAndSync).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});