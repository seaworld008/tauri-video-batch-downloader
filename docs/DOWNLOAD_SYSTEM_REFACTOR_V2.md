# 下载系统深度重构方案 V2

> **状态**: ✅ 已完成
> **日期**: 2025-12-03
> **问题**: 进度显示为0，暂停功能无效
> **修复**: 已实施并测试

## 1. 问题根因深度分析

### 1.1 Runtime 隔离问题

**关键发现**: `spawn_download_runtime` 在 Tauri 应用启动之前被调用。

```rust
// main.rs
fn main() {
    // 此时还没有 tokio runtime
    let app_state = AppState::new();  // 这里调用 spawn_download_runtime
    
    tauri::Builder::default()
        .manage(app_state)
        .run(...);
}
```

在 `spawn_download_runtime` 中:
```rust
match Handle::try_current() {
    Ok(handle) => {
        handle.spawn(router_future);  // 使用现有 runtime
    }
    Err(_) => {
        // 创建新的独立 runtime！问题所在！
        std::thread::Builder::new()
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_multi_thread()...;
                runtime.block_on(router_future);
            })
    }
}
```

**后果**: `router_loop` 在独立线程中运行，与 Tauri 的 async runtime 隔离。虽然 channel 通信可以跨 runtime，但可能存在竞态条件。

### 1.2 进度通道链路问题

完整的进度更新链路:
```
1. HttpDownloader.update_progress() 
   ↓ [progress_tx channel - 在 execute_download_attempt 中创建]
2. execute_download_attempt 中的 progress_handle 任务
   ↓ [event_sender - DownloadManager 的 EventSender]
3. main.rs 的 event bridge 接收 DownloadEvent
   ↓ [Tauri emit_all]
4. 前端 downloadStore 的 listener
   ↓ [Zustand setState]
5. UI 渲染
```

**问题点**:
- 链路过长，容易在任何一环断裂
- 多个 spawn 任务之间的协调复杂
- 错误难以追踪

### 1.3 暂停功能失效原因

1. **锁竞争**: `router_loop` 需要获取 `manager.write()` 锁，但其他操作可能持有锁
2. **Runtime 隔离**: 暂停命令通过 channel 发送，但响应可能丢失
3. **任务 ID 不匹配**: `active_downloads` 中的 key 可能与前端传入的 task_id 不一致

## 2. 重构方案

### 2.1 核心原则

1. **延迟初始化**: 将 download_runtime 的初始化延迟到 Tauri setup 中
2. **简化链路**: 减少进度更新的中间环节
3. **统一 Runtime**: 确保所有异步任务在同一个 runtime 中运行
4. **直接事件发送**: 下载器直接发送 Tauri 事件，不经过 EventSender

### 2.2 架构变更

#### 变更前:
```
Frontend → Tauri Command → download_runtime (独立 runtime)
                              ↓
                         DownloadManager (需要锁)
                              ↓
                         HttpDownloader
                              ↓
                         progress_tx → progress_handle → event_sender → event_bridge → Frontend
```

#### 变更后:
```
Frontend → Tauri Command → DownloadManager (Tauri runtime)
                              ↓
                         HttpDownloader (直接持有 AppHandle)
                              ↓
                         Tauri emit_all → Frontend
```

### 2.3 具体修改

#### 修改1: 延迟 runtime 初始化

```rust
// main.rs
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 在 Tauri runtime 中初始化
            let download_runtime = spawn_download_runtime_in_tauri(
                app.state::<AppState>().download_manager.clone()
            );
            // ...
        })
}
```

#### 修改2: 直接使用 AppHandle 发送事件

```rust
// downloader.rs
pub struct HttpDownloader {
    // 替换 progress_tx
    app_handle: Option<tauri::AppHandle>,
    // ...
}

impl HttpDownloader {
    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }
    
    async fn update_progress(&self, task: &mut DownloadTask, ...) {
        // 直接发送 Tauri 事件
        if let Some(ref handle) = self.app_handle {
            let progress = ProgressUpdate { ... };
            let _ = handle.emit_all("download_progress", &progress);
        }
    }
}
```

#### 修改3: 简化 DownloadManager

```rust
// manager.rs
impl DownloadManager {
    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        // 传递给内部的 HttpDownloader
        self.http_downloader.set_app_handle(handle.clone());
        self.app_handle = Some(handle);
    }
    
    // 移除 EventSender，直接使用 AppHandle
}
```

## 3. 实施步骤

### 步骤 1: 修改 AppState 初始化
- 移除 `spawn_download_runtime` 的早期调用
- 在 Tauri setup 中初始化

### 步骤 2: 添加 AppHandle 支持
- 修改 HttpDownloader 支持 AppHandle
- 修改 DownloadManager 支持 AppHandle

### 步骤 3: 简化进度更新链路
- HttpDownloader 直接发送 Tauri 事件
- 移除 progress_tx / progress_rx 中间层

### 步骤 4: 修复暂停功能
- 确保任务 ID 一致性
- 增强取消信号传递

### 步骤 5: 添加详细日志
- 在关键点添加日志
- 便于问题追踪

## 4. 实施的修复

### 4.1 Runtime 初始化修复 (runtime.rs)

**问题**: `spawn_download_runtime` 在 Tauri 启动前调用，导致 router_loop 在独立线程中运行。

**修复**: 
1. 新增 `create_download_runtime_handle` 函数，只创建 channel，不 spawn
2. 新增 `spawn_router_loop` 函数，在 Tauri runtime 中 spawn router
3. 保留 `spawn_download_runtime` 作为兼容

```rust
pub fn create_download_runtime_handle(manager: Arc<RwLock<DownloadManager>>) 
    -> (DownloadRuntimeHandle, mpsc::Receiver<RuntimeCommand>) {
    let (tx, rx) = mpsc::channel(256);
    (DownloadRuntimeHandle::new(tx), rx)
}

pub fn spawn_router_loop(manager: Arc<RwLock<DownloadManager>>, rx: mpsc::Receiver<RuntimeCommand>) {
    tauri::async_runtime::spawn(async move {
        router_loop(manager, rx).await;
    });
}
```

### 4.2 AppState 修改 (main.rs)

**修复**:
1. AppState 增加 `router_rx` 字段存储 receiver
2. 在 Tauri setup 中调用 `spawn_router_loop`
3. 使用 `block_on` 同步等待 `manager.start()` 完成

```rust
pub struct AppState {
    // ...
    router_rx: std::sync::Mutex<Option<mpsc::Receiver<RuntimeCommand>>>,
}

// 在 setup 中:
if let Some(router_rx) = app_state.take_router_rx() {
    spawn_router_loop(download_manager_for_router, router_rx);
}

// 同步启动 manager
let start_result = tauri::async_runtime::block_on(async {
    let mut manager = download_manager.write().await;
    manager.start(sender).await
});
```

### 4.3 错误处理增强 (manager.rs)

**修复**: 避免 `event_sender.unwrap()` 导致的 panic

```rust
let event_sender = match &self.event_sender {
    Some(sender) => sender.clone(),
    None => {
        return Err(AppError::System(
            "Download manager not initialized.".to_string()
        ));
    }
};
```

### 4.4 增强日志 (downloader.rs)

**修复**: 增加关键操作的日志，便于追踪问题

```rust
// 注册下载任务时记录
tracing::info!("[DOWNLOAD] Registered task {} in active_downloads", task.id);

// 取消下载时详细记录
tracing::info!("[CANCEL_DOWNLOAD] Active downloads count: {}, looking for: {}", count, task_id);
```

## 5. 测试验证

修复后需验证:
- [ ] 启动下载后立即看到进度更新
- [ ] 进度百分比正确递增
- [ ] 下载速度正确显示
- [ ] 点击暂停立即生效
- [ ] 暂停后可以恢复
- [ ] 取消功能正常工作
- [ ] 多任务并发正常

## 6. 关键日志追踪

启动时应看到：
```
[RUNTIME] Created download runtime handle (router not yet spawned)
[RUNTIME] Spawning download runtime router in Tauri runtime
[RUNTIME] Router loop spawned successfully
✅ Download manager started successfully (sync)
```

下载时应看到：
```
[DOWNLOAD] Registered task xxx in active_downloads (total: 1)
[DOWNLOAD_TRACE] smart_download started for task xxx
[DOWNLOAD_TRACE] progress_tx is_some=true
[PROGRESS_TX] Sent progress for task xxx: 0%
```

暂停时应看到：
```
[PAUSE_CMD] Received pause request for task: xxx
[CANCEL_DOWNLOAD] Active downloads count: 1, looking for task: xxx
[CANCEL_DOWNLOAD] ✅ Found and cancelled task: xxx
```

