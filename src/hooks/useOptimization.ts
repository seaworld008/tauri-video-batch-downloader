/**
 * 🚀 React性能优化Hook
 * 专为工具软件设计：简洁、实用、高效
 * 
 * 集成功能：
 * - 智能Memoization (useMemo, useCallback)
 * - 防抖和节流处理
 * - 大数据集优化
 * - 渲染性能监控
 * - 内存泄漏防护
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { perfMonitor, usePerformanceTracker } from '../utils/performanceMonitor';

// ====================================================
// 防抖Hook
// ====================================================

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 防抖回调Hook
 */
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
  dependencies?: React.DependencyList
): T {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<NodeJS.Timeout>();

  // 更新回调引用
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(
    ((...args: any[]) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    }) as T,
    [delay, ...(dependencies || [])]
  );
}

// ====================================================
// 节流Hook
// ====================================================

/**
 * 节流Hook
 */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastExecuted = useRef<number>(Date.now());

  useEffect(() => {
    if (Date.now() >= lastExecuted.current + interval) {
      lastExecuted.current = Date.now();
      setThrottledValue(value);
    } else {
      const timer = setTimeout(() => {
        lastExecuted.current = Date.now();
        setThrottledValue(value);
      }, interval);

      return () => clearTimeout(timer);
    }
  }, [value, interval]);

  return throttledValue;
}

/**
 * 节流回调Hook
 */
export function useThrottledCallback<T extends (...args: any[]) => void>(
  callback: T,
  interval: number,
  dependencies?: React.DependencyList
): T {
  const callbackRef = useRef(callback);
  const lastExecuted = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout>();

  // 更新回调引用
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(
    ((...args: any[]) => {
      const now = Date.now();
      
      if (now - lastExecuted.current >= interval) {
        lastExecuted.current = now;
        callbackRef.current(...args);
      } else if (!timeoutRef.current) {
        const remaining = interval - (now - lastExecuted.current);
        timeoutRef.current = setTimeout(() => {
          lastExecuted.current = Date.now();
          callbackRef.current(...args);
          timeoutRef.current = undefined;
        }, remaining);
      }
    }) as T,
    [interval, ...(dependencies || [])]
  );
}

// ====================================================
// 大数据集优化Hooks
// ====================================================

/**
 * 大列表分页Hook
 */
export function usePagination<T>(
  data: T[],
  pageSize: number = 50
): {
  currentPage: number;
  totalPages: number;
  paginatedData: T[];
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  canGoNext: boolean;
  canGoPrev: boolean;
} {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(data.length / pageSize);
  
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return data.slice(startIndex, endIndex);
  }, [data, currentPage, pageSize]);

  const goToPage = useCallback((page: number) => {
    const newPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(newPage);
  }, [totalPages]);

  const nextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(current => current + 1);
    }
  }, [currentPage, totalPages]);

  const prevPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(current => current - 1);
    }
  }, [currentPage]);

  // 重置页码当数据变化
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [data.length, totalPages, currentPage]);

  return {
    currentPage,
    totalPages,
    paginatedData,
    goToPage,
    nextPage,
    prevPage,
    canGoNext: currentPage < totalPages,
    canGoPrev: currentPage > 1
  };
}

/**
 * 虚拟滚动Hook
 */
export function useVirtualScroll(
  itemCount: number,
  itemHeight: number,
  containerHeight: number,
  overscan: number = 5
): {
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  visibleRange: { start: number; end: number };
  totalHeight: number;
} {
  const [scrollTop, setScrollTop] = useState(0);

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    
    return { start, end };
  }, [scrollTop, itemHeight, containerHeight, overscan, itemCount]);

  const totalHeight = itemCount * itemHeight;

  return {
    scrollTop,
    setScrollTop,
    visibleRange,
    totalHeight
  };
}

// ====================================================
// 搜索和过滤优化Hook
// ====================================================

/**
 * 优化的搜索Hook
 */
export function useOptimizedSearch<T>(
  data: T[],
  searchQuery: string,
  searchFields: (keyof T)[],
  debounceMs: number = 300
): {
  results: T[];
  isSearching: boolean;
  matchCount: number;
} {
  const [isSearching, setIsSearching] = useState(false);
  const debouncedQuery = useDebounce(searchQuery.toLowerCase().trim(), debounceMs);

  const results = useMemo(() => {
    if (!debouncedQuery) {
      setIsSearching(false);
      return data;
    }

    setIsSearching(true);
    
    const filtered = perfMonitor.measure(
      'OptimizedSearch.filter',
      () => data.filter(item => 
        searchFields.some(field => {
          const value = item[field];
          return value && 
                 String(value).toLowerCase().includes(debouncedQuery);
        })
      ),
      'data',
      { itemCount: data.length, queryLength: debouncedQuery.length }
    );

    setIsSearching(false);
    return filtered;
  }, [data, debouncedQuery, searchFields]);

  return {
    results,
    isSearching,
    matchCount: results.length
  };
}

/**
 * 多条件过滤Hook
 */
export function useMultiFilter<T>(
  data: T[],
  filters: Record<string, (item: T) => boolean>
): T[] {
  return useMemo(() => {
    const activeFilters = Object.values(filters).filter(Boolean);
    
    if (activeFilters.length === 0) return data;

    return perfMonitor.measure(
      'MultiFilter.apply',
      () => data.filter(item => activeFilters.every(filter => filter(item))),
      'data',
      { itemCount: data.length, filterCount: activeFilters.length }
    );
  }, [data, filters]);
}

// ====================================================
// 性能监控Hooks
// ====================================================

/**
 * 组件性能监控Hook
 */
export function useComponentPerformance(componentName: string): {
  measureRender: () => void;
  measureEffect: (effectName: string, fn: () => void | Promise<void>) => Promise<void>;
  performanceData: {
    renderCount: number;
    averageRenderTime: number;
    lastRenderTime: number;
  };
} {
  const { trackEffect } = usePerformanceTracker(componentName);
  const renderCountRef = useRef(0);
  const renderTimesRef = useRef<number[]>([]);
  const [performanceData, setPerformanceData] = useState({
    renderCount: 0,
    averageRenderTime: 0,
    lastRenderTime: 0
  });

  const measureRender = useCallback(() => {
    const renderTime = performance.now();
    renderCountRef.current += 1;
    renderTimesRef.current.push(renderTime);
    
    // 保持最近的50次渲染记录
    if (renderTimesRef.current.length > 50) {
      renderTimesRef.current = renderTimesRef.current.slice(-50);
    }

    const averageTime = renderTimesRef.current.reduce((sum, time, index, arr) => {
      if (index === 0) return 0;
      return sum + (arr[index] - arr[index - 1]);
    }, 0) / Math.max(1, renderTimesRef.current.length - 1);

    setPerformanceData({
      renderCount: renderCountRef.current,
      averageRenderTime: averageTime,
      lastRenderTime: renderTime
    });

    perfMonitor.recordRender(componentName, renderTime);
  }, [componentName]);

  const measureEffect = useCallback(async (effectName: string, fn: () => void | Promise<void>) => {
    await trackEffect(effectName, fn);
  }, [trackEffect]);

  return {
    measureRender,
    measureEffect,
    performanceData
  };
}

/**
 * 内存监控Hook
 */
export function useMemoryMonitor(intervalMs: number = 5000): {
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  } | null;
  takeSnapshot: () => void;
} {
  const [memoryUsage, setMemoryUsage] = useState<{
    used: number;
    total: number;
    percentage: number;
  } | null>(null);

  const takeSnapshot = useCallback(() => {
    const snapshot = perfMonitor.takeMemorySnapshot();
    if (snapshot) {
      setMemoryUsage({
        used: snapshot.usedJSHeapSize,
        total: snapshot.totalJSHeapSize,
        percentage: (snapshot.usedJSHeapSize / snapshot.jsHeapSizeLimit) * 100
      });
    }
  }, []);

  useEffect(() => {
    // 立即拍摄一次快照
    takeSnapshot();

    // 定期监控
    const interval = setInterval(takeSnapshot, intervalMs);

    return () => clearInterval(interval);
  }, [takeSnapshot, intervalMs]);

  return {
    memoryUsage,
    takeSnapshot
  };
}

// ====================================================
// 数据缓存Hooks
// ====================================================

/**
 * 智能缓存Hook
 */
export function useSmartCache<K, V>(
  maxSize: number = 100,
  ttl: number = 5 * 60 * 1000 // 5分钟默认TTL
): {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  has: (key: K) => boolean;
  delete: (key: K) => boolean;
  clear: () => void;
  size: number;
} {
  const cacheRef = useRef(new Map<K, { value: V; timestamp: number }>());

  const cleanup = useCallback(() => {
    const now = Date.now();
    const cache = cacheRef.current;
    
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp > ttl) {
        cache.delete(key);
      }
    }

    // 如果仍然超过最大大小，删除最旧的条目
    if (cache.size > maxSize) {
      const entries = Array.from(cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toDelete = entries.slice(0, cache.size - maxSize);
      toDelete.forEach(([key]) => cache.delete(key));
    }
  }, [maxSize, ttl]);

  const get = useCallback((key: K): V | undefined => {
    const entry = cacheRef.current.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (now - entry.timestamp > ttl) {
      cacheRef.current.delete(key);
      return undefined;
    }

    return entry.value;
  }, [ttl]);

  const set = useCallback((key: K, value: V) => {
    cleanup();
    cacheRef.current.set(key, { value, timestamp: Date.now() });
  }, [cleanup]);

  const has = useCallback((key: K): boolean => {
    return get(key) !== undefined;
  }, [get]);

  const deleteKey = useCallback((key: K): boolean => {
    return cacheRef.current.delete(key);
  }, []);

  const clear = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  // 定期清理过期条目
  useEffect(() => {
    const interval = setInterval(cleanup, Math.min(ttl / 2, 60000)); // 最多每分钟清理一次
    return () => clearInterval(interval);
  }, [cleanup, ttl]);

  return {
    get,
    set,
    has,
    delete: deleteKey,
    clear,
    get size() {
      return cacheRef.current.size;
    }
  };
}

// ====================================================
// 默认导出
// ====================================================

export default {
  useDebounce,
  useDebouncedCallback,
  useThrottle,
  useThrottledCallback,
  usePagination,
  useVirtualScroll,
  useOptimizedSearch,
  useMultiFilter,
  useComponentPerformance,
  useMemoryMonitor,
  useSmartCache
};