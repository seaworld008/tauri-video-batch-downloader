import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SystemInfo } from '../../types';
import { useSystemInfo } from '../useSystemInfo';
import { invokeTauri } from '../../utils/tauriBridge';
import { handleError } from '../../utils/errorHandler';

vi.mock('../../utils/tauriBridge', () => ({
  invokeTauri: vi.fn(),
}));

vi.mock('../../utils/errorHandler', () => ({
  handleError: vi.fn(),
}));

describe('useSystemInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches data immediately and continues polling', async () => {
    const firstInfo: SystemInfo = {
      cpu_usage: 12.5,
      memory_usage: 42.2,
      disk_usage: 10,
      network_speed: { download: 1024, upload: 256 },
      active_downloads: 2,
    };

    const secondInfo: SystemInfo = {
      cpu_usage: 18.3,
      memory_usage: 45.6,
      disk_usage: 15,
      network_speed: { download: 2048, upload: 512 },
      active_downloads: 1,
    };

    vi.mocked(invokeTauri).mockResolvedValueOnce(firstInfo).mockResolvedValue(secondInfo);

    const { result } = renderHook(() => useSystemInfo({ intervalMs: 50 }));

    await waitFor(() => {
      expect(result.current.systemInfo).not.toBeNull();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    const firstSnapshot = result.current.systemInfo;
    expect([firstInfo, secondInfo]).toContainEqual(firstSnapshot);

    await waitFor(
      () => {
        expect(result.current.systemInfo).toEqual(secondInfo);
      },
      { timeout: 500 }
    );

    expect(invokeTauri).toHaveBeenCalledTimes(2);
  });

  it('handles errors and allows manual refresh', async () => {
    const failure = new Error('boom');
    vi.mocked(invokeTauri).mockRejectedValueOnce(failure);

    const { result } = renderHook(() => useSystemInfo({ intervalMs: 50 }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe('boom');
    });

    expect(handleError).toHaveBeenCalledWith('获取系统信息', failure, false);

    const recoveryInfo: SystemInfo = {
      cpu_usage: 55.1,
      memory_usage: 60.2,
      disk_usage: 22,
      network_speed: { download: 512, upload: 256 },
      active_downloads: 0,
    };

    vi.mocked(invokeTauri).mockResolvedValueOnce(recoveryInfo);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.systemInfo).toEqual(recoveryInfo);
    expect(result.current.error).toBeNull();
  });
});
