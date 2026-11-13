import { describe, expect, it } from 'vitest';
import { STRINGS } from './i18n';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('i18n', () => {
  it('has no empty strings', () => {
    expect(keys(STRINGS.en).length).toBeGreaterThan(10);
    for (const lang of Object.values(STRINGS)) {
      for (const v of Object.values(lang)) if (typeof v === 'string') expect(v.trim()).not.toBe('');
    }
  });
});
