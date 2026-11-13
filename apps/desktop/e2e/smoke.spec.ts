import { expect, type Page, test } from '@playwright/test';

// Headless Chromium can't capture WebGPU canvases, so the Isles tests pin the WebGL2 backend.
// Both backends run the same TSL shader.

const frames = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { deskwall?: { frames: number } }).deskwall?.frames ?? 0,
  );

const useTheme = (page: Page, theme: string) =>
  page.addInitScript(
    (t) => localStorage.setItem('deskwall.settings', JSON.stringify({ theme: t })),
    theme,
  );

test('isles renders the scene around demo icons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await useTheme(page, 'isles');
  await page.goto('/wallpaper.html?renderer=webgl');
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'webgl2');
  await expect(page.locator('.demo-icon')).toHaveCount(13);
  await expect.poll(() => frames(page)).toBeGreaterThan(5);
  const shot = await page.locator('canvas#scene').screenshot();
  expect(shot.byteLength).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test('dragging an icon reshapes the isles', async ({ page }) => {
  await useTheme(page, 'isles');
  await page.goto('/wallpaper.html?renderer=webgl');
  await expect.poll(() => frames(page)).toBeGreaterThan(5);
  const before = await page.locator('canvas#scene').screenshot();
  const icon = page.locator('.demo-icon').last();
  const box = await icon.boundingBox();
  if (!box) throw new Error('no icon');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after = await page.locator('canvas#scene').screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
});

for (const theme of ['beach', 'meadow', 'forest', 'thaw']) {
  test(`classic ${theme} theme starts and receives icons`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await useTheme(page, theme);
    await page.goto('/wallpaper.html');
    await expect(page.locator('html')).toHaveAttribute('data-surface', `classic:${theme}`);
    // The theme page answers `ready`, then gets the icon layout.
    await expect.poll(() => frames(page)).toBe(1);
    const frame = page.frameLocator('iframe.theme-frame');
    await expect(frame.locator('body.wall')).toHaveCount(1);
    await page.waitForTimeout(1500);
    const shot = await page.screenshot();
    expect(shot.byteLength).toBeGreaterThan(50_000);
    expect(errors).toEqual([]);
  });
}

test('living year shows a season page and switches seasons with a cross-fade', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'deskwall.settings',
      JSON.stringify({ theme: 'year', themeParams: { year: { season: 1 } } }),
    );
  });
  await page.goto('/wallpaper.html');
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'year');
  await expect(page.locator('iframe.theme-frame')).toHaveAttribute('src', /thaw\.html/);
  await expect.poll(() => frames(page)).toBe(1);
  // pick autumn: the forest page starts underneath, fades in, the thaw page goes away
  await page.evaluate(() => {
    const w = window as unknown as { deskwall: { setSettings(s: unknown): void } };
    w.deskwall.setSettings({ theme: 'year', labelVeil: 0.7, themeParams: { year: { season: 4 } } });
  });
  await expect(page.locator('iframe.theme-frame')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('iframe.theme-frame')).toHaveAttribute('src', /forest\.html/);
  expect(errors).toEqual([]);
});

test('settings page saves the chosen theme and palette', async ({ page }) => {
  await page.goto('/?renderer=webgl');
  await page.getByRole('button', { name: /Meadow|Луг/ }).click();
  await expect(page.getByRole('button', { name: /Meadow|Луг/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: /Isles|Острова/ }).click();
  await page.getByRole('button', { name: /Dusk|Закат/ }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /Isles|Острова/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: /Dusk|Закат/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
