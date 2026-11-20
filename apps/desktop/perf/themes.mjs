// Speed check for every theme: time until the first layout is on screen and the worst frame gap (stalls).
// Run it on a PC with a real GPU (software WebGL on CI is far slower and would only be noise):
//   pnpm build && pnpm perf            (needs Chrome or Edge installed, or PW_CHROMIUM_PATH)
// Budgets: start in 1500 ms, no frame gap over 100 ms. Exit code 1 when a theme is over budget.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const THEMES = ['thaw', 'zen', 'mycelium', 'ripples', 'isolines', 'watercolor', 'stars', 'frost'];
const START_MS = 1500;
const WORST_FRAME_MS = 100;
const PORT = 5192;

const server = spawn('pnpm', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: true,
});
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${base}/wallpaper.html`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const exe = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(
  exe ? { executablePath: exe } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome' },
);
const rows = [];
for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript((t) => {
    localStorage.setItem('deskwall.settings', JSON.stringify({ theme: t }));
    window.__t0 = performance.now();
    window.addEventListener('message', (e) => {
      if (typeof e.data === 'string' && e.data.includes('"drawn"'))
        window.__drawn ??= performance.now();
    });
  }, theme);
  await page.goto(`${base}/wallpaper.html`);
  await page.waitForFunction(
    () => window.__drawn || (window.deskwall && window.deskwall.frames > 2),
    null,
    { timeout: 30_000 },
  );
  const startMs = await page.evaluate(() =>
    Math.round((window.__drawn ?? performance.now()) - window.__t0),
  );
  // Worst gap between two presented frames over 3 s: stalls show up here, not in the average.
  const worstFrameMs = await page.evaluate(
    () =>
      new Promise((res) => {
        let worst = 0;
        let prev = performance.now();
        const t0 = prev;
        const tick = (now) => {
          worst = Math.max(worst, now - prev);
          prev = now;
          if (now - t0 < 3000) requestAnimationFrame(tick);
          else res(Math.round(worst));
        };
        requestAnimationFrame(tick);
      }),
  );
  rows.push({ theme, startMs, worstFrameMs });
  await page.close();
}
await browser.close();
server.kill();
console.table(rows);
const bad = rows.filter((r) => r.startMs > START_MS || r.worstFrameMs > WORST_FRAME_MS);
if (bad.length) {
  console.error(
    `Over budget (start > ${START_MS} ms or a frame gap > ${WORST_FRAME_MS} ms): ${bad.map((r) => r.theme).join(', ')}`,
  );
  process.exitCode = 1;
}
