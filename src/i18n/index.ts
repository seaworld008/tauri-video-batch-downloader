/**
 * i18n Configuration for Video Downloader Pro
 * Provides internationalization support with TypeScript types
 */
import i18n, { type InitOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import en from './locales/en.json';
import zh from './locales/zh.json';

// Define supported languages
export const SUPPORTED_LANGUAGES = {
  en: 'English',
  zh: '中文'
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// Define translation resources type
export type TranslationResources = typeof en;

// Language detection configuration
const detectionOptions = {
  // Order of language detection methods
  order: [
    'localStorage',
    'navigator',
    'htmlTag',
    'path',
    'subdomain'
  ],
  
  // Keys to look up language from
  lookupLocalStorage: 'video-downloader-language',
  lookupFromPathIndex: 0,
  lookupFromSubdomainIndex: 0,

  // Cache the detected language
  caches: ['localStorage'],

  // Exclude certain languages from detection
  excludeCacheFor: ['cimode'],

  // Only detect languages that we actually have translations for
  checkWhitelist: true
};

const initOptions: InitOptions = {
  resources: {
    en: {
      translation: en,
    },
    zh: {
      translation: zh,
    },
  },
  detection: detectionOptions,
  fallbackLng: 'en',
  supportedLngs: Object.keys(SUPPORTED_LANGUAGES),
  defaultNS: 'translation',
  ns: ['translation'],
  keySeparator: '.',
  interpolation: {
    escapeValue: false,
    format: (value: any, format?: string, lng?: string): string => {
      if (format === 'number' && typeof value === 'number') {
        return new Intl.NumberFormat(lng).format(value);
      }

      if (format === 'currency' && typeof value === 'number') {
        return new Intl.NumberFormat(lng, {
          style: 'currency',
          currency: 'USD',
        }).format(value);
      }

      if (format === 'date' && value instanceof Date) {
        return new Intl.DateTimeFormat(lng).format(value);
      }

      if (format === 'time' && value instanceof Date) {
        return new Intl.DateTimeFormat(lng, {
          hour: '2-digit',
          minute: '2-digit',
        }).format(value);
      }

      return value as string;
    },
  },
  react: {
    useSuspense: false,
    transSupportBasicHtmlNodes: true,
    transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'em', 'span'],
  },
  debug: process.env.NODE_ENV === 'development',
  initImmediate: false,
  load: 'languageOnly',
  preload: Object.keys(SUPPORTED_LANGUAGES),
  missingKeyHandler: (lng: string[], ns: string, key: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Missing translation key: ${key} for language: ${lng[0]}`);
    }
  },
  saveMissing: process.env.NODE_ENV === 'development',
};

// i18n configuration
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init(initOptions);

export default i18n;