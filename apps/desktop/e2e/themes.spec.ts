import { expect, type Page, test } from '@playwright/test';
import { sceneryScore } from './helpers';

// One cheap check per theme, no reference images. It guards what users actually hit:
//  - a theme that starts while the wallpaper is paused still shows its scenery;
//  - a running theme keeps animating (the picture changes over time);
//  - switching themes never leaves the desktop blank.
// The window is small on purpose: software WebGL on CI cost grows with the pixel count.
test.use({ viewport: { width: 640, height: 360 } });

const THEMES = [
  'beach',
  'meadow',
  'thaw',
  'zen',
  'mycelium',
  'ripples',
  'watercolor',
  'isles',
] as const;

const useTheme = (page: Page, theme: string) =>
  page.addInitScript(
    (t) => localStorage.setItem('deskwall.settings', JSON.stringify({ theme: t })),
    theme,
  );

const open = async (page: Page, theme: string, query = '') => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await useTheme(page, theme);
  await page.goto(`/wallpaper.html?renderer=webgl${query}`);
  await expect(page.locator('html')).toHaveAttribute(
    'data-surface',
    theme === 'isles' ? 'webgl2' : `classic:${theme}`,
  );
  // Score the scenery only: the sample icons and their captions are sharp edges too.
  await page.addStyleTag({ content: '#icons, .label-veil { display: none !important; }' });
  return errors;
};

// Lowest score a painted scene may have (about a third of what the theme really scores). An
// empty background or the few dots a paused Mycelium used to show stay well below it.
const PAINTED: Record<(typeof THEMES)[number], number> = {
  beach: 0.04,
  meadow: 0.025,
  thaw: 0.03,
  zen: 0.15,
  mycelium: 0.15,
  ripples: 0.03,
  watercolor: 0.02,
  isles: 0.06,
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
  await open(page, 'beach');
  await expect
    .poll(async () => sceneryScore(page, await page.screenshot()), { timeout: 20_000 })
    .toBeGreaterThan(PAINTED.beach);
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
  expect(Math.min(...scores)).toBeGreaterThan(PAINTED.beach);
});
