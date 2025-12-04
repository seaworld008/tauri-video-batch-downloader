// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;
use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::{mpsc, RwLock};
use tracing::{error, info, warn};

mod commands;
mod core;
mod parsers;
mod utils;

use commands::*;
use core::{
    downloader::{DownloaderConfig, HttpDownloader},
    runtime::{create_download_runtime_handle, spawn_router_loop, DownloadRuntimeHandle},
    AppConfig, DownloadManager,
};

/// 简化的应用程序状态，防止初始化失败
pub struct AppState {
    pub download_manager: Arc<RwLock<DownloadManager>>,
    pub http_downloader: Arc<RwLock<HttpDownloader>>,
    pub config: Arc<RwLock<AppConfig>>,
    pub download_runtime: DownloadRuntimeHandle,
    /// Router receiver - needs to be spawned in Tauri runtime during setup
    router_rx: std::sync::Mutex<Option<mpsc::Receiver<core::runtime::RuntimeCommand>>>,
}

impl AppState {
    pub fn new() -> Self {
        info!("🔧 Creating simplified AppState");

        // 使用简化的初始化过程，避免panic
        match Self::try_new() {
            Ok(state) => {
                info!("✅ AppState created successfully");
                state
            }
            Err(e) => {
                error!("❌ Failed to create AppState: {}, using fallback", e);
                // 创建最小化的fallback状态
                Self::create_fallback()
            }
        }
    }

    fn try_new() -> Result<Self, String> {
        // 使用更安全的方式优先加载本地配置，失败时再回退到默认值
        let mut config = Self::load_initial_config();
        let download_config = config.download.clone();

        // 简化DownloadManager创建
        let download_manager = DownloadManager::new(download_config.clone())
            .map_err(|e| format!("DownloadManager creation failed: {}", e))?;
        let download_manager = Arc::new(RwLock::new(download_manager));

        // 创建 runtime handle 但不立即 spawn router（等待 Tauri runtime）
        let (download_runtime, router_rx) =
            create_download_runtime_handle(download_manager.clone());
        info!("📡 Download runtime handle created (router will be spawned in Tauri setup)");

        // 根据实际配置生成HTTP下载器参数
        let downloader_config = DownloaderConfig {
            max_concurrent: download_config.concurrent_downloads.max(1), // 至少一个并发
            max_connections_per_download: 4,
            timeout: download_config.timeout_seconds,
            retry_attempts: download_config.retry_attempts,
            buffer_size: 64 * 1024,
            user_agent: download_config.user_agent.clone(),
            resume_enabled: true,
        };

        let http_downloader = HttpDownloader::new(downloader_config)
            .map_err(|e| format!("HttpDownloader creation failed: {}", e))?;

        if config.ui.is_none() {
            config.ui = Some(core::config::UiConfig::default());
        }
        if config.system.is_none() {
            config.system = Some(core::config::SystemConfig::default());
        }

        Ok(Self {
            download_manager,
            http_downloader: Arc::new(RwLock::new(http_downloader)),
            config: Arc::new(RwLock::new(config)),
            download_runtime,
            router_rx: std::sync::Mutex::new(Some(router_rx)),
        })
    }

    fn load_initial_config() -> AppConfig {
        match AppConfig::load() {
            Ok(cfg) => {
                if let Err(err) = cfg.validate() {
                    warn!(
                        "Invalid configuration detected ({}), falling back to defaults",
                        err
                    );
                    let default_cfg = AppConfig::default();
                    if let Err(save_err) = default_cfg.save() {
                        warn!("Failed to persist default configuration: {}", save_err);
                    }
                    default_cfg
                } else {
                    cfg
                }
            }
            Err(err) => {
                warn!(
                    "Failed to load configuration from disk: {}. Using defaults",
                    err
                );
                let default_cfg = AppConfig::default();
                if let Err(save_err) = default_cfg.save() {
                    warn!("Failed to persist default configuration: {}", save_err);
                }
                default_cfg
            }
        }
    }

    fn create_fallback() -> Self {
        // 创建最基本的状态，即使某些组件失败也能工作
        let config = Self::load_initial_config();

        // 如果DownloadManager创建失败，使用更简单的配置
        let download_manager = DownloadManager::new(config.download.clone()).unwrap_or_else(|_| {
            info!("Creating DownloadManager with minimal config");
            // 这里应该有一个更简单的构造函数，先假设能处理
            DownloadManager::new(config.download.clone()).expect("Minimal config should work")
        });
        let download_manager = Arc::new(RwLock::new(download_manager));
        let (download_runtime, router_rx) =
            create_download_runtime_handle(download_manager.clone());

        let downloader_config = DownloaderConfig {
            max_concurrent: 1,
            max_connections_per_download: 1,
            timeout: 120,
            retry_attempts: 0,
            buffer_size: 16 * 1024,
            user_agent: "VideoDownloaderPro/1.0.0-fallback".to_string(),
            resume_enabled: false,
        };

        let http_downloader = HttpDownloader::new(downloader_config).unwrap_or_else(|_| {
            panic!("Cannot create even fallback HttpDownloader");
        });

        Self {
            download_manager,
            http_downloader: Arc::new(RwLock::new(http_downloader)),
            config: Arc::new(RwLock::new(config)),
            download_runtime,
            router_rx: std::sync::Mutex::new(Some(router_rx)),
        }
    }

    /// Take the router receiver for spawning in Tauri runtime
    pub fn take_router_rx(&self) -> Option<mpsc::Receiver<core::runtime::RuntimeCommand>> {
        self.router_rx
            .lock()
            .ok()
            .and_then(|mut guard| guard.take())
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        if let Err(err) = windows_webview::ensure_webview2_runtime() {
            eprintln!("Failed to initialize WebView2 runtime: {}", err);
            return;
        }
    }

    // 初始化日志系统
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "video_downloader_pro=info,tauri=info".into()),
        )
        .init();

    info!("🚀 Starting Video Downloader Pro (Fixed Version)");

    // 创建应用状态 - 现在更安全了
    let app_state = AppState::new();

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // 下载相关命令
            add_download_tasks,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            debug_download_test,
            pause_all_downloads,
            resume_all_downloads,
            cancel_all_downloads,
            start_all_pending_downloads,
            remove_download,
            remove_download_tasks,
            get_download_tasks,
            get_download_stats,
            clear_completed_tasks,
            retry_failed_tasks,
            set_rate_limit,
            get_rate_limit,
            // 导入相关命令
            import_file,
            import_csv_file,
            import_tasks_and_enqueue,
            import_excel_file,
            detect_file_encoding,
            preview_import_data,
            // YouTube 相关命令
            get_youtube_info,
            get_youtube_formats,
            download_youtube_playlist,
            // 配置相关命令
            get_config,
            update_config,
            reset_config,
            export_config,
            import_config,
            // 系统相关命令
            get_system_info,
            start_system_monitor,
            stop_system_monitor,
            open_download_folder,
            show_in_folder,
            // 工具命令
            validate_url,
            get_video_info,
            check_ffmpeg,
            check_yt_dlp,
            select_output_directory,
            log_frontend_event,
        ])
        .setup(|app| {
            info!("🔧 Setting up application");

            // 获取应用状态
            let app_state: State<AppState> = app.state();
            let app_handle = app.handle();

            // 🔑 关键：在 Tauri runtime 中 spawn router loop
            // 这必须在任何下载命令之前完成
            let download_manager_for_router = app_state.download_manager.clone();
            if let Some(router_rx) = app_state.take_router_rx() {
                info!("🔄 Spawning download runtime router in Tauri runtime");
                spawn_router_loop(download_manager_for_router, router_rx);
            } else {
                warn!("⚠️ Router receiver already taken or not available");
            }

            // Emit a bootstrap log so frontend diagnostics file exists even before UI mounts
            let bootstrap_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = log_frontend_event(
                    bootstrap_handle,
                    Some("info".to_string()),
                    "backend_setup".to_string(),
                )
                .await
                {
                    error!("Failed to write frontend bootstrap log: {}", error);
                }
            });

            // Create event channel for DownloadManager
            let (sender, mut receiver) = mpsc::unbounded_channel::<core::manager::DownloadEvent>();

            let download_manager_for_events = app_state.download_manager.clone();
            // Spawn event handler to bridge DownloadManager events to Tauri events
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                info!("🔌 Event bridge started - listening for DownloadManager events");
                let mut progress_event_count = 0u64;
                while let Some(event) = receiver.recv().await {
                    if let Err(sync_err) = {
                        let mut manager = download_manager_for_events.write().await;
                        manager.apply_event_side_effects(&event).await
                    } {
                        error!("[EVENT_BRIDGE] Failed to sync manager state: {}", sync_err);
                    }

                    match event {
                        core::manager::DownloadEvent::TaskProgress {
                            task_id,
                            progress,
                        } => {
                            progress_event_count += 1;
                            // Log every progress event initially, then every 20th for debugging
                            if progress_event_count <= 5 || progress_event_count % 20 == 0 {
                                info!(
                                    "[EVENT_BRIDGE] TaskProgress #{} for task {}: progress={:.1}%, speed={:.0} B/s, downloaded={}",
                                    progress_event_count, task_id, progress.progress * 100.0, progress.speed, progress.downloaded_size
                                );
                            }
                            if let Err(e) = app_handle_clone.emit_all("download_progress", &progress) {
                                error!("[EVENT_BRIDGE] Failed to emit download_progress: {}", e);
                            }
                        }
                        core::manager::DownloadEvent::TaskStarted { task_id } => {
                            info!("[EVENT_BRIDGE] TaskStarted for task {}", task_id);
                            let payload = json!({
                                "task_id": task_id,
                                "status": "Downloading",
                                "error_message": null
                            });
                            if let Err(e) = app_handle_clone.emit_all("task_status_changed", payload) {
                                error!("[EVENT_BRIDGE] Failed to emit task_status_changed: {}", e);
                            }
                        }
                        core::manager::DownloadEvent::TaskCompleted {
                            task_id,
                            file_path: _,
                        } => {
                            let payload = json!({
                                "task_id": task_id,
                                "status": "Completed",
                                "error_message": null
                            });
                            let _ = app_handle_clone.emit_all("task_status_changed", payload);
                        }
                        core::manager::DownloadEvent::TaskFailed { task_id, error } => {
                            let payload = json!({
                                "task_id": task_id,
                                "status": "Failed",
                                "error_message": error
                            });
                            let _ = app_handle_clone.emit_all("task_status_changed", payload);
                        }
                        core::manager::DownloadEvent::TaskPaused { task_id } => {
                            let payload = json!({
                                "task_id": task_id,
                                "status": "Paused",
                                "error_message": null
                            });
                            let _ = app_handle_clone.emit_all("task_status_changed", payload);
                        }
                        core::manager::DownloadEvent::TaskResumed { task_id } => {
                            let payload = json!({
                                "task_id": task_id,
                                "status": "Downloading",
                                "error_message": null
                            });
                            let _ = app_handle_clone.emit_all("task_status_changed", payload);
                        }
                        core::manager::DownloadEvent::TaskCancelled { task_id } => {
                            let payload = json!({
                                "task_id": task_id,
                                "status": "Cancelled",
                                "error_message": null
                            });
                            let _ = app_handle_clone.emit_all("task_status_changed", payload);
                        }
                        core::manager::DownloadEvent::StatsUpdated { stats } => {
                            let _ = app_handle_clone.emit_all("download_stats", stats);
                        }
                        _ => {}
                    }
                }
                warn!("🔌 Event bridge stopped");
            });

            // 🔑 异步启动下载管理器
            // 使用 spawn 而不是 block_on，避免在 setup 中阻塞
            info!("🚀 启动下载管理器 (异步)...");
            let download_manager = app_state.download_manager.clone();
            let app_handle_for_manager = app_handle.clone();

            tauri::async_runtime::spawn(async move {
                info!("[MANAGER_INIT] Starting manager initialization in async task");

                match tokio::time::timeout(
                    std::time::Duration::from_secs(10),
                    async {
                        info!("[MANAGER_INIT] Acquiring write lock...");
                        let mut manager = download_manager.write().await;
                        info!("[MANAGER_INIT] Write lock acquired, calling start()...");
                        manager.start_with_sender(sender).await
                    },
                )
                .await
                {
                    Ok(Ok(_)) => {
                        info!("✅ [MANAGER_INIT] Download manager started successfully");
                        if let Err(e) = app_handle_for_manager.emit_all("download_manager_ready", true) {
                            error!("[MANAGER_INIT] Failed to emit download_manager_ready event: {}", e);
                        } else {
                            info!("[MANAGER_INIT] ✅ download_manager_ready event emitted");
                        }
                    }
                    Ok(Err(e)) => {
                        error!("❌ [MANAGER_INIT] Download manager failed to start: {}", e);
                        let _ = app_handle_for_manager.emit_all(
                            "download_manager_error",
                            format!("Download manager failed: {}", e),
                        );
                    }
                    Err(_) => {
                        error!("❌ [MANAGER_INIT] Download manager startup timed out");
                        let _ = app_handle_for_manager.emit_all(
                            "download_manager_error",
                            "Download manager startup timed out".to_string(),
                        );
                    }
                }
            });

            // 后台维持并发数：持续填充空槽位（仅后端调度）
            // 立即发送应用准备就绪信号
            if let Err(e) = app.emit_all("app_ready", true) {
                error!("Failed to emit app_ready event: {}", e);
            } else {
                info!("✅ App ready event emitted");
            }

            Ok(())
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api: _api, .. } => {
                info!("📦 Application closing requested");

                // 移除 prevent_close() 调用，允许直接关闭
                // 如果需要确认对话框，可以在前端处理
                info!("🔚 Application closing normally");

                // 可选：执行清理操作但不阻止关闭
                // 这里可以添加异步清理逻辑
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "windows")]
mod windows_webview {
    use std::{
        env,
        ffi::{CString, OsStr},
        fs, mem,
        os::windows::ffi::OsStrExt,
        path::{Path, PathBuf},
        process::Command,
        thread,
        time::Duration,
    };
    use winapi::{
        shared::winerror::SUCCEEDED,
        um::{
            combaseapi::CoTaskMemFree,
            libloaderapi::{FreeLibrary, GetProcAddress, LoadLibraryW},
            winuser::{
                MessageBoxW, IDYES, MB_ICONERROR, MB_ICONINFORMATION, MB_ICONQUESTION, MB_OK,
                MB_TOPMOST, MB_YESNO,
            },
        },
    };

    const INSTALLER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    pub fn ensure_webview2_runtime() -> Result<(), String> {
        if runtime_installed() {
            return Ok(());
        }

        let install = prompt_yes_no(
            "Microsoft Edge WebView2 Runtime 未检测到。该组件是运行本软件必须的，是否立即自动安装？",
        );

        if !install {
            return Err("用户拒绝安装 Microsoft Edge WebView2 Runtime，应用无法启动。".to_string());
        }

        install_runtime().map_err(|err| {
            show_error(&format!(
                "自动安装 WebView2 失败：{}。请手动访问 https://go.microsoft.com/fwlink/p/?LinkId=2124703 安装后重新启动。",
                err
            ));
            err
        })?;

        show_info("WebView2 运行时安装完成，应用即将启动。");

        Ok(())
    }

    fn runtime_installed() -> bool {
        attempt_loader_version_check().unwrap_or(false) || runtime_paths_present()
    }

    fn attempt_loader_version_check() -> Result<bool, String> {
        unsafe {
            let loader = LoadLibraryW(to_wide("WebView2Loader.dll").as_ptr());
            if loader.is_null() {
                return Ok(false);
            }

            let proc_name = CString::new("GetAvailableCoreWebView2BrowserVersionString")
                .map_err(|err| err.to_string())?;
            let proc = GetProcAddress(loader, proc_name.as_ptr());
            if proc.is_null() {
                FreeLibrary(loader);
                return Ok(false);
            }

            type GetVersionFn = unsafe extern "system" fn(*const u16, *mut *mut u16) -> i32;
            let func: GetVersionFn = mem::transmute(proc);

            let mut version_ptr: *mut u16 = std::ptr::null_mut();
            let hr = func(std::ptr::null(), &mut version_ptr);

            let success = SUCCEEDED(hr) && !version_ptr.is_null();
            if !version_ptr.is_null() {
                CoTaskMemFree(version_ptr as *mut _);
            }
            FreeLibrary(loader);
            Ok(success)
        }
    }

    fn runtime_paths_present() -> bool {
        runtime_candidate_paths()
            .into_iter()
            .any(|path| path.exists() && path.is_dir())
    }

    fn runtime_candidate_paths() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
            paths.push(
                Path::new(&program_files_x86)
                    .join("Microsoft")
                    .join("EdgeWebView")
                    .join("Application"),
            );
        }
        if let Ok(program_files) = env::var("ProgramFiles") {
            paths.push(
                Path::new(&program_files)
                    .join("Microsoft")
                    .join("EdgeWebView")
                    .join("Application"),
            );
        }
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            paths.push(
                Path::new(&local_app_data)
                    .join("Microsoft")
                    .join("EdgeWebView")
                    .join("Application"),
            );
        }
        paths
    }

    fn install_runtime() -> Result<(), String> {
        let installer_path = download_bootstrapper()?;
        let status = Command::new(&installer_path)
            .args(["/install", "/silent", "/norestart"])
            .status()
            .map_err(|err| format!("无法启动 WebView2 安装程序: {}", err))?;

        if !status.success() {
            return Err(format!(
                "WebView2 安装程序返回错误状态: {:?}",
                status.code()
            ));
        }

        // 等待安装完成并重新检测
        for _ in 0..10 {
            if runtime_installed() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(500));
        }

        Err("安装程序运行后仍未检测到 WebView2。".to_string())
    }

    fn download_bootstrapper() -> Result<PathBuf, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|err| format!("无法初始化下载客户端: {}", err))?;

        let response = client
            .get(INSTALLER_URL)
            .send()
            .and_then(|resp| resp.error_for_status())
            .map_err(|err| format!("下载 WebView2 安装程序失败: {}", err))?;

        let bytes = response
            .bytes()
            .map_err(|err| format!("读取安装程序内容失败: {}", err))?;

        let installer_path = env::temp_dir().join("MicrosoftEdgeWebView2Setup.exe");
        fs::write(&installer_path, &bytes)
            .map_err(|err| format!("写入安装程序到临时目录失败: {}", err))?;

        Ok(installer_path)
    }

    fn prompt_yes_no(message: &str) -> bool {
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                to_wide(message).as_ptr(),
                to_wide("Video Downloader Pro").as_ptr(),
                MB_ICONQUESTION | MB_TOPMOST | MB_YESNO,
            ) == IDYES
        }
    }

    fn show_info(message: &str) {
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                to_wide(message).as_ptr(),
                to_wide("Video Downloader Pro").as_ptr(),
                MB_ICONINFORMATION | MB_TOPMOST | MB_OK,
            );
        }
    }

    fn show_error(message: &str) {
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                to_wide(message).as_ptr(),
                to_wide("Video Downloader Pro").as_ptr(),
                MB_ICONERROR | MB_TOPMOST | MB_OK,
            );
        }
    }

    fn to_wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_creation() {
        // 测试不应该panic
        let state = AppState::new();
        assert!(!state.download_manager.try_read().is_err());
        assert!(!state.config.try_read().is_err());
    }
}
