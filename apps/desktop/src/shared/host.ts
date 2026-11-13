import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@deskwall/protocol';
import { invoke, isTauri } from '@tauri-apps/api/core';

/** True inside the DeskWall desktop app, false in a plain browser (preview / tests). */
export const inApp = isTauri();

const STORE_FILE = 'settings.json';
const LOCAL_KEY = 'deskwall.settings';

/** Loads settings from the app store, or from localStorage in the browser preview. */
export async function loadSettings(): Promise<Settings> {
  if (inApp) {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(STORE_FILE, { defaults: {}, autoSave: true });
    return normalizeSettings(await store.get('settings'));
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (inApp) {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(STORE_FILE, { defaults: {}, autoSave: true });
    await store.set('settings', settings);
    return;
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: settings just won't persist.
  }
}

/** Windows display languages in the app (most preferred first), browser languages otherwise. */
export async function loadSystemLocales(): Promise<readonly string[]> {
  if (!inApp) return navigator.languages;
  try {
    return await invoke<string[]>('system_locales');
  } catch {
    return navigator.languages;
  }
}
