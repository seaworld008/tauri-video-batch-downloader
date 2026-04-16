import type { VideoTask } from '../../../schemas';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

export const recordTaskCreationImport = (
  recordRecentImport: (taskIds: string[], snapshot: VideoTask[]) => void,
  tasks: VideoTask[]
): void => {
  recordRecentImport(
    tasks.map(task => task.id),
    tasks
  );
};

export const refreshStatsAfterTaskCreation = async (
  refreshStats: () => Promise<unknown>
): Promise<void> => {
  try {
    await refreshStats();
    reportFrontendDiagnosticIfEnabled('info', 'task_creation_effects:refresh_stats:success');
  } catch (statsError) {
    reportFrontendDiagnosticIfEnabled('warn', 'task_creation_effects:refresh_stats:failed', statsError);
  }
};

export const scheduleTaskCreationValidation = (
  validateAndSync: () => Promise<boolean>,
  delayMs = 1000
): ReturnType<typeof setTimeout> =>
  setTimeout(() => {
    void validateAndSync();
  }, delayMs);