// DeskWall · Frost ("Иней").
// A window pane on a winter night. Hoar-frost ferns grow out of every group of icons, so a row or
// a column of icons freezes into one shared rim; the rest of the glass stays dark and clear.
// Motion: when icons move the old frost melts and new ferns grow from the new outline; ice
// crystals glint now and then. Cursor: it breathes on the glass and leaves a fading fog patch.
// Click: a snowflake-shaped frost star grows on the glass and slowly melts. Rarely one appears
// on its own.
// The glass is one full-screen pass over the icon field (kit.js Field + Morph); the ferns are one
// instanced draw of line segments built on the CPU only when the icons change. No per-frame
// allocations; lines are anti-aliased in device pixels, so crisp at 4K.
import {
  MAX_CLICKS, nextClick, clamp, fbm, rng, hash, Field, Morph, iconRects, contourPoints, Segs,
  SEG_VS, SEG_GLSL, FULL_VS, NOISE_GLSL, makeGL, program, runPage, STEP,
} from './kit.js';

const P = { frost: 1, haze: 1, glints: 1, palette: 0, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
// per palette: glass top, glass bottom, haze, frost
const PALETTES = [
  [[0.066, 0.114, 0.16], [0.11, 0.176, 0.235], [0.47, 0.6, 0.69], [0.89, 0.94, 0.98]],     // night glass
  [[0.12, 0.1, 0.17], [0.2, 0.16, 0.25], [0.62, 0.55, 0.7], [0.97, 0.92, 0.97]],          // dawn
  [[0.1, 0.105, 0.115], [0.17, 0.175, 0.19], [0.58, 0.6, 0.63], [0.93, 0.94, 0.95]],      // silver
  [[0.03, 0.1, 0.11], [0.06, 0.17, 0.18], [0.4, 0.62, 0.62], [0.86, 0.97, 0.95]],         // deep teal
];
const WAKES = 10, NR = MAX_CLICKS + WAKES + 1;   // frost stars from clicks, breath fog, one on its own
const GROW_S = 6, MELT_S = 2.4, PATH = 420;      // ferns grow PATH px of path in GROW_S seconds

const FS = `#version 300 es
precision highp float;
uniform sampler2D uF0, uF1;
uniform float uK, uScale, uT, uHaze;
uniform int uN;
uniform vec2 uCv, uGrid;
uniform vec3 uG0, uG1, uHz, uFr;
uniform vec4 uR[${NR}];           // x, y, birth time, kind (1 frost star, 2 breath)
out vec4 o;
${NOISE_GLSL}
float fld(vec2 p) {
  vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid;
  return mix(texture(uF0, uv).r, texture(uF1, uv).r, uK);
}
const float PI = 3.14159265;
// distance (CSS px) to a six-armed frost star of radius rg; arms carry side branches at 60 degrees
float flake(vec2 v, float rg, float rot) {
  float rr = length(v);
  if (rr > rg + 3.) return 1e3;
  float a = atan(v.y, v.x) + rot;
  a = mod(a + PI / 6., PI / 3.) - PI / 6.;
  vec2 q = rr * vec2(cos(a), abs(sin(a)));
  float d = q.x < rg ? q.y : length(q - vec2(rg, 0.));
  const float sp = 6.5;
  vec2 b = vec2(0.5, 0.866), bn = vec2(-0.866, 0.5);
  float k0 = floor(q.x / sp);
  for (int j = 0; j < 4; j++) {
    float xk = (k0 - float(j)) * sp;
    if (xk < 3.) break;
    float lb = (rg - xk) * 0.42;
    vec2 u = q - vec2(xk, 0.);
    float al = dot(u, b);
    if (al > 0. && al < lb) d = min(d, abs(dot(u, bn)));
  }
  return d;
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  float s = fld(p);
  vec3 col = mix(uG0, uG1, clamp(dev.y / uCv.y * 0.6 + (fbm3(p * 0.0014) - 0.5) * 0.5 + 0.2, 0., 1.));
  // a cold haze hugs the frozen rim
  float haze = exp(-max(s, 0.) / 70.);
  col = mix(col, uHz, 0.28 * haze * uHaze);
  // inside the outline the glass is frosted over in faint facets
  float f = smoothstep(6., -6., s);
  if (f > 0.) { vec3 c = cells(p / 26.); col = mix(col, mix(uHz, uFr, 0.3), f * (0.2 + 0.1 * c.y) * (0.85 + 0.15 * smoothstep(0.2, 0.6, c.x)) * uHaze); }
  for (int i = 0; i < ${NR}; i++) {
    if (i >= uN) break;
    vec4 r = uR[i];
    float age = uT - r.z;
    float hs = fract(sin(r.z * 91.7 + r.x * 0.37) * 4375.85);
    vec2 v = p - r.xy;
    if (r.w < 1.5) {
      // frost star: grows for 2.5 s, stays, melts away after about 40 s
      float rg = (34. + 26. * hs) * smoothstep(0., 2.5, age);
      float life = 1. - smoothstep(34., 42., age);
      float d = flake(v, rg, hs * 6.283) * uScale;
      float w = 0.75 * uScale;
      float ln = 1. - smoothstep(w - 0.5, w + 0.7, d);
      float gl = exp(-d / (2.5 * uScale)) * 0.22;
      float halo = exp(-dot(v, v) / (2. * rg * rg + 1.)) * 0.08;
      col = mix(col, uFr, clamp((ln * 0.75 + gl) * life, 0., 1.));
      col = mix(col, uHz, halo * life);
    } else {
      // breath on the glass: a soft fog patch that clears in a few seconds
      float fog = exp(-dot(v, v) / (2. * 46. * 46.)) * smoothstep(0., 0.4, age) * exp(-age / 2.2);
      fog *= 0.75 + 0.5 * vn(p * 0.03 + r.z);
      col = mix(col, uHz, clamp(fog * 0.32, 0., 1.));
    }
  }
  vec2 c = dev / uCv - 0.5; col *= 1. - 0.2 * dot(c * vec2(1.6, 1.2), c * vec2(1.6, 1.2));
  col += (h21(dev) - 0.5) / 255.;
  o = vec4(col, 1.);
}`;

// fern segments: w half width, alpha, grow (path / PATH), set; hash
const FS_SEG = `#version 300 es
precision highp float;
in vec2 vL;
in float vLen;
flat in vec4 vA;
flat in vec2 vB;
uniform float uScale, uT, uGrow0, uGrow1, uMelt, uGlints;
uniform vec3 uFr;
out vec4 o;
${SEG_GLSL}
void main() {
  float d = segDist();
  bool old = vA.w < 0.5;
  // new frost grows from the root outwards; old frost melts from the tips inwards
  float v = old ? clamp((uGrow0 - vA.z) * 30., 0., 1.) * clamp((1. - uMelt) * 1.6 - vA.z * 0.6, 0., 1.)
                : clamp((uGrow1 - vA.z) * 30., 0., 1.);
  if (v <= 0.) discard;
  float w = vA.x * uScale;
  float a = (1. - smoothstep(w - 0.5, w + 0.7, d)) * vA.y;
  float glow = exp(-d / (2.2 * uScale)) * 0.07 * vA.y;
  float tw = pow(0.5 + 0.5 * sin(uT * 0.6 + vB.x * 97.), 40.) * uGlints;
  o = vec4(uFr * (a * 0.62 * (1. + 1.6 * tw) + glow) * v, 0.);
}`;

const cv = document.getElementById('art');
const gl = makeGL(cv);
const PR = program(gl, FULL_VS, FS), U = PR.U;
const PS = program(gl, SEG_VS, FS_SEG), US = PS.U;
const VAO = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2400);
const segs = new Segs(gl, 30000);
let W = 1, H = 1, CW = 1, CH = 1, icons = [], T = 0, nextSlot = 0, wakeSlot = 0, wakeClock = 0, nActive = 0;
let growT0 = 0, growT0old = -1e9, meltT0 = -1e9, lastS = null, selfAt = 90 + Math.random() * 120;
const R = new Float32Array(NR * 4);
const RA = new Float32Array(NR * 4);
const g2 = [0, 0];

// A fern: a slightly bent main stem with side branches at about 60 degrees that get shorter
// towards the tip; branches have their own smaller side needles. `path` is the length from the
// rim, so every fern grows outwards from the icons at the same speed.
function fern(R, x, y, a, len, w, depth, alpha, path, set, h) {
  const step = depth ? 2.6 : 3.2, n = Math.max(2, len / step), bend = (R() - 0.5) * 0.025;
  let side = 5 + R() * 5, flip = R() < 0.5 ? 1 : -1, acc = 0;
  for (let k = 0; k < n; k++) {
    a += (R() - 0.5) * 0.08 + bend;
    const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
    segs.push(x, y, nx, ny, w, alpha, path / PATH, set, h + k * 0.013, 0);
    x = nx; y = ny; acc += step; path += step;
    if (depth < 2 && acc > side && k < n * 0.92) {
      acc = 0; side = depth ? 3.5 : 6 + R() * 4;
      const rem = (n - k) * step, sl = rem * (depth ? 0.32 : 0.42) * (0.7 + R() * 0.5);
      fern(R, x, y, a + flip * (1.0 + R() * 0.15), sl, w * 0.65, depth + 1, alpha * 0.85, path, set, h + k);
      if (depth === 0 && R() < 0.6) fern(R, x, y, a - flip * (1.0 + R() * 0.15), sl * 0.8, w * 0.65, depth + 1, alpha * 0.85, path, set, h + k + 0.5);
      flip = -flip;
    }
  }
}
function build(s, set) {
  const k = P.frost;
  for (const [x, y] of contourPoints(field, s, 4, 40)) {
    const ix = Math.round(x), iy = Math.round(y), R = rng((hash(ix, iy, 3) * 4294967296) >>> 0);
    field.grad(s, x, y, g2);
    const m = fbm(x / 260, y / 260, 41, 3), big = R() < 0.3 ? 1.6 : 0.6;
    const len = (25 + R() * 70 + 260 * m * m * m * big) * k;
    fern(R, x, y, Math.atan2(g2[1], g2[0]) + (R() - 0.5) * 0.9, len, 0.6, 0, 0.5 + R() * 0.2, 0, set, R() * 50);
  }
  // fine needles right on the rim
  for (const [x, y] of contourPoints(field, s, -2, 9)) {
    const ix = Math.round(x), iy = Math.round(y), R = rng((hash(ix, iy, 4) * 4294967296) >>> 0);
    field.grad(s, x, y, g2);
    fern(R, x, y, Math.atan2(g2[1], g2[0]) + (R() - 0.5) * 1.6, (10 + R() * 22) * Math.min(1, k), 0.45, 2, 0.5, 0, set, R() * 50);
  }
}
function layout(instant) {
  const s = field.compute(iconRects(icons), { reach: 24, warp: 12, soft: 34, far: 1300, wobble: 0.12 });
  lastS = s;
  morph.set(s, instant);
  if (instant) { segs.clear(); build(s, 1); growT0 = T; meltT0 = -1e9; }
  else { segs.keepSet(1, 0); growT0old = growT0; build(s, 1); growT0 = T; meltT0 = T; }
  segs.upload();
}
function rebuild() { if (!lastS) return; segs.clear(); build(lastS, 1); segs.upload(); }
function addSlot(i, x, y, kind) { R[i * 4] = x; R[i * 4 + 1] = y; R[i * 4 + 2] = T; R[i * 4 + 3] = kind; }
function click(x, y) { const i = nextSlot; nextSlot = nextClick(i, P); addSlot(i, x, y, 1); }
function step(dt) {
  T += dt;
  for (let i = 0; i < NR; i++) if (R[i * 4 + 3] > 0 && T - R[i * 4 + 2] > (R[i * 4 + 3] === 1 ? 43 : 12)) R[i * 4 + 3] = 0;
  const lim = Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
  for (let i = lim; i < MAX_CLICKS; i++) R[i * 4 + 3] = 0;
  const pt = page && page.ptr;
  wakeClock -= dt;
  // breath fog follows the cursor over clear glass, and an icon while it is dragged
  if (pt && pt.in && (pt.drag || (!pt.icon && Math.hypot(pt.vx, pt.vy) > 60)) && wakeClock <= 0) {
    addSlot(MAX_CLICKS + wakeSlot, pt.x, pt.y, 2); wakeSlot = (wakeSlot + 1) % WAKES; wakeClock = 0.25;
  }
  // now and then a frost star appears on its own, somewhere on the clear glass
  if (T > selfAt) {
    selfAt = T + 120 + Math.random() * 180;
    for (let k = 0; k < 12; k++) {
      const x = 80 + Math.random() * (W - 160), y = 80 + Math.random() * (H - 160);
      if (morph.target(x, y) > 260) { addSlot(NR - 1, x, y, 1); break; }
    }
  }
  nActive = 0;
  for (let i = 0; i < NR; i++) {
    if (R[i * 4 + 3] <= 0) continue;
    const o = nActive++ * 4;
    RA[o] = R[i * 4]; RA[o + 1] = R[i * 4 + 1]; RA[o + 2] = R[i * 4 + 2]; RA[o + 3] = R[i * 4 + 3];
  }
}
function draw(now) {
  const pal = PALETTES[clamp(P.palette | 0, 0, PALETTES.length - 1)];
  morph.tick(now);
  gl.viewport(0, 0, CW, CH);
  gl.useProgram(PR.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, morph.tex[0]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, morph.tex[1]);
  gl.uniform1i(U.uF0, 0); gl.uniform1i(U.uF1, 1); gl.uniform1f(U.uK, morph.k);
  gl.uniform2f(U.uGrid, field.Gw, field.Gh); gl.uniform2f(U.uCv, CW, CH); gl.uniform1f(U.uScale, CW / W);
  gl.uniform1f(U.uT, T); gl.uniform1f(U.uHaze, P.haze); gl.uniform1i(U.uN, nActive);
  gl.uniform3fv(U.uG0, pal[0]); gl.uniform3fv(U.uG1, pal[1]); gl.uniform3fv(U.uHz, pal[2]); gl.uniform3fv(U.uFr, pal[3]);
  gl.uniform4fv(U.uR, RA);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
  gl.useProgram(PS.p);
  gl.uniform2f(US.uCv, CW, CH); gl.uniform1f(US.uScale, CW / W); gl.uniform1f(US.uPad, 5);
  gl.uniform1f(US.uT, T); gl.uniform1f(US.uGlints, P.glints);
  gl.uniform1f(US.uGrow0, (T - growT0old) / GROW_S); gl.uniform1f(US.uGrow1, (T - growT0) / GROW_S);
  gl.uniform1f(US.uMelt, clamp((T - meltT0) / MELT_S, 0, 1));
  gl.uniform3fv(US.uFr, pal[3]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  segs.draw();
  gl.disable(gl.BLEND);
}

const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['frost', 'haze', 'glints', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc();
    if (icons.length) layout(true);
  },
  icons(list, first) { icons = list; layout(first || !lastS); },
  settings(changed) { if (changed.includes('frost')) rebuild(); },
  reseed() { field.reseed(); layout(true); },
  step, draw, click,
  stats: () => `frost ${segs.n} · ${nActive}`,
});
window.__dbg = { P, click, segs, setT(t) { T = t; }, frostStar() { selfAt = T; } };
