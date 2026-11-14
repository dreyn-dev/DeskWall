//! DeskWall native host: places the wallpaper window behind the desktop icons, tracks icon
//! positions through the Shell API and forwards them to the web scene.

mod chrome;
mod desktop;
mod load;
mod locale;
mod protocol;
mod state;
mod tray;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use tauri::{Listener, Manager, RunEvent, WindowEvent};
use tauri_plugin_store::StoreExt;

use crate::protocol::{DOCK, EVENT_SETTINGS, HostSettings, ReadyReply, SETTINGS, TrayOpens};
use crate::state::HostState;

const AUTOSTART_FLAG: &str = "--autostart";

/// Called by the wallpaper page once its listeners are in place.
#[tauri::command]
fn wallpaper_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<HostState>>,
    backend: String,
) -> ReadyReply {
    log::info!("wallpaper ready, renderer backend: {backend}");
    state.publish_icons(&app, None, true);
    state.publish_pause(&app, true);
    ReadyReply {
        native: desktop::NATIVE,
    }
}

/// The Windows user's languages, for the settings page ("System" language).
#[tauri::command]
fn system_locales() -> Vec<String> {
    locale::system_locales()
}

/// Opens a settings UI variant from the page: `window` (A) or `dock` (B).
#[tauri::command]
fn open_settings(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let mode = tray::UiMode::parse(&mode).ok_or_else(|| format!("unknown mode: {mode}"))?;
    tray::open_and_remember(&app, mode);
    Ok(())
}

/// Keeps the desktop panel open when it loses focus (the pin in its header).
#[tauri::command]
fn set_dock_pinned(state: tauri::State<'_, Arc<HostState>>, pinned: bool) {
    state.dock_pinned.store(pinned, Ordering::Relaxed);
}

/// CPU and GPU load of DeskWall (our process and its WebView2 processes).
#[tauri::command]
fn load_stats(sampler: tauri::State<'_, Mutex<load::Sampler>>) -> load::LoadStats {
    sampler.lock().unwrap_or_else(|e| e.into_inner()).sample()
}

/// Reads `--open=window` / `--open=dock` from a launch's arguments.
fn open_arg(args: &[String]) -> Option<tray::UiMode> {
    args.iter()
        .find_map(|a| a.strip_prefix("--open="))
        .and_then(tray::UiMode::parse)
}

fn read_host_settings(app: &tauri::AppHandle) -> HostSettings {
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get("settings"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Managed before any window exists: the wallpaper page may call `wallpaper_ready`
        // before `setup` finishes. `setup` fills in the stored settings.
        .manage(Arc::new(HostState::default()))
        .manage(Mutex::new(load::Sampler::default()))
        // A second launch (e.g. from the Start menu) just opens settings in the running instance.
        // `--open=window|dock` picks the settings mode (shortcuts, checks on the PC).
        .plugin(tauri_plugin_single_instance::init(
            |app, args, _cwd| match open_arg(&args) {
                Some(mode) => tray::open_and_remember(app, mode),
                None => tray::show_settings(app),
            },
        ))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([AUTOSTART_FLAG])
                .app_name("DeskWall")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            wallpaper_ready,
            system_locales,
            open_settings,
            set_dock_pinned,
            load_stats
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let host = read_host_settings(&handle);
            let state = app.state::<Arc<HostState>>().inner().clone();
            state
                .pause_on_fullscreen
                .store(host.pause_on_fullscreen, Ordering::Relaxed);
            state
                .tray_opens_dock
                .store(host.tray_opens == TrayOpens::Dock, Ordering::Relaxed);
            state.publish_pause(&handle, true);

            // Follow settings saved by the settings window.
            let listener_handle = handle.clone();
            app.listen_any(EVENT_SETTINGS, move |event| {
                if let Ok(s) = serde_json::from_str::<HostSettings>(event.payload()) {
                    let state = listener_handle.state::<Arc<HostState>>();
                    state
                        .pause_on_fullscreen
                        .store(s.pause_on_fullscreen, Ordering::Relaxed);
                    state
                        .tray_opens_dock
                        .store(s.tray_opens == TrayOpens::Dock, Ordering::Relaxed);
                    state.publish_pause(&listener_handle, false);
                    tray::relabel(&listener_handle, s.locale);
                }
            });

            tray::create(&handle, host.locale)?;
            desktop::start(handle.clone(), state)?;

            // Open settings on a manual launch, stay in the tray when started with Windows.
            // The very first run always opens the window: it carries the first-run hint.
            let args: Vec<String> = std::env::args().collect();
            if let Some(mode) = open_arg(&args) {
                tray::open_and_remember(&handle, mode);
            } else if !args.iter().any(|a| a == AUTOSTART_FLAG) {
                if host.hint_seen {
                    tray::show_settings(&handle);
                } else {
                    tray::show_mode(&handle, tray::UiMode::Window);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            if label != SETTINGS && label != DOCK {
                return;
            }
            match event {
                // Closing settings hides it; the app keeps running in the tray.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    tray::sync_settings_pause(window.app_handle());
                }
                // Minimizing or restoring the window toggles the desktop pause.
                WindowEvent::Resized(_) if label == SETTINGS => {
                    tray::sync_settings_pause(window.app_handle());
                }
                // Snap Layouts on the custom maximize button; refreshed because WebView2
                // creates its child windows late.
                WindowEvent::Focused(true) if label == SETTINGS => {
                    if let Some(w) = window.app_handle().get_webview_window(SETTINGS) {
                        chrome::install(&w);
                    }
                }
                // The desktop panel hides on click-away unless pinned.
                WindowEvent::Focused(false) if label == DOCK => {
                    tray::dock_blurred(window.app_handle());
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building DeskWall")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                desktop::shutdown(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_argument_picks_a_mode() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            open_arg(&args(&["deskwall.exe", "--open=dock"])),
            Some(tray::UiMode::Dock)
        );
        assert_eq!(open_arg(&args(&["deskwall.exe"])), None);
        assert_eq!(open_arg(&args(&["deskwall.exe", "--open=nope"])), None);
    }
}
