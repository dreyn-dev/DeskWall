/** UI languages. English only for now; "System" falls back to English. */
export type Lang = 'en';

const en = {
  title: 'DeskWall',
  tagline: 'A living landscape that grows around your desktop icons.',
  preview: 'Preview',
  previewHint: 'Sample icons. On your desktop the land follows your real icons.',
  theme: 'Theme',
  themeSettings: 'Theme settings',
  px: 'px',
  palette: 'Palette',
  palettes: { daybreak: 'Daybreak', lagoon: 'Lagoon', dusk: 'Dusk', nocturne: 'Nocturne' },
  scenery: 'Scenery',
  landReach: 'Land around icons',
  roughness: 'Coastline detail',
  motion: 'Motion speed',
  contours: 'Contour lines',
  performance: 'Performance',
  fps: 'Frame rate',
  pauseOnFullscreen: 'Pause when a window is full screen',
  system: 'System',
  autostart: 'Start with Windows',
  language: 'Language',
  langAuto: 'System',
  reset: 'Reset to defaults',
  renderer: 'Renderer',
  browserNote: 'Browser preview: settings are saved in this browser only.',
};

export const STRINGS = { en } as const;
export type Strings = typeof en;

export function resolveLang(_pref: 'auto' | Lang): Lang {
  return 'en';
}
