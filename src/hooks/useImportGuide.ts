import { useState, useCallback, useRef, useEffect } from 'react';

interface ImportGuideState {
  showGuide: boolean;
  taskCount: number;
  selectedCount: number;
  timestamp: number;
}

const GUIDE_STORAGE_KEY = 'video_downloader_import_guide';
const GUIDE_TIMEOUT = 30000; // 30秒后自动隐藏

const createHiddenState = (): ImportGuideState => ({
  showGuide: false,
  taskCount: 0,
  selectedCount: 0,
  timestamp: 0,
});

export const useImportGuide = () => {
  const [guideState, setGuideState] = useState<ImportGuideState>(createHiddenState);

  const autoHideTimerRef = useRef<number | undefined>(undefined);

  const clearAutoHideTimer = useCallback(() => {
    if (autoHideTimerRef.current !== undefined) {
      window.clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = undefined;
    }
  }, []);

  const hideGuideState = useCallback(() => {
    setGuideState(createHiddenState());

    try {
      localStorage.removeItem(GUIDE_STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear import guide state:', error);
    }
  }, []);

  // 关闭引导
  const dismissGuide = useCallback(() => {
    clearAutoHideTimer();
    hideGuideState();
  }, [clearAutoHideTimer, hideGuideState]);

  // 触发导入成功引导 - 改进版本
  const triggerImportGuide = useCallback(
    (taskCount: number, selectedCount: number = 0) => {
      clearAutoHideTimer();

      const newState: ImportGuideState = {
        showGuide: true,
        taskCount,
        selectedCount: selectedCount || taskCount,
        timestamp: Date.now(),
      };

      console.log('🎯 触发导入引导:', newState);

      // 同步更新状态
      setGuideState(newState);

      // 异步保存到 localStorage，避免阻塞UI更新
      window.setTimeout(() => {
        try {
          localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(newState));
          console.log('💾 引导状态已保存到localStorage');
        } catch (error) {
          console.warn('Failed to save import guide state:', error);
        }
      }, 0);

      // 延长自动隐藏时间，确保用户能看到引导
      autoHideTimerRef.current = window.setTimeout(() => {
        console.log('⏰ 自动隐藏导入引导');
        hideGuideState();
        clearAutoHideTimer();
      }, GUIDE_TIMEOUT);
    },
    [clearAutoHideTimer, hideGuideState]
  );

  // 检查是否应该显示引导（页面刷新后恢复状态）- 改进版本
  const checkAndRestoreGuide = useCallback(() => {
    try {
      const saved = localStorage.getItem(GUIDE_STORAGE_KEY);
      console.log('🔍 检查localStorage中的引导状态:', saved ? '有数据' : '无数据');

      if (saved) {
        const savedState: ImportGuideState = JSON.parse(saved);
        console.log('📋 解析的引导状态:', savedState);

        // 检查是否在有效时间范围内（5分钟内）
        const isRecent = Date.now() - savedState.timestamp < 300000; // 5分钟
        const isValid = savedState.showGuide && isRecent;

        console.log('✅ 状态验证:', {
          showGuide: savedState.showGuide,
          isRecent,
          isValid,
          age: Math.round((Date.now() - savedState.timestamp) / 1000) + '秒',
        });

        if (isValid) {
          console.log('🎉 恢复引导状态:', savedState);
          setGuideState(savedState);
          return true;
        }

        // 过期或无效的状态，清理掉
        console.log('🗑️ 清理过期的引导状态');
        localStorage.removeItem(GUIDE_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Failed to restore import guide state:', error);
      // 清理可能损坏的数据
      localStorage.removeItem(GUIDE_STORAGE_KEY);
    }
    return false;
  }, []);

  useEffect(() => {
    return () => {
      clearAutoHideTimer();
    };
  }, [clearAutoHideTimer]);

  return {
    guideState,
    triggerImportGuide,
    dismissGuide,
    checkAndRestoreGuide,
  };
};
