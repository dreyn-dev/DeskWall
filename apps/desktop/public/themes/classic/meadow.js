// DeskWall · Meadow ("Луг").
// A soft summer meadow seen from above. Every icon rests on a white cloud; icons side by side
// share one cloud. Clouds cast deep green shadows on the grass, a few free clouds drift over,
// flowers bloom around the clouds, a child flies a kite and a cat roams. Light follows the
// clock; one wind combs the grass, bends the flowers, pulls the kite and moves the clouds.
import {
  QS, TAU, clamp, mix, sstep, easeBack, hash, Field, Morph, iconRects, STEP,
  dayLight, clockHour, windAt, WIND_DIR, WIND_GLSL, NOISE_GLSL, FULL_VS, makeGL, program, texture, Atlas, Sprites,
  runPage, diffIcons, rng,
} from './kit.js';

/* ======================================================================
   Parameters (keys match apps/desktop/src/shared/themes.ts)
   ====================================================================== */
const P = { sigma: 72, cover: 0.3, flow: 1, showBoy: 1, showCat: 1, flowers: 1, byClock: 1, hour: 14, cap30: true };
const DEFAULTS = { ...P };
if (QS.has('hour')) { P.byClock = 0; P.hour = +QS.get('hour'); }

const LIGHT_KEYS = [
  [0, [0.66, 0.72, 0.86], [0.92, 0.96, 1.06], 30], [4.8, [0.66, 0.72, 0.86], [0.92, 0.96, 1.06], 30],
  [6.4, [1.0, 0.93, 0.9], [1.05, 0.95, 0.9], 70], [8.5, [1.0, 0.98, 0.95], [1.03, 1.0, 0.95], 56],
  [12.5, [1.0, 1.0, 1.0], [1.0, 1.0, 1.0], 42], [16.5, [1.01, 0.99, 0.95], [1.03, 1.0, 0.95], 54],
  [18.8, [1.03, 0.95, 0.86], [1.06, 0.96, 0.86], 74], [20.3, [0.8, 0.77, 0.89], [1.0, 0.88, 0.92], 44],
  [21.8, [0.66, 0.72, 0.86], [0.92, 0.96, 1.06], 30], [24, [0.66, 0.72, 0.86], [0.92, 0.96, 1.06], 30],
];
const LIGHT = { tint: [1, 1, 1], warm: [1, 1, 1], len: 42, night: 0, dir: [-0.6, -0.8] };
const updateLight = () => dayLight(LIGHT_KEYS, P.byClock ? clockHour() : P.hour, LIGHT);
const CLOUD_LIFT = 3.2;   // cloud height in shadow units

/* ======================================================================
   Shaders. Shared: icon field + free clouds + lumpy outline → cloud distance.
   ====================================================================== */
const COMMON = `
${NOISE_GLSL}
${WIND_GLSL}
uniform sampler2D uFA, uFB;
uniform float uMix, uT, uScale, uFlow;
uniform vec2 uCv, uGrid, uSun, uDrift;
uniform vec4 uFree[8];
uniform vec4 uPoke[4];
float field(vec2 p) { vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid; return mix(texture(uFA, uv).r, texture(uFB, uv).r, uMix); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float body(vec2 p) {
  float d = field(p);
  for (int i = 0; i < 8; i++) {
    vec4 c = uFree[i]; if (c.z <= 0.0) continue;
    vec2 q = (p - c.xy) / c.zw;
    d = smin(d, (length(q) - 1.0) * min(c.z, c.w), 36.0);
  }
  // a tap on a cloud: it puffs up around the spot and settles back with a little wobble
  for (int i = 0; i < 4; i++) {
    vec4 k = uPoke[i]; if (k.z < 0.0 || k.z > 3.0) continue;
    float e = exp(-k.z * 2.0) * (1.0 + 0.35 * sin(k.z * 11.0));
    d -= 16.0 * e * exp(-dot(p - k.xy, p - k.xy) / 5200.0);
  }
  return d;
}
// F1, F2 and the nearest feature point of a jittered grid (cell units)
vec4 cell2(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0; vec2 best = vec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y), c = o + 0.15 + 0.7 * h22(i + o); float d = length(c - f);
    if (d < d1) { d2 = d1; d1 = d; best = c - f; } else if (d < d2) d2 = d;
  }
  return vec4(d1, d2, best);
}
// signed distance to the puffy outline (< 0 inside). lobes: big cell info for shading
float cloud(vec2 p, out vec4 lobe) {
  vec2 q = p - uDrift;
  lobe = cell2(q / 40.0 + 1.3);
  vec4 small = cell2(q / 19.0 + 3.7);
  float bump = (0.6 - lobe.x) * 40.0 * 0.6 + (0.6 - small.x) * 19.0 * 0.35;
  return body(p) - bump - 6.0;
}
float cloudCoarse(vec2 p) { vec4 l = cell2((p - uDrift) / 40.0 + 1.3); return body(p) - (0.6 - l.x) * 40.0 * 0.6 - 6.0; }
`;
const GROUND_FS = `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D uShade;
uniform float uCloudOff, uNight;
uniform vec3 uTint, uWarm;
uniform vec4 uRings[6];
out vec4 o;
const vec3 G_SUN = vec3(0.80, 0.87, 0.55), G_MID = vec3(0.67, 0.79, 0.45), G_LUSH = vec3(0.56, 0.72, 0.38);
const vec3 INK = vec3(0.27, 0.42, 0.2), SHADE = vec3(0.40, 0.58, 0.38);
float segment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
// hatching: in each 16×10 cell a little group of 1–3 parallel dashes; groups thin out in patches
float hatch(vec2 p, float lean) {
  const vec2 C = vec2(16.0, 10.0);
  vec2 c0 = floor(p / C); float ink = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 0; i++) {
    vec2 c = c0 + vec2(float(i), float(j)); vec2 base = c * C;
    float hc = h21(c * 1.37 + 11.0);
    float dens = smoothstep(0.4, 0.72, fbm3(base * 0.0045)) * 0.75 + 0.06;
    if (hc > dens) continue;
    vec2 at = base + h22(c + 4.1) * C;
    float ang = (vn(base * 0.002 + 7.0) - 0.5) * 0.9 + lean;
    vec2 dir = vec2(cos(ang), sin(ang)), nrm = vec2(-dir.y, dir.x);
    float n = 1.0 + floor(h21(c + 8.3) * 3.0), len = 2.6 + 2.6 * h21(c + 2.9);
    for (int k = 0; k < 3; k++) {
      if (float(k) >= n) break;
      vec2 m = at + nrm * (float(k) * 2.6) + dir * (h21(c + float(k)) - 0.5) * 2.0;
      float d = segment(p, m - dir * len, m + dir * len);
      ink = max(ink, (1.0 - smoothstep(0.25, 0.95, d)) * (0.45 + 0.4 * h21(c + 5.0 + float(k))));
    }
  }
  return ink;
}
float shade() {
  vec2 uv = gl_FragCoord.xy / uCv, e = 2.5 / uCv;
  return (texture(uShade, uv).r * 2.0 + texture(uShade, uv + vec2(e.x, 0)).r + texture(uShade, uv - vec2(e.x, 0)).r
        + texture(uShade, uv + vec2(0, e.y)).r + texture(uShade, uv - vec2(0, e.y)).r) / 6.0;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y) / uScale;
  float t = uT, w = windAt(p, t);
  // watercolour wash: sunny yellow-green and lusher patches, soft blooms of pigment
  float w1 = fbm3(p * 0.0023 + 1.7), w2 = fbm3(p * 0.0061 - 4.2), w3 = vn(p * 0.019);
  vec3 col = mix(G_MID, G_SUN, smoothstep(0.32, 0.72, w1 * 0.7 + w2 * 0.3));
  col = mix(col, G_LUSH, smoothstep(0.58, 0.8, w2) * 0.55);
  col *= 0.975 + 0.05 * w3;
  // wind sheen: grass bends in the gusts and shows its lighter side
  col = mix(col, col * 1.07 + vec3(0.03, 0.03, 0.0), smoothstep(0.35, 1.0, w) * 0.55);
  // hatched grass, leaning with the wind
  col = mix(col, INK, hatch(p, (w - 0.22) * 0.5) * 0.62);
  // paper grain
  col *= 1.0 + (h21(floor(p * uScale)) - 0.5) * 0.035;
  // shadows: small things (flowers, cat, child, kite) and the clouds overhead
  float sh = shade();
  col *= mix(vec3(1.0), vec3(0.74, 0.8, 0.74), sh * 0.7);
  float cs = 1.0 - smoothstep(-10.0, 10.0, cloudCoarse(p + uSun * uCloudOff));
  col = mix(col, col * SHADE / G_MID * 0.86, cs * 0.88);
  // rings where an icon lands: a breath of wind across the grass
  for (int i = 0; i < 6; i++) {
    vec4 r = uRings[i]; if (r.z < 0.0 || r.z > 4.0) continue;
    float rr = 30.0 + r.z * 140.0, dd = length(p - r.xy);
    col *= 1.0 + exp(-pow((dd - rr) / 14.0, 2.0)) * exp(-r.z * 1.1) * 0.12;
  }
  col *= mix(vec3(1.0), uWarm, 0.6) * uTint;
  col = mix(col, col * vec3(0.84, 0.9, 1.1), uNight * 0.5);
  o = vec4(col, 1.0);
}`;
const CLOUD_FS = `#version 300 es
precision highp float;
${COMMON}
uniform vec3 uTint, uWarm;
uniform float uNight;
out vec4 o;
// overlapping round puffs: which puff is on top here, its centre offset and radius (cell units)
vec4 puffs(vec2 q, out float edge) {
  vec2 i = floor(q), f = fract(q); float top = -1.0; vec4 best = vec4(0.0, 0.0, 0.0, -1.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y), id = i + o, c = o + 0.15 + 0.7 * h22(id); vec2 v = c - f;
    float r = 0.52 + 0.3 * h21(id + 2.3), d = length(v), pr = h21(id + 9.1);
    if (d < r && pr > top) { top = pr; best = vec4(v, r, pr); }
  }
  edge = best.w < 0.0 ? 1.0 : best.z - length(best.xy);
  return best;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y) / uScale;
  vec4 lobe;
  float d = cloud(p, lobe);
  float a = 1.0 - smoothstep(-1.0, 1.0, d * uScale);
  if (a <= 0.0) { o = vec4(0); return; }
  const float CELL = 50.0;
  float edge; vec4 pf = puffs((p - uDrift) / CELL + 1.3, edge);
  vec3 L = normalize(vec3(uSun, 0.8));
  float lit = 0.75;
  if (pf.w >= 0.0) {
    vec2 n2 = -pf.xy / pf.z;
    vec3 N = normalize(vec3(n2, sqrt(max(0.0, 1.0 - dot(n2, n2))) + 0.15));
    lit = clamp(dot(N, L) * 0.55 + 0.45, 0.0, 1.0);
  }
  // the whole cloud: the side away from the sun is cooler
  float side = clamp((cloudCoarse(p + uSun * 22.0) - cloudCoarse(p)) / 22.0, -1.0, 1.0);
  vec3 WHITE = vec3(0.99, 0.995, 1.0), COOL = vec3(0.79, 0.84, 0.93), CREASE = vec3(0.83, 0.87, 0.95);
  vec3 col = mix(COOL, WHITE, clamp(lit * 0.7 + 0.3 + side * 0.22, 0.0, 1.0));
  // a soft line where one puff lies over another (only inside the cloud)
  float line = (1.0 - smoothstep(0.0, 2.2 / CELL, edge)) * smoothstep(3.0, 10.0, -d);
  col = mix(col, CREASE, line * 0.42);
  // crisp bright rim on the sunny edge, cool rim on the shaded one
  col = mix(col, vec3(1.0), smoothstep(-7.0, -1.0, d) * clamp(side, 0.0, 1.0) * 0.8);
  col = mix(col, COOL * 0.97, smoothstep(-6.0, -1.0, d) * clamp(-side, 0.0, 1.0) * 0.45);
  col *= mix(vec3(1.0), uWarm, 0.8) * uTint;
  col = mix(col, col * vec3(0.86, 0.9, 1.08), uNight * 0.4);
  o = vec4(col * a, a);
}`;

/* ======================================================================
   Painted sprites
   ====================================================================== */
const atlas = new Atlas(1024);
const SPR = {};
const R = rng(5150);
function petals(g, S, n, len, wid, fill, center, cr) {
  const c = S / 2;
  g.translate(c, c); g.rotate(R() * TAU);
  g.fillStyle = fill;
  for (let i = 0; i < n; i++) { g.rotate(TAU / n); g.beginPath(); g.ellipse(len * 0.55, 0, len * 0.5, wid, 0, 0, TAU); g.fill(); }
  g.fillStyle = center; g.beginPath(); g.arc(0, 0, cr, 0, TAU); g.fill();
}
function paintLeaves(g, S) {
  const c = S / 2; g.translate(c, c);
  for (let i = 0; i < 5; i++) {
    g.rotate(TAU / 5 + (R() - 0.5) * 0.4);
    g.fillStyle = i % 2 ? '#5c8f3c' : '#6fa246';
    g.beginPath(); g.ellipse(S * 0.2, 0, S * 0.22, S * 0.07, 0, 0, TAU); g.fill();
  }
}
function paintButterfly(g, S, k, c) {
  const u = S / 32; g.translate(S / 2, S / 2); g.scale(u, u);
  const sp = 0.35 + 0.65 * k;
  for (const s of [-1, 1]) {
    g.fillStyle = c[0]; g.beginPath(); g.ellipse(2, s * 5.5 * sp, 5, 5.5 * sp, s * 0.3, 0, TAU); g.fill();
    g.fillStyle = c[1]; g.beginPath(); g.ellipse(-3.5, s * 4 * sp, 3.6, 4 * sp, -s * 0.3, 0, TAU); g.fill();
    g.fillStyle = c[2]; g.beginPath(); g.arc(3, s * 7 * sp, 1.3 * sp + 0.4, 0, TAU); g.fill();
  }
  g.fillStyle = '#2a2622'; g.beginPath(); g.ellipse(0, 0, 6, 1.1, 0, 0, TAU); g.fill();
}
const BFLY = [['#f6f2e6', '#ece6d4', '#3a3a3a'], ['#f2d65a', '#e9c84a', '#b8761c'], ['#e98a3a', '#d06a28', '#2b2b2b'], ['#9cc0ee', '#86aee2', '#f4f4f4']];
// cat from above, facing +x. pose: walk frames 0..3, 4 sitting, 5 curled asleep
function paintCat(g, S, pose) {
  const u = S / 64; g.translate(S / 2, S / 2); g.scale(u, u);
  const FUR = '#e39a52', DARK = '#c4783a', LIGHT = '#f3c08a';
  g.lineCap = 'round';
  if (pose === 5) {
    g.fillStyle = FUR; g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.fill();
    g.strokeStyle = DARK; g.lineWidth = 4.2; g.beginPath(); g.arc(0, 0, 11.5, 0.6, 3.6); g.stroke();
    g.fillStyle = LIGHT; g.beginPath(); g.arc(5, -3, 5.4, 0, TAU); g.fill();
    g.fillStyle = FUR; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(7 + s * 2.6, -6.5); g.lineTo(9.5 + s * 1.2, -11); g.lineTo(10.5 + s * 3.6, -6); g.fill(); }
    g.strokeStyle = 'rgba(120,70,30,.5)'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(0, 0, 6 + i * 1.5, 2.4 + i * 0.2, 3.2 + i * 0.2); g.stroke(); }
    return;
  }
  const sit = pose === 4, f = pose % 4, step = [0, 1, 0, -1][f] * (sit ? 0 : 1);
  // tail
  g.strokeStyle = DARK; g.lineWidth = 3.4;
  g.beginPath(); g.moveTo(-10, 0);
  if (sit) g.quadraticCurveTo(-12, 12, 2, 13); else g.quadraticCurveTo(-18, step * 4, -24, step * 6 + 3);
  g.stroke();
  // legs
  if (!sit) {
    g.fillStyle = DARK;
    for (const [lx, side, ph] of [[7, -1, 1], [7, 1, -1], [-7, -1, -1], [-7, 1, 1]]) { g.beginPath(); g.ellipse(lx + step * ph * 3, side * 6, 2.6, 1.8, 0, 0, TAU); g.fill(); }
  }
  g.fillStyle = FUR; g.beginPath(); g.ellipse(sit ? -2 : 0, 0, sit ? 10 : 13, sit ? 9 : 6.5, 0, 0, TAU); g.fill();
  g.strokeStyle = DARK; g.lineWidth = 1.6;
  for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 3.6 - 1, -5); g.quadraticCurveTo(i * 3.6 + 0.5, 0, i * 3.6 - 1, 5); g.stroke(); }
  const hx = sit ? 9 : 13;
  g.fillStyle = FUR; g.beginPath(); g.ellipse(hx, 0, 5.6, 5.2, 0, 0, TAU); g.fill();
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(hx - 1, s * 3); g.lineTo(hx + 1, s * 7.6); g.lineTo(hx + 3.6, s * 3.2); g.fill(); }
  g.fillStyle = LIGHT; g.beginPath(); g.ellipse(hx + 3, 0, 2.4, 2.2, 0, 0, TAU); g.fill();
}
// child from above, facing +x: hair, shoulders in a red t-shirt, arms; f: step frame
function paintChild(g, S, f) {
  const u = S / 34; g.translate(S / 2, S / 2); g.scale(u, u);
  const st = [0, 1, 0, -1][f];
  g.fillStyle = '#3b5a8a';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(st * s * 3, s * 3.2, 3.2, 2.1, 0, 0, TAU); g.fill(); }   // feet / legs
  g.fillStyle = '#e2563c'; g.beginPath(); g.ellipse(0, 0, 4.6, 8, 0, 0, TAU); g.fill();                    // shoulders
  g.strokeStyle = '#f0c8a0'; g.lineWidth = 2.2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(1, -6.5); g.lineTo(7.5, -3.5); g.moveTo(1, 6.5); g.lineTo(7.5, 3.2); g.stroke();   // arms up front
  g.fillStyle = '#5a3a22'; g.beginPath(); g.arc(0.5, 0, 4.3, 0, TAU); g.fill();                             // hair
  g.fillStyle = '#6e4a2c'; g.beginPath(); g.arc(-0.3, -1, 2, 0, TAU); g.fill();
}
function paintKite(g, S) {
  const c = S / 2; g.translate(c, c); g.rotate(-Math.PI / 2);
  const L = S * 0.42, Wd = S * 0.3;
  const quad = (a, b, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.closePath(); g.fill(); };
  const T = [0, -L], Rr = [Wd, -L * 0.25], B = [0, L], Lf = [-Wd, -L * 0.25];
  quad(T, Rr, '#f2c23a'); quad(Rr, B, '#e2563c'); quad(B, Lf, '#3f8fd6'); quad(Lf, T, '#f6f2e6');
  g.strokeStyle = 'rgba(60,40,30,.6)'; g.lineWidth = S * 0.02;
  g.beginPath(); g.moveTo(T[0], T[1]); g.lineTo(B[0], B[1]); g.moveTo(Lf[0], Lf[1]); g.lineTo(Rr[0], Rr[1]); g.stroke();
}
function paintBow(g, S, col) {
  const c = S / 2; g.translate(c, c); g.fillStyle = col;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, 0); g.lineTo(s * S * 0.4, -S * 0.25); g.lineTo(s * S * 0.4, S * 0.25); g.closePath(); g.fill(); }
}
function paintDot(g, S) { g.fillStyle = '#fff'; g.fillRect(0, S * 0.25, S, S * 0.5); }
function paintBalloon(g, S) {
  const c = S / 2, r = S * 0.46; g.translate(c, c);
  const cols = ['#e2563c', '#f2c23a', '#f6f2e6', '#3f8fd6'];
  for (let i = 0; i < 12; i++) {
    g.fillStyle = cols[i % 4]; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, (i / 12) * TAU, ((i + 1) / 12) * TAU); g.closePath(); g.fill();
  }
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,40,.25)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
}
function paintSwallow(g, S, k) {
  const u = S / 40; g.translate(S / 2, S / 2); g.scale(u, u);
  const sp = 6 + 10 * k;
  g.fillStyle = '#26324a';
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(3, s * 1.5); g.quadraticCurveTo(0, s * sp, -6, s * (sp + 2)); g.quadraticCurveTo(-3, s * sp * 0.4, -3, s * 1.5); g.fill(); }
  g.beginPath(); g.ellipse(1, 0, 6, 2.3, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(-4, 0); g.lineTo(-11, -3); g.lineTo(-7, 0); g.lineTo(-11, 3); g.fill();
  g.fillStyle = '#c4553a'; g.beginPath(); g.arc(6, 0, 1.4, 0, TAU); g.fill();
}
function paintWisp(g, S) {
  const c = S / 2, gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.55, 'rgba(250,252,255,.6)'); gr.addColorStop(1, 'rgba(240,245,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
}
function paintAll() {
  SPR.wisp = atlas.paint(24, paintWisp);
  SPR.flower = {
    daisy: [0, 1].map(() => atlas.paint(14, (g, S) => petals(g, S, 11, S * 0.42, S * 0.07, '#fbfaf3', '#f1c232', S * 0.12))),
    butter: [0, 1].map(() => atlas.paint(11, (g, S) => petals(g, S, 5, S * 0.4, S * 0.15, '#f6d23a', '#d9a21c', S * 0.08))),
    clover: [0, 1].map(() => atlas.paint(10, (g, S) => petals(g, S, 14, S * 0.34, S * 0.06, '#e48fb4', '#c2648e', S * 0.14))),
    corn: [0, 1].map(() => atlas.paint(11, (g, S) => petals(g, S, 8, S * 0.4, S * 0.09, '#5f8fe0', '#3c5fb0', S * 0.08))),
    puff: [0].map(() => atlas.paint(12, (g, S) => petals(g, S, 22, S * 0.42, S * 0.03, 'rgba(255,255,255,.85)', '#d8d2b8', S * 0.08))),
  };
  SPR.leaves = [0, 1, 2].map(() => atlas.paint(16, paintLeaves));
  SPR.bfly = BFLY.map(c => [1, 0.55, 0.15].map(k => atlas.paint(18, (g, S) => paintButterfly(g, S, k, c))));
  SPR.cat = [0, 1, 2, 3, 4, 5].map(p => atlas.paint(40, (g, S) => paintCat(g, S, p)));
  SPR.child = [0, 1, 2, 3].map(f => atlas.paint(30, (g, S) => paintChild(g, S, f)));
  SPR.kite = atlas.paint(40, paintKite);
  SPR.bow = ['#e2563c', '#f2c23a', '#3f8fd6'].map(c => atlas.paint(10, (g, S) => paintBow(g, S, c)));
  SPR.line = atlas.paint(4, paintDot);
  SPR.balloon = atlas.paint(110, paintBalloon);
  SPR.swallow = [1, 0.5, 0.1].map(k => atlas.paint(26, (g, S) => paintSwallow(g, S, k)));
}

/* ======================================================================
   GL
   ====================================================================== */
const cv = document.getElementById('art');
const gl = makeGL(cv);
const GROUND = program(gl, FULL_VS, GROUND_FS);
const CLOUD = program(gl, FULL_VS, CLOUD_FS);
const VAO0 = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2600);
const sprites = new Sprites(gl, 3000);
let atlasTex = null, W = 1, H = 1, CW = 1, CH = 1;
const T0 = performance.now();
const secs = now => (now - T0) / 1000;

/* ======================================================================
   World
   ====================================================================== */
let icons = [];
const nearIcon = (x, y, pad) => icons.some(ic => x > ic.x - pad && x < ic.x + ic.w + pad && y > ic.y - pad && y < ic.y + ic.h + pad);
const sNow = (x, y) => morph.at(x, y);
const sTarget = (x, y) => morph.target(x, y);
function computeClouds(instant) {
  const s = field.compute(iconRects(icons), { reach: P.sigma, warp: 34, wobble: 0.1, soft: P.sigma * 0.6, far: 900 });
  morph.set(s, instant);
  placeFlowers();
}
// flowers bloom in patches around the clouds; thinner further out
let flowers = [];
const KINDS = ['daisy', 'daisy', 'butter', 'clover', 'corn', 'butter', 'daisy', 'puff'];
function placeFlowers() {
  const out = [], cap = Math.round(200 * P.flowers);
  if (cap > 0) for (let gy = 0; gy * 22 < H; gy++) for (let gx = 0; gx * 22 < W; gx++) {
    const x = gx * 22 + hash(gx, gy, 51) * 22, y = gy * 22 + hash(gx, gy, 52) * 22, s = sTarget(x, y);
    if (s < -4 || s > 130 || nearIcon(x, y, 4)) continue;
    const patch = hash(Math.floor(x / 90), Math.floor(y / 90), 53);         // patches of one kind
    const dens = (0.6 - s / 210) * sstep(0.25, 0.75, patch);
    if (hash(gx, gy, 54) > dens) continue;
    const kind = KINDS[(patch * KINDS.length) | 0];
    out.push({ x, y, kind, v: (hash(gx, gy, 55) * 2) | 0, rot: hash(gx, gy, 56) * TAU, g: 0, delay: 0, leaves: hash(gx, gy, 57) < 0.35 });
    if (out.length >= cap) break;
  }
  for (const f of out) {
    const old = flowers.find(o => Math.abs(o.x - f.x) < 1 && Math.abs(o.y - f.y) < 1);
    if (old) { f.g = old.g; f.delay = old.delay; } else f.delay = 0.3 + Math.random() * 1.6;
  }
  flowers = out;
}
// free clouds drifting with the wind
const free = Array.from({ length: 8 }, (_, i) => ({ i, on: false, x: 0, y: 0, rx: 0, ry: 0, a: 0 }));
const FREE = new Float32Array(32);
function stepFree(dt) {
  const want = Math.round(P.cover * 8);
  const v = 10 * P.flow;
  for (const c of free) {
    if (!c.on) {
      if (c.i >= want) continue;
      c.on = true; c.rx = 70 + Math.random() * 90; c.ry = c.rx * (0.55 + Math.random() * 0.25); c.a = 0;
      // first fill: anywhere; later: upwind, just off screen
      if (!c.seen) { c.x = Math.random() * W; c.y = Math.random() * H; c.seen = true; }
      else { c.x = -c.rx * 2 - Math.random() * 200; c.y = Math.random() * (H + 200) - 100 - WIND_DIR[1] * 300; }
    }
    c.x += WIND_DIR[0] * v * dt; c.y += WIND_DIR[1] * v * dt;
    const k = c.i < want ? 1 : 0;
    c.a += (k - c.a) * Math.min(1, dt * 0.4);
    if (c.x - c.rx * 2 > W || c.y - c.ry * 2 > H || (k === 0 && c.a < 0.02)) c.on = false;
  }
  for (const c of free) {
    const o = c.i * 4;
    if (c.on) { FREE[o] = c.x; FREE[o + 1] = c.y; FREE[o + 2] = c.rx * c.a; FREE[o + 3] = c.ry * c.a; }
    else FREE[o + 2] = 0;
  }
}

/* ======================================================================
   Life
   ====================================================================== */
const kid = { on: false, x: 0, y: 0, hd: 0, tx: 0, ty: 0, t: 0, walk: false, f: 0, kx: 0, ky: 0, a: 0, ph: 0 };
const cat = { on: false, x: 0, y: 0, hd: 0, t: 0, mode: 'walk', f: 0, a: 0, tx: 0, ty: 0 };
const bflies = Array.from({ length: 5 }, (_, i) => ({ i, x: Math.random() * 1600, y: Math.random() * 900, tx: 0, ty: 0, hd: 0, ph: Math.random() * TAU, rest: 0, c: i % 4, a: 0 }));
const ST = { kind: null, t: 0, next: 60 + Math.random() * 60, a: [] };
const offScreen = (o, m) => o.x < -m || o.y < -m || o.x > W + m || o.y > H + m;
function wanderTarget(o, minS) {
  for (let k = 0; k < 20; k++) {
    const x = 60 + Math.random() * (W - 120), y = 60 + Math.random() * (H - 120);
    if (sTarget(x, y) > minS) { o.tx = x; o.ty = y; return; }
  }
  o.tx = W / 2; o.ty = H / 2;
}
function turnTo(o, ang, rate, dt) { const d = ((ang - o.hd + Math.PI) % TAU + TAU) % TAU - Math.PI; o.hd += clamp(d, -rate * dt, rate * dt); }
function stepKid(dt, t) {
  const want = P.showBoy > 0.5;
  if (!kid.on) {
    if (!want) return;
    Object.assign(kid, { on: true, a: 0, t: 0, walk: true });
    wanderTarget(kid, 30); kid.x = kid.tx; kid.y = kid.ty; wanderTarget(kid, 30);
    kid.hd = Math.atan2(kid.ty - kid.y, kid.tx - kid.x);
    kid.kx = kid.x + WIND_DIR[0] * 150; kid.ky = kid.y + WIND_DIR[1] * 150;
  }
  kid.a = clamp(kid.a + (want ? dt : -dt) * 0.8, 0, 1);
  if (!want && kid.a <= 0) { kid.on = false; return; }
  kid.t -= dt;
  if (kid.walk) {
    const dx = kid.tx - kid.x, dy = kid.ty - kid.y, d = Math.hypot(dx, dy);
    turnTo(kid, Math.atan2(dy, dx), 2, dt);
    kid.x += Math.cos(kid.hd) * 16 * dt; kid.y += Math.sin(kid.hd) * 16 * dt; kid.f += dt * 5;
    if (d < 12) { kid.walk = false; kid.t = 6 + Math.random() * 10; }
  } else {
    turnTo(kid, Math.atan2(WIND_DIR[1], WIND_DIR[0]), 1.2, dt);    // faces the kite
    if (kid.t <= 0) { kid.walk = true; wanderTarget(kid, 30); }
  }
  // the kite flies downwind, higher in a gust, swinging gently
  const w = windAt(kid.x, kid.y, t);
  kid.ph += dt;
  const reach = 150 + 50 * w, sw = Math.sin(kid.ph * 0.7) * 34 + Math.sin(kid.ph * 1.9) * 8;
  const tx = kid.x + WIND_DIR[0] * reach - WIND_DIR[1] * sw, ty = kid.y + WIND_DIR[1] * reach + WIND_DIR[0] * sw;
  kid.kx += (tx - kid.kx) * Math.min(1, dt * 0.8); kid.ky += (ty - kid.ky) * Math.min(1, dt * 0.8);
}
function stepCat(dt) {
  const want = P.showCat > 0.5;
  if (!cat.on) {
    if (!want) return;
    Object.assign(cat, { on: true, a: 0, mode: 'walk' });
    wanderTarget(cat, 10); cat.x = cat.tx; cat.y = cat.ty; wanderTarget(cat, 10);
  }
  cat.a = clamp(cat.a + (want ? dt : -dt), 0, 1);
  if (!want && cat.a <= 0) { cat.on = false; return; }
  cat.t -= dt;
  const pt = PTR();
  const sp2 = Math.hypot(pt.vx, pt.vy), dPtr = Math.hypot(pt.x - cat.x, pt.y - cat.y);
  if (pt.in && !pt.icon && cat.mode !== 'sleep' && dPtr < 340 && (sp2 > 30 || cat.mode === 'chase' || cat.mode === 'watch')) {
    if (dPtr > 22) {
      cat.mode = 'chase';
      turnTo(cat, Math.atan2(pt.y - cat.y, pt.x - cat.x), 6, dt);
      const v = Math.min(90, 30 + dPtr * 0.6);
      cat.x += Math.cos(cat.hd) * v * dt; cat.y += Math.sin(cat.hd) * v * dt; cat.f += dt * v / 6;
    } else { cat.mode = 'watch'; cat.t = 4; }
    return;
  }
  if (cat.mode === 'chase' || cat.mode === 'watch') { cat.mode = 'sit'; cat.t = 3 + Math.random() * 3; }
  if (cat.mode === 'walk' || cat.mode === 'pounce') {
    const fast = cat.mode === 'pounce';
    const dx = cat.tx - cat.x, dy = cat.ty - cat.y, d = Math.hypot(dx, dy);
    turnTo(cat, Math.atan2(dy, dx), fast ? 5 : 2.2, dt);
    const sp = fast ? 70 : 20;
    cat.x += Math.cos(cat.hd) * sp * dt; cat.y += Math.sin(cat.hd) * sp * dt; cat.f += dt * (fast ? 12 : 5);
    if (d < 8) {
      const r = Math.random();
      cat.mode = r < 0.45 ? 'sit' : r < 0.7 ? 'sleep' : 'walk';
      cat.t = cat.mode === 'sleep' ? 40 + Math.random() * 50 : 5 + Math.random() * 8;
      if (cat.mode === 'walk') wanderTarget(cat, 10);
    }
  } else if (cat.t <= 0) { cat.mode = 'walk'; wanderTarget(cat, 10); }
  // a butterfly landing nearby wakes the hunter
  if (cat.mode === 'sit') for (const b of bflies) if (b.rest > 0 && Math.hypot(b.x - cat.x, b.y - cat.y) < 110) { cat.mode = 'pounce'; cat.tx = b.x; cat.ty = b.y; b.rest = 0; break; }
}
function stepBflies(dt) {
  for (const b of bflies) {
    b.ph += dt;
    b.a = Math.min(1, b.a + dt * 0.3);
    if (b.rest > 0) {
      b.rest -= dt;
      const pt = PTR();
      if (pt.in && Math.hypot(b.x - pt.x, b.y - pt.y) < 80) b.rest = 0; else continue;
    }
    const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
    if (d < 6 || !b.tx) {
      if (b.tx && Math.random() < 0.5) b.rest = 2 + Math.random() * 6;
      const f = flowers.length ? flowers[(Math.random() * flowers.length) | 0] : null;
      if (f && Math.random() < 0.8) { b.tx = f.x; b.ty = f.y; } else { b.tx = Math.random() * W; b.ty = Math.random() * H; }
      continue;
    }
    const pt = PTR(), dp = Math.hypot(b.x - pt.x, b.y - pt.y);
    if (pt.in && dp < 80) { b.rest = 0; turnTo(b, Math.atan2(b.y - pt.y, b.x - pt.x), 8, dt); b.flee = 1; }
    else turnTo(b, Math.atan2(dy, dx) + Math.sin(b.ph * 3.1) * 0.9, 4, dt);
    b.flee = Math.max(0, (b.flee || 0) - dt);
    const v = 34 + 70 * b.flee;
    b.x += Math.cos(b.hd) * v * dt; b.y += Math.sin(b.hd) * v * dt;
  }
}
// rare scenes: a hot-air balloon drifting over, swallows swooping low
function startStory(kind) {
  ST.kind = kind; ST.t = 0;
  if (kind === 'balloon') ST.a = [{ x: -80, y: H * (0.2 + Math.random() * 0.5), hd: 0 }];
  else ST.a = [0, 1, 2].map(i => ({ i, x: -40 - i * 50, y: H * (0.3 + Math.random() * 0.4), hd: 0.2, ph: i }));
  return true;
}
function stepStory(dt) {
  if (!ST.kind) { if ((ST.next -= dt) <= 0) { ST.next = 100 + Math.random() * 110; startStory(Math.random() < 0.5 ? 'balloon' : 'swallows'); } return; }
  ST.t += dt;
  let alive = false;
  for (const a of ST.a) {
    if (ST.kind === 'balloon') { a.x += WIND_DIR[0] * 13 * P.flow * dt + 6 * dt; a.y += WIND_DIR[1] * 6 * dt; }
    else { a.ph += dt; a.hd += Math.sin(a.ph * 1.3 + a.i) * dt * 1.4; a.x += Math.cos(a.hd) * 160 * dt; a.y += Math.sin(a.hd) * 160 * dt; }
    if (!offScreen(a, 150) || ST.t < 3) alive = true;
  }
  if (!alive || ST.t > 300) ST.kind = null;
}

/* ======================================================================
   The cursor: the cat chases it like a laser dot, butterflies keep away. Clicks: a cloud
   puffs, flowers sprout from the grass, the kite does a loop, the cat sits and looks at you
   (three taps and it curls up for a nap).
   ====================================================================== */
const NOPTR = { in: false, x: -1e4, y: -1e4, vx: 0, vy: 0 };
const PTR = () => (page && page.ptr) || NOPTR;
const pokes = new Float32Array(16).fill(-1);
let pokeI = 0;
const wisps = Array.from({ length: 24 }, () => ({ on: false }));
const sprouts = [];
let catTaps = [];
function click(x, y) {
  const t = performance.now() / 1000;
  if (kid.on && (Math.hypot(kid.x - x, kid.y - y) < 26 || Math.hypot(kid.kx - x, kid.ky - y) < 30)) { kid.loop = 1.6; return; }
  if (cat.on && Math.hypot(cat.x - x, cat.y - y) < 28) {
    catTaps = catTaps.filter(q => t - q < 3); catTaps.push(t);
    if (catTaps.length >= 3) { cat.mode = 'sleep'; cat.t = 60; catTaps = []; }
    else { cat.mode = 'sit'; cat.t = 6; cat.hd = Math.atan2(y - cat.y, x - cat.x) + Math.PI; }
    return;
  }
  if (cloudAt(x, y)) {
    pokes[pokeI * 4] = x; pokes[pokeI * 4 + 1] = y; pokes[pokeI * 4 + 2] = 0; pokeI = (pokeI + 1) % 4;
    for (let i = 0; i < 5; i++) {
      const w = wisps.find(o => !o.on); if (!w) break;
      const a = Math.random() * TAU, sp = 20 + Math.random() * 30;
      Object.assign(w, { on: true, x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 2 + Math.random(), s: 16 + Math.random() * 14 });
    }
    return;
  }
  // grass: a little ring of flowers grows where you tapped
  const kind = KINDS[(Math.random() * KINDS.length) | 0], n = 5 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.random() * 0.4, r = i === 0 ? 0 : 9 + Math.random() * 12;
    sprouts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, kind, v: i % 2, rot: Math.random() * TAU, g: 0, delay: i * 0.12, life: 120 });
  }
  while (sprouts.length > 60) sprouts.shift();
}
// whether a point is under a cloud (CPU copy of the outline, without the lumps)
function cloudAt(x, y) {
  if (sNow(x, y) < 8) return true;
  for (const c of free) if (c.on && Math.hypot((x - c.x) / (c.rx * c.a || 1), (y - c.y) / (c.ry * c.a || 1)) < 1.1) return true;
  return false;
}
function stepInteract(dt) {
  for (let i = 0; i < 4; i++) if (pokes[i * 4 + 2] >= 0) pokes[i * 4 + 2] += dt;
  for (const w of wisps) if (w.on) { w.age += dt; w.x += w.vx * dt; w.y += w.vy * dt; w.vx *= 0.97; w.vy *= 0.97; if (w.age > w.life) w.on = false; }
  for (let i = sprouts.length - 1; i >= 0; i--) { const f = sprouts[i]; f.life -= dt; if (f.life <= 0) sprouts.splice(i, 1); }
  if (kid.loop > 0) kid.loop -= dt;
}

/* ======================================================================
   Frame
   ====================================================================== */
const rings = new Float32Array(24).fill(-1);
let ringI = 0;
const addRing = (x, y) => { rings[ringI * 4] = x; rings[ringI * 4 + 1] = y; rings[ringI * 4 + 2] = 0; ringI = (ringI + 1) % 6; };
let layersBelow = 0;
function lineSprite(x0, y0, x1, y1, w, a, lift) {
  sprites.push((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0), w, Math.atan2(y1 - y0, x1 - x0), lift, SPR.line, 1, 1, 1, a);
}
function build(dt, t) {
  sprites.begin();
  for (let i = 0; i < 6; i++) if (rings[i * 4 + 2] >= 0) rings[i * 4 + 2] += dt;
  // flowers on the ground
  const L0 = sprites.layer(true);
  for (const f of flowers) {
    if ((f.delay -= dt) <= 0) f.g = Math.min(1, f.g + dt / 1.3);
    if (f.g <= 0) continue;
    const g = easeBack(f.g), w = windAt(f.x, f.y, t);
    const ox = WIND_DIR[0] * w * 1.6 + Math.sin(t * 2.3 + f.rot * 7) * 0.4 * w, oy = WIND_DIR[1] * w * 1.6;
    if (f.leaves) sprites.push(f.x, f.y + 1, 15 * g, 15 * g, f.rot, 0, SPR.leaves[f.v], 1, 1, 1, 0.9);
    const fl = SPR.flower[f.kind], sz = f.kind === 'daisy' ? 13 : f.kind === 'puff' ? 12 : 10;
    sprites.push(f.x + ox, f.y + oy, sz * g, sz * g, f.rot + t * 0.02, 0.12, fl[f.v % fl.length], 1, 1, 1, 1);
  }
  for (const f of sprouts) {
    if ((f.delay -= dt) <= 0) f.g = Math.min(1, f.g + dt / 0.9);
    if (f.g <= 0) continue;
    const g = easeBack(f.g) * Math.min(1, f.life / 3), fl = SPR.flower[f.kind], sz = f.kind === 'daisy' ? 13 : 11;
    sprites.push(f.x, f.y, sz * g, sz * g, f.rot, 0.12, fl[f.v % fl.length], 1, 1, 1, 1);
  }
  sprites.end(L0);
  // the cat, the child, the kite string and the kite
  const L1 = sprites.layer(true);
  if (cat.on) {
    const pose = cat.mode === 'sit' || cat.mode === 'watch' ? 4 : cat.mode === 'sleep' ? 5 : Math.floor(cat.f) % 4;
    sprites.push(cat.x, cat.y, 60, 60, cat.hd, 0.12, SPR.cat[pose], 1, 1, 1, cat.a);
  }
  if (kid.on) {
    sprites.push(kid.x, kid.y, 48, 48, kid.hd, 0.3, SPR.child[kid.walk ? Math.floor(kid.f) % 4 : 0], 1, 1, 1, kid.a);
    const hx = kid.x + Math.cos(kid.hd) * 8, hy = kid.y + Math.sin(kid.hd) * 8;
    lineSprite(hx, hy, kid.kx, kid.ky, 1.3, 0.75 * kid.a, 0);
  }
  sprites.end(L1);
  const L2 = sprites.layer(true);
  if (kid.on) {
    const w = windAt(kid.kx, kid.ky, t), ang = Math.atan2(kid.ky - kid.y, kid.kx - kid.x);
    // tail of bows trailing downwind with a lazy wave
    for (let i = 1; i <= 5; i++) {
      const d = 14 + i * 12, wv = Math.sin(t * 3 - i * 0.9) * (3 + i * 1.2) * (0.6 + w);
      const bx = kid.kx + Math.cos(ang) * d - Math.sin(ang) * wv, by = kid.ky + Math.sin(ang) * d + Math.cos(ang) * wv;
      sprites.push(bx, by, 11, 11, ang + Math.sin(t * 4 + i) * 0.5, 4.2, SPR.bow[i % 3], 1, 1, 1, kid.a);
    }
    const lp = kid.loop > 0 ? 1 - kid.loop / 1.6 : 0, spin = lp > 0 ? easeBack(lp) * TAU : 0;
    const ox = lp > 0 ? Math.sin(lp * TAU) * 30 : 0, oy = lp > 0 ? (1 - Math.cos(lp * TAU)) * 18 : 0;
    sprites.push(kid.kx + ox, kid.ky - oy, 50, 50, ang + Math.sin(t * 1.7) * 0.12 + spin, 4.5, SPR.kite, 1, 1, 1, kid.a);
  }
  for (const b of bflies) {
    const fr = b.rest > 0 ? (Math.sin(b.ph * 2) > 0.7 ? 1 : 0) : Math.floor(b.ph * 14) % 3;
    sprites.push(b.x, b.y, 21, 21, b.hd, b.rest > 0 ? 0.1 : 0.6, SPR.bfly[b.c][fr], 1, 1, 1, b.a);
  }
  sprites.end(L2);
  layersBelow = sprites.layers.length;
  // above the clouds: balloon and swallows
  const L3 = sprites.layer(true);
  for (const w of wisps) if (w.on) { const e = w.age / w.life; sprites.push(w.x, w.y, w.s * (1 + e), w.s * (1 + e), 0, 0, SPR.wisp, 1, 1, 1, (1 - e) * 0.9); }
  if (ST.kind === 'balloon') for (const a of ST.a) sprites.push(a.x, a.y, 104, 104, 0, 5, SPR.balloon, 1, 1, 1, 1);
  if (ST.kind === 'swallows') for (const a of ST.a) sprites.push(a.x, a.y, 24, 24, a.hd, 1.8, SPR.swallow[Math.floor(a.ph * 8) % 3], 1, 1, 1, 1);
  sprites.end(L3);
  sprites.upload();
}
function setCommon(U, t) {
  gl.uniform1i(U.uFA, 0); gl.uniform1i(U.uFB, 1);
  gl.uniform1f(U.uMix, morph.k); gl.uniform1f(U.uT, t); gl.uniform1f(U.uScale, CW / W);
  gl.uniform2f(U.uCv, CW, CH); gl.uniform2f(U.uGrid, field.Gw, field.Gh);
  gl.uniform2f(U.uSun, LIGHT.dir[0], LIGHT.dir[1]);
  gl.uniform2f(U.uDrift, WIND_DIR[0] * 10 * P.flow * t, WIND_DIR[1] * 10 * P.flow * t);
  gl.uniform4fv(U.uFree, FREE);
  gl.uniform4fv(U.uPoke, pokes);
  gl.uniform3fv(U.uTint, LIGHT.tint); gl.uniform3fv(U.uWarm, LIGHT.warm); gl.uniform1f(U.uNight, LIGHT.night);
}
function draw(now) {
  const t = secs(now);
  sprites.drawShadows(W, H, atlasTex, [LIGHT.dir[0] * -LIGHT.len * 0.5, LIGHT.dir[1] * -LIGHT.len * 0.5]);
  gl.viewport(0, 0, CW, CH);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, morph.tex[0]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, morph.tex[1]);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sprites.shadowTex);
  gl.bindVertexArray(VAO0);
  gl.disable(gl.BLEND);
  gl.useProgram(GROUND.p); setCommon(GROUND.U, t);
  gl.uniform1i(GROUND.U.uShade, 2); gl.uniform1f(GROUND.U.uCloudOff, LIGHT.len * CLOUD_LIFT); gl.uniform4fv(GROUND.U.uRings, rings);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const tint = LIGHT.tint.map((v, i) => v * mix(1, LIGHT.warm[i], 0.4));
  sprites.draw(W, H, atlasTex, tint, CW, CH, 0, layersBelow);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, morph.tex[0]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, morph.tex[1]);
  gl.bindVertexArray(VAO0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(CLOUD.p); setCommon(CLOUD.U, t);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  sprites.draw(W, H, atlasTex, tint, CW, CH, layersBelow);
}

/* ======================================================================
   Start
   ====================================================================== */
paintAll();
atlasTex = texture(gl, atlas.cv);
updateLight();
let first = true;
const page = runPage({
  P, defaults: DEFAULTS, canvas: cv,
  keys: ['sigma', 'cover', 'flow', 'showBoy', 'showCat', 'flowers', 'byClock', 'hour'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc(); sprites.allocShadow(CW, CH);
    if (!first) computeClouds(true);
  },
  icons(list, isFirst, prev) {
    icons = list;
    if (!isFirst) { const { added } = diffIcons(prev, list); if (added.length <= 6) for (const a of added) addRing(a.x + a.w / 2, a.y + a.h / 2); }
    computeClouds(isFirst || first);
    first = false;
  },
  settings(keys) {
    if (keys.includes('sigma')) computeClouds(false);
    else if (keys.includes('flowers')) placeFlowers();
    if (keys.includes('hour') || keys.includes('byClock')) updateLight();
  },
  reseed() { field.reseed(); computeClouds(true); },
  step(dt, now) {
    const t = secs(now);
    morph.tick(now);
    if (page && page.frame % 300 === 0) updateLight();
    if (morph.moving && page.frame % 10 === 0) placeFlowers();
    stepFree(dt); stepKid(dt, t); stepCat(dt); stepBflies(dt); stepStory(dt); stepInteract(dt);
    build(dt, t);
  },
  draw,
  click,
  stats: () => `sprites ${sprites.n} · flowers ${flowers.length}`,
});

window.__dbg = {
  P, LIGHT, kid, cat, bflies, ST, free, flowers: () => flowers, click, sprouts,
  story: k => startStory(k),
  set(k, v) { P[k] = v; if (k === 'hour') { P.byClock = 0; updateLight(); } else computeClouds(false); },
  move(i, x, y) { const prev = page.icons.map(o => ({ ...o })); const next = prev.map(o => ({ ...o })); next[i] = { ...next[i], x, y }; page.icons = next; icons = next; for (const a of diffIcons(prev, next).added) addRing(a.x + a.w / 2, a.y + a.h / 2); computeClouds(false); },
  advance(sec) { const dt = 1 / 30; for (let s = 0; s < sec; s += dt) { morph.t0 -= dt * 1000; const n = performance.now(); morph.tick(n); stepFree(dt); stepKid(dt, secs(n)); stepCat(dt); stepBflies(dt); stepStory(dt); build(dt, secs(n)); } draw(performance.now()); },
};
