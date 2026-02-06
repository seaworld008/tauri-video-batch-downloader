import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/tauri';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import { initializeProgressListener } from './stores/downloadStore';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import './i18n'; // Initialize i18n system
import './styles/index.css';

const safeStringify = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack || value.message || value.toString();
  }

  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object Object]';
    }
  }

  return String(value);
};

const localLoggingEnabled = Boolean(
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_LOCAL_LOGGING === 'true'
);

const logFrontendEvent = (level: 'info' | 'warn' | 'error', message: string) => {
  if (!localLoggingEnabled) {
    return;
  }

  const truncated = message.length > 4000 ? `${message.slice(0, 4000)}...` : message;

  invoke('log_frontend_event', { level, message: truncated }).catch(() => {
    // Ignore logging failures to avoid recursive error loops
  });
};

if (localLoggingEnabled && typeof window !== 'undefined') {
  window.addEventListener('error', event => {
    const message = event?.error ? safeStringify(event.error) : event?.message || 'Unknown error';
    logFrontendEvent('error', message);
  });

  window.addEventListener('unhandledrejection', event => {
    const message = safeStringify(event.reason ?? 'Unknown reason');
    logFrontendEvent('error', `Unhandled rejection: ${message}`);
  });

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args.map(safeStringify).join(' ');
    logFrontendEvent('error', message);
    originalConsoleError.apply(console, args as any);
  };
}

logFrontendEvent('info', 'frontend_bootstrap');

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

// 初始化进度监听器
void initializeProgressListener();

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
