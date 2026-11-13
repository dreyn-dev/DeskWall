import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
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
