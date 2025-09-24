import React, { useState, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { 
  DocumentArrowUpIcon, 
  TableCellsIcon, 
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  PlusIcon,
  PlayIcon,
  LinkIcon,
  XMarkIcon,
  ArrowDownTrayIcon,
  FolderOpenIcon,
  ClipboardDocumentListIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import { notify, useUIStore } from '../../stores/uiStore';
import { useImportGuide } from '../../hooks/useImportGuide';
import { buildDefaultFieldMapping, buildBackendFieldMapping, canProceedWithImport } from '../../utils/importMapping';
import { ImportProgress, SimpleProgress, createImportSteps, type ImportProgressStep } from './ImportProgress';
import { TaskControls } from '../Downloads/TaskControls';
import { VideoTable } from '../Downloads/VideoTable';
import { LoadingButton, StatusMessage, LoadingOverlay } from '../UI/LoadingStates';
import type { ImportPreview, ImportedData, VideoTask } from '../../types';

type ImportTabType = 'file' | 'manual' | 'youtube';

interface ManualUrlEntry {
  id: string;
  url: string;
  title?: string;
  isValid?: boolean;
  isProcessing?: boolean;
  error?: string;
}

interface ImportViewProps {}

export const ImportView: React.FC<ImportViewProps> = () => {
  const [activeTab, setActiveTab] = useState<ImportTabType>('file');
  
  // 文件导入相关状态 (保持原有功能不变)
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [latestImportTaskIds, setLatestImportTaskIds] = useState<string[]>([]);
  const [importSuccess, setImportSuccess] = useState(false); // 新增：导入成功状态
  
  // 导入进度跟踪状态
  const [importSteps, setImportSteps] = useState<ImportProgressStep[]>(createImportSteps());
  const [currentStep, setCurrentStep] = useState<string | undefined>(undefined);
  const [importProgress, setImportProgress] = useState(0);
  const [showDetailedProgress, setShowDetailedProgress] = useState(false);
  
  // 手动添加相关状态
  const [manualUrls, setManualUrls] = useState<ManualUrlEntry[]>([]);
  const [newUrlInput, setNewUrlInput] = useState('');
  const [outputDir, setOutputDir] = useState<string>('');
  const [isValidatingUrls, setIsValidatingUrls] = useState(false);
  
  const {
    addTasks,
    tasks,
    selectedTasks,
    startAllDownloads,
    clearSelection,
  } = useDownloadStore();
  const defaultOutputDirFromConfig = useConfigStore(state => state.config.download.output_directory);
  const setCurrentView = useUIStore(state => state.setCurrentView);

  const canImport = importPreview ? canProceedWithImport(importPreview.headers, fieldMapping) : false;
  const { triggerImportGuide } = useImportGuide();
  const getImportCommand = (filePath: string): 'import_csv_file' | 'import_excel_file' => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.ods')) {
      return 'import_excel_file';
    }
    return 'import_csv_file';
  };

  
  // 进度步骤更新辅助函数
  const updateStep = (stepId: string, status: ImportProgressStep['status'], errorMessage?: string) => {
    setImportSteps(prev => prev.map(step => {
      if (step.id === stepId) {
        const updatedStep = { 
          ...step, 
          status, 
          errorMessage,
          startTime: status === 'processing' ? Date.now() : step.startTime,
          endTime: (status === 'completed' || status === 'error') ? Date.now() : step.endTime,
        };
        return updatedStep;
      }
      return step;
    }));
    
    if (status === 'processing') {
      setCurrentStep(stepId);
    }
  };
  
  const resetProgress = () => {
    setImportSteps(createImportSteps());
    setCurrentStep(undefined);
    setImportProgress(0);
    setShowDetailedProgress(false);
  };

  // 标签页配置 - 符合现代UI设计
  const tabs = [
    { 
      id: 'file' as ImportTabType, 
      name: '批量导入', 
      icon: DocumentArrowUpIcon,
      description: '从 CSV/Excel 文件导入',
      color: 'blue'
    },
    { 
      id: 'manual' as ImportTabType, 
      name: '手动添加', 
      icon: PlusIcon,
      description: '单个或多个链接添加',
      color: 'green'
    },
    { 
      id: 'youtube' as ImportTabType, 
      name: 'YouTube', 
      icon: PlayIcon,
      description: '专业 YouTube 下载',
      color: 'red'
    },
  ];

  // ============ 文件导入功能 (保持原有逻辑不变) ============
  const handleFileSelect = async () => {
    console.log('🎯 Debug: handleFileSelect called');
    try {
      console.log('🔍 Opening file dialog...');
      const selected = await open({
        title: '选择导入文件',
        filters: [{
          name: '支持的文件',
          extensions: ['csv', 'xlsx', 'xls']
        }]
      });

      console.log('📋 Dialog result:', { selected, isArray: Array.isArray(selected) });

      if (selected && !Array.isArray(selected)) {
        console.log('📁 File selected:', selected);
        setSelectedFile(selected);
        const previewResult = await previewImportData(selected);
        if (!previewResult) {
          setSelectedFile(null);
        }
      } else {
        console.log('⚠️ File selection cancelled || multiple files selected');
      }
    } catch (error) {
      console.error('❌ 文件选择失败 - 详细错误:', error);
      console.error('❌ 错误类型:', typeof error);
      console.error('❌ 错误内容:', JSON.stringify(error, null, 2));
      notify.error('文件选择失败', error as string);
    }
  };

  const previewImportData = async (filePath: string) => {
    setIsLoading(true);
    console.log('[Import] previewImportData called with:', filePath);
    try {
      console.log('[Import] Invoking preview_import_data', {
        file_path: filePath,
        max_rows: 10
      });

      const preview = await invoke<ImportPreview>('preview_import_data', {
        file_path: filePath,
        max_rows: 10
      });

      console.log('[Import] Preview response:', preview);

      setImportPreview(preview);
      const defaultMapping = buildDefaultFieldMapping(
        preview.headers,
        preview.field_mapping,
        fieldMapping,
      );

      setFieldMapping(defaultMapping);

      return { preview, mapping: defaultMapping };
    } catch (error) {
      console.error('[Import] 数据预览失败:', error);
      notify.error('数据预览失败', String(error));
      setImportPreview(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const executeImport = useCallback(
    async (
      preview: ImportPreview,
      filePath: string,
      mapping: Record<string, string>,
      outputDirOverride?: string
    ) => {
      console.log('[Import] executeImport triggered', { filePath, rows: preview.total_rows });

      const backendFieldMapping = buildBackendFieldMapping(preview.headers, mapping);
      if (!canProceedWithImport(preview.headers, mapping) || !backendFieldMapping.video_url) {
        notify.error('导入失败', '请确保视频链接列已经正确识别');
        return null;
      }

      const candidateOutputDir = (outputDirOverride ?? outputDir ?? '').trim();
      const configOutputDir = (defaultOutputDirFromConfig ?? '').trim();
      const effectiveOutputDir = candidateOutputDir || configOutputDir || './downloads';

      resetProgress();
      setIsLoading(true);
      setShowDetailedProgress(true);

      try {
        updateStep('file-select', 'completed');
        setImportProgress(20);

        updateStep('file-parse', 'processing');
        await new Promise(resolve => setTimeout(resolve, 180));
        updateStep('file-parse', 'completed');
        setImportProgress(40);

        updateStep('data-validate', 'processing');
        await new Promise(resolve => setTimeout(resolve, 180));
        updateStep('data-validate', 'completed');
        setImportProgress(55);

        updateStep('tasks-create', 'processing');

        const command = getImportCommand(filePath);
        const importArgs: Record<string, unknown> = {
          file_path: filePath,
          field_mapping: backendFieldMapping,
          encoding: preview.encoding,
        };
        if (command === 'import_excel_file') {
          importArgs.sheet_name = null;
        }

        const importedData = await invoke<ImportedData[]>(command, importArgs);

        const validRows = importedData.filter(item => item.record_url || item.url);
        if (validRows.length === 0) {
          updateStep('tasks-create', 'error', '未找到有效的视频链接列');
          notify.error('导入失败', '未在文件中找到有效的视频链接列');
          return null;
        }

        if (validRows.length < importedData.length) {
          notify.warning(
            '部分行已跳过',
            `共有 ${importedData.length - validRows.length} 行缺少视频链接，已自动忽略。`
          );
        }

        const previousTaskIds = new Set(useDownloadStore.getState().tasks.map(task => task.id));

        const tasksToAdd: VideoTask[] = validRows.map((item, index) => {
          const url = item.record_url || item.url || '';
          const id = item.zl_id || item.id || `task_${Date.now()}_${index}`;
          const title =
            item.kc_name || item.course_name || item.name || `视频_${index + 1}`;

          return {
            id,
            url,
            title,
            output_path: effectiveOutputDir,
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

        await addTasks(tasksToAdd);

        const updatedTasks = useDownloadStore.getState().tasks;
        const newTaskIds = updatedTasks
          .filter(task => !previousTaskIds.has(task.id))
          .map(task => task.id);

        updateStep('tasks-create', 'completed');
        setImportProgress(72);

        updateStep('backend-sync', 'processing');
        await new Promise(resolve => setTimeout(resolve, 150));
        updateStep('backend-sync', 'completed');
        setImportProgress(88);

        updateStep('ui-update', 'processing');
        await new Promise(resolve => setTimeout(resolve, 150));

        setLatestImportTaskIds(newTaskIds);
        useDownloadStore.setState({ selectedTasks: newTaskIds });

        const createdCount = newTaskIds.length;
        const totalRows = validRows.length;

        if (createdCount === 0) {
          notify.info('未创建新任务', '导入内容可能已经存在于下载列表中。');
        } else if (createdCount < totalRows) {
          notify.success(`成功导入 ${createdCount}/${totalRows} 个下载任务`);
        } else {
          notify.success(`成功导入 ${createdCount} 个下载任务`);
        }

        triggerImportGuide(createdCount, newTaskIds.length);
        updateStep('ui-update', 'completed');
        setImportProgress(100);

        setShowDetailedProgress(false);
        setImportSuccess(false);
        setSelectedFile(null);
        setImportPreview(null);
        setFieldMapping({});
        setOutputDir('');
        setCurrentView('downloads');

        return tasksToAdd;
      } catch (error) {
        console.error('导入失败:', error);
        if (currentStep) {
          updateStep(currentStep, 'error', String(error));
        }
        notify.error('导入失败', String(error));
        setTimeout(() => {
          setShowDetailedProgress(false);
        }, 3000);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [addTasks, currentStep, defaultOutputDirFromConfig, outputDir, resetProgress, setCurrentView, triggerImportGuide, updateStep]
  );


  const handleImport = useCallback(async () => {
    if (!importPreview || !selectedFile) {
      notify.error('导入失败', '请先选择文件');
      return;
    }

    await executeImport(importPreview, selectedFile, fieldMapping, outputDir);
  }, [executeImport, fieldMapping, importPreview, outputDir, selectedFile]);

  // ============ 手动添加功能 ============
  const addNewUrlEntry = () => {
    if (newUrlInput.trim()) {
      const newEntry: ManualUrlEntry = {
        id: Date.now().toString(),
        url: newUrlInput.trim(),
        isValid: undefined,
        isProcessing: false
      };
      setManualUrls([...manualUrls, newEntry]);
      setNewUrlInput('');
    }
  };

  const removeUrlEntry = (id: string) => {
    setManualUrls(manualUrls.filter(entry => entry.id !== id));
  };

  const updateUrlEntry = (id: string, updates: Partial<ManualUrlEntry>) => {
    setManualUrls(manualUrls.map(entry => 
      entry.id === id ? { ...entry, ...updates } : entry
    ));
  };

  const validateUrls = async () => {
    if (manualUrls.length === 0) return;
    
    setIsValidatingUrls(true);
    
    for (const entry of manualUrls) {
      updateUrlEntry(entry.id, { isProcessing: true });
      
      try {
        // 简单的URL验证，也可以调用后端API
        const isValidUrl = /^https?:\/\//.test(entry.url);
        let title = entry.url;
        
        // 如果是YouTube链接，尝试获取标题
        if (entry.url.includes('youtube.com') || entry.url.includes('youtu.be')) {
          try {
            const videoInfo = await invoke('get_video_info', { url: entry.url });
            title = (videoInfo as any).title || entry.url;
          } catch {
            // 静默处理，使用URL作为标题
          }
        }
        
        updateUrlEntry(entry.id, {
          isValid: isValidUrl,
          title: title,
          isProcessing: false,
          error: isValidUrl ? undefined : '无效的URL格式'
        });
      } catch (error) {
        updateUrlEntry(entry.id, {
          isValid: false,
          isProcessing: false,
          error: '验证失败'
        });
      }
    }
    
    setIsValidatingUrls(false);
  };

  const startManualDownload = async () => {
    const validUrls = manualUrls.filter(entry => entry.isValid);
    if (validUrls.length === 0) {
      notify.error('没有有效的URL', '请先添加并验证URL');
      return;
    }

    if (!outputDir) {
      notify.error('请选择输出目录', '');
      return;
    }

    try {
      const videoTasks: VideoTask[] = validUrls.map((entry, index) => ({
        id: `manual_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        url: entry.url,
        title: entry.title || `手动添加_${index + 1}`,
        output_path: outputDir,
        status: 'pending' as const,
        progress: 0,
        downloaded_size: 0,
        file_size: undefined,
        speed: 0,
        eta: undefined,
        error_message: undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        downloader_type: entry.url.includes('youtube') ? 'youtube' : 'http',
        
        // 额外的视频信息
        video_info: {
          zl_id: entry.id,
          zl_name: '手动添加',
          record_url: entry.url,
          kc_id: entry.id,
          kc_name: entry.title || '手动添加下载',
        }
      }));

      // 添加到下载队列
      await addTasks(videoTasks);
      
      // 启动下载
      for (const task of videoTasks) {
        try {
          await invoke('start_download', { task_id: task.id });
        } catch (error) {
          console.error(`Failed to start download for task ${task.id}:`, error);
        }
      }

      notify.success('下载已开始', `成功添加 ${videoTasks.length} 个下载任务`);
      
      // 跳转到下载管理页面
      const { useUIStore } = await import('../../stores/uiStore');
      useUIStore.getState().setCurrentView('downloads');
      
      // 重置状态
      setManualUrls([]);
      
    } catch (error) {
      console.error('启动下载失败:', error);
      notify.error('启动下载失败', error as string);
    }
  };

  // 选择输出目录
  const handleSelectOutputDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择下载目录'
      });
      
      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
        notify.success('目录选择成功', `已选择目录：${selected}`);
      }
    } catch (error) {
      console.error('选择目录失败:', error);
      notify.error('选择目录失败', error as string);
    }
  };

  // 从剪贴板批量添加
  const addFromClipboard = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      const urls = clipboardText.split('\n')
        .map(line => line.trim())
        .filter(line => line && /^https?:\/\//.test(line));
      
      if (urls.length === 0) {
        notify.error('剪贴板中没有找到有效的URL', '');
        return;
      }
      
      const newEntries: ManualUrlEntry[] = urls.map(url => ({
        id: `clipboard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        url,
        isValid: undefined,
        isProcessing: false
      }));
      
      setManualUrls([...manualUrls, ...newEntries]);
      notify.success('添加成功', `从剪贴板添加了 ${urls.length} 个链接`);
    } catch (error) {
      notify.error('读取剪贴板失败', '请确保浏览器允许访问剪贴板');
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* 现代化标签页导航 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex space-x-8" aria-label="Tabs">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`${
                    isActive
                      ? `border-${tab.color}-500 text-${tab.color}-600 dark:text-${tab.color}-400 bg-${tab.color}-50 dark:bg-${tab.color}-900/20`
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  } group relative min-w-0 flex-1 overflow-hidden bg-white dark:bg-gray-800 py-4 px-6 text-center text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700/50 focus:z-10 transition-all duration-200 border-b-2`}
                >
                  <div className="flex items-center justify-center space-x-3">
                    <IconComponent className="w-5 h-5" />
                    <div className="hidden sm:block">
                      <div className="font-semibold">{tab.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {tab.description}
                      </div>
                    </div>
                  </div>
                  
                  {/* 活跃指示器 */}
                  {isActive && (
                    <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-${tab.color}-500`} />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          
          {/* 文件导入标签页 */}
          {activeTab === 'file' && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  批量文件导入
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  支持 CSV、Excel 文件，自动识别编码和字段映射
                </p>
              </div>

              {!selectedFile ? (
                // 文件选择区域
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
                  <div className="text-center">
                    <DocumentArrowUpIcon className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                      选择导入文件
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                      支持 CSV、Excel (xlsx/xls) 格式，自动检测编码
                    </p>
                    <button
                      onClick={handleFileSelect}
                      className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm"
                    >
                      <DocumentArrowUpIcon className="w-5 h-5 mr-2" />
                      选择文件
                    </button>
                  </div>
                </div>
              ) : (
                // 文件预览和导入区域 (保持原有UI结构)
                <div className="space-y-6">
                  {/* 文件信息 */}
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <CheckCircleIcon className="w-6 h-6 text-green-600 dark:text-green-400 mr-3" />
                        <div>
                          <p className="font-medium text-green-800 dark:text-green-200">
                            文件已选择: {selectedFile.split(/[\\/]/).pop()}
                          </p>
                          {importPreview && (
                            <p className="text-sm text-green-600 dark:text-green-300 mt-1">
                              共 {importPreview.total_rows} 行数据，编码: {importPreview.encoding}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedFile(null);
                          setImportPreview(null);
                          setFieldMapping({});
                          setImportSuccess(false);
                        }}
                        className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* 字段映射和预览... (保持原有逻辑) */}
                  {importPreview && (
                    <>
                      {/* 字段映射 */}
                      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                          <TableCellsIcon className="w-5 h-5 mr-2" />
                          字段映射
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {importPreview.headers.map((header, index) => (
                            <div key={index} className="space-y-2">
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                {header}
                              </label>
                              <select
                                value={fieldMapping[header] || ''}
                                onChange={(e) => setFieldMapping({ ...fieldMapping, [header]: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">选择映射字段...</option>
                                <option value="record_url">视频链接 (record_url)</option>
                                <option value="zl_id">专栏ID (zl_id)</option>
                                <option value="zl_name">专栏名称 (zl_name)</option>
                                <option value="kc_id">课程ID (kc_id)</option>
                                <option value="kc_name">课程名称 (kc_name)</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 数据预览 */}
                      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                          数据预览 (前5行)
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                              <tr>
                                {importPreview.headers.map((header, index) => (
                                  <th key={index} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                    {header}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                              {importPreview.rows.slice(0, 5).map((row, rowIndex) => (
                                <tr key={rowIndex} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                  {row.map((cell, cellIndex) => (
                                    <td key={cellIndex} className="px-4 py-3 text-sm text-gray-900 dark:text-gray-300 max-w-xs truncate">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* 输出目录选择 */}
                      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                          <FolderOpenIcon className="w-5 h-5 mr-2" />
                          输出设置
                        </h3>
                        <div className="flex gap-3">
                          <input
                            type="text"
                            value={outputDir}
                            readOnly
                            placeholder="选择保存目录 (可选，默认使用 './downloads')"
                            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 cursor-pointer"
                            onClick={handleSelectOutputDir}
                          />
                          <button
                            onClick={handleSelectOutputDir}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                          >
                            选择目录
                          </button>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                          💡 提示：如果不选择目录，将自动使用默认下载目录
                        </p>
                      </div>

                      {/* 导入按钮或成功状态 */}
                      <div className="flex justify-center">
                        {importSuccess ? (
                          // 导入成功状态
                          <div className="text-center">
                            <div className="inline-flex items-center px-8 py-3 bg-green-100 dark:bg-green-900/20 border-2 border-green-500 rounded-lg text-green-800 dark:text-green-200 font-medium text-lg mb-4">
                              <CheckCircleIcon className="w-6 h-6 mr-3" />
                              导入成功！已添加 {importPreview?.total_rows} 个下载任务
                            </div>
                            <div className="flex gap-3 justify-center">
                              <button
                                onClick={() => setCurrentView('downloads')}
                                className="inline-flex items-center px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                              >
                                查看下载任务
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedFile(null);
                                  setImportPreview(null);
                                  setFieldMapping({});
                                  setImportSuccess(false);
                                  setOutputDir('');
                                }}
                                className="inline-flex items-center px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
                              >
                                重新导入
                              </button>
                            </div>
                          </div>
                        ) : (
                          // 导入按钮
                          <button
                            onClick={handleImport}
                            disabled={isLoading || !importPreview || !canImport}
                            className="inline-flex items-center px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors shadow-sm text-lg"
                          >
                            {isLoading ? (
                              <>
                                <ArrowPathIcon className="w-5 h-5 mr-2 animate-spin" />
                                导入中...
                              </>
                            ) : (
                              <>
                                <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                                开始导入 ({importPreview?.total_rows} 个任务)
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 手动添加标签页 */}
          {activeTab === 'manual' && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  手动添加下载
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  支持单个或批量添加视频链接，支持 HTTP、M3U8、YouTube 等格式
                </p>
              </div>

              {/* URL输入区域 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center">
                    <LinkIcon className="w-5 h-5 mr-2 text-green-500" />
                    添加下载链接
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={addFromClipboard}
                      className="inline-flex items-center px-3 py-2 text-sm bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-lg transition-colors"
                    >
                      <ClipboardDocumentListIcon className="w-4 h-4 mr-1" />
                      从剪贴板批量添加
                    </button>
                  </div>
                </div>
                
                <div className="flex gap-3 mb-4">
                  <input
                    type="url"
                    value={newUrlInput}
                    onChange={(e) => setNewUrlInput(e.target.value)}
                    placeholder="输入视频链接 (支持 HTTP、M3U8、YouTube 等格式)"
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-500"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        addNewUrlEntry();
                      }
                    }}
                  />
                  <button
                    onClick={addNewUrlEntry}
                    disabled={!newUrlInput.trim()}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center"
                  >
                    <PlusIcon className="w-4 h-4 mr-1" />
                    添加
                  </button>
                </div>

                {/* URL列表 */}
                {manualUrls.length > 0 && (
                  <div className="space-y-3">
                    {manualUrls.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              #{index + 1}
                            </span>
                            {entry.isProcessing ? (
                              <ArrowPathIcon className="w-4 h-4 text-blue-500 animate-spin" />
                            ) : entry.isValid === true ? (
                              <CheckCircleIcon className="w-4 h-4 text-green-500" />
                            ) : entry.isValid === false ? (
                              <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
                            ) : null}
                          </div>
                          
                          <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                            {entry.title || entry.url}
                          </p>
                          
                          {entry.url !== entry.title && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {entry.url}
                            </p>
                          )}
                          
                          {entry.error && (
                            <p className="text-xs text-red-500 mt-1">{entry.error}</p>
                          )}
                        </div>
                        
                        <button
                          onClick={() => removeUrlEntry(entry.id)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    
                    {/* 批量操作按钮 */}
                    <div className="flex gap-3 pt-3">
                      <button
                        onClick={validateUrls}
                        disabled={isValidatingUrls}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center"
                      >
                        {isValidatingUrls ? (
                          <>
                            <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />
                            验证中...
                          </>
                        ) : (
                          <>
                            <SparklesIcon className="w-4 h-4 mr-2" />
                            验证链接
                          </>
                        )}
                      </button>
                      
                      <button
                        onClick={() => setManualUrls([])}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                      >
                        清空列表
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 输出目录设置 */}
              {manualUrls.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                    <FolderOpenIcon className="w-5 h-5 mr-2 text-blue-500" />
                    下载设置
                  </h3>
                  
                  <div className="flex gap-3 mb-4">
                    <input
                      type="text"
                      value={outputDir}
                      readOnly
                      placeholder="点击选择保存目录..."
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 cursor-pointer"
                      onClick={handleSelectOutputDir}
                    />
                    <button
                      onClick={handleSelectOutputDir}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                    >
                      选择目录
                    </button>
                  </div>

                  {/* 开始下载按钮 */}
                  <div className="flex justify-center">
                    <button
                      onClick={startManualDownload}
                      disabled={!outputDir || manualUrls.filter(entry => entry.isValid).length === 0}
                      className="inline-flex items-center px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors shadow-sm text-lg"
                    >
                      <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                      开始下载 ({manualUrls.filter(entry => entry.isValid).length} 个链接)
                    </button>
                  </div>
                </div>
              )}

              {/* 使用提示 */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
                <div className="flex items-start">
                  <ExclamationTriangleIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3 mt-0.5" />
                  <div>
                    <h5 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-2">
                      支持的链接格式
                    </h5>
                    <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                      <li>• <strong>HTTP/HTTPS:</strong> 直链视频文件 (.mp4, .avi, .mkv 等)</li>
                      <li>• <strong>M3U8:</strong> HLS 流媒体链接</li>
                      <li>• <strong>YouTube:</strong> YouTube 视频链接 (自动调用专业下载器)</li>
                      <li>• <strong>批量添加:</strong> 复制多行链接到剪贴板，点击"从剪贴板批量添加"</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* YouTube专业下载标签页 */}
          {activeTab === 'youtube' && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2 flex items-center justify-center">
                  <PlayIcon className="w-8 h-8 mr-3 text-red-500" />
                  YouTube 专业下载
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  支持 YouTube、B站等主流视频网站下载
                </p>
              </div>

              {/* YouTube URL输入区域 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center">
                    <PlayIcon className="w-5 h-5 mr-2 text-red-500" />
                    YouTube/视频链接下载
                  </h3>
                </div>
                
                <div className="flex gap-3 mb-4">
                  <input
                    type="url"
                    value={newUrlInput}
                    onChange={(e) => setNewUrlInput(e.target.value)}
                    placeholder="输入 YouTube 或其他视频网站链接"
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-500"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const entry: ManualUrlEntry = {
                          id: Date.now().toString(),
                          url: newUrlInput.trim(),
                          isValid: undefined,
                          isProcessing: false
                        };
                        setManualUrls([...manualUrls, entry]);
                        setNewUrlInput('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newUrlInput.trim()) {
                        const entry: ManualUrlEntry = {
                          id: Date.now().toString(),
                          url: newUrlInput.trim(),
                          isValid: undefined,
                          isProcessing: false
                        };
                        setManualUrls([...manualUrls, entry]);
                        setNewUrlInput('');
                      }
                    }}
                    disabled={!newUrlInput.trim()}
                    className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center"
                  >
                    <PlusIcon className="w-4 h-4 mr-1" />
                    添加
                  </button>
                </div>

                {/* 添加的URL列表 */}
                {manualUrls.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {manualUrls.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                              #{index + 1}
                            </span>
                            {entry.isProcessing ? (
                              <ArrowPathIcon className="w-4 h-4 text-blue-500 animate-spin" />
                            ) : entry.isValid === true ? (
                              <CheckCircleIcon className="w-4 h-4 text-green-500" />
                            ) : entry.isValid === false ? (
                              <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
                            ) : null}
                          </div>
                          
                          <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                            {entry.title || entry.url}
                          </p>
                          
                          {entry.error && (
                            <p className="text-xs text-red-500 mt-1">{entry.error}</p>
                          )}
                        </div>
                        
                        <button
                          onClick={() => setManualUrls(manualUrls.filter(e => e.id !== entry.id))}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    
                    {/* 输出目录和下载按钮 */}
                    <div className="pt-3 border-t border-gray-200 dark:border-gray-600">
                      <div className="flex gap-3 mb-3">
                        <input
                          type="text"
                          value={outputDir}
                          readOnly
                          placeholder="点击选择保存目录..."
                          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 cursor-pointer"
                          onClick={handleSelectOutputDir}
                        />
                        <button
                          onClick={handleSelectOutputDir}
                          className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                        >
                          选择目录
                        </button>
                      </div>

                      <div className="flex justify-center">
                        <button
                          onClick={startManualDownload}
                          disabled={!outputDir || manualUrls.length === 0}
                          className="inline-flex items-center px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                          开始下载 ({manualUrls.length} 个链接)
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 使用提示 */}
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 p-4 mt-4">
                  <div className="flex items-start">
                    <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 mr-3 mt-0.5" />
                    <div>
                      <h5 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">
                        支持的视频网站
                      </h5>
                      <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
                        <li>• <strong>YouTube:</strong> 支持单个视频和播放列表</li>
                        <li>• <strong>哔哩哔哩:</strong> 支持av号、BV号链接</li>
                        <li>• <strong>其他网站:</strong> 通用视频链接下载</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
