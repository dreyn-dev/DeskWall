/**
 * Elevation field: turns icon rectangles into a smooth height map.
 * Positive values are land, negative are water; units are CSS pixels.
 * Pure and allocation-light so it can run on every icon change (and in tests).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldOptions {
  /** Grid cell size in CSS pixels. */
  cell: number;
  /** 0..1 — how far land reaches beyond the icon boxes. */
  reach: number;
}

export interface Field {
  cols: number;
  rows: number;
  cell: number;
  /** Row-major, row 0 is the top of the screen. Values are clamped to ±FIELD_RANGE. */
  data: Float32Array;
}

/** Elevation is clamped to this many CSS pixels in each direction. */
export const FIELD_RANGE = 128;

/** Signed distance from point to a rounded box centred at (cx, cy). */
function roundedBoxSdf(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  r: number,
) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Polynomial smooth minimum; blends neighbouring islands into one coastline. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Reach in CSS pixels for a 0..1 setting. */
export const reachPx = (reach: number) => 18 + reach * 70;

export function computeField(
  icons: readonly Rect[],
  width: number,
  height: number,
  opts: FieldOptions,
): Field {
  const cell = Math.max(2, opts.cell);
  const cols = Math.max(1, Math.ceil(width / cell) + 1);
  const rows = Math.max(1, Math.ceil(height / cell) + 1);
  const data = new Float32Array(cols * rows);
  const reach = reachPx(opts.reach);
  const blend = 36 + opts.reach * 40;

  if (icons.length === 0) {
    data.fill(-FIELD_RANGE);
    return { cols, rows, cell, data };
  }

  // Shrink icon boxes a little so labels sit on land, not on the very edge.
  const boxes = icons.map((r) => ({
    cx: r.x + r.w / 2,
    cy: r.y + r.h / 2,
    hw: Math.max(4, r.w / 2 - 6),
    hh: Math.max(4, r.h / 2 - 6),
    rad: Math.min(r.w, r.h) * 0.3,
  }));
  const cutoff = FIELD_RANGE + reach + blend;

  for (let j = 0; j < rows; j++) {
    const py = j * cell;
    for (let i = 0; i < cols; i++) {
      const px = i * cell;
      let d = Number.POSITIVE_INFINITY;
      for (const b of boxes) {
        // Cheap reject: far boxes cannot affect the clamped result.
        if (Math.abs(px - b.cx) - b.hw > cutoff || Math.abs(py - b.cy) - b.hh > cutoff) continue;
        const s = roundedBoxSdf(px, py, b.cx, b.cy, b.hw, b.hh, b.rad);
        d = d === Number.POSITIVE_INFINITY ? s : smin(d, s, blend);
      }
      const e = reach - d;
      data[j * cols + i] = Math.max(-FIELD_RANGE, Math.min(FIELD_RANGE, e));
    }
  }
  return { cols, rows, cell, data };
}

/** Linear blend of two fields of the same shape into `out`. */
export function mixFields(
  a: Field,
  b: Field,
  t: number,
  out: Float32Array = new Float32Array(a.data.length),
) {
  if (a.data.length !== b.data.length) return b.data.slice();
  for (let i = 0; i < out.length; i++)
    out[i] = (a.data[i] as number) + ((b.data[i] as number) - (a.data[i] as number)) * t;
  return out;
}

/** Sample a field at CSS pixel coordinates (bilinear). Used by tests and hit-testing. */
export function sampleField(f: Field, x: number, y: number): number {
  const fx = Math.min(Math.max(x / f.cell, 0), f.cols - 1);
  const fy = Math.min(Math.max(y / f.cell, 0), f.rows - 1);
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const i1 = Math.min(i0 + 1, f.cols - 1);
  const j1 = Math.min(j0 + 1, f.rows - 1);
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (i: number, j: number) => f.data[j * f.cols + i] as number;
  const top = at(i0, j0) + (at(i1, j0) - at(i0, j0)) * tx;
  const bottom = at(i0, j1) + (at(i1, j1) - at(i0, j1)) * tx;
  return top + (bottom - top) * ty;
}

/** Icon layout similar to a fresh Windows desktop, for previews and the browser demo. */
export function demoLayout(width: number, height: number): Rect[] {
  const cw = 76;
  const ch = 96;
  const icons: Rect[] = [];
  const perCol = Math.max(1, Math.floor((height - 48) / ch));
  for (let k = 0; k < Math.min(7, perCol); k++) icons.push({ x: 4, y: 4 + k * ch, w: cw, h: ch });
  for (let k = 0; k < Math.min(3, perCol); k++)
    icons.push({ x: 4 + cw, y: 4 + k * ch, w: cw, h: ch });
  const rx = Math.max(cw * 3, width - cw * 2 - 24);
  icons.push({ x: rx, y: 4, w: cw, h: ch }, { x: rx + cw, y: 4, w: cw, h: ch });
  const mx = Math.round(width * 0.55);
  const my = Math.round(height * 0.45);
  icons.push({ x: mx, y: my, w: cw, h: ch });
  return icons;
}
