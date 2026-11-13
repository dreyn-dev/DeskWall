import { createScene, demoLayout, type Rect } from '@deskwall/engine';
import {
  HostEvent,
  type IconsPayload,
  normalizeSettings,
  type PausePayload,
  parseIconsPayload,
} from '@deskwall/protocol';
import { inApp, loadSettings } from '../shared/host';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const iconLayer = document.getElementById('icons') as HTMLDivElement;
// `?embed` is used by the settings window preview: no HUD, no dragging.
const embed = params.has('embed');

async function main() {
  const settings = await loadSettings();
  const scene = await createScene({
    canvas,
    settings,
    forceWebGL: params.get('renderer') === 'webgl',
    maxPixelRatio: embed ? 1.5 : 2,
  });
  document.documentElement.dataset.backend = scene.backend;
  (window as unknown as { deskwall: unknown }).deskwall = scene;

  if (inApp && !embed) {
    await connectHost(scene);
  } else {
    runDemo(scene);
  }

  if (!embed && params.has('hud')) {
    const hud = document.createElement('div');
    hud.id = 'hud';
    document.body.append(hud);
    setInterval(() => {
      hud.textContent = `DeskWall · ${scene.backend} · ${scene.frames} frames`;
    }, 500);
  }

  // Settings preview in the same browser profile: follow edits live.
  window.addEventListener('storage', (e) => {
    if (e.key === 'deskwall.settings' && e.newValue)
      scene.setSettings(normalizeSettings(JSON.parse(e.newValue)));
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const msg = e.data as { type?: string; settings?: unknown };
    if (msg?.type === 'deskwall:settings') scene.setSettings(normalizeSettings(msg.settings));
  });
}

async function connectHost(scene: Awaited<ReturnType<typeof createScene>>) {
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');

  await listen<IconsPayload>(HostEvent.Icons, ({ payload }) => {
    const p = parseIconsPayload(payload);
    if (!p) return;
    const k = window.devicePixelRatio || 1;
    const rects: Rect[] = p.visible
      ? p.icons.map((r) => ({ x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k }))
      : [];
    scene.setIcons(rects);
  });
  await listen<PausePayload>(HostEvent.Pause, ({ payload }) => scene.setPaused(!!payload?.paused));
  await listen(HostEvent.Settings, ({ payload }) => scene.setSettings(normalizeSettings(payload)));

  // Tell the host we're listening so it sends the current layout immediately.
  // Off Windows the host can't see desktop icons, so fall back to the demo.
  const reply = await invoke<{ native: boolean }>('wallpaper_ready', { backend: scene.backend });
  if (!reply.native) runDemo(scene);
}

/** Browser preview: sample icons you can drag around to watch the land reshape. */
function runDemo(scene: Awaited<ReturnType<typeof createScene>>) {
  const names = [
    'This PC',
    'Projects',
    'Recycle Bin',
    'Notes.txt',
    'Photos',
    'Music',
    'Browser',
    'Mail',
    'Game',
    'Terminal',
    'Design',
    'Docs',
    'Inbox',
  ];
  const rects = demoLayout(innerWidth, innerHeight);
  const els: HTMLDivElement[] = [];

  const sync = () => scene.setIcons(rects);
  const place = (el: HTMLDivElement, r: Rect) => {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  rects.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'demo-icon';
    el.innerHTML = `<i></i><span>${names[i % names.length]}</span>`;
    place(el, r);
    iconLayer.append(el);
    els.push(el);
    if (embed) return;
    el.addEventListener('pointerdown', (ev) => {
      el.setPointerCapture(ev.pointerId);
      el.classList.add('dragging');
      const ox = ev.clientX - r.x;
      const oy = ev.clientY - r.y;
      const move = (m: PointerEvent) => {
        r.x = Math.round((m.clientX - ox) / 4) * 4;
        r.y = Math.round((m.clientY - oy) / 4) * 4;
        place(el, r);
        sync();
      };
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
    });
  });
  sync();

  window.addEventListener('resize', () => {
    // Mutate in place so drag handlers keep pointing at the same rects.
    demoLayout(innerWidth, innerHeight).forEach((next, i) => {
      const r = rects[i];
      const el = els[i];
      if (!r || !el) return;
      Object.assign(r, next);
      place(el, r);
    });
    sync();
  });
}

main().catch((err) => {
  console.error('[deskwall] wallpaper failed to start', err);
  document.body.dataset.error = String(err);
});
