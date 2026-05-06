import { z } from 'zod';

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
  }

  return {
    success: false,
    errors: result.error.errors,
  };
};

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
