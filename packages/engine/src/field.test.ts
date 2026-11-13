import { describe, expect, it } from 'vitest';
import {
  computeField,
  demoLayout,
  FIELD_RANGE,
  mixFields,
  reachPx,
  sampleField,
  smin,
} from './field';

describe('computeField', () => {
  it('is all water without icons', () => {
    const f = computeField([], 100, 50, { cell: 10, reach: 0.5 });
    expect(f.cols).toBe(11);
    expect(f.rows).toBe(6);
    expect(Array.from(f.data).every((v) => v === -FIELD_RANGE)).toBe(true);
  });

  it('raises land under icons and sinks it far away', () => {
    const icon = { x: 100, y: 100, w: 76, h: 96 };
    const f = computeField([icon], 800, 600, { cell: 4, reach: 0.5 });
    expect(sampleField(f, 138, 148)).toBeGreaterThan(reachPx(0.5));
    expect(sampleField(f, 700, 500)).toBe(-FIELD_RANGE);
  });

  it('coastline sits roughly `reach` pixels from the icon box', () => {
    const icon = { x: 200, y: 200, w: 80, h: 80 };
    const reach = 0.5;
    const f = computeField([icon], 800, 800, { cell: 2, reach });
    // Shrunk box right edge is x = 274; the coast should be near 274 + reach.
    const coastX = 274 + reachPx(reach);
    expect(sampleField(f, coastX - 6, 240)).toBeGreaterThan(0);
    expect(sampleField(f, coastX + 6, 240)).toBeLessThan(0);
  });

  it('merges neighbouring icons into one island', () => {
    const a = { x: 0, y: 0, w: 76, h: 96 };
    const b = { x: 76, y: 0, w: 76, h: 96 };
    const f = computeField([a, b], 400, 300, { cell: 4, reach: 0.3 });
    expect(sampleField(f, 76, 48)).toBeGreaterThan(0);
  });

  it('wider reach means more land', () => {
    const icons = demoLayout(1280, 720);
    const land = (r: number) =>
      Array.from(computeField(icons, 1280, 720, { cell: 16, reach: r }).data).filter((v) => v > 0)
        .length;
    expect(land(1)).toBeGreaterThan(land(0));
  });
});

describe('helpers', () => {
  it('smin is never above min', () => {
    for (const [a, b] of [
      [1, 2],
      [5, -3],
      [0, 0],
    ] as const)
      expect(smin(a, b, 10)).toBeLessThanOrEqual(Math.min(a, b));
  });

  it('mixFields interpolates', () => {
    const a = computeField([], 10, 10, { cell: 5, reach: 0 });
    const b = { ...a, data: a.data.map(() => 0) };
    expect(mixFields(a, b, 0.5)[0]).toBe(-FIELD_RANGE / 2);
  });
});
