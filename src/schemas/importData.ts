import { z } from 'zod';

export const ImportedDataSchema = z
  .object({
    zl_id: z.string().optional(),
    zl_name: z.string().optional(),
    record_url: z.string().optional(),
    kc_id: z.string().optional(),
    kc_name: z.string().optional(),

    id: z.string().optional(),
    name: z.string().optional(),
    url: z.string().optional(),
    course_id: z.string().optional(),
    course_name: z.string().optional(),
  })
  .refine(
    data => {
      const validUrl = data.record_url || data.url;
      if (!validUrl) {
        return false;
      }

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

export const EncodingDetectionSchema = z.object({
  encoding: z.string().min(1),
  confidence: z.number().min(0).max(1),
  language: z.string().optional(),
});

export const ImportPreviewSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  total_rows: z.number().nonnegative(),
  encoding: z.string().min(1),
  field_mapping: z.record(z.string(), z.string()),
});

export type ImportedData = z.infer<typeof ImportedDataSchema>;
export type EncodingDetection = z.infer<typeof EncodingDetectionSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
