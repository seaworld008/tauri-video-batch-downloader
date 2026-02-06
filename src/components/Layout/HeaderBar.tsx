import React from 'react';
import {
  Bars3Icon,
  MoonIcon,
  SunIcon,
  ComputerDesktopIcon,
  XMarkIcon,
  MinusIcon,
} from '@heroicons/react/24/outline';
import { useUIStore } from '../../stores/uiStore';
import { useTheme } from '../../contexts/ThemeContext';
import { appWindow } from '@tauri-apps/api/window';

export const HeaderBar: React.FC = () => {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const { theme, setTheme, isDark } = useTheme();

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
  };

  const handleClose = async () => {
    await appWindow.close();
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return <SunIcon className='w-5 h-5' />;
      case 'dark':
        return <MoonIcon className='w-5 h-5' />;
      default:
        return <ComputerDesktopIcon className='w-5 h-5' />;
    }
  };

  const cycleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('system');
    } else {
      setTheme('light');
    }
  };

  return (
    <div
      className='h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 select-none'
      data-tauri-drag-region
    >
      {/* 左侧：菜单按钮和标题 */}
      <div className='flex items-center space-x-4'>
        <button
          onClick={toggleSidebar}
          className='p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
          title={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
        >
          <Bars3Icon className='w-5 h-5 text-gray-600 dark:text-gray-400' />
        </button>

        <div className='flex items-center space-x-3'>
          <div className='w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center'>
            <span className='text-white text-sm font-bold'>VD</span>
          </div>
          <div>
            <h1 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
              Video Downloader Pro
            </h1>
            <p className='text-xs text-gray-500 dark:text-gray-400'>v1.0.0</p>
          </div>
        </div>
      </div>

      {/* 右侧：工具按钮和窗口控制 */}
      <div className='flex items-center space-x-2'>
        {/* 主题切换 */}
        <button
          onClick={cycleTheme}
          className='p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
          title={`当前主题: ${theme === 'system' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}`}
        >
          {getThemeIcon()}
        </button>

        {/* 分隔线 */}
        <div className='w-px h-6 bg-gray-200 dark:bg-gray-600 mx-2'></div>

        {/* 窗口控制按钮 */}
        <div className='flex items-center space-x-1'>
          <button
            onClick={handleMinimize}
            className='p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
            title='最小化'
          >
            <MinusIcon className='w-4 h-4 text-gray-600 dark:text-gray-400' />
          </button>

          <button
            onClick={handleMaximize}
            className='p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
            title='最大化'
          >
            <svg
              className='w-4 h-4 text-gray-600 dark:text-gray-400'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4'
              />
            </svg>
          </button>

          <button
            onClick={handleClose}
            className='p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 hover:text-red-600 transition-colors'
            title='关闭'
          >
            <XMarkIcon className='w-4 h-4' />
          </button>
        </div>
      </div>
    </div>
  );
};
