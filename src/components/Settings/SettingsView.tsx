import React, { useState, useEffect, useCallback } from 'react';
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
import { useI18n } from '../../i18n/hooks';

interface SettingsViewProps {}

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const { t } = useI18n();
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

  const refreshExternalTools = useCallback(async () => {
    setIsLoadingTools(true);
    try {
      setExternalTools(await getExternalToolStatusCommand());
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tools_refresh_failed', error);
      notify.error(t('settings.toasts.toolsRefreshFailed'), formatErrorMessage(error));
    } finally {
      setIsLoadingTools(false);
    }
  }, [t]);

  useEffect(() => {
    void refreshExternalTools();
  }, [refreshExternalTools]);

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
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:save_failed', error);
      notify.error(t('settings.toasts.saveFailed'), formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetSettings = async () => {
    setIsLoading(true);
    try {
      await resetConfig();
      setHasChanges(false);
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:reset_failed', error);
      notify.error(t('settings.toasts.resetFailed'), formatErrorMessage(error));
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
      notify.error(t('settings.toasts.selectDirFailed'), formatErrorMessage(error));
    }
  };

  const checkExternalToolUpdates = async () => {
    setIsLoadingTools(true);
    try {
      const updated = await checkExternalToolUpdatesCommand();
      setExternalTools(updated);
      notify.success(
        t('settings.toasts.checkCompleteTitle'),
        t('settings.toasts.checkCompleteMessage')
      );
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tools_check_failed', error);
      notify.error(t('settings.toasts.checkUpdatesFailed'), formatErrorMessage(error));
    } finally {
      setIsLoadingTools(false);
    }
  };

  const updateExternalTool = async (tool: ExternalToolId) => {
    setUpdatingTool(tool);
    try {
      const updated = await updateExternalToolCommand(tool);
      setExternalTools(current => current.map(item => (item.id === tool ? updated : item)));
      notify.success(
        t('settings.toasts.toolUpdatedTitle'),
        t('settings.toasts.toolUpdatedMessage', { name: updated.display_name })
      );
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_update_failed', error);
      notify.error(t('settings.toasts.toolUpdateFailed'), formatErrorMessage(error));
    } finally {
      setUpdatingTool(null);
    }
  };

  const rollbackExternalTool = async (tool: ExternalToolId) => {
    setUpdatingTool(tool);
    try {
      const updated = await rollbackExternalToolCommand(tool);
      setExternalTools(current => current.map(item => (item.id === tool ? updated : item)));
      notify.success(
        t('settings.toasts.toolRolledBackTitle'),
        t('settings.toasts.toolRolledBackMessage', { name: updated.display_name })
      );
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_rollback_failed', error);
      notify.error(t('settings.toasts.toolRollbackFailed'), formatErrorMessage(error));
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
      notify.success(
        t('settings.toasts.toolOverrideUpdatedTitle'),
        t('settings.toasts.toolOverrideUpdatedMessage', { name: updated.display_name })
      );
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_override_failed', error);
      notify.error(t('settings.toasts.toolOverrideFailed'), formatErrorMessage(error));
    }
  };

  const clearExternalToolOverride = async (tool: ExternalToolId) => {
    try {
      const updated = await clearExternalToolOverrideCommand(tool);
      setExternalTools(current => current.map(item => (item.id === tool ? updated : item)));
      notify.success(
        t('settings.toasts.toolOverrideClearedTitle'),
        t('settings.toasts.toolOverrideClearedMessage', { name: updated.display_name })
      );
    } catch (error) {
      reportFrontendIssue('error', 'settings_view:external_tool_clear_failed', error);
      notify.error(t('settings.toasts.toolClearFailed'), formatErrorMessage(error));
    }
  };

  if (!localConfig) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-center'>
          <div className='w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4'></div>
          <p className='text-gray-600 dark:text-gray-400'>{t('settings.loadingConfig')}</p>
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
