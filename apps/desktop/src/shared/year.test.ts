import { describe, expect, it } from 'vitest';
import { seasonOf, seasonScene } from './year';

describe('living year', () => {
  it('maps months to seasons', () => {
    expect(seasonOf(new Date(2026, 0, 15)).season).toBe('winter');
    expect(seasonOf(new Date(2026, 11, 20)).season).toBe('winter');
    expect(seasonOf(new Date(2026, 2, 1)).season).toBe('spring');
    expect(seasonOf(new Date(2026, 5, 10)).season).toBe('summer');
    expect(seasonOf(new Date(2026, 9, 10)).season).toBe('autumn');
  });

  it('shifts by half a year in the south', () => {
    expect(seasonOf(new Date(2026, 0, 15), true).season).toBe('summer');
    expect(seasonOf(new Date(2026, 6, 15), true).season).toBe('winter');
  });

  it('grows the thaw through spring', () => {
    const early = seasonScene(new Date(2026, 2, 3));
    const late = seasonScene(new Date(2026, 3, 28));
    expect(early.theme).toBe('thaw');
    expect(late.params.sigma ?? 0).toBeGreaterThan(early.params.sigma ?? 0);
    expect(late.params.bloom ?? 0).toBeGreaterThan(early.params.bloom ?? 0);
  });

  it('can be forced to a season', () => {
    expect(seasonScene(new Date(2026, 0, 1), { season: 3 }).theme).toBe('meadow');
    const autumn = seasonScene(new Date(2026, 0, 1), { season: 4 });
    expect(autumn.theme).toBe('thaw');
    expect(autumn.query).toBe('autumn');
    expect(seasonScene(new Date(2026, 6, 1), { season: 1 }).params.bloom).toBe(0);
  });
});
