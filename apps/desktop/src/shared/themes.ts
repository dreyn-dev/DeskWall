import type { ThemeId } from '@deskwall/protocol';

export interface ThemeParam {
  key: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** How to show the value. Toggles use `toggle` (0 / 1). */
  format: 'px' | 'percent' | 'times' | 'count' | 'plain' | 'toggle';
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  /** Thumbnail URL for the theme picker. */
  thumb: string;
  /** Classic themes run as self-contained WebGL2 pages hosted in an iframe. */
  page?: string;
  params: ThemeParam[];
}

/**
 * Beach and Meadow are ported from Deskland Preview (GPL-3.0, see NOTICE); parameter ranges and
 * defaults match the original `themes.json`. Isles runs on the DeskWall three.js engine.
 */
export const THEMES: ThemeDef[] = [
  {
    id: 'beach',
    name: 'Beach',
    description: 'The shoreline curves around your files and waves roll up the sand.',
    thumb: '/themes/classic/thumbs/beach.webp',
    page: '/themes/classic/beach.html',
    params: [
      {
        key: 'sigma',
        label: 'Distance to shore',
        min: 40,
        max: 200,
        step: 1,
        default: 85,
        format: 'px',
      },
      {
        key: 'warp',
        label: 'Winding coastline',
        min: 0,
        max: 80,
        step: 1,
        default: 34,
        format: 'plain',
      },
      {
        key: 'shoal',
        label: 'Clear shallows',
        min: 0,
        max: 300,
        step: 1,
        default: 110,
        format: 'px',
      },
      {
        key: 'shallow',
        label: 'Shallow sea width',
        min: 120,
        max: 700,
        step: 1,
        default: 260,
        format: 'px',
      },
      {
        key: 'palms',
        label: 'Palm trees',
        min: 0,
        max: 10,
        step: 1,
        default: 4,
        format: 'count',
      },
      {
        key: 'kayaks',
        label: 'Kayaks',
        min: 0,
        max: 4,
        step: 1,
        default: 2,
        format: 'count',
      },
      {
        key: 'birds',
        label: 'Seabirds',
        min: 0,
        max: 8,
        step: 1,
        default: 3,
        format: 'count',
      },
    ],
  },
  {
    id: 'meadow',
    name: 'Meadow',
    description: 'Ink-and-wash meadow. Icons rest on white clouds that cast deep green shadows.',
    thumb: '/themes/classic/thumbs/meadow.webp',
    page: '/themes/classic/meadow.html',
    params: [
      {
        key: 'sigma',
        label: 'Cloud size',
        min: 40,
        max: 200,
        step: 1,
        default: 72,
        format: 'px',
      },
      {
        key: 'cover',
        label: 'Clouds over the meadow',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.3,
        format: 'percent',
      },
      {
        key: 'flow',
        label: 'Drift speed',
        min: 0,
        max: 3,
        step: 0.05,
        default: 1,
        format: 'times',
      },
      {
        key: 'showBoy',
        label: 'Boy with a kite',
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'showCat',
        label: 'Little cat',
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
    ],
  },
  {
    id: 'isles',
    name: 'Isles',
    description: 'Paper-cut topographic islands. Runs on WebGPU.',
    thumb: '/themes/isles.webp',
    params: [],
  },
];

export const themeById = (id: ThemeId): ThemeDef =>
  THEMES.find((t) => t.id === id) ?? (THEMES[0] as ThemeDef);

/** Effective parameters for a classic theme: defaults overlaid with the user's values. */
export function themeValues(
  def: ThemeDef,
  stored: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) {
    const v = stored?.[p.key];
    out[p.key] = typeof v === 'number' ? Math.min(p.max, Math.max(p.min, v)) : p.default;
  }
  return out;
}
