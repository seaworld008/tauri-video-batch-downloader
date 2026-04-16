import type toast from 'react-hot-toast';

import {
  buildImportTaskPreviewSummary,
  buildImportValidationCompletionSummary,
  buildImportValidationPatch,
  prepareImportFromFileSuccess,
} from './importFileFlow';

export const executeImportFromFile = async ({
  filePath,
  rawImportedData,
  outputDirectory,
  durationMs,
  addTasks,
  recordValidation,
  setValidationErrors,
  toastApi,
}: {
  filePath: string;
  rawImportedData: unknown[];
  outputDirectory: string;
  durationMs: number;
  addTasks: (tasks: ReturnType<typeof prepareImportFromFileSuccess>['tasks']) => Promise<unknown>;
  recordValidation: (success: boolean, durationMs: number) => void;
  setValidationErrors: (errors: string[]) => void;
  toastApi: Pick<typeof toast, 'success'>;
}) => {
  const {
    importValidation,
    validImportedData,
    tasks,
    successSummary,
    successMessage,
    warningSummary,
    validationErrors,
  } = prepareImportFromFileSuccess({
    filePath,
    rawImportedData,
    outputDirectory,
    durationMs,
  });

  recordValidation(importValidation.invalidCount === 0, durationMs);

  if (warningSummary) {
    setValidationErrors(buildImportValidationPatch(validationErrors).validationErrors);
  }

  await addTasks(tasks);
  toastApi.success(successMessage);

  return {
    validImportedData,
    tasks,
    successSummary,
    warningSummary,
    completionSummary: buildImportValidationCompletionSummary({
      rawCount: rawImportedData.length,
      validCount: validImportedData.length,
      successRate: importValidation.successRate,
    }),
    taskPreviewSummary: buildImportTaskPreviewSummary(tasks),
  };
};
