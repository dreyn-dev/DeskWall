// DeskWall · Mycelium ("Грибница").
// A dark forest floor at night. From every icon a mycelium spreads: thin glowing threads that
// wander, fork and reach for the neighbouring icons, so icons in a row or column share one
// network. Each knot of threads glows in its own colour (teal, violet, amber, pink, sky, lime)
// and the colours blend where the threads meet. The glow lights the moss right around the
// icons; the rest of the screen stays dark and calm. Threads are dimmed behind icons and
// captions so the text stays readable.
// Motion: slow waves of brightness run through the net, knots breathe, sparks of light travel
// along the threads, spores drift up. Cursor: threads brighten around it. Click the bare ground:
// a new thread grows from the nearest knot to that spot and puffs spores. Click a knot: it sends
// a burst of sparks along its threads.
import {
  MAX_CLICKS, nextClick,
  QS, TAU, clamp, mix, Field, Morph, iconRects,
  NOISE_GLSL, FULL_VS, makeGL, program, runPage, diffIcons, rng, RNG, noise, STEP,
} from './kit.js';

/* ======================================================================
   Parameters (keys match apps/desktop/src/shared/themes.ts)
   ====================================================================== */
const P = { density: 1, spread: 1, glow: 1, colors: 1, pulses: 1, spores: 1, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
const HUES = [[70, 230, 200], [150, 110, 255], [255, 160, 80], [255, 110, 180], [120, 220, 255], [170, 240, 110]];
const MAX_LIGHTS = 64;

/* ======================================================================
   Ground: dark night floor; moss and leaf litter show only where the knots light them.
   Drawn into a cached texture when the icons change.
   ====================================================================== */
const GROUND_FS = `#version 300 es
precision highp float;
${NOISE_GLSL}
uniform sampler2D uF;
uniform vec2 uCv, uGrid;
uniform float uScale, uNL, uU, uGlow;
uniform vec4 uL[${MAX_LIGHTS}];     // x, y, radius, intensity (CSS px)
uniform vec3 uLC[${MAX_LIGHTS}];    // colour 0..1
out vec4 o;
float field(vec2 p) { return texture(uF, (p / ${STEP.toFixed(1)} + 0.5) / uGrid).r; }
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  vec2 q = p / uU;                          // pattern scale follows the icon size
  float yv = dev.y / uCv.y;
  vec3 col = mix(vec3(8.0, 15.0, 19.0), vec3(10.0, 21.0, 24.0), yv) / 255.0;
  float m = (fbm3(q / 320.0) - 0.5) * 6.0 / 255.0; col += vec3(m * 0.5, m, m);
  vec2 c = dev / uCv - 0.5; c.y *= 0.8;
  col = mix(col, vec3(5.0, 10.0, 13.0) / 255.0, smoothstep(0.45, 1.1, length(c)) * 0.7);
  vec3 L = vec3(0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (float(i) >= uNL) break;
    vec4 l = uL[i]; vec2 d = (p - l.xy) * vec2(1.0, 1.25);
    float k = dot(d, d) / (l.z * l.z); if (k > 9.0) continue;
    L += l.w * exp(-k * 2.2) * uLC[i];
  }
  L *= uGlow;
  float dw = field(p) / uU + (fbm3(q / 80.0) - 0.5) * 70.0;
  float fl = smoothstep(90.0, -30.0, dw);
  float alb = fl > 0.0 ? 0.10 + fl * 0.26 * fbm3(q / 5.0) : 0.10 + 0.06 * vn(q / 6.0);
  col += L * alb * 0.55 + L * 0.035;
  col += (h21(dev) - 0.5) * 1.6 / 255.0;
  o = vec4(col, 1.0);
}`;

/* every frame: the cached ground (old and new layout cross-fade) */
const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uB0, uB1;
uniform float uK;
out vec4 o;
void main() { ivec2 fc = ivec2(gl_FragCoord.xy); o = vec4(mix(texelFetch(uB0, fc, 0).rgb, texelFetch(uB1, fc, 0).rgb, uK), 1.0); }`;

/* glowing points: knots, sparks, spores; additive */
const PT_VS = `#version 300 es
layout(location = 0) in vec4 aP;      // x, y (CSS px), radius (CSS px), profile (0 soft, 1 bokeh)
layout(location = 1) in vec4 aC;      // rgb 0..1, alpha
uniform vec2 uRes; uniform float uScale;
out vec4 vC; out float vK;
void main() { vC = aC; vK = aP.w; gl_PointSize = max(1.0, aP.z * 2.0 * uScale); gl_Position = vec4(aP.xy / uRes * vec2(2, -2) + vec2(-1, 1), 0, 1); }`;
const PT_FS = `#version 300 es
precision highp float;
in vec4 vC; in float vK; out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q);
  float a = vK > 0.5 ? (1.0 - smoothstep(0.7, 1.0, d)) * (0.55 + 0.45 * d)
                     : (exp(-d * 30.0) * 0.9 + exp(-d * 6.0) * 0.28) * (1.0 - smoothstep(0.75, 1.0, d));
  o = vec4(vC.rgb * a * vC.a, 0.0);
}`;
/* Every thread is drawn the same way: one instanced quad per segment with a thin sharp core and
   a soft glow, computed per pixel, so threads stay crisp at any screen density. The net of a
   layout sits in a static buffer; grown threads and reaching tufts are rebuilt each frame. */
const ST_VS = `#version 300 es
layout(location = 0) in vec4 aS;      // segment x0, y0, x1, y1 (CSS px)
layout(location = 1) in vec4 aC;      // colour 0..1, alpha
layout(location = 2) in float aW;     // core width (CSS px)
uniform vec2 uRes; uniform float uHW;
out vec4 vC; out float vD; out float vW;
void main() {
  float t = float(gl_VertexID & 1), side = (gl_VertexID & 2) != 0 ? 1.0 : -1.0;
  vec2 d = aS.zw - aS.xy; float l = max(length(d), 1e-4); vec2 n = vec2(-d.y, d.x) / l;
  vec2 p = mix(aS.xy, aS.zw, t) + n * side * uHW;
  vC = aC; vD = side * uHW; vW = aW;
  gl_Position = vec4(p / uRes * vec2(2, -2) + vec2(-1, 1), 0, 1);
}`;
const ST_FS = `#version 300 es
precision highp float;
${NOISE_GLSL}
uniform float uScale, uU, uA, uTime, uGlow;
uniform vec2 uCv; uniform vec3 uPtr;
uniform sampler2D uMask;
in vec4 vC; in float vD; in float vW; out vec4 o;
void main() {
  float d = abs(vD) * uScale, hw = vW * uScale * 0.5;
  float core = 1.0 - smoothstep(hw - 0.5, hw + 0.8, d);
  float g = exp(-pow(abs(vD) / (1.9 * uU), 2.0)) * 0.45;
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  float br = 0.72 + 0.56 * vn(p * 0.004 + vec2(uTime * 0.05, -uTime * 0.031));
  vec2 dp = p - uPtr.xy; br += uPtr.z * 0.9 * exp(-dot(dp, dp) / (150.0 * 150.0));
  float m = 1.0 - 0.72 * texture(uMask, dev / uCv).r;     // dimmed behind icons and captions
  o = vec4(vC.rgb * vC.a * (core + g) * br * uGlow * uA * m, 0.0);
}`;

/* ======================================================================
   GL
   ====================================================================== */
const cv = document.getElementById('art');
const gl = makeGL(cv);
const GROUND = program(gl, FULL_VS, GROUND_FS);
const COMPOSE = program(gl, FULL_VS, COMPOSE_FS);
const PTS = program(gl, PT_VS, PT_FS);
const STR = program(gl, ST_VS, ST_FS);
const VAO0 = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 1);
let W = 1, H = 1, CW = 1, CH = 1;
const T0 = performance.now();
const secs = now => (now - T0) / 1000;

// two slots of (ground, threads); a new layout fades in over the old one
const slots = [0, 1].map(() => ({ base: gl.createTexture(), fb: gl.createFramebuffer(), vbo: gl.createBuffer(), vao: gl.createVertexArray(), n: 0 }));
const maskTex = gl.createTexture();
let cur = 0, fadeT0 = -1e9, fadeK = 1;
const FADE_MS = 1600;
function allocSlots() {
  for (const s of slots) {
    gl.bindTexture(gl.TEXTURE_2D, s.base);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, CW, CH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.base, 0);
    gl.clearColor(0.03, 0.06, 0.075, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// point and line buffers (filled in place every frame, no allocations)
const MAX_PTS = 4096;
const ptBuf = new Float32Array(MAX_PTS * 8);
let nPts = 0;
const ptVBO = gl.createBuffer(), ptVAO = gl.createVertexArray();
gl.bindVertexArray(ptVAO); gl.bindBuffer(gl.ARRAY_BUFFER, ptVBO); gl.bufferData(gl.ARRAY_BUFFER, ptBuf.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
const SEGF = 9;                          // floats per segment instance
function segVAO(vao, vbo) {
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, SEGF * 4, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, SEGF * 4, 16); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, SEGF * 4, 32); gl.vertexAttribDivisor(2, 1);
}
const MAX_SEG = 60000;
const stBuf = new Float32Array(MAX_SEG * SEGF);
let nSeg = 0;
const stVBO = gl.createBuffer(), stVAO = gl.createVertexArray();
gl.bindBuffer(gl.ARRAY_BUFFER, stVBO); gl.bufferData(gl.ARRAY_BUFFER, stBuf.byteLength, gl.DYNAMIC_DRAW);
segVAO(stVAO, stVBO);
for (const s of slots) segVAO(s.vao, s.vbo);
gl.bindVertexArray(null);
function pt(x, y, r, kind, c, a) {
  if (nPts >= MAX_PTS || a <= 0.002) return;
  const o = nPts++ * 8; ptBuf[o] = x; ptBuf[o + 1] = y; ptBuf[o + 2] = r; ptBuf[o + 3] = kind;
  ptBuf[o + 4] = c[0]; ptBuf[o + 5] = c[1]; ptBuf[o + 6] = c[2]; ptBuf[o + 7] = a;
}
/** One live segment from (x0, y0) to (x1, y1): core width w (CSS px), colour c (0..1), alpha a. */
function seg(x0, y0, x1, y1, w, c, a) {
  if (nSeg >= MAX_SEG || a <= 0.003) return;
  const o = nSeg++ * SEGF;
  stBuf[o] = x0; stBuf[o + 1] = y0; stBuf[o + 2] = x1; stBuf[o + 3] = y1;
  stBuf[o + 4] = c[0]; stBuf[o + 5] = c[1]; stBuf[o + 6] = c[2]; stBuf[o + 7] = a; stBuf[o + 8] = w;
}
/** The static net of a layout, built once: a growing list of segment instances. */
let netBuf = new Float32Array(SEGF * 65536), nNet = 0;
function netSeg(x0, y0, x1, y1, w, c, a) {
  if ((nNet + 1) * SEGF > netBuf.length) { const b = new Float32Array(netBuf.length * 2); b.set(netBuf); netBuf = b; }
  const o = nNet++ * SEGF;
  netBuf[o] = x0; netBuf[o + 1] = y0; netBuf[o + 2] = x1; netBuf[o + 3] = y1;
  netBuf[o + 4] = c[0]; netBuf[o + 5] = c[1]; netBuf[o + 6] = c[2]; netBuf[o + 7] = a; netBuf[o + 8] = w;
}

/* ======================================================================
   World: knots (roots) next to icons, threads between them
   ====================================================================== */
let icons = [];
let U = 1;                       // icon-size unit: 1 at a 124 px tall icon cell
let roots = [], lights = [], hyphae = [], nodes = [];
const LBUF = new Float32Array(MAX_LIGHTS * 4), LCOL = new Float32Array(MAX_LIGHTS * 3);
const thrCanvas = document.createElement('canvas');
const tg = thrCanvas.getContext('2d');

function groups(list) {
  const n = list.length, par = list.map((_, i) => i);
  const find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = list[i], b = list[j];
    const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    if (gx < 34 && gy < 34) par[find(i)] = find(j);
  }
  const m = new Map();
  list.forEach((ic, i) => { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(ic); });
  return [...m.values()];
}
const overIcon = (x, y, r) => icons.some(ic => x + r > ic.x && x - r < ic.x + ic.w && y + r > ic.y && y - r < ic.y + ic.h);
const lightCol = (x, y, out) => {
  let r = 0, g = 0, b = 0, w = 0; const s2 = (160 * U) ** 2;
  for (const L of lights) { const k = Math.exp(-((x - L.x) ** 2 + (y - L.y) ** 2) / s2) + 1e-6; r += k * L.col[0]; g += k * L.col[1]; b += k * L.col[2]; w += k; }
  out[0] = Math.min(255, r / w * 0.85 + 30); out[1] = Math.min(255, g / w * 0.85 + 30); out[2] = Math.min(255, b / w * 0.85 + 30);
  return out;
};

function placeRoots(R) {
  roots = [];
  const gs = groups(icons);
  gs.forEach((g, gi) => {
    const start = (hash2(g[0].x, g[0].y) * HUES.length) | 0;
    // walk the group in reading order so neighbours share colours in small runs
    g.sort((a, b) => a.y - b.y || a.x - b.x);
    g.forEach((ic, i) => {
      const cx = ic.x + ic.w / 2, cy = ic.y + ic.h / 2;
      // try spots beside and below the icon, away from the screen edge, off every icon
      const towardX = cx < W / 2 ? 1 : -1;
      const cands = [
        [cx + towardX * (ic.w / 2 + 14 * U), cy + (R() - 0.3) * ic.h * 0.4],
        [cx - towardX * (ic.w / 2 + 14 * U), cy + (R() - 0.3) * ic.h * 0.4],
        [cx + (R() - 0.5) * ic.w * 0.5, ic.y + ic.h + 16 * U],
      ];
      if (R() < 0.35) cands.unshift(cands.splice(2, 1)[0]);
      let spot = null;
      for (const [x, y] of cands) if (x > 6 && x < W - 6 && y > 6 && y < H - 6 && !overIcon(x, y, 6 * U) && !roots.some(r => Math.hypot(r.x - x, r.y - y) < 40 * U)) { spot = [x, y]; break; }
      if (!spot) return;
      const hue = P.colors > 0.5 ? (start + ((i / 2) | 0) + gi) % HUES.length : 0;
      roots.push({ x: spot[0], y: spot[1], sz: 0.55 + R() * 0.6, col: HUES[hue], ph: R() * TAU, flash: 0 });
    });
  });
  lights = roots.slice(0, MAX_LIGHTS).map(r => ({ x: r.x, y: r.y - 10 * U, r: (120 + 90 * r.sz) * U, I: 0.45 + 0.4 * r.sz, col: r.col }));
}
const hash2 = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233 + RNG.seed * 0.001) * 43758.5453; return s - Math.floor(s); };

let steerK = 0.06;
/** A wandering thread. Records its points, forks into children, optional target to steer to. */
function hypha(R, x, y, a, len, al, depth, tx, ty, out, off = 0) {
  const pts = [x, y], step = 2.5 * U;
  for (let l = 0; l < len; l += step) {
    a += (noise(x / (30 * U), y / (30 * U) + depth * 3, 5) - 0.5) * 0.22 + (R() - 0.5) * 0.08;
    if (tx !== undefined) {
      let da = Math.atan2(ty - y, tx - x) - a; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      // steer harder close to the target, so a thread lands instead of circling it
      const dt = Math.hypot(tx - x, ty - y), near = Math.max(0, 1 - dt / (70 * U));
      a += da * (steerK + near * near * 0.35); if (dt < 10 * U) break;
    }
    x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push(x, y);
    if (depth < 3 && R() < 0.006) nodes.push({ x, y, ph: R() * TAU, r: (2.2 + R() * 2.5) * U });
    if (depth < 3 && R() < 0.02 * P.density) hypha(R, x, y, a + (R() < 0.5 ? -1 : 1) * (0.4 + R() * 0.7), (len - l) * 0.45, al * 0.8, depth + 1, undefined, undefined, out, off + l);
  }
  if (pts.length >= 4) out.push({ pts: new Float32Array(pts), al, steer: tx !== undefined, depth, off });
}

function layout() {
  U = icons.length ? clamp(icons.reduce((s, ic) => s + ic.h, 0) / icons.length / 110, 0.6, 1.8) : 1;
  const R = rng(RNG.seed ^ 0x5eed);
  morph.set(field.compute(iconRects(icons), { reach: 30 * U, warp: 18, wobble: 0.1, soft: 28, far: 900 }), true);
  placeRoots(R);
  hyphae = []; nodes = [];
  const reach = P.spread;
  for (const r of roots) {
    const n = Math.round(12 * P.density);
    for (let k = 0; k < n; k++) hypha(R, r.x, r.y, R() * TAU, (90 + R() * 240) * U * (0.6 + r.sz * 0.4) * reach, 0.55, 0, undefined, undefined, hyphae);
  }
  for (const ic of icons) {
    const cx = ic.x + ic.w / 2, cy = ic.y + ic.h / 2, n = Math.round(7 * P.density);
    for (let k = 0; k < n; k++) { const a = R() * TAU; hypha(R, cx + Math.cos(a) * ic.w * 0.42, cy + Math.sin(a) * ic.h * 0.4, a, (60 + R() * 140) * U * reach, 0.35, 1, undefined, undefined, hyphae); }
  }
  // threads that reach for the neighbouring icon: one network along rows and columns
  for (let a = 0; a < icons.length; a++) for (let b = a + 1; b < icons.length; b++) {
    const p = icons[a], q = icons[b], px = p.x + p.w / 2, py = p.y + p.h / 2, qx = q.x + q.w / 2, qy = q.y + q.h / 2;
    if (Math.hypot(px - qx, py - qy) > 1.3 * Math.max(p.h, q.h) * 1.12) continue;
    const n = Math.round(8 * P.density);
    for (let k = 0; k < n; k++) {
      const ox = (R() - 0.5) * p.w, oy = (R() - 0.5) * p.h * 0.75;
      hypha(R, px + ox, py + oy, Math.atan2(qy - py, qx - px) + (R() - 0.5) * 1.5, 400 * U, 0.5, 2, qx + (R() - 0.5) * q.w, qy + (R() - 0.5) * q.h * 0.75, hyphae);
    }
  }
  bakeThreads();
  renderBase();
  sparks.length = 0;
  for (const s of spores) s.life = 0;
}

/** Threads are drawn once per layout on a 2D canvas at device resolution and uploaded. */
const C3 = [0, 0, 0];
let tips = [];
const HAIR_N = 6, HP = new Float32Array((HAIR_N + 1) * 2);
/**
 * Points of one hair of a tuft. pull 0..1: how much it bends and stretches toward (cx, cy),
 * dist: distance from the tip to the cursor.
 */
function hairPts(tip, hr, pull, cx, cy, out) {
  const a0 = hr.a, a1 = a0 + hr.bend;
  let ae = a1, len = hr.len;
  if (pull > 0) {
    let at = Math.atan2(cy - tip.y, cx - tip.x) + (hr.r - 0.5) * 0.35, da = at - a1;
    while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    ae = a1 + da * pull * 0.9;
    const dist = Math.hypot(cx - tip.x, cy - tip.y);
    len = hr.len + pull * Math.min(dist * 0.7, 110 * U) * (0.6 + 0.4 * hr.r);
  }
  const mx = tip.x + Math.cos(a0) * len * 0.45, my = tip.y + Math.sin(a0) * len * 0.45;
  const ex = tip.x + Math.cos(ae) * len, ey = tip.y + Math.sin(ae) * len;
  for (let j = 0; j <= HAIR_N; j++) {
    const t = j / HAIR_N, u = 1 - t;
    out[j * 2] = u * u * tip.x + 2 * u * t * mx + t * t * ex;
    out[j * 2 + 1] = u * u * tip.y + 2 * u * t * my + t * t * ey;
  }
  return out;
}
function bakeThreads() {
  nNet = 0;
  const C01 = [0, 0, 0];
  for (const h of hyphae) {
    const pts = h.pts, n = pts.length / 2, seg6 = 6;
    for (let c = 0; c < seg6; c++) {
      const i0 = Math.floor(c / seg6 * (n - 1)), i1 = Math.floor((c + 1) / seg6 * (n - 1)); if (i1 <= i0) continue;
      const f = h.steer ? 1 - 0.4 * Math.sin(c / (seg6 - 1) * Math.PI) : 1 - c / seg6;
      lightCol(pts[i0 * 2], pts[i0 * 2 + 1], C3); C01[0] = C3[0] / 255; C01[1] = C3[1] / 255; C01[2] = C3[2] / 255;
      for (let j = i0; j < i1; j++) netSeg(pts[j * 2], pts[j * 2 + 1], pts[j * 2 + 2], pts[j * 2 + 3], (0.55 + 0.35 * f) * U, C01, h.al * f);
    }
  }
  // tufts: a fan of fine hairs at the free end of every thread; their tips reach for the cursor
  tips = [];
  const TR = rng(RNG.seed ^ 0x7f7f);
  for (const h of hyphae) {
    if (h.steer || h.depth > 2) continue;
    const p = h.pts, n = p.length;
    const ex = p[n - 2], ey = p[n - 1], ang = Math.atan2(ey - p[n - 3], ex - p[n - 4]);
    if (overIcon(ex, ey, 4 * U)) continue;
    lightCol(ex, ey, C3);
    const tip = { x: ex, y: ey, ang, al: h.al, c: [C3[0] / 255, C3[1] / 255, C3[2] / 255], s: 0, hairs: [] };
    const nh = 4 + ((TR() * 5) | 0);
    for (let k = 0; k < nh; k++) tip.hairs.push({ a: ang + (k / (nh - 1) - 0.5) * 1.2 + (TR() - 0.5) * 0.25, len: (6 + TR() * 12) * U, bend: (TR() - 0.5) * 0.7, r: TR() });
    for (const hr of tip.hairs) {
      hairPts(tip, hr, 0, 0, 0, HP);
      for (let j = 0; j < HAIR_N; j++) { const f = 1 - j / HAIR_N; netSeg(HP[j * 2], HP[j * 2 + 1], HP[j * 2 + 2], HP[j * 2 + 3], (0.35 + 0.25 * f) * U, tip.c, 0.12 * f + 0.1); }
    }
    if (tips.length < 900) tips.push(tip);
  }
  // mask behind icons and captions (half resolution, soft edges); the thread shader dims there
  const mw = Math.max(1, CW >> 1), mh = Math.max(1, CH >> 1), k = mw / W, off = 100000;
  if (thrCanvas.width !== mw || thrCanvas.height !== mh) { thrCanvas.width = mw; thrCanvas.height = mh; }
  tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, mw, mh); tg.fillStyle = '#000'; tg.fillRect(0, 0, mw, mh);
  tg.setTransform(k, 0, 0, k, 0, 0);
  tg.fillStyle = '#fff'; tg.shadowColor = '#fff'; tg.shadowBlur = 8 * U * k; tg.shadowOffsetX = off * k;
  for (const ic of icons) { tg.beginPath(); tg.roundRect(ic.x + 3 - off, ic.y + 2, ic.w - 6, ic.h - 2, 14); tg.fill(); }
  tg.shadowColor = 'transparent'; tg.shadowBlur = 0; tg.shadowOffsetX = 0;
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, thrCanvas);
  for (const [kk, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, kk, v);
  for (const n of nodes) lightCol(n.x, n.y, n.col = [0, 0, 0]);
  for (const r of roots) r.c01 = r.col.map(v => Math.min(1, (v * 0.85 + 30) / 255));
  for (const n of nodes) n.c01 = n.col.map(v => v / 255);
  // swap slots: the new layout fades in over the old one
  cur = 1 - cur;
  const s = slots[cur];
  gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo); gl.bufferData(gl.ARRAY_BUFFER, netBuf.subarray(0, nNet * SEGF), gl.STATIC_DRAW);
  s.n = nNet;
  fadeT0 = performance.now(); fadeK = first ? 1 : 0;
}
function renderBase() {
  LBUF.fill(0); LCOL.fill(0);
  lights.forEach((L, i) => { LBUF.set([L.x, L.y, L.r, L.I], i * 4); LCOL.set([L.col[0] / 255, L.col[1] / 255, L.col[2] / 255], i * 3); });
  const s = slots[cur];
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
  gl.viewport(0, 0, CW, CH);
  gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, morph.tex[1]);
  const { p, U: u } = GROUND;
  gl.useProgram(p);
  gl.uniform1i(u.uF, 0);
  gl.uniform2f(u.uCv, CW, CH); gl.uniform2f(u.uGrid, field.Gw, field.Gh);
  gl.uniform1f(u.uScale, CW / W); gl.uniform1f(u.uNL, lights.length); gl.uniform1f(u.uU, U); gl.uniform1f(u.uGlow, P.glow);
  gl.uniform4fv(u.uL, LBUF); gl.uniform3fv(u.uLC, LCOL);
  gl.bindVertexArray(VAO0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ======================================================================
   Sparks that travel along the threads, spores, threads grown by clicks
   ====================================================================== */
const sparks = [];                       // { h, t, v, c }
let sparkClock = 0;
function sendSpark(h, v) {
  if (sparks.length >= 160) return;
  const p = h.pts; const c = lightCol(p[0], p[1], [0, 0, 0]).map(x => Math.min(1, x / 255 * 1.15));
  sparks.push({ h, t: 0, v: v || (60 + Math.random() * 60) * U, c, len: polyLen(p) });
}
const polyLen = p => { if (p.len) return p.len; let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); p.len = s; return s; };
const PA = [0, 0];
function along(p, d, out) {
  let s = 0;
  for (let i = 2; i < p.length; i += 2) {
    const l = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    if (s + l >= d) { const k = (d - s) / (l || 1); out[0] = p[i - 2] + (p[i] - p[i - 2]) * k; out[1] = p[i - 1] + (p[i + 1] - p[i - 1]) * k; return out; }
    s += l;
  }
  out[0] = p[p.length - 2]; out[1] = p[p.length - 1]; return out;
}
const spores = Array.from({ length: 180 }, () => ({ life: 0 }));
function respawnSpore(s, x, y, burst) {
  const r = roots.length ? roots[(Math.random() * roots.length) | 0] : null;
  if (!r && x === undefined) { s.life = 0; return; }
  const a = Math.random() * TAU, d = burst ? Math.random() * 30 * U : (30 + Math.pow(Math.random(), 0.7) * 300) * U;
  s.x = (x ?? r.x) + Math.cos(a) * d; s.y = (y ?? r.y - 40 * U) + Math.sin(a) * d * 0.7;
  s.bokeh = !burst && Math.random() < 0.2;
  s.r = (s.bokeh ? 5 + Math.random() * 6 : 0.9 + Math.random() * 1.4) * U;
  s.c = lightCol(s.x, s.y, [0, 0, 0]).map(v => v / 255);
  s.vx = burst ? Math.cos(a) * 30 * U : 0; s.vy = burst ? Math.sin(a) * 30 * U - 8 * U : -(1 + Math.random() * 3) * U;
  s.ph = Math.random() * TAU; s.age = 0; s.life = burst ? 3 + Math.random() * 3 : 8 + Math.random() * 14;
}
let sporeClock = 0;

const grown = [];                        // live click nets; the oldest retract when over the limit
const GROW_V = 150;                      // CSS px per second (scaled by U)
const GROWN_LIFE = 60;                   // seconds a grown net stays before it retracts
const RETRACT_K = 1.3;                  // retraction speed relative to growth
/** Revealed path length: grows, holds, then withdraws along the same path. */
function growReveal(g, V) {
  if (g.dying) return g.r0 * dyingLeft(g);
  const tEnd = g.total / V + GROWN_LIFE;
  return g.age < tEnd ? g.age * V : g.total - (g.age - tEnd) * V * RETRACT_K;
}
/** Seconds until a net is gone (it retracts along its own path, tips first). */
const DYING_S = 1.5;                     // seconds for a trimmed net to withdraw, all threads together
const dyingLeft = g => { const k = clamp((g.age - g.t0) / DYING_S, 0, 1); return 1 - k * k * (3 - 2 * k); };
const netEnd = (g, V) => g.dying ? g.t0 + DYING_S : g.total / V + GROWN_LIFE + g.total / (V * RETRACT_K);
/** Over the limit: the oldest nets withdraw quickly instead of vanishing. */
function trimNets() {
  const lim = Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
  let alive = grown.filter(g => !g.dying);
  for (let i = 0; alive.length - i > lim; i++) {
    const g = alive[i];
    g.r0 = Math.min(g.total, growReveal(g, GROW_V * U)); g.t0 = g.age; g.dying = true;
    for (const th of g.live) th.l0 = clamp(g.r0 - th.off, 0, th.len);
  }
}
/** Live copy of a thread: colours per chunk like the baked ones, length for the reveal. */
function liveThread(h) {
  const pts = h.pts, n = pts.length / 2, seg6 = 6, cols = [];
  for (let c = 0; c < seg6; c++) { const i0 = Math.floor(c / seg6 * (n - 1)); lightCol(pts[i0 * 2], pts[i0 * 2 + 1], C3); cols.push([C3[0] / 255, C3[1] / 255, C3[2] / 255]); }
  return { pts, off: h.off, len: polyLen(pts), al: h.al, steer: h.steer, cols };
}
/** Short fan of hairs at a grown thread's end, revealed after the thread arrives. */
function liveTuft(h, R, out) {
  const p = h.pts, n = p.length, ex = p[n - 2], ey = p[n - 1], ang = Math.atan2(ey - p[n - 3], ex - p[n - 4]);
  const tip = { x: ex, y: ey }, off = h.off + polyLen(p), nh = 4 + ((R() * 4) | 0);
  for (let k = 0; k < nh; k++) {
    const hr = { a: ang + (k / (nh - 1) - 0.5) * 1.2, len: (6 + R() * 12) * U, bend: (R() - 0.5) * 0.7, r: R() };
    const q = hairPts(tip, hr, 0, 0, 0, new Float32Array((HAIR_N + 1) * 2));
    out.push({ pts: q, off, len: polyLen(q), al: 0.22, steer: false, cols: null, hair: true, tip, hr, s: 0 });
  }
}
function startNet(x, y, threads, R) {
  const g = {};
  const live = threads.map(liveThread);
  for (const h of threads) if (!h.steer || h.depth >= 3) liveTuft(h, R, live);
  for (const t of live) if (!t.cols) { lightCol(t.pts[0], t.pts[1], C3); t.cols = [[C3[0] / 255, C3[1] / 255, C3[2] / 255]]; }
  const arrive = Math.max(...live.filter(t => t.steer).map(t => t.off + t.len), 0);
  const total = Math.max(...live.map(t => t.off + t.len));
  Object.assign(g, { on: true, live, age: 0, x, y, arrive, total, puffed: arrive === 0, dying: false });
  grown.push(g); trimNets();
}
/** Click on bare ground: a bundle of threads grows from the nearest knot to the spot. */
function growTo(x, y) {
  if (!roots.length) return;
  let best = roots[0], bd = 1e9;
  for (const r of roots) { const d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; best = r; } }
  for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
  const R = rng((x * 7 + y * 13) | 0), out = [], nl = nodes.length;
  // strands start from the few knots and forks nearest to the spot, not from one point
  const from = [...roots, ...nodes].map(o => [Math.hypot(o.x - x, o.y - y), o]).sort((p, q) => p[0] - q[0]).slice(0, 4);
  const n = Math.round(5 * P.density);
  steerK = 0.035;
  for (let k = 0; k < n; k++) {
    const [d0, o] = from[k % from.length], a0 = Math.atan2(y - o.y, x - o.x);
    hypha(R, o.x, o.y, a0 + (R() - 0.5) * 1.8, d0 * 2.2 + 80 * U, 0.5, 2, x + (R() - 0.5) * 40 * U, y + (R() - 0.5) * 40 * U, out);
  }
  steerK = 0.06;
  // at the spot the bundle frays into a small knot of its own
  for (let k = 0; k < 6; k++) hypha(R, x, y, R() * TAU, (30 + R() * 70) * U * P.spread, 0.45, 2, undefined, undefined, out, bd * 1.15);
  nodes.length = nl;
  if (out.length) startNet(x, y, out, R);
}
/** Click on a knot: it flashes, sends sparks and sprouts a few new threads outward. */
function sprout(r) {
  const R = rng((r.x * 3 + r.y * 5 + performance.now()) | 0), out = [], nl = nodes.length;
  for (let k = 0; k < 7; k++) hypha(R, r.x, r.y, R() * TAU, (60 + R() * 140) * U * P.spread, 0.5, 1, undefined, undefined, out);
  nodes.length = nl;
  if (out.length) startNet(r.x, r.y, out, R);
}

/* ======================================================================
   Cursor and clicks
   ====================================================================== */
const NOPTR = { in: false, x: -1e4, y: -1e4 };
const PTR = () => (page && page.ptr) || NOPTR;
let ptrK = 0;
function click(x, y) {
  for (const r of roots) if (Math.hypot(r.x - x, r.y - y) < 26 * U) {
    r.flash = 1;
    const near = hyphae.filter(h => Math.hypot(h.pts[0] - r.x, h.pts[1] - r.y) < 4);
    for (let k = 0; k < 10 && near.length; k++) sendSpark(near[(Math.random() * near.length) | 0], (110 + Math.random() * 60) * U);
    sprout(r);
    return;
  }
  growTo(x, y);
}

/* ======================================================================
   Frame
   ====================================================================== */
function step(dt, now) {
  const t = secs(now);
  fadeK = Math.min(1, (now - fadeT0) / FADE_MS); fadeK = fadeK * fadeK * (3 - 2 * fadeK);
  const pt = PTR();
  ptrK = clamp(ptrK + ((pt.in && !pt.icon) ? dt * 2 : -dt * 1.5), 0, 1);
  // sparks along long threads
  if (P.pulses > 0 && hyphae.length) {
    sparkClock -= dt * P.pulses * (0.6 + roots.length * 0.18);
    while (sparkClock <= 0) { sparkClock += 1; const h = hyphae[(Math.random() * hyphae.length) | 0]; if (h.depth <= 2) sendSpark(h); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.t += s.v * dt; if (s.t > s.len) sparks.splice(i, 1); }
  // spores
  const want = Math.round(60 * P.spores * Math.min(1, roots.length / 6 + 0.3));
  let live = 0; for (const s of spores) if (s.life > 0) live++;
  sporeClock -= dt;
  for (const s of spores) {
    if (s.life <= 0) { if (live < want && sporeClock <= 0) { respawnSpore(s); live++; sporeClock = 0.15; } continue; }
    s.age += dt; s.ph += dt;
    s.vx *= Math.exp(-dt * 1.5); s.vy = mix(s.vy, -(1.5 * U), 1 - Math.exp(-dt * 0.8));
    s.x += (s.vx + Math.sin(s.ph * 0.7) * 3 * U) * dt; s.y += s.vy * dt;
    if (s.age > s.life) s.life = 0;
  }
  for (const r of roots) r.flash = Math.max(0, r.flash - dt * 0.8);
  const near = pt.in && !pt.icon, R0 = 170 * U;
  for (let gi = grown.length - 1; gi >= 0; gi--) {
    const g = grown[gi];
    g.age += dt;
    if (!g.puffed && g.age * GROW_V * U > g.arrive) {
      g.puffed = true; let n = 0;
      for (const s of spores) if (s.life <= 0 && n < 14) { respawnSpore(s, g.x, g.y, true); n++; }
    }
    const V0 = GROW_V * U, rev = growReveal(g, V0);
    if (g.age > netEnd(g, V0)) { grown.splice(gi, 1); continue; }
    // grown tufts reach for the cursor too, once their thread has arrived
    for (const th of g.live) if (th.hair) {
      const d = near && rev > th.off + th.len ? Math.hypot(pt.x - th.tip.x, pt.y - th.tip.y) : 1e9;
      const want = d < R0 ? 1 - Math.max(0, (d - R0 * 0.25) / (R0 * 0.75)) : 0;
      if (want > 0 || th.s > 0.001) th.s += (want * want * (3 - 2 * want) - th.s) * Math.min(1, dt * 3);
      else th.s = 0;
    }
  }
  // tufts near the cursor lean and stretch toward it (eased in and out)
  for (const tp of tips) {
    const d = near ? Math.hypot(pt.x - tp.x, pt.y - tp.y) : 1e9;
    const want = d < R0 ? 1 - Math.max(0, (d - R0 * 0.25) / (R0 * 0.75)) : 0;
    if (want > 0 || tp.s > 0.001) tp.s += (want * want * (3 - 2 * want) - tp.s) * Math.min(1, dt * 3);
    else tp.s = 0;
  }
  build(t);
}
function build(t) {
  nPts = 0;
  const G = P.glow;
  // knots: soft colour hearts that breathe
  for (const r of roots) {
    const b = 0.8 + 0.2 * Math.sin(t * 0.7 + r.ph) + r.flash * 0.9;
    pt(r.x, r.y, 26 * U * (0.6 + r.sz * 0.5) * (1 + r.flash * 0.4), 0, r.c01, 0.75 * b * G);
  }
  for (const n of nodes) pt(n.x, n.y, n.r * 4, 0, n.c01, (0.55 + 0.45 * Math.sin(t * 0.9 + n.ph)) * G);
  // sparks with a short tail
  for (const s of sparks) {
    const e = Math.min(1, s.t / (30 * U), (s.len - s.t) / (30 * U));
    for (let k = 0; k < 4; k++) { along(s.h.pts, Math.max(0, s.t - k * 5 * U), PA); pt(PA[0], PA[1], (4.5 - k) * U, 0, s.c, e * (1 - k * 0.22) * G); }
  }
  // spores
  for (const s of spores) if (s.life > 0) {
    const f = Math.min(1, s.age / 1.5, (s.life - s.age) / 2);
    pt(s.x, s.y, s.bokeh ? s.r : s.r * 5, s.bokeh ? 1 : 0, s.c, f * (s.bokeh ? 0.1 : 0.85) * G);
  }
  // grown nets: revealed as they grow, then fade
  nSeg = 0;
  const V = GROW_V * U;
  const pcg = PTR();
  for (const g of grown) {
    const reveal = growReveal(g, V), endFade = g.dying ? dyingLeft(g) ** 0.5 : clamp((netEnd(g, V) - g.age) / 0.3, 0, 1);
    for (const th of g.live) {
      const vis = g.dying ? th.l0 * dyingLeft(g) : reveal - th.off; if (vis <= 0) continue;
      if (th.hair && th.s > 0.01) hairPts(th.tip, th.hr, th.s, pcg.x + Math.sin(t * 1.3 + th.hr.r * 9) * 4 * U, pcg.y + Math.cos(t * 1.1 + th.hr.r * 7) * 4 * U, th.pts);
      const p = th.pts, n = p.length / 2, nc = th.cols.length;
      let s = 0;
      for (let i = 1; i < n; i++) {
        const x0 = p[i * 2 - 2], y0 = p[i * 2 - 1], x1 = p[i * 2], y1 = p[i * 2 + 1], l = Math.hypot(x1 - x0, y1 - y0);
        if (s >= vis) break;
        const k = Math.min(1, (vis - s) / (l || 1)), c = Math.min(nc - 1, (i / n * nc) | 0);
        const f = th.hair ? 1 - i / n : th.steer ? 1 - 0.4 * Math.sin(c / 5 * Math.PI) : 1 - c / 6;
        seg(x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, (th.hair ? 0.35 + 0.25 * f : 0.55 + 0.35 * f) * U, th.cols[c], th.al * (th.hair ? 1 + th.s * 1.2 : 1) * f * endFade * G * 1.15);
        if (k < 1) { if (!th.hair) pt(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 3 * U, 0, th.cols[c], 0.7 * G); break; }
        s += l;
      }
    }
    if (g.puffed) pt(g.x, g.y, 9 * U, 0, g.live[0].cols[0], 0.6 * endFade * G);
  }
  // tufts reaching for the cursor
  const pc = PTR();
  for (const tp of tips) {
    if (tp.s < 0.01) continue;
    for (const hr of tp.hairs) {
      hairPts(tp, hr, tp.s, pc.x + Math.sin(t * 1.3 + hr.r * 9) * 4 * U, pc.y + Math.cos(t * 1.1 + hr.r * 7) * 4 * U, HP);
      for (let j = 0; j < HAIR_N; j++) { const f = 1 - j / HAIR_N; seg(HP[j * 2], HP[j * 2 + 1], HP[j * 2 + 2], HP[j * 2 + 3], (0.35 + 0.3 * f) * U, tp.c, (0.25 + 0.35 * f) * (0.4 + 0.6 * tp.s) * G); }
      pt(HP[HAIR_N * 2], HP[HAIR_N * 2 + 1], 2.2 * U, 0, tp.c, 0.55 * tp.s * G);
    }
  }
}
function draw(now) {
  const t = secs(now);
  gl.viewport(0, 0, CW, CH);
  gl.disable(gl.BLEND);
  const a = slots[1 - cur], b = slots[cur];
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.base);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.base);
  gl.useProgram(COMPOSE.p);
  gl.uniform1i(COMPOSE.U.uB0, 0); gl.uniform1i(COMPOSE.U.uB1, 1); gl.uniform1f(COMPOSE.U.uK, fadeK);
  gl.bindVertexArray(VAO0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  // threads: old net fading out, new net fading in, then the live ones
  const { p: sp, U: su } = STR;
  gl.useProgram(sp);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.uniform1i(su.uMask, 2);
  gl.uniform2f(su.uRes, W, H); gl.uniform2f(su.uCv, CW, CH); gl.uniform1f(su.uScale, CW / W); gl.uniform1f(su.uU, U);
  gl.uniform1f(su.uHW, 5 * U); gl.uniform1f(su.uTime, t); gl.uniform1f(su.uGlow, P.glow);
  const pt0 = PTR(); gl.uniform3f(su.uPtr, pt0.x, pt0.y, ptrK);
  if (fadeK < 1 && a.n) { gl.uniform1f(su.uA, 1 - fadeK); gl.bindVertexArray(a.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, a.n); }
  if (b.n) { gl.uniform1f(su.uA, fadeK); gl.bindVertexArray(b.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.n); }
  if (nSeg) {
    gl.bindBuffer(gl.ARRAY_BUFFER, stVBO); gl.bufferSubData(gl.ARRAY_BUFFER, 0, stBuf, 0, nSeg * SEGF);
    gl.uniform1f(su.uA, 1); gl.bindVertexArray(stVAO); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nSeg);
  }
  if (nPts) {
    gl.bindBuffer(gl.ARRAY_BUFFER, ptVBO); gl.bufferSubData(gl.ARRAY_BUFFER, 0, ptBuf, 0, nPts * 8);
    gl.useProgram(PTS.p); gl.uniform2f(PTS.U.uRes, W, H); gl.uniform1f(PTS.U.uScale, CW / W);
    gl.bindVertexArray(ptVAO); gl.drawArrays(gl.POINTS, 0, nPts);
  }
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

/* ======================================================================
   Start
   ====================================================================== */
let first = true;
const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['density', 'spread', 'glow', 'colors', 'pulses', 'spores', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc(); allocSlots();
    if (!first) { first = true; layout(); first = false; }
  },
  icons(list, isFirst, prev) {
    icons = list;
    layout();
    if (!isFirst && !first) { const { added } = diffIcons(prev, list); for (const a of added.slice(0, 2)) growTo(a.x + a.w / 2, a.y + a.h + 20 * U); }
    first = false;
  },
  settings(keys) {
    if (keys.some(k => k !== 'pulses' && k !== 'spores' && k !== 'clicks')) layout();
  },
  reseed() { field.reseed(); layout(); },
  step,
  draw,
  click,
  stats: () => `threads ${hyphae.length} · knots ${roots.length} · sparks ${sparks.length} · points ${nPts}`,
});

window.__dbg = {
  P, click, growTo, roots: () => roots, hyphae: () => hyphae,
  set(k, v) { P[k] = v; layout(); },
};
void QS; void mix;
