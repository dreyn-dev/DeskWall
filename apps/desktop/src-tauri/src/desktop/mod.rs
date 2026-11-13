//! Platform glue for the wallpaper surface.

use std::sync::Arc;

use tauri::AppHandle;

use crate::state::HostState;

#[cfg(windows)]
mod windows;

/// Whether this platform tracks real desktop icons.
pub const NATIVE: bool = cfg!(windows);

#[cfg(windows)]
pub fn start(app: AppHandle, state: Arc<HostState>) -> tauri::Result<()> {
    windows::start(app, state)
}

/// Other platforms: show the wallpaper page in a normal window so the scene can be developed
/// on macOS / Linux. It runs its built-in demo icons.
#[cfg(not(windows))]
pub fn start(app: AppHandle, _state: Arc<HostState>) -> tauri::Result<()> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window(crate::protocol::WALLPAPER) {
        w.set_decorations(true)?;
        w.set_resizable(true)?;
        w.show()?;
    }
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    #[cfg(windows)]
    windows::shutdown(app);
    #[cfg(not(windows))]
    let _ = app;
}
