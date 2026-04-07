/**
 * 🚀 轻量级性能监控面板
 * 专为工具软件设计：简洁、实用、不干扰主要功能
 *
 * 显示内容：
 * - 基本性能指标
 * - 内存使用情况
 * - 数据验证统计
 * - 简单的优化建议
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  ChartBarIcon,
  CpuChipIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { perfMonitor, PerformanceMonitor } from '../../utils/performanceMonitor';
import { useMemoryMonitor } from '../../hooks/useOptimization';
import { useDownloadStore } from '../../stores/downloadStore';

interface PerformanceDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

/**
 * 性能指标卡片组件
 */
const MetricCard: React.FC<{
  title: string;
  value: string;
  icon: React.ReactNode;
  status: 'good' | 'warning' | 'error';
  subtitle?: string;
}> = ({ title, value, icon, status, subtitle }) => {
  const statusColors = {
    good: 'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  };

  return (
    <div className={`p-3 rounded-lg border ${statusColors[status]}`}>
      <div className='flex items-center space-x-2 mb-1'>
        <div className='w-4 h-4'>{icon}</div>
        <span className='text-sm font-medium'>{title}</span>
      </div>
      <div className='text-lg font-bold'>{value}</div>
      {subtitle && <div className='text-xs opacity-75 mt-1'>{subtitle}</div>}
    </div>
  );
};

/**
 * 简洁的优化建议组件
 */
const OptimizationTips: React.FC<{
  memoryUsage?: { percentage: number };
  performanceReport: any;
}> = ({ memoryUsage, performanceReport }) => {
  const tips = useMemo(() => {
    const suggestions: string[] = [];

    // 内存优化建议
    if (memoryUsage && memoryUsage.percentage > 80) {
      suggestions.push('内存使用偏高，考虑清理已完成的任务');
    }

    // 渲染性能建议
    if (performanceReport.summary.slowRenders > 10) {
      suggestions.push(
        `发现${performanceReport.summary.slowRenders}个慢渲染，建议减少同时显示的任务数量`
      );
    }

    // 平均渲染时间建议
    if (performanceReport.summary.averageRenderTime > 20) {
      suggestions.push('组件渲染较慢，已自动启用性能优化模式');
    }

    // 数据处理建议
    if (performanceReport.topSlowDataOps.length > 0) {
      const slowestOp = performanceReport.topSlowDataOps[0];
      if (slowestOp.duration > 100) {
        suggestions.push(`数据处理 "${slowestOp.operation}" 耗时较长，考虑分批处理`);
      }
    }

    return suggestions;
  }, [memoryUsage, performanceReport]);

  if (tips.length === 0) {
    return (
      <div className='bg-green-50 border border-green-200 rounded-lg p-3'>
        <div className='flex items-center space-x-2 text-green-800'>
          <CheckCircleIcon className='w-4 h-4' />
          <span className='text-sm font-medium'>性能状态良好</span>
        </div>
        <p className='text-xs text-green-600 mt-1'>所有指标都在正常范围内</p>
      </div>
    );
  }

  return (
    <div className='bg-yellow-50 border border-yellow-200 rounded-lg p-3'>
      <div className='flex items-center space-x-2 text-yellow-800 mb-2'>
        <ExclamationTriangleIcon className='w-4 h-4' />
        <span className='text-sm font-medium'>优化建议</span>
      </div>
      <ul className='text-xs text-yellow-700 space-y-1'>
        {tips.slice(0, 3).map((tip, index) => (
          <li key={index} className='flex items-start space-x-2'>
            <span className='w-1 h-1 bg-yellow-600 rounded-full mt-1.5 flex-shrink-0' />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * 主性能面板组件
 */
export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({
  isOpen,
  onClose,
  className = '',
}) => {
  const { memoryUsage } = useMemoryMonitor(2000); // 每2秒检查内存
  const getValidationStats = useDownloadStore(state => state.getValidationStats);
  const [performanceReport, setPerformanceReport] = useState(perfMonitor.getPerformanceReport());

  // 定期更新性能报告
  useEffect(() => {
    if (!isOpen) return;

    const updateInterval = setInterval(() => {
      setPerformanceReport(perfMonitor.getPerformanceReport());
    }, 3000); // 每3秒更新

    return () => clearInterval(updateInterval);
  }, [isOpen]);

  // 计算性能状态
  const performanceStatus = useMemo(() => {
    const memoryOk = !memoryUsage || memoryUsage.percentage < 80;
    const renderOk = performanceReport.summary.averageRenderTime < 16;
    const slowRendersOk = performanceReport.summary.slowRenders < 5;

    if (memoryOk && renderOk && slowRendersOk) return 'good';
    if (!memoryOk || performanceReport.summary.slowRenders > 20) return 'error';
    return 'warning';
  }, [memoryUsage, performanceReport]);

  const validationStats = getValidationStats();

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 ${className}`}
    >
      <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto'>
        {/* 头部 */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center space-x-2'>
            <ChartBarIcon className='w-5 h-5 text-blue-600' />
            <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>性能监控</h2>
          </div>
          <button
            onClick={onClose}
            className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          >
            <XMarkIcon className='w-5 h-5' />
          </button>
        </div>

        <div className='p-4 space-y-4'>
          {/* 核心指标 */}
          <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
            <MetricCard
              title='渲染性能'
              value={`${performanceReport.summary.averageRenderTime.toFixed(1)}ms`}
              icon={<ClockIcon className='w-4 h-4' />}
              status={performanceReport.summary.averageRenderTime < 16 ? 'good' : 'warning'}
              subtitle='平均渲染时间'
            />

            <MetricCard
              title='内存使用'
              value={memoryUsage ? `${memoryUsage.percentage.toFixed(1)}%` : 'N/A'}
              icon={<CpuChipIcon className='w-4 h-4' />}
              status={
                !memoryUsage
                  ? 'good'
                  : memoryUsage.percentage < 70
                    ? 'good'
                    : memoryUsage.percentage < 85
                      ? 'warning'
                      : 'error'
              }
              subtitle={
                memoryUsage ? `${(memoryUsage.used / 1024 / 1024).toFixed(0)}MB` : undefined
              }
            />

            <MetricCard
              title='数据验证'
              value={`${(validationStats.successRate * 100).toFixed(0)}%`}
              icon={<CheckCircleIcon className='w-4 h-4' />}
              status={validationStats.successRate > 0.95 ? 'good' : 'warning'}
              subtitle={`${validationStats.total}次验证`}
            />

            <MetricCard
              title='慢渲染'
              value={performanceReport.summary.slowRenders.toString()}
              icon={<ExclamationTriangleIcon className='w-4 h-4' />}
              status={
                performanceReport.summary.slowRenders === 0
                  ? 'good'
                  : performanceReport.summary.slowRenders < 10
                    ? 'warning'
                    : 'error'
              }
              subtitle='超过16ms的渲染'
            />
          </div>

          {/* 优化建议 */}
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100 mb-2'>系统状态</h3>
            <OptimizationTips memoryUsage={memoryUsage} performanceReport={performanceReport} />
          </div>

          {/* 详细统计 */}
          {performanceReport.topSlowRenders.length > 0 && (
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100 mb-2'>
                慢渲染组件 (前3个)
              </h3>
              <div className='bg-gray-50 dark:bg-gray-700 rounded-lg p-3'>
                <div className='space-y-2 text-xs text-gray-600 dark:text-gray-400'>
                  {performanceReport.topSlowRenders
                    .slice(0, 3)
                    .map((render: any, index: number) => (
                      <div key={index} className='flex justify-between items-center'>
                        <span>{render.componentName}</span>
                        <span className='font-mono'>{render.renderTime.toFixed(1)}ms</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* 内存趋势 */}
          {performanceReport.memoryTrend && (
            <div>
              <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100 mb-2'>
                内存趋势
              </h3>
              <div className='flex items-center space-x-2 text-sm'>
                <span
                  className={`px-2 py-1 rounded-full text-xs ${
                    performanceReport.memoryTrend === 'increasing'
                      ? 'bg-red-100 text-red-800'
                      : performanceReport.memoryTrend === 'decreasing'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {performanceReport.memoryTrend === 'increasing'
                    ? '📈 上升'
                    : performanceReport.memoryTrend === 'decreasing'
                      ? '📉 下降'
                      : '📊 稳定'}
                </span>
                <span className='text-gray-600 dark:text-gray-400'>
                  {performanceReport.memoryTrend === 'increasing'
                    ? '内存使用量在增长'
                    : performanceReport.memoryTrend === 'decreasing'
                      ? '内存使用量在下降'
                      : '内存使用量保持稳定'}
                </span>
              </div>
            </div>
          )}

          {/* 快速操作 */}
          <div>
            <h3 className='text-sm font-medium text-gray-900 dark:text-gray-100 mb-2'>快速优化</h3>
            <div className='flex flex-wrap gap-2'>
              <button
                onClick={() => {
                  perfMonitor.clear();
                  setPerformanceReport(perfMonitor.getPerformanceReport());
                }}
                className='px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200'
              >
                清理性能数据
              </button>

              <button
                onClick={() => {
                  if (window.gc) {
                    window.gc();
                  } else {
                    alert('垃圾回收功能不可用');
                  }
                }}
                className='px-3 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200'
              >
                手动垃圾回收
              </button>

              <button
                onClick={() => {
                  const data = perfMonitor.exportData();
                  console.log('性能数据导出:', data);
                  alert('性能数据已导出到控制台');
                }}
                className='px-3 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200'
              >
                导出数据
              </button>
            </div>
          </div>

          {/* 状态指示 */}
          <div className='text-center pt-2 border-t border-gray-200 dark:border-gray-700'>
            <div
              className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs ${
                performanceStatus === 'good'
                  ? 'bg-green-100 text-green-800'
                  : performanceStatus === 'warning'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-red-100 text-red-800'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  performanceStatus === 'good'
                    ? 'bg-green-500'
                    : performanceStatus === 'warning'
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
              />
              <span>
                {performanceStatus === 'good'
                  ? '性能良好'
                  : performanceStatus === 'warning'
                    ? '需要关注'
                    : '需要优化'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformanceDashboard;
