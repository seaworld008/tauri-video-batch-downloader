/**
 * 🚀 轻量级性能监控工具
 * 专为工具软件设计：简洁、实用、高效
 *
 * 核心功能：
 * - 组件渲染性能监控
 * - 内存使用跟踪
 * - 数据处理耗时测量
 * - 用户交互响应监控
 * - 简单的性能报告
 */
import React from 'react';

// ====================================================
// 性能指标类型定义
// ====================================================

export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  category: 'render' | 'data' | 'network' | 'user' | 'memory';
  tags?: Record<string, string | number>;
}

export interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

export interface RenderMetric {
  componentName: string;
  renderTime: number;
  propsCount: number;
  timestamp: number;
}

export interface DataProcessingMetric {
  operation: string;
  itemCount: number;
  duration: number;
  timestamp: number;
}

// ====================================================
// 轻量级性能监控器
// ====================================================

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, PerformanceMetric> = new Map();
  private renderMetrics: RenderMetric[] = [];
  private dataMetrics: DataProcessingMetric[] = [];
  private memorySnapshots: MemoryInfo[] = [];
  private maxMetricsHistory = 100; // 限制历史记录数量，避免内存泄漏
  private isEnabled = true; // 在工具软件中默认启用，可动态关闭

  private constructor() {
    // 定期清理旧指标
    setInterval(() => this.cleanupOldMetrics(), 60000); // 每分钟清理一次
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * 开始性能测量
   */
  public startMetric(
    name: string,
    category: PerformanceMetric['category'],
    tags?: Record<string, string | number>
  ): string {
    if (!this.isEnabled) return name;

    const metricId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const metric: PerformanceMetric = {
      name,
      startTime: performance.now(),
      category,
      tags,
    };

    this.metrics.set(metricId, metric);
    return metricId;
  }

  /**
   * 结束性能测量
   */
  public endMetric(metricId: string): number {
    if (!this.isEnabled) return 0;

    const metric = this.metrics.get(metricId);
    if (!metric) {
      console.warn(`⚠️ Performance metric not found: ${metricId}`);
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - metric.startTime;

    metric.endTime = endTime;
    metric.duration = duration;

    // 记录到对应的历史记录中
    this.recordMetric(metric);

    // 清理完成的指标
    this.metrics.delete(metricId);

    return duration;
  }

  /**
   * 便捷方法：测量函数执行时间
   */
  public async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    category: PerformanceMetric['category'] = 'data',
    tags?: Record<string, string | number>
  ): Promise<T> {
    const metricId = this.startMetric(name, category, tags);
    try {
      const result = await fn();
      return result;
    } finally {
      this.endMetric(metricId);
    }
  }

  public measure<T>(
    name: string,
    fn: () => T,
    category: PerformanceMetric['category'] = 'data',
    tags?: Record<string, string | number>
  ): T {
    const metricId = this.startMetric(name, category, tags);
    try {
      return fn();
    } finally {
      this.endMetric(metricId);
    }
  }

  /**
   * 记录组件渲染性能
   */
  public recordRender(componentName: string, renderTime: number, propsCount: number = 0): void {
    if (!this.isEnabled) return;

    const metric: RenderMetric = {
      componentName,
      renderTime,
      propsCount,
      timestamp: Date.now(),
    };

    this.renderMetrics.push(metric);

    // 限制历史记录数量
    if (this.renderMetrics.length > this.maxMetricsHistory) {
      this.renderMetrics = this.renderMetrics.slice(-this.maxMetricsHistory);
    }

    // 警告慢渲染
    if (renderTime > 16) {
      // 16ms = 60fps阈值
      console.warn(`🐌 Slow render detected: ${componentName} took ${renderTime.toFixed(2)}ms`);
    }
  }

  /**
   * 记录数据处理性能
   */
  public recordDataProcessing(operation: string, itemCount: number, duration: number): void {
    if (!this.isEnabled) return;

    const metric: DataProcessingMetric = {
      operation,
      itemCount,
      duration,
      timestamp: Date.now(),
    };

    this.dataMetrics.push(metric);

    // 限制历史记录数量
    if (this.dataMetrics.length > this.maxMetricsHistory) {
      this.dataMetrics = this.dataMetrics.slice(-this.maxMetricsHistory);
    }

    // 分析处理效率
    const itemsPerMs = itemCount / duration;
    if (itemsPerMs < 1 && itemCount > 100) {
      // 每毫秒处理少于1项且总数超过100
      console.warn(
        `🐌 Slow data processing: ${operation} processed ${itemCount} items in ${duration.toFixed(2)}ms`
      );
    }
  }

  /**
   * 拍摄内存快照
   */
  public takeMemorySnapshot(): MemoryInfo | null {
    const performanceMemory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;

    if (!this.isEnabled || !performanceMemory) {
      return null;
    }

    const snapshot: MemoryInfo = {
      usedJSHeapSize: performanceMemory.usedJSHeapSize,
      totalJSHeapSize: performanceMemory.totalJSHeapSize,
      jsHeapSizeLimit: performanceMemory.jsHeapSizeLimit,
      timestamp: Date.now(),
    };

    this.memorySnapshots.push(snapshot);

    // 限制历史记录数量
    if (this.memorySnapshots.length > this.maxMetricsHistory) {
      this.memorySnapshots = this.memorySnapshots.slice(-this.maxMetricsHistory);
    }

    // 内存使用警告（使用超过80%）
    const usageRatio = snapshot.usedJSHeapSize / snapshot.jsHeapSizeLimit;
    if (usageRatio > 0.8) {
      console.warn(
        `🚨 High memory usage: ${(usageRatio * 100).toFixed(1)}% (${this.formatBytes(snapshot.usedJSHeapSize)}/${this.formatBytes(snapshot.jsHeapSizeLimit)})`
      );
    }

    return snapshot;
  }

  /**
   * 获取性能报告
   */
  public getPerformanceReport(): {
    summary: {
      totalMetrics: number;
      averageRenderTime: number;
      slowRenders: number;
      memoryUsage?: string;
    };
    topSlowRenders: RenderMetric[];
    topSlowDataOps: DataProcessingMetric[];
    memoryTrend?: 'increasing' | 'decreasing' | 'stable';
  } {
    const summary = {
      totalMetrics: this.renderMetrics.length + this.dataMetrics.length,
      averageRenderTime: this.calculateAverageRenderTime(),
      slowRenders: this.renderMetrics.filter(m => m.renderTime > 16).length,
      memoryUsage: this.getCurrentMemoryUsage(),
    };

    const topSlowRenders = [...this.renderMetrics]
      .sort((a, b) => b.renderTime - a.renderTime)
      .slice(0, 5);

    const topSlowDataOps = [...this.dataMetrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);

    const memoryTrend = this.analyzeMemoryTrend();

    return {
      summary,
      topSlowRenders,
      topSlowDataOps,
      memoryTrend,
    };
  }

  /**
   * 清理过期指标
   */
  private cleanupOldMetrics(): void {
    if (!this.isEnabled) return;

    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5分钟

    // 清理未完成的指标
    for (const [id, metric] of this.metrics.entries()) {
      if (now - metric.startTime > maxAge) {
        console.warn(`⚠️ Cleaning up long-running metric: ${metric.name}`);
        this.metrics.delete(id);
      }
    }
  }

  /**
   * 记录完成的指标
   */
  private recordMetric(metric: PerformanceMetric): void {
    if (!metric.duration) return;

    // 根据类别记录到不同的存储中
    switch (metric.category) {
      case 'render':
        this.recordRender(metric.name, metric.duration, metric.tags?.propsCount as number);
        break;
      case 'data':
        this.recordDataProcessing(
          metric.name,
          (metric.tags?.itemCount as number) || 0,
          metric.duration
        );
        break;
      default:
        // 其他类别的指标可以扩展
        break;
    }
  }

  /**
   * 计算平均渲染时间
   */
  private calculateAverageRenderTime(): number {
    if (this.renderMetrics.length === 0) return 0;

    const totalTime = this.renderMetrics.reduce((sum, metric) => sum + metric.renderTime, 0);
    return totalTime / this.renderMetrics.length;
  }

  /**
   * 获取当前内存使用情况
   */
  private getCurrentMemoryUsage(): string | undefined {
    if (!this.isEnabled) {
      return undefined;
    }

    const performanceMemory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;

    if (!performanceMemory) {
      return undefined;
    }

    const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = performanceMemory;

    return `${this.formatBytes(usedJSHeapSize)}/${this.formatBytes(totalJSHeapSize)} (limit: ${this.formatBytes(jsHeapSizeLimit)})`;
  }

  /**
   * 分析内存趋势
   */
  private analyzeMemoryTrend(): 'increasing' | 'decreasing' | 'stable' | undefined {
    if (this.memorySnapshots.length < 3) return undefined;

    const recent = this.memorySnapshots.slice(-3);
    const first = recent[0].usedJSHeapSize;
    const last = recent[recent.length - 1].usedJSHeapSize;

    const change = (last - first) / first;

    if (change > 0.1) return 'increasing'; // 10%以上增长
    if (change < -0.1) return 'decreasing'; // 10%以上减少
    return 'stable';
  }

  /**
   * 格式化字节数
   */
  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(1);

    return `${size} ${sizes[i]}`;
  }

  /**
   * 启用/禁用监控
   */
  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * 清空所有指标
   */
  public clear(): void {
    this.metrics.clear();
    this.renderMetrics = [];
    this.dataMetrics = [];
    this.memorySnapshots = [];
  }

  /**
   * 导出性能数据（用于调试）
   */
  public exportData(): {
    renderMetrics: RenderMetric[];
    dataMetrics: DataProcessingMetric[];
    memorySnapshots: MemoryInfo[];
    summary: ReturnType<typeof this.getPerformanceReport>;
  } {
    return {
      renderMetrics: [...this.renderMetrics],
      dataMetrics: [...this.dataMetrics],
      memorySnapshots: [...this.memorySnapshots],
      summary: this.getPerformanceReport(),
    };
  }
}

// ====================================================
// 便捷的全局实例和工具函数
// ====================================================

export const perfMonitor = PerformanceMonitor.getInstance();

/**
 * 装饰器：测量异步函数性能
 */
export function measurePerformance(
  name?: string,
  category: PerformanceMetric['category'] = 'data'
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const metricName = name || `${target.constructor.name}.${propertyKey}`;
      return perfMonitor.measureAsync(
        metricName,
        () => Promise.resolve(originalMethod.apply(this, args)),
        category
      );
    };

    return descriptor;
  };
}

/**
 * 高阶组件：测量组件渲染性能
 */
export function withPerformanceTracking<T extends object>(
  Component: React.ComponentType<T>,
  componentName?: string
): React.ComponentType<T> {
  const displayName = componentName || Component.displayName || Component.name || 'Component';

  const WrappedComponent: React.FC<T> = props => {
    const renderStartRef = React.useRef(performance.now());
    renderStartRef.current = performance.now();

    React.useEffect(() => {
      const renderTime = performance.now() - renderStartRef.current;
      const propCount = Object.keys(props as Record<string, unknown>).length;
      perfMonitor.recordRender(displayName, renderTime, propCount);
    });

    return <Component {...props} />;
  };

  WrappedComponent.displayName = `withPerformanceTracking(${displayName})`;

  return WrappedComponent;
}

/**
 * Hook: 测量组件生命周期性能
 */
export function usePerformanceTracker(componentName: string): {
  trackRender: () => void;
  trackEffect: (effectName: string, fn: () => void | Promise<void>) => Promise<void>;
  trackCallback: <T extends (...args: any[]) => any>(callbackName: string, fn: T) => T;
} {
  const renderStartTime = React.useRef<number>(0);

  // 记录渲染开始时间
  renderStartTime.current = performance.now();

  React.useEffect(() => {
    const renderTime = performance.now() - renderStartTime.current;
    perfMonitor.recordRender(componentName, renderTime);
  });

  const trackRender = React.useCallback(() => {
    const renderTime = performance.now() - renderStartTime.current;
    perfMonitor.recordRender(componentName, renderTime);
  }, [componentName]);

  const trackEffect = React.useCallback(
    async (effectName: string, fn: () => void | Promise<void>) => {
      await perfMonitor.measureAsync(
        `${componentName}.${effectName}`,
        async () => {
          await fn();
        },
        'render'
      );
    },
    [componentName]
  );

  const trackCallback = React.useCallback(
    <T extends (...args: any[]) => any>(callbackName: string, fn: T): T => {
      return ((...args: any[]) => {
        return perfMonitor.measure(`${componentName}.${callbackName}`, () => fn(...args), 'user');
      }) as T;
    },
    [componentName]
  );

  return { trackRender, trackEffect, trackCallback };
}

/**
 * 简单的性能计时器
 */
export class SimpleTimer {
  private startTime: number;

  constructor(private name: string) {
    this.startTime = performance.now();
  }

  public end(): number {
    const duration = performance.now() - this.startTime;
    console.log(`⏱️ ${this.name}: ${duration.toFixed(2)}ms`);
    return duration;
  }

  public static measure<T>(name: string, fn: () => T): T {
    const timer = new SimpleTimer(name);
    try {
      return fn();
    } finally {
      timer.end();
    }
  }

  public static async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const timer = new SimpleTimer(name);
    try {
      return await fn();
    } finally {
      timer.end();
    }
  }
}

/**
 * React性能分析组件
 */
export const PerformanceProfiler: React.FC<{
  id: string;
  children: React.ReactNode;
  onRender?: React.ProfilerOnRenderCallback;
}> = ({ id, children, onRender }) => {
  const handleRender: React.ProfilerOnRenderCallback = (
    profilerId,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime
  ) => {
    perfMonitor.recordRender(profilerId, actualDuration);
    onRender?.(profilerId, phase, actualDuration, baseDuration, startTime, commitTime);
  };

  return (
    <React.Profiler id={id} onRender={handleRender}>
      {children}
    </React.Profiler>
  );
};

// ====================================================
// 默认导出
// ====================================================

export default {
  PerformanceMonitor,
  perfMonitor,
  measurePerformance,
  withPerformanceTracking,
  usePerformanceTracker,
  SimpleTimer,
  PerformanceProfiler,
};
