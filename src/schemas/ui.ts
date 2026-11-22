import { z } from 'zod';
import { FormFieldTypeSchema, ModalTypeSchema, NotificationTypeSchema } from './enums';

const VoidFunctionSchema = z.custom<() => void>(val => typeof val === 'function', {
  message: 'Expected a function',
});

const AsyncVoidFunctionSchema = z.custom<() => void | Promise<void>>(
  val => typeof val === 'function',
  {
    message: 'Expected a function',
  }
);

export const NotificationActionSchema = z.object({
  label: z.string().min(1),
  action: VoidFunctionSchema,
  style: z.enum(['primary', 'secondary']).optional(),
});

export const NotificationSchema = z.object({
  id: z.string().min(1),
  type: NotificationTypeSchema,
  title: z.string().min(1),
  message: z.string(),
  timestamp: z.number().nonnegative(),
  duration: z.number().positive().optional(),
  actions: z.array(NotificationActionSchema).optional(),
});

export const ModalOptionsSchema = z.object({
  type: ModalTypeSchema,
  title: z.string().min(1),
  message: z.string().optional(),
  confirmText: z.string().optional(),
  cancelText: z.string().optional(),
  onConfirm: AsyncVoidFunctionSchema.optional(),
  onCancel: VoidFunctionSchema.optional(),
  customContent: z.any().optional(),
});

export const FormFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: FormFieldTypeSchema,
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  validation: z.any().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.any(),
      })
    )
    .optional(),
  description: z.string().optional(),
});

export const KeyboardShortcutSchema = z.object({
  key: z.string().min(1),
  ctrlKey: z.boolean().optional(),
  altKey: z.boolean().optional(),
  shiftKey: z.boolean().optional(),
  metaKey: z.boolean().optional(),
  action: VoidFunctionSchema,
  description: z.string().min(1),
});

export type NotificationAction = z.infer<typeof NotificationActionSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type ModalOptions = z.infer<typeof ModalOptionsSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;
export type KeyboardShortcut = z.infer<typeof KeyboardShortcutSchema>;
