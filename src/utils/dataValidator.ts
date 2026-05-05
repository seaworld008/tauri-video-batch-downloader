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
  createApiResponseSchema,
} from '../schemas';
import type {
  VideoTask,
  ImportedData,
  ProgressUpdate,
  DownloadConfig,
  AppConfig,
  ApiResponse,
} from '../schemas';
export {
  DataValidator,
  type BatchValidationResult,
  type ValidationError,
  type ValidationResult,
} from './dataValidationCore';
export { normalizeImportedData, normalizeTaskData } from './dataNormalization';
export { checkDataIntegrity, createValidationStats } from './dataIntegrity';
import { DataValidator, type BatchValidationResult, type ValidationResult } from './dataValidationCore';
import { normalizeImportedData, normalizeTaskData } from './dataNormalization';
import { checkDataIntegrity, createValidationStats } from './dataIntegrity';

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
