import { describe, expect, it } from 'vitest';
import { validateImportedRows } from '../importValidation';

describe('importValidation helpers', () => {
  it('returns validated rows plus summarized error messages for partial failures', () => {
    const result = validateImportedRows([
      {
        record_url: 'https://example.com/video-1.m3u8',
        zl_name: '专栏A',
        kc_name: '课程A',
      },
      {
        zl_name: '缺少链接',
      },
    ]);

    expect(result.validImportedData).toHaveLength(1);
    expect(result.invalidCount).toBe(1);
    expect(result.totalItems).toBe(2);
    expect(result.successRate).toBe(0.5);
    expect(result.validationErrorMessages).toEqual(['第2行: 导入数据必须包含有效的视频URL']);
  });

  it('throws a summarized error when every imported row is invalid', () => {
    expect(() => validateImportedRows([{ zl_name: '缺少链接' }])).toThrow(
      '所有导入数据均无效。错误详情: 第1行: 导入数据必须包含有效的视频URL'
    );
  });
});