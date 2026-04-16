import type toast from 'react-hot-toast';

import { executeImportFromFile } from './importFileAction';
import {
  buildImportFromFileFailurePatch,
  logImportFromFileFailureContext,
} from './importFileFlow';
import { reportFrontendDiagnosticIfEnabled } from '../../../utils/frontendLogging';

export const executeImportFromFileStoreAction = async ({
  filePath,
  outputDirectory,
  importFile,
  addTasks,
  recordValidation,
  getValidationStats,
  getValidationErrors,
  applyValidationPatch,
  applyFailurePatch,
  toastApi,
}: {
  filePath: string;
  outputDirectory: string;
  importFile: (filePath: string) => Promise<unknown[]>;
  addTasks: Parameters<typeof executeImportFromFile>[0]['addTasks'];
  recordValidation: Parameters<typeof executeImportFromFile>[0]['recordValidation'];
  getValidationStats: () => unknown;
  getValidationErrors: () => string[];
  applyValidationPatch: (patch: { validationErrors: string[] }) => void;
  applyFailurePatch: (patch: ReturnType<typeof buildImportFromFileFailurePatch>) => void;
  toastApi: Pick<typeof toast, 'success'>;
}) => {
  const validationStartTime = performance.now();

  try {
    const rawImportedData = await importFile(filePath);

    reportFrontendDiagnosticIfEnabled('info', 'import_file_store_action:raw_data_loaded', {
      count: rawImportedData.length,
      sample: rawImportedData[0],
    });

    reportFrontendDiagnosticIfEnabled('info', 'import_file_store_action:validation:start');

    const validationDuration = performance.now() - validationStartTime;
    return await executeImportFromFile({
      filePath,
      rawImportedData,
      outputDirectory,
      durationMs: validationDuration,
      addTasks,
      recordValidation,
      setValidationErrors: validationErrors => {
        applyValidationPatch({ validationErrors });
      },
      toastApi,
    });
  } catch (error) {
    const validationDuration = performance.now() - validationStartTime;

    recordValidation(false, validationDuration);

    applyFailurePatch(buildImportFromFileFailurePatch(getValidationErrors(), error));

    logImportFromFileFailureContext({
      filePath,
      validationDuration,
      validationStats: getValidationStats(),
    });

    throw error;
  }
};
