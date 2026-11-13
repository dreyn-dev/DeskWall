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

export type PauseReason = 'user' | 'fullscreen' | 'locked';

export interface PausePayload {
  paused: boolean;
  reasons: PauseReason[];
}

export type ThemeId = 'isles';
export type PaletteId = 'daybreak' | 'lagoon' | 'dusk' | 'nocturne';

export interface Settings {
  theme: ThemeId;
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
  locale: 'auto' | 'en' | 'ru';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'isles',
  palette: 'lagoon',
  landReach: 0.5,
  roughness: 0.5,
  motion: 1,
  fps: 30,
  contours: true,
  pauseOnFullscreen: true,
  autostart: false,
  locale: 'auto',
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const oneOf = <T extends string | number>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;

/** Validates untrusted (stored or received) settings, filling gaps with defaults. */
export function normalizeSettings(input: unknown): Settings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(s.theme, ['isles'] as const, d.theme),
    palette: oneOf(s.palette, ['daybreak', 'lagoon', 'dusk', 'nocturne'] as const, d.palette),
    landReach: clamp(s.landReach, 0, 1, d.landReach),
    roughness: clamp(s.roughness, 0, 1, d.roughness),
    motion: clamp(s.motion, 0, 2, d.motion),
    fps: oneOf(s.fps, [15, 30, 60] as const, d.fps),
    contours: typeof s.contours === 'boolean' ? s.contours : d.contours,
    pauseOnFullscreen:
      typeof s.pauseOnFullscreen === 'boolean' ? s.pauseOnFullscreen : d.pauseOnFullscreen,
    autostart: typeof s.autostart === 'boolean' ? s.autostart : d.autostart,
    locale: oneOf(s.locale, ['auto', 'en', 'ru'] as const, d.locale),
  };
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
