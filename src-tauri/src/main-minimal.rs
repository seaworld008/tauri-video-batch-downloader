// 最简化的Tauri应用，只保留核心功能
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 测试命令
#[tauri::command]
async fn test_hello() -> Result<String, String> {
    println!("Hello from backend!");
    Ok("Hello from Tauri backend!".to_string())
}

fn main() {
    println!("🚀 Starting minimal Tauri app");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![test_hello])
        .setup(|app| {
            println!("✅ Tauri app setup complete");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
