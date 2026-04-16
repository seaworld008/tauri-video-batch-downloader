import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useConfigStore, defaultConfig } from '../configStore';
import {
  exportConfigCommand,
  getConfigCommand,
  importConfigCommand,
  resetConfigCommand,
  updateConfigCommand,
} from '../../features/downloads/api/configCommands';
import type { AppConfig } from '../../types';

const { setDownloadConfig, handleError, toastMock } = vi.hoisted(() => ({
  setDownloadConfig: vi.fn(),
  handleError: vi.fn(),
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../features/downloads/api/configCommands', () => ({
  getConfigCommand: vi.fn(),
  updateConfigCommand: vi.fn(),
  resetConfigCommand: vi.fn(),
  exportConfigCommand: vi.fn(),
  importConfigCommand: vi.fn(),
}));

vi.mock('../downloadStore', () => ({
  useDownloadStore: {
    getState: () => ({
      setDownloadConfig,
    }),
  },
}));

vi.mock('../../utils/errorHandler', () => ({
  handleError: (...args: unknown[]) => handleError(...args),
}));

vi.mock('react-hot-toast', () => ({
  default: toastMock,
}));

describe('configStore', () => {
  const baseConfig: AppConfig = structuredClone(defaultConfig);

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useConfigStore.setState({
      config: structuredClone(defaultConfig),
      isLoading: false,
    });
  });

  it('loads config through the shared config command seam and syncs download config', async () => {
    const remoteConfig: AppConfig = {
      ...baseConfig,
      download: {
        ...baseConfig.download,
        concurrent_downloads: 6,
      },
    };
    vi.mocked(getConfigCommand).mockResolvedValue(remoteConfig);

    await act(async () => {
      await useConfigStore.getState().loadConfig();
    });

    expect(getConfigCommand).toHaveBeenCalledTimes(1);
    expect(useConfigStore.getState().config.download.concurrent_downloads).toBe(6);
    expect(setDownloadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ concurrent_downloads: 6 })
    );
  });

  it('updates config through the shared config command seam', async () => {
    vi.mocked(updateConfigCommand).mockResolvedValue(undefined);

    await act(async () => {
      await useConfigStore.getState().updateConfig({
        download: {
          ...baseConfig.download,
          concurrent_downloads: 5,
        },
      });
    });

    expect(updateConfigCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        download: expect.objectContaining({ concurrent_downloads: 5 }),
      })
    );
    expect(useConfigStore.getState().config.download.concurrent_downloads).toBe(5);
    expect(setDownloadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ concurrent_downloads: 5 })
    );
    expect(toastMock.success).toHaveBeenCalledWith('配置已更新');
  });

  it('resets config through the shared config command seam', async () => {
    const resetConfig: AppConfig = {
      ...baseConfig,
      download: {
        ...baseConfig.download,
        concurrent_downloads: 2,
      },
    };
    vi.mocked(resetConfigCommand).mockResolvedValue(resetConfig);

    await act(async () => {
      await useConfigStore.getState().resetConfig();
    });

    expect(resetConfigCommand).toHaveBeenCalledTimes(1);
    expect(useConfigStore.getState().config.download.concurrent_downloads).toBe(2);
    expect(setDownloadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ concurrent_downloads: 2 })
    );
    expect(toastMock.success).toHaveBeenCalledWith('配置已重置为默认值');
  });

  it('exports config by passing a file path instead of raw config data', async () => {
    vi.mocked(exportConfigCommand).mockResolvedValue(undefined);

    await act(async () => {
      await useConfigStore.getState().exportConfig('/tmp/config.json');
    });

    expect(exportConfigCommand).toHaveBeenCalledWith('/tmp/config.json');
    expect(toastMock.success).toHaveBeenCalledWith('配置已导出');
  });

  it('imports config from file through the shared config command seam', async () => {
    const importedConfig: AppConfig = {
      ...baseConfig,
      download: {
        ...baseConfig.download,
        output_directory: '/downloads/imported',
      },
    };
    vi.mocked(importConfigCommand).mockResolvedValue(importedConfig);

    await act(async () => {
      await useConfigStore.getState().importConfig('/tmp/config.json');
    });

    expect(importConfigCommand).toHaveBeenCalledWith('/tmp/config.json');
    expect(useConfigStore.getState().config.download.output_directory).toBe('/downloads/imported');
    expect(setDownloadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ output_directory: '/downloads/imported' })
    );
    expect(toastMock.success).toHaveBeenCalledWith('配置已导入');
  });

  it('falls back to defaults when loading config fails', async () => {
    vi.mocked(getConfigCommand).mockRejectedValue(new Error('boom'));

    await act(async () => {
      await useConfigStore.getState().loadConfig();
    });

    expect(handleError).toHaveBeenCalledWith('加载配置', expect.any(Error), false);
    expect(useConfigStore.getState().config.download.concurrent_downloads).toBe(
      defaultConfig.download.concurrent_downloads
    );
    expect(setDownloadConfig).toHaveBeenCalledWith(defaultConfig.download);
  });
});
