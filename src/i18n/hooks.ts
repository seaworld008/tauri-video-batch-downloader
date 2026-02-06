import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { SUPPORTED_LANGUAGES, SupportedLanguage } from './index';
import type { AllTranslationKeys, PluralOptions, TranslationParams } from './types';

const LANGUAGE_STORAGE_KEY = 'video-downloader-language';
const fallbackTranslationMessage = 'Translation missing';
type SafeSupportedLanguage = SupportedLanguage | (string & {});

type TranslationKeyArg = AllTranslationKeys | `translation:${AllTranslationKeys}` | string;

type TranslationParamsArg = TranslationParams | PluralOptions | undefined;

type SafeTranslator = (key: TranslationKeyArg, params?: TranslationParamsArg) => string;

export const useI18n = () => {
  const { t, i18n: i18nInstance, ready } = useTranslation();

  const changeLanguage = React.useCallback(
    (lng: SafeSupportedLanguage) => i18nInstance.changeLanguage(lng),
    [i18nInstance]
  );

  return {
    t: t as unknown as SafeTranslator,
    i18n: i18nInstance,
    ready,
    language: i18nInstance.language,
    changeLanguage,
  };
};

/**
 * Hook for language management
 */
export const useLanguage = () => {
  const initialLanguage = (i18n.language as SupportedLanguage) ?? 'en';
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>(initialLanguage);
  const [isChanging, setIsChanging] = useState(false);

  const changeLanguage = React.useCallback(
    async (language: SupportedLanguage) => {
      if (language === currentLanguage) return;

      setIsChanging(true);
      try {
        await i18n.changeLanguage(language);
        setCurrentLanguage(language);

        localStorage.setItem(LANGUAGE_STORAGE_KEY, language);

        window.dispatchEvent(
          new CustomEvent('languageChanged', {
            detail: {
              language,
              previousLanguage: currentLanguage,
            },
          })
        );
      } catch (error) {
        console.error('Failed to change language:', error);
      } finally {
        setIsChanging(false);
      }
    },
    [currentLanguage]
  );

  useEffect(() => {
    const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (savedLanguage && Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, savedLanguage)) {
      setCurrentLanguage(savedLanguage as SupportedLanguage);
    }
  }, []);

  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      if (Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, lng)) {
        setCurrentLanguage(lng as SupportedLanguage);
      }
    };

    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, []);

  return {
    currentLanguage,
    availableLanguages: SUPPORTED_LANGUAGES,
    changeLanguage,
    isChanging,
    isSupported: (lang: string): lang is SupportedLanguage =>
      Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, lang),
  };
};

/**
 * Hook for formatted translations
 */
export const useFormattedTranslation = () => {
  const { t } = useI18n();

  const formatBytes = React.useCallback(
    (bytes: number): string => {
      if (bytes === 0) return '0 B';

      const k = 1024;
      const sizes = ['bytes', 'kilobytes', 'megabytes', 'gigabytes'] as const;
      const index = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
      const value = (bytes / Math.pow(k, index)).toFixed(1);

      return t(`formats.${sizes[index]}`, { value });
    },
    [t]
  );

  const formatSpeed = React.useCallback(
    (bytesPerSecond: number): string => {
      const formattedBytes = formatBytes(bytesPerSecond);
      return t('formats.speed', { value: formattedBytes });
    },
    [t, formatBytes]
  );

  const formatTimeRemaining = React.useCallback(
    (seconds: number): string => {
      if (seconds < 60) return t('formats.timeRemaining', { time: `${seconds}s` });
      if (seconds < 3600)
        return t('formats.timeRemaining', { time: `${Math.floor(seconds / 60)}m` });

      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return t('formats.timeRemaining', { time: `${hours}h ${minutes}m` });
    },
    [t]
  );

  const formatPercentage = React.useCallback(
    (value: number): string => {
      return t('formats.percentage', { value: value.toFixed(1) });
    },
    [t]
  );

  return {
    t,
    formatBytes,
    formatSpeed,
    formatTimeRemaining,
    formatPercentage,
  };
};

/**
 * Hook for translation with fallback
 */
export const useSafeTranslation = (fallback: string = fallbackTranslationMessage) => {
  const { t, ready } = useI18n();

  const safeT: SafeTranslator = React.useCallback(
    (key: TranslationKeyArg, params?: TranslationParamsArg) => {
      if (!ready) return fallback;

      try {
        const result = t(key, params);
        if (result === key) {
          return fallback;
        }
        return (result as string) || fallback;
      } catch (error) {
        console.warn(`Translation error for key "${String(key)}":`, error);
        return fallback;
      }
    },
    [t, ready, fallback]
  );

  return {
    t: safeT,
    ready,
  };
};

/**
 * Hook for language-aware number formatting
 */
export const useNumberFormat = () => {
  const { currentLanguage } = useLanguage();

  const formatNumber = React.useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => {
      return new Intl.NumberFormat(currentLanguage, options).format(value);
    },
    [currentLanguage]
  );

  const formatCurrency = React.useCallback(
    (value: number, currency: string = 'USD') => {
      return new Intl.NumberFormat(currentLanguage, {
        style: 'currency',
        currency,
      }).format(value);
    },
    [currentLanguage]
  );

  const formatPercent = React.useCallback(
    (value: number) => {
      return new Intl.NumberFormat(currentLanguage, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value / 100);
    },
    [currentLanguage]
  );

  return {
    formatNumber,
    formatCurrency,
    formatPercent,
  };
};

/**
 * Hook for language-aware date formatting
 */
export const useDateFormat = () => {
  const { currentLanguage } = useLanguage();

  const formatDate = React.useCallback(
    (date: Date, options?: Intl.DateTimeFormatOptions) => {
      return new Intl.DateTimeFormat(currentLanguage, options).format(date);
    },
    [currentLanguage]
  );

  const formatTime = React.useCallback(
    (date: Date, options?: Intl.DateTimeFormatOptions) => {
      const defaultOptions: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        ...options,
      };
      return new Intl.DateTimeFormat(currentLanguage, defaultOptions).format(date);
    },
    [currentLanguage]
  );

  const formatDateTime = React.useCallback(
    (date: Date) => {
      return new Intl.DateTimeFormat(currentLanguage, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    },
    [currentLanguage]
  );

  const formatRelativeTime = React.useCallback(
    (date: Date) => {
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

      const rtf = new Intl.RelativeTimeFormat(currentLanguage, { numeric: 'auto' });

      if (Math.abs(diffInSeconds) < 60) {
        return rtf.format(-diffInSeconds, 'second');
      }
      if (Math.abs(diffInSeconds) < 3600) {
        return rtf.format(-Math.floor(diffInSeconds / 60), 'minute');
      }
      if (Math.abs(diffInSeconds) < 86400) {
        return rtf.format(-Math.floor(diffInSeconds / 3600), 'hour');
      }
      return rtf.format(-Math.floor(diffInSeconds / 86400), 'day');
    },
    [currentLanguage]
  );

  return {
    formatDate,
    formatTime,
    formatDateTime,
    formatRelativeTime,
  };
};
