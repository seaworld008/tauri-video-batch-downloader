// 任务状态枚举
export type TaskStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

// 下载器类型
export type DownloaderType = 'http' | 'm3u8' | 'youtube';

// 视频任务接口
export interface VideoTask {
  id: string;
  url: string;
  title: string;
  output_path: string;
  status: TaskStatus;
  progress: number;
  file_size?: number;
  downloaded_size: number;
  speed: number;
  eta?: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
  downloader_type?: DownloaderType;
  
  // 保存完整的视频信息供后续使用
  video_info?: {
    zl_id?: string;        // 专栏ID
    zl_name?: string;      // 专栏名称  
    record_url?: string;   // 视频链接
    kc_id?: string;        // 课程ID
    kc_name?: string;      // 课程名称
    
    // 向后兼容的字段
    id?: string;          
    name?: string;        
    url?: string;         
    course_id?: string;   
    course_name?: string; 
  };
}

// 进度更新接口
export interface ProgressUpdate {
  task_id: string;
  downloaded_size: number;
  total_size?: number;
  speed: number;
  eta?: number;
}

// 导入的数据接口 - 与Go版本Video结构保持一致
export interface ImportedData {
  zl_id?: string;        // 专栏ID (对应Rust版本的zl_id)
  zl_name?: string;      // 专栏名称 (对应Rust版本的zl_name)
  record_url?: string;   // 视频链接 (对应Rust版本的record_url)
  kc_id?: string;        // 课程ID (对应Rust版本的kc_id)  
  kc_name?: string;      // 课程名称 (对应Rust版本的kc_name)
  
  // 向后兼容的字段
  id?: string;          // 兼容旧版本
  name?: string;        // 兼容旧版本
  url?: string;         // 兼容旧版本
  course_id?: string;   // 兼容旧版本
  course_name?: string; // 兼容旧版本
}

// 下载配置接口
export interface DownloadConfig {
  concurrent_downloads: number;
  retry_attempts: number;
  timeout_seconds: number;
  user_agent: string;
  proxy?: string;
  headers: Record<string, string>;
  output_directory: string;
  auto_verify_integrity: boolean;
  integrity_algorithm?: string | null;
  expected_hashes: Record<string, string>;
}

// 应用配置接口
export interface AppConfig {
  download: DownloadConfig;
  ui: UIConfig;
  system: SystemConfig;
  youtube: YoutubeConfig;
  advanced: AdvancedConfig;
}

export interface UIConfig {
  theme: 'light' | 'dark' | 'system';
  language: string;
  window_width: number;
  window_height: number;
  window_x: number | null;
  window_y: number | null;
  show_completed_tasks: boolean;
  auto_start_downloads: boolean;
  show_notifications: boolean;
  notification_sound: boolean;
  minimize_to_tray: boolean;
  start_minimized: boolean;
}

export interface SystemConfig {
  auto_update: boolean;
  check_update_on_startup: boolean;
  hardware_acceleration: boolean;
  max_memory_usage_mb: number | null;
  temp_directory: string | null;
  log_level: string | null;
}

export interface YoutubeConfig {
  default_quality?: string | null;
  default_format?: string | null;
  extract_audio: boolean;
  audio_format?: string | null;
  download_subtitles: boolean;
  subtitle_languages: string[];
  download_thumbnail: boolean;
  download_description: boolean;
  playlist_reverse: boolean;
  playlist_max_items?: number | null;
}

export interface AdvancedConfig {
  enable_logging: boolean;
  log_level: 'error' | 'warn' | 'info' | 'debug';
  max_log_files: number;
  cleanup_on_exit: boolean;
  enable_proxy: boolean;
  proxy_type: 'http' | 'https' | 'socks4' | 'socks5';
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  proxy_password?: string;
  custom_user_agents: Record<string, string>;
  rate_limit_mbps?: number;
  enable_statistics: boolean;
  statistics_retention_days: number;
}

// 系统信息接口
export interface SystemInfo {
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
  network_speed: {
    download: number;
    upload: number;
  };
  active_downloads: number;
}

// 下载统计接口
export interface DownloadStats {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  total_downloaded: number;
  average_speed: number;
  active_downloads: number;
}

// YouTube 视频信息接口
export interface YoutubeVideoInfo {
  id: string;
  title: string;
  description: string;
  duration: number;
  thumbnail: string;
  formats: VideoFormat[];
  subtitles: SubtitleTrack[];
}

// 视频格式接口
export interface VideoFormat {
  format_id: string;
  ext: string;
  width?: number;
  height?: number;
  fps?: number;
  vbr?: number;
  abr?: number;
  filesize?: number;
  quality: string;
}

// 字幕轨道接口
export interface SubtitleTrack {
  language: string;
  language_code: string;
  url: string;
  ext: string;
}

// 文件编码检测结果
export interface EncodingDetection {
  encoding: string;
  confidence: number;
  language?: string;
}

// 导入预览数据
export interface ImportPreview {
  headers: string[];
  rows: string[][];
  total_rows: number;
  encoding: string;
  field_mapping: Record<string, string>;
}

// UI 视图类型
export type ViewType = 'dashboard' | 'import' | 'settings' | 'about';

// 通知类型
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

// 通知接口
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  duration?: number;
  actions?: NotificationAction[];
}

// 通知操作接口
export interface NotificationAction {
  label: string;
  action: () => void;
  style?: 'primary' | 'secondary';
}

// 过滤选项接口
export interface FilterOptions {
  status?: TaskStatus[];
  downloader_type?: DownloaderType[];
  date_range?: {
    start: Date;
    end: Date;
  };
  search_query?: string;
}

// 排序选项接口
export interface SortOptions {
  field: keyof VideoTask;
  direction: 'asc' | 'desc';
}

// 分页选项接口
export interface PaginationOptions {
  page: number;
  limit: number;
  total: number;
}

// API 响应泛型接口
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// Tauri 命令响应类型
export type TauriResponse<T = any> = Promise<T>;

// 错误类型
export interface AppError {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
}

// 组件 Props 基础接口
export interface BaseComponentProps {
  className?: string;
  children?: React.ReactNode;
}

// 表单字段类型
export type FormFieldType = 'text' | 'number' | 'select' | 'checkbox' | 'file' | 'textarea';

// 表单字段接口
export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  placeholder?: string;
  required?: boolean;
  validation?: any;
  options?: { label: string; value: any }[];
  description?: string;
}

// 模态框类型
export type ModalType = 'confirm' | 'info' | 'warning' | 'error' | 'custom';

// 模态框接口
export interface ModalOptions {
  type: ModalType;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  customContent?: React.ReactNode;
}

// 键盘快捷键接口
export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  action: () => void;
  description: string;
}
