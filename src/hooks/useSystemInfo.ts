import { useCallback, useEffect, useRef, useState } from 'react';
import type { SystemInfo } from '../types';
import { invokeTauri } from '../utils/tauriBridge';
import { handleError } from '../utils/errorHandler';

const DEFAULT_POLLING_INTERVAL = 5000;
type IntervalHandle = ReturnType<typeof setInterval> | number;

interface UseSystemInfoOptions {
  intervalMs?: number;
  enabled?: boolean;
}

interface UseSystemInfoResult {
  systemInfo: SystemInfo | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
}

export function useSystemInfo(options: UseSystemInfoOptions = {}): UseSystemInfoResult {
  const { intervalMs = DEFAULT_POLLING_INTERVAL, enabled = true } = options;

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const timerRef = useRef<IntervalHandle | null>(null);
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const fetchSystemInfo = useCallback(async () => {
    if (!enabled || isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

    try {
      const info = await invokeTauri<SystemInfo>('get_system_info');
      if (!isMountedRef.current) {
        return;
      }

      setSystemInfo(info);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        handleError('获取系统信息', err, false);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      isFetchingRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
  }, []);

  useEffect(() => {
    clearTimer();

    if (!enabled) {
      setIsLoading(false);
      return;
    }

    fetchSystemInfo();

    if (typeof window !== 'undefined') {
      timerRef.current = window.setInterval(() => {
        void fetchSystemInfo();
      }, intervalMs);
    }

    return () => {
      clearTimer();
    };
  }, [enabled, fetchSystemInfo, intervalMs]);

  const refresh = useCallback(async () => {
    await fetchSystemInfo();
  }, [fetchSystemInfo]);

  return {
    systemInfo,
    isLoading,
    error,
    lastUpdated,
    refresh,
  };
}
