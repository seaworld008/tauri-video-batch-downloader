/**
 * 自动状态同步Hook
 * 提供前后端状态自动同步机制
 * 增强版：包含防抖、节流、智能调度和内存泄漏防护
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { useDownloadStore } from '../stores/downloadStore';
import { shouldValidate } from '../utils/stateValidator';

interface UseAutoSyncOptions {
  /**
   * 验证间隔（毫秒），默认30秒
   */
  intervalMs?: number;
  
  /**
   * 是否启用自动同步，默认true
   */
  enabled?: boolean;
  
  /**
   * 组件卸载时是否清理定时器，默认true
   */
  cleanupOnUnmount?: boolean;
  
  /**
   * 验证失败时的回调
   */
  onValidationFailed?: (error: any) => void;
  
  /**
   * 同步完成时的回调
   */
  onSyncCompleted?: (success: boolean) => void;
  
  /**
   * 防抖延迟（毫秒），默认1000ms
   * 用于防止频繁触发手动同步
   */
  debounceMs?: number;
  
  /**
   * 节流间隔（毫秒），默认5000ms
   * 限制同步操作的最小间隔
   */
  throttleMs?: number;
  
  /**
   * 是否启用智能调度，默认true
   * 根据页面可见性和用户活跃度调整同步频率
   */
  smartScheduling?: boolean;
  
  /**
   * 页面不可见时的同步间隔倍数，默认3倍
   * 当页面隐藏时延长同步间隔以节省资源
   */
  hiddenPageMultiplier?: number;
  
  /**
   * 最大重试次数，默认3次
   */
  maxRetries?: number;
  
  /**
   * 启用性能监控，默认false
   */
  enablePerformanceMonitoring?: boolean;
}

/**
 * 自动状态同步Hook
 * 
 * @example
 * ```tsx
 * // 在主要组件中使用
 * function App() {
 *   useAutoSync({
 *     intervalMs: 30000, // 30秒检查一次
 *     onSyncCompleted: (success) => {
 *       if (!success) {
 *         console.warn('状态同步失败');
 *       }
 *     }
 *   });
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export function useAutoSync(options: UseAutoSyncOptions = {}) {
  const {
    intervalMs = 30000, // 默认30秒
    enabled = true,
    cleanupOnUnmount = true,
    onValidationFailed,
    onSyncCompleted,
    debounceMs = 1000, // 防抖延迟
    throttleMs = 5000, // 节流间隔
    smartScheduling = true, // 智能调度
    hiddenPageMultiplier = 3, // 页面隐藏时间隔倍数
    maxRetries = 3, // 最大重试次数
    enablePerformanceMonitoring = false, // 性能监控
  } = options;

  const validateAndSync = useDownloadStore(state => state.validateAndSync);
  const forceSync = useDownloadStore(state => state.forceSync);
  
  // 基础状态管理
    const intervalRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const lastSyncTimeRef = useRef<number>(0);
  const retryCountRef = useRef<number>(0);
  
  // 防抖和节流相关
    const debounceTimerRef = useRef<number | null>(null);
    const throttleTimerRef = useRef<number | null>(null);
    const initialRunTimerRef = useRef<number | null>(null);
    const retryTimerRef = useRef<number | null>(null);
  
  // 智能调度相关
  const [isPageVisible, setIsPageVisible] = useState(() => !document.hidden);
  const [currentIntervalMs, setCurrentIntervalMs] = useState(intervalMs);
  
  // 性能监控
  const [performanceMetrics, setPerformanceMetrics] = useState({
    syncCount: 0,
    successCount: 0,
    failureCount: 0,
    averageResponseTime: 0,
    lastSyncDuration: 0,
  });
  
  // 内存泄漏防护：清理所有定时器
  const cleanupAllTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    [debounceTimerRef, throttleTimerRef, initialRunTimerRef, retryTimerRef].forEach(timer => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    });
  }, []);

  /**
   * 增强版执行一次验证和同步
   * 包含节流、重试、性能监控功能
   */
  const performSync = useCallback(async (isManualTrigger = false) => {
    if (isRunningRef.current || !enabled) {
      return false;
    }

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // 节流控制：检查距离上次同步是否满足最小间隔
    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTimeRef.current;
    if (!isManualTrigger && timeSinceLastSync < throttleMs) {
      console.log(`🛑 同步被节流限制，距离上次同步仅 ${timeSinceLastSync}ms`);
      return false;
    }

    // 检查是否需要验证（仅自动触发时）
    if (!isManualTrigger && !shouldValidate(currentIntervalMs)) {
      return false;
    }

    const syncStartTime = performance.now();
    let success = false;

    try {
      isRunningRef.current = true;
      lastSyncTimeRef.current = now;
      
      console.log('⏰ 状态验证触发...', {
        手动触发: isManualTrigger,
        页面可见: isPageVisible,
        当前间隔: currentIntervalMs,
        距离上次: timeSinceLastSync
      });
      
      success = await validateAndSync();
      
      // 重置重试计数
      retryCountRef.current = 0;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      
      // 更新性能指标
      if (enablePerformanceMonitoring) {
        const syncDuration = performance.now() - syncStartTime;
        setPerformanceMetrics(prev => ({
          syncCount: prev.syncCount + 1,
          successCount: prev.successCount + 1,
          failureCount: prev.failureCount,
          averageResponseTime: (prev.averageResponseTime * prev.syncCount + syncDuration) / (prev.syncCount + 1),
          lastSyncDuration: syncDuration,
        }));
        
        console.log(`📊 同步性能: ${syncDuration.toFixed(2)}ms`);
      }
      
      if (onSyncCompleted) {
        onSyncCompleted(success);
      }
      
    } catch (error) {
      console.error('❌ 自动同步过程出错:', error);
      
      // 更新失败指标
      if (enablePerformanceMonitoring) {
        setPerformanceMetrics(prev => ({
          ...prev,
          syncCount: prev.syncCount + 1,
          failureCount: prev.failureCount + 1,
        }));
      }
      
      // 重试机制
      retryCountRef.current++;
      if (retryCountRef.current < maxRetries) {
        console.log(`🔄 准备第 ${retryCountRef.current}/${maxRetries} 次重试...`);
        // 指数退避重试：2^n * 1000ms
        const retryDelay = Math.pow(2, retryCountRef.current) * 1000;
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
        }
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void performSync(isManualTrigger);
        }, retryDelay);
      } else {
        console.error(`❌ 已达到最大重试次数 ${maxRetries}，放弃同步`);
        retryCountRef.current = 0; // 重置计数器
      }
      
      if (onValidationFailed) {
        onValidationFailed(error);
      }
      
    } finally {
      isRunningRef.current = false;
    }

    return success;
  }, [enabled, currentIntervalMs, throttleMs, validateAndSync, onValidationFailed, onSyncCompleted, enablePerformanceMonitoring, maxRetries, isPageVisible]);

  /**
   * 智能调度：根据页面可见性调整同步间隔
   */
  const updateSyncInterval = useCallback(() => {
    if (!smartScheduling) {
      setCurrentIntervalMs(intervalMs);
      return;
    }

    const newInterval = isPageVisible 
      ? intervalMs 
      : intervalMs * hiddenPageMultiplier;
      
    if (newInterval !== currentIntervalMs) {
      setCurrentIntervalMs(newInterval);
      console.log(`🧠 智能调度: 页面${isPageVisible ? '可见' : '隐藏'}，同步间隔调整为 ${newInterval}ms`);
    }
  }, [intervalMs, isPageVisible, smartScheduling, hiddenPageMultiplier, currentIntervalMs]);

  /**
   * 启动智能定时器
   */
  const startTimer = useCallback(() => {
    if (!enabled) return;

    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (initialRunTimerRef.current !== null) {
      window.clearTimeout(initialRunTimerRef.current);
      initialRunTimerRef.current = null;
    }

    console.log('🔄 启动智能状态同步定时器, 间隔:', currentIntervalMs, 'ms');

    intervalRef.current = window.setInterval(() => {
      void performSync(false);
    }, currentIntervalMs);

    const initialDelay = Math.min(5000, Math.max(1000, currentIntervalMs));
    initialRunTimerRef.current = window.setTimeout(() => {
      void performSync(false);
    }, initialDelay);
  }, [enabled, currentIntervalMs, performSync]);

  /**
   * 防抖的手动触发同步
   */
  const debouncedTriggerSync = useCallback(async () => {
    return new Promise<boolean>((resolve) => {
      // 清除之前的防抖定时器
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      
      debounceTimerRef.current = window.setTimeout(async () => {
        console.log('🔄 防抖后手动触发状态同步...');
        const success = await performSync(true);
        resolve(success);
      }, debounceMs);
    });
  }, [performSync, debounceMs]);

  /**
   * 清理定时器
   */
  const cleanupTimer = useCallback(() => {
    const hasActiveTimers =
      intervalRef.current !== null ||
      debounceTimerRef.current !== null ||
      throttleTimerRef.current !== null ||
      initialRunTimerRef.current !== null ||
      retryTimerRef.current !== null;

    cleanupAllTimers();

    if (hasActiveTimers) {
      console.log('🛑 所有自动同步定时器已清理');
    }
  }, [cleanupAllTimers]);

  /**
   * 强制同步（跳过验证直接从后端同步）
   */
  const triggerForceSync = useCallback(async () => {
    console.log('💪 强制状态同步...');
    const startTime = performance.now();

    try {
      const success = await forceSync();
      
      // 更新性能指标
      if (enablePerformanceMonitoring && success) {
        const syncDuration = performance.now() - startTime;
        setPerformanceMetrics(prev => ({
          syncCount: prev.syncCount + 1,
          successCount: prev.successCount + 1,
          failureCount: prev.failureCount,
          averageResponseTime: (prev.averageResponseTime * prev.syncCount + syncDuration) / (prev.syncCount + 1),
          lastSyncDuration: syncDuration,
        }));
      }
      
      if (onSyncCompleted) {
        onSyncCompleted(success);
      }
      return success;
    } catch (error) {
      // 更新失败指标
      if (enablePerformanceMonitoring) {
        setPerformanceMetrics(prev => ({
          ...prev,
          syncCount: prev.syncCount + 1,
          failureCount: prev.failureCount + 1,
        }));
      }
      
      if (onValidationFailed) {
        onValidationFailed(error);
      }
      throw error;
    }
  }, [forceSync, onValidationFailed, onSyncCompleted, enablePerformanceMonitoring]);

  // 页面可见性监听（智能调度）
  useEffect(() => {
    if (!smartScheduling) return;

    const handleVisibilityChange = () => {
      const newIsVisible = !document.hidden;
      setIsPageVisible(newIsVisible);
      
      console.log(`👀 页面可见性变更: ${newIsVisible ? '可见' : '隐藏'}`);
      
      // 页面从隐藏变为可见时，立即触发一次同步
      if (newIsVisible && !isPageVisible) {
        window.setTimeout(() => performSync(false), 1000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [smartScheduling, isPageVisible, performSync]);

  // 智能调度：根据页面可见性更新同步间隔
  useEffect(() => {
    updateSyncInterval();
  }, [updateSyncInterval, isPageVisible]);

  // 当同步间隔变化时，重新启动定时器
  useEffect(() => {
    if (enabled) {
      startTimer();
    }

    return () => {
      if (cleanupOnUnmount) {
        cleanupTimer();
      }
    };
  }, [enabled, currentIntervalMs, startTimer, cleanupTimer, cleanupOnUnmount]);

  // 当基础配置变化时，更新相关状态
  useEffect(() => {
    updateSyncInterval();
  }, [intervalMs, smartScheduling, hiddenPageMultiplier, updateSyncInterval]);

  return {
    /**
     * 防抖的手动触发同步
     */
    triggerSync: debouncedTriggerSync,

    /**
     * 强制同步
     */
    triggerForceSync,

    /**
     * 当前是否正在同步
     */
    isRunning: isRunningRef.current,

    /**
     * 当前页面是否可见
     */
    isPageVisible,

    /**
     * 当前同步间隔（可能因智能调度而变化）
     */
    currentInterval: currentIntervalMs,

    /**
     * 性能监控指标
     */
    performanceMetrics: enablePerformanceMonitoring ? performanceMetrics : null,

    /**
     * 清理定时器（通常不需要手动调用）
     */
    cleanup: cleanupTimer,
  };
}

/**
 * 轻量版自动同步Hook，只在特定事件后触发验证
 * 适合在子组件中使用
 */
export function useEventBasedSync() {
  const validateAndSync = useDownloadStore(state => state.validateAndSync);
  
  /**
   * 在重要操作后触发验证
   */
  const triggerValidation = useCallback((delayMs: number = 1000) => {
    window.setTimeout(async () => {
      try {
        await validateAndSync();
      } catch (error) {
        console.warn('事件驱动的状态验证失败:', error);
      }
    }, delayMs);
  }, [validateAndSync]);

  return {
    triggerValidation,
  };
}

export default useAutoSync;


