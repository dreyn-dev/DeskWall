import type { ThemeId } from '@deskwall/protocol';

/**
 * "Living year": one world that changes with the date. Winter is the snowfield with small
 * thawed patches, spring the thaw that grows week by week, summer the meadow, autumn the light
 * wood (the Thaw page in its autumn mode).
 * Pure function of the date so it is easy to test; the wallpaper re-checks it every few minutes.
 */
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export const SEASONS: readonly Season[] = ['winter', 'spring', 'summer', 'autumn'];

export interface SeasonScene {
  season: Season;
  theme: Extract<ThemeId, 'thaw' | 'meadow' | 'forest'>;
  /** Overrides on top of that theme's own parameters. */
  params: Record<string, number>;
  /** Extra query for the theme page, e.g. `autumn` turns the Thaw page into the autumn wood. */
  query?: string;
}

export interface YearOptions {
  /** 0 = by date, 1..4 = always winter / spring / summer / autumn (to look at a season). */
  season?: number;
  /** Southern hemisphere: seasons shifted by half a year. */
  south?: number;
}

const DAY = 86_400_000;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (v: number, step: number) => Math.round(v / step) * step;

/** Season and how far into it (0..1) for a date. Months: Dec–Feb, Mar–Apr, May–Aug, Sep–Nov. */
export function seasonOf(date: Date, south = false): { season: Season; t: number } {
  const d = south ? new Date(date.getTime() + 182.5 * DAY) : date;
  const y = d.getFullYear();
  const m = d.getMonth();
  const span = (from: Date, to: Date) =>
    Math.min(1, Math.max(0, (d.getTime() - from.getTime()) / (to.getTime() - from.getTime())));
  if (m >= 2 && m <= 3) return { season: 'spring', t: span(new Date(y, 2, 1), new Date(y, 4, 1)) };
  if (m >= 4 && m <= 7) return { season: 'summer', t: span(new Date(y, 4, 1), new Date(y, 8, 1)) };
  if (m >= 8 && m <= 10)
    return { season: 'autumn', t: span(new Date(y, 8, 1), new Date(y, 11, 1)) };
  const from = m === 11 ? new Date(y, 11, 1) : new Date(y - 1, 11, 1);
  return { season: 'winter', t: span(from, new Date(from.getFullYear(), from.getMonth() + 3, 1)) };
}

export function seasonScene(date: Date, opts: YearOptions = {}): SeasonScene {
  const forced = Math.round(opts.season ?? 0);
  const { season, t } =
    forced >= 1 && forced <= 4
      ? { season: SEASONS[forced - 1] as Season, t: 0.5 }
      : seasonOf(date, opts.south === 1);
  switch (season) {
    case 'winter':
      // deep snow: small patches only right at the icons, no flowers yet, frequent flurries
      return { season, theme: 'thaw', params: { sigma: 66, bloom: 0, flakes: 1.2 } };
    case 'spring':
      // the patches widen and fill with flowers as spring goes on
      return {
        season,
        theme: 'thaw',
        params: {
          sigma: round(lerp(80, 150, t), 1),
          bloom: round(lerp(0.3, 1.3, t), 0.1),
          flakes: round(lerp(0.6, 0, t), 0.1),
        },
      };
    case 'summer':
      return { season, theme: 'meadow', params: {} };
    default:
      // the same ground as spring: straw-gold glades, leaf litter where the snow lies, light groves
      return {
        season,
        theme: 'thaw',
        query: 'autumn',
        params: { sigma: round(lerp(100, 115, t), 1), flakes: 0, bloom: 1 },
      };
  }
}
