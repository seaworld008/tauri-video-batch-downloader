/**
 * i18n Integration Tests
 * Focus on live i18n context + selector interaction, without depending on removed legacy views.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupDefaultMocks } from '../setup/integration.setup';
import { LanguageSelector } from '../../components/Common/LanguageSelector';
import { useLanguage, useI18n } from '../../i18n/hooks';
import i18n from '../../i18n';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

describe('i18n Integration Tests', () => {
  beforeEach(() => {
    setupDefaultMocks();
    void i18n.changeLanguage('en');
  });

  describe('LanguageSelector Integration', () => {
    it('should switch sibling translated content from English to Chinese', async () => {
      const IntegratedComponent = () => {
        const { t } = useI18n();

        return (
          <TestWrapper>
            <div>
              <LanguageSelector />
              <div data-testid='loading-text'>{t('common.loading')}</div>
              <div data-testid='error-text'>{t('common.error')}</div>
            </div>
          </TestWrapper>
        );
      };

      render(<IntegratedComponent />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /English/i })).toBeInTheDocument();
        expect(screen.getByTestId('loading-text')).toHaveTextContent('Loading...');
        expect(screen.getByTestId('error-text')).toHaveTextContent('Error');
      });

      fireEvent.click(screen.getByRole('button', { name: /English/i }));

      await waitFor(() => {
        fireEvent.click(screen.getByText('中文'));
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /中文/ })).toBeInTheDocument();
        expect(screen.getByTestId('loading-text')).toHaveTextContent('加载中...');
        expect(screen.getByTestId('error-text')).toHaveTextContent('错误');
      });
    });

    it('should persist language changes across re-renders', async () => {
      const TestComponent = () => {
        const { currentLanguage } = useLanguage();
        const { t } = useI18n();

        return (
          <TestWrapper>
            <div>
              <LanguageSelector />
              <span data-testid='current-language'>{currentLanguage}</span>
              <div data-testid='cancel-text'>{t('common.cancel')}</div>
            </div>
          </TestWrapper>
        );
      };

      const result = render(<TestComponent />);

      fireEvent.click(screen.getByRole('button', { name: /English/i }));

      await waitFor(() => {
        fireEvent.click(screen.getByText('中文'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('current-language')).toHaveTextContent('zh');
        expect(screen.getByTestId('cancel-text')).toHaveTextContent('取消');
      });

      result.rerender(<TestComponent />);

      await waitFor(() => {
        expect(screen.getByTestId('current-language')).toHaveTextContent('zh');
        expect(screen.getByTestId('cancel-text')).toHaveTextContent('取消');
      });
    });
  });

  describe('Translation Context Integration', () => {
    it('should provide consistent translations for plain hook consumers', async () => {
      const MultiComponentTest = () => {
        const { t } = useI18n();
        const { changeLanguage } = useLanguage();

        return (
          <TestWrapper>
            <div>
              <button onClick={() => void changeLanguage('zh')} data-testid='lang-button'>
                {t('common.cancel')}
              </button>
              <div data-testid='loading-text'>{t('common.loading')}</div>
              <div data-testid='error-text'>{t('common.error')}</div>
            </div>
          </TestWrapper>
        );
      };

      render(<MultiComponentTest />);

      await waitFor(() => {
        expect(screen.getByTestId('loading-text')).toHaveTextContent('Loading...');
        expect(screen.getByTestId('error-text')).toHaveTextContent('Error');
        expect(screen.getByTestId('lang-button')).toHaveTextContent('Cancel');
      });

      fireEvent.click(screen.getByTestId('lang-button'));

      await waitFor(() => {
        expect(screen.getByTestId('loading-text')).toHaveTextContent('加载中...');
        expect(screen.getByTestId('error-text')).toHaveTextContent('错误');
        expect(screen.getByTestId('lang-button')).toHaveTextContent('取消');
      });
    });

    it('should handle translation parameters correctly', async () => {
      const ParameterTest = () => {
        const { t } = useI18n();
        const { changeLanguage } = useLanguage();

        return (
          <TestWrapper>
            <div>
              <button onClick={() => void changeLanguage('zh')} data-testid='change-lang'>
                Change Language
              </button>
              <div data-testid='task-count'>{t('downloads.preview.taskCount', { count: 5 })}</div>
              <div data-testid='percentage'>{t('formats.percentage', { value: 75.5 })}</div>
            </div>
          </TestWrapper>
        );
      };

      render(<ParameterTest />);

      await waitFor(() => {
        expect(screen.getByTestId('task-count')).toHaveTextContent('5 tasks to import');
        expect(screen.getByTestId('percentage')).toHaveTextContent('75.5%');
      });

      fireEvent.click(screen.getByTestId('change-lang'));

      await waitFor(() => {
        expect(screen.getByTestId('task-count')).toHaveTextContent('将导入 5 个任务');
        expect(screen.getByTestId('percentage')).toHaveTextContent('75.5%');
      });
    });
  });

  describe('Error Handling', () => {
    it('should gracefully handle missing translation keys', async () => {
      const ErrorHandlingTest = () => {
        const { t } = useI18n();

        return (
          <TestWrapper>
            <div data-testid='missing-key'>{t('nonexistent.translation.key' as never)}</div>
          </TestWrapper>
        );
      };

      render(<ErrorHandlingTest />);

      await waitFor(() => {
        expect(screen.getByTestId('missing-key')).toHaveTextContent('nonexistent.translation.key');
      });
    });
  });
});
