import type { ScreenTheme, Settings, UpdatePayload } from '@deskwall/protocol';
import { inApp } from '../shared/host';
import { THEMES, type ThemeParam, themeById, themeValues } from '../shared/themes';
import { useScreens, useUpdates } from './bridge';
import { pad2 } from './format';
import type { Lang, Strings } from './i18n';
import { Chip, Field, Pill, Section, Select, Slider, Toggle } from './ui';

/**
 * Side panel content shared by variant A (window) and variant B (dock): theme list with big
 * Cormorant names and mono numerals, then the active theme's parameters, then general settings.
 */
export function PanelContent({
  settings,
  lang,
  t,
  update,
  reset,
}: {
  settings: Settings;
  lang: Lang;
  t: Strings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}) {
  const current = themeById(settings.theme);
  const values = themeValues(current, settings.themeParams[current.id]);
  const screens = useScreens();
  const updates = useUpdates();

  return (
    <div className="flex flex-col gap-8 px-8 pt-2 pb-8">
      <section
        id="panel-themes"
        aria-labelledby="themes-h"
        className="flex scroll-mt-4 flex-col gap-4"
      >
        <h2 id="themes-h" className="label text-stone">
          {t.themes} · {pad2(THEMES.length)}
        </h2>
        <ol className="flex flex-col gap-1">
          {THEMES.map((def, i) => {
            const active = def.id === settings.theme;
            return (
              <li key={def.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ theme: def.id })}
                  className="group flex w-full items-baseline gap-4 py-1 text-left"
                >
                  <span aria-hidden="true" className="label text-stone w-6 shrink-0">
                    {pad2(i + 1)}
                  </span>
                  <span
                    className={`font-brand text-theme-name font-light transition-colors duration-160 ${
                      active
                        ? 'text-stone underline decoration-2 underline-offset-8'
                        : 'text-ink group-hover:text-graphite'
                    }`}
                  >
                    {def.name[lang]}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-graphite">{current.description[lang]}</p>
      </section>

      {screens.length > 1 && (
        <Section id="panel-screens" title={t.screens}>
          {screens.map((sc, i) => {
            const name = `${t.screen} ${i + 1}${sc.primary ? ` · ${t.screenMain}` : ''}`;
            const size = `${sc.w}×${sc.h}`;
            if (sc.primary)
              return (
                <div key={sc.id} className="flex items-center justify-between gap-4">
                  <span>
                    {name} <span className="text-caption text-stone">{size}</span>
                  </span>
                  <span className="text-graphite">
                    {current.name[lang]}{' '}
                    <span className="text-caption text-stone">· {t.screenMainHint}</span>
                  </span>
                </div>
              );
            const value: ScreenTheme = settings.screenThemes[sc.id] ?? 'same';
            return (
              <Select
                key={sc.id}
                label={`${name} · ${size}`}
                value={value}
                options={[
                  { value: 'same', label: t.screenSame },
                  ...THEMES.map((d) => ({ value: d.id, label: d.name[lang] })),
                  { value: 'off', label: t.screenOff },
                ]}
                onChange={(v) => {
                  const next = { ...settings.screenThemes };
                  if (v === 'same') delete next[sc.id];
                  else next[sc.id] = v;
                  update({ screenThemes: next });
                }}
              />
            );
          })}
        </Section>
      )}

      {current.params.length > 0 && (
        <Section title={`${t.themeSettings} · ${current.name[lang]}`}>
          {current.params.map((p) => (
            <ParamControl
              key={p.key}
              param={p}
              lang={lang}
              t={t}
              value={values[p.key] ?? p.default}
              onChange={(v) =>
                update({
                  themeParams: { ...settings.themeParams, [current.id]: { ...values, [p.key]: v } },
                })
              }
            />
          ))}
        </Section>
      )}

      <Section id="panel-general" title={t.general}>
        <Slider
          label={t.labelVeil}
          value={settings.labelVeil}
          shown={pct(settings.labelVeil)}
          onChange={(v) => update({ labelVeil: v })}
        />
        <Field label={t.fps}>
          {([15, 30, 60] as const).map((fps) => (
            <Chip key={fps} active={settings.fps === fps} onClick={() => update({ fps })}>
              {fps}
            </Chip>
          ))}
        </Field>
        <Toggle
          label={t.pauseOnFullscreen}
          checked={settings.pauseOnFullscreen}
          onChange={(v) => update({ pauseOnFullscreen: v })}
        />
        {inApp && (
          <Toggle
            label={t.autostart}
            checked={settings.autostart}
            onChange={(v) => update({ autostart: v })}
          />
        )}
        <Select
          label={t.language}
          value={settings.locale}
          options={[
            { value: 'auto', label: t.langAuto },
            { value: 'en', label: 'English' },
          ]}
          onChange={(locale) => update({ locale })}
        />
        <div className="flex flex-col gap-2">
          <Select
            label={t.trayOpens}
            value={settings.trayOpens}
            options={[
              { value: 'window', label: t.trayWindow },
              { value: 'dock', label: t.trayDock },
            ]}
            onChange={(trayOpens) => update({ trayOpens })}
          />
          <p className="text-caption text-graphite">{t.trayHint}</p>
        </div>
      </Section>

      {inApp && updates.status && (
        <Section id="panel-updates" title={t.updates}>
          <Toggle
            label={t.autoUpdate}
            checked={settings.autoUpdate}
            onChange={(v) => update({ autoUpdate: v })}
          />
          <div className="flex flex-col gap-3">
            <p className="text-caption text-graphite" role="status">
              {t.version} {updates.status.current} · {updateText(updates.status, t, lang)}
            </p>
            <div className="flex gap-2">
              <Pill kind="outline" onClick={updates.check} disabled={isBusy(updates.status.state)}>
                {t.checkNow}
              </Pill>
              {updates.status.state === 'available' && !settings.autoUpdate && (
                <Pill kind="solid" onClick={updates.install}>
                  {t.installUpdate}
                </Pill>
              )}
            </div>
          </div>
        </Section>
      )}

      <footer className="border-mist flex items-center justify-between gap-4 border-t pt-6">
        {inApp ? (
          <span className="label text-stone">
            DeskWall {updates.status?.current ?? ''} · GPL-3.0
          </span>
        ) : (
          <span className="text-caption text-stone">{t.browserNote}</span>
        )}
        <Pill kind="outline" onClick={reset}>
          {t.reset}
        </Pill>
      </footer>
    </div>
  );
}

const isBusy = (state: UpdatePayload['state']) =>
  state === 'checking' || state === 'downloading' || state === 'ready';

/** One plain line for the updater status; the last check time follows when it is known. */
function updateText(u: UpdatePayload, t: Strings, lang: Lang): string {
  const v = u.latest ?? '';
  const main = {
    idle: t.updIdle,
    checking: t.updChecking,
    uptodate: t.updUpToDate,
    available: t.updAvailable.replace('{v}', v),
    downloading: t.updDownloading.replace('{v}', v).replace('{p}', String(u.progress ?? 0)),
    ready: t.updReady.replace('{v}', v),
    error: t.updError,
  }[u.state];
  if (u.checkedAt === null || isBusy(u.state)) return main;
  const time = new Date(u.checkedAt).toLocaleTimeString(lang, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${main} · ${t.updChecked.replace('{t}', time)}`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function ParamControl({
  param,
  value,
  lang,
  t,
  onChange,
}: {
  param: ThemeParam;
  value: number;
  lang: Lang;
  t: Strings;
  onChange: (v: number) => void;
}) {
  if (param.format === 'choice' && param.choices) {
    return (
      <Field label={param.label[lang]}>
        {param.choices.map((c, i) => (
          <Chip key={c.en} active={value === i} onClick={() => onChange(i)}>
            {c[lang]}
          </Chip>
        ))}
      </Field>
    );
  }
  if (param.format === 'toggle') {
    return (
      <Toggle
        label={param.label[lang]}
        checked={value === 1}
        onChange={(v) => onChange(v ? 1 : 0)}
      />
    );
  }
  const shown =
    param.format === 'percent'
      ? pct(value)
      : param.format === 'times'
        ? `×${value.toFixed(2)}`
        : param.format === 'px'
          ? `${value} ${t.px}`
          : `${value}`;
  return (
    <Slider
      label={param.label[lang]}
      hint={param.hint?.[lang]}
      value={value}
      min={param.min}
      max={param.max}
      step={param.step}
      shown={shown}
      onChange={onChange}
    />
  );
}
