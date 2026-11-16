use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::protocol::{EVENT_ICONS, EVENT_PAUSE, IconsPayload, PausePayload, PauseReason};

/// What the host last sent to one wallpaper window (one per monitor).
#[derive(Default)]
struct WallState {
    icons: Option<IconsPayload>,
    pause: Option<PausePayload>,
    /// A full-screen or maximized window covers this monitor.
    covered: bool,
}

/// Shared host state. Updated by the desktop watcher thread, the tray and the settings window.
#[derive(Default)]
pub struct HostState {
    /// Keyed by wallpaper window label (`wallpaper`, `wallpaper-DISPLAY2`, ...).
    walls: Mutex<BTreeMap<String, WallState>>,
    pub user_paused: AtomicBool,
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
    /// Monitors (`Settings.screenThemes` keys) set to "off": no wallpaper window there.
    pub screens_off: Mutex<BTreeSet<String>>,
}

impl HostState {
    fn walls(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, WallState>> {
        self.walls.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Forgets a wallpaper window that was closed (its monitor was unplugged or turned off).
    pub fn remove_wall(&self, label: &str) {
        self.walls().remove(label);
    }

    /// Emits the icon layout to one wallpaper window if it changed (or `force`).
    pub fn publish_icons(
        &self,
        app: &AppHandle,
        label: &str,
        payload: Option<IconsPayload>,
        force: bool,
    ) {
        let mut walls = self.walls();
        let wall = walls.entry(label.to_owned()).or_default();
        if let Some(p) = payload {
            if !force && wall.icons.as_ref() == Some(&p) {
                return;
            }
            let summary = |i: &IconsPayload| (i.icons.len(), i.surface, i.visible);
            if wall.icons.as_ref().map(summary) != Some(summary(&p)) {
                log::info!(
                    "{label}: {} icons on {}x{} (visible: {})",
                    p.icons.len(),
                    p.surface.w,
                    p.surface.h,
                    p.visible
                );
            }
            wall.icons = Some(p);
        }
        if let Some(p) = wall.icons.as_ref()
            && let Err(err) = app.emit_to(label, EVENT_ICONS, p)
        {
            log::warn!("emit icons to {label} failed: {err}");
        }
    }

    /// Marks one monitor as covered by a full-screen window (or not).
    pub fn set_covered(&self, label: &str, covered: bool) {
        self.walls().entry(label.to_owned()).or_default().covered = covered;
    }

    /// Recomputes the pause state of every wallpaper window and emits the ones that changed
    /// (or all of them with `force`).
    pub fn publish_pause(&self, app: &AppHandle, force: bool) {
        let mut shared = Vec::new();
        if self.user_paused.load(Ordering::Relaxed) {
            shared.push(PauseReason::User);
        }
        let fullscreen = self.pause_on_fullscreen.load(Ordering::Relaxed);
        let locked = self.locked.load(Ordering::Relaxed);
        let settings = self.settings_open.load(Ordering::Relaxed);

        for (label, wall) in self.walls().iter_mut() {
            let mut reasons = shared.clone();
            if wall.covered && fullscreen {
                reasons.push(PauseReason::Fullscreen);
            }
            if locked {
                reasons.push(PauseReason::Locked);
            }
            if settings {
                reasons.push(PauseReason::Settings);
            }
            let next = PausePayload {
                paused: !reasons.is_empty(),
                reasons,
            };
            if !force && wall.pause.as_ref() == Some(&next) {
                continue;
            }
            if let Err(err) = app.emit_to(label.as_str(), EVENT_PAUSE, &next) {
                log::warn!("emit pause to {label} failed: {err}");
            }
            wall.pause = Some(next);
        }
    }

    /// Sends one window its last icons and pause state (it just loaded or reloaded).
    pub fn replay(&self, app: &AppHandle, label: &str) {
        self.publish_icons(app, label, None, true);
        // Force a resend for this window only.
        if let Some(w) = self.walls().get_mut(label) {
            w.pause = None;
        }
        self.publish_pause(app, false);
    }
}
