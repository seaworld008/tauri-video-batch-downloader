import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  __resetConcurrencyNoticeForTests,
  handleQueuedConcurrency,
  isConcurrencyError,
  runControlCommandWithRuntimeSync,
  runQueuedControlCommand,
  syncRuntimeAfterControl,
} from '../commandControlEffects';

describe('commandControlEffects helpers', () => {
  beforeEach(() => {
    __resetConcurrencyNoticeForTests();
    vi.useRealTimers();
  });

  it('detects concurrency errors by code or message', () => {
    expect(isConcurrencyError({ code: 'MAX_CONCURRENCY_REACHED' })).toBe(true);
    expect(isConcurrencyError(new Error('Maximum concurrent downloads reached'))).toBe(true);
    expect(isConcurrencyError(new Error('other error'))).toBe(false);
  });

  it('syncs runtime in background after control actions', async () => {
    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);

    syncRuntimeAfterControl(syncRuntimeState, 'pauseDownload');
    await Promise.resolve();

    expect(syncRuntimeState).toHaveBeenCalledWith('pauseDownload');
  });

  it('runs control commands through one runtime-sync seam', async () => {
    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);
    const runCommand = vi.fn().mockResolvedValue('started');

    await expect(
      runControlCommandWithRuntimeSync({
        runCommand,
        source: 'startDownload',
        syncRuntimeState,
      })
    ).resolves.toBe('started');

    expect(runCommand).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(syncRuntimeState).toHaveBeenCalledWith('startDownload');
  });

  it('maps concurrency failures to queued results through shared queued-control seam', async () => {
    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);
    const toastFn = vi.fn();

    await expect(
      runQueuedControlCommand({
        runCommand: vi.fn().mockRejectedValue({ code: 'MAX_CONCURRENCY_REACHED' }),
        source: 'resumeDownload',
        syncRuntimeState,
        concurrencyError: {
          queueMessage: '当前下载达到最大并发，任务已加入队列等待恢复。',
          queuedResult: 'queued' as const,
          toastFn,
        },
      })
    ).resolves.toBe('queued');

    expect(toastFn).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(syncRuntimeState).toHaveBeenCalledWith('resumeDownload:max-concurrency');
  });

  it('handles queued concurrency with throttled toast and runtime sync', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T06:30:00Z'));

    const syncRuntimeState = vi.fn().mockResolvedValue(undefined);
    const toastFn = vi.fn();

    expect(
      handleQueuedConcurrency({
        error: { code: 'MAX_CONCURRENCY_REACHED' },
        queueMessage: '当前下载达到最大并发，其余任务已自动排队等待。',
        syncRuntimeState,
        source: 'startDownload:max-concurrency',
        toastFn,
      })
    ).toBe(true);

    expect(toastFn).toHaveBeenCalledTimes(1);

    expect(
      handleQueuedConcurrency({
        error: { code: 'MAX_CONCURRENCY_REACHED' },
        queueMessage: '当前下载达到最大并发，其余任务已自动排队等待。',
        syncRuntimeState,
        source: 'startDownload:max-concurrency',
        toastFn,
      })
    ).toBe(true);

    expect(toastFn).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(syncRuntimeState).toHaveBeenCalledTimes(2);
  });
});