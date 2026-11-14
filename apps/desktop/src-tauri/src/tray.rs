use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Wry};
use tauri_plugin_store::StoreExt;

use crate::locale;
use crate::protocol::{DOCK, Locale, SETTINGS, TrayOpens, WALLPAPER};
use crate::state::HostState;

/// Width of the desktop panel (variant B) in logical pixels, from brand/DESIGN.md.
const DOCK_WIDTH: f64 = 400.0;

struct Labels {
    window: &'static str,
    dock: &'static str,
    pause: &'static str,
    reload: &'static str,
    quit: &'static str,
}

/// Tray items kept so their labels can follow a language change.
pub struct TrayItems {
    window: MenuItem<Wry>,
    dock: MenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
    reload: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Relabels the tray menu after the language setting changes.
pub fn relabel(app: &AppHandle, pref: Locale) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let l = labels(locale::wants_russian(pref));
        let _ = items.window.set_text(l.window);
        let _ = items.dock.set_text(l.dock);
        let _ = items.pause.set_text(l.pause);
        let _ = items.reload.set_text(l.reload);
        let _ = items.quit.set_text(l.quit);
    }
}

fn labels(ru: bool) -> Labels {
    if ru {
        Labels {
            window: "Окно настроек",
            dock: "Панель на рабочем столе",
            pause: "Пауза",
            reload: "Перезагрузить сцену",
            quit: "Выход",
        }
    } else {
        Labels {
            window: "Settings window",
            dock: "Panel on the desktop",
            pause: "Pause",
            reload: "Reload scene",
            quit: "Quit",
        }
    }
}

/// Which settings UI to show: the window with a live preview (A) or the desktop panel (B).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiMode {
    Window,
    Dock,
}

impl UiMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "window" => Some(Self::Window),
            "dock" => Some(Self::Dock),
            _ => None,
        }
    }

    fn setting(self) -> TrayOpens {
        match self {
            Self::Window => TrayOpens::Window,
            Self::Dock => TrayOpens::Dock,
        }
    }
}

/// Opens the settings UI a tray click should open (`Settings.trayOpens`).
pub fn show_settings(app: &AppHandle) {
    let dock = app
        .try_state::<Arc<HostState>>()
        .is_some_and(|s| s.tray_opens_dock.load(Ordering::Relaxed));
    show_mode(app, if dock { UiMode::Dock } else { UiMode::Window });
}

/// Opens a variant the user picked explicitly and remembers it for the next tray click.
pub fn open_and_remember(app: &AppHandle, mode: UiMode) {
    remember_mode(app, mode);
    show_mode(app, mode);
}

/// Stores `trayOpens` in the host state and in the settings store (the pages reread the store
/// when their window gets focus).
fn remember_mode(app: &AppHandle, mode: UiMode) {
    if let Some(state) = app.try_state::<Arc<HostState>>() {
        state
            .tray_opens_dock
            .store(mode == UiMode::Dock, Ordering::Relaxed);
    }
    let Ok(store) = app.store("settings.json") else {
        return;
    };
    let mut settings = store
        .get("settings")
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let value = serde_json::to_value(mode.setting()).unwrap_or_default();
    if settings.get("trayOpens") == Some(&value) {
        return;
    }
    settings["trayOpens"] = value;
    store.set("settings", settings);
    if let Err(err) = store.save() {
        log::warn!("saving trayOpens failed: {err}");
    }
}

/// Shows one settings variant and hides the other.
pub fn show_mode(app: &AppHandle, mode: UiMode) {
    let (show, hide) = match mode {
        UiMode::Window => (SETTINGS, DOCK),
        UiMode::Dock => (DOCK, SETTINGS),
    };
    if let Some(w) = app.get_webview_window(hide) {
        let _ = w.hide();
    }
    if let Some(w) = app.get_webview_window(show) {
        if mode == UiMode::Dock {
            place_dock(app, &w);
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    sync_settings_pause(app);
}

/// Docks the panel to the right edge of the work area (above the taskbar) of the monitor under
/// the cursor, sized for that monitor's DPI.
fn place_dock(app: &AppHandle, w: &tauri::WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let area = monitor.work_area();
    let width = (DOCK_WIDTH * monitor.scale_factor()).round() as u32;
    let x = area.position.x + area.size.width as i32 - width as i32;
    // Move first so the window takes the target monitor's DPI before it gets its size.
    let _ = w.set_position(PhysicalPosition::new(x, area.position.y));
    let _ = w.set_size(PhysicalSize::new(width, area.size.height));
}

/// Hides the desktop panel shortly after it loses focus, unless it is pinned. The delay lets
/// focus come back from short-lived popups (the language list) without closing the panel.
pub fn dock_blurred(app: &AppHandle) {
    let pinned = app
        .try_state::<Arc<HostState>>()
        .is_some_and(|s| s.dock_pinned.load(Ordering::Relaxed));
    if pinned {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        if let Some(w) = app.get_webview_window(DOCK)
            && !w.is_focused().unwrap_or(true)
            && !app
                .state::<Arc<HostState>>()
                .dock_pinned
                .load(Ordering::Relaxed)
        {
            let _ = w.hide();
        }
    });
}

/// Pauses the desktop scene while the settings window (with its own preview) is on screen.
pub fn sync_settings_pause(app: &AppHandle) {
    let open = app
        .get_webview_window(SETTINGS)
        .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false));
    if let Some(state) = app.try_state::<Arc<HostState>>() {
        state.settings_open.store(open, Ordering::Relaxed);
        state.publish_pause(app, false);
    }
}

pub fn create(app: &AppHandle, pref: Locale) -> tauri::Result<()> {
    let l = labels(locale::wants_russian(pref));
    let window = MenuItem::with_id(app, "window", l.window, true, None::<&str>)?;
    let dock = MenuItem::with_id(app, "dock", l.dock, true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", l.pause, true, false, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", l.reload, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&window, &dock, &sep, &pause, &reload, &sep2, &quit])?;
    let pause_item = pause.clone();

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("DeskWall")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "window" => open_and_remember(app, UiMode::Window),
            "dock" => open_and_remember(app, UiMode::Dock),
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
        window,
        dock,
        pause: pause_item,
        reload,
        quit,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_mode_parses_known_values_only() {
        assert_eq!(UiMode::parse("window"), Some(UiMode::Window));
        assert_eq!(UiMode::parse("dock"), Some(UiMode::Dock));
        assert_eq!(UiMode::parse("panel"), None);
        assert_eq!(UiMode::Dock.setting(), TrayOpens::Dock);
    }
}
