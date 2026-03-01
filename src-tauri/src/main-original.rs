use tauri::Emitter;
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::RwLock;
use tracing::{info, error};

mod commands;
mod core;
mod parsers;
mod utils;

use commands::*;
use core::{DownloadManager, AppConfig};
use core::downloader::{HttpDownloader, DownloaderConfig};

/// 应用程序状态
#[derive(Clone)]
pub struct AppState {
    pub download_manager: Arc<RwLock<DownloadManager>>,
    pub http_downloader: Arc<RwLock<HttpDownloader>>,
    pub config: Arc<RwLock<AppConfig>>,
}

impl AppState {
    pub fn new() -> Self {
        // Use a minimal implementation to isolate the crash issue
        info!("🔧 Creating minimal AppState for debugging");
        
        let default_config = AppConfig::default();
        
        // For now, create a simple state without complex initialization
        // to isolate the crash issue
        match Self::try_new() {
            Ok(state) => {
                info!("✅ AppState created successfully");
                state
            }
            Err(e) => {
                error!("❌ Failed to create AppState: {}", e);
                panic!("Failed to create AppState: {}", e);
            }
        }
    }
    
    fn try_new() -> Result<Self, String> {
        let config = AppConfig::load().unwrap_or_default();
        
        // Try creating DownloadManager
        let download_manager = DownloadManager::new(config.download.clone())
            .map_err(|e| format!("Failed to create download manager: {}", e))?;
        
        // 创建HTTP下载器配置
        let downloader_config = DownloaderConfig {
            max_concurrent: 10, // Default value
            max_connections_per_download: 4,
            timeout: 30, // Default 30 seconds
            retry_attempts: 3, // Default 3 retries
            buffer_size: 64 * 1024, // 64KB
            user_agent: "VideoDownloaderPro/1.0.0".to_string(),
            resume_enabled: true,
        };
        
        let http_downloader = HttpDownloader::new(downloader_config)
            .map_err(|e| format!("Failed to create HTTP downloader: {}", e))?;
        
        Ok(Self {
            download_manager: Arc::new(RwLock::new(download_manager)),
            http_downloader: Arc::new(RwLock::new(http_downloader)),
            config: Arc::new(RwLock::new(config)),
        })
    }
}

fn main() {
    // 初始化日志系统
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "video_downloader_pro=debug,tauri=info".into()),
        )
        .init();

    info!("🚀 Starting Video Downloader Pro");

    // 创建应用状态
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
            pause_all_downloads,
            resume_all_downloads,
            cancel_all_downloads,
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
        ])
        .setup(|app| {
            info!("🔧 Setting up application");
            
            // 获取应用状态
            let app_state: State<AppState> = app.state();
            
            // 启动系统监控 - TODO: Implement system_monitor
            // let app_handle = app.handle();
            // tokio::spawn(async move {
            //     utils::system_monitor::start_monitoring(app_handle).await;
            // });
            
            // 启动下载管理器 - 使用Tauri的async runtime
            info!("🚀 启动下载管理器...");
            
            let download_manager = app_state.download_manager.clone();
            let app_handle = app.handle();
            tauri::async_runtime::spawn(async move {
                let mut manager = download_manager.write().await;
                match manager.start().await {
                    Ok(_) => {
                        info!("✅ Download manager started successfully");
                        // 通知前端下载管理器已就绪
                        if let Err(e) = app_handle.emit("download_manager_ready", true) {
                            error!("Failed to emit download_manager_ready event: {}", e);
                        }
                    }
                    Err(e) => {
                        error!("❌ Failed to start download manager: {}", e);
                        // 通知前端下载管理器启动失败
                        if let Err(emit_err) = app_handle.emit("download_manager_error", e.to_string()) {
                            error!("Failed to emit download_manager_error event: {}", emit_err);
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                info!("📦 Application closing requested");
                // 在这里可以添加清理逻辑
                api.prevent_close();
                
                // 可以显示确认对话框
                let window = event.window();
                let app_handle = window.app_handle();
                
                tauri::api::dialog::ask(
                    Some(window),
                    "退出确认",
                    "确定要退出视频下载器吗？正在进行的下载将被暂停。",
                    move |answer| {
                        if answer {
                            info!("🔚 Application confirmed to close");
                            app_handle.exit(0);
                        }
                    },
                );
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_creation() {
        let state = AppState::new();
        assert!(!state.download_manager.try_read().is_err());
        assert!(!state.config.try_read().is_err());
    }
}
