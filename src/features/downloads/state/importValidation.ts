import type { ImportedData } from '../../../schemas';
import {
  normalizeImportedData,
  validateImportDataList,
  type BatchValidationResult,
} from '../../../utils/dataValidator';

const formatImportValidationMessages = (
  invalidItems: BatchValidationResult<ImportedData>['invalidItems'],
  limit: number
): string[] =>
  invalidItems
    .slice(0, limit)
    .map(item => `第${item.index + 1}行: ${item.errors.map(error => error.message).join(', ')}`);

export const validateImportedRows = (
  rawRows: unknown[]
): {
  validImportedData: ImportedData[];
  invalidCount: number;
  successRate: number;
  totalItems: number;
  validationErrorMessages: string[];
} => {
  const normalizedImportData = rawRows.map(data => normalizeImportedData(data));
  const importValidation = validateImportDataList(normalizedImportData, {
    stopOnFirstError: false,
  });

  if (importValidation.validItems.length === 0) {
    const errorDetails = formatImportValidationMessages(importValidation.invalidItems, 5).join('; ');
    throw new Error(`所有导入数据均无效。错误详情: ${errorDetails}`);
  }

  return {
    validImportedData: importValidation.validItems,
    invalidCount: importValidation.invalidItems.length,
    successRate: importValidation.successRate,
    totalItems: importValidation.totalItems,
    validationErrorMessages: formatImportValidationMessages(importValidation.invalidItems, 10),
  };
};