"""Render the Autumn Forest tree crowns and ground tile from CC0 sources.

Trees: Quaternius "Stylized Nature MegaKit" (CC0, https://quaternius.com/packs/stylizednaturemegakit.html).
Ground: Poly Haven "leaves_forest_ground" (CC0, https://polyhaven.com/a/leaves_forest_ground).

Run with Blender 5.x (headless):
  blender -b --factory-startup -P tools/forest/render_trees.py -- \
      --src <dir with the MegaKit glTF/FBX/OBJ files> \
      --ground <Poly Haven diffuse map, jpg/png> \
      --out apps/desktop/public/themes/classic/assets

Writes:
  forest-crowns.webp   4x4 atlas of 512 px top-down crowns (straight alpha, colour bled into
                       transparent pixels so mipmaps have no dark fringes)
  forest-shadows.webp  same layout: blurred silhouettes for the shadow pass
  forest-crowns.json   per cell: palette, kind, crown radius as a fraction of the cell
  forest-ground.webp   1024 px seamless forest-floor tile, warmed and softened for label readability
"""

import argparse
import json
import math
import os
import random
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

CELL = 512
GRID = 4

# Autumn palettes (sRGB): dark, mid, light. Leaves are recoloured with a noise-driven ramp through
# these, multiplied by the luminance of the original leaf texture so the leaf detail survives.
PALETTES = {
    'orange': ['#6e2a0d', '#bf5419', '#f09235'],
    'rust': ['#5a2410', '#9c4a1d', '#d77a33'],
    'red': ['#4f110e', '#a12519', '#de4b2a'],
    'crimson': ['#3f0c12', '#861b22', '#c93a2f'],
    'gold': ['#6f4c0f', '#c38f1f', '#f3c84c'],
    'amber': ['#6a3d0c', '#b8741b', '#efab3c'],
    'olive': ['#3f4716', '#7c822a', '#c3a63e'],
}
# 16 cells: 4 orange/rust, 4 red, 4 gold/amber, 2 olive/amber, 2 firs
PLAN = [
    ('orange', 'broadleaf'), ('rust', 'broadleaf'), ('orange', 'broadleaf'), ('rust', 'broadleaf'),
    ('red', 'broadleaf'), ('crimson', 'broadleaf'), ('red', 'broadleaf'), ('crimson', 'broadleaf'),
    ('gold', 'broadleaf'), ('amber', 'broadleaf'), ('gold', 'broadleaf'), ('amber', 'broadleaf'),
    ('olive', 'broadleaf'), ('amber', 'broadleaf'),
    ('fir', 'evergreen'), ('fir', 'evergreen'),
]
# The pack's stylised pines read as flat paper stars from above, so the two "fir" cells are dense
# broadleaf crowns in a deep evergreen palette instead (set USE_PINES to render the pines).
USE_PINES = False
PALETTES['fir'] = ['#14240f', '#2a4420', '#4f6f34']
CONIFER_WORDS = ('pine', 'fir', 'spruce', 'conifer', 'cypress')
SKIP_WORDS = ('dead', 'stump', 'log', 'trunk', 'branch', 'root', 'bush', 'plant', 'grass', 'flower',
              'rock', 'pebble', 'mushroom', 'fern', 'clover', 'petal', 'path')
LEAF_WORDS = ('leaf', 'leaves', 'foliage', 'needle', 'canopy', 'crown')


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--src', required=True)
    p.add_argument('--ground', required=False)
    p.add_argument('--out', required=True)
    p.add_argument('--samples', type=int, default=96)
    p.add_argument('--seed', type=int, default=7)
    return p.parse_args(argv)


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_linear(h):
    return tuple(srgb_to_linear(int(h[i:i + 2], 16)) for i in (1, 3, 5)) + (1.0,)


def find_models(src):
    exts = ('.glb', '.gltf', '.fbx', '.obj')
    files = []
    for root, _, names in os.walk(src):
        for n in names:
            if n.lower().endswith(exts):
                files.append(os.path.join(root, n))
    # prefer one format per model name (glTF > FBX > OBJ)
    best = {}
    rank = {'.glb': 0, '.gltf': 1, '.fbx': 2, '.obj': 3}
    for f in files:
        stem, ext = os.path.splitext(os.path.basename(f))
        k = stem.lower()
        if k not in best or rank[ext.lower()] < rank[os.path.splitext(best[k])[1].lower()]:
            best[k] = f
    trees = [f for k, f in best.items() if 'tree' in k or any(w in k for w in CONIFER_WORDS)]
    trees = [f for f in trees if not any(w in os.path.basename(f).lower() for w in SKIP_WORDS)]
    conifers = sorted(f for f in trees if any(w in os.path.basename(f).lower() for w in CONIFER_WORDS))
    broad = sorted(f for f in trees if f not in conifers)
    return broad, conifers


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(path):
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.wm.obj_import(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def is_leaf_material(mat):
    name = mat.name.lower()
    if any(w in name for w in LEAF_WORDS):
        return True
    bsdf = principled(mat)
    if bsdf is None:
        return False
    col = bsdf.inputs['Base Color'].default_value
    return col[1] > col[0] * 1.15 and col[1] > col[2]


def principled(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    return None


def autumnize(mat, pal, rng):
    """Replace the leaf colour with a noise-driven autumn ramp, keeping texture luminance and alpha."""
    nt = mat.node_tree
    bsdf = principled(mat)
    if bsdf is None:
        return
    base = bsdf.inputs['Base Color']
    src = base.links[0].from_socket if base.links else None
    coord = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 2.2 + rng.random() * 1.5
    noise.inputs['Detail'].default_value = 3.0
    # offset the noise per tree so two trees with the same palette still differ
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Location'].default_value = (rng.random() * 50, rng.random() * 50, rng.random() * 50)
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    stops = [hex_linear(h) for h in PALETTES[pal]]
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.3, stops[0]
    el[1].position, el[1].color = 0.72, stops[2]
    mid = el.new(0.5)
    mid.color = stops[1]
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    out = ramp.outputs['Color']
    if src is not None:
        bw = nt.nodes.new('ShaderNodeRGBToBW')
        nt.links.new(src, bw.inputs['Color'])
        lift = nt.nodes.new('ShaderNodeMath')
        lift.operation = 'MULTIPLY_ADD'
        lift.inputs[1].default_value = 1.1
        lift.inputs[2].default_value = 0.45
        nt.links.new(bw.outputs['Val'], lift.inputs[0])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(out, mul.inputs['A'])
        nt.links.new(lift.outputs['Value'], mul.inputs['B'])
        out = mul.outputs['Result']
    nt.links.new(out, base)
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = 0.75
    foliage_light(nt, bsdf, out)


def foliage_light(nt, bsdf, colour):
    """Leaf cards: let light through (translucency) and add a little ambient glow, so a crown seen
    from above reads as sunlit foliage instead of a dark ball of back-facing cards."""
    output = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if output is None:
        return
    trans = nt.nodes.new('ShaderNodeBsdfTranslucent')
    nt.links.new(colour, trans.inputs['Color'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = 0.4
    nt.links.new(bsdf.outputs['BSDF'], mix.inputs[1])
    nt.links.new(trans.outputs['BSDF'], mix.inputs[2])
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(colour, emit.inputs['Color'])
    emit.inputs['Strength'].default_value = 0.28
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(mix.outputs['Shader'], add.inputs[0])
    nt.links.new(emit.outputs['Emission'], add.inputs[1])
    # keep the leaf cut-out: route the original alpha through a transparent mix
    alpha_in = bsdf.inputs.get('Alpha')
    final = add.outputs['Shader']
    if alpha_in is not None and alpha_in.links:
        transp = nt.nodes.new('ShaderNodeBsdfTransparent')
        cut = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(alpha_in.links[0].from_socket, cut.inputs['Fac'])
        nt.links.new(transp.outputs['BSDF'], cut.inputs[1])
        nt.links.new(final, cut.inputs[2])
        final = cut.outputs['Shader']
    nt.links.new(final, output.inputs['Surface'])


def darken_bark(mat):
    bsdf = principled(mat)
    if bsdf is None:
        return
    # matte, so the dark bark does not mirror the blue sky
    bsdf.inputs['Roughness'].default_value = 1.0
    for name in ('Specular IOR Level', 'Specular'):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = 0.0
    if 'Normal' in bsdf.inputs and bsdf.inputs['Normal'].links:
        mat.node_tree.links.remove(bsdf.inputs['Normal'].links[0])
    base = bsdf.inputs['Base Color']
    tint = (0.16, 0.1, 0.06, 1)
    if base.links:
        mix = mat.node_tree.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mat.node_tree.links.new(base.links[0].from_socket, mix.inputs['A'])
        mix.inputs['B'].default_value = tint
        mat.node_tree.links.new(mix.outputs['Result'], base)
    else:
        base.default_value = tint


def warm_conifer(mat):
    bsdf = principled(mat)
    if bsdf is None:
        return
    base = bsdf.inputs['Base Color']
    if base.links:
        # deepen and desaturate the stylised bright green into a natural spruce green
        mix = mat.node_tree.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mat.node_tree.links.new(base.links[0].from_socket, mix.inputs['A'])
        mix.inputs['B'].default_value = (0.42, 0.5, 0.36, 1)
        mat.node_tree.links.new(mix.outputs['Result'], base)
    else:
        c = base.default_value
        base.default_value = (c[0] * 0.45, c[1] * 0.5, c[2] * 0.36, 1)


def setup_render(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for backend in ('OPTIX', 'CUDA', 'HIP'):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                if any(d.type == backend for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == backend
                    sc.cycles.device = 'GPU'
                    break
            except TypeError:
                continue
    except KeyError:
        pass
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    # dozens of alpha-masked leaf cards overlap in a crown: without enough transparent bounces
    # Cycles stops early and the inside of the crown renders black
    sc.cycles.transparent_max_bounces = 128
    sc.cycles.max_bounces = 12
    sc.cycles.diffuse_bounces = 6
    sc.cycles.transmission_bounces = 6
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = CELL
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.7, 0.72, 0.78, 1)
    bg.inputs['Strength'].default_value = 1.4
    sc.world = world
    # warm, fairly high sun from the top left of the image (camera looks down -Z, image up = +Y)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 5.0
    sun.color = (1.0, 0.9, 0.76)
    sun.angle = math.radians(6)
    so = bpy.data.objects.new('sun', sun)
    d = Vector((0.75, -0.9, -1.9)).normalized()
    so.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def frame_top(cam_obj, objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == 'MESH' for c in o.bound_box]
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    size = max(max(xs) - min(xs), max(ys) - min(ys))
    cam_obj.location = (cx, cy, max(zs) + 10)
    cam_obj.rotation_euler = (0, 0, 0)
    cam_obj.data.ortho_scale = size * 1.1
    cam_obj.data.clip_end = max(zs) - min(zs) + 50


def render_tree(path, pal, kind, cam_obj, rng, tmp, idx):
    objs = import_model(path)
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m:
                continue
            if not is_leaf_material(m):
                # bark seen through gaps in the crown should read as shade, not as grey sticks
                m = m.copy()
                slot.material = m
                darken_bark(m)
                continue
            m = m.copy()
            slot.material = m
            if kind == 'conifer':
                warm_conifer(m)
            else:
                autumnize(m, pal, rng)
    # spin the model, never the light: baked lighting must stay top-left
    root = [o for o in objs if o.parent is None]
    ang = rng.random() * math.tau
    for o in root:
        o.rotation_euler.z += ang
    bpy.context.view_layer.update()
    frame_top(cam_obj, objs)
    out = os.path.join(tmp, f'crown_{idx:02d}.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return out


def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return a


def box_blur(a, r):
    for axis in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(a.ndim)], mode='edge'), axis=axis)
        hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def bleed(rgba, iters=24):
    """Spread colour into transparent pixels so mipmapping never pulls in black."""
    rgb, a = rgba[..., :3].copy(), rgba[..., 3]
    known = a > 0.02
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            k = np.roll(np.roll(known, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * k[..., None]
            cnt += k
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        known = known | grow
        if known.all():
            break
    rgb[~known] = rgb[known].mean(axis=0)
    out = rgba.copy()
    out[..., :3] = rgb
    return out


def save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels[:] = np.clip(arr[::-1], 0, 1).ravel()
    img.filepath_raw = path
    img.file_format = 'WEBP' if path.endswith('.webp') else 'PNG'
    img.save()
    bpy.data.images.remove(img)


def crown_radius(alpha):
    h, w = alpha.shape
    ys, xs = np.nonzero(alpha > 0.1)
    if not len(xs):
        return 0.4
    d = np.hypot(xs - w / 2, ys - h / 2)
    return float(np.percentile(d, 97) / w)


def make_ground(path, out):
    img = bpy.data.images.load(path)
    img.scale(1024, 1024)
    w, h = img.size
    g = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    rgb = g[..., :3]
    soft = box_blur(box_blur(rgb, 2), 2)
    rgb = rgb * 0.7 + soft * 0.3                      # soften fine detail
    mean = rgb.reshape(-1, 3).mean(axis=0)
    rgb = mean + (rgb - mean) * 0.82                  # less contrast so labels stay readable
    rgb *= np.array([1.07, 1.0, 0.86])                # warmer, autumn afternoon
    rgb *= 0.92
    g[..., :3] = rgb
    g[..., 3] = 1
    save(g, out)


def main():
    a = parse_args()
    os.makedirs(a.out, exist_ok=True)
    broad, conifers = find_models(a.src)
    print(f'found {len(broad)} broadleaf and {len(conifers)} conifer models')
    if not broad:
        raise SystemExit('no tree models found under --src')
    rng = random.Random(a.seed)
    clear_scene()
    cam = setup_render(a.samples)
    tmp = tempfile.mkdtemp(prefix='deskwall-forest-')
    atlas = np.zeros((CELL * GRID, CELL * GRID, 4), np.float32)
    shadows = np.zeros_like(atlas)
    manifest = []
    bi = ci = 0
    for idx, (pal, kind) in enumerate(PLAN):
        if kind == 'evergreen' and USE_PINES and conifers:
            kind = 'conifer'
            path = conifers[ci % len(conifers)]
            ci += 1
        elif kind == 'evergreen':
            kind = 'broadleaf'
            path = [b for b in broad if 'common' in os.path.basename(b).lower()][ci % 5] if broad else None
            ci += 1
        else:
            kind = 'broadleaf'
            path = broad[bi % len(broad)]
            bi += 1
        print(f'[{idx + 1}/16] {os.path.basename(path)} -> {pal}')
        png = render_tree(path, pal, kind, cam, rng, tmp, idx)
        rgba = load_rgba(png)
        r, c = divmod(idx, GRID)
        ys, xs = slice(r * CELL, (r + 1) * CELL), slice(c * CELL, (c + 1) * CELL)
        atlas[ys, xs] = bleed(rgba)
        sil = box_blur(rgba[..., 3], 10)
        shadows[ys, xs, 3] = sil
        manifest.append({'pal': pal, 'kind': kind, 'r': round(crown_radius(rgba[..., 3]), 4),
                         'model': os.path.basename(path)})
    save(atlas, os.path.join(a.out, 'forest-crowns.webp'))
    save(shadows, os.path.join(a.out, 'forest-shadows.webp'))
    with open(os.path.join(a.out, 'forest-crowns.json'), 'w') as f:
        json.dump({'cell': CELL, 'grid': GRID, 'crowns': manifest}, f, indent=1)
    if a.ground:
        make_ground(a.ground, os.path.join(a.out, 'forest-ground.webp'))
    print('done:', a.out)


if __name__ == '__main__':
    main()
