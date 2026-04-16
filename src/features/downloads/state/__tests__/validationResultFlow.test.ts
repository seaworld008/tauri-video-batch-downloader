import { describe, expect, it, vi } from 'vitest';
import {
  executeValidationSync,
  getValidationSyncPayload,
  isValidationConsistent,
} from '../validationResultFlow';

describe('validationResultFlow helpers', () => {
  const inconsistent = {
    isConsistent: false,
    issues: [{ code: 'task_count_mismatch', severity: 'error', message: 'bad' }],
    syncSuggestion: 'USE_BACKEND',
  } as any;

  it('detects consistency from validation results', () => {
    expect(isValidationConsistent({ ...inconsistent, isConsistent: true })).toBe(true);
    expect(isValidationConsistent(inconsistent)).toBe(false);
  });

  it('extracts sync payload from validation results', () => {
    expect(getValidationSyncPayload(inconsistent)).toEqual({
      issues: inconsistent.issues,
      syncSuggestion: 'USE_BACKEND',
    });
  });

  it('executes sync through supplied executor', async () => {
    const syncExecutor = vi.fn().mockResolvedValue(true);

    await expect(executeValidationSync(inconsistent, syncExecutor)).resolves.toBe(true);
    expect(syncExecutor).toHaveBeenCalledWith(inconsistent.issues, 'USE_BACKEND');
  });
});
