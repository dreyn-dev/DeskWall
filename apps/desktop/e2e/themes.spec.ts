import { expect, type Page, test } from '@playwright/test';
import { sceneryScore } from './helpers';

// One cheap check per theme, no reference images. It guards what users actually hit:
//  - a theme that starts while the wallpaper is paused still shows its scenery;
//  - a running theme keeps animating (the picture changes over time);
//  - switching themes never leaves the desktop blank.
// The window is small on purpose: software WebGL on CI cost grows with the pixel count.
test.use({ viewport: { width: 640, height: 360 } });

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

const useTheme = (page: Page, theme: string) =>
  page.addInitScript(
    (t) =>
      localStorage.setItem(
        'deskwall.settings',
        // Ripples follows the clock by default; pin its water so the score does not depend on the hour.
        JSON.stringify({
          theme: t,
          themeParams: t === 'ripples' ? { ripples: { palette: 0 } } : {},
        }),
      ),
    theme,
  );

const open = async (page: Page, theme: string, query = '') => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await useTheme(page, theme);
  await page.goto(`/wallpaper.html?renderer=webgl${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-surface', `classic:${theme}`);
  // Score the scenery only: the sample icons and their captions are sharp edges too.
  await page.addStyleTag({ content: '#icons, .label-veil { display: none !important; }' });
  return errors;
};

// Lowest score a painted scene may have (about a third of what the theme really scores). An
// empty background or the few dots a paused Mycelium used to show stay well below it.
const PAINTED: Record<(typeof THEMES)[number], number> = {
  thaw: 0.03,
  zen: 0.15,
  mycelium: 0.15,
  ripples: 0.015, // rings reach less far on short screens (this window is 360 px tall)
  isolines: 0.03,
  watercolor: 0.02,
  stars: 0.02,
  frost: 0.02,
};

for (const theme of THEMES) {
  test(`${theme}: starting while paused still shows the scenery`, async ({ page }) => {
    const errors = await open(page, theme, '&paused');
    await expect
      .poll(async () => sceneryScore(page, await page.screenshot()), { timeout: 20_000 })
      .toBeGreaterThan(PAINTED[theme]);
    expect(errors).toEqual([]);
  });

  test(`${theme}: a running theme keeps animating`, async ({ page }) => {
    const errors = await open(page, theme);
    await expect
      .poll(async () => sceneryScore(page, await page.screenshot()), { timeout: 20_000 })
      .toBeGreaterThan(PAINTED[theme]);
    const a = await page.screenshot();
    await expect
      .poll(async () => Buffer.compare(a, await page.screenshot()), { timeout: 15_000 })
      .not.toBe(0);
    expect(errors).toEqual([]);
  });
}

test('switching between classic themes never shows an empty desktop', async ({ page }) => {
  await open(page, 'zen');
  await expect
    .poll(async () => sceneryScore(page, await page.screenshot()), { timeout: 20_000 })
    .toBeGreaterThan(PAINTED.zen);
  // Another tab of the same profile saves the new theme, like the settings window does.
  const other = await page.context().newPage();
  await other.goto('/robots.txt');
  await other.evaluate(() =>
    localStorage.setItem('deskwall.settings', JSON.stringify({ theme: 'mycelium' })),
  );
  const scores: number[] = [];
  for (let i = 0; i < 12; i++) {
    scores.push(await sceneryScore(page, await page.screenshot()));
    if ((await page.locator('html').getAttribute('data-surface')) === 'classic:mycelium') break;
  }
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'classic:mycelium', {
    timeout: 20_000,
  });
  // The old scenery stayed until the new one was ready.
  expect(Math.min(...scores)).toBeGreaterThan(PAINTED.zen);
});

// Regression (Watercolor, 2026-11-19): in a window whose field grid has an odd width, the field
// texture upload failed with INVALID_OPERATION (default 4-byte row alignment) and the whole sheet
// was painted. Every classic theme must run without WebGL errors at such a size.
for (const theme of THEMES) {
  test(`${theme}: no WebGL errors in an odd-sized window`, async ({ page }) => {
    const gl: string[] = [];
    page.on('console', (m) => {
      if (/INVALID_|GL_|WebGL:/.test(m.text()) && !/GPU stall/.test(m.text())) gl.push(m.text());
    });
    await page.setViewportSize({ width: 641, height: 361 });
    const errors = await open(page, theme);
    await page.waitForTimeout(1500);
    expect(gl).toEqual([]);
    expect(errors).toEqual([]);
  });
}

type Dbg = {
  P: { palette: number };
  leaf: { ph: number; on: boolean; dur: number; t: number; x: number; y: number };
  spawnLeaf(): void;
  click(x: number, y: number): void;
};
const dbg = <T>(page: Page, fn: (d: Dbg) => T) =>
  page.evaluate(`(${fn.toString()})(window.__dbg)`) as Promise<T>;

test('ripples: the leaf drifts in, a click near it pushes it away, the water follows the clock', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/themes/classic/ripples.html?seed=7&hour=23');
  await expect.poll(() => page.evaluate('typeof window.__dbg')).toBe('object');
  expect(await dbg(page, (d) => d.P.palette)).toBe(4); // by the clock is the default
  await dbg(page, (d) => {
    d.spawnLeaf();
    d.leaf.t = d.leaf.dur * 0.96;
  });
  await expect.poll(() => dbg(page, (d) => d.leaf.ph)).toBe(1);
  const { x, y } = await dbg(page, (d) => ({ x: d.leaf.x, y: d.leaf.y }));
  await page.evaluate(`window.__dbg.click(${x - 10}, ${y})`);
  await expect.poll(() => dbg(page, (d) => d.leaf.ph)).toBe(3);
  await expect.poll(() => dbg(page, (d) => d.leaf.on), { timeout: 10_000 }).toBe(false);
  expect(errors).toEqual([]);
});
