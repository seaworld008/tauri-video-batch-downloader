import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CogIcon,
  FolderIcon,
  CloudArrowDownIcon,
  ComputerDesktopIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useConfigStore } from '../../stores/configStore';
import { notify } from '../../stores/uiStore';
import type { AppConfig } from '../../types';

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
      console.error('保存设置失败:', error);
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
      console.error('重置设置失败:', error);
      notify.error('重置失败', error as string);
    } finally {
      setIsLoading(false);
    }
  };

  const selectOutputDirectory = async () => {
    try {
      const selected = await invoke<string>('select_output_directory');
      if (selected && localConfig) {
        handleConfigChange('download', 'output_directory', selected);
      }
    } catch (error) {
      console.error('选择目录失败:', error);
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
        {/* 下载设置 */}
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
                  handleConfigChange('download', 'concurrent_downloads', parseInt(e.target.value))
                }
                data-testid='concurrent-downloads'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
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
                onChange={e =>
                  handleConfigChange('download', 'retry_attempts', parseInt(e.target.value))
                }
                data-testid='retry-attempts'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
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
                onChange={e =>
                  handleConfigChange('download', 'timeout_seconds', parseInt(e.target.value))
                }
                data-testid='timeout-setting'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              />
            </div>

            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                下载目录
              </label>
              <div className='flex items-center space-x-2'>
                <input
                  type='text'
                  value={localConfig.download.output_directory}
                  onChange={e => handleConfigChange('download', 'output_directory', e.target.value)}
                  className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                />
                <button
                  onClick={selectOutputDirectory}
                  className='px-3 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors'
                >
                  <FolderIcon className='w-4 h-4' />
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
              onChange={e => handleConfigChange('download', 'user_agent', e.target.value)}
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
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
              onChange={e => handleConfigChange('download', 'proxy', e.target.value || undefined)}
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            />
          </div>
        </div>

        {/* UI 设置 */}
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
                  handleConfigChange('ui', 'theme', e.target.value as 'light' | 'dark' | 'system')
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
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
                onChange={e => handleConfigChange('ui', 'language', e.target.value)}
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              >
                <option value='zh-CN'>简体中文</option>
                <option value='en-US'>English</option>
              </select>
            </div>
          </div>

          <div className='mt-6 space-y-4'>
            <div className='flex items-center justify-between'>
              <div>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  显示已完成任务
                </label>
                <p className='text-xs text-gray-500 dark:text-gray-400'>
                  在任务列表中显示已完成的下载任务
                </p>
              </div>
              <input
                type='checkbox'
                checked={localConfig.ui.show_completed_tasks}
                onChange={e => handleConfigChange('ui', 'show_completed_tasks', e.target.checked)}
                className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
              />
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  自动开始下载
                </label>
                <p className='text-xs text-gray-500 dark:text-gray-400'>添加任务后自动开始下载</p>
              </div>
              <input
                type='checkbox'
                checked={localConfig.ui.auto_start_downloads}
                onChange={e => handleConfigChange('ui', 'auto_start_downloads', e.target.checked)}
                className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
              />
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  显示通知
                </label>
                <p className='text-xs text-gray-500 dark:text-gray-400'>显示下载完成和错误通知</p>
              </div>
              <input
                type='checkbox'
                checked={localConfig.ui.show_notifications}
                onChange={e => handleConfigChange('ui', 'show_notifications', e.target.checked)}
                className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
              />
            </div>
          </div>
        </div>

        {/* 高级设置 */}
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
                  handleConfigChange(
                    'advanced',
                    'log_level',
                    e.target.value as 'error' | 'warn' | 'info' | 'debug'
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
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
                onChange={e =>
                  handleConfigChange('advanced', 'max_log_files', parseInt(e.target.value))
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              />
            </div>
          </div>

          <div className='mt-6 space-y-4'>
            <div className='flex items-center justify-between'>
              <div>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  启用日志记录
                </label>
                <p className='text-xs text-gray-500 dark:text-gray-400'>记录应用运行和错误日志</p>
              </div>
              <input
                type='checkbox'
                checked={localConfig.advanced.enable_logging}
                onChange={e => handleConfigChange('advanced', 'enable_logging', e.target.checked)}
                className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
              />
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  退出时清理
                </label>
                <p className='text-xs text-gray-500 dark:text-gray-400'>应用退出时清理临时文件</p>
              </div>
              <input
                type='checkbox'
                checked={localConfig.advanced.cleanup_on_exit}
                onChange={e => handleConfigChange('advanced', 'cleanup_on_exit', e.target.checked)}
                className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
              />
            </div>
          </div>
        </div>
      </div>

      {/* 保存按钮 - 固定在底部 */}
      <div className='fixed bottom-0 right-0 w-full max-w-md bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-4 shadow-lg z-10'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-4'>
            {hasChanges && (
              <div className='flex items-center text-amber-600 dark:text-amber-400'>
                <ExclamationTriangleIcon className='w-5 h-5 mr-2' />
                <span className='text-sm'>有未保存的更改</span>
              </div>
            )}
          </div>

          <div className='flex items-center space-x-3'>
            <button
              onClick={handleResetSettings}
              disabled={isLoading}
              className='px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors'
            >
              恢复默认
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={isLoading || !hasChanges}
              data-testid='save-settings'
              className='inline-flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            >
              {isLoading ? (
                <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2'></div>
              ) : (
                <CheckCircleIcon className='w-4 h-4 mr-2' />
              )}
              {isLoading ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
