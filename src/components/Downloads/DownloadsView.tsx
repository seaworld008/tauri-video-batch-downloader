import React, { useEffect, useMemo } from 'react';
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
import { useI18n } from '../../i18n/hooks';
import { ensureDownloadStats } from '../../utils/downloadStats';

export const DownloadsView: React.FC = () => {
  const { t } = useI18n();
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
  } = useDownloadStore();

  const safeStats = useMemo(() => ensureDownloadStats(stats), [stats]);

  const { guideState, dismissGuide, checkAndRestoreGuide } = useImportGuide();

  useEffect(() => {
    const refreshInterval = setInterval(() => {
      refreshStats();
    }, 2000); // 每2秒刷新一次统计信息

    return () => clearInterval(refreshInterval);
  }, [refreshStats]);

  // 检查是否需要恢复导入引导状态（页面刷新后）- 改进版本
  useEffect(() => {
    console.log('🏠 DownloadsView挂载，当前引导状态:', guideState);

    // 立即检查恢复状态
    const hasGuide = checkAndRestoreGuide();
    console.log('🔄 初始状态恢复结果:', hasGuide);

    // 添加定期检查机制，以防状态同步延迟
    const stateCheckInterval = setInterval(() => {
      if (!guideState.showGuide) {
        console.log('🔍 定期检查引导状态...');
        const hasRestoredState = checkAndRestoreGuide();
        if (hasRestoredState) {
          console.log('✅ 成功恢复引导状态，停止定期检查');
          clearInterval(stateCheckInterval);
        }
      } else {
        console.log('🎯 引导状态已激活，停止定期检查');
        clearInterval(stateCheckInterval);
      }
    }, 300); // 每300ms检查一次，更频繁的检查

    // 3秒后停止检查，避免无限循环
    const stopTimeout = setTimeout(() => {
      console.log('⏰ 停止定期状态检查');
      clearInterval(stateCheckInterval);
    }, 3000);

    return () => {
      clearInterval(stateCheckInterval);
      clearTimeout(stopTimeout);
    };
  }, [checkAndRestoreGuide, guideState]);

  // 添加对guideState变化的响应
  useEffect(() => {
    console.log('📊 引导状态发生变化:', {
      showGuide: guideState.showGuide,
      taskCount: guideState.taskCount,
      selectedCount: guideState.selectedCount,
      timestamp: guideState.timestamp,
    });
  }, [guideState]);

  // 处理开始下载
  const handleStartDownload = async () => {
    try {
      await startAllDownloads();
      // 导入 toast
      const toast = (await import('react-hot-toast')).default;
      toast.success(`开始下载 ${guideState.selectedCount} 个选中的任务`);
    } catch (error) {
      console.error('开始下载失败:', error);
      const toast = (await import('react-hot-toast')).default;
      toast.error(`开始下载失败: ${error}`);
    }
  };

  // 确定当前工作流程阶段
  const getWorkflowStage = () => {
    if (tasks.length === 0) {
      return 'empty';
    }

    const downloadingCount = tasks.filter(t => t.status === 'downloading').length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const failedCount = tasks.filter(t => t.status === 'failed').length;
    const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'paused').length;

    // 如果所有任务都完成了（包括失败的）
    if (completedCount === tasks.length) {
      return 'completed';
    }

    // 如果有任务正在下载
    if (downloadingCount > 0) {
      return 'downloading';
    }

    // 如果有任务但还没开始下载（刚导入的状态）
    if (pendingCount > 0) {
      return 'imported';
    }

    // 默认为导入状态
    return 'imported';
  };

  const workflowStage = getWorkflowStage();
  const downloadingTaskCount = tasks.filter(t => t.status === 'downloading').length;
  const completedTaskCount = tasks.filter(t => t.status === 'completed').length;

  // 过滤和搜索任务
  const filteredTasks = tasks.filter(task => {
    // 状态过滤
    if (filterStatus !== 'all' && task.status !== filterStatus) {
      return false;
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        task.title.toLowerCase().includes(query) ||
        task.url.toLowerCase().includes(query) ||
        task.output_path.toLowerCase().includes(query)
      );
    }

    return true;
  });

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='flex items-center space-x-4'>
          <div className='loading-spinner w-8 h-8 border-2 border-primary-600'></div>
          <span className='text-lg font-medium text-gray-600 dark:text-gray-400'>
            {t('common.loading')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full space-y-6'>
      {/* 统计信息卡片 */}
      <DownloadStats stats={safeStats} />

      {/* 工作流程提示 - 改进版本 */}
      {(() => {
        const shouldShowWorkflowTips = !guideState.showGuide && workflowStage !== 'empty';

        console.log('🎨 WorkflowTips显示判断:', {
          'guideState.showGuide': guideState.showGuide,
          workflowStage: workflowStage,
          'workflowStage !== empty': workflowStage !== 'empty',
          shouldShowWorkflowTips: shouldShowWorkflowTips,
          'tasks.length': tasks.length,
          downloadingTaskCount: downloadingTaskCount,
          completedTaskCount: completedTaskCount,
        });

        return (
          shouldShowWorkflowTips && (
            <WorkflowTips
              stage={workflowStage}
              taskCount={tasks.length}
              downloadingCount={downloadingTaskCount}
              completedCount={completedTaskCount}
              onAction={workflowStage === 'imported' ? handleStartDownload : undefined}
              actionLabel={
                workflowStage === 'imported' ? `开始下载 (${tasks.length} 个任务)` : undefined
              }
            />
          )
        );
      })()}

      {/* 搜索和过滤 */}
      <SearchAndFilter />

      {/* 任务控制按钮 */}
      <TaskControls selectedTasks={selectedTasks} />

      {/* 视频表格或导入区域 */}
      <div className='flex-1 min-h-0'>
        {filteredTasks.length > 0 ? (
          <VideoTable tasks={filteredTasks} />
        ) : tasks.length === 0 ? (
          <div className='space-y-6'>
            {/* 空状态的工作流程提示 */}
            <WorkflowTips stage='empty' taskCount={0} downloadingCount={0} completedCount={0} />
            {/* 导入区域 */}
            <ImportView />
          </div>
        ) : (
          <EmptyState
            title='没有匹配的视频'
            description='当前过滤条件下没有找到匹配的视频任务'
            icon='🔍'
          />
        )}
      </div>

      {/* 导入成功引导 - 改进版本 */}
      {(() => {
        const shouldShowGuide = guideState.showGuide && guideState.taskCount > 0;

        console.log('🎯 ImportSuccessGuide显示判断:', {
          'guideState.showGuide': guideState.showGuide,
          'guideState.taskCount': guideState.taskCount,
          shouldShowGuide: shouldShowGuide,
          fullGuideState: guideState,
        });

        return (
          shouldShowGuide && (
            <ImportSuccessGuide
              taskCount={guideState.taskCount}
              selectedCount={guideState.selectedCount}
              onDismiss={dismissGuide}
              onStartDownload={handleStartDownload}
            />
          )
        );
      })()}
    </div>
  );
};
