// 最简化的Tauri应用，用于测试连接问题
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tracing::{error, info};

// 简化的系统信息命令
#[tauri::command]
async fn get_system_info() -> Result<String, String> {
    info!("📊 Getting system info");
    Ok("Video Downloader Pro - Debug Version".to_string())
}

// 测试命令
#[tauri::command]
async fn test_connection() -> Result<String, String> {
    info!("🔍 Testing connection");
    Ok("连接正常".to_string())
}

fn main() {
    // 初始化简单的日志系统
    tracing_subscriber::fmt().with_env_filter("info").init();

    info!("🚀 Starting simplified Video Downloader Pro");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_system_info, test_connection])
        .setup(|app| {
            info!("🔧 Setting up simplified application");

            // 立即通知前端应用已就绪
            if let Err(e) = app.emit_all("app_ready", true) {
                error!("Failed to emit app_ready event: {}", e);
            } else {
                info!("✅ App ready event emitted");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running simplified tauri application");
}
