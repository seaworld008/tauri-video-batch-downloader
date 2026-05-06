import { describe, expect, it, vi } from 'vitest';
import {
  buildTaskCreationStatePatch,
  buildTaskCreationSuccessMessage,
  mergeCreatedTasks,
  summarizeTaskCreationReconciliation,
  warnTaskIntegrityIssues,
} from '../taskCreationState';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnosticIfEnabled: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('taskCreationState helpers', () => {
  it('merges created tasks by replacing existing ids and appending new ids', () => {
    const merged = mergeCreatedTasks(
      [{ id: 'task-1', title: 'old' } as any, { id: 'task-2', title: 'keep' } as any],
      [{ id: 'task-1', title: 'new' } as any, { id: 'task-3', title: 'added' } as any]
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

  it('builds reconciliation messages for duplicate imports and resumable tasks', () => {
    expect(
      buildTaskCreationSuccessMessage({
        createdCount: 0,
        existingCount: 3,
        completedCount: 1,
        resumableCount: 1,
        pendingCount: 1,
        inputCount: 3,
        invalidCount: 0,
      })
    ).toBe('未创建新任务：已识别 3 个已有任务（已完成 1、可续传 1、等待 1）');

    expect(
      buildTaskCreationSuccessMessage({
        createdCount: 2,
        existingCount: 1,
        failedCount: 1,
        inputCount: 4,
        invalidCount: 1,
      })
    ).toBe('新增 2 个任务，识别已有 1 个（失败 1），已跳过 1 个无效任务');
  });

  it('summarizes created, existing, completed, and resumable task buckets', () => {
    const summary = summarizeTaskCreationReconciliation(
      [{ id: 'task-completed' } as any, { id: 'task-resume' } as any],
      [
        { id: 'task-completed', status: 'completed', downloaded_size: 100 } as any,
        { id: 'task-resume', status: 'paused', downloaded_size: 40 } as any,
        { id: 'task-new', status: 'pending', downloaded_size: 0 } as any,
      ]
    );

    expect(summary).toEqual({
      createdCount: 1,
      existingCount: 2,
      completedCount: 1,
      resumableCount: 1,
      pendingCount: 1,
      activeCount: 0,
      failedCount: 0,
      cancelledCount: 0,
    });
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
