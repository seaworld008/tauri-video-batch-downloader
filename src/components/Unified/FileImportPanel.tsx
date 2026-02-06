import React, { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import {
  DocumentArrowUpIcon,
  TableCellsIcon,
  CheckCircleIcon,
  XMarkIcon,
  ArrowDownTrayIcon,
  FolderOpenIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import { notify } from '../../stores/uiStore';
import {
  buildDefaultFieldMapping,
  buildBackendFieldMapping,
  canProceedWithImport,
} from '../../utils/importMapping';
import type { ImportPreview, ImportedData, VideoTask } from '../../types';

interface FileImportPanelProps {
  onImportSuccess?: () => void;
}

// 简单的 ID 生成器
const generateTaskId = (() => {
  let counter = 0;
  const sanitizeSeed = (seed?: string | null) =>
    (seed ?? 'task')
      .toString()
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '')
      .slice(-16) || 'task';

  return (seed?: string | null) => {
    counter = (counter + 1) % 1000000;
    return `${sanitizeSeed(seed)}_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
  };
})();

export const FileImportPanel: React.FC<FileImportPanelProps> = ({ onImportSuccess }) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [outputDir, setOutputDir] = useState<string>('');

  const {
    addTasks,
    refreshTasks,
    setFilterStatus,
    setSearchQuery,
    setSortBy,
    recordRecentImport,
    tasks,
  } = useDownloadStore();

  const defaultOutputDirFromConfig = useConfigStore(
    state => state.config.download.output_directory
  );

  const getImportCommand = (filePath: string): 'import_csv_file' | 'import_excel_file' => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.ods')) {
      return 'import_excel_file';
    }
    return 'import_csv_file';
  };

  const previewImportData = async (filePath: string) => {
    setIsLoading(true);
    try {
      const preview = await invoke<ImportPreview>('preview_import_data', {
        filePath,
        maxRows: 10,
      });

      setImportPreview(preview);
      const defaultMapping = buildDefaultFieldMapping(
        preview.headers,
        preview.field_mapping,
        fieldMapping
      );
      setFieldMapping(defaultMapping);
      return { preview, mapping: defaultMapping };
    } catch (error) {
      notify.error('数据预览失败', String(error));
      setImportPreview(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = async () => {
    try {
      const selected = await open({
        title: '选择导入文件',
        filters: [
          {
            name: '支持的文件',
            extensions: ['csv', 'xlsx', 'xls'],
          },
        ],
      });

      if (selected && !Array.isArray(selected)) {
        setSelectedFile(selected);
        const previewResult = await previewImportData(selected);
        if (!previewResult) {
          setSelectedFile(null);
        }
      }
    } catch (error) {
      notify.error('文件选择失败', error as string);
    }
  };

  const handleSelectOutputDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择下载目录',
      });

      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
      }
    } catch (error) {
      notify.error('选择目录失败', error as string);
    }
  };

  const executeImport = useCallback(async () => {
    if (!importPreview || !selectedFile) return;

    const backendFieldMapping = buildBackendFieldMapping(importPreview.headers, fieldMapping);
    if (
      !canProceedWithImport(importPreview.headers, fieldMapping) ||
      !backendFieldMapping.video_url
    ) {
      notify.error('导入失败', '请确保视频链接列已经正确识别');
      return;
    }

    const candidateOutputDir = (outputDir || defaultOutputDirFromConfig || './downloads').trim();
    setIsLoading(true);

    try {
      const command = getImportCommand(selectedFile);
      const importArgs: Record<string, unknown> = {
        filePath: selectedFile,
        fieldMapping: backendFieldMapping,
        encoding: importPreview.encoding,
      };
      if (command === 'import_excel_file') {
        importArgs.sheetName = null;
      }

      const importedData = await invoke<ImportedData[]>(command, importArgs);
      const validRows = importedData.filter(item => item.record_url || item.url);

      if (validRows.length === 0) {
        notify.error('导入失败', '未在文件中找到有效的视频链接列');
        return;
      }

      // Record previous tasks to identify new ones
      const previousTaskIds = new Set(tasks.map(task => task.id));

      const tasksToAdd: VideoTask[] = validRows.map((item, index) => {
        const url = item.record_url || item.url || '';
        const idSeed = item.record_url || item.url || item.zl_id || item.id || `${index}`;
        const id = generateTaskId(idSeed);
        const title = item.kc_name || item.course_name || item.name || `视频_${index + 1}`;

        return {
          id,
          url,
          title,
          output_path: candidateOutputDir,
          status: 'pending' as const,
          progress: 0,
          downloaded_size: 0,
          speed: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          video_info: {
            zl_id: item.zl_id,
            zl_name: item.zl_name,
            record_url: item.record_url,
            kc_id: item.kc_id,
            kc_name: item.kc_name,
            id: item.id,
            name: item.name,
            url: item.url,
            course_id: item.course_id,
            course_name: item.course_name,
          },
        };
      });

      const addedTasks = await addTasks(tasksToAdd);
      const resolvedTasks = addedTasks.length > 0 ? addedTasks : tasksToAdd;

      if (refreshTasks) {
        await refreshTasks().catch(console.warn);
      }

      // Identify new tasks for "Recent Imports" logic
      const newTaskIds = resolvedTasks
        .filter(task => !previousTaskIds.has(task.id))
        .map(task => task.id);

      // Update store with recent imports
      const effectiveSnapshot =
        newTaskIds.length > 0
          ? resolvedTasks.filter(t => newTaskIds.includes(t.id))
          : resolvedTasks; // Fallback if sync failed

      recordRecentImport(
        newTaskIds.length > 0 ? newTaskIds : resolvedTasks.map(t => t.id),
        effectiveSnapshot
      );

      const createdCount = newTaskIds.length;
      if (createdCount === 0) {
        notify.info('未创建新任务', '导入内容可能已经存在于下载列表中。');
      } else if (createdCount < validRows.length) {
        notify.success(`成功导入 ${createdCount}/${validRows.length} 个下载任务`);
      } else {
        notify.success(`成功导入 ${createdCount} 个下载任务`);
      }

      // Reset UI
      setSelectedFile(null);
      setImportPreview(null);
      setFieldMapping({});

      // Reset Filters to show everything (or new items)
      setFilterStatus('all');
      setSearchQuery('');
      setSortBy('created_at', 'desc');

      // Call onSuccess callback
      if (onImportSuccess) {
        onImportSuccess();
      }
    } catch (error) {
      notify.error('导入失败', String(error));
    } finally {
      setIsLoading(false);
    }
  }, [
    addTasks,
    defaultOutputDirFromConfig,
    fieldMapping,
    importPreview,
    outputDir,
    refreshTasks,
    selectedFile,
    setFilterStatus,
    recordRecentImport,
    setSearchQuery,
    setSortBy,
    tasks,
    onImportSuccess,
  ]);

  return (
    <div className='space-y-6 max-w-4xl mx-auto'>
      {!selectedFile ? (
        <div
          onClick={handleFileSelect}
          className='border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all group'
        >
          <DocumentArrowUpIcon className='w-12 h-12 text-gray-400 group-hover:text-blue-500 mx-auto mb-4 transition-colors' />
          <h3 className='text-lg font-semibold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'>
            点击选择 CSV 或 Excel 文件
          </h3>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-2'>
            支持自动识别编码和字段映射
          </p>
        </div>
      ) : (
        <div className='bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fadeIn'>
          {/* File Header */}
          <div className='flex items-center justify-between mb-6 pb-4 border-b border-gray-100 dark:border-gray-700'>
            <div className='flex items-center gap-3'>
              <div className='p-2 bg-green-100 dark:bg-green-900/30 rounded-lg'>
                <CheckCircleIcon className='w-6 h-6 text-green-600 dark:text-green-400' />
              </div>
              <div>
                <div className='font-medium text-gray-900 dark:text-gray-100'>
                  {selectedFile.split(/[\\/]/).pop()}
                </div>
                {importPreview && (
                  <div className='text-xs text-gray-500'>
                    {importPreview.total_rows} 行数据 • {importPreview.encoding}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => setSelectedFile(null)}
              className='p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-400 hover:text-red-500 transition-colors'
            >
              <XMarkIcon className='w-5 h-5' />
            </button>
          </div>

          {importPreview && (
            <>
              {/* Mapping Section */}
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-6'>
                {importPreview.headers.map(header => (
                  <div
                    key={header}
                    className='flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 p-2 rounded-lg'
                  >
                    <label className='text-sm text-gray-500 w-1/3 truncate' title={header}>
                      {header}
                    </label>
                    <select
                      value={fieldMapping[header] || ''}
                      onChange={e => setFieldMapping({ ...fieldMapping, [header]: e.target.value })}
                      className='flex-1 text-sm border-none bg-transparent focus:ring-0 text-gray-900 dark:text-gray-200 font-medium'
                    >
                      <option value=''>忽略此列</option>
                      <option value='record_url'>视频链接 (record_url)</option>
                      <option value='zl_id'>专栏ID (zl_id)</option>
                      <option value='zl_name'>专栏名称 (zl_name)</option>
                      <option value='kc_id'>课程ID (kc_id)</option>
                      <option value='kc_name'>课程名称 (kc_name)</option>
                    </select>
                  </div>
                ))}
              </div>

              {/* Output Directory */}
              <div className='flex gap-2 mb-6'>
                <div className='flex-1 relative'>
                  <input
                    type='text'
                    value={outputDir || defaultOutputDirFromConfig || './downloads'}
                    readOnly
                    className='w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-600'
                  />
                  <FolderOpenIcon className='w-5 h-5 text-gray-400 absolute left-3 top-2.5' />
                </div>
                <button
                  onClick={handleSelectOutputDir}
                  className='px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors'
                >
                  更改目录
                </button>
              </div>

              {/* Action Button */}
              <button
                onClick={executeImport}
                disabled={isLoading}
                className='w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium shadow-sm transition-all flex items-center justify-center gap-2'
              >
                {isLoading ? (
                  <>
                    <ArrowPathIcon className='w-5 h-5 animate-spin' />
                    正在处理...
                  </>
                ) : (
                  <>
                    <ArrowDownTrayIcon className='w-5 h-5' />
                    确认导入 {importPreview.total_rows} 个任务
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
