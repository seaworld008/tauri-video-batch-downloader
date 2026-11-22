import React, { useState, useCallback } from 'react';
import {
  DocumentArrowUpIcon,
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
import type { ImportPreview, VideoTask } from '../../types';
import {
  importStructuredFileCommand,
  previewImportDataCommand,
  selectImportFileCommand,
} from '../../features/downloads/api/importCommands';
import {
  buildTaskCreationSuccessMessage,
  summarizeTaskCreationReconciliation,
} from '../../features/downloads/state/taskCreationState';
import { selectOutputDirectoryCommand } from '../../features/downloads/api/systemCommands';
import { reportFrontendIssue } from '../../utils/frontendLogging';
import { useI18n } from '../../i18n/hooks';

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
  const { t } = useI18n();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [outputDir, setOutputDir] = useState<string>('');

  const addTasks = useDownloadStore(state => state.addTasks);
  const enqueueDownloads = useDownloadStore(state => state.enqueueDownloads);
  const refreshTasks = useDownloadStore(state => state.refreshTasks);
  const setFilterStatus = useDownloadStore(state => state.setFilterStatus);
  const setSearchQuery = useDownloadStore(state => state.setSearchQuery);
  const setSortBy = useDownloadStore(state => state.setSortBy);
  const recordRecentImport = useDownloadStore(state => state.recordRecentImport);

  const defaultOutputDirFromConfig = useConfigStore(
    state => state.config.download.output_directory
  );
  const autoStartDownloads = useConfigStore(
    state => state?.config?.ui?.auto_start_downloads ?? false
  );

  const previewImportData = async (filePath: string) => {
    setIsLoading(true);
    try {
      const preview = await previewImportDataCommand({
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
      notify.error(
        t('fileImport.previewFailed'),
        error instanceof Error ? error.message : String(error)
      );
      setImportPreview(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = async () => {
    try {
      const selected = await selectImportFileCommand({ defaultPath: selectedFile ?? undefined });

      if (selected) {
        setSelectedFile(selected);
        const previewResult = await previewImportData(selected);
        if (!previewResult) {
          setSelectedFile(null);
        }
      }
    } catch (error) {
      notify.error(
        t('fileImport.selectFileFailed'),
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const handleSelectOutputDir = async () => {
    try {
      const selected = await selectOutputDirectoryCommand({
        title: t('fileImport.selectDirTitle'),
        defaultPath: outputDir || defaultOutputDirFromConfig,
      });

      if (selected) {
        setOutputDir(selected);
      }
    } catch (error) {
      notify.error(
        t('fileImport.selectDirFailed'),
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const executeImport = useCallback(async () => {
    if (!importPreview || !selectedFile) return;

    const backendFieldMapping = buildBackendFieldMapping(importPreview.headers, fieldMapping);
    if (
      !canProceedWithImport(importPreview.headers, fieldMapping) ||
      !backendFieldMapping.video_url
    ) {
      notify.error(t('fileImport.importFailed'), t('fileImport.ensureUrlColumn'));
      return;
    }

    const candidateOutputDir = (outputDir || defaultOutputDirFromConfig || './downloads').trim();
    setIsLoading(true);

    try {
      const importedData = await importStructuredFileCommand({
        filePath: selectedFile,
        fieldMapping: backendFieldMapping,
        encoding: importPreview.encoding,
      });
      const validRows = importedData.filter(item => item.record_url || item.url);

      if (validRows.length === 0) {
        notify.error(t('fileImport.importFailed'), t('fileImport.noValidUrlColumn'));
        return;
      }

      // Record previous tasks to identify new ones
      const existingTasks = useDownloadStore.getState().tasks;
      const previousTaskIds = new Set(existingTasks.map(task => task.id));

      const tasksToAdd: VideoTask[] = validRows.map((item, index) => {
        const url = item.record_url || item.url || '';
        const idSeed = item.record_url || item.url || item.zl_id || item.id || `${index}`;
        const id = generateTaskId(idSeed);
        const title =
          item.kc_name ||
          item.course_name ||
          item.name ||
          t('fileImport.defaultVideoTitle', { index: index + 1 });

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
      if (addedTasks.length === 0) {
        notify.error(t('fileImport.importFailed'), t('fileImport.addQueueFailed'));
        return;
      }

      if (refreshTasks) {
        await refreshTasks().catch(error => {
          reportFrontendIssue('warn', 'file_import_panel:refresh_tasks_failed', error);
        });
      }

      // Identify new tasks for "Recent Imports" logic
      const newTaskIds = addedTasks
        .filter(task => !previousTaskIds.has(task.id))
        .map(task => task.id);

      // Update store with recent imports
      const effectiveSnapshot =
        newTaskIds.length > 0 ? addedTasks.filter(t => newTaskIds.includes(t.id)) : addedTasks;

      recordRecentImport(
        newTaskIds.length > 0 ? newTaskIds : addedTasks.map(t => t.id),
        effectiveSnapshot
      );

      if (autoStartDownloads && newTaskIds.length > 0 && typeof enqueueDownloads === 'function') {
        enqueueDownloads(newTaskIds);
      }

      const reconciliation = summarizeTaskCreationReconciliation(
        existingTasks as unknown as Parameters<typeof summarizeTaskCreationReconciliation>[0],
        addedTasks as unknown as Parameters<typeof summarizeTaskCreationReconciliation>[1]
      );
      const feedbackMessage = buildTaskCreationSuccessMessage({
        ...reconciliation,
        inputCount: importedData.length,
        invalidCount: importedData.length - validRows.length,
      });

      if (reconciliation.createdCount === 0) {
        notify.info(t('fileImport.noNewTasks'), feedbackMessage.replace('未创建新任务：', ''));
      } else if (reconciliation.existingCount > 0) {
        notify.success(t('fileImport.importComplete'), feedbackMessage);
      } else {
        notify.success(feedbackMessage);
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
      notify.error(t('fileImport.importFailed'), String(error));
    } finally {
      setIsLoading(false);
    }
  }, [
    addTasks,
    autoStartDownloads,
    defaultOutputDirFromConfig,
    enqueueDownloads,
    fieldMapping,
    importPreview,
    outputDir,
    refreshTasks,
    selectedFile,
    setFilterStatus,
    recordRecentImport,
    setSearchQuery,
    setSortBy,
    t,
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
            {t('fileImport.dropzoneTitle')}
          </h3>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-2'>
            {t('fileImport.dropzoneSubtitle')}
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
                    {t('fileImport.rowsAndEncoding', {
                      rows: importPreview.total_rows,
                      encoding: importPreview.encoding,
                    })}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedFile(null);
                setImportPreview(null);
                setFieldMapping({});
              }}
              className='p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-400 hover:text-red-500 transition-colors'
            >
              <XMarkIcon className='w-5 h-5' />
            </button>
          </div>

          {importPreview && (
            <>
              {/* Mapping Section */}
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-6'>
                {importPreview.headers.map((header, index) => (
                  <div
                    key={`${header}-${index}`}
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
                      <option value=''>{t('fileImport.ignoreColumn')}</option>
                      <option value='record_url'>{t('fileImport.colUrl')}</option>
                      <option value='zl_id'>{t('fileImport.colZlId')}</option>
                      <option value='zl_name'>{t('fileImport.colZlName')}</option>
                      <option value='kc_id'>{t('fileImport.colKcId')}</option>
                      <option value='kc_name'>{t('fileImport.colKcName')}</option>
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
                  {t('fileImport.changeDir')}
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
                    {t('fileImport.processing')}
                  </>
                ) : (
                  <>
                    <ArrowDownTrayIcon className='w-5 h-5' />
                    {t('fileImport.confirmImport', { count: importPreview.total_rows })}
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
