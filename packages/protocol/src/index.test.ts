import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HIDDEN_THEME_IDS,
  normalizeSettings,
  parseIconsPayload,
  parseScreens,
  parseUpdatePayload,
  THEME_IDS,
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
      theme: 'ripples',
      themeParams: { ripples: { sigma: 90, x: 'a' }, nope: { a: 1 } },
    });
    expect(s.theme).toBe('ripples');
    expect(s.themeParams).toEqual({ ripples: { sigma: 90 } });
  });

  it('falls back to the default theme for removed themes', () => {
    expect(normalizeSettings({ theme: 'year' }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(normalizeSettings({ theme: 'forest' }).theme).toBe(DEFAULT_SETTINGS.theme);
    for (const old of ['beach', 'meadow', 'isles'])
      expect(normalizeSettings({ theme: old }).theme).toBe('mycelium');
    expect(
      normalizeSettings({ screenThemes: { DISPLAY2: 'meadow', DISPLAY3: 'stars' } }).screenThemes,
    ).toEqual({ DISPLAY3: 'stars' });
    expect(normalizeSettings({ themeParams: { forest: { a: 1 } } }).themeParams).toEqual({});
  });

  it('hides the themes set aside for rework unless asked', () => {
    for (const id of HIDDEN_THEME_IDS) {
      expect(THEME_IDS).not.toContain(id);
      const saved = { theme: id, screenThemes: { DISPLAY2: id }, themeParams: { [id]: { a: 1 } } };
      const s = normalizeSettings(saved);
      expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
      expect(s.screenThemes).toEqual({});
      // Their parameters survive, so the theme comes back as the user left it.
      expect(s.themeParams).toEqual({ [id]: { a: 1 } });
      expect(normalizeSettings(saved, { hidden: true })).toMatchObject({
        theme: id,
        screenThemes: { DISPLAY2: id },
      });
    }
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
      screenThemes: {
        DISPLAY2: 'stars',
        DISPLAY3: 'off',
        DISPLAY4: 'same',
        'bad id': 'stars',
        X: 1,
      },
    });
    expect(s.screenThemes).toEqual({ DISPLAY2: 'stars', DISPLAY3: 'off' });
    expect(normalizeSettings({}).screenThemes).toEqual({});
  });

  it('picks the theme for a monitor', () => {
    const s = normalizeSettings({
      theme: 'ripples',
      screenThemes: { DISPLAY2: 'stars', DISPLAY3: 'off' },
    });
    expect(themeForScreen(s, null)).toBe('ripples');
    expect(themeForScreen(s, 'DISPLAY2')).toBe('stars');
    expect(themeForScreen(s, 'DISPLAY3')).toBeNull();
    expect(themeForScreen(s, 'DISPLAY9')).toBe('ripples');
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

describe('updates', () => {
  it('defaults to automatic updates and rejects non-booleans', () => {
    expect(normalizeSettings({}).autoUpdate).toBe(true);
    expect(normalizeSettings({ autoUpdate: false }).autoUpdate).toBe(false);
    expect(normalizeSettings({ autoUpdate: 'no' }).autoUpdate).toBe(true);
  });

  it('parses the host update status', () => {
    expect(
      parseUpdatePayload({
        state: 'downloading',
        current: '0.1.0',
        latest: '0.2.0',
        progress: 40,
        checkedAt: 1700000000000,
      }),
    ).toEqual({
      state: 'downloading',
      current: '0.1.0',
      latest: '0.2.0',
      progress: 40,
      checkedAt: 1700000000000,
    });
    expect(parseUpdatePayload({ state: 'idle', current: '0.1.0' })).toEqual({
      state: 'idle',
      current: '0.1.0',
      latest: null,
      progress: null,
      checkedAt: null,
    });
    expect(parseUpdatePayload({ state: 'bogus', current: '0.1.0' })).toBeNull();
    expect(parseUpdatePayload(null)).toBeNull();
  });
});
