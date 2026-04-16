import { describe, expect, it, vi } from 'vitest';
import {
  buildImportFromFileFailurePatch,
  buildImportFromFileSuccessMessage,
  buildImportFromFileSuccessSummary,
  buildImportTaskPreviewSummary,
  buildImportValidationCompletionSummary,
  buildImportValidationPatch,
  logImportFromFileFailureContext,
  prepareImportFromFileSuccess,
} from '../importFileFlow';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnostic: vi.fn(),
  reportFrontendIssue: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('importFileFlow helpers', () => {
  it('prepares validated imported rows and task drafts through one seam', () => {
    const result = prepareImportFromFileSuccess({
      filePath: '/tmp/tasks.csv',
      rawImportedData: [
        {
          record_url: 'https://example.com/video-1.m3u8',
          zl_name: '专栏A',
          kc_name: '课程A',
        },
        {
          zl_name: '缺少链接',
        },
      ],
      outputDirectory: '/downloads',
      durationMs: 12.34,
    });

    expect(result.validImportedData).toHaveLength(1);
    expect(result.importValidation.invalidCount).toBe(1);
    expect(result.tasks).toMatchObject([
      {
        url: 'https://example.com/video-1.m3u8',
        title: '课程A',
      },
    ]);
    expect(result.warningSummary).toEqual({
      总数: 2,
      有效: 1,
      无效: 1,
      成功率: '50.0%',
    });
    expect(result.validationErrors).toEqual(['第2行: 导入数据必须包含有效的视频URL']);
    expect(result.successSummary).toMatchObject({
      导入文件: '/tmp/tasks.csv',
      原始数据: 2,
      有效数据: 1,
      最终任务: 1,
      数据质量: '50.0%',
    });
    expect(result.successMessage).toBe('已导入 1/2 个任务 - 已跳过 1 条无效数据');
  });

  it('throws when imported rows are empty', () => {
    expect(() =>
      prepareImportFromFileSuccess({
        filePath: '/tmp/empty.csv',
        rawImportedData: [],
        outputDirectory: '/downloads',
        durationMs: 1,
      })
    ).toThrow('导入的文件为空或无有效数据');
  });

  it('builds success summary, validation patch/summary, task preview, and feedback message', () => {
    const summary = buildImportFromFileSuccessSummary({
      filePath: '/tmp/import.csv',
      rawCount: 10,
      validCount: 8,
      taskCount: 8,
      durationMs: 12.34,
      successRate: 0.8,
    });

    expect(summary).toMatchObject({
      导入文件: '/tmp/import.csv',
      原始数据: 10,
      有效数据: 8,
      最终任务: 8,
      数据质量: '80.0%',
    });
    expect(summary.验证耗时).toBe('12.34ms');

    expect(
      buildImportValidationPatch(['第2行: 导入数据必须包含有效的视频URL'])
    ).toEqual({
      validationErrors: ['第2行: 导入数据必须包含有效的视频URL'],
    });

    expect(
      buildImportValidationCompletionSummary({
        rawCount: 10,
        validCount: 8,
        successRate: 0.8,
      })
    ).toEqual({
      原始数量: 10,
      有效数量: 8,
      成功率: '80.0%',
    });

    expect(
      buildImportTaskPreviewSummary([
        {
          url: 'https://example.com/video-1.m3u8',
          title: '课程A',
          output_path: '/downloads/专栏A',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
          display_speed_bps: 0,
        } as any,
      ])
    ).toMatchObject({
      count: 1,
      sample: expect.objectContaining({ title: '课程A' }),
    });

    expect(
      buildImportFromFileSuccessMessage({
        taskCount: 8,
        rawCount: 10,
        invalidCount: 2,
        successRate: 0.8,
      })
    ).toBe('已导入 8/10 个任务 - 已跳过 2 条无效数据');
  });

  it('builds failure patch and logs context', () => {
    frontendLoggingMocks.reportFrontendDiagnostic.mockReset();

    const patch = buildImportFromFileFailurePatch(['旧错误'], new Error('boom'));
    expect(patch.validationErrors).toEqual(['旧错误', '文件导入失败: boom']);

    logImportFromFileFailureContext({
      filePath: '/tmp/import.csv',
      validationDuration: 45.67,
      validationStats: { failed: 1 },
    });

    expect(frontendLoggingMocks.reportFrontendDiagnostic).toHaveBeenCalledWith(
      'error',
      'import_file_flow:failure_context',
      {
        文件路径: '/tmp/import.csv',
        验证耗时: '45.67ms',
        验证统计: { failed: 1 },
      }
    );
  });
});
