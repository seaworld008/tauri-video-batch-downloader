/**
 * i18n Integration Tests
 * Tests for internationalization integration with components
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupDefaultMocks } from '../setup/integration.setup';
import { useDownloadStore } from '../../stores/downloadStore';
import { DownloadsView } from '../../components/Downloads/DownloadsView';
import { LanguageSelector } from '../../components/Common/LanguageSelector';
import { useLanguage, useI18n } from '../../i18n/hooks';
import i18n from '../../i18n';

// Test wrapper with all required providers
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
    // Setup default mocks
    setupDefaultMocks();

    // Reset store state
    useDownloadStore.setState({
      tasks: [],
      stats: {
        total_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        active_downloads: 0,
        queue_paused: false,
      },
      isLoading: false,
      filterStatus: 'all',
      searchQuery: '',
      selectedTasks: [],
    });

    // Reset language to English
    i18n.changeLanguage('en');
  });

  describe('DownloadsView Translation Integration', () => {
    it('should display English translations by default', async () => {
      render(
        <TestWrapper>
          <DownloadsView />
        </TestWrapper>
      );

      await waitFor(() => {
        // Check for empty state translations
        expect(screen.getByText('No Download Tasks')).toBeInTheDocument();
        expect(
          screen.getByText(
            "Click 'Import Tasks' in the sidebar to start batch adding download tasks"
          )
        ).toBeInTheDocument();
        expect(screen.getByText('Import Tasks')).toBeInTheDocument();
      });
    });

    it('should switch to Chinese translations', async () => {
      // Create a component that can change language
      const TestComponent = () => {
        const { changeLanguage } = useLanguage();

        return (
          <TestWrapper>
            <div>
              <button onClick={() => changeLanguage('zh')} data-testid='change-language'>
                Change to Chinese
              </button>
              <DownloadsView />
            </div>
          </TestWrapper>
        );
      };

      render(<TestComponent />);

      // Change language to Chinese
      fireEvent.click(screen.getByTestId('change-language'));

      await waitFor(() => {
        // Check for Chinese translations
        expect(screen.getByText('暂无下载任务')).toBeInTheDocument();
        expect(
          screen.getByText('点击左侧导航的「导入任务」开始批量添加下载任务')
        ).toBeInTheDocument();
        expect(screen.getByText('导入任务')).toBeInTheDocument();
      });
    });

    it('should display loading state in current language', async () => {
      // Set loading state
      useDownloadStore.setState({
        isLoading: true,
      });

      const { unmount } = render(
        <TestWrapper>
          <DownloadsView />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Loading...')).toBeInTheDocument();
      });

      unmount();

      // Change to Chinese and check loading translation
      const TestComponent = () => {
        const { changeLanguage } = useLanguage();
        React.useEffect(() => {
          changeLanguage('zh');
        }, [changeLanguage]);

        return (
          <TestWrapper>
            <DownloadsView />
          </TestWrapper>
        );
      };

      render(<TestComponent />);

      await waitFor(() => {
        expect(screen.getByText('加载中...')).toBeInTheDocument();
      });
    });

    it('should handle filtered tasks with translations', async () => {
      // Add some tasks
      useDownloadStore.setState({
        tasks: [
          {
            id: '1',
            url: 'https://example.com/video1.mp4',
            title: 'Test Video 1',
            output_path: '/downloads/video1.mp4',
            status: 'completed',
            progress: 100,
            downloaded_size: 1048576,
            file_size: 1048576,
            speed: 0,
            eta: null,
            error_message: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            downloader_type: 'http',
          },
        ],
        filterStatus: 'pending', // Filter that shows no results
        searchQuery: '',
      });

      const TestComponent = () => {
        const { changeLanguage } = useLanguage();

        return (
          <TestWrapper>
            <div>
              <button onClick={() => changeLanguage('zh')} data-testid='change-language'>
                Change Language
              </button>
              <DownloadsView />
            </div>
          </TestWrapper>
        );
      };

      render(<TestComponent />);

      await waitFor(() => {
        // Should show "no matches" in English
        expect(screen.getByText('No Matching Tasks')).toBeInTheDocument();
      });

      // Change to Chinese
      fireEvent.click(screen.getByTestId('change-language'));

      await waitFor(() => {
        // Should show "no matches" in Chinese
        expect(screen.getByText('没有匹配的任务')).toBeInTheDocument();
      });
    });
  });

  describe('LanguageSelector Integration', () => {
    it('should integrate with DownloadsView language changes', async () => {
      const IntegratedComponent = () => (
        <TestWrapper>
          <div>
            <LanguageSelector />
            <DownloadsView />
          </div>
        </TestWrapper>
      );

      render(<IntegratedComponent />);

      // Check initial English state
      await waitFor(() => {
        expect(screen.getByText('No Download Tasks')).toBeInTheDocument();
        expect(screen.getByText('English')).toBeInTheDocument();
      });

      // Open language selector
      const languageButton = screen.getByRole('button', { name: /English/i });
      fireEvent.click(languageButton);

      // Select Chinese
      await waitFor(() => {
        const chineseOption = screen.getByText('中文');
        fireEvent.click(chineseOption);
      });

      // Verify language change affected both components
      await waitFor(() => {
        expect(screen.getByText('暂无下载任务')).toBeInTheDocument();
        // The button text should now show Chinese is selected
        expect(screen.getByRole('button', { name: /中文/ })).toBeInTheDocument();
      });
    });

    it('should persist language changes across re-renders', async () => {
      let rerender: any;

      const TestComponent = () => {
        const { currentLanguage } = useLanguage();
        return (
          <TestWrapper>
            <div>
              <LanguageSelector />
              <span data-testid='current-language'>{currentLanguage}</span>
              <DownloadsView />
            </div>
          </TestWrapper>
        );
      };

      const result = render(<TestComponent />);
      rerender = result.rerender;

      // Change to Chinese
      const languageButton = screen.getByRole('button', { name: /English/i });
      fireEvent.click(languageButton);

      await waitFor(() => {
        const chineseOption = screen.getByText('中文');
        fireEvent.click(chineseOption);
      });

      // Verify language changed
      await waitFor(() => {
        expect(screen.getByTestId('current-language')).toHaveTextContent('zh');
        expect(screen.getByText('暂无下载任务')).toBeInTheDocument();
      });

      // Re-render component
      rerender(<TestComponent />);

      // Language should persist
      await waitFor(() => {
        expect(screen.getByTestId('current-language')).toHaveTextContent('zh');
        expect(screen.getByText('暂无下载任务')).toBeInTheDocument();
      });
    });
  });

  describe('Translation Context Integration', () => {
    it('should provide consistent translations across all components', async () => {
      const MultiComponentTest = () => {
        const { t } = useI18n();
        const { changeLanguage } = useLanguage();

        return (
          <TestWrapper>
            <div>
              <button onClick={() => changeLanguage('zh')} data-testid='lang-button'>
                {t('common.cancel')}
              </button>
              <div data-testid='loading-text'>{t('common.loading')}</div>
              <div data-testid='error-text'>{t('common.error')}</div>
              <DownloadsView />
            </div>
          </TestWrapper>
        );
      };

      render(<MultiComponentTest />);

      // Check English translations
      await waitFor(() => {
        expect(screen.getByTestId('loading-text')).toHaveTextContent('Loading...');
        expect(screen.getByTestId('error-text')).toHaveTextContent('Error');
        expect(screen.getByTestId('lang-button')).toHaveTextContent('Cancel');
        expect(screen.getByText('No Download Tasks')).toBeInTheDocument();
      });

      // Change to Chinese
      fireEvent.click(screen.getByTestId('lang-button'));

      // Check Chinese translations
      await waitFor(() => {
        expect(screen.getByTestId('loading-text')).toHaveTextContent('加载中...');
        expect(screen.getByTestId('error-text')).toHaveTextContent('错误');
        expect(screen.getByTestId('lang-button')).toHaveTextContent('取消');
        expect(screen.getByText('暂无下载任务')).toBeInTheDocument();
      });
    });

    it('should handle translation parameters correctly', async () => {
      const ParameterTest = () => {
        const { t } = useI18n();
        const { changeLanguage } = useLanguage();

        return (
          <TestWrapper>
            <div>
              <button onClick={() => changeLanguage('zh')} data-testid='change-lang'>
                Change Language
              </button>
              <div data-testid='task-count'>{t('downloads.preview.taskCount', { count: 5 })}</div>
              <div data-testid='percentage'>{t('formats.percentage', { value: 75.5 })}</div>
            </div>
          </TestWrapper>
        );
      };

      render(<ParameterTest />);

      // Check English with parameters
      await waitFor(() => {
        expect(screen.getByTestId('task-count')).toHaveTextContent('5 tasks to import');
        expect(screen.getByTestId('percentage')).toHaveTextContent('75.5%');
      });

      // Change to Chinese
      fireEvent.click(screen.getByTestId('change-lang'));

      // Check Chinese with parameters
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
            <div data-testid='missing-key'>{t('nonexistent.translation.key' as any)}</div>
          </TestWrapper>
        );
      };

      render(<ErrorHandlingTest />);

      await waitFor(() => {
        // Should show the key itself as fallback
        expect(screen.getByTestId('missing-key')).toHaveTextContent('nonexistent.translation.key');
      });
    });

    it('should handle translation errors gracefully', async () => {
      // This would test error boundary integration with i18n
      // For now, we'll just ensure the component doesn't crash
      render(
        <TestWrapper>
          <DownloadsView />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('No Download Tasks')).toBeInTheDocument();
      });
    });
  });
});
