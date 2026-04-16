/**
 * 统一错误处理工具类
 * 提供一致的错误处理和用户友好的反馈
 */
import toast from 'react-hot-toast';

import { reportFrontendIssue } from './frontendLogging';

export enum ErrorType {
  NETWORK = 'NETWORK',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  BACKEND_ERROR = 'BACKEND_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface AppError {
  type: ErrorType;
  message: string;
  originalError: unknown;
  action: string;
  timestamp: Date;
}

export class AppErrorHandler {
  /**
   * 处理错误的主要方法
   * @param action 执行的操作名称（如"导入文件"、"开始下载"）
   * @param error 原始错误对象
   * @param showToast 是否显示Toast提示（默认true）
   * @returns 格式化后的错误信息
   */
  static handle(action: string, error: unknown, showToast: boolean = true): AppError {
    const appError = this.classifyError(action, error);

    reportFrontendIssue('error', `${action}:failed`, {
      type: appError.type,
      message: appError.message,
      originalError: appError.originalError,
      timestamp: appError.timestamp,
    });

    // 显示用户友好提示
    if (showToast) {
      this.showUserFriendlyMessage(appError);
    }

    return appError;
  }

  /**
   * 分类错误类型
   */
  private static classifyError(action: string, error: unknown): AppError {
    const timestamp = new Date();
    const message = this.extractMessage(error);

    // 网络相关错误
    if (this.isNetworkError(error, message)) {
      return {
        type: ErrorType.NETWORK,
        message: '网络连接失败，请检查网络状态',
        originalError: error,
        action,
        timestamp,
      };
    }

    // 文件相关错误
    if (this.isFileError(error, message)) {
      return {
        type: ErrorType.FILE_NOT_FOUND,
        message: '文件未找到或无法访问，请检查文件路径和权限',
        originalError: error,
        action,
        timestamp,
      };
    }

    // 权限相关错误
    if (this.isPermissionError(error, message)) {
      return {
        type: ErrorType.PERMISSION_ERROR,
        message: '权限不足，请检查文件访问权限',
        originalError: error,
        action,
        timestamp,
      };
    }

    // 超时错误
    if (this.isTimeoutError(error, message)) {
      return {
        type: ErrorType.TIMEOUT_ERROR,
        message: '操作超时，请稍后重试',
        originalError: error,
        action,
        timestamp,
      };
    }

    // 验证错误
    if (this.isValidationError(error, message)) {
      return {
        type: ErrorType.VALIDATION_ERROR,
        message: message.includes('validation') ? message : '数据验证失败，请检查输入',
        originalError: error,
        action,
        timestamp,
      };
    }

    // 后端错误
    if (this.isBackendError(error, message)) {
      return {
        type: ErrorType.BACKEND_ERROR,
        message: `后端服务异常: ${message}`,
        originalError: error,
        action,
        timestamp,
      };
    }

    // 未知错误
    return {
      type: ErrorType.UNKNOWN,
      message: message || '未知错误',
      originalError: error,
      action,
      timestamp,
    };
  }

  /**
   * 显示用户友好的错误提示
   */
  private static showUserFriendlyMessage(appError: AppError): void {
    const { type, message, action } = appError;

    switch (type) {
      case ErrorType.NETWORK:
        toast.error('🌐 网络连接失败，请检查网络状态后重试');
        break;

      case ErrorType.FILE_NOT_FOUND:
        toast.error('📁 文件未找到，请检查文件路径是否正确');
        break;

      case ErrorType.PERMISSION_ERROR:
        toast.error('🔒 权限不足，请检查文件访问权限');
        break;

      case ErrorType.TIMEOUT_ERROR:
        toast.error('⏱️ 操作超时，请稍后重试');
        break;

      case ErrorType.VALIDATION_ERROR:
        toast.error(`📝 数据验证失败: ${message}`);
        break;

      case ErrorType.BACKEND_ERROR:
        toast.error(`⚙️ 后端服务异常: ${message}`);
        break;

      default:
        toast.error(`❌ ${action}失败: ${message}`);
    }
  }

  /**
   * 提取错误消息
   */
  private static extractMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as any).message);
    }

    if (error && typeof error === 'object' && 'error' in error) {
      return String((error as any).error);
    }

    return JSON.stringify(error);
  }

  /**
   * 检查是否为网络错误
   */
  private static isNetworkError(error: unknown, message: string): boolean {
    return (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('NETWORK_ERROR') ||
      message.includes('ERR_NETWORK') ||
      (error instanceof Error && error.name === 'NetworkError')
    );
  }

  /**
   * 检查是否为文件错误
   */
  private static isFileError(error: unknown, message: string): boolean {
    return (
      message.includes('file not found') ||
      message.includes('ENOENT') ||
      message.includes('File not found') ||
      message.includes('path does not exist') ||
      message.includes('No such file')
    );
  }

  /**
   * 检查是否为权限错误
   */
  private static isPermissionError(error: unknown, message: string): boolean {
    return (
      message.includes('permission') ||
      message.includes('EACCES') ||
      message.includes('access denied') ||
      message.includes('unauthorized') ||
      message.includes('EPERM')
    );
  }

  /**
   * 检查是否为超时错误
   */
  private static isTimeoutError(error: unknown, message: string): boolean {
    return (
      message.includes('timeout') ||
      message.includes('TIMEOUT') ||
      message.includes('timed out') ||
      message.includes('ETIMEDOUT')
    );
  }

  /**
   * 检查是否为验证错误
   */
  private static isValidationError(error: unknown, message: string): boolean {
    return (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('required') ||
      message.includes('format') ||
      message.includes('schema')
    );
  }

  /**
   * 检查是否为后端错误
   */
  private static isBackendError(error: unknown, message: string): boolean {
    return (
      message.includes('tauri') ||
      message.includes('command') ||
      message.includes('invoke') ||
      message.includes('backend') ||
      message.includes('rust') ||
      message.includes('Internal server error')
    );
  }

  /**
   * 创建带有重试功能的错误处理
   * @param action 操作名称
   * @param operation 要执行的操作
   * @param maxRetries 最大重试次数（默认3次）
   * @param retryDelay 重试延迟（毫秒，默认1000）
   */
  static async withRetry<T>(
    action: string,
    operation: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        reportFrontendIssue('warn', `${action}:retry`, {
          attempt,
          maxRetries,
          error,
        });

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }
    }

    // 所有重试都失败了，处理错误
    throw this.handle(`${action} (${maxRetries}次重试后)`, lastError, true);
  }

  /**
   * 创建带有超时的错误处理
   * @param action 操作名称
   * @param operation 要执行的操作
   * @param timeoutMs 超时时间（毫秒）
   */
  static async withTimeout<T>(
    action: string,
    operation: () => Promise<T>,
    timeoutMs: number = 30000
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${action} 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } catch (error) {
      throw this.handle(action, error, true);
    }
  }
}

// 导出便捷的错误处理函数
export const handleError = AppErrorHandler.handle.bind(AppErrorHandler);
export const withRetry = AppErrorHandler.withRetry.bind(AppErrorHandler);
export const withTimeout = AppErrorHandler.withTimeout.bind(AppErrorHandler);
