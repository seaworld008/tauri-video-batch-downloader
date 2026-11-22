use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tracing::warn;

use crate::AppState;

const TRAY_ID: &str = "main";
const MENU_SHOW_HIDE: &str = "tray_show_hide";
const MENU_START_ALL: &str = "tray_start_all";
const MENU_PAUSE_ALL: &str = "tray_pause_all";
const MENU_QUIT: &str = "tray_quit";

/// Returns whether a window close request should hide to the system tray instead of exiting.
pub fn should_minimize_on_close(minimize_to_tray: bool, force_quit: bool) -> bool {
    minimize_to_tray && !force_quit
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

fn handle_menu_action(app: &AppHandle, menu_id: &str, force_quit: &Arc<AtomicBool>) {
    match menu_id {
        MENU_SHOW_HIDE => toggle_main_window(app),
        MENU_START_ALL => {
            let runtime = app.state::<AppState>().download_runtime.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = runtime.start_all().await {
                    warn!("Tray start_all failed: {}", err);
                }
            });
        }
        MENU_PAUSE_ALL => {
            let runtime = app.state::<AppState>().download_runtime.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = runtime.pause_all().await {
                    warn!("Tray pause_all failed: {}", err);
                }
            });
        }
        MENU_QUIT => {
            force_quit.store(true, Ordering::SeqCst);
            let app_handle = app.clone();
            let download_manager = app.state::<AppState>().download_manager.clone();
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(Duration::from_secs(5), async {
                    let mut manager = download_manager.write().await;
                    if let Err(err) = manager.stop().await {
                        warn!("Failed to stop download manager on tray quit: {}", err);
                    }
                })
                .await;
                app_handle.exit(0);
            });
        }
        _ => {}
    }
}

pub fn build_tray(app: &tauri::App, force_quit: Arc<AtomicBool>) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(
        app,
        MENU_SHOW_HIDE,
        "Show / Hide Window",
        true,
        None::<&str>,
    )?;
    let start_all = MenuItem::with_id(
        app,
        MENU_START_ALL,
        "Start / Resume All",
        true,
        None::<&str>,
    )?;
    let pause_all = MenuItem::with_id(app, MENU_PAUSE_ALL, "Pause All", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show_hide, &start_all, &pause_all, &separator, &quit],
    )?;

    let fq_for_menu = Arc::clone(&force_quit);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
        let _ = tray.set_tooltip(Some("Video Downloader Pro"));
        tray.on_menu_event(move |app_handle, event| {
            handle_menu_action(app_handle, event.id().as_ref(), &fq_for_menu);
        });
        tray.on_tray_icon_event(|tray_icon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray_icon.app_handle());
            }
        });
        return Ok(());
    }

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Video Downloader Pro");

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
        .on_menu_event(move |app_handle, event| {
            handle_menu_action(app_handle, event.id().as_ref(), &fq_for_menu);
        })
        .on_tray_icon_event(|tray_icon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray_icon.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_minimize_on_close;

    #[test]
    fn minimizes_to_tray_only_when_enabled_and_not_force_quitting() {
        assert!(!should_minimize_on_close(false, false));
        assert!(!should_minimize_on_close(false, true));
        assert!(should_minimize_on_close(true, false));
        assert!(!should_minimize_on_close(true, true));
    }
}
