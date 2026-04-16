import { reportFrontendDiagnostic } from '../../../utils/frontendLogging';

export const buildTaskCreationFailurePatch = (
  existingErrors: string[],
  error: unknown
): {
  isLoading: false;
  validationErrors: string[];
  lastValidationTime: number;
} => ({
  isLoading: false,
  validationErrors: [
    ...existingErrors,
    `任务添加失败: ${error instanceof Error ? error.message : String(error)}`,
  ],
  lastValidationTime: Date.now(),
});

export const logTaskCreationFailureContext = ({
  inputTaskCount,
  validationDuration,
  validationStats,
}: {
  inputTaskCount: number;
  validationDuration: number;
  validationStats: unknown;
}): void => {
  reportFrontendDiagnostic('error', 'task_creation_error:failure_context', {
    输入任务数量: inputTaskCount,
    验证耗时: `${validationDuration.toFixed(2)}ms`,
    验证统计: validationStats,
  });
};