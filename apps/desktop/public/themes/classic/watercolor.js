// DeskWall · Watercolor ("Акварель").
// Watercolour on cold-press paper. Pigment washes bloom out of the icons; all icons share one wet
// shape, so a row or a column makes a single wash. What makes it read as real paint:
//  - paper: a baked relief (bumps and pits, lit from the upper left) that pigment settles into, so
//    colour is denser in the valleys (granulation) and the white paper shows through on the peaks;
//  - three transparent glazes that add up as absorption (Beer-Lambert), never as multiplied colours,
//    so overlaps deepen instead of going muddy, and the pigment ramp only mixes neighbouring hues;
//  - wet-in-wet edges that bleed softly in some places and stay hard and darkened (pooled pigment)
//    in others, dry-brush breakup on the outer edge, backruns (cauliflower blooms) and brush flow;
//  - drops from clicks: wet and dark at first, then they dry lighter and their rim sharpens.
// Cursor: moving over bare paper leaves small wet dabs. One full-screen pass over a field computed
// on the CPU only when the icons change (kit.js Field + Morph); the paper relief is baked once per
// resize into a texture, so a frame costs a few texture reads, and far from the wash it is paper only.
import { MAX_CLICKS, nextClick, clamp, Field, Morph, iconRects, FULL_VS, NOISE_GLSL, makeGL, program, runPage, STEP } from './kit.js';

const P = { spread: 1, depth: 1, palette: 0, clicks: 16, cap30: true };
const DEFAULTS = { ...P };
// per palette: three neighbouring pigments (colour at unit density), paper tint
const PALETTES = [
  [[0.1, 0.5, 0.58], [0.2, 0.36, 0.74], [0.3, 0.64, 0.46], [0.968, 0.952, 0.915]],   // sea
  [[0.86, 0.3, 0.42], [0.94, 0.46, 0.32], [0.95, 0.68, 0.28], [0.972, 0.948, 0.912]], // blossom
  [[0.42, 0.3, 0.72], [0.2, 0.38, 0.76], [0.84, 0.34, 0.6], [0.96, 0.95, 0.93]],      // dusk
  [[0.32, 0.64, 0.3], [0.66, 0.74, 0.22], [0.14, 0.54, 0.5], [0.965, 0.955, 0.91]],   // meadow
];
const WAKES = 8, NR = MAX_CLICKS + WAKES;

// Paper relief, baked once per resize: r = height, g = light from the upper left (0.5 = flat).
const PAPER_FS = `#version 300 es
precision highp float;
uniform vec2 uCv;
uniform float uScale;
out vec4 o;
${NOISE_GLSL}
float ph(vec2 p) {
  float a = vn(p * 0.55 + 11.) * 0.42 + vn(p * 1.3 + 4.) * 0.3 + vn(p * 3.1 + 21.) * 0.16;
  vec3 c = cells(p * 0.36);
  float fib = vn(vec2(dot(p, vec2(0.8, 0.6)) * 0.5, dot(p, vec2(-0.6, 0.8)) * 0.035) + 31.);
  return clamp(a * 0.62 + (1. - c.x) * 0.34 + fib * 0.1 + (fbm3(p * 0.018) - 0.5) * 0.12 - 0.08, 0., 1.);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y) / uScale;
  float e = 0.9 / uScale, h0 = ph(p), hx = ph(p + vec2(e, 0.)), hy = ph(p + vec2(0., e));
  float sh = ((hx - h0) + (hy - h0)) * 0.7 / e;
  o = vec4(h0, clamp(0.5 + sh * 0.22, 0., 1.), 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uF0, uF1, uPaper;
uniform float uK, uScale, uT, uSpread, uDepth, uH;
uniform int uN;
uniform vec2 uCv, uGrid;
uniform vec3 uP0, uP1, uP2, uPaper3;
uniform vec4 uR[${NR}];           // live drops and dabs: x, y, birth time, strength
out vec4 o;
${NOISE_GLSL}
float fld(vec2 p) {
  vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid;
  return mix(texture(uF0, uv).r, texture(uF1, uv).r, uK);
}
// pigment colour at unit density, and how strongly it granulates (the middle pigment settles most)
vec3 pigment(vec2 p, float k, out float gr) {
  float u = clamp(fbm3(p * 0.0016 + 4.7 + k) * 1.5 - 0.2 + (p.y / uH - 0.5) * 0.5, 0., 1.);
  gr = 0.45 + 0.55 * (1. - abs(2. * u - 1.));
  return u < 0.5 ? mix(uP0, uP1, u * 2.) : mix(uP1, uP2, u * 2. - 1.);
}
// one glaze: coverage inside the wet edge (paper relief breaks the edge up), and a pooled rim
vec2 glaze(float sw, float soft, float rimw, float h, float dry) {
  float v = sw + (h - 0.5) * dry;
  float inside = 1. - smoothstep(-soft, soft, v);
  float rim = exp(-pow((v + rimw * 0.9) / rimw, 2.)) * smoothstep(soft * 0.6, -rimw, v);
  return vec2(inside, rim);
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  vec4 pp = texture(uPaper, gl_FragCoord.xy / uCv);
  float h = pp.r, relief = (pp.g - 0.5) * 4.;
  float s = fld(p);
  float tw = uT * 0.01;
  float sp = 125. * uSpread;
  float D = 0.;                    // pigment density of the washes
  float gr = 0.7;
  vec3 pig = pigment(p, 0., gr);
  if (s - sp < 150.) {
    // hand wobble of the three edges, each with its own noise so the glazes do not run parallel
    float nA = (fbm3(p * 0.0085 + vec2(1.3, 2.1) + tw) - 0.5) * 150. + (vn(p * 0.045 + 5.) - 0.5) * 9.;
    float nB = (fbm3(p * 0.0105 + vec2(7.7, 3.3) - tw) - 0.5) * 80. + (vn(p * 0.06 + 9.) - 0.5) * 7.;
    float nC = (fbm3(p * 0.013 + vec2(4.2, 8.8) + tw) - 0.5) * 50. + (vn(p * 0.07 + 2.) - 0.5) * 5.;
    // wet-in-wet where the paper was wet (soft bleeding edges), hard wet-on-dry elsewhere
    float w = smoothstep(0.4, 0.62, fbm3(p * 0.0034 + vec2(9., 2.)));
    vec2 gA = glaze(s - sp + nA, mix(3., 36., w), mix(5., 14., w), h, 22.);
    vec2 gB = glaze(s - sp * 0.45 + nB, mix(2.4, 10., w * 0.6), mix(3.6, 8., w), h, 9.);
    vec2 gC = glaze(s + 4. + nC, 2.2, 3., h, 4.);
    // backruns: lobed pale patches with a pooled dark outline where water pushed pigment away
    vec2 wp = p + 45. * vec2(vn(p * 0.011) - 0.5, vn(p * 0.011 + 5.) - 0.5);
    float bf = fbm3(wp * 0.0062 + 3.1);
    float bIn = smoothstep(0.625, 0.65, bf), bRing = exp(-pow((bf - 0.64) / 0.01, 2.));
    // brush flow: faint streaks along one direction; flocculation: fine uneven pigment
    float flow = 0.92 + 0.16 * vn(vec2(dot(p, vec2(0.94, -0.34)) * 0.011, dot(p, vec2(0.34, 0.94)) * 0.17));
    float floc = 0.94 + 0.12 * vn(p * 0.16 + 8.);
    // pigment settles into the paper valleys: dense in the pits, thin on the peaks
    float G = clamp(1. + gr * (0.5 - h) * 2.3, 0.2, 2.), g2 = clamp(1. + 0.4 * (0.5 - h) * 2.4, 0.5, 1.5);
    float body = flow * floc * (1. - 0.3 * bIn * (gA.x + gB.x)) * G;
    float da = gA.x * 0.15 + gA.y * 0.12 * (1. - 0.7 * w) + bRing * 0.09 * gA.x;
    float db = gB.x * 0.13 + gB.y * 0.14 + bRing * 0.05 * gB.x;
    float dc = gC.x * 0.1 + gC.y * 0.07;
    D = (da + db) * body + dc * flow * g2;
    // a little paper white speckle where the glaze is thin
    D *= 1. - 0.5 * (1. - smoothstep(0., 0.2, D)) * smoothstep(0.58, 0.8, h);
  }
  D *= uDepth;
  vec3 col = uPaper3 + (fbm3(p * 0.9) - 0.5) * 0.02 + (h21(dev) - 0.5) * 0.008;
  col *= pow(pig, vec3(min(D, 2.2)));
  // drops from clicks and dabs from the cursor: wet and dark at first, dry and lighter later
  for (int i = 0; i < ${NR}; i++) {
    if (i >= uN) break;
    vec4 r = uR[i];
    float age = uT - r.z, big = step(0.2, r.w);
    float dry = smoothstep(0., mix(3., 7., big), age);
    float rad = mix(13., 95., big) * (1. - exp(-age * mix(1.8, 0.9, big)));
    float d = length(p - r.xy) + (fbm3(p * 0.04 + r.z) - 0.5) * rad * 0.3 + (h - 0.5) * 6.;
    float soft = mix(mix(9., 24., big), 2.6, dry);
    float ins = 1. - smoothstep(rad - soft, rad + soft * 0.6, d);
    float rim = exp(-pow((d - rad + 4.) / mix(7., 3.4, dry), 2.)) * smoothstep(rad + 2., rad - 3., d) * (0.3 + 0.7 * dry);
    float back = big * smoothstep(1.5, 5., age) * exp(-pow((d - rad * 0.55) / (6. + 0.04 * rad), 2.)) * 0.5;
    float heart = 1. - 0.4 * big * (1. - smoothstep(0., rad, d));
    float life = exp(-age / mix(5., 10., big)) * (1. - smoothstep(18., 30., age)) * smoothstep(0., 0.25, age);
    float G2 = clamp(1. + 0.7 * (0.5 - h) * 3., 0.3, 1.8);
    float k = mix(1.3, 1., dry);
    float dd = (ins * 0.2 * heart * k + rim * 0.2 + back * 0.08) * life * mix(1., 1.3, big) * G2 * uDepth;
    float gq;
    col *= pow(pigment(r.xy, fract(r.z * 3.7) * 6., gq), vec3(min(dd, 1.6)));
  }
  // paper relief lights the finished picture (pigment sits in the valleys, so shade stays visible)
  col *= 1. + relief * 0.1;
  // faint wet sheen drifting over the wash
  col += vec3(1., 0.99, 0.95) * 0.03 * min(D, 1.) * smoothstep(0.6, 1., sin(p.x * 0.004 + p.y * 0.0028 - uT * 0.05) * 0.5 + 0.5);
  vec2 c = dev / uCv - 0.5; col *= 1. - 0.05 * dot(c * vec2(1.6, 1.2), c * vec2(1.6, 1.2));
  o = vec4(col, 1.);
}`;

const cv = document.getElementById('art');
const gl = makeGL(cv);
const PR = program(gl, FULL_VS, FS), U = PR.U;
const PB = program(gl, FULL_VS, PAPER_FS);
const paperTex = gl.createTexture(), paperFb = gl.createFramebuffer();
const VAO = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2800);
let W = 1, H = 1, CW = 1, CH = 1, icons = [], first = true, T = 0, nextSlot = 0, wakeSlot = 0, wakeClock = 0, nActive = 0;
const R = new Float32Array(NR * 4);
const RA = new Float32Array(NR * 4);   // R compacted to the live slots, what the shader reads


// Render the paper relief once into a texture the size of the canvas (on resize only).
function bakePaper() {
  gl.bindTexture(gl.TEXTURE_2D, paperTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, CW, CH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, paperFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, paperTex, 0);
  gl.viewport(0, 0, CW, CH);
  gl.useProgram(PB.p);
  gl.uniform2f(PB.U.uCv, CW, CH); gl.uniform1f(PB.U.uScale, CW / W);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

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
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(U.uPaper, 2);
  gl.uniform1i(U.uF0, 0); gl.uniform1i(U.uF1, 1); gl.uniform1f(U.uK, morph.k);
  gl.uniform2f(U.uGrid, field.Gw, field.Gh); gl.uniform2f(U.uCv, CW, CH); gl.uniform1f(U.uScale, CW / W);
  gl.uniform1f(U.uT, T); gl.uniform1f(U.uSpread, P.spread); gl.uniform1f(U.uDepth, P.depth);
  gl.uniform1f(U.uH, H); gl.uniform1i(U.uN, nActive);
  gl.uniform3fv(U.uP0, pal[0]); gl.uniform3fv(U.uP1, pal[1]); gl.uniform3fv(U.uP2, pal[2]); gl.uniform3fv(U.uPaper3, pal[3]);
  gl.uniform4fv(U.uR, RA);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
}

const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['spread', 'depth', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc(); bakePaper();
    if (icons.length) { const f = first; first = true; layout(); first = f; }
  },
  icons(list) { icons = list; layout(); first = false; },
  settings() {},
  reseed() { field.reseed(); layout(); },
  step, draw, click,
  stats: () => `watercolor ${nActive}`,
});
window.__dbg = { P, click, setT(t) { T = t; } };
