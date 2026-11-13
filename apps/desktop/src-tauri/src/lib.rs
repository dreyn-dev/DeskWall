//! DeskWall native host: places the wallpaper window behind the desktop icons, tracks icon
//! positions through the Shell API and forwards them to the web scene.

mod desktop;
mod protocol;
mod state;
mod tray;

use std::sync::Arc;
use std::sync::atomic::Ordering;

use tauri::{Listener, Manager, RunEvent, WindowEvent};
use tauri_plugin_store::StoreExt;

use crate::protocol::{EVENT_SETTINGS, HostSettings, ReadyReply, SETTINGS};
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
        // A second launch (e.g. from the Start menu) just opens settings in the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_settings(app)
        }))
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
        .invoke_handler(tauri::generate_handler![wallpaper_ready])
        .setup(|app| {
            let handle = app.handle().clone();
            let host = read_host_settings(&handle);
            let state = Arc::new(HostState::new(host.pause_on_fullscreen));
            app.manage(state.clone());

            // Follow settings saved by the settings window.
            let listener_handle = handle.clone();
            app.listen_any(EVENT_SETTINGS, move |event| {
                if let Ok(s) = serde_json::from_str::<HostSettings>(event.payload()) {
                    let state = listener_handle.state::<Arc<HostState>>();
                    state
                        .pause_on_fullscreen
                        .store(s.pause_on_fullscreen, Ordering::Relaxed);
                    state.publish_pause(&listener_handle, false);
                }
            });

            tray::create(&handle)?;
            desktop::start(handle.clone(), state)?;

            // Open settings on a manual launch, stay in the tray when started with Windows.
            if !std::env::args().any(|a| a == AUTOSTART_FLAG) {
                tray::show_settings(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing settings hides it; the app keeps running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == SETTINGS
            {
                api.prevent_close();
                let _ = window.hide();
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
