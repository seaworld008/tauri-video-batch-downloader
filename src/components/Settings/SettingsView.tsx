import React, { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { notify } from '../../stores/uiStore';
import { selectOutputDirectoryCommand } from '../../features/downloads/api/systemCommands';
import type { AppConfig } from '../../types';
import { reportFrontendIssue } from '../../utils/frontendLogging';
import {
  AdvancedSettingsSection,
  DownloadSettingsSection,
  UiSettingsSection,
} from './SettingsSections';
import { SettingsSaveBar } from './SettingsSaveBar';

interface SettingsViewProps {}

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const config = useConfigStore(state => state.config);
  const updateConfig = useConfigStore(state => state.updateConfig);
  const resetConfig = useConfigStore(state => state.resetConfig);
  const [localConfig, setLocalConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (config) {
      setLocalConfig(JSON.parse(JSON.stringify(config))); // Deep copy
    }
  }, [config]);

  const handleConfigChange = (section: keyof AppConfig, key: string, value: any) => {
    if (!localConfig) return;

    const updatedConfig = {
      ...localConfig,
      [section]: {
        ...localConfig[section],
        [key]: value,
      },
    };

    setLocalConfig(updatedConfig);
    setHasChanges(true);
  };

  const handleSaveSettings = async () => {
    if (!localConfig) return;

    setIsLoading(true);
    try {
      await updateConfig(localConfig);
      setHasChanges(false);
      notify.success('设置已保存', '配置已成功更新');
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:save_failed', error);
      notify.error('保存失败', error as string);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetSettings = async () => {
    setIsLoading(true);
    try {
      await resetConfig();
      setHasChanges(false);
      notify.success('设置已重置', '已恢复默认配置');
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:reset_failed', error);
      notify.error('重置失败', error as string);
    } finally {
      setIsLoading(false);
    }
  };

  const selectOutputDirectory = async () => {
    try {
      const selected = await selectOutputDirectoryCommand();
      if (selected && localConfig) {
        handleConfigChange('download', 'output_directory', selected);
      }
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:select_output_directory_failed', error);
      notify.error('选择目录失败', error as string);
    }
  };

  if (!localConfig) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-center'>
          <div className='w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4'></div>
          <p className='text-gray-600 dark:text-gray-400'>加载配置中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full' data-testid='settings-page'>
      <div className='space-y-8 pb-20'>
        <DownloadSettingsSection
          localConfig={localConfig}
          onConfigChange={handleConfigChange}
          onSelectOutputDirectory={selectOutputDirectory}
        />
        <UiSettingsSection localConfig={localConfig} onConfigChange={handleConfigChange} />
        <AdvancedSettingsSection localConfig={localConfig} onConfigChange={handleConfigChange} />
      </div>

      <SettingsSaveBar
        hasChanges={hasChanges}
        isLoading={isLoading}
        onReset={handleResetSettings}
        onSave={handleSaveSettings}
      />
    </div>
  );
};
