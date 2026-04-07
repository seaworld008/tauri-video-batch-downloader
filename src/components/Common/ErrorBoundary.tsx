/**
 * Error Boundary Component with i18n support
 * Catches and displays application errors with translations
 */

import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useSafeTranslation } from '../../i18n/hooks';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<ErrorFallbackProps>;
}

interface ErrorFallbackProps {
  error?: Error;
  errorInfo?: React.ErrorInfo;
  onRetry: () => void;
  onReload: () => void;
}

// Default error fallback component
const DefaultErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  onRetry,
  onReload,
}) => {
  const { t } = useSafeTranslation('Application Error');

  return (
    <div className='min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4'>
      <div className='max-w-md w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6'>
        {/* Error icon */}
        <div className='flex items-center justify-center w-12 h-12 mx-auto bg-red-100 dark:bg-red-900/20 rounded-full mb-4'>
          <ExclamationTriangleIcon className='w-6 h-6 text-red-600 dark:text-red-400' />
        </div>

        {/* Error title */}
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100 text-center mb-2'>
          {t('errors.systemError')}
        </h2>

        {/* Error description */}
        <p className='text-sm text-gray-600 dark:text-gray-400 text-center mb-4'>
          很抱歉，应用程序遇到了意外错误。请尝试刷新页面或重启应用。
        </p>

        {/* Error details (expandable) */}
        {error && (
          <details className='bg-gray-50 dark:bg-gray-700 rounded p-3 mb-4'>
            <summary className='text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer'>
              错误详情
            </summary>
            <div className='mt-2 space-y-2'>
              <pre className='text-xs text-red-600 dark:text-red-400 overflow-auto whitespace-pre-wrap'>
                {error.message}
              </pre>
              {error.stack && (
                <pre className='text-xs text-gray-500 dark:text-gray-400 overflow-auto whitespace-pre-wrap max-h-32'>
                  {error.stack}
                </pre>
              )}
            </div>
          </details>
        )}

        {/* Action buttons */}
        <div className='flex space-x-3'>
          <button
            onClick={onReload}
            className='flex-1 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium py-2 px-4 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
          >
            刷新页面
          </button>

          <button
            onClick={onRetry}
            className='flex-1 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 text-sm font-medium py-2 px-4 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'
          >
            重试
          </button>
        </div>

        {/* Development mode info */}
        {typeof import.meta !== 'undefined' && import.meta.env?.DEV && (
          <div className='mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md'>
            <p className='text-xs text-yellow-800 dark:text-yellow-200'>
              <strong>Development Mode:</strong> 详细错误信息已显示在控制台中
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Log error details
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);

    // In production, you might want to send this to an error reporting service
    if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) {
      // Example: Send to error monitoring service
      // this.reportError(error, errorInfo);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  private handleReload = () => {
    window.location.reload();
  };

  // Method to report errors to external services
  // private reportError(error: Error, errorInfo: React.ErrorInfo) {
  //   // Implement error reporting logic here
  //   // e.g., send to Sentry, LogRocket, etc.
  // }

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;

      return (
        <FallbackComponent
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
