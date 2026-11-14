use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Wry};

use crate::locale;
use crate::protocol::{DOCK, Locale, SETTINGS, WALLPAPER};
use crate::state::HostState;

/// Width of the desktop panel (variant B) in logical pixels, from brand/DESIGN.md.
const DOCK_WIDTH: f64 = 400.0;

struct Labels {
    settings: &'static str,
    dock: &'static str,
    prefer_dock: &'static str,
    pause: &'static str,
    reload: &'static str,
    quit: &'static str,
}

/// Tray items kept so their labels can follow a language change.
pub struct TrayItems {
    settings: MenuItem<Wry>,
    dock: MenuItem<Wry>,
    prefer_dock: Option<CheckMenuItem<Wry>>,
    pause: CheckMenuItem<Wry>,
    reload: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Relabels the tray menu after the language setting changes.
pub fn relabel(app: &AppHandle, pref: Locale) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let l = labels(locale::wants_russian(pref));
        let _ = items.settings.set_text(l.settings);
        let _ = items.dock.set_text(l.dock);
        if let Some(item) = &items.prefer_dock {
            let _ = item.set_text(l.prefer_dock);
        }
        let _ = items.pause.set_text(l.pause);
        let _ = items.reload.set_text(l.reload);
        let _ = items.quit.set_text(l.quit);
    }
}

fn labels(ru: bool) -> Labels {
    if ru {
        Labels {
            settings: "Настройки",
            dock: "Панель на рабочем столе",
            prefer_dock: "Прототип: клик по значку открывает панель",
            pause: "Пауза",
            reload: "Перезагрузить сцену",
            quit: "Выход",
        }
    } else {
        Labels {
            settings: "Settings",
            dock: "Panel on the desktop",
            prefer_dock: "Prototype: tray click opens the panel",
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
}

/// Opens the settings UI the tray prefers (variant A unless the prototype switch says B).
pub fn show_settings(app: &AppHandle) {
    let dock = app
        .try_state::<Arc<HostState>>()
        .is_some_and(|s| s.prefer_dock.load(Ordering::Relaxed));
    show_mode(app, if dock { UiMode::Dock } else { UiMode::Window });
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
            place_dock(&w);
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    sync_settings_pause(app);
}

/// Docks the panel to the right edge of the primary monitor's work area (above the taskbar).
fn place_dock(w: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = w.primary_monitor() else {
        return;
    };
    let area = monitor.work_area();
    let width = (DOCK_WIDTH * monitor.scale_factor()).round() as u32;
    let x = area.position.x + area.size.width as i32 - width as i32;
    let _ = w.set_size(PhysicalSize::new(width, area.size.height));
    let _ = w.set_position(PhysicalPosition::new(x, area.position.y));
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
    let settings = MenuItem::with_id(app, "settings", l.settings, true, None::<&str>)?;
    let dock = MenuItem::with_id(app, "dock", l.dock, true, None::<&str>)?;
    // Dev builds only: lets Mark compare variants A and B from the tray.
    let prefer_dock = if cfg!(debug_assertions) {
        Some(CheckMenuItem::with_id(
            app,
            "prefer_dock",
            l.prefer_dock,
            true,
            false,
            None::<&str>,
        )?)
    } else {
        None
    };
    let pause = CheckMenuItem::with_id(app, "pause", l.pause, true, false, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", l.reload, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&settings, &dock, &sep, &pause, &reload, &sep2, &quit],
    )?;
    if let Some(item) = &prefer_dock {
        menu.insert(item, 2)?;
    }
    let pause_item = pause.clone();
    let prefer_item = prefer_dock.clone();

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("DeskWall")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "settings" => show_mode(app, UiMode::Window),
            "dock" => show_mode(app, UiMode::Dock),
            "prefer_dock" => {
                let state = app.state::<Arc<HostState>>();
                let next = !state.prefer_dock.load(Ordering::Relaxed);
                state.prefer_dock.store(next, Ordering::Relaxed);
                if let Some(item) = &prefer_item {
                    let _ = item.set_checked(next);
                }
            }
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
        dock,
        prefer_dock,
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
    }
}
