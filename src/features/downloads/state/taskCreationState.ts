import type { VideoTask } from '../../../schemas';
import { checkDataIntegrity } from '../../../utils/dataValidator';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

export const warnTaskIntegrityIssues = (tasks: VideoTask[]): void => {
  const integrityCheck = checkDataIntegrity(tasks);

  if (integrityCheck.duplicates.length > 0 || integrityCheck.corrupted.length > 0) {
    reportFrontendDiagnosticIfEnabled('warn', 'task_creation_state:integrity_issues_detected', integrityCheck);
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
  validationErrors:
    invalidCount > 0 ? [`部分任务验证失败 (${invalidCount}/${totalItems})`] : [],
});

export const buildTaskCreationSuccessMessage = ({
  createdCount,
  inputCount,
  invalidCount,
}: {
  createdCount: number;
  inputCount: number;
  invalidCount: number;
}): string =>
  invalidCount === 0
    ? `已添加 ${createdCount} 个下载任务`
    : `已添加 ${createdCount}/${inputCount} 个任务 - 已跳过 ${invalidCount} 个无效任务`;