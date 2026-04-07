/**
 * i18n System Tests
 * Tests for internationalization functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import i18n from '../../i18n';
import {
  useI18n,
  useLanguage,
  useFormattedTranslation,
  useSafeTranslation,
  useNumberFormat,
  useDateFormat,
} from '../../i18n/hooks';
import { LanguageSelector } from '../../components/Common/LanguageSelector';
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../i18n';

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// Mock window.dispatchEvent
const mockDispatchEvent = vi.fn();
Object.defineProperty(window, 'dispatchEvent', {
  value: mockDispatchEvent,
});

// Test wrapper component
const tAny = i18n.t.bind(i18n) as (key: string, options?: any) => string;
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div>{children}</div>;
};

describe('i18n System', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
    await i18n.changeLanguage('en');
  });

  describe('Basic i18n Configuration', () => {
    it('should initialize with English as default language', () => {
      expect(i18n.language).toBe('en');
      expect(i18n.isInitialized).toBe(true);
    });

    it('should have all supported languages configured', () => {
      const resources = i18n.options.resources;
      expect(resources).toHaveProperty('en');
      expect(resources).toHaveProperty('zh');
    });

    it('should support language detection', () => {
      expect(i18n.options.detection).toBeDefined();
      expect(i18n.options.detection?.order).toContain('localStorage');
    });
  });

  describe('Translation Keys', () => {
    it('should translate common keys in English', () => {
      i18n.changeLanguage('en');

      expect(tAny('common.loading' as any)).toBe('Loading...');
      expect(tAny('common.error' as any)).toBe('Error');
      expect(tAny('common.success' as any)).toBe('Success');
      expect(tAny('common.cancel' as any)).toBe('Cancel');
    });

    it('should translate common keys in Chinese', async () => {
      await i18n.changeLanguage('zh');

      expect(tAny('common.loading' as any)).toBe('加载中...');
      expect(tAny('common.error' as any)).toBe('错误');
      expect(tAny('common.success' as any)).toBe('成功');
      expect(tAny('common.cancel' as any)).toBe('取消');
    });

    it('should handle nested translation keys', () => {
      expect(tAny('downloads.stats.totalTasks')).toBe('Total Tasks');
      expect(tAny('settings.download.concurrentDownloads')).toBe('Concurrent Downloads');
    });

    it('should handle interpolation', () => {
      expect(tAny('downloads.preview.taskCount', { count: 5 })).toBe('5 tasks to import');
      expect(tAny('formats.percentage', { value: 75.5 })).toBe('75.5%');
    });

    it('should fallback to English for missing keys', async () => {
      await i18n.changeLanguage('zh');
      expect(tAny('nonexistent.key')).toBe('nonexistent.key');
    });
  });

  describe('useI18n Hook', () => {
    it('should provide translation function and language info', () => {
      const { result } = renderHook(() => useI18n(), {
        wrapper: TestWrapper,
      });

      expect(result.current.t).toBeInstanceOf(Function);
      expect(result.current.language).toBe('en');
      expect(result.current.ready).toBe(true);
    });

    it('should translate keys with type safety', () => {
      const { result } = renderHook(() => useI18n(), {
        wrapper: TestWrapper,
      });

      const translation = result.current.t('common.loading' as any);
      expect(translation).toBe('Loading...');
    });

    it('should handle interpolation parameters', () => {
      const { result } = renderHook(() => useI18n(), {
        wrapper: TestWrapper,
      });

      const translation = result.current.t('formats.percentage', { value: 50 });
      expect(translation).toBe('50%');
    });
  });

  describe('useLanguage Hook', () => {
    it('should provide current language and available languages', () => {
      const { result } = renderHook(() => useLanguage(), {
        wrapper: TestWrapper,
      });

      expect(result.current.currentLanguage).toBe('en');
      expect(result.current.availableLanguages).toEqual(SUPPORTED_LANGUAGES);
      expect(result.current.changeLanguage).toBeInstanceOf(Function);
      expect(result.current.isChanging).toBe(false);
    });

    it('should change language and update state', async () => {
      const { result } = renderHook(() => useLanguage(), {
        wrapper: TestWrapper,
      });

      await act(async () => {
        await result.current.changeLanguage('zh');
      });

      expect(result.current.currentLanguage).toBe('zh');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('video-downloader-language', 'zh');
    });

    it('should dispatch language change event', async () => {
      const { result } = renderHook(() => useLanguage(), {
        wrapper: TestWrapper,
      });

      await act(async () => {
        await result.current.changeLanguage('zh');
      });

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'languageChanged',
          detail: {
            language: 'zh',
            previousLanguage: 'en',
          },
        })
      );
    });

    it('should validate supported languages', () => {
      const { result } = renderHook(() => useLanguage(), {
        wrapper: TestWrapper,
      });

      expect(result.current.isSupported('en')).toBe(true);
      expect(result.current.isSupported('zh')).toBe(true);
      expect(result.current.isSupported('fr')).toBe(false);
    });
  });

  describe('useFormattedTranslation Hook', () => {
    it('should format bytes correctly', () => {
      const { result } = renderHook(() => useFormattedTranslation(), {
        wrapper: TestWrapper,
      });

      expect(result.current.formatBytes(0)).toBe('0 B');
      expect(result.current.formatBytes(1024)).toBe('1.0 KB');
      expect(result.current.formatBytes(1048576)).toBe('1.0 MB');
      expect(result.current.formatBytes(1073741824)).toBe('1.0 GB');
    });

    it('should format speed correctly', () => {
      const { result } = renderHook(() => useFormattedTranslation(), {
        wrapper: TestWrapper,
      });

      expect(result.current.formatSpeed(1024)).toBe('1.0 KB/s');
      expect(result.current.formatSpeed(1048576)).toBe('1.0 MB/s');
    });

    it('should format time remaining correctly', () => {
      const { result } = renderHook(() => useFormattedTranslation(), {
        wrapper: TestWrapper,
      });

      expect(result.current.formatTimeRemaining(30)).toBe('30s remaining');
      expect(result.current.formatTimeRemaining(120)).toBe('2m remaining');
      expect(result.current.formatTimeRemaining(3660)).toBe('1h 1m remaining');
    });

    it('should format percentage correctly', () => {
      const { result } = renderHook(() => useFormattedTranslation(), {
        wrapper: TestWrapper,
      });

      expect(result.current.formatPercentage(75.555)).toBe('75.6%');
      expect(result.current.formatPercentage(100)).toBe('100.0%');
    });
  });

  describe('useSafeTranslation Hook', () => {
    it('should provide safe translation with fallback', () => {
      const { result } = renderHook(() => useSafeTranslation('Default fallback'), {
        wrapper: TestWrapper,
      });

      expect(result.current.t('common.loading' as any)).toBe('Loading...');
    });

    it('should return fallback for invalid keys', () => {
      const { result } = renderHook(() => useSafeTranslation('Default fallback'), {
        wrapper: TestWrapper,
      });

      expect(result.current.t('invalid.key' as any)).toBe('Default fallback');
    });
  });

  describe('useNumberFormat Hook', () => {
    it('should format numbers according to locale', () => {
      const { result } = renderHook(() => useNumberFormat(), {
        wrapper: TestWrapper,
      });

      const formatted = result.current.formatNumber(1234567.89);
      expect(formatted).toMatch(/1,234,567\.89|1 234 567,89/); // Different locales format differently
    });

    it('should format currency', () => {
      const { result } = renderHook(() => useNumberFormat(), {
        wrapper: TestWrapper,
      });

      const formatted = result.current.formatCurrency(99.99);
      expect(formatted).toMatch(/\$99\.99|\$\s*99\.99/);
    });

    it('should format percentages', () => {
      const { result } = renderHook(() => useNumberFormat(), {
        wrapper: TestWrapper,
      });

      expect(result.current.formatPercent(75.5)).toMatch(/75\.5\s*%/);
    });
  });

  describe('useDateFormat Hook', () => {
    const testDate = new Date('2023-12-25T15:30:00Z');

    it('should format dates according to locale', () => {
      const { result } = renderHook(() => useDateFormat(), {
        wrapper: TestWrapper,
      });

      const formatted = result.current.formatDate(testDate);
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    it('should format time', () => {
      const { result } = renderHook(() => useDateFormat(), {
        wrapper: TestWrapper,
      });

      const formatted = result.current.formatTime(testDate);
      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should format date and time together', () => {
      const { result } = renderHook(() => useDateFormat(), {
        wrapper: TestWrapper,
      });

      const formatted = result.current.formatDateTime(testDate);
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(10);
    });
  });
});

describe('LanguageSelector Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18n.changeLanguage('en');
  });

  it('should render with default props', () => {
    render(<LanguageSelector />);

    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should show current language flag and name', () => {
    render(<LanguageSelector showName={true} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('🇺🇸');
    expect(button).toHaveTextContent('English');
  });

  it('should open dropdown when clicked', async () => {
    render(<LanguageSelector />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('中文')).toBeInTheDocument();
    });
  });

  it('should change language when option is selected', async () => {
    const TestComponent = () => {
      const { currentLanguage } = useLanguage();
      return (
        <div>
          <LanguageSelector />
          <span data-testid='current-lang'>{currentLanguage}</span>
        </div>
      );
    };

    render(<TestComponent />);

    // Open dropdown
    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Select Chinese
    await waitFor(() => {
      const chineseOption = screen.getByText('中文');
      fireEvent.click(chineseOption);
    });

    // Check that language changed
    await waitFor(() => {
      expect(screen.getByTestId('current-lang')).toHaveTextContent('zh');
    });
  });

  it('should be disabled when prop is set', () => {
    render(<LanguageSelector disabled={true} />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should show loading state', () => {
    render(<LanguageSelector showLoading={true} />);

    // Note: This would need to be tested with a mock that triggers the loading state
    // For now, just check that the component renders without error
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

describe('Integration Tests', () => {
  it('should persist language preference to localStorage', async () => {
    const { result } = renderHook(() => useLanguage(), {
      wrapper: TestWrapper,
    });

    await act(async () => {
      await result.current.changeLanguage('zh');
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('video-downloader-language', 'zh');
  });

  it('should update translations when language changes', async () => {
    // Ensure we start with English
    await i18n.changeLanguage('en');

    const TestComponent = () => {
      const { t } = useI18n();
      const { changeLanguage } = useLanguage();

      return (
        <div>
          <span data-testid='translation'>{t('common.loading' as any)}</span>
          <button onClick={async () => await changeLanguage('zh')}>Change to Chinese</button>
        </div>
      );
    };

    render(<TestComponent />);

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByTestId('translation')).toHaveTextContent('Loading...');
    });

    // Change to Chinese
    fireEvent.click(screen.getByText('Change to Chinese'));

    // Check updated Chinese translation
    await waitFor(
      () => {
        expect(screen.getByTestId('translation')).toHaveTextContent('加载中...');
      },
      { timeout: 3000 }
    );
  });
});
