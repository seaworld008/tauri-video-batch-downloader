//! Video Downloader Pro - Core Library
//!
//! This library provides the core functionality for the video downloader application,
//! including download management, file parsing, and system utilities.

// TODO(code-quality): roll out crate-wide
// #![warn(clippy::unwrap_used, clippy::expect_used)] once each pre-existing
// call site has been audited. Until that audit lands, *new* modules in
// safety-critical paths should opt in locally via
// `#![deny(clippy::unwrap_used, clippy::expect_used)]`.

pub mod commands;
pub mod core;
pub mod engine;
pub mod infra;
pub mod utils;

// Re-export commonly used types
pub use core::{
    config::AppConfig,
    downloader::HttpDownloader,
    file_parser::FileParser,
    m3u8_downloader::M3U8Downloader,
    manager::DownloadManager,
    models::{AppError, DownloadConfig, ImportedData, ProgressUpdate, TaskStatus, VideoTask},
    runtime::{
        create_download_runtime_handle, spawn_download_runtime, spawn_router_loop,
        DownloadRuntimeHandle,
    },
};

pub use utils::encoding::detect_encoding;

use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::{mpsc, RwLock};
use tracing::{error, info, warn};

use commands::*;
use core::queue_scheduler::spawn_queue_scheduler;
use engine::task_engine::{spawn_task_engine, TaskEngineHandle};
use infra::download_event_bridge::spawn_download_event_bridge;
use utils::logging;

/// Application state shared between Tauri commands
#[derive(Clone)]
pub struct AppState {
    pub download_manager: Arc<RwLock<DownloadManager>>,
    pub config: Arc<RwLock<AppConfig>>,
    pub download_runtime: DownloadRuntimeHandle,
    pub task_engine: TaskEngineHandle,
    /// Router receiver - needs to be spawned in Tauri runtime during setup
    router_rx: Arc<std::sync::Mutex<Option<mpsc::Receiver<core::runtime::RuntimeCommand>>>>,
}

impl AppState {
    pub fn new() -> Self {
        info!("🔧 Creating AppState");

        match Self::try_new() {
            Ok(state) => {
                info!("✅ AppState created successfully");
                state
            }
            Err(e) => {
                error!("❌ Failed to create AppState: {}, using fallback", e);
                match Self::create_fallback() {
                    Ok(state) => state,
                    Err(fallback_error) => {
                        error!("❌ Failed to create fallback AppState: {}", fallback_error);
                        std::process::exit(1);
                    }
                }
            }
        }
    }

    fn try_new() -> Result<Self, String> {
        let mut config = core::app_bootstrap::load_or_initialize_config();
        let download_config = config.download.clone();

        let download_manager = DownloadManager::new(download_config)
            .map_err(|e| format!("DownloadManager creation failed: {}", e))?;
        let download_manager = Arc::new(RwLock::new(download_manager));

        let (download_runtime, router_rx) =
            create_download_runtime_handle(download_manager.clone());
        info!("📡 Download runtime handle created (router will be spawned in Tauri setup)");
        let task_engine = spawn_task_engine(Arc::new(download_runtime.clone()));

        core::app_bootstrap::ensure_optional_config_defaults(&mut config);

        Ok(Self {
            download_manager,
            config: Arc::new(RwLock::new(config)),
            download_runtime,
            task_engine,
            router_rx: Arc::new(std::sync::Mutex::new(Some(router_rx))),
        })
    }

    fn create_fallback() -> Result<Self, String> {
        let mut config = core::app_bootstrap::load_or_initialize_config();

        let download_manager = match DownloadManager::new(config.download.clone()) {
            Ok(manager) => manager,
            Err(error) => {
                warn!(
                    "Failed to create fallback DownloadManager from loaded config: {}",
                    error
                );
                let fallback_download_config = DownloadConfig::default();
                let manager = DownloadManager::new(fallback_download_config.clone()).map_err(
                    |fallback_error| {
                        format!(
                            "Failed to create DownloadManager from default config: {}",
                            fallback_error
                        )
                    },
                )?;
                config.download = fallback_download_config;
                manager
            }
        };
        let download_manager = Arc::new(RwLock::new(download_manager));
        let (download_runtime, router_rx) =
            create_download_runtime_handle(download_manager.clone());
        let task_engine = spawn_task_engine(Arc::new(download_runtime.clone()));

        Ok(Self {
            download_manager,
            config: Arc::new(RwLock::new(config)),
            download_runtime,
            task_engine,
            router_rx: Arc::new(std::sync::Mutex::new(Some(router_rx))),
        })
    }

    /// Take the router receiver for spawning in Tauri runtime
    pub fn take_router_rx(&self) -> Option<mpsc::Receiver<core::runtime::RuntimeCommand>> {
        self.router_rx
            .lock()
            .ok()
            .and_then(|mut guard| guard.take())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Library name
pub const NAME: &str = env!("CARGO_PKG_NAME");

/// Initialize the library with default settings
pub fn init() -> anyhow::Result<()> {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("video_downloader_pro=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .try_init()
        .ok();

    tracing::info!("📚 {} v{} initialized", NAME, VERSION);
    Ok(())
}

/// Run the desktop application.
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if let Err(err) = windows_webview::ensure_webview2_runtime() {
            eprintln!("Failed to initialize WebView2 runtime: {}", err);
            return;
        }
    }

    logging::init_tracing();

    info!("🚀 Starting Video Downloader Pro v{}", VERSION);

    let app_state = AppState::new();

    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // 下载相关命令
            add_download_tasks,
            update_task_output_paths,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            pause_all_downloads,
            start_all_downloads,
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
            import_excel_file,
            detect_file_encoding,
            preview_import_data,
            get_supported_formats,
            // 配置相关命令
            get_config,
            update_config,
            reset_config,
            export_config,
            import_config,
            // 系统相关命令
            open_download_folder,
            reveal_path_in_folder,
            read_clipboard_text,
            get_video_info,
            get_external_tool_status,
            check_external_tool_updates,
            update_external_tool,
            rollback_external_tool,
            set_external_tool_override,
            clear_external_tool_override,
            log_frontend_event,
        ])
        .setup(|app| {
            info!("🔧 Setting up application");

            let app_state: State<AppState> = app.state();
            let app_handle = app.handle();

            let download_manager_for_router = app_state.download_manager.clone();
            if let Some(router_rx) = app_state.take_router_rx() {
                info!("🔄 Spawning download runtime router in Tauri runtime");
                spawn_router_loop(download_manager_for_router, router_rx);
            } else {
                warn!("⚠️ Router receiver already taken or not available");
            }

            if logging::local_logging_enabled() {
                tauri::async_runtime::spawn(async move {
                    if let Err(error) =
                        logging::append_frontend_log_entry(Some("info"), "backend_setup")
                    {
                        error!("Failed to write frontend bootstrap log: {}", error);
                    }
                });
            }

            let (sender, receiver) = mpsc::unbounded_channel::<core::manager::DownloadEvent>();

            let download_runtime_for_events = app_state.download_runtime.clone();
            let app_handle_clone = app_handle.clone();
            spawn_download_event_bridge(app_handle_clone, download_runtime_for_events, receiver);

            info!("🚀 启动下载管理器 (异步)...");
            let download_manager = app_state.download_manager.clone();
            tauri::async_runtime::spawn(async move {
                info!("[MANAGER_INIT] Starting manager initialization in async task");

                match tokio::time::timeout(std::time::Duration::from_secs(10), async {
                    info!("[MANAGER_INIT] Acquiring write lock...");
                    let mut manager = download_manager.write().await;
                    info!("[MANAGER_INIT] Write lock acquired, calling start()...");
                    manager.start_with_sender(sender).await?;
                    let scheduler_handle = spawn_queue_scheduler(download_manager.clone());
                    manager.set_scheduler_handle(scheduler_handle);
                    Ok::<(), AppError>(())
                })
                .await
                {
                    Ok(Ok(_)) => {
                        info!("✅ [MANAGER_INIT] Download manager started successfully");
                    }
                    Ok(Err(e)) => {
                        error!("❌ [MANAGER_INIT] Download manager failed to start: {}", e);
                    }
                    Err(_) => {
                        error!("❌ [MANAGER_INIT] Download manager startup timed out");
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api: _api, .. } = event {
                info!("📦 Application closing requested");

                let download_manager = window.state::<AppState>().download_manager.clone();
                tauri::async_runtime::spawn(async move {
                    let mut manager = download_manager.write().await;
                    if let Err(err) = manager.stop().await {
                        warn!("Failed to stop download manager on close: {}", err);
                    }
                });

                info!("🔚 Application closing normally");
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            error!("❌ Error while running Tauri application: {}", error);
            std::process::exit(1);
        });
}

#[cfg(target_os = "windows")]
mod windows_webview {
    use std::{
        env,
        ffi::{CString, OsStr},
        fs, mem,
        os::windows::ffi::OsStrExt,
        path::{Path, PathBuf},
        thread,
        time::Duration,
    };
    use winapi::{
        shared::winerror::SUCCEEDED,
        um::{
            combaseapi::CoTaskMemFree,
            libloaderapi::{
                FreeLibrary, GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_APPLICATION_DIR,
                LOAD_LIBRARY_SEARCH_SYSTEM32,
            },
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
        // SAFETY: Win32 FFI block. Invariants:
        //   - to_wide(...) returns a NUL-terminated UTF-16 buffer that
        //     outlives the LoadLibraryExW call.
        //   - LoadLibraryExW restricts lookup to app dir and System32 to avoid
        //     CWD DLL planting, and is null-checked + paired with FreeLibrary.
        //   - GetProcAddress is null-checked before transmuting to
        //     `HRESULT (LPCWSTR, LPWSTR*)`.
        //   - version_ptr is freed with CoTaskMemFree when non-null.
        unsafe {
            let loader = LoadLibraryExW(
                to_wide("WebView2Loader.dll").as_ptr(),
                std::ptr::null_mut(),
                LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
            );
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
        let status_result = crate::utils::process::hidden_std_command(&installer_path)
            .args(["/install", "/silent", "/norestart"])
            .status()
            .map_err(|err| format!("无法启动 WebView2 安装程序: {}", err));
        let _ = fs::remove_file(&installer_path);
        let status = status_result?;

        if !status.success() {
            return Err(format!(
                "WebView2 安装程序返回错误状态: {:?}",
                status.code()
            ));
        }

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

        let installer_path = env::temp_dir().join(format!(
            "MicrosoftEdgeWebView2Setup-{}.exe",
            std::process::id()
        ));
        fs::write(&installer_path, &bytes)
            .map_err(|err| format!("写入安装程序到临时目录失败: {}", err))?;

        Ok(installer_path)
    }

    fn prompt_yes_no(message: &str) -> bool {
        // SAFETY: MessageBoxW FFI. Both wide-string buffers are owned by
        // this scope and outlive the call; HWND is null; flags are valid MB_* bits.
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
        // SAFETY: same invariants as prompt_yes_no — null parent HWND, owned
        // wide-string buffers, valid MB_* flag composition.
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
        // SAFETY: same invariants as prompt_yes_no — null parent HWND, owned
        // wide-string buffers, valid MB_* flag composition.
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
    fn test_init() {
        assert!(init().is_ok());
    }

    #[test]
    fn test_version() {
        assert_eq!(VERSION, env!("CARGO_PKG_VERSION"));
        assert_eq!(NAME, "video-downloader-pro");
    }

    #[test]
    fn test_app_state_creation() {
        let state = AppState::new();
        assert!(state.download_manager.try_read().is_ok());
        assert!(state.config.try_read().is_ok());
    }
}
