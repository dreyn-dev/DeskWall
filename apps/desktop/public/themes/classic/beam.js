// DeskWall · Light Beam ("Луч").
// A dark room full of thin haze. Every icon throws a soft beam of light into it, toward the open
// middle of the screen; a row or a column of icons throws parallel beams that read as one wide
// shaft. The light splits a little at the edges (rainbow fringes, white where beams overlap) and
// ends in a soft rainbow pool. The middle of the screen stays dark and empty.
// Motion: the haze drifts slowly through the still beams, dust specks float and glint inside them.
// Cursor: moving through a beam stirs the haze. Click: a flash of light runs out through the haze.
// Dragging an icon leaves a faint stirred, lit trail.
// Cost: the beams themselves are baked on the GPU only when icons or settings change (half
// resolution); every frame is a quarter-resolution haze pass plus one full-screen composite.
// No per-frame allocations.
import { MAX_CLICKS, nextClick, clamp, Field, CapMask, FULL_VS, makeGL, program, runPage, STEP } from './kit.js';

// palette: 0 = prism (each group its own light), 1 = warm lamps, 2 = moonlight
// Every setting is 1 at the look Mark approved on his PC (2026-11-23): long beams, plain white
// light, dim, plenty of dust. The shader works in its own units (BASE times the setting).
const P = { reach: 1, prism: 0, light: 1, specks: 1, palette: 0, clicks: 16, cap30: true };
const BASE = { reach: 1.6, prism: 0.4, light: 0.4, specks: 2 };
const DEFAULTS = { ...P };
const PALETTES = [
  [[1, 0.93, 0.82], [1, 0.8, 0.55], [0.7, 0.85, 1], [1, 0.75, 0.8]],
  [[1, 0.9, 0.76], [1, 0.82, 0.6], [1, 0.87, 0.7], [1, 0.78, 0.56]],
  [[0.72, 0.85, 1], [0.8, 0.9, 1], [0.68, 0.8, 1], [0.86, 0.92, 1]],
];
const WAKES = 10;
const BAKE = 0.5, HAZE = 0.25;   // bake and haze resolution, per CSS pixel

const COMMON = `#version 300 es
precision highp float;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.; a *= .5; } return s; }
`;

// Beams, baked on layout. Per icon (texel i of uIc): origin x, y (CSS px), beam angle, tint index.
// Out A: beam light per channel (already through 1 - exp), how much beam is there at all (dust mask).
// Out B: static extra light (rainbow pool and the warm glow at the icon, halved), thin crisp rays.
const BAKE_FS = COMMON + `
uniform sampler2D uIc;
uniform int uN;
uniform float uBS, uSc, uLen, uRain;
uniform vec3 uTint[4];
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
void main() {
  vec2 q = gl_FragCoord.xy / uBS;
  vec3 acc = vec3(0.), pl = vec3(0.);
  float dacc = 0., ray = 0., glow = 0.;
  float cut0 = 430. * uLen, cut1 = 720. * uLen, fall = 260. * uLen, D = 400. * uLen;
  for (int i = 0; i < 1024; i++) {
    if (i >= uN) break;
    vec4 ic = texelFetch(uIc, ivec2(i, 0), 0);
    vec2 d = (q - ic.xy) / uSc;
    glow += exp(-dot(d, d) / (55. * 55.));
    vec2 L = vec2(cos(ic.z), sin(ic.z)), Pp = vec2(-L.y, L.x);
    float al = dot(d, L);
    if (al < -40. || al > cut1) continue;
    float pp = dot(d, Pp), wd = 16. + al * .11, dl = al * .08 * uRain;
    if (abs(pp) > wd * 3.5 + dl * 2.) continue;
    float fi = float(i);
    float on = smoothstep(10., 90., al) * exp(-al / fall) * (1. - smoothstep(cut0, cut1, al));
    vec3 x = vec3(pp + dl, pp, pp - dl) / wd;   // shifted per channel: rainbow fringes, white overlap
    float st = .45 + .75 * vn(vec2(al * .006, pp / wd * 3. + fi * 7.)) * vn(vec2(al * .002, pp / wd * 1.3 + fi * 3.) + .5);
    vec3 tint = uTint[int(ic.w) & 3];
    acc += exp(-x * x) * on * st * tint;
    dacc += exp(-pp * pp / (wd * wd)) * on;
    float rv = vn(vec2(al * .0012 + fi, pp / wd * 7. + fi * 13.));
    ray += smoothstep(.72, .97, rv) * exp(-pp * pp / (wd * wd * .8)) * on * smoothstep(40., 160., al) * tint.r;
    vec3 xa = (vec3(al - D) + vec3(-40., 0., 40.) * uRain) / 120.;
    vec3 xp = vec3(pp + dl * 1.6, pp, pp - dl * 1.6) / (wd * 1.15);
    pl += exp(-xa * xa - xp * xp) * (.85 + .3 * vn(q * .015 + fi));
  }
  vec3 dens = 1. - exp(-acc * 1.6);
  vec3 pool = 1. - exp(-pl * 1.1);
  pool -= min(pool.r, min(pool.g, pool.b)) * .35;
  pool *= .35 + .65 * min(uRain, 1.);
  vec3 stat = pool * .22 + vec3(1., .86, .64) * glow * .06;
  oA = vec4(dens, min(dacc, 1.));
  oB = vec4(clamp(stat * 2., 0., 1.), min(ray, 1.2) / 1.2);
}`;

// Haze, every frame at quarter resolution: r = haze, g = wisps, b = click flash and drag glow,
// a = stirred haze (cursor). The cursor wakes twist the haze lookup around them.
const HAZE_FS = COMMON + `
uniform float uHS, uT;
uniform int uNW, uNC;
uniform vec4 uW[${WAKES}];          // wakes: x, y, birth, strength (< 0: a dragged icon)
uniform vec4 uC[${MAX_CLICKS}];     // clicks: x, y, birth, strength
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy / uHS;
  float stir = 0., drag = 0.;
  for (int i = 0; i < ${WAKES}; i++) {
    if (i >= uNW) break;
    vec4 w = uW[i];
    vec2 v = p - w.xy;
    float age = uT - w.z, s = abs(w.w) * exp(-age / 1.8) * exp(-dot(v, v) / (80. * 80.));
    float a = s * 3. * (mod(float(i), 2.) < 1. ? 1. : -1.), c = cos(a), sn = sin(a);
    p = w.xy + vec2(c * v.x - sn * v.y, sn * v.x + c * v.y);
    stir += s;
    if (w.w < 0.) drag += s;
  }
  float flash = 0.;
  for (int i = 0; i < ${MAX_CLICKS}; i++) {
    if (i >= uNC) break;
    vec4 c = uC[i];
    float age = uT - c.z, x = length(p - c.xy) - age * 300.;
    flash += c.w * exp(-x * x / (45. * 45.)) * exp(-age / 1.3) * smoothstep(0., .08, age);
  }
  vec2 dr = vec2(fbm(p * .0012 + vec2(3., 1.) + uT * .004), fbm(p * .0012 + vec2(8., 4.) - uT * .003));
  float haze = fbm((p - uT * vec2(9., -2.)) * .004 + dr * 2.);
  float wisp = fbm(vec2((p.x - uT * 14.) * .009, p.y * .02) + dr * 3. + uT * .01);
  o = vec4(haze, wisp, clamp(flash + drag * 1.3, 0., 1.), clamp(stir, 0., 1.));
}`;

const FS = COMMON + `
uniform sampler2D uA0, uB0, uA1, uB1, uHz, uCap;
uniform float uK, uScale, uT, uGlow, uDust;
uniform vec2 uCv, uWH, uBk, uHw, uGrid;
out vec4 o;
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  vec2 bu = p * ${BAKE} / uBk;
  vec4 A = mix(texture(uA0, bu), texture(uA1, bu), uK), B = mix(texture(uB0, bu), texture(uB1, bu), uK);
  vec4 Hz = texture(uHz, p * ${HAZE} / uHw);
  float veil = texture(uCap, (p / ${STEP.toFixed(1)} + .5) / uGrid).r;
  vec3 dens = A.rgb;
  float hz = .75 + .4 * Hz.r + .25 * (Hz.g - .5);
  vec3 c = mix(vec3(.05, .068, .105), vec3(.028, .032, .05), p.y / uWH.y);
  c += dens * hz * .6 * uGlow * (1. - .45 * veil) + dens * .08 * uGlow;
  c += B.rgb * .5 * (.8 + .4 * Hz.r);
  c += vec3(1., .96, .88) * B.a * 1.2 * .16 * uGlow * (1. - .5 * veil);
  // dust: specks drift through the room and glint only where a beam catches them
  vec2 pd = p + uT * vec2(5., -3.), cell = floor(pd / 6.);
  float spk = step(.9, h(cell + 3.)) * smoothstep(1.2, 0., length(mod(pd, 6.) - h2(cell) * 6.)) * (.4 + .6 * h(cell + 9.));
  spk *= .55 + .45 * sin(uT * (.7 + 1.6 * h(cell + 5.)) + h(cell + 1.) * 6.28);
  c += vec3(1., .97, .9) * spk * A.a * (.5 + .8 * Hz.g) * .55 * uDust * (1. + Hz.a);
  // stirred haze lights up inside the beams; a click flash shows mostly in them, faintly elsewhere
  c += dens * Hz.a * .7 * uGlow;
  c += (dens * 1.4 + vec3(.085, .078, .066) * (.2 + 1.5 * Hz.r * Hz.g)) * Hz.b * (1. - .5 * veil);
  c += vec3(.015, .02, .035) * (Hz.r - .5);
  vec2 v = (p - uWH * .5) / (uWH * vec2(.586, .625));
  c *= 1. - .28 * dot(v, v);
  c += (h(gl_FragCoord.xy) - .5) / 255.;
  o = vec4(c, 1.);
}`;

const cv = document.getElementById('art');
const gl = makeGL(cv);
const bakePR = program(gl, FULL_VS, BAKE_FS), hazePR = program(gl, FULL_VS, HAZE_FS), PR = program(gl, FULL_VS, FS);
const VAO = gl.createVertexArray();
const field = new Field();           // only for the caption mask grid
const cap = new CapMask(gl, field);
let W = 1, H = 1, CW = 1, CH = 1, BW = 1, BH = 1, HW = 1, HH = 1, icons = [], first = true, T = 0;
let cur = 0, fadeT0 = -1e9, K = 1, nW = 0, nC = 0, clickSlot = 0, wakeSlot = 0, wakeClock = 0, wakeSign = 1, nIc = 0;
const Wk = new Float32Array(WAKES * 4), Wa = new Float32Array(WAKES * 4);
const Ck = new Float32Array(MAX_CLICKS * 4), Ca = new Float32Array(MAX_CLICKS * 4);
const tint = new Float32Array(12);

function tex(w, h, fmt = gl.RGBA8) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return t;
}
const icTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, icTex);
for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
let icBuf = new Float32Array(4);
// two baked layouts (old and new, crossfaded) and the haze target, with their framebuffers
let sets = [], hazeTex = null, hazeFB = null;
function alloc() {
  for (const s of sets) { gl.deleteTexture(s.A); gl.deleteTexture(s.B); gl.deleteFramebuffer(s.fb); }
  if (hazeTex) { gl.deleteTexture(hazeTex); gl.deleteFramebuffer(hazeFB); }
  BW = Math.max(1, Math.ceil(W * BAKE)); BH = Math.max(1, Math.ceil(H * BAKE));
  HW = Math.max(1, Math.ceil(W * HAZE)); HH = Math.max(1, Math.ceil(H * HAZE));
  sets = [0, 1].map(() => {
    const A = tex(BW, BH), B = tex(BW, BH), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, A, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, B, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    return { A, B, fb };
  });
  hazeTex = tex(HW, HH); hazeFB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, hazeFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hazeTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Beam directions: icons that touch form a group (a row, a column, a block); the whole group
// shines toward the open middle of the screen, tilted a little downward, with a slight fan.
function beams() {
  const n = icons.length, par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const root = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const cx = i => icons[i].x + icons[i].w / 2, cy = i => icons[i].y + Math.min(30, icons[i].h * 0.33);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = icons[i], b = icons[j];
    if (Math.abs(cx(i) - cx(j)) < (a.w + b.w) * 0.8 && Math.abs(cy(i) - cy(j)) < (a.h + b.h) * 0.8) par[root(i)] = root(j);
  }
  const g = new Map();
  for (let i = 0; i < n; i++) {
    const r = root(i), e = g.get(r) || { x: 0, y: 0, n: 0, id: g.size };
    e.x += cx(i); e.y += cy(i); e.n++; g.set(r, e);
  }
  if (icBuf.length < n * 4) icBuf = new Float32Array(Math.max(4, n * 4));
  for (let i = 0; i < n; i++) {
    const e = g.get(root(i)), gx = e.x / e.n, gy = e.y / e.n;
    let dx = (W / 2 - gx) / W, dy = 0.6 * (H / 2 - gy) / H + 0.3 * Math.abs((W / 2 - gx) / W);
    if (Math.hypot(dx, dy) < 0.05) { dx = 1; dy = 0.55; }
    if (Math.abs(dx) >= Math.abs(dy)) dy = clamp(dy, -0.55 * Math.abs(dx), 0.55 * Math.abs(dx));
    else dx = clamp(dx, -0.6 * Math.abs(dy), 0.6 * Math.abs(dy));
    let a = Math.atan2(dy, dx);
    // slight fan: icons off the group centre lean outward, so a long row spreads a little
    const off = (cx(i) - gx) * -Math.sin(a) + (cy(i) - gy) * Math.cos(a);
    a += clamp(off * 0.00025, -0.12, 0.12);
    icBuf[i * 4] = cx(i); icBuf[i * 4 + 1] = cy(i); icBuf[i * 4 + 2] = a; icBuf[i * 4 + 3] = e.id & 3;
  }
  nIc = n;
  gl.bindTexture(gl.TEXTURE_2D, icTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, Math.max(1, n), 1, 0, gl.RGBA, gl.FLOAT, n ? icBuf.subarray(0, n * 4) : new Float32Array(4));
}
function updateTint() {
  const pal = PALETTES[clamp(P.palette | 0, 0, PALETTES.length - 1)];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) tint[i * 3 + k] = pal[i][k];
}
function bake(instant) {
  beams();
  const s = instant ? cur : 1 - cur;
  gl.bindFramebuffer(gl.FRAMEBUFFER, sets[s].fb);
  gl.viewport(0, 0, BW, BH);
  gl.useProgram(bakePR.p);
  const U = bakePR.U;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, icTex); gl.uniform1i(U.uIc, 0);
  gl.uniform1i(U.uN, nIc); gl.uniform1f(U.uBS, BAKE);
  gl.uniform1f(U.uSc, clamp(Math.min(W / 2560, H / 1440), 0.45, 1.6));
  gl.uniform1f(U.uLen, BASE.reach * P.reach); gl.uniform1f(U.uRain, BASE.prism * P.prism); gl.uniform3fv(U.uTint, tint);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (instant) { K = 1; fadeT0 = -1e9; }
  else { cur = s; fadeT0 = performance.now(); K = 0; }
}
function layout(instant) {
  bake(instant);
  cap.bake(icons);
}

function click(x, y) {
  const i = clickSlot; clickSlot = nextClick(i, P);
  Ck[i * 4] = x; Ck[i * 4 + 1] = y; Ck[i * 4 + 2] = T; Ck[i * 4 + 3] = 0.8;
}
function step(dt) {
  T += dt;
  const lim = Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
  for (let i = 0; i < MAX_CLICKS; i++) if (Ck[i * 4 + 3] > 0 && (i >= lim || T - Ck[i * 4 + 2] > 5)) Ck[i * 4 + 3] = 0;
  for (let i = 0; i < WAKES; i++) if (Wk[i * 4 + 3] !== 0 && T - Wk[i * 4 + 2] > 6) Wk[i * 4 + 3] = 0;
  const pt = page && page.ptr;
  wakeClock -= dt;
  if (pt && pt.in && (!pt.icon || pt.drag)) {
    const sp = Math.hypot(pt.vx, pt.vy);
    if ((sp > 60 || (pt.drag && sp > 15)) && wakeClock <= 0) {
      const i = wakeSlot; wakeSlot = (wakeSlot + 1) % WAKES; wakeClock = 0.14;
      // alternate the twist so a path leaves a pair of counter-turning swirls
      wakeSign = -wakeSign;
      const s = 0.25 + 0.45 * clamp(sp / 900, 0, 1);
      Wk[i * 4] = pt.x; Wk[i * 4 + 1] = pt.y; Wk[i * 4 + 2] = T; Wk[i * 4 + 3] = pt.drag ? -s : s;
    }
  }
  // compact the live slots so the haze pass loops over them only; even slots twist one way
  nW = 0;
  for (let i = 0; i < WAKES; i++) {
    if (Wk[i * 4 + 3] === 0) continue;
    const o = nW++ * 4;
    Wa[o] = Wk[i * 4]; Wa[o + 1] = Wk[i * 4 + 1]; Wa[o + 2] = Wk[i * 4 + 2]; Wa[o + 3] = Wk[i * 4 + 3];
  }
  nC = 0;
  for (let i = 0; i < MAX_CLICKS; i++) {
    if (Ck[i * 4 + 3] <= 0) continue;
    const o = nC++ * 4;
    Ca[o] = Ck[i * 4]; Ca[o + 1] = Ck[i * 4 + 1]; Ca[o + 2] = Ck[i * 4 + 2]; Ca[o + 3] = Ck[i * 4 + 3];
  }
}
function draw(now) {
  const e = clamp((now - fadeT0) / 2400, 0, 1);
  K = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
  // haze
  gl.bindFramebuffer(gl.FRAMEBUFFER, hazeFB);
  gl.viewport(0, 0, HW, HH);
  gl.useProgram(hazePR.p);
  let U = hazePR.U;
  gl.uniform1f(U.uHS, HAZE); gl.uniform1f(U.uT, T);
  gl.uniform1i(U.uNW, nW); gl.uniform1i(U.uNC, nC);
  gl.uniform4fv(U.uW, Wa); gl.uniform4fv(U.uC, Ca);
  gl.bindVertexArray(VAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // composite
  gl.viewport(0, 0, CW, CH);
  gl.useProgram(PR.p);
  U = PR.U;
  const old = sets[1 - cur], nw = sets[cur];
  const bind = (unit, t, u) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u, unit); };
  bind(0, old.A, U.uA0); bind(1, old.B, U.uB0); bind(2, nw.A, U.uA1); bind(3, nw.B, U.uB1);
  bind(4, hazeTex, U.uHz);
  cap.bind(5); gl.uniform1i(U.uCap, 5);
  gl.uniform1f(U.uK, K); gl.uniform1f(U.uScale, CW / W); gl.uniform1f(U.uT, T);
  gl.uniform1f(U.uGlow, BASE.light * P.light); gl.uniform1f(U.uDust, BASE.specks * P.specks);
  gl.uniform2f(U.uCv, CW, CH); gl.uniform2f(U.uWH, W, H); gl.uniform2f(U.uBk, BW, BH); gl.uniform2f(U.uHw, HW, HH);
  gl.uniform2f(U.uGrid, field.Gw, field.Gh);
  gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
}

updateTint();
const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['reach', 'prism', 'light', 'specks', 'palette', 'clicks'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); cap.alloc(); alloc();
    layout(true);
  },
  icons(list) { icons = list; layout(first); first = false; },
  settings(keys) {
    if (keys.includes('palette')) updateTint();
    if (keys.some(k => k === 'reach' || k === 'prism' || k === 'palette')) layout(false);
  },
  reseed() {},
  step, draw, click,
  stats: () => `beams ${nIc} · wakes ${nW} · flashes ${nC}`,
});
window.__dbg = { P, click };
