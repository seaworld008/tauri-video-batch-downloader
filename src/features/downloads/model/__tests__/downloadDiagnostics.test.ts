import { describe, expect, it } from 'vitest';

import { classifyDownloadDiagnosticCode, toDownloadDiagnostic } from '../downloadDiagnostics';

describe('downloadDiagnostics', () => {
  it('classifies concurrency failures as queued informational diagnostics', () => {
    const diagnostic = toDownloadDiagnostic({ code: 'MAX_CONCURRENCY_REACHED' });

    expect(diagnostic).toMatchObject({
      code: 'max_concurrency_reached',
      severity: 'info',
    });
    expect(diagnostic.message).toContain('等待队列');
  });

  it('classifies user-actionable download failures', () => {
    expect(classifyDownloadDiagnosticCode(new Error('Permission denied'))).toBe(
      'permission_denied'
    );
    expect(classifyDownloadDiagnosticCode(new Error('HTTP 429 Too Many Requests'))).toBe(
      'rate_limited'
    );
    expect(classifyDownloadDiagnosticCode(new Error('yt-dlp not installed'))).toBe(
      'external_tool_missing'
    );
    expect(classifyDownloadDiagnosticCode(new Error('failed to parse json output'))).toBe(
      'json_parse_failed'
    );
    expect(classifyDownloadDiagnosticCode(new Error('corrupted .part file'))).toBe(
      'part_file_corrupted'
    );
  });
});
