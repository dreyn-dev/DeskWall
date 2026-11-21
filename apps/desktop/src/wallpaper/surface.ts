import type { Settings } from '@deskwall/protocol';
import { type ThemeDef, themeById, themeValues } from '../shared/themes';

/** Icon rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whatever draws the wallpaper: a classic theme page in an iframe. */
export interface Surface {
  readonly kind: string;
  readonly frames: number;
  setIcons(icons: readonly Rect[]): void;
  setSettings(settings: Settings): void;
  setPaused(paused: boolean): void;
  /** Cursor over the empty desktop, CSS pixels; null when it left the desktop. */
  setPointer(p: Pointer | null): void;
  /** Classic themes: resolves once the first layout is on screen. Engine: absent. */
  readonly drawn?: Promise<void>;
  /** Removes the surface; `fadeMs` fades it out first. Absent on the engine surface. */
  dispose?(fadeMs?: number): void;
}

export interface Pointer {
  x: number;
  y: number;
  down: boolean;
}

export async function createSurface(settings: Settings): Promise<Surface> {
  const def = themeById(settings.theme);
  return createClassicSurface(def, settings, (s) => s.themeParams[def.id]);
}

type ThemeMessage =
  | { t: 'icons'; vis: boolean; r: [number, number, number, number][] }
  | { t: 'settings'; v: Record<string, number> }
  | { t: 'pause'; v: boolean }
  | { t: 'pointer'; in: boolean; x: number; y: number; down: boolean };

interface ClassicSurface extends Surface {
  readonly frame: HTMLIFrameElement;
  /** Resolves when the page has started and received its first messages. */
  readonly ready: Promise<void>;
  readonly drawn: Promise<void>;
  dispose(fadeMs?: number): void;
}

/**
 * Classic themes are DeskWall's own self-contained WebGL2 pages. They run in a
 * same-origin iframe in "wallpaper" mode and receive the same messages their original host sent.
 * `stored` picks the user's values for this page out of the settings.
 */
function createClassicSurface(
  def: ThemeDef,
  settings: Settings,
  stored: (s: Settings) => Record<string, number> | undefined,
  insertAfter?: Element,
): ClassicSurface {
  const frame = document.createElement('iframe');
  frame.title = def.name.en;
  // `wallpaper.html?stats` passes on to the theme: frame-time overlay in the dev build
  const stats = new URLSearchParams(location.search).has('stats') ? '&stats' : '';
  frame.src = `${def.page}?wallpaper${stats}`;
  frame.className = 'theme-frame';
  frame.setAttribute('aria-hidden', 'true');
  if (insertAfter) insertAfter.after(frame);
  else document.body.prepend(frame);

  let ready = false;
  let icons: readonly Rect[] = [];
  let params = themeValues(def, stored(settings));
  let paused = false;
  let fps = settings.fps;
  let markReady = () => {};
  const readyP = new Promise<void>((r) => {
    markReady = r;
  });
  let markDrawn = () => {};
  const drawnP = new Promise<void>((r) => {
    markDrawn = r;
  });

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
    send({ t: 'settings', v: { ...params, fps } });
    send({ t: 'pause', v: paused });
    sendIcons();
  };

  const onMessage = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const m = typeof e.data === 'string' ? safeParse(e.data) : e.data;
    if (m && (m as { t?: string }).t === 'ready') {
      ready = true;
      sendAll();
      markReady();
    }
    if (m && (m as { t?: string }).t === 'drawn') markDrawn();
  };
  window.addEventListener('message', onMessage);

  return {
    kind: `classic:${def.id}`,
    frame,
    ready: readyP,
    drawn: drawnP,
    get frames() {
      return ready ? 1 : 0;
    },
    setIcons(next) {
      icons = next.map((r) => ({ ...r }));
      sendIcons();
    },
    setSettings(s) {
      params = themeValues(def, stored(s));
      fps = s.fps;
      send({ t: 'settings', v: { ...params, fps } });
    },
    setPaused(p) {
      paused = p;
      send({ t: 'pause', v: p });
    },
    setPointer(p) {
      send(
        p
          ? { t: 'pointer', in: true, x: p.x, y: p.y, down: p.down }
          : { t: 'pointer', in: false, x: 0, y: 0, down: false },
      );
    },
    dispose(fadeMs = 0) {
      window.removeEventListener('message', onMessage);
      if (fadeMs > 0) {
        frame.style.transition = `opacity ${fadeMs}ms ease`;
        frame.style.opacity = '0';
        setTimeout(() => frame.remove(), fadeMs + 50);
      } else frame.remove();
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
