# 🏗️ 架构模式与最佳实践

## Tauri + React + Zustand 企业级架构指南

### 🔧 核心技术栈最佳实践

#### 1. Tauri 后端架构模式

##### Command Pattern (推荐模式)
```rust
// src-tauri/src/commands/download.rs
#[tauri::command]
pub async fn start_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    options: DownloadOptions,
) -> Result<String, String> {
    let mut manager = state.download_manager.write().await;
    let task_id = manager.add_task(url, options).await?;
    
    // 发送事件到前端
    app.emit_all("download:started", &task_id)?;
    Ok(task_id)
}
```

##### State Management Pattern
```rust
// src-tauri/src/state.rs
pub struct AppState {
    pub download_manager: Arc<RwLock<DownloadManager>>,
    pub config: Arc<RwLock<AppConfig>>,
    pub event_bus: Arc<EventBus>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            download_manager: Arc::new(RwLock::new(DownloadManager::new())),
            config: Arc::new(RwLock::new(AppConfig::default())),
            event_bus: Arc::new(EventBus::new()),
        }
    }
}
```

##### Event-Driven Architecture
```rust
// src-tauri/src/events.rs
pub struct EventBus {
    app_handle: Option<tauri::AppHandle>,
}

impl EventBus {
    pub async fn emit_progress(&self, task_id: &str, progress: f64) -> Result<()> {
        if let Some(handle) = &self.app_handle {
            handle.emit_all("download:progress", json!({
                "task_id": task_id,
                "progress": progress
            }))?;
        }
        Ok(())
    }
}
```

#### 2. Zustand 状态管理最佳实践

##### Slices Pattern (企业级推荐)
```typescript
// src/stores/slices/downloadSlice.ts
import { StateCreator } from 'zustand'

export interface DownloadSlice {
  tasks: VideoTask[]
  isDownloading: boolean
  // Actions
  addTask: (task: Omit<VideoTask, 'id'>) => void
  updateTask: (id: string, updates: Partial<VideoTask>) => void
  removeTask: (id: string) => void
  startDownload: (id: string) => Promise<void>
  pauseDownload: (id: string) => Promise<void>
  resumeDownload: (id: string) => Promise<void>
}

export const createDownloadSlice: StateCreator<
  AppStore,
  [['zustand/devtools', never], ['zustand/persist', unknown]],
  [],
  DownloadSlice
> = (set, get) => ({
  tasks: [],
  isDownloading: false,
  
  addTask: (task) => set(
    (state) => ({
      tasks: [...state.tasks, { ...task, id: crypto.randomUUID() }]
    }),
    false,
    'download/addTask'
  ),
  
  updateTask: (id, updates) => set(
    (state) => ({
      tasks: state.tasks.map(task =>
        task.id === id ? { ...task, ...updates } : task
      )
    }),
    false,
    'download/updateTask'
  ),
  
  startDownload: async (id) => {
    const { tasks } = get()
    const task = tasks.find(t => t.id === id)
    if (!task) throw new Error('Task not found')
    
    try {
      set({ isDownloading: true }, false, 'download/startDownload')
      await invoke('start_download', { url: task.url, options: task.options })
    } catch (error) {
      console.error('Download failed:', error)
      throw error
    } finally {
      set({ isDownloading: false }, false, 'download/endDownload')
    }
  }
})
```

##### 持久化配置 (Persistence Pattern)
```typescript
// src/stores/slices/configSlice.ts
export const createConfigSlice: StateCreator<
  AppStore,
  [['zustand/devtools', never], ['zustand/persist', unknown]],
  [],
  ConfigSlice
> = (set, get) => ({
  theme: 'dark',
  language: 'zh-CN',
  downloadPath: './downloads',
  maxConcurrent: 3,
  
  updateConfig: (updates) => set(
    (state) => ({ ...state, ...updates }),
    false,
    'config/updateConfig'
  ),
})
```

##### Store 组合 (Store Composition)
```typescript
// src/stores/index.ts
import { create } from 'zustand'
import { devtools, persist, createJSONStorage } from 'zustand/middleware'
import { createDownloadSlice } from './slices/downloadSlice'
import { createConfigSlice } from './slices/configSlice'
import { createUISlice } from './slices/uiSlice'

export type AppStore = DownloadSlice & ConfigSlice & UISlice

export const useAppStore = create<AppStore>()(
  devtools(
    persist(
      (...args) => ({
        ...createDownloadSlice(...args),
        ...createConfigSlice(...args),
        ...createUISlice(...args),
      }),
      {
        name: 'video-downloader-storage',
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          // 只持久化配置相关状态，不持久化临时状态
          theme: state.theme,
          language: state.language,
          downloadPath: state.downloadPath,
          maxConcurrent: state.maxConcurrent,
        })
      }
    ),
    { name: 'VideoDownloaderStore' }
  )
)
```

#### 3. Async Actions 最佳实践

##### Error Boundary Pattern
```typescript
// src/stores/slices/downloadSlice.ts
export const createDownloadSlice = (set, get) => ({
  // ... other state
  errors: [] as Array<{ id: string; message: string; timestamp: Date }>,
  
  startDownloadWithErrorHandling: async (id: string) => {
    try {
      set({ isDownloading: true }, false, 'download/start')
      
      // 监听 Tauri 事件
      const unlisten = await listen('download:error', (event) => {
        set(
          (state) => ({
            errors: [...state.errors, {
              id: crypto.randomUUID(),
              message: event.payload.message,
              timestamp: new Date()
            }]
          }),
          false,
          'download/addError'
        )
      })
      
      await invoke('start_download', { taskId: id })
      
      // 清理监听器
      unlisten()
    } catch (error) {
      set(
        (state) => ({
          errors: [...state.errors, {
            id: crypto.randomUUID(),
            message: error.message,
            timestamp: new Date()
          }]
        }),
        false,
        'download/addError'
      )
    } finally {
      set({ isDownloading: false }, false, 'download/end')
    }
  }
})
```

#### 4. TypeScript 类型安全最佳实践

##### 严格类型定义
```typescript
// src/types/download.ts
export interface VideoTask {
  id: string
  url: string
  filename: string
  progress: number
  status: TaskStatus
  speed: number
  eta: number
  createdAt: Date
  updatedAt: Date
  options: DownloadOptions
}

export type TaskStatus = 
  | 'pending' 
  | 'downloading' 
  | 'paused' 
  | 'completed' 
  | 'failed'

export interface DownloadOptions {
  quality?: string
  format?: string
  outputPath?: string
  headers?: Record<string, string>
  proxy?: string
}

// Tauri Command 类型
export interface TauriCommands {
  start_download: (args: { url: string; options: DownloadOptions }) => Promise<string>
  pause_download: (args: { taskId: string }) => Promise<void>
  resume_download: (args: { taskId: string }) => Promise<void>
  get_download_info: (args: { url: string }) => Promise<VideoInfo>
}

// 扩展全局类型
declare global {
  interface Window {
    __TAURI__: {
      invoke: <K extends keyof TauriCommands>(
        cmd: K,
        args?: Parameters<TauriCommands[K]>[0]
      ) => ReturnType<TauriCommands[K]>
    }
  }
}
```

#### 5. 性能优化模式

##### Selector Pattern (避免不必要重渲染)
```typescript
// src/hooks/useDownloadTasks.ts
import { useAppStore } from '@/stores'
import { useMemo } from 'react'

export const useDownloadTasks = () => {
  // 使用 selector 模式避免不必要的重新渲染
  const tasks = useAppStore(state => state.tasks)
  const isDownloading = useAppStore(state => state.isDownloading)
  
  // 派生状态计算
  const stats = useMemo(() => ({
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'completed').length,
    downloading: tasks.filter(t => t.status === 'downloading').length,
    failed: tasks.filter(t => t.status === 'failed').length,
    totalProgress: tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length
  }), [tasks])
  
  return { tasks, isDownloading, stats }
}
```

##### Virtual Scrolling for Large Lists
```typescript
// src/components/TaskList/TaskList.tsx
import { useVirtualizer } from '@tanstack/react-virtual'

export const TaskList = () => {
  const { tasks } = useDownloadTasks()
  const parentRef = useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // 预估每个任务项高度
    overscan: 5
  })
  
  return (
    <div ref={parentRef} className="h-96 overflow-auto">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <TaskItem
            key={item.key}
            task={tasks[item.index]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

### 🔒 安全性最佳实践

#### CSP 配置
```json
// src-tauri/tauri.conf.json
{
  "tauri": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

#### 权限最小化原则
```json
// src-tauri/tauri.conf.json
{
  "tauri": {
    "allowlist": {
      "fs": {
        "readFile": true,
        "writeFile": true,
        "scope": ["$DOWNLOAD/**", "$TEMP/**"]
      },
      "http": {
        "request": true,
        "scope": ["https://**"]
      }
    }
  }
}
```

### 📋 开发工作流最佳实践

#### 1. 开发环境配置
- 使用 `pnpm` 作为包管理器
- 配置 ESLint + Prettier
- 设置 Husky Git hooks
- 使用 TypeScript strict 模式

#### 2. 测试策略
- 单元测试：Vitest + Testing Library
- 集成测试：Playwright
- Rust 测试：cargo test
- E2E 测试：Tauri WebDriver

#### 3. 构建和部署
- 使用 GitHub Actions 自动化构建
- 多平台构建：Windows、macOS、Linux
- 自动签名和公证
- 自动发布到 GitHub Releases

这些架构模式和最佳实践确保了项目的可维护性、可扩展性和类型安全性。