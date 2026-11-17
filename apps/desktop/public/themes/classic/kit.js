// DeskWall · classic theme kit.
// Shared, DeskWall-own building blocks for the self-contained theme pages (Beach, Meadow):
// parameters and hosted-mode protocol, seeded noise, the icon field (smooth union of rounded
// icon boxes, so icons in a row or column grow one continuous shape), time-of-day light, one
// wind for the whole scene, a WebGL2 sprite batch with soft shadows, and the frame loop.
'use strict';

/* ======================================================================
   Page mode and small math
   ====================================================================== */
export const QS = new URLSearchParams(location.search);
export const WALL = QS.has('wallpaper');
export const PREVIEW = QS.has('preview');
export const TAU = Math.PI * 2;
/**
 * Click marks (rings, raked circles, waves, pokes) that can be on screen at once. Every theme
 * takes the count from the shared `clicks` setting (themes.ts `clickParams`), and sizes its
 * shader arrays to MAX_CLICKS. Mark (2026-11-16): never hard-lock this in a theme.
 */
export const MAX_CLICKS = 32;
export const nextClick = (i, P) => (i + 1) % Math.max(1, Math.min(MAX_CLICKS, P.clicks | 0));
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeInOut = e => (e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2);
/** Spring-like overshoot for growing things: 0 → 1 with a small bounce. */
export const easeBack = e => { const c = 1.9; e = clamp(e, 0, 1) - 1; return 1 + (c + 1) * e * e * e + c * e * e; };

/* ======================================================================
   Seeded random and value noise (CPU)
   ====================================================================== */
export const RNG = { seed: QS.has('seed') ? +QS.get('seed') : (Math.random() * 1e6) | 0 };
export function hash(x, y, k = 0) {
  let h = (x | 0) * 0x27d4eb2d ^ (y | 0) * 0x165667b1 ^ (RNG.seed + k * 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
export function noise(x, y, k = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(ix, iy, k), b = hash(ix + 1, iy, k), c = hash(ix, iy + 1, k), d = hash(ix + 1, iy + 1, k);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}
export function fbm(x, y, k = 0, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x, y, k + i * 31); n += a; x = x * 2.07 + 5.3; y = y * 2.07 - 3.1; a *= 0.5; }
  return s / n;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x9e3779b9) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 16), 0x21f0aaad); t = Math.imul(t ^ (t >>> 15), 0x735a2d97); return ((t ^ (t >>> 15)) >>> 0) / 4294967296; };
}

/* ======================================================================
   Icon field.
   Every icon is a rounded box. The field value is a smooth minimum of the distances to all
   boxes (log-sum-exp, so neighbours melt together), measured in a gently warped plane so the
   outline is organic, minus the reach. s < 0 inside the shape (land, cloud), s > 0 outside, in
   CSS pixels. Computed on the CPU only when icons or the reach change.
   ====================================================================== */
export const STEP = 5;
export class Field {
  constructor() { this.Gw = 1; this.Gh = 1; this.wx = null; this.wy = null; this.wn = null; }
  resize(W, H) {
    this.Gw = Math.ceil(W / STEP) + 2; this.Gh = Math.ceil(H / STEP) + 2;
    const N = this.Gw * this.Gh;
    this.wx = new Float32Array(N); this.wy = new Float32Array(N); this.wn = new Float32Array(N);
    this.reseed();
  }
  reseed() {
    const { Gw, Gh } = this;
    for (let gy = 0; gy < Gh; gy++) for (let gx = 0; gx < Gw; gx++) {
      const i = gy * Gw + gx, x = gx * STEP, y = gy * STEP;
      this.wx[i] = fbm(x * 0.0037, y * 0.0037, 11) * 2 - 1;
      this.wy[i] = fbm(x * 0.0037, y * 0.0037, 23) * 2 - 1;
      this.wn[i] = fbm(x * 0.011, y * 0.011, 37, 3) * 2 - 1;
    }
  }
  /**
   * rects: [{cx, cy, hw, hh}] in CSS px. reach: how far the shape extends past the icon box.
   * warp: outline wiggle in px. soft: how eagerly neighbours merge (px). far: clamp distance.
   */
  compute(rects, { reach, warp, soft = reach * 0.45, far = 900, wobble = 0.12 }) {
    const { Gw, Gh } = this, N = Gw * Gh;
    const s = new Float32Array(N).fill(far);
    if (!rects.length) return s;
    const inv = 1 / soft, cut = soft * 7;
    for (let gy = 0; gy < Gh; gy++) for (let gx = 0; gx < Gw; gx++) {
      const i = gy * Gw + gx;
      const px = gx * STEP + this.wx[i] * warp, py = gy * STEP + this.wy[i] * warp;
      let m = Infinity;
      for (let k = 0; k < rects.length; k++) {
        const r = rects[k], d = boxDist(px - r.cx, py - r.cy, r.hw, r.hh, r.rad);
        if (d < m) m = d;
      }
      if (m > far + reach) continue;
      let acc = 0;
      for (let k = 0; k < rects.length; k++) {
        const r = rects[k], d = boxDist(px - r.cx, py - r.cy, r.hw, r.hh, r.rad);
        if (d - m < cut) acc += Math.exp(-(d - m) * inv);
      }
      const sm = m - soft * Math.log(acc);
      // bigger shapes get a bolder wobble; a lone icon stays close to a soft round blob
      s[i] = Math.min(far, sm - reach + this.wn[i] * reach * wobble);
    }
    return s;
  }
  sample(a, x, y) {
    const { Gw, Gh } = this;
    const fx = clamp(x / STEP, 0, Gw - 1.001), fy = clamp(y / STEP, 0, Gh - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, i = iy * Gw + ix;
    return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + Gw] * (1 - tx) + a[i + Gw + 1] * tx) * ty;
  }
  /** Gradient of the field (points away from the shape). */
  grad(a, x, y, out) {
    const e = STEP;
    out[0] = (this.sample(a, x + e, y) - this.sample(a, x - e, y)) / (2 * e);
    out[1] = (this.sample(a, x, y + e) - this.sample(a, x, y - e)) / (2 * e);
    return out;
  }
}
function boxDist(dx, dy, hw, hh, rad) {
  const qx = Math.abs(dx) - hw + rad, qy = Math.abs(dy) - hh + rad;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rad;
}
export const iconRects = icons => icons.map(ic => ({ cx: ic.x + ic.w / 2, cy: ic.y + ic.h / 2, hw: Math.max(4, ic.w / 2 - 14), hh: Math.max(4, ic.h / 2 - 18), rad: 18 }));

/** Field textures for the GPU: two half-float layers (from, to) blended while icons move. */
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7bff;
  return sign | (e << 10) | (m >>> 13);
}

/* ======================================================================
   Morphing between two field layouts
   ====================================================================== */
export class Morph {
  constructor(field, gl, ms = 2400) {
    this.field = field; this.gl = gl; this.ms = ms;
    this.A = null; this.B = null; this.t0 = -1e9; this.k = 1;
    this.tex = [gl.createTexture(), gl.createTexture()];
    this.slot = 0; this.buf = null;
  }
  alloc() {
    const { gl, field } = this;
    this.buf = new Uint16Array(field.Gw * field.Gh);
    for (const t of this.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, field.Gw, field.Gh, 0, gl.RED, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.A = this.B = null;
  }
  upload(i, s) {
    const { gl, field, buf } = this;
    for (let k = 0; k < s.length; k++) buf[k] = toHalf(s[k]);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, field.Gw, field.Gh, gl.RED, gl.HALF_FLOAT, buf);
  }
  /** Move to a new field. instant: no animation (first layout, resize). */
  set(s, instant, now = performance.now()) {
    if (instant || !this.B) {
      this.A = this.B = s; this.upload(0, s); this.upload(1, s); this.k = 1; this.t0 = -1e9; return;
    }
    // freeze the current in-between shape as the new start
    const cur = this.k >= 1 ? this.B : blend(this.A, this.B, this.k);
    this.A = cur; this.B = s; this.upload(0, cur); this.upload(1, s); this.t0 = now; this.k = 0;
  }
  tick(now) { this.k = this.B ? easeInOut(clamp((now - this.t0) / this.ms, 0, 1)) : 1; return this.k; }
  get moving() { return this.k < 1; }
  at(x, y) { return this.B ? (this.k >= 1 ? this.field.sample(this.B, x, y) : mix(this.field.sample(this.A, x, y), this.field.sample(this.B, x, y), this.k)) : 999; }
  target(x, y) { return this.B ? this.field.sample(this.B, x, y) : 999; }
}
function blend(a, b, k) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + (b[i] - a[i]) * k; return o; }

/* ======================================================================
   Light through the day. keys: [hour, tint rgb, warm rgb, shadow length]
   ====================================================================== */
export function dayLight(keys, hour, out) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= h) i++;
  const a = keys[i], b = keys[i + 1], t = sstep(0, 1, (h - a[0]) / (b[0] - a[0] || 1));
  for (let k = 0; k < 3; k++) { out.tint[k] = mix(a[1][k], b[1][k], t); out.warm[k] = mix(a[2][k], b[2][k], t); }
  out.len = mix(a[3], b[3], t);
  out.night = 1 - sstep(5.2, 7, h) + sstep(19.5, 21.5, h);
  // the sun comes from the left in the morning, from the top-left at noon, the right at dusk
  const ang = clamp((h - 13) / 7, -1, 1) * 0.9;
  out.dir[0] = -Math.sin(0.65 - ang * 0.9); out.dir[1] = -Math.cos(0.65 - ang * 0.9);
  return out;
}
export const clockHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

/* ======================================================================
   One wind for the whole scene. Gust bands roll across the screen; the same formula is in
   WIND_GLSL so grass, water and sprites lean together.
   ====================================================================== */
export const WIND_DIR = [0.93, 0.37];
export function windAt(x, y, t) {
  const u = (x * WIND_DIR[0] + y * WIND_DIR[1] - t * 150) / 1300, f = u - Math.floor(u);
  const band = sstep(0, 0.12, f) * sstep(0.42, 0.14, f);
  const side = -x * WIND_DIR[1] + y * WIND_DIR[0];
  return 0.22 + 0.78 * band * (0.72 + 0.28 * Math.sin(side * 0.0035 + t * 0.27));
}
export const WIND_GLSL = `
const vec2 WIND_DIR = vec2(0.93, 0.37);
float windAt(vec2 p, float t) {
  float u = (dot(p, WIND_DIR) - t * 150.0) / 1300.0, f = fract(u);
  float band = smoothstep(0.0, 0.12, f) * smoothstep(0.42, 0.28, f);
  float side = dot(p, vec2(-WIND_DIR.y, WIND_DIR.x));
  return 0.22 + 0.78 * band * (0.72 + 0.28 * sin(side * 0.0035 + t * 0.27));
}`;

/* ======================================================================
   GLSL helpers shared by the ground shaders
   ====================================================================== */
export const NOISE_GLSL = `
float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n * 17.0)); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm3(vec2 p) { return vn(p) * 0.55 + vn(p * 2.1 + 7.3) * 0.3 + vn(p * 4.3 - 3.1) * 0.15; }
// cellular noise: x = distance to nearest feature point, yz = that cell's id hash
vec3 cells(vec2 p) {
  vec2 i = floor(p), f = fract(p); float best = 9.0; vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y), c = o + h22(i + o) * 0.8 + 0.1; float d = length(c - f);
    if (d < best) { best = d; id = i + o; }
  }
  return vec3(best, h22(id));
}`;
export const FULL_VS = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0, 1); }`;

/* ======================================================================
   GL setup
   ====================================================================== */
export function makeGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true });
  if (!gl) { document.getElementById('nogl').style.display = 'grid'; throw new Error('WebGL2 is not available'); }
  return gl;
}
export function program(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); U[name] = gl.getUniformLocation(p, name); }
  return { p, U };
}
export function texture(gl, src, { repeat = false, mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  return t;
}

/* ======================================================================
   Painted sprite atlas: sprites are painted once at startup on a 2D canvas (at 2× for crisp
   edges on high-DPI screens) and packed into one texture.
   ====================================================================== */
export class Atlas {
  constructor(size = 2048) {
    this.size = size;
    this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = size;
    this.g = this.cv.getContext('2d');
    this.tmp = document.createElement('canvas'); this.tg = this.tmp.getContext('2d');
    this.x = 0; this.y = 0; this.row = 0;
  }
  /** Paints fn(g, S) on an S×S canvas (S = 2·px, origin top-left) and returns its uv rect. */
  paint(px, fn) {
    const S = px * 2, pad = 2;
    this.tmp.width = this.tmp.height = S;
    const g = this.tg; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S); g.globalAlpha = 1; g.filter = 'none';
    fn(g, S);
    if (this.x + S + pad > this.size) { this.x = 0; this.y += this.row + pad; this.row = 0; }
    if (this.y + S > this.size) throw new Error('sprite atlas is full');
    const x = this.x, y = this.y;
    this.g.drawImage(this.tmp, x, y);
    this.x += S + pad; this.row = Math.max(this.row, S);
    const z = this.size;
    return [x / z, y / z, (x + S) / z, (y + S) / z];
  }
}

/* ======================================================================
   Sprite batch: instanced quads (x, y, w, h, rotation, lift, uv rect, rgba tint).
   One pass draws shadows (silhouettes shifted along the light by lift) into a half-res
   alpha buffer the ground shader reads; the second pass draws the sprites themselves.
   ====================================================================== */
const SPRITE_VS = `#version 300 es
layout(location = 0) in vec4 aRect;   // x, y, w, h (centre, CSS px)
layout(location = 1) in vec2 aRot;    // rotation, lift
layout(location = 2) in vec4 aUV;
layout(location = 3) in vec4 aCol;
uniform vec2 uRes; uniform vec2 uShadow; uniform float uMode;
out vec2 vUV; out vec4 vCol;
void main() {
  const vec2 C[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(1, 0), vec2(1, 1), vec2(0, 1));
  vec2 c = C[gl_VertexID];
  vec2 q = (c - 0.5) * aRect.zw; float s = sin(aRot.x), k = cos(aRot.x);
  vec2 p = aRect.xy + vec2(q.x * k - q.y * s, q.x * s + q.y * k);
  if (uMode > 0.5) p += uShadow * aRot.y;
  vUV = mix(aUV.xy, aUV.zw, c); vCol = aCol;
  gl_Position = vec4(p / uRes * vec2(2, -2) + vec2(-1, 1), 0, 1);
}`;
const SPRITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform float uMode; uniform vec3 uTint;
in vec2 vUV; in vec4 vCol; out vec4 o;
void main() {
  vec4 t = texture(uTex, vUV);
  if (uMode > 0.5) { o = vec4(t.a * vCol.a); return; }      // shadow: coverage only
  o = vec4(t.rgb * vCol.rgb * uTint, t.a) * vCol.a;          // premultiplied
}`;
export const INST = 14;
export class Sprites {
  constructor(gl, max = 6000) {
    this.gl = gl; this.max = max; this.data = new Float32Array(max * INST); this.n = 0;
    this.prog = program(gl, SPRITE_VS, SPRITE_FS);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const B = INST * 4;
    const attr = (loc, size, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, off * 4); gl.vertexAttribDivisor(loc, 1); };
    attr(0, 4, 0); attr(1, 2, 4); attr(2, 4, 6); attr(3, 4, 10);
    gl.bindVertexArray(null);
    this.layers = [];
    this.fb = null; this.shadowTex = null; this.sw = 0; this.sh = 0;
  }
  begin() { this.n = 0; this.layers.length = 0; }
  /** Starts a named run of sprites (drawn in order); shadow: whether it casts a shadow. */
  layer(shadow = true) { const l = { start: this.n, count: 0, shadow }; this.layers.push(l); return l; }
  end(l) { l.count = this.n - l.start; }
  push(x, y, w, h, rot, lift, uv, r = 1, g = 1, b = 1, a = 1) {
    if (this.n >= this.max || a <= 0.003) return;
    const d = this.data, o = this.n++ * INST;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h; d[o + 4] = rot; d[o + 5] = lift;
    d[o + 6] = uv[0]; d[o + 7] = uv[1]; d[o + 8] = uv[2]; d[o + 9] = uv[3];
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
  }
  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * INST);
  }
  allocShadow(cw, ch) {
    const gl = this.gl;
    this.sw = Math.max(1, cw >> 1); this.sh = Math.max(1, ch >> 1);
    if (!this.shadowTex) { this.shadowTex = gl.createTexture(); this.fb = gl.createFramebuffer(); }
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.sw, this.sh, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** Shadow pass into the half-res buffer. shadow = [dx, dy] per unit of lift (CSS px). */
  drawShadows(W, H, tex, shadow) {
    const gl = this.gl, { p, U } = this.prog;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, this.sw, this.sh);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    gl.uniform2f(U.uRes, W, H); gl.uniform2f(U.uShadow, shadow[0], shadow[1]); gl.uniform1f(U.uMode, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uTex, 0);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vao);
    for (const l of this.layers) if (l.shadow && l.count) this.drawRange(l);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  draw(W, H, tex, tint, cw, ch, from = 0, to = this.layers.length) {
    const gl = this.gl, { p, U } = this.prog;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(p);
    gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uMode, 0); gl.uniform3fv(U.uTint, tint);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uTex, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    for (let i = from; i < to; i++) { const l = this.layers[i]; if (l.count) this.drawRange(l); }
  }
  drawRange(l) {
    const gl = this.gl, B = INST * 4, o = l.start * B;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, B, o);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, B, o + 16);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, B, o + 24);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, B, o + 40);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, l.count);
  }
}

/* ======================================================================
   Page runtime: demo icons when opened directly, hosted mode inside the wallpaper / settings
   preview (messages from the parent page), resize, 30 fps cap, pause while covered.
   ====================================================================== */
export function demoIcons(W, H) {
  const out = [], cw = 76, ch = 98;
  for (let c = 0; c < 2; c++) for (let r = 0; r < 7; r++) {
    if (c === 1 && r >= 3) continue;
    out.push({ x: 2 + c * cw, y: 4 + r * ch, w: 74, h: 92 });
  }
  out.push({ x: Math.round(W * 0.55), y: Math.round(H * 0.42), w: 74, h: 92 });
  out.push({ x: W - 2 * cw - 2, y: 4, w: 74, h: 92 }, { x: W - cw - 2, y: 4, w: 74, h: 92 });
  return out;
}
export function drawGhosts(icons) {
  const el = document.getElementById('ghosts');
  if (el) el.innerHTML = icons.map(ic => `<div class="ghost" style="left:${ic.x}px;top:${ic.y}px;width:${ic.w}px;height:${ic.h}px"><i></i><b></b></div>`).join('');
}
/** Which icons appeared and which spots were vacated between two layouts. */
export function diffIcons(prev, next) {
  const same = (a, b) => Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4;
  return { added: next.filter(n => !prev.some(o => same(o, n))), gone: prev.filter(o => !next.some(n => same(o, n))) };
}

/**
 * opts: { P, defaults, keys (accepted numeric params), canvas, quality,
 *   resize(W, H, cw, ch), icons(list, first), settings(changedKeys), reseed(),
 *   step(dt, now), draw(now, dt), stats() }
 */
/** Simulation steps run once when a page starts paused (about 8 s of scenery growth). */
const WARM_STEPS = 240;
export function runPage(o) {
  const { P, canvas: cv } = o;
  const st = { W: innerWidth, H: innerHeight, icons: [], paused: false, frame: 0, fps: 0, limit: 30 };
  // the cursor: position, whether it is over the bare desktop, speed; clicks on empty ground
  const ptr = st.ptr = { x: -1e4, y: -1e4, in: false, down: false, vx: 0, vy: 0, t: 0, dx: 0, dy: 0, dt: 0 };
  window.__ptr = ptr;   // for tests
  const onIcon = (x, y) => st.icons.some(ic => x > ic.x - 4 && x < ic.x + ic.w + 4 && y > ic.y - 4 && y < ic.y + ic.h + 4);
  function pointer(inside, x, y, down) {
    const now = performance.now();
    if (inside) {
      if (ptr.in) { const dt = Math.max(16, now - ptr.t) / 1000; ptr.vx = mix(ptr.vx, (x - ptr.x) / dt, 0.5); ptr.vy = mix(ptr.vy, (y - ptr.y) / dt, 0.5); }
      else { ptr.vx = ptr.vy = 0; }
      ptr.x = x; ptr.y = y;
    }
    ptr.in = inside; ptr.t = now; ptr.icon = inside && onIcon(x, y);
    if (down && !ptr.down) { ptr.dx = x; ptr.dy = y; ptr.dt = now; }
    if (!down && ptr.down && inside && now - ptr.dt < 600 && Math.hypot(x - ptr.dx, y - ptr.dy) < 8 && !onIcon(ptr.dx, ptr.dy)) o.click?.(x, y);
    ptr.down = down && inside;
    o.pointer?.(ptr);
  }
  // cursor speed fades when it stops moving
  st.ptrDecay = dt => { ptr.vx *= Math.exp(-dt * 6); ptr.vy *= Math.exp(-dt * 6); };
  const statsEl = document.getElementById('stats');
  function resize() {
    const scale = PREVIEW ? 0.5 : Math.min(devicePixelRatio || 1, o.quality ?? 2);
    const box = cv.getBoundingClientRect();
    cv.width = Math.round((box.width || innerWidth) * scale); cv.height = Math.round((box.height || innerHeight) * scale);
    st.W = cv.width / scale; st.H = cv.height / scale; st.scale = scale;
    o.resize(st.W, st.H, cv.width, cv.height);
  }
  function setIcons(list, first) {
    const prev = st.icons; st.icons = list; st.dirty = true;
    if (PREVIEW || !WALL) drawGhosts(list);
    o.icons(list, first, prev);
  }
  function apply(v) {
    // The user's frame-rate setting (15 / 30 / 60), sent by the host next to the theme values.
    if (typeof v.fps === 'number' && v.fps > 0) st.limit = clamp(v.fps, 5, 120);
    if (typeof v.seed === 'number' && v.seed !== RNG.seed) { RNG.seed = v.seed; o.reseed(); }
    const changed = [];
    for (const k of o.keys) if (typeof v[k] === 'number' && v[k] !== P[k]) { P[k] = v[k]; changed.push(k); }
    if (changed.length) { o.settings(changed); st.dirty = true; }
  }
  resize();
  if (WALL || PREVIEW) {
    document.body.classList.add('wall');
    if (PREVIEW) document.body.classList.add('preview');
    let first = true, sentDrawn = false;
    const handle = m => {
      kick();
      if (m.t === 'pause') { st.paused = PREVIEW ? false : !!m.v; return; }
      if (m.t === 'settings') { apply(m.v || {}); return; }
      if (m.t === 'pointer') { pointer(!!m.in, m.x, m.y, !!m.down); return; }
      if (m.t === 'reset') { apply(Object.assign({}, o.defaults, m.v || {})); return; }
      if (m.t !== 'icons') return;
      const k = devicePixelRatio || 1;
      setIcons(m.vis ? m.r.map(([l, t, r, b]) => ({ x: l / k, y: t / k, w: (r - l) / k, h: (b - t) / k })) : [], first);
      // Real layout arrived: if the page is paused, it still has to show the grown scenery.
      if (first && m.vis) st.warm = WARM_STEPS;
      first = false;
      // Tell the host the first layout is on screen (it keeps the old theme until then).
      if (!sentDrawn) { sentDrawn = true; requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage(JSON.stringify({ t: 'drawn' }), location.origin))); }
    };
    addEventListener('message', ev => {
      if (ev.source === parent && ev.origin === location.origin) handle(typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data);
    });
    setIcons([], true);
    parent.postMessage(JSON.stringify({ t: 'ready' }), location.origin);
  } else {
    setIcons(demoIcons(st.W, st.H), true);
    let down = false;
    addEventListener('pointermove', e => pointer(true, e.clientX, e.clientY, down));
    addEventListener('pointerdown', e => { down = true; pointer(true, e.clientX, e.clientY, down); });
    addEventListener('pointerup', e => { down = false; pointer(true, e.clientX, e.clientY, down); });
    document.documentElement.addEventListener('pointerleave', () => pointer(false, 0, 0, false));
  }
  let rt = 0;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { resize(); if (!(WALL || PREVIEW)) setIcons(demoIcons(st.W, st.H), true); else o.icons(st.icons, true, st.icons); }, 120);
  });
  let last = 0, raf = 0, timer = 0;
  // Frames are paced by a timer, not by polling every display refresh (60-144 wake-ups a second
  // for nothing at a 30 fps cap). `next(ms)` waits that long, then asks for one animation frame.
  const next = ms => {
    if (raf) return;
    if (ms > 8) { clearTimeout(timer); timer = setTimeout(() => { timer = 0; if (!raf) raf = requestAnimationFrame(frame); }, ms - 5); }
    else { clearTimeout(timer); timer = 0; raf = requestAnimationFrame(frame); }
  };
  const kick = () => { if (!raf) next(0); };
  st.kick = kick;
  function frame(now) {
    raf = 0;
    // Paused (full screen app on top): still draw one frame after icons, settings or size
    // change, so a page that loads while paused shows the land around the icons.
    if (st.paused) {
      last = 0;
      if (st.dirty) {
        st.dirty = false;
        // A theme that starts paused would show only its intro state, as growth is time based:
        // fast-forward the simulation once, within a small time budget.
        const t0 = performance.now();
        for (; st.warm > 0 && performance.now() - t0 < 350; st.warm--) o.step(1 / 30, now);
        st.warm = 0;
        o.step(1 / 30, now); o.draw(now, 1 / 30);
        st.settleUntil = now + 2500; st.settleAt = now;
        next(0);
      } else if (now < st.settleUntil) {
        // Fades that run on the wall clock (a theme crossfading into its layout) need a few
        // frames to finish: keep drawing at about 10 fps for a moment after each change.
        if (now - st.settleAt > 90) { st.settleAt = now; o.step(0.09, now); o.draw(now, 0.09); }
        next(60);
      } else next(250);
      return;
    }
    const gap = P.cap30 !== false ? 1000 / st.limit : 0;
    if (gap && last && now - last < gap - 2) { next(gap - (now - last)); return; }
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 30;
    if (last) st.fps = st.fps ? st.fps * 0.92 + 0.08 / dt : 1 / dt;
    last = now;
    st.ptrDecay(dt);
    o.step(dt, now);
    o.draw(now, dt);
    if (++st.frame % 15 === 0 && statsEl && !WALL) statsEl.textContent = `${st.fps.toFixed(0)} fps · ${cv.width}×${cv.height}${o.stats ? ' · ' + o.stats() : ''}`;
    next(gap ? gap - (performance.now() - now) : 0);
  }
  next(0);
  return st;
}
