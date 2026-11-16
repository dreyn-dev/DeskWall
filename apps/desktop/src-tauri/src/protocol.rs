//! Mirrors `packages/protocol/src/index.ts`. Keep both in sync.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const EVENT_ICONS: &str = "deskwall://icons";
pub const EVENT_PAUSE: &str = "deskwall://pause";
pub const EVENT_SETTINGS: &str = "deskwall://settings";
pub const EVENT_POINTER: &str = "deskwall://pointer";

/// The wallpaper window on the primary monitor. The others are `wallpaper-<screen id>`.
pub const WALLPAPER: &str = "wallpaper";
const WALLPAPER_PREFIX: &str = "wallpaper-";

/// True for every wallpaper window: the primary one and one per extra monitor.
pub fn is_wallpaper(label: &str) -> bool {
    label == WALLPAPER || label.starts_with(WALLPAPER_PREFIX)
}

/// Window label of the wallpaper on a non-primary monitor.
pub fn wallpaper_label(screen: &str) -> String {
    format!("{WALLPAPER_PREFIX}{screen}")
}

/// `\\.\DISPLAY2` → `DISPLAY2`: a stable key that is also valid in a window label and a URL.
pub fn screen_id(device: &str) -> String {
    device
        .trim_start_matches(['\\', '.'])
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(32)
        .collect()
}

/// A monitor, for the settings page (`list_screens`). Physical pixels, virtual-screen space.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScreenInfo {
    pub id: String,
    pub primary: bool,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
pub const SETTINGS: &str = "settings";
/// Variant B of the settings UI: a 400px panel docked to the right edge of the desktop.
pub const DOCK: &str = "dock";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Size {
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IconsPayload {
    pub visible: bool,
    pub surface: Size,
    pub icons: Vec<PhysicalRect>,
}

/// The cursor over the empty desktop, in physical pixels relative to the wallpaper surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PointerPayload {
    pub x: i32,
    pub y: i32,
    pub inside: bool,
    pub down: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PauseReason {
    User,
    Fullscreen,
    Locked,
    /// The settings window shows its own live preview; two scenes at once double the GPU load.
    Settings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PausePayload {
    pub paused: bool,
    pub reasons: Vec<PauseReason>,
}

/// The subset of settings the host acts on. Everything else is handled by the web layer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HostSettings {
    pub pause_on_fullscreen: bool,
    pub locale: Locale,
    pub tray_opens: TrayOpens,
    pub hint_seen: bool,
    /// Theme per extra monitor (`screen id → theme id | "off"`); the host only needs "off".
    pub screen_themes: BTreeMap<String, String>,
}

/// `Settings.screenThemes` value for a monitor that keeps the normal Windows wallpaper.
pub const SCREEN_OFF: &str = "off";

impl HostSettings {
    pub fn screens_off(&self) -> BTreeSet<String> {
        self.screen_themes
            .iter()
            .filter(|(_, v)| v.as_str() == SCREEN_OFF)
            .map(|(k, _)| k.clone())
            .collect()
    }
}

/// `Settings.trayOpens`: what a tray icon click opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayOpens {
    Dock,
    /// Also any unknown value.
    #[default]
    #[serde(other)]
    Window,
}

impl Default for HostSettings {
    fn default() -> Self {
        Self {
            pause_on_fullscreen: true,
            locale: Locale::Auto,
            tray_opens: TrayOpens::Window,
            hint_seen: false,
            screen_themes: BTreeMap::new(),
        }
    }
}

/// UI language preference (`Settings.locale`). `Auto` follows the Windows display language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    En,
    /// Also any unknown value, e.g. the old `ru` choice.
    #[default]
    #[serde(other)]
    Auto,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ReadyReply {
    /// True when the host tracks real desktop icons (Windows). False: the page runs its demo.
    pub native: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icons_payload_shape_matches_typescript() {
        let p = IconsPayload {
            visible: true,
            surface: Size { w: 1920, h: 1080 },
            icons: vec![PhysicalRect {
                x: 1,
                y: 2,
                w: 3,
                h: 4,
            }],
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"visible":true,"surface":{"w":1920,"h":1080},"icons":[{"x":1,"y":2,"w":3,"h":4}]}"#
        );
    }

    #[test]
    fn pointer_payload_shape_matches_typescript() {
        let p = PointerPayload {
            x: 10,
            y: -2,
            inside: true,
            down: false,
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"x":10,"y":-2,"inside":true,"down":false}"#
        );
    }

    #[test]
    fn pause_reasons_are_lowercase() {
        let p = PausePayload {
            paused: true,
            reasons: vec![PauseReason::Fullscreen],
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"paused":true,"reasons":["fullscreen"]}"#
        );
    }

    #[test]
    fn settings_pause_reason_matches_typescript() {
        let p = PausePayload {
            paused: true,
            reasons: vec![PauseReason::User, PauseReason::Settings],
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"paused":true,"reasons":["user","settings"]}"#
        );
    }

    #[test]
    fn host_settings_tolerate_partial_json() {
        let s: HostSettings = serde_json::from_str(r#"{"palette":"dusk"}"#).unwrap();
        assert!(s.pause_on_fullscreen);
        let s: HostSettings = serde_json::from_str(r#"{"pauseOnFullscreen":false}"#).unwrap();
        assert!(!s.pause_on_fullscreen);
    }

    #[test]
    fn host_settings_read_tray_mode() {
        let s: HostSettings =
            serde_json::from_str(r#"{"trayOpens":"dock","hintSeen":true}"#).unwrap();
        assert_eq!(s.tray_opens, TrayOpens::Dock);
        assert!(s.hint_seen);
        let s: HostSettings = serde_json::from_str(r#"{"trayOpens":"panel"}"#).unwrap();
        assert_eq!(s.tray_opens, TrayOpens::Window);
        assert_eq!(
            serde_json::to_string(&TrayOpens::Dock).unwrap(),
            r#""dock""#
        );
    }

    #[test]
    fn host_settings_read_screens_off() {
        let s: HostSettings = serde_json::from_str(
            r#"{"screenThemes":{"DISPLAY2":"off","DISPLAY3":"zen","DISPLAY4":"same"}}"#,
        )
        .unwrap();
        assert_eq!(
            s.screens_off().into_iter().collect::<Vec<_>>(),
            vec!["DISPLAY2"]
        );
        let s: HostSettings = serde_json::from_str("{}").unwrap();
        assert!(s.screens_off().is_empty());
    }

    #[test]
    fn screen_ids_and_labels() {
        assert_eq!(screen_id(r"\\.\DISPLAY2"), "DISPLAY2");
        assert_eq!(screen_id("odd name/1"), "oddname1");
        assert_eq!(wallpaper_label("DISPLAY2"), "wallpaper-DISPLAY2");
        assert!(is_wallpaper("wallpaper"));
        assert!(is_wallpaper("wallpaper-DISPLAY2"));
        assert!(!is_wallpaper("settings"));
    }

    #[test]
    fn screen_info_shape_matches_typescript() {
        let s = ScreenInfo {
            id: "DISPLAY1".into(),
            primary: true,
            x: 0,
            y: 0,
            w: 3840,
            h: 2160,
        };
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"id":"DISPLAY1","primary":true,"x":0,"y":0,"w":3840,"h":2160}"#
        );
    }

    #[test]
    fn host_settings_read_locale() {
        let s: HostSettings = serde_json::from_str(r#"{"locale":"en"}"#).unwrap();
        assert_eq!(s.locale, Locale::En);
        let s: HostSettings = serde_json::from_str(r#"{"locale":"ru"}"#).unwrap();
        assert_eq!(s.locale, Locale::Auto);
        let s: HostSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.locale, Locale::Auto);
    }
}
