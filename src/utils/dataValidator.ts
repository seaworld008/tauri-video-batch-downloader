/**
 * 🛡️ 数据验证工具
 *
 * 核心功能：
 * - 运行时类型检查和数据验证
 * - 与Zod schemas的无缝集成
 * - 详细的错误报告和处理
 * - 性能优化的批量验证
 * - 自动类型推断和转换
 */

import { z } from 'zod';
import {
  VideoTaskSchema,
  ImportedDataSchema,
  ProgressUpdateSchema,
  DownloadConfigSchema,
  AppConfigSchema,
  ApiResponseSchema,
  AppErrorSchema,
  TaskListSchema,
  ImportDataListSchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  BatchOperationRequestSchema,
  safeParse,
  validateArray,
  validateRelatedData,
  createApiResponseSchema,
} from '../schemas';
import type {
  VideoTask,
  ImportedData,
  ProgressUpdate,
  DownloadConfig,
  AppConfig,
  ApiResponse,
  AppError,
} from '../schemas';
import { AppErrorHandler } from './errorHandler';

// ====================================================
// 验证结果类型定义
// ====================================================

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  sanitizedData?: T; // 清理后的数据
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  receivedValue?: any;
}

export interface BatchValidationResult<T = any> {
  success: boolean;
  validItems: T[];
  invalidItems: {
    index: number;
    data: unknown;
    errors: ValidationError[];
  }[];
  successRate: number;
  totalItems: number;
}

// ====================================================
// 核心验证类
// ====================================================

export class DataValidator {
  private static instance: DataValidator;

  private constructor() {}

  public static getInstance(): DataValidator {
    if (!DataValidator.instance) {
      DataValidator.instance = new DataValidator();
    }
    return DataValidator.instance;
  }

  private transformZodErrors(zodErrors: z.ZodError['errors']): ValidationError[] {
    return zodErrors.map(error => ({
      field: error.path.join('.') || 'root',
      message: error.message,
      code: error.code,
      receivedValue: (error as any).received,
    }));
  }

  private reportValidationFailure(
    context: string,
    errors: ValidationError[],
    originalData: unknown,
    schemaName: string | undefined
  ) {
    console.error(`[验证失败] ${context}`, {
      validationErrors: errors,
      originalData,
      schemaName,
    });

    AppErrorHandler.handle(`数据验证失败 [${context}]`, new Error(JSON.stringify(errors)), false);
  }

  public validate<T extends z.ZodTypeAny>(
    schema: T,
    data: unknown,
    options: {
      sanitize?: boolean;
      strict?: boolean;
      context?: string;
    } = {}
  ): ValidationResult<z.infer<T>> {
    const { sanitize = true, strict = false, context = 'unknown' } = options;

    try {
      const result = safeParse(schema, data);

      if (result.success && result.data) {
        return {
          success: true,
          data: result.data,
          sanitizedData: sanitize ? this.sanitizeData(result.data) : result.data,
        };
      }

      const errors = result.errors ? this.transformZodErrors(result.errors) : [];
      this.reportValidationFailure(context, errors, data, (schema as any)?.constructor?.name);

      return {
        success: false,
        errors,
        data: strict ? undefined : (data as z.infer<T>),
      };
    } catch (error) {
      AppErrorHandler.handle(`数据验证异常 [${context}]`, error as Error, false);

      return {
        success: false,
        errors: [
          {
            field: 'validation',
            message: '验证流程出现异常',
            code: 'VALIDATION_EXCEPTION',
          },
        ],
      };
    }
  }

  public validateBatch<T extends z.ZodTypeAny>(
    schema: T,
    dataArray: unknown[],
    options: {
      stopOnFirstError?: boolean;
      sanitize?: boolean;
      context?: string;
    } = {}
  ): BatchValidationResult<z.infer<T>> {
    const { stopOnFirstError = false, sanitize = true, context = 'batch' } = options;
    const validItems: z.infer<T>[] = [];
    const invalidItems: BatchValidationResult['invalidItems'] = [];

    for (let index = 0; index < dataArray.length; index++) {
      const item = dataArray[index];
      const result = this.validate(schema, item, { sanitize, context: `${context}[${index}]` });

      if (result.success && result.data) {
        validItems.push(result.sanitizedData || result.data);
      } else {
        invalidItems.push({
          index,
          data: item,
          errors: result.errors || [],
        });

        if (stopOnFirstError) {
          break;
        }
      }
    }

    const totalItems = dataArray.length;
    const successRate = totalItems > 0 ? validItems.length / totalItems : 0;

    return {
      success: invalidItems.length === 0,
      validItems,
      invalidItems,
      successRate,
      totalItems,
    };
  }

  private sanitizeData<T>(data: T): T {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item)) as T;
    }

    if (typeof data === 'object' && data.constructor === Object) {
      const sanitized: any = {};

      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          sanitized[key] =
            typeof value === 'string' ? value.trim() : this.sanitizeData(value as any);
        }
      }

      return sanitized as T;
    }

    if (typeof data === 'string') {
      return data.trim() as T;
    }

    return data;
  }
}

// ====================================================
// 专用验证函数 - 针对特定数据类型的便捷函数
// ====================================================

const validator = DataValidator.getInstance();

/**
 * 验证视频任务数据
 */
export const validateVideoTask = (data: unknown): ValidationResult<VideoTask> => {
  return validator.validate(VideoTaskSchema, data, { context: 'VideoTask' });
};

/**
 * 验证导入数据
 */
export const validateImportedData = (data: unknown): ValidationResult<ImportedData> => {
  return validator.validate(ImportedDataSchema, data, { context: 'ImportedData' });
};

/**
 * 验证进度更新数据
 */
export const validateProgressUpdate = (data: unknown): ValidationResult<ProgressUpdate> => {
  return validator.validate(ProgressUpdateSchema, data, { context: 'ProgressUpdate' });
};

/**
 * 验证下载配置
 */
export const validateDownloadConfig = (data: unknown): ValidationResult<DownloadConfig> => {
  return validator.validate(DownloadConfigSchema, data, { context: 'DownloadConfig' });
};

/**
 * 验证应用配置
 */
export const validateAppConfig = (data: unknown): ValidationResult<AppConfig> => {
  return validator.validate(AppConfigSchema, data, { context: 'AppConfig' });
};

/**
 * 验证API响应数据
 */
export const validateApiResponse = <T>(
  data: unknown,
  dataSchema?: z.ZodTypeAny
): ValidationResult<ApiResponse<T>> => {
  const schema = dataSchema ? createApiResponseSchema(dataSchema) : ApiResponseSchema;
  const result = validator.validate(schema as z.ZodTypeAny, data, { context: 'ApiResponse' });
  return result as ValidationResult<ApiResponse<T>>;
};

/**
 * 验证任务创建请求
 */
export const validateCreateTaskRequest = (data: unknown) => {
  return validator.validate(CreateTaskRequestSchema, data, { context: 'CreateTaskRequest' });
};

/**
 * 验证任务更新请求
 */
export const validateUpdateTaskRequest = (data: unknown) => {
  return validator.validate(UpdateTaskRequestSchema, data, { context: 'UpdateTaskRequest' });
};

/**
 * 验证批量操作请求
 */
export const validateBatchOperationRequest = (data: unknown) => {
  return validator.validate(BatchOperationRequestSchema, data, {
    context: 'BatchOperationRequest',
  });
};

// ====================================================
// 批量验证的专用函数
// ====================================================

/**
 * 批量验证视频任务列表
 */
export const validateVideoTaskList = (
  tasks: unknown[],
  options?: { stopOnFirstError?: boolean }
): BatchValidationResult<VideoTask> => {
  return validator.validateBatch(VideoTaskSchema, tasks, {
    ...options,
    context: 'VideoTaskList',
  });
};

/**
 * 批量验证导入数据列表
 */
export const validateImportDataList = (
  data: unknown[],
  options?: { stopOnFirstError?: boolean }
): BatchValidationResult<ImportedData> => {
  return validator.validateBatch(ImportedDataSchema, data, {
    ...options,
    context: 'ImportDataList',
  });
};

// ====================================================
// 数据转换和标准化函数
// ====================================================

/**
 * 标准化导入数据 - 将旧格式转换为新格式
 */
export const normalizeImportedData = (data: any): ImportedData => {
  const normalizeString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const normalized: ImportedData = {};

  // 优先使用新格式，回退到旧格式
  normalized.zl_id = normalizeString(data.zl_id) || normalizeString(data.id);
  normalized.zl_name = normalizeString(data.zl_name) || normalizeString(data.name);
  normalized.record_url = normalizeString(data.record_url) || normalizeString(data.url);
  normalized.kc_id = normalizeString(data.kc_id) || normalizeString(data.course_id);
  normalized.kc_name = normalizeString(data.kc_name) || normalizeString(data.course_name);

  // 保留原始字段以支持向后兼容
  if (normalizeString(data.id) && !normalized.zl_id) normalized.id = normalizeString(data.id);
  if (normalizeString(data.name) && !normalized.zl_name)
    normalized.name = normalizeString(data.name);
  if (normalizeString(data.url) && !normalized.record_url)
    normalized.url = normalizeString(data.url);
  if (normalizeString(data.course_id) && !normalized.kc_id) {
    normalized.course_id = normalizeString(data.course_id);
  }
  if (normalizeString(data.course_name) && !normalized.kc_name) {
    normalized.course_name = normalizeString(data.course_name);
  }

  return normalized;
};

/**
 * 创建任务数据标准化
 */
export const normalizeTaskData = (data: any): Partial<VideoTask> => {
  const normalizedVideoInfo = data.video_info ? normalizeImportedData(data.video_info) : undefined;
  const hasVideoInfo =
    normalizedVideoInfo && Object.values(normalizedVideoInfo).some(value => value !== undefined);
  return {
    id: data.id || generateTaskId(),
    url: data.url?.trim(),
    title: data.title?.trim() || extractTitleFromUrl(data.url),
    output_path: data.output_path?.trim(),
    status: data.status || 'pending',
    progress: Number(data.progress) || 0,
    downloaded_size: Number(data.downloaded_size) || 0,
    speed: Number(data.speed) || 0,
    created_at: data.created_at || new Date().toISOString(),
    updated_at: data.updated_at || new Date().toISOString(),
    video_info: hasVideoInfo ? normalizedVideoInfo : undefined,
  };
};

// ====================================================
// 辅助工具函数
// ====================================================

/**
 * 生成任务ID
 */
const generateTaskId = (): string => {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 从URL提取标题
 */
const extractTitleFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/');
    const lastSegment = segments[segments.length - 1];
    return lastSegment || `video_${Date.now()}`;
  } catch {
    return `video_${Date.now()}`;
  }
};

/**
 * 数据完整性检查
 */
export const checkDataIntegrity = (
  data: VideoTask[]
): {
  duplicates: string[];
  orphaned: string[];
  corrupted: string[];
} => {
  const duplicates: string[] = [];
  const orphaned: string[] = [];
  const corrupted: string[] = [];
  const seenIds = new Set<string>();

  data.forEach(task => {
    // 检查重复ID
    if (seenIds.has(task.id)) {
      duplicates.push(task.id);
    } else {
      seenIds.add(task.id);
    }

    // 检查数据完整性
    if (!task.url || !task.title) {
      corrupted.push(task.id);
    }

    // 检查孤立任务 (可以根据业务逻辑扩展)
    if (task.status === 'downloading' && !task.speed) {
      orphaned.push(task.id);
    }
  });

  return { duplicates, orphaned, corrupted };
};

/**
 * 性能监控的验证统计
 */
export const createValidationStats = () => {
  let totalValidations = 0;
  let successfulValidations = 0;
  let failedValidations = 0;
  let totalValidationTime = 0;

  return {
    recordValidation: (success: boolean, duration: number) => {
      totalValidations++;
      if (success) {
        successfulValidations++;
      } else {
        failedValidations++;
      }
      totalValidationTime += duration;
    },

    getStats: () => ({
      total: totalValidations,
      successful: successfulValidations,
      failed: failedValidations,
      successRate: totalValidations > 0 ? successfulValidations / totalValidations : 0,
      averageDuration: totalValidations > 0 ? totalValidationTime / totalValidations : 0,
    }),

    reset: () => {
      totalValidations = 0;
      successfulValidations = 0;
      failedValidations = 0;
      totalValidationTime = 0;
    },
  };
};

// ====================================================
// 默认导出
// ====================================================

export default {
  DataValidator,
  validateVideoTask,
  validateImportedData,
  validateProgressUpdate,
  validateDownloadConfig,
  validateAppConfig,
  validateApiResponse,
  validateVideoTaskList,
  validateImportDataList,
  normalizeImportedData,
  normalizeTaskData,
  checkDataIntegrity,
  createValidationStats,
};
