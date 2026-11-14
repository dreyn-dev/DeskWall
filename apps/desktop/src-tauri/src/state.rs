use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::protocol::{
    EVENT_ICONS, EVENT_PAUSE, IconsPayload, PausePayload, PauseReason, WALLPAPER,
};

/// Shared host state. Updated by the desktop watcher thread, the tray and the settings window.
#[derive(Default)]
pub struct HostState {
    last_icons: Mutex<Option<IconsPayload>>,
    last_pause: Mutex<Option<PausePayload>>,
    pub user_paused: AtomicBool,
    pub covered: AtomicBool,
    pub locked: AtomicBool,
    pub pause_on_fullscreen: AtomicBool,
    /// The settings window (variant A, with its own preview) is on screen.
    pub settings_open: AtomicBool,
    /// `Settings.trayOpens == "dock"`: a tray click opens the desktop panel (variant B).
    pub tray_opens_dock: AtomicBool,
    /// The desktop panel stays open when it loses focus.
    pub dock_pinned: AtomicBool,
    /// When the desktop panel was last shown (focus changes right after showing are ignored).
    pub dock_shown_at: Mutex<Option<std::time::Instant>>,
}

impl HostState {
    /// Emits the icon layout to the wallpaper if it changed (or `force`).
    pub fn publish_icons(&self, app: &AppHandle, payload: Option<IconsPayload>, force: bool) {
        let mut last = self.last_icons.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(p) = payload {
            if !force && last.as_ref() == Some(&p) {
                return;
            }
            *last = Some(p);
        }
        if let Some(p) = last.as_ref()
            && let Err(err) = app.emit_to(WALLPAPER, EVENT_ICONS, p)
        {
            log::warn!("emit icons failed: {err}");
        }
    }

    /// Recomputes the pause state and emits it if it changed (or `force`).
    pub fn publish_pause(&self, app: &AppHandle, force: bool) {
        let mut reasons = Vec::new();
        if self.user_paused.load(Ordering::Relaxed) {
            reasons.push(PauseReason::User);
        }
        if self.covered.load(Ordering::Relaxed) && self.pause_on_fullscreen.load(Ordering::Relaxed)
        {
            reasons.push(PauseReason::Fullscreen);
        }
        if self.locked.load(Ordering::Relaxed) {
            reasons.push(PauseReason::Locked);
        }
        if self.settings_open.load(Ordering::Relaxed) {
            reasons.push(PauseReason::Settings);
        }
        let next = PausePayload {
            paused: !reasons.is_empty(),
            reasons,
        };
        let mut last = self.last_pause.lock().unwrap_or_else(|e| e.into_inner());
        if !force && last.as_ref() == Some(&next) {
            return;
        }
        if let Err(err) = app.emit_to(WALLPAPER, EVENT_PAUSE, &next) {
            log::warn!("emit pause failed: {err}");
        }
        *last = Some(next);
    }
}
