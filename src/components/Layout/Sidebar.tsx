import React from 'react';
import { 
  HomeIcon,
  ArrowDownTrayIcon,
  Cog6ToothIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { useUIStore } from '../../stores/uiStore';
import { useDownloadStore } from '../../stores/downloadStore';
import type { ViewType } from '../../types';

interface SidebarItem {
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

export const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, sidebarOpen } = useUIStore();
  const { stats } = useDownloadStore();

  const sidebarItems: SidebarItem[] = [
    {
      id: 'dashboard',
      label: '仪表板',
      icon: HomeIcon,
    },
    {
      id: 'downloads',
      label: '下载管理',
      icon: ArrowDownTrayIcon,
      badge: stats.active_downloads > 0 ? stats.active_downloads : undefined,
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
    <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
      {/* 导航菜单 */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        {sidebarItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`
                w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all duration-200
                ${isActive
                  ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
                }
              `}
            >
              <div className="flex items-center space-x-3">
                <Icon 
                  className={`w-5 h-5 ${
                    isActive 
                      ? 'text-primary-600 dark:text-primary-400' 
                      : 'text-gray-400 dark:text-gray-500'
                  }`} 
                />
                <span className="font-medium">{item.label}</span>
              </div>
              
              {item.badge && (
                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-primary-600 rounded-full min-w-[1.25rem] h-5">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 底部统计信息 */}
      <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-700">
        <div className="space-y-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">
            统计信息
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {stats.total_tasks}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                总任务
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                {stats.completed_tasks}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                已完成
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                {stats.active_downloads}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                进行中
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                {stats.failed_tasks}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                失败
              </div>
            </div>
          </div>

          {/* 总下载量显示 */}
          <div className="text-center pt-2 border-t border-gray-200 dark:border-gray-600">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {formatBytes(stats.total_downloaded)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              累计下载
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