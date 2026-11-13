import { PALETTES } from '@deskwall/engine/palettes';
import { DEFAULT_SETTINGS, HostEvent, type PaletteId, type Settings } from '@deskwall/protocol';
import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { inApp, loadSettings, saveSettings } from '../shared/host';
import { resolveLang, STRINGS } from './i18n';

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

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [, startTransition] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const t = useMemo(() => STRINGS[resolveLang(settings?.locale ?? 'auto')], [settings?.locale]);

  if (!settings) return null;

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    startTransition(async () => {
      await saveSettings(next);
      await broadcast(next, frame.current);
      if ('autostart' in patch) await applyAutostart(next.autostart);
    });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-6">
      <header className="flex items-center gap-3">
        <img src="/brand/mark.svg" alt="" className="size-10" />
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-fog-300 text-sm">{t.tagline}</p>
        </div>
      </header>

      <section aria-label={t.preview} className="flex flex-col gap-2">
        <div className="relative aspect-video overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-xl shadow-black/40">
          <iframe
            ref={frame}
            title={t.preview}
            src={`/wallpaper.html?embed${new URLSearchParams(location.search).get('renderer') === 'webgl' ? '&renderer=webgl' : ''}`}
            className="pointer-events-none absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50 border-0"
          />
        </div>
        <p className="text-fog-300 text-xs">{t.previewHint}</p>
      </section>

      <Card title={t.palette}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(PALETTES) as PaletteId[]).map((id) => {
            const p = PALETTES[id];
            const active = settings.palette === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => update({ palette: id })}
                className={`group flex flex-col gap-2 rounded-xl p-2 text-left text-sm transition ${
                  active ? 'bg-ink-700 ring-2 ring-tide-500' : 'bg-ink-800 hover:bg-ink-700'
                }`}
              >
                <span
                  className="h-12 rounded-lg"
                  style={{
                    background: `radial-gradient(circle at 35% 45%, ${p.high} 0 14%, ${p.low} 15% 24%, ${p.sand} 25% 31%, ${p.shallow} 32% 50%, ${p.deep} 75%)`,
                  }}
                />
                {t.palettes[id]}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title={t.scenery}>
        <Slider
          label={t.landReach}
          value={settings.landReach}
          onChange={(v) => update({ landReach: v })}
        />
        <Slider
          label={t.roughness}
          value={settings.roughness}
          onChange={(v) => update({ roughness: v })}
        />
        <Slider
          label={t.motion}
          value={settings.motion}
          max={2}
          onChange={(v) => update({ motion: v })}
        />
        <Toggle
          label={t.contours}
          checked={settings.contours}
          onChange={(v) => update({ contours: v })}
        />
      </Card>

      <Card title={t.performance}>
        <Row label={t.fps}>
          <Segmented
            value={settings.fps}
            options={[15, 30, 60] as const}
            onChange={(fps) => update({ fps })}
            format={(v) => `${v}`}
          />
        </Row>
        <Toggle
          label={t.pauseOnFullscreen}
          checked={settings.pauseOnFullscreen}
          onChange={(v) => update({ pauseOnFullscreen: v })}
        />
      </Card>

      <Card title={t.system}>
        {inApp && (
          <Toggle
            label={t.autostart}
            checked={settings.autostart}
            onChange={(v) => update({ autostart: v })}
          />
        )}
        <Row label={t.language}>
          <Segmented
            value={settings.locale}
            options={['auto', 'en', 'ru'] as const}
            onChange={(locale) => update({ locale })}
            format={(v) => (v === 'auto' ? t.langAuto : v === 'en' ? 'English' : 'Русский')}
          />
        </Row>
      </Card>

      <footer className="text-fog-300 flex items-center justify-between pb-2 text-xs">
        <span>{inApp ? 'DeskWall 0.1.0 · GPL-3.0' : t.browserNote}</span>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 hover:bg-ink-800"
          onClick={() => update({ ...DEFAULT_SETTINGS, autostart: settings.autostart })}
        >
          {t.reset}
        </button>
      </footer>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-ink-900 flex flex-col gap-4 rounded-2xl p-5 ring-1 ring-white/5">
      <h2 className="text-fog-300 text-xs font-semibold tracking-wider uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  max = 1,
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="flex justify-between">
        {label}
        <span className="text-fog-300 tabular-nums">{Math.round((value / max) * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      {label}
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="bg-ink-700 checked:bg-tide-500 relative h-6 w-11 cursor-pointer appearance-none rounded-full transition before:absolute before:top-1 before:left-1 before:size-4 before:rounded-full before:bg-white before:transition checked:before:translate-x-5"
      />
    </label>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  format,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <div className="bg-ink-800 flex rounded-lg p-1">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={`rounded-md px-3 py-1 text-sm transition ${o === value ? 'bg-tide-500 text-ink-950 font-semibold' : 'hover:bg-ink-700'}`}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}
