export type Lang = 'en' | 'ru';

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

const ru: typeof en = {
  title: 'DeskWall',
  tagline: 'Живой пейзаж, который вырастает вокруг иконок на рабочем столе.',
  preview: 'Предпросмотр',
  previewHint: 'Иконки для примера. На рабочем столе суша следует за вашими настоящими иконками.',
  theme: 'Тема',
  themeSettings: 'Настройки темы',
  px: 'пикс.',
  palette: 'Палитра',
  palettes: { daybreak: 'Рассвет', lagoon: 'Лагуна', dusk: 'Закат', nocturne: 'Ночь' },
  scenery: 'Пейзаж',
  landReach: 'Суша вокруг иконок',
  roughness: 'Изрезанность берега',
  motion: 'Скорость движения',
  contours: 'Линии рельефа',
  performance: 'Производительность',
  fps: 'Частота кадров',
  pauseOnFullscreen: 'Пауза, когда окно на весь экран',
  system: 'Система',
  autostart: 'Запускать вместе с Windows',
  language: 'Язык',
  langAuto: 'Системный',
  reset: 'Сбросить настройки',
  renderer: 'Рендер',
  browserNote: 'Предпросмотр в браузере: настройки хранятся только в этом браузере.',
};

export const STRINGS = { en, ru } as const;
export type Strings = typeof en;

/**
 * Picks the UI language. Russian has no manual choice: it is used only with "System" when the
 * Windows display language (first preferred locale) is Russian.
 */
export function resolveLang(pref: 'auto' | 'en', systemLocales: readonly string[]): Lang {
  if (pref === 'en') return 'en';
  return systemLocales[0]?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
