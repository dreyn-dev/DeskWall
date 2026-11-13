import type { Settings } from '@deskwall/protocol';
import { type ThemeDef, themeById, themeValues } from '../shared/themes';

/** Icon rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whatever draws the wallpaper: the three.js engine or a classic theme page. */
export interface Surface {
  readonly kind: string;
  readonly frames: number;
  setIcons(icons: readonly Rect[]): void;
  setSettings(settings: Settings): void;
  setPaused(paused: boolean): void;
}

export async function createSurface(
  canvas: HTMLCanvasElement,
  settings: Settings,
  opts: { forceWebGL: boolean; embed: boolean },
): Promise<Surface> {
  const def = themeById(settings.theme);
  if (def.page) return createClassicSurface(def, settings);
  // Load three.js only when the engine theme is active.
  const { createScene } = await import('@deskwall/engine');
  const scene = await createScene({
    canvas,
    settings,
    forceWebGL: opts.forceWebGL,
    maxPixelRatio: opts.embed ? 1.5 : 2,
  });
  return {
    kind: scene.backend,
    get frames() {
      return scene.frames;
    },
    setIcons: (icons) => scene.setIcons(icons),
    setSettings: (s) => scene.setSettings(s),
    setPaused: (p) => scene.setPaused(p),
  };
}

type ThemeMessage =
  | { t: 'icons'; vis: boolean; r: [number, number, number, number][] }
  | { t: 'settings'; v: Record<string, number> }
  | { t: 'pause'; v: boolean };

/**
 * Classic themes (ported from Deskland) are self-contained WebGL2 pages. They run in a
 * same-origin iframe in "wallpaper" mode and receive the same messages their original host sent.
 */
function createClassicSurface(def: ThemeDef, settings: Settings): Surface {
  const frame = document.createElement('iframe');
  frame.title = def.name;
  frame.src = `${def.page}?wallpaper`;
  frame.className = 'theme-frame';
  frame.setAttribute('aria-hidden', 'true');
  document.body.prepend(frame);

  let ready = false;
  let icons: readonly Rect[] = [];
  let params = themeValues(def, settings.themeParams[def.id]);
  let paused = false;

  const send = (m: ThemeMessage) => {
    if (ready) frame.contentWindow?.postMessage(JSON.stringify(m), location.origin);
  };
  const sendIcons = () => {
    // The theme divides by its devicePixelRatio, which equals ours (same window).
    const k = window.devicePixelRatio || 1;
    send({
      t: 'icons',
      vis: true,
      r: icons.map((r) => [r.x * k, r.y * k, (r.x + r.w) * k, (r.y + r.h) * k]),
    });
  };
  const sendAll = () => {
    send({ t: 'settings', v: params });
    send({ t: 'pause', v: paused });
    sendIcons();
  };

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const m = typeof e.data === 'string' ? safeParse(e.data) : e.data;
    if (m && (m as { t?: string }).t === 'ready') {
      ready = true;
      sendAll();
    }
  });

  return {
    kind: `classic:${def.id}`,
    get frames() {
      return ready ? 1 : 0;
    },
    setIcons(next) {
      icons = next.map((r) => ({ ...r }));
      sendIcons();
    },
    setSettings(s) {
      params = themeValues(def, s.themeParams[def.id]);
      send({ t: 'settings', v: params });
    },
    setPaused(p) {
      paused = p;
      send({ t: 'pause', v: p });
    },
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
