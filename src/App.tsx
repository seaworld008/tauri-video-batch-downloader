import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { MainLayout } from './components/Layout/MainLayout';
import { DownloadsView } from './components/Downloads/DownloadsView';
import { OptimizedDownloadsView } from './components/Downloads/OptimizedDownloadsView';
import { ImportView } from './components/Import/ImportView';
import { SettingsView } from './components/Settings/SettingsView';
import { PerformanceDashboard } from './components/Performance/PerformanceDashboard';
import { useDownloadStore } from './stores/downloadStore';
import { useConfigStore } from './stores/configStore';
import { useUIStore } from './stores/uiStore';
import { useAutoSync } from './hooks/useAutoSync';
import { useComponentPerformance, useMemoryMonitor } from './hooks/useOptimization';
import { perfMonitor, PerformanceProfiler } from './utils/performanceMonitor';

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [useOptimizedView, setUseOptimizedView] = useState(false);
  const [showPerformanceDashboard, setShowPerformanceDashboard] = useState(false);
  
  const { initializeStore: initDownloadStore, tasks } = useDownloadStore();
  const { loadConfig } = useConfigStore();
  const { currentView } = useUIStore();
  
  // 性能监控
  const { measureEffect, performanceData } = useComponentPerformance('App');
  const { memoryUsage } = useMemoryMonitor(10000); // 每10秒检查内存
  
  // 启用自动状态同步 - 增强版本带性能监控
  useAutoSync({
    intervalMs: 30000, // 30秒检查一次
    enabled: isInitialized && !initError, // 只有在初始化完成且无错误时才启用
    enablePerformanceMonitoring: true, // 启用性能监控
    onSyncCompleted: (success) => {
      if (!success) {
        console.warn('⚠️ 定期状态同步失败');
      }
    },
    onValidationFailed: (error) => {
      console.error('❌ 状态验证失败:', error);
      // 性能监控记录
      perfMonitor.recordDataProcessing('StateValidation.failed', 1, performance.now());
    }
  });
  
  // 智能视图切换：根据任务数量和性能情况自动切换
  useEffect(() => {
    const shouldUseOptimized = 
      tasks.length > 50 || // 任务数超过50
      (memoryUsage && memoryUsage.percentage > 75) || // 内存使用超过75%
      performanceData.averageRenderTime > 20; // 平均渲染时间超过20ms
    
    if (shouldUseOptimized !== useOptimizedView) {
      setUseOptimizedView(shouldUseOptimized);
      console.log(`🔄 智能切换视图模式: ${shouldUseOptimized ? '优化模式' : '标准模式'}`, {
        任务数: tasks.length,
        内存使用: memoryUsage?.percentage,
        渲染时间: performanceData.averageRenderTime
      });
    }
  }, [tasks.length, memoryUsage, performanceData.averageRenderTime, useOptimizedView]);

  useEffect(() => {
    // 安全的异步初始化 - 增强版本带性能监控
    const initializeApp = async () => {
      await measureEffect('appInitialization', async () => {
      try {
        console.log('🚀 Starting application initialization...');
        setInitError(null);
        
        // 使用更保守的初始化方式
        console.log('1. Testing Tauri commands...');
        try {
          await invoke('get_system_info');
          console.log('✅ Tauri backend is responsive');
        } catch (error) {
          console.warn('⚠️ Tauri backend not ready:', error);
          throw new Error(`Backend connection failed: ${error}`);
        }
        
        console.log('2. Loading configuration...');
        try {
          await loadConfig();
          console.log('✅ Configuration loaded');
        } catch (error) {
          console.warn('⚠️ Config load failed, using defaults:', error);
        }
        
        console.log('3. Initializing stores...');
        try {
          await initDownloadStore();
          console.log('✅ Download store initialized');
        } catch (error) {
          console.warn('⚠️ Store initialization failed:', error);
        }
        
        console.log('4. Setting up download manager listeners...');
        try {
          // 监听下载管理器状态
          const { listen } = await import('@tauri-apps/api/event');
          
          await listen('download_manager_ready', (event) => {
            console.log('✅ Download manager is ready');
          });
          
          await listen('download_manager_error', (event) => {
            console.error('❌ Download manager failed:', event.payload);
            setInitError(`下载管理器启动失败: ${event.payload}`);
          });
          
          // 初始化进度监听器
          const { initializeProgressListener } = await import('./stores/downloadStore');
          initializeProgressListener();
          console.log('✅ Progress listener initialized');
        } catch (error) {
          console.warn('⚠️ Download manager listeners setup failed:', error);
        }
        
        console.log('✅ Application initialized successfully');
        
        // 性能监控初始化
        perfMonitor.recordDataProcessing('App.initialization', 1, performance.now());
        
        setIsInitialized(true);
      } catch (error) {
        console.error('❌ Failed to initialize application:', error);
        
        // 性能监控记录错误
        perfMonitor.recordDataProcessing('App.initializationError', 1, performance.now());
        
        setInitError(error instanceof Error ? error.message : String(error));
        setIsInitialized(true); // 仍然显示UI，但带有错误状态
      }
      }); // 结束 measureEffect
    };

    initializeApp();
  }, [initDownloadStore, loadConfig, measureEffect]);

  const checkSystemDependencies = async () => {
    try {
      // 检查 FFmpeg
      const ffmpegAvailable = await invoke<boolean>('check_ffmpeg').catch(() => false);
      if (!ffmpegAvailable) {
        console.warn('⚠️ FFmpeg not found - M3U8 downloads may not work properly');
      }

      // 检查 yt-dlp
      const ytDlpAvailable = await invoke<boolean>('check_yt_dlp').catch(() => false);
      if (!ytDlpAvailable) {
        console.warn('⚠️ yt-dlp not found - YouTube downloads will not work');
      }
    } catch (error) {
      console.error('❌ Failed to check system dependencies:', error);
    }
  };

  // 如果还没有初始化完成，显示加载界面
  if (!isInitialized) {
    return (
      <div className="h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold mb-2">正在启动 Video Downloader Pro</h2>
          <p className="text-gray-600 dark:text-gray-400">请稍候，正在初始化应用程序...</p>
        </div>
      </div>
    );
  }

  // 如果有初始化错误，显示错误信息但仍然尝试渲染基本UI
  if (initError) {
    console.warn('App initialized with errors:', initError);
  }

  const renderCurrentView = () => {
    // 如果有初始化错误，显示错误状态的downloads view
    if (initError) {
      return (
        <div className="p-8 text-center">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
              初始化出现问题
            </h3>
            <p className="text-red-600 dark:text-red-400 mb-4">
              {initError}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              重新加载应用
            </button>
          </div>
          <div className="text-gray-600 dark:text-gray-400">
            尽管出现错误，您仍可以尝试使用应用的基本功能。
          </div>
        </div>
      );
    }

    switch (currentView) {
      case 'downloads':
        return useOptimizedView ? <OptimizedDownloadsView /> : <DownloadsView />;
      case 'import':
        return <ImportView />;
      case 'settings':
        return <SettingsView />;
      case 'performance':
        return (
          <div className="p-8">
            <h2 className="text-2xl font-bold mb-4">性能监控</h2>
            <button
              onClick={() => setShowPerformanceDashboard(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              打开性能面板
            </button>
          </div>
        );
      case 'about':
        return <div className="p-8 text-center text-gray-600 dark:text-gray-400">About View - Coming Soon</div>;
      default:
        return (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-4xl">
              <div className="w-24 h-24 mx-auto mb-8 text-primary-500">
                <svg
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              
              <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Video Downloader Pro
              </h1>
              
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-12 max-w-2xl mx-auto">
                欢迎使用专业级视频批量下载工具。支持HTTP、M3U8、YouTube等多种视频源，
                具备现代化界面和强大的下载管理功能。
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto">
                <FeatureCard
                  icon="🚀"
                  title="高性能下载"
                  description="多线程并发下载，支持断点续传，智能错误恢复"
                />
                <FeatureCard
                  icon="📱"
                  title="现代化界面"
                  description="响应式设计，支持暗黑模式，直观的用户体验"
                />
                <FeatureCard
                  icon="🎯"
                  title="智能管理"
                  description="批量处理，进度追踪，完整的任务管理系统"
                />
              </div>
              
              <div className="mt-12 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
                  开始使用
                </h3>
                <p className="text-blue-700 dark:text-blue-300 text-sm">
                  点击左侧导航栏的 <strong>"导入任务"</strong> 开始批量导入视频链接，
                  或前往 <strong>"下载管理"</strong> 查看和控制下载任务。
                </p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <PerformanceProfiler id="App" onRender={(id, phase, actualDuration) => {
      if (actualDuration > 50) {
        console.warn(`🐌 App整体渲染过慢: ${actualDuration.toFixed(2)}ms (${phase})`);
      }
    }}>
      <div className="h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <MainLayout>
          {renderCurrentView()}
        </MainLayout>
        
        {/* 性能监控面板 */}
        <PerformanceDashboard
          isOpen={showPerformanceDashboard}
          onClose={() => setShowPerformanceDashboard(false)}
        />
        
        {/* 开发模式的性能快速访问按钮 */}
        {process.env.NODE_ENV === 'development' && (
          <div className="fixed top-4 right-4 z-40">
            <button
              onClick={() => setShowPerformanceDashboard(true)}
              className="bg-blue-600 text-white p-2 rounded-full text-xs hover:bg-blue-700 shadow-lg"
              title="打开性能监控"
            >
              📈
            </button>
          </div>
        )}
        
        {/* 性能状态指示器 */}
        {(useOptimizedView || (memoryUsage && memoryUsage.percentage > 70)) && (
          <div className="fixed bottom-4 left-4 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded z-30">
            {useOptimizedView && '🚀 优化模式'}
            {memoryUsage && memoryUsage.percentage > 70 && (
              <span className="ml-2 text-yellow-300">
                🟡 内存: {memoryUsage.percentage.toFixed(0)}%
              </span>
            )}
          </div>
        )}
      </div>
    </PerformanceProfiler>
  );
}

// 特性卡片组件
interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description }) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
    <div className="text-4xl mb-4 text-center">{icon}</div>
    <h3 className="text-xl font-semibold mb-3 text-center">{title}</h3>
    <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">{description}</p>
  </div>
);

export default App;