import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, parseIconsPayload } from './index';

describe('normalizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers and rejects unknown enums', () => {
    const s = normalizeSettings({ landReach: 4, motion: -1, fps: 144, palette: 'neon' });
    expect(s.landReach).toBe(1);
    expect(s.motion).toBe(0);
    expect(s.fps).toBe(30);
    expect(s.palette).toBe('lagoon');
  });

  it('keeps only numeric theme params of known themes', () => {
    const s = normalizeSettings({
      theme: 'meadow',
      themeParams: { meadow: { sigma: 90, x: 'a' }, nope: { a: 1 } },
    });
    expect(s.theme).toBe('meadow');
    expect(s.themeParams).toEqual({ meadow: { sigma: 90 } });
  });

  it('keeps valid values', () => {
    const s = normalizeSettings({ palette: 'dusk', fps: 60, contours: false });
    expect(s).toMatchObject({ palette: 'dusk', fps: 60, contours: false });
  });
});

describe('parseIconsPayload', () => {
  it('drops malformed rects', () => {
    const p = parseIconsPayload({
      visible: true,
      surface: { w: 1920, h: 1080 },
      icons: [{ x: 1, y: 2, w: 3, h: 4 }, { x: 'a' }, null, { x: 0, y: 0, w: 0, h: 10 }],
    });
    expect(p?.icons).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
  });

  it('rejects payloads without a surface', () => {
    expect(parseIconsPayload({ icons: [] })).toBeNull();
  });
});
