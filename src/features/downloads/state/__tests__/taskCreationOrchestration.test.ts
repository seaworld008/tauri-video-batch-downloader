import { describe, expect, it } from 'vitest';
import {
  buildTaskCreationBackendRequestPreview,
  buildTaskCreationBackendResponsePreview,
  buildTaskCreationCompletionSummary,
  buildTaskCreationInputSummary,
  buildTaskCreationValidationPatch,
  buildTaskCreationValidationWarningSummary,
  prepareTaskCreationCompletionArtifacts,
  prepareTaskCreationRequest,
  prepareTaskCreationStateUpdate,
  prepareTaskCreationSuccessArtifacts,
  prepareTaskCreationValidatedInput,
} from '../taskCreationOrchestration';

describe('taskCreationOrchestration helpers', () => {
  it('prepares validated tasks and backend payload together', () => {
    const result = prepareTaskCreationRequest({
      newTasks: [
        {
          url: 'https://example.com/video.mp4',
          title: 'Video',
          output_path: '/downloads/video.mp4',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
        },
      ],
      convertTaskForBackend: task => ({ task_id: task.id ?? 'generated', title: task.title }),
    });

    expect(result.processedTasks).toHaveLength(1);
    expect(result.inputValidation.invalidCount).toBe(0);
    expect(result.backendTasksPayload).toEqual([
      expect.objectContaining({
        task_id: expect.any(String),
        title: 'Video',
      }),
    ]);
  });

  it('builds partial-validation patch and warning summary from input validation result', () => {
    const validatedInput = prepareTaskCreationValidatedInput({
      newTasks: [
        {
          url: 'https://example.com/video.mp4',
          title: 'Video',
          output_path: '/downloads/video.mp4',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
        },
        {
          title: 'Missing URL',
          output_path: '/downloads/video.mp4',
        },
      ],
      convertTaskForBackend: task => task,
    });

    expect(validatedInput.validationPatch.validationErrors).toHaveLength(1);
    expect(validatedInput.validationPatch.validationErrors[0]).toContain('任务[1]:');
    expect(typeof validatedInput.validationPatch.lastValidationTime).toBe('number');
    expect(validatedInput.validationWarningSummary).toEqual({
      总数: 2,
      有效: 1,
      无效: 1,
      成功率: '50.0%',
    });
    expect(validatedInput.inputSummary).toEqual({
      原始数量: 2,
      有效数量: 1,
      成功率: '50.0%',
    });
    expect(validatedInput.backendRequestPreview).toEqual({
      count: 1,
      sample: expect.objectContaining({
        title: 'Video',
      }),
    });
  });

  it('returns state patch plus summary for created tasks', () => {
    const result = prepareTaskCreationStateUpdate({
      currentTasks: [{ id: 'task-1', title: 'old' } as any],
      incomingTasks: [{ id: 'task-2', title: 'new', status: 'pending', downloaded_size: 0 } as any],
      invalidCount: 1,
      totalItems: 3,
    });

    expect(result.patch.tasks).toEqual([
      { id: 'task-1', title: 'old' },
      { id: 'task-2', title: 'new', status: 'pending', downloaded_size: 0 },
    ]);
    expect(result.patch.validationErrors).toEqual(['部分任务验证失败 (1/3)']);
    expect(result.summary).toEqual({
      原有任务数: 1,
      新增任务数: 1,
      已有任务数: 0,
      已完成: 0,
      可续传: 0,
      等待中: 1,
      下载中: 0,
      失败: 0,
      最终任务数: 2,
    });
  });

  it('prepares success artifacts from merged state update and completion feedback', () => {
    const result = prepareTaskCreationSuccessArtifacts({
      currentTasks: [{ id: 'task-1', title: 'old' } as any],
      incomingTasks: [{ id: 'task-2', title: 'new', status: 'pending', downloaded_size: 0 } as any],
      invalidCount: 1,
      totalItems: 3,
      inputCount: 3,
      durationMs: 12.34,
    });

    expect(result.stateUpdate.summary).toEqual({
      原有任务数: 1,
      新增任务数: 1,
      已有任务数: 0,
      已完成: 0,
      可续传: 0,
      等待中: 1,
      下载中: 0,
      失败: 0,
      最终任务数: 2,
    });
    expect(result.completionArtifacts).toEqual({
      summary: {
        新增任务: 1,
        已有任务: 0,
        已完成: 0,
        可续传: 0,
        等待中: 1,
        失败: 0,
        原始输入: 3,
        验证耗时: '12.34ms',
        当前总数: 2,
      },
      successMessage: '已添加 1/3 个任务 - 已跳过 1 个无效任务',
    });
  });

  it('builds compact input/backend/completion artifacts for logging and feedback', () => {
    expect(
      buildTaskCreationInputSummary({
        inputCount: 5,
        processedCount: 4,
        successRate: 0.8,
      })
    ).toEqual({
      原始数量: 5,
      有效数量: 4,
      成功率: '80.0%',
    });

    expect(
      buildTaskCreationBackendRequestPreview([
        { id: 'task-1', title: 'Task 1' } as any,
        { id: 'task-2', title: 'Task 2' } as any,
      ])
    ).toEqual({
      count: 2,
      sample: { id: 'task-1', title: 'Task 1' },
    });

    expect(
      buildTaskCreationBackendResponsePreview([
        { id: 'task-1', title: 'Task 1' } as any,
        { id: 'task-2', title: 'Task 2' } as any,
      ])
    ).toEqual({
      count: 2,
      sample: { id: 'task-1', title: 'Task 1' },
      allTaskIds: ['task-1', 'task-2'],
    });

    expect(
      buildTaskCreationCompletionSummary({
        createdCount: 4,
        existingCount: 1,
        completedCount: 1,
        resumableCount: 2,
        pendingCount: 1,
        inputCount: 5,
        durationMs: 12.34,
        totalTaskCount: 9,
      })
    ).toEqual({
      新增任务: 4,
      已有任务: 1,
      已完成: 1,
      可续传: 2,
      等待中: 1,
      失败: 0,
      原始输入: 5,
      验证耗时: '12.34ms',
      当前总数: 9,
    });

    expect(
      prepareTaskCreationCompletionArtifacts({
        createdCount: 4,
        existingCount: 1,
        completedCount: 1,
        resumableCount: 2,
        pendingCount: 1,
        inputCount: 5,
        invalidCount: 1,
        durationMs: 12.34,
        totalTaskCount: 9,
      })
    ).toEqual({
      summary: {
        新增任务: 4,
        已有任务: 1,
        已完成: 1,
        可续传: 2,
        等待中: 1,
        失败: 0,
        原始输入: 5,
        验证耗时: '12.34ms',
        当前总数: 9,
      },
      successMessage: '新增 4 个任务，识别已有 1 个（已完成 1、可续传 2、等待 1），已跳过 1 个无效任务',
    });
  });

  it('reports duplicate import reconciliation without inflating created count', () => {
    const result = prepareTaskCreationSuccessArtifacts({
      currentTasks: [
        { id: 'task-1', status: 'completed', downloaded_size: 100 } as any,
        { id: 'task-2', status: 'paused', downloaded_size: 50 } as any,
      ],
      incomingTasks: [
        { id: 'task-1', status: 'completed', downloaded_size: 100 } as any,
        { id: 'task-2', status: 'paused', downloaded_size: 50 } as any,
      ],
      invalidCount: 0,
      totalItems: 2,
      inputCount: 2,
      durationMs: 1,
    });

    expect(result.stateUpdate.summary).toEqual({
      原有任务数: 2,
      新增任务数: 0,
      已有任务数: 2,
      已完成: 1,
      可续传: 1,
      等待中: 0,
      下载中: 0,
      失败: 0,
      最终任务数: 2,
    });
    expect(result.completionArtifacts.successMessage).toBe(
      '未创建新任务：已识别 2 个已有任务（已完成 1、可续传 1）'
    );
  });
});
