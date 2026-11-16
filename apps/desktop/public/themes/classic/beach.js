// DeskWall · Beach ("Пляж").
// A calm open sea. Around the icons sand rises out of the water: icons in a row share one
// island. Clear shallows show the rippled bottom and moving caustics, swells roll in, the
// swash runs up the sand and leaves a wet band. Palms lean over the water, crabs and shells
// live at the waterline, kayaks and gulls pass, and now and then a turtle or dolphins.
// All painting is code; the light follows the clock and one wind moves palms and water.
import {
  QS, WALL, PREVIEW, TAU, clamp, mix, sstep, easeBack, RNG, hash, fbm, rng, Field, Morph, iconRects, STEP,
  dayLight, clockHour, windAt, WIND_DIR, WIND_GLSL, NOISE_GLSL, FULL_VS, makeGL, program, texture, Atlas, Sprites,
  runPage, diffIcons, MAX_CLICKS, nextClick,
} from './kit.js';

/* ======================================================================
   Parameters (keys match apps/desktop/src/shared/themes.ts)
   ====================================================================== */
const P = { clicks: 16, sigma: 85, warp: 34, shoal: 110, shallow: 260, palms: 4, kayaks: 2, birds: 3, byClock: 1, hour: 15, cap30: true };
const DEFAULTS = { ...P };
if (QS.has('hour')) { P.byClock = 0; P.hour = +QS.get('hour'); }

// hour, frame tint, warm light on sand and foam, shadow length per unit of height (px)
const LIGHT_KEYS = [
  [0, [0.6, 0.67, 0.84], [0.9, 0.95, 1.08], 8], [4.8, [0.6, 0.67, 0.84], [0.9, 0.95, 1.08], 8],
  [6.4, [1.0, 0.92, 0.9], [1.05, 0.95, 0.9], 48], [8.5, [1.0, 0.97, 0.95], [1.04, 1.0, 0.95], 40],
  [12.5, [1.0, 1.0, 1.0], [1.0, 1.0, 1.0], 24], [16.5, [1.01, 0.99, 0.95], [1.03, 1.0, 0.95], 34],
  [18.8, [1.03, 0.94, 0.86], [1.06, 0.96, 0.86], 52], [20.3, [0.78, 0.74, 0.88], [1.0, 0.86, 0.9], 26],
  [21.8, [0.6, 0.67, 0.84], [0.9, 0.95, 1.08], 8], [24, [0.6, 0.67, 0.84], [0.9, 0.95, 1.08], 8],
];
const LIGHT = { tint: [1, 1, 1], warm: [1, 1, 1], len: 24, night: 0, dir: [-0.6, -0.8] };
const updateLight = () => dayLight(LIGHT_KEYS, P.byClock ? clockHour() : P.hour, LIGHT);

/* ======================================================================
   Ground shader: sea, shallows, swash and sand from the icon field
   ====================================================================== */
const GROUND_FS = `#version 300 es
precision highp float;
uniform sampler2D uFA, uFB, uShade;
uniform float uMix, uT, uScale, uShoal, uShallow, uNight, uLen;
uniform vec2 uCv, uGrid, uSun;
uniform vec3 uTint, uWarm;
uniform vec4 uRings[${MAX_CLICKS}];
out vec4 o;
${NOISE_GLSL}
${WIND_GLSL}
const vec3 SAND = vec3(0.965, 0.915, 0.80), SAND_DEEP = vec3(0.93, 0.86, 0.72), WET = vec3(0.80, 0.72, 0.60);
const vec3 CLEAR = vec3(0.62, 0.92, 0.86), TURQ = vec3(0.13, 0.74, 0.80), DEEP = vec3(0.05, 0.47, 0.67), ABYSS = vec3(0.04, 0.36, 0.58);
float field(vec2 p) { vec2 uv = (p / ${STEP.toFixed(1)} + 0.5) / uGrid; return mix(texture(uFA, uv).r, texture(uFB, uv).r, uMix); }
float shade() {
  vec2 uv = gl_FragCoord.xy / uCv, e = 2.5 / uCv;
  return (texture(uShade, uv).r * 2.0 + texture(uShade, uv + vec2(e.x, 0)).r + texture(uShade, uv - vec2(e.x, 0)).r
        + texture(uShade, uv + vec2(0, e.y)).r + texture(uShade, uv - vec2(0, e.y)).r) / 6.0;
}
// swash: how far up the sand the water reaches now, and how long ago a point at depth d dried
const float PER = 8.0, UP = 0.3, DOWN = 0.46;
vec2 swash(float d, float ph) {
  float cyc = floor(ph), f = fract(ph);
  float R = 13.0 + 18.0 * h21(vec2(cyc, 7.0));
  float r = f < UP ? R * sin(1.5708 * f / UP) : (f < UP + DOWN ? R * pow(1.0 - (f - UP) / DOWN, 1.7) : 0.0);
  float dry = 9.0;
  if (d > 0.0 && d < R) {
    float f1 = UP * asin(d / R) / 1.5708, f2 = UP + DOWN * (1.0 - pow(d / R, 1.0 / 1.7));
    dry = f >= f1 && f <= f2 ? 0.0 : (f > f2 ? f - f2 : f + 1.0 - f2) * PER;
  }
  return vec2(r, dry);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uCv.y - gl_FragCoord.y) / uScale;
  float t = uT;
  float s = field(p) + (fbm3(p * 0.04) - 0.5) * 5.0;
  float along = vn(p * 0.0032) * 2.2 + vn(p * 0.013) * 0.3;
  float wind = windAt(p, t);
  float grain = h21(floor(p * uScale)) - 0.5;
  float sh = shade();
  vec3 col;
  float d = -s;                                        // depth into the sand
  vec2 sw = swash(d, t / PER + along);
  float run = sw.x, dry = sw.y;
  if (s > 0.0 || d < run) {
    // ---------- water ----------
    float z = max(s, 0.0);
    float k1 = smoothstep(0.0, uShoal, z), k2 = smoothstep(uShoal * 0.5, uShoal + uShallow, z);
    float k3 = smoothstep(uShoal + uShallow * 0.8, uShoal + uShallow * 2.2, z);
    // the bottom: wet sand with ripples parallel to the shore, darker with depth
    float rip = sin(z * 0.42 + fbm3(p * 0.02) * 7.0) * 0.5 + 0.5;
    vec3 bottom = mix(WET * 1.05, WET * 0.86, rip * 0.5) * mix(vec3(1.0), vec3(0.8, 0.96, 0.96), k1);
    col = mix(bottom * vec3(0.86, 1.02, 1.0) + vec3(0.02, 0.08, 0.08), CLEAR, 0.35 + 0.65 * k1 * 0.6);
    col = mix(col, TURQ, smoothstep(0.15, 1.0, k1) * (1.0 - k2 * 0.2));
    col = mix(col, DEEP, k2);
    col = mix(col, ABYSS, k3);
    // big slow colour patches so open water is never flat
    col *= 0.955 + 0.09 * fbm3(p * 0.0035 + vec2(t * 0.006, -t * 0.004));
    // caustics in the shallows
    vec2 q = p * 0.028 + vec2(t * 0.11, t * 0.07);
    q += vec2(vn(q * 0.7 + t * 0.05), vn(q * 0.7 + 9.0 - t * 0.04)) * 1.6;
    float c1 = pow(1.0 - abs(vn(q) * 2.0 - 1.0), 7.0), c2 = pow(1.0 - abs(vn(q * 1.7 + 4.0) * 2.0 - 1.0), 9.0);
    col += (c1 * 0.6 + c2 * 0.4) * 0.11 * pow(1.0 - k1, 1.4) * smoothstep(0.0, 14.0, z) * uWarm;
    // swells rolling in (thin light crests broken into pieces)
    float swv = z / 46.0 + t * 0.16 + along * 0.7;
    float crest = pow(max(0.0, sin(swv * 6.2832)), 8.0) * smoothstep(0.35, 0.65, vn(p * 0.012 + vec2(swv * 0.4, 0.0)));
    col += crest * 0.06 * smoothstep(10.0, 40.0, z) * (1.0 - smoothstep(uShoal * 0.35, uShoal * 0.9, z)) * uWarm;
    // wind ruffles on open water
    col *= 1.0 + (vn(p * 0.035 + vec2(t * 0.3, -t * 0.1)) - 0.5) * 0.035 * wind * k2;
    // sun glitter on open water: sparse twinkles, more in gusts
    vec2 cell = floor(p / 11.0); float hc = h21(cell);
    vec2 cc = (cell + 0.2 + 0.6 * h22(cell + 3.7)) * 11.0;
    float dot1 = smoothstep(1.6, 0.4, length(p - cc));
    float tw = pow(max(0.0, sin(t * (0.9 + hc * 1.4) + hc * 60.0)), 18.0) * step(0.975 - wind * 0.012, h21(cell + 7.3)) * dot1;
    col += tw * 0.55 * k1 * mix(vec3(1.0, 0.97, 0.88), vec3(0.8, 0.88, 1.0), uNight) * uWarm;
    // foam where the water meets the sand
    float foamBand = smoothstep(14.0, 0.0, z) * (0.55 + 0.45 * vn(p * 0.12 + vec2(t * 0.4, 0.0)));
    col = mix(col, vec3(1.0), foamBand * 0.55);
    // the thin sheet of swash on the sand
    if (s <= 0.0) {
      float edge = run - d;                              // px behind the front
      vec3 sheet = mix(WET * 1.04, CLEAR * 1.02, 0.45 + 0.25 * smoothstep(0.0, 14.0, edge));
      float lace = smoothstep(0.42, 0.62, vn(p * 0.16 + t * 0.3)) * smoothstep(9.0, 0.0, edge);
      col = mix(sheet, vec3(1.0), clamp(smoothstep(3.5, 0.0, edge) * 0.85 + lace * 0.5, 0.0, 1.0));
    }
    // shadows on water are bluish and soft
    col *= mix(vec3(1.0), vec3(0.78, 0.86, 0.92), sh * 0.75);
    col *= 1.0 + grain * 0.025;
  } else {
    // ---------- sand ----------
    float mott = fbm3(p * 0.006 + 3.0);
    col = mix(SAND_DEEP, SAND, 0.55 + 0.45 * mott);
    // dunes inland are a touch warmer, the band near the water paler and finer
    col = mix(col, col * vec3(1.0, 0.985, 0.955), smoothstep(30.0, 140.0, d) * 0.6);
    // wind ripples in dry sand
    float wr = sin(dot(p, WIND_DIR.yx * vec2(-1.0, 1.0)) * 0.0 + dot(p, WIND_DIR) * 0.33 + fbm3(p * 0.015) * 9.0);
    col *= 1.0 + wr * 0.011 * smoothstep(24.0, 70.0, d);
    // wet band left by the swash: fresh water darkens it, then it dries out
    float wet = exp(-dry / 2.6) * smoothstep(1.0, 0.0, d / 34.0);
    wet = max(wet, smoothstep(24.0, 0.0, d) * 0.42);
    col = mix(col, WET, wet * 0.85);
    // the tide line: a faint row of foam remnants and darker grains
    float tl = exp(-pow((d - 36.0 - along * 6.0) / 2.2, 2.0)) * smoothstep(0.45, 0.7, vn(p * 0.09));
    col = mix(col, vec3(1.0, 0.99, 0.96), tl * 0.25);
    // speckles of shell grit
    float sp = step(0.985, h21(floor(p * 0.9) + 3.1));
    col = mix(col, vec3(1.0, 0.97, 0.94), sp * 0.5) * (1.0 + grain * 0.06);
    // warm sun on sand, cool shade
    col *= mix(vec3(1.0), uWarm, 0.6);
    col *= mix(vec3(1.0), vec3(0.84, 0.81, 0.9), sh * 0.75);
  }
  // soft cloud shadows drifting across everything
  float cs = smoothstep(0.58, 0.8, fbm3(p * 0.0011 + vec2(t * 0.0045, t * 0.0016)));
  col *= 1.0 - 0.07 * cs;
  // rings when an island appears (water) or a spot is left (sand puff)
  for (int i = 0; i < ${MAX_CLICKS}; i++) {
    vec4 w = uRings[i]; if (w.z < 0.0 || w.z > 5.0) continue;
    float dd = length(p - w.xy);
    if (w.w > 0.5) {   // a tap on the water: small rings spreading
      for (int k = 0; k < 3; k++) { float r = 3.0 + max(0.0, w.z - float(k) * 0.35) * 42.0;
        col += exp(-pow((dd - r) / 2.2, 2.0)) * exp(-w.z * 1.3) * 0.22 * step(0.0, s) * step(float(k) * 0.35, w.z); }
    } else {
      float r = 30.0 + w.z * 120.0;
      col += exp(-pow((dd - r) / 7.0, 2.0)) * exp(-w.z * 0.9) * 0.18 * step(0.0, s);
    }
  }
  col *= uTint;
  col = mix(col, col * vec3(0.82, 0.9, 1.12) + vec3(0.0, 0.01, 0.03), uNight * 0.6);
  o = vec4(col, 1.0);
}`;

/* ======================================================================
   Painted sprites (top-down, light from the top-left baked in)
   ====================================================================== */
const atlas = new Atlas(2048);
const SPR = {};
const R = rng(90210);
function shadeCol(hex, k) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => clamp(Math.round(v * k), 0, 255));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function paintPalm(g, S, v) {
  const c = S / 2, r = rng(400 + v * 17);
  const N = 9 + (v % 3), L = S * 0.47;
  const greens = [['#2f6b2c', '#4f9a3a', '#86c45a'], ['#2b6432', '#4a9440', '#7fc063'], ['#356c28', '#5a9e36', '#9ccb5c']][v % 3];
  const frond = (a, len, layer) => {
    const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx, bend = (r() - 0.5) * 0.5 + 0.18;
    const lit = 0.5 + 0.5 * (-(dx * -0.6 + dy * -0.8));        // fronds toward the sun are lighter
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      pts.push([c + dx * len * t + px * len * bend * t * t, c + dy * len * t + py * len * bend * t * t, t]);
    }
    // leaflets on both sides, swept forward
    for (const side of [-1, 1]) for (let i = 2; i < pts.length; i++) {
      const [x, y, t] = pts[i];
      const [x0, y0] = pts[i - 1];
      let tx = x - x0, ty = y - y0; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const ang = 0.95 + 0.25 * t, ca = Math.cos(ang * side), sa = Math.sin(ang * side);
      const lx = tx * ca - ty * sa, ly = tx * sa + ty * ca;
      const l = len * 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.6) * (1 - 0.35 * t) * (0.85 + r() * 0.3);
      const k = layer ? 1 : 0.8;
      const grad = g.createLinearGradient(x, y, x + lx * l, y + ly * l);
      grad.addColorStop(0, shadeCol(greens[0], k * (0.85 + lit * 0.25)));
      grad.addColorStop(0.55, shadeCol(greens[1], k * (0.85 + lit * 0.3)));
      grad.addColorStop(1, shadeCol(greens[2], k * (0.85 + lit * 0.35)));
      g.strokeStyle = grad; g.lineWidth = S * (0.011 + 0.006 * (1 - t)); g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + lx * l * 0.5 + tx * l * 0.12, y + ly * l * 0.5 + ty * l * 0.12, x + lx * l + tx * l * 0.25, y + ly * l + ty * l * 0.25);
      g.stroke();
    }
    g.strokeStyle = shadeCol('#a7b65a', layer ? 1 : 0.85); g.lineWidth = S * 0.008;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.stroke();
  };
  const a0 = r() * TAU;
  for (let i = 0; i < N; i++) frond(a0 + (i / N) * TAU + (r() - 0.5) * 0.25, L * (0.82 + r() * 0.18), 0);
  for (let i = 0; i < N - 3; i++) frond(a0 + ((i + 0.5) / (N - 3)) * TAU + (r() - 0.5) * 0.3, L * (0.6 + r() * 0.2), 1);
  // coconuts and the heart of the crown
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + v, x = c + Math.cos(a) * S * 0.035, y = c + Math.sin(a) * S * 0.035;
    const gr = g.createRadialGradient(x - S * 0.008, y - S * 0.01, 0, x, y, S * 0.03);
    gr.addColorStop(0, '#9b7a3c'); gr.addColorStop(1, '#5a3f1c');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, S * 0.028, 0, TAU); g.fill();
  }
  g.fillStyle = '#6f8a36'; g.beginPath(); g.arc(c, c, S * 0.022, 0, TAU); g.fill();
}
function paintTrunk(g, S) {
  // trunk along +x, base at the left edge
  const h = S * 0.09, y = S / 2;
  const grad = g.createLinearGradient(0, y - h, 0, y + h);
  grad.addColorStop(0, '#c9ae86'); grad.addColorStop(0.45, '#a88a63'); grad.addColorStop(1, '#6f5a40');
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(S * 0.02, y - h); g.lineTo(S * 0.98, y - h * 0.65); g.lineTo(S * 0.98, y + h * 0.65); g.lineTo(S * 0.02, y + h); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(70,52,34,.45)'; g.lineWidth = S * 0.008;
  for (let x = S * 0.05; x < S * 0.97; x += S * 0.045) { const k = 1 - 0.35 * (x / S); g.beginPath(); g.moveTo(x, y - h * k); g.quadraticCurveTo(x + S * 0.012, y, x, y + h * k); g.stroke(); }
}
function paintKayak(g, S, hull) {
  const c = S / 2, L = S * 0.46, Wd = S * 0.075;
  g.translate(c, c);
  const grad = g.createLinearGradient(0, -Wd, 0, Wd);
  grad.addColorStop(0, shadeCol(hull, 1.18)); grad.addColorStop(0.5, hull); grad.addColorStop(1, shadeCol(hull, 0.72));
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(-L, 0); g.bezierCurveTo(-L * 0.5, -Wd * 1.25, L * 0.5, -Wd * 1.25, L, 0); g.bezierCurveTo(L * 0.5, Wd * 1.25, -L * 0.5, Wd * 1.25, -L, 0); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = S * 0.006;
  g.beginPath(); g.moveTo(-L * 0.92, -1); g.lineTo(L * 0.92, -1); g.stroke();
  // cockpit and paddler (seen from above: hat, shoulders)
  g.fillStyle = '#26323a'; g.beginPath(); g.ellipse(-L * 0.05, 0, L * 0.2, Wd * 0.7, 0, 0, TAU); g.fill();
  g.fillStyle = '#2f7fb0'; g.beginPath(); g.ellipse(-L * 0.06, 0, S * 0.04, S * 0.06, 0, 0, TAU); g.fill();   // life vest
  g.fillStyle = '#f2e4c4'; g.beginPath(); g.arc(-L * 0.02, 0, S * 0.03, 0, TAU); g.fill();                   // sun hat
  g.fillStyle = 'rgba(0,0,0,.15)'; g.beginPath(); g.arc(-L * 0.02, S * 0.006, S * 0.017, 0, TAU); g.fill();
}
function paintPaddle(g, S) {
  const c = S / 2, L = S * 0.4;
  g.translate(c, c);
  g.strokeStyle = '#3a3a3a'; g.lineWidth = S * 0.012; g.beginPath(); g.moveTo(0, -L); g.lineTo(0, L); g.stroke();
  g.fillStyle = '#e8eef0';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(0, s * L, S * 0.03, S * 0.07, 0, 0, TAU); g.fill(); }
}
function paintGull(g, S, span) {
  const c = S / 2, u = S / 64;
  g.translate(c, c); g.scale(u, u);
  // wings (span 0..1), tail, body, head with a yellow beak; facing +x
  const sp = 7 + 22 * span;
  for (const s of [-1, 1]) {
    g.fillStyle = '#c6ccd4';
    g.beginPath(); g.moveTo(4, s * 2); g.quadraticCurveTo(6, s * sp * 0.55, -1, s * sp); g.lineTo(-5, s * sp * 0.95);
    g.quadraticCurveTo(-3, s * sp * 0.45, -5, s * 2); g.closePath(); g.fill();
    g.fillStyle = '#2b2b30';
    g.beginPath(); g.moveTo(-1, s * sp); g.lineTo(-5, s * sp * 0.95); g.lineTo(-2.5, s * sp * 0.78); g.closePath(); g.fill();
  }
  g.fillStyle = '#f4f5f6';
  g.beginPath(); g.moveTo(-6, -2.4); g.lineTo(-12, 0); g.lineTo(-6, 2.4); g.fill();
  g.beginPath(); g.ellipse(0, 0, 8, 3.4, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(8, 0, 3.2, 2.8, 0, 0, TAU); g.fill();
  g.fillStyle = '#f2c230'; g.beginPath(); g.moveTo(10.5, -0.8); g.lineTo(14, 0); g.lineTo(10.5, 0.8); g.fill();
}
function paintCrab(g, S, f) {
  const c = S / 2, u = S / 40;
  g.translate(c, c); g.scale(u, u);
  g.strokeStyle = '#c4553a'; g.lineWidth = 1.3; g.lineCap = 'round';
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.45 + (f ? (i % 2 ? 0.2 : -0.2) : 0);
    g.beginPath(); g.moveTo(s * 4, a * 4); g.lineTo(s * 10, a * 9 + 1); g.lineTo(s * 12.5, a * 12 + 3); g.stroke();
  }
  for (const s of [-1, 1]) {
    g.fillStyle = '#e06a48'; g.beginPath(); g.ellipse(s * 7, -8, 3.2, 2.4, s * 0.6, 0, TAU); g.fill();
    g.strokeStyle = '#d4603f'; g.beginPath(); g.moveTo(s * 3, -3); g.lineTo(s * 6, -6.5); g.stroke();
  }
  const gr = g.createRadialGradient(-1.5, -2, 0, 0, 0, 7);
  gr.addColorStop(0, '#f08a62'); gr.addColorStop(1, '#c4503a');
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 6.5, 5, 0, 0, TAU); g.fill();
  g.fillStyle = '#2a1a14'; for (const s of [-1, 1]) { g.beginPath(); g.arc(s * 2, -4.6, 0.9, 0, TAU); g.fill(); }
}
function paintStar(g, S, hue) {
  const c = S / 2, R1 = S * 0.42, R0 = S * 0.16;
  g.translate(c, c); g.rotate(R() * TAU);
  g.fillStyle = hue;
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, rr = i % 2 ? R0 : R1; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.lineJoin = 'round'; g.lineWidth = S * 0.08; g.strokeStyle = hue; g.stroke(); g.fill();
  g.fillStyle = 'rgba(255,240,220,.55)';
  for (let i = 0; i < 14; i++) { const a = R() * TAU, rr = R() * R1 * 0.8; g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, S * 0.018, 0, TAU); g.fill(); }
}
function paintShell(g, S, kind) {
  const c = S / 2;
  g.translate(c, c); g.rotate(R() * TAU);
  if (kind === 0) {                                      // scallop fan
    const gr = g.createRadialGradient(0, S * 0.25, 0, 0, S * 0.25, S * 0.5);
    gr.addColorStop(0, '#f6d7c4'); gr.addColorStop(1, '#e7a888');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, S * 0.3); g.arc(0, S * 0.3, S * 0.4, -2.5, -0.64); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(160,90,70,.4)'; g.lineWidth = S * 0.02;
    for (let i = -3; i <= 3; i++) { const a = -1.57 + i * 0.25; g.beginPath(); g.moveTo(0, S * 0.3); g.lineTo(Math.cos(a) * S * 0.38, S * 0.3 + Math.sin(a) * S * 0.38); g.stroke(); }
  } else {                                               // little spiral
    g.fillStyle = '#f3e6d4'; g.beginPath(); g.ellipse(0, 0, S * 0.36, S * 0.22, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(150,110,80,.55)'; g.lineWidth = S * 0.03; g.beginPath();
    for (let a = 0; a < 9; a += 0.2) { const rr = S * 0.02 * a; g.lineTo(S * 0.12 + Math.cos(a) * rr * 0.9, Math.sin(a) * rr * 0.55); }
    g.stroke();
  }
}
function paintTurtle(g, S, f) {
  const c = S / 2, u = S / 64;
  g.translate(c, c); g.scale(u, u);
  const sw = Math.sin(f * TAU) * 0.5;
  g.fillStyle = '#6e8f5c';
  for (const s of [-1, 1]) {
    g.save(); g.translate(6, s * 9); g.rotate(s * (0.5 + sw)); g.beginPath(); g.ellipse(4, 0, 9, 3.4, 0, 0, TAU); g.fill(); g.restore();
    g.save(); g.translate(-9, s * 7); g.rotate(s * (2.4 - sw * 0.6)); g.beginPath(); g.ellipse(3, 0, 5, 2.6, 0, 0, TAU); g.fill(); g.restore();
  }
  g.beginPath(); g.ellipse(15, 0, 5, 4, 0, 0, TAU); g.fill();
  const gr = g.createRadialGradient(-3, -4, 1, 0, 0, 14);
  gr.addColorStop(0, '#9c8a52'); gr.addColorStop(1, '#5d5232');
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 14, 11, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(50,40,20,.5)'; g.lineWidth = 0.9;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.beginPath(); g.moveTo(Math.cos(a) * 4.5, Math.sin(a) * 4); g.lineTo(Math.cos(a) * 12, Math.sin(a) * 9.5); g.stroke(); }
  g.beginPath(); g.ellipse(0, 0, 5, 4.2, 0, 0, TAU); g.stroke();
}
function paintDolphin(g, S) {
  const c = S / 2, u = S / 80;
  g.translate(c, c); g.scale(u, u);
  const gr = g.createLinearGradient(0, -8, 0, 8);
  gr.addColorStop(0, '#9fb3c2'); gr.addColorStop(0.5, '#6f8799'); gr.addColorStop(1, '#4d6474');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(32, 0); g.bezierCurveTo(24, -7, -10, -8, -26, -2); g.lineTo(-34, -7); g.lineTo(-31, 0); g.lineTo(-34, 7); g.lineTo(-26, 2);
  g.bezierCurveTo(-10, 8, 24, 7, 32, 0); g.fill();
  g.fillStyle = '#5b7385';
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(10, s * 5); g.lineTo(2, s * 13); g.lineTo(-1, s * 6); g.fill(); }
  g.fillStyle = '#4a6070'; g.beginPath(); g.ellipse(-4, 0, 6, 1.6, 0, 0, TAU); g.fill();   // dorsal fin from above
}
function paintFish(g, S) {
  const c = S / 2;
  g.translate(c, c);
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(S * 0.08, 0, S * 0.26, S * 0.09, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(-S * 0.14, 0); g.lineTo(-S * 0.34, -S * 0.1); g.lineTo(-S * 0.3, 0); g.lineTo(-S * 0.34, S * 0.1); g.fill();
}
function paintFoam(g, S) {
  const c = S / 2, gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
}
function paintRing(g, S) {
  g.strokeStyle = '#fff'; g.lineWidth = S * 0.06; g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, TAU); g.stroke();
}
function paintNut(g, S) {
  const c = S / 2, gr = g.createRadialGradient(c * 0.8, c * 0.75, S * 0.05, c, c, S * 0.42);
  gr.addColorStop(0, '#a5823f'); gr.addColorStop(1, '#5a3d1a');
  g.fillStyle = gr; g.beginPath(); g.arc(c, c, S * 0.4, 0, TAU); g.fill();
}
function paintCastle(g, S) {
  const c = S / 2, u = S / 64;
  g.translate(c, c); g.scale(u, u);
  const SAND = '#e9d3a6', LIT = '#f6e6c4', DARK = '#c9ae7e';
  g.fillStyle = DARK; g.fillRect(-17, -17, 36, 36);
  g.fillStyle = SAND; g.fillRect(-18, -18, 36, 36);
  g.fillStyle = LIT; g.fillRect(-18, -18, 36, 5); g.fillRect(-18, -18, 5, 36);
  for (let i = -14; i <= 12; i += 6) { g.fillStyle = DARK; g.fillRect(i, -20, 3, 3); g.fillRect(i, 17, 3, 3); g.fillRect(-20, i, 3, 3); g.fillRect(17, i, 3, 3); }
  for (const [x, y] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) {
    const gr = g.createRadialGradient(x - 2.5, y - 2.5, 1, x, y, 9);
    gr.addColorStop(0, LIT); gr.addColorStop(1, DARK);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 8.5, 0, TAU); g.fill();
  }
  const gr = g.createRadialGradient(-3, -3, 1, 0, 0, 10);
  gr.addColorStop(0, LIT); gr.addColorStop(1, DARK);
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();
  g.strokeStyle = '#6b5236'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -14); g.stroke();
  g.fillStyle = '#e2563c'; g.beginPath(); g.moveTo(0, -14); g.lineTo(9, -11); g.lineTo(0, -8); g.fill();
}
function paintAll() {
  SPR.nut = atlas.paint(14, paintNut);
  SPR.castle = atlas.paint(64, paintCastle);
  SPR.palm = [0, 1, 2].map(v => atlas.paint(150, (g, S) => paintPalm(g, S, v)));
  SPR.trunk = atlas.paint(80, paintTrunk);
  SPR.kayak = ['#f2b51c', '#e8553a', '#3bb07a', '#f08a2c'].map(h => atlas.paint(64, (g, S) => paintKayak(g, S, h)));
  SPR.paddle = atlas.paint(64, paintPaddle);
  SPR.gull = [1, 0.8, 0.45, 0.15].map(k => atlas.paint(48, (g, S) => paintGull(g, S, k)));
  SPR.crab = [0, 1].map(f => atlas.paint(20, (g, S) => paintCrab(g, S, f)));
  SPR.star = ['#e8774a', '#d9573f', '#f0a050'].map(h => atlas.paint(18, (g, S) => paintStar(g, S, h)));
  SPR.shell = [0, 1, 0, 1].map(k => atlas.paint(12, (g, S) => paintShell(g, S, k)));
  SPR.turtle = [0, 0.25, 0.5, 0.75].map(f => atlas.paint(56, (g, S) => paintTurtle(g, S, f)));
  SPR.dolphin = atlas.paint(72, paintDolphin);
  SPR.fish = atlas.paint(14, paintFish);
  SPR.foam = atlas.paint(24, paintFoam);
  SPR.ring = atlas.paint(32, paintRing);
}

/* ======================================================================
   GL objects
   ====================================================================== */
const cv = document.getElementById('art');
const gl = makeGL(cv);
const GROUND = program(gl, FULL_VS, GROUND_FS);
const VAO0 = gl.createVertexArray();
const field = new Field();
const morph = new Morph(field, gl, 2600);
const sprites = new Sprites(gl, 3000);
let atlasTex = null, W = 1, H = 1, CW = 1, CH = 1;
const T0 = performance.now();
const now_s = now => (now - T0) / 1000;

/* ======================================================================
   World: the land, palms, decor on the beach
   ====================================================================== */
let icons = [];
const nearIcon = (x, y, pad) => icons.some(ic => x > ic.x - pad && x < ic.x + ic.w + pad && y > ic.y - pad && y < ic.y + ic.h + pad);
const sNow = (x, y) => morph.at(x, y);
const sTarget = (x, y) => morph.target(x, y);
const G = [0, 0];
function computeLand(instant) {

  const s = field.compute(iconRects(icons), { reach: P.sigma + 10, warp: 30 + P.warp * 1.8, wobble: 0.1 + P.warp / 400, far: 1400 });
  morph.set(s, instant);
  placePalms(); placeDecor();
  for (let i = castles.length - 1; i >= 0; i--) if (sTarget(castles[i].x, castles[i].y) > -10 || nearIcon(castles[i].x, castles[i].y, 16)) castles.splice(i, 1);
}
// palms: stable candidate spots on a jittered grid, chosen by a seeded score
let palms = [];
function placePalms() {
  const want = Math.round(P.palms * Math.max(1, Math.min(2.2, icons.length / 9)));
  const cand = [];
  for (let gy = 0; gy * 34 < H + 34; gy++) for (let gx = 0; gx * 34 < W + 34; gx++) {
    const x = gx * 34 + hash(gx, gy, 5) * 26, y = gy * 34 + hash(gx, gy, 6) * 26;
    if (x < 10 || y < 10 || x > W - 10 || y > H - 10) continue;
    const s = sTarget(x, y);
    if (s > -16 || s < -P.sigma * 0.95 || nearIcon(x, y, 8)) continue;
    cand.push({ x, y, score: hash(gx, gy, 9) + (s > -P.sigma * 0.5 ? 0.35 : 0) });
  }
  cand.sort((a, b) => b.score - a.score);
  const keep = palms.filter(p => p.want && sTarget(p.x, p.y) < -12 && !nearIcon(p.x, p.y, 4));
  for (const p of palms) if (!keep.includes(p)) p.want = false;
  const chosen = keep.slice(0, want);
  for (const p of keep.slice(want)) p.want = false;
  for (const c of cand) {
    if (chosen.length >= want) break;
    if (chosen.some(p => Math.hypot(p.x - c.x, p.y - c.y) < 120)) continue;
    field.grad(morph.B, c.x, c.y, G);
    const gl2 = Math.hypot(G[0], G[1]) || 1;
    const lean = 20 + hash(c.x | 0, c.y | 0, 3) * 18;
    const p = { x: c.x, y: c.y, lx: (G[0] / gl2) * lean, ly: (G[1] / gl2) * lean, v: (hash(c.x | 0, c.y | 0, 4) * 3) | 0,
      size: 86 + hash(c.x | 0, c.y | 0, 8) * 30, rot: hash(c.x | 0, c.y | 0, 2) * TAU, grow: 0, want: true, delay: 0.4 + Math.random() * 0.8, ph: Math.random() * TAU };
    chosen.push(p); palms.push(p);
  }
  palms.sort((a, b) => a.y - b.y);
}
// shells and starfish along the waterline, a few under the clear water
let decor = [];
function placeDecor() {
  const out = [];
  for (let gy = 0; gy * 26 < H; gy++) for (let gx = 0; gx * 26 < W; gx++) {
    if (hash(gx, gy, 41) > 0.16) continue;
    const x = gx * 26 + hash(gx, gy, 42) * 26, y = gy * 26 + hash(gx, gy, 43) * 26, s = sTarget(x, y);
    const under = false, line = s < -10 && s > -40;
    if (!(under || line) || nearIcon(x, y, 2)) continue;
    const k = hash(gx, gy, 44);
    out.push({ x, y, under, kind: k < 0.3 ? 'star' : 'shell', v: (hash(gx, gy, 45) * 4) | 0, rot: hash(gx, gy, 46) * TAU, a: 0 });
    if (out.length > 60) break;
  }
  for (const d of out) { const old = decor.find(o => Math.abs(o.x - d.x) < 1 && Math.abs(o.y - d.y) < 1); if (old) d.a = old.a; }
  decor = out;
}

/* ======================================================================
   Life: kayaks, gulls, crabs, fish, rare turtle and dolphins
   ====================================================================== */
const kayaks = Array.from({ length: 4 }, (_, i) => ({ i, on: false, x: 0, y: 0, hd: 0, want: 0, ph: Math.random() * TAU, c: i % 4, wakeT: 0, a: 0 }));
const wakes = Array.from({ length: 120 }, () => ({ on: false }));
let wakeI = 0;
const gulls = Array.from({ length: 8 }, (_, i) => ({ i, on: false, x: 0, y: 0, hd: 0, turn: 0, ph: Math.random() * 10, flapT: 0, a: 0, alt: 3.2 + Math.random() * 1.6 }));
const crabs = Array.from({ length: 4 }, (_, i) => ({ i, on: false, x: 0, y: 0, hd: 0, t: 0, dir: 1, a: 0, f: 0 }));
const school = { on: false, x: 0, y: 0, hd: 0, t: 0, fish: Array.from({ length: 9 }, () => ({ ox: (Math.random() - 0.5) * 40, oy: (Math.random() - 0.5) * 26, ph: Math.random() * TAU })) };
const ST = { kind: null, t: 0, next: 50 + Math.random() * 60, a: [] };

function edgeSpawn(minS) {
  for (let k = 0; k < 30; k++) {
    const side = (Math.random() * 4) | 0, r = Math.random();
    const x = side === 0 ? -40 : side === 1 ? W + 40 : r * W, y = side === 2 ? -40 : side === 3 ? H + 40 : r * H;
    if (sNow(clamp(x, 0, W), clamp(y, 0, H)) > minS) return [x, Math.atan2(H / 2 - y, W / 2 - x) + (Math.random() - 0.5) * 0.8, x, y];
  }
  return null;
}
function steer(o, dt, minS, speed, wander) {
  // look ahead; if land is near, turn toward deeper water along the field gradient
  const ax = o.x + Math.cos(o.hd) * 60, ay = o.y + Math.sin(o.hd) * 60;
  const sa = sNow(clamp(ax, 0, W), clamp(ay, 0, H));
  if (sa < minS) {
    field.grad(morph.B, clamp(ax, 0, W), clamp(ay, 0, H), G);
    const want = Math.atan2(G[1], G[0]);
    let dh = ((want - o.hd + Math.PI) % TAU + TAU) % TAU - Math.PI;
    o.hd += clamp(dh, -1, 1) * dt * 1.4;
  } else {
    o.hd += (Math.sin(o.ph * 0.13 + o.i) * 0.5) * wander * dt;
  }
  o.x += Math.cos(o.hd) * speed * dt; o.y += Math.sin(o.hd) * speed * dt;
}
const offScreen = (o, m) => o.x < -m || o.y < -m || o.x > W + m || o.y > H + m;
function stepKayaks(dt, t) {
  for (const k of kayaks) {
    const want = k.i < P.kayaks;
    if (!k.on) {
      if (!want || Math.random() > dt * 0.4) continue;
      const sp = edgeSpawn(90); if (!sp) continue;
      [k.x, k.hd] = sp; k.on = true; k.a = 0;
    }
    if (k.wave > 0) k.wave -= dt;
    k.ph += dt * (k.wave > 0 ? 0 : 2.6);
    const pulse = k.wave > 0 ? 0.15 : 0.75 + 0.25 * Math.abs(Math.sin(k.ph));
    steer(k, dt, 70, 17 * pulse, 0.25);
    k.a = Math.min(1, k.a + dt * 0.5);
    if (!want) k.a = Math.max(0, k.a - dt);
    if (offScreen(k, 80) || (!want && k.a <= 0)) { k.on = false; continue; }
    if ((k.wakeT -= dt) <= 0) {
      k.wakeT = 0.35;
      for (const s of [-1, 1]) {
        const w = wakes[wakeI = (wakeI + 1) % wakes.length];
        Object.assign(w, { on: true, x: k.x - Math.cos(k.hd) * 26 + Math.cos(k.hd + s * 1.57) * 6, y: k.y - Math.sin(k.hd) * 26 + Math.sin(k.hd + s * 1.57) * 6,
          vx: Math.cos(k.hd + s * 2.2) * 6, vy: Math.sin(k.hd + s * 2.2) * 6, age: 0, life: 3.2 });
      }
    }
  }
  for (const w of wakes) if (w.on) { w.age += dt; w.x += w.vx * dt; w.y += w.vy * dt; if (w.age > w.life) w.on = false; }
}
function stepGulls(dt, t) {
  for (const g of gulls) {
    const want = g.i < P.birds;
    if (!g.on) {
      if (!want || Math.random() > dt * 0.25) continue;
      const side = Math.random() < 0.5;
      g.x = side ? -60 : W + 60; g.y = H * (0.15 + Math.random() * 0.7); g.hd = side ? (Math.random() - 0.5) * 0.6 : Math.PI + (Math.random() - 0.5) * 0.6;
      g.on = true; g.a = 1; g.turn = 0;
    }
    g.ph += dt;
    // circle lazily, mostly gliding; occasionally a few flaps
    g.turn += (Math.sin(g.ph * 0.4 + g.i * 2) * 0.35 - g.turn) * dt * 0.5;
    g.hd += g.turn * dt;
    let spd = 46;
    const P0 = PTR();
    if (P0.in) {
      const dx = g.x - P0.x, dy = g.y - P0.y, d = Math.hypot(dx, dy);
      if (d < 90) turnAway(g, Math.atan2(dy, dx), (1 - d / 90) * 3, dt);
    }
    if (g.scare > 0) { g.scare -= dt; spd = 46 + 110 * Math.min(1, g.scare); }
    g.x += Math.cos(g.hd) * spd * dt; g.y += Math.sin(g.hd) * spd * dt;
    if (g.flapT > 0) g.flapT -= dt; else if (Math.random() < dt * 0.15) g.flapT = 1.2 + Math.random();
    if (offScreen(g, 120)) { g.on = false; }
  }
}
function stepCrabs(dt) {
  const landy = icons.length > 0;
  for (const c of crabs) {
    if (!c.on) {
      if (!landy || Math.random() > dt * 0.1) continue;
      // find a spot on the damp sand
      for (let k = 0; k < 40; k++) {
        const x = Math.random() * W, y = Math.random() * H, s = sNow(x, y);
        if (s < -14 && s > -42 && !nearIcon(x, y, 6)) { Object.assign(c, { on: true, x, y, a: 0, t: 1 + Math.random() * 2, life: 40 + Math.random() * 60 }); break; }
      }
      continue;
    }
    c.life -= dt;
    c.t -= dt;
    const P1 = PTR();
    if (P1.in && !c.flee && Math.hypot(c.x - P1.x, c.y - P1.y) < 70) { c.flee = true; c.life = Math.min(c.life, 2.5); }
    if (c.flee) {
      field.grad(morph.B, c.x, c.y, G);
      const gl2 = Math.hypot(G[0], G[1]) || 1;
      c.hd = Math.atan2(G[1], G[0]) - 1.57; c.x += (G[0] / gl2) * 75 * dt; c.y += (G[1] / gl2) * 75 * dt; c.f += dt * 30;
      c.a = Math.max(0, c.a - dt * (sNow(c.x, c.y) > -4 ? 3 : 0.2));
      if (c.a <= 0) { c.on = false; c.flee = false; }
      continue;
    }
    if (c.t <= 0) { c.t = 0.6 + Math.random() * 2.4; c.moving = !c.moving; if (c.moving) { c.dir = Math.random() < 0.5 ? -1 : 1; field.grad(morph.B, c.x, c.y, G); c.hd = Math.atan2(G[1], G[0]); } }
    if (c.moving) {
      // crabs walk sideways along the shore
      const ax = Math.cos(c.hd + c.dir * 1.57), ay = Math.sin(c.hd + c.dir * 1.57);
      const nx = c.x + ax * 22 * dt, ny = c.y + ay * 22 * dt, s = sNow(nx, ny);
      if (s < -10 && s > -48 && !nearIcon(nx, ny, 4)) { c.x = nx; c.y = ny; c.f += dt * 14; } else c.dir *= -1;
    }
    c.a = clamp(c.a + (c.life > 0 && sNow(c.x, c.y) < -6 ? dt : -dt), 0, 1);
    if (c.life <= 0 && c.a <= 0) c.on = false;
  }
}
function stepSchool(dt, t) {
  const s = school;
  if (!s.on) {
    if (!icons.length || Math.random() > dt * 0.05) return;
    for (let k = 0; k < 40; k++) {
      const x = Math.random() * W, y = Math.random() * H, z = sNow(x, y);
      if (z > 30 && z < P.shoal + 60) { Object.assign(s, { on: true, x, y, hd: Math.random() * TAU, t: 25 + Math.random() * 30, a: 0, i: 7, ph: 0 }); break; }
    }
    return;
  }
  s.t -= dt; s.ph += dt;
  const P2 = PTR();
  const near = P2.in && Math.hypot(s.x - P2.x, s.y - P2.y) < 110;
  if (near) { turnAway(s, Math.atan2(s.y - P2.y, s.x - P2.x), 6, dt); s.spook = 1.5; }
  s.spook = Math.max(0, (s.spook || 0) - dt);
  steer(s, dt, 26, 20 + 60 * Math.min(1, s.spook), 0.6);
  const z = sNow(clamp(s.x, 0, W), clamp(s.y, 0, H));
  if (z > P.shoal + P.shallow * 0.6) s.hd += dt * 0.8;    // stay in the shallows
  s.a = clamp(s.a + (s.t > 0 ? dt * 0.4 : -dt * 0.4), 0, 1);
  if ((s.t <= 0 && s.a <= 0) || offScreen(s, 200)) s.on = false;
}
// rare scenes, one at a time every 1.5–3.5 minutes
function startStory(kind) {
  const sp = edgeSpawn(kind === 'turtle' ? 40 : 120);
  if (!sp) return false;
  ST.kind = kind; ST.t = 0;
  if (kind === 'turtle') ST.a = [{ i: 0, x: sp[0], y: sp[1] * 0 + sp[3], hd: sp[1], ph: 0 }];
  else ST.a = [0, 1].map(i => ({ i, x: sp[0] - i * 40, y: sp[3] + i * 26, hd: sp[1], ph: i * 1.3, up: 0 }));
  return true;
}
function stepStory(dt) {
  if (!ST.kind) {
    if ((ST.next -= dt) <= 0) { ST.next = 90 + Math.random() * 120; startStory(Math.random() < 0.55 ? 'turtle' : 'dolphins'); }
    return;
  }
  ST.t += dt;
  let alive = false;
  for (const a of ST.a) {
    a.ph += dt;
    if (ST.kind === 'turtle') steer(a, dt, 30, 11, 0.3);
    else { steer(a, dt, 110, 38, 0.15); }
    if (!offScreen(a, 120) || ST.t < 8) alive = true;
  }
  if (!alive || ST.t > 140) ST.kind = null;
}

/* ======================================================================
   The cursor: gulls dodge it, crabs run to the water, fish scatter. Clicks: a gull flees,
   a palm shakes and drops a coconut, a kayaker waves, the water rings, dolphins leap, and
   five quick taps on the same patch of sand build a sandcastle.
   ====================================================================== */
const NOPTR = { in: false, x: -1e4, y: -1e4 };
const PTR = () => (page && page.ptr) || NOPTR;
function turnAway(o, away, rate, dt) { const d = ((away - o.hd + Math.PI) % TAU + TAU) % TAU - Math.PI; o.hd += clamp(d, -rate * dt, rate * dt); }
const nuts = Array.from({ length: 6 }, () => ({ on: false }));
const castles = [];
const taps = [];
function click(x, y) {
  // a gull?
  for (const g of gulls) if (g.on && Math.hypot(g.x - x, g.y - y) < 34) {
    g.hd = Math.atan2(g.y - y, g.x - x) + (Math.random() - 0.5) * 0.5; g.scare = 2.2; g.flapT = 2; g.turn = 0;
    return;
  }
  for (const k of kayaks) if (k.on && Math.hypot(k.x - x, k.y - y) < 36) { k.wave = 2.6; return; }
  if (ST.kind === 'dolphins') for (const a of ST.a) if (Math.hypot(a.x - x, a.y - y) < 60) { a.ph = Math.asin(0.2) / 1.1; addRing(a.x, a.y); return; }
  if (ST.kind === 'turtle') for (const a of ST.a) if (Math.hypot(a.x - x, a.y - y) < 40) { a.hd += Math.PI * 0.6; addRing(a.x, a.y); return; }
  // a palm crown?
  for (const p of palms) {
    if (p.g < 0.9) continue;
    const cx = p.x + p.lx, cy = p.y + p.ly;
    if (Math.hypot(cx - x, cy - y) < p.size * 0.4) {
      p.shake = 1.2;
      const n = nuts.find(c => !c.on);
      if (n) {
        const a = Math.random() * TAU, r = 14 + Math.random() * 10;
        Object.assign(n, { on: true, landed: false, t: 0, sx: cx + Math.cos(a) * 8, sy: cy + Math.sin(a) * 8, x: cx + Math.cos(a) * r + LIGHT.dir[0] * -6, y: cy + Math.sin(a) * r, rot: Math.random() * TAU, life: 40 });
      }
      return;
    }
  }
  const s = sNow(x, y);
  if (s > 0) { addRing(x, y); return; }
  // sand: count quick taps in one spot
  const now = simT;
  taps.push({ x, y, t: now });
  while (taps.length && now - taps[0].t > 3) taps.shift();
  const here = taps.filter(q => Math.hypot(q.x - x, q.y - y) < 60);
  if (here.length >= 5 && s < -12 && !nearIcon(x, y, 20)) {
    taps.length = 0;
    while (castles.length >= Math.max(1, P.clicks | 0)) castles.shift();
    castles.push({ x, y, g: 0 });
  }
}
function stepNuts(dt) {
  for (const c of nuts) {
    if (!c.on) continue;
    if (!c.landed) {
      c.t += dt;
      if (c.t >= 0.7) {
        c.landed = true; c.t = 0.7;
        if (sNow(c.x, c.y) > 0) { addRing(c.x, c.y); c.on = false; }        // plop
      }
    } else if ((c.life -= dt) <= 0) c.on = false;
  }
}

/* ======================================================================
   Building the sprite list for a frame
   ====================================================================== */
const rings = new Float32Array(MAX_CLICKS * 4).fill(-1);
let ringI = 0;
function addRing(x, y, small = 1) { rings[ringI * 4] = x; rings[ringI * 4 + 1] = y; rings[ringI * 4 + 2] = 0; rings[ringI * 4 + 3] = small; ringI = nextClick(ringI, P); }
let simT = 0;
function build(dt, t) {
  sprites.begin();
  const tint = 1;
  // under water: decor, fish, turtle and dolphins (tinted by the water above them)
  const L0 = sprites.layer(false);
  for (const d of decor) {
    d.a = Math.min(1, d.a + dt * 0.5);
    const s = sNow(d.x, d.y), vis = d.under ? sstep(60, 6, s) * sstep(0, 6, s) : sstep(-2, -10, s);
    if (vis <= 0) continue;
    const uv = d.kind === 'star' ? SPR.star[d.v % 3] : SPR.shell[d.v % 4], sz = d.kind === 'star' ? 16 : 10;
    if (d.under) sprites.push(d.x, d.y, sz, sz, d.rot, 0, uv, 0.62, 0.86, 0.84, vis * d.a * 0.75);
    else sprites.push(d.x, d.y, sz, sz, d.rot, 0, uv, 1, 1, 1, vis * d.a);
  }
  if (school.on) for (const f of school.fish) {
    const c = Math.cos(school.hd), s = Math.sin(school.hd), w = Math.sin(school.ph * 6 + f.ph) * 2, k = 1 + 1.6 * Math.min(1, school.spook || 0);
    const x = school.x + f.ox * k * c - (f.oy * k + w) * s, y = school.y + f.ox * k * s + (f.oy * k + w) * c;
    sprites.push(x, y, 13, 13, school.hd + Math.sin(school.ph * 8 + f.ph) * 0.15, 0, SPR.fish, 0.1, 0.32, 0.38, school.a * 0.45);
  }
  if (ST.kind === 'turtle') for (const a of ST.a) {
    sprites.push(a.x, a.y, 54, 54, a.hd, 0, SPR.turtle[Math.floor(a.ph * 1.6) % 4], 0.7, 0.9, 0.88, 0.85);
  }
  if (ST.kind === 'dolphins') for (const a of ST.a) {
    // surfacing in slow arcs: visible near the top of each arc, a little splash when breaking the surface
    const k = Math.sin(a.ph * 1.1), up = sstep(0.2, 0.8, k);
    sprites.push(a.x, a.y, 72, 72, a.hd, 0, SPR.dolphin, mix(0.55, 1, up), mix(0.8, 1, up), mix(0.85, 1, up), 0.35 + 0.6 * up);
    if (k > 0.15 && k < 0.45) sprites.push(a.x + Math.cos(a.hd) * 26, a.y + Math.sin(a.hd) * 26, 30, 30, 0, 0, SPR.foam, 1, 1, 1, 0.5);
  }
  sprites.end(L0);
  // on the surface: wakes, kayaks, crabs
  const L1 = sprites.layer(false);
  for (const w of wakes) if (w.on) { const e = w.age / w.life; sprites.push(w.x, w.y, 10 + e * 20, 10 + e * 20, 0, 0, SPR.foam, 1, 1, 1, (1 - e) * 0.32); }
  for (let i = 0; i < MAX_CLICKS; i++) if (rings[i * 4 + 2] >= 0) rings[i * 4 + 2] += dt;
  for (const c of nuts) if (c.on && c.landed) sprites.push(c.x, c.y, 13, 13, c.rot, 0.05, SPR.nut, 1, 1, 1, Math.min(1, c.life / 3));
  sprites.end(L1);
  const LC0 = sprites.layer(true);
  for (const c of castles) { c.g = Math.min(1, c.g + dt / 1.4); const g = easeBack(c.g); sprites.push(c.x, c.y, 58 * g, 58 * g, 0, 0.35 * g, SPR.castle, 1, 1, 1, 1); }
  sprites.end(LC0);
  const L2 = sprites.layer(true);
  for (const k of kayaks) if (k.on) {
    sprites.push(k.x, k.y, 64, 64, k.hd, 0.15, SPR.kayak[k.c], 1, 1, 1, k.a);
    const waving = (k.wave || 0) > 0;
    const sw = waving ? 1.57 + Math.sin(simT * 9) * 0.5 : Math.sin(k.ph) * 0.55;
    sprites.push(k.x - Math.cos(k.hd) * 1, k.y - Math.sin(k.hd) * 1, 58, 58, k.hd + sw, waving ? 0.6 : 0.2, SPR.paddle, 1, 1, 1, k.a);
  }
  for (const c of crabs) if (c.on && c.a > 0) sprites.push(c.x, c.y, 18, 18, c.hd + 1.57, 0.05, SPR.crab[Math.floor(c.f) % 2], 1, 1, 1, c.a);
  sprites.end(L2);
  // palms: trunk shadow (shadow only), trunk, crown
  const LS = sprites.layer(true); LS.hidden = true;
  const LT = [], LC = [];
  for (const p of palms) {
    const wantVis = p.want && sNow(p.x, p.y) < -8;
    if (wantVis) { if ((p.delay -= dt) <= 0) p.grow = Math.min(1, p.grow + dt / 1.6); }
    else p.grow = Math.max(0, p.grow - dt / 1.2);
    p.g = easeBack(p.grow) * (wantVis ? 1 : p.grow);
  }
  palms = palms.filter(p => p.want || p.grow > 0);
  for (const p of palms) {
    if (p.g <= 0.01) continue;
    const g = p.g, h = 1.8 * g;
    // shadow of the trunk: from the base to where the crown's shadow falls
    const tx = p.x + p.lx * g, ty = p.y + p.ly * g;
    const shx = tx + LIGHT.dir[0] * -LIGHT.len * h, shy = ty + LIGHT.dir[1] * -LIGHT.len * h;
    const mx = (p.x + shx) / 2, my = (p.y + shy) / 2, len = Math.hypot(shx - p.x, shy - p.y);
    sprites.push(mx, my, len, 14 * g, Math.atan2(shy - p.y, shx - p.x), 0, SPR.trunk, 1, 1, 1, 0.9);
  }
  sprites.end(LS);
  const LTr = sprites.layer(false);
  for (const p of palms) {
    if (p.g <= 0.01) continue;
    const g = p.g, tx = p.x + p.lx * g, ty = p.y + p.ly * g, len = Math.hypot(tx - p.x, ty - p.y) + 6;
    sprites.push((p.x + tx) / 2, (p.y + ty) / 2, len * 1.05, 12 * g, Math.atan2(ty - p.y, tx - p.x), 0, SPR.trunk, 1, 1, 1, 1);
  }
  sprites.end(LTr);
  const LCr = sprites.layer(true);
  for (const p of palms) {
    if (p.g <= 0.01) continue;
    const g = p.g, w = windAt(p.x, p.y, t);
    p.shake = Math.max(0, (p.shake || 0) - dt);
    const sway = Math.sin(t * 1.3 + p.ph) * 0.03 + w * 0.06 + Math.sin(t * 3.1 + p.ph) * 0.012 * w + Math.sin(t * 22) * 0.09 * p.shake * p.shake;
    const tx = p.x + p.lx * g + WIND_DIR[0] * w * 3, ty = p.y + p.ly * g + WIND_DIR[1] * w * 3;
    sprites.push(tx, ty, p.size * g, p.size * g, p.rot + sway, 1.8 * g, SPR.palm[p.v], 1, 1, 1, 1);
  }
  for (const c of nuts) if (c.on && !c.landed) { const e = c.t / 0.7; sprites.push(mix(c.sx, c.x, e), mix(c.sy, c.y, e), 13, 13, c.rot + e * 4, 1.8 * (1 - e * e), SPR.nut, 1, 1, 1, 1); }
  sprites.end(LCr);
  // gulls high above
  const LG = sprites.layer(true);
  for (const g of gulls) if (g.on) {
    const fr = g.flapT > 0 ? 1 + (Math.floor(g.ph * 9) % 3) : 0;
    sprites.push(g.x, g.y, 46, 46, g.hd, g.alt, SPR.gull[fr], 1, 1, 1, 1);
  }
  sprites.end(LG);
  sprites.upload();
}

/* ======================================================================
   Drawing
   ====================================================================== */
function draw(now) {
  const t = now_s(now);
  gl.disable(gl.BLEND);
  sprites.drawShadows(W, H, atlasTex, [LIGHT.dir[0] * -LIGHT.len, LIGHT.dir[1] * -LIGHT.len]);
  gl.viewport(0, 0, CW, CH);
  gl.disable(gl.BLEND);
  const { p, U } = GROUND;
  gl.useProgram(p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, morph.tex[0]); gl.uniform1i(U.uFA, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, morph.tex[1]); gl.uniform1i(U.uFB, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sprites.shadowTex); gl.uniform1i(U.uShade, 2);
  gl.uniform1f(U.uMix, morph.k); gl.uniform1f(U.uT, t); gl.uniform1f(U.uScale, CW / W);
  gl.uniform2f(U.uCv, CW, CH); gl.uniform2f(U.uGrid, field.Gw, field.Gh);
  gl.uniform1f(U.uShoal, P.shoal); gl.uniform1f(U.uShallow, P.shallow);
  gl.uniform3fv(U.uTint, LIGHT.tint); gl.uniform3fv(U.uWarm, LIGHT.warm); gl.uniform1f(U.uNight, LIGHT.night);
  gl.uniform4fv(U.uRings, rings);
  gl.bindVertexArray(VAO0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const tint = LIGHT.tint.map((v, i) => v * mix(1, LIGHT.warm[i], 0.35));
  for (let i = 0; i < sprites.layers.length; i++) if (!sprites.layers[i].hidden) sprites.draw(W, H, atlasTex, tint, CW, CH, i, i + 1);
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
  keys: ['clicks', 'sigma', 'warp', 'shoal', 'shallow', 'palms', 'kayaks', 'birds', 'byClock', 'hour'],
  resize(w, h, cw, ch) {
    W = w; H = h; CW = cw; CH = ch;
    field.resize(W, H); morph.alloc(); sprites.allocShadow(CW, CH);
    if (!first) computeLand(true);
  },
  icons(list, isFirst, prev) {
    icons = list;
    if (!isFirst) {
      const { added, gone } = diffIcons(prev, list);
      if (added.length <= 6) for (const a of added) addRing(a.x + a.w / 2, a.y + a.h / 2, 0);
      void gone;
    }
    computeLand(isFirst || first);
    first = false;
  },
  settings(keys) {
    if (keys.some(k => k === 'sigma' || k === 'warp')) computeLand(false);
    else if (keys.includes('palms')) placePalms();
    if (keys.includes('hour') || keys.includes('byClock')) updateLight();
  },
  reseed() { field.reseed(); palms = []; computeLand(true); },
  step(dt, now) {
    const t = now_s(now);
    simT += dt;
    morph.tick(now);
    if (page && page.frame % 300 === 0) updateLight();
    if (morph.moving && page.frame % 10 === 0) { placePalms(); placeDecor(); }
    stepKayaks(dt, t); stepGulls(dt, t); stepCrabs(dt); stepSchool(dt, t); stepStory(dt); stepNuts(dt);
    build(dt, t);
  },
  draw,
  click,
  stats: () => `sprites ${sprites.n} · palms ${palms.length}`,
});

window.__dbg = {
  P, LIGHT, palms: () => palms, click, castles, nuts, s: (x, y) => sNow(x, y), kayaks, gulls, crabs, school, ST,
  story(k) { ST.kind = null; return startStory(k); },
  set(k, v) { P[k] = v; if (k === 'hour') { P.byClock = 0; updateLight(); } else computeLand(false); },
  move(i, x, y) { const prev = page.icons.map(o => ({ ...o })); const next = prev.map(o => ({ ...o })); next[i] = { ...next[i], x, y }; page.icons = next; icons = next; for (const a of diffIcons(prev, next).added) addRing(a.x + a.w / 2, a.y + a.h / 2); computeLand(false); },
  advance(sec) { const dt = 1 / 30; for (let s = 0; s < sec; s += dt) { morph.t0 -= dt * 1000; const n = performance.now(); morph.tick(n); stepKayaks(dt, now_s(n)); stepGulls(dt); stepCrabs(dt); stepSchool(dt); stepStory(dt); build(dt, now_s(n)); } draw(performance.now()); },
  spawnAll() { for (const k of kayaks) if (k.i < P.kayaks) { k.on = true; k.x = W * (0.3 + 0.3 * k.i); k.y = H * 0.5; k.hd = 0.3; k.a = 1; } for (const g of gulls) if (g.i < P.birds) { g.on = true; g.x = W * (0.25 + 0.2 * g.i); g.y = H * (0.25 + 0.15 * g.i); g.hd = 0.5; } },
};
void WALL; void PREVIEW; void RNG; void fbm; void rng;
