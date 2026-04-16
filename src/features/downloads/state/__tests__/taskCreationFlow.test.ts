import { describe, expect, it, vi } from 'vitest';
import {
  resolveCreatedTasksFromBackend,
  validateTaskCreationInput,
} from '../taskCreationFlow';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnosticIfEnabled: vi.fn(),
  reportFrontendIssue: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('taskCreationFlow helpers', () => {
  it('returns processed tasks plus summarized validation messages for partial input failures', () => {
    const result = validateTaskCreationInput([
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
    ]);

    expect(result.processedTasks).toHaveLength(1);
    expect(result.invalidCount).toBe(1);
    expect(result.totalItems).toBe(2);
    expect(result.successRate).toBe(0.5);
    expect(result.validationErrorMessages[0]).toContain('任务[1]:');
  });

  it('throws when every input task is invalid', () => {
    expect(() => validateTaskCreationInput([{ title: 'Missing URL' }])).toThrow(
      '所有输入任务均无效。错误详情:'
    );
  });

  it('falls back to locally validated tasks when backend task array is invalid', () => {
    frontendLoggingMocks.reportFrontendDiagnosticIfEnabled.mockReset();
    const processedTasks = [
      {
        id: 'task-1',
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
      } as any,
    ];

    const result = resolveCreatedTasksFromBackend({
      backendResponse: [{ bad: 'payload' }],
      processedTasks,
      normalizeBackendTask: task => task as any,
    });

    expect(result).toEqual(processedTasks);
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalled();
  });

  it('uses validated backend tasks when response can be normalized into a task list', () => {
    const result = resolveCreatedTasksFromBackend({
      backendResponse: [
        {
          id: 'task-1',
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
        },
      ],
      processedTasks: [],
      normalizeBackendTask: task => task as any,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('task-1');
  });
});