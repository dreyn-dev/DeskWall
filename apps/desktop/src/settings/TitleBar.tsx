import type { ReactNode } from 'react';
import { inApp } from '../shared/host';
import { useCaptionState, useMaximized, windowAction } from './bridge';
import type { Strings } from './i18n';
import { Tip } from './ui';

/** Segoe Fluent Icons glyphs used by Windows 11 caption buttons. */
const GLYPH = {
  minimize: String.fromCharCode(0xe921),
  maximize: String.fromCharCode(0xe922),
  restore: String.fromCharCode(0xe923),
  close: String.fromCharCode(0xe8bb),
};

function Caption({
  glyph,
  label,
  danger,
  hover,
  pressed,
  onClick,
}: {
  glyph: string;
  label: string;
  danger?: boolean;
  /** Forced states, for the maximize button whose mouse events go to the host. */
  hover?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  const state = pressed ? 'bg-ink/20' : hover ? 'bg-ink/10' : '';
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`group relative grid h-10 w-[46px] place-items-center text-[10px] text-ink transition-colors duration-160 ${state} ${
        danger ? 'hover:bg-[#c42b1c] hover:text-white' : 'hover:bg-ink/10'
      }`}
      style={{ fontFamily: '"Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif' }}
    >
      {glyph}
      <Tip text={label} />
    </button>
  );
}

/**
 * Custom 40px title bar (the window has `decorations: false`): mark and name on the left, Windows
 * caption buttons on the right, the rest is a drag region (double click maximizes). Over a live
 * scene only the two clusters get a `pill` backdrop, so text stays readable on any scenery.
 */
export function TitleBar({
  t,
  overScene = false,
  maximizable = true,
  children,
  className = '',
}: {
  t: Strings;
  overScene?: boolean;
  maximizable?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const maximized = useMaximized();
  const caption = useCaptionState();
  const backdrop = overScene ? 'bg-pill/75' : '';
  return (
    <div
      data-tauri-drag-region
      className={`relative z-30 flex h-10 items-center justify-between gap-2 select-none ${className}`}
    >
      <div data-tauri-drag-region className={`flex h-10 items-center gap-2 pr-3 pl-3 ${backdrop}`}>
        <img src="/brand/mark.svg" alt="" className="pointer-events-none size-4" />
        <span data-tauri-drag-region className="label text-ink">
          DeskWall
        </span>
      </div>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {children}
      </div>
      {inApp && (
        <div className={`flex ${backdrop}`}>
          <Caption
            glyph={GLYPH.minimize}
            label={t.minimize}
            onClick={() => windowAction('minimize')}
          />
          {maximizable && (
            <Caption
              glyph={maximized ? GLYPH.restore : GLYPH.maximize}
              label={maximized ? t.restore : t.maximize}
              hover={caption.hover}
              pressed={caption.pressed}
              onClick={() => windowAction('maximize')}
            />
          )}
          <Caption
            glyph={GLYPH.close}
            label={t.close}
            danger
            onClick={() => windowAction('close')}
          />
        </div>
      )}
    </div>
  );
}
