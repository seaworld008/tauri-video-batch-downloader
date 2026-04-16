import * as dialog from '@tauri-apps/plugin-dialog';
import { invokeTauri } from '../../../utils/tauriBridge';
import type { ImportPreview, ImportedData } from '../../../types';

export type ImportFileCommand = 'import_csv_file' | 'import_excel_file';

export interface PreviewImportDataOptions {
  filePath: string;
  maxRows?: number;
  encoding?: string;
}

export interface ImportStructuredFileOptions {
  filePath: string;
  fieldMapping: Record<string, string>;
  encoding?: string;
  sheetName?: string | null;
}

export interface SelectImportFileOptions {
  defaultPath?: string;
}

export const resolveImportFileCommand = (filePath: string): ImportFileCommand => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.ods')) {
    return 'import_excel_file';
  }

  return 'import_csv_file';
};

export const previewImportDataCommand = async ({
  filePath,
  maxRows,
  encoding,
}: PreviewImportDataOptions): Promise<ImportPreview> => {
  const args: Record<string, unknown> = { filePath };

  if (typeof maxRows === 'number') {
    args.maxRows = maxRows;
  }

  if (encoding) {
    args.encoding = encoding;
  }

  return invokeTauri<ImportPreview>('preview_import_data', args);
};

export const importStructuredFileCommand = async ({
  filePath,
  fieldMapping,
  encoding,
  sheetName,
}: ImportStructuredFileOptions): Promise<ImportedData[]> => {
  const command = resolveImportFileCommand(filePath);
  const args: Record<string, unknown> = {
    filePath,
    fieldMapping,
  };

  if (encoding) {
    args.encoding = encoding;
  }

  if (command === 'import_excel_file') {
    args.sheetName = sheetName ?? null;
  }

  return invokeTauri<ImportedData[]>(command, args);
};

export const importRawFileCommand = async ({
  filePath,
  encoding,
  sheetName,
}: Omit<ImportStructuredFileOptions, 'fieldMapping'>): Promise<ImportedData[]> => {
  const command = resolveImportFileCommand(filePath);
  const args: Record<string, unknown> = { filePath };

  if (encoding) {
    args.encoding = encoding;
  }

  if (command === 'import_excel_file') {
    args.sheetName = sheetName ?? null;
  }

  return invokeTauri<ImportedData[]>(command, args);
};

export const selectImportFileCommand = async ({
  defaultPath,
}: SelectImportFileOptions = {}): Promise<string | null> => {
  const selected = await dialog.open({
    title: '选择导入文件',
    defaultPath,
    filters: [
      {
        name: '支持的文件',
        extensions: ['csv', 'xlsx', 'xls'],
      },
    ],
  });

  return typeof selected === 'string' ? selected : null;
};
