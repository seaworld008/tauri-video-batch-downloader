import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ApiResponseSchema,
  CreateTaskRequestSchema,
  DownloadConfigSchema,
  DownloadStatsSchema,
  KeyboardShortcutSchema,
  ModalOptionsSchema,
  NotificationSchema,
  UpdateTaskRequestSchema,
  VideoTaskSchema,
  createApiResponseSchema,
  safeParse,
  validateArray,
  validateRelatedData,
} from '../index';
import { DataValidator } from '../../utils/dataValidationCore';

describe('Zod v4 schemas', () => {
  const validTaskBase = {
    id: 'task-1',
    url: 'https://example.com/video.mp4',
    title: 'Sample Video',
    output_path: '/downloads/video.mp4',
    status: 'pending' as const,
    progress: 0,
    downloaded_size: 0,
    speed: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00+00:00',
  };

  describe('VideoTaskSchema and task requests', () => {
    it('accepts Z and +00:00 ISO datetimes and populates default display_speed_bps', () => {
      const parsed = VideoTaskSchema.parse(validTaskBase);

      expect(parsed.display_speed_bps).toBe(0);
      expect(parsed.created_at).toBe('2026-01-01T00:00:00Z');
      expect(parsed.updated_at).toBe('2026-01-01T00:00:00+00:00');
    });

    it('preprocesses downloader_type youtube to ytdlp', () => {
      const parsed = VideoTaskSchema.parse({
        ...validTaskBase,
        downloader_type: 'youtube',
      });

      expect(parsed.downloader_type).toBe('ytdlp');
    });

    it('rejects invalid URL and datetime with expected localized messages', () => {
      const result = VideoTaskSchema.safeParse({
        ...validTaskBase,
        url: 'not-a-url',
        created_at: 'invalid-date',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.message === '请输入有效的URL')).toBe(true);
        expect(
          result.error.issues.some(issue => issue.message === '创建时间必须是有效的ISO datetime')
        ).toBe(true);
      }
    });

    it('emits custom issue when downloaded_size exceeds file_size', () => {
      const result = VideoTaskSchema.safeParse({
        ...validTaskBase,
        file_size: 100,
        downloaded_size: 150,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'custom',
              path: ['downloaded_size'],
              message: '下载量不能超过文件总大小',
            }),
          ])
        );
      }
    });

    it('validates CreateTaskRequestSchema and UpdateTaskRequestSchema', () => {
      const createResult = CreateTaskRequestSchema.safeParse({
        url: 'https://example.com/new.mp4',
        title: 'New Video',
        output_path: '/downloads/new.mp4',
        progress: 0,
        downloaded_size: 0,
        speed: 0,
      });
      expect(createResult.success).toBe(true);

      const updateResult = UpdateTaskRequestSchema.safeParse({
        id: 'task-1',
        title: 'Updated',
      });
      expect(updateResult.success).toBe(true);
    });
  });

  describe('DownloadConfigSchema and DownloadStatsSchema', () => {
    it('rejects invalid proxy URL in DownloadConfigSchema', () => {
      const result = DownloadConfigSchema.safeParse({
        concurrent_downloads: 3,
        retry_attempts: 3,
        timeout_seconds: 30,
        user_agent: 'TestAgent/1.0',
        proxy: 'not a valid url',
        headers: {},
        output_directory: '/downloads',
        auto_verify_integrity: false,
        expected_hashes: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(issue => issue.message === '代理设置必须是有效的URL格式')
        ).toBe(true);
      }
    });

    it('applies runtime defaults and rejects inconsistent task counts in DownloadStatsSchema', () => {
      const parsed = DownloadStatsSchema.parse({
        total_tasks: 2,
        completed_tasks: 1,
        failed_tasks: 1,
        total_downloaded: 1024,
        average_speed: 128,
        active_downloads: 0,
      });

      expect(parsed.display_total_speed_bps).toBe(0);
      expect(parsed.queue_paused).toBe(false);
      expect(parsed.average_transfer_duration).toBe(0);

      const invalid = DownloadStatsSchema.safeParse({
        total_tasks: 1,
        completed_tasks: 1,
        failed_tasks: 1,
        total_downloaded: 0,
        average_speed: 0,
        active_downloads: 0,
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('UI schemas', () => {
    it('accepts valid callbacks and rejects non-function callbacks', () => {
      const fn = vi.fn();

      expect(
        NotificationSchema.safeParse({
          id: 'notif-1',
          type: 'info',
          title: 'Notice',
          message: 'Done',
          timestamp: Date.now(),
          actions: [{ label: 'Open', action: fn }],
        }).success
      ).toBe(true);

      expect(
        NotificationSchema.safeParse({
          id: 'notif-2',
          type: 'error',
          title: 'Error',
          message: 'Bad action',
          timestamp: Date.now(),
          actions: [{ label: 'Broken', action: 'not-a-fn' }],
        }).success
      ).toBe(false);

      expect(
        ModalOptionsSchema.safeParse({
          type: 'confirm',
          title: 'Confirm',
          onConfirm: async () => {},
          onCancel: fn,
        }).success
      ).toBe(true);

      expect(
        ModalOptionsSchema.safeParse({
          type: 'confirm',
          title: 'Confirm',
          onConfirm: 123,
        }).success
      ).toBe(false);

      expect(
        KeyboardShortcutSchema.safeParse({
          key: 'Enter',
          action: fn,
          description: 'Submit',
        }).success
      ).toBe(true);

      expect(
        KeyboardShortcutSchema.safeParse({
          key: 'Enter',
          action: null,
          description: 'Submit',
        }).success
      ).toBe(false);
    });
  });

  describe('Validation helpers and API response schemas', () => {
    it('populates errors from Zod v4 issues in safeParse, validateArray, validateRelatedData, and DataValidator', () => {
      const itemSchema = z.object({ count: z.number().int().positive() });

      const failed = safeParse(itemSchema, { count: -1 });
      expect(failed.success).toBe(false);
      expect(failed.errors?.length).toBeGreaterThan(0);
      expect(failed.errors?.[0].path).toEqual(['count']);

      const batch = validateArray(itemSchema, [{ count: 2 }, { count: -5 }]);
      expect(batch.validItems).toEqual([{ count: 2 }]);
      expect(batch.invalidItems).toHaveLength(1);
      expect(batch.invalidItems[0].errors.length).toBeGreaterThan(0);

      const related = validateRelatedData([
        { name: 'ok', schema: itemSchema, data: { count: 1 } },
        { name: 'bad', schema: itemSchema, data: { count: 0 } },
      ]);
      expect(related.success).toBe(false);
      expect(related.results.ok.success).toBe(true);
      expect(related.results.bad.success).toBe(false);
      expect(related.results.bad.errors?.length).toBeGreaterThan(0);

      const coreResult = DataValidator.getInstance().validate(
        itemSchema,
        { count: -3 },
        {
          context: 'SchemaTest',
        }
      );
      expect(coreResult.success).toBe(false);
      expect(coreResult.errors?.[0]).toEqual(
        expect.objectContaining({
          field: 'count',
          code: 'too_small',
        })
      );
    });

    it('validates createApiResponseSchema and ApiResponseSchema variants', () => {
      const typedApiSchema = createApiResponseSchema(z.object({ id: z.string() }));

      expect(
        typedApiSchema.safeParse({
          success: true,
          data: { id: 'abc' },
          timestamp: Date.now(),
        }).success
      ).toBe(true);

      expect(
        typedApiSchema.safeParse({
          success: true,
          timestamp: Date.now(),
        }).success
      ).toBe(false);

      expect(
        ApiResponseSchema.safeParse({
          success: false,
          error: 'Failed',
          timestamp: Date.now(),
        }).success
      ).toBe(true);

      expect(
        ApiResponseSchema.safeParse({
          success: false,
          timestamp: Date.now(),
        }).success
      ).toBe(false);
    });
  });
});
