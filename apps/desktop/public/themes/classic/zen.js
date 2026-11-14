// DeskWall · Zen garden ("Сад камней").
// A Japanese dry garden seen from above. Grey granite gravel is raked in straight lines; every
// icon sits on a soft island of cushion moss, and icons side by side share one island. The rake
// circles each island and its stones a few times before the lines run straight again. One small
// maple grows at the edge of the biggest island and now and then drops a leaf. Light follows the
// clock; slow cloud shadows pass over.
// Cursor: it draws a shallow groove in the gravel that smooths out again. Click the gravel: a
// small raked circle forms around the spot. Click the maple: it shakes and drops leaves. A sparrow
// visits from time to time and flies off when the cursor comes close.
import {
  QS, TAU, clamp, mix, sstep, hash, Field, Morph, iconRects, STEP,
  dayLight, clockHour, windAt, WIND_DIR, NOISE_GLSL, FULL_VS, makeGL, program, texture, Atlas, Sprites,
  runPage, diffIcons, rng,
} from './kit.js';

/* ======================================================================
   Parameters (keys match apps/desktop/src/shared/themes.ts)
   ====================================================================== */
const P = { reach: 30, rings: 5, maple: 1, leaves: 1, birds: 1, byClock: 1, hour: 13, cap30: true };
const DEFAULTS = { ...P };
if (QS.has('hour')) { P.byClock = 0; P.hour = +QS.get('hour'); }

const LIGHT_KEYS = [
  [0, [0.7, 0.75, 0.88], [0.94, 0.97, 1.06], 26], [4.8, [0.7, 0.75, 0.88], [0.94, 0.97, 1.06], 26],
  [6.4, [1.0, 0.95, 0.92], [1.05, 0.97, 0.92], 64], [8.5, [1.0, 0.99, 0.97], [1.02, 1.0, 0.97], 50],
  [12.5, [1.0, 1.0, 1.0], [1.0, 1.0, 1.0], 40], [16.5, [1.01, 0.99, 0.97], [1.02, 1.0, 0.96], 50],
  [18.8, [1.03, 0.96, 0.9], [1.05, 0.97, 0.9], 68], [20.3, [0.82, 0.8, 0.9], [1.0, 0.9, 0.94], 40],
  [21.8, [0.7, 0.75, 0.88], [0.94, 0.97, 1.06], 26], [24, [0.7, 0.75, 0.88], [0.94, 0.97, 1.06], 26],
];
const LIGHT = { tint: [1, 1, 1], warm: [1, 1, 1], len: 40, night: 0, dir: [-0.6, -0.8] };
const updateLight = () => dayLight(LIGHT_KEYS, P.byClock ? clockHour() : P.hour, LIGHT);
const MAX_STONES = 12;

/* ======================================================================
   Ground shader: gravel with rake lines, moss islands, stones, shadows
   ====================================================================== */
const GROUND_FS = `#version 300 es
precision highp float;
${NOISE_GLSL}
uniform sampler2D uFA, uFB, uTrail;
uniform float uMix, uScale, uRings, uLen, uNStones;
uniform vec2 uCv, uGrid, uSun;
uniform vec4 uStones[${MAX_STONES}];
uniform float uStoneRot[${MAX_STONES}];
uniform vec4 uRip[4];
out vec4 o;
const float SP = 19.0, FLAT = 11.0;
const vec3 SAND = vec3(218.0, 218.0, 212.0) / 255.0, SAND_HI = vec3(242.0, 242.0, 238.0) / 255.0, SAND_LO = vec3(176.0, 177.0, 172.0) / 255.0;
const vec3 MOSS1 = vec3(128.0, 156.0, 76.0) / 255.0, MOSS2 = vec3(104.0, 134.0, 62.0) / 255.0;
const vec3 MOSS_HI = vec3(172.0, 196.0, 108.0) / 255.0, MOSS_LO = vec3(78.0, 106.0, 50.0) / 255.0;
const vec3 STONE = vec3(150.0, 140.0, 128.0) / 255.0;

float field(vec2 p) { vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid; return mix(texture(uFA, uv).r, texture(uFB, uv).r, uMix); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// ellipse distance (approximate, px) and the local frame of stone i
vec2 stoneLocal(vec2 p, int i) { vec4 s = uStones[i]; float c = cos(uStoneRot[i]), n = sin(uStoneRot[i]); vec2 d = p - s.xy; return vec2(d.x * c + d.y * n, -d.x * n + d.y * c) / s.zw; }
float stoneD(vec2 p, int i) { vec4 s = uStones[i]; return (length(stoneLocal(p, i)) - 1.0) * min(s.z, s.w); }
float stonesD(vec2 p) { float d = 1e4; for (int i = 0; i < ${MAX_STONES}; i++) { if (float(i) >= uNStones) break; d = min(d, stoneD(p, i)); } return d; }
// distance the rake follows: moss islands and stones, melted together
float rakeD(vec2 p) { return smin(field(p), stonesD(p) - 5.0, 14.0); }

// rake profile: rounded ridges, slightly narrower furrows
float ridge(float ph) { return pow(0.5 - 0.5 * cos(6.2831853 * ph), 0.65); }
float groove(vec2 p) {
  float d = rakeD(p), wob = (vn(p * 0.12) - 0.5) * 1.3;
  float h;
  float ringEnd = FLAT + uRings * SP;
  // rings around islands and stones; the straight lines butt into the outer ring (soft 6 px seam)
  float hr = d < FLAT ? 0.0 : ridge((d - FLAT + wob) / SP);
  float hs = ridge((p.y + wob + sin(p.x / 700.0) * 2.5) / SP);
  h = mix(hr, hs, smoothstep(ringEnd - 3.0, ringEnd + 3.0, d));
  // clicked spots: a small raked circle grows, then the old lines come back
  for (int i = 0; i < 4; i++) {
    vec4 r = uRip[i]; if (r.z < 0.0 || r.z > 14.0) continue;
    float rd = length(p - r.xy), R = 26.0 + min(r.z, 2.5) * 34.0;
    float w = (1.0 - smoothstep(R - 18.0, R, rd)) * (1.0 - smoothstep(8.0, 14.0, r.z)) * smoothstep(FLAT + 4.0, FLAT + 20.0, d);
    h = mix(h, rd < 7.0 ? 0.0 : ridge((rd - 7.0) / SP * 1.15), w);
  }
  return h;
}
// gravel grains in scene px: little domes, x = height, yz = slope, w = grain id
vec4 grain(vec2 q) {
  const float C = 3.0;
  vec2 i = floor(q / C), f = q / C - i; float best = 9.0; vec2 bv = vec2(0); float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y), c = o + h22(i + o); vec2 v = f - c; float d = dot(v, v);
    if (d < best) { best = d; bv = v; id = h21(i + o + 31.7); }
  }
  float dist = sqrt(best), amp = (0.6 + id * 0.6) * 0.28;
  float hgt = max(0.0, 0.75 - dist) * amp;
  vec2 slope = dist > 0.001 && dist < 0.75 ? -bv / dist / C * amp : vec2(0);
  return vec4(hgt, slope, id);
}
// moss cushions: soft domes on a jittered grid (no creases); returns height and slope
vec3 cush(vec2 p, float c, float k) {
  vec2 ci = floor(p / c); float s = 0.0; vec2 g = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 id = ci + vec2(x, y), q = (id + h22(id + k)) * c;
    float r = c * (0.32 + 0.22 * h21(id + k + 9.0)); vec2 v = p - q;
    float e = exp(-dot(v, v) / (r * r)); s += e; g += e * -2.0 * v / (r * r);
  }
  float ex = exp(-1.6 * s);
  return vec3(1.0 - ex, 1.6 * ex * g);
}
float trail(vec2 p) { return texture(uTrail, vec2(p.x * uScale / uCv.x, 1.0 - p.y * uScale / uCv.y)).r; }

void main() {
  vec2 dev = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y), p = dev / uScale;
  float px = 1.0 / uScale;
  // --- gravel: rake lines + grains, lit from the sun
  float h0 = groove(p), hx = groove(p + vec2(px, 0)), hy = groove(p + vec2(0, px));
  vec2 slope = vec2(hx - h0, hy - h0) / px; // per scene px, same look at any density
  float tr = trail(p);
  if (tr > 0.002) slope -= vec2(trail(p + vec2(2.0, 0)) - tr, trail(p + vec2(0, 2.0)) - tr) * 1.1;
  vec4 gr = grain(p);
  slope += gr.yz * mix(1.0, 0.6, tr);
  float lit = -dot(slope, uSun) * 5.2;
  vec3 col = lit > 0.0 ? mix(SAND, SAND_HI, min(1.0, lit)) : mix(SAND, SAND_LO, min(1.0, -lit));
  col += ((gr.w - 0.5) * 16.0 + (h21(dev) - 0.5) * 3.0) / 255.0;
  if (gr.w > 0.985) col = mix(col, mix(SAND_LO, vec3(0.47, 0.44, 0.39), 0.4), 0.5);
  col *= 1.0 - tr * 0.05;
  // soft shadow of moss and stones on the gravel
  float d = rakeD(p);
  float dS = rakeD(p + uSun * uLen * 0.33);
  col = mix(col, vec3(0.59, 0.55, 0.49), (1.0 - smoothstep(-6.0, 14.0, dS)) * 0.11 * smoothstep(-2.0, 3.0, d));

  // --- moss islands
  float dm = field(p);
  if (dm < 2.0) {
    vec3 mc; float edgeN;
    // velvet carpet: broad soft tone patches + fine short fibres catching the light, almost flat
    float t = fbm3(p / 70.0 + 4.0), t2 = vn(p / 22.0 + 9.0);
    mc = mix(MOSS2, MOSS1, smoothstep(0.25, 0.75, t * 0.7 + t2 * 0.3));
    vec2 q = p * vec2(0.9, 0.9); float f1 = vn(q), f2 = vn(q * 2.3 + 5.1);
    vec2 fg = vec2(vn(q + vec2(0.35, 0)) - f1, vn(q + vec2(0, 0.35)) - f1);
    float fl = -dot(fg, uSun) * 3.5;
    mc = fl > 0.0 ? mix(mc, MOSS_HI, min(0.5, fl * 0.5)) : mix(mc, MOSS_LO, min(0.5, -fl * 0.45));
    mc += (f2 - 0.5) * vec3(10.0, 10.0, 6.0) / 255.0;
    vec3 bb = cush(p + vec2(300.0, 170.0), 46.0, 5.0); float bl = -dot(bb.yz, uSun) * 6.0;
    mc = bl > 0.0 ? mix(mc, MOSS_HI, min(0.35, bl * 0.4)) : mix(mc, MOSS_LO, min(0.3, -bl * 0.35));
    edgeN = f1;
    mc += (h21(dev) - 0.5) * 2.0 / 255.0;
    // raised edge: lit rim toward the sun, gentle shade away from it (no dark outline)
    vec2 en = vec2(field(p + vec2(3.0, 0)) - field(p - vec2(3.0, 0)), field(p + vec2(0, 3.0)) - field(p - vec2(0, 3.0)));
    float rim = dot(en, uSun) / max(length(en), 1e-3) * smoothstep(-14.0, 0.0, dm);
    mc = rim > 0.0 ? mix(mc, MOSS_HI, rim * 0.45) : mix(mc, MOSS_LO, -rim * 0.35);
    // soft, slightly ragged edge in scene px (no per-pixel noise), anti-aliased over ~1.5 device px
    float fuzz = (vn(p * 0.45) - 0.5) * 2.2 + (edgeN - 0.5) * 1.2;
    col = mix(col, mc, smoothstep(0.75 * px, -0.75 * px, dm + fuzz));
  }

  // --- stones (above moss): rounded, lit from the sun, speckled
  for (int i = 0; i < ${MAX_STONES}; i++) {
    if (float(i) >= uNStones) break;
    float sd = stoneD(p, i);
    if (sd > 1.5) continue;
    vec2 u = stoneLocal(p, i); float r2 = min(1.0, dot(u, u)), nz = sqrt(1.0 - r2);
    float c = cos(uStoneRot[i]), n = sin(uStoneRot[i]);
    vec2 nw = vec2(u.x * c - u.y * n, u.x * n + u.y * c);
    float sl = dot(nw, uSun) * 0.6 + nz * 0.5 + (fbm3(p / 14.0 + float(i) * 3.1) - 0.5) * 0.35;
    vec3 hi = mix(STONE, vec3(0.92, 0.91, 0.886), 0.6), lo = mix(STONE, vec3(0.31, 0.3, 0.27), 0.35);
    vec3 sc = sl > 0.5 ? mix(STONE, hi, min(1.0, (sl - 0.5) * 1.6)) : mix(lo, STONE, max(0.0, sl * 2.0));
    sc += (h21(dev + 3.0) - 0.5) * 6.0 / 255.0;
    col = mix(col, sc, smoothstep(1.5, -1.0, sd * uScale));
  }

  o = vec4(col, 1.0);
}`;
// every frame: the cached ground + shadows of the maple, leaves and sparrow, slow cloud shadows, light
const COMPOSE_FS = `#version 300 es
precision highp float;
${NOISE_GLSL}
uniform sampler2D uBase, uShade;
uniform float uScale, uNight;
uniform vec2 uCv, uDrift;
uniform vec3 uTint, uWarm;
out vec4 o;
float shade() {
  vec2 uv = gl_FragCoord.xy / uCv, e = 2.5 / uCv;
  return (texture(uShade, uv).r * 2.0 + texture(uShade, uv + vec2(e.x, 0)).r + texture(uShade, uv - vec2(e.x, 0)).r
        + texture(uShade, uv + vec2(0, e.y)).r + texture(uShade, uv - vec2(0, e.y)).r) / 6.0;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y) / uScale;
  vec3 col = texelFetch(uBase, ivec2(gl_FragCoord.xy), 0).rgb;
  col *= mix(vec3(1.0), vec3(0.72, 0.72, 0.74), shade() * 0.62);
  float cl = smoothstep(0.52, 0.72, fbm3((p - uDrift) * 0.0011 + 3.0));
  col *= 1.0 - cl * 0.06;
  col *= mix(vec3(1.0), uWarm, 0.6) * uTint;
  col = mix(col, col * vec3(0.84, 0.9, 1.1), uNight * 0.5);
  o = vec4(col, 1.0);
}`;

/* ======================================================================
   Cursor groove: a half-res buffer where the cursor presses soft dots; it fades linearly
   ====================================================================== */
const DOT_VS = `#version 300 es
layout(location = 0) in vec3 aP;      // x, y (CSS px), strength
uniform vec2 uRes; uniform float uSize;
out float vS;
void main() { vS = aP.z; gl_PointSize = uSize; gl_Position = vec4(aP.xy / uRes * vec2(2, -2) + vec2(-1, 1), 0, 1); }`;
const DOT_FS = `#version 300 es
precision highp float;
in float vS; out vec4 o;
void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); o = vec4(vS * exp(-r * 3.2) * (1.0 - smoothstep(0.8, 1.0, r))); }`;
const FADE_FS = `#version 300 es
precision highp float;
uniform float uA; out vec4 o;
void main() { o = vec4(uA); }`;

/* ======================================================================
   Painted sprites: the maple crown (as in the approved still), leaves, the sparrow
   ====================================================================== */
const atlas = new Atlas(1024);
const SPR = {};
const LX = -0.6, LY = -0.8;   // painted light: upper left
function leafPath(g, x, y, r, a) {
  g.save(); g.translate(x, y); g.rotate(a); g.beginPath();
  for (let i = 0; i < 5; i++) {
    const t = -Math.PI / 2 + (i - 2) * 0.62, tx = Math.cos(t) * r, ty = Math.sin(t) * r;
    const t2 = t + 0.31, ix = Math.cos(t2) * r * 0.42, iy = Math.sin(t2) * r * 0.42;
    if (i === 0) g.moveTo(0, r * 0.15);
    g.lineTo(tx, ty); if (i < 4) g.lineTo(ix, iy);
  }
  g.closePath(); g.restore();
}
const CROWN = 150, CROWN_R = 56;
function paintCrown(g, S) {
  const k = S / CROWN, c = S / 2, R = rng(7);
  g.scale(k, k);
  const blobs = [];
  for (let i = 0; i < 420; i++) {
    const a = R() * TAU, rr = Math.pow(R(), 0.6) * CROWN_R;
    blobs.push([c / k + Math.cos(a) * rr, c / k + Math.sin(a) * rr * 0.9, (5.6 + R() * 4) , R() * TAU, R(), rr / CROWN_R]);
  }
  blobs.sort((a, b) => b[5] - a[5]);
  for (const b of blobs) {
    const t = b[4], shade = 1 - b[5] * 0.25;
    const col = t < 0.55 ? [214, 96, 64] : t < 0.85 ? [232, 132, 78] : [240, 170, 96];
    const lx = (b[0] - c / k) / CROWN_R, ly = (b[1] - c / k) / CROWN_R, lit = 1 + (lx * LX + ly * LY) * 0.12;
    g.fillStyle = `rgb(${Math.min(255, col[0] * shade * lit) | 0},${Math.min(255, col[1] * shade * lit) | 0},${Math.min(255, col[2] * shade * lit) | 0})`;
    leafPath(g, b[0], b[1], b[2], b[3]); g.fill();
  }
}
function paintLeaf(g, S, col) { g.fillStyle = col; leafPath(g, S / 2, S / 2, S * 0.42, 0); g.fill(); }
// a house sparrow from above, 32 units long. pose: 0 sit, 1 peck, 2/3 flying wings up/down
function paintSparrow(g, S, pose) {
  const u = S / 40; g.translate(S / 2, S / 2); g.scale(u, u);
  const BROWN = '#8a5f3c', DARK = '#4e3524', BUFF = '#c9a77f', GREY = '#9a958c';
  if (pose >= 2) {
    const sp = pose === 2 ? 1 : 0.55;
    for (const s of [-1, 1]) {
      g.fillStyle = BROWN; g.beginPath(); g.moveTo(3, s * 2); g.quadraticCurveTo(-1, s * 14 * sp, -7, s * 16 * sp); g.quadraticCurveTo(-6, s * 6 * sp, -4, s * 2); g.fill();
      g.strokeStyle = DARK; g.lineWidth = 0.9; g.beginPath(); g.moveTo(0, s * 5 * sp); g.lineTo(-5, s * 13 * sp); g.stroke();
    }
  }
  g.fillStyle = DARK; g.beginPath(); g.moveTo(-6, 0); g.lineTo(-14, -2.4); g.lineTo(-14, 2.4); g.closePath(); g.fill();   // tail
  g.fillStyle = BROWN; g.beginPath(); g.ellipse(-1, 0, 8, 5.2, 0, 0, TAU); g.fill();                                      // back
  if (pose < 2) { g.fillStyle = DARK; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(-2.5, s * 3, 5, 1.5, s * 0.15, 0, TAU); g.fill(); } }
  g.fillStyle = BUFF; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(0, s * 2.6, 3.2, 1, s * 0.2, 0, TAU); g.fill(); }
  const hx = pose === 1 ? 8.6 : 7;
  g.fillStyle = GREY; g.beginPath(); g.arc(hx, 0, 3.6, 0, TAU); g.fill();                                                  // head
  g.fillStyle = BROWN; g.beginPath(); g.ellipse(hx - 0.6, 0, 2.6, 1.2, 0, 0, TAU); g.fill();
  g.fillStyle = '#e0c48a'; g.beginPath(); g.moveTo(hx + 3, -1); g.lineTo(hx + 5.4, 0); g.lineTo(hx + 3, 1); g.fill();       // beak
}
function paintAll() {
  SPR.crown = atlas.paint(CROWN, paintCrown);
  SPR.leaf = ['#d9714a', '#e8955a', '#c95a3c'].map(c => atlas.paint(16, (g, S) => paintLeaf(g, S, c)));
  SPR.sparrow = [0, 1, 2, 3].map(p => atlas.paint(30, (g, S) => paintSparrow(g, S, p)));
}

/* ======================================================================
   GL
   ====================================================================== */
const cv = document.getElementById('art');
const gl = makeGL(cv);
const GROUND = program(gl, FULL_VS, GROUND_FS);
const COMPOSE = program(gl, FULL_VS, COMPOSE_FS);
const base = { tex: gl.createTexture(), fb: gl.createFramebuffer(), dirty: true, sun: [0, 0] };
const DOTS = program(gl, DOT_VS, DOT_FS);
const FADE = program(gl, FULL_VS, FADE_FS);
const VAO0 = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2600);
const sprites = new Sprites(gl, 400);
let atlasTex = null, W = 1, H = 1, CW = 1, CH = 1;
const T0 = performance.now();
const secs = now => (now - T0) / 1000;

// trail buffer (half res) and a small dynamic vertex buffer for the dots
const trail = { tex: gl.createTexture(), fb: gl.createFramebuffer(), w: 1, h: 1, buf: gl.createBuffer(), vao: gl.createVertexArray(), pts: new Float32Array(3 * 256), n: 0, last: -1e9 };
gl.bindVertexArray(trail.vao);
gl.bindBuffer(gl.ARRAY_BUFFER, trail.buf);
gl.bufferData(gl.ARRAY_BUFFER, trail.pts.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
gl.bindVertexArray(null);
function allocBase() {
  gl.bindTexture(gl.TEXTURE_2D, base.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, CW, CH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, base.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, base.tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  base.dirty = true;
}
function allocTrail() {
  trail.w = Math.max(1, CW >> 1); trail.h = Math.max(1, CH >> 1);
  gl.bindTexture(gl.TEXTURE_2D, trail.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, trail.w, trail.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, trail.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, trail.tex, 0);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ======================================================================
   World: islands, stones, the maple
   ====================================================================== */
let icons = [];
const sTarget = (x, y) => morph.target(x, y);
const STONES = new Float32Array(MAX_STONES * 4), STONE_ROT = new Float32Array(MAX_STONES);
let stones = [], nStones = 0;                  // current (animated) and target layouts
const tree = { on: false, x: 0, y: 0, tx: 0, ty: 0, a: 0, shake: 0 };

/** Icons that touch (gap < 34 px) form one island. */
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
  return [...m.values()].map(g => {
    const x0 = Math.min(...g.map(i => i.x)), y0 = Math.min(...g.map(i => i.y)), x1 = Math.max(...g.map(i => i.x + i.w)), y1 = Math.max(...g.map(i => i.y + i.h));
    return { icons: g, x0, y0, x1, y1, row: x1 - x0 > y1 - y0 };
  });
}
const overIcon = (x, y, r) => icons.some(ic => x + r > ic.x && x - r < ic.x + ic.w && y + r * 0.8 > ic.y && y - r * 0.8 < ic.y + ic.h);
/** Pushes a spot along (dx, dy) until a circle of radius r clears every icon and stays on screen. */
function clear(x, y, r, dx, dy) {
  for (let k = 0; k < 24 && overIcon(x, y, r); k++) { x += dx * 6; y += dy * 6; }
  return [clamp(x, r * 0.6, W - r * 0.6), clamp(y, r * 0.6, H - r * 0.6)];
}
function layout(instant) {
  const s = field.compute(iconRects(icons), { reach: P.reach, warp: 22, wobble: 0.12, soft: 26, far: 900 });
  morph.set(s, instant);
  base.dirty = true;
  const gs = groups(icons).sort((a, b) => b.icons.length - a.icons.length);
  const want = [];
  gs.forEach((g, gi) => {
    if (want.length >= MAX_STONES - 1) return;
    const k = hash(Math.round(g.x0), Math.round(g.y0), 71), big = 19 + k * 7, rot = (k - 0.5) * 1.4;
    let x, y;
    if (g.icons.length === 1) [x, y] = clear(g.x1 + big * 0.2, g.y1 - big * 0.1, big, 0.7, 0.7);
    else if (g.row) [x, y] = clear(g.x0 - big * 0.25, (g.y0 + g.y1) / 2 + big * 0.35, big, -1, 0.2);
    else [x, y] = clear(g.x1 - big * 0.1, g.y1 + big * 0.2, big, 0.3, 1);
    want.push({ x, y, rx: big, ry: big * 0.74, rot });
    if (g.icons.length >= 3 || gi === 0) {
      const sm = 9 + k * 4, a = rot + 2.2;
      const [sx, sy] = clear(x + Math.cos(a) * (big + sm * 1.6), y + Math.sin(a) * (big + sm * 1.6), sm, Math.cos(a), Math.sin(a));
      want.push({ x: sx, y: sy, rx: sm, ry: sm * 0.78, rot: -rot });
    }
  });
  // the maple at the far end of the biggest island (rows: right end, columns: right side)
  const g = gs.find(o => o.icons.length >= 2) || gs[0];
  if (g && P.maple > 0.5) {
    let x, y;
    if (g.row) [x, y] = clear(g.x1 + CROWN_R * 0.25, (g.y0 + g.y1) / 2 + CROWN_R * 0.55, CROWN_R * 0.8, 1, 0.3);
    else [x, y] = clear(g.x1 + CROWN_R * 0.4, g.y0 + Math.min(g.y1 - g.y0, 200) * 0.55, CROWN_R * 0.8, 1, 0.15);
    if (!tree.on) { tree.x = x; tree.y = y; }
    tree.on = true; tree.tx = x; tree.ty = y;
  } else tree.on = false;
  // match old stones to new spots so they glide instead of jumping
  const next = want.map(w => {
    let best = null, bd = 1e9;
    for (const o of stones) { const d = Math.hypot(o.x - w.x, o.y - w.y); if (d < bd && !o.used) { bd = d; best = o; } }
    const to = { wx: w.x, wy: w.y, wrx: w.rx, wry: w.ry, rot: w.rot, used: false };
    if (best && !instant && bd < 600) { best.used = true; return { ...to, fx: best.x, fy: best.y, frx: best.rx, fry: best.ry, k: 0, x: best.x, y: best.y, rx: best.rx, ry: best.ry }; }
    return { ...to, fx: w.x, fy: w.y, frx: instant ? w.rx : 0, fry: instant ? w.ry : 0, k: instant ? 1 : 0, x: w.x, y: w.y, rx: instant ? w.rx : 0, ry: instant ? w.ry : 0 };
  });
  stones = next;
  nStones = stones.length;
  if (instant) placeFallen();
}
function stepWorld(dt) {
  for (const s of stones) {
    s.k = Math.min(1, s.k + dt / 2.2);
    const e = s.k * s.k * (3 - 2 * s.k);
    s.x = mix(s.fx, s.wx, e); s.y = mix(s.fy, s.wy, e);
    s.rx = mix(s.frx, s.wrx, e); s.ry = mix(s.fry, s.wry, e);
  }
  for (let i = 0; i < MAX_STONES; i++) {
    const s = stones[i], o = i * 4;
    if (s) { STONES[o] = s.x; STONES[o + 1] = s.y; STONES[o + 2] = Math.max(0.5, s.rx); STONES[o + 3] = Math.max(0.5, s.ry); STONE_ROT[i] = s.rot; }
  }
  const k = Math.min(1, dt * 1.2);
  tree.x += (tree.tx - tree.x) * k; tree.y += (tree.ty - tree.y) * k;
  tree.a = clamp(tree.a + (tree.on ? dt : -dt) * 0.7, 0, 1);
  tree.shake = Math.max(0, tree.shake - dt);
}

/* ======================================================================
   Leaves: some lie on the gravel, now and then one drifts down from the maple
   ====================================================================== */
const leaves = Array.from({ length: 16 }, () => ({ on: false }));
let nextLeaf = 20 + Math.random() * 30;
function dropLeaf(fromTree) {
  const l = leaves.find(o => !o.on); if (!l) return;
  const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * CROWN_R * 0.8;
  Object.assign(l, {
    on: true, x: tree.x + Math.cos(a) * r, y: tree.y + Math.sin(a) * r, z: fromTree ? 1 : 0, rot: Math.random() * TAU,
    spin: (Math.random() - 0.5) * 3, v: (Math.random() * 3) | 0, age: 0, rest: 150 + Math.random() * 150, ph: Math.random() * TAU,
  });
}
function placeFallen() {
  for (const l of leaves) l.on = false;
  if (!tree.on) return;
  const R = rng(91);
  for (let i = 0; i < 4; i++) {
    const a = R() * TAU, r = CROWN_R * (1.4 + R() * 3.5);
    const x = tree.tx + Math.cos(a) * r, y = tree.ty + Math.sin(a) * r;
    if (x < 10 || y < 10 || x > W - 10 || y > H - 10 || overIcon(x, y, 8)) continue;
    const l = leaves.find(o => !o.on);
    Object.assign(l, { on: true, x, y, z: 0, rot: R() * TAU, spin: 0, v: (R() * 3) | 0, age: 0, rest: 1e9, ph: 0 });
  }
}
function stepLeaves(dt, t) {
  if (tree.on && P.leaves > 0 && (nextLeaf -= dt * P.leaves) <= 0) { nextLeaf = 25 + Math.random() * 45; dropLeaf(true); }
  for (const l of leaves) {
    if (!l.on) continue;
    l.age += dt;
    if (l.z > 0) {
      const w = windAt(l.x, l.y, t);
      l.ph += dt;
      l.z = Math.max(0, l.z - dt / 7);
      l.x += (WIND_DIR[0] * (6 + 14 * w) + Math.sin(l.ph * 1.7) * 9) * dt;
      l.y += (WIND_DIR[1] * (6 + 14 * w) + Math.cos(l.ph * 1.3) * 5 + 3) * dt;
      l.rot += l.spin * dt;
    } else if (l.age > l.rest) l.on = false;
  }
}

/* ======================================================================
   The sparrow: lands on the gravel now and then, hops and pecks, flees from the cursor
   ====================================================================== */
const bird = { mode: 'away', x: 0, y: 0, tx: 0, ty: 0, hd: 0, t: 40 + Math.random() * 50, z: 0, f: 0, hop: 0 };
function spotNearMoss() {
  for (let k = 0; k < 30; k++) {
    const x = 80 + Math.random() * (W - 160), y = 80 + Math.random() * (H - 160), s = sTarget(x, y);
    if (s > 25 && s < 160 && !overIcon(x, y, 20)) return [x, y];
  }
  return [W * 0.5, H * 0.55];
}
function flyAway(dt0) {
  bird.mode = 'leave'; bird.t = 0;
  const a = Math.atan2(bird.y - PTR().y, bird.x - PTR().x) + (Math.random() - 0.5) * 0.8;
  bird.tx = bird.x + Math.cos(a) * 2600; bird.ty = bird.y + Math.sin(a) * 2600;
  void dt0;
}
function stepBird(dt) {
  const pt = PTR();
  if (bird.mode === 'away') {
    if (P.birds < 0.5) return;
    if ((bird.t -= dt) > 0) return;
    const [x, y] = spotNearMoss();
    const a = Math.random() * TAU;
    Object.assign(bird, { mode: 'arrive', x: x + Math.cos(a) * 1400, y: y + Math.sin(a) * 1400, tx: x, ty: y, z: 1, f: 0 });
    return;
  }
  bird.f += dt;
  if (bird.mode === 'arrive' || bird.mode === 'leave') {
    const dx = bird.tx - bird.x, dy = bird.ty - bird.y, d = Math.hypot(dx, dy);
    bird.hd = Math.atan2(dy, dx);
    const v = bird.mode === 'arrive' ? Math.min(260, 40 + d * 0.9) : 320;
    bird.x += Math.cos(bird.hd) * v * dt; bird.y += Math.sin(bird.hd) * v * dt;
    bird.z = bird.mode === 'arrive' ? clamp(d / 260, 0, 1) : Math.min(1, bird.z + dt * 1.5);
    if (bird.mode === 'arrive' && d < 3) { bird.mode = 'sit'; bird.t = 18 + Math.random() * 20; bird.hop = 1 + Math.random(); bird.z = 0; }
    if (bird.mode === 'leave' && (bird.x < -80 || bird.y < -80 || bird.x > W + 80 || bird.y > H + 80)) { bird.mode = 'away'; bird.t = 70 + Math.random() * 80; }
    return;
  }
  // sitting: hop now and then, peck, look around; the cursor or a click scares it off
  if (pt.in && !pt.icon && Math.hypot(pt.x - bird.x, pt.y - bird.y) < 90) { flyAway(); return; }
  bird.t -= dt; bird.hop -= dt;
  if (bird.hop <= 0) {
    if (Math.random() < 0.45) { bird.hd += (Math.random() - 0.5) * 2.2; bird.peck = 0.5; }
    else {
      const a = bird.hd + (Math.random() - 0.5) * 1.2, nx = bird.x + Math.cos(a) * 12, ny = bird.y + Math.sin(a) * 12;
      if (sTarget(nx, ny) > 8 && !overIcon(nx, ny, 14)) { bird.hd = a; bird.jx = nx; bird.jy = ny; bird.jt = 0.18; }
    }
    bird.hop = 0.6 + Math.random() * 1.6;
  }
  if (bird.jt > 0) { const k = Math.min(1, dt / bird.jt); bird.x += (bird.jx - bird.x) * k; bird.y += (bird.jy - bird.y) * k; bird.jt -= dt; }
  if (bird.peck > 0) bird.peck -= dt;
  if (bird.t <= 0) flyAway();
}

/* ======================================================================
   Cursor and clicks
   ====================================================================== */
const NOPTR = { in: false, x: -1e4, y: -1e4, vx: 0, vy: 0 };
const PTR = () => (page && page.ptr) || NOPTR;
const rip = new Float32Array(16).fill(-1);
let ripI = 0, lastPX = 0, lastPY = 0, lastIn = false;
function click(x, y) {
  if (bird.mode === 'sit' && Math.hypot(bird.x - x, bird.y - y) < 40) { flyAway(); return; }
  if (tree.on && Math.hypot(tree.x - x, tree.y - y) < CROWN_R) {
    tree.shake = 1.4;
    const n = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) dropLeaf(true);
    return;
  }
  if (sTarget(x, y) > 14) { rip[ripI * 4] = x; rip[ripI * 4 + 1] = y; rip[ripI * 4 + 2] = 0; ripI = (ripI + 1) % 4; }
}
function stepCursor(dt) {
  for (let i = 0; i < 4; i++) if (rip[i * 4 + 2] >= 0) rip[i * 4 + 2] += dt;
  const pt = PTR();
  trail.n = 0;
  if (pt.in && !pt.icon && lastIn) {
    const dx = pt.x - lastPX, dy = pt.y - lastPY, d = Math.hypot(dx, dy);
    if (d > 0.5 && d < 400) {
      const steps = Math.min(255, Math.ceil(d / 2)), s = pt.down ? 0.9 : 0.55;
      for (let i = 1; i <= steps; i++) {
        const x = lastPX + dx * i / steps, y = lastPY + dy * i / steps;
        if (sTarget(x, y) < 6) continue;           // the moss doesn't take a groove
        const o = trail.n++ * 3; trail.pts[o] = x; trail.pts[o + 1] = y; trail.pts[o + 2] = s;
      }
    }
  }
  lastIn = pt.in && !pt.icon; lastPX = pt.x; lastPY = pt.y;
  void dt;
}
function drawTrail(now) {
  const live = now - trail.last < 9500;
  if (!trail.n && !live) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, trail.fb);
  gl.viewport(0, 0, trail.w, trail.h);
  gl.enable(gl.BLEND);
  if (live) {
    // linear fade: about 8 s from full depth to smooth gravel
    gl.useProgram(FADE.p); gl.uniform1f(FADE.U.uA, 1 / 255);
    gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(VAO0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  if (trail.n) {
    gl.bindBuffer(gl.ARRAY_BUFFER, trail.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, trail.pts, 0, trail.n * 3);
    gl.useProgram(DOTS.p); gl.uniform2f(DOTS.U.uRes, W, H); gl.uniform1f(DOTS.U.uSize, Math.max(3, 15 * CW / W * 0.5));
    gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(trail.vao); gl.drawArrays(gl.POINTS, 0, trail.n);
    trail.last = now;
  }
  gl.blendEquation(gl.FUNC_ADD);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ======================================================================
   Frame
   ====================================================================== */
function build(t) {
  sprites.begin();
  const L0 = sprites.layer(true);
  for (const l of leaves) if (l.on && l.z <= 0) {
    const fade = Math.min(1, (l.rest - l.age) / 3);
    sprites.push(l.x, l.y, 15, 15, l.rot, 0.06, SPR.leaf[l.v], 1, 1, 1, fade);
  }
  if (bird.mode === 'sit') {
    const pose = bird.peck > 0 ? 1 : 0, bob = bird.jt > 0 ? 2.5 : 0;
    sprites.push(bird.x, bird.y - bob, 38, 38, bird.hd, 0.08 + bob * 0.05, SPR.sparrow[pose], 1, 1, 1, 1);
  }
  sprites.end(L0);
  const L1 = sprites.layer(true);
  if (tree.on || tree.a > 0) {
    const w = windAt(tree.x, tree.y, t), sh = tree.shake > 0 ? Math.sin(tree.shake * 26) * tree.shake * 0.03 : 0;
    const sway = Math.sin(t * 0.7) * 0.012 * (0.4 + w) + sh, s = CROWN * (0.96 + 0.04 * tree.a);
    sprites.push(tree.x + WIND_DIR[0] * w * 1.2, tree.y + WIND_DIR[1] * w * 1.2, s, s, sway, 0.75, SPR.crown, 1, 1, 1, tree.a);
  }
  sprites.end(L1);
  const L2 = sprites.layer(true);
  for (const l of leaves) if (l.on && l.z > 0) {
    const s = 15 * (1 + l.z * 0.25), flip = Math.abs(Math.sin(l.ph * 2.2)) * 0.6 + 0.4;
    sprites.push(l.x, l.y, s, s * flip, l.rot, 0.1 + l.z * 1.6, SPR.leaf[l.v], 1, 1, 1, 1);
  }
  if (bird.mode === 'arrive' || bird.mode === 'leave') {
    const fr = 2 + (Math.floor(bird.f * 18) % 2), s = 38 * (1 + bird.z * 0.15);
    sprites.push(bird.x, bird.y, s, s, bird.hd, 0.1 + bird.z * 2.4, SPR.sparrow[bird.z < 0.05 ? 0 : fr], 1, 1, 1, 1);
  }
  sprites.end(L2);
  sprites.upload();
}
function baseDirty(now) {
  if (base.dirty || morph.moving || now - trail.last < 9500) return true;
  for (let i = 0; i < 4; i++) if (rip[i * 4 + 2] >= 0 && rip[i * 4 + 2] < 15) return true;
  for (const s of stones) if (s.k < 1) return true;
  // the sun turns slowly through the day: redraw when it has moved a little
  return Math.abs(base.sun[0] - LIGHT.dir[0]) + Math.abs(base.sun[1] - LIGHT.dir[1]) > 0.01;
}
let baseDraws = 0;
function draw(now) {
  const t = secs(now);
  drawTrail(now);
  sprites.drawShadows(W, H, atlasTex, [LIGHT.dir[0] * -LIGHT.len * 0.5, LIGHT.dir[1] * -LIGHT.len * 0.5]);
  gl.bindVertexArray(VAO0);
  gl.disable(gl.BLEND);
  if (baseDirty(now)) {
    base.dirty = false; base.sun[0] = LIGHT.dir[0]; base.sun[1] = LIGHT.dir[1]; baseDraws++;
    gl.bindFramebuffer(gl.FRAMEBUFFER, base.fb);
    gl.viewport(0, 0, CW, CH);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, morph.tex[0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, morph.tex[1]);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, trail.tex);
    const { p, U } = GROUND;
    gl.useProgram(p);
    gl.uniform1i(U.uFA, 0); gl.uniform1i(U.uFB, 1); gl.uniform1i(U.uTrail, 3);
    gl.uniform1f(U.uMix, morph.k); gl.uniform1f(U.uScale, CW / W);
    gl.uniform1f(U.uRings, P.rings); gl.uniform1f(U.uLen, LIGHT.len);
    gl.uniform2f(U.uCv, CW, CH); gl.uniform2f(U.uGrid, field.Gw, field.Gh);
    gl.uniform2f(U.uSun, LIGHT.dir[0], LIGHT.dir[1]);
    gl.uniform1f(U.uNStones, nStones);
    gl.uniform4fv(U.uStones, STONES); gl.uniform1fv(U.uStoneRot, STONE_ROT);
    gl.uniform4fv(U.uRip, rip);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  gl.viewport(0, 0, CW, CH);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, base.tex);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sprites.shadowTex);
  const { p, U } = COMPOSE;
  gl.useProgram(p);
  gl.uniform1i(U.uBase, 0); gl.uniform1i(U.uShade, 2);
  gl.uniform1f(U.uScale, CW / W); gl.uniform1f(U.uNight, LIGHT.night);
  gl.uniform2f(U.uCv, CW, CH);
  gl.uniform2f(U.uDrift, WIND_DIR[0] * 7 * t, WIND_DIR[1] * 7 * t);
  gl.uniform3fv(U.uTint, LIGHT.tint); gl.uniform3fv(U.uWarm, LIGHT.warm);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  for (let i = 0; i < 3; i++) TINT[i] = LIGHT.tint[i] * mix(1, LIGHT.warm[i], 0.4);
  sprites.draw(W, H, atlasTex, TINT, CW, CH, 0, sprites.layers.length);
}
const TINT = new Float32Array(3);

/* ======================================================================
   Start
   ====================================================================== */
paintAll();
atlasTex = texture(gl, atlas.cv);
updateLight();
let first = true;
const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['reach', 'rings', 'maple', 'leaves', 'birds', 'byClock', 'hour'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc(); sprites.allocShadow(CW, CH); allocTrail(); allocBase();
    if (!first) layout(true);
  },
  icons(list, isFirst, prev) {
    icons = list;
    if (!isFirst) { const { added } = diffIcons(prev, list); for (const a of added.slice(0, 2)) click(a.x + a.w / 2, a.y + a.h + 30); }
    layout(isFirst || first);
    first = false;
  },
  settings(keys) {
    if (keys.includes('reach') || keys.includes('maple')) layout(false);
    base.dirty = true;
    if (keys.includes('hour') || keys.includes('byClock')) updateLight();
    if (keys.includes('birds') && P.birds < 0.5 && bird.mode !== 'away') flyAway();
  },
  reseed() { field.reseed(); layout(true); },
  step(dt, now) {
    const t = secs(now);
    morph.tick(now);
    if (page && page.frame % 300 === 0) updateLight();
    stepWorld(dt); stepLeaves(dt, t); stepBird(dt); stepCursor(dt);
    build(t);
  },
  draw,
  click,
  stats: () => `sprites ${sprites.n} · stones ${nStones} · ground redraws ${baseDraws}`,
});

window.__dbg = {
  P, LIGHT, bird, tree, leaves, click, stones: () => stones,
  bird_in() { bird.t = 0; },
  birdAt(x, y) { Object.assign(bird, { mode: 'sit', x, y, t: 30, hop: 1, z: 0, hd: 0.4 }); },
  leafAt(x, y, z) { const l = leaves.find(o => !o.on); Object.assign(l, { on: true, x, y, z, rot: 0.5, spin: 1, v: 1, age: 0, rest: 300, ph: 1 }); },
  set(k, v) { P[k] = v; if (k === 'hour') { P.byClock = 0; updateLight(); } else layout(false); },
};
