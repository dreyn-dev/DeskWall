import {
  DEFAULT_SETTINGS,
  HostEvent,
  parseScreens,
  parseUpdatePayload,
  type ScreenInfo,
  type Settings,
  type UpdatePayload,
} from '@deskwall/protocol';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { inApp, loadSettings, loadSystemLocales, saveSettings } from '../shared/host';

/**
 * Settings UI variants (prototype, brand/DESIGN.md "Поверхности"):
 * - `window`: variant A, full-window live preview with a side panel (settings window).
 * - `dock`: variant B, a 400px panel docked to the right edge over the real wallpaper.
 */
export type UiMode = 'window' | 'dock';

export const uiMode: UiMode =
  new URLSearchParams(location.search).get('mode') === 'dock' ? 'dock' : 'window';

/** Opens the other variant through the host (or switches the URL in a browser). */
export async function openMode(mode: UiMode): Promise<void> {
  if (!inApp) {
    const url = new URL(location.href);
    if (mode === 'dock') url.searchParams.set('mode', 'dock');
    else url.searchParams.delete('mode');
    location.href = url.toString();
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_settings', { mode });
}

/** Caption-button actions for the custom title bar. No-ops in a browser. */
export async function windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void> {
  if (!inApp) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (action === 'minimize') await w.minimize();
  else if (action === 'maximize') await w.toggleMaximize();
  else await w.close();
}

/** Tracks whether this window is maximized (for the restore / maximize glyph). */
export function useMaximized(): boolean {
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!inApp) return;
    let off: (() => void) | undefined;
    let alive = true;
    import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      const sync = async () => alive && setMax(await w.isMaximized());
      await sync();
      off = await w.onResized(() => void sync());
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return max;
}

async function broadcast(settings: Settings, frame: HTMLIFrameElement | null) {
  frame?.contentWindow?.postMessage({ type: 'deskwall:settings', settings }, location.origin);
  if (!inApp) return;
  // To every window: one wallpaper per monitor, and the host (it adds or removes monitors).
  const { emit } = await import('@tauri-apps/api/event');
  await emit(HostEvent.Settings, settings);
}

async function applyAutostart(enabled: boolean) {
  if (!inApp) return;
  const autostart = await import('@tauri-apps/plugin-autostart');
  if (enabled !== (await autostart.isEnabled()))
    await (enabled ? autostart.enable() : autostart.disable());
}

/**
 * Settings state shared by both variants. Reloads from the store when the window regains focus,
 * so the window and the dock panel stay in step when the user switches between them.
 */
export function useSettings(frame?: { current: HTMLIFrameElement | null }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [systemLocales, setSystemLocales] = useState<readonly string[]>(navigator.languages);
  const [, startTransition] = useTransition();
  const latest = useRef<Settings | null>(null);
  latest.current = settings;

  useEffect(() => {
    loadSettings().then(setSettings);
    loadSystemLocales().then(setSystemLocales);
    const refresh = () => {
      loadSettings().then((s) => {
        const prev = latest.current;
        if (prev && JSON.stringify(prev) === JSON.stringify(s)) return;
        setSettings(s);
        frame?.current?.contentWindow?.postMessage(
          { type: 'deskwall:settings', settings: s },
          location.origin,
        );
      });
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [frame]);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      const prev = latest.current;
      if (!prev) return;
      const next = { ...prev, ...patch };
      latest.current = next;
      setSettings(next);
      startTransition(async () => {
        await saveSettings(next);
        await broadcast(next, frame?.current ?? null);
        if ('autostart' in patch) await applyAutostart(next.autostart);
      });
    },
    [frame],
  );

  const reset = useCallback(() => {
    const prev = latest.current;
    if (prev)
      update({
        ...DEFAULT_SETTINGS,
        autostart: prev.autostart,
        trayOpens: prev.trayOpens,
        hintSeen: prev.hintSeen,
      });
  }, [update]);

  return { settings, systemLocales, update, reset };
}

export interface LoadStats {
  cpu: number | null;
  gpu: number | null;
}

/** CPU / GPU load of DeskWall from the host, every 2 s while `enabled`. Null in a browser. */
export function useLoad(enabled: boolean): LoadStats | null {
  const [load, setLoad] = useState<LoadStats | null>(null);
  useEffect(() => {
    if (!inApp || !enabled) return;
    let alive = true;
    const tick = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const next = await invoke<LoadStats>('load_stats');
        if (alive) setLoad(next);
      } catch {
        // Older host or no counters: keep showing renderer and FPS only.
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);
  return load;
}

/** "CPU 4% · GPU 9%" or nothing when the host has no numbers yet. */
export function formatLoad(load: LoadStats | null): string {
  if (!load) return '';
  const parts: string[] = [];
  if (load.cpu !== null) parts.push(`CPU ${Math.round(load.cpu)}%`);
  if (load.gpu !== null) parts.push(`GPU ${Math.round(load.gpu)}%`);
  return parts.join(' · ');
}

/**
 * Hover / pressed state of the maximize button. The host draws Snap Layouts there, so mouse
 * events go to a native window instead of the page; the host reports them as an event.
 */
export function useCaptionState(): { hover: boolean; pressed: boolean } {
  const [state, setState] = useState({ hover: false, pressed: false });
  useEffect(() => {
    if (!inApp || uiMode !== 'window') return;
    let off: (() => void) | undefined;
    let alive = true;
    import('@tauri-apps/api/event').then(async ({ listen }) => {
      const un = await listen<{ hover: boolean; pressed: boolean }>(
        'deskwall://caption',
        ({ payload }) => setState({ hover: !!payload?.hover, pressed: !!payload?.pressed }),
      );
      if (alive) off = un;
      else un();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return state;
}

/** Keeps the desktop panel open on click-away (host side). */
export async function setDockPinned(pinned: boolean): Promise<void> {
  if (!inApp) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_dock_pinned', { pinned });
}

/**
 * The monitors, refreshed when the window regains focus (a monitor may have been plugged in).
 * Browser preview: none, unless `?screens=N` asks for N sample monitors.
 */
export function useScreens(): ScreenInfo[] {
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  useEffect(() => {
    if (!inApp) {
      const n = Math.min(4, Number(new URLSearchParams(location.search).get('screens')) || 0);
      setScreens(
        Array.from({ length: n }, (_, i) => ({
          id: `DISPLAY${i + 1}`,
          primary: i === 0,
          x: i * 1920,
          y: 0,
          w: i === 0 ? 3840 : 1920,
          h: i === 0 ? 2160 : 1080,
        })),
      );
      return;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const next = parseScreens(await invoke('list_screens'));
        if (alive)
          setScreens((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      } catch {
        // Older host: no per-monitor themes.
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return screens;
}

/** Updater status from the host, kept live through its event. Null in a browser. */
export function useUpdates(): {
  status: UpdatePayload | null;
  check: () => void;
  install: () => void;
} {
  const [status, setStatus] = useState<UpdatePayload | null>(null);
  useEffect(() => {
    if (!inApp) return;
    let off: (() => void) | undefined;
    let alive = true;
    (async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);
      const un = await listen<unknown>(HostEvent.Update, ({ payload }) => {
        const next = parseUpdatePayload(payload);
        if (next && alive) setStatus(next);
      });
      if (!alive) return un();
      off = un;
      try {
        const next = parseUpdatePayload(await invoke('update_status'));
        if (next && alive) setStatus((prev) => prev ?? next);
      } catch {
        // Older host: no updater block.
      }
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const call = useCallback(async (command: string) => {
    if (!inApp) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(command);
  }, []);
  return {
    status,
    check: () => void call('check_for_updates'),
    install: () => void call('install_update'),
  };
}
