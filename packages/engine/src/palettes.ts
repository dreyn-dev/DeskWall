import type { PaletteId } from '@deskwall/protocol';

/** Colors for the "Isles" theme: a paper-cut topographic map that grows around icons. */
export interface Palette {
  deep: string;
  shallow: string;
  foam: string;
  sand: string;
  low: string;
  high: string;
  peak: string;
  contour: string;
  /** Strength of drifting cloud shadows, 0..1. */
  shade: number;
  /** Glow on wave crests (bioluminescence at night). */
  glow: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  daybreak: {
    deep: '#3b6fa6',
    shallow: '#8fd3d9',
    foam: '#f4fbf8',
    sand: '#f1dcae',
    low: '#a8cf7a',
    high: '#6ea65b',
    peak: '#e9efe1',
    contour: '#2f4a3a',
    shade: 0.16,
    glow: '#ffffff',
  },
  lagoon: {
    deep: '#0f4c6e',
    shallow: '#33b5b0',
    foam: '#e8fff9',
    sand: '#efd9a7',
    low: '#7fbf6a',
    high: '#3f8b57',
    peak: '#cfe3c4',
    contour: '#123a2e',
    shade: 0.2,
    glow: '#d9fff6',
  },
  dusk: {
    deep: '#2b2458',
    shallow: '#b0618a',
    foam: '#ffe2d0',
    sand: '#f2b989',
    low: '#c9875f',
    high: '#8a4f5c',
    peak: '#f6d6c2',
    contour: '#2a1630',
    shade: 0.22,
    glow: '#ffd2b8',
  },
  nocturne: {
    deep: '#060d1f',
    shallow: '#123a5a',
    foam: '#6fe3ff',
    sand: '#3b4660',
    low: '#24405a',
    high: '#1a2c45',
    peak: '#5c6f94',
    contour: '#9fb7e8',
    shade: 0.1,
    glow: '#5ef0ff',
  },
};

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
