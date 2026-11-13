use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::protocol::{SETTINGS, WALLPAPER};
use crate::state::HostState;

struct Labels {
    settings: &'static str,
    pause: &'static str,
    reload: &'static str,
    quit: &'static str,
}

fn labels() -> Labels {
    let ru = sys_locale::get_locale().is_some_and(|l| l.to_lowercase().starts_with("ru"));
    if ru {
        Labels {
            settings: "Настройки",
            pause: "Пауза",
            reload: "Перезагрузить сцену",
            quit: "Выход",
        }
    } else {
        Labels {
            settings: "Settings",
            pause: "Pause",
            reload: "Reload scene",
            quit: "Quit",
        }
    }
}

pub fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let l = labels();
    let settings = MenuItem::with_id(app, "settings", l.settings, true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", l.pause, true, false, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", l.reload, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&settings, &pause, &reload, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("DeskWall")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "settings" => show_settings(app),
            "pause" => {
                let state = app.state::<Arc<HostState>>();
                let paused = !state.user_paused.load(Ordering::Relaxed);
                state.user_paused.store(paused, Ordering::Relaxed);
                let _ = pause.set_checked(paused);
                state.publish_pause(app, false);
            }
            "reload" => {
                if let Some(w) = app.get_webview_window(WALLPAPER) {
                    let _ = w.reload();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_settings(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
