import React, { useMemo } from 'react';
import {
  HomeIcon,
  Cog6ToothIcon,
  InformationCircleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { useUIStore } from '../../stores/uiStore';
import { useDownloadStore } from '../../stores/downloadStore';
import type { ViewType } from '../../types';

interface SidebarItem {
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeColor?: string;
}

export const Sidebar: React.FC = () => {
  const currentView = useUIStore(state => state.currentView);
  const setCurrentView = useUIStore(state => state.setCurrentView);
  const sidebarOpen = useUIStore(state => state.sidebarOpen);
  const stats = useDownloadStore(state => state.stats);
  const tasks = useDownloadStore(state => state.tasks);

  const pendingCount = useMemo(() => tasks.filter(t => t.status === 'pending').length, [tasks]);

  const sidebarItems: SidebarItem[] = [
    {
      id: 'dashboard',
      label: '仪表板',
      icon: HomeIcon,
    },
    {
      id: 'import',
      label: '导入任务',
      icon: PlusIcon,
      badge: pendingCount > 0 ? pendingCount : undefined,
      badgeColor: 'bg-yellow-500',
    },
    {
      id: 'settings',
      label: '设置',
      icon: Cog6ToothIcon,
    },
    {
      id: 'about',
      label: '关于',
      icon: InformationCircleIcon,
    },
  ];

  if (!sidebarOpen) {
    return null;
  }

  return (
    <aside className='w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full transition-colors duration-300'>
      {/* Logo / 标题区域 */}
      <div className='h-16 flex items-center px-6 border-b border-gray-100 dark:border-gray-800'>
        <div className='text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600'>
          Video Downloader
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className='flex-1 px-3 py-6 space-y-1 overflow-y-auto'>
        {sidebarItems.map(item => {
          const isActive = currentView === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`
                w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group
                ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                }
              `}
            >
              <div className='flex items-center space-x-3'>
                <Icon
                  className={`w-5 h-5 transition-colors ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300'
                  }`}
                />
                <span>{item.label}</span>
              </div>

              {item.badge && (
                <span
                  className={`
                  inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white rounded-full min-w-[1.25rem] h-5
                  ${item.badgeColor || 'bg-gray-500'}
                `}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 底部统计信息卡片 */}
      <div className='p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50'>
        <div className='bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
              任务概览
            </span>
            <span className='text-xs font-bold text-gray-900 dark:text-gray-100'>
              {stats.total_tasks}
            </span>
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <div className='flex flex-col p-2 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/20'>
              <span className='text-xs text-green-600 dark:text-green-400 mb-1'>已完成</span>
              <span className='text-lg font-bold text-green-700 dark:text-green-300'>
                {stats.completed_tasks}
              </span>
            </div>

            <div className='flex flex-col p-2 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20'>
              <span className='text-xs text-blue-600 dark:text-blue-400 mb-1'>进行中</span>
              <span className='text-lg font-bold text-blue-700 dark:text-blue-300'>
                {stats.active_downloads}
              </span>
            </div>
          </div>

          {/* 存储空间/总下载 */}
          <div className='pt-2 border-t border-gray-100 dark:border-gray-700'>
            <div className='flex justify-between items-center text-xs'>
              <span className='text-gray-500 dark:text-gray-400'>已下载总计</span>
              <span className='font-mono font-medium text-gray-700 dark:text-gray-300'>
                {formatBytes(stats.total_downloaded)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

// 格式化字节大小的工具函数
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
