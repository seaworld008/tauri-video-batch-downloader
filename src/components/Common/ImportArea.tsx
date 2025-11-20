import React, { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { 
  DocumentArrowUpIcon, 
  FolderOpenIcon,
  CloudArrowUpIcon,
  Cog6ToothIcon,
  PlayIcon,
  DocumentTextIcon,
  TableCellsIcon
} from '@heroicons/react/24/outline';
import { useDownloadStore } from '../../stores/downloadStore';
import { useConfigStore } from '../../stores/configStore';
import { notify } from '../../stores/uiStore';
import { buildDefaultFieldMapping, buildBackendFieldMapping, canProceedWithImport } from '../../utils/importMapping';
import type { ImportPreview, ImportedData } from '../../types';

interface ImportAreaProps {
  className?: string;
}

export const ImportArea: React.FC<ImportAreaProps> = ({ className = '' }) => {
const resolveImportCommand = (filePath: string): 'import_csv_file' | 'import_excel_file' => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.ods')) {
    return 'import_excel_file';
  }
  return 'import_csv_file';
};

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState<string>('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const { addTasks } = useDownloadStore();
  const defaultOutputDirFromConfig = useConfigStore(state => state.config.download.output_directory);
  const canImport = importPreview ? canProceedWithImport(importPreview.headers, fieldMapping) : false;

  // 选择导入文件
  const handleFileSelect = async () => {
    try {
      const selected = await open({
        title: '选择导入文件',
        filters: [{
          name: '支持的文件',
          extensions: ['csv', 'xlsx', 'xls']
        }]
      });

      if (selected && !Array.isArray(selected)) {
        setSelectedFile(selected);
        const previewResult = await previewImportData(selected);
        if (previewResult) {
          await executeImport(previewResult.preview, selected, previewResult.mapping);
        } else {
          setSelectedFile(null);
        }
      }
    } catch (error) {
      console.error('文件选择失败:', error);
      notify.error('文件选择失败', error as string);
    }
  };

  // 选择输出目录
  const handleOutputDirSelect = useCallback(async () => {
    try {
      const selected = await open({
        title: '选择下载保存目录',
        directory: true
      });

      if (selected && !Array.isArray(selected)) {
        setOutputDir(selected);
        notify.success('目录选择成功', `保存路径：${selected}`);
      }
    } catch (error) {
      console.error('目录选择失败:', error);
      notify.error('目录选择失败', error as string);
    }
  }, []);

  // 预览导入数据
  const previewImportData = async (filePath: string) => {
    setIsLoading(true);
    try {
      const preview = await invoke<ImportPreview>('preview_import_data', {
        filePath,
        encoding: 'utf-8'
      });

      setImportPreview(preview);
      const defaultMapping = buildDefaultFieldMapping(
        preview.headers,
        preview.field_mapping,
        fieldMapping,
      );

      setFieldMapping(defaultMapping);

      return { preview, mapping: defaultMapping };
    } catch (error) {
      console.error('数据预览失败:', error);
      notify.error('数据预览失败', error as string);
      setImportPreview(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const executeImport = useCallback(async (preview: ImportPreview, filePath: string, mapping: Record<string, string>) => {
    const backendFieldMapping = buildBackendFieldMapping(preview.headers, mapping);
    if (!canProceedWithImport(preview.headers, mapping) || !backendFieldMapping.video_url) {
      notify.error('导入失败', '请确认视频链接列已经正确识别');
      return null;
    }

    setIsLoading(true);
    try {
      const candidateOutputDir = (outputDir ?? '').trim();
      const configOutputDir = (defaultOutputDirFromConfig ?? '').trim();
      const effectiveOutputDir = candidateOutputDir || configOutputDir || './downloads';

      const command = resolveImportCommand(filePath);
      const importArgs: Record<string, unknown> = {
        filePath,
        fieldMapping: backendFieldMapping,
        encoding: preview.encoding
      };
      if (command === 'import_excel_file') {
        importArgs.sheetName = null;
      }

      const importedData = await invoke<ImportedData[]>(command, importArgs);

      const validRows = importedData.filter(item => item.record_url || item.url);
      if (validRows.length === 0) {
        notify.error('导入失败', '未找到有效的视频链接列');
        return null;
      }

      if (validRows.length < importedData.length) {
        notify.warning(
          '部分行已跳过',
          `共有 ${importedData.length - validRows.length} 行缺少视频链接，已自动忽略。`
        );
      }

      const previousTaskIds = new Set(useDownloadStore.getState().tasks.map(task => task.id));

      const tasks = validRows.map((item, index) => ({
        id: item.zl_id || item.id || `task_${Date.now()}_${index}`,
        url: item.record_url || item.url || '',
        title: item.kc_name || item.name || `视频_${index + 1}`,
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
          kc_name: item.kc_name
        }
      }));

      await addTasks(tasks);

      const updatedTasks = useDownloadStore.getState().tasks;
      const newTaskIds = updatedTasks
        .filter(task => !previousTaskIds.has(task.id))
        .map(task => task.id);

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

      setSelectedFile(null);
      setImportPreview(null);
      setFieldMapping({});
      setShowAdvanced(false);
      return tasks;
    } catch (error) {
      console.error('导入失败:', error);
      notify.error('导入失败', error as string);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [addTasks, defaultOutputDirFromConfig, outputDir]);


  // 执行导入
  const handleImport = useCallback(async () => {
    if (!selectedFile || !importPreview) {
      notify.error('导入失败', '请先选择文件');
      return;
    }

    await executeImport(importPreview, selectedFile, fieldMapping);
  }, [executeImport, fieldMapping, importPreview, selectedFile]);

  // 更新字段映射
  const updateFieldMapping = (header: string, field: string) => {
    setFieldMapping(prev => ({
      ...prev,
      [header]: field
    }));
  };

  // 如果没有选择文件，显示初始导入界面
  if (!selectedFile) {
    return (
      <div className={`bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-800 dark:to-gray-900 rounded-xl border-2 border-dashed border-blue-300 dark:border-gray-600 transition-all duration-300 hover:border-blue-400 dark:hover:border-gray-500 ${className}`}>
        <div className="p-6 text-center">
          {/* 主图标 */}
          <div className="mx-auto w-16 h-16 bg-blue-500 dark:bg-blue-600 rounded-full flex items-center justify-center mb-4 shadow-lg">
            <CloudArrowUpIcon className="w-8 h-8 text-white" />
          </div>

          {/* 标题和描述 */}
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            批量导入视频任务
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto leading-relaxed">
            支持 CSV、Excel 文件批量导入，自动检测编码格式，智能映射字段
          </p>

          {/* 操作按钮组 */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
            <button
              onClick={handleFileSelect}
              disabled={isLoading}
              className="flex items-center justify-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
            >
              <DocumentArrowUpIcon className="w-5 h-5 mr-2" />
              选择导入文件
            </button>
            
            <button
              onClick={handleOutputDirSelect}
              className="flex items-center justify-center px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105"
            >
              <FolderOpenIcon className="w-5 h-5 mr-2" />
              {outputDir ? '已选择目录' : '选择保存目录'}
            </button>
          </div>

          {/* 选中的输出目录显示 */}
          {outputDir && (
            <div className="mb-6 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm text-green-800 dark:text-green-200">
                <FolderOpenIcon className="w-4 h-4 inline mr-2" />
                保存路径：{outputDir}
              </p>
            </div>
          )}

          {/* 支持的文件格式 - 文字显示 */}
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            支持格式：CSV、Excel (.xlsx/.xls)
          </div>

          {/* 功能特性 */}
          <div className="mt-4 grid grid-cols-2 gap-2 max-w-md mx-auto text-left">
            {[
              '🚀 智能字段识别',
              '🔄 自动编码检测',
              '📊 实时数据预览', 
              '⚙️ 灵活映射配置'
            ].map((feature) => (
              <div key={feature} className="flex items-center text-xs text-gray-600 dark:text-gray-400">
                <span className="mr-1">{feature.split(' ')[0]}</span>
                <span>{feature.split(' ').slice(1).join(' ')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 如果已选择文件，显示预览和配置界面
  return (
    <div className={`space-y-6 ${className}`}>
      {/* 文件信息卡片 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
              <DocumentArrowUpIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {selectedFile.split('/').pop() || selectedFile.split('\\').pop()}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {importPreview ? `${importPreview.total_rows} 行数据 • ${importPreview.encoding} 编码` : '正在解析...'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setSelectedFile(null);
              setImportPreview(null);
              setFieldMapping({});
            }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            重新选择
          </button>
        </div>

        {/* 保存目录显示 - 更突出的位置 */}
        {outputDir ? (
          <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <FolderOpenIcon className="w-5 h-5 text-green-600 dark:text-green-400 mr-3" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    保存目录已选择
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-300 mt-1 break-all">
                    {outputDir}
                  </p>
                </div>
              </div>
              <button
                onClick={handleOutputDirSelect}
                className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 text-sm font-medium"
              >
                更改目录
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <FolderOpenIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mr-3" />
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  请选择保存目录
                </p>
              </div>
              <button
                onClick={handleOutputDirSelect}
                className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                选择目录
              </button>
            </div>
          </div>
        )}

        {/* 高级配置切换 */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors mb-4"
        >
          <Cog6ToothIcon className="w-4 h-4 mr-1" />
          {showAdvanced ? '隐藏' : '显示'}高级配置
        </button>

        {/* 高级配置面板 */}
        {showAdvanced && importPreview && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-3">字段映射配置</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {importPreview.headers.map((header, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-24 truncate">
                    {header}
                  </span>
                  <select
                    value={fieldMapping[header] || ''}
                    onChange={(e) => updateFieldMapping(header, e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
                  >
                    <option value="">-- 不映射 --</option>
                    <option value="record_url">视频链接</option>
                    <option value="zl_id">专栏ID</option>
                    <option value="zl_name">专栏名称</option>
                    <option value="kc_id">课程ID</option>
                    <option value="kc_name">课程名称</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {importPreview && (
              <>
                准备导入 <span className="font-semibold text-blue-600 dark:text-blue-400">{importPreview.total_rows}</span> 个任务
                {outputDir && (
                  <>
                    <br />
                    <FolderOpenIcon className="w-4 h-4 inline mr-1" />
                    保存至：{outputDir}
                  </>
                )}
              </>
            )}
          </div>
          
          <div className="flex space-x-3">
            {!outputDir && (
              <button
                onClick={handleOutputDirSelect}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <FolderOpenIcon className="w-4 h-4 inline mr-1" />
                选择目录
              </button>
            )}
            
            <button
              onClick={handleImport}
              disabled={isLoading || !importPreview || !canImport}
              className="flex items-center px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg"
            >
              <PlayIcon className="w-4 h-4 mr-2" />
              {isLoading ? '导入中...' : '开始导入'}
            </button>
          </div>
        </div>
      </div>

      {/* 数据预览 */}
      {importPreview && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-4">数据预览</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700">
                  {importPreview.headers.map((header, index) => (
                    <th key={index} className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                {importPreview.rows.slice(0, 3).map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2 text-sm text-gray-900 dark:text-gray-300 max-w-xs truncate">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

