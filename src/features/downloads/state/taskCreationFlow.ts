import { TaskListSchema, type VideoTask } from '../../../schemas';
import {
  normalizeTaskData,
  validateApiResponse,
  validateVideoTaskList,
  type BatchValidationResult,
} from '../../../utils/dataValidator';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

const formatTaskValidationMessages = (
  invalidItems: BatchValidationResult<VideoTask>['invalidItems']
): string[] =>
  invalidItems.map(item => `任务[${item.index}]: ${item.errors.map(error => error.message).join(', ')}`);

export const validateTaskCreationInput = (
  newTasks: unknown[]
): {
  processedTasks: VideoTask[];
  invalidCount: number;
  successRate: number;
  totalItems: number;
  validationErrorMessages: string[];
} => {
  const normalizedTasks = newTasks.map(task => normalizeTaskData(task));
  const inputValidation = validateVideoTaskList(normalizedTasks, { stopOnFirstError: false });

  if (inputValidation.validItems.length === 0) {
    throw new Error(
      `所有输入任务均无效。错误详情: ${inputValidation.invalidItems
        .map(item => item.errors.map(error => error.message).join(', '))
        .join('; ')}`
    );
  }

  return {
    processedTasks: inputValidation.validItems,
    invalidCount: inputValidation.invalidItems.length,
    successRate: inputValidation.successRate,
    totalItems: inputValidation.totalItems,
    validationErrorMessages: formatTaskValidationMessages(inputValidation.invalidItems),
  };
};

export const resolveCreatedTasksFromBackend = ({
  backendResponse,
  processedTasks,
  normalizeBackendTask,
}: {
  backendResponse: unknown;
  processedTasks: VideoTask[];
  normalizeBackendTask: (task: unknown) => VideoTask;
}): VideoTask[] => {
  let backendTasksSource: unknown[] | undefined;

  if (Array.isArray(backendResponse)) {
    backendTasksSource = backendResponse.map(normalizeBackendTask);
  } else {
    const responseValidation = validateApiResponse(backendResponse, TaskListSchema);
    if (!responseValidation.success) {
      const errorDetails = responseValidation.errors?.map(error => error.message).join(', ') ?? 'unknown error';
      throw new Error(`Backend response format invalid: ${errorDetails}`);
    }

    const payload = responseValidation.data?.data ?? backendResponse;
    if (Array.isArray(payload)) {
      backendTasksSource = payload.map(normalizeBackendTask);
    } else {
      reportFrontendDiagnosticIfEnabled('warn', 'task_creation_flow:backend_payload_not_array', {
        payload,
      });
    }
  }

  if (!backendTasksSource) {
    reportFrontendDiagnosticIfEnabled(
      'warn',
      'task_creation_flow:backend_task_list_missing_fallback'
    );
    return processedTasks;
  }

  const backendValidation = validateVideoTaskList(backendTasksSource, {
    stopOnFirstError: false,
  });

  if (!backendValidation.success || backendValidation.validItems.length === 0) {
    reportFrontendDiagnosticIfEnabled('warn', 'task_creation_flow:backend_tasks_invalid_fallback', {
      原始响应: backendTasksSource,
      验证错误: backendValidation.invalidItems,
    });
    return processedTasks;
  }

  return backendValidation.validItems;
};