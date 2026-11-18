// DeskWall · Ripples ("Круги на воде").
// Dusk water seen from above. Every icon is a pebble: soft rings of light spread around it and
// follow the outline of the whole group, so a row or a column of icons makes one set of waves
// instead of separate circles. The middle of the screen stays calm, dark and empty.
// Motion: rings drift slowly outward, the light glints as the moon-spot wanders. Cursor: moving
// over bare water leaves a faint wake. Click the bare water: a stone drops and a ring runs out.
// Everything is one full-screen pass over a distance field that is computed on the CPU only when
// the icons change (kit.js Field + Morph); no per-frame allocations.
import { MAX_CLICKS, nextClick, clamp, Field, Morph, iconRects, FULL_VS, makeGL, program, runPage, STEP } from './kit.js';

const P = { rings: 1, reach: 1, glow: 1, drops: 1, palette: 0, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
// per palette: water top, water bottom, lit water, glint
const PALETTES = [
  [[0.06, 0.11, 0.2], [0.12, 0.2, 0.33], [0.08, 0.2, 0.3], [1.0, 0.84, 0.55]],   // dusk
  [[0.03, 0.12, 0.14], [0.07, 0.24, 0.25], [0.08, 0.28, 0.27], [0.92, 1.0, 0.85]], // lagoon
  [[0.16, 0.11, 0.21], [0.29, 0.19, 0.3], [0.32, 0.18, 0.24], [1.0, 0.8, 0.62]],   // dawn
  [[0.02, 0.03, 0.06], [0.06, 0.07, 0.13], [0.09, 0.11, 0.2], [0.85, 0.9, 1.0]],   // ink night
];
const WAKES = 8, DROPS = 6, NR = MAX_CLICKS + WAKES + DROPS;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uF0, uF1, uCap;
uniform float uK, uScale, uT, uGlow, uWave, uReach, uH;
uniform int uN;
uniform vec2 uCv, uGrid;
uniform vec3 uD0, uD1, uLit, uSpec, uLight;
uniform vec4 uR[${NR}];           // active stones, wakes and drops only: x, y, birth time, strength
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
    if (i >= uN) break;
    vec4 r = uR[i];
    vec2 v = p - r.xy; float rr = max(length(v), 1.0), age = uT - r.z;
    float x = rr - age * 150., g = exp(-pow(x / 42., 2.));
    float dec = r.w * exp(-age / 3.2) * smoothstep(0., 0.2, age) / (1. + rr * 0.004);
    float kc = 0.09;
    slope += dec * (g * kc * cos(kc * x) - 2. * x / (42. * 42.) * g * sin(kc * x)) * v / rr;
  }
  vec3 n = normalize(vec3(-slope * 9., 1.));
  vec3 L = normalize(uLight);
  float dif = dot(n, L), sp = pow(max(dot(reflect(-L, n), vec3(0., 0., 1.)), 0.), 90.);
  float lit = smoothstep(0.55, 0.95, dif);
  vec3 col = mix(uD0, uD1, clamp(p.y / uH * 0.6 + 0.2, 0., 1.));
  // soft band under every icon where its caption sits: the rings dim there so the text stays readable
  float cap = 1. - 0.55 * texture(uCap, (p / ${STEP.toFixed(1)} + 0.5) / uGrid).r;
  col += (uLit * lit * 2.2 + uSpec * sp * 0.78) * uGlow * cap;
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
let W = 1, H = 1, CW = 1, CH = 1, icons = [], first = true, T = 0, nextSlot = 0, wakeSlot = 0, wakeClock = 0, dropSlot = 0, dropClock = 2, nActive = 0;
const R = new Float32Array(NR * 4);
const RA = new Float32Array(NR * 4);   // R compacted to the active slots, what the shader reads
const capTex = gl.createTexture();
let capBuf = new Uint8Array(1);
const light = new Float32Array(3);

function allocCap() {
  capBuf = new Uint8Array(field.Gw * field.Gh);
  gl.bindTexture(gl.TEXTURE_2D, capTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, field.Gw, field.Gh, 0, gl.RED, gl.UNSIGNED_BYTE, capBuf);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
}
// Caption mask (on layout only): 1 inside a band under each icon glyph, soft edge about 10 px.
function bakeCap() {
  capBuf.fill(0);
  const Gw = field.Gw, Gh = field.Gh, M = 10;
  for (const ic of icons) {
    const x0 = ic.x + 4, x1 = ic.x + ic.w - 4, y0 = ic.y + ic.h * 0.6, y1 = ic.y + ic.h + 8;
    const i0 = Math.max(0, Math.floor((x0 - M) / STEP)), i1 = Math.min(Gw - 1, Math.ceil((x1 + M) / STEP));
    const j0 = Math.max(0, Math.floor((y0 - M) / STEP)), j1 = Math.min(Gh - 1, Math.ceil((y1 + M) / STEP));
    for (let j = j0; j <= j1; j++) {
      const dy = Math.max(y0 - j * STEP, 0, j * STEP - y1);
      for (let i = i0; i <= i1; i++) {
        const dx = Math.max(x0 - i * STEP, 0, i * STEP - x1);
        const t = clamp(1 - Math.hypot(dx, dy) / M, 0, 1), v = (t * t * (3 - 2 * t) * 255) | 0;
        if (v > capBuf[j * Gw + i]) capBuf[j * Gw + i] = v;
      }
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, capTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, field.Gw, field.Gh, gl.RED, gl.UNSIGNED_BYTE, capBuf);
}
function layout() {
  const rects = iconRects(icons);
  morph.set(field.compute(rects, { reach: 12, warp: 8, soft: 30, far: 900, wobble: 0.04 }), first);
  bakeCap();
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
  // a small drop falls beside a random icon now and then (sides and above, never on its caption)
  dropClock -= dt;
  if (dropClock <= 0) {
    dropClock = 2 + Math.random() * 3;
    if (P.drops > 0 && icons.length) {
      const ic = icons[(Math.random() * icons.length) | 0];
      const a = -Math.PI - 0.35 + Math.random() * (Math.PI + 0.7), off = 10 + Math.random() * 30;
      const i = MAX_CLICKS + WAKES + dropSlot; dropSlot = (dropSlot + 1) % DROPS;
      R[i * 4] = ic.x + ic.w / 2 + Math.cos(a) * (37 + off); R[i * 4 + 1] = ic.y + 28 + Math.sin(a) * (28 + off);
      R[i * 4 + 2] = T; R[i * 4 + 3] = (0.3 + Math.random() * 0.3) * P.drops;
    }
  }
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
  // compact the live slots so the shader loops over them only
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
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, capTex); gl.uniform1i(U.uCap, 2);
  gl.uniform1i(U.uF0, 0); gl.uniform1i(U.uF1, 1); gl.uniform1f(U.uK, morph.k);
  gl.uniform2f(U.uGrid, field.Gw, field.Gh); gl.uniform2f(U.uCv, CW, CH); gl.uniform1f(U.uScale, CW / W);
  gl.uniform1f(U.uT, T); gl.uniform1f(U.uGlow, P.glow); gl.uniform1f(U.uWave, P.rings); gl.uniform1f(U.uReach, P.reach); gl.uniform1f(U.uH, H); gl.uniform1i(U.uN, nActive);
  gl.uniform3fv(U.uD0, pal[0]); gl.uniform3fv(U.uD1, pal[1]); gl.uniform3fv(U.uLit, pal[2]); gl.uniform3fv(U.uSpec, pal[3]);
  // the glint spot wanders very slowly
  light[0] = -0.5 + 0.25 * Math.sin(T * 0.05); light[1] = 0.6 + 0.15 * Math.cos(T * 0.037); light[2] = 0.65;
  gl.uniform3fv(U.uLight, light);
  gl.uniform4fv(U.uR, RA);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
}

const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['rings', 'reach', 'glow', 'drops', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc(); allocCap();
    if (icons.length) { const f = first; first = true; layout(); first = f; }
  },
  icons(list) { icons = list; layout(); first = false; },
  settings() {},
  reseed() { field.reseed(); layout(); },
  step, draw, click,
  stats: () => `ripples ${nActive}`,
});
window.__dbg = { P, click };
