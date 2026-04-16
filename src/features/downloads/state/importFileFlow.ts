import type { DownloadConfig, ImportedData } from '../../../schemas';
import { buildTasksFromImportedData, type TaskDraft } from './importOrchestration';
import { validateImportedRows } from './importValidation';
import { reportFrontendDiagnostic } from '../../../utils/frontendLogging';

export type ImportFromFileSuccessArtifacts = ReturnType<typeof prepareImportFromFileSuccess>;

export const prepareImportFromFileSuccess = ({
  filePath,
  rawImportedData,
  outputDirectory,
  durationMs,
}: {
  filePath: string;
  rawImportedData: unknown[];
  outputDirectory: DownloadConfig['output_directory'];
  durationMs: number;
}): {
  importValidation: ReturnType<typeof validateImportedRows>;
  validImportedData: ImportedData[];
  tasks: TaskDraft[];
  successSummary: {
    导入文件: string;
    原始数据: number;
    有效数据: number;
    最终任务: number;
    验证耗时: string;
    数据质量: string;
  };
  successMessage: string;
  warningSummary: {
    总数: number;
    有效: number;
    无效: number;
    成功率: string;
  } | null;
  validationErrors: string[];
} => {
  if (!rawImportedData || rawImportedData.length === 0) {
    throw new Error('导入的文件为空或无有效数据');
  }

  const importValidation = validateImportedRows(rawImportedData);
  const validImportedData = importValidation.validImportedData;
  const tasks = buildTasksFromImportedData(validImportedData, outputDirectory);
  const successSummary = buildImportFromFileSuccessSummary({
    filePath,
    rawCount: rawImportedData.length,
    validCount: validImportedData.length,
    taskCount: tasks.length,
    durationMs,
    successRate: importValidation.successRate,
  });
  const successMessage = buildImportFromFileSuccessMessage({
    taskCount: tasks.length,
    rawCount: rawImportedData.length,
    invalidCount: importValidation.invalidCount,
    successRate: importValidation.successRate,
  });

  return {
    importValidation,
    validImportedData,
    tasks,
    successSummary,
    successMessage,
    warningSummary: buildImportValidationWarningSummary(importValidation),
    validationErrors: importValidation.invalidCount > 0 ? importValidation.validationErrorMessages : [],
  };
};

export const buildImportValidationPatch = (
  validationErrors: string[]
): { validationErrors: string[] } => ({
  validationErrors,
});

export const buildImportValidationCompletionSummary = ({
  rawCount,
  validCount,
  successRate,
}: {
  rawCount: number;
  validCount: number;
  successRate: number;
}) => ({
  原始数量: rawCount,
  有效数量: validCount,
  成功率: `${(successRate * 100).toFixed(1)}%`,
});

export const buildImportTaskPreviewSummary = (
  tasks: TaskDraft[]
): {
  count: number;
  sample: TaskDraft | undefined;
} => ({
  count: tasks.length,
  sample: tasks[0],
});

export const buildImportValidationWarningSummary = (
  importValidation: ReturnType<typeof validateImportedRows>
): {
  总数: number;
  有效: number;
  无效: number;
  成功率: string;
} | null => {
  if (importValidation.invalidCount === 0) {
    return null;
  }

  return {
    总数: importValidation.totalItems,
    有效: importValidation.validImportedData.length,
    无效: importValidation.invalidCount,
    成功率: `${(importValidation.successRate * 100).toFixed(1)}%`,
  };
};

export const buildImportFromFileSuccessSummary = ({
  filePath,
  rawCount,
  validCount,
  taskCount,
  durationMs,
  successRate,
}: {
  filePath: string;
  rawCount: number;
  validCount: number;
  taskCount: number;
  durationMs: number;
  successRate: number;
}) => ({
  导入文件: filePath,
  原始数据: rawCount,
  有效数据: validCount,
  最终任务: taskCount,
  验证耗时: `${durationMs.toFixed(2)}ms`,
  数据质量: `${(successRate * 100).toFixed(1)}%`,
});

export const buildImportFromFileSuccessMessage = ({
  taskCount,
  rawCount,
  invalidCount,
  successRate,
}: {
  taskCount: number;
  rawCount: number;
  invalidCount: number;
  successRate: number;
}): string => {
  if (successRate === 1) {
    return `已导入 ${taskCount} 个任务`;
  }

  return `已导入 ${taskCount}/${rawCount} 个任务 - 已跳过 ${invalidCount} 条无效数据`;
};

export const buildImportFromFileFailurePatch = (
  existingErrors: string[],
  error: unknown
) => ({
  isImporting: false,
  validationErrors: [
    ...existingErrors,
    `文件导入失败: ${error instanceof Error ? error.message : String(error)}`,
  ],
  lastValidationTime: Date.now(),
});

export const logImportFromFileFailureContext = ({
  filePath,
  validationDuration,
  validationStats,
}: {
  filePath: string;
  validationDuration: number;
  validationStats: unknown;
}): void => {
  reportFrontendDiagnostic('error', 'import_file_flow:failure_context', {
    文件路径: filePath,
    验证耗时: `${validationDuration.toFixed(2)}ms`,
    验证统计: validationStats,
  });
};
