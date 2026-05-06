import { z } from 'zod';
import { LogLevelSchema, ThemeTypeSchema } from './enums';

export const DownloadConfigSchema = z
  .object({
    concurrent_downloads: z.number().int().min(1).max(10, '并发下载数应在1-10之间'),
    retry_attempts: z.number().int().min(0).max(10, '重试次数应在0-10之间'),
    timeout_seconds: z.number().int().min(10).max(300, '超时时间应在10-300秒之间'),
    user_agent: z.string().min(1, 'User-Agent不能为空'),
    proxy: z.string().optional().nullable(),
    headers: z.record(z.string(), z.string()),
    output_directory: z.string().min(1, '输出目录不能为空'),
    auto_verify_integrity: z.boolean(),
    integrity_algorithm: z.string().min(1).optional().nullable(),
    expected_hashes: z.record(z.string(), z.string()),
  })
  .refine(
    data => {
      if (data.proxy) {
        try {
          new URL(data.proxy);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: '代理设置必须是有效的URL格式',
    }
  );

export const UIConfigSchema = z.object({
  theme: ThemeTypeSchema,
  language: z.string().min(1),
  window_width: z.number().int().min(600),
  window_height: z.number().int().min(400),
  window_x: z.number().int().optional().nullable(),
  window_y: z.number().int().optional().nullable(),
  show_completed_tasks: z.boolean(),
  auto_start_downloads: z.boolean(),
  show_notifications: z.boolean(),
  notification_sound: z.boolean(),
  minimize_to_tray: z.boolean(),
  start_minimized: z.boolean(),
});

export const SystemConfigSchema = z.object({
  auto_update: z.boolean(),
  check_update_on_startup: z.boolean(),
  hardware_acceleration: z.boolean(),
  max_memory_usage_mb: z.number().int().positive().optional().nullable(),
  temp_directory: z.string().optional().nullable(),
  log_level: z.string().optional().nullable(),
});

export const YoutubeConfigSchema = z.object({
  default_quality: z.string().optional().nullable(),
  default_format: z.string().optional().nullable(),
  extract_audio: z.boolean(),
  audio_format: z.string().optional().nullable(),
  download_subtitles: z.boolean(),
  subtitle_languages: z.array(z.string()),
  download_thumbnail: z.boolean(),
  download_description: z.boolean(),
  playlist_reverse: z.boolean(),
  playlist_max_items: z.number().int().positive().optional().nullable(),
});

export const AdvancedConfigSchema = z.object({
  enable_logging: z.boolean(),
  log_level: LogLevelSchema,
  max_log_files: z.number().int().min(1).max(50),
  cleanup_on_exit: z.boolean(),
  enable_proxy: z.boolean(),
  proxy_type: z.enum(['http', 'https', 'socks4', 'socks5']),
  proxy_host: z.string().optional(),
  proxy_port: z.number().int().positive().optional(),
  proxy_username: z.string().optional(),
  proxy_password: z.string().optional(),
  custom_user_agents: z.record(z.string(), z.string()),
  rate_limit_mbps: z.number().positive().optional(),
  enable_statistics: z.boolean(),
  statistics_retention_days: z.number().int().min(1).max(365),
});

export const AppConfigSchema = z.object({
  download: DownloadConfigSchema,
  ui: UIConfigSchema.optional().nullable(),
  system: SystemConfigSchema.optional().nullable(),
  youtube: YoutubeConfigSchema.optional().nullable(),
  advanced: AdvancedConfigSchema,
});

export type DownloadConfig = z.infer<typeof DownloadConfigSchema>;
export type UIConfig = z.infer<typeof UIConfigSchema>;
export type SystemConfig = z.infer<typeof SystemConfigSchema>;
export type YoutubeConfig = z.infer<typeof YoutubeConfigSchema>;
export type AdvancedConfig = z.infer<typeof AdvancedConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
