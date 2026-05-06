import { z } from 'zod';
import { safeParse } from '../schemas';
import { AppErrorHandler } from './errorHandler';
import { reportFrontendIssue } from './frontendLogging';

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  sanitizedData?: T;
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
    reportFrontendIssue('error', `data_validator:validation_failed:${context}`, {
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
