import { describe, expect, it, vi } from 'vitest';
import {
  buildTasksFromImportedData,
  buildTasksFromUrls,
  filterExistingTaskIds,
} from '../importOrchestration';

const frontendLoggingMocks = vi.hoisted(() => ({
  reportFrontendDiagnosticIfEnabled: vi.fn(),
}));

vi.mock('../../../../utils/frontendLogging', () => frontendLoggingMocks);

describe('importOrchestration helpers', () => {
  it('builds task drafts from raw urls', () => {
    expect(buildTasksFromUrls(['https://example.com/a.mp4'], '/downloads')).toEqual([
      {
        url: 'https://example.com/a.mp4',
        title: 'https://example.com/a.mp4',
        output_path: '/downloads',
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        display_speed_bps: 0,
        eta: undefined,
        error_message: undefined,
      },
    ]);
  });

  it('filters ids down to tasks that still exist in store state', () => {
    expect(
      filterExistingTaskIds(['task-1', 'missing', 'task-2'], [
        { id: 'task-1' } as any,
        { id: 'task-2' } as any,
      ])
    ).toEqual(['task-1', 'task-2']);
  });

  it('maps validated imported records into download task drafts', () => {
    expect(
      buildTasksFromImportedData(
        [
          {
            id: 'row-1',
            name: '专题一',
            zl_name: '专栏A',
            record_url: 'https://example.com/video-1.m3u8',
            course_id: 'course-1',
            course_name: '课程A',
          } as any,
        ],
        '/downloads'
      )
    ).toEqual([
      {
        url: 'https://example.com/video-1.m3u8',
        title: '课程A',
        output_path: '/downloads/专栏A',
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        display_speed_bps: 0,
        eta: undefined,
        error_message: undefined,
        video_info: {
          zl_id: 'row-1',
          zl_name: '专栏A',
          record_url: 'https://example.com/video-1.m3u8',
          kc_id: 'course-1',
          kc_name: '课程A',
        },
      },
    ]);
  });

  it('skips imported rows that still lack a usable url after validation fallback', () => {
    frontendLoggingMocks.reportFrontendDiagnosticIfEnabled.mockReset();

    expect(buildTasksFromImportedData([{ name: '缺少链接' } as any], '/downloads')).toEqual([]);
    expect(frontendLoggingMocks.reportFrontendDiagnosticIfEnabled).toHaveBeenCalledWith(
      'warn',
      'import_orchestration:skip_row_missing_url',
      { name: '缺少链接' }
    );
  });
});