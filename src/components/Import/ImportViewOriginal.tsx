import React, { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import {
  DocumentArrowUpIcon,
  TableCellsIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { useDownloadStore } from '../../stores/downloadStore';
import { notify } from '../../stores/uiStore';
import type { ImportPreview, ImportedData } from '../../types';

interface ImportViewProps {}

export const ImportView: React.FC<ImportViewProps> = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const { addTasks } = useDownloadStore();

  // 选择文件
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
        await previewImportData(selected);
      }
    } catch (error) {
      console.error('文件选择失败:', error);
      notify.error('文件选择失败', error as string);
    }
  };

  // 预览导入数据
  const previewImportData = async (filePath: string) => {
    setIsLoading(true);
    try {
      const preview = await invoke<ImportPreview>('preview_import_data', {
        filePath,
        encoding: 'utf-8',
      });

      setImportPreview(preview);

      // 设置默认字段映射 - 与Go版本保持一致
      const defaultMapping: Record<string, string> = {};
      preview.headers.forEach((header, index) => {
        const headerLower = header.toLowerCase();

        // 匹配Go版本的标准字段名
        if (
          headerLower === 'record_url' ||
          headerLower.includes('record_url') ||
          headerLower.includes('视频链接') ||
          headerLower.includes('下载链接')
        ) {
          defaultMapping[header] = 'record_url';
        } else if (
          headerLower === 'zl_id' ||
          headerLower.includes('专栏id') ||
          headerLower.includes('zl_id') ||
          headerLower.includes('专栏标识')
        ) {
          defaultMapping[header] = 'zl_id';
        } else if (
          headerLower === 'zl_name' ||
          headerLower.includes('专栏名称') ||
          headerLower.includes('zl_name')
        ) {
          defaultMapping[header] = 'zl_name';
        } else if (
          headerLower === 'kc_id' ||
          headerLower.includes('课程id') ||
          headerLower.includes('kc_id') ||
          headerLower.includes('课程标识')
        ) {
          defaultMapping[header] = 'kc_id';
        } else if (
          headerLower === 'kc_name' ||
          headerLower.includes('课程名称') ||
          headerLower.includes('kc_name')
        ) {
          defaultMapping[header] = 'kc_name';
        }

        // 向后兼容旧版本字段
        else if (headerLower.includes('url') || headerLower.includes('链接')) {
          defaultMapping[header] = 'record_url'; // 映射到标准字段
        } else if (
          headerLower.includes('name') ||
          headerLower.includes('名称') ||
          headerLower.includes('标题')
        ) {
          defaultMapping[header] = 'kc_name'; // 默认映射到课程名称
        } else if (headerLower.includes('id') && !headerLower.includes('course')) {
          defaultMapping[header] = 'zl_id'; // 默认映射到专栏ID
        }
      });
      setFieldMapping(defaultMapping);
    } catch (error) {
      console.error('数据预览失败:', error);
      notify.error('数据预览失败', error as string);
      setImportPreview(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 执行导入
  const handleImport = async () => {
    if (!selectedFile || !importPreview) return;

    setIsLoading(true);
    try {
      const importedData = await invoke<ImportedData[]>('import_csv_file', {
        filePath: selectedFile,
        fieldMapping: fieldMapping,
        encoding: importPreview.encoding,
      });

      // 将导入的数据添加到下载任务 - 使用Go版本的字段结构
      const tasks = importedData.map((item, index) => ({
        id: item.zl_id || item.id || `task_${index}`, // 使用专栏ID或生成ID
        url: item.record_url || item.url || '', // 使用标准视频链接字段
        title: item.kc_name || item.name || `视频_${index}`, // 使用课程名称作为标题
        output_path: '', // 后端会根据专栏信息自动生成路径
        status: 'pending' as const,
        progress: 0,
        downloaded_size: 0,
        speed: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),

        // 保存完整的视频信息供后续使用
        video_info: {
          zl_id: item.zl_id,
          zl_name: item.zl_name,
          record_url: item.record_url,
          kc_id: item.kc_id,
          kc_name: item.kc_name,
        },
      }));

      await addTasks(tasks);

      notify.success('导入成功', `成功导入 ${importedData.length} 个下载任务`);

      // 重置状态
      setSelectedFile(null);
      setImportPreview(null);
      setFieldMapping({});
    } catch (error) {
      console.error('导入失败:', error);
      notify.error('导入失败', error as string);
    } finally {
      setIsLoading(false);
    }
  };

  // 更新字段映射
  const updateFieldMapping = (header: string, field: string) => {
    setFieldMapping(prev => ({
      ...prev,
      [header]: field,
    }));
  };

  return (
    <div className='h-full overflow-auto'>
      <div className='max-w-6xl mx-auto p-6'>
        {/* 页面标题 */}
        <div className='mb-8'>
          <h1 className='text-3xl font-bold text-gray-900 dark:text-gray-100'>批量导入任务</h1>
          <p className='text-gray-600 dark:text-gray-400 mt-2'>
            支持从 CSV、Excel 文件批量导入下载任务
          </p>
        </div>

        {/* 文件选择区域 */}
        {!selectedFile && (
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8'>
            <div className='text-center'>
              <DocumentArrowUpIcon className='mx-auto h-16 w-16 text-gray-400 dark:text-gray-500 mb-4' />
              <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100 mb-2'>
                选择导入文件
              </h3>
              <p className='text-gray-600 dark:text-gray-400 mb-6'>
                支持 CSV、Excel (.xlsx/.xls) 格式的文件
              </p>
              <button
                onClick={handleFileSelect}
                disabled={isLoading}
                className='inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              >
                {isLoading ? (
                  <ArrowPathIcon className='w-5 h-5 mr-2 animate-spin' />
                ) : (
                  <DocumentArrowUpIcon className='w-5 h-5 mr-2' />
                )}
                {isLoading ? '加载中...' : '选择文件'}
              </button>
            </div>
          </div>
        )}

        {/* 数据预览和映射 */}
        {importPreview && (
          <div className='space-y-6'>
            {/* 文件信息 */}
            <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <h3 className='font-medium text-blue-900 dark:text-blue-100'>文件信息</h3>
                  <p className='text-sm text-blue-700 dark:text-blue-300 mt-1'>
                    共 {importPreview.total_rows} 行数据，编码：{importPreview.encoding}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setImportPreview(null);
                    setFieldMapping({});
                  }}
                  className='text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300'
                >
                  重新选择
                </button>
              </div>
            </div>

            {/* 字段映射 */}
            <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
              <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100 mb-4'>
                字段映射配置
              </h3>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                {importPreview.headers.map((header, index) => (
                  <div key={index} className='flex items-center space-x-3'>
                    <span className='text-sm font-medium text-gray-700 dark:text-gray-300 w-32 truncate'>
                      {header}
                    </span>
                    <select
                      value={fieldMapping[header] || ''}
                      onChange={e => updateFieldMapping(header, e.target.value)}
                      className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm'
                    >
                      <option value=''>-- 不映射 --</option>
                      <option value='record_url'>视频链接 (record_url)</option>
                      <option value='zl_id'>专栏ID (zl_id)</option>
                      <option value='zl_name'>专栏名称 (zl_name)</option>
                      <option value='kc_id'>课程ID (kc_id)</option>
                      <option value='kc_name'>课程名称 (kc_name)</option>

                      {/* 兼容旧版本字段 */}
                      <option value='url'>链接 (url)</option>
                      <option value='id'>ID (id)</option>
                      <option value='name'>名称 (name)</option>
                      <option value='course_id'>课程ID (course_id)</option>
                      <option value='course_name'>课程名称 (course_name)</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* 数据预览 */}
            <div className='bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6'>
              <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100 mb-4'>
                数据预览 (前5行)
              </h3>
              <div className='overflow-x-auto'>
                <table className='min-w-full table-auto'>
                  <thead>
                    <tr className='bg-gray-50 dark:bg-gray-700'>
                      {importPreview.headers.map((header, index) => (
                        <th
                          key={index}
                          className='px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200 dark:divide-gray-600'>
                    {importPreview.rows.slice(0, 5).map((row, rowIndex) => (
                      <tr key={rowIndex} className='hover:bg-gray-50 dark:hover:bg-gray-700'>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className='px-4 py-3 text-sm text-gray-900 dark:text-gray-300 max-w-xs truncate'
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 导入按钮 */}
            <div className='flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-lg p-4'>
              <div className='flex items-center space-x-2'>
                <CheckCircleIcon className='w-5 h-5 text-green-500' />
                <span className='text-sm text-gray-600 dark:text-gray-400'>
                  准备导入 {importPreview.total_rows} 个任务
                </span>
              </div>
              <button
                onClick={handleImport}
                disabled={isLoading || Object.keys(fieldMapping).length === 0}
                className='inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              >
                {isLoading ? (
                  <ArrowPathIcon className='w-5 h-5 mr-2 animate-spin' />
                ) : (
                  <CheckCircleIcon className='w-5 h-5 mr-2' />
                )}
                {isLoading ? '导入中...' : '开始导入'}
              </button>
            </div>
          </div>
        )}

        {/* 使用说明 */}
        <div className='mt-8 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4'>
          <div className='flex items-start'>
            <ExclamationTriangleIcon className='w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 mr-3' />
            <div>
              <h4 className='text-sm font-medium text-yellow-800 dark:text-yellow-200'>导入说明</h4>
              <ul className='mt-2 text-sm text-yellow-700 dark:text-yellow-300 space-y-1'>
                <li>• 支持 CSV、Excel (.xlsx/.xls) 格式文件</li>
                <li>• 请确保文件包含下载链接列</li>
                <li>• 支持 UTF-8、GBK、GB2312 编码格式</li>
                <li>• 建议文件大小不超过 50MB</li>
                <li>• 导入的任务会自动添加到下载队列</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
