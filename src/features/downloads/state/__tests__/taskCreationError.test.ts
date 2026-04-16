import { describe, expect, it, vi } from 'vitest';
import {
  buildTaskCreationFailurePatch,
  logTaskCreationFailureContext,
} from '../taskCreationError';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnostic: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('taskCreationError helpers', () => {
  it('builds failure patch by appending a formatted error message', () => {
    const patch = buildTaskCreationFailurePatch(['旧错误'], new Error('boom'));

    expect(patch.isLoading).toBe(false);
    expect(patch.validationErrors).toEqual(['旧错误', '任务添加失败: boom']);
  });

  it('logs failure context with duration and stats snapshot', () => {
    frontendLoggingMocks.reportFrontendDiagnostic.mockReset();

    logTaskCreationFailureContext({
      inputTaskCount: 3,
      validationDuration: 12.34,
      validationStats: { total: 5 },
    });

    expect(frontendLoggingMocks.reportFrontendDiagnostic).toHaveBeenCalledWith(
      'error',
      'task_creation_error:failure_context',
      {
        输入任务数量: 3,
        验证耗时: '12.34ms',
        验证统计: { total: 5 },
      }
    );
  });
});