import type { ThemeId } from '@deskwall/protocol';

type L = { en: string; ru: string };

export interface ThemeParam {
  key: string;
  label: L;
  hint?: L;
  min: number;
  max: number;
  step: number;
  default: number;
  /** How to show the value. Toggles use `toggle` (0 / 1). */
  format: 'px' | 'percent' | 'times' | 'count' | 'plain' | 'toggle';
}

export interface ThemeDef {
  id: ThemeId;
  name: L;
  description: L;
  /** Thumbnail URL for the theme picker. */
  thumb: string;
  /** Classic themes run as self-contained WebGL2 pages hosted in an iframe. */
  page?: string;
  params: ThemeParam[];
  /** How much shade captions need on this scenery (0..1, multiplied by Settings.labelVeil). */
  labelVeil?: number;
}

/**
 * Beach and Meadow are ported from Deskland Preview (GPL-3.0, see NOTICE); parameter ranges and
 * defaults match the original `themes.json`. Autumn Forest is DeskWall's own classic page, painted
 * procedurally. Isles runs on the DeskWall three.js engine.
 */
export const THEMES: ThemeDef[] = [
  {
    id: 'beach',
    labelVeil: 0.8,
    name: { en: 'Beach', ru: 'Пляж' },
    description: {
      en: 'The shoreline curves around your files and waves roll up the sand.',
      ru: 'Берег огибает ваши файлы, волны набегают на песок.',
    },
    thumb: '/themes/classic/thumbs/beach.webp',
    page: '/themes/classic/beach.html',
    params: [
      {
        key: 'sigma',
        label: { en: 'Distance to shore', ru: 'Расстояние до берега' },
        min: 40,
        max: 200,
        step: 1,
        default: 85,
        format: 'px',
      },
      {
        key: 'warp',
        label: { en: 'Winding coastline', ru: 'Извилистость берега' },
        min: 0,
        max: 80,
        step: 1,
        default: 34,
        format: 'plain',
      },
      {
        key: 'shoal',
        label: { en: 'Clear shallows', ru: 'Прозрачное мелководье' },
        min: 0,
        max: 300,
        step: 1,
        default: 110,
        format: 'px',
      },
      {
        key: 'shallow',
        label: { en: 'Shallow sea width', ru: 'Ширина мелкого моря' },
        min: 120,
        max: 700,
        step: 1,
        default: 260,
        format: 'px',
      },
      {
        key: 'palms',
        label: { en: 'Palm trees', ru: 'Пальмы' },
        min: 0,
        max: 10,
        step: 1,
        default: 4,
        format: 'count',
      },
      {
        key: 'kayaks',
        label: { en: 'Kayaks', ru: 'Каяки' },
        min: 0,
        max: 4,
        step: 1,
        default: 2,
        format: 'count',
      },
      {
        key: 'birds',
        label: { en: 'Seabirds', ru: 'Чайки' },
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
    labelVeil: 0.7,
    name: { en: 'Meadow', ru: 'Луг' },
    description: {
      en: 'Ink-and-wash meadow. Icons rest on white clouds that cast deep green shadows.',
      ru: 'Луг в технике тушь и акварель. Иконки лежат на белых облаках, а облака отбрасывают тень на траву.',
    },
    thumb: '/themes/classic/thumbs/meadow.webp',
    page: '/themes/classic/meadow.html',
    params: [
      {
        key: 'sigma',
        label: { en: 'Cloud size', ru: 'Размер облаков' },
        min: 40,
        max: 200,
        step: 1,
        default: 72,
        format: 'px',
      },
      {
        key: 'cover',
        label: { en: 'Clouds over the meadow', ru: 'Облака над лугом' },
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.3,
        format: 'percent',
      },
      {
        key: 'flow',
        label: { en: 'Drift speed', ru: 'Скорость облаков' },
        min: 0,
        max: 3,
        step: 0.05,
        default: 1,
        format: 'times',
      },
      {
        key: 'showBoy',
        label: { en: 'Boy with a kite', ru: 'Мальчик с воздушным змеем' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'showCat',
        label: { en: 'Little cat', ru: 'Котёнок' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
    ],
  },
  {
    id: 'forest',
    labelVeil: 0.35,
    name: { en: 'Autumn Forest', ru: 'Осенний лес' },
    description: {
      en: 'An autumn forest seen from above. Icons sit in sunlit clearings; a fox, squirrels and birds live around them.',
      ru: 'Осенний лес с высоты. Иконки стоят на солнечных полянах, вокруг живут лиса, белки и птицы.',
    },
    thumb: '/themes/classic/thumbs/forest.webp',
    page: '/themes/classic/forest.html',
    params: [
      {
        key: 'sigma',
        label: { en: 'Clearing size', ru: 'Размер полян' },
        min: 60,
        max: 200,
        step: 1,
        default: 105,
        format: 'px',
      },
      {
        key: 'leaves',
        label: { en: 'Falling leaves', ru: 'Листопад' },
        min: 0,
        max: 3,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'wind',
        label: { en: 'Wind', ru: 'Ветер' },
        min: 0,
        max: 3,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'showFox',
        label: { en: 'Fox', ru: 'Лиса' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'showSquirrels',
        label: { en: 'Squirrels', ru: 'Белки' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'showBirds',
        label: { en: 'Birds', ru: 'Птицы' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
    ],
  },
  {
    id: 'thaw',
    labelVeil: 1,
    name: { en: 'Thaw', ru: 'Проталины' },
    description: {
      en: 'A calm snowfield. Spring melts through around your icons: wet earth, first flowers, birds.',
      ru: 'Спокойное снежное поле. Вокруг иконок тает снег: влажная земля, первые цветы, птицы.',
    },
    thumb: '/themes/classic/thumbs/thaw.webp',
    page: '/themes/classic/thaw.html',
    params: [
      {
        key: 'sigma',
        label: { en: 'Thawed patch size', ru: 'Размер проталин' },
        min: 60,
        max: 200,
        step: 1,
        default: 108,
        format: 'px',
      },
      {
        key: 'bloom',
        label: { en: 'Flowers', ru: 'Цветы' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'flakes',
        label: { en: 'Snow flurries', ru: 'Снежинки' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 0.4,
        format: 'times',
      },
      {
        key: 'byClock',
        label: { en: 'Light follows the clock', ru: 'Время суток по часам' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'hour',
        label: { en: 'Fixed time of day (hour)', ru: 'Время суток, если не по часам' },
        min: 0,
        max: 24,
        step: 0.5,
        default: 16,
        format: 'plain',
      },
      {
        key: 'showBirds',
        label: { en: 'Birds', ru: 'Птицы' },
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
    labelVeil: 0.6,
    name: { en: 'Isles', ru: 'Острова' },
    description: {
      en: 'Paper-cut topographic islands. Runs on WebGPU.',
      ru: 'Острова как вырезанная из бумаги топокарта. Работает на WebGPU.',
    },
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
