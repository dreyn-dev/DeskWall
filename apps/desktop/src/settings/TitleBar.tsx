import { inApp } from '../shared/host';
import { useMaximized, windowAction } from './bridge';
import type { Strings } from './i18n';

/** Segoe Fluent Icons glyphs used by Windows 11 caption buttons. */
const GLYPH = { minimize: '', maximize: '', restore: '', close: '' };

function Caption({
  glyph,
  label,
  danger,
  onClick,
}: {
  glyph: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-10 w-[46px] place-items-center text-[10px] text-ink transition-colors duration-160 ${
        danger ? 'hover:bg-[#c42b1c] hover:text-white' : 'hover:bg-ink/10'
      }`}
      style={{ fontFamily: '"Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif' }}
    >
      {glyph}
    </button>
  );
}

/**
 * Custom 40px title bar (the window has `decorations: false`): mark and name on the left, Windows
 * caption buttons on the right, the rest is a drag region (double click maximizes).
 */
export function TitleBar({
  t,
  tag,
  maximizable = true,
  className = '',
}: {
  t: Strings;
  tag?: string;
  maximizable?: boolean;
  className?: string;
}) {
  const maximized = useMaximized();
  return (
    <div
      data-tauri-drag-region
      className={`relative z-30 flex h-10 items-center justify-between select-none ${className}`}
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3">
        <img src="/brand/mark.svg" alt="" className="pointer-events-none size-4" />
        <span data-tauri-drag-region className="label text-ink">
          DeskWall
        </span>
        {tag && (
          <span data-tauri-drag-region className="label text-stone">
            · {tag}
          </span>
        )}
      </div>
      {inApp && (
        <div className="flex">
          <Caption
            glyph={GLYPH.minimize}
            label={t.minimize}
            onClick={() => windowAction('minimize')}
          />
          {maximizable && (
            <Caption
              glyph={maximized ? GLYPH.restore : GLYPH.maximize}
              label={maximized ? t.restore : t.maximize}
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
