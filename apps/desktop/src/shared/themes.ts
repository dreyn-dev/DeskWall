import { DEFAULT_SETTINGS, type ThemeId } from '@deskwall/protocol';

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
  format: 'px' | 'percent' | 'times' | 'count' | 'plain' | 'toggle' | 'choice';
  /** Labels for `choice`: value i shows choices[i]. */
  choices?: L[];
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

/** Time-of-day controls shared by the classic pages. */
const clockParams = (hour: number): ThemeParam[] => [
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
    default: hour,
    format: 'plain',
  },
];

/**
 * How many click marks (rings, raked circles, waves) can be on screen at once. Every classic
 * theme has it, and every future theme with click effects must too: never hard-lock the count
 * (Mark, 2026-11-16). Pages size their arrays to 32 (`MAX_CLICKS` in classic/kit.js).
 */
const clickParams = (): ThemeParam[] => [
  {
    key: 'clicks',
    label: { en: 'Click marks at once', ru: 'Следов от кликов сразу' },
    hint: {
      en: 'How many rings or circles from clicks stay on screen together',
      ru: 'Сколько кругов от кликов может быть на экране одновременно',
    },
    min: 1,
    max: 32,
    step: 1,
    default: 16,
    format: 'count',
  },
];

/**
 * All themes are DeskWall's own self-contained classic pages on the shared `classic/kit.js`.
 * Beach, Meadow and Isles were removed on 2026-11-20 (too close to the Deskland originals).
 */
export const THEMES: ThemeDef[] = [
  {
    id: 'thaw',
    labelVeil: 1,
    name: { en: 'First Thaw', ru: 'Первая оттепель' },
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
        key: 'showBirds',
        label: { en: 'Birds', ru: 'Птицы' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      ...clockParams(16),
      ...clickParams(),
    ],
  },
  {
    id: 'zen',
    labelVeil: 0.6,
    name: { en: 'Still Stones', ru: 'Тихие камни' },
    description: {
      en: 'A dry garden of raked grey gravel. Icons rest on islands of moss; the rake circles them.',
      ru: 'Японский сад камней: серый гравий с бороздками, иконки на островках мха, грабли обходят их кругами.',
    },
    thumb: '/themes/classic/thumbs/zen.webp',
    page: '/themes/classic/zen.html',
    params: [
      {
        key: 'reach',
        label: { en: 'Moss around icons', ru: 'Мох вокруг иконок' },
        min: 10,
        max: 70,
        step: 1,
        default: 30,
        format: 'px',
      },
      {
        key: 'rings',
        label: { en: 'Rake circles', ru: 'Круги от грабель' },
        min: 1,
        max: 8,
        step: 1,
        default: 5,
        format: 'count',
      },
      {
        key: 'maple',
        label: { en: 'Maple', ru: 'Клён' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'leaves',
        label: { en: 'Falling leaves', ru: 'Падающие листья' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'birds',
        label: { en: 'Sparrow visits', ru: 'Воробей' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      ...clockParams(13),
      ...clickParams(),
    ],
  },
  {
    id: 'mycelium',
    labelVeil: 0.3,
    name: { en: 'Glowthread', ru: 'Светонить' },
    description: {
      en: 'A dark forest floor at night. Glowing threads of mycelium grow from the icons and join them into one net.',
      ru: 'Ночная лесная подстилка. От иконок растут светящиеся нити грибницы и соединяют их в одну сеть.',
    },
    thumb: '/themes/classic/thumbs/mycelium.webp',
    page: '/themes/classic/mycelium.html',
    params: [
      {
        key: 'density',
        label: { en: 'Threads', ru: 'Густота нитей' },
        min: 0.3,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'spread',
        label: { en: 'How far threads reach', ru: 'Как далеко тянутся нити' },
        min: 0.5,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'glow',
        label: { en: 'Glow', ru: 'Яркость свечения' },
        min: 0.3,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'colors',
        label: { en: 'Many colours', ru: 'Разные цвета' },
        hint: {
          en: 'Off: all threads glow teal',
          ru: 'Если выключить, все нити светятся бирюзовым',
        },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'pulses',
        label: { en: 'Sparks along threads', ru: 'Искры по нитям' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'spores',
        label: { en: 'Spores', ru: 'Споры' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      ...clickParams(),
    ],
  },
  {
    id: 'ripples',
    labelVeil: 0.3,
    name: { en: 'Dusk Ripples', ru: 'Круги на воде' },
    description: {
      en: 'Dusk water. Soft rings of light spread from the icons and join them into one set of waves.',
      ru: 'Сумеречная вода. От иконок расходятся мягкие круги света и соединяют их в одни волны.',
    },
    thumb: '/themes/classic/thumbs/ripples.webp',
    page: '/themes/classic/ripples.html',
    params: [
      {
        key: 'rings',
        label: { en: 'Ring spacing', ru: 'Расстояние между кругами' },
        min: 0.6,
        max: 1.8,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'reach',
        label: { en: 'How far rings spread', ru: 'Как далеко расходятся круги' },
        min: 0.5,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'glow',
        label: { en: 'Light', ru: 'Яркость света' },
        min: 0.3,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'drops',
        label: { en: 'Drops', ru: 'Капли' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'palette',
        label: { en: 'Water', ru: 'Вода' },
        min: 0,
        max: 3,
        step: 1,
        default: 0,
        format: 'choice',
        choices: [
          { en: 'Dusk', ru: 'Сумерки' },
          { en: 'Lagoon', ru: 'Лагуна' },
          { en: 'Dawn', ru: 'Рассвет' },
          { en: 'Ink night', ru: 'Тёмная ночь' },
        ],
      },
      ...clickParams(),
    ],
  },
  {
    id: 'isolines',
    labelVeil: 0.4,
    name: { en: 'Contour Map', ru: 'Изолинии' },
    description: {
      en: 'A calm topographic map. Contour lines run around your icons and join a row of them into one ridge.',
      ru: 'Спокойная карта высот. Линии уровня идут вокруг иконок и соединяют ряд иконок в один хребет.',
    },
    thumb: '/themes/classic/thumbs/isolines.webp',
    page: '/themes/classic/isolines.html',
    params: [
      {
        key: 'lines',
        label: { en: 'Contour density', ru: 'Частота линий' },
        min: 0.6,
        max: 1.6,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'reach',
        label: { en: 'How far the hills spread', ru: 'Как далеко расходятся холмы' },
        min: 0.5,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'glow',
        label: { en: 'Line brightness', ru: 'Яркость линий' },
        min: 0.4,
        max: 1.4,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'palette',
        label: { en: 'Map', ru: 'Карта' },
        min: 0,
        max: 3,
        step: 1,
        default: 0,
        format: 'choice',
        choices: [
          { en: 'Moss', ru: 'Мох' },
          { en: 'Deep sea', ru: 'Глубокое море' },
          { en: 'Paper', ru: 'Бумага' },
          { en: 'Plum dusk', ru: 'Сливовые сумерки' },
        ],
      },
      ...clickParams(),
    ],
  },
  {
    id: 'watercolor',
    labelVeil: 1,
    name: { en: 'Watercolor Wash', ru: 'Акварель' },
    description: {
      en: 'Light paper. Soft watercolor washes bloom from your icons and join them into one painted shape.',
      ru: 'Светлая бумага. От иконок расплывается акварель и соединяет их в одно нарисованное пятно.',
    },
    thumb: '/themes/classic/thumbs/watercolor.webp',
    page: '/themes/classic/watercolor.html',
    params: [
      {
        key: 'spread',
        label: { en: 'How far the wash spreads', ru: 'Как далеко расплывается краска' },
        min: 0.5,
        max: 1.8,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'depth',
        label: { en: 'Paint strength', ru: 'Насыщенность краски' },
        min: 0.5,
        max: 1.6,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'palette',
        label: { en: 'Paints', ru: 'Краски' },
        min: 0,
        max: 4,
        step: 1,
        default: 0,
        format: 'choice',
        choices: [
          { en: 'Sea', ru: 'Море' },
          { en: 'Blossom', ru: 'Цветение' },
          { en: 'Dusk', ru: 'Сумерки' },
          { en: 'Meadow', ru: 'Луг' },
          { en: 'Spectrum', ru: 'Спектр' },
        ],
      },
      {
        key: 'paper',
        label: { en: 'Canvas', ru: 'Холст' },
        min: 0,
        max: 5,
        step: 1,
        default: 0,
        format: 'choice',
        choices: [
          { en: 'Warm white', ru: 'Тёплый белый' },
          { en: 'Bright white', ru: 'Яркий белый' },
          { en: 'Cream', ru: 'Сливочный' },
          { en: 'Kraft', ru: 'Крафт' },
          { en: 'Cool grey', ru: 'Холодный серый' },
          { en: 'Blush', ru: 'Розовый' },
        ],
      },
      ...clickParams(),
    ],
  },
  {
    id: 'stars',
    labelVeil: 0.2,
    name: { en: 'Constellations', ru: 'Созвездия' },
    description: {
      en: 'A calm night sky. A soft nebula gathers around the icons and their stars join into constellations.',
      ru: 'Спокойное ночное небо. Вокруг иконок собирается туманность, а звёзды складываются в созвездия.',
    },
    thumb: '/themes/classic/thumbs/stars.webp',
    page: '/themes/classic/stars.html',
    params: [
      {
        key: 'nebula',
        label: { en: 'Nebula', ru: 'Туманность' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'stars',
        label: { en: 'Stars', ru: 'Сколько звёзд' },
        min: 0.3,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'lines',
        label: { en: 'Constellation lines', ru: 'Линии созвездий' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'palette',
        label: { en: 'Sky', ru: 'Небо' },
        min: 0,
        max: 3,
        step: 1,
        default: 0,
        format: 'choice',
        choices: [
          { en: 'Night blue', ru: 'Ночное синее' },
          { en: 'Violet haze', ru: 'Фиолетовая дымка' },
          { en: 'Aurora teal', ru: 'Бирюзовое' },
          { en: 'Ink', ru: 'Чернильное' },
        ],
      },
      ...clickParams(),
    ],
  },
  {
    id: 'frost',
    labelVeil: 0.3,
    name: { en: 'Window Frost', ru: 'Иней' },
    description: {
      en: 'A winter window at night. Frost ferns grow out of the icons and freeze each row into one rim.',
      ru: 'Зимнее окно ночью. От иконок растут морозные узоры, и ряд иконок замерзает одной кромкой.',
    },
    thumb: '/themes/classic/thumbs/frost.webp',
    page: '/themes/classic/frost.html',
    params: [
      {
        key: 'frost',
        label: { en: 'Frost length', ru: 'Длина узоров' },
        min: 0.4,
        max: 1.8,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'haze',
        label: { en: 'Haze on the glass', ru: 'Дымка на стекле' },
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
        format: 'times',
      },
      {
        key: 'glints',
        label: { en: 'Glints', ru: 'Блёстки' },
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        format: 'toggle',
      },
      {
        key: 'palette',
        label: { en: 'Glass', ru: 'Стекло' },
        min: 0,
        max: 3,
        step: 1,
        default: 0,
        format: 'choice',
        choices: [
          { en: 'Night', ru: 'Ночное' },
          { en: 'Dawn', ru: 'Рассвет' },
          { en: 'Silver', ru: 'Серебро' },
          { en: 'Deep teal', ru: 'Глубокое бирюзовое' },
        ],
      },
      ...clickParams(),
    ],
  },
];

export const themeById = (id: ThemeId): ThemeDef =>
  THEMES.find((t) => t.id === id) ??
  THEMES.find((t) => t.id === DEFAULT_SETTINGS.theme) ??
  (THEMES[0] as ThemeDef);

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
