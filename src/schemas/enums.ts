import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'pending',
  'downloading',
  'committing',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

export const DownloaderTypeSchema = z.preprocess(
  value => (value === 'youtube' ? 'ytdlp' : value),
  z.enum(['http', 'm3u8', 'ytdlp'])
);
export const ViewTypeSchema = z.enum(['dashboard', 'import', 'settings', 'about']);
export const NotificationTypeSchema = z.enum(['success', 'error', 'warning', 'info']);
export const ModalTypeSchema = z.enum(['confirm', 'info', 'warning', 'error', 'custom']);
export const FormFieldTypeSchema = z.enum([
  'text',
  'number',
  'select',
  'checkbox',
  'file',
  'textarea',
]);
export const LogLevelSchema = z.enum(['error', 'warn', 'info', 'debug']);
export const ThemeTypeSchema = z.enum(['light', 'dark', 'system']);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type DownloaderType = z.infer<typeof DownloaderTypeSchema>;
export type ViewType = z.infer<typeof ViewTypeSchema>;
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export type ModalType = z.infer<typeof ModalTypeSchema>;
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type ThemeType = z.infer<typeof ThemeTypeSchema>;
