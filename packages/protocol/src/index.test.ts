import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseIconsPayload,
  parseScreens,
  themeForScreen,
} from './index';

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
    expect(normalizeSettings({ labelVeil: 3 }).labelVeil).toBe(1);
    expect(normalizeSettings({ labelVeil: 'x' }).labelVeil).toBe(DEFAULT_SETTINGS.labelVeil);
  });

  it('keeps only numeric theme params of known themes', () => {
    const s = normalizeSettings({
      theme: 'meadow',
      themeParams: { meadow: { sigma: 90, x: 'a' }, nope: { a: 1 } },
    });
    expect(s.theme).toBe('meadow');
    expect(s.themeParams).toEqual({ meadow: { sigma: 90 } });
  });

  it('falls back to the default theme for removed themes', () => {
    expect(normalizeSettings({ theme: 'year' }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(normalizeSettings({ theme: 'forest' }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(normalizeSettings({ themeParams: { forest: { a: 1 } } }).themeParams).toEqual({});
  });

  it('reads the tray mode and the first-run flag', () => {
    expect(normalizeSettings({}).trayOpens).toBe('window');
    expect(normalizeSettings({ trayOpens: 'dock', hintSeen: true })).toMatchObject({
      trayOpens: 'dock',
      hintSeen: true,
    });
    expect(normalizeSettings({ trayOpens: 'panel' }).trayOpens).toBe('window');
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

describe('per-monitor themes', () => {
  it('keeps valid monitor ids and values only', () => {
    const s = normalizeSettings({
      screenThemes: { DISPLAY2: 'zen', DISPLAY3: 'off', DISPLAY4: 'same', 'bad id': 'beach', X: 1 },
    });
    expect(s.screenThemes).toEqual({ DISPLAY2: 'zen', DISPLAY3: 'off' });
    expect(normalizeSettings({}).screenThemes).toEqual({});
  });

  it('picks the theme for a monitor', () => {
    const s = normalizeSettings({
      theme: 'meadow',
      screenThemes: { DISPLAY2: 'zen', DISPLAY3: 'off' },
    });
    expect(themeForScreen(s, null)).toBe('meadow');
    expect(themeForScreen(s, 'DISPLAY2')).toBe('zen');
    expect(themeForScreen(s, 'DISPLAY3')).toBeNull();
    expect(themeForScreen(s, 'DISPLAY9')).toBe('meadow');
  });

  it('parses the host monitor list', () => {
    expect(
      parseScreens([
        { id: 'DISPLAY1', primary: true, x: 0, y: 0, w: 3840, h: 2160 },
        { id: 'DISPLAY2', x: 3840, y: 0, w: 1920, h: 1080 },
        { id: '../x', x: 0, y: 0, w: 1, h: 1 },
        null,
      ]),
    ).toEqual([
      { id: 'DISPLAY1', primary: true, x: 0, y: 0, w: 3840, h: 2160 },
      { id: 'DISPLAY2', primary: false, x: 3840, y: 0, w: 1920, h: 1080 },
    ]);
    expect(parseScreens('nope')).toEqual([]);
  });
});
