/**
 * 格式化工具函数
 * 用于在 UI 中显示各种数据格式
 */

/**
 * 格式化字节大小
 * @param bytes 字节数
 * @param decimals 小数位数，默认为2
 * @returns 格式化后的字符串，如 "1.23 MB"
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes <= 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 格式化持续时间（秒）
 * @param seconds 总秒数
 * @returns 格式化后的字符串，如 "1h 23m 45s" 或 "23m 45s" 或 "45s"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (remainingSeconds > 0 || parts.length === 0) {
    parts.push(`${remainingSeconds}s`);
  }

  return parts.join(' ');
}

/**
 * 格式化日期时间
 * @param dateString ISO 8601 日期字符串
 * @returns 格式化后的日期时间字符串
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) {
    return '无效日期';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // 相对时间（1分钟内）
  if (diffMs < 60000) {
    return '刚刚';
  }

  // 相对时间（1小时内）
  if (diffMinutes < 60) {
    return `${diffMinutes}分钟前`;
  }

  // 相对时间（24小时内）
  if (diffHours < 24) {
    return `${diffHours}小时前`;
  }

  // 相对时间（7天内）
  if (diffDays < 7) {
    return `${diffDays}天前`;
  }

  // 绝对时间
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  // 如果是今年，不显示年份
  if (year === now.getFullYear()) {
    return `${month}-${day} ${hours}:${minutes}`;
  }

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 格式化相对时间（更人性化）
 * @param dateString ISO 8601 日期字符串
 * @returns 相对时间字符串，如 "2小时前"
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) {
    return '无效日期';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

  if (diffMs < 60000) { // 1分钟内
    return '刚刚';
  }

  if (diffMs < 3600000) { // 1小时内
    return rtf.format(-Math.floor(diffMs / 60000), 'minute');
  }

  if (diffMs < 86400000) { // 24小时内
    return rtf.format(-Math.floor(diffMs / 3600000), 'hour');
  }

  if (diffMs < 604800000) { // 7天内
    return rtf.format(-Math.floor(diffMs / 86400000), 'day');
  }

  if (diffMs < 2592000000) { // 30天内
    return rtf.format(-Math.floor(diffMs / 604800000), 'week');
  }

  if (diffMs < 31536000000) { // 365天内
    return rtf.format(-Math.floor(diffMs / 2592000000), 'month');
  }

  return rtf.format(-Math.floor(diffMs / 31536000000), 'year');
}

/**
 * 格式化速度
 * @param bytesPerSecond 每秒字节数
 * @returns 格式化后的速度字符串，如 "1.23 MB/s"
 */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * 格式化百分比
 * @param value 数值（0-100）
 * @param decimals 小数位数，默认为1
 * @returns 格式化后的百分比字符串，如 "67.5%"
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * 格式化文件名（从URL或路径中提取）
 * @param urlOrPath URL或文件路径
 * @returns 文件名
 */
export function formatFileName(urlOrPath: string): string {
  // 检查是否为真实的URL（以http或https开头）
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    try {
      const url = new URL(urlOrPath);
      const pathname = url.pathname;
      const fileName = pathname.split('/').pop() || 'unknown';
      
      // 移除查询参数
      return fileName.split('?')[0] || 'unknown';
    } catch {
      // URL解析失败，降级到路径处理
    }
  }
  
  // 作为文件路径处理
  const normalizedPath = urlOrPath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  return parts[parts.length - 1] || 'unknown';
}

/**
 * 格式化任务状态为中文
 * @param status 任务状态
 * @returns 中文状态
 */
export function formatTaskStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending: '等待中',
    downloading: '下载中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  };
  
  return statusMap[status] || status;
}

/**
 * 格式化数字（添加千分位分隔符）
 * @param num 数字
 * @returns 格式化后的数字字符串
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('zh-CN').format(num);
}

/**
 * 截断文本并添加省略号
 * @param text 原文本
 * @param maxLength 最大长度
 * @returns 截断后的文本
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * 格式化 ETA（预计剩余时间）
 * @param seconds ETA秒数
 * @returns 格式化的ETA字符串
 */
export function formatETA(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) {
    return '--';
  }

  if (seconds < 60) {
    return `${Math.ceil(seconds)}秒`;
  }

  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes}分钟`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  
  if (hours < 24) {
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  
  return remainingHours > 0 ? `${days}天${remainingHours}小时` : `${days}天`;
}