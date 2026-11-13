use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::locale;
use crate::protocol::{Locale, SETTINGS, WALLPAPER};
use crate::state::HostState;

struct Labels {
    settings: &'static str,
    pause: &'static str,
    reload: &'static str,
    quit: &'static str,
}

/// Tray items kept so their labels can follow a language change.
pub struct TrayItems {
    settings: MenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
    reload: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Relabels the tray menu after the language setting changes.
pub fn relabel(app: &AppHandle, pref: Locale) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let l = labels(locale::wants_russian(pref));
        let _ = items.settings.set_text(l.settings);
        let _ = items.pause.set_text(l.pause);
        let _ = items.reload.set_text(l.reload);
        let _ = items.quit.set_text(l.quit);
    }
}

fn labels(ru: bool) -> Labels {
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

pub fn create(app: &AppHandle, pref: Locale) -> tauri::Result<()> {
    let l = labels(locale::wants_russian(pref));
    let settings = MenuItem::with_id(app, "settings", l.settings, true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", l.pause, true, false, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", l.reload, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&settings, &pause, &reload, &sep, &quit])?;
    let pause_item = pause.clone();

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
    app.manage(TrayItems {
        settings,
        pause: pause_item,
        reload,
        quit,
    });
    Ok(())
}
