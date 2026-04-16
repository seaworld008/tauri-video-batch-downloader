import type { VideoTask } from '../../../schemas';
import { resolveCreatedTasksFromBackend } from './taskCreationFlow';
import {
  buildTaskCreationBackendResponsePreview,
  prepareTaskCreationRequest,
  prepareTaskCreationSuccessArtifacts,
  prepareTaskCreationValidatedInput,
} from './taskCreationOrchestration';

export interface ExecuteTaskCreationParams {
  newTasks: unknown[];
  convertTaskForBackend: (task: VideoTask) => unknown;
  addDownloadTasksCommand: (payload: unknown[]) => Promise<unknown>;
  normalizeBackendTask: (task: unknown) => VideoTask;
  currentTasks: VideoTask[];
  durationMs: number;
}

export interface ExecuteTaskCreationResult {
  inputValidation: ReturnType<typeof prepareTaskCreationRequest>['inputValidation'];
  processedTasks: VideoTask[];
  backendTasksPayload: unknown[];
  inputSummary: ReturnType<typeof prepareTaskCreationValidatedInput>['inputSummary'];
  backendRequestPreview: ReturnType<typeof prepareTaskCreationValidatedInput>['backendRequestPreview'];
  validationWarningSummary: ReturnType<typeof prepareTaskCreationValidatedInput>['validationWarningSummary'];
  validationPatch: ReturnType<typeof prepareTaskCreationValidatedInput>['validationPatch'] | null;
  validatedBackendTasks: VideoTask[];
  backendResponsePreview: ReturnType<typeof buildTaskCreationBackendResponsePreview>;
  stateUpdate: ReturnType<typeof prepareTaskCreationSuccessArtifacts>['stateUpdate'];
  completionArtifacts: ReturnType<typeof prepareTaskCreationSuccessArtifacts>['completionArtifacts'];
}

export const executeTaskCreation = async ({
  newTasks,
  convertTaskForBackend,
  addDownloadTasksCommand,
  normalizeBackendTask,
  currentTasks,
  durationMs,
}: ExecuteTaskCreationParams): Promise<ExecuteTaskCreationResult> => {
  const {
    inputValidation,
    processedTasks,
    backendTasksPayload,
    inputSummary,
    backendRequestPreview,
    validationWarningSummary,
    validationPatch,
  } = prepareTaskCreationValidatedInput({
    newTasks,
    convertTaskForBackend,
  });

  const backendResponse = await addDownloadTasksCommand(backendTasksPayload);

  const validatedBackendTasks = resolveCreatedTasksFromBackend({
    backendResponse,
    processedTasks,
    normalizeBackendTask,
  });

  const backendResponsePreview = buildTaskCreationBackendResponsePreview(validatedBackendTasks);
  const { stateUpdate, completionArtifacts } = prepareTaskCreationSuccessArtifacts({
    currentTasks,
    incomingTasks: validatedBackendTasks,
    invalidCount: inputValidation.invalidCount,
    totalItems: inputValidation.totalItems,
    inputCount: newTasks.length,
    durationMs,
  });

  return {
    inputValidation,
    processedTasks,
    backendTasksPayload,
    inputSummary,
    backendRequestPreview,
    validationWarningSummary,
    validationPatch: validationWarningSummary ? validationPatch : null,
    validatedBackendTasks,
    backendResponsePreview,
    stateUpdate,
    completionArtifacts,
  };
};
