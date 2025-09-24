import React from 'react';
import { Sidebar } from './Sidebar';
import { HeaderBar } from './HeaderBar';
import { StatusBar } from './StatusBar';
import { useUIStore } from '../../stores/uiStore';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { sidebarOpen, globalLoading, loadingMessage } = useUIStore();

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* 顶部标题栏 */}
      <HeaderBar />
      
      {/* 主要内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 侧边栏 */}
        <Sidebar />
        
        {/* 主内容区 */}
        <main 
          className={`flex-1 overflow-auto transition-all duration-300 ${
            sidebarOpen ? 'ml-0' : '-ml-64'
          }`}
        >
          <div className="p-6 h-full">
            {children}
          </div>
        </main>
      </div>
      
      {/* 底部状态栏 */}
      <StatusBar />
      
      {/* 全局加载覆盖层 */}
      {globalLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 flex items-center space-x-4 shadow-xl">
            <div className="loading-spinner w-6 h-6 border-2 border-primary-600"></div>
            <span className="text-gray-900 dark:text-gray-100 font-medium">
              {loadingMessage || '加载中...'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};