import type { VideoTask } from '../../../schemas';
import { checkDataIntegrity } from '../../../utils/dataValidator';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

export const warnTaskIntegrityIssues = (tasks: VideoTask[]): void => {
  const integrityCheck = checkDataIntegrity(tasks);

  if (integrityCheck.duplicates.length > 0 || integrityCheck.corrupted.length > 0) {
    reportFrontendDiagnosticIfEnabled(
      'warn',
      'task_creation_state:integrity_issues_detected',
      integrityCheck
    );
  }
};

export const mergeCreatedTasks = (
  currentTasks: VideoTask[],
  incomingTasks: VideoTask[]
): VideoTask[] => {
  const updatedTasks = [...currentTasks];
  const indexById = new Map(updatedTasks.map((task, index) => [task.id, index]));

  for (const task of incomingTasks) {
    const existingIndex = indexById.get(task.id);
    if (existingIndex !== undefined) {
      updatedTasks[existingIndex] = task;
    } else {
      indexById.set(task.id, updatedTasks.length);
      updatedTasks.push(task);
    }
  }

  return updatedTasks;
};

export interface TaskCreationReconciliation {
  createdCount: number;
  existingCount: number;
  completedCount: number;
  resumableCount: number;
  pendingCount: number;
  activeCount: number;
  failedCount: number;
  cancelledCount: number;
}

export const summarizeTaskCreationReconciliation = (
  currentTasks: VideoTask[],
  incomingTasks: VideoTask[]
): TaskCreationReconciliation => {
  const existingIds = new Set(currentTasks.map(task => task.id));

  return incomingTasks.reduce<TaskCreationReconciliation>(
    (summary, task) => {
      const existedBefore = existingIds.has(task.id);

      if (existedBefore) {
        summary.existingCount += 1;
      } else {
        summary.createdCount += 1;
      }

      if (task.status === 'completed') {
        summary.completedCount += 1;
      } else if (
        task.status === 'paused' ||
        (task.downloaded_size > 0 && task.status === 'pending')
      ) {
        summary.resumableCount += 1;
      } else if (task.status === 'pending') {
        summary.pendingCount += 1;
      } else if (task.status === 'downloading' || task.status === 'committing') {
        summary.activeCount += 1;
      } else if (task.status === 'failed') {
        summary.failedCount += 1;
      } else if (task.status === 'cancelled') {
        summary.cancelledCount += 1;
      }

      return summary;
    },
    {
      createdCount: 0,
      existingCount: 0,
      completedCount: 0,
      resumableCount: 0,
      pendingCount: 0,
      activeCount: 0,
      failedCount: 0,
      cancelledCount: 0,
    }
  );
};

export const buildTaskCreationStatePatch = ({
  currentTasks,
  incomingTasks,
  invalidCount,
  totalItems,
}: {
  currentTasks: VideoTask[];
  incomingTasks: VideoTask[];
  invalidCount: number;
  totalItems: number;
}) => ({
  tasks: mergeCreatedTasks(currentTasks, incomingTasks),
  isLoading: false,
  lastValidationTime: Date.now(),
  validationErrors: invalidCount > 0 ? [`部分任务验证失败 (${invalidCount}/${totalItems})`] : [],
});

export const buildTaskCreationSuccessMessage = ({
  createdCount,
  existingCount = 0,
  completedCount = 0,
  resumableCount = 0,
  pendingCount = 0,
  failedCount = 0,
  inputCount,
  invalidCount,
}: {
  createdCount: number;
  existingCount?: number;
  completedCount?: number;
  resumableCount?: number;
  pendingCount?: number;
  failedCount?: number;
  inputCount: number;
  invalidCount: number;
}): string => {
  const statusParts = [
    completedCount > 0 ? `已完成 ${completedCount}` : null,
    resumableCount > 0 ? `可续传 ${resumableCount}` : null,
    pendingCount > 0 ? `等待 ${pendingCount}` : null,
    failedCount > 0 ? `失败 ${failedCount}` : null,
  ].filter(Boolean);
  const statusSuffix = statusParts.length > 0 ? `（${statusParts.join('、')}）` : '';
  const invalidSuffix = invalidCount > 0 ? `，已跳过 ${invalidCount} 个无效任务` : '';

  if (createdCount === 0 && existingCount > 0) {
    return `未创建新任务：已识别 ${existingCount} 个已有任务${statusSuffix}${invalidSuffix}`;
  }

  if (existingCount > 0) {
    return `新增 ${createdCount} 个任务，识别已有 ${existingCount} 个${statusSuffix}${invalidSuffix}`;
  }

  if (invalidCount > 0) {
    return `已添加 ${createdCount}/${inputCount} 个任务 - 已跳过 ${invalidCount} 个无效任务`;
  }

  return `已添加 ${createdCount} 个下载任务`;
};
