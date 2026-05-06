import { z } from 'zod';

export const NetworkSpeedSchema = z.object({
  download: z.number().nonnegative(),
  upload: z.number().nonnegative(),
});

export const SystemInfoSchema = z.object({
  cpu_usage: z.number().min(0).max(100),
  memory_usage: z.number().min(0).max(100),
  disk_usage: z.number().min(0).max(100),
  network_speed: NetworkSpeedSchema,
  active_downloads: z.number().nonnegative(),
});

export const DownloadStatsSchema = z
  .object({
    total_tasks: z.number().nonnegative(),
    completed_tasks: z.number().nonnegative(),
    failed_tasks: z.number().nonnegative(),
    total_downloaded: z.number().nonnegative(),
    average_speed: z.number().nonnegative(),
    display_total_speed_bps: z.number().nonnegative().optional().default(0),
    active_downloads: z.number().nonnegative(),
    queue_paused: z.boolean().optional().default(false),
    average_transfer_duration: z.number().nonnegative().optional().default(0),
    average_commit_duration: z.number().nonnegative().optional().default(0),
    p95_commit_duration: z.number().nonnegative().optional().default(0),
    failed_commit_count: z.number().nonnegative().optional().default(0),
    commit_warning_count: z.number().nonnegative().optional().default(0),
    commit_elevated_warning_count: z.number().nonnegative().optional().default(0),
  })
  .refine(data => data.completed_tasks + data.failed_tasks <= data.total_tasks, {
    message: '任务统计数据不一致',
  });

export type NetworkSpeed = z.infer<typeof NetworkSpeedSchema>;
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
export type DownloadStats = z.infer<typeof DownloadStatsSchema>;
