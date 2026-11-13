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
const STEP = 5, MORPH_MS = 2200, WARP = 46;
const P = { sigma: 108, bloom: 1, flakes: 0.6, showBirds: 1, adaptive: 1, quality: 2, cap30: true, debug: false };
const DEFAULTS = Object.assign({}, P);
const NUM_KEYS = ['sigma', 'bloom', 'flakes'];
const DISPLAY_KEYS = ['showBirds', 'adaptive'];

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
    NZ.wx[i] = fbm(x * 0.0032, y * 0.0032, 1) - 0.47;
    NZ.wy[i] = fbm(x * 0.0032, y * 0.0032, 2) - 0.47;
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
  const BACK = tit ? '#8a9a52' : '#8a6a46', WING = tit ? '#6f8396' : '#6e5136', DARK = '#1d1a18';
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
  if (tit) {
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
const SPR = { tit: [], sparrow: [], flake: null };
function paintAll() {
  for (const tit of [true, false]) {
    const arr = tit ? SPR.tit : SPR.sparrow;
    arr.push(paintSprite(64, (g, S) => paintBird(g, S, 0, tit)));
    arr.push(paintSprite(64, (g, S) => paintBird(g, S, 1, tit)));
    for (let i = 0; i < 6; i++) arr.push(paintSprite(64, (g, S) => paintBird(g, S, 1 + 0.15 + 0.85 * Math.abs(Math.cos(i / 6 * Math.PI)), tit)));
  }
  SPR.flake = paintSprite(32, paintFlake);
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
out vec4 o;
const vec2 TO_LIGHT = vec2(-0.6, -0.8);
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
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;
  float s = fieldS(p);
  vec2 gr = vec2(fieldS(p + vec2(3.0, 0.0)) - fieldS(p - vec2(3.0, 0.0)), fieldS(p + vec2(0.0, 3.0)) - fieldS(p - vec2(0.0, 3.0)));
  vec2 nrm = length(gr) > 1e-4 ? normalize(gr) : vec2(0.0);
  // a slightly ragged edge: melt line wanders a few px with fine noise
  float edgeN = (N(p, 60.0).g - 0.5) * 9.0 + (N(p, 18.0).b - 0.5) * 4.0;
  float se = s + edgeN;

  // ---------- snow: calm, faint drifts, cool where it faces away from the sun ----------
  // the scan only adds fine grain; its tracks and marks are clamped so the field stays calm
  float sl = dot(texture(uSnow, p / 300.0).rgb, vec3(0.333));
  float sa = dot(textureLod(uSnow, vec2(0.5), 10.0).rgb, vec3(0.333));
  vec3 snow = vec3(0.935, 0.95, 0.972) * (1.0 + clamp(sl - sa, -0.015, 0.04) * 0.8);
  float drift = N(p, 1600.0).g * 0.6 + N(p + 90.0, 520.0).r * 0.4;
  snow *= mix(vec3(0.982, 0.987, 0.998), vec3(1.008, 1.006, 1.003), ss(0.3, 0.7, drift));
  // the snow wall around a patch: raised rim, lit on the side facing the sun, blue on the far side
  float rim = ss(30.0, 2.0, se) * ss(-3.0, 3.0, se);
  float facing = dot(-nrm, TO_LIGHT);
  snow *= mix(vec3(1.0), facing > 0.0 ? vec3(1.05, 1.045, 1.03) : vec3(0.76, 0.83, 0.96), rim * abs(facing) * 0.85);
  // grainy, grey-blue slush right at the melt line
  float crust = ss(9.0, 0.0, se) * ss(-3.0, 1.0, se);
  vec3 slush = vec3(0.74, 0.78, 0.82) * (0.88 + 0.24 * hash2(floor(p * 0.8)));
  snow = mix(snow, slush, crust * 0.7);
  // sun glints: rare, tiny, twinkling
  vec2 gc = floor(p / 7.0);
  float gh = hash2(gc + 17.0);
  float tw = 0.5 + 0.5 * sin(uTime * (1.5 + gh * 3.0) + gh * 40.0);
  float glint = step(0.9965, gh) * pow(tw, 6.0) * (1.0 - ss(0.0, 2.2, length(p - (gc + 0.5) * 7.0)));
  snow += vec3(1.0, 0.98, 0.9) * glint * 0.55 * ss(0.0, 20.0, s);

  // ---------- the thawed patch: wet rim, earth, last year's grass, green, puddles ----------
  float depth = -se;
  vec3 earth = tex2(uEarth, p, 420.0);
  vec3 green = tex2(uGreen, p, 460.0);
  vec3 grass = tex2(uGrass, p, 520.0);
  vec3 g = earth;
  // last year's grass lies matted and pale right at the snow line, wet earth further in
  g = mix(g, grass * vec3(1.08, 1.04, 0.95), clamp(ss(34.0, 6.0, depth) * 0.75 + ss(0.5, 0.64, N(p + 300.0, 260.0).b) * 0.35, 0.0, 0.85));
  g = mix(g, green, ss(28.0, 75.0, depth) * (0.55 + 0.45 * ss(0.35, 0.6, N(p + 731.0, 380.0).r)));
  g *= mix(0.86, 1.0, ss(0.0, 9.0, depth));                  // thin wet rim along the snow
  g = mix(g, vec3(0.62, 0.66, 0.68) * (0.85 + 0.3 * hash2(floor(p * 0.7))), ss(5.0, 0.0, depth) * 0.55);   // slush on the earth side
  g *= 1.08 + 0.1 * ss(10.0, 40.0, depth);
  // shade cast by the snow wall onto the patch (sun from the top left)
  float wall = ss(-2.0, 10.0, fieldS(p + TO_LIGHT * 14.0) + edgeN) * ss(0.0, 30.0, depth);
  g *= mix(vec3(1.0), vec3(0.66, 0.72, 0.86), wall * 0.75);
  // puddles in the hollows of older patches: sky reflection, ripples from drips
  float pm = N(p + 1200.0, 300.0).r * 0.7 + N(p + 40.0, 120.0).g * 0.3;
  float pud = ss(0.73, 0.76, pm) * ss(34.0, 60.0, depth);
  if (pud > 0.001) {
    vec2 rc = floor(p / 46.0);
    float rp = hash2(rc), period = 3.5 + rp * 4.0;
    float t = mod(uTime + rp * 10.0, period);
    vec2 c = (rc + 0.25 + 0.5 * vec2(hash2(rc + 3.0), hash2(rc + 7.0))) * 46.0;
    float ring = t < 1.6 ? (1.0 - ss(0.0, 1.6, t)) * (1.0 - ss(0.0, 1.6, abs(length(p - c) - t * 14.0))) : 0.0;
    vec3 sky = mix(vec3(0.4, 0.46, 0.52), vec3(0.56, 0.61, 0.66), ss(0.0, 1.0, (p.y / uRes.y)));
    float shimmer = (N(p + vec2(uTime * 6.0, 0.0), 40.0).r - 0.5) * 0.14;
    vec3 water = sky * (0.85 + shimmer) + ring * 0.2;
    water = mix(water, g * 0.45, ss(0.76, 0.735, pm) * 0.75);   // muddy shallow edge
    g = mix(g, water, pud);
  }
  float sh = texture(uShadow, gl_FragCoord.xy / uCanvas).g;
  g *= mix(vec3(1.0), vec3(0.55, 0.55, 0.66), sh * 0.8);
  snow *= mix(vec3(1.0), vec3(0.74, 0.8, 0.95), sh * 0.7);

  float land = ss(1.0, -1.0, se);
  vec3 col = mix(snow, g, land);
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
in vec2 vUV, vW;
in vec4 vCol;
out vec4 o;
void main() {
  if (uMode > 0.5) { float a = texture(uAtlas, vUV, 1.5).a * vCol.a; o = vec4(0.0, a, 0.0, 0.0); return; }
  vec4 t = texture(uAtlas, vUV);
  o = vec4(t.rgb * vCol.rgb * cloudShade(vW), t.a) * vCol.a;
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
let noiseTex = null;
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
const IMG = { sprites: null, spriteTex: null, tiles: {} };
// Which plants come up how far into the patch (depth = px from the melt line)
const SIZES = { snowdrops: 26, snowdrop: 15, crocuses: 30, crocus: 18, crocuses_white: 28, coltsfoot: 26, clover: 20,
  shoots: 22, old_grass: 26, leaves: 22, fern: 28, pebble: 13, rock: 24 };
function pickKind(depth, r) {
  if (depth < 16) return r < 0.6 ? 'old_grass' : 'shoots';
  if (depth < 34) return r < 0.35 ? 'shoots' : r < 0.55 ? 'old_grass' : r < 0.8 ? 'snowdrop' : 'clover';
  if (depth < 60) return r < 0.25 ? 'snowdrops' : r < 0.4 ? 'shoots' : r < 0.55 ? 'clover' : r < 0.68 ? 'crocus' : r < 0.78 ? 'leaves' : r < 0.86 ? 'coltsfoot' : r < 0.94 ? 'snowdrop' : 'rock';
  return r < 0.22 ? 'crocuses' : r < 0.34 ? 'crocuses_white' : r < 0.48 ? 'snowdrops' : r < 0.6 ? 'coltsfoot' : r < 0.72 ? 'clover' : r < 0.82 ? 'leaves' : r < 0.9 ? 'fern' : 'crocus';
}
let plants = [];
function placeWorld() {
  plants = [];
  if (!IMG.sprites) return;
  const rnd = mulberry32((seed ^ 0x7ae5) >>> 0);
  const G = 21;
  for (let gy = -1; gy <= Math.ceil(H / G) + 1; gy++) for (let gx = -1; gx <= Math.ceil(W / G) + 1; gx++) {
    const x = (gx + 0.5 + (rnd() - 0.5) * 0.95) * G, y = (gy + 0.5 + (rnd() - 0.5) * 0.95) * G;
    plants.push({ x, y, r: rnd(), d: rnd(), rot: (rnd() - 0.5) * 0.7, sc: 0.8 + rnd() * 0.45, grow: 0, want: 0, kind: null, spr: null, delay: 0 });
  }
}
function updateWants() {
  if (!IMG.sprites) return;
  const dens = clamp(P.bloom, 0, 2);
  for (const p of plants) {
    const depth = -curS(p.x, p.y), finalDepth = -targetS(p.x, p.y);
    const cluster = fbm(p.x * 0.012, p.y * 0.012, 31);          // flowers grow in drifts, not evenly
    const keep = depth > 6 && p.d < (0.18 + 0.5 * cluster) * dens && !nearIcon(p.x, p.y, 3);
    if (keep && (!p.kind || p.want === 0)) {
      const kind = pickKind(finalDepth, p.r);   // what grows here once the thaw has settled
      if (kind !== p.kind) {
        const opts = IMG.byKind[kind] || IMG.byKind.shoots;
        p.kind = kind; p.spr = opts[Math.floor(p.r * 97) % opts.length];
      }
      p.delay = 0.3 + Math.max(0, 90 - finalDepth) * 0.015 + p.d * 0.6;   // deep in the patch comes up first                // nearer the icon comes up first
    }
    p.want = keep ? 1 : 0;
  }
}

// Birds: fly in, hop and peck on the patches, fly off
const birds = [0, 1, 2].map(i => ({ state: 'away', t: 4 + i * 7 + Math.random() * 6, x: 0, y: 0, hd: 0, tit: i !== 1, ph: 0, from: null, to: null, k: 0, hop: 1, peck: 0 }));
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
    f.h -= f.v * dt; f.x += (14 + Math.sin(t * 0.7 + f.ph) * 10) * dt; f.y += (5 + Math.cos(t * 1.1 + f.ph) * 6) * dt;
    f.a = Math.min(1, f.a + dt * 2) * sstep(0, 0.12, f.h);
    if (f.h <= 0 || f.x > W + 40) f.on = false;
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
    const g = p.grow * p.grow * (3 - 2 * p.grow);
    p.g = g;
    if (g <= 0.01 || !p.spr) continue;
    const D = SIZES[p.kind] * p.sc / (p.spr.r * 2) * g;
    push(p.x, p.y, D, D, p.rot, 0.25, p.spr.uv, 1, 1, 1, 0.5);
  }
  segEnd(sSh);
  const sShB = segBegin();
  for (const b of birds) if (b.state !== 'away') {
    const flying = b.state !== 'ground';
    const fr = flying ? 2 + (Math.floor(b.ph) % 6) : b.peck;
    const lift = flying ? 2.5 * Math.sin(Math.min(1, b.k) * Math.PI) + (b.state === 'leave' ? b.k * 3 : 0) : (b.hop < 1 ? Math.sin(b.hop * Math.PI) * 0.4 : 0.05);
    push(b.x, b.y, 30, 30, b.hd, lift, (b.tit ? SPR.tit : SPR.sparrow)[fr], 1, 1, 1, 0.5);
  }
  for (const f of flakes) if (f.on) push(f.x, f.y, f.size, f.size, 0, f.h * 6, SPR.flake, 1, 1, 1, 0.35 * f.a);
  segEnd(sShB);
  // 1: plants (rendered atlas), 2: birds and flakes (painted atlas)
  const sPl = segBegin();
  if (IMG.sprites) for (const p of plants) {
    if (p.g <= 0.01 || !p.spr) continue;
    const D = SIZES[p.kind] * p.sc / (p.spr.r * 2) * p.g;
    push(p.x, p.y, D, D, p.rot, 0, p.spr.uv, 1, 1, 1, Math.min(1, p.g * 1.5));
  }
  segEnd(sPl);
  const sB = segBegin();
  for (const b of birds) if (b.state !== 'away') {
    const flying = b.state !== 'ground';
    const fr = flying ? 2 + (Math.floor(b.ph) % 6) : b.peck;
    const sz = flying ? 30 * (1 + 0.5 * Math.sin(Math.min(1, b.k) * Math.PI)) : 30 * (1 + (b.hop < 1 ? 0.12 * Math.sin(b.hop * Math.PI) : 0));
    push(b.x, b.y, sz, sz, b.hd, 0, (b.tit ? SPR.tit : SPR.sparrow)[fr], 1, 1, 1, 1);
  }
  for (const f of flakes) if (f.on) { const sz = f.size * (1 + f.h * 0.8); push(f.x, f.y, sz, sz, 0, 0, SPR.flake, 1, 1, 1, 0.9 * f.a); }
  segEnd(sB);
  return { sSh, sShB, sPl, sB };
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
  gl.uniform2f(U.uShadowOff, SHADOW_OFF[0], SHADOW_OFF[1]);
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  if (IMG.spriteTex) drawSprites(segs.sPl, 0, now, IMG.spriteTex);
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
let lastT = 0, fpsEMA = 0, frameN = 0, paused = false;
const statsEl = document.getElementById('stats');
function step(dt, now) {
  const e = Math.min((now - morphT0) / morphDur, 1);
  curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
  simT += dt;
  if (layoutDirty || curMix < 1 || frameN % 15 === 0) { updateWants(); if (curMix >= 1) layoutDirty = false; }
  for (const b of birds) stepBird(b, dt);
  stepFlakes(dt, simT);
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
    if (k === 'bloom') layoutDirty = true;
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
  P, birds, get plants() { return plants; }, get IMG() { return IMG; },
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
