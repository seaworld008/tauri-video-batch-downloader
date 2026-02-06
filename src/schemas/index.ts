/**
 * 🏗️ Zod Schema 定义库
 * 提供运行时类型验证和TypeScript类型推断
 *
 * 功能特性：
 * - 完整的类型覆盖：从基础枚举到复杂嵌套对象
 * - 运行时验证：确保数据在运行时符合预期类型
 * - 类型推断：使用z.infer<>自动生成TypeScript类型
 * - 错误处理：提供详细的验证错误信息
 * - 向后兼容：支持现有类型的平滑迁移
 */
import { z } from 'zod';

// ====================================================
// 基础枚举 Schemas
// ====================================================

/**
 * 任务状态枚举 - 支持所有下载阶段
 */
export const TaskStatusSchema = z.enum([
  'pending',
  'downloading',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * 下载器类型枚举 - 支持多种视频源
 */
export const DownloaderTypeSchema = z.enum(['http', 'm3u8', 'youtube']);

/**
 * UI视图类型枚举
 */
export const ViewTypeSchema = z.enum(['dashboard', 'import', 'settings', 'about']);

/**
 * 通知类型枚举
 */
export const NotificationTypeSchema = z.enum(['success', 'error', 'warning', 'info']);

/**
 * 模态框类型枚举
 */
export const ModalTypeSchema = z.enum(['confirm', 'info', 'warning', 'error', 'custom']);

/**
 * 表单字段类型枚举
 */
export const FormFieldTypeSchema = z.enum([
  'text',
  'number',
  'select',
  'checkbox',
  'file',
  'textarea',
]);

/**
 * 日志级别枚举
 */
export const LogLevelSchema = z.enum(['error', 'warn', 'info', 'debug']);

/**
 * 主题类型枚举
 */
export const ThemeTypeSchema = z.enum(['light', 'dark', 'system']);

// ====================================================
// 核心数据结构 Schemas
// ====================================================

/**
 * 视频信息 Schema - 支持多种数据源格式
 * 包含新格式(zl_*, kc_*)和向后兼容格式
 */
export const VideoInfoSchema = z
  .object({
    // 新标准格式
    zl_id: z.string().optional(),
    zl_name: z.string().optional(),
    record_url: z.string().url().optional(),
    kc_id: z.string().optional(),
    kc_name: z.string().optional(),

    // 向后兼容格式
    id: z.string().optional(),
    name: z.string().optional(),
    url: z.string().url().optional(),
    course_id: z.string().optional(),
    course_name: z.string().optional(),
  })
  .refine(
    data => {
      // 至少包含一组有效的标识符
      const hasNewFormat = data.zl_id || data.kc_id || data.record_url;
      const hasOldFormat = data.id || data.course_id || data.url;
      return hasNewFormat || hasOldFormat;
    },
    {
      message: '视频信息必须包含至少一组有效的标识符',
    }
  );

/**
 * 主要下载任务 Schema
 * 包含完整的任务生命周期数据
 */
const VideoTaskBaseSchema = z.object({
  id: z.string().min(1, '任务ID不能为空'),
  url: z.string().url('请输入有效的URL'),
  title: z.string().min(1, '标题不能为空'),
  output_path: z.string().min(1, '输出路径不能为空'),
  status: TaskStatusSchema,
  progress: z.number().min(0).max(100, '进度必须在0-100之间'),
  file_size: z.number().nonnegative().optional(),
  downloaded_size: z.number().nonnegative(),
  speed: z.number().nonnegative(),
  eta: z.number().nonnegative().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string().datetime('创建时间必须是有效的ISO datetime'),
  updated_at: z.string().datetime('更新时间必须是有效的ISO datetime'),
  downloader_type: DownloaderTypeSchema.optional(),
  video_info: VideoInfoSchema.optional(),
});

const applyVideoTaskValidations = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((data, ctx) => {
    const fileSize = (data as { file_size?: number }).file_size;
    const downloadedSize = (data as { downloaded_size?: number }).downloaded_size;

    if (
      typeof fileSize === 'number' &&
      typeof downloadedSize === 'number' &&
      downloadedSize > fileSize
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['downloaded_size'],
        message: '下载量不能超过文件总大小',
      });
    }
  });

export const VideoTaskSchema = applyVideoTaskValidations(VideoTaskBaseSchema);

/**
 * 进度更新 Schema
 * 放宽验证规则以提高健壮性，允许一些边缘情况
 */
export const ProgressUpdateSchema = z.object({
  task_id: z.string().min(1, '任务ID不能为空'),
  downloaded_size: z.number().nonnegative(),
  total_size: z.number().nonnegative().nullable().optional(),
  speed: z.number(), // 允许任何数值，负数会在前端被规范化为0
  eta: z.number().nullable().optional(),
  progress: z.number().min(0).max(1.01).optional(), // 允许略微超过1的值（浮点精度问题）
});
// 移除 refine 验证，因为在断点续传等场景下 downloaded_size 可能暂时超过 total_size

/**
 * 导入数据 Schema - 支持CSV/Excel导入
 */
export const ImportedDataSchema = z
  .object({
    // 新标准格式
    zl_id: z.string().optional(),
    zl_name: z.string().optional(),
    record_url: z.string().optional(),
    kc_id: z.string().optional(),
    kc_name: z.string().optional(),

    // 向后兼容格式
    id: z.string().optional(),
    name: z.string().optional(),
    url: z.string().optional(),
    course_id: z.string().optional(),
    course_name: z.string().optional(),
  })
  .refine(
    data => {
      // 验证至少包含必需的URL信息
      const validUrl = data.record_url || data.url;
      if (!validUrl) {
        return false;
      }

      // 验证URL格式
      try {
        new URL(validUrl);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: '导入数据必须包含有效的视频URL',
    }
  );

// ====================================================
// 配置 Schemas
// ====================================================

/**
 * 下载配置 Schema
 */
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
      // 验证代理格式 (如果提供)
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

/**
 * UI配置 Schema
 */
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

/**
 * 高级配置 Schema
 */
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

/**
 * 应用程序配置 Schema
 */
export const AppConfigSchema = z.object({
  download: DownloadConfigSchema,
  ui: UIConfigSchema.optional().nullable(),
  system: SystemConfigSchema.optional().nullable(),
  youtube: YoutubeConfigSchema.optional().nullable(),
  advanced: AdvancedConfigSchema,
});

// ====================================================
// 系统信息和统计 Schemas
// ====================================================

/**
 * 网络速度 Schema
 */
export const NetworkSpeedSchema = z.object({
  download: z.number().nonnegative(),
  upload: z.number().nonnegative(),
});

/**
 * 系统信息 Schema
 */
export const SystemInfoSchema = z.object({
  cpu_usage: z.number().min(0).max(100),
  memory_usage: z.number().min(0).max(100),
  disk_usage: z.number().min(0).max(100),
  network_speed: NetworkSpeedSchema,
  active_downloads: z.number().nonnegative(),
});

/**
 * 下载统计 Schema
 */
export const DownloadStatsSchema = z
  .object({
    total_tasks: z.number().nonnegative(),
    completed_tasks: z.number().nonnegative(),
    failed_tasks: z.number().nonnegative(),
    total_downloaded: z.number().nonnegative(),
    average_speed: z.number().nonnegative(),
    active_downloads: z.number().nonnegative(),
    queue_paused: z.boolean().optional().default(false),
  })
  .refine(
    data => {
      // 验证统计数据的一致性
      return data.completed_tasks + data.failed_tasks <= data.total_tasks;
    },
    {
      message: '任务统计数据不一致',
    }
  );

// ====================================================
// YouTube 相关 Schemas
// ====================================================

/**
 * 视频格式 Schema
 */
export const VideoFormatSchema = z.object({
  format_id: z.string(),
  ext: z.string(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  fps: z.number().positive().optional(),
  vbr: z.number().nonnegative().optional(),
  abr: z.number().nonnegative().optional(),
  filesize: z.number().nonnegative().optional(),
  quality: z.string(),
});

/**
 * 字幕轨道 Schema
 */
export const SubtitleTrackSchema = z.object({
  language: z.string().min(1),
  language_code: z.string().length(2, '语言代码必须是2位'),
  url: z.string().url(),
  ext: z.string().min(1),
});

/**
 * YouTube视频信息 Schema
 */
export const YoutubeVideoInfoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  duration: z.number().nonnegative(),
  thumbnail: z.string().url(),
  formats: z.array(VideoFormatSchema),
  subtitles: z.array(SubtitleTrackSchema),
});

// ====================================================
// 文件和导入 Schemas
// ====================================================

/**
 * 编码检测结果 Schema
 */
export const EncodingDetectionSchema = z.object({
  encoding: z.string().min(1),
  confidence: z.number().min(0).max(1),
  language: z.string().optional(),
});

/**
 * 导入预览 Schema
 */
export const ImportPreviewSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  total_rows: z.number().nonnegative(),
  encoding: z.string().min(1),
  field_mapping: z.record(z.string(), z.string()),
});

// ====================================================
// UI和交互 Schemas
// ====================================================

/**
 * 通知操作 Schema
 */
export const NotificationActionSchema = z.object({
  label: z.string().min(1),
  action: z.function().returns(z.void()),
  style: z.enum(['primary', 'secondary']).optional(),
});

/**
 * 通知 Schema
 */
export const NotificationSchema = z.object({
  id: z.string().min(1),
  type: NotificationTypeSchema,
  title: z.string().min(1),
  message: z.string(),
  timestamp: z.number().nonnegative(),
  duration: z.number().positive().optional(),
  actions: z.array(NotificationActionSchema).optional(),
});

/**
 * 模态框选项 Schema
 */
export const ModalOptionsSchema = z.object({
  type: ModalTypeSchema,
  title: z.string().min(1),
  message: z.string().optional(),
  confirmText: z.string().optional(),
  cancelText: z.string().optional(),
  onConfirm: z
    .function()
    .returns(z.union([z.void(), z.promise(z.void())]))
    .optional(),
  onCancel: z.function().returns(z.void()).optional(),
  customContent: z.any().optional(), // React.ReactNode 类型较难直接验证
});

/**
 * 表单字段 Schema
 */
export const FormFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: FormFieldTypeSchema,
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  validation: z.any().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.any(),
      })
    )
    .optional(),
  description: z.string().optional(),
});

// ====================================================
// 过滤和排序 Schemas
// ====================================================

/**
 * 日期范围 Schema
 */
export const DateRangeSchema = z
  .object({
    start: z.date(),
    end: z.date(),
  })
  .refine(data => data.start <= data.end, {
    message: '开始日期不能晚于结束日期',
  });

/**
 * 过滤选项 Schema
 */
export const FilterOptionsSchema = z.object({
  status: z.array(TaskStatusSchema).optional(),
  downloader_type: z.array(DownloaderTypeSchema).optional(),
  date_range: DateRangeSchema.optional(),
  search_query: z.string().optional(),
});

/**
 * 排序选项 Schema
 */
export const SortOptionsSchema = z.object({
  field: z.string(), // 使用string而非keyof VideoTask，更灵活
  direction: z.enum(['asc', 'desc']),
});

/**
 * 分页选项 Schema
 */
export const PaginationOptionsSchema = z
  .object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(1000),
    total: z.number().int().nonnegative(),
  })
  .refine(
    data => {
      // 验证页码不超出总页数
      const totalPages = Math.ceil(data.total / data.limit);
      return data.page <= totalPages || totalPages === 0;
    },
    {
      message: '页码超出有效范围',
    }
  );

// ====================================================
// API和错误处理 Schemas
// ====================================================

/**
 * API响应 Schema (泛型)
 */
export const createApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z
    .object({
      success: z.boolean(),
      data: dataSchema.optional(),
      error: z.string().optional(),
      timestamp: z.number().nonnegative(),
    })
    .refine(
      data => {
        // 成功时应该有data，失败时应该有error
        if (data.success && !data.data) {
          return false;
        }
        if (!data.success && !data.error) {
          return false;
        }
        return true;
      },
      {
        message: 'API响应格式不正确',
      }
    );

/**
 * 通用API响应 Schema
 */
export const ApiResponseSchema = createApiResponseSchema(z.any());

/**
 * 应用错误 Schema
 */
export const AppErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.any().optional(),
  timestamp: z.number().nonnegative(),
});

/**
 * 键盘快捷键 Schema
 */
export const KeyboardShortcutSchema = z.object({
  key: z.string().min(1),
  ctrlKey: z.boolean().optional(),
  altKey: z.boolean().optional(),
  shiftKey: z.boolean().optional(),
  metaKey: z.boolean().optional(),
  action: z.function().returns(z.void()),
  description: z.string().min(1),
});

// ====================================================
// 类型推断导出 - 与现有types/index.ts保持一致
// ====================================================

/**
 * 从Zod Schema推断的TypeScript类型
 * 这些类型可以替代types/index.ts中的手动类型定义
 */
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type DownloaderType = z.infer<typeof DownloaderTypeSchema>;
export type ViewType = z.infer<typeof ViewTypeSchema>;
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export type ModalType = z.infer<typeof ModalTypeSchema>;
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type ThemeType = z.infer<typeof ThemeTypeSchema>;

export type VideoInfo = z.infer<typeof VideoInfoSchema>;
export type VideoTask = z.infer<typeof VideoTaskSchema>;
export type ProgressUpdate = z.infer<typeof ProgressUpdateSchema>;
export type ImportedData = z.infer<typeof ImportedDataSchema>;

export type DownloadConfig = z.infer<typeof DownloadConfigSchema>;
export type UIConfig = z.infer<typeof UIConfigSchema>;
export type AdvancedConfig = z.infer<typeof AdvancedConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export type NetworkSpeed = z.infer<typeof NetworkSpeedSchema>;
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
export type DownloadStats = z.infer<typeof DownloadStatsSchema>;

export type VideoFormat = z.infer<typeof VideoFormatSchema>;
export type SubtitleTrack = z.infer<typeof SubtitleTrackSchema>;
export type YoutubeVideoInfo = z.infer<typeof YoutubeVideoInfoSchema>;

export type EncodingDetection = z.infer<typeof EncodingDetectionSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationAction = z.infer<typeof NotificationActionSchema>;
export type ModalOptions = z.infer<typeof ModalOptionsSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;

export type DateRange = z.infer<typeof DateRangeSchema>;
export type FilterOptions = z.infer<typeof FilterOptionsSchema>;
export type SortOptions = z.infer<typeof SortOptionsSchema>;
export type PaginationOptions = z.infer<typeof PaginationOptionsSchema>;

export type ApiResponse<T = any> = z.infer<
  ReturnType<typeof createApiResponseSchema<z.ZodType<T>>>
>;
export type AppError = z.infer<typeof AppErrorSchema>;
export type KeyboardShortcut = z.infer<typeof KeyboardShortcutSchema>;

// ====================================================
// 集合类型 Schemas
// ====================================================

/**
 * 任务列表 Schema
 */
export const TaskListSchema = z.array(VideoTaskSchema);

/**
 * 导入数据列表 Schema
 */
export const ImportDataListSchema = z.array(ImportedDataSchema);

/**
 * 通知列表 Schema
 */
export const NotificationListSchema = z.array(NotificationSchema);

// ====================================================
// 常用的组合 Schemas
// ====================================================

/**
 * 任务创建请求 Schema - 用于新建任务时的数据验证
 */
export const CreateTaskRequestSchema = applyVideoTaskValidations(
  VideoTaskBaseSchema.omit({
    id: true,
    status: true,
    created_at: true,
    updated_at: true,
  }).extend({
    // 允许提交初始状态
    status: TaskStatusSchema.optional(),
  })
);

/**
 * 更新任务请求 Schema - 用于更新任务时的严格验证
 */
export const UpdateTaskRequestSchema = applyVideoTaskValidations(
  VideoTaskBaseSchema.partial().extend({
    id: z.string().min(1), // ID不能为空
  })
);

/**
 * 批量操作请求 Schema
 */
export const BatchOperationRequestSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, '至少需要选择一个任务'),
  operation: z.enum(['start', 'pause', 'resume', 'cancel', 'delete']),
  options: z.record(z.string(), z.any()).optional(),
});

// ====================================================
// Schema验证工具函数
// ====================================================

/**
 * 安全解析函数 - 返回解析结果和错误信息
 */
export const safeParse = <T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): {
  success: boolean;
  data?: z.infer<T>;
  errors?: z.ZodError['errors'];
} => {
  const result = schema.safeParse(data);
  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  } else {
    return {
      success: false,
      errors: result.error.errors,
    };
  }
};

/**
 * 批量验证函数 - 验证数组中的所有项目
 */
export const validateArray = <T extends z.ZodTypeAny>(
  schema: T,
  dataArray: unknown[]
): {
  validItems: z.infer<T>[];
  invalidItems: { index: number; data: unknown; errors: z.ZodError['errors'] }[];
} => {
  const validItems: z.infer<T>[] = [];
  const invalidItems: { index: number; data: unknown; errors: z.ZodError['errors'] }[] = [];

  dataArray.forEach((item, index) => {
    const result = safeParse(schema, item);
    if (result.success && result.data) {
      validItems.push(result.data);
    } else {
      invalidItems.push({
        index,
        data: item,
        errors: result.errors || [],
      });
    }
  });

  return { validItems, invalidItems };
};

/**
 * Schema组合验证 - 验证多个相关的数据对象
 */
export const validateRelatedData = (
  validations: {
    name: string;
    schema: z.ZodTypeAny;
    data: unknown;
  }[]
): {
  success: boolean;
  results: Record<string, { success: boolean; data?: any; errors?: z.ZodError['errors'] }>;
} => {
  const results: Record<string, { success: boolean; data?: any; errors?: z.ZodError['errors'] }> =
    {};
  let overallSuccess = true;

  validations.forEach(({ name, schema, data }) => {
    const result = safeParse(schema, data);
    results[name] = result;
    if (!result.success) {
      overallSuccess = false;
    }
  });

  return {
    success: overallSuccess,
    results,
  };
};

/**
 * 默认导出 - 常用的schemas集合
 */
export default {
  // 枚举类型
  TaskStatusSchema,
  DownloaderTypeSchema,
  ViewTypeSchema,
  NotificationTypeSchema,

  // 核心数据类型
  VideoTaskSchema,
  ImportedDataSchema,
  ProgressUpdateSchema,

  // 配置类型
  AppConfigSchema,
  DownloadConfigSchema,

  // API类型
  ApiResponseSchema,
  AppErrorSchema,

  // 工具函数
  safeParse,
  validateArray,
  validateRelatedData,
  createApiResponseSchema,
};
