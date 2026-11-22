import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import { reportFrontendEventIfEnabled, safeStringify } from './utils/frontendLogging';
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

// 渲染应用
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
