/**
 * Messages exchanged between the native host (Rust / Tauri) and the web layer.
 * Rust mirrors these shapes in `apps/desktop/src-tauri/src/protocol.rs`; keep both in sync.
 */

/** Event names emitted by the host. */
export const HostEvent = {
  /** Desktop icon layout changed. Payload: {@link IconsPayload}. */
  Icons: 'deskwall://icons',
  /** Rendering should pause or resume. Payload: {@link PausePayload}. */
  Pause: 'deskwall://pause',
  /** Settings changed in another window. Payload: {@link Settings}. */
  Settings: 'deskwall://settings',
  /** Cursor over the empty desktop (for theme interactions). Payload: {@link PointerPayload}. */
  Pointer: 'deskwall://pointer',
  /** Updater status changed. Payload: {@link UpdatePayload}. */
  Update: 'deskwall://update',
} as const;

/** A rectangle in physical pixels, relative to the wallpaper surface's top-left corner. */
export interface PhysicalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IconsPayload {
  /** False when the user turned off "Show desktop icons". */
  visible: boolean;
  /** Surface size in physical pixels. */
  surface: { w: number; h: number };
  icons: PhysicalRect[];
}

/**
 * The cursor as seen by the wallpaper. Windows routes mouse input to the icon layer, so the host
 * watches the cursor and sends it while it is over the desktop itself (not over another window).
 */
export interface PointerPayload {
  /** Physical pixels relative to the wallpaper surface. */
  x: number;
  y: number;
  /** False when the cursor left the desktop (another window, taskbar, other monitor). */
  inside: boolean;
  /** Left button held. */
  down: boolean;
}

/** `settings`: the settings window is open with its own live preview (brand/DESIGN.md). */
export type PauseReason = 'user' | 'fullscreen' | 'locked';

export interface PausePayload {
  paused: boolean;
  reasons: PauseReason[];
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

/** Updater status from the host (`update_status`, event {@link HostEvent.Update}). */
export interface UpdatePayload {
  state: UpdateState;
  /** Installed version. */
  current: string;
  /** Newest version found, if any. */
  latest: string | null;
  /** 0..100 while `downloading`. */
  progress: number | null;
  /** Unix time in milliseconds of the last finished check. */
  checkedAt: number | null;
}

/** Removed themes (`year`, `forest`, 2026-11-14) fall back to the default theme when loaded. */
export type ThemeId = 'beach' | 'meadow' | 'thaw' | 'zen' | 'mycelium' | 'isles';
export const THEME_IDS: readonly ThemeId[] = [
  'beach',
  'meadow',
  'thaw',
  'zen',
  'mycelium',
  'isles',
];
export type PaletteId = 'daybreak' | 'lagoon' | 'dusk' | 'nocturne';

/**
 * A monitor, from the host (`list_screens`). Physical pixels in virtual-screen space.
 * `id` is the Windows device name without `\\.\` (e.g. `DISPLAY2`).
 */
export interface ScreenInfo {
  id: string;
  primary: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What an extra monitor shows: `same` follows {@link Settings.theme} (the primary monitor's
 * theme), `off` keeps the normal Windows wallpaper there.
 */
export type ScreenTheme = ThemeId | 'same' | 'off';

export interface Settings {
  /** Theme of the primary monitor, and of every other monitor set to `same`. */
  theme: ThemeId;
  /** Per extra monitor, keyed by {@link ScreenInfo.id}. Missing means `same`. */
  screenThemes: Record<string, ScreenTheme>;
  /** Per-theme parameters for the classic themes, e.g. `{ beach: { palms: 4 } }`. */
  themeParams: Partial<Record<ThemeId, Record<string, number>>>;
  palette: PaletteId;
  /** 0..1 — how far land spreads out from the icons. */
  landReach: number;
  /** 0..1 — irregularity of coastlines. */
  roughness: number;
  /** 0..2 — speed multiplier for water and clouds. */
  motion: number;
  /** Frame rate cap. 30 is the default for integrated GPUs. */
  fps: 15 | 30 | 60;
  /** Draw contour lines between terraces. */
  contours: boolean;
  /** Pause when a full-screen or maximized window covers the wallpaper. */
  pauseOnFullscreen: boolean;
  /** Start with Windows. */
  autostart: boolean;
  /** 0..1 — soft shade under icon captions so they stay readable on bright scenery. */
  labelVeil: number;
  locale: 'auto' | 'en';
  /**
   * What a click on the tray icon opens: the settings window or the desktop panel. Also follows
   * the mode the user switched to last.
   */
  trayOpens: 'window' | 'dock';
  /** The first-run hint in the settings window was shown and dismissed. */
  hintSeen: boolean;
  /** Download and install new versions in the background. */
  autoUpdate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'beach',
  screenThemes: {},
  themeParams: {},
  palette: 'lagoon',
  landReach: 0.5,
  roughness: 0.5,
  motion: 1,
  fps: 30,
  contours: true,
  pauseOnFullscreen: true,
  autostart: false,
  labelVeil: 0.7,
  locale: 'auto',
  trayOpens: 'window',
  hintSeen: false,
  autoUpdate: true,
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const oneOf = <T extends string | number>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;

function normalizeThemeParams(input: unknown): Settings['themeParams'] {
  const out: Settings['themeParams'] = {};
  if (!input || typeof input !== 'object') return out;
  for (const id of THEME_IDS) {
    const params = (input as Record<string, unknown>)[id];
    if (!params || typeof params !== 'object') continue;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(params))
      if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
    out[id] = clean;
  }
  return out;
}

const SCREEN_ID = /^[A-Za-z0-9_-]{1,32}$/;

function normalizeScreenThemes(input: unknown): Settings['screenThemes'] {
  const out: Settings['screenThemes'] = {};
  if (!input || typeof input !== 'object') return out;
  for (const [id, v] of Object.entries(input)) {
    if (!SCREEN_ID.test(id)) continue;
    // `same` is the default: not stored. Removed themes fall back to it too.
    if (v === 'off' || THEME_IDS.includes(v as ThemeId)) out[id] = v as ScreenTheme;
  }
  return out;
}

/**
 * The theme a wallpaper window shows. `screen` is its monitor id, or null for the primary
 * monitor. Null result: this monitor is off (the host shows no wallpaper window there).
 */
export function themeForScreen(settings: Settings, screen: string | null): ThemeId | null {
  if (!screen) return settings.theme;
  const v = settings.screenThemes[screen];
  if (v === 'off') return null;
  return v && v !== 'same' ? v : settings.theme;
}

/** Validates untrusted (stored or received) settings, filling gaps with defaults. */
export function normalizeSettings(input: unknown): Settings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(s.theme, THEME_IDS, d.theme),
    screenThemes: normalizeScreenThemes(s.screenThemes),
    themeParams: normalizeThemeParams(s.themeParams),
    palette: oneOf(s.palette, ['daybreak', 'lagoon', 'dusk', 'nocturne'] as const, d.palette),
    landReach: clamp(s.landReach, 0, 1, d.landReach),
    roughness: clamp(s.roughness, 0, 1, d.roughness),
    motion: clamp(s.motion, 0, 2, d.motion),
    fps: oneOf(s.fps, [15, 30, 60] as const, d.fps),
    contours: typeof s.contours === 'boolean' ? s.contours : d.contours,
    pauseOnFullscreen:
      typeof s.pauseOnFullscreen === 'boolean' ? s.pauseOnFullscreen : d.pauseOnFullscreen,
    autostart: typeof s.autostart === 'boolean' ? s.autostart : d.autostart,
    labelVeil: clamp(s.labelVeil, 0, 1, d.labelVeil),
    locale: oneOf(s.locale, ['auto', 'en'] as const, d.locale),
    trayOpens: oneOf(s.trayOpens, ['window', 'dock'] as const, d.trayOpens),
    hintSeen: typeof s.hintSeen === 'boolean' ? s.hintSeen : d.hintSeen,
    autoUpdate: typeof s.autoUpdate === 'boolean' ? s.autoUpdate : d.autoUpdate,
  };
}

/** Validates the host's monitor list. Drops malformed entries. */
export function parseScreens(input: unknown): ScreenInfo[] {
  if (!Array.isArray(input)) return [];
  const out: ScreenInfo[] = [];
  for (const r of input) {
    if (!r || typeof r !== 'object') continue;
    const { id, primary, x, y, w, h } = r as Record<string, unknown>;
    if (
      typeof id === 'string' &&
      SCREEN_ID.test(id) &&
      [x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))
    )
      out.push({
        id,
        primary: primary === true,
        x: x as number,
        y: y as number,
        w: w as number,
        h: h as number,
      });
  }
  return out;
}

/** Validates an icons payload coming from the host. Returns null if malformed. */
export function parseIconsPayload(input: unknown): IconsPayload | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Record<string, unknown>;
  const surface = p.surface as Record<string, unknown> | undefined;
  if (!surface || typeof surface.w !== 'number' || typeof surface.h !== 'number') return null;
  if (!Array.isArray(p.icons)) return null;
  const icons: PhysicalRect[] = [];
  for (const r of p.icons) {
    if (!r || typeof r !== 'object') continue;
    const { x, y, w, h } = r as Record<string, unknown>;
    if (
      [x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      (w as number) > 0 &&
      (h as number) > 0
    ) {
      icons.push({ x: x as number, y: y as number, w: w as number, h: h as number });
    }
  }
  return { visible: p.visible !== false, surface: { w: surface.w, h: surface.h }, icons };
}

const UPDATE_STATES: readonly UpdateState[] = [
  'idle',
  'checking',
  'uptodate',
  'available',
  'downloading',
  'ready',
  'error',
];

/** Validates an updater status coming from the host. Returns null if malformed. */
export function parseUpdatePayload(input: unknown): UpdatePayload | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Record<string, unknown>;
  if (!UPDATE_STATES.includes(p.state as UpdateState) || typeof p.current !== 'string') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    state: p.state as UpdateState,
    current: p.current,
    latest: typeof p.latest === 'string' ? p.latest : null,
    progress: num(p.progress),
    checkedAt: num(p.checkedAt),
  };
}
