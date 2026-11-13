//! Mirrors `packages/protocol/src/index.ts`. Keep both in sync.

use serde::{Deserialize, Serialize};

pub const EVENT_ICONS: &str = "deskwall://icons";
pub const EVENT_PAUSE: &str = "deskwall://pause";
pub const EVENT_SETTINGS: &str = "deskwall://settings";

pub const WALLPAPER: &str = "wallpaper";
pub const SETTINGS: &str = "settings";

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PauseReason {
    User,
    Fullscreen,
    Locked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PausePayload {
    pub paused: bool,
    pub reasons: Vec<PauseReason>,
}

/// The subset of settings the host acts on. Everything else is handled by the web layer.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HostSettings {
    pub pause_on_fullscreen: bool,
}

impl Default for HostSettings {
    fn default() -> Self {
        Self {
            pause_on_fullscreen: true,
        }
    }
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
    fn host_settings_tolerate_partial_json() {
        let s: HostSettings = serde_json::from_str(r#"{"palette":"dusk"}"#).unwrap();
        assert!(s.pause_on_fullscreen);
        let s: HostSettings = serde_json::from_str(r#"{"pauseOnFullscreen":false}"#).unwrap();
        assert!(!s.pause_on_fullscreen);
    }
}
