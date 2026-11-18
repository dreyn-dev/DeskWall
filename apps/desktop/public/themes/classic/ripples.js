// DeskWall · Ripples ("Круги на воде").
// Dusk water seen from above. Every icon is a pebble: soft rings of light spread around it and
// follow the outline of the whole group, so a row or a column of icons makes one set of waves
// instead of separate circles. The middle of the screen stays calm, dark and empty.
// Motion: rings drift slowly outward, the light glints as the moon-spot wanders. Cursor: moving
// over bare water leaves a faint wake. Click the bare water: a stone drops and a ring runs out.
// Everything is one full-screen pass over a distance field that is computed on the CPU only when
// the icons change (kit.js Field + Morph); no per-frame allocations.
import { MAX_CLICKS, nextClick, clamp, Field, Morph, iconRects, FULL_VS, makeGL, program, runPage, STEP } from './kit.js';

const P = { rings: 1, reach: 1, glow: 1, palette: 0, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
// per palette: water top, water bottom, lit water, glint
const PALETTES = [
  [[0.06, 0.11, 0.2], [0.12, 0.2, 0.33], [0.08, 0.2, 0.3], [1.0, 0.84, 0.55]],   // dusk
  [[0.03, 0.12, 0.14], [0.07, 0.24, 0.25], [0.08, 0.28, 0.27], [0.92, 1.0, 0.85]], // lagoon
  [[0.16, 0.11, 0.21], [0.29, 0.19, 0.3], [0.32, 0.18, 0.24], [1.0, 0.8, 0.62]],   // dawn
  [[0.02, 0.03, 0.06], [0.06, 0.07, 0.13], [0.09, 0.11, 0.2], [0.85, 0.9, 1.0]],   // ink night
];
const WAKES = 8, NR = MAX_CLICKS + WAKES;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uF0, uF1;
uniform float uK, uScale, uT, uGlow, uWave, uReach;
uniform vec2 uCv, uGrid;
uniform vec3 uD0, uD1, uLit, uSpec, uLight;
uniform vec4 uR[${NR}];           // x, y, birth time, strength (0 = unused)
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fld(vec2 p) {
  vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid;
  return mix(texture(uF0, uv).r, texture(uF1, uv).r, uK);
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  // distance to the icon group (smooth union, softly wobbling outline), 0 at the edge of the group
  float d = max(fld(p), 0.0);
  const float E = ${STEP.toFixed(1)};
  vec2 gd = vec2(fld(p + vec2(E, 0.)) - fld(p - vec2(E, 0.)), fld(p + vec2(0., E)) - fld(p - vec2(0., E))) / (2. * E);
  float kk = 0.085 / uWave, spd = 1.0;
  float env = exp(-pow(d / (200. * uReach), 2.)) * smoothstep(0., 60., d);
  float breathe = 0.9 + 0.1 * sin(uT * 0.35);
  float ph = d * kk - uT * spd;
  vec2 slope = env * breathe * kk * cos(ph) * gd;
  // stones and wakes: a packet of rings that runs outward and fades
  for (int i = 0; i < ${NR}; i++) {
    vec4 r = uR[i];
    if (r.w <= 0.0) continue;
    vec2 v = p - r.xy; float rr = max(length(v), 1.0), age = uT - r.z;
    float x = rr - age * 150., g = exp(-pow(x / 42., 2.));
    float dec = r.w * exp(-age / 3.2) * smoothstep(0., 0.2, age) / (1. + rr * 0.004);
    float kc = 0.09;
    slope += dec * (g * kc * cos(kc * x) - 2. * x / (42. * 42.) * g * sin(kc * x)) * v / rr;
  }
  vec3 n = normalize(vec3(-slope * 9., 1.));
  vec3 L = normalize(uLight);
  float dif = dot(n, L), sp = pow(max(dot(reflect(-L, n), vec3(0., 0., 1.)), 0.), 60.);
  float lit = smoothstep(0.55, 0.95, dif);
  vec3 col = mix(uD0, uD1, clamp(p.y / ${'1440.0'} * 0.6 + 0.2, 0., 1.));
  col += uLit * lit * 2.2 * uGlow + uSpec * sp * 0.7 * uGlow;
  col += vec3(0.05, 0.1, 0.12) * exp(-pow(d / 230., 2.)) * 0.5;
  vec2 c = dev / uCv - 0.5; col *= 1. - 0.25 * dot(c * vec2(1.7, 1.2), c * vec2(1.7, 1.2)) * 1.4;
  col += (hash(dev) - 0.5) / 255.;
  o = vec4(col, 1.);
}`;

const cv = document.getElementById('art');
const gl = makeGL(cv);
const PR = program(gl, FULL_VS, FS), U = PR.U;
const VAO = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2400);
let W = 1, H = 1, CW = 1, CH = 1, icons = [], first = true, T = 0, nextSlot = 0, wakeSlot = 0, wakeClock = 0;
const R = new Float32Array(NR * 4);
const light = new Float32Array(3);

function layout() {
  const rects = iconRects(icons);
  morph.set(field.compute(rects, { reach: 12, warp: 12, soft: 30, far: 900, wobble: 0.08 }), first);
}
function click(x, y) {
  const i = nextSlot; nextSlot = nextClick(i, P);
  R[i * 4] = x; R[i * 4 + 1] = y; R[i * 4 + 2] = T; R[i * 4 + 3] = 1;
}
function step(dt) {
  T += dt;
  for (let i = 0; i < NR; i++) if (R[i * 4 + 3] > 0 && T - R[i * 4 + 2] > 9) R[i * 4 + 3] = 0;
  const lim = Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
  for (let i = lim; i < MAX_CLICKS; i++) R[i * 4 + 3] = 0;
  // wake of the cursor over bare water
  const pt = page && page.ptr;
  wakeClock -= dt;
  if (pt && pt.in && !pt.icon) {
    const sp = Math.hypot(pt.vx, pt.vy);
    if (sp > 140 && wakeClock <= 0) {
      const i = MAX_CLICKS + wakeSlot; wakeSlot = (wakeSlot + 1) % WAKES; wakeClock = 0.22;
      R[i * 4] = pt.x; R[i * 4 + 1] = pt.y; R[i * 4 + 2] = T; R[i * 4 + 3] = 0.22 + 0.2 * clamp(sp / 900, 0, 1);
    }
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
  gl.uniform1f(U.uT, T); gl.uniform1f(U.uGlow, P.glow); gl.uniform1f(U.uWave, P.rings); gl.uniform1f(U.uReach, P.reach);
  gl.uniform3fv(U.uD0, pal[0]); gl.uniform3fv(U.uD1, pal[1]); gl.uniform3fv(U.uLit, pal[2]); gl.uniform3fv(U.uSpec, pal[3]);
  // the glint spot wanders very slowly
  light[0] = -0.5 + 0.25 * Math.sin(T * 0.05); light[1] = 0.6 + 0.15 * Math.cos(T * 0.037); light[2] = 0.65;
  gl.uniform3fv(U.uLight, light);
  gl.uniform4fv(U.uR, R);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
}

const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['rings', 'reach', 'glow', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc();
    if (icons.length) { const f = first; first = true; layout(); first = f; }
  },
  icons(list) { icons = list; layout(); first = false; },
  settings() {},
  reseed() { field.reseed(); layout(); },
  step, draw, click,
  stats: () => `ripples ${R.reduce((n, v, i) => n + ((i & 3) === 3 && v > 0 ? 1 : 0), 0)}`,
});
window.__dbg = { P, click };
