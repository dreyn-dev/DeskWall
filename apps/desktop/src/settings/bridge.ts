import { DEFAULT_SETTINGS, HostEvent, type Settings } from '@deskwall/protocol';
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
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('wallpaper', HostEvent.Settings, settings);
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
    if (prev) update({ ...DEFAULT_SETTINGS, autostart: prev.autostart });
  }, [update]);

  return { settings, systemLocales, update, reset };
}
