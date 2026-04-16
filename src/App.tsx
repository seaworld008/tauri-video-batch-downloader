import React, { useEffect, useState } from 'react';
import { UnifiedView } from './components/Unified/UnifiedView';
import { NotificationCenter } from './components/Common/NotificationCenter';
import { useDownloadStore } from './stores/downloadStore';
import { initializeDownloadEventBridge } from './features/downloads/state/downloadEventBridge';
import { useConfigStore } from './stores/configStore';
import { Toaster } from 'react-hot-toast';
import { reportFrontendIssue } from './utils/frontendLogging';

function App() {
  const [isInitialized, setIsInitialized] = useState(false);

  const initDownloadStore = useDownloadStore(state => state.initializeStore);
  const loadConfig = useConfigStore(state => state.loadConfig);

  useEffect(() => {
    void initializeDownloadEventBridge();

    const initializeApp = async () => {
      try {
        await loadConfig();
      } catch (error) {
        reportFrontendIssue('warn', 'app_bootstrap:load_config_failed', error);
      }

      try {
        await initDownloadStore();
      } catch (error) {
        reportFrontendIssue('warn', 'app_bootstrap:initialize_store_failed', error);
      }

      setIsInitialized(true);
    };

    void initializeApp();
  }, [initDownloadStore, loadConfig]);

  if (!isInitialized) {
    return (
      <div className='h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex items-center justify-center'>
        <div className='text-center'>
          <div className='w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4'></div>
          <h2 className='text-xl font-semibold mb-2'>Video Downloader Pro</h2>
          <p className='text-gray-600 dark:text-gray-400'>正在启动...</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 relative font-sans'>
      <UnifiedView />
      <NotificationCenter />
      <Toaster
        position='top-center'
        toastOptions={{
          duration: 4000,
          className:
            'dark:bg-gray-800 dark:text-white shadow-lg border border-gray-200 dark:border-gray-700',
        }}
      />
    </div>
  );
}

export default App;
