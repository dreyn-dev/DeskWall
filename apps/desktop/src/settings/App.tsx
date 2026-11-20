import type { Settings } from '@deskwall/protocol';
import {
  AppWindow,
  Palette,
  Pause,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveSettings, showHidden } from '../shared/host';
import { THEMES, themeById } from '../shared/themes';
import {
  formatLoad,
  type LoadStats,
  openMode,
  setDockPinned,
  type UiMode,
  uiMode,
  useLoad,
  useSettings,
  windowAction,
} from './bridge';
import { pad2 } from './format';
import { resolveLang, STRINGS, type Strings } from './i18n';
import { PanelContent } from './Panel';
import { TitleBar } from './TitleBar';
import { Disc, Kbd, Pill } from './ui';

const ICON = { size: 16, strokeWidth: 1.5 } as const;

export function App() {
  return uiMode === 'dock' ? <DockView /> : <WindowView />;
}

function useLang(pref: 'auto' | 'en' | undefined, systemLocales: readonly string[]) {
  const lang = resolveLang(pref ?? 'auto', systemLocales);
  const t = useMemo(() => STRINGS[lang], [lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return { lang, t };
}

/**
 * Switches to the other variant and remembers it for the next tray click. Saves before
 * switching: in a browser the switch is a navigation.
 */
function useSwitchMode(settings: Settings | null) {
  return useCallback(
    async (mode: UiMode) => {
      if (settings) await saveSettings({ ...settings, trayOpens: mode });
      await openMode(mode);
    },
    [settings],
  );
}

/** Typing in a field must not trigger single-key shortcuts. */
const typing = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && e.target.closest('input, select, textarea') !== null;

/* ---------------------------------------------------------------------------------------------
 * Variant A, "Окно": full-window live preview, labelled controls, side panel from the right.
 * ------------------------------------------------------------------------------------------- */

type SceneState = { status: 'loading' | 'ok' | 'error'; surface: string };

/** Watches the preview iframe: whether the scene has started, which backend, errors. */
function useSceneState(frame: { current: HTMLIFrameElement | null }, key: string): SceneState {
  const [state, setState] = useState<SceneState>({ status: 'loading', surface: '' });
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart polling on theme change
  useEffect(() => {
    setState({ status: 'loading', surface: '' });
    const id = setInterval(() => {
      const w = frame.current?.contentWindow as
        | (Window & { deskwall?: { frames: number } })
        | null
        | undefined;
      const doc = frame.current?.contentDocument;
      if (!w || !doc) return;
      if (doc.body?.dataset.error) {
        setState({ status: 'error', surface: doc.documentElement.dataset.surface ?? '' });
        return;
      }
      const surface = doc.documentElement.dataset.surface ?? '';
      const started = (w.deskwall?.frames ?? 0) > 0;
      setState((prev) =>
        prev.status === (started ? 'ok' : 'loading') && prev.surface === surface
          ? prev
          : { status: started ? 'ok' : 'loading', surface },
      );
    }, 400);
    return () => clearInterval(id);
  }, [frame, key]);
  return state;
}

function surfaceLabel(surface: string): string {
  if (surface.startsWith('classic:')) return 'WEBGL2';
  return surface.toUpperCase();
}

type PanelTarget = 'themes' | 'general';

function WindowView() {
  const frame = useRef<HTMLIFrameElement>(null);
  const { settings, systemLocales, update, reset } = useSettings(frame);
  const { lang, t } = useLang(settings?.locale, systemLocales);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const scene = useSceneState(frame, `${settings?.theme}:${reloadKey}`);
  const load = useLoad(true);
  const switchMode = useSwitchMode(settings);
  const themesRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const hintOpen = !!settings && !settings.hintSeen;

  const openPanel = useCallback((target: PanelTarget) => {
    setOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(target === 'themes' ? 'panel-themes' : 'panel-general');
      if (el && scroller.current)
        scroller.current.scrollTo({ top: target === 'themes' ? 0 : el.offsetTop - 16 });
      el?.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true });
    });
  }, []);

  const closePanel = useCallback(() => {
    returnFocus.current = true;
    setOpen(false);
  }, []);

  // The Themes button only exists while the panel is closed: focus it after the re-render.
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      themesRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hintOpen) return;
      if (e.key === 'Escape' && open) {
        closePanel();
        return;
      }
      if (open || typing(e) || e.ctrlKey || e.altKey || e.metaKey) return;
      // Physical keys, so the hints work with any keyboard layout.
      if (e.code === 'KeyT') openPanel('themes');
      else if (e.code === 'KeyS') openPanel('general');
      else if (e.code === 'KeyD') void switchMode('dock');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hintOpen, openPanel, closePanel, switchMode]);

  // A theme switch reloads the preview page; keep the preview's pause in step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply when the scene restarts
  useEffect(() => {
    const w = frame.current?.contentWindow as
      | (Window & { deskwall?: { setPaused(p: boolean): void } })
      | null
      | undefined;
    w?.deskwall?.setPaused(paused);
  }, [paused, scene.status]);

  if (!settings) return <div className="bg-paper h-dvh" />;
  const current = themeById(settings.theme);
  const index = THEMES.findIndex((d) => d.id === current.id) + 1;
  const renderer = new URLSearchParams(location.search).get('renderer') === 'webgl';

  return (
    <div className="bg-paper relative h-dvh w-full overflow-hidden">
      {/* Live preview fills the window. Sample icons; on the desktop the land follows real icons. */}
      <iframe
        key={reloadKey}
        ref={frame}
        title={t.preview}
        src={`/wallpaper.html?embed&inset=80${renderer ? '&renderer=webgl' : ''}${showHidden ? '&hidden' : ''}`}
        className="pointer-events-none absolute top-0 left-0 h-[133.333%] w-[133.333%] origin-top-left scale-75 border-0"
        tabIndex={-1}
      />
      {scene.status !== 'ok' && (
        <div className="bg-paper absolute inset-0 grid place-items-center">
          {scene.status === 'loading' ? (
            <p className="label text-stone">{t.loading}</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <p className="text-danger">{t.themeError}</p>
              <Pill
                kind="outline"
                icon={<RotateCcw {...ICON} />}
                onClick={() => setReloadKey((k) => k + 1)}
              >
                {t.restartTheme}
              </Pill>
            </div>
          )}
        </div>
      )}

      <TitleBar t={t} overScene className="absolute inset-x-0 top-0" />

      {/* Top right: labelled entry points, or a labelled close button when the panel is open. */}
      <div className="absolute top-12 right-4 z-40 flex items-center gap-2">
        {open ? (
          <Pill
            onScene
            icon={<X {...ICON} />}
            kbd="Esc"
            aria-expanded="true"
            aria-controls="settings-panel"
            onClick={closePanel}
          >
            {t.closePanel}
          </Pill>
        ) : (
          <>
            <Disc
              label={paused ? t.playPreview : t.pausePreview}
              aria-pressed={paused}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? (
                <Play size={18} strokeWidth={1.5} />
              ) : (
                <Pause size={18} strokeWidth={1.5} />
              )}
            </Disc>
            <Pill
              ref={themesRef}
              onScene
              icon={<Palette {...ICON} />}
              kbd="T"
              aria-expanded="false"
              aria-controls="settings-panel"
              data-spot="themes"
              onClick={() => openPanel('themes')}
            >
              {t.themesBtn}
            </Pill>
            <Pill
              onScene
              icon={<SlidersHorizontal {...ICON} />}
              kbd="S"
              aria-controls="settings-panel"
              onClick={() => openPanel('general')}
            >
              {t.settingsBtn}
            </Pill>
          </>
        )}
      </div>

      {/* Bottom left: theme name pill and the load label. */}
      <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2">
        <SceneLabel t={t} scene={scene} paused={paused} fps={settings.fps} load={load} />
        <Pill
          onScene
          onClick={() => openPanel('themes')}
          aria-label={`${t.theme}: ${current.name[lang]}`}
        >
          <span className="label text-stone group-hover:text-snow">{pad2(index)}</span>
          {current.name[lang]}
        </Pill>
      </div>

      {/* Bottom right: switch to the side panel (a narrow strip over the real wallpaper). */}
      <div
        className={`absolute right-4 bottom-4 z-20 transition-opacity duration-240 ${open ? 'pointer-events-none opacity-0' : ''}`}
      >
        <button
          type="button"
          data-spot="dock"
          onClick={() => void switchMode('dock')}
          className="group bg-pill text-ink hover:bg-ink hover:text-snow on-scene flex w-[300px] items-center gap-4 px-4 py-3 text-left transition-colors duration-160"
        >
          <ScreenStrip />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 font-medium">
              {t.openDock}
              <Kbd>D</Kbd>
            </span>
            <span className="text-caption text-graphite group-hover:text-snow/80">
              {t.openDockText}
            </span>
          </span>
        </button>
      </div>

      <aside
        id="settings-panel"
        aria-label={t.menu}
        inert={!open}
        className={`bg-paper dw-surface absolute top-0 right-0 bottom-0 z-30 flex w-[400px] max-w-full flex-col transition-transform duration-240 ease-grow ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-24 shrink-0" />
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <PanelContent settings={settings} lang={lang} t={t} update={update} reset={reset} />
        </div>
      </aside>

      {hintOpen && <FirstRunHint t={t} onDone={() => update({ hintSeen: true })} />}
    </div>
  );
}

function SceneLabel({
  t,
  scene,
  paused,
  fps,
  load,
}: {
  t: Strings;
  scene: SceneState;
  paused: boolean;
  fps: number;
  load: LoadStats | null;
}) {
  if (scene.status !== 'ok') return null;
  const compat = scene.surface === 'webgl2';
  const parts = [
    paused ? t.paused : '',
    formatLoad(load),
    `${fps} FPS`,
    surfaceLabel(scene.surface),
  ].filter(Boolean);
  return (
    <div className="flex flex-col items-start gap-1">
      {compat && <p className="bg-pill/75 text-caption text-graphite px-2 py-0.5">{t.compat}</p>}
      <p className="label bg-pill/75 text-graphite px-2 py-0.5" title={t.load}>
        {parts.join(' · ')}
      </p>
    </div>
  );
}

/** A screen with a strip on its right edge: the side panel mode, drawn small. */
function ScreenStrip() {
  return (
    <svg
      width="48"
      height="36"
      viewBox="0 0 48 36"
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1" y="1" width="46" height="28" />
      <rect x="35" y="1" width="12" height="28" fill="currentColor" />
      <path d="M18 34h12M24 29v5" />
    </svg>
  );
}

/**
 * First run: three short steps over the preview, shown once (Settings.hintSeen). The control a
 * step talks about gets a ring (`data-spot` + `.dw-spot`), so the hint points at something real.
 */
function FirstRunHint({ t, onDone }: { t: Strings; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const steps = t.hints;
  const last = step === steps.length - 1;
  const spot = step === 0 ? 'themes' : step === 1 ? 'dock' : '';

  useEffect(() => {
    next.current?.focus();
  }, []);
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-spot]');
    for (const el of els) el.classList.toggle('dw-spot', el.dataset.spot === spot);
    return () => {
      for (const el of els) el.classList.remove('dw-spot');
    };
  }, [spot]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const item = steps[step];
  if (!item) return null;
  return (
    <section
      role="dialog"
      aria-labelledby="hint-title"
      className="bg-paper dw-surface border-mist absolute bottom-20 left-1/2 z-50 flex w-[440px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col gap-4 border p-6"
    >
      <p className="label text-stone">
        {t.hintStep} {pad2(step + 1)} / {pad2(steps.length)}
      </p>
      <h2 id="hint-title" className="font-brand text-[32px] leading-9 font-light italic">
        {item.title}
      </h2>
      <p className="text-graphite">{item.text}</p>
      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          className="text-graphite hover:text-ink inline-flex items-center gap-2 underline-offset-4 hover:underline"
          onClick={onDone}
        >
          {t.hintSkip} <Kbd>Esc</Kbd>
        </button>
        <Pill
          ref={next}
          kind={last ? 'accent' : 'outline'}
          onClick={() => (last ? onDone() : setStep((s) => s + 1))}
        >
          {last ? t.hintDone : t.hintNext}
        </Pill>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Variant B, "На рабочем столе": a 400px panel docked to the screen edge over the real wallpaper.
 * ------------------------------------------------------------------------------------------- */

function DockView() {
  const { settings, systemLocales, update, reset } = useSettings();
  const { lang, t } = useLang(settings?.locale, systemLocales);
  const [pinned, setPinned] = useState(false);
  const load = useLoad(true);
  const switchMode = useSwitchMode(settings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void windowAction('close');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!settings) return <div className="bg-paper h-dvh" />;
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    void setDockPinned(next);
  };
  const loadText = formatLoad(load);
  return (
    <div className="bg-paper dw-surface border-mist flex h-dvh w-full flex-col overflow-hidden border-l">
      <TitleBar t={t} title={t.dockTitle} maximizable={false} />
      <div className="flex flex-col gap-3 px-8 pt-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            kind="solid"
            className="border-ink border"
            icon={<AppWindow {...ICON} />}
            tip={t.openWindowTip}
            onClick={() => void switchMode('window')}
          >
            {t.openWindow}
          </Pill>
          <Pill
            kind="outline"
            icon={pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />}
            aria-pressed={pinned}
            tip={pinned ? t.unpinTip : t.pinTip}
            tipSide="below-end"
            className={pinned ? 'border-ink bg-ink text-snow' : ''}
            onClick={togglePin}
          >
            {t.pin}
          </Pill>
        </div>
        <p className="text-caption text-graphite">
          {t.dockHint} <Kbd>Esc</Kbd>
        </p>
        {loadText && (
          <p className="label text-stone" title={t.load}>
            {loadText} · {settings.fps} FPS
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelContent settings={settings} lang={lang} t={t} update={update} reset={reset} />
      </div>
    </div>
  );
}
