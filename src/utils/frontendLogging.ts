import type { LogFrontendEventOptions } from '../features/downloads/api/systemCommands';
import { logFrontendEventCommand } from '../features/downloads/api/systemCommands';

const MAX_FRONTEND_LOG_MESSAGE_LENGTH = 4000;

export const safeStringify = (value: unknown): string => {
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

export const truncateFrontendLogMessage = (message: string): string =>
  message.length > MAX_FRONTEND_LOG_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_FRONTEND_LOG_MESSAGE_LENGTH)}...`
    : message;

export const isLocalFrontendLoggingEnabled = (): boolean =>
  Boolean(typeof import.meta !== 'undefined' && import.meta.env?.VITE_LOCAL_LOGGING === 'true');

export const reportFrontendEvent = ({ level, message }: LogFrontendEventOptions): void => {
  void logFrontendEventCommand({
    level,
    message: truncateFrontendLogMessage(message),
  }).catch(() => {
    // Ignore logging failures to avoid recursive error loops.
  });
};

export const reportFrontendEventIfEnabled = (options: LogFrontendEventOptions): void => {
  if (!isLocalFrontendLoggingEnabled()) {
    return;
  }

  reportFrontendEvent(options);
};

export const reportFrontendDiagnostic = (
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: unknown
): void => {
  const suffix = detail === undefined ? '' : `:${safeStringify(detail)}`;
  reportFrontendEvent({
    level,
    message: `${message}${suffix}`,
  });
};

export const reportFrontendDiagnosticIfEnabled = (
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: unknown
): void => {
  if (!isLocalFrontendLoggingEnabled()) {
    return;
  }

  reportFrontendDiagnostic(level, message, detail);
};

export const reportFrontendIssue = (
  level: 'warn' | 'error',
  message: string,
  error?: unknown
): void => {
  const detail = error === undefined ? '' : `:${safeStringify(error)}`;
  reportFrontendEvent({
    level,
    message: `${message}${detail}`,
  });
};