import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeImportFromFileStoreAction } from '../importFileStoreAction';

describe('importFileStoreAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T09:00:00Z'));
  });

  it('loads raw rows, applies validation patch, and returns import summaries through one seam', async () => {
    const recordValidation = vi.fn();
    const applyValidationPatch = vi.fn();
    const applyFailurePatch = vi.fn();
    const toastApi = { success: vi.fn() };
    const addTasks = vi.fn().mockResolvedValue([]);

    const result = await executeImportFromFileStoreAction({
      filePath: '/tmp/tasks.csv',
      outputDirectory: '/downloads',
      importFile: vi.fn().mockResolvedValue([
        {
          record_url: 'https://example.com/video-1.m3u8',
          zl_name: '专栏A',
          kc_name: '课程A',
        },
        {
          zl_name: '缺少链接',
        },
      ]),
      addTasks,
      recordValidation,
      getValidationStats: () => ({ total: 1 }),
      getValidationErrors: () => ['旧错误'],
      applyValidationPatch,
      applyFailurePatch,
      toastApi,
    });

    expect(recordValidation).toHaveBeenCalledWith(false, expect.any(Number));
    expect(applyValidationPatch).toHaveBeenCalledWith({
      validationErrors: ['第2行: 导入数据必须包含有效的视频URL'],
    });
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
    expect(applyFailurePatch).not.toHaveBeenCalled();
  });

  it('applies failure patch and rethrows when import file command fails', async () => {
    const error = new Error('csv boom');
    const recordValidation = vi.fn();
    const applyFailurePatch = vi.fn();

    await expect(
      executeImportFromFileStoreAction({
        filePath: '/tmp/tasks.csv',
        outputDirectory: '/downloads',
        importFile: vi.fn().mockRejectedValue(error),
        addTasks: vi.fn(),
        recordValidation,
        getValidationStats: () => ({ total: 2 }),
        getValidationErrors: () => ['旧错误'],
        applyValidationPatch: vi.fn(),
        applyFailurePatch,
        toastApi: { success: vi.fn() },
      })
    ).rejects.toThrow('csv boom');

    expect(recordValidation).toHaveBeenCalledWith(false, expect.any(Number));
    expect(applyFailurePatch).toHaveBeenCalledWith({
      isImporting: false,
      validationErrors: ['旧错误', '文件导入失败: csv boom'],
      lastValidationTime: Date.now(),
    });
  });
});
