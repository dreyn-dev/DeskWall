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

/* every frame: ground + baked threads (sharp + glow), breathing waves, the cursor's halo */
const COMPOSE_FS = `#version 300 es
precision highp float;
${NOISE_GLSL}
uniform sampler2D uB0, uB1, uT0, uT1;
uniform float uK, uTime, uScale, uGlow, uLod;
uniform vec2 uCv;
uniform vec3 uPtr;                   // x, y (CSS px), strength
out vec4 o;
vec3 glowAt(sampler2D t, vec2 uv) {
  vec2 e = exp2(uLod) * 0.7 / uCv;
  return (textureLod(t, uv + vec2(e.x, e.y), uLod).rgb + textureLod(t, uv + vec2(-e.x, e.y), uLod).rgb
        + textureLod(t, uv + vec2(e.x, -e.y), uLod).rgb + textureLod(t, uv - e, uLod).rgb) * 0.25;
}
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale, uv = dev / uCv;
  vec3 col = mix(texelFetch(uB0, fc, 0).rgb, texelFetch(uB1, fc, 0).rgb, uK);
  vec3 sharp = mix(texture(uT0, uv).rgb, texture(uT1, uv).rgb, uK);
  vec3 glow = mix(glowAt(uT0, uv), glowAt(uT1, uv), uK);
  float br = 0.72 + 0.56 * vn(p * 0.004 + vec2(uTime * 0.05, -uTime * 0.031));
  vec2 dp = p - uPtr.xy; br += uPtr.z * 0.9 * exp(-dot(dp, dp) / (150.0 * 150.0));
  col += (sharp * 0.85 + glow * 1.5) * br * uGlow;
  o = vec4(col, 1.0);
}`;

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
/* new threads that grow after a click; drawn as lines until they fade */
const LN_VS = `#version 300 es
layout(location = 0) in vec2 aP; layout(location = 1) in vec4 aC;
uniform vec2 uRes; out vec4 vC;
void main() { vC = aC; gl_Position = vec4(aP / uRes * vec2(2, -2) + vec2(-1, 1), 0, 1); }`;
const LN_FS = `#version 300 es
precision highp float;
in vec4 vC; out vec4 o;
void main() { o = vec4(vC.rgb * vC.a, 0.0); }`;

/* ======================================================================
   GL
   ====================================================================== */
const cv = document.getElementById('art');
const gl = makeGL(cv);
const GROUND = program(gl, FULL_VS, GROUND_FS);
const COMPOSE = program(gl, FULL_VS, COMPOSE_FS);
const PTS = program(gl, PT_VS, PT_FS);
const LNS = program(gl, LN_VS, LN_FS);
const VAO0 = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 1);
let W = 1, H = 1, CW = 1, CH = 1;
const T0 = performance.now();
const secs = now => (now - T0) / 1000;

// two slots of (ground, threads); a new layout fades in over the old one
const slots = [0, 1].map(() => ({ base: gl.createTexture(), fb: gl.createFramebuffer(), thr: gl.createTexture() }));
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
    gl.bindTexture(gl.TEXTURE_2D, s.thr);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.generateMipmap(gl.TEXTURE_2D);
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
const MAX_LV = 32768;
const lnBuf = new Float32Array(MAX_LV * 6);
let nLV = 0;
const lnVBO = gl.createBuffer(), lnVAO = gl.createVertexArray();
gl.bindVertexArray(lnVAO); gl.bindBuffer(gl.ARRAY_BUFFER, lnVBO); gl.bufferData(gl.ARRAY_BUFFER, lnBuf.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
gl.bindVertexArray(null);
function pt(x, y, r, kind, c, a) {
  if (nPts >= MAX_PTS || a <= 0.002) return;
  const o = nPts++ * 8; ptBuf[o] = x; ptBuf[o + 1] = y; ptBuf[o + 2] = r; ptBuf[o + 3] = kind;
  ptBuf[o + 4] = c[0]; ptBuf[o + 5] = c[1]; ptBuf[o + 6] = c[2]; ptBuf[o + 7] = a;
}
function lv(x, y, c, a) {
  if (nLV >= MAX_LV) return;
  const o = nLV++ * 6; lnBuf[o] = x; lnBuf[o + 1] = y; lnBuf[o + 2] = c[0]; lnBuf[o + 3] = c[1]; lnBuf[o + 4] = c[2]; lnBuf[o + 5] = a;
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

/** A wandering thread. Records its points, forks into children, optional target to steer to. */
function hypha(R, x, y, a, len, al, depth, tx, ty, out) {
  const pts = [x, y], step = 2.5 * U;
  for (let l = 0; l < len; l += step) {
    a += (noise(x / (30 * U), y / (30 * U) + depth * 3, 5) - 0.5) * 0.22 + (R() - 0.5) * 0.08;
    if (tx !== undefined) {
      let da = Math.atan2(ty - y, tx - x) - a; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      a += da * 0.06; if (Math.hypot(tx - x, ty - y) < 6 * U) break;
    }
    x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push(x, y);
    if (depth < 3 && R() < 0.006) nodes.push({ x, y, ph: R() * TAU, r: (2.2 + R() * 2.5) * U });
    if (depth < 3 && R() < 0.02 * P.density) hypha(R, x, y, a + (R() < 0.5 ? -1 : 1) * (0.4 + R() * 0.7), (len - l) * 0.45, al * 0.8, depth + 1, undefined, undefined, out);
  }
  if (pts.length >= 4) out.push({ pts: new Float32Array(pts), al, steer: tx !== undefined, depth });
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
function bakeThreads() {
  const k = CW / W;
  if (thrCanvas.width !== CW || thrCanvas.height !== CH) { thrCanvas.width = CW; thrCanvas.height = CH; }
  tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, CW, CH);
  tg.setTransform(k, 0, 0, k, 0, 0);
  tg.globalCompositeOperation = 'lighter'; tg.lineCap = 'round'; tg.lineJoin = 'round';
  for (const h of hyphae) {
    const pts = h.pts, n = pts.length / 2, seg = 6;
    for (let c = 0; c < seg; c++) {
      const i0 = Math.floor(c / seg * (n - 1)), i1 = Math.floor((c + 1) / seg * (n - 1)); if (i1 <= i0) continue;
      const f = h.steer ? 1 - 0.4 * Math.sin(c / (seg - 1) * Math.PI) : 1 - c / seg;
      lightCol(pts[i0 * 2], pts[i0 * 2 + 1], C3);
      tg.strokeStyle = `rgba(${C3[0] | 0},${C3[1] | 0},${C3[2] | 0},${h.al * f})`;
      tg.lineWidth = (0.55 + 0.35 * f) * U;
      tg.beginPath(); tg.moveTo(pts[i0 * 2], pts[i0 * 2 + 1]);
      for (let j = i0 + 1; j <= i1; j++) tg.lineTo(pts[j * 2], pts[j * 2 + 1]);
      tg.stroke();
    }
  }
  // keep captions clean: fade the threads right behind each icon and its label (soft edges)
  tg.globalCompositeOperation = 'destination-out';
  const off = 100000;
  tg.fillStyle = '#000'; tg.shadowColor = 'rgba(0,0,0,0.7)'; tg.shadowBlur = 8 * U * k; tg.shadowOffsetX = off * k;
  for (const ic of icons) { tg.beginPath(); tg.roundRect(ic.x + 3 - off, ic.y + 2, ic.w - 6, ic.h - 2, 14); tg.fill(); }
  tg.shadowColor = 'transparent'; tg.shadowBlur = 0; tg.shadowOffsetX = 0;
  tg.globalCompositeOperation = 'source-over';
  for (const n of nodes) lightCol(n.x, n.y, n.col = [0, 0, 0]);
  for (const r of roots) r.c01 = r.col.map(v => Math.min(1, (v * 0.85 + 30) / 255));
  for (const n of nodes) n.c01 = n.col.map(v => v / 255);
  // swap slots: the new layout fades in over the old one
  cur = 1 - cur;
  const s = slots[cur];
  gl.bindTexture(gl.TEXTURE_2D, s.thr);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, thrCanvas);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
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

const grown = Array.from({ length: MAX_CLICKS }, () => ({ on: false }));
let grownI = 0;
function growTo(x, y) {
  if (!roots.length) return;
  let best = roots[0], bd = 1e9;
  for (const r of roots) { const d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; best = r; } }
  for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
  const R = rng((x * 7 + y * 13) | 0), out = [], nl = nodes.length;
  const a0 = Math.atan2(y - best.y, x - best.x);
  hypha(R, best.x, best.y, a0 + (R() - 0.5) * 0.8, bd * 2 + 50 * U, 0.8, 2, x, y, out);
  nodes.length = nl;
  const main = out[out.length - 1]; if (!main) return;
  const g = grown[grownI]; grownI = nextClick(grownI, P);
  const c = best.c01 || lightCol(best.x, best.y, [0, 0, 0]).map(v => Math.min(1, v / 255 * 1.1));
  // a few short side hairs near the tip
  const side = [];
  for (let k = 0; k < 3; k++) { const p = main.pts, j = Math.max(1, ((p.length / 2) * (0.55 + R() * 0.4)) | 0); hypha(R, p[j * 2], p[j * 2 + 1], R() * TAU, (20 + R() * 40) * U, 0.6, 3, undefined, undefined, side); }
  nodes.length = nl;
  Object.assign(g, { on: true, main: main.pts, side: side.map(s => s.pts), c, age: 0, len: polyLen(main.pts), x, y, puffed: false });
}
const GROW_V = 160;                      // CSS px per second (scaled by U)

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
  for (const g of grown) if (g.on) {
    g.age += dt;
    if (!g.puffed && g.age * GROW_V * U > g.len) {
      g.puffed = true; let n = 0;
      for (const s of spores) if (s.life <= 0 && n < 14) { respawnSpore(s, g.x, g.y, true); n++; }
    }
    if (g.age > g.len / (GROW_V * U) + 30) g.on = false;
  }
  build(t);
}
function build(t) {
  nPts = 0; nLV = 0;
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
  // grown threads: revealed as they grow, then fade
  for (const g of grown) if (g.on) {
    const grownLen = g.age * GROW_V * U, endFade = clamp((g.len / (GROW_V * U) + 30 - g.age) / 5, 0, 1);
    const p = g.main; let s = 0, prevX = p[0], prevY = p[1], tipX = p[0], tipY = p[1];
    for (let i = 2; i < p.length; i += 2) {
      const l = Math.hypot(p[i] - prevX, p[i + 1] - prevY); if (s + l > grownLen) break; s += l;
      lv(prevX, prevY, g.c, 0.9 * endFade * G); lv(p[i], p[i + 1], g.c, 0.9 * endFade * G);
      prevX = tipX = p[i]; prevY = tipY = p[i + 1];
    }
    if (g.puffed) for (const q of g.side) { const age = g.age - g.len / (GROW_V * U), n = Math.min(q.length / 2, (age * 60) | 0);
      for (let i = 1; i < n; i++) { lv(q[i * 2 - 2], q[i * 2 - 1], g.c, 0.6 * endFade * G); lv(q[i * 2], q[i * 2 + 1], g.c, 0.6 * endFade * G); } }
    if (!g.puffed) pt(tipX, tipY, 7 * U, 0, g.c, 1);
    else pt(g.x, g.y, 9 * U, 0, g.c, 0.8 * endFade * G);
  }
}
function draw(now) {
  const t = secs(now);
  gl.viewport(0, 0, CW, CH);
  gl.disable(gl.BLEND);
  const a = slots[1 - cur], b = slots[cur];
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.base);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.base);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, a.thr);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, b.thr);
  const { p, U: u } = COMPOSE;
  gl.useProgram(p);
  gl.uniform1i(u.uB0, 0); gl.uniform1i(u.uB1, 1); gl.uniform1i(u.uT0, 2); gl.uniform1i(u.uT1, 3);
  gl.uniform1f(u.uK, fadeK); gl.uniform1f(u.uTime, t); gl.uniform1f(u.uScale, CW / W);
  gl.uniform1f(u.uGlow, P.glow); gl.uniform1f(u.uLod, Math.log2(Math.max(1, 2.2 * CW / W * U)));
  gl.uniform2f(u.uCv, CW, CH);
  const pt0 = PTR(); gl.uniform3f(u.uPtr, pt0.x, pt0.y, ptrK);
  gl.bindVertexArray(VAO0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  if (nLV) {
    gl.bindBuffer(gl.ARRAY_BUFFER, lnVBO); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lnBuf, 0, nLV * 6);
    gl.useProgram(LNS.p); gl.uniform2f(LNS.U.uRes, W, H);
    gl.bindVertexArray(lnVAO); gl.drawArrays(gl.LINES, 0, nLV);
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
