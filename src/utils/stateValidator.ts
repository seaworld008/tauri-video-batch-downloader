/**
 * 状态一致性验证机制
 * 确保前端状态与后端状态保持同步
 */
import { handleError } from './errorHandler';
import type { VideoTask, DownloadStats } from '../types';
import { ensureDownloadStats } from './downloadStats';
import { getDownloadStatsCommand, getDownloadTasksCommand } from '../features/downloads/api/runtimeQueries';
import { reportFrontendDiagnostic, reportFrontendDiagnosticIfEnabled, reportFrontendIssue } from './frontendLogging';

export interface StateValidationResult {
  isConsistent: boolean;
  issues: StateIssue[];
  syncSuggestion: SyncStrategy;
}

export interface StateIssue {
  type: 'MISSING_TASK' | 'EXTRA_TASK' | 'STATUS_MISMATCH' | 'STATS_MISMATCH' | 'DATA_CORRUPTION';
  taskId?: string;
  description: string;
  frontendValue?: any;
  backendValue?: any;
}

export type SyncStrategy = 'USE_BACKEND' | 'MANUAL_RESOLVE';

export class StateValidator {
  private static lastValidationTime = 0;
  private static validationInProgress = false;

  /**
   * 验证前端和后端状态是否一致
   */
  static async validateState(
    frontendTasks: VideoTask[],
    frontendStats: DownloadStats
  ): Promise<StateValidationResult> {
    if (this.validationInProgress) {
      reportFrontendDiagnosticIfEnabled('info', 'state_validator:validate:skipped_in_progress');
      return { isConsistent: true, issues: [], syncSuggestion: 'USE_BACKEND' };
    }

    try {
      this.validationInProgress = true;
      this.lastValidationTime = Date.now();

      reportFrontendDiagnosticIfEnabled('info', 'state_validator:validate:start');

      // 获取后端状态
      const [backendTasks, backendStats] = await Promise.all([
        getDownloadTasksCommand<VideoTask>(),
        getDownloadStatsCommand().then(stats => ensureDownloadStats(stats) as DownloadStats),
      ]);

      // 比较任务状态
      const taskIssues = this.compareTasks(frontendTasks, backendTasks);

      // 比较统计信息
      const statsIssues = this.compareStats(frontendStats, backendStats);

      const allIssues = [...taskIssues, ...statsIssues];
      const isConsistent = allIssues.length === 0;

      reportFrontendDiagnosticIfEnabled('info', 'state_validator:validate:result', {
        isConsistent,
        issueCount: allIssues.length,
        taskIssueCount: taskIssues.length,
        statsIssueCount: statsIssues.length,
      });

      return {
        isConsistent,
        issues: allIssues,
        syncSuggestion: this.determineSyncStrategy(allIssues),
      };
    } catch (error) {
      handleError('状态一致性验证', error, false);
      return { isConsistent: false, issues: [], syncSuggestion: 'USE_BACKEND' };
    } finally {
      this.validationInProgress = false;
    }
  }

  /**
   * 比较前端和后端任务
   */
  private static compareTasks(frontendTasks: VideoTask[], backendTasks: VideoTask[]): StateIssue[] {
    const issues: StateIssue[] = [];

    // 创建映射以便快速查找
    const frontendMap = new Map(frontendTasks.map(task => [task.id, task]));
    const backendMap = new Map(backendTasks.map(task => [task.id, task]));

    // 检查缺失的任务（后端有，前端没有）
    for (const [taskId, backendTask] of backendMap) {
      if (!frontendMap.has(taskId)) {
        issues.push({
          type: 'MISSING_TASK',
          taskId,
          description: `前端缺失任务: ${backendTask.title}`,
          backendValue: backendTask,
        });
      }
    }

    // 检查多余的任务（前端有，后端没有）
    for (const [taskId, frontendTask] of frontendMap) {
      if (!backendMap.has(taskId)) {
        issues.push({
          type: 'EXTRA_TASK',
          taskId,
          description: `前端多余任务: ${frontendTask.title}`,
          frontendValue: frontendTask,
        });
      }
    }

    // 检查状态不匹配的任务
    for (const [taskId, frontendTask] of frontendMap) {
      const backendTask = backendMap.get(taskId);
      if (backendTask) {
        const statusIssues = this.compareTaskFields(taskId, frontendTask, backendTask);
        issues.push(...statusIssues);
      }
    }

    return issues;
  }

  /**
   * 比较单个任务的字段
   */
  private static compareTaskFields(
    taskId: string,
    frontendTask: VideoTask,
    backendTask: VideoTask
  ): StateIssue[] {
    const issues: StateIssue[] = [];

    // 关键字段比较
    const criticalFields = ['status', 'progress', 'downloaded_size'] as const;

    for (const field of criticalFields) {
      if (frontendTask[field] !== backendTask[field]) {
        // 对于progress，允许小误差（因为可能存在更新延迟）
        if (field === 'progress') {
          const diff = Math.abs(frontendTask[field] - backendTask[field]);
          if (diff < 1) continue; // 1%以内的误差可以忽略
        }

        issues.push({
          type: 'STATUS_MISMATCH',
          taskId,
          description: `任务 ${frontendTask.title} 的 ${field} 字段不一致`,
          frontendValue: frontendTask[field],
          backendValue: backendTask[field],
        });
      }
    }

    return issues;
  }

  /**
   * 比较统计信息
   */
  private static compareStats(
    frontendStats: DownloadStats,
    backendStats: DownloadStats
  ): StateIssue[] {
    const issues: StateIssue[] = [];

    const statsFields = [
      'total_tasks',
      'completed_tasks',
      'failed_tasks',
      'active_downloads',
      'total_downloaded',
      'average_speed',
      'display_total_speed_bps',
      'queue_paused',
    ] as const;

    for (const field of statsFields) {
      if (frontendStats[field] !== backendStats[field]) {
        issues.push({
          type: 'STATS_MISMATCH',
          description: `统计信息 ${field} 不一致`,
          frontendValue: frontendStats[field],
          backendValue: backendStats[field],
        });
      }
    }

    return issues;
  }

  /**
   * 确定同步策略
   */
  private static determineSyncStrategy(issues: StateIssue[]): SyncStrategy {
    if (issues.length === 0) return 'USE_BACKEND';

    // 分析问题类型
    const hasDataCorruption = issues.some(issue => issue.type === 'DATA_CORRUPTION');

    // 当前正式语义只有两种：
    // - 数据损坏：人工介入
    // - 其余漂移：以后端快照为准
    if (hasDataCorruption) {
      return 'MANUAL_RESOLVE';
    }

    return 'USE_BACKEND';
  }

  /**
   * 执行状态同步
   */
  static async syncStates(
    issues: StateIssue[],
    strategy: SyncStrategy,
    storeUpdater: {
      updateTasks: (tasks: VideoTask[]) => void;
      updateStats: (stats: DownloadStats) => void;
    }
  ): Promise<boolean> {
    try {
      reportFrontendDiagnosticIfEnabled('info', 'state_validator:sync:start', {
        strategy,
        issueCount: issues.length,
      });

      switch (strategy) {
        case 'USE_BACKEND':
          return await this.syncFromBackend(storeUpdater);

        case 'MANUAL_RESOLVE':
          reportFrontendIssue('error', 'state_validator:sync:manual_resolution_required', {
            issueCount: issues.length,
          });
          return false;

        default:
          return await this.syncFromBackend(storeUpdater);
      }
    } catch (error) {
      handleError('状态同步', error, false);
      return false;
    }
  }

  /**
   * 从后端同步状态（最安全的策略）
   */
  private static async syncFromBackend(storeUpdater: {
    updateTasks: (tasks: VideoTask[]) => void;
    updateStats: (stats: DownloadStats) => void;
  }): Promise<boolean> {
    try {
      const [backendTasks, backendStats] = await Promise.all([
        getDownloadTasksCommand<VideoTask>(),
        getDownloadStatsCommand().then(stats => ensureDownloadStats(stats) as DownloadStats),
      ]);

      storeUpdater.updateTasks(backendTasks);
      storeUpdater.updateStats(backendStats);

      reportFrontendDiagnosticIfEnabled('info', 'state_validator:sync_from_backend:success', {
        taskCount: backendTasks.length,
        stats: backendStats,
      });

      return true;
    } catch (error) {
      handleError('从后端同步状态', error, false);
      return false;
    }
  }

  /**
   * 获取上次验证时间
   */
  static getLastValidationTime(): number {
    return this.lastValidationTime;
  }

  /**
   * 检查是否需要验证（基于时间间隔）
   */
  static shouldValidate(intervalMs: number = 30000): boolean {
    return Date.now() - this.lastValidationTime > intervalMs;
  }
}

// 导出便捷函数
export const validateState = StateValidator.validateState.bind(StateValidator);
export const syncStates = StateValidator.syncStates.bind(StateValidator);
export const shouldValidate = StateValidator.shouldValidate.bind(StateValidator);
