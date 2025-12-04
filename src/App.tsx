import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { UnifiedView } from './components/Unified/UnifiedView';
import { NotificationCenter } from './components/Common/NotificationCenter';
import { useDownloadStore, initializeProgressListener } from './stores/downloadStore';
import { useConfigStore } from './stores/configStore';
import { Toaster } from 'react-hot-toast';

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const { initializeStore: initDownloadStore } = useDownloadStore();
  const { loadConfig } = useConfigStore();

  useEffect(() => {
    // 初始化进度监听器
    void initializeProgressListener();

    const initializeApp = async () => {
      try {
        setInitError(null);
        await invoke('get_system_info');
      } catch (error) {
        console.warn('Backend connection failed:', error);
        setInitError(error instanceof Error ? error.message : String(error));
      }

      try {
        await loadConfig();
      } catch (error) {
        console.warn('Config load failed, using defaults instead.', error);
      }

      try {
        await initDownloadStore();
      } catch (error) {
        console.warn('Download store initialization failed:', error);
      }

      setIsInitialized(true);
    };

    void initializeApp();
  }, [initDownloadStore, loadConfig]);

  // Loading Screen
  if (!isInitialized) {
    return (
      <div className="h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold mb-2">Video Downloader Pro</h2>
          <p className="text-gray-600 dark:text-gray-400">正在启动...</p>
        </div>
      </div>
    );
  }

  // Init Error Screen
  if (initError) {
    return (
      <div className="h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex items-center justify-center p-8">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md text-center border border-red-200 dark:border-red-900">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">⚠️</span>
          </div>
          <h3 className="text-xl font-bold text-red-600 dark:text-red-400 mb-4">启动失败</h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{initError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            重新尝试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 relative font-sans">
      <UnifiedView />
      <NotificationCenter />
      <Toaster position="top-center" toastOptions={{
        duration: 4000,
        className: 'dark:bg-gray-800 dark:text-white shadow-lg border border-gray-200 dark:border-gray-700'
      }} />
    </div>
  );
}

export default App;
