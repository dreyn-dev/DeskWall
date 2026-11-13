import { expect, type Page, test } from '@playwright/test';

// Headless Chromium can't capture WebGPU canvases, so e2e pins the WebGL2 backend.
// Both backends run the same TSL shader.

const frames = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { deskwall?: { frames: number } }).deskwall?.frames ?? 0,
  );

test('wallpaper renders the scene around demo icons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/wallpaper.html?renderer=webgl');
  await expect(page.locator('html')).toHaveAttribute('data-backend', 'webgl2');
  await expect(page.locator('.demo-icon')).toHaveCount(13);
  await expect.poll(() => frames(page)).toBeGreaterThan(5);

  // Land under the first icon, water in the open sea.
  const shot = await page.locator('canvas').screenshot();
  expect(shot.byteLength).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test('dragging an icon reshapes the land', async ({ page }) => {
  await page.goto('/wallpaper.html?renderer=webgl');
  await expect.poll(() => frames(page)).toBeGreaterThan(5);
  const before = await page.locator('canvas').screenshot();
  const icon = page.locator('.demo-icon').last();
  const box = await icon.boundingBox();
  if (!box) throw new Error('no icon');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after = await page.locator('canvas').screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
});

test('settings page saves the chosen palette', async ({ page }) => {
  await page.goto('/?renderer=webgl');
  await page.getByRole('button', { name: /Dusk|Закат/ }).click();
  await expect(page.getByRole('button', { name: /Dusk|Закат/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: /Dusk|Закат/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
