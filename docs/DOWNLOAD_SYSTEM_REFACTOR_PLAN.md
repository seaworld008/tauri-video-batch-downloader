# 下载系统重构方案

## 文档版本
- **版本**: 1.0.0
- **日期**: 2024-12-02
- **作者**: AI Assistant

---

## 一、问题诊断

### 1.1 当前症状
1. **下载进度显示为0%**: 点击开始下载后，进度条和速度始终为0
2. **暂停按钮无效**: 点击暂停没有任何响应
3. **批量操作异常**: "全部开始"后任务状态变为"下载中"但无实际进度

### 1.2 根本原因分析

#### 问题1: 进度更新链路断裂

```
当前进度更新流程:
HttpDownloader.update_progress() 
    → progress_tx.send() 
    → [progress_handle] download_progress_rx.recv()
    → event_sender.send(TaskProgress)
    → [main.rs event bridge] app_handle.emit_all("download_progress", ...)
    → [Frontend] listen("download_progress")
```

**断点位置**:
1. `execute_download_attempt` 中克隆 downloader 后设置 progress_tx，但原始 downloader 的 progress_tx 可能为 None
2. `manager.rs:1753-1754` 处的 `downloader_clone.set_progress_callback()` 在下载开始前设置，但实际下载可能使用了不同的实例

```rust
// manager.rs:1753-1754 - 潜在问题
let mut downloader_clone = (*downloader).clone();
downloader_clone.set_progress_callback(download_progress_tx.clone());

// downloader.rs:864 - Clone时复制了旧的progress_tx (可能是None)
progress_tx: self.progress_tx.clone(),
```

#### 问题2: 任务ID不一致

```rust
// manager.rs:1644-1646
let mut download_task = DownloadTask::new(url.to_string(), output_path.to_string(), filename);
download_task.id = task_id.to_string();  // 手动覆盖ID
```

这个覆盖是正确的，但如果 `downloader.download()` 内部生成新的 task，ID 就会不匹配。

#### 问题3: 暂停机制设计缺陷

当前暂停实现:
```rust
// manager.rs:868-911
pub(crate) async fn pause_download_impl(&mut self, task_id: &str) -> AppResult<()> {
    self.auto_fill_enabled = false;
    let handle = self.active_downloads.lock().await.remove(task_id);
    
    let downloader = Arc::clone(&self.http_downloader);
    let _ = downloader.cancel_download(task_id).await;  // 只设置cancel_flag
    downloader.force_remove_active(task_id).await;
    
    if let Some(handle) = handle {
        handle.abort();  // 强制中断tokio任务
    }
    // ...
}
```

**缺陷**:
1. `cancel_download` 只设置 `AtomicBool` 标志，不会中断正在进行的 HTTP 流
2. `handle.abort()` 强制中断可能导致状态不一致
3. 没有等待下载循环优雅退出

#### 问题4: ResumeDownloader 进度回调问题

```rust
// downloader.rs:459-463
let progress_callback: ResumeProgressCallback = {
    let delta_tx = delta_tx.clone();
    Arc::new(move |_, delta, _| {
        let _ = delta_tx.send(delta);
    })
};
```

这里使用了独立的 `delta_tx` 通道，但 `update_progress` 需要通过 `self.progress_tx` 发送。两个通道系统没有正确连接。

---

## 二、系统架构重设计

### 2.1 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  DownloadStore  │  │   TaskItem.tsx  │  │   TaskList.tsx  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                │                                  │
│                     listen("download_progress")                   │
│                     listen("task_status_changed")                 │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Tauri Event Bridge                            │
│              (main.rs event handler loop)                        │
│                                                                   │
│   DownloadEvent::TaskProgress  → emit("download_progress")       │
│   DownloadEvent::TaskStarted   → emit("task_status_changed")     │
│   DownloadEvent::TaskPaused    → emit("task_status_changed")     │
│   DownloadEvent::TaskCompleted → emit("task_status_changed")     │
│   DownloadEvent::TaskFailed    → emit("task_status_changed")     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DownloadRuntime                               │
│                  (runtime.rs router loop)                        │
│                                                                   │
│   RuntimeCommand::Start  → manager.start_download_impl()        │
│   RuntimeCommand::Pause  → manager.pause_download_impl()        │
│   RuntimeCommand::Cancel → manager.cancel_download_impl()       │
│   RuntimeCommand::FillSlots → manager.fill_concurrency_slots()  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DownloadManager                               │
│                                                                   │
│   ┌──────────────────┐  ┌───────────────────┐                   │
│   │   Task Storage   │  │  Active Downloads │                   │
│   │   (HashMap)      │  │  (JoinHandle Map) │                   │
│   └──────────────────┘  └───────────────────┘                   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                  Download Workers                         │  │
│   │                                                            │  │
│   │   Worker spawned per task with:                           │  │
│   │   - CancellationToken (tokio_util)                        │  │
│   │   - Progress channel                                      │  │
│   │   - Graceful shutdown support                             │  │
│   └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Unified Downloader Engine                       │
│                                                                   │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│   │ HttpDownloader│  │ M3U8Downloader│  │ ResumeDownloader │ │
│   └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│          │                │                      │               │
│          └────────────────┼──────────────────────┘               │
│                           │                                       │
│                           ▼                                       │
│                  Unified Progress Callback                       │
│                  (Single channel per task)                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心改进点

#### 2.2.1 统一取消令牌 (CancellationToken)

使用 `tokio_util::sync::CancellationToken` 替代 `AtomicBool`:

```rust
// 新设计
use tokio_util::sync::CancellationToken;

pub struct DownloadWorkerContext {
    pub task_id: String,
    pub cancel_token: CancellationToken,
    pub progress_tx: mpsc::UnboundedSender<ProgressUpdate>,
}

// 在下载循环中使用
loop {
    tokio::select! {
        biased;
        _ = cancel_token.cancelled() => {
            info!("Download cancelled: {}", task_id);
            return Err(DownloadCancelled);
        }
        chunk = stream.next() => {
            // 处理数据
        }
    }
}
```

#### 2.2.2 统一进度通道

每个下载任务只使用一个进度通道，从底层一直传递到顶层:

```rust
// 新设计
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub output_path: String,
    // ... 其他字段
    
    // 统一进度回调
    progress_callback: Option<Arc<dyn Fn(ProgressUpdate) + Send + Sync>>,
}

// 进度更新统一入口
impl DownloadTask {
    pub fn update_progress(&self, downloaded: u64, total: Option<u64>, speed: f64) {
        if let Some(callback) = &self.progress_callback {
            callback(ProgressUpdate {
                task_id: self.id.clone(),
                downloaded_size: downloaded,
                total_size: total,
                speed,
                progress: total.map(|t| downloaded as f64 / t as f64),
                eta: self.calculate_eta(downloaded, total, speed),
            });
        }
    }
}
```

#### 2.2.3 优雅暂停/恢复机制

```rust
// 新设计
pub enum WorkerCommand {
    Pause,
    Resume,
    Cancel,
}

pub struct DownloadWorker {
    task_id: String,
    cancel_token: CancellationToken,
    command_rx: mpsc::Receiver<WorkerCommand>,
    state: WorkerState,
}

impl DownloadWorker {
    async fn run(&mut self) -> Result<()> {
        loop {
            tokio::select! {
                biased;
                
                // 优先处理命令
                Some(cmd) = self.command_rx.recv() => {
                    match cmd {
                        WorkerCommand::Pause => {
                            self.state = WorkerState::Paused;
                            self.wait_for_resume().await?;
                        }
                        WorkerCommand::Cancel => {
                            return Ok(());
                        }
                        WorkerCommand::Resume => {
                            self.state = WorkerState::Running;
                        }
                    }
                }
                
                // 取消令牌
                _ = self.cancel_token.cancelled() => {
                    return Ok(());
                }
                
                // 下载逻辑
                result = self.download_chunk() => {
                    // 处理下载
                }
            }
        }
    }
}
```

---

## 三、具体修复步骤

### Phase 1: 修复进度更新链路 (优先级: 高)

#### Step 1.1: 确保进度通道正确连接

**文件**: `src-tauri/src/core/manager.rs`

```rust
// 修改 execute_download_attempt 函数

async fn execute_download_attempt(
    task_id: &str,
    url: &str,
    output_path: &str,
    downloader: Arc<HttpDownloader>,
    event_sender: EventSender,
    // ... 其他参数
) -> AppResult<String> {
    // 创建专用进度通道
    let (progress_tx, mut progress_rx) = mpsc::unbounded_channel::<ProgressUpdate>();
    
    // 创建进度回调 - 直接发送到事件通道
    let task_id_clone = task_id.to_string();
    let event_sender_clone = event_sender.clone();
    
    // 统一进度处理器
    let progress_handle = tokio::spawn(async move {
        while let Some(update) = progress_rx.recv().await {
            // 1. 发送到前端
            let _ = event_sender_clone.send(DownloadEvent::TaskProgress {
                task_id: task_id_clone.clone(),
                progress: update.clone(),
            });
            
            // 2. 更新任务存储 (低频率)
            // ... 
        }
    });
    
    // 创建统一的进度回调
    let progress_callback = Arc::new(move |update: ProgressUpdate| {
        let _ = progress_tx.send(update);
    });
    
    // 执行下载
    let result = downloader.download_with_progress(
        task_id,
        url,
        output_path,
        progress_callback,
    ).await;
    
    // ...
}
```

#### Step 1.2: 修改 HttpDownloader 支持外部进度回调

**文件**: `src-tauri/src/core/downloader.rs`

```rust
// 新增方法
pub async fn download_with_progress(
    &self,
    task_id: &str,
    url: &str,
    output_path: &str,
    progress_callback: Arc<dyn Fn(ProgressUpdate) + Send + Sync>,
) -> Result<String> {
    // 使用传入的回调而不是内部的 progress_tx
    // ...
}
```

### Phase 2: 修复暂停/取消机制 (优先级: 高)

#### Step 2.1: 引入 CancellationToken

**文件**: `src-tauri/Cargo.toml`

```toml
[dependencies]
tokio-util = { version = "0.7", features = ["sync"] }
```

**文件**: `src-tauri/src/core/manager.rs`

```rust
use tokio_util::sync::CancellationToken;

pub struct ActiveDownload {
    pub handle: tokio::task::JoinHandle<()>,
    pub cancel_token: CancellationToken,
    pub command_tx: mpsc::Sender<WorkerCommand>,
}

// 修改 active_downloads 类型
active_downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,

// 修改 pause_download_impl
pub(crate) async fn pause_download_impl(&mut self, task_id: &str) -> AppResult<()> {
    let mut active = self.active_downloads.lock().await;
    
    if let Some(download) = active.get(task_id) {
        // 发送暂停命令而不是直接中断
        let _ = download.command_tx.send(WorkerCommand::Pause).await;
        
        // 等待确认暂停
        // ...
    }
    
    self.update_task_status(task_id, TaskStatus::Paused).await?;
    // ...
}
```

### Phase 3: 优化前端监听器 (优先级: 中)

#### Step 3.1: 确保监听器正确初始化

**文件**: `src/stores/downloadStore.ts`

```typescript
// 修改 initializeProgressListener

export const initializeProgressListener = async () => {
  if (listenersInitialized) {
    console.log('Listeners already initialized, skipping');
    return;
  }

  try {
    console.log('🔌 Initializing download event listeners...');
    
    // 监听进度更新
    const unlistenProgress = await listen<ProgressUpdate>('download_progress', event => {
      const update = event.payload;
      
      // 增加调试日志
      console.log('📊 Progress update received:', update);
      
      if (!update || !update.task_id) {
        console.warn('Invalid progress update:', update);
        return;
      }
      
      // 更新状态...
    });
    
    // 监听状态变化
    const unlistenStatus = await listen<TaskStatusPayload>('task_status_changed', event => {
      console.log('🔄 Status change received:', event.payload);
      // ...
    });
    
    listenersInitialized = true;
    console.log('✅ Download event listeners initialized');
    
  } catch (error) {
    console.error('❌ Failed to initialize listeners:', error);
    throw error;
  }
};
```

### Phase 4: 数据一致性保障 (优先级: 中)

#### Step 4.1: 定期状态同步

```typescript
// 在 downloadStore.ts 中添加

// 启动定期同步
const startPeriodicSync = () => {
  const SYNC_INTERVAL = 2000; // 2秒
  
  setInterval(async () => {
    const state = useDownloadStore.getState();
    const hasActiveDownloads = state.tasks.some(t => t.status === 'downloading');
    
    if (hasActiveDownloads) {
      try {
        // 从后端获取最新任务状态
        const tasks = await invoke<VideoTask[]>('get_download_tasks');
        
        // 智能合并状态
        useDownloadStore.setState(current => ({
          tasks: mergeTasks(current.tasks, tasks),
        }));
      } catch (error) {
        console.warn('Sync failed:', error);
      }
    }
  }, SYNC_INTERVAL);
};

// 智能合并函数
const mergeTasks = (local: VideoTask[], remote: VideoTask[]): VideoTask[] => {
  const remoteMap = new Map(remote.map(t => [t.id, t]));
  
  return local.map(localTask => {
    const remoteTask = remoteMap.get(localTask.id);
    if (!remoteTask) return localTask;
    
    // 如果远程进度更大，使用远程数据
    if (remoteTask.progress > localTask.progress) {
      return { ...localTask, ...remoteTask };
    }
    
    // 如果状态不一致，以远程为准
    if (remoteTask.status !== localTask.status) {
      return { ...localTask, status: remoteTask.status };
    }
    
    return localTask;
  });
};
```

---

## 四、测试验证

### 4.1 单元测试

```rust
#[tokio::test]
async fn test_progress_callback_chain() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    
    let callback = Arc::new(move |update: ProgressUpdate| {
        tx.send(update).unwrap();
    });
    
    // 模拟进度更新
    callback(ProgressUpdate {
        task_id: "test".to_string(),
        downloaded_size: 1000,
        total_size: Some(10000),
        speed: 100.0,
        progress: Some(0.1),
        eta: Some(90),
    });
    
    let received = rx.recv().await.unwrap();
    assert_eq!(received.downloaded_size, 1000);
}

#[tokio::test]
async fn test_pause_resume_flow() {
    let cancel_token = CancellationToken::new();
    let (cmd_tx, mut cmd_rx) = mpsc::channel(10);
    
    // 模拟下载worker
    let worker_token = cancel_token.clone();
    let worker = tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = worker_token.cancelled() => {
                    return "cancelled";
                }
                Some(cmd) = cmd_rx.recv() => {
                    match cmd {
                        WorkerCommand::Pause => return "paused",
                        _ => {}
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    // 模拟下载工作
                }
            }
        }
    });
    
    // 发送暂停命令
    cmd_tx.send(WorkerCommand::Pause).await.unwrap();
    
    let result = worker.await.unwrap();
    assert_eq!(result, "paused");
}
```

### 4.2 集成测试

```typescript
// __tests__/integration/download.test.tsx

describe('Download Integration', () => {
  it('should update progress when download starts', async () => {
    const { result } = renderHook(() => useDownloadStore());
    
    // 添加任务
    await act(async () => {
      await result.current.addTasks([mockTask]);
    });
    
    // 开始下载
    await act(async () => {
      await result.current.startDownload(mockTask.id);
    });
    
    // 等待进度更新
    await waitFor(() => {
      const task = result.current.tasks.find(t => t.id === mockTask.id);
      expect(task?.progress).toBeGreaterThan(0);
    }, { timeout: 5000 });
  });
  
  it('should pause download immediately', async () => {
    const { result } = renderHook(() => useDownloadStore());
    
    // 开始下载
    await act(async () => {
      await result.current.startDownload(mockTask.id);
    });
    
    // 暂停下载
    await act(async () => {
      await result.current.pauseDownload(mockTask.id);
    });
    
    // 验证状态
    const task = result.current.tasks.find(t => t.id === mockTask.id);
    expect(task?.status).toBe('paused');
  });
});
```

---

## 五、实施计划

### 阶段一: 紧急修复 (1-2天)
1. [x] 诊断问题根因
2. [ ] 修复进度回调链路
3. [ ] 修复暂停机制

### 阶段二: 架构优化 (3-5天)
1. [ ] 引入 CancellationToken
2. [ ] 统一进度通道
3. [ ] 实现优雅暂停/恢复

### 阶段三: 质量保障 (2-3天)
1. [ ] 编写单元测试
2. [ ] 编写集成测试
3. [ ] 性能测试

### 阶段四: 监控增强 (1-2天)
1. [ ] 添加诊断日志
2. [ ] 实现状态同步机制
3. [ ] 错误恢复机制

---

## 六、风险评估

| 风险项 | 等级 | 缓解措施 |
|--------|------|----------|
| 并发状态竞争 | 高 | 使用 RwLock 和原子操作 |
| 内存泄漏 | 中 | 确保正确释放 channel 和 handle |
| 网络异常恢复 | 中 | 实现重试机制和断点续传 |
| 前后端状态不一致 | 中 | 定期同步和冲突解决 |

---

## 七、监控指标

### 7.1 关键指标
- 进度更新延迟 (< 500ms)
- 暂停响应时间 (< 1s)
- 内存使用稳定性
- CPU 使用率

### 7.2 告警阈值
- 进度更新超过 5 秒无变化 → 警告
- 暂停命令超过 3 秒无响应 → 错误
- 内存增长超过 100MB/小时 → 警告

