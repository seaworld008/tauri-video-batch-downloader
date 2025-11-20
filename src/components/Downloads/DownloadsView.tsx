import React from 'react';
import { OptimizedDownloadsView } from './OptimizedDownloadsView';

// DownloadsView 现在作为 OptimizedDownloadsView 的别名
// 所有的视图逻辑已统一到 OptimizedDownloadsView 中
export const DownloadsView: React.FC = () => {
  return <OptimizedDownloadsView />;
};
