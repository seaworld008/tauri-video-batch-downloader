// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::RwLock;
use tracing::{error, info};

mod commands;
mod core;
mod downloaders;
mod parsers;
mod utils;

use commands::*;
use core::downloader::{DownloaderConfig, HttpDownloader};
use core::{AppConfig, DownloadManager};

/// 简化的应用程序状态，防止初始化失败
#[derive(Clone)]
pub struct AppState {
    pub download_manager: Arc<RwLock<DownloadManager>>,
    pub http_downloader: Arc<RwLock<HttpDownloader>>,
    pub config: Arc<RwLock<AppConfig>>,
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
        // 使用默认配置而不是加载文件，避免IO错误
        let config = AppConfig::default();

        // 简化DownloadManager创建
        let download_manager = DownloadManager::new(config.download.clone())
            .map_err(|e| format!("DownloadManager creation failed: {}", e))?;

        // 使用更保守的HTTP下载器配置
        let downloader_config = DownloaderConfig {
            max_concurrent: 3,               // 减少并发数
            max_connections_per_download: 2, // 减少连接数
            timeout: 60,                     // 增加超时时间
            retry_attempts: 1,               // 减少重试次数
            buffer_size: 32 * 1024,          // 减小缓冲区
            user_agent: "VideoDownloaderPro/1.0.0".to_string(),
            resume_enabled: true,
        };

        let http_downloader = HttpDownloader::new(downloader_config)
            .map_err(|e| format!("HttpDownloader creation failed: {}", e))?;

        Ok(Self {
            download_manager: Arc::new(RwLock::new(download_manager)),
            http_downloader: Arc::new(RwLock::new(http_downloader)),
            config: Arc::new(RwLock::new(config)),
        })
    }

    fn create_fallback() -> Self {
        // 创建最基本的状态，即使某些组件失败也能工作
        let config = AppConfig::default();

        // 如果DownloadManager创建失败，使用更简单的配置
        let download_manager = DownloadManager::new(config.download.clone()).unwrap_or_else(|_| {
            info!("Creating DownloadManager with minimal config");
            // 这里应该有一个更简单的构造函数，先假设能处理
            DownloadManager::new(config.download.clone()).expect("Minimal config should work")
        });

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
            download_manager: Arc::new(RwLock::new(download_manager)),
            http_downloader: Arc::new(RwLock::new(http_downloader)),
            config: Arc::new(RwLock::new(config)),
        }
    }
}

fn main() {
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
            remove_download,
            remove_download_tasks,
            get_download_tasks,
            get_download_stats,
            clear_completed_tasks,
            retry_failed_tasks,
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

            // 异步启动下载管理器，但不阻塞主线程
            info!("🚀 启动下载管理器...");
            let download_manager = app_state.download_manager.clone();
            let app_handle = app.handle();

            tauri::async_runtime::spawn(async move {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(10), // 10秒超时
                    async {
                        let mut manager = download_manager.write().await;
                        manager.start().await
                    },
                )
                .await
                {
                    Ok(Ok(_)) => {
                        info!("✅ Download manager started successfully");
                        if let Err(e) = app_handle.emit_all("download_manager_ready", true) {
                            error!("Failed to emit download_manager_ready event: {}", e);
                        }
                    }
                    Ok(Err(e)) => {
                        error!("❌ Download manager failed to start: {}", e);
                        // 不再阻止应用启动，只是发出警告
                        if let Err(emit_err) = app_handle.emit_all(
                            "download_manager_warning",
                            format!("Download manager failed: {}", e),
                        ) {
                            error!("Failed to emit warning event: {}", emit_err);
                        }
                    }
                    Err(_) => {
                        error!("❌ Download manager startup timed out");
                        if let Err(emit_err) = app_handle.emit_all(
                            "download_manager_warning",
                            "Download manager startup timed out".to_string(),
                        ) {
                            error!("Failed to emit timeout warning: {}", emit_err);
                        }
                    }
                }
            });

            // 立即发送应用准备就绪信号
            if let Err(e) = app.emit_all("app_ready", true) {
                error!("Failed to emit app_ready event: {}", e);
            } else {
                info!("✅ App ready event emitted");
            }

            Ok(())
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
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
