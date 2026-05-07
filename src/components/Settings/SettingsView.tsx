import React, { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { notify } from '../../stores/uiStore';
import {
  checkExternalToolUpdatesCommand,
  clearExternalToolOverrideCommand,
  getExternalToolStatusCommand,
  rollbackExternalToolCommand,
  selectExternalToolBinaryCommand,
  selectOutputDirectoryCommand,
  setExternalToolOverrideCommand,
  updateExternalToolCommand,
  type ExternalToolId,
  type ExternalToolStatus,
} from '../../features/downloads/api/systemCommands';
import type { AppConfig } from '../../types';
import { reportFrontendIssue } from '../../utils/frontendLogging';
import { ExternalToolsSection } from './ExternalToolsSection';
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
  const [externalTools, setExternalTools] = useState<ExternalToolStatus[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [updatingTool, setUpdatingTool] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setLocalConfig(JSON.parse(JSON.stringify(config))); // Deep copy
    }
  }, [config]);

  const refreshExternalTools = async () => {
    setIsLoadingTools(true);
    try {
      setExternalTools(await getExternalToolStatusCommand());
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tools_refresh_failed', error);
      notify.error('工具检测失败', error as string);
    } finally {
      setIsLoadingTools(false);
    }
  };

  useEffect(() => {
    void refreshExternalTools();
  }, []);

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

  const checkExternalToolUpdates = async () => {
    setIsLoadingTools(true);
    try {
      const updated = await checkExternalToolUpdatesCommand();
      setExternalTools(updated);
      notify.success('检查完成', '外部工具版本状态已更新');
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tools_check_failed', error);
      notify.error('检查更新失败', error as string);
    } finally {
      setIsLoadingTools(false);
    }
  };

  const updateExternalTool = async (tool: ExternalToolId) => {
    setUpdatingTool(tool);
    try {
      const updated = await updateExternalToolCommand(tool);
      setExternalTools(current => current.map(item => (item.id === tool ? updated : item)));
      notify.success('工具已更新', `${updated.display_name} 已更新到可用版本`);
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_update_failed', error);
      notify.error('工具更新失败', error as string);
    } finally {
      setUpdatingTool(null);
    }
  };

  const rollbackExternalTool = async (tool: ExternalToolId) => {
    setUpdatingTool(tool);
    try {
      const updated = await rollbackExternalToolCommand(tool);
      setExternalTools(current => current.map(item => (item.id === tool ? updated : item)));
      notify.success('工具已回退', `${updated.display_name} 已切回上一个 App 管理版本`);
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_rollback_failed', error);
      notify.error('工具回退失败', error as string);
    } finally {
      setUpdatingTool(null);
    }
  };

  const selectExternalToolOverride = async (tool: ExternalToolId) => {
    try {
      const selected = await selectExternalToolBinaryCommand(tool);
      if (!selected) return;
      const updated = await setExternalToolOverrideCommand(tool, selected);
      setExternalTools(current => current.map(item => (item.id === tool ? updated : item)));
      notify.success('工具路径已更新', `${updated.display_name} 将优先使用指定文件`);
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_override_failed', error);
      notify.error('设置工具路径失败', error as string);
    }
  };

  const clearExternalToolOverride = async (tool: ExternalToolId) => {
    try {
      const updated = await clearExternalToolOverrideCommand(tool);
      setExternalTools(current => current.map(item => (item.id === tool ? updated : item)));
      notify.success('工具路径已清除', `${updated.display_name} 已恢复自动检测`);
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_clear_failed', error);
      notify.error('清除工具路径失败', error as string);
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
        <ExternalToolsSection
          tools={externalTools}
          isLoading={isLoadingTools}
          isUpdating={updatingTool}
          onRefresh={refreshExternalTools}
          onCheckUpdates={checkExternalToolUpdates}
          onUpdate={updateExternalTool}
          onRollback={rollbackExternalTool}
          onSelectOverride={selectExternalToolOverride}
          onClearOverride={clearExternalToolOverride}
        />
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
