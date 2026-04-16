import { describe, expect, it, vi } from 'vitest';
import { executeTaskCreation } from '../taskCreationAction';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnosticIfEnabled: vi.fn(),
  reportFrontendIssue: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

const buildInputTask = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://example.com/video.mp4',
  title: 'Video',
  output_path: '/downloads/video.mp4',
  progress: 0,
  downloaded_size: 0,
  speed: 0,
  display_speed_bps: 0,
  ...overrides,
});

const buildRuntimeTask = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  url: 'https://example.com/video.mp4',
  title: 'Video',
  output_path: '/downloads/video.mp4',
  status: 'pending',
  progress: 0,
  downloaded_size: 0,
  speed: 0,
  display_speed_bps: 0,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  ...overrides,
});

describe('taskCreationAction', () => {
  it('returns validation patch plus merged completion artifacts for partial invalid input', async () => {
    const backendPayloads: unknown[][] = [];

    const result = await executeTaskCreation({
      newTasks: [buildInputTask(), { title: 'Missing URL' }],
      convertTaskForBackend: task => ({ url: task.url, title: task.title }),
      addDownloadTasksCommand: async payload => {
        backendPayloads.push(payload as unknown[]);
        return [buildRuntimeTask('task-1')];
      },
      normalizeBackendTask: task => task as any,
      currentTasks: [buildRuntimeTask('existing-task') as any],
      durationMs: 12,
    });

    expect(backendPayloads).toHaveLength(1);
    expect(backendPayloads[0]).toEqual([{ url: 'https://example.com/video.mp4', title: 'Video' }]);
    expect(result.validationWarningSummary).toMatchObject({ 总数: 2, 有效: 1, 无效: 1 });
    expect(result.validationPatch).toMatchObject({
      validationErrors: [expect.stringContaining('任务[1]:')],
    });
    expect(result.inputSummary).toEqual({
      原始数量: 2,
      有效数量: 1,
      成功率: '50.0%',
    });
    expect(result.backendRequestPreview).toMatchObject({ count: 1 });
    expect(result.backendResponsePreview).toMatchObject({
      count: 1,
      allTaskIds: ['task-1'],
    });
    expect(result.stateUpdate.patch.tasks).toHaveLength(2);
    expect(result.completionArtifacts.successMessage).toContain('已添加 1/2 个任务');
  });

  it('falls back to locally processed tasks when backend response cannot be normalized', async () => {
    frontendLoggingMocks.reportFrontendDiagnosticIfEnabled.mockReset();

    const result = await executeTaskCreation({
      newTasks: [buildInputTask()],
      convertTaskForBackend: task => task,
      addDownloadTasksCommand: async () => [{ bad: 'payload' }],
      normalizeBackendTask: task => task as any,
      currentTasks: [],
      durationMs: 8,
    });

    expect(result.validationWarningSummary).toBeNull();
    expect(result.validationPatch).toBeNull();
    expect(result.validatedBackendTasks).toHaveLength(1);
    expect(result.validatedBackendTasks[0]).toMatchObject({
      title: 'Video',
      status: 'pending',
    });
    expect(result.stateUpdate.patch.tasks).toHaveLength(1);
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalled();
  });
});
