import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import {
  reportFrontendEventIfEnabled,
  safeStringify,
} from './utils/frontendLogging';
import './i18n'; // Initialize i18n system
import './styles/index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('error', event => {
    const message = event?.error ? safeStringify(event.error) : event?.message || 'Unknown error';
    reportFrontendEventIfEnabled({ level: 'error', message });
  });

  window.addEventListener('unhandledrejection', event => {
    const message = safeStringify(event.reason ?? 'Unknown reason');
    reportFrontendEventIfEnabled({ level: 'error', message: `Unhandled rejection: ${message}` });
  });
}

reportFrontendEventIfEnabled({ level: 'info', message: 'frontend_bootstrap' });

// React Query 客户端配置
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

// 渲染应用
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <App />
          {typeof import.meta !== 'undefined' && import.meta.env?.DEV && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
