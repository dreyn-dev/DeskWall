import { describe, expect, it } from 'vitest';
import { resolveLang, STRINGS } from './i18n';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('i18n', () => {
  it('ru and en have the same keys and no empty strings', () => {
    expect(keys(STRINGS.ru).sort()).toEqual(keys(STRINGS.en).sort());
    for (const lang of Object.values(STRINGS)) {
      for (const v of Object.values(lang)) if (typeof v === 'string') expect(v.trim()).not.toBe('');
    }
  });

  it('uses Russian only through System on a Russian Windows', () => {
    expect(resolveLang('auto', ['ru-RU', 'en-US'])).toBe('ru');
    expect(resolveLang('auto', ['en-US', 'ru-RU'])).toBe('en');
    expect(resolveLang('auto', [])).toBe('en');
    expect(resolveLang('en', ['ru-RU'])).toBe('en');
  });
});
