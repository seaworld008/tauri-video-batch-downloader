import { describe, expect, it, vi } from 'vitest';

import { executeImportFromFile } from '../importFileAction';

describe('importFileAction', () => {
  it('executes import success orchestration through one seam', async () => {
    const addTasks = vi.fn().mockResolvedValue([]);
    const recordValidation = vi.fn();
    const setValidationErrors = vi.fn();
    const toastApi = { success: vi.fn() };

    const result = await executeImportFromFile({
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
      addTasks,
      recordValidation,
      setValidationErrors,
      toastApi,
    });

    expect(recordValidation).toHaveBeenCalledWith(false, 12.34);
    expect(setValidationErrors).toHaveBeenCalledWith(['第2行: 导入数据必须包含有效的视频URL']);
    expect(addTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://example.com/video-1.m3u8',
        title: '课程A',
      }),
    ]);
    expect(toastApi.success).toHaveBeenCalledWith('已导入 1/2 个任务 - 已跳过 1 条无效数据');
    expect(result.completionSummary).toEqual({
      原始数量: 2,
      有效数量: 1,
      成功率: '50.0%',
    });
    expect(result.taskPreviewSummary).toMatchObject({
      count: 1,
      sample: expect.objectContaining({ title: '课程A' }),
    });
    expect(result.warningSummary).toEqual({
      总数: 2,
      有效: 1,
      无效: 1,
      成功率: '50.0%',
    });
  });
});
