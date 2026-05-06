import type { VideoTask } from '../../../schemas';
import {
  buildTaskCreationStatePatch,
  buildTaskCreationSuccessMessage,
  summarizeTaskCreationReconciliation,
} from './taskCreationState';
import { validateTaskCreationInput } from './taskCreationFlow';

type TaskCreationInputValidation = ReturnType<typeof validateTaskCreationInput>;

export const prepareTaskCreationRequest = ({
  newTasks,
  convertTaskForBackend,
}: {
  newTasks: unknown[];
  convertTaskForBackend: (task: VideoTask) => unknown;
}): {
  inputValidation: TaskCreationInputValidation;
  processedTasks: VideoTask[];
  backendTasksPayload: unknown[];
} => {
  const inputValidation = validateTaskCreationInput(newTasks);
  const processedTasks = inputValidation.processedTasks;

  return {
    inputValidation,
    processedTasks,
    backendTasksPayload: processedTasks.map(convertTaskForBackend),
  };
};

export const buildTaskCreationValidationPatch = (
  inputValidation: TaskCreationInputValidation
): Pick<
  { validationErrors: string[]; lastValidationTime: number },
  'validationErrors' | 'lastValidationTime'
> => ({
  validationErrors: inputValidation.validationErrorMessages,
  lastValidationTime: Date.now(),
});

export const prepareTaskCreationValidatedInput = ({
  newTasks,
  convertTaskForBackend,
}: {
  newTasks: unknown[];
  convertTaskForBackend: (task: VideoTask) => unknown;
}): {
  inputValidation: TaskCreationInputValidation;
  processedTasks: VideoTask[];
  backendTasksPayload: unknown[];
  validationWarningSummary: ReturnType<typeof buildTaskCreationValidationWarningSummary>;
  validationPatch: ReturnType<typeof buildTaskCreationValidationPatch>;
  inputSummary: ReturnType<typeof buildTaskCreationInputSummary>;
  backendRequestPreview: ReturnType<typeof buildTaskCreationBackendRequestPreview>;
} => {
  const { inputValidation, processedTasks, backendTasksPayload } = prepareTaskCreationRequest({
    newTasks,
    convertTaskForBackend,
  });

  return {
    inputValidation,
    processedTasks,
    backendTasksPayload,
    validationWarningSummary: buildTaskCreationValidationWarningSummary(inputValidation),
    validationPatch: buildTaskCreationValidationPatch(inputValidation),
    inputSummary: buildTaskCreationInputSummary({
      inputCount: newTasks.length,
      processedCount: processedTasks.length,
      successRate: inputValidation.successRate,
    }),
    backendRequestPreview: buildTaskCreationBackendRequestPreview(processedTasks),
  };
};

export const buildTaskCreationInputSummary = ({
  inputCount,
  processedCount,
  successRate,
}: {
  inputCount: number;
  processedCount: number;
  successRate: number;
}) => ({
  原始数量: inputCount,
  有效数量: processedCount,
  成功率: `${(successRate * 100).toFixed(1)}%`,
});

export const buildTaskCreationValidationWarningSummary = (
  inputValidation: TaskCreationInputValidation
): {
  总数: number;
  有效: number;
  无效: number;
  成功率: string;
} | null => {
  if (inputValidation.invalidCount === 0) {
    return null;
  }

  return {
    总数: inputValidation.totalItems,
    有效: inputValidation.processedTasks.length,
    无效: inputValidation.invalidCount,
    成功率: `${(inputValidation.successRate * 100).toFixed(1)}%`,
  };
};

export const buildTaskCreationBackendRequestPreview = (
  processedTasks: VideoTask[]
): {
  count: number;
  sample: VideoTask | undefined;
} => ({
  count: processedTasks.length,
  sample: processedTasks[0],
});

export const buildTaskCreationBackendResponsePreview = (
  tasks: VideoTask[]
): {
  count: number;
  sample: VideoTask | undefined;
  allTaskIds: Array<VideoTask['id']>;
} => ({
  count: tasks.length,
  sample: tasks[0],
  allTaskIds: tasks.map(task => task.id),
});

export const prepareTaskCreationStateUpdate = ({
  currentTasks,
  incomingTasks,
  invalidCount,
  totalItems,
}: {
  currentTasks: VideoTask[];
  incomingTasks: VideoTask[];
  invalidCount: number;
  totalItems: number;
}) => {
  const reconciliation = summarizeTaskCreationReconciliation(currentTasks, incomingTasks);
  const patch = buildTaskCreationStatePatch({
    currentTasks,
    incomingTasks,
    invalidCount,
    totalItems,
  });

  return {
    patch,
    summary: {
      原有任务数: currentTasks.length,
      新增任务数: reconciliation.createdCount,
      已有任务数: reconciliation.existingCount,
      已完成: reconciliation.completedCount,
      可续传: reconciliation.resumableCount,
      等待中: reconciliation.pendingCount,
      下载中: reconciliation.activeCount,
      失败: reconciliation.failedCount,
      最终任务数: patch.tasks.length,
    },
    reconciliation,
  };
};

export const buildTaskCreationCompletionSummary = ({
  createdCount,
  existingCount = 0,
  completedCount = 0,
  resumableCount = 0,
  pendingCount = 0,
  failedCount = 0,
  inputCount,
  durationMs,
  totalTaskCount,
}: {
  createdCount: number;
  existingCount?: number;
  completedCount?: number;
  resumableCount?: number;
  pendingCount?: number;
  failedCount?: number;
  inputCount: number;
  durationMs: number;
  totalTaskCount: number;
}) => ({
  新增任务: createdCount,
  已有任务: existingCount,
  已完成: completedCount,
  可续传: resumableCount,
  等待中: pendingCount,
  失败: failedCount,
  原始输入: inputCount,
  验证耗时: `${durationMs.toFixed(2)}ms`,
  当前总数: totalTaskCount,
});

export const prepareTaskCreationCompletionArtifacts = ({
  createdCount,
  existingCount = 0,
  completedCount = 0,
  resumableCount = 0,
  pendingCount = 0,
  failedCount = 0,
  inputCount,
  invalidCount,
  durationMs,
  totalTaskCount,
}: {
  createdCount: number;
  existingCount?: number;
  completedCount?: number;
  resumableCount?: number;
  pendingCount?: number;
  failedCount?: number;
  inputCount: number;
  invalidCount: number;
  durationMs: number;
  totalTaskCount: number;
}): {
  summary: ReturnType<typeof buildTaskCreationCompletionSummary>;
  successMessage: string;
} => ({
  summary: buildTaskCreationCompletionSummary({
    createdCount,
    existingCount,
    completedCount,
    resumableCount,
    pendingCount,
    failedCount,
    inputCount,
    durationMs,
    totalTaskCount,
  }),
  successMessage: buildTaskCreationSuccessMessage({
    createdCount,
    existingCount,
    completedCount,
    resumableCount,
    pendingCount,
    failedCount,
    inputCount,
    invalidCount,
  }),
});

export const prepareTaskCreationSuccessArtifacts = ({
  currentTasks,
  incomingTasks,
  invalidCount,
  totalItems,
  inputCount,
  durationMs,
}: {
  currentTasks: VideoTask[];
  incomingTasks: VideoTask[];
  invalidCount: number;
  totalItems: number;
  inputCount: number;
  durationMs: number;
}): {
  stateUpdate: ReturnType<typeof prepareTaskCreationStateUpdate>;
  completionArtifacts: ReturnType<typeof prepareTaskCreationCompletionArtifacts>;
} => {
  const stateUpdate = prepareTaskCreationStateUpdate({
    currentTasks,
    incomingTasks,
    invalidCount,
    totalItems,
  });

  return {
    stateUpdate,
    completionArtifacts: prepareTaskCreationCompletionArtifacts({
      createdCount: stateUpdate.reconciliation.createdCount,
      existingCount: stateUpdate.reconciliation.existingCount,
      completedCount: stateUpdate.reconciliation.completedCount,
      resumableCount: stateUpdate.reconciliation.resumableCount,
      pendingCount: stateUpdate.reconciliation.pendingCount,
      failedCount: stateUpdate.reconciliation.failedCount,
      inputCount,
      invalidCount,
      durationMs,
      totalTaskCount: stateUpdate.patch.tasks.length,
    }),
  };
};
