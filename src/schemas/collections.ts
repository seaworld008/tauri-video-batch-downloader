import { z } from 'zod';
import { ImportedDataSchema } from './importData';
import { VideoTaskSchema } from './tasks';
import { NotificationSchema } from './ui';

export const TaskListSchema = z.array(VideoTaskSchema);
export const ImportDataListSchema = z.array(ImportedDataSchema);
export const NotificationListSchema = z.array(NotificationSchema);
