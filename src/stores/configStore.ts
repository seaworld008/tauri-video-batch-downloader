import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import toast from 'react-hot-toast';
import { handleError } from '../utils/errorHandler';
import type { AppConfig, DownloadConfig } from '../types';

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

const defaultConfig: AppConfig = {
  download: {
    concurrent_downloads: 3,
    retry_attempts: 3,
    timeout_seconds: 30,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    proxy: undefined,
    headers: {},
    output_directory: '',
  },
  ui: {
    theme: 'system',
    language: 'zh-CN',
    show_completed_tasks: true,
    auto_start_downloads: false,
    show_notifications: true,
  },
  advanced: {
    enable_logging: true,
    log_level: 'info',
    max_log_files: 10,
    cleanup_on_exit: true,
  },
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: defaultConfig,
      isLoading: false,
      
      loadConfig: async () => {
        try {
          set({ isLoading: true });
          const config = await invoke<AppConfig>('get_config');
          set({ config, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          handleError('加载配置', error, false); // 不显示Toast，因为会使用默认配置
          // 如果加载失败，使用默认配置
          set({ config: defaultConfig });
        }
      },
      
      updateConfig: async (newConfig) => {
        try {
          const updatedConfig = { ...get().config, ...newConfig };
          await invoke('update_config', { config: updatedConfig });
          set({ config: updatedConfig });
          toast.success('配置已更新');
        } catch (error) {
          handleError('更新配置', error);
          throw error;
        }
      },
      
      updateDownloadConfig: async (newDownloadConfig) => {
        const currentConfig = get().config;
        const updatedConfig = {
          ...currentConfig,
          download: { ...currentConfig.download, ...newDownloadConfig },
        };
        await get().updateConfig(updatedConfig);
      },
      
      resetConfig: async () => {
        try {
          await invoke('reset_config');
          set({ config: defaultConfig });
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
      
      importConfig: async (configData) => {
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
      partialize: (state) => ({ config: state.config }),
    }
  )
);