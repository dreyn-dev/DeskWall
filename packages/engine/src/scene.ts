import { DEFAULT_SETTINGS, type Settings } from '@deskwall/protocol';
import {
  abs,
  clamp,
  dFdx,
  dFdy,
  exp,
  Fn,
  float,
  floor,
  fract,
  fwidth,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  Scene,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGPURenderer,
} from 'three/webgpu';
import { computeField, FIELD_RANGE, type Field, mixFields, type Rect } from './field';
import { PALETTES } from './palettes';

export type Backend = 'webgpu' | 'webgl2';

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  /** Force the WebGL2 backend even if WebGPU is available. */
  forceWebGL?: boolean;
  settings?: Settings;
  /** Max device pixel ratio for rendering. Lower = faster. */
  maxPixelRatio?: number;
  /** Duration of the reshaping animation when icons move, in ms. */
  morphMs?: number;
}

export interface DeskScene {
  readonly backend: Backend;
  setIcons(icons: readonly Rect[]): void;
  setSettings(settings: Settings): void;
  setPaused(paused: boolean): void;
  /** Cursor over the empty desktop (CSS px), null when it left. Themes may react to it. */
  setPointer?(p: { x: number; y: number; down: boolean } | null): void;
  /** Frames rendered since start; handy for tests and diagnostics. */
  readonly frames: number;
  dispose(): void;
}

const FIELD_CELL = 8;
const ease = (t: number) => t * t * (3 - 2 * t);

function makeFieldTexture(field: Field) {
  const tex = new DataTexture(
    new Uint16Array(field.cols * field.rows),
    field.cols,
    field.rows,
    RedFormat,
    HalfFloatType,
  );
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function upload(tex: DataTexture, values: Float32Array) {
  const dst = tex.image.data as Uint16Array;
  for (let i = 0; i < values.length; i++)
    dst[i] = DataUtils.toHalfFloat((values[i] as number) / FIELD_RANGE);
  tex.needsUpdate = true;
}

/**
 * Creates the wallpaper scene. Uses three.js WebGPURenderer, which picks WebGPU when present
 * and falls back to its WebGL2 backend otherwise; the shader is written once in TSL for both.
 */
export async function createScene(opts: SceneOptions): Promise<DeskScene> {
  const { canvas } = opts;
  let settings = opts.settings ?? DEFAULT_SETTINGS;
  const morphMs = opts.morphMs ?? 900;
  const maxPixelRatio = opts.maxPixelRatio ?? 2;

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: opts.forceWebGL ?? false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  await renderer.init();
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu'
    : 'webgl2';

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // --- state -----------------------------------------------------------------
  let width = Math.max(1, canvas.clientWidth);
  let height = Math.max(1, canvas.clientHeight);
  let icons: readonly Rect[] = [];
  let from: Field = computeField([], width, height, {
    cell: FIELD_CELL,
    reach: settings.landReach,
  });
  let to: Field = from;
  let morphStart = 0;
  let morphing = false;
  let fieldTex = makeFieldTexture(from);
  upload(fieldTex, from.data);
  let simTime = 0;
  let paused = false;
  let frames = 0;
  let disposed = false;
  let ptrDown = false;

  // --- uniforms --------------------------------------------------------------
  const uRes = uniform(vec2(width, height));
  const uFieldScale = uniform(vec2(1, 1));
  const uFieldOffset = uniform(vec2(0, 0));
  const uTime = uniform(0);
  const uRough = uniform(settings.roughness);
  const uContours = uniform(settings.contours ? 1 : 0);
  const col = (hex: string) => uniform(new Color(hex));
  const p0 = PALETTES[settings.palette];
  const uc = {
    deep: col(p0.deep),
    shallow: col(p0.shallow),
    foam: col(p0.foam),
    sand: col(p0.sand),
    low: col(p0.low),
    high: col(p0.high),
    peak: col(p0.peak),
    contour: col(p0.contour),
    glow: col(p0.glow),
  };
  const uShade = uniform(p0.shade);
  // Cursor: a soft lantern glow around it; taps: rings on the water and a paper hill that pops
  // up on land. Five quick taps in one spot raise a small island that stays for a while.
  const uPtr = uniform(new Vector3(-1e4, -1e4, 0));
  const taps = [0, 1, 2, 3].map(() => ({
    x: 0,
    y: 0,
    age: -1,
    amp: 0,
    keep: false,
    u: uniform(new Vector4(0, 0, -1, 0)),
  }));
  let tapI = 0;
  const recent: { x: number; y: number; t: number }[] = [];
  const fieldNode = texture(fieldTex);

  // --- shader ----------------------------------------------------------------
  const shader = Fn(() => {
    const st = vec2(uv().x, uv().y.oneMinus());
    const p = st.mul(uRes); // CSS pixels, origin top-left
    const t = uTime;

    const raw = fieldNode.sample(st.mul(uFieldScale).add(uFieldOffset)).r.mul(FIELD_RANGE);
    const n = mx_fractal_noise_float(vec3(p.mul(0.009), t.mul(0.015)), 3, 2.0, 0.5);
    const e = raw.add(n.mul(uRough.mul(26).add(4))).toVar();
    const ripple = float(0).toVar();
    for (const tp of taps) {
      const d = p.sub(tp.u.xy).length();
      const alive = smoothstep(-0.01, 0, tp.u.z);
      e.addAssign(tp.u.w.mul(exp(d.mul(d).div(-1800))).mul(alive));
      const r = tp.u.z.mul(70).add(4);
      ripple.addAssign(
        exp(d.sub(r).div(5).pow(2).negate())
          .mul(exp(tp.u.z.mul(-1.1)))
          .mul(alive),
      );
    }

    // Water: depth gradient, travelling rings and a moving shoreline.
    const depth = smoothstep(-90, -4, e);
    const water = mix(uc.deep, uc.shallow, depth.pow(1.6)).toVar();
    const ring = sin(e.mul(0.32).add(t.mul(1.4)));
    const ringMask = smoothstep(-48, -10, e).mul(smoothstep(0.82, 0.98, ring));
    water.assign(mix(water, uc.foam, ringMask.mul(0.35)));
    const shoreE = e.add(sin(t.mul(0.9).add(p.x.mul(0.01))).mul(1.6));
    const foam = smoothstep(4, 0, abs(shoreE.add(1.5)));
    water.assign(mix(water, uc.glow, foam.mul(0.9)));
    water.assign(mix(water, uc.foam, clamp(ripple, 0, 1).mul(0.45)));

    // Land: beach, then terraces with contour lines.
    const terraceStep = float(20);
    const above = max(e.sub(9), 0).div(terraceStep);
    const level = floor(above);
    const tier = clamp(level.div(4), 0, 1);
    const land = mix(uc.low, uc.high, tier).toVar();
    land.assign(mix(land, uc.peak, smoothstep(4.5, 6, level)));
    land.assign(mix(uc.sand, land, smoothstep(7, 10, e)));

    // Soft slope lighting from the top-left.
    const slope = normalize(vec3(dFdx(e).negate(), dFdy(e).negate(), 2.5));
    const light = clamp(slope.dot(normalize(vec3(-0.5, -0.6, 1))), 0, 1);
    land.mulAssign(mix(0.82, 1.08, light));

    // Terrace edges: anti-aliased contour lines plus a paper-cut drop shadow below each step.
    const fw = max(fwidth(above), 0.0001);
    const edge = fract(above);
    const line = smoothstep(fw.mul(1.5), 0, edge)
      .mul(smoothstep(0.5, 1.5, above))
      .mul(uContours);
    land.assign(mix(land, uc.contour, line.mul(0.45)));
    const shadow = smoothstep(fw.mul(6), 0, fract(above.add(0.12))).mul(
      smoothstep(0.5, 1.5, above),
    );
    land.mulAssign(float(1).sub(shadow.mul(0.12)));

    const isLand = smoothstep(-0.5, 0.5, e);
    const colorOut = mix(water, land, isLand).toVar();

    // Drifting cloud shadows.
    const cloud = mx_fractal_noise_float(
      vec3(p.mul(0.0016).add(vec2(t.mul(0.012), t.mul(0.005))), t.mul(0.01)),
      3,
      2.0,
      0.5,
    );
    colorOut.mulAssign(float(1).sub(smoothstep(0.05, 0.45, cloud).mul(uShade)));

    // Lantern glow around the cursor while it is over the desktop.
    const dc = p.sub(uPtr.xy).length();
    colorOut.mulAssign(float(1).add(exp(dc.mul(dc).div(-9000)).mul(uPtr.z).mul(0.07)));

    // Gentle vignette keeps the edges calm behind taskbar and corners.
    const v = st.sub(0.5).length();
    colorOut.mulAssign(mix(1, 0.9, smoothstep(0.45, 0.85, v)));
    return vec4(colorOut, 1);
  });

  const material = new MeshBasicNodeMaterial();
  material.colorNode = shader();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  // --- field updates -----------------------------------------------------------
  let blended = new Float32Array(to.data.length);
  const rebuildField = (now: number) => {
    const next = computeField(icons, width, height, {
      cell: FIELD_CELL,
      reach: settings.landReach,
    });
    if (next.cols !== to.cols || next.rows !== to.rows) {
      // Surface size changed: no meaningful morph, swap texture.
      fieldTex.dispose();
      fieldTex = makeFieldTexture(next);
      fieldNode.value = fieldTex;
      from = next;
      to = next;
      blended = new Float32Array(next.data.length);
      upload(fieldTex, next.data);
      morphing = false;
    } else {
      // Start the morph from wherever the current animation is.
      const k = morphing ? ease(Math.min(1, (now - morphStart) / morphMs)) : 1;
      from = { ...to, data: mixFields(from, to, k) };
      to = next;
      morphStart = now;
      morphing = true;
    }
    // Grid point i sits at i * cell px and at texel centre (i + 0.5) / cols.
    uFieldScale.value.set(width / (next.cell * next.cols), height / (next.cell * next.rows));
    uFieldOffset.value.set(0.5 / next.cols, 0.5 / next.rows);
    requestFrame();
  };

  const stepMorph = (now: number) => {
    if (!morphing) return;
    const k = ease(Math.min(1, (now - morphStart) / morphMs));
    upload(fieldTex, mixFields(from, to, k, blended));
    if (k >= 1) morphing = false;
  };

  // --- loop --------------------------------------------------------------------
  let last = performance.now();
  let lastDraw = 0;
  let pendingOneShot = false;

  const draw = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) simTime += dt * settings.motion;
    uTime.value = simTime;
    for (const tp of taps) {
      if (tp.age < 0) continue;
      tp.age += dt;
      // a quick pop that settles, or a lasting island that sinks back after ~40 s
      const amp = tp.keep
        ? tp.amp * Math.min(1, tp.age * 1.5) * (1 - Math.max(0, tp.age - 40) / 8)
        : tp.amp * Math.exp(-tp.age * 2.2) * (1 + 0.4 * Math.sin(tp.age * 12));
      if ((tp.keep && tp.age > 48) || (!tp.keep && tp.age > 5)) tp.age = -1;
      tp.u.value.set(tp.x, tp.y, tp.age, tp.age < 0 ? 0 : amp);
    }
    stepMorph(now);
    renderer.render(scene, camera);
    frames++;
  };

  const loop = (now: number) => {
    if (disposed) return;
    const minGap = 1000 / settings.fps - 2;
    if (now - lastDraw < minGap) return;
    lastDraw = now;
    draw(now);
  };

  const applyLoop = () => {
    renderer.setAnimationLoop(paused ? null : loop);
  };

  /** Renders while paused (e.g. after a settings change) without restarting the loop. */
  function requestFrame() {
    if (!paused || pendingOneShot || disposed) return;
    pendingOneShot = true;
    const tick = (now: number) => {
      draw(now);
      if (morphing) requestAnimationFrame(tick);
      else pendingOneShot = false;
    };
    requestAnimationFrame(tick);
  }

  const resize = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.setSize(w, h, false);
    if (w === width && h === height) return;
    width = w;
    height = h;
    uRes.value.set(w, h);
    rebuildField(performance.now());
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  rebuildField(performance.now());
  applyLoop();

  const applyPalette = () => {
    const p = PALETTES[settings.palette];
    for (const key of Object.keys(uc) as (keyof typeof uc)[]) uc[key].value.set(p[key]);
    uShade.value = p.shade;
  };

  return {
    backend,
    get frames() {
      return frames;
    },
    setIcons(next) {
      icons = next.map((r) => ({ ...r }));
      rebuildField(performance.now());
    },
    setSettings(next) {
      const reachChanged = next.landReach !== settings.landReach;
      settings = next;
      uRough.value = next.roughness;
      uContours.value = next.contours ? 1 : 0;
      applyPalette();
      if (reachChanged) rebuildField(performance.now());
      requestFrame();
    },
    setPointer(ptr) {
      const was = ptrDown;
      ptrDown = !!ptr?.down;
      uPtr.value.set(ptr?.x ?? -1e4, ptr?.y ?? -1e4, ptr ? 1 : 0);
      if (
        ptr &&
        !ptr.down &&
        was &&
        !icons.some((r) => ptr.x > r.x && ptr.x < r.x + r.w && ptr.y > r.y && ptr.y < r.y + r.h)
      ) {
        const now = performance.now() / 1000;
        recent.push({ x: ptr.x, y: ptr.y, t: now });
        while (recent.length && now - (recent[0] as { t: number }).t > 3) recent.shift();
        const here = recent.filter((q) => Math.hypot(q.x - ptr.x, q.y - ptr.y) < 50).length;
        const tp = taps[tapI] as (typeof taps)[number];
        tapI = (tapI + 1) % taps.length;
        Object.assign(tp, {
          x: ptr.x,
          y: ptr.y,
          age: 0,
          keep: here >= 5,
          amp: here >= 5 ? 95 : 16,
        });
        if (here >= 5) recent.length = 0;
        requestFrame();
      }
    },
    setPaused(next) {
      if (next === paused) return;
      paused = next;
      last = performance.now();
      applyLoop();
    },
    dispose() {
      disposed = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      fieldTex.dispose();
      material.dispose();
      quad.geometry.dispose();
      renderer.dispose();
    },
  };
}
