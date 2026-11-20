// DeskWall · Constellations ("Созвездия").
// A calm night sky. A soft nebula gathers around every group of icons and the stars grow denser
// there; bright stars ring the group and are linked into constellations, so a row or a column of
// icons gets one shared figure. The middle of the screen stays dark with only a light dusting.
// Motion: stars twinkle, the nebula drifts very slowly, now and then a meteor crosses the sky.
// Cursor: moving over the empty sky leaves a short trail of stardust. Click: a shooting star
// flies off from the cursor and a new star lights up where you clicked, then fades.
// The sky (nebula and dust stars) is one full-screen pass over the icon field (kit.js Field +
// Morph); the constellations are one instanced draw built on the CPU only when the icons change.
// No per-frame allocations; stars are drawn analytically in device pixels, so crisp at 4K.
import {
  MAX_CLICKS, nextClick, clamp, easeInOut, hash, Field, Morph, iconRects, contourPoints, Segs,
  SEG_VS, SEG_GLSL, FULL_VS, NOISE_GLSL, makeGL, program, runPage, STEP,
} from './kit.js';

const P = { nebula: 1, stars: 1, lines: 1, palette: 0, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
// per palette: sky top, sky bottom, nebula A, nebula B, star tint, line colour
const PALETTES = [
  [[0.03, 0.047, 0.1], [0.063, 0.086, 0.18], [0.13, 0.38, 0.5], [0.41, 0.25, 0.55], [0.86, 0.91, 1.0], [0.62, 0.7, 0.95]],    // night blue
  [[0.05, 0.03, 0.09], [0.11, 0.06, 0.16], [0.45, 0.2, 0.55], [0.72, 0.3, 0.42], [1.0, 0.92, 0.96], [0.85, 0.66, 0.9]],        // violet haze
  [[0.01, 0.045, 0.055], [0.03, 0.1, 0.11], [0.08, 0.46, 0.42], [0.18, 0.32, 0.6], [0.86, 1.0, 0.95], [0.6, 0.9, 0.85]],       // aurora teal
  [[0.012, 0.014, 0.02], [0.03, 0.03, 0.045], [0.3, 0.25, 0.2], [0.2, 0.22, 0.36], [1.0, 0.93, 0.82], [0.85, 0.78, 0.66]],     // ink
];
const WAKES = 8, NR = MAX_CLICKS + WAKES + 1;   // clicks, cursor stardust, one random meteor
const FADE_MS = 2400;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uF0, uF1;
uniform float uK, uScale, uT, uNeb, uDens;
uniform int uN;
uniform vec2 uCv, uGrid;
uniform vec3 uS0, uS1, uNa, uNb, uStar;
uniform vec4 uR[${NR}];           // x, y, birth time, kind (1 click, 2 stardust, 3 / 4 meteor to the left / right)
out vec4 o;
${NOISE_GLSL}
float fld(vec2 p) {
  vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid;
  return mix(texture(uF0, uv).r, texture(uF1, uv).r, uK);
}
float fbm5(vec2 p) { float s = 0., a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.97; }
// one layer of dust stars: at most one star per cell, kept with a probability that grows near icons
vec3 dust(vec2 p, float cell, float amount, float size) {
  vec2 c = floor(p / cell), h = h22(c + cell);
  vec2 sp = (c + 0.15 + 0.7 * h) * cell;
  float near = exp(-max(fld(sp), 0.) / 230.);
  float keep = (0.05 + 0.95 * near) * amount;
  if (h21(c * 1.31 + cell) > keep) return vec3(0);
  float m = h21(c + 7.7), r = (0.45 + m * m * m * 1.3) * size * uScale;
  float d = length(p - sp) * uScale;
  float tw = 0.7 + 0.3 * sin(uT * (0.5 + 1.3 * h.x) + h.y * 6.283);
  float a = (0.25 + 0.65 * h21(c + 3.3)) * (1. - smoothstep(r - 0.5, r + 0.7, d)) * tw;
  vec3 tint = mix(uStar, vec3(1.0, 0.86, 0.7), step(0.82, h21(c + 9.1)));
  return tint * a;
}
// a streak of light ending at head, coming along dir
float streak(vec2 p, vec2 head, vec2 dir, float len, float w) {
  vec2 v = p - head; float along = -dot(v, dir), across = dot(v, vec2(-dir.y, dir.x));
  if (along < -6. || along > len) return 0.;
  float t = 1. - clamp(along / len, 0., 1.);
  float wd = w * (0.35 + 0.65 * t) * uScale;
  return t * t * exp(-pow(abs(across) * uScale / wd, 2.)) + exp(-dot(v, v) * uScale * uScale / (w * w * 6.)) * 0.8;
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  float s = fld(p);
  vec3 col = mix(uS0, uS1, clamp(dev.y / uCv.y * 0.7 + 0.3 * fbm3(p * 0.0011), 0., 1.));
  // nebula: only around the icon groups, slowly drifting
  float near = exp(-max(s, 0.) / 170.);
  if (near > 0.01) {
    float n = fbm5(p * 0.0048 + vec2(uT * 0.004, -uT * 0.0025));
    float neb = near * (0.45 + 0.75 * pow(n, 1.5));
    vec3 nc = mix(uNa, uNb, smoothstep(0.35, 0.65, fbm3(p * 0.002 + 4.)));
    col += nc * neb * 0.62 * uNeb;
  }
  col += dust(p, 24., 0.8 * uDens, 1.) + dust(p + 7., 11., 0.38 * uDens, 0.75);
  for (int i = 0; i < ${NR}; i++) {
    if (i >= uN) break;
    vec4 r = uR[i];
    float age = uT - r.z;
    float hs = fract(sin(r.z * 91.7 + r.x) * 4375.85);
    if (r.w < 1.5) {
      // click: a shooting star flies off, a new star lights up and slowly fades
      float ang = 2.45 + (hs - 0.5) * 0.9;
      vec2 dir = vec2(cos(ang), sin(ang));
      if (age < 1.2) col += uStar * streak(p, r.xy + dir * 520. * age, dir, 140. + 100. * min(age * 3., 1.), 1.3) * (1. - smoothstep(0.7, 1.2, age));
      float lit = smoothstep(0., 0.4, age) * exp(-age / 14.);
      vec2 v = (p - r.xy) * uScale; float d = length(v);
      float g = exp(-d * d / (2. * 1.4 * 1.4 * uScale * uScale)) + 0.35 * exp(-d / (5. * uScale));
      float rays = (exp(-abs(v.x) / (0.7 * uScale)) + exp(-abs(v.y) / (0.7 * uScale))) * exp(-d / (11. * uScale)) * 0.35;
      col += uStar * (g + rays) * lit;
    } else if (r.w < 2.5) {
      // cursor stardust: a few glints around the spot, gone in about a second
      vec2 c = floor(p / 7.); float hh = h21(c + r.z);
      if (hh > 0.86 && length(p - r.xy) < 34.) {
        vec2 sp = (c + 0.5) * 7.; float d = length(p - sp) * uScale;
        col += uStar * (1. - smoothstep(0.4, 1.3 * uScale, d)) * exp(-age / 0.7) * smoothstep(0., 0.1, age) * (0.4 + 0.6 * fract(hh * 13.));
      }
    } else {
      // a random meteor across the sky
      vec2 dir = normalize(vec2(r.w < 3.5 ? -0.8 : 0.8, 0.5));
      if (age < 1.8) col += vec3(1.0, 0.95, 0.88) * streak(p, r.xy + dir * 900. * age, dir, 260., 1.5) * (1. - smoothstep(1.2, 1.8, age)) * smoothstep(0., 0.15, age);
    }
  }
  vec2 c = dev / uCv - 0.5; col *= 1. - 0.18 * dot(c * vec2(1.6, 1.2), c * vec2(1.6, 1.2));
  col += (h21(dev) - 0.5) / 255.;
  o = vec4(col, 1.);
}`;

// constellations: kind 0 = a line between two stars, kind 1 = a bright star (w = 1.8 x glow radius)
const FS_SEG = `#version 300 es
precision highp float;
in vec2 vL;
in float vLen;
flat in vec4 vA;
flat in vec2 vB;
uniform float uScale, uT, uFade0, uFade1, uLines;
uniform vec3 uStar, uLine;
out vec4 o;
${SEG_GLSL}
void main() {
  float d = segDist(), fade = vA.w < 0.5 ? uFade0 : uFade1;
  if (vB.y < 0.5) {
    float w = vA.x * uScale;
    float a = (1. - smoothstep(w - 0.4, w + 0.8, d)) * vA.y * fade * uLines;
    // lines stop short of the stars they join
    a *= smoothstep(5. * uScale, 10. * uScale, vL.x) * smoothstep(5. * uScale, 10. * uScale, vLen - vL.x);
    o = vec4(uLine * a, 0.);
    return;
  }
  float R = vA.x / 1.8 * uScale, m = vA.y;
  float tw = 0.82 + 0.18 * sin(uT * (0.4 + vB.x * 1.2) + vB.x * 40.);
  float core = exp(-d * d / (2. * pow(0.9 * uScale * (0.8 + 0.4 * m), 2.)));
  float halo = exp(-d / (0.2 * R)) * 0.75 + exp(-d / (0.55 * R)) * 0.2;
  float rays = m > 1.15 ? (exp(-abs(vL.x) / (0.6 * uScale)) + exp(-abs(vL.y) / (0.6 * uScale))) * exp(-d / (0.7 * R)) * 0.3 : 0.;
  vec3 c = mix(uStar, vec3(1.), core * 0.6) * (core + halo + rays) * m * tw * fade;
  o = vec4(c, 0.);
}`;

const cv = document.getElementById('art');
const gl = makeGL(cv);
const PR = program(gl, FULL_VS, FS), U = PR.U;
const PS = program(gl, SEG_VS, FS_SEG), US = PS.U;
const VAO = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, FADE_MS);
const segs = new Segs(gl, 6000);
let W = 1, H = 1, CW = 1, CH = 1, icons = [], first = true, T = 0, nextSlot = 0, wakeSlot = 0, wakeClock = 0, nActive = 0;
let fadeT0 = -1e9, fadeK = 1, meteorAt = 40 + Math.random() * 80;
const R = new Float32Array(NR * 4);
const RA = new Float32Array(NR * 4);
const g2 = [0, 0];

// Bright stars ring each group just outside its outline and are joined to their nearest
// neighbour; some send a short arm out into the sky. Positions come from seeded hashes of the
// spot, so a group that did not move keeps its figure.
function build(s, set) {
  const pts = contourPoints(field, s, 34, 46), stars = [];
  for (const [x, y] of pts) {
    const ix = Math.round(x), iy = Math.round(y);
    field.grad(s, x, y, g2); const gl2 = Math.hypot(g2[0], g2[1]) || 1, gx = g2[0] / gl2, gy = g2[1] / gl2;
    const o = hash(ix, iy, 5) * 46 - 6;
    const sx = x + gx * o + (hash(ix, iy, 6) - 0.5) * 14, sy = y + gy * o + (hash(ix, iy, 7) - 0.5) * 14;
    if (sx < 4 || sy < 4 || sx > W - 4 || sy > H - 4) continue;
    const st = [sx, sy, 0.6 + 0.9 * hash(ix, iy, 8)];
    stars.push(st);
    if (hash(ix, iy, 9) < 0.3) {
      let px = sx, py = sy, prev = st;
      const n = 1 + (hash(ix, iy, 10) * 2 | 0);
      for (let j = 0; j < n; j++) {
        const a = Math.atan2(gy, gx) + (hash(ix, iy, 11 + j) - 0.5) * 1.1, l = 55 + 70 * hash(ix, iy, 13 + j);
        px += Math.cos(a) * l; py += Math.sin(a) * l;
        if (px < 4 || py < 4 || px > W - 4 || py > H - 4) break;
        const ns = [px, py, 0.5 + 0.8 * hash(ix, iy, 15 + j)];
        segs.push(prev[0], prev[1], px, py, 0.5, 0.3, 0, set, 0, 0);
        stars.push(ns); prev = ns;
      }
    }
  }
  const lim = 120 * 120;
  for (let i = 0; i < stars.length; i++) {
    const a = stars[i]; let best = -1, bd = lim;
    for (let j = 0; j < stars.length; j++) {
      if (j === i) continue;
      const b = stars[j], d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    // each pair once: the link from the lower index, or a one-way nearest neighbour
    if (best >= 0) {
      const b = stars[best];
      let back = -1, bb = lim;
      for (let j = 0; j < stars.length; j++) {
        if (j === best) continue;
        const c = stars[j], d = (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2;
        if (d < bb) { bb = d; back = j; }
      }
      if (back !== i || i < best) segs.push(a[0], a[1], b[0], b[1], 0.5, 0.3, 0, set, 0, 0);
    }
  }
  for (const [x, y, m] of stars) segs.push(x, y, x, y, (5 + 9 * m) * 1.8, m, 0, set, hash(Math.round(x), Math.round(y), 21), 1);
}

function layout(instant) {
  const s = field.compute(iconRects(icons), { reach: 10, warp: 14, soft: 40, far: 1300, wobble: 0.15 });
  morph.set(s, instant);
  if (instant) { segs.clear(); build(s, 1); fadeK = 1; fadeT0 = -1e9; }
  else { segs.keepSet(1, 0); build(s, 1); fadeT0 = performance.now(); fadeK = 0; }
  segs.upload();
}
function addSlot(i, x, y, kind) { R[i * 4] = x; R[i * 4 + 1] = y; R[i * 4 + 2] = T; R[i * 4 + 3] = kind; }
function click(x, y) { const i = nextSlot; nextSlot = nextClick(i, P); addSlot(i, x, y, 1); }
function step(dt) {
  T += dt;
  for (let i = 0; i < NR; i++) if (R[i * 4 + 3] > 0 && T - R[i * 4 + 2] > (R[i * 4 + 3] === 1 ? 60 : 3)) R[i * 4 + 3] = 0;
  const lim = Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
  for (let i = lim; i < MAX_CLICKS; i++) R[i * 4 + 3] = 0;
  const pt = page && page.ptr;
  wakeClock -= dt;
  if (pt && pt.in && !pt.icon && Math.hypot(pt.vx, pt.vy) > 120 && wakeClock <= 0) {
    addSlot(MAX_CLICKS + wakeSlot, pt.x, pt.y, 2); wakeSlot = (wakeSlot + 1) % WAKES; wakeClock = 0.12;
  }
  // now and then a meteor crosses the sky
  if (T > meteorAt) {
    meteorAt = T + 45 + Math.random() * 110;
    const left = Math.random() < 0.5;
    addSlot(NR - 1, left ? W * (0.55 + 0.4 * Math.random()) : W * (0.05 + 0.4 * Math.random()), H * 0.25 * Math.random(), left ? 3 : 4);
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
  fadeK = easeInOut(clamp((now - fadeT0) / FADE_MS, 0, 1));
  gl.viewport(0, 0, CW, CH);
  gl.useProgram(PR.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, morph.tex[0]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, morph.tex[1]);
  gl.uniform1i(U.uF0, 0); gl.uniform1i(U.uF1, 1); gl.uniform1f(U.uK, morph.k);
  gl.uniform2f(U.uGrid, field.Gw, field.Gh); gl.uniform2f(U.uCv, CW, CH); gl.uniform1f(U.uScale, CW / W);
  gl.uniform1f(U.uT, T); gl.uniform1f(U.uNeb, P.nebula); gl.uniform1f(U.uDens, P.stars); gl.uniform1i(U.uN, nActive);
  gl.uniform3fv(U.uS0, pal[0]); gl.uniform3fv(U.uS1, pal[1]); gl.uniform3fv(U.uNa, pal[2]); gl.uniform3fv(U.uNb, pal[3]); gl.uniform3fv(U.uStar, pal[4]);
  gl.uniform4fv(U.uR, RA);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
  // constellations on top, added light
  gl.useProgram(PS.p);
  gl.uniform2f(US.uCv, CW, CH); gl.uniform1f(US.uScale, CW / W); gl.uniform1f(US.uPad, 1);
  gl.uniform1f(US.uT, T); gl.uniform1f(US.uFade0, 1 - fadeK); gl.uniform1f(US.uFade1, fadeK); gl.uniform1f(US.uLines, P.lines);
  gl.uniform3fv(US.uStar, pal[4]); gl.uniform3fv(US.uLine, pal[5]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  segs.draw();
  gl.disable(gl.BLEND);
}

const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['nebula', 'stars', 'lines', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc();
    if (icons.length) layout(true);
  },
  icons(list) { icons = list; layout(first); first = false; },
  settings() {},
  reseed() { field.reseed(); layout(true); },
  step, draw, click,
  stats: () => `stars ${segs.n} · ${nActive}`,
});
window.__dbg = { P, click, setT(t) { T = t; }, meteor() { meteorAt = T; } };
