import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import toast from 'react-hot-toast';
import { handleError } from '../utils/errorHandler';
import type { AppConfig, DownloadConfig } from '../types';
import { useDownloadStore } from './downloadStore';

interface ConfigState {
  // 配置数据
  config: AppConfig;
  isLoading: boolean;

  // Actions
  loadConfig: () => Promise<void>;
  updateConfig: (config: Partial<AppConfig>) => Promise<void>;
  updateDownloadConfig: (config: Partial<DownloadConfig>) => Promise<void>;
  resetConfig: () => Promise<void>;
  exportConfig: () => Promise<void>;
  importConfig: (configData: string) => Promise<void>;
}

export const defaultConfig: AppConfig = {
  download: {
    concurrent_downloads: 3,
    retry_attempts: 3,
    timeout_seconds: 30,
    user_agent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    proxy: undefined,
    headers: {},
    output_directory: 'downloads',
    auto_verify_integrity: false,
    integrity_algorithm: 'sha256',
    expected_hashes: {},
  },
  ui: {
    theme: 'system',
    language: 'zh-CN',
    window_width: 1200,
    window_height: 800,
    window_x: null,
    window_y: null,
    show_completed_tasks: true,
    auto_start_downloads: false,
    show_notifications: true,
    notification_sound: true,
    minimize_to_tray: false,
    start_minimized: false,
  },
  system: {
    auto_update: true,
    check_update_on_startup: true,
    hardware_acceleration: true,
    max_memory_usage_mb: null,
    temp_directory: null,
    log_level: 'info',
  },
  youtube: {
    default_quality: '720p',
    default_format: 'mp4',
    extract_audio: false,
    audio_format: 'mp3',
    download_subtitles: false,
    subtitle_languages: ['zh-CN', 'en'],
    download_thumbnail: true,
    download_description: true,
    playlist_reverse: false,
    playlist_max_items: null,
  },
  advanced: {
    enable_logging: true,
    log_level: 'info',
    max_log_files: 10,
    cleanup_on_exit: true,
    enable_proxy: false,
    proxy_type: 'http',
    proxy_host: undefined,
    proxy_port: undefined,
    proxy_username: undefined,
    proxy_password: undefined,
    custom_user_agents: {},
    rate_limit_mbps: undefined,
    enable_statistics: true,
    statistics_retention_days: 30,
  },
};

const mergeConfigWithDefaults = (config?: Partial<AppConfig>): AppConfig => {
  const incomingDownload: Partial<AppConfig['download']> = config?.download ?? {};
  const incomingAdvanced: Partial<AppConfig['advanced']> = config?.advanced ?? {};

  return {
    download: {
      ...defaultConfig.download,
      ...incomingDownload,
      headers: {
        ...defaultConfig.download.headers,
        ...(incomingDownload.headers ?? {}),
      },
      expected_hashes: {
        ...defaultConfig.download.expected_hashes,
        ...(incomingDownload.expected_hashes ?? {}),
      },
    },
    ui: {
      ...defaultConfig.ui,
      ...(config?.ui ?? {}),
    },
    system: {
      ...defaultConfig.system,
      ...(config?.system ?? {}),
    },
    youtube: {
      ...defaultConfig.youtube,
      ...(config?.youtube ?? {}),
    },
    advanced: {
      ...defaultConfig.advanced,
      ...incomingAdvanced,
      custom_user_agents: {
        ...defaultConfig.advanced.custom_user_agents,
        ...(incomingAdvanced.custom_user_agents ?? {}),
      },
    },
  };
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: mergeConfigWithDefaults(),
      isLoading: false,

      loadConfig: async () => {
        try {
          set({ isLoading: true });
          const config = await invoke<AppConfig>('get_config');
          const mergedConfig = mergeConfigWithDefaults(config);
          set({ config: mergedConfig, isLoading: false });
          useDownloadStore.getState().setDownloadConfig(mergedConfig.download);
        } catch (error) {
          set({ isLoading: false });
          handleError('加载配置', error, false); // 不显示Toast，因为会使用默认配置
          // 如果加载失败，使用默认配置
          const fallbackConfig = mergeConfigWithDefaults();
          set({ config: fallbackConfig });
          useDownloadStore.getState().setDownloadConfig(fallbackConfig.download);
        }
      },

      updateConfig: async newConfig => {
        try {
          const currentConfig = mergeConfigWithDefaults(get().config);

          const mergedConfig = mergeConfigWithDefaults({
            ...currentConfig,
            ...newConfig,
            download: {
              ...currentConfig.download,
              ...(newConfig.download ?? {}),
            },
            ui: {
              ...currentConfig.ui,
              ...(newConfig.ui ?? {}),
            },
            system: {
              ...currentConfig.system,
              ...(newConfig.system ?? {}),
            },
            youtube: {
              ...currentConfig.youtube,
              ...(newConfig.youtube ?? {}),
            },
            advanced: {
              ...currentConfig.advanced,
              ...(newConfig.advanced ?? {}),
            },
          });
          await invoke('update_config', { newConfig: mergedConfig, new_config: mergedConfig });
          set({ config: mergedConfig });
          useDownloadStore.getState().setDownloadConfig(mergedConfig.download);
          toast.success('配置已更新');
        } catch (error) {
          handleError('更新配置', error);
          throw error;
        }
      },

      updateDownloadConfig: async newDownloadConfig => {
        const currentConfig = get().config;
        const updatedConfig = {
          ...currentConfig,
          download: { ...currentConfig.download, ...newDownloadConfig },
        };
        await get().updateConfig(updatedConfig);
      },

      resetConfig: async () => {
        try {
          const resetConfig = await invoke<AppConfig>('reset_config');
          const normalizedConfig = mergeConfigWithDefaults(resetConfig);
          set({ config: normalizedConfig });
          useDownloadStore.getState().setDownloadConfig(normalizedConfig.download);
          toast.success('配置已重置为默认值');
        } catch (error) {
          handleError('重置配置', error);
          throw error;
        }
      },

      exportConfig: async () => {
        try {
          const configJson = JSON.stringify(get().config, null, 2);
          await invoke('export_config', { configData: configJson });
          toast.success('配置已导出');
        } catch (error) {
          handleError('导出配置', error);
          throw error;
        }
      },

      importConfig: async configData => {
        try {
          const importedConfig = JSON.parse(configData) as AppConfig;
          await get().updateConfig(importedConfig);
          toast.success('配置已导入');
        } catch (error) {
          handleError('导入配置', error);
          throw error;
        }
      },
    }),
    {
      name: 'app-config',
      partialize: state => ({ config: state.config }),
    }
  )
);
