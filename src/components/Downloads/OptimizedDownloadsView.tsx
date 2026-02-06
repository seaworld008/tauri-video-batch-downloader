import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDownloadStore } from '../../stores/downloadStore';
import { DashboardToolbar } from './DashboardToolbar';
import { EmptyState } from '../Common/EmptyState';
import { ImportSuccessGuide } from './ImportSuccessGuide';
import { WorkflowTips } from '../Common/WorkflowTips';
import { useImportGuide } from '../../hooks/useImportGuide';
import { VirtualizedTaskList } from '../Optimized/VirtualizedTaskList';
import { VideoTableItem } from './VideoTableItem';
import {
  useOptimizedSearch,
  useMultiFilter,
  useThrottledCallback,
  useComponentPerformance,
  useMemoryMonitor,
  usePagination,
} from '../../hooks/useOptimization';
import { PerformanceProfiler } from '../../utils/performanceMonitor';
import { ensureDownloadStats } from '../../utils/downloadStats';
import { VideoTask, TaskStatus } from '../../schemas';
import type { DownloadStats as DownloadStatsType } from '../../types';
import { useI18n } from '../../i18n/hooks';

// ====================================================
// 主下载视图组件
// ====================================================

export const OptimizedDownloadsView: React.FC = React.memo(() => {
  const { t } = useI18n();

  // 暂时禁用性能监控以避免无限渲染
  // const {
  //   measureRender,
  //   measureEffect,
  //   performanceData,
  // } = useComponentPerformance('OptimizedDownloadsView');

  // const { memoryUsage, takeSnapshot } = useMemoryMonitor(10000); // 每10秒检查内存

  const {
    tasks,
    stats,
    isLoading,
    filterStatus,
    searchQuery,
    selectedTasks,
    refreshTasks,
    refreshStats,
    startAllDownloads,
    pauseAllDownloads,
    removeTasks,
    setSearchQuery,
    setFilterStatus,
    getValidationStats,
    runDataIntegrityCheck,
  } = useDownloadStore();

  const safeStats = useMemo(() => ensureDownloadStats(stats), [stats]);

  const { guideState, dismissGuide, checkAndRestoreGuide } = useImportGuide();

  // 状态管理
  const [useVirtualization, setUseVirtualization] = useState(tasks.length > 100);
  const [showPerformanceInfo, setShowPerformanceInfo] = useState(false);

  // 性能优化的搜索
  const { results: searchResults, isSearching } = useOptimizedSearch(
    tasks,
    searchQuery,
    ['title', 'url'] as (keyof VideoTask)[],
    300 // 300ms防抖
  );

  // 多条件过滤
  const filteredTasks = useMultiFilter(searchResults, {
    status: filterStatus === 'all' ? null : (task: VideoTask) => task.status === filterStatus,
  });

  // 分页（当不使用虚拟化时）
  const {
    currentPage,
    totalPages,
    paginatedData,
    goToPage,
    nextPage,
    prevPage,
    canGoNext,
    canGoPrev,
  } = usePagination(filteredTasks, 50);

  // 节流的刷新函数
  const throttledRefreshStats = useThrottledCallback(
    () => {
      void refreshStats();
    },
    2000 // 最多每2秒刷新一次
  );

  const isEmpty = tasks.length === 0;
  const isFilteredEmpty = !isEmpty && filteredTasks.length === 0;

  const downloadingTaskCount = useMemo(
    () => tasks.filter(t => t.status === 'downloading').length,
    [tasks]
  );

  const completedTaskCount = useMemo(
    () => tasks.filter(t => t.status === 'completed').length,
    [tasks]
  );

  const workflowStage = useMemo(() => {
    if (tasks.length === 0) {
      return 'empty';
    }
    if (downloadingTaskCount > 0) {
      return 'downloading';
    }
    if (completedTaskCount === tasks.length) {
      return 'completed';
    }
    return 'imported';
  }, [tasks.length, downloadingTaskCount, completedTaskCount]);

  // 智能虚拟化切换
  useEffect(() => {
    const shouldUseVirtualization = tasks.length > 100;

    if (shouldUseVirtualization !== useVirtualization) {
      setUseVirtualization(shouldUseVirtualization);
    }
  }, [tasks.length, useVirtualization]);

  // 统计信息刷新
  useEffect(() => {
    let refreshInterval: number | undefined;

    const setupRefresh = async () => {
      await refreshStats();
      refreshInterval = window.setInterval(throttledRefreshStats, 5000);
    };

    void setupRefresh();

    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = undefined;
      }
    };
  }, [refreshStats, throttledRefreshStats]);

  // Memoized计算值
  const displayTasks = useMemo(() => {
    return useVirtualization ? filteredTasks : paginatedData;
  }, [useVirtualization, filteredTasks, paginatedData]);

  const showGuide =
    guideState.showGuide && guideState.taskCount > 0 && workflowStage === 'imported' && !isLoading;

  // 稳定的 refreshTasks 回调
  const handleRefresh = useCallback(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const resolveTranslation = useCallback(
    (key: string, fallbackKey?: string, fallbackValue?: string) => {
      const primary = t(key);
      if (primary && primary !== key) {
        return primary;
      }
      if (fallbackKey) {
        const fallback = t(fallbackKey);
        if (fallback && fallback !== fallbackKey) {
          return fallback;
        }
      }
      return fallbackValue ?? primary;
    },
    [t]
  );

  const emptyTitle = resolveTranslation(
    'downloads.empty.title',
    'downloads.empty.noTasks',
    '暂无下载任务'
  );
  const emptyDescription = resolveTranslation(
    'downloads.empty.description',
    'downloads.empty.noTasksDescription',
    '开始导入您的视频链接'
  );
  const emptyActionLabel = resolveTranslation(
    'downloads.empty.action',
    'downloads.empty.importButton',
    '导入任务'
  );
  const noMatchesTitle = resolveTranslation(
    'downloads.empty.noMatches',
    undefined,
    '没有匹配的任务'
  );
  const noMatchesDescription = resolveTranslation(
    'downloads.empty.noMatchesDescription',
    undefined,
    '请调整搜索条件或过滤器'
  );

  // 性能信息组件（简化版本）
  const PerformanceInfo = useMemo(() => {
    if (!showPerformanceInfo) return null;
    const validationStats = getValidationStats();
    return (
      <div className='fixed top-4 right-4 bg-black bg-opacity-75 text-white text-xs p-2 rounded z-50 max-w-xs'>
        <div className='font-bold mb-1'>性能监控</div>
        <div>
          任务: {tasks.length} | 显示: {displayTasks.length}
        </div>
        <div>搜索中: {isSearching ? '是' : '否'}</div>
        <div>虚拟化: {useVirtualization ? '是' : '否'}</div>
        <div>验证: {validationStats.successRate.toFixed(1)}%</div>
        <button
          onClick={() => setShowPerformanceInfo(false)}
          className='text-red-400 hover:text-red-300 mt-1'
        >
          关闭
        </button>
      </div>
    );
  }, [
    showPerformanceInfo,
    tasks.length,
    displayTasks.length,
    isSearching,
    useVirtualization,
    getValidationStats,
  ]);

  // 渲染
  return (
    <PerformanceProfiler
      id='OptimizedDownloadsView'
      onRender={(id, phase, actualDuration) => {
        if (actualDuration > 16) {
          console.warn(`🐌 ${id} 渲染较慢: ${actualDuration.toFixed(2)}ms (${phase})`);
        }
      }}
    >
      <div className='h-full flex flex-col bg-white dark:bg-gray-900'>
        {/* 性能监控按钮 */}
        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={() => setShowPerformanceInfo(!showPerformanceInfo)}
            className='fixed bottom-4 right-4 bg-blue-600 text-white p-2 rounded-full text-xs z-40 hover:bg-blue-700'
          >
            📊
          </button>
        )}

        {/* 性能信息面板 */}
        {PerformanceInfo}

        {/* 顶部工具栏 - 整合了搜索、过滤和批量操作 */}
        <DashboardToolbar onRefresh={handleRefresh} />

        {/* 导入成功引导 */}
        {showGuide && (
          <ImportSuccessGuide
            taskCount={guideState.taskCount}
            selectedCount={guideState.selectedCount}
            onDismiss={dismissGuide}
            onStartDownload={() => void startAllDownloads()}
          />
        )}

        {/* 加载状态 */}
        {isLoading ? (
          <div className='flex-1 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400'>
            {resolveTranslation('common.loading', undefined, '加载中...')}
          </div>
        ) : isEmpty ? (
          <div className='flex-1 flex flex-col'>
            <div className='flex-1 flex items-center justify-center'>
              <EmptyState
                title={emptyTitle}
                description={emptyDescription}
                action={{
                  label: emptyActionLabel,
                  onClick: () => {
                    console.log('触发导入操作');
                  },
                }}
              />
            </div>
          </div>
        ) : isFilteredEmpty ? (
          <div className='flex-1 flex flex-col'>
            <div className='flex-1 flex items-center justify-center'>
              <EmptyState
                title={noMatchesTitle}
                description={noMatchesDescription}
                action={{
                  label: emptyActionLabel,
                  onClick: () => {
                    console.log('触发导入操作');
                  },
                }}
              />
            </div>
          </div>
        ) : (
          <>
            {/* 任务列表 - 智能渲染 */}
            <div className='flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900'>
              {useVirtualization ? (
                <VirtualizedTaskList overscan={5} className='h-full' />
              ) : (
                <div className='h-full flex flex-col overflow-y-auto'>
                  <div className='divide-y divide-gray-100 dark:divide-gray-800'>
                    {displayTasks.map(task => (
                      <VideoTableItem key={task.id} task={task} />
                    ))}
                  </div>

                  {/* 分页控制 */}
                  {totalPages > 1 && (
                    <div className='flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'>
                      <div className='text-sm text-gray-600 dark:text-gray-400'>
                        第 {currentPage} 页，共 {totalPages} 页 (总共 {filteredTasks.length} 项)
                      </div>

                      <div className='flex space-x-2'>
                        <button
                          onClick={prevPage}
                          disabled={!canGoPrev}
                          className='px-3 py-1 text-sm bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors'
                        >
                          上一页
                        </button>

                        <button
                          onClick={nextPage}
                          disabled={!canGoNext}
                          className='px-3 py-1 text-sm bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors'
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 工作流提示 */}
            <WorkflowTips
              stage={workflowStage}
              taskCount={tasks.length}
              downloadingCount={downloadingTaskCount}
              completedCount={completedTaskCount}
              onAction={workflowStage === 'imported' ? () => void startAllDownloads() : undefined}
              actionLabel={
                workflowStage === 'imported'
                  ? t('downloads.controls.startAll') || '开始所有任务'
                  : undefined
              }
            />
          </>
        )}
      </div>
    </PerformanceProfiler>
  );
});

OptimizedDownloadsView.displayName = 'OptimizedDownloadsView';

export default OptimizedDownloadsView;
