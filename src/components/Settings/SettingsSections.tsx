import React from 'react';
import {
  CogIcon,
  FolderIcon,
  CloudArrowDownIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';
import type { AppConfig } from '../../types';

type ConfigChangeHandler = (section: keyof AppConfig, key: string, value: any) => void;

const inputClass =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const buttonFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

interface SettingsSectionProps {
  localConfig: AppConfig;
  onConfigChange: ConfigChangeHandler;
}

export const DownloadSettingsSection: React.FC<
  SettingsSectionProps & { onSelectOutputDirectory: () => void }
> = ({ localConfig, onConfigChange, onSelectOutputDirectory }) => (
  <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
    <div className='flex items-center mb-6'>
      <CloudArrowDownIcon className='w-6 h-6 text-blue-600 dark:text-blue-400 mr-3' />
      <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>下载设置</h2>
    </div>

    <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          并发下载数
        </label>
        <input
          type='number'
          min='1'
          max='20'
          value={localConfig.download.concurrent_downloads}
          onChange={e =>
            onConfigChange('download', 'concurrent_downloads', parseInt(e.target.value))
          }
          data-testid='concurrent-downloads'
          className={inputClass}
        />
        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>建议值：3-8</p>
      </div>

      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          重试次数
        </label>
        <input
          type='number'
          min='0'
          max='10'
          value={localConfig.download.retry_attempts}
          onChange={e => onConfigChange('download', 'retry_attempts', parseInt(e.target.value))}
          data-testid='retry-attempts'
          className={inputClass}
        />
      </div>

      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          超时时间 (秒)
        </label>
        <input
          type='number'
          min='10'
          max='300'
          value={localConfig.download.timeout_seconds}
          onChange={e => onConfigChange('download', 'timeout_seconds', parseInt(e.target.value))}
          data-testid='timeout-setting'
          className={inputClass}
        />
      </div>

      <div className='md:col-span-2'>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          默认下载目录
        </label>
        <div className='rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 p-3'>
          <div className='text-sm text-gray-900 dark:text-gray-100 break-all'>
            {localConfig.download.output_directory || '未设置目录'}
          </div>
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-2'>
            这是未来新任务和导入任务的默认保存根目录。开始下载时可以对本次任务临时覆盖，不会修改这里。
          </p>
        </div>
        <div className='mt-3 flex items-center justify-end'>
          <button
            type='button'
            onClick={onSelectOutputDirectory}
            className={`inline-flex items-center px-3 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors ${buttonFocusClass}`}
          >
            <FolderIcon className='w-4 h-4 mr-2' />
            选择目录
          </button>
        </div>
      </div>
    </div>

    <div className='mt-6'>
      <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
        User Agent
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
        代理服务器 (可选)
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

export const UiSettingsSection: React.FC<SettingsSectionProps> = ({
  localConfig,
  onConfigChange,
}) => (
  <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
    <div className='flex items-center mb-6'>
      <ComputerDesktopIcon className='w-6 h-6 text-green-600 dark:text-green-400 mr-3' />
      <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>界面设置</h2>
    </div>

    <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          主题
        </label>
        <select
          value={localConfig.ui.theme}
          onChange={e =>
            onConfigChange('ui', 'theme', e.target.value as 'light' | 'dark' | 'system')
          }
          className={inputClass}
        >
          <option value='system'>跟随系统</option>
          <option value='light'>浅色</option>
          <option value='dark'>深色</option>
        </select>
      </div>

      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          语言
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
        label='显示已完成任务'
        description='在任务列表中显示已完成的下载任务'
        checked={localConfig.ui.show_completed_tasks}
        onChange={checked => onConfigChange('ui', 'show_completed_tasks', checked)}
      />
      <SettingsCheckbox
        label='自动开始下载'
        description='添加任务后自动开始下载'
        checked={localConfig.ui.auto_start_downloads}
        onChange={checked => onConfigChange('ui', 'auto_start_downloads', checked)}
      />
      <SettingsCheckbox
        label='显示通知'
        description='显示下载完成和错误通知'
        checked={localConfig.ui.show_notifications}
        onChange={checked => onConfigChange('ui', 'show_notifications', checked)}
      />
    </div>
  </div>
);

export const AdvancedSettingsSection: React.FC<SettingsSectionProps> = ({
  localConfig,
  onConfigChange,
}) => (
  <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
    <div className='flex items-center mb-6'>
      <CogIcon className='w-6 h-6 text-purple-600 dark:text-purple-400 mr-3' />
      <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>高级设置</h2>
    </div>

    <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          日志级别
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
          <option value='error'>错误</option>
          <option value='warn'>警告</option>
          <option value='info'>信息</option>
          <option value='debug'>调试</option>
        </select>
      </div>

      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          最大日志文件数
        </label>
        <input
          type='number'
          min='1'
          max='50'
          value={localConfig.advanced.max_log_files}
          onChange={e => onConfigChange('advanced', 'max_log_files', parseInt(e.target.value))}
          className={inputClass}
        />
      </div>
    </div>

    <div className='mt-6 space-y-4'>
      <SettingsCheckbox
        label='启用日志记录'
        description='记录应用运行和错误日志'
        checked={localConfig.advanced.enable_logging}
        onChange={checked => onConfigChange('advanced', 'enable_logging', checked)}
      />
      <SettingsCheckbox
        label='退出时清理'
        description='应用退出时清理临时文件'
        checked={localConfig.advanced.cleanup_on_exit}
        onChange={checked => onConfigChange('advanced', 'cleanup_on_exit', checked)}
      />
    </div>
  </div>
);

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
