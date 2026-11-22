import { z } from 'zod';
import { DownloaderTypeSchema, TaskStatusSchema } from './enums';

export const VideoInfoSchema = z
  .object({
    zl_id: z.string().optional(),
    zl_name: z.string().optional(),
    record_url: z.url().optional(),
    kc_id: z.string().optional(),
    kc_name: z.string().optional(),

    id: z.string().optional(),
    name: z.string().optional(),
    url: z.url().optional(),
    course_id: z.string().optional(),
    course_name: z.string().optional(),
  })
  .refine(
    data => {
      const hasNewFormat = data.zl_id || data.kc_id || data.record_url;
      const hasOldFormat = data.id || data.course_id || data.url;
      return hasNewFormat || hasOldFormat;
    },
    {
      message: '视频信息必须包含至少一组有效的标识符',
    }
  );

export const SourcePlatformSchema = z.enum([
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'generic',
]);

export const ExternalVideoInfoSchema = z.object({
  source_platform: SourcePlatformSchema,
  extractor: z.string().nullable().optional(),
  webpage_url: z.url().nullable().optional(),
  title: z.string().nullable().optional(),
  thumbnail: z.url().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  format_id: z.string().nullable().optional(),
  format_note: z.string().nullable().optional(),
  requires_auth: z.boolean().optional().default(false),
});

export const VideoTaskBaseSchema = z.object({
  id: z.string().min(1, '任务ID不能为空'),
  url: z.url('请输入有效的URL'),
  title: z.string().min(1, '标题不能为空'),
  output_path: z.string().min(1, '输出路径不能为空'),
  resolved_path: z.string().optional(),
  status: TaskStatusSchema,
  progress: z.number().min(0).max(100, '进度必须在0-100之间'),
  file_size: z.number().nonnegative().optional(),
  downloaded_size: z.number().nonnegative(),
  speed: z.number().nonnegative(),
  display_speed_bps: z.number().nonnegative().optional().default(0),
  eta: z.number().nonnegative().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.iso.datetime({ offset: true, error: '创建时间必须是有效的ISO datetime' }),
  updated_at: z.iso.datetime({ offset: true, error: '更新时间必须是有效的ISO datetime' }),
  downloader_type: DownloaderTypeSchema.optional(),
  video_info: VideoInfoSchema.optional(),
  external_info: ExternalVideoInfoSchema.optional(),
});

export const applyVideoTaskValidations = <T extends z.ZodType>(schema: T) =>
  schema.superRefine((data, ctx) => {
    const fileSize = (data as { file_size?: number }).file_size;
    const downloadedSize = (data as { downloaded_size?: number }).downloaded_size;

    if (
      typeof fileSize === 'number' &&
      typeof downloadedSize === 'number' &&
      downloadedSize > fileSize
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['downloaded_size'],
        message: '下载量不能超过文件总大小',
      });
    }
  });

export const VideoTaskSchema = applyVideoTaskValidations(VideoTaskBaseSchema);

export const ProgressUpdateSchema = z.object({
  task_id: z.string().min(1, '任务ID不能为空'),
  downloaded_size: z.number().nonnegative(),
  total_size: z.number().nonnegative().nullable().optional(),
  speed: z.number(),
  display_speed_bps: z.number().nonnegative().optional().default(0),
  eta: z.number().nullable().optional(),
  progress: z.number().min(0).max(1.01).optional(),
});

type ExternalVideoInfoOutput = z.infer<typeof ExternalVideoInfoSchema>;
type VideoTaskOutput = z.infer<typeof VideoTaskSchema>;
type ProgressUpdateOutput = z.infer<typeof ProgressUpdateSchema>;

export type VideoInfo = z.infer<typeof VideoInfoSchema>;
export type ExternalVideoInfo = Omit<ExternalVideoInfoOutput, 'requires_auth'> & {
  requires_auth?: boolean;
};
export type VideoTask = Omit<VideoTaskOutput, 'display_speed_bps' | 'external_info'> & {
  display_speed_bps?: number;
  external_info?: ExternalVideoInfo;
};
export type ProgressUpdate = Omit<ProgressUpdateOutput, 'display_speed_bps'> & {
  display_speed_bps?: number;
};
