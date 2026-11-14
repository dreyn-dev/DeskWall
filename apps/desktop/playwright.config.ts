import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // CI runners render WebGL in software (about 2 fps) and run the suite about 3x slower than a
  // dev machine, and the settings page keeps a live wallpaper preview running.
  timeout: process.env.CI ? 120_000 : 60_000,
  // CI runners render WebGL in software at a few frames per second; give frame polls headroom.
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:5190',
    viewport: { width: 1280, height: 720 },
    // Optional: point at a preinstalled Chromium instead of running `playwright install`.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'pnpm vite preview --port 5190 --strictPort',
    url: 'http://localhost:5190/wallpaper.html',
    reuseExistingServer: !process.env.CI,
  },
});
