// DeskWall · Watercolor ("Акварель").
// Light paper with pigment washes that bloom out of the icons. All icons share one wet shape, so a
// row or a column makes a single wash (never a pile of separate blobs), and the colour changes
// gradually across it between neighbouring hues, so nothing goes muddy where shapes meet. Three
// glazes (pale, middle, deep) have slightly different, hand-wobbled edges with a darker pooled rim
// and granulated pigment; the rest of the sheet is bare paper.
// Motion: the edges breathe very slowly and a faint wet sheen drifts across the wash. Cursor:
// moving over bare paper leaves small pigment dabs that dry out. Click: a drop of colour blooms
// on the paper into a round wash with a dark rim and a pale heart.
// One full-screen pass over a field computed on the CPU only when the icons change (kit.js Field
// + Morph); no per-frame allocations; the paper grain is in device pixels, so crisp at 4K.
import { MAX_CLICKS, nextClick, clamp, Field, Morph, iconRects, FULL_VS, NOISE_GLSL, makeGL, program, runPage, STEP } from './kit.js';

const P = { spread: 1, depth: 1, palette: 0, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
// per palette: three neighbouring pigments (colour at full strength), paper tint
const PALETTES = [
  [[0.16, 0.55, 0.6], [0.3, 0.5, 0.8], [0.38, 0.7, 0.5], [0.955, 0.94, 0.905]],   // sea
  [[0.9, 0.4, 0.5], [0.96, 0.56, 0.4], [0.97, 0.74, 0.38], [0.965, 0.935, 0.9]],  // blossom
  [[0.52, 0.4, 0.78], [0.3, 0.48, 0.8], [0.88, 0.45, 0.66], [0.95, 0.94, 0.92]],  // dusk
  [[0.4, 0.7, 0.4], [0.72, 0.78, 0.34], [0.22, 0.6, 0.55], [0.955, 0.945, 0.9]],  // meadow
];
const WAKES = 8, NR = MAX_CLICKS + WAKES;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uF0, uF1;
uniform float uK, uScale, uT, uSpread, uDepth, uH;
uniform int uN;
uniform vec2 uCv, uGrid;
uniform vec3 uP0, uP1, uP2, uPaper;
uniform vec4 uR[${NR}];           // live drops and dabs: x, y, birth time, strength
out vec4 o;
${NOISE_GLSL}
float fld(vec2 p) {
  vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid;
  return mix(texture(uF0, uv).r, texture(uF1, uv).r, uK);
}
vec3 pigment(vec2 p, float k) {
  float u = clamp(fbm3(p * 0.0016 + 4.7 + k) * 1.5 - 0.2 + (p.y / uH - 0.5) * 0.5, 0., 1.);
  return u < 0.5 ? mix(uP0, uP1, u * 2.) : mix(uP1, uP2, u * 2. - 1.);
}
// one glaze: coverage inside the wet edge, and a thin darker rim along the edge
vec2 glaze(float sw, float soft) {
  float inside = 1. - smoothstep(-soft, soft, sw);
  float rim = exp(-sw * sw / (2. * soft * soft * 2.2)) * (0.45 + 0.55 * inside);
  return vec2(inside, rim);
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  float s = fld(p);
  float tw = uT * 0.012;
  // hand wobble of the three edges, each with its own noise so the glazes do not run parallel
  float nA = (fbm3(p * 0.0085 + vec2(1.3, 2.1) + tw) - 0.5) * 150. + (vn(p * 0.045 + 5.) - 0.5) * 9.;
  float nB = (fbm3(p * 0.0105 + vec2(7.7, 3.3) - tw) - 0.5) * 80. + (vn(p * 0.06 + 9.) - 0.5) * 7.;
  float nC = (fbm3(p * 0.013 + vec2(4.2, 8.8) + tw) - 0.5) * 50. + (vn(p * 0.07 + 2.) - 0.5) * 5.;
  float sp = 125. * uSpread;
  vec2 gA = glaze(s - sp + nA, 3.2 * uScale), gB = glaze(s - sp * 0.45 + nB, 2.6 * uScale), gC = glaze(s + 4. + nC, 2.2 * uScale);
  // granulation and blooms inside the pigment
  float gran = 0.84 + 0.32 * vn(p * 0.7) + 0.1 * (h21(dev * 0.37) - 0.5);
  float bloom = 1. - 0.28 * smoothstep(0.55, 0.8, fbm3(p * 0.021 + 3.));
  float k = uDepth * gran * bloom;
  float aA = gA.x * 0.36 + gA.y * 0.18;
  float aB = gB.x * 0.34 + gB.y * 0.2;
  float aC = gC.x * 0.3 + gC.y * 0.12;
  float a = 1. - (1. - clamp(aA * k, 0., 0.9)) * (1. - clamp(aB * k, 0., 0.9)) * (1. - clamp(aC * k, 0., 0.9));
  vec3 pig = pigment(p, 0.);
  // paper: soft cloudy tone plus fine grain
  vec3 col = uPaper + (fbm3(p * 0.9) - 0.5) * 0.03 + (vn(p * vec2(0.35, 1.9)) - 0.5) * 0.014 + (h21(dev) - 0.5) * 0.012;
  col *= 1. - a * (1. - pig);
  // drops from clicks and dabs from the cursor
  for (int i = 0; i < ${NR}; i++) {
    if (i >= uN) break;
    vec4 r = uR[i];
    float age = uT - r.z, big = step(0.2, r.w);
    float rad = mix(13., 95., big) * (1. - exp(-age * mix(1.8, 0.9, big)));
    float d = length(p - r.xy) + (fbm3(p * 0.04 + r.z) - 0.5) * rad * 0.25;
    float life = exp(-age / mix(5., 14., big)) * smoothstep(0., 0.25, age);
    float ins = 1. - smoothstep(rad - 2.5 * uScale, rad + 2.5 * uScale, d);
    float rim = exp(-pow((d - rad) / (4. * uScale), 2.)) * 0.8;
    float heart = mix(1., 0.55, big * (1. - smoothstep(0., rad, d)));
    float da = clamp((ins * 0.3 * heart + rim * 0.3) * life * mix(1., 1.4, big) * uDepth * gran, 0., 0.85);
    col *= 1. - da * (1. - pigment(r.xy, fract(r.z * 3.7) * 6.));
  }
  // faint wet sheen drifting over the wash
  col += vec3(1., 0.99, 0.95) * 0.04 * a * smoothstep(0.6, 1., sin(p.x * 0.004 + p.y * 0.0028 - uT * 0.05) * 0.5 + 0.5);
  vec2 c = dev / uCv - 0.5; col *= 1. - 0.06 * dot(c * vec2(1.6, 1.2), c * vec2(1.6, 1.2));
  o = vec4(col, 1.);
}`;

const cv = document.getElementById('art');
const gl = makeGL(cv);
const PR = program(gl, FULL_VS, FS), U = PR.U;
const VAO = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2800);
let W = 1, H = 1, CW = 1, CH = 1, icons = [], first = true, T = 0, nextSlot = 0, wakeSlot = 0, wakeClock = 0, nActive = 0;
const R = new Float32Array(NR * 4);
const RA = new Float32Array(NR * 4);   // R compacted to the live slots, what the shader reads

function layout() {
  morph.set(field.compute(iconRects(icons), { reach: 26, warp: 22, soft: 46, far: 900, wobble: 0.25 }), first);
}
function click(x, y) {
  const i = nextSlot; nextSlot = nextClick(i, P);
  R[i * 4] = x; R[i * 4 + 1] = y; R[i * 4 + 2] = T; R[i * 4 + 3] = 0.3;
}
function step(dt) {
  T += dt;
  for (let i = 0; i < NR; i++) if (R[i * 4 + 3] > 0 && T - R[i * 4 + 2] > 30) R[i * 4 + 3] = 0;
  const lim = Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
  for (let i = lim; i < MAX_CLICKS; i++) R[i * 4 + 3] = 0;
  // the cursor over bare paper leaves small pigment dabs
  const pt = page && page.ptr;
  wakeClock -= dt;
  if (pt && pt.in && !pt.icon) {
    const sp = Math.hypot(pt.vx, pt.vy);
    if (sp > 140 && wakeClock <= 0) {
      const i = MAX_CLICKS + wakeSlot; wakeSlot = (wakeSlot + 1) % WAKES; wakeClock = 0.16;
      R[i * 4] = pt.x; R[i * 4 + 1] = pt.y; R[i * 4 + 2] = T; R[i * 4 + 3] = 0.1;
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
  gl.uniform1f(U.uT, T); gl.uniform1f(U.uSpread, P.spread); gl.uniform1f(U.uDepth, P.depth);
  gl.uniform1f(U.uH, H); gl.uniform1i(U.uN, nActive);
  gl.uniform3fv(U.uP0, pal[0]); gl.uniform3fv(U.uP1, pal[1]); gl.uniform3fv(U.uP2, pal[2]); gl.uniform3fv(U.uPaper, pal[3]);
  gl.uniform4fv(U.uR, RA);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
}

const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['spread', 'depth', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc();
    if (icons.length) { const f = first; first = true; layout(); first = f; }
  },
  icons(list) { icons = list; layout(); first = false; },
  settings() {},
  reseed() { field.reseed(); layout(); },
  step, draw, click,
  stats: () => `watercolor ${nActive}`,
});
window.__dbg = { P, click, setT(t) { T = t; } };
