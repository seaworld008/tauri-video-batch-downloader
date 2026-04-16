import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  return String(error ?? '');
};

const getErrorCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as any).code);
  }

  return undefined;
};

export const isConcurrencyError = (error: unknown) => {
  const code = getErrorCode(error);
  if (code === 'MAX_CONCURRENCY_REACHED') {
    return true;
  }

  return getErrorMessage(error).toLowerCase().includes('maximum concurrent downloads');
};

const CONCURRENCY_NOTICE_INTERVAL = 4000;
let lastConcurrencyNotice = 0;

export const __resetConcurrencyNoticeForTests = () => {
  lastConcurrencyNotice = 0;
};

export const syncRuntimeAfterControl = (
  syncRuntimeState: (source: string) => Promise<unknown>,
  source: string
): void => {
  void syncRuntimeState(source).catch(err =>
    reportFrontendDiagnosticIfEnabled('warn', `[${source}] runtime sync failed`, err)
  );
};

export const runControlCommandWithRuntimeSync = async <TResult>({
  runCommand,
  source,
  syncRuntimeState,
}: {
  runCommand: () => Promise<TResult>;
  source: string;
  syncRuntimeState: (source: string) => Promise<unknown>;
}): Promise<TResult> => {
  const result = await runCommand();
  syncRuntimeAfterControl(syncRuntimeState, source);
  return result;
};

export const handleQueuedConcurrency = ({
  error,
  suppressToast = false,
  queueMessage,
  syncRuntimeState,
  source,
  toastFn,
}: {
  error: unknown;
  suppressToast?: boolean;
  queueMessage: string;
  syncRuntimeState: (source: string) => Promise<unknown>;
  source: string;
  toastFn: (message: string) => void;
}): boolean => {
  if (!isConcurrencyError(error)) {
    return false;
  }

  if (!suppressToast) {
    const now = Date.now();
    if (now - lastConcurrencyNotice > CONCURRENCY_NOTICE_INTERVAL) {
      toastFn(queueMessage);
      lastConcurrencyNotice = now;
    }
  }

  syncRuntimeAfterControl(syncRuntimeState, source);
  return true;
};

export const runQueuedControlCommand = async <TResult, TQueuedResult>({
  runCommand,
  source,
  syncRuntimeState,
  concurrencyError,
}: {
  runCommand: () => Promise<TResult>;
  source: string;
  syncRuntimeState: (source: string) => Promise<unknown>;
  concurrencyError: {
    queueMessage: string;
    toastFn: (message: string) => void;
    queuedResult: TQueuedResult;
    suppressToast?: boolean;
    queueSource?: string;
  };
}): Promise<TResult | TQueuedResult> => {
  try {
    return await runControlCommandWithRuntimeSync({
      runCommand,
      source,
      syncRuntimeState,
    });
  } catch (error) {
    if (
      handleQueuedConcurrency({
        error,
        suppressToast: concurrencyError.suppressToast,
        queueMessage: concurrencyError.queueMessage,
        syncRuntimeState,
        source: concurrencyError.queueSource ?? `${source}:max-concurrency`,
        toastFn: concurrencyError.toastFn,
      })
    ) {
      return concurrencyError.queuedResult;
    }

    throw error;
  }
};