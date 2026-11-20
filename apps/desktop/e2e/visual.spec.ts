import fs from 'node:fs';
import path from 'node:path';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { APCAcontrast, sRGBtoY } from 'apca-w3';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// Measurable items of the quality checklist (docs/quality.md), heavy, so only in the nightly
// full run (E2E_FULL=1) or on demand (VISUAL=1):
//  1. each theme at Mark's sizes (2560x1440 at 100% and 4K = 2560x1440 at 150%) compared with a
//     reference: a 640x360 thumbnail of the whole screen plus a 512x512 crop at real device pixels
//     (detail at 100% and 4K crispness). References live in e2e/visual/; `UPDATE_VISUAL=1`
//     rewrites them after an intended change.
//  2. contrast of the white icon captions over the scenery behind them (APCA Lc).
// Frames are reproducible: a fixed clock (noon UTC, so day/night themes show day) drives Date,
// performance.now, timers and animation frames, and Math.random is seeded.
const RUN = !!(process.env.E2E_FULL || process.env.VISUAL);
const UPDATE = !!process.env.UPDATE_VISUAL;
const REF_DIR = path.join(import.meta.dirname, 'visual');

const THEMES = [
  'thaw',
  'zen',
  'mycelium',
  'ripples',
  'isolines',
  'watercolor',
  'stars',
  'frost',
] as const;
type Theme = (typeof THEMES)[number];

const SIZES = [
  { name: '2560', width: 2560, height: 1440, dpr: 1 },
  { name: '4k150', width: 2560, height: 1440, dpr: 1.5 },
] as const;

// How far the picture may drift from its reference (RGB distance 0..1.7 of a grid cell's mean
// colour): animation moves a little, a changed palette, a blank screen or a moved scene far more.
const MAX_MEAN = 0.04;
const MAX_CELL = 0.12;
// the 512 px detail crop is a small area, so one moving glint or drop weighs more there
const MAX_CELL_DETAIL = 0.22;

// Lowest APCA |Lc| a caption may have over its background (worst caption on screen). Windows
// draws captions white with a dark shadow, which carries the rest; values below these mean the
// scenery got brighter behind the labels. Set from the 2026-11-20 measurement, minus a margin.
const MIN_LC: Record<Theme, number> = {
  thaw: 40,
  zen: 55,
  mycelium: 65,
  ripples: 85,
  isolines: 75,
  watercolor: 58,
  stars: 85,
  frost: 80,
};

async function openTheme(context: BrowserContext, theme: Theme): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-06-15T12:00:00Z') });
  await page.addInitScript(() => {
    let a = 0x9e3779b9;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.addInitScript(
    (t) => localStorage.setItem('deskwall.settings', JSON.stringify({ theme: t })),
    theme,
  );
  // Paused, like a wallpaper under a full-screen app: the page fast-forwards its growth without
  // drawing, then draws the grown scene and settles for ~2.5 s at 10 fps. Far fewer frames than a
  // running theme, which matters with software WebGL at 4K.
  await page.goto('/wallpaper.html?renderer=webgl&paused');
  await expect(page.locator('html')).toHaveAttribute('data-surface', `classic:${theme}`);
  // assets load in real time (Thaw's textures and sprites) before the theme starts its clock
  await page.waitForLoadState('networkidle');
  // Some fades read the real time of the theme frame, so real time passes alongside the fake
  // clock; then wait until the picture stops changing (a theme can take a few seconds to grow in).
  let prev: number[][] | null = null;
  for (let i = 0; i < 24; i++) {
    await page.clock.runFor(500);
    await page.waitForTimeout(500);
    if (i < 8 || i % 2) continue;
    const now = cells(PNG.sync.read(await page.screenshot({ scale: 'css' })), 16, 9);
    if (prev && meanShift(prev, now) < 0.004) break;
    prev = now;
  }
  expect(errors).toEqual([]);
  return page;
}

/** Box-filter downscale of an RGBA image. */
function shrink(src: PNG, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  const fx = src.width / w;
  const fy = src.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * fy); sy < Math.floor((y + 1) * fy); sy++) {
        for (let sx = Math.floor(x * fx); sx < Math.floor((x + 1) * fx); sx++) {
          const i = (sy * src.width + sx) * 4;
          for (let k = 0; k < 4; k++) acc[k] = (acc[k] ?? 0) + (src.data[i + k] ?? 0);
          n++;
        }
      }
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out.data[o + k] = Math.round((acc[k] ?? 0) / Math.max(1, n));
    }
  }
  return out;
}

function crop(src: PNG, x0: number, y0: number, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x0, y0, w, h, 0, 0);
  return out;
}

/** Mean colour of each cell of a cols x rows grid, 0..1. */
function cells(img: PNG, cols: number, rows: number): number[][] {
  const out: number[][] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const acc = [0, 0, 0];
      let n = 0;
      for (
        let y = Math.floor((cy * img.height) / rows);
        y < Math.floor(((cy + 1) * img.height) / rows);
        y += 2
      ) {
        for (
          let x = Math.floor((cx * img.width) / cols);
          x < Math.floor(((cx + 1) * img.width) / cols);
          x += 2
        ) {
          const i = (y * img.width + x) * 4;
          for (let k = 0; k < 3; k++) acc[k] = (acc[k] ?? 0) + (img.data[i + k] ?? 0) / 255;
          n++;
        }
      }
      out.push(acc.map((v) => v / Math.max(1, n)));
    }
  }
  return out;
}

/** Share of pixels with a clear step to their right neighbour: how much fine detail there is. */
function sharpness(img: PNG): number {
  let edges = 0;
  let total = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width - 1; x++) {
      const i = (y * img.width + x) * 4;
      let d = 0;
      for (let k = 0; k < 3; k++)
        d += Math.abs((img.data[i + k] ?? 0) - (img.data[i + 4 + k] ?? 0));
      if (d > 30) edges++;
      total++;
    }
  }
  return edges / total;
}

/** Mean colour distance between two cell grids. */
function meanShift(a: number[][], b: number[][]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.hypot(...(a[i] ?? []).map((v, k) => v - (b[i]?.[k] ?? 0)));
  }
  return sum / a.length;
}

/**
 * Compares with the stored reference (written when missing or with UPDATE_VISUAL=1). The themes
 * keep moving (water, sparks, drifting lines), so this is not a pixel diff: it checks that the
 * picture has the same layout and colours (mean colour of a 16x9 grid) and, for the detail crop,
 * about as much fine detail (a blurred or pixelated 4K frame loses or gains a lot).
 */
function matchRef(
  name: string,
  img: PNG,
  info: { outputPath(n: string): string },
  detail: boolean,
) {
  const file = path.join(REF_DIR, `${name}.png`);
  if (UPDATE || !fs.existsSync(file)) {
    fs.mkdirSync(REF_DIR, { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(img));
    return;
  }
  const ref = PNG.sync.read(fs.readFileSync(file));
  expect([ref.width, ref.height], `${name}: size`).toEqual([img.width, img.height]);
  const a = cells(ref, 16, 9);
  const b = cells(img, 16, 9);
  const d = a
    .map((c, i) => Math.hypot(...c.map((v, k) => v - (b[i]?.[k] ?? 0))))
    .sort((p, q) => p - q);
  const mean = d.reduce((p, q) => p + q, 0) / d.length;
  const p95 = d[Math.floor(d.length * 0.95)] ?? 0;
  const sharp = detail ? sharpness(img) / Math.max(1e-4, sharpness(ref)) : 1;
  const maxCell = detail ? MAX_CELL_DETAIL : MAX_CELL;
  const ok = mean <= MAX_MEAN && p95 <= maxCell && sharp > 0.6 && sharp < 1.6;
  if (!ok) {
    const diff = new PNG({ width: img.width, height: img.height });
    pixelmatch(ref.data, img.data, diff.data, img.width, img.height, { threshold: 0.12 });
    fs.writeFileSync(info.outputPath(`${name}-actual.png`), PNG.sync.write(img));
    fs.writeFileSync(info.outputPath(`${name}-diff.png`), PNG.sync.write(diff));
  }
  console.log(
    `${name}: colour mean ${mean.toFixed(3)}, p95 ${p95.toFixed(3)}, detail x${sharp.toFixed(2)}`,
  );
  expect(mean, `${name}: mean colour change`).toBeLessThanOrEqual(MAX_MEAN);
  expect(p95, `${name}: colour change of the most changed cells`).toBeLessThanOrEqual(maxCell);
  expect(sharp, `${name}: fine detail compared with the reference`).toBeGreaterThan(0.6);
  expect(sharp, `${name}: fine detail compared with the reference`).toBeLessThan(1.6);
}

test.describe('quality checklist, measured', () => {
  test.skip(!RUN, 'heavy: runs nightly (E2E_FULL=1) or with VISUAL=1');
  test.setTimeout(300_000);

  for (const size of SIZES) {
    for (const theme of THEMES) {
      test(`${theme} at ${size.name}: looks like its reference`, async ({ browser }, info) => {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: size.dpr,
          timezoneId: 'UTC',
        });
        const page = await openTheme(context, theme);
        const shot = PNG.sync.read(await page.screenshot());
        matchRef(`${theme}-${size.name}-screen`, shrink(shot, 640, 360), info, false);
        matchRef(`${theme}-${size.name}-detail`, crop(shot, 0, 0, 512, 512), info, true);
        await context.close();
      });
    }
  }

  for (const theme of THEMES) {
    test(`${theme}: icon captions keep their contrast`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 2560, height: 1440 },
        timezoneId: 'UTC',
      });
      const page = await openTheme(context, theme);
      const boxes = await page.locator('.demo-icon span').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        }),
      );
      // the scenery (with the caption shade the wallpaper lays over it), without the captions
      await page.addStyleTag({ content: '#icons { visibility: hidden !important; }' });
      const shot = PNG.sync.read(await page.screenshot());
      const white = sRGBtoY([255, 255, 255]);
      const lcs = boxes.map((b) => {
        // the brightest tenth of the background behind the caption is what the text fights
        const ys: number[] = [];
        for (let y = b.y; y < b.y + b.h; y++) {
          for (let x = b.x; x < b.x + b.w; x++) {
            const i = (y * shot.width + x) * 4;
            ys.push(sRGBtoY([shot.data[i] ?? 0, shot.data[i + 1] ?? 0, shot.data[i + 2] ?? 0]));
          }
        }
        ys.sort((p, q) => p - q);
        return Math.abs(APCAcontrast(white, ys[Math.floor(ys.length * 0.9)] ?? 0));
      });
      const worst = Math.min(...lcs);
      console.log(
        `${theme}: caption contrast APCA Lc worst ${worst.toFixed(1)}, median ${lcs.sort((p, q) => p - q)[lcs.length >> 1]?.toFixed(1)}`,
      );
      expect(worst).toBeGreaterThanOrEqual(MIN_LC[theme]);
      await context.close();
    });
  }
});
