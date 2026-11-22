import React from 'react';
import {
  CogIcon,
  FolderIcon,
  CloudArrowDownIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';
import type { AppConfig } from '../../types';
import { useI18n } from '../../i18n/hooks';

type ConfigChangeHandler = (section: keyof AppConfig, key: string, value: any) => void;

const inputClass =
  'w-full h-10 min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const buttonFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

interface SettingsSectionProps {
  localConfig: AppConfig;
  onConfigChange: ConfigChangeHandler;
}

const parseIntInput = (raw: string, onValid: (value: number) => void) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isNaN(parsed)) {
    onValid(parsed);
  }
};

export const DownloadSettingsSection: React.FC<
  SettingsSectionProps & { onSelectOutputDirectory: () => void }
> = ({ localConfig, onConfigChange, onSelectOutputDirectory }) => {
  const { t } = useI18n();

  return (
    <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
      <div className='flex items-center mb-6'>
        <CloudArrowDownIcon className='w-6 h-6 text-blue-600 dark:text-blue-400 mr-3' />
        <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
          {t('settings.download.title')}
        </h2>
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-6 items-start'>
        <div className='min-w-0'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.download.concurrentDownloads')}
          </label>
          <input
            type='number'
            min='1'
            max='10'
            value={localConfig.download.concurrent_downloads}
            onChange={e =>
              parseIntInput(e.target.value, value =>
                onConfigChange('download', 'concurrent_downloads', value)
              )
            }
            data-testid='concurrent-downloads'
            className={inputClass}
          />
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            {t('settings.download.concurrentDownloadsHint')}
          </p>
        </div>

        <div className='min-w-0'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.download.retryAttempts')}
          </label>
          <input
            type='number'
            min='0'
            max='10'
            value={localConfig.download.retry_attempts}
            onChange={e =>
              parseIntInput(e.target.value, value =>
                onConfigChange('download', 'retry_attempts', value)
              )
            }
            data-testid='retry-attempts'
            className={inputClass}
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.download.timeout')}
          </label>
          <input
            type='number'
            min='10'
            max='300'
            value={localConfig.download.timeout_seconds}
            onChange={e =>
              parseIntInput(e.target.value, value =>
                onConfigChange('download', 'timeout_seconds', value)
              )
            }
            data-testid='timeout-setting'
            className={inputClass}
          />
        </div>

        <div className='md:col-span-2'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.download.outputDirectory')}
          </label>
          <div className='rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 p-3'>
            <div className='text-sm text-gray-900 dark:text-gray-100 break-all'>
              {localConfig.download.output_directory || t('settings.download.unsetDirectory')}
            </div>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-2'>
              {t('settings.download.outputDirectoryHint')}
            </p>
          </div>
          <div className='mt-3 flex items-center justify-end'>
            <button
              type='button'
              onClick={onSelectOutputDirectory}
              className={`inline-flex items-center px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors ${buttonFocusClass}`}
            >
              <FolderIcon className='w-4 h-4 mr-2' />
              {t('settings.download.selectDirectory')}
            </button>
          </div>
        </div>
      </div>

      <div className='mt-6'>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          {t('settings.advanced.userAgent')}
        </label>
        <input
          type='text'
          value={localConfig.download.user_agent}
          onChange={e => onConfigChange('download', 'user_agent', e.target.value)}
          className={inputClass}
        />
      </div>

      <div className='mt-6'>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          {t('settings.advanced.proxy')}
        </label>
        <input
          type='text'
          placeholder='http://proxy.example.com:8080'
          value={localConfig.download.proxy || ''}
          onChange={e => onConfigChange('download', 'proxy', e.target.value || undefined)}
          className={inputClass}
        />
      </div>
    </div>
  );
};

export const UiSettingsSection: React.FC<SettingsSectionProps> = ({
  localConfig,
  onConfigChange,
}) => {
  const { t } = useI18n();

  return (
    <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
      <div className='flex items-center mb-6'>
        <ComputerDesktopIcon className='w-6 h-6 text-green-600 dark:text-green-400 mr-3' />
        <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
          {t('settings.ui.title')}
        </h2>
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-6 items-start'>
        <div className='min-w-0'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.theme.title')}
          </label>
          <select
            value={localConfig.ui.theme}
            onChange={e =>
              onConfigChange('ui', 'theme', e.target.value as 'light' | 'dark' | 'system')
            }
            className={inputClass}
          >
            <option value='system'>{t('settings.theme.system')}</option>
            <option value='light'>{t('settings.theme.light')}</option>
            <option value='dark'>{t('settings.theme.dark')}</option>
          </select>
        </div>

        <div className='min-w-0'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.language.title')}
          </label>
          <select
            value={localConfig.ui.language}
            onChange={e => onConfigChange('ui', 'language', e.target.value)}
            className={inputClass}
          >
            <option value='zh-CN'>简体中文</option>
            <option value='en-US'>English</option>
          </select>
        </div>
      </div>

      <div className='mt-6 space-y-4'>
        <SettingsCheckbox
          label={t('settings.ui.showCompletedTasks')}
          description={t('settings.ui.showCompletedTasksDesc')}
          checked={localConfig.ui.show_completed_tasks}
          onChange={checked => onConfigChange('ui', 'show_completed_tasks', checked)}
        />
        <SettingsCheckbox
          label={t('settings.ui.autoStartDownloads')}
          description={t('settings.ui.autoStartDownloadsDesc')}
          checked={localConfig.ui.auto_start_downloads}
          onChange={checked => onConfigChange('ui', 'auto_start_downloads', checked)}
        />
        <SettingsCheckbox
          label={t('settings.ui.showNotifications')}
          description={t('settings.ui.showNotificationsDesc')}
          checked={localConfig.ui.show_notifications}
          onChange={checked => onConfigChange('ui', 'show_notifications', checked)}
        />
        <SettingsCheckbox
          label={t('settings.ui.notificationSound')}
          description={t('settings.ui.notificationSoundDesc')}
          checked={localConfig.ui.notification_sound ?? true}
          onChange={checked => onConfigChange('ui', 'notification_sound', checked)}
        />
        <SettingsCheckbox
          label={t('settings.ui.minimizeToTray')}
          description={t('settings.ui.minimizeToTrayDesc')}
          checked={localConfig.ui.minimize_to_tray ?? false}
          onChange={checked => onConfigChange('ui', 'minimize_to_tray', checked)}
        />
        <SettingsCheckbox
          label={t('settings.ui.startMinimized')}
          description={t('settings.ui.startMinimizedDesc')}
          checked={localConfig.ui.start_minimized ?? false}
          onChange={checked => onConfigChange('ui', 'start_minimized', checked)}
        />
      </div>
    </div>
  );
};

export const AdvancedSettingsSection: React.FC<SettingsSectionProps> = ({
  localConfig,
  onConfigChange,
}) => {
  const { t } = useI18n();

  return (
    <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
      <div className='flex items-center mb-6'>
        <CogIcon className='w-6 h-6 text-purple-600 dark:text-purple-400 mr-3' />
        <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
          {t('settings.advanced.title')}
        </h2>
      </div>

      <div className='grid grid-cols-1 md:grid-cols-2 gap-6 items-start'>
        <div className='min-w-0'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.advanced.logLevel')}
          </label>
          <select
            value={localConfig.advanced.log_level}
            onChange={e =>
              onConfigChange(
                'advanced',
                'log_level',
                e.target.value as 'error' | 'warn' | 'info' | 'debug'
              )
            }
            className={inputClass}
          >
            <option value='error'>{t('settings.advanced.logError')}</option>
            <option value='warn'>{t('settings.advanced.logWarn')}</option>
            <option value='info'>{t('settings.advanced.logInfo')}</option>
            <option value='debug'>{t('settings.advanced.logDebug')}</option>
          </select>
        </div>

        <div className='min-w-0'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            {t('settings.advanced.maxLogFiles')}
          </label>
          <input
            type='number'
            min='1'
            max='50'
            value={localConfig.advanced.max_log_files}
            onChange={e =>
              parseIntInput(e.target.value, value =>
                onConfigChange('advanced', 'max_log_files', value)
              )
            }
            className={inputClass}
          />
        </div>
      </div>

      <div className='mt-6 space-y-4'>
        <SettingsCheckbox
          label={t('settings.advanced.enableLogging')}
          description={t('settings.advanced.enableLoggingDesc')}
          checked={localConfig.advanced.enable_logging}
          onChange={checked => onConfigChange('advanced', 'enable_logging', checked)}
        />
        <SettingsCheckbox
          label={t('settings.advanced.cleanupOnExit')}
          description={t('settings.advanced.cleanupOnExitDesc')}
          checked={localConfig.advanced.cleanup_on_exit}
          onChange={checked => onConfigChange('advanced', 'cleanup_on_exit', checked)}
        />
      </div>
    </div>
  );
};

interface SettingsCheckboxProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SettingsCheckbox: React.FC<SettingsCheckboxProps> = ({
  label,
  description,
  checked,
  onChange,
}) => (
  <div className='flex items-center justify-between'>
    <div>
      <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>{label}</label>
      <p className='text-xs text-gray-500 dark:text-gray-400'>{description}</p>
    </div>
    <input
      type='checkbox'
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 focus-visible:ring-2 focus-visible:ring-ring dark:bg-gray-700 dark:border-gray-600'
    />
  </div>
);
