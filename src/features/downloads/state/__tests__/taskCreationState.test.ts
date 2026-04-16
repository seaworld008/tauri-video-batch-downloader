import { describe, expect, it, vi } from 'vitest';
import {
  buildTaskCreationStatePatch,
  buildTaskCreationSuccessMessage,
  mergeCreatedTasks,
  warnTaskIntegrityIssues,
} from '../taskCreationState';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnosticIfEnabled: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('taskCreationState helpers', () => {
  it('merges created tasks by replacing existing ids and appending new ids', () => {
    const merged = mergeCreatedTasks(
      [
        { id: 'task-1', title: 'old' } as any,
        { id: 'task-2', title: 'keep' } as any,
      ],
      [
        { id: 'task-1', title: 'new' } as any,
        { id: 'task-3', title: 'added' } as any,
      ]
    );

    expect(merged).toEqual([
      { id: 'task-1', title: 'new' },
      { id: 'task-2', title: 'keep' },
      { id: 'task-3', title: 'added' },
    ]);
  });

  it('builds store patch with partial-validation summary when invalid input exists', () => {
    const patch = buildTaskCreationStatePatch({
      currentTasks: [{ id: 'task-1' } as any],
      incomingTasks: [{ id: 'task-2' } as any],
      invalidCount: 2,
      totalItems: 5,
    });

    expect(patch.tasks).toEqual([{ id: 'task-1' }, { id: 'task-2' }]);
    expect(patch.isLoading).toBe(false);
    expect(patch.validationErrors).toEqual(['部分任务验证失败 (2/5)']);
  });

  it('builds correct success messages for full and partial creation', () => {
    expect(
      buildTaskCreationSuccessMessage({ createdCount: 3, inputCount: 3, invalidCount: 0 })
    ).toBe('已添加 3 个下载任务');
    expect(
      buildTaskCreationSuccessMessage({ createdCount: 3, inputCount: 5, invalidCount: 2 })
    ).toBe('已添加 3/5 个任务 - 已跳过 2 个无效任务');
  });

  it('warns when integrity check finds duplicate or corrupted tasks', () => {
    frontendLoggingMocks.reportFrontendDiagnosticIfEnabled.mockReset();
    warnTaskIntegrityIssues([
      { id: 'dup', url: 'https://example.com/a', title: 'a', status: 'pending' } as any,
      { id: 'dup', url: '', title: '', status: 'pending' } as any,
    ]);
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'warn',
      'task_creation_state:integrity_issues_detected',
      expect.objectContaining({
        duplicates: expect.any(Array),
        corrupted: expect.any(Array),
      })
    );
  });
});