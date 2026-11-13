import type { Rect } from './surface';

/**
 * A soft, cool shade under the icon labels so white Windows captions stay readable on bright
 * scenery (snow, sand, sunny grass). It sits above every theme, so all themes get it, and it is
 * redrawn only when the icons or the strength change: nothing runs per frame.
 *
 * The icon rect is the desktop grid cell (position + spacing); the caption sits in its lower part.
 */
export interface LabelVeil {
  setIcons(icons: readonly Rect[]): void;
  /** 0 = off .. 1 = strongest. Already multiplied by how bright the theme is. */
  setStrength(k: number): void;
}

// Deep blue-grey: reads as a patch of shade, not as dirt, on snow and on grass alike.
const SHADE = '22, 34, 54';
const MAX_ALPHA = 0.34;

export function createLabelVeil(after: Element | null): LabelVeil {
  const cv = document.createElement('canvas');
  cv.className = 'label-veil';
  cv.setAttribute('aria-hidden', 'true');
  if (after) after.after(cv);
  else document.body.prepend(cv);
  const ctx = cv.getContext('2d');

  let icons: readonly Rect[] = [];
  let strength = 0;

  const draw = () => {
    if (!ctx) return;
    const k = window.devicePixelRatio || 1;
    const w = Math.round(innerWidth * k);
    const h = Math.round(innerHeight * k);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const a = MAX_ALPHA * Math.min(1, Math.max(0, strength));
    if (a <= 0.005) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const r of icons) {
      // caption area: lower part of the cell, one or two lines of text
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h * 0.7;
      const rx = r.w * 0.62;
      const ry = r.h * 0.24;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${SHADE}, ${a})`);
      g.addColorStop(0.5, `rgba(${SHADE}, ${a * 0.7})`);
      g.addColorStop(1, `rgba(${SHADE}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  window.addEventListener('resize', draw);
  return {
    setIcons(next) {
      icons = next.map((r) => ({ ...r }));
      draw();
    },
    setStrength(k) {
      if (k === strength) return;
      strength = k;
      draw();
    },
  };
}
