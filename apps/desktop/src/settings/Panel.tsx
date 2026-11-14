import type { PaletteId, Settings } from '@deskwall/protocol';
import { inApp } from '../shared/host';
import { THEMES, type ThemeParam, themeById, themeValues } from '../shared/themes';
import { pad2 } from './format';
import type { Lang, Strings } from './i18n';
import { Chip, Field, Pill, Section, Select, Slider, Toggle } from './ui';

const PALETTE_IDS: PaletteId[] = ['daybreak', 'lagoon', 'dusk', 'nocturne'];

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

      {(current.params.length > 0 || current.id === 'isles') && (
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
          {current.id === 'isles' && (
            <>
              <Field label={t.palette}>
                {PALETTE_IDS.map((id) => (
                  <Chip
                    key={id}
                    active={settings.palette === id}
                    onClick={() => update({ palette: id })}
                  >
                    {t.palettes[id]}
                  </Chip>
                ))}
              </Field>
              <Slider
                label={t.landReach}
                value={settings.landReach}
                shown={pct(settings.landReach)}
                onChange={(v) => update({ landReach: v })}
              />
              <Slider
                label={t.roughness}
                value={settings.roughness}
                shown={pct(settings.roughness)}
                onChange={(v) => update({ roughness: v })}
              />
              <Slider
                label={t.motion}
                value={settings.motion}
                max={2}
                shown={pct(settings.motion / 2)}
                onChange={(v) => update({ motion: v })}
              />
              <Toggle
                label={t.contours}
                checked={settings.contours}
                onChange={(v) => update({ contours: v })}
              />
            </>
          )}
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

      <footer className="border-mist flex items-center justify-between gap-4 border-t pt-6">
        {inApp ? (
          <span className="label text-stone">DeskWall 0.1.0 · GPL-3.0</span>
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
