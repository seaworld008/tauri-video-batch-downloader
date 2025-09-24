/**



 * 🚀 优化版下载视图组件



 * 应用了性能监控和优化技术



 * 



 * 优化特性：



 * - React.memo + 智能memoization



 * - 虚拟化大列表显示



 * - 防抖搜索和过滤



 * - 性能监控集成



 * - 内存泄漏防护



 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useDownloadStore } from '../../stores/downloadStore';

import { VideoTable } from './VideoTable';

import { TaskControls } from './TaskControls';

import { DownloadStats } from './DownloadStats';

import { SearchAndFilter } from './SearchAndFilter';

import { EmptyState } from '../Common/EmptyState';

import { ImportView } from '../Import/ImportView';

import { ImportSuccessGuide } from './ImportSuccessGuide';

import { WorkflowTips } from '../Common/WorkflowTips';

import { useImportGuide } from '../../hooks/useImportGuide';

import { VirtualizedTaskList } from '../Optimized/VirtualizedTaskList';

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

// 优化的子组件们 - 使用React.memo

// ====================================================

/**



 * 优化的统计组件



 */

const OptimizedStats = React.memo<{
  stats: DownloadStatsType;
}>(({ stats }) => {
  return (
    <PerformanceProfiler id='DownloadStats'>
      <DownloadStats stats={stats} />
    </PerformanceProfiler>
  );
});

/**



 * 优化的控制组件



 */

const OptimizedTaskControls = React.memo<{
  selectedTasks: string[];

  onStartAll: () => Promise<void> | void;

  onPauseAll: () => Promise<void> | void;

  onDeleteSelected: () => Promise<void> | void;

  disabled: boolean;
}>(({ selectedTasks, onStartAll, onPauseAll, onDeleteSelected, disabled }) => {
  const handleStartAll = () => {
    void onStartAll();
  };

  const handlePauseAll = () => {
    void onPauseAll();
  };

  const handleDeleteSelected = () => {
    void onDeleteSelected();
  };

  return (
    <PerformanceProfiler id='TaskControls'>
      <TaskControls
        selectedTasks={selectedTasks}
        onStartAll={handleStartAll}
        onPauseAll={handlePauseAll}
        onDeleteSelected={handleDeleteSelected}
        disabled={disabled}
      />
    </PerformanceProfiler>
  );
});

/**



 * 优化的搜索和过滤组件



 */

const OptimizedSearchAndFilter = React.memo<{
  searchQuery: string;

  filterStatus: TaskStatus | 'all';

  tasks: VideoTask[];

  onSearchChange: (query: string) => void;

  onFilterChange: (status: TaskStatus | 'all') => void;

  onRefresh: () => Promise<void> | void;
}>(({ searchQuery, filterStatus, tasks, onSearchChange, onFilterChange, onRefresh }) => {
  return (
    <PerformanceProfiler id='SearchAndFilter'>
      <SearchAndFilter
        searchQuery={searchQuery}
        filterStatus={filterStatus}
        tasks={tasks}
        onSearchChange={onSearchChange}
        onFilterChange={onFilterChange}
        onRefresh={onRefresh}
      />
    </PerformanceProfiler>
  );
});

// ====================================================

// 主下载视图组件

// ====================================================

export const OptimizedDownloadsView: React.FC = React.memo(() => {
  const { t } = useI18n();

  const {
    measureRender,

    measureEffect,

    performanceData,
  } = useComponentPerformance('OptimizedDownloadsView');

  const { memoryUsage, takeSnapshot } = useMemoryMonitor(10000); // 每10秒检查内存

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

    // 可以添加更多过滤条件
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
      measureEffect('refreshStats', async () => {
        await refreshStats();
      });
    },

    2000 // 最多每2秒刷新一次
  );

  // 性能优化的回调函数

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
    },

    [setSearchQuery]
  );

  const handleFilterChange = useCallback(
    (status: TaskStatus | 'all') => {
      setFilterStatus(status);
    },

    [setFilterStatus]
  );

  const handleStartAll = useCallback(() => {
    return measureEffect('startAllDownloads', () => startAllDownloads());
  }, [measureEffect, startAllDownloads]);

  const handlePauseAll = useCallback(() => {
    return measureEffect('pauseAllDownloads', () => pauseAllDownloads());
  }, [measureEffect, pauseAllDownloads]);

  const handleDeleteSelected = useCallback(() => {
    return measureEffect('deleteSelected', () => removeTasks(selectedTasks));
  }, [measureEffect, removeTasks, selectedTasks]);

  const handleRefreshTasks = useCallback(() => refreshTasks(), [refreshTasks]);

  const isEmpty = tasks.length === 0;

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
    const shouldUseVirtualization =
      tasks.length > 100 || (memoryUsage && memoryUsage.percentage > 70);

    if (shouldUseVirtualization !== useVirtualization) {
      setUseVirtualization(shouldUseVirtualization);

      console.log(
        `🔄 切换渲染模式: ${shouldUseVirtualization ? '虚拟化' : '常规'} (任务数: ${tasks.length}, 内存: ${memoryUsage?.percentage.toFixed(1)}%)`
      );
    }
  }, [tasks.length, memoryUsage, useVirtualization]);

  // 统计信息刷新

  useEffect(() => {
    let refreshInterval: number | undefined;

    void measureEffect('setupStatsRefresh', async () => {
      await refreshStats();

      refreshInterval = window.setInterval(throttledRefreshStats, 5000);
    });

    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);

        refreshInterval = undefined;
      }
    };
  }, [refreshStats, throttledRefreshStats, measureEffect]);

  useEffect(() => {
    let stateCheckInterval: number | undefined;
    let stopTimeout: number | undefined;

    void measureEffect('setupImportGuide', async () => {
      console.log('?? OptimizedDownloadsView���أ���ǰ����״̬:', guideState);

      const hasGuide = checkAndRestoreGuide();

      console.log('?? ��ʼ״̬�ָ����:', hasGuide);

      if (!guideState.showGuide) {
        stateCheckInterval = window.setInterval(() => {
          console.log('?? ���ڼ������״̬...');

          const hasRestoredState = checkAndRestoreGuide();

          if (hasRestoredState) {
            console.log('? ����״̬�ѻָ�');

            if (stateCheckInterval) {
              clearInterval(stateCheckInterval);
              stateCheckInterval = undefined;
            }
          }
        }, 1000);

        stopTimeout = window.setTimeout(() => {
          if (stateCheckInterval) {
            clearInterval(stateCheckInterval);
            stateCheckInterval = undefined;
          }
        }, 5000);
      }
    });

    return () => {
      if (stateCheckInterval) {
        clearInterval(stateCheckInterval);
      }

      if (stopTimeout) {
        clearTimeout(stopTimeout);
      }
    };
  }, [guideState, checkAndRestoreGuide, measureEffect]);

  // 记录渲染性能

  useEffect(() => {
    measureRender();
  });

  // 数据完整性检查（开发模式）

  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && tasks.length > 0) {
      const integrityCheck = runDataIntegrityCheck();

      if (integrityCheck.duplicates.length > 0 || integrityCheck.corrupted.length > 0) {
        console.warn('⚠️ 数据完整性检查发现问题:', integrityCheck);
      }
    }
  }, [tasks.length, runDataIntegrityCheck]);

  // Memoized计算值

  const displayTasks = useMemo(() => {
    return useVirtualization ? filteredTasks : paginatedData;
  }, [useVirtualization, filteredTasks, paginatedData]);

  const showGuide =
    guideState.showGuide && guideState.taskCount > 0 && workflowStage === 'imported' && !isLoading;

  // 性能信息组件

  const PerformanceInfo = useMemo(() => {
    if (!showPerformanceInfo) return null;

    const validationStats = getValidationStats();

    return (
      <div className='fixed top-4 right-4 bg-black bg-opacity-75 text-white text-xs p-2 rounded z-50 max-w-xs'>
        <div className='font-bold mb-1'>性能监控</div>

        <div>
          渲染: {performanceData.renderCount}次 (平均{performanceData.averageRenderTime.toFixed(1)}
          ms)
        </div>

        <div>
          任务: {tasks.length} | 显示: {displayTasks.length}
        </div>

        <div>搜索中: {isSearching ? '是' : '否'}</div>

        <div>虚拟化: {useVirtualization ? '是' : '否'}</div>

        {memoryUsage && <div>内存: {memoryUsage.percentage.toFixed(1)}%</div>}

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

    performanceData,

    tasks.length,

    displayTasks.length,

    isSearching,

    useVirtualization,

    memoryUsage,

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

        {/* 导入成功引导 */}

        {showGuide && (
          <ImportSuccessGuide
            taskCount={guideState.taskCount}
            selectedCount={guideState.selectedCount}
            onDismiss={dismissGuide}
            onStartDownload={() => void handleStartAll()}
          />
        )}

        {/* 空状态处理 */}

        {isEmpty ? (
          <div className='flex-1 flex flex-col'>
            <div className='flex-1 flex items-center justify-center'>
              <EmptyState
                title={t('downloads.empty.title') || '暂无下载任务'}
                description={t('downloads.empty.description') || '开始导入您的视频链接'}
                action={{
                  label: t('downloads.empty.action') || '导入任务',

                  onClick: () => {
                    console.log('触发导入操作');
                  },
                }}
              />
            </div>
          </div>
        ) : (
          <>
            {/* 统计信息 */}

            <OptimizedStats stats={safeStats} />

            {/* 搜索和过滤 */}

            <OptimizedSearchAndFilter
              searchQuery={searchQuery}
              filterStatus={filterStatus}
              tasks={tasks}
              onSearchChange={handleSearchChange}
              onFilterChange={handleFilterChange}
              onRefresh={handleRefreshTasks}
            />

            {/* 任务控制 */}

            <OptimizedTaskControls
              selectedTasks={selectedTasks}
              onStartAll={handleStartAll}
              onPauseAll={handlePauseAll}
              onDeleteSelected={handleDeleteSelected}
              disabled={isLoading}
            />

            {/* 任务列表 - 智能渲染 */}

            <div className='flex-1 overflow-hidden'>
              {useVirtualization ? (
                <VirtualizedTaskList
                  tasks={displayTasks}
                  itemHeight={80}
                  containerHeight={600}
                  overscan={5}
                  selectedTasks={selectedTasks}
                  className='h-full'
                />
              ) : (
                <div className='h-full flex flex-col'>
                  <VideoTable tasks={displayTasks} />

                  {/* 分页控制 */}

                  {totalPages > 1 && (
                    <div className='flex items-center justify-between px-4 py-3 border-t'>
                      <div className='text-sm text-gray-600'>
                        第 {currentPage} 页，共 {totalPages} 页 (总共 {filteredTasks.length} 项)
                      </div>

                      <div className='flex space-x-2'>
                        <button
                          onClick={prevPage}
                          disabled={!canGoPrev}
                          className='px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50'
                        >
                          上一页
                        </button>

                        <button
                          onClick={nextPage}
                          disabled={!canGoNext}
                          className='px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50'
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
              onAction={workflowStage === 'imported' ? () => void handleStartAll() : undefined}
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
