import { demoLayout } from '@deskwall/engine/field';
import {
  HostEvent,
  type IconsPayload,
  normalizeSettings,
  type PausePayload,
  type PointerPayload,
  parseIconsPayload,
  type Settings,
  themeForScreen,
} from '@deskwall/protocol';
import { inApp, loadSettings, showHidden } from '../shared/host';
import { themeById } from '../shared/themes';
import { createLabelVeil } from './labelVeil';
import { createSurface, type Pointer, type Rect, type Surface } from './surface';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const iconLayer = document.getElementById('icons') as HTMLDivElement;
// `?embed` is used by the settings window preview: no HUD, no dragging.
const embed = params.has('embed');
// The settings window lays its own chrome over the preview: keep sample icons clear of it.
const inset = embed ? Math.max(0, Math.min(200, Number(params.get('inset')) || 0)) : 0;
// `?screen=DISPLAY2`: this window is on an extra monitor with its own theme choice.
const screen = params.get('screen');
/** Settings as this monitor sees them: its own theme in place of the primary one. */
const forScreen = (s: Settings): Settings => ({
  ...s,
  theme: themeForScreen(s, screen) ?? s.theme,
});

async function main() {
  let settings = forScreen(await loadSettings());
  let current = await createSurface(settings);
  document.documentElement.dataset.surface = current.kind;

  // Soft shade under the captions, shared by every theme; follows the same icon rects.
  const veil = createLabelVeil(canvas);
  const veilStrength = (s: Settings) => s.labelVeil * (themeById(s.theme).labelVeil ?? 0.6);
  veil.setStrength(veilStrength(settings));

  // What a new surface needs to catch up with. The host talks to this facade only.
  let lastIcons: readonly Rect[] = [];
  let lastPaused = false;
  let lastPointer: Pointer | null = null;
  const surface: Surface = {
    get kind() {
      return current.kind;
    },
    get frames() {
      return current.frames;
    },
    setIcons(icons) {
      lastIcons = icons;
      current.setIcons(icons);
      veil.setIcons(icons);
    },
    setSettings: (s) => current.setSettings(s),
    setPaused(p) {
      lastPaused = p;
      current.setPaused(p);
    },
    setPointer(p) {
      lastPointer = p;
      current.setPointer(p);
    },
  };
  (window as unknown as { deskwall: Surface }).deskwall = surface;
  // `?paused` starts the scene paused, as the host does while the settings window covers it.
  if (params.has('paused')) surface.setPaused(true);

  // Classic theme to classic theme: build the new one under the old one and swap when it has
  // drawn its first layout, so the desktop is never blank in between.
  let switching = 0;
  const swapTheme = async (next: Settings) => {
    const ticket = ++switching;
    const old = current;
    let fresh: Surface;
    try {
      fresh = await createSurface(next);
    } catch (err) {
      console.error('[deskwall] theme switch failed, reloading', err);
      location.reload();
      return;
    }
    fresh.setPaused(lastPaused);
    fresh.setIcons(lastIcons);
    fresh.setPointer(lastPointer);
    // A theme that never reports is not worth waiting for.
    await Promise.race([fresh.drawn, new Promise((r) => setTimeout(r, 4000))]);
    if (ticket !== switching) {
      fresh.dispose?.();
      return;
    }
    current = fresh;
    settings = next;
    document.documentElement.dataset.surface = fresh.kind;
    fresh.setSettings(next);
    veil.setStrength(veilStrength(next));
    // Slow fades inside a theme finish while the old one fades out.
    old.dispose?.(500);
  };

  const apply = (incoming: Settings) => {
    const next = forScreen(incoming);
    if (next.theme !== settings.theme) {
      void swapTheme(next);
      return;
    }
    settings = next;
    surface.setSettings(next);
    veil.setStrength(veilStrength(next));
  };

  if (inApp && !embed) {
    await connectHost(surface, apply);
  } else {
    runDemo(surface);
  }

  if (!embed && params.has('hud')) {
    const hud = document.createElement('div');
    hud.id = 'hud';
    document.body.append(hud);
    setInterval(() => {
      hud.textContent = `DeskWall · ${surface.kind} · ${surface.frames} frames`;
    }, 500);
  }

  // Browser preview: follow edits from the settings page (same profile or parent frame).
  window.addEventListener('storage', (e) => {
    if (e.key === 'deskwall.settings' && e.newValue)
      apply(normalizeSettings(JSON.parse(e.newValue), { hidden: showHidden }));
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.source === window) return;
    const msg = e.data as { type?: string; settings?: unknown };
    if (msg?.type === 'deskwall:settings')
      apply(normalizeSettings(msg.settings, { hidden: showHidden }));
  });
}

async function connectHost(surface: Surface, apply: (s: Settings) => void) {
  // Listen on this window only: a plain `listen` also receives events the host sends to the
  // wallpaper windows of the other monitors (their icons, cursor and pause).
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = getCurrentWebviewWindow();
  const listen = win.listen.bind(win);
  const { invoke } = await import('@tauri-apps/api/core');

  // Physical → CSS pixels. Measured from the surface, not taken from devicePixelRatio: a window
  // moved under the desktop onto a monitor with another scale (100% next to 150%) gets no DPI
  // change message, so its devicePixelRatio can stay at the old monitor's value.
  let k = window.devicePixelRatio || 1;
  await listen<IconsPayload>(HostEvent.Icons, ({ payload }) => {
    const p = parseIconsPayload(payload);
    if (!p) return;
    if (p.surface.w > 0 && innerWidth > 0) k = p.surface.w / innerWidth;
    const rects: Rect[] = p.visible
      ? p.icons.map((r) => ({ x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k }))
      : [];
    surface.setIcons(rects);
  });
  await listen<PausePayload>(HostEvent.Pause, ({ payload }) =>
    surface.setPaused(!!payload?.paused),
  );
  await listen(HostEvent.Settings, ({ payload }) =>
    apply(normalizeSettings(payload, { hidden: showHidden })),
  );
  await listen<PointerPayload>(HostEvent.Pointer, ({ payload }) => {
    surface.setPointer(
      payload?.inside ? { x: payload.x / k, y: payload.y / k, down: !!payload.down } : null,
    );
  });

  // Tell the host we're listening so it sends the current layout immediately.
  // Off Windows the host can't see desktop icons, so fall back to the demo.
  const reply = await invoke<{ native: boolean }>('wallpaper_ready', { backend: surface.kind });
  if (!reply.native) runDemo(surface);
}

/** Browser preview: sample icons you can drag around to watch the scenery reshape. */
function runDemo(surface: Surface) {
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
  const layout = () =>
    demoLayout(innerWidth - inset * 3, innerHeight - inset).map((r) => ({
      ...r,
      x: r.x + inset,
      y: r.y + inset,
    }));
  const rects = layout();
  const els: HTMLDivElement[] = [];

  const sync = () => surface.setIcons(rects);
  // In a browser the page gets real mouse events: pass them on like the host would.
  if (!embed) {
    let down = false;
    const send = (ev: PointerEvent) => surface.setPointer({ x: ev.clientX, y: ev.clientY, down });
    window.addEventListener('pointermove', send);
    window.addEventListener('pointerdown', (ev) => {
      down = true;
      send(ev);
    });
    window.addEventListener('pointerup', (ev) => {
      down = false;
      send(ev);
    });
    document.documentElement.addEventListener('pointerleave', () => surface.setPointer(null));
  }
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
        sync();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up, { once: true });
    });
  });
  sync();

  window.addEventListener('resize', () => {
    // Mutate in place so drag handlers keep pointing at the same rects.
    layout().forEach((next, i) => {
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
