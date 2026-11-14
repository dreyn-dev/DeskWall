import { PanelRight, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES, themeById } from '../shared/themes';
import { openMode, uiMode, useSettings, windowAction } from './bridge';
import { type Lang, resolveLang, STRINGS, type Strings } from './i18n';
import { PanelContent, pad2 } from './Panel';
import { TitleBar } from './TitleBar';
import { Disc, Pill } from './ui';

const DEV_TAG = import.meta.env.DEV;

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

/* ---------------------------------------------------------------------------------------------
 * Variant A, "Окно": full-window live preview, discs in the corners, side panel from the right.
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
  if (surface === 'year') return 'WEBGL2';
  return surface.toUpperCase();
}

function WindowView() {
  const frame = useRef<HTMLIFrameElement>(null);
  const { settings, systemLocales, update, reset } = useSettings(frame);
  const { lang, t } = useLang(settings?.locale, systemLocales);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const scene = useSceneState(frame, `${settings?.theme}:${reloadKey}`);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
        src={`/wallpaper.html?embed&inset=80${renderer ? '&renderer=webgl' : ''}`}
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
                icon={<RotateCcw size={16} strokeWidth={1.5} />}
                onClick={() => setReloadKey((k) => k + 1)}
              >
                {t.restartTheme}
              </Pill>
            </div>
          )}
        </div>
      )}

      <TitleBar
        t={t}
        tag={DEV_TAG ? `${t.variant} A` : undefined}
        className="absolute inset-x-0 top-0"
      />

      {/* Top-right, next to the menu: pause the preview. Hidden while the panel is open. */}
      <div
        className={`absolute top-12 right-14 z-20 transition-opacity duration-240 ${open ? 'pointer-events-none opacity-0' : ''}`}
      >
        <Disc
          label={paused ? t.playPreview : t.pausePreview}
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <Play size={18} strokeWidth={1.5} /> : <Pause size={18} strokeWidth={1.5} />}
        </Disc>
      </div>

      {/* Top-right: menu (two dots, a cross when open). Sits above the panel. */}
      <div className="absolute top-12 right-2 z-40">
        <Disc
          ref={menuRef}
          label={open ? t.closePanel : t.menu}
          aria-expanded={open}
          aria-controls="settings-panel"
          onClick={() => setOpen((o) => !o)}
        >
          <MenuGlyph open={open} />
        </Disc>
      </div>

      {/* Bottom-left: theme name pill and the load label. */}
      <div className="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2">
        <SceneLabel t={t} scene={scene} paused={paused} fps={settings.fps} />
        <Pill
          onScene
          onClick={() => setOpen(true)}
          aria-label={`${t.theme}: ${current.name[lang]}`}
        >
          <span className="label text-stone">{pad2(index)}</span>
          {current.name[lang]}
        </Pill>
      </div>

      {/* Bottom-right: open variant B, the panel on the real desktop. */}
      <div
        className={`absolute right-2 bottom-2 z-20 transition-opacity duration-240 ${open ? 'pointer-events-none opacity-0' : ''}`}
      >
        <Disc label={t.openDock} onClick={() => openMode('dock')}>
          <PanelRight size={18} strokeWidth={1.5} />
        </Disc>
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PanelContent settings={settings} lang={lang} t={t} update={update} reset={reset} />
        </div>
      </aside>
    </div>
  );
}

function SceneLabel({
  t,
  scene,
  paused,
  fps,
}: {
  t: Strings;
  scene: SceneState;
  paused: boolean;
  fps: number;
}) {
  if (scene.status !== 'ok') return null;
  const compat = scene.surface === 'webgl2';
  return (
    <div className="flex flex-col items-start gap-1">
      {compat && <p className="bg-pill/70 text-caption text-graphite px-2 py-0.5">{t.compat}</p>}
      <p className="label bg-pill/70 text-stone px-2 py-0.5">
        {paused ? `${t.paused} · ` : ''}
        {surfaceLabel(scene.surface)} · {fps} FPS
      </p>
    </div>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
      {open ? (
        <path
          d="M4.5 4.5l9 9M13.5 4.5l-9 9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : (
        <>
          <circle cx="6" cy="9" r="1.6" />
          <circle cx="12" cy="9" r="1.6" />
        </>
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Variant B, "На рабочем столе": a 400px panel docked to the screen edge over the real wallpaper.
 * ------------------------------------------------------------------------------------------- */

function DockView() {
  const { settings, systemLocales, update, reset } = useSettings();
  const { lang, t } = useLang(settings?.locale, systemLocales);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void windowAction('close');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!settings) return <div className="bg-paper h-dvh" />;
  return <Dock settings={settings} lang={lang} t={t} update={update} reset={reset} />;
}

function Dock({
  settings,
  lang,
  t,
  update,
  reset,
}: {
  settings: NonNullable<ReturnType<typeof useSettings>['settings']>;
  lang: Lang;
  t: Strings;
  update: ReturnType<typeof useSettings>['update'];
  reset: () => void;
}) {
  return (
    <div className="bg-paper dw-surface border-mist flex h-dvh w-full flex-col border-l">
      <TitleBar t={t} tag={DEV_TAG ? `${t.variant} B` : undefined} maximizable={false} />
      <div className="flex flex-col items-start gap-3 px-8 pt-4 pb-4">
        <p className="text-caption text-graphite">{t.dockHint}</p>
        <Pill kind="outline" onClick={() => openMode('window')}>
          {t.openWindow}
        </Pill>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelContent settings={settings} lang={lang} t={t} update={update} reset={reset} />
      </div>
    </div>
  );
}
