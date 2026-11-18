// CPU cost of every theme: share of one core used by each browser process type while the scene runs.
//   pnpm build && pnpm perf:cpu [--size=2560x1440] [--fps=30] [--themes=beach,zen] [--secs=8]
// Rows: idle (nothing moves) and pointer (cursor sweeps the desktop). cpu = percent of ONE core.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const [VW, VH] = arg('size', '2560x1440').split('x').map(Number);
const FPS = Number(arg('fps', 30));
const SECS = Number(arg('secs', 8));
const THEMES = arg('themes', 'beach,meadow,thaw,zen,mycelium,ripples,isolines,isles').split(',');
const PORT = 5193;
const budget = Number(arg('budget', 0)); // percent of one core, total; 0 = report only

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
const cdp = await browser.newBrowserCDPSession();
const snap = async () => {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const o = { renderer: 0, gpu: 0, browser: 0 };
  for (const p of processInfo) {
    const k =
      p.type === 'renderer'
        ? 'renderer'
        : p.type === 'GPU'
          ? 'gpu'
          : p.type === 'browser'
            ? 'browser'
            : null;
    if (k) o[k] += p.cpuTime;
  }
  return o;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.addInitScript(
    ([t, f]) => localStorage.setItem('deskwall.settings', JSON.stringify({ theme: t, fps: f })),
    [theme, FPS],
  );
  await page.goto(`${base}/wallpaper.html`);
  await page
    .waitForFunction(() => window.deskwall && window.deskwall.frames > 2, null, { timeout: 30_000 })
    .catch(() => {});
  await sleep(3000); // settle: intro growth, shader compile
  const row = { theme };
  for (const mode of ['idle', 'pointer']) {
    const a = await snap();
    const t0 = Date.now();
    if (mode === 'idle') await sleep(SECS * 1000);
    else {
      let k = 0;
      while (Date.now() - t0 < SECS * 1000) {
        k += 0.06;
        await page.mouse.move(
          VW / 2 + Math.cos(k) * VW * 0.3,
          VH / 2 + Math.sin(k * 1.3) * VH * 0.3,
        );
        await sleep(16);
      }
    }
    const dt = (Date.now() - t0) / 1000,
      b = await snap();
    const pc = (k) => Math.round(((b[k] - a[k]) / dt) * 100);
    row[`${mode}:page`] = pc('renderer');
    row[`${mode}:gpu`] = pc('gpu');
    row[`${mode}:total`] = pc('renderer') + pc('gpu') + pc('browser');
  }
  rows.push(row);
  await page.close();
}
await browser.close();
server.kill();
console.log(`viewport ${VW}x${VH}, fps setting ${FPS}, ${SECS}s per mode; percent of one core`);
console.table(rows);
if (budget) {
  const bad = rows.filter((r) => r['idle:total'] > budget || r['pointer:total'] > budget);
  if (bad.length) {
    console.error(`Over CPU budget ${budget}%: ${bad.map((r) => r.theme).join(', ')}`);
    process.exitCode = 1;
  }
}
