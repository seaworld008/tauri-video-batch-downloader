/**
 * TypeScript declarations for i18next
 * Provides type safety for translation keys
 */

import { TranslationResources } from './index';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: TranslationResources;
    };
    returnNull: false;
  }
}

// Helper types for translation keys
export type TranslationKey = keyof TranslationResources;
export type NestedTranslationKey<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedTranslationKey<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

export type AllTranslationKeys = NestedTranslationKey<TranslationResources>;

// Language change event types
export interface LanguageChangeEvent {
  language: string;
  previousLanguage: string;
}

// Translation parameters type
export interface TranslationParams {
  [key: string]: string | number | boolean | Date;
}

// Pluralization options
export interface PluralOptions {
  count: number;
  [key: string]: any;
}
