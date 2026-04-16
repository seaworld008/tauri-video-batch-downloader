import type { AppConfig } from '../../../types';
import { invokeTauri } from '../../../utils/tauriBridge';

export const getConfigCommand = async (): Promise<AppConfig> =>
  invokeTauri<AppConfig>('get_config');

export const updateConfigCommand = async (config: AppConfig): Promise<void> =>
  invokeTauri<void>('update_config', {
    newConfig: config,
    new_config: config,
  });

export const resetConfigCommand = async (): Promise<AppConfig> =>
  invokeTauri<AppConfig>('reset_config');

export const exportConfigCommand = async (filePath: string): Promise<void> =>
  invokeTauri<void>('export_config', {
    filePath,
    file_path: filePath,
  });

export const importConfigCommand = async (filePath: string): Promise<AppConfig> =>
  invokeTauri<AppConfig>('import_config', {
    filePath,
    file_path: filePath,
  });
