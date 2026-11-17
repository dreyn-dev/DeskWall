// DeskWall · Thaw ("Проталины").
// A calm snowfield; around every icon the snow has melted into a patch of wet earth, last year's
// grass and the first flowers. Icons close together share one patch. The icon field
// (computeField), noise helpers and hosted-mode protocol follow the classic themes ported from
// Deskland Preview (GPL-3.0, see NOTICE). Ground tiles and plant sprites come from CC0 sources via
// tools/thaw/render_sprites.py; birds and snowflakes are painted at startup.
'use strict';

/* ======================================================================
   Parameters
   ====================================================================== */
const QS = new URLSearchParams(location.search);
const WALL = QS.has('wallpaper');
const PREVIEW = QS.has('preview');
const STEP = 5, MORPH_MS = 2200, WARP = 74;   // strong warp: single patches melt into irregular shapes, not discs
// Click and icon-move waves on screen at once: P.clicks (shared setting), arrays sized for the
// most (same limit as MAX_CLICKS in kit.js; this page does not use kit.js).
const MAX_CLICKS = 32;
const P = { clicks: 16, sigma: 108, bloom: 1, flakes: 0.4, showBirds: 1, byClock: 1, hour: 16, adaptive: 1, quality: 2, cap30: true, debug: false };
const DEFAULTS = Object.assign({}, P);
const NUM_KEYS = ['clicks', 'sigma', 'bloom', 'flakes', 'hour'];
const sigEff = () => P.sigma;
// the shared wind (same formula as gust() in the ground shader): 0.25 calm .. 1 in a gust
const WIND = [0.94, 0.34];
let T0w = performance.now();
function windAt(x, y) {
  const t = (performance.now() - T0w) / 1000;
  const u = x * WIND[0] + y * WIND[1] - t * 170, f = ((u / 1500) % 1 + 1) % 1;
  const band = sstep(0, 0.1, f) * sstep(0.34, 0.12, f);
  const perp = -x * WIND[1] + y * WIND[0];
  return 0.25 + 0.75 * band * (0.7 + 0.3 * Math.sin(perp * 0.004 + t * 0.3));
}
const DISPLAY_KEYS = ['showBirds', 'byClock', 'adaptive'];
if (QS.has('hour')) { P.byClock = 0; P.hour = +QS.get('hour'); }
// Light through the day: (hour, whole-frame tint, extra tint on snow, shadow length px).
// Night stays light enough for icon labels; the sun is always low (early spring).
const LIGHT_KEYS = [
  [0, [0.82, 0.85, 0.92], [0.97, 0.985, 1.01], 12], [5, [0.82, 0.85, 0.92], [0.97, 0.985, 1.01], 12],
  [6.5, [1.0, 0.95, 0.96], [1.02, 0.975, 0.99], 52], [8.5, [1.01, 0.99, 0.97], [1.01, 1.0, 0.995], 38],
  [12, [1.01, 1.0, 0.98], [1, 1, 1], 26], [16, [1.02, 0.995, 0.96], [1.01, 1.0, 0.985], 34],
  [18.5, [1.035, 0.985, 0.925], [1.02, 0.99, 0.955], 54], [20, [0.92, 0.9, 0.95], [0.99, 0.975, 1.0], 32],
  [21.5, [0.83, 0.86, 0.92], [0.97, 0.985, 1.01], 12], [24, [0.82, 0.85, 0.92], [0.97, 0.985, 1.01], 12],
];
const LIGHT = { tint: [1, 1, 1], snow: [1, 1, 1], len: 26, dir: [-0.6, -0.8] };
function updateLight() {
  const d = new Date(), h = P.byClock ? d.getHours() + d.getMinutes() / 60 : clamp(P.hour, 0, 24);
  let i = 0;
  while (i < LIGHT_KEYS.length - 2 && LIGHT_KEYS[i + 1][0] <= h) i++;
  const a = LIGHT_KEYS[i], b = LIGHT_KEYS[i + 1], t = sstep(0, 1, (h - a[0]) / (b[0] - a[0] || 1));
  for (let k = 0; k < 3; k++) { LIGHT.tint[k] = a[1][k] + (b[1][k] - a[1][k]) * t; LIGHT.snow[k] = a[2][k] + (b[2][k] - a[2][k]) * t; }
  LIGHT.len = a[3] + (b[3] - a[3]) * t;
  // the sun swings a little from left (morning) to top (afternoon); sprites keep their baked light
  const ang = clamp((h - 13) / 6, -1, 1) * 0.38, c = Math.cos(ang), s = Math.sin(ang);
  LIGHT.dir[0] = -0.6 * c + 0.8 * s; LIGHT.dir[1] = -0.6 * s - 0.8 * c;
}

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
   Icon field: s < 0 inside the thawed patch, > 0 on snow
   ====================================================================== */
let W = innerWidth, H = innerHeight, Gw = 1, Gh = 1, NZ = null;
function buildNoise() {
  const N = Gw * Gh;
  NZ = { wx: new Float32Array(N), wy: new Float32Array(N) };
  for (let gy = 0; gy < Gh; gy++) for (let gx = 0; gx < Gw; gx++) {
    const i = gy * Gw + gx, x = gx * STEP, y = gy * STEP;
    NZ.wx[i] = fbm(x * 0.0042, y * 0.0042, 1) - 0.47;
    NZ.wy[i] = fbm(x * 0.0042, y * 0.0042, 2) - 0.47;
  }
}
function computeField(rects) {
  const N = Gw * Gh, f1 = new Float32Array(N);
  const sig = sigEff(), is1 = 1 / (sig * sig);
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
   Painted sprites: small birds (great tits and sparrows) and snowflakes
   ====================================================================== */
const ATLAS = 512;
const atlasCv = document.createElement('canvas');
atlasCv.width = atlasCv.height = ATLAS;
const actx = atlasCv.getContext('2d');
actx.imageSmoothingQuality = 'high';
const tmpCv = document.createElement('canvas');
const tg = tmpCv.getContext('2d');
let packX = 0, packY = 0, packRow = 0;
function paintSprite(size, fn) {
  const S = size * 2;
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
// Small songbird seen from above, facing +x. pose: 0 standing, 1 pecking (head forward), or a
// wing-span factor > 1 for flight frames (span - 1 in 0..1).
function paintBird(g, S, pose, tit) {
  const u = S / 64;
  g.translate(S / 2, S / 2);
  g.scale(u, u);
  const crow = tit === 'crow';
  const BACK = crow ? '#2c2a2d' : tit ? '#8a9a52' : '#8a6a46', WING = crow ? '#242226' : tit ? '#6f8396' : '#6e5136', DARK = '#1d1a18';
  if (pose > 1) {
    const k = pose - 1, span = 4 + 15 * k;
    for (const s of [-1, 1]) {
      g.fillStyle = WING;
      g.beginPath(); g.moveTo(3, s * 2.4);
      g.quadraticCurveTo(2, s * (2.4 + span * 0.7), -3, s * (2.4 + span));
      g.lineTo(-6.5, s * (2.4 + span * 0.85)); g.quadraticCurveTo(-5, s * (2.4 + span * 0.4), -4.5, s * 2.4); g.closePath(); g.fill();
      g.fillStyle = 'rgba(240,240,235,.75)';
      g.beginPath(); g.moveTo(0, s * (2.6 + span * 0.25)); g.lineTo(-3.5, s * (2.6 + span * 0.55)); g.lineTo(-4.5, s * (2.6 + span * 0.5)); g.lineTo(-1, s * (2.6 + span * 0.2)); g.closePath(); g.fill();
    }
  }
  g.fillStyle = DARK;
  g.beginPath(); g.moveTo(-6, -1.4); g.lineTo(-12.5, -2.4); g.lineTo(-12.5, 2.4); g.lineTo(-6, 1.4); g.closePath(); g.fill();
  g.fillStyle = BACK; g.beginPath(); g.ellipse(-0.5, 0, 7, 4.4, 0, 0, TAU); g.fill();
  if (pose <= 1) {
    for (const s of [-1, 1]) {
      g.fillStyle = WING; g.beginPath(); g.ellipse(-2.5, s * 2.4, 5.5, 2.2, s * 0.12, 0, TAU); g.fill();
      g.fillStyle = 'rgba(245,245,240,.8)'; g.beginPath(); g.ellipse(-1, s * 3.1, 2.6, 0.6, s * 0.1, 0, TAU); g.fill();
    }
  }
  const hx = pose === 1 ? 7.5 : 6.2;
  if (crow) {
    g.fillStyle = '#26242a'; g.beginPath(); g.ellipse(hx, 0, 3.6, 3.3, 0, 0, TAU); g.fill();
  } else if (tit) {
    g.fillStyle = '#f2f1ea'; g.beginPath(); g.ellipse(hx, 0, 3.4, 3.6, 0, 0, TAU); g.fill();
    g.fillStyle = DARK; g.beginPath(); g.ellipse(hx + 0.6, 0, 2.6, 1.8, 0, 0, TAU); g.fill();
  } else {
    g.fillStyle = '#7b6e64'; g.beginPath(); g.ellipse(hx, 0, 3.4, 3.2, 0, 0, TAU); g.fill();
    g.fillStyle = '#8a5a34'; g.beginPath(); g.ellipse(hx - 0.6, 0, 2.2, 3.0, 0, 0, TAU); g.fill();
  }
  g.fillStyle = '#2a241e'; g.beginPath(); g.moveTo(hx + 3, -0.7); g.lineTo(hx + 5.2, 0); g.lineTo(hx + 3, 0.7); g.closePath(); g.fill();
}
function paintFlake(g, S) {
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(250,252,255,.85)'); grad.addColorStop(1, 'rgba(240,245,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
}
// Butterfly from above, wings opened by k (0 closed .. 1 flat). c: [fore, hind, accent]
function paintButterfly(g, S, k, c) {
  const u = S / 32;
  g.translate(S / 2, S / 2); g.scale(u, u);
  const span = 1.5 + 12 * k;
  for (const s of [-1, 1]) {
    g.fillStyle = c[0];
    g.beginPath(); g.moveTo(1.5, s * 0.8); g.quadraticCurveTo(7, s * span * 0.9, 1, s * span); g.quadraticCurveTo(-3, s * span * 0.7, -1, s * 0.8); g.closePath(); g.fill();
    g.fillStyle = c[1];
    g.beginPath(); g.moveTo(-0.5, s * 0.8); g.quadraticCurveTo(-1, s * span * 0.85, -6, s * span * 0.6); g.quadraticCurveTo(-6.5, s * span * 0.2, -1.5, s * 0.8); g.closePath(); g.fill();
    if (k > 0.3) { g.fillStyle = c[2]; g.beginPath(); g.arc(2, s * span * 0.62, 1.1 * k + 0.3, 0, TAU); g.fill(); }
  }
  g.fillStyle = '#2a2420'; g.beginPath(); g.ellipse(0, 0, 5, 1, 0, 0, TAU); g.fill();
}
function paintBee(g, S, wing) {
  const u = S / 32;
  g.translate(S / 2, S / 2); g.scale(u, u);
  g.fillStyle = 'rgba(235,240,250,.65)';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(-0.5, s * (2.5 + wing), 3.2, 2 + wing, s * 0.3, 0, TAU); g.fill(); }
  g.fillStyle = '#e8b02a'; g.beginPath(); g.ellipse(-0.5, 0, 4.6, 2.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#2a2018'; for (const x of [-2.6, 0.2]) g.fillRect(x, -2.6, 1.1, 5.2);
  g.beginPath(); g.arc(4.2, 0, 1.6, 0, TAU); g.fill();
}
function paintPetal(g, S) {
  g.fillStyle = '#fff6f8'; g.beginPath(); g.ellipse(S / 2, S / 2, S * 0.4, S * 0.26, 0.4, 0, TAU); g.fill();
}
const BFLY = [['#f6f3ea', '#efece2', '#2b2b2b'], ['#f2de66', '#ecd458', '#c98a1c'], ['#c8452c', '#a8331f', '#3b5fa8'], ['#86aee6', '#6f97d4', '#f2f2f2']];
// Mountain hare in its half-white spring coat, from above, facing +x. f: bound phase 0..1
function paintHare(g, S, f) {
  const u = S / 64;
  g.translate(S / 2, S / 2); g.scale(u, u);
  // e: 0 gathered (hind feet forward beside the shoulders) .. 1 stretched out mid-bound
  const e = Math.sin(f * Math.PI);
  const L = 1 + 0.25 * e;
  // big hind feet: trailing behind when stretched, brought forward when gathered
  g.fillStyle = '#b4a693';
  for (const s of [-1, 1]) {
    const fx = -14 * L + (1 - e) * 16, fy = s * (5.5 - e * 1.5);
    g.beginPath(); g.ellipse(fx, fy, 6, 1.9, s * 0.15, 0, TAU); g.fill();
  }
  // body: wider at the haunches, narrower at the shoulders
  g.fillStyle = '#d3c8b8';
  g.beginPath();
  g.moveTo(9 * L, 0);
  g.bezierCurveTo(8 * L, -5, 0, -7.5, -8 * L, -6.5);
  g.bezierCurveTo(-14 * L, -5.5, -15 * L, 5.5, -8 * L, 6.5);
  g.bezierCurveTo(0, 7.5, 8 * L, 5, 9 * L, 0);
  g.fill();
  g.fillStyle = 'rgba(140,122,100,.55)';                       // darker spring moult along the back
  g.beginPath(); g.ellipse(-2 * L, 0, 8 * L, 2.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#f6f4ef'; g.beginPath(); g.arc(-14 * L, 0, 2.6, 0, TAU); g.fill();   // white scut
  // head
  const hx = 12 * L;
  g.fillStyle = '#c9bca9'; g.beginPath(); g.ellipse(hx, 0, 5, 3.9, 0, 0, TAU); g.fill();
  // long ears laid back in a V, dark tips
  for (const s of [-1, 1]) {
    g.save(); g.translate(hx - 2.5, s * 1.6); g.rotate(Math.PI + s * -0.32);
    g.fillStyle = '#a8977e'; g.beginPath(); g.ellipse(6, 0, 7, 1.6, 0, 0, TAU); g.fill();
    g.fillStyle = '#6f5f4c'; g.beginPath(); g.ellipse(11.8, 0, 1.6, 1.2, 0, 0, TAU); g.fill();
    g.restore();
  }
}
// A footprint pressed into the snow: soft blue, never dark
function paintPrint(g, S) {
  const grad = g.createRadialGradient(S * 0.46, S * 0.44, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(150,170,205,.75)'); grad.addColorStop(0.6, 'rgba(175,192,222,.45)'); grad.addColorStop(1, 'rgba(200,214,236,0)');
  g.fillStyle = grad; g.beginPath(); g.ellipse(S / 2, S / 2, S * 0.46, S * 0.3, 0, 0, TAU); g.fill();
}
function paintRing(g, S) {
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = S * 0.06;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, TAU); g.stroke();
}
const SPR = { tit: [], sparrow: [], crow: [], hare: [], print: null, ring: null, flake: null, bfly: [], bee: [], petal: null };
function paintAll() {
  for (const tit of [true, false]) {
    const arr = tit ? SPR.tit : SPR.sparrow;
    arr.push(paintSprite(64, (g, S) => paintBird(g, S, 0, tit)));
    arr.push(paintSprite(64, (g, S) => paintBird(g, S, 1, tit)));
    for (let i = 0; i < 6; i++) arr.push(paintSprite(64, (g, S) => paintBird(g, S, 1 + 0.15 + 0.85 * Math.abs(Math.cos(i / 6 * Math.PI)), tit)));
  }
  SPR.flake = paintSprite(32, paintFlake);
  for (const c of BFLY) { const f = []; for (const k of [1, 0.7, 0.35, 0.08]) f.push(paintSprite(32, (g, S) => paintButterfly(g, S, k, c))); SPR.bfly.push(f); }
  for (const w of [0, 1.2]) SPR.bee.push(paintSprite(32, (g, S) => paintBee(g, S, w)));
  SPR.petal = paintSprite(32, paintPetal);
  for (let i = 0; i < 6; i++) SPR.crow.push(paintSprite(64, (g, S) => paintBird(g, S, 1 + 0.15 + 0.85 * Math.abs(Math.cos(i / 6 * Math.PI)), 'crow')));
  for (let i = 0; i < 4; i++) SPR.hare.push(paintSprite(128, (g, S) => paintHare(g, S, i / 4)));
  SPR.print = paintSprite(32, paintPrint);
  SPR.ring = paintSprite(32, paintRing);
}

/* ======================================================================
   Shaders
   ====================================================================== */
const COMMON = `
uniform sampler2D uNoise;
uniform float uSeed, uTime;
float hash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec4 N(vec2 p, float scale) { return texture(uNoise, p / scale + uSeed * 0.013); }
float cloudShade(vec2 p) {
  vec2 q = p + vec2(uTime * 7.0, uTime * 2.5);
  float c = N(q, 2800.0).r * 0.65 + N(q + 500.0, 1200.0).g * 0.35;
  return 1.0 - 0.045 * ss(0.52, 0.8, c);
}`;

const FULL_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GROUND_FS = `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D uFA, uFB, uSnow, uEarth, uGreen, uGrass, uShadow;
uniform vec2 uRes, uGrid, uCanvas;
uniform float uScale, uStep, uMix, uDebug;
// growth waves: (x, y, start time, kind) kind 0 = spring arrives (new icon spot), 1 = frost returns (old spot); start < 0 = unused
uniform vec4 uWaves[${MAX_CLICKS}];
uniform vec3 uTint, uSnowTint;
uniform vec2 uToLight;
uniform float uShadowLen;
// one wind for everything: gusts roll across the screen as soft bands (mirrored in windAt())
const vec2 WIND = vec2(0.94, 0.34);
float gust(vec2 p) {
  float f = fract((dot(p, WIND) - uTime * 170.0) / 1500.0);
  float band = ss(0.0, 0.1, f) * ss(0.34, 0.12, f);
  float perp = dot(p, vec2(-WIND.y, WIND.x));
  return band * (0.7 + 0.3 * sin(perp * 0.004 + uTime * 0.3));
}
out vec4 o;
#define TO_LIGHT uToLight
float fieldS(vec2 p) {
  vec2 uv = (p / uStep + 0.5) / uGrid;
  return mix(texture(uFA, uv).r, texture(uFB, uv).r, uMix);
}
vec3 tex2(sampler2D t, vec2 p, float k) {
  // two rotated samples blended by noise hide the tile repeat
  vec3 a = texture(t, p / k).rgb;
  vec3 b = texture(t, mat2(0.8, -0.6, 0.6, 0.8) * p / (k * 1.17) + 0.31).rgb;
  return mix(a, b, ss(0.4, 0.6, N(p, 700.0).r));
}
// ---- the Meadow theme's ground (same palette and grass strokes), used inside the glades ----
const vec3 G_LIGHT = vec3(0.76, 0.83, 0.52), G_MID = vec3(0.62, 0.75, 0.42), G_DEEP = vec3(0.52, 0.68, 0.36);
const vec3 INK = vec3(0.24, 0.38, 0.18);
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float grassInk(vec2 p) {
  const vec2 G = vec2(12.0, 6.0);
  vec2 c0 = floor(p / G);
  float ink = 0.0;
  for (int j = -1; j <= 1; j++) {
    vec2 c = c0 + vec2(0.0, float(j));
    vec2 cp = (c + 0.5) * G;
    float h = hash2(c + 3.1);
    float dens = 0.75 * ss(0.42, 0.72, N(cp, 700.0).r) * ss(0.35, 0.6, N(cp + 50.0, 300.0).g) + 0.02;
    if (h > dens) continue;
    float ang = (N(cp, 1100.0).g - 0.5) * 0.7 + (hash2(c + 7.7) - 0.5) * 0.3;
    float len = 2.5 + 3.0 * hash2(c + 1.9);
    vec2 ctr = cp + (vec2(hash2(c + 4.3), hash2(c + 5.9)) - 0.5) * vec2(2.0, 3.0);
    vec2 dir = vec2(cos(ang), sin(ang)) * len;
    float d = segD(p, ctr - dir, ctr + dir);
    ink = max(ink, (1.0 - ss(0.2, 0.9, d)) * (0.35 + 0.45 * hash2(c + 9.1)));
  }
  return ink;
}
// snow height: broad drifts plus wind ripples that bend with the drifts
float snowH(vec2 q) {
  // only the smooth noise channel (.b has no fine octaves), so drifts stay soft
  float d = N(q, 2200.0).b + N(q + 40.0, 900.0).b * 0.2;
  float rip = sin(dot(q, vec2(0.06, 0.028)) + N(q, 640.0).b * 5.0) * 0.035 * ss(0.4, 0.7, N(q + 9.0, 900.0).b);
  return d + rip;
}
vec3 meadow(vec2 p) {
  float w1 = N(p, 900.0).b, w2 = N(p + 311.0, 360.0).g;
  vec3 c = mix(G_MID, G_LIGHT, ss(0.3, 0.75, w1 * 0.7 + w2 * 0.3));
  c = mix(c, G_DEEP, ss(0.45, 0.85, N(p + 977.0, 700.0).r) * 0.4);
  c *= 1.0 + (hash2(floor(p * 0.8)) - 0.5) * 0.035;
  return mix(c, INK, grassInk(p) * 0.75);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float s = fieldS(p);
  vec2 gr = vec2(fieldS(p + vec2(8.0, 0.0)) - fieldS(p - vec2(8.0, 0.0)), fieldS(p + vec2(0.0, 8.0)) - fieldS(p - vec2(0.0, 8.0)));
  vec2 nrm = length(gr) > 1e-4 ? normalize(gr) : vec2(0.0);
  // a slightly ragged edge: melt line wanders a few px with fine noise
  float edgeN = (N(p, 230.0).g - 0.5) * 60.0 + (N(p, 60.0).g - 0.5) * 9.0 + (N(p, 18.0).b - 0.5) * 4.0;
  float se = s + edgeN;

  // ---------- snow: calm, faint drifts, cool where it faces away from the sun ----------
  // the scan only adds fine grain; its tracks and marks are clamped so the field stays calm
  float sl = dot(texture(uSnow, p / 300.0).rgb, vec3(0.333));
  float sa = dot(textureLod(uSnow, vec2(0.5), 10.0).rgb, vec3(0.333));
  vec3 snow = vec3(0.935, 0.95, 0.972) * (1.0 + clamp(sl - sa, -0.015, 0.04) * 0.8);
  float drift = N(p, 1600.0).g * 0.6 + N(p + 90.0, 520.0).r * 0.4;
  snow *= mix(vec3(0.982, 0.987, 0.998), vec3(1.008, 1.006, 1.003), ss(0.3, 0.7, drift));
  // relief: soft drifts and wind ripples lit by the low sun — brighter ridges, blue hollows
  vec2 hx = vec2(6.0, 0.0), hy = vec2(0.0, 6.0);
  float dhx = snowH(p + hx) - snowH(p - hx), dhy = snowH(p + hy) - snowH(p - hy);
  vec3 sn = normalize(vec3(-dhx * 4.0, -dhy * 4.0, 1.0));
  float elev = mix(0.32, 0.8, ss(52.0, 20.0, uShadowLen));
  vec3 L3 = normalize(vec3(TO_LIGHT * (1.0 - elev * 0.5), elev));
  float relief = dot(sn, L3) - L3.z;
  snow *= 1.0 + relief * 0.28;
  snow = mix(snow, snow * vec3(0.9, 0.94, 1.0), ss(0.0, -0.12, relief) * 0.7);
  // the snow wall around a patch: raised rim, lit on the side facing the sun, soft blue on the far
  // side, and a crisp bright lip right at the melt line. No grey slush: the edge stays clean.
  float rim = ss(30.0, 2.0, se) * ss(-3.0, 3.0, se);
  float facing = dot(-nrm, TO_LIGHT);
  snow *= mix(vec3(1.0), facing > 0.0 ? vec3(1.045, 1.04, 1.03) : vec3(0.8, 0.86, 0.97), rim * abs(facing) * 0.8);
  snow = mix(snow, vec3(1.0, 1.0, 0.995), ss(5.0, 0.5, se) * ss(-1.0, 0.5, se) * 0.5);
  // meltwater: soaked, slightly darker and cooler runnels in the snow on the slopes of the snow
  // wall, running downhill into the patch; they widen, break up and dissolve near the glade
  vec2 tng = vec2(-nrm.y, nrm.x);
  float lanes = dot(p, tng) / 38.0 + (N(p, 150.0).r - 0.5) * 0.9;
  float lane = floor(lanes);
  float wv = mix(0.035, 0.13, ss(42.0, 2.0, se));
  float wet = (1.0 - ss(wv * 0.45, wv, abs(fract(lanes) - 0.5)))
            * step(0.78, hash2(vec2(lane, 3.0)))
            * ss(44.0, 14.0, se) * ss(-2.0, 3.0, se)
            * ss(0.3, 0.55, N(p + lane * 13.0, 70.0).g);
  if (wet > 0.001) {
    float run = fract(dot(p, nrm) / 46.0 + uTime * 0.22 + hash2(vec2(lane, 9.0)));
    vec3 soaked = snow * vec3(0.87, 0.91, 0.96) + vec3(0.06) * ss(0.82, 0.97, run);
    snow = mix(snow, soaked, wet * 0.75);
  }
  // sun glints: rare, tiny, twinkling
  vec2 gc = floor(p / 7.0);
  float gh = hash2(gc + 17.0);
  float tw = 0.5 + 0.5 * sin(uTime * (1.5 + gh * 3.0) + gh * 40.0);
  float glint = step(0.9965, gh) * pow(tw, 6.0) * (1.0 - ss(0.0, 2.2, length(p - (gc + 0.5) * 7.0)));
  snow += vec3(1.0, 0.98, 0.9) * glint * 0.7 * ss(0.0, 20.0, s) * ss(0.0, 0.06, relief);   // sparkle only on sunlit slopes

  // ---------- the thawed patch: a thin band of pale straw, then the Meadow glade ----------
  float depth = -se;
  vec3 grass = tex2(uGrass, p, 520.0);
  // last year's grass: light and warm, not brown or grey
  vec3 straw = mix(grass * vec3(1.3, 1.26, 1.1), vec3(0.93, 0.9, 0.74), 0.68);
  vec3 g = mix(straw, meadow(p), ss(1.5 + 3.0 * N(p + 300.0, 90.0).b, 9.0, depth));
  // soft, cool shade of the snow wall on the glade (sun from the top left)
  // ---- growth as a show: a soft green front runs out from a newly placed icon, the fresh melt
  // behind it glistens wet and dries within a couple of seconds; at the old spot frost sparkles
  // as the snow creeps back ----
  float sheen = 0.0, frost = 0.0;
  for (int i = 0; i < ${MAX_CLICKS}; i++) {
    vec4 w = uWaves[i];
    if (w.z < 0.0) continue;
    float t = uTime - w.z;
    if (t < 0.0 || t > 4.5) continue;
    float d = length(p - w.xy);
    if (w.w < 0.5) {
      float front = t * 240.0;
      float age = t - d / 240.0;
      g += vec3(0.05, 0.1, 0.02) * (1.0 - ss(0.0, 18.0, abs(d - front))) * ss(4.0, 2.0, t);
      sheen = max(sheen, ss(-0.05, 0.15, age) * exp(-max(age, 0.0) / 1.1));
    } else {
      frost = max(frost, exp(-t / 1.6) * ss(260.0, 40.0, d));
    }
  }
  g = mix(g, g * vec3(0.93, 0.96, 1.0), sheen * 0.5);
  g += vec3(0.16, 0.17, 0.16) * sheen * ss(0.78, 0.95, N(p + vec2(uTime * 3.0, 0.0), 24.0).r);
  snow += vec3(0.07, 0.08, 0.1) * frost * step(0.94, hash2(floor(p / 3.0) + floor(uTime * 6.0)));
  // the snow wall's shadow on the glade: longer and bluer when the sun is low
  float wall = ss(-2.0, 10.0, fieldS(p + TO_LIGHT * uShadowLen * 0.55) + edgeN) * ss(0.0, uShadowLen + 4.0, depth);
  g *= mix(vec3(1.0), vec3(0.78, 0.84, 0.97), wall * mix(0.45, 0.7, ss(20.0, 50.0, uShadowLen)));
  // where a runnel reaches the glade it leaves a small, faint wet spot
  g *= 1.0 - wet * 0.08;
  // a gust passing over the glade: bent grass catches the light
  g *= 1.0 + 0.06 * gust(p) * ss(8.0, 30.0, depth);
  // small lumps of snow fallen onto the glade near the edge: rounded, lit from the sun side,
  // blue on the far side, with a little shadow on the grass
  if (depth > 2.0 && depth < 34.0) {
    vec2 lc = floor(p / 24.0);
    for (int dy = 0; dy <= 1; dy++) for (int dx = 0; dx <= 1; dx++) {
      vec2 c = lc + vec2(float(dx), float(dy)) - 0.5;
      vec2 cc = floor(c + 0.5);
      float h = hash2(cc + 41.0);
      if (h > 0.2) continue;
      vec2 ctr = (cc + 0.2 + 0.6 * vec2(hash2(cc + 5.0), hash2(cc + 8.0))) * 24.0;
      float cdepth = -(fieldS(ctr) + edgeN);
      if (cdepth < 3.0 || cdepth > 30.0) continue;
      float r = 2.5 + 4.5 * hash2(cc + 13.0) * ss(30.0, 6.0, cdepth);
      vec2 q = (p - ctr) / r;
      float sd = length(p - ctr - (-TO_LIGHT) * r * 0.6) / r;
      g *= 1.0 - (1.0 - ss(0.7, 1.3, sd)) * 0.22;                           // shadow on the grass
      float l = length(q);
      if (l < 1.0) {
        float lit = 0.5 + 0.5 * dot(normalize(vec3(q, sqrt(max(0.0, 1.0 - l * l)))), normalize(vec3(TO_LIGHT, 0.8)));
        vec3 lump = mix(vec3(0.74, 0.8, 0.92), vec3(1.0, 0.995, 0.98), lit);
        g = mix(g, lump * uSnowTint, ss(1.0, 0.82, l));
      }
    }
  }
  float sh = texture(uShadow, gl_FragCoord.xy / uCanvas).g;
  g *= mix(vec3(1.0), vec3(0.55, 0.55, 0.66), sh * 0.8);
  snow *= mix(vec3(1.0), vec3(0.74, 0.8, 0.95), sh * 0.7);

  snow *= uSnowTint;
  float land = ss(1.0, -1.0, se);
  vec3 col = mix(snow, g, land);
  // drops of meltwater glinting right on the melt line
  vec2 mc = floor(p / 5.0);
  float mh = hash2(mc + 77.0);
  if (mh > 0.975 && abs(se) < 3.0) {
    float tw2 = pow(0.5 + 0.5 * sin(uTime * (2.0 + mh * 4.0) + mh * 60.0), 8.0);
    col += vec3(0.5, 0.52, 0.5) * tw2 * (1.0 - ss(0.0, 1.8, length(p - (mc + 0.5) * 5.0)));
  }
  col *= uTint;
  col *= cloudShade(p);
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
out vec2 vUV, vW;
out vec4 vCol;
void main() {
  int id = gl_VertexID;
  vec2 c = vec2((id == 1 || id == 2 || id == 4) ? 1.0 : 0.0, (id == 2 || id == 4 || id == 5) ? 1.0 : 0.0);
  vec2 l = (c - 0.5) * iPos.zw;
  float s = sin(iRot.x), co = cos(iRot.x);
  vec2 w = iPos.xy + vec2(co * l.x - s * l.y, s * l.x + co * l.y);
  if (uMode > 0.5) w += uShadowOff * iRot.y;
  vW = w;
  vUV = mix(iUV.xy, iUV.zw, c);
  vCol = iCol;
  gl_Position = vec4(w.x / uRes.x * 2.0 - 1.0, 1.0 - w.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D uAtlas;
uniform float uMode;
uniform vec3 uTint;
in vec2 vUV, vW;
in vec4 vCol;
out vec4 o;
void main() {
  if (uMode > 0.5) { float a = texture(uAtlas, vUV, 1.5).a * vCol.a; o = vec4(0.0, a, 0.0, 0.0); return; }
  vec4 t = texture(uAtlas, vUV);
  o = vec4(t.rgb * vCol.rgb * cloudShade(vW) * uTint, t.a) * vCol.a;
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
function flatTex(rgb) {
  const c = document.createElement('canvas'); c.width = c.height = 4;
  const x = c.getContext('2d'); x.fillStyle = rgb; x.fillRect(0, 0, 4, 4);
  return texFrom(c, true);
}
let noiseTex = null, NOISE = null;
// CPU copy of the GPU noise lookup N(p, scale), so plants follow the same ragged melt line
function Ncpu(x, y, scale, ch) {
  const S = 256, off = (seed % 997) * 0.37 * 0.013;
  const u = (x / scale + off) * S - 0.5, v = (y / scale + off) * S - 0.5;
  const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
  const at = (a, b) => NOISE[((((b % S) + S) % S) * S + (((a % S) + S) % S)) * 4 + ch];
  return ((at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy) / 255;
}
// snow tongues (long wavelength) + small ragged melt line; mirrored in GROUND_FS
const edgeOff = (x, y) => (Ncpu(x, y, 230, 1) - 0.5) * 60 + (Ncpu(x, y, 60, 1) - 0.5) * 9 + (Ncpu(x, y, 18, 2) - 0.5) * 4;
function buildNoiseTex() {
  const S = 256, d = new Uint8Array(S * S * 4);
  const chans = [[8, 16, 32, 64], [8, 16, 32, 64], [8, 16, 32], [16, 32, 64, 128]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    for (let c = 0; c < 4; c++) d[i + c] = clamp((tileFbm(u, v, chans[c], 100 + c * 50) - 0.5) * 1.9 + 0.5, 0, 1) * 255;
  }
  NOISE = d;
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
let icons = [], layoutDirty = true;
const iconRects = () => icons.map(ic => ({ cx: ic.x + ic.w / 2, cy: ic.y + ic.h / 2, hw: ic.w / 2 - 4, hh: ic.h / 2 - 2 }));
function commit(fromEmpty = false) {
  const nf = computeField(P.adaptive ? iconRects() : []);
  const target = 1 - toI;
  if (fromEmpty) { FA = computeField([]); uploadField(toI, FA); } else FA = FB;
  FB = nf;
  uploadField(target, FB);
  fromI = toI; toI = target;
  morphT0 = performance.now();
  morphDur = fromEmpty ? 3200 : MORPH_MS;
  layoutDirty = true;
  measureThaw();
}
function refresh() {
  FA = FB = computeField(P.adaptive ? iconRects() : []);
  uploadField(toI, FB);
  fromI = toI; morphT0 = -1e9;
  layoutDirty = true;
  measureThaw();
}
const curS = (x, y) => FB ? sampleArr(FA.s, x, y) * (1 - curMix) + sampleArr(FB.s, x, y) * curMix : 999;
const targetS = (x, y) => FB ? sampleArr(FB.s, x, y) : 999;
const nearIcon = (x, y, pad) => icons.some(ic => x > ic.x - pad && x < ic.x + ic.w + pad && y > ic.y - pad && y < ic.y + ic.h + pad);

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

const INST_F = 14, MAXI = 5000;
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
   World: plants that grow with the thaw, birds, snowflakes
   ====================================================================== */
const IMG = { sprites: null, spriteTex: null, trees: null, treeTex: null, tiles: {} };
// Plants by how far into the patch they stand (depth = px from the ragged melt line): last year's
// grass and first shoots at the edge, early flowers next, then a full spring meadow and bushes.
const SIZES = { snowdrops: 26, snowdrop: 15, crocuses: 30, crocus: 18, crocuses_white: 28, coltsfoot: 26, clover: 20,
  shoots: 22, old_grass: 26, leaves: 22, fern: 28, pebble: 13, rock: 24, tulips: 32, tulips_yellow: 32, dandelions: 26,
  primroses: 26, bush_blossom: 58, bush_fresh: 52, tulip: 19, grass_tall: 28, clover_bright: 22 };
const BANDS = [
  [14, [['shoots', 1]]],
  [32, [['shoots', 4], ['grass_tall', 2], ['snowdrop', 3], ['snowdrops', 2], ['clover_bright', 2], ['crocus', 2]]],
  [65, [['crocuses', 3], ['snowdrops', 3], ['primroses', 3], ['dandelions', 2], ['crocus', 2], ['tulip', 1], ['crocuses_white', 2], ['coltsfoot', 2]]],
  [1e9, [['tulips', 1], ['tulips_yellow', 1], ['dandelions', 3], ['primroses', 3], ['crocuses', 3], ['snowdrops', 2], ['tulip', 2], ['coltsfoot', 2]]],
];
function pickKind(depth, r) {
  const band = BANDS.find(b => depth < b[0])[1];
  let tot = 0;
  for (const [, w] of band) tot += w;
  let x = r * tot;
  for (const [k, w] of band) { x -= w; if (x <= 0) return k; }
  return band[0][0];
}
let plants = [], trees = [], thawF = 0;
function placeWorld() {
  plants = []; trees = [];
  if (!IMG.sprites) return;
  const rnd = mulberry32((seed ^ 0x7ae5) >>> 0);
  const G = 19;
  for (let gy = -1; gy <= Math.ceil(H / G) + 1; gy++) for (let gx = -1; gx <= Math.ceil(W / G) + 1; gx++) {
    const x = (gx + 0.5 + (rnd() - 0.5) * 0.95) * G, y = (gy + 0.5 + (rnd() - 0.5) * 0.95) * G;
    plants.push({ x, y, r: rnd(), d: rnd(), rot: (rnd() - 0.5) * 0.7, sc: 0.8 + rnd() * 0.45, ph: rnd() * TAU, grow: 0, want: 0, kind: null, spr: null, delay: 0 });
  }
  if (!IMG.trees) return;
  const GT = 120;
  for (let gy = 0; gy <= Math.ceil(H / GT); gy++) for (let gx = 0; gx <= Math.ceil(W / GT); gx++) {
    const x = (gx + 0.5 + (rnd() - 0.5) * 0.8) * GT, y = (gy + 0.5 + (rnd() - 0.5) * 0.8) * GT;
    trees.push({ x, y, spr: IMG.trees[Math.floor(rnd() * IMG.trees.length)], R: 46 + rnd() * 22, ph: rnd() * TAU, grow: 0, want: 0, delay: 0, petals: 0 });
  }
}
function updateWants() {
  if (!IMG.sprites) return;
  const dens = clamp(P.bloom, 0, 2);
  for (const p of plants) {
    const e = edgeOff(p.x, p.y);
    const depth = -(curS(p.x, p.y) + e), finalDepth = -(targetS(p.x, p.y) + e);
    const cluster = fbm(p.x * 0.012, p.y * 0.012, 31);          // flowers grow in drifts, not evenly
    // the deeper into spring, the denser the meadow
    const drift = sstep(0.42, 0.62, cluster);                  // flower drifts with plain sward between
    // a light scatter of flowers in a few drifts; the glade stays calm
    const fill = (0.025 + 0.05 * sstep(20, 90, finalDepth)) * (0.2 + 1.0 * drift);
    const keep = depth > 5 && (p.d < fill * dens || p.boost) && !nearIcon(p.x, p.y, 3);
    if (keep && (!p.kind || p.want === 0)) {
      const kind = pickKind(finalDepth, p.r);   // what grows here once the thaw has settled
      if (kind !== p.kind) {
        const opts = IMG.byKind[kind] || IMG.byKind.shoots;
        p.kind = kind; p.spr = opts[Math.floor(p.r * 97) % opts.length];
      }
      p.delay = p.waveDelay != null ? p.waveDelay + p.d * 0.25 : 0.3 + Math.max(0, 100 - finalDepth) * 0.012 + p.d * 0.6;   // with a wave: open as the front passes
      p.waveDelay = null;
    }
    p.want = keep ? 1 : 0;
  }
  for (const t of trees) {
    const depth = -(curS(t.x, t.y) + edgeOff(t.x, t.y));
    const keep = depth > 105 + t.R * 0.4 && !nearIcon(t.x, t.y, t.R * 0.55);
    if (keep && t.want === 0) t.delay = 1.2 + Math.random() * 1.5;
    t.want = keep ? 1 : 0;
  }
}
// Share of the screen that has turned to spring: drives how much life is in the frame
function measureThaw() {
  if (!FB) return;
  let n = 0, k = 0;
  for (let i = 0; i < FB.s.length; i += 7) { n++; if (FB.s[i] < 0) k++; }
  thawF = n ? k / n : 0;
}

// Birds: fly in, hop and peck on the patches, fly off. More of them as more of the land thaws.
const birds = Array.from({ length: 9 }, (_, i) => ({ i, state: 'away', t: 4 + i * 5 + Math.random() * 6, x: 0, y: 0, hd: 0, tit: i % 3 !== 1, ph: 0, from: null, to: null, k: 0, hop: 1, peck: 0 }));
const activeBirds = () => clamp(Math.round(1 + thawF * 6), 1, 5);
function patchPoint(minDepth) {
  for (let k = 0; k < 50; k++) {
    const x = 30 + Math.random() * (W - 60), y = 30 + Math.random() * (H - 80);
    if (-targetS(x, y) > minDepth && !nearIcon(x, y, 4)) return { x, y };
  }
  return null;
}
function stepBird(b, dt) {
  b.t -= dt;
  if (!P.showBirds) { b.state = 'away'; return; }
  if (b.state === 'away') {
    if (b.t > 0) return;
    if (b.i >= activeBirds()) { b.t = 4; return; }          // still too wintry for this one
    const land = patchPoint(22);
    if (!land) { b.t = 5; return; }
    const a = Math.random() * TAU, R = Math.hypot(W, H) * 0.6;
    b.from = { x: land.x + Math.cos(a) * R, y: land.y + Math.sin(a) * R }; b.to = land;
    b.state = 'fly'; b.k = 0; b.x = b.from.x; b.y = b.from.y; b.hd = Math.atan2(land.y - b.from.y, land.x - b.from.x);
    return;
  }
  if (b.state === 'fly' || b.state === 'leave') {
    const D = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y);
    b.k = Math.min(1, b.k + dt * 190 / D);
    const e = b.state === 'fly' ? 1 - Math.pow(1 - b.k, 2) : b.k * b.k;
    b.x = b.from.x + (b.to.x - b.from.x) * e; b.y = b.from.y + (b.to.y - b.from.y) * e;
    b.ph += dt * 16;
    if (b.k >= 1) {
      if (b.state === 'fly') { b.state = 'ground'; b.t = 9 + Math.random() * 14; b.hop = 1; b.pause = 0.4; }
      else { b.state = 'away'; b.t = 14 + Math.random() * 26; }
    }
    return;
  }
  // on the ground: short hops between pecks
  if (b.t <= 0) {
    const a = Math.random() * TAU, R = Math.hypot(W, H) * 0.6;
    b.from = { x: b.x, y: b.y }; b.to = { x: b.x + Math.cos(a) * R, y: b.y + Math.sin(a) * R };
    b.hd = a; b.state = 'leave'; b.k = 0; return;
  }
  if (b.hop < 1) {
    b.hop = Math.min(1, b.hop + dt / 0.18);
    b.x = b.hf.x + (b.ht.x - b.hf.x) * b.hop; b.y = b.hf.y + (b.ht.y - b.hf.y) * b.hop;
    return;
  }
  b.pause -= dt;
  b.peck = b.pause > 0 && Math.sin(b.pause * 18) > 0.3 ? 1 : 0;
  if (b.pause > 0) return;
  let tx = 0, ty = 0, ok = false;
  for (let k = 0; k < 8 && !ok; k++) {
    const a = b.hd + (Math.random() - 0.5) * 2.2, L = 8 + Math.random() * 14;
    tx = b.x + Math.cos(a) * L; ty = b.y + Math.sin(a) * L;
    ok = -targetS(tx, ty) > 10 && !nearIcon(tx, ty, 2);
    if (ok) b.hd = a;
  }
  if (!ok) { b.hd += Math.PI * (0.6 + Math.random() * 0.8); b.pause = 0.3; return; }
  b.hf = { x: b.x, y: b.y }; b.ht = { x: tx, y: ty }; b.hop = 0; b.pause = 0.25 + Math.random() * 1.2;
}

// Butterflies and bees over the flowers; their number follows how much of the land is spring
const bflies = Array.from({ length: 30 }, (_, i) => ({ i, on: false, a: 0, x: 0, y: 0, tx: 0, ty: 0, hd: 0, ph: Math.random() * TAU, rest: 0, c: i % 4 }));
const bees = Array.from({ length: 14 }, (_, i) => ({ i, on: false, a: 0, x: 0, y: 0, tx: 0, ty: 0, hd: 0, hover: 0, ph: Math.random() * TAU }));
const flowerPoint = () => {
  for (let k = 0; k < 30; k++) {
    const p = plants[Math.floor(Math.random() * plants.length)];
    if (p && p.g > 0.6 && p.kind && !/grass|shoots|pebble|rock|clover|leaves|fern|bush_fresh/.test(p.kind)) return p;
  }
  return patchPoint(35);
};
function stepInsects(dt, t) {
  const nB = Math.round(clamp(thawF * 1.4, 0, 1) * 10 * clamp(P.bloom, 0, 1.5));
  for (const b of bflies) {
    const want = b.i < nB;
    if (!b.on) { if (!want) continue; const p = flowerPoint(); if (!p) continue; b.on = true; b.x = p.x + (Math.random() - 0.5) * 80; b.y = p.y + (Math.random() - 0.5) * 80; b.tx = p.x; b.ty = p.y; b.a = 0; b.rest = 0; }
    b.a = want ? Math.min(1, b.a + dt) : b.a - dt;
    if (b.a <= 0) { b.on = false; continue; }
    b.ph += dt * (b.rest > 0 ? 2.2 : 14);
    if (b.rest > 0) { b.rest -= dt; continue; }
    const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
    if (d < 6) {
      if (Math.random() < 0.4) b.rest = 1.5 + Math.random() * 4;
      const p = flowerPoint(); if (p) { b.tx = p.x + (Math.random() - 0.5) * 6; b.ty = p.y + (Math.random() - 0.5) * 6; }
      continue;
    }
    const want_hd = Math.atan2(dy, dx) + Math.sin(t * 3 + b.i) * 0.9;
    b.hd += clamp(((want_hd - b.hd + Math.PI * 3) % TAU) - Math.PI, -4 * dt, 4 * dt);
    const v = 38 + 14 * Math.sin(t * 5 + b.i), bw = windAt(b.x, b.y) * 22;
    b.x += (Math.cos(b.hd) * v + WIND[0] * bw) * dt; b.y += (Math.sin(b.hd) * v + WIND[1] * bw) * dt;
  }
  const nE = Math.round(clamp(thawF * 1.4, 0, 1) * 5 * clamp(P.bloom, 0, 1));
  for (const e of bees) {
    const want = e.i < nE;
    if (!e.on) { if (!want) continue; const p = flowerPoint(); if (!p) continue; e.on = true; e.x = p.x; e.y = p.y; e.tx = p.x; e.ty = p.y; e.a = 0; e.hover = 1; }
    e.a = want ? Math.min(1, e.a + dt) : e.a - dt;
    if (e.a <= 0) { e.on = false; continue; }
    e.ph += dt * 60;
    if (e.hover > 0) { e.hover -= dt; e.x += Math.sin(t * 9 + e.i) * 6 * dt; e.y += Math.cos(t * 11 + e.i) * 6 * dt; if (e.hover <= 0) { const p = flowerPoint(); if (p) { e.tx = p.x; e.ty = p.y; } } continue; }
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
    if (d < 4) { e.hover = 0.8 + Math.random() * 2; continue; }
    e.hd = Math.atan2(dy, dx) + Math.sin(t * 13 + e.i) * 0.5;
    const v = Math.min(d / dt, 110);
    e.x += Math.cos(e.hd) * v * dt; e.y += Math.sin(e.hd) * v * dt;
  }
}
const petals = Array.from({ length: 40 }, () => ({ on: false }));
function stepPetals(dt, t) {
  const blossom = trees.filter(tr => tr.g > 0.8 && /cherry|apple/.test(tr.spr.kind));
  for (const f of petals) {
    if (!f.on) {
      if (blossom.length && Math.random() < dt * 0.06 * blossom.length) {
        const tr = blossom[Math.floor(Math.random() * blossom.length)];
        const a = Math.random() * TAU, d = Math.random() * tr.R * 0.7;
        f.on = true; f.x = tr.x + Math.cos(a) * d; f.y = tr.y + Math.sin(a) * d; f.h = 0.7; f.ph = Math.random() * TAU; f.rot = Math.random() * TAU;
        f.pink = /cherry/.test(tr.spr.kind);
      }
      continue;
    }
    f.h -= dt * 0.12; f.x += (12 + Math.sin(t * 2 + f.ph) * 10) * dt; f.y += (6 + Math.cos(t * 1.6 + f.ph) * 6) * dt; f.rot += dt * 2;
    if (f.h <= -0.6) f.on = false;
  }
}

const MAX_FLAKES = 70;
const flakes = Array.from({ length: MAX_FLAKES }, () => ({ on: false }));
let flakeAcc = 0, flurry = 0, flurryT = 20;
function stepFlakes(dt, t) {
  // mostly still air; now and then a short, light flurry
  flurryT -= dt;
  if (flurryT <= 0) { flurry = 1; flurryT = 40 + Math.random() * 60; }
  flurry = Math.max(0, flurry - dt / 14);
  const rate = P.flakes * (2 + 22 * Math.sin(Math.min(1, flurry) * Math.PI));
  flakeAcc = Math.min(3, flakeAcc + dt * rate);
  for (const f of flakes) {
    if (!f.on) {
      if (flakeAcc >= 1) { f.on = true; flakeAcc -= 1; f.x = Math.random() * (W + 100) - 100; f.y = Math.random() * H; f.h = 0.6 + Math.random() * 0.4; f.v = 0.08 + Math.random() * 0.08; f.ph = Math.random() * TAU; f.size = 4 + Math.random() * 4; f.a = 0; }
      continue;
    }
    const w = windAt(f.x, f.y);
    f.h -= f.v * dt; f.x += (WIND[0] * 60 * w + Math.sin(t * 0.7 + f.ph) * 8) * dt; f.y += (WIND[1] * 60 * w + Math.cos(t * 1.1 + f.ph) * 6) * dt;
    f.a = Math.min(1, f.a + dt * 2) * sstep(0, 0.12, f.h);
    if (f.h <= 0 || f.x > W + 40) f.on = false;
  }
}

/* Rare small stories: one scene at a time, every couple of minutes. A hare crossing the snow
   (its tracks stay and fade), a crow flying over, a tit bathing in meltwater, two tits chasing. */
const prints = Array.from({ length: 160 }, () => ({ on: false, x: 0, y: 0, rot: 0, age: 0, life: 60, s: 1 }));
let printI = 0;
function addPrint(x, y, rot, s) {
  if (curS(x, y) + edgeOff(x, y) < 5) return;                 // only where there is snow to press
  const p = prints[printI]; printI = (printI + 1) % prints.length;
  p.on = true; p.x = x; p.y = y; p.rot = rot; p.age = 0; p.life = 50 + Math.random() * 20; p.s = s;
}
const ripples = Array.from({ length: 8 }, () => ({ on: false, x: 0, y: 0, age: 0 }));
const drops = Array.from({ length: 12 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, age: 0 }));
const pool = { x: 0, y: 0, rot: 0, a: 0 };
const ST = { kind: null, t: 0, next: 40 + Math.random() * 50, a: null, b: null, n: 0 };
function crossLine() {
  // a straight line across the screen through its middle part
  const cx = W * (0.25 + 0.5 * Math.random()), cy = H * (0.25 + 0.5 * Math.random());
  const hd = Math.random() * TAU, R = Math.hypot(W, H) * 0.6 + 60;
  return { x: cx - Math.cos(hd) * R, y: cy - Math.sin(hd) * R, hd, d: 0, L: 2 * R };
}
function meltSpot() {
  for (let k = 0; k < 80; k++) {
    const x = 40 + Math.random() * (W - 80), y = 40 + Math.random() * (H - 100);
    const depth = -(targetS(x, y) + edgeOff(x, y));
    if (depth > 5 && depth < 12 && !nearIcon(x, y, 6)) return { x, y };
  }
  return null;
}
function startStory(kind) {
  ST.t = 0; ST.a = ST.b = null;
  if (kind === 'hare') {
    if (thawF > 0.85) return false;                             // nothing left to cross
    const l = crossLine();
    ST.a = { ...l, f: 0, sit: 0, sitAt: l.L * (0.3 + 0.3 * Math.random()), sat: false, bound: 0 };
  } else if (kind === 'crow') {
    ST.a = { ...crossLine(), ph: 0 };
  } else if (kind === 'bath') {
    const to = meltSpot();
    if (!to) return false;
    const a = Math.random() * TAU, R = Math.hypot(W, H) * 0.6;
    ST.a = { from: { x: to.x + Math.cos(a) * R, y: to.y + Math.sin(a) * R }, to, x: 0, y: 0, hd: a + Math.PI, k: 0, ph: 0, phase: 'in', bath: 0, rip: 0 };
    ST.a.x = ST.a.from.x; ST.a.y = ST.a.from.y;
  } else if (kind === 'chase') {
    const l = crossLine(), k = 0.55;
    ST.a = { x: l.x + Math.cos(l.hd) * l.L * 0.5 * (1 - k), y: l.y + Math.sin(l.hd) * l.L * 0.5 * (1 - k), hd: l.hd, ph: 0 };
    l.x = ST.a.x; l.y = ST.a.y;
    ST.b = { x: l.x - Math.cos(l.hd) * 46, y: l.y - Math.sin(l.hd) * 46, hd: l.hd, ph: 2 };
  } else return false;
  ST.kind = kind; ST.n++;
  return true;
}
const offScreen = (o, m) => o.x < -m || o.y < -m || o.x > W + m || o.y > H + m;
function stepStory(dt) {
  for (const p of prints) if (p.on && (p.age += dt) > p.life) p.on = false;
  for (const r of ripples) if (r.on && (r.age += dt) > 1.6) r.on = false;
  const inBath = ST.kind === 'bath' && ST.a.phase === 'bath';
  pool.a = inBath ? Math.min(1, pool.a + dt * 1.5) : Math.max(0, pool.a - dt / 5);
  for (const d of drops) if (d.on) { d.age += dt; d.x += d.vx * dt; d.y += d.vy * dt; if (d.age > 0.45) d.on = false; }
  if (!ST.kind) {
    if (!P.showBirds) return;
    ST.next -= dt;
    if (ST.next > 0) return;
    const kinds = ['hare', 'crow', 'bath', 'chase'];
    const ok = startStory(kinds[(ST.n + Math.floor(Math.random() * 2)) % 4]);   // mostly in turn, never the same twice in a row
    ST.next = ok ? 90 + Math.random() * 110 : 15;
    return;
  }
  ST.t += dt;
  const a = ST.a;
  if (ST.kind === 'hare') {
    if (a.sit > 0) { a.sit -= dt; a.f = Math.floor(a.f); return; }   // sits up for a moment, listening
    const v = 230;
    a.x += Math.cos(a.hd) * v * dt; a.y += Math.sin(a.hd) * v * dt; a.d += v * dt;
    a.f += dt / 0.3;
    if (Math.floor(a.f) > a.bound) {
      // one bound = a Y of four prints: the long hind feet land side by side ahead of the front ones
      a.bound = Math.floor(a.f);
      const c = Math.cos(a.hd), s = Math.sin(a.hd);
      for (const sd of [-1, 1]) addPrint(a.x + c * 10 - s * sd * 4.5, a.y + s * 10 + c * sd * 4.5, a.hd, 1.2);
      addPrint(a.x - c * 6 + s * 1.5, a.y - s * 6 - c * 1.5, a.hd, 0.8);
      addPrint(a.x - c * 15 - s * 1.5, a.y - s * 15 + c * 1.5, a.hd, 0.8);
    }
    if (!a.sat && a.d > a.sitAt && curS(a.x, a.y) > 10) { a.sat = true; a.sit = 1.4 + Math.random() * 1.6; }
    for (const b of birds) if (b.state === 'ground' && Math.hypot(b.x - a.x, b.y - a.y) < 90) b.t = 0;   // birds take off
    if (a.d > a.L) ST.kind = null;
  } else if (ST.kind === 'crow') {
    const v = 150;
    a.hd += Math.sin(a.d * 0.004) * 0.08 * dt;
    a.x += Math.cos(a.hd) * v * dt; a.y += Math.sin(a.hd) * v * dt; a.d += v * dt;
    if (Math.sin(a.d * 0.006) < 0.3) a.ph += dt * 7;              // slow flaps, then a long glide
    if (a.d > a.L + 100) ST.kind = null;
  } else if (ST.kind === 'bath') {
    a.ph += dt * 16;
    if (a.phase === 'in' || a.phase === 'out') {
      const D = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y);
      a.k = Math.min(1, a.k + dt * 190 / D);
      const e = a.phase === 'in' ? 1 - (1 - a.k) ** 2 : a.k * a.k;
      a.x = a.from.x + (a.to.x - a.from.x) * e; a.y = a.from.y + (a.to.y - a.from.y) * e;
      if (a.k >= 1) {
        if (a.phase === 'in') { a.phase = 'bath'; a.bath = 5.5; pool.x = a.to.x; pool.y = a.to.y; pool.rot = Math.random() * TAU; }
        else ST.kind = null;
      }
    } else {
      // dips and shakes: little rings on the water and a few bright drops flung off
      a.bath -= dt; a.rip -= dt;
      a.x = a.to.x + Math.sin(ST.t * 23) * 1.2; a.y = a.to.y + Math.cos(ST.t * 19) * 0.8;
      if (a.rip <= 0) {
        a.rip = 0.35 + Math.random() * 0.35;
        const r = ripples.find(q => !q.on);
        if (r) { r.on = true; r.age = 0; r.x = a.to.x + (Math.random() - 0.5) * 6; r.y = a.to.y + (Math.random() - 0.5) * 6; }
        for (let k = 0; k < 3; k++) {
          const d = drops.find(q => !q.on); if (!d) break;
          const an = Math.random() * TAU, sp = 40 + Math.random() * 50;
          d.on = true; d.age = 0; d.x = a.to.x; d.y = a.to.y; d.vx = Math.cos(an) * sp; d.vy = Math.sin(an) * sp;
        }
      }
      if (a.bath <= 0) {
        const an = Math.random() * TAU, R = Math.hypot(W, H) * 0.6;
        a.from = { x: a.x, y: a.y }; a.to = { x: a.x + Math.cos(an) * R, y: a.y + Math.sin(an) * R };
        a.hd = an; a.k = 0; a.phase = 'out';
      }
    }
  } else if (ST.kind === 'chase') {
    const b = ST.b, t = ST.t;
    // fly into view first, then wherever the chase takes them
    if (t < 5) { const toC = Math.atan2(H / 2 - a.y, W / 2 - a.x); a.hd += clamp(((toC - a.hd + Math.PI * 3) % TAU) - Math.PI, -1.5 * dt, 1.5 * dt); }
    // the leader jinks along a wavy path, the other one cuts the corners after it
    a.hd += (Math.sin(t * 1.9) * 2.2 + Math.sin(t * 0.7 + 1) * 0.9) * dt;
    a.x += Math.cos(a.hd) * 210 * dt; a.y += Math.sin(a.hd) * 210 * dt;
    const want = Math.atan2(a.y - b.y, a.x - b.x);
    b.hd += clamp(((want - b.hd + Math.PI * 3) % TAU) - Math.PI, -3.6 * dt, 3.6 * dt);
    const gap = Math.hypot(a.x - b.x, a.y - b.y), vb = gap < 30 ? 195 : 228;
    b.x += Math.cos(b.hd) * vb * dt; b.y += Math.sin(b.hd) * vb * dt;
    a.ph += dt * 18; b.ph += dt * 18;
    if (t > 3 && offScreen(a, 80) && offScreen(b, 80)) ST.kind = null;
    if (t > 22) ST.kind = null;
  }
}
const HARE = 128, CROW = 96;
function birdFrame(ph) { return 2 + (Math.floor(ph) % 6); }
function storyShadows() {
  const a = ST.a;
  if (!ST.kind || !a) return;
  if (ST.kind === 'hare') {
    const fr = a.f % 1, up = a.sit > 0 ? 0 : Math.sin(fr * Math.PI);
    push(a.x, a.y, HARE, HARE, a.hd, 0.1 + 0.45 * up, SPR.hare[a.sit > 0 ? 0 : Math.floor(fr * 4)], 1, 1, 1, 0.5);
  } else if (ST.kind === 'crow') {
    push(a.x, a.y, CROW, CROW, a.hd, 4.5, SPR.crow[Math.floor(a.ph) % 6], 1, 1, 1, 0.42);
  } else if (ST.kind === 'bath') {
    const fl = a.phase !== 'bath';
    push(a.x, a.y, 48, 48, a.hd, fl ? 2.5 * Math.sin(a.k * Math.PI) + (a.phase === 'out' ? a.k * 3 : 0) : 0.05, SPR.tit[fl ? birdFrame(a.ph) : 0], 1, 1, 1, 0.5);
  } else if (ST.kind === 'chase') {
    for (const o of [a, ST.b]) push(o.x, o.y, 48, 48, o.hd, 2.2, SPR.tit[birdFrame(o.ph)], 1, 1, 1, 0.45);
  }
}
function storySprites() {
  if (pool.a > 0) push(pool.x, pool.y, 34, 26, pool.rot, 0, SPR.print, 0.8, 0.9, 1, 0.55 * pool.a);   // the little pool of meltwater
  for (const r of ripples) if (r.on) {
    const k = r.age / 1.6, sz = 6 + 22 * Math.sqrt(k);
    push(r.x, r.y, sz, sz * 0.8, 0, 0, SPR.ring, 0.62, 0.74, 0.9, 0.85 * (1 - k));
  }
  for (const d of drops) if (d.on) push(d.x, d.y, 4, 4, 0, 0, SPR.flake, 1, 1, 1, 0.9 * (1 - d.age / 0.45));
  const a = ST.a;
  if (!ST.kind || !a) return;
  if (ST.kind === 'hare') {
    const fr = a.f % 1;
    push(a.x, a.y, HARE, HARE, a.hd, 0, SPR.hare[a.sit > 0 ? 0 : Math.floor(fr * 4)], 1, 1, 1, 1);
  } else if (ST.kind === 'crow') {
    push(a.x, a.y, CROW * 1.25, CROW * 1.25, a.hd, 0, SPR.crow[Math.floor(a.ph) % 6], 1, 1, 1, 1);
  } else if (ST.kind === 'bath') {
    if (a.phase === 'bath') {
      // a quick flutter now and then, otherwise ducking (the pecking pose)
      const fl = Math.sin(ST.t * 5) > 0.55;
      push(a.x, a.y, 48, 48, a.hd + Math.sin(ST.t * 9) * 0.15, 0, SPR.tit[fl ? birdFrame(a.ph * 1.5) : (Math.sin(ST.t * 14) > 0 ? 1 : 0)], 1, 1, 1, 1);
    } else {
      const sz = 48 * (1 + 0.5 * Math.sin(a.k * Math.PI));
      push(a.x, a.y, sz, sz, a.hd, 0, SPR.tit[birdFrame(a.ph)], 1, 1, 1, 1);
    }
  } else if (ST.kind === 'chase') {
    for (const o of [a, ST.b]) push(o.x, o.y, 60, 60, o.hd, 0, SPR.tit[birdFrame(o.ph)], 1, 1, 1, 1);
  }
}

/* ======================================================================
   Frame assembly
   ====================================================================== */
const SHADOW_OFF = [10, 13];
let simT = 0;
function buildInstances(dt) {
  nInst = 0; segN = 0;
  // 0: shadows of plants, birds and flakes
  const sSh = segBegin();
  if (IMG.sprites) for (const p of plants) {
    if (p.want === 1 && p.grow < 1) { p.delay -= dt; if (p.delay > 0) { p.g = p.grow; } }
    const rate = p.want ? 0.8 : 1.6;
    if (!(p.want === 1 && p.delay > 0)) p.grow += clamp(p.want - p.grow, -rate * dt, rate * dt);
    // flowers open with a light spring: a small overshoot, then settle
    const gr = clamp(p.grow, 0, 1), g = p.want ? 1 + 2.6 * Math.pow(gr - 1, 3) + 1.6 * Math.pow(gr - 1, 2) : gr * gr * (3 - 2 * gr);
    p.g = g;
    if (g <= 0.01 || !p.spr) continue;
    const D = SIZES[p.kind] * p.sc / (p.spr.r * 2) * g;
    push(p.x, p.y, D, D, p.rot, /bush/.test(p.kind) ? 0.6 : 0.25, p.spr.uv, 1, 1, 1, 0.5);
  }
  segEnd(sSh);
  const sShT = segBegin();
  for (const t of trees) {
    if (t.want === 1 && t.grow < 1) t.delay -= dt;
    if (!(t.want === 1 && t.delay > 0)) t.grow += clamp(t.want - t.grow, -0.6 * dt, 0.45 * dt);
    const g = t.grow * t.grow * (3 - 2 * t.grow);
    t.g = g;
    if (g <= 0.01) continue;
    const D = t.R / t.spr.r * g;
    push(t.x, t.y, D, D, Math.sin(simT * 0.6 + t.ph) * 0.015, 1.6, t.spr.uv, 1, 1, 1, 0.6);
  }
  segEnd(sShT);
  const BIRD = 48;
  // hare tracks: pressed into the snow, drawn before everything that stands on the ground
  const sTrk = segBegin();
  for (const pr of prints) if (pr.on) push(pr.x, pr.y, 9 * pr.s, 6 * pr.s, pr.rot, 0, SPR.print, 1, 1, 1, sstep(0, 0.4, pr.age) * (1 - sstep(pr.life - 12, pr.life, pr.age)));
  segEnd(sTrk);
  const sShB = segBegin();
  storyShadows();
  for (const b of birds) if (b.state !== 'away') {
    const flying = b.state !== 'ground';
    const fr = flying ? 2 + (Math.floor(b.ph) % 6) : b.peck;
    const lift = flying ? 2.5 * Math.sin(Math.min(1, b.k) * Math.PI) + (b.state === 'leave' ? b.k * 3 : 0) : (b.hop < 1 ? Math.sin(b.hop * Math.PI) * 0.4 : 0.05);
    push(b.x, b.y, BIRD, BIRD, b.hd, lift, (b.tit ? SPR.tit : SPR.sparrow)[fr], 1, 1, 1, 0.5);
  }
  for (const f of flakes) if (f.on) push(f.x, f.y, f.size, f.size, 0, f.h * 6, SPR.flake, 1, 1, 1, 0.35 * f.a);
  for (const b of bflies) if (b.on) push(b.x, b.y, 22, 22, b.hd, b.rest > 0 ? 0.15 : 1.4, SPR.bfly[b.c][Math.floor(Math.abs(Math.sin(b.ph)) * 3.99)], 1, 1, 1, 0.3 * b.a);
  for (const f of petals) if (f.on && f.h > 0) push(f.x, f.y, 7, 7, f.rot, f.h * 3, SPR.petal, 1, 1, 1, 0.3);
  segEnd(sShB);
  // 1: plants (rendered atlas), 2: spring trees, 3: birds, insects, petals, flakes (painted atlas)
  const sPl = segBegin();
  if (IMG.sprites) for (const p of plants) {
    if (p.g <= 0.01 || !p.spr) continue;
    const D = SIZES[p.kind] * p.sc / (p.spr.r * 2) * p.g;
    // flowers lean with the shared wind: a small shift downwind plus a flutter in gusts
    const w = windAt(p.x, p.y), lean = (w - 0.25) * 4;
    const sway = Math.sin(simT * 1.3 + p.ph) * 0.04 + lean * (0.12 + 0.05 * Math.sin(simT * 7 + p.ph));
    push(p.x + WIND[0] * lean * 2.5, p.y + WIND[1] * lean * 2.5, D, D, p.rot + sway, 0, p.spr.uv, 1, 1, 1, Math.min(1, p.g * 1.5));
  }
  segEnd(sPl);
  const sTr = segBegin();
  for (const t of trees) if (t.g > 0.01) {
    const D = t.R / t.spr.r * t.g;
    const k = t.spr.kind === 'tree_apple' ? 1.28 : 1.04;     // white blossom renders a little grey
    push(t.x, t.y, D, D, Math.sin(simT * 0.6 + t.ph) * 0.015, 0, t.spr.uv, k, k, k, Math.min(1, t.g * 1.4));
  }
  segEnd(sTr);
  const sB = segBegin();
  for (const f of petals) if (f.on) {
    const a = f.h > 0 ? 1 : 1 + f.h / 0.6;
    push(f.x, f.y, 6 + f.h * 4, 6 + f.h * 4, f.rot, 0, SPR.petal, 1, f.pink ? 0.82 : 0.97, f.pink ? 0.88 : 0.97, a);
  }
  for (const e of bees) if (e.on) push(e.x, e.y, 12, 12, e.hd, 0, SPR.bee[Math.floor(e.ph) % 2], 1, 1, 1, e.a);
  for (const b of bflies) if (b.on) push(b.x, b.y, 22, 22, b.hd, 0, SPR.bfly[b.c][Math.floor(Math.abs(Math.sin(b.ph)) * 3.99)], 1, 1, 1, b.a);
  for (const b of birds) if (b.state !== 'away') {
    const flying = b.state !== 'ground';
    const fr = flying ? 2 + (Math.floor(b.ph) % 6) : b.peck;
    const sz = flying ? BIRD * (1 + 0.5 * Math.sin(Math.min(1, b.k) * Math.PI)) : BIRD * (1 + (b.hop < 1 ? 0.12 * Math.sin(b.hop * Math.PI) : 0));
    push(b.x, b.y, sz, sz, b.hd, 0, (b.tit ? SPR.tit : SPR.sparrow)[fr], 1, 1, 1, 1);
  }
  for (const f of flakes) if (f.on) { const sz = f.size * (1 + f.h * 0.8); push(f.x, f.y, sz, sz, 0, 0, SPR.flake, 1, 1, 1, 0.9 * f.a); }
  storySprites();
  segEnd(sB);
  return { sSh, sShT, sShB, sPl, sTr, sB, sTrk };
}

let atlasTex = null;
function setCommon(U, now) {
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(U.uNoise, 0);
  gl.uniform1f(U.uSeed, (seed % 997) * 0.37);
  gl.uniform1f(U.uTime, (now - T0) / 1000);
}
function drawSprites(seg, mode, now, tex) {
  if (!seg.count) return;
  const { p, U } = SPRITE;
  gl.useProgram(p);
  setCommon(U, now);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uAtlas, 1);
  gl.uniform2f(U.uRes, W, H);
  gl.uniform2f(U.uShadowOff, -LIGHT.dir[0] * LIGHT.len * 0.5, -LIGHT.dir[1] * LIGHT.len * 0.5);
  gl.uniform3fv(U.uTint, LIGHT.tint);
  gl.uniform1f(U.uMode, mode);
  bindInst(seg.start);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, seg.count);
}
function draw(now, dt) {
  const segs = buildInstances(dt);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, nInst * INST_F);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFB);
  gl.viewport(0, 0, shW, shH);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
  if (IMG.spriteTex) drawSprites(segs.sSh, 1, now, IMG.spriteTex);
  if (IMG.treeTex) drawSprites(segs.sShT, 1, now, IMG.treeTex);
  drawSprites(segs.sShB, 1, now, atlasTex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cv.width, cv.height);
  gl.disable(gl.BLEND);
  const { p, U } = GROUND;
  gl.useProgram(p);
  gl.bindVertexArray(emptyVAO);
  setCommon(U, now);
  const T = IMG.tiles;
  const bindT = (unit, name, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U[name], unit); };
  bindT(1, 'uFA', ftex[fromI]); bindT(2, 'uFB', ftex[toI]);
  bindT(3, 'uSnow', T.snow); bindT(4, 'uEarth', T.earth); bindT(5, 'uGreen', T.green); bindT(6, 'uGrass', T.grass);
  bindT(7, 'uShadow', shadowTex);
  gl.uniform2f(U.uRes, cv.width / cv._scale, cv.height / cv._scale);
  gl.uniform2f(U.uCanvas, cv.width, cv.height);
  gl.uniform2f(U.uGrid, Gw, Gh);
  gl.uniform1f(U.uScale, cv._scale);
  gl.uniform1f(U.uStep, STEP);
  gl.uniform1f(U.uMix, curMix);
  gl.uniform1f(U.uDebug, P.debug ? 1 : 0);
  for (let i = 0; i < MAX_CLICKS; i++) {
    const w = waves[i];
    WAVE_BUF[i * 4] = w ? w.x : 0; WAVE_BUF[i * 4 + 1] = w ? w.y : 0; WAVE_BUF[i * 4 + 2] = w ? w.t : -1; WAVE_BUF[i * 4 + 3] = w ? w.kind : 0;
  }
  gl.uniform4fv(U.uWaves, WAVE_BUF);
  gl.uniform3fv(U.uTint, LIGHT.tint); gl.uniform3fv(U.uSnowTint, LIGHT.snow);
  gl.uniform2fv(U.uToLight, LIGHT.dir); gl.uniform1f(U.uShadowLen, LIGHT.len);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  drawSprites(segs.sTrk, 0, now, atlasTex);
  if (IMG.spriteTex) drawSprites(segs.sPl, 0, now, IMG.spriteTex);
  if (IMG.treeTex) drawSprites(segs.sTr, 0, now, IMG.treeTex);
  drawSprites(segs.sB, 0, now, atlasTex);
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
T0w = T0;   // the CPU wind uses the shader's clock, so flowers lean exactly where the grass ripples
let lastT = 0, fpsEMA = 0, frameN = 0, paused = false;
const statsEl = document.getElementById('stats');
function step(dt, now) {
  const e = Math.min((now - morphT0) / morphDur, 1);
  curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
  simT += dt;
  if (frameN % 300 === 0 || layoutDirty) updateLight();
  if (layoutDirty || curMix < 1 || frameN % 15 === 0) { updateWants(); if (curMix >= 1) layoutDirty = false; }
  for (const b of birds) stepBird(b, dt);
  stepFlakes(dt, simT);
  stepInsects(dt, simT);
  stepPetals(dt, simT);
  stepStory(dt);
  stepPointer();
}
function frame(now) {
  requestAnimationFrame(frame);
  if (paused) { lastT = 0; return; }
  if (P.cap30 && now - lastT < 31) return;
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.03;
  if (lastT) fpsEMA = fpsEMA ? fpsEMA * 0.9 + (1 / dt) * 0.1 : 1 / dt;
  lastT = now;
  step(dt, now);
  draw(now, dt);
  if (++frameN % 15 === 0 && !WALL) statsEl.textContent = `${fpsEMA.toFixed(0)} fps · ${cv.width}×${cv.height} · sprites ${nInst}`;
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
    if (k === 'bloom' || k === 'hour' || k === 'byClock') layoutDirty = true;
  }
  if (adaptive && FB) commit();
  else if (field && FB) refresh();
}
function startHostedMode() {
  document.body.classList.add('wall');
  if (PREVIEW) document.body.classList.add('preview');
  icons = [];
  commit(true);
  let first = true, sentDrawn = false;
  const handle = m => {
    if (m.t === 'pause') { paused = PREVIEW ? false : m.v; return; }
    if (m.t === 'settings') { applySettings(m.v || {}); return; }
    if (m.t === 'pointer') { pointer(!!m.in, m.x, m.y, !!m.down); return; }
    if (m.t === 'reset') { applySettings(Object.assign({}, DEFAULTS, m.v || {})); return; }
    if (m.t !== 'icons') return;
    const k = window.devicePixelRatio || 1;
    const prev = icons;
    icons = m.vis ? m.r.map(([l, t, r, b]) => ({ x: l / k, y: t / k, w: (r - l) / k, h: (b - t) / k })) : [];
    if (!first) iconsMoved(prev, icons);
    if (PREVIEW) drawGhosts();
    iconsSeen = true;
    commit(first);
    first = false;
    // Tell the host the first layout is on screen (it keeps the old theme until then).
    if (!sentDrawn) { sentDrawn = true; requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage(JSON.stringify({ t: 'drawn' }), location.origin))); }
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

// Compare icon layouts: new spots get a spring wave, vacated spots a frost wave, birds nearby take off
const waves = new Array(MAX_CLICKS).fill(null), WAVE_BUF = new Float32Array(MAX_CLICKS * 4);
let waveI = 0;
function addWave(x, y, kind) {
  waves[waveI] = { x, y, t: (performance.now() - T0) / 1000, kind };
  waveI = (waveI + 1) % Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
}
function iconsMoved(prev, next) {
  const same = (a, b) => Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4;
  const added = next.filter(n => !prev.some(o => same(o, n)));
  const gone = prev.filter(o => !next.some(n => same(o, n)));
  if (added.length > 6) return;                          // a whole new layout: no fireworks
  for (const n of added) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    addWave(cx, cy, 0);
    for (const b of birds) if (b.state === 'ground' && Math.hypot(b.x - cx, b.y - cy) < 160) b.t = 0;   // startled
    for (const p of plants) { const d = Math.hypot(p.x - cx, p.y - cy); if (d < 320) p.waveDelay = 0.15 + d / 240; }
  }
  for (const o of gone) addWave(o.x + o.w / 2, o.y + o.h / 2, 1);
}

/* ---------- the cursor: birds on the ground take off when it comes close, butterflies keep
   away. A click in a thawed patch sends a spring wave and a few more flowers open; a click on
   the snow leaves a soft frost ring, and three quick taps on the snow call the hare. ---------- */
const PTR = { in: false, x: -1e4, y: -1e4, down: false, dx: 0, dy: 0, dt: 0 };
let snowTaps = [];
function pointer(inside, x, y, down) {
  const now = performance.now();
  PTR.in = inside; if (inside) { PTR.x = x; PTR.y = y; }
  if (down && !PTR.down) { PTR.dx = x; PTR.dy = y; PTR.dt = now; }
  if (!down && PTR.down && inside && now - PTR.dt < 600 && Math.hypot(x - PTR.dx, y - PTR.dy) < 8 && !nearIcon(x, y, 4)) clickAt(x, y);
  PTR.down = down && inside;
}
function clickAt(x, y) {
  const s = curS(x, y) + edgeOff(x, y);
  if (s < -6) {
    addWave(x, y, 0);
    for (const p of plants) { const d = Math.hypot(p.x - x, p.y - y); if (d < 46) { p.boost = true; p.waveDelay = 0.1 + d / 120; } else if (d < 220) p.waveDelay = 0.15 + d / 240; }
    for (const b of birds) if (b.state === 'ground' && Math.hypot(b.x - x, b.y - y) < 160) b.t = 0;
    layoutDirty = true;
    return;
  }
  addWave(x, y, 1);
  const t = now_s();
  snowTaps = snowTaps.filter(q => t - q < 3); snowTaps.push(t);
  if (snowTaps.length >= 3 && !ST.kind) { snowTaps = []; startStory('hare'); }
}
const now_s = () => performance.now() / 1000;
function stepPointer() {
  if (!PTR.in) return;
  for (const b of birds) if (b.state === 'ground' && b.t > 0.05 && Math.hypot(b.x - PTR.x, b.y - PTR.y) < 90) b.t = 0;
  for (const b of bflies) if (b.on && Math.hypot(b.x - PTR.x, b.y - PTR.y) < 80) {
    b.rest = 0; const a = Math.atan2(b.y - PTR.y, b.x - PTR.x); b.hd = a; b.x += Math.cos(a) * 3; b.y += Math.sin(a) * 3;
    b.tx = b.x + Math.cos(a) * 160; b.ty = b.y + Math.sin(a) * 160;
  }
}
if (!(WALL || PREVIEW)) {
  let down = false;
  addEventListener('pointermove', e => pointer(true, e.clientX, e.clientY, down));
  addEventListener('pointerdown', e => { down = true; pointer(true, e.clientX, e.clientY, down); });
  addEventListener('pointerup', e => { down = false; pointer(true, e.clientX, e.clientY, down); });
}

window.__dbg = {
  click: (x, y) => clickAt(x, y),
  // move a demo icon (standalone page) to preview the growth wave
  story(k) { ST.kind = null; return startStory(k); }, get story_() { return ST; },
  move(i, x, y) { const prev = icons.map(o => ({ ...o })); icons[i] = { ...icons[i], x, y }; drawGhosts(); iconsMoved(prev, icons); commit(); },
  P, birds, bflies, bees, get plants() { return plants; }, get trees() { return trees; }, get IMG() { return IMG; }, get thawF() { return thawF; },
  set(k, v) { applySettings({ [k]: v }); },
  bench() {
    const ts = [], px = new Uint8Array(4);
    for (let i = 0; i < 10; i++) { const a = performance.now(); draw(performance.now(), 0.033); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - a); }
    ts.sort((a, b) => a - b);
    return { frame: +ts[5].toFixed(1), canvas: cv.width + 'x' + cv.height, sprites: nInst };
  },
  advance(sec) {
    const dt = 1 / 30;
    for (let t = 0; t < sec; t += dt) { morphT0 -= dt * 1000; step(dt, performance.now()); buildInstances(dt); }
    draw(performance.now(), dt);
  },
};

/* ---------- start: load the rendered sprites and ground tiles, then run ---------- */
const loadImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
async function loadAssets() {
  const tile = async (name, fallback) => {
    try { return texFrom(await loadImg(`assets/thaw-${name}.webp`), true); } catch (e) { return flatTex(fallback); }
  };
  [IMG.tiles.snow, IMG.tiles.earth, IMG.tiles.green, IMG.tiles.grass] = await Promise.all([
    tile('snow', '#e8ecf0'), tile('earth', '#3b2c22'), tile('green', '#4d5a2c'), tile('grass', '#8a7d4c'),
  ]);
  try {
    const m = await (await fetch('assets/thaw-sprites.json')).json();
    const img = await loadImg('assets/thaw-sprites.webp');
    const g = m.grid;
    IMG.sprites = m.sprites.map((k, i) => ({ kind: k.kind, r: k.r, uv: [(i % g) / g, Math.floor(i / g) / g, (i % g + 1) / g, (Math.floor(i / g) + 1) / g] }));
    IMG.byKind = {};
    for (const s of IMG.sprites) (IMG.byKind[s.kind] ||= []).push(s);
    IMG.spriteTex = texFrom(img, false);
  } catch (e) { IMG.sprites = null; }
}
await loadAssets();
paintAll();
atlasTex = texFrom(atlasCv, false);
buildNoiseTex();
resize();
if (WALL || PREVIEW) startHostedMode();
else { icons = demoIcons(); drawGhosts(); iconsSeen = true; commit(true); }
requestAnimationFrame(frame);
