import type toast from 'react-hot-toast';
import type { VideoTask } from '../../../schemas';
import { executeTaskCreation } from './taskCreationAction';
import {
  recordTaskCreationImport,
  refreshStatsAfterTaskCreation,
  scheduleTaskCreationValidation,
} from './taskCreationEffects';
import {
  buildTaskCreationFailurePatch,
  logTaskCreationFailureContext,
} from './taskCreationError';
import { warnTaskIntegrityIssues } from './taskCreationState';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

export interface ExecuteTaskCreationStoreActionParams {
  newTasks: unknown[];
  validationStartTime: number;
  convertTaskForBackend: (task: VideoTask) => unknown;
  addDownloadTasksCommand: (payload: unknown[]) => Promise<unknown>;
  normalizeBackendTask: (task: unknown) => VideoTask;
  currentTasks: VideoTask[];
  recordValidation: (success: boolean, durationMs: number) => void;
  getValidationStats: () => unknown;
  getValidationErrors: () => string[];
  applyValidationPatch: (patch: { validationErrors: string[]; lastValidationTime: number }) => void;
  applyStateUpdate: (patch: { isLoading: boolean; tasks: VideoTask[]; validationErrors: string[]; lastValidationTime: number }, summary: unknown) => void;
  applyFailurePatch: (patch: { isLoading: false; validationErrors: string[]; lastValidationTime: number }) => void;
  recordRecentImport: (taskIds: string[], snapshot: VideoTask[]) => void;
  refreshStats: () => Promise<unknown>;
  validateAndSync: () => Promise<boolean>;
  toastApi: Pick<typeof toast, 'success'>;
}

export const executeTaskCreationStoreAction = async ({
  newTasks,
  validationStartTime,
  convertTaskForBackend,
  addDownloadTasksCommand,
  normalizeBackendTask,
  currentTasks,
  recordValidation,
  getValidationStats,
  getValidationErrors,
  applyValidationPatch,
  applyStateUpdate,
  applyFailurePatch,
  recordRecentImport,
  refreshStats,
  validateAndSync,
  toastApi,
}: ExecuteTaskCreationStoreActionParams): Promise<VideoTask[]> => {
  try {
    const taskCreationResult = await executeTaskCreation({
      newTasks,
      convertTaskForBackend,
      addDownloadTasksCommand,
      normalizeBackendTask,
      currentTasks,
      durationMs: performance.now() - validationStartTime,
    });

    const {
      inputValidation,
      inputSummary,
      validationWarningSummary,
      validationPatch,
      backendRequestPreview,
      validatedBackendTasks,
      backendResponsePreview,
      stateUpdate,
      completionArtifacts,
    } = taskCreationResult;

    const validationDuration = performance.now() - validationStartTime;
    recordValidation(inputValidation.invalidCount === 0, validationDuration);

    if (validationWarningSummary && validationPatch) {
      reportFrontendDiagnosticIfEnabled(
        'warn',
        'task_creation_store_action:input_validation_warning',
        validationWarningSummary
      );
      applyValidationPatch(validationPatch);
    }

    reportFrontendDiagnosticIfEnabled('info', 'task_creation_store_action:input_validated', inputSummary);
    reportFrontendDiagnosticIfEnabled(
      'info',
      'task_creation_store_action:backend_request_preview',
      backendRequestPreview
    );
    reportFrontendDiagnosticIfEnabled(
      'info',
      'task_creation_store_action:backend_response_validation:start'
    );
    reportFrontendDiagnosticIfEnabled(
      'info',
      'task_creation_store_action:backend_response_preview',
      backendResponsePreview
    );

    warnTaskIntegrityIssues(validatedBackendTasks);

    reportFrontendDiagnosticIfEnabled(
      'info',
      'task_creation_store_action:state_updated',
      stateUpdate.summary
    );
    applyStateUpdate(stateUpdate.patch, stateUpdate.summary);

    recordTaskCreationImport(recordRecentImport, validatedBackendTasks);
    await refreshStatsAfterTaskCreation(refreshStats);

    reportFrontendDiagnosticIfEnabled(
      'info',
      'task_creation_store_action:completed',
      completionArtifacts.summary
    );

    toastApi.success(completionArtifacts.successMessage);
    scheduleTaskCreationValidation(validateAndSync, 1000);

    return validatedBackendTasks;
  } catch (error) {
    const validationDuration = performance.now() - validationStartTime;

    recordValidation(false, validationDuration);
    applyFailurePatch(buildTaskCreationFailurePatch(getValidationErrors(), error));

    logTaskCreationFailureContext({
      inputTaskCount: newTasks.length,
      validationDuration,
      validationStats: getValidationStats(),
    });

    throw error;
  }
};
