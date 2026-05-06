import { z } from 'zod';

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

export const ApiResponseSchema = createApiResponseSchema(z.any());

export const AppErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.any().optional(),
  timestamp: z.number().nonnegative(),
});

export type ApiResponse<T = any> = z.infer<
  ReturnType<typeof createApiResponseSchema<z.ZodType<T>>>
>;
export type AppError = z.infer<typeof AppErrorSchema>;
