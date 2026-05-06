import { z } from 'zod';
import { DownloaderTypeSchema, TaskStatusSchema } from './enums';

export const DateRangeSchema = z
  .object({
    start: z.date(),
    end: z.date(),
  })
  .refine(data => data.start <= data.end, {
    message: '开始日期不能晚于结束日期',
  });

export const FilterOptionsSchema = z.object({
  status: z.array(TaskStatusSchema).optional(),
  downloader_type: z.array(DownloaderTypeSchema).optional(),
  date_range: DateRangeSchema.optional(),
  search_query: z.string().optional(),
});

export const SortOptionsSchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']),
});

export const PaginationOptionsSchema = z
  .object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(1000),
    total: z.number().int().nonnegative(),
  })
  .refine(
    data => {
      const totalPages = Math.ceil(data.total / data.limit);
      return data.page <= totalPages || totalPages === 0;
    },
    {
      message: '页码超出有效范围',
    }
  );

export type DateRange = z.infer<typeof DateRangeSchema>;
export type FilterOptions = z.infer<typeof FilterOptionsSchema>;
export type SortOptions = z.infer<typeof SortOptionsSchema>;
export type PaginationOptions = z.infer<typeof PaginationOptionsSchema>;
