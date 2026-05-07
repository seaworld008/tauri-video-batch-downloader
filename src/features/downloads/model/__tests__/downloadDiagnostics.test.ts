import { describe, expect, it } from 'vitest';

import {
  buildTaskSupportBundle,
  classifyDownloadDiagnosticCode,
  toDownloadDiagnostic,
} from '../downloadDiagnostics';

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
    expect(classifyDownloadDiagnosticCode(new Error('authentication_required: sign in'))).toBe(
      'authentication_required'
    );
    expect(classifyDownloadDiagnosticCode(new Error('geo_or_policy_restricted: policy'))).toBe(
      'geo_or_policy_restricted'
    );
    expect(
      classifyDownloadDiagnosticCode(new Error('unsupported_extractor: Unsupported URL'))
    ).toBe('unsupported_extractor');
    expect(classifyDownloadDiagnosticCode(new Error('ffmpeg_missing: ffmpeg not found'))).toBe(
      'ffmpeg_missing'
    );
    expect(classifyDownloadDiagnosticCode(new Error('ytdlp_update_recommended'))).toBe(
      'ytdlp_update_recommended'
    );
    expect(classifyDownloadDiagnosticCode(new Error('failed to parse json output'))).toBe(
      'json_parse_failed'
    );
    expect(classifyDownloadDiagnosticCode(new Error('corrupted .part file'))).toBe(
      'part_file_corrupted'
    );
  });

  it('builds a copyable task support bundle with platform and log context', () => {
    const bundle = buildTaskSupportBundle(
      {
        id: 'task-1',
        title: 'Public video',
        url: 'https://www.youtube.com/watch?v=abc',
        output_path: '/downloads/Public video.mp4',
        status: 'failed',
        progress: 42,
        downloaded_size: 1024,
        file_size: 4096,
        speed: 0,
        created_at: '2026-05-07T00:00:00.000Z',
        updated_at: '2026-05-07T00:01:00.000Z',
        downloader_type: 'ytdlp',
        error_message: 'authentication_required: sign in',
        external_info: {
          source_platform: 'youtube',
          extractor: 'Youtube',
          webpage_url: 'https://www.youtube.com/watch?v=abc',
          requires_auth: true,
        },
      },
      { generatedAt: new Date('2026-05-07T00:02:00.000Z') }
    );

    expect(bundle).toContain('Video Downloader Pro Task Diagnostic');
    expect(bundle).toContain('generated_at: 2026-05-07T00:02:00.000Z');
    expect(bundle).toContain('task_id: task-1');
    expect(bundle).toContain('source_platform: youtube');
    expect(bundle).toContain('extractor: Youtube');
    expect(bundle).toContain('diagnostic_code: authentication_required');
    expect(bundle).toContain('logs: ./log/backend.log, ./log/frontend.log');
  });
});
