//! Auto-update: checks the update feed, downloads in the background and installs (passive NSIS).
//!
//! The feed URL and the minisign public key live in `tauri.conf.json` (`plugins.updater`), so
//! moving to another host means editing that one place. Failures (offline, no release yet) are
//! only logged and shown as a status; nothing pops up.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::protocol::{EVENT_UPDATE, UpdatePayload, UpdateState};

/// First check this long after start, so startup stays light.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// Shared updater state (managed by Tauri).
pub struct Updates {
    status: Mutex<UpdatePayload>,
    /// `Settings.autoUpdate`.
    auto: AtomicBool,
    /// A check or download is running.
    busy: AtomicBool,
    /// The found update, kept for "install now" when automatic updates are off.
    pending: Mutex<Option<Update>>,
}

impl Updates {
    pub fn new(current: String, auto: bool) -> Self {
        Self {
            status: Mutex::new(UpdatePayload {
                state: UpdateState::Idle,
                current,
                latest: None,
                progress: None,
                checked_at: None,
            }),
            auto: AtomicBool::new(auto),
            busy: AtomicBool::new(false),
            pending: Mutex::new(None),
        }
    }

    pub fn set_auto(&self, auto: bool) {
        self.auto.store(auto, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> UpdatePayload {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn pending(&self) -> std::sync::MutexGuard<'_, Option<Update>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Download progress in whole percent, or None while the size is unknown.
pub fn percent(done: u64, total: Option<u64>) -> Option<u8> {
    total
        .filter(|t| *t > 0)
        .map(|t| (done.saturating_mul(100) / t).min(100) as u8)
}

/// Updates the status and tells the settings windows.
fn publish(app: &AppHandle, change: impl FnOnce(&mut UpdatePayload)) {
    let Some(updates) = app.try_state::<Arc<Updates>>() else {
        return;
    };
    let payload = {
        let mut status = updates.status.lock().unwrap_or_else(|e| e.into_inner());
        change(&mut status);
        status.clone()
    };
    let _ = app.emit(EVENT_UPDATE, payload);
}

/// Checks for an update. With automatic updates on, a found update is installed right away.
pub async fn check(app: &AppHandle, manual: bool) {
    let updates = app.state::<Arc<Updates>>().inner().clone();
    if updates.busy.swap(true, Ordering::AcqRel) {
        return;
    }
    publish(app, |s| {
        s.state = UpdateState::Checking;
        s.progress = None;
    });
    log::info!(
        "update check started ({})",
        if manual { "manual" } else { "scheduled" }
    );

    let handle = app.clone();
    let found = match app
        .updater_builder()
        // The installer replaces the exe and relaunches it; give the desktop its icons back first.
        .on_before_exit(move || crate::desktop::shutdown(&handle))
        .build()
    {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };

    match found {
        Ok(None) => {
            log::info!("no update found");
            *updates.pending() = None;
            publish(app, |s| {
                s.state = UpdateState::UpToDate;
                s.latest = None;
                s.checked_at = Some(now_ms());
            });
        }
        Ok(Some(update)) => {
            log::info!(
                "update found: {} -> {}",
                update.current_version,
                update.version
            );
            let version = update.version.clone();
            publish(app, |s| {
                s.state = UpdateState::Available;
                s.latest = Some(version);
                s.checked_at = Some(now_ms());
            });
            if updates.auto.load(Ordering::Relaxed) {
                download_and_install(app, &update).await;
            } else {
                *updates.pending() = Some(update);
            }
        }
        Err(err) => {
            log::warn!("update check failed: {err}");
            publish(app, |s| {
                s.state = UpdateState::Error;
                s.checked_at = Some(now_ms());
            });
        }
    }
    updates.busy.store(false, Ordering::Release);
}

/// Downloads the update, verifies it and starts the installer, which restarts the app.
async fn download_and_install(app: &AppHandle, update: &Update) {
    let mut done: u64 = 0;
    let mut last: Option<u8> = None;
    publish(app, |s| {
        s.state = UpdateState::Downloading;
        s.progress = Some(0);
    });
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                let p = percent(done, total);
                if p != last {
                    last = p;
                    publish(app, |s| s.progress = p);
                }
            },
            || {},
        )
        .await;
    let bytes = match bytes {
        Ok(b) => b,
        Err(err) => {
            log::warn!("update download failed: {err}");
            publish(app, |s| {
                s.state = UpdateState::Error;
                s.progress = None;
            });
            return;
        }
    };
    publish(app, |s| {
        s.state = UpdateState::Ready;
        s.progress = Some(100);
    });
    log::info!("update {} downloaded, installing", update.version);
    // On Windows this starts the installer and exits the app; it comes back after the install.
    if let Err(err) = update.install(bytes) {
        log::warn!("update install failed: {err}");
        publish(app, |s| {
            s.state = UpdateState::Error;
            s.progress = None;
        });
    }
}

/// Installs the update found earlier (automatic updates are off). No-op if none is waiting.
pub async fn install_pending(app: &AppHandle) {
    let updates = app.state::<Arc<Updates>>().inner().clone();
    let Some(update) = updates.pending().take() else {
        return;
    };
    if updates.busy.swap(true, Ordering::AcqRel) {
        *updates.pending() = Some(update);
        return;
    }
    download_and_install(app, &update).await;
    updates.busy.store(false, Ordering::Release);
}

/// Schedules the checks: once after start, then every six hours. Release builds only: a dev
/// build has no installed copy to replace.
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        log::info!("scheduled update checks are off in dev builds");
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(FIRST_CHECK_DELAY).await;
        loop {
            check(&app, false).await;
            sleep(CHECK_EVERY).await;
        }
    });
}

/// A thread sleep on the blocking pool keeps us off a direct tokio dependency.
async fn sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_percent_is_clamped() {
        assert_eq!(percent(50, Some(200)), Some(25));
        assert_eq!(percent(300, Some(200)), Some(100));
        assert_eq!(percent(10, None), None);
        assert_eq!(percent(10, Some(0)), None);
    }

    #[test]
    fn starts_idle_with_the_current_version() {
        let u = Updates::new("0.1.0".into(), true);
        let s = u.snapshot();
        assert_eq!(s.state, UpdateState::Idle);
        assert_eq!(s.current, "0.1.0");
        assert!(s.latest.is_none());
    }
}
