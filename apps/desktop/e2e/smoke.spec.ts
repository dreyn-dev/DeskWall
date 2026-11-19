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
  // Two full-canvas screenshots plus a drag cost 35-60 s on CI, where WebGL runs in software at
  // about 2 fps (each screenshot waits for stable frames). Give this test the slow-test budget.
  // Too slow for every pull request: CI runs it in the nightly full run (E2E_FULL=1).
  test.skip(!!process.env.CI && !process.env.E2E_FULL, 'full run only');
  test.slow();
  await useTheme(page, 'isles');
  await page.goto('/wallpaper.html?renderer=webgl');
  await expect.poll(() => frames(page)).toBeGreaterThan(5);
  const before = await page.locator('canvas#scene').screenshot();
  const icon = page.locator('.demo-icon').last();
  const box = await icon.boundingBox();
  if (!box) throw new Error('no icon');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + 120, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after = await page.locator('canvas#scene').screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
});

for (const theme of [
  'beach',
  'meadow',
  'thaw',
  'zen',
  'mycelium',
  'ripples',
  'isolines',
  'watercolor',
]) {
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

test('the cursor over the bare desktop reaches the theme page', async ({ page }) => {
  await useTheme(page, 'meadow');
  await page.goto('/wallpaper.html');
  await expect.poll(() => frames(page)).toBe(1);
  await page.waitForTimeout(500);
  await page.mouse.move(900, 500);
  await page.mouse.move(920, 510);
  const inner = page.frames().find((f) => f.url().includes('meadow.html'));
  if (!inner) throw new Error('no theme frame');
  await expect
    .poll(() =>
      inner.evaluate(() => (window as unknown as { __ptr: { in: boolean; x: number } }).__ptr),
    )
    .toMatchObject({ in: true, x: 920 });
});

test('a saved removed theme falls back to the default theme', async ({ page }) => {
  await useTheme(page, 'forest');
  await page.goto('/wallpaper.html');
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'classic:beach');
});

// Settings pages: skip the first-run hint unless a test is about it. Seeds storage only once,
// so reloads and navigations keep what the test saved.
const seenHint = (page: Page, extra: Record<string, unknown> = {}) =>
  page.addInitScript((x) => {
    if (!localStorage.getItem('deskwall.settings'))
      localStorage.setItem('deskwall.settings', JSON.stringify({ hintSeen: true, ...x }));
  }, extra);

test('first run shows a three-step hint once', async ({ page }) => {
  await page.goto('/?renderer=webgl');
  const hint = page.getByRole('dialog');
  await expect(hint).toContainText('Step 01 / 03');
  await expect(hint).toContainText('Pick a theme');
  await expect(page.getByRole('button', { name: /^Themes/ })).toHaveClass(/dw-spot/);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(hint).toContainText('Settings on the side');
  await expect(hint).toContainText('narrow strip on the right');
  await expect(page.getByRole('button', { name: /^Side panel/ })).toHaveClass(/dw-spot/);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(hint).toContainText('tray');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Themes/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('settings window (variant A) saves the chosen theme and palette', async ({ page }) => {
  await seenHint(page);
  await page.goto('/?renderer=webgl');
  await expect(page.locator('iframe[title="Preview"]')).toHaveCount(1);
  // Labelled entry points, no hidden menu.
  const themes = page.getByRole('button', { name: /^Themes/ });
  await expect(themes).toBeVisible();
  await expect(page.getByRole('button', { name: /^Settings/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Side panel/ })).toContainText(
    'narrow strip on the right',
  );
  await themes.click();
  const close = page.getByRole('button', { name: /^Close/ });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Daydream Meadow', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Daydream Meadow', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Drift Isles', exact: true }).click();
  await page.getByRole('button', { name: 'Dusk', exact: true }).click();
  // Esc closes the panel and returns focus to the Themes button.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Themes/ })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('button', { name: /Theme: Drift Isles/ })).toBeVisible();
  // Keyboard hint: T opens the theme list.
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Drift Isles', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Dusk', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('switching to the desktop panel remembers the mode for the tray', async ({ page }) => {
  await seenHint(page);
  await page.goto('/?renderer=webgl');
  await page.getByRole('button', { name: /^Side panel/ }).click();
  await expect(page).toHaveURL(/mode=dock/);
  await expect(page.getByRole('combobox', { name: 'Tray icon click opens' })).toHaveValue('dock');
  await page.getByRole('button', { name: /^Open the big window/ }).click();
  await expect(page).not.toHaveURL(/mode=dock/);
  await page.keyboard.press('s');
  await expect(page.getByRole('combobox', { name: 'Tray icon click opens' })).toHaveValue('window');
});

test('desktop panel (variant B) has no preview and shares settings', async ({ page }) => {
  await seenHint(page, { theme: 'thaw', fps: 60 });
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto('/?mode=dock');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('DeskWall · settings')).toBeVisible();
  await expect(page.getByRole('button', { name: 'First Thaw', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '60', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('auto');
  // Labelled header actions; the pin toggles.
  await expect(page.getByRole('button', { name: /^Open the big window/ })).toBeVisible();
  const pin = page.getByRole('button', { name: /^Pin/ });
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  // Nothing overflows the 400px panel sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('each extra monitor can have its own theme or none', async ({ page }) => {
  await seenHint(page, { theme: 'meadow' });
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto('/?mode=dock&screens=3');
  await expect(page.getByRole('heading', { name: 'Monitors' })).toBeVisible();
  await expect(page.getByText('Monitor 1 · main')).toBeVisible();
  const second = page.getByRole('combobox', { name: 'Monitor 2 · 1920×1080' });
  await expect(second).toHaveValue('same');
  await second.selectOption('zen');
  await page.getByRole('combobox', { name: 'Monitor 3 · 1920×1080' }).selectOption('off');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('deskwall.settings') ?? '{}').screenThemes,
      ),
    )
    .toEqual({ DISPLAY2: 'zen', DISPLAY3: 'off' });
  // Back to "same as main" drops the entry.
  await second.selectOption('same');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('deskwall.settings') ?? '{}').screenThemes,
      ),
    )
    .toEqual({ DISPLAY3: 'off' });
});

test('a wallpaper on an extra monitor shows that monitor theme', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'deskwall.settings',
      JSON.stringify({ theme: 'beach', screenThemes: { DISPLAY2: 'meadow' } }),
    ),
  );
  await page.goto('/wallpaper.html?screen=DISPLAY2');
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'classic:meadow');
  await page.goto('/wallpaper.html');
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'classic:beach');
});
