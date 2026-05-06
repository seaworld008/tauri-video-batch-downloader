import { z } from 'zod';
import { TaskStatusSchema } from './enums';
import { applyVideoTaskValidations, VideoTaskBaseSchema } from './tasks';

export const CreateTaskRequestSchema = applyVideoTaskValidations(
  VideoTaskBaseSchema.omit({
    id: true,
    status: true,
    created_at: true,
    updated_at: true,
  }).extend({
    status: TaskStatusSchema.optional(),
  })
);

export const UpdateTaskRequestSchema = applyVideoTaskValidations(
  VideoTaskBaseSchema.partial().extend({
    id: z.string().min(1),
  })
);

export const BatchOperationRequestSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, '至少需要选择一个任务'),
  operation: z.enum(['start', 'pause', 'resume', 'cancel', 'delete']),
  options: z.record(z.string(), z.any()).optional(),
});
