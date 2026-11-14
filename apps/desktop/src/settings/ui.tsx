import type { ButtonHTMLAttributes, ComponentProps, CSSProperties, ReactNode } from 'react';

/** Small building blocks from brand/DESIGN.md "Компоненты". Flat: no shadows, no blur. */

const press = 'transition-colors duration-160 ease-grow active:scale-[0.97]';

type PillKind = 'solid' | 'accent' | 'outline';

export function Pill({
  kind = 'solid',
  onScene = false,
  icon,
  kbd,
  tip,
  tipSide,
  children,
  className = '',
  ...rest
}: ComponentProps<'button'> & {
  kind?: PillKind;
  onScene?: boolean;
  icon?: ReactNode;
  /** Keyboard shortcut shown inside the pill. */
  kbd?: string;
  /** Longer explanation, shown on hover and keyboard focus. */
  tip?: string;
  tipSide?: TipSide;
}) {
  const look =
    kind === 'accent'
      ? 'bg-sprout text-[#1d2420] hover:bg-ink hover:text-snow'
      : kind === 'outline'
        ? `${onScene ? 'bg-pill/70' : 'bg-transparent'} border border-line text-ink hover:bg-ink hover:text-snow`
        : 'bg-pill text-ink hover:bg-ink hover:text-snow';
  return (
    <button
      type="button"
      className={`group relative inline-flex h-9 items-center gap-2 rounded-full px-4 text-control font-medium whitespace-nowrap ${look} ${press} ${onScene ? 'on-scene' : ''} ${className}`}
      {...rest}
    >
      {children}
      {icon}
      {kbd && <Kbd>{kbd}</Kbd>}
      {tip && <Tip text={tip} side={tipSide} />}
    </button>
  );
}

/** Small keyboard hint, e.g. <Kbd>Esc</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-line text-graphite group-hover:border-snow/50 group-hover:text-snow rounded-[4px] border px-1 font-mono text-[10px] leading-4 font-normal">
      {children}
    </kbd>
  );
}

type TipSide = 'below' | 'below-end' | 'above' | 'left';

/** Visible tooltip for icon buttons: shows on hover and on keyboard focus. */
export function Tip({ text, side = 'below' }: { text: string; side?: TipSide }) {
  const pos =
    side === 'above'
      ? 'bottom-full mb-1 right-0'
      : side === 'left'
        ? 'right-full mr-2 top-1/2 -translate-y-1/2'
        : side === 'below-end'
          ? 'top-full mt-1 right-0'
          : 'top-full mt-1 left-0';
  return (
    <span
      role="tooltip"
      className={`bg-ink text-snow text-caption pointer-events-none absolute z-50 w-max max-w-64 px-2 py-1 opacity-0 transition-opacity delay-300 duration-160 group-hover:opacity-100 group-focus-visible:opacity-100 ${pos}`}
    >
      {text}
    </span>
  );
}

/** Round 40px disc in a 48px hit area; floats over the scene. Always has a tooltip. */
export function Disc({
  label,
  tipSide,
  children,
  className = '',
  ...rest
}: ComponentProps<'button'> & { label: string; tipSide?: TipSide }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`group relative grid size-12 place-items-center rounded-full ${className}`}
      {...rest}
    >
      <span
        className={`bg-pill text-ink group-hover:bg-ink group-hover:text-snow grid size-10 place-items-center rounded-full ${press} on-scene`}
      >
        {children}
      </span>
      <Tip text={label} side={tipSide} />
    </button>
  );
}

export function Chip({
  active,
  count,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-caption ${press} ${
        active ? 'border-ink bg-ink text-snow' : 'border-line text-ink hover:bg-snow'
      }`}
      {...rest}
    >
      {children}
      {count !== undefined && <span className="label opacity-70">{count}</span>}
    </button>
  );
}

export function Slider({
  label,
  hint,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  shown,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  shown: string;
  onChange: (v: number) => void;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between gap-4">
        <span>{label}</span>
        <span className="label text-graphite tabular-nums">{shown}</span>
      </span>
      <input
        type="range"
        className="dw-range"
        style={{ '--fill': `${fill}%` } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      {hint && <span className="text-caption text-graphite">{hint}</span>}
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="bg-line checked:bg-sprout before:bg-pill checked:before:bg-ink relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full transition-colors duration-160 before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:transition-[translate,background-color] before:duration-160 checked:before:translate-x-4"
      />
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.currentTarget.value as T)}
        className="dw-select border-line bg-snow text-ink rounded-field h-9 min-w-36 border px-3"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-mist flex scroll-mt-4 flex-col gap-5 border-t pt-6">
      <h2 className="text-title font-medium">{title}</h2>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span>{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
