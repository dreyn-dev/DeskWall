import type { Settings } from '@deskwall/protocol';
import { type ThemeDef, themeById, themeValues } from '../shared/themes';
import { type SeasonScene, seasonScene } from '../shared/year';

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
  if (def.id === 'year') return createYearSurface(settings);
  if (def.page) return createClassicSurface(def, settings, (s) => s.themeParams[def.id]);
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

interface ClassicSurface extends Surface {
  readonly frame: HTMLIFrameElement;
  /** Resolves when the page has started and received its first messages. */
  readonly ready: Promise<void>;
  dispose(): void;
}

/**
 * Classic themes (ported from Deskland) are self-contained WebGL2 pages. They run in a
 * same-origin iframe in "wallpaper" mode and receive the same messages their original host sent.
 * `stored` picks the user's values for this page out of the settings (the Living year mixes its
 * season on top of them).
 */
function createClassicSurface(
  def: ThemeDef,
  settings: Settings,
  stored: (s: Settings) => Record<string, number> | undefined,
  insertAfter?: Element,
): ClassicSurface {
  const frame = document.createElement('iframe');
  frame.title = def.name.en;
  frame.src = `${def.page}?wallpaper`;
  frame.className = 'theme-frame';
  frame.setAttribute('aria-hidden', 'true');
  if (insertAfter) insertAfter.after(frame);
  else document.body.prepend(frame);

  let ready = false;
  let icons: readonly Rect[] = [];
  let params = themeValues(def, stored(settings));
  let paused = false;
  let markReady = () => {};
  const readyP = new Promise<void>((r) => {
    markReady = r;
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
    send({ t: 'settings', v: params });
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
  };
  window.addEventListener('message', onMessage);

  return {
    kind: `classic:${def.id}`,
    frame,
    ready: readyP,
    get frames() {
      return ready ? 1 : 0;
    },
    setIcons(next) {
      icons = next.map((r) => ({ ...r }));
      sendIcons();
    },
    setSettings(s) {
      params = themeValues(def, stored(s));
      send({ t: 'settings', v: params });
    },
    setPaused(p) {
      paused = p;
      send({ t: 'pause', v: p });
    },
    dispose() {
      window.removeEventListener('message', onMessage);
      frame.remove();
    },
  };
}

const CHECK_MS = 5 * 60_000;
const FADE_MS = 4000;

/**
 * Living year: shows the season's theme for today's date. When the season turns (or the user
 * picks another season to look at), the next theme starts underneath, grows its landscape, and
 * fades in over the old one.
 */
function createYearSurface(initial: Settings): Surface {
  let settings = initial;
  let icons: readonly Rect[] = [];
  let paused = false;
  const opts = (s: Settings) => s.themeParams.year ?? {};
  const sceneNow = () => seasonScene(new Date(), opts(settings));
  let scene: SeasonScene = sceneNow();

  // Each page reads its season's overrides through a holder, so spring can keep growing day by
  // day without reopening the page.
  type Season = { surf: ClassicSurface; sc: SeasonScene };
  const open = (sc: SeasonScene, after?: Element): Season => {
    const def = themeById(sc.theme);
    const h = { sc } as Season;
    h.surf = createClassicSurface(
      def,
      settings,
      (s) => ({ ...s.themeParams[def.id], ...h.sc.params }),
      after,
    );
    h.surf.setPaused(paused);
    h.surf.setIcons(icons);
    return h;
  };
  let curS = open(scene);
  let nextS: Season | null = null;

  const update = () => {
    const sc = sceneNow();
    if (nextS) return;
    if (sc.theme === scene.theme) {
      scene = sc;
      curS.sc = sc;
      curS.surf.setSettings(settings);
      return;
    }
    scene = sc;
    const inS = open(sc, curS.surf.frame);
    nextS = inS;
    const incoming = inS.surf;
    incoming.frame.style.opacity = '0';
    incoming.frame.style.transition = `opacity ${FADE_MS}ms ease`;
    void incoming.ready.then(() => {
      // let the new season grow its patches first, then cross-fade
      setTimeout(() => {
        incoming.frame.style.opacity = '1';
        setTimeout(() => {
          curS.surf.dispose();
          curS = inS;
          nextS = null;
        }, FADE_MS + 200);
      }, 2500);
    });
  };
  setInterval(update, CHECK_MS);

  const all = (fn: (s: ClassicSurface) => void) => {
    fn(curS.surf);
    if (nextS) fn(nextS.surf);
  };
  return {
    kind: 'year',
    get frames() {
      return curS.surf.frames;
    },
    setIcons(n) {
      icons = n.map((r) => ({ ...r }));
      all((s) => s.setIcons(icons));
    },
    setSettings(s) {
      settings = s;
      all((x) => x.setSettings(s));
      update();
    },
    setPaused(p) {
      paused = p;
      all((s) => s.setPaused(p));
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
