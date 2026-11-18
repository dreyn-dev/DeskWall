// DeskWall · Isolines ("Изолинии").
// A calm topographic map. Every icon is a small hill and the contour lines run around the whole
// group, so a row or a column of icons makes one continuous ridge. Far from the icons the map is
// bare. Motion: the contours creep very slowly. Cursor: moving over bare ground raises a faint
// knoll that sinks again. Click: a hill rises under the cursor and its contours ring out.
// One full-screen pass over a field computed on the CPU only when the icons change (kit.js Field
// + Morph); no per-frame allocations. Lines are anti-aliased in device pixels, so crisp at 4K.
import { MAX_CLICKS, nextClick, clamp, Field, Morph, CapMask, iconRects, FULL_VS, NOISE_GLSL, makeGL, program, runPage, STEP } from './kit.js';

const P = { lines: 1, reach: 1, glow: 1, palette: 0, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
// per palette: ground low, ground high, contour, index contour (every 4th), shading strength
const PALETTES = [
  [[0.15, 0.24, 0.22], [0.27, 0.39, 0.34], [0.72, 0.85, 0.72], [0.97, 0.86, 0.62], 1.0],   // moss
  [[0.05, 0.1, 0.16], [0.1, 0.22, 0.3], [0.52, 0.8, 0.86], [0.96, 0.9, 0.7], 1.0],          // deep sea
  [[0.94, 0.92, 0.86], [0.89, 0.87, 0.79], [0.5, 0.42, 0.32], [0.74, 0.36, 0.2], 0.4],       // paper
  [[0.14, 0.11, 0.2], [0.27, 0.19, 0.31], [0.85, 0.72, 0.88], [1.0, 0.78, 0.6], 1.0],        // plum dusk
];
const WAKES = 8, NR = MAX_CLICKS + WAKES;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uF0, uF1, uCap;
uniform float uK, uScale, uT, uGlow, uLines, uReach, uH, uShade;
uniform int uN;
uniform vec2 uCv, uGrid;
uniform vec3 uB0, uB1, uLine, uIdx;
uniform vec4 uR[${NR}];           // live knolls (clicks and cursor): x, y, birth time, strength
out vec4 o;
${NOISE_GLSL}
float fld(vec2 p) {
  vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid;
  return mix(texture(uF0, uv).r, texture(uF1, uv).r, uK);
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  float s = fld(p);
  const float E = ${STEP.toFixed(1)};
  vec2 gd = vec2(fld(p + vec2(E, 0.)) - fld(p - vec2(E, 0.)), fld(p + vec2(0., E)) - fld(p - vec2(0., E))) / (2. * E);
  float L = 190. * uReach;
  // the land: one smooth hill over the icon group, steep near it, a long gentle foot
  float hb = exp(-max(s, 0.) / L);
  float h = hb;
  vec2 g = -hb / L * gd * step(0., s);            // slope of the hill
  // terrain wobble, fades at the very top and the far foot so the outline stays clean
  float wob = (vn(p * 0.0042 + 3.1) - 0.5) * 0.14 + (vn(p * 0.012 + 8.7) - 0.5) * 0.045;
  h += wob * smoothstep(0.015, 0.25, hb) * (1. - 0.6 * smoothstep(0.8, 1., hb));
  // knolls from clicks and the cursor
  for (int i = 0; i < ${NR}; i++) {
    if (i >= uN) break;
    vec4 r = uR[i];
    vec2 v = p - r.xy; float age = uT - r.z, sg = 28. + 160. * r.w;
    h += r.w * 1.5 * smoothstep(0., 0.9, age) * exp(-age / 4.2) * exp(-dot(v, v) / (2. * sg * sg));
  }
  float N = 12. * uLines;
  float it = h * N - uT * 0.03;
  float fw = max(fwidth(it), 1e-5);
  float dl = abs(fract(it - 0.5) - 0.5) / fw;     // distance to the nearest contour in device pixels
  float idx = floor(it + 0.5);
  float major = step(abs(mod(idx, 4.)), 0.5);
  float hw = (0.55 + 0.45 * major) * uScale * 0.9;
  float ln = 1. - smoothstep(hw - 0.7, hw + 0.7, dl);
  // lines live only on the hill; fade towards the empty far field and at the flat top
  float a = smoothstep(0.035, 0.17, h) * (1. - smoothstep(0.9, 1.02, h));
  float cap = 1. - 0.7 * texture(uCap, (p / ${STEP.toFixed(1)} + 0.5) / uGrid).r;
  // ground: darker at the foot, lighter towards the top, light from the upper left
  vec3 col = mix(uB0, uB1, smoothstep(0., 1., h));
  float sh = clamp(dot(normalize(g + 1e-7), vec2(-0.7, 0.7)) * min(length(g) * L * 1.6, 1.), -1., 1.);
  col += sh * 0.05 * uShade * (0.4 + 0.6 * smoothstep(0.02, 0.5, hb));
  col += (vn(p * 0.02) - 0.5) * 0.02;
  col = mix(col, mix(uLine, uIdx, major), ln * a * cap * clamp(0.62 + 0.38 * major, 0., 1.) * min(uGlow, 1.4));
  vec2 c = dev / uCv - 0.5; col *= 1. - 0.22 * dot(c * vec2(1.7, 1.2), c * vec2(1.7, 1.2)) * 1.4;
  col += (h21(dev) - 0.5) / 255.;
  o = vec4(col, 1.);
}`;

const cv = document.getElementById('art');
const gl = makeGL(cv);
const PR = program(gl, FULL_VS, FS), U = PR.U;
const VAO = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2400);
const cap = new CapMask(gl, field);
let W = 1, H = 1, CW = 1, CH = 1, icons = [], first = true, T = 0, nextSlot = 0, wakeSlot = 0, wakeClock = 0, nActive = 0;
const R = new Float32Array(NR * 4);
const RA = new Float32Array(NR * 4);   // R compacted to the live slots, what the shader reads

function layout() {
  morph.set(field.compute(iconRects(icons), { reach: 16, warp: 14, soft: 40, far: 1300, wobble: 0.2 }), first);
  cap.bake(icons);
}
function click(x, y) {
  const i = nextSlot; nextSlot = nextClick(i, P);
  R[i * 4] = x; R[i * 4 + 1] = y; R[i * 4 + 2] = T; R[i * 4 + 3] = 0.3;
}
function step(dt) {
  T += dt;
  for (let i = 0; i < NR; i++) if (R[i * 4 + 3] > 0 && T - R[i * 4 + 2] > 16) R[i * 4 + 3] = 0;
  const lim = Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
  for (let i = lim; i < MAX_CLICKS; i++) R[i * 4 + 3] = 0;
  // the cursor over bare ground raises a faint knoll now and then
  const pt = page && page.ptr;
  wakeClock -= dt;
  if (pt && pt.in && !pt.icon) {
    const sp = Math.hypot(pt.vx, pt.vy);
    if (sp > 140 && wakeClock <= 0) {
      const i = MAX_CLICKS + wakeSlot; wakeSlot = (wakeSlot + 1) % WAKES; wakeClock = 0.3;
      R[i * 4] = pt.x; R[i * 4 + 1] = pt.y; R[i * 4 + 2] = T; R[i * 4 + 3] = 0.16 + 0.06 * clamp(sp / 900, 0, 1);
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
  cap.bind(2); gl.uniform1i(U.uCap, 2);
  gl.uniform1i(U.uF0, 0); gl.uniform1i(U.uF1, 1); gl.uniform1f(U.uK, morph.k);
  gl.uniform2f(U.uGrid, field.Gw, field.Gh); gl.uniform2f(U.uCv, CW, CH); gl.uniform1f(U.uScale, CW / W);
  gl.uniform1f(U.uT, T); gl.uniform1f(U.uGlow, P.glow); gl.uniform1f(U.uLines, P.lines); gl.uniform1f(U.uReach, P.reach);
  gl.uniform1f(U.uH, H); gl.uniform1i(U.uN, nActive); gl.uniform1f(U.uShade, pal[4]);
  gl.uniform3fv(U.uB0, pal[0]); gl.uniform3fv(U.uB1, pal[1]); gl.uniform3fv(U.uLine, pal[2]); gl.uniform3fv(U.uIdx, pal[3]);
  gl.uniform4fv(U.uR, RA);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
}

const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['lines', 'reach', 'glow', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc(); cap.alloc();
    if (icons.length) { const f = first; first = true; layout(); first = f; }
  },
  icons(list) { icons = list; layout(); first = false; },
  settings() {},
  reseed() { field.reseed(); layout(); },
  step, draw, click,
  stats: () => `isolines ${nActive}`,
});
window.__dbg = { P, click, setT(t) { T = t; } };
