// DeskWall · Autumn Forest.
// The icon field (computeField), noise helpers and the hosted-mode message protocol follow the
// classic themes ported from Deskland Preview (GPL-3.0, see NOTICE). Everything drawn here (trees,
// forest floor, animals, leaves) is painted procedurally at startup; the theme ships no images.
'use strict';

/* ======================================================================
   Parameters
   ====================================================================== */
const QS = new URLSearchParams(location.search);
const WALL = QS.has('wallpaper');
const PREVIEW = QS.has('preview');
const STEP = 5, MORPH_MS = 1800, WARP = 40;
const P = {
  sigma: 105, leaves: 1, wind: 1, showFox: 1, showSquirrels: 1, showBirds: 1,
  adaptive: 1, quality: 2, cap30: true, debug: false,
};
const DEFAULTS = Object.assign({}, P);
const NUM_KEYS = ['sigma', 'leaves', 'wind'];
const DISPLAY_KEYS = ['showFox', 'showSquirrels', 'showBirds', 'adaptive'];

/* ======================================================================
   Random + CPU noise
   ====================================================================== */
let seed = QS.has('seed') ? +QS.get('seed') : (Math.random() * 1e6) | 0;
function hash2(x, y, k = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed + k, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, k = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, k), b = hash2(ix + 1, iy, k), c = hash2(ix, iy + 1, k), d = hash2(ix + 1, iy + 1, k);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, k = 0) {
  let a = 0.5, s = 0;
  for (let i = 0; i < 4; i++) { s += a * vnoise(x, y, k + i * 7); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= 0.5; }
  return s;
}
function tileNoise(x, y, px, py, k) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = (v, p) => ((v % p) + p) % p;
  const x0 = m(ix, px), x1 = m(ix + 1, px), y0 = m(iy, py), y1 = m(iy + 1, py);
  const a = hash2(x0, y0, k), b = hash2(x1, y0, k), c = hash2(x0, y1, k), d = hash2(x1, y1, k);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function tileFbm(u, v, periods, k) {
  let s = 0, w = 0.5, tw = 0;
  for (let i = 0; i < periods.length; i++) { s += w * tileNoise(u * periods[i], v * periods[i], periods[i], periods[i], k + i * 13); tw += w; w *= 0.5; }
  return s / tw;
}
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/* ======================================================================
   Icon field: s = signed distance-like value, < 0 inside the clearing around icons
   ====================================================================== */
let W = innerWidth, H = innerHeight, Gw = 1, Gh = 1, NZ = null;
function buildNoise() {
  const N = Gw * Gh;
  NZ = { wx: new Float32Array(N), wy: new Float32Array(N) };
  for (let gy = 0; gy < Gh; gy++) for (let gx = 0; gx < Gw; gx++) {
    const i = gy * Gw + gx, x = gx * STEP, y = gy * STEP;
    NZ.wx[i] = fbm(x * 0.0028, y * 0.0028, 1) - 0.47;
    NZ.wy[i] = fbm(x * 0.0028, y * 0.0028, 2) - 0.47;
  }
}
function computeField(rects) {
  const N = Gw * Gh, f1 = new Float32Array(N);
  const sig = P.sigma, is1 = 1 / (sig * sig);
  const wa = WARP * 2.2, wmax = wa * 0.5;
  for (const r of rects) {
    const R = 5.5 * sig + Math.max(r.hw, r.hh) * 0.5 + wmax;
    const gx0 = Math.max(0, Math.floor((r.cx - R) / STEP)), gx1 = Math.min(Gw - 1, Math.ceil((r.cx + R) / STEP));
    const gy0 = Math.max(0, Math.floor((r.cy - R) / STEP)), gy1 = Math.min(Gh - 1, Math.ceil((r.cy + R) / STEP));
    const chw = r.hw * 0.5, chh = r.hh * 0.5;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const i = gy * Gw + gx;
      const qx = gx * STEP + NZ.wx[i] * wa, qy = gy * STEP + NZ.wy[i] * wa;
      let dx = Math.abs(qx - r.cx) - chw, dy = Math.abs(qy - r.cy) - chh;
      if (dx < 0) dx = 0; if (dy < 0) dy = 0;
      f1[i] += Math.exp(-(dx * dx + dy * dy) * is1);
    }
  }
  const c0 = Math.sqrt(-Math.log(0.35)), s = new Float32Array(N), fMin = Math.exp(-30);
  for (let i = 0; i < N; i++) {
    const g = Math.log(Math.max(f1[i], fMin));
    s[i] = sig * (Math.sqrt(Math.max(-g, 0)) - c0) - sig * 0.6 * Math.max(g, 0);
  }
  return { s };
}
function sampleArr(a, x, y) {
  const fx = clamp(x / STEP, 0, Gw - 1.001), fy = clamp(y / STEP, 0, Gh - 1.001);
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, i = iy * Gw + ix;
  return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + Gw] * (1 - tx) + a[i + Gw + 1] * tx) * ty;
}

/* ======================================================================
   Procedural painting: one sprite atlas + one forest-floor tile, painted once at startup
   ====================================================================== */
const ATLAS = 2048;
const atlasCv = document.createElement('canvas');
atlasCv.width = atlasCv.height = ATLAS;
const actx = atlasCv.getContext('2d');
actx.imageSmoothingQuality = 'high';
const tmpCv = document.createElement('canvas');
const tg = tmpCv.getContext('2d');
let packX = 0, packY = 0, packRow = 0;
function paintSprite(size, fn) {
  const S = size * 2;                         // paint at 2× and downscale for clean edges
  tmpCv.width = tmpCv.height = S;
  tg.setTransform(1, 0, 0, 1, 0, 0);
  tg.clearRect(0, 0, S, S);
  fn(tg, S);
  if (packX + size > ATLAS) { packX = 0; packY += packRow; packRow = 0; }
  const x = packX, y = packY;
  packX += size; packRow = Math.max(packRow, size);
  actx.drawImage(tmpCv, 0, 0, S, S, x, y, size, size);
  return [x / ATLAS, y / ATLAS, (x + size) / ATLAS, (y + size) / ATLAS];
}
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const PALS = {
  mapleR: ['#3e0d0a', '#86200f', '#c9441b', '#f28a3f', '#ffd08a'],
  mapleO: ['#4d1f08', '#a24314', '#de7523', '#ffb04f', '#ffe1a0'],
  oak:    ['#33200e', '#6f431a', '#a96c2c', '#d9a458', '#f3d79a'],
  birch:  ['#4a360a', '#9a7212', '#d8ab25', '#ffe060', '#fff6c4'],
  turn:   ['#1d2711', '#3d4c1e', '#6d772b', '#a99a3c', '#ddca76'],
  fir:    ['#141d10', '#22341c', '#37532b', '#617d45', '#9cae70'],
};
const PALRGB = {};
for (const k in PALS) PALRGB[k] = PALS[k].map(hex);
function palColor(name, t, mul = 1, alpha = 1) {
  const p = PALRGB[name], n = p.length - 1, x = clamp(t, 0, 0.999) * n, i = Math.floor(x), f = x - i;
  const a = p[i], b = p[i + 1];
  return `rgba(${(a[0] + (b[0] - a[0]) * f) * mul | 0},${(a[1] + (b[1] - a[1]) * f) * mul | 0},${(a[2] + (b[2] - a[2]) * f) * mul | 0},${alpha})`;
}
const LIGHT = (() => { const v = [-0.52, -0.62, 0.58], l = Math.hypot(...v); return v.map(x => x / l); })();

// A leaf outline centred on the origin, pointing along +x, length L.
function leafPath(g, kind, L) {
  g.beginPath();
  if (kind === 1) {                           // maple: five pointed lobes
    const lob = [0, 0.95, -0.95, 1.9, -1.9], rr = [0.5, 0.42, 0.42, 0.3, 0.3];
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const order = [3, 1, 0, 2, 4][i];
      pts.push([lob[order], rr[order]]);
    }
    let first = true;
    for (let i = 0; i < pts.length; i++) {
      const [a, r] = pts[i];
      const am = i < pts.length - 1 ? (a + pts[i + 1][0]) / 2 : null;
      const x = Math.cos(a) * r * L, y = Math.sin(a) * r * L;
      if (first) { g.moveTo(-0.08 * L, 0.06 * L); first = false; }
      g.lineTo(x, y);
      if (am !== null) g.lineTo(Math.cos(am) * 0.17 * L, Math.sin(am) * 0.17 * L);
    }
    g.lineTo(-0.08 * L, -0.06 * L);
    g.lineTo(-0.5 * L, 0);
  } else if (kind === 2) {                    // oak: wavy outline
    for (let i = 0; i <= 28; i++) {
      const a = i / 28 * TAU, c = Math.cos(a), s = Math.sin(a);
      const r = 0.5 * L * (1 + 0.13 * Math.cos(a * 7));
      const x = c * r, y = s * r * 0.5 * (0.75 + 0.25 * c);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  } else {                                    // ovate (birch, beech)
    g.moveTo(-L / 2, 0);
    g.bezierCurveTo(-L / 4, -L * 0.34, L / 4, -L * 0.3, L / 2, 0);
    g.bezierCurveTo(L / 4, L * 0.3, -L / 4, L * 0.34, -L / 2, 0);
  }
  g.closePath();
}

// Deciduous crown seen from above: lobes of foliage, each painted as a dome of thousands of leaf dabs
function paintCrown(g, S, pal, rnd, Rk = 0.36, dabsK = 1) {
  const R = S * Rk, sc = S / 512;
  g.translate(S / 2, S / 2);
  // Many small clumps of foliage; the crown outline is their union. Each clump is a low dome,
  // the whole crown is a broad dome, and the crevices between clumps fall into shadow.
  const clumps = [];
  const n = Math.round((22 + rnd() * 10) * (dabsK < 1 ? 0.6 : 1));
  const squash = 0.82 + rnd() * 0.18, tilt = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, d = Math.pow(rnd(), 0.7) * R * 0.78;
    let x = Math.cos(a) * d, y = Math.sin(a) * d * squash;
    const c = Math.cos(tilt), s = Math.sin(tilt);
    [x, y] = [c * x - s * y, s * x + c * y];
    const r = R * (0.17 + rnd() * 0.15) * (1.15 - 0.35 * d / R);
    clumps.push({ x, y, r, base: Math.sqrt(Math.max(0, 1 - (d / (R * 1.05)) ** 2)) * R * 0.55 });
  }
  const crownH = (x, y) => {
    let best = -1e9, bc = null, bd = 0;
    for (const c of clumps) {
      const d = Math.hypot(x - c.x, y - c.y) / c.r;
      if (d > 1.15) continue;
      const h = Math.sqrt(Math.max(0, 1 - Math.min(d, 1) ** 2)) * c.r * 0.55 + c.base - Math.max(0, d - 1) * c.r;
      if (h > best) { best = h; bc = c; bd = d; }
    }
    return [best, bc, bd];
  };
  // deep shadow underlayer: the crevices and the inside of the crown
  g.fillStyle = palColor(pal, 0.16, 0.72);
  for (const c of clumps) { g.beginPath(); g.arc(c.x, c.y, c.r * 0.95, 0, TAU); g.fill(); }
  const dabs = [];
  const N = Math.round(6500 * dabsK);
  for (let k = 0; k < N; k++) {
    const a = rnd() * TAU, rr = Math.sqrt(rnd()) * R * 1.08;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const [h, c, d] = crownH(x, y);
    if (!c) continue;
    if (d > 1.0 && rnd() < 0.6) continue;
    const nz0 = Math.sqrt(Math.max(0.05, 1 - Math.min(d, 1) ** 2));
    // clump normal blended with the broad crown dome
    const gx = x / (R * 1.25), gy = y / (R * 1.25), gz = Math.sqrt(Math.max(0.05, 1 - gx * gx - gy * gy));
    let nx = (x - c.x) / c.r * 0.55 + gx * 0.75, ny = (y - c.y) / c.r * 0.55 + gy * 0.75, nz = nz0 * 0.55 + gz * 0.75;
    const nl = Math.hypot(nx, ny, nz);
    let lum = 0.5 + 0.5 * (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
    const crevice = sstep(1.05, 0.55, d);                 // dark where clumps meet
    lum *= 0.62 + 0.38 * crevice;
    lum *= 0.82 + 0.18 * (h / (R * 0.8));
    dabs.push(x, y, h, lum);
  }
  const order = [];
  for (let i = 0; i < dabs.length; i += 4) order.push(i);
  order.sort((a, b) => dabs[a + 2] - dabs[b + 2]);
  const alt = { mapleR: 'mapleO', mapleO: 'mapleR', oak: 'mapleO', birch: 'turn', turn: 'birch' }[pal] || pal;
  const varied = rnd() * 0.12;
  for (const i of order) {
    const x = dabs[i], y = dabs[i + 1], lum = dabs[i + 3];
    const t = clamp(lum * 0.92 - 0.04 + varied + (rnd() - 0.5) * 0.16, 0.02, 0.9);
    const name = rnd() < 0.07 ? alt : pal;
    g.fillStyle = palColor(name, t);
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * TAU);
    const L = (10 + rnd() * 8) * sc, w = L * (0.5 + rnd() * 0.2);
    g.beginPath(); g.ellipse(0, 0, L / 2, w / 2, 0, 0, TAU); g.fill();
    g.restore();
  }
  // sunlit leaf tips on the clumps that face the sun
  for (let k = 0; k < 260 * dabsK; k++) {
    const a = rnd() * TAU, rr = Math.sqrt(rnd()) * R * 0.95;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const [, c, d] = crownH(x, y);
    if (!c || d > 0.85) continue;
    const facing = -((x - c.x) * LIGHT[0] + (y - c.y) * LIGHT[1]) / c.r;
    if (facing > -0.25 || rnd() < 0.4) continue;
    g.fillStyle = palColor(pal, 0.78 + rnd() * 0.17, 1, 0.85);
    g.beginPath(); g.ellipse(x, y, 4 * sc, 2 * sc, rnd() * TAU, 0, TAU); g.fill();
  }
}

// Fir / spruce from above: a star of drooping branches, each covered with short needles
function paintFir(g, S, rnd) {
  // Tiers of drooping branches, outer and lowest first; each tier is a ragged star of branch tips
  const R = S * 0.34, sc = S / 512;
  g.translate(S / 2, S / 2);
  g.lineCap = 'round';
  const TIERS = 5;
  g.fillStyle = palColor('fir', 0.02, 0.7);
  g.beginPath(); g.arc(0, 0, R * 0.8, 0, TAU); g.fill();
  for (let ti = 0; ti < TIERS; ti++) {
    const Rt = R * (1 - ti * 0.17), k = 7 + Math.floor(rnd() * 3) + (TIERS - ti), ph = rnd() * TAU;
    const ox = (rnd() - 0.5) * 10 * sc, oy = (rnd() - 0.5) * 10 * sc;
    const tipJ = Array.from({ length: k }, () => 0.75 + rnd() * 0.35);
    const rimAt = th => {
      const x = (th + ph) / TAU * k, i = Math.floor(x), f = x - i;
      const j = tipJ[((i % k) + k) % k];
      return Rt * (0.55 + 0.45 * j * Math.pow(Math.sin(f * Math.PI), 0.6));
    };
    const needles = [];
    const N = Math.round(2400 * (1 - ti * 0.12));
    for (let n = 0; n < N; n++) {
      const th = rnd() * TAU, rr = (0.25 + 0.75 * Math.sqrt(rnd())) * Rt * 1.02, u = rr / rimAt(th);
      if (u > 1.04 || (u > 0.95 && rnd() < 0.5)) continue;
      const branch = Math.pow(Math.sin(((th + ph) / TAU * k % 1) * Math.PI), 2) * 0.6 + rnd() * 0.4;
      const c = Math.cos(th), s = Math.sin(th);
      const dir = 0.5 + 0.5 * ((c * LIGHT[0] + s * LIGHT[1]) * 0.75 + LIGHT[2] * 0.66);
      const lum = (0.25 + 0.75 * dir) * (0.45 + 0.55 * branch) * (0.6 + 0.4 * (1 - u)) * (0.75 + 0.25 * ti / (TIERS - 1)) + 0.08 * ti / TIERS;
      needles.push(th, rr, lum);
    }
    for (let i = 0; i < needles.length; i += 3) {
      const th = needles[i], rr = needles[i + 1], lum = needles[i + 2];
      const x = Math.cos(th) * rr + ox, y = Math.sin(th) * rr + oy, a = th + (rnd() - 0.5) * 1.3, L = (6 + rnd() * 6) * sc;
      g.strokeStyle = palColor('fir', clamp(lum + (rnd() - 0.5) * 0.12, 0.03, 0.82));
      g.lineWidth = 2.4 * sc;
      g.beginPath(); g.moveTo(x - Math.cos(a) * L / 2, y - Math.sin(a) * L / 2); g.lineTo(x + Math.cos(a) * L / 2, y + Math.sin(a) * L / 2); g.stroke();
    }
  }
  // the top: a loose tuft of young, lighter needles instead of a hard centre
  for (let n = 0; n < 160; n++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * R * 0.22, L = (5 + rnd() * 5) * sc;
    const x = Math.cos(a) * d - 2 * sc, y = Math.sin(a) * d - 3 * sc, b = a + (rnd() - 0.5);
    g.strokeStyle = palColor('fir', 0.55 + rnd() * 0.3, 1, 0.9); g.lineWidth = 2 * sc;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * L, y + Math.sin(b) * L); g.stroke();
  }
}

function paintLeafSprite(g, S, kind, pal, t, rnd) {
  g.translate(S / 2, S / 2);
  g.rotate(-0.5);
  const L = S * 0.78;
  leafPath(g, kind, L);
  const grad = g.createLinearGradient(-L / 2, -L / 3, L / 2, L / 3);
  grad.addColorStop(0, palColor(pal, t + 0.12));
  grad.addColorStop(1, palColor(pal, t - 0.12));
  g.fillStyle = grad; g.fill();
  g.strokeStyle = palColor(pal, t - 0.35, 1, 0.55); g.lineWidth = S * 0.02;
  g.beginPath(); g.moveTo(-L * 0.55, 0); g.lineTo(L * 0.42, 0); g.stroke();
  if (kind === 1) for (const a of [0.95, -0.95]) { g.beginPath(); g.moveTo(-L * 0.05, 0); g.lineTo(Math.cos(a) * L * 0.36, Math.sin(a) * L * 0.36); g.stroke(); }
}

function paintFern(g, S, rnd, warm) {
  const sc = S / 256;
  g.translate(S / 2, S / 2);
  const n = 12 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + (rnd() - 0.5) * 0.5, len = S * (0.24 + rnd() * 0.16), bend = (rnd() - 0.5) * 0.9;
    const lit = 0.5 + 0.5 * (Math.cos(a) * -0.6 + Math.sin(a) * -0.7);
    const pal = warm ? (rnd() < 0.5 ? 'oak' : 'birch') : 'turn';
    for (let j = 2; j < 22; j++) {
      const t = j / 22, x = Math.cos(a + bend * t) * len * t, y = Math.sin(a + bend * t) * len * t;
      const pl = (1 - t) * 11 * sc + 2.5 * sc, dir = a + bend * t;
      for (const side of [-1, 1]) {
        g.fillStyle = palColor(pal, clamp(0.35 + lit * 0.45 + (rnd() - 0.5) * 0.15 - t * 0.1, 0.05, 0.95));
        g.save(); g.translate(x, y); g.rotate(dir + side * 1.15);
        g.beginPath(); g.ellipse(pl / 2, 0, pl / 2, pl * 0.2, 0, 0, TAU); g.fill(); g.restore();
      }
    }
  }
}
function paintStone(g, S, rnd) {
  const sc = S / 256, R = S * 0.3;
  g.translate(S / 2, S / 2);
  const pts = [];
  for (let i = 0; i < 11; i++) { const a = i / 11 * TAU, r = R * (0.78 + rnd() * 0.3); pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.82]); }
  const path = () => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
  path();
  const grad = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.15);
  grad.addColorStop(0, '#a39c90'); grad.addColorStop(0.55, '#6e685f'); grad.addColorStop(1, '#3a3530');
  g.fillStyle = grad; g.fill();
  g.save(); path(); g.clip();
  for (let k = 0; k < 260; k++) {
    const x = (rnd() - 0.5) * R * 2, y = (rnd() - 0.5) * R * 2;
    if (y > -R * 0.05 + x * 0.2 && rnd() < 0.8) continue;
    g.fillStyle = palColor('turn', 0.3 + rnd() * 0.35, 1, 0.85);
    g.beginPath(); g.arc(x, y, (2 + rnd() * 4) * sc, 0, TAU); g.fill();
  }
  g.restore();
  g.strokeStyle = 'rgba(30,24,20,.5)'; g.lineWidth = 2 * sc; path(); g.stroke();
}
function paintLog(g, S, rnd) {
  const sc = S / 256, L = S * 0.78, Wd = S * 0.16;
  g.translate(S / 2, S / 2);
  g.rotate(-0.35);
  const body = () => { g.beginPath(); g.roundRect(-L / 2, -Wd / 2, L, Wd, Wd / 2); };
  body();
  const grad = g.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
  grad.addColorStop(0, '#9a6a3e'); grad.addColorStop(0.45, '#6a4527'); grad.addColorStop(1, '#2e1d10');
  g.fillStyle = grad; g.fill();
  g.save(); body(); g.clip();
  g.strokeStyle = 'rgba(30,18,8,.55)'; g.lineWidth = 2.2 * sc;
  for (let k = 0; k < 26; k++) { const y = (rnd() - 0.5) * Wd, x = (rnd() - 0.5) * L; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (20 + rnd() * 50) * sc, y + (rnd() - 0.5) * 3 * sc); g.stroke(); }
  for (let k = 0; k < 120; k++) {
    const x = (rnd() - 0.5) * L * 0.8, y = -Wd * 0.3 + (rnd() - 0.5) * Wd * 0.4;
    g.fillStyle = palColor('turn', 0.3 + rnd() * 0.4, 1, 0.9);
    g.beginPath(); g.arc(x, y, (2 + rnd() * 3.5) * sc, 0, TAU); g.fill();
  }
  g.restore();
  g.fillStyle = '#c99c62';
  g.beginPath(); g.ellipse(L / 2 - Wd * 0.18, 0, Wd * 0.2, Wd / 2 - 1, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(110,70,35,.6)'; g.lineWidth = 1.4 * sc;
  for (let r = 0.25; r < 1; r += 0.25) { g.beginPath(); g.ellipse(L / 2 - Wd * 0.18, 0, Wd * 0.2 * r, (Wd / 2 - 1) * r, 0, 0, TAU); g.stroke(); }
}
function paintMushrooms(g, S, rnd, red) {
  const sc = S / 256;
  g.translate(S / 2, S / 2);
  const n = 3 + Math.floor(rnd() * 3);
  const caps = [];
  for (let i = 0; i < n; i++) caps.push([(rnd() - 0.5) * S * 0.3, (rnd() - 0.5) * S * 0.3, (12 + rnd() * 16) * sc]);
  caps.sort((a, b) => a[2] - b[2]);
  for (const [x, y, r] of caps) {
    const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    if (red) { grad.addColorStop(0, '#ff7a52'); grad.addColorStop(0.6, '#d1301d'); grad.addColorStop(1, '#7a1209'); }
    else { grad.addColorStop(0, '#d9a96a'); grad.addColorStop(0.6, '#9a6332'); grad.addColorStop(1, '#4e2d14'); }
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (red) {
      g.fillStyle = 'rgba(255,250,235,.95)';
      for (let k = 0; k < 7; k++) { const a = rnd() * TAU, d = rnd() * r * 0.75; g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, (1.6 + rnd() * 2.2) * sc, 0, TAU); g.fill(); }
    }
  }
}
function paintLeafPile(g, S, rnd) {
  g.translate(S / 2, S / 2);
  const pals = ['mapleR', 'mapleO', 'oak', 'birch'];
  for (let k = 0; k < 90; k++) {
    const a = rnd() * TAU, d = Math.abs(rnd() + rnd() - 1) * S * 0.3;
    g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(rnd() * TAU);
    const L = S * (0.07 + rnd() * 0.05), kind = Math.floor(rnd() * 3);
    leafPath(g, kind, L);
    g.fillStyle = palColor(pals[k % 4], 0.35 + rnd() * 0.45 * (1 - d / (S * 0.3)) + 0.1);
    g.fill(); g.restore();
  }
}

// Fox seen from above, facing +x. f: walk phase (radians) or null for sitting.
function paintFox(g, S, f) {
  const u = S / 128;
  g.translate(S / 2, S / 2);
  g.scale(u, u);
  const ORANGE = '#c85a22', LIGHTO = '#e9883b', DARK = '#2a1a12', CREAM = '#f2e4cc';
  const leg = (x, y, dx, dy) => { g.strokeStyle = DARK; g.lineWidth = 4.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke(); };
  const tail = (pts, w) => {
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1), [x, y] = pts[i];
      const r = w * (0.55 + Math.sin(Math.min(t * 1.25, 1) * Math.PI * 0.9) * 0.6);
      g.fillStyle = t > 0.8 ? CREAM : t > 0.72 ? '#d9b08a' : (i % 2 ? ORANGE : '#b9501d');
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    for (let i = 1; i < pts.length * 0.75; i++) {
      const [x, y] = pts[i];
      g.fillStyle = 'rgba(240,150,80,.5)';
      g.beginPath(); g.arc(x - 0.6, y - 1, w * 0.35, 0, TAU); g.fill();
    }
  };
  if (f === null) {
    // sitting: compact body, tail wrapped round the side
    leg(19, -4.5, 7, -0.5); leg(19, 4.5, 7, 0.5);
    const pts = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16, a = Math.PI * (1.0 + t * 0.95); pts.push([-6 + Math.cos(a) * 15 + t * 10, 3 + Math.sin(a) * -15 * 0.9 + t * 4]); }
    g.fillStyle = ORANGE; g.beginPath(); g.ellipse(-2, 0, 17, 13, 0, 0, TAU); g.fill();
    g.fillStyle = LIGHTO; g.beginPath(); g.ellipse(-3, -1, 12, 6, 0, 0, TAU); g.fill();
    tail(pts.map(([x, y]) => [x, -y]), 5.5);
    var hx = 17;
  } else {
    const s1 = Math.sin(f), s2 = Math.sin(f + Math.PI), bob = Math.sin(f * 2) * 0.5;
    // legs: dark lower legs swinging fore and aft, sticking out past the flanks
    leg(15, -8, s1 * 10 + 3, -6); leg(15, 8, s2 * 10 + 3, 6);
    leg(-13, -8, s2 * 10 - 3, -6); leg(-13, 8, s1 * 10 - 3, 6);
    // bushy tail with a white tip, swinging with the stride
    const sway = Math.sin(f) * 0.2;
    const pts = [];
    for (let i = 0; i <= 22; i++) { const t = i / 22, a = sway * t * 1.5 + Math.sin(f * 0.5 + t * 2) * 0.06; pts.push([-20 - t * 38, Math.sin(a) * t * 30]); }
    tail(pts, 8.5);
    // body: deep chest, narrow waist, rounded haunches (thighs in orange over the legs)
    g.fillStyle = '#b44d1b';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(-13, s * 7.5, 8, 5.5, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(15, s * 7, 6.5, 4.6, 0, 0, TAU); g.fill(); }
    g.fillStyle = ORANGE;
    g.beginPath();
    g.moveTo(-24, bob);
    g.bezierCurveTo(-22, -12 + bob, 0, -12.5 + bob, 14, -11 + bob);
    g.bezierCurveTo(22, -10 + bob, 26, -6 + bob, 27, bob);
    g.bezierCurveTo(26, 6 + bob, 22, 10 + bob, 14, 11 + bob);
    g.bezierCurveTo(0, 12.5 + bob, -22, 12 + bob, -24, bob);
    g.fill();
    // fur shading along the spine and the shoulders
    g.fillStyle = LIGHTO; g.beginPath(); g.ellipse(1, bob - 0.5, 20, 5.2, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,190,120,.45)'; g.beginPath(); g.ellipse(-2, bob - 1.2, 13, 2.4, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(120,45,15,.35)'; g.lineWidth = 0.8;
    for (let k = 0; k < 22; k++) { const x = -20 + k * 2, s = k % 2 ? 1 : -1; g.beginPath(); g.moveTo(x, s * (6 + (k % 3))); g.lineTo(x - 2.5, s * (9 + (k % 3))); g.stroke(); }
    var hx = 31;
  }
  // head: skull, cream cheeks, tapered snout with a black nose, dark-tipped ears
  g.fillStyle = CREAM; g.beginPath(); g.ellipse(hx + 2, 0, 8, 9.5, 0, 0, TAU); g.fill();
  g.fillStyle = ORANGE; g.beginPath(); g.ellipse(hx, 0, 8.5, 7.5, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(hx + 4, -5); g.quadraticCurveTo(hx + 13, -2.2, hx + 17, 0); g.quadraticCurveTo(hx + 13, 2.2, hx + 4, 5); g.closePath(); g.fill();
  g.fillStyle = LIGHTO; g.beginPath(); g.ellipse(hx + 2, -1, 5, 3, 0, 0, TAU); g.fill();
  g.fillStyle = '#140d09'; g.beginPath(); g.arc(hx + 16.5, 0, 1.7, 0, TAU); g.fill();
  for (const s of [-1, 1]) {
    g.fillStyle = DARK;
    g.beginPath(); g.moveTo(hx - 3, s * 3); g.lineTo(hx - 10, s * 9.5); g.lineTo(hx + 1, s * 7.5); g.closePath(); g.fill();
    g.fillStyle = '#7a3a18';
    g.beginPath(); g.moveTo(hx - 2.5, s * 3.6); g.lineTo(hx - 7, s * 7.6); g.lineTo(hx, s * 6.6); g.closePath(); g.fill();
    g.fillStyle = '#1a120c'; g.beginPath(); g.arc(hx + 5, s * 3.6, 1.1, 0, TAU); g.fill();
  }
}

// Red squirrel from above, facing +x. pose: 0 sit, 1 crouch, 2 leap
function paintSquirrel(g, S, pose) {
  const u = S / 64;
  g.translate(S / 2, S / 2);
  g.scale(u, u);
  const BODY = '#9c4a20', BACK = '#c26a32', DARK = '#3a1d0e';
  const tailC = pose === 2 ? [-17, 0, 10, 4.2] : pose === 1 ? [-11, 0, 8, 7.2] : [-10, 0, 8.5, 7.8];
  g.fillStyle = DARK;
  if (pose === 2) { for (const s of [-1, 1]) { g.fillRect(12, s * 3 - 0.8, 6, 1.6); g.fillRect(-11, s * 4 - 0.9, 5, 1.8); } }
  // tail: fluffy plume
  const [tx, ty, trx, try_] = tailC;
  for (let k = 0; k < 40; k++) {
    const a = k / 40 * TAU, r = 0.75 + 0.25 * Math.sin(k * 2.3);
    g.fillStyle = k % 3 ? '#b55a28' : '#dd9a5a';
    g.beginPath(); g.arc(tx + Math.cos(a) * trx * r * 0.8, ty + Math.sin(a) * try_ * r * 0.8, 2.6, 0, TAU); g.fill();
  }
  g.fillStyle = '#a8522a'; g.beginPath(); g.ellipse(tx, ty, trx * 0.75, try_ * 0.72, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(70,30,10,.55)'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(tx + 1, ty, trx * 0.4, try_ * 0.38, 0, 0.5, 5.6); g.stroke();
  const brx = pose === 2 ? 11 : pose === 1 ? 8 : 8.6, bry = pose === 2 ? 4.4 : 5.6;
  g.fillStyle = BODY; g.beginPath(); g.ellipse(1, 0, brx, bry, 0, 0, TAU); g.fill();
  g.fillStyle = BACK; g.beginPath(); g.ellipse(0.5, -0.4, brx * 0.7, bry * 0.45, 0, 0, TAU); g.fill();
  const hx = pose === 2 ? 13 : 10.5;
  g.fillStyle = BODY; g.beginPath(); g.ellipse(hx, 0, 4.8, 4.2, 0, 0, TAU); g.fill();
  g.fillStyle = '#e8c9a0'; g.beginPath(); g.ellipse(hx + 2.6, 0, 2.2, 2.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#1a0f08'; g.beginPath(); g.arc(hx + 4.6, 0, 0.8, 0, TAU); g.fill();
  for (const s of [-1, 1]) {
    g.fillStyle = DARK; g.beginPath(); g.moveTo(hx - 1.5, s * 2.2); g.lineTo(hx - 4.5, s * 5.2); g.lineTo(hx + 0.6, s * 3.6); g.closePath(); g.fill();
    g.fillStyle = '#120a06'; g.beginPath(); g.arc(hx + 1.6, s * 2.2, 0.7, 0, TAU); g.fill();
  }
}

// Small corvid from above, facing +x, wingspan factor k in [0, 1]
function paintBird(g, S, k) {
  const u = S / 64;
  g.translate(S / 2, S / 2);
  g.scale(u, u);
  // broad, rounded wings with fingered primaries; span shrinks when the wings are up or down
  const span = 5 + 21 * k, wrist = span * 0.5, sweep = 3 + 3 * (1 - k);
  for (const s of [-1, 1]) {
    const y = v => s * (2.5 + v);
    g.fillStyle = '#26211e';
    g.beginPath();
    g.moveTo(4, y(0));
    g.quadraticCurveTo(5, y(wrist * 0.6), 1.5, y(wrist));                  // leading edge to the wrist
    g.quadraticCurveTo(-1, y(span * 0.85), -sweep - 2, y(span));            // hand
    for (let i = 0; i < 4; i++) {                                            // finger notches
      const t = i / 4, fx = -sweep - 2 - t * 4.5, fy = span - t * span * 0.16;
      g.lineTo(fx - 1.6, y(fy - 1.4)); g.lineTo(fx - 2.2, y(fy - span * 0.04));
    }
    g.quadraticCurveTo(-9, y(wrist * 0.9), -9, y(wrist * 0.4));             // trailing edge
    g.lineTo(-7, y(0));
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(125,112,100,.5)';                                    // lighter coverts
    g.beginPath(); g.moveTo(3, y(0.5)); g.quadraticCurveTo(3.5, y(wrist * 0.55), 1, y(wrist * 0.9));
    g.quadraticCurveTo(-3, y(wrist * 0.7), -4, y(0.5)); g.closePath(); g.fill();
  }
  g.fillStyle = '#2c2622';
  g.beginPath(); g.moveTo(-8, -1.6); g.lineTo(-15, -3.6); g.lineTo(-15, 3.6); g.lineTo(-8, 1.6); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(0, 0, 8.5, 3.3, 0, 0, TAU); g.fill();
  g.beginPath(); g.arc(8.6, 0, 3, 0, TAU); g.fill();
  g.fillStyle = '#4a4038'; g.beginPath(); g.moveTo(11, -1); g.lineTo(14, 0); g.lineTo(11, 1); g.closePath(); g.fill();
}

// Forest-floor tile: earth, layers of fallen leaves with soft contact shadows, twigs. Seamless.
function paintLitter(S) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(0x7a11e7);
  g.fillStyle = '#3a2716'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 5000; k++) {
    const v = rnd(); g.fillStyle = v < 0.5 ? `rgba(20,12,6,${0.25 + rnd() * 0.3})` : `rgba(110,80,50,${0.12 + rnd() * 0.2})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  const wrap = (x, y, r, fn) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox < -r || x + ox > S + r || y + oy < -r || y + oy > S + r) continue;
      g.save(); g.translate(x + ox, y + oy); fn(); g.restore();
    }
  };
  for (let k = 0; k < 34; k++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * TAU, L = 20 + rnd() * 45;
    wrap(x, y, L, () => { g.rotate(a); g.strokeStyle = 'rgba(28,18,10,.85)'; g.lineWidth = 1.6 + rnd() * 1.4; g.beginPath(); g.moveTo(-L / 2, 0); g.quadraticCurveTo(0, (rnd() - 0.5) * 8, L / 2, (rnd() - 0.5) * 6); g.stroke(); });
  }
  const pals = ['mapleR', 'mapleO', 'oak', 'oak', 'birch', 'mapleO'];
  for (let k = 0; k < 1900; k++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * TAU, L = 11 + rnd() * 15, kind = Math.floor(rnd() * 3);
    const pal = pals[Math.floor(rnd() * pals.length)], t = 0.25 + rnd() * 0.5, age = 0.62 + rnd() * 0.36;
    wrap(x, y, L, () => {
      g.rotate(a);
      g.save(); g.translate(1.6, 2.2); leafPath(g, kind, L); g.fillStyle = 'rgba(15,8,3,.38)'; g.fill(); g.restore();
      leafPath(g, kind, L); g.fillStyle = palColor(pal, t, age); g.fill();
      g.strokeStyle = palColor(pal, t - 0.25, age * 0.8, 0.6); g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(-L * 0.45, 0); g.lineTo(L * 0.4, 0); g.stroke();
    });
  }
  return cv;
}

const SPR = { crowns: [], firs: [], leaves: [], decor: [], fox: [], foxSit: null, squirrel: [], bird: [] };
let paintMs = 0;
function paintAll() {
  const t0 = performance.now();
  const rnd = mulberry32(0xf0e57);
  const CROWNS = ['mapleR', 'mapleR', 'mapleR', 'mapleO', 'mapleO', 'mapleO', 'oak', 'oak', 'oak', 'birch', 'birch', 'birch', 'turn', 'turn'];
  for (const pal of CROWNS) SPR.crowns.push({ uv: paintSprite(256, (g, S) => paintCrown(g, S, pal, rnd)), pal, r: 0.36 });
  for (let i = 0; i < 2; i++) SPR.firs.push({ uv: paintSprite(256, (g, S) => paintFir(g, S, rnd)), pal: 'fir', r: 0.34 });
  const D = SPR.decor;
  D.push({ uv: paintSprite(128, (g, S) => paintFern(g, S, rnd, true)), kind: 'fern', size: 46 });
  D.push({ uv: paintSprite(128, (g, S) => paintFern(g, S, rnd, false)), kind: 'fern', size: 44 });
  D.push({ uv: paintSprite(128, (g, S) => paintStone(g, S, rnd)), kind: 'stone', size: 28 });
  D.push({ uv: paintSprite(128, (g, S) => paintStone(g, S, rnd)), kind: 'stone', size: 22 });
  D.push({ uv: paintSprite(128, (g, S) => paintLog(g, S, rnd)), kind: 'log', size: 96 });
  D.push({ uv: paintSprite(128, (g, S) => paintMushrooms(g, S, rnd, true)), kind: 'mush', size: 34 });
  D.push({ uv: paintSprite(128, (g, S) => paintMushrooms(g, S, rnd, false)), kind: 'mush', size: 32 });
  D.push({ uv: paintSprite(128, (g, S) => paintCrown(g, S, 'mapleO', rnd, 0.38, 0.45)), kind: 'bush', size: 70 });
  D.push({ uv: paintSprite(128, (g, S) => paintCrown(g, S, 'birch', rnd, 0.38, 0.45)), kind: 'bush', size: 62 });
  D.push({ uv: paintSprite(128, (g, S) => paintLeafPile(g, S, rnd)), kind: 'pile', size: 58 });
  for (let i = 0; i < 8; i++) SPR.fox.push(paintSprite(128, (g, S) => paintFox(g, S, i / 8 * TAU)));
  SPR.foxSit = paintSprite(128, (g, S) => paintFox(g, S, null));
  for (let i = 0; i < 3; i++) SPR.squirrel.push(paintSprite(64, (g, S) => paintSquirrel(g, S, i)));
  for (let i = 0; i < 8; i++) SPR.bird.push(paintSprite(64, (g, S) => paintBird(g, S, 0.15 + 0.85 * Math.abs(Math.cos(i / 8 * Math.PI)))));
  const LEAVES = [[1, 'mapleR', 0.55], [1, 'mapleO', 0.6], [1, 'mapleO', 0.75], [0, 'birch', 0.65], [0, 'birch', 0.8], [2, 'oak', 0.55], [2, 'oak', 0.7], [1, 'mapleR', 0.7], [0, 'turn', 0.7], [2, 'mapleO', 0.5]];
  for (const [kind, pal, t] of LEAVES) SPR.leaves.push(paintSprite(48, (g, S) => paintLeafSprite(g, S, kind, pal, t, rnd)));
  paintMs = performance.now() - t0;
}

/* ======================================================================
   Shaders
   ====================================================================== */
const COMMON = `
uniform sampler2D uNoise;
uniform float uSeed, uTime, uWindT;
float hash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec4 N(vec2 p, float scale) { return texture(uNoise, p / scale + uSeed * 0.013); }
// Large, slow cloud shadows drifting over the whole forest
float cloudShade(vec2 p) {
  vec2 q = p + vec2(uTime * 9.0, uTime * 3.5);
  float c = N(q, 2600.0).r * 0.65 + N(q + 500.0, 1100.0).g * 0.35;
  return 1.0 - 0.2 * ss(0.5, 0.78, c);
}`;

const FULL_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GROUND_FS = `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D uFA, uFB, uLitter, uShadow;
uniform vec2 uRes, uGrid, uCanvas;
uniform float uScale, uStep, uMix, uDebug, uGroundImg, uGroundScale;
out vec4 o;
float fieldS(sampler2D t, vec2 p) { return texture(t, (p / uStep + 0.5) / uGrid).r; }
vec3 litter(vec2 p) {
  float k = uGroundImg > 0.5 ? uGroundScale : 300.0;
  vec3 a = texture(uLitter, p / k).rgb;
  vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * p;
  vec3 b = texture(uLitter, r / (k * 1.13) + 0.37).rgb;
  vec3 l = mix(a, b, ss(0.38, 0.62, N(p, 520.0).r));
  // calm the leaf confetti so icons stay readable: pull towards the tile's average colour
  vec3 avg = textureLod(uLitter, vec2(0.5), 9.0).rgb;
  return mix(l, avg, uGroundImg > 0.5 ? 0.12 : 0.3);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float s = mix(fieldS(uFA, p), fieldS(uFB, p), uMix);
  vec3 col = litter(p);
  // big patches: warmer and cooler areas of the floor
  float v = N(p + 211.0, 1500.0).g;
  col *= mix(vec3(1.08, 0.97, 0.84), vec3(0.88, 0.95, 1.0), ss(0.3, 0.7, v));
  // moss and short grass inside the clearings
  float inner = ss(-15.0, -85.0, s);
  float moss = ss(0.5, 0.72, N(p + 411.0, 640.0).b) * inner;
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  vec3 mossC = vec3(0.36, 0.42, 0.17) * (0.55 + 1.3 * lum);
  col = mix(col, mossC, moss * 0.4 * ss(0.25, 0.6, N(p * 3.1, 90.0).g));
  // the clearing is sunlit and warm; under the canopy it is dark and cool
  float under = ss(-6.0, 60.0, s);
  col *= mix(vec3(1.16, 1.07, 0.94), vec3(0.42, 0.33, 0.27), under);
  col *= 1.0 - 0.28 * ss(-90.0, -4.0, s) * (1.0 - under);
  // shadows of crowns, decor, animals and falling leaves
  float sh = texture(uShadow, gl_FragCoord.xy / uCanvas).g;
  col *= mix(vec3(1.0), vec3(0.42, 0.36, 0.4), sh);
  // sun flecks through the leaves, slowly shifting with the wind
  vec2 q = p + vec2(sin(uWindT * 0.35) * 14.0, cos(uWindT * 0.29) * 10.0);
  float fleck = ss(0.66, 0.74, N(q, 150.0).r * 0.7 + N(q + 77.0, 60.0).g * 0.3);
  col += vec3(0.23, 0.16, 0.07) * fleck * ss(-160.0, -20.0, s) * (1.0 - sh) * 0.55;
  col *= cloudShade(p);
  col *= 1.0 + (hash2(floor(p * 1.3)) - 0.5) * 0.04;
  if (uDebug > 0.5) col = mix(col, vec3(1.0, 0.2, 0.1), 1.0 - ss(0.0, 2.0, abs(s)));
  o = vec4(col, 1.0);
}`;

const SPRITE_VS = `#version 300 es
layout(location = 0) in vec4 iPos;
layout(location = 1) in vec2 iRot;
layout(location = 2) in vec4 iUV;
layout(location = 3) in vec4 iCol;
uniform vec2 uRes, uShadowOff;
uniform float uMode;
out vec2 vUV, vW, vC;
out vec4 vCol;
out float vLift;
void main() {
  int id = gl_VertexID;
  vec2 c = vec2((id == 1 || id == 2 || id == 4) ? 1.0 : 0.0, (id == 2 || id == 4 || id == 5) ? 1.0 : 0.0);
  vec2 l = (c - 0.5) * iPos.zw;
  float s = sin(iRot.x), co = cos(iRot.x);
  vec2 w = iPos.xy + vec2(co * l.x - s * l.y, s * l.x + co * l.y);
  if (uMode > 0.5) w += uShadowOff * iRot.y;
  vW = w;
  vC = c - 0.5;
  vLift = iRot.y;
  vUV = mix(iUV.xy, iUV.zw, c);
  vCol = iCol;
  gl_Position = vec4(w.x / uRes.x * 2.0 - 1.0, 1.0 - w.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D uAtlas, uShadow;
uniform vec2 uCanvas;
uniform float uMode, uShadeK;
in vec2 vUV, vW, vC;
in vec4 vCol;
in float vLift;
out vec4 o;
// Height of this sprite's surface: crowns are domes, everything else is flat at its lift
float surfaceH() {
  float dome = sqrt(max(0.0, 1.0 - dot(vC, vC) / (0.37 * 0.37)));
  return vLift * mix(1.0, 0.62 + 0.38 * dome, step(0.3, vLift));
}
void main() {
  if (uMode > 1.5) { float a = texture(uAtlas, vUV, 2.5).a * vCol.a; o = vec4(0.0, 0.0, 0.0, a); return; }
  if (uMode > 0.5) {
    // shadow buffer: R = height of the caster (for shading lower crowns), G = shadow strength
    float a = texture(uAtlas, vUV, 2.0).a;
    o = vec4(surfaceH() * ss(0.05, 0.6, a), a * vCol.a, 0.0, 0.0);
    return;
  }
  vec4 t = texture(uAtlas, vUV);
  vec4 sv = texture(uShadow, gl_FragCoord.xy / uCanvas);
  float shade = ss(-0.03, 0.2, sv.r - surfaceH()) * sv.g * uShadeK;
  vec3 c = t.rgb * vCol.rgb * cloudShade(vW);
  c *= mix(vec3(1.0), vec3(0.5, 0.42, 0.42), shade);
  o = vec4(c, t.a) * vCol.a;
}`;

/* ======================================================================
   WebGL setup
   ====================================================================== */
const cv = document.getElementById('art');
const gl = cv.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) document.getElementById('nogl').style.display = 'grid';
function program(vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); throw new Error('shader'); }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
  const U = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); U[nm] = gl.getUniformLocation(p, nm); }
  return { p, U };
}
const GROUND = program(FULL_VS, GROUND_FS);
const SPRITE = program(SPRITE_VS, SPRITE_FS);
const emptyVAO = gl.createVertexArray();

function texFrom(src, repeat) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
}
let noiseTex = null, atlasTex = null, litterTex = null;
function buildNoiseTex() {
  const S = 256, d = new Uint8Array(S * S * 4);
  const chans = [[8, 16, 32, 64], [8, 16, 32, 64], [8, 16, 32], [16, 32, 64, 128]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    for (let c = 0; c < 4; c++) d[i + c] = clamp((tileFbm(u, v, chans[c], 100 + c * 50) - 0.5) * 1.9 + 0.5, 0, 1) * 255;
  }
  if (noiseTex) gl.deleteTexture(noiseTex);
  noiseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
}

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v; const x = u32[0];
  const sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >>> 13);
}
const ftex = [null, null];
let fromI = 0, toI = 0, morphT0 = -1e9, morphDur = MORPH_MS, FA = null, FB = null, curMix = 1;
function allocField() {
  for (let i = 0; i < 2; i++) {
    if (ftex[i]) gl.deleteTexture(ftex[i]);
    ftex[i] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, ftex[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, Gw, Gh, 0, gl.RED, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
}
function uploadField(i, Fd) {
  const d = new Uint16Array(Gw * Gh);
  for (let k = 0; k < d.length; k++) d[k] = toHalf(Fd.s[k]);
  gl.bindTexture(gl.TEXTURE_2D, ftex[i]);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Gw, Gh, gl.RED, gl.HALF_FLOAT, d);
}
let icons = [];
const iconRects = () => icons.map(ic => ({ cx: ic.x + ic.w / 2, cy: ic.y + ic.h / 2, hw: ic.w / 2 - 4, hh: ic.h / 2 - 2 }));
function commit(fromEmpty = false) {
  const nf = computeField(P.adaptive ? iconRects() : []);
  const target = 1 - toI;
  if (fromEmpty) { FA = computeField([]); uploadField(toI, FA); } else FA = FB;
  FB = nf;
  uploadField(target, FB);
  fromI = toI; toI = target;
  morphT0 = performance.now();
  morphDur = fromEmpty ? 2600 : MORPH_MS;
  layoutDirty = true;
}
function refresh() {
  FA = FB = computeField(P.adaptive ? iconRects() : []);
  uploadField(toI, FB);
  fromI = toI; morphT0 = -1e9;
  layoutDirty = true;
}
const curS = (x, y) => FB ? sampleArr(FA.s, x, y) * (1 - curMix) + sampleArr(FB.s, x, y) * curMix : 999;
const targetS = (x, y) => FB ? sampleArr(FB.s, x, y) : 999;
const nearIcon = (x, y, pad) => icons.some(ic => x > ic.x - pad && x < ic.x + ic.w + pad && y > ic.y - pad && y < ic.y + ic.h + pad);

// Shadow buffer: half resolution, MAX-blended coverage of everything that casts a shadow
let shadowFB = null, shadowTex = null, shW = 0, shH = 0;
function allocShadow() {
  shW = Math.max(1, cv.width >> 1); shH = Math.max(1, cv.height >> 1);
  if (shadowTex) gl.deleteTexture(shadowTex);
  if (!shadowFB) shadowFB = gl.createFramebuffer();
  shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, shW, shH);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Instanced sprites: one dynamic buffer, rebuilt every frame without allocations
const INST_F = 14, MAXI = 6000;
const inst = new Float32Array(MAXI * INST_F);
let nInst = 0;
const instBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
const spriteVAO = gl.createVertexArray();
gl.bindVertexArray(spriteVAO);
for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribDivisor(i, 1); }
function bindInst(start) {
  const b = start * INST_F * 4, st = INST_F * 4;
  gl.bindVertexArray(spriteVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, st, b);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, b + 16);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, b + 24);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, b + 40);
}
function push(x, y, w, h, rot, lift, uv, r, g, b, a) {
  if (nInst >= MAXI || a <= 0.003) return;
  const o = nInst++ * INST_F;
  inst[o] = x; inst[o + 1] = y; inst[o + 2] = w; inst[o + 3] = h; inst[o + 4] = rot; inst[o + 5] = lift;
  inst[o + 6] = uv[0]; inst[o + 7] = uv[1]; inst[o + 8] = uv[2]; inst[o + 9] = uv[3];
  inst[o + 10] = r; inst[o + 11] = g; inst[o + 12] = b; inst[o + 13] = a;
}
const SEGS = Array.from({ length: 8 }, () => ({ start: 0, count: 0 }));
let segN = 0;
const segBegin = () => { const s = SEGS[segN++]; s.start = nInst; return s; };
const segEnd = s => { s.count = nInst - s.start; };

/* ======================================================================
   World: trees, decor, animals, leaves, birds
   ====================================================================== */
let trees = [], decor = [], layoutDirty = true;
// Rendered crowns (tools/forest/render_trees.py) when present, the painted ones otherwise
const IMG_GROUPS = { mapleR: ['red', 'crimson'], mapleO: ['orange', 'rust'], oak: ['rust', 'amber'], birch: ['gold', 'amber'], turn: ['olive'], fir: ['fir'] };
function pickCrown(pal, rnd) {
  if (IMG.crowns) {
    const want = IMG_GROUPS[pal] || ['orange'];
    let opts = IMG.crowns.filter(c => want.includes(c.pal));
    if (!opts.length) opts = IMG.crowns.filter(c => c.pal !== 'fir');
    return opts[Math.floor(rnd() * opts.length)];
  }
  if (pal === 'fir') return SPR.firs[Math.floor(rnd() * SPR.firs.length)];
  const opts = SPR.crowns.filter(c => c.pal === pal);
  return opts[Math.floor(rnd() * opts.length)];
}
function placeWorld() {
  const rnd = mulberry32((seed ^ 0x51ed) >>> 0);
  trees = [];
  // rendered crowns carry fine leaf detail: fewer, larger trees keep each crown legible
  const G = IMG.crowns ? 74 : 60;
  for (let gy = -2; gy <= Math.ceil(H / G) + 2; gy++) for (let gx = -2; gx <= Math.ceil(W / G) + 2; gx++) {
    const x = (gx + 0.5 + (rnd() - 0.5) * 0.95) * G, y = (gy + 0.5 + (rnd() - 0.5) * 0.95) * G;
    const zone = fbm(x * 0.0021, y * 0.0021, 9), r = rnd();
    let sp;
    if (zone < 0.33 && r < 0.4) sp = pickCrown('fir', rnd);
    else {
      const band = zone < 0.42 ? ['turn', 'birch', 'oak'] : zone < 0.52 ? ['mapleO', 'oak', 'birch', 'mapleR'] : ['mapleR', 'mapleO', 'mapleR', 'birch'];
      const pal = r < 0.12 ? ['birch', 'oak', 'mapleO'][Math.floor(rnd() * 3)] : band[Math.floor(rnd() * band.length)];
      sp = pickCrown(pal, rnd);
    }
    const fir = sp.pal === 'fir';
    const R = IMG.crowns ? 64 + rnd() * 30 : fir ? 44 + rnd() * 14 : 50 + rnd() * 30;
    const Ht = fir ? 0.72 + rnd() * 0.2 : 0.5 + (R - 50) / 30 * 0.25 + rnd() * 0.12;
    // rendered crowns carry baked top-left sunlight, so they must not be rotated
    const rot = rnd() * TAU;
    trees.push({ x, y, R, H: Ht, sp, ph: rnd() * TAU, rot: sp.img ? 0 : rot, tint: sp.img ? 1.0 + rnd() * 0.14 : 0.8 + rnd() * 0.22, grow: 0, want: 0 });
  }
  trees.sort((a, b) => (a.y + a.R * 0.3) - (b.y + b.R * 0.3));
  decor = [];
  const GD = 70;
  for (let gy = -1; gy <= Math.ceil(H / GD) + 1; gy++) for (let gx = -1; gx <= Math.ceil(W / GD) + 1; gx++) {
    if (rnd() > 0.5) { rnd(); rnd(); rnd(); continue; }
    const x = (gx + 0.5 + (rnd() - 0.5) * 0.9) * GD, y = (gy + 0.5 + (rnd() - 0.5) * 0.9) * GD;
    const d = SPR.decor[Math.floor(rnd() * SPR.decor.length)];
    decor.push({ x, y, d, rot: rnd() * TAU, scale: 0.8 + rnd() * 0.45, grow: 0, want: 0 });
  }
  layoutDirty = true;
}
function updateWorldWants() {
  for (const t of trees) t.want = curS(t.x, t.y) > t.R * 0.62 ? 1 : 0;
  for (const o of decor) {
    const s = curS(o.x, o.y), r = o.d.size * o.scale * 0.5;
    const band = o.d.kind === 'fern' || o.d.kind === 'bush' ? s > -55 && s < -6 : o.d.kind === 'log' ? s > -70 && s < -25 : s > -110 && s < -10;
    o.want = band && !nearIcon(o.x, o.y, r + 4) ? 1 : 0;
  }
}

// Clearing points for animals to visit
function randomClearing(rnd, sMin, sMax, near, maxDist) {
  for (let k = 0; k < 60; k++) {
    let x, y;
    if (near) { const a = rnd() * TAU, d = 30 + rnd() * maxDist; x = near.x + Math.cos(a) * d; y = near.y + Math.sin(a) * d; }
    else { x = 30 + rnd() * (W - 60); y = 30 + rnd() * (H - 90); }
    if (x < 10 || y < 10 || x > W - 10 || y > H - 50) continue;
    const s = targetS(x, y);
    if (s > sMin && s < sMax && !nearIcon(x, y, 6)) return { x, y };
  }
  return null;
}

const arnd = Math.random;
const fox = { x: -200, y: -200, hd: 0, state: 'off', t: 0, phase: 0, tgt: null, speed: 40, look: 0 };
function stepFox(dt) {
  if (!P.showFox) { fox.state = 'off'; return; }
  if (fox.state === 'off') {
    const p = randomClearing(arnd, -400, -30, null, 0) || { x: W * 0.5, y: H * 0.5 };
    fox.x = p.x; fox.y = p.y; fox.hd = arnd() * TAU; fox.state = 'sit'; fox.t = 2 + arnd() * 3; return;
  }
  fox.t -= dt;
  if (fox.state === 'sit') {
    fox.look = Math.sin(performance.now() / 1700) * 0.25;
    if (fox.t <= 0) {
      fox.tgt = randomClearing(arnd, -400, -24, fox, 520) || randomClearing(arnd, -400, -24, null, 0);
      if (!fox.tgt) fox.tgt = { x: 60 + arnd() * (W - 120), y: 60 + arnd() * (H - 160) };
      fox.state = 'walk'; fox.speed = arnd() < 0.25 ? 72 : 42;
    }
    return;
  }
  const dx = fox.tgt.x - fox.x, dy = fox.tgt.y - fox.y, d = Math.hypot(dx, dy);
  let want = Math.atan2(dy, dx), diff = ((want - fox.hd + Math.PI * 3) % TAU) - Math.PI;
  fox.hd += clamp(diff, -1.8 * dt, 1.8 * dt);
  const v = fox.speed * (0.4 + 0.6 * Math.max(0, Math.cos(diff))) * sstep(0, 40, d);
  fox.x += Math.cos(fox.hd) * v * dt; fox.y += Math.sin(fox.hd) * v * dt;
  fox.phase += v * dt / (fox.speed > 60 ? 7.5 : 6.2);
  fox.look = 0;
  if (d < 14) { fox.state = 'sit'; fox.t = 4 + arnd() * 8; }
}

const squirrels = [{}, {}].map(() => ({ state: 'wait', t: 2 + arnd() * 8, x: 0, y: 0, hd: 0, hop: 0, hopFrom: null, hopTo: null, path: [], pose: 0, flick: 0 }));
function stepSquirrel(q, dt) {
  if (!P.showSquirrels && q.state !== 'wait') { q.state = 'wait'; q.leaving = false; q.t = 2; }
  q.t -= dt;
  if (q.state === 'wait') {
    if (q.t > 0 || !P.showSquirrels) return;
    const edge = randomClearing(arnd, -26, -6, null, 0);
    if (!edge) { q.t = 3; return; }
    // start hidden under the canopy, just outside the clearing edge
    let ox = 0, oy = 0;
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; const s = targetS(edge.x + Math.cos(a) * 40, edge.y + Math.sin(a) * 40); if (s > 30) { ox = Math.cos(a) * 46; oy = Math.sin(a) * 46; break; } }
    q.x = edge.x + ox; q.y = edge.y + oy;
    const inner = randomClearing(arnd, -400, -30, edge, 120) || edge;
    const second = arnd() < 0.5 ? randomClearing(arnd, -400, -30, inner, 90) : null;
    q.path = second ? [edge, inner, second] : [edge, inner];
    q.home = { x: q.x, y: q.y };
    q.state = 'hop'; q.hop = 1; q.t = 0;
    return;
  }
  if (q.state === 'idle') {
    q.flick += dt;
    q.pose = (Math.floor(q.flick * 2.4) % 5 === 0) ? 1 : 0;
    if (q.t <= 0) { q.state = 'hop'; q.path = [q.home]; q.hop = 1; q.leaving = true; }
    return;
  }
  // hopping along the path
  if (q.hop >= 1) {
    if (q.t > 0) { q.pose = 1; return; }                 // short pause between hops
    if (!q.path.length) {
      if (q.leaving) { q.state = 'wait'; q.leaving = false; q.t = 6 + arnd() * 12; }
      else { q.state = 'idle'; q.t = 4 + arnd() * 6; q.flick = 0; }
      return;
    }
    const tg = q.path[0], dx = tg.x - q.x, dy = tg.y - q.y, d = Math.hypot(dx, dy);
    if (d < 6) { q.path.shift(); return; }
    const L = Math.min(d, 24 + arnd() * 10);
    q.hd = Math.atan2(dy, dx);
    q.hopFrom = { x: q.x, y: q.y }; q.hopTo = { x: q.x + dx / d * L, y: q.y + dy / d * L };
    q.hop = 0;
  }
  q.hop = Math.min(1, q.hop + dt / 0.26);
  const e = q.hop;
  q.x = q.hopFrom.x + (q.hopTo.x - q.hopFrom.x) * e; q.y = q.hopFrom.y + (q.hopTo.y - q.hopFrom.y) * e;
  q.pose = e < 0.15 || e > 0.85 ? 1 : 2;
  if (q.hop >= 1) q.t = 0.08 + arnd() * 0.35;
}

const MAX_AIR = 60, MAX_LAND = 110;
const air = Array.from({ length: MAX_AIR }, () => ({ on: false }));
const land = Array.from({ length: MAX_LAND }, () => ({ on: false }));
let landNext = 0, leafAcc = 0;
function spawnLeaf(lf, anywhereY) {
  lf.on = true;
  lf.x = -80 + arnd() * (W + 80); lf.y = anywhereY ? arnd() * H : -40 + arnd() * (H + 40);
  lf.h = 0.75 + arnd() * 0.25; lf.fall = 0.06 + arnd() * 0.05;
  lf.rot = arnd() * TAU; lf.vr = (arnd() - 0.5) * 3; lf.tumble = 1.5 + arnd() * 2.5; lf.ph = arnd() * TAU;
  lf.spr = SPR.leaves[Math.floor(arnd() * SPR.leaves.length)]; lf.size = 15 + arnd() * 7; lf.a = 0;
}
function stepLeaves(dt, windT) {
  const want = Math.round(16 * P.leaves);
  let alive = 0;
  for (const lf of air) if (lf.on) alive++;
  leafAcc = Math.min(2, leafAcc + dt * want / 6);
  for (const lf of air) {
    if (!lf.on) {
      if (alive < want && leafAcc >= 1) { spawnLeaf(lf, false); leafAcc -= 1; alive++; }
      continue;
    }
    const gust = 0.6 + 0.6 * Math.sin(windT * 0.4 + lf.x * 0.004) * Math.sin(windT * 0.23 + 1.3);
    const wx = 26 * P.wind * gust + 10, wy = 9 * P.wind * gust + 4;
    lf.x += (wx + Math.sin(windT * 2.1 + lf.ph) * 16) * dt;
    lf.y += (wy + Math.cos(windT * 1.7 + lf.ph) * 9) * dt;
    lf.rot += lf.vr * dt;
    lf.h -= lf.fall * dt;
    lf.a = Math.min(1, lf.a + dt * 1.5);
    const s = curS(lf.x, lf.y);
    if (s > 4 && lf.h < 0.42) lf.a -= dt * 3;           // came down onto the canopy
    if (lf.a <= 0 || lf.x > W + 100 || lf.y > H + 100) { lf.on = false; continue; }
    if (lf.h <= 0) {
      lf.on = false;
      if (s < -4) {
        const d = land[landNext]; landNext = (landNext + 1) % MAX_LAND;
        d.on = true; d.x = lf.x; d.y = lf.y; d.rot = lf.rot; d.spr = lf.spr; d.size = lf.size; d.age = 0; d.life = 40 + arnd() * 50;
      }
    }
  }
  for (const d of land) if (d.on) { d.age += dt; if (d.age > d.life || curS(d.x, d.y) > 8) d.on = false; }
}

const flock = { on: false, next: 6 + arnd() * 12, birds: [], dir: 0, x: 0, y: 0, speed: 120 };
function stepBirds(dt) {
  if (!P.showBirds) { flock.on = false; return; }
  if (!flock.on) {
    flock.next -= dt;
    if (flock.next > 0) return;
    const fromLeft = arnd() < 0.7;
    flock.dir = (fromLeft ? 0 : Math.PI) + (arnd() - 0.5) * 0.9;
    const cx = W / 2 + (arnd() - 0.5) * W * 0.5, cy = H / 2 + (arnd() - 0.5) * H * 0.5, R = Math.hypot(W, H) * 0.6 + 100;
    flock.x = cx - Math.cos(flock.dir) * R; flock.y = cy - Math.sin(flock.dir) * R;
    flock.speed = 105 + arnd() * 40;
    const n = 4 + Math.floor(arnd() * 5);
    flock.birds = [];
    for (let i = 0; i < n; i++) {
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      flock.birds.push({ bx: -row * 30 + (arnd() - 0.5) * 12, by: side * row * 24 + (arnd() - 0.5) * 12, ph: arnd() * TAU, glide: 0, fx: 0, fy: 0, k: 1.8 + arnd() * 0.5 });
    }
    flock.on = true; flock.travel = 0; flock.R = R * 2 + 300;
    return;
  }
  flock.x += Math.cos(flock.dir) * flock.speed * dt; flock.y += Math.sin(flock.dir) * flock.speed * dt;
  flock.travel += flock.speed * dt;
  for (const b of flock.birds) {
    b.ph += dt * TAU * b.k * (b.glide > 0 ? 0 : 1);
    b.glide -= dt;
    if (b.glide < -2.5 && arnd() < dt * 0.5) b.glide = 0.6 + arnd() * 1.2;
    b.fx = Math.sin(performance.now() / 900 + b.k * 3) * 5; b.fy = Math.cos(performance.now() / 1100 + b.k) * 5;
  }
  if (flock.travel > flock.R) { flock.on = false; flock.next = 25 + arnd() * 40; }
}

/* ======================================================================
   Frame assembly
   ====================================================================== */
const SHADOW_OFF = [26, 34];
let windT = 0, flowT = 0;
function buildInstances(dt) {
  nInst = 0; segN = 0;
  const grow = (o, rate) => { o.grow += clamp(o.want - o.grow, -rate * dt, rate * dt); return o.grow * o.grow * (3 - 2 * o.grow); };
  const wind = P.wind;
  // 0: shadow casters (into the shadow buffer): crowns first (their own texture), then the rest
  const sShadowT = segBegin();
  for (const t of trees) {
    const g = grow(t, 1.1);
    t.g = g;
    if (g <= 0.001) continue;
    const sway = (0.012 + 0.018 * wind) * Math.sin(windT * 0.9 + t.ph) * (0.6 + 0.4 * Math.sin(windT * 0.31 + t.x * 0.01));
    t.sway = t.sp.img ? sway * 0.5 : sway;
    const D = t.R / t.sp.r * g;
    push(t.x + sway * t.R * 0.4, t.y + sway * t.R * 0.15, D, D, t.rot + t.sway, t.H * g, t.sp.uv, 1, 1, 1, 0.85);
  }
  segEnd(sShadowT);
  const sShadow = segBegin();
  for (const o of decor) {
    const g = grow(o, 1.4); o.g = g;
    if (g <= 0.001) continue;
    const D = o.d.size * o.scale * 2 * g;
    push(o.x, o.y, D, D, o.rot, o.d.kind === 'bush' ? 0.16 : o.d.kind === 'log' ? 0.08 : 0.05, o.d.uv, 1, 1, 1, 0.7);
  }
  if (fox.state !== 'off') {
    const uv = fox.state === 'sit' ? SPR.foxSit : SPR.fox[((Math.floor(fox.phase / TAU * 8) % 8) + 8) % 8];
    push(fox.x, fox.y, 96, 96, fox.hd + fox.look, 0.1, uv, 1, 1, 1, 0.6);
  }
  for (const q of squirrels) if (q.state !== 'wait') {
    const lift = q.state === 'hop' && q.hop < 1 ? Math.sin(q.hop * Math.PI) * 0.3 : 0;
    push(q.x, q.y, 40, 40, q.hd, 0.06 + lift, SPR.squirrel[q.pose], 1, 1, 1, 0.55);
  }
  for (const lf of air) if (lf.on) {
    const tum = 0.3 + 0.7 * Math.abs(Math.cos(windT * lf.tumble + lf.ph));
    push(lf.x, lf.y, lf.size, lf.size * tum, lf.rot, lf.h * 1.6, lf.spr, 1, 1, 1, 0.45 * lf.a);
  }
  segEnd(sShadow);
  // 1: things on the ground (under the canopy)
  const sGround = segBegin();
  for (const o of decor) if (o.g > 0.001) {
    const D = o.d.size * o.scale * 2 * o.g;
    push(o.x, o.y, D, D, o.rot, 0, o.d.uv, 0.95, 0.95, 0.95, 1);
  }
  for (const d of land) if (d.on) {
    const a = sstep(0, 1.5, d.age) * (1 - sstep(d.life - 8, d.life, d.age));
    push(d.x, d.y, d.size, d.size, d.rot, 0, d.spr, 0.86, 0.84, 0.8, a);
  }
  if (fox.state !== 'off') {
    const uv = fox.state === 'sit' ? SPR.foxSit : SPR.fox[((Math.floor(fox.phase / TAU * 8) % 8) + 8) % 8];
    push(fox.x, fox.y, 96, 96, fox.hd + fox.look, 0, uv, 1, 1, 1, 1);
  }
  for (const q of squirrels) if (q.state !== 'wait') {
    const lift = q.state === 'hop' && q.hop < 1 ? Math.sin(q.hop * Math.PI) : 0;
    const sz = 40 * (1 + 0.22 * lift);
    push(q.x, q.y, sz, sz, q.hd, 0, SPR.squirrel[q.pose], 1, 1, 1, 1);
  }
  segEnd(sGround);
  // 2: crowns, south-most on top
  const sCrown = segBegin();
  for (const t of trees) {
    if (t.g <= 0.001) continue;
    const D = t.R / t.sp.r * t.g, k = t.tint;
    push(t.x + t.sway * t.R * 0.4, t.y + t.sway * t.R * 0.15, D, D, t.rot + t.sway, t.H * t.g, t.sp.uv, k, k, k * 0.97, 1);
  }
  segEnd(sCrown);
  // 3: leaves in the air
  const sAir = segBegin();
  for (const lf of air) if (lf.on) {
    const tum = 0.3 + 0.7 * Math.abs(Math.cos(windT * lf.tumble + lf.ph)), sz = lf.size * (1 + lf.h * 0.7);
    const shade = 0.75 + 0.25 * tum;
    push(lf.x, lf.y, sz, sz * tum, lf.rot, lf.h, lf.spr, shade, shade, shade, lf.a);
  }
  segEnd(sAir);
  // 4: bird shadows on the canopy and floor, 5: birds
  const sBirdSh = segBegin();
  if (flock.on) for (const b of flock.birds) {
    const c = Math.cos(flock.dir), s = Math.sin(flock.dir);
    const x = flock.x + c * b.bx - s * b.by + b.fx, y = flock.y + s * b.bx + c * b.by + b.fy;
    const fr = b.glide > 0 ? 3 : ((Math.floor(b.ph / TAU * 8) % 8) + 8) % 8;
    push(x, y, 42, 42, flock.dir, 5.5, SPR.bird[fr], 1, 1, 1, 0.22);
  }
  segEnd(sBirdSh);
  const sBird = segBegin();
  if (flock.on) for (const b of flock.birds) {
    const c = Math.cos(flock.dir), s = Math.sin(flock.dir);
    const x = flock.x + c * b.bx - s * b.by + b.fx, y = flock.y + s * b.bx + c * b.by + b.fy;
    const fr = b.glide > 0 ? 3 : ((Math.floor(b.ph / TAU * 8) % 8) + 8) % 8;
    push(x, y, 42, 42, flock.dir, 0, SPR.bird[fr], 1, 1, 1, 1);
  }
  segEnd(sBird);
  return { sShadowT, sShadow, sGround, sCrown, sAir, sBirdSh, sBird };
}

function setCommon(U, now) {
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(U.uNoise, 0);
  gl.uniform1f(U.uSeed, (seed % 997) * 0.37);
  gl.uniform1f(U.uTime, (now - T0) / 1000);
  gl.uniform1f(U.uWindT, windT);
}
function drawSprites(seg, mode, now, tex = atlasTex, shadeK = 0.85) {
  if (!seg.count) return;
  const { p, U } = SPRITE;
  gl.useProgram(p);
  setCommon(U, now);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uAtlas, 1);
  // never bind the shadow texture while rendering into it (feedback loop)
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mode === 1 ? noiseTex : shadowTex); gl.uniform1i(U.uShadow, 2);
  gl.uniform2f(U.uCanvas, cv.width, cv.height);
  gl.uniform2f(U.uRes, W, H);
  gl.uniform2f(U.uShadowOff, SHADOW_OFF[0], SHADOW_OFF[1]);
  gl.uniform1f(U.uMode, mode);
  gl.uniform1f(U.uShadeK, shadeK);
  bindInst(seg.start);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, seg.count);
}
function draw(now, dt) {
  const segs = buildInstances(dt);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, nInst * INST_F);
  // shadows
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
  gl.viewport(0, 0, shW, shH);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
  drawSprites(segs.sShadowT, 1, now, IMG.crowns ? IMG.crownTex : atlasTex);
  drawSprites(segs.sShadow, 1, now);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cv.width, cv.height);
  // ground
  gl.disable(gl.BLEND);
  const { p, U } = GROUND;
  gl.useProgram(p);
  gl.bindVertexArray(emptyVAO);
  setCommon(U, now);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ftex[fromI]); gl.uniform1i(U.uFA, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ftex[toI]); gl.uniform1i(U.uFB, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, litterTex); gl.uniform1i(U.uLitter, 3);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, shadowTex); gl.uniform1i(U.uShadow, 4);
  gl.uniform2f(U.uRes, cv.width / cv._scale, cv.height / cv._scale);
  gl.uniform2f(U.uCanvas, cv.width, cv.height);
  gl.uniform2f(U.uGrid, Gw, Gh);
  gl.uniform1f(U.uScale, cv._scale);
  gl.uniform1f(U.uStep, STEP);
  gl.uniform1f(U.uMix, curMix);
  gl.uniform1f(U.uDebug, P.debug ? 1 : 0);
  gl.uniform1f(U.uGroundImg, GROUND_IMG);
  gl.uniform1f(U.uGroundScale, GROUND_SCALE);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  // sprites
  gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  drawSprites(segs.sGround, 0, now);
  // rendered crowns already carry their own light and self-shadowing: only a hint of neighbour shade
  drawSprites(segs.sCrown, 0, now, IMG.crowns ? IMG.crownTex : atlasTex, IMG.crowns ? 0.42 : 0.85);
  drawSprites(segs.sAir, 0, now);
  drawSprites(segs.sBirdSh, 2, now);
  drawSprites(segs.sBird, 0, now);
  gl.disable(gl.BLEND);
}

/* ======================================================================
   Size / main loop
   ====================================================================== */
function resize() {
  W = innerWidth; H = innerHeight;
  const scale = PREVIEW ? 0.5 : Math.min(devicePixelRatio || 1, P.quality);
  const box = cv.getBoundingClientRect();
  cv.width = Math.round((box.width || W) * scale); cv.height = Math.round((box.height || H) * scale); cv._scale = scale;
  W = cv.width / scale; H = cv.height / scale;
  Gw = Math.ceil(W / STEP) + 2; Gh = Math.ceil(H / STEP) + 2;
  buildNoise();
  allocField();
  allocShadow();
  placeWorld();
}

const T0 = performance.now();
let lastT = 0, fpsEMA = 0, frameN = 0, paused = false;
const statsEl = document.getElementById('stats');
function frame(now) {
  requestAnimationFrame(frame);
  if (paused) { lastT = 0; return; }
  if (P.cap30 && now - lastT < 31) return;
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.03;
  if (lastT) fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1 / dt) * 0.1 : 1 / dt;
  lastT = now;
  const e = Math.min((now - morphT0) / morphDur, 1);
  curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
  windT += dt * (0.4 + 0.6 * P.wind);
  if (layoutDirty || curMix < 1 || frameN % 15 === 0) { updateWorldWants(); if (curMix >= 1) layoutDirty = false; }
  stepFox(dt);
  for (const q of squirrels) stepSquirrel(q, dt);
  stepLeaves(dt, windT);
  stepBirds(dt);
  draw(now, dt);
  if (++frameN % 15 === 0 && !WALL) {
    statsEl.textContent = `${fpsEMA.toFixed(0)} fps · ${cv.width}×${cv.height} · sprites ${nInst} · paint ${paintMs.toFixed(0)} ms`;
  }
}

/* ======================================================================
   Standalone demo layout and hosted mode
   ====================================================================== */
function drawGhosts() {
  document.getElementById('ghosts').innerHTML = icons.map(ic => `<div class="ghost" style="left:${ic.x}px;top:${ic.y}px;width:${ic.w}px;height:${ic.h}px"><i></i><b></b></div>`).join('');
}
function demoIcons() {
  const out = [], cw = 76, ch = 98;
  for (let c = 0; c < 2; c++) for (let r = 0; r < 9; r++) {
    if (c === 1 && (r === 2 || r >= 6)) continue;
    if (r === 6 && c === 0) continue;
    out.push({ x: 2 + c * cw, y: 4 + r * ch, w: 74, h: 92 });
  }
  out.push({ x: Math.round(W * 0.33), y: Math.round(H * 0.1), w: 74, h: 92 });
  out.push({ x: Math.round(W * 0.31), y: Math.round(H * 0.52), w: 74, h: 92 });
  return out;
}
let iconsSeen = !(WALL || PREVIEW);
function reseed(v) {
  seed = v; buildNoise(); buildNoiseTex(); placeWorld();
  if (iconsSeen) commit(true);
}
function applySettings(v) {
  if (typeof v.seed === 'number' && v.seed !== seed) reseed(v.seed);
  let field = false, adaptive = false;
  for (const k in v) {
    if ((!NUM_KEYS.includes(k) && !DISPLAY_KEYS.includes(k)) || typeof v[k] !== 'number' || P[k] === v[k]) continue;
    if (DISPLAY_KEYS.includes(k) && v[k] !== 0 && v[k] !== 1) continue;
    P[k] = v[k];
    if (k === 'adaptive') adaptive = true;
    if (k === 'sigma') field = true;
  }
  if (adaptive && FB) commit();
  else if (field && FB) refresh();
}
function startHostedMode() {
  document.body.classList.add('wall');
  if (PREVIEW) document.body.classList.add('preview');
  icons = [];
  commit(true);
  let first = true;
  const handle = m => {
    if (m.t === 'pause') { paused = PREVIEW ? false : m.v; return; }
    if (m.t === 'settings') { applySettings(m.v || {}); return; }
    if (m.t === 'reset') { applySettings(Object.assign({}, DEFAULTS, m.v || {})); return; }
    if (m.t !== 'icons') return;
    const k = window.devicePixelRatio || 1;
    icons = m.vis ? m.r.map(([l, t, r, b]) => ({ x: l / k, y: t / k, w: (r - l) / k, h: (b - t) / k })) : [];
    if (PREVIEW) drawGhosts();
    iconsSeen = true;
    commit(first);
    first = false;
  };
  addEventListener('message', ev => {
    if (ev.source === parent && ev.origin === location.origin) handle(typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data);
  });
  parent.postMessage(JSON.stringify({ t: 'ready' }), location.origin);
}

let resizeT = 0;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    resize();
    if (!(WALL || PREVIEW)) { icons = demoIcons(); drawGhosts(); }
    refresh();
  }, 100);
});

window.__dbg = {
  P, fox, flock, squirrels, SPR, get IMG() { return IMG; }, get atlasCv() { return atlasCv; }, get trees() { return trees; },
  bench() {
    const ts = [], px = new Uint8Array(4);
    for (let i = 0; i < 10; i++) { const a = performance.now(); draw(performance.now(), 0.033); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - a); }
    ts.sort((a, b) => a - b);
    return { frame: +ts[5].toFixed(1), canvas: cv.width + 'x' + cv.height, sprites: nInst, paintMs: Math.round(paintMs) };
  },
  birdsNow() { flock.next = 0; },
  // fast-forward the simulation (for screenshots from throttled tabs)
  advance(sec) {
    const dt = 1 / 30;
    for (let t = 0; t < sec; t += dt) {
      morphT0 -= dt * 1000;
      const e = Math.min((performance.now() - morphT0) / morphDur, 1);
      curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
      windT += dt * (0.4 + 0.6 * P.wind);
      updateWorldWants(); stepFox(dt); for (const q of squirrels) stepSquirrel(q, dt); stepLeaves(dt, windT); stepBirds(dt);
      buildInstances(dt);
    }
    draw(performance.now(), dt);
  },
};

async function loadRendered() {
  // Optional assets from tools/forest/render_trees.py; the theme falls back to painted ones
  const img = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  try {
    const m = await (await fetch('assets/forest-crowns.json')).json();
    const [c, s] = await Promise.all([img('assets/forest-crowns.webp'), img('assets/forest-shadows.webp')]);
    const g = m.grid;
    IMG.crowns = m.crowns.map((k, i) => ({ pal: k.pal, r: k.r, img: true, uv: [(i % g) / g, Math.floor(i / g) / g, (i % g + 1) / g, (Math.floor(i / g) + 1) / g] }));
    IMG.crownTex = texFrom(c, false);
    IMG.shadowTex = texFrom(s, false);
  } catch (e) { IMG.crowns = null; }
  try { IMG.ground = await img('assets/forest-ground.webp'); } catch (e) { IMG.ground = null; }
}
const IMG = { crowns: null, crownTex: null, shadowTex: null, ground: null };
await loadRendered();
paintAll();
atlasTex = texFrom(atlasCv, false);
litterTex = IMG.ground ? texFrom(IMG.ground, true) : texFrom(paintLitter(512), true);
const GROUND_IMG = IMG.ground ? 1 : 0;
// how many CSS px one repeat of the photo ground covers (the scan is ~2 m of forest floor)
const GROUND_SCALE = +(QS.get('groundScale') || 520);
buildNoiseTex();
resize();
if (WALL || PREVIEW) startHostedMode();
else { icons = demoIcons(); drawGhosts(); iconsSeen = true; commit(true); }
requestAnimationFrame(frame);
