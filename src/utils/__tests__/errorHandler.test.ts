import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastMock, frontendLoggingMocks } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
  frontendLoggingMocks: {
    reportFrontendIssue: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: toastMock,
}));

vi.mock('../frontendLogging', () => frontendLoggingMocks);

import { AppErrorHandler, ErrorType } from '../errorHandler';

describe('AppErrorHandler frontend logging seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports handled errors through frontend issue logging', () => {
    const error = new Error('boom');

    const appError = AppErrorHandler.handle('加载配置', error, false);

    expect(appError.type).toBe(ErrorType.UNKNOWN);
    expect(frontendLoggingMocks.reportFrontendIssue).toHaveBeenCalledWith(
      'error',
      '加载配置:failed',
      expect.objectContaining({
        type: ErrorType.UNKNOWN,
        message: 'boom',
        originalError: error,
      })
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('reports retry attempts through frontend issue logging', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('ok');

    await expect(AppErrorHandler.withRetry('同步状态', operation, 2, 0)).resolves.toBe('ok');

    expect(frontendLoggingMocks.reportFrontendIssue).toHaveBeenCalledWith(
      'warn',
      '同步状态:retry',
      expect.objectContaining({
        attempt: 1,
        maxRetries: 2,
        error: expect.any(Error),
      })
    );
  });
});
