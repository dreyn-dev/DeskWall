"""Render the "Thaw" theme's ground sprites and ground tiles from CC0 sources.

Plants and stones: Quaternius "Stylized Nature MegaKit" (CC0), rendered strictly top-down with the
same camera and warm top-left sun as the forest crowns (tools/forest/render_trees.py).
Ground tiles: Poly Haven snow_02, mud_forest, brown_mud_leaves_01, grass_ground (all CC0).

Run with Blender 5.x:
  blender -b --factory-startup -P tools/thaw/render_sprites.py -- \
      --src <MegaKit glTF dir> --tiles <dir with the Poly Haven *_diff_2k.jpg> \
      --out apps/desktop/public/themes/classic/assets

Writes thaw-sprites.webp (4x4 atlas, 256 px cells, straight alpha with bled colour),
thaw-sprites.json (per cell: kind, radius as a fraction of the cell, real size in metres) and
thaw-snow.webp, thaw-earth.webp, thaw-green.webp, thaw-grass.webp (1024 px seamless tiles).
"""

import argparse
import json
import os
import random
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'forest'))
import render_trees as rt  # noqa: E402  (shared Blender helpers)

CELL = 256
GRID = 5

# (model, kind, petal colour or None, leaf tint)  colours are sRGB hex
PLAN = [
    ('Flower_3_Group', 'snowdrops', '#f4f6f2', '#5f7a52'),
    ('Flower_3_Single', 'snowdrop', '#f6f7f3', '#62805a'),
    ('Flower_4_Group', 'crocuses', '#8e5bc8', '#6b8a4e'),
    ('Flower_4_Single', 'crocus', '#a172d6', '#6b8a4e'),
    ('Flower_4_Group', 'crocuses_white', '#ece4f4', '#6b8a4e'),
    ('Flower_3_Group', 'coltsfoot', '#f2c53a', '#6f7d3e'),
    ('Clover_1', 'clover', None, '#5d8a3c'),
    ('Clover_2', 'clover', None, '#68923f'),
    ('Grass_Common_Short', 'shoots', None, '#79a84a'),
    ('Grass_Wispy_Short', 'old_grass', None, '#b9a46a'),
    ('Plant_1', 'leaves', None, '#5f8a42'),
    ('Fern_1', 'fern', None, '#6f9446'),
    ('Pebble_Round_1', 'pebble', None, '#6d6860'),
    ('Pebble_Round_3', 'pebble', None, '#625e57'),
    ('Pebble_Square_2', 'pebble', None, '#706a62'),
    ('Rock_Medium_1', 'rock', None, '#67625a'),
    # spring proper: tulips, dandelions, primroses, flowering and fresh bushes
    ('Flower_4_Group', 'tulips', '#e0362b', '#5f8d3e'),
    ('Flower_4_Group', 'tulips_yellow', '#f4c22e', '#5f8d3e'),
    ('Flower_3_Group', 'dandelions', '#ffd21f', '#5d9038'),
    ('Flower_3_Group', 'primroses', '#f7e98f', '#5f8d3e'),
    ('Bush_Common_Flowers', 'bush_blossom', '#f6c6d6', '#5e9a3c'),
    ('Bush_Common', 'bush_fresh', None, '#79b544'),
    ('Flower_4_Single', 'tulip', '#ef5a8a', '#5f8d3e'),
    ('Grass_Common_Tall', 'grass_tall', None, '#6fae3f'),
    ('Clover_1', 'clover_bright', None, '#76b046'),
]
# The "full spring" experiment (blossoming trees, a dense grass tile) is parked: Mark preferred a
# calm glade. Set to True to render those extras too.
SPRING_EXTRAS = False
# Small spring trees for big merged patches: (model, kind, leaf colour, blossom mix)
TREES = [
    ('CommonTree_1', 'tree_cherry', '#f3c1d3'),
    ('CommonTree_3', 'tree_apple', '#f7eef0'),
    ('CommonTree_2', 'tree_birch', '#a7d45a'),
    ('CommonTree_5', 'tree_willow', '#cfe06a'),
]
TILES = {
    'snow': ('snow_02', dict(calm=0.55, warm=(0.99, 1.0, 1.02), gain=1.02)),
    'earth': ('mud_forest', dict(calm=0.15, warm=(1.04, 1.0, 0.94), gain=0.95)),
    'green': ('brown_mud_leaves_01', dict(calm=0.2, warm=(1.0, 1.0, 0.92), gain=0.9)),
    'grass': ('grass_ground', dict(calm=0.2, warm=(1.05, 1.0, 0.88), gain=0.95)),
}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--src', required=True)
    p.add_argument('--tiles', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--samples', type=int, default=64)
    return p.parse_args(argv)


def tint(mat, hexcol, lift=0.5):
    """Base colour = flat colour x (lift + luminance of the original texture): keeps the detail."""
    bsdf = rt.principled(mat)
    if bsdf is None:
        return
    nt = mat.node_tree
    base = bsdf.inputs['Base Color']
    col = rt.hex_linear(hexcol)
    if base.links:
        src = base.links[0].from_socket
        bw = nt.nodes.new('ShaderNodeRGBToBW')
        nt.links.new(src, bw.inputs['Color'])
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY_ADD'
        m.inputs[1].default_value = 1.0
        m.inputs[2].default_value = lift
        nt.links.new(bw.outputs['Val'], m.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['A'].default_value = col
        nt.links.new(m.outputs['Value'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], base)
    else:
        base.default_value = col
    bsdf.inputs['Roughness'].default_value = 0.8


def render_sprite(path, petal, leaf, cam, tmp, idx):
    objs = rt.import_model(path)
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m:
                continue
            m = m.copy()
            slot.material = m
            name = m.name.lower()
            if 'flower' in name and petal:
                tint(m, petal, 0.35)
            else:
                tint(m, leaf, 0.45)
            if 'leaves' in name or 'grass' in name or 'flower' in name:
                bsdf = rt.principled(m)
                rt.foliage_light(m.node_tree, bsdf, bsdf.inputs['Base Color'].links[0].from_socket
                                 if bsdf.inputs['Base Color'].links else bsdf.outputs['BSDF'])
    root = [o for o in objs if o.parent is None]
    ang = random.random() * 6.283
    for o in root:
        o.rotation_euler.z += ang
    bpy.context.view_layer.update()
    rt.frame_top(cam, objs)
    size = cam.data.ortho_scale
    out = os.path.join(tmp, f'sprite_{idx:02d}.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return out, size


def render_tree_sprite(path, leaf, cam, tmp, idx):
    objs = rt.import_model(path)
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m:
                continue
            m = m.copy()
            slot.material = m
            if rt.is_leaf_material(m):
                tint(m, leaf, 0.55)
                bsdf = rt.principled(m)
                rt.foliage_light(m.node_tree, bsdf, bsdf.inputs['Base Color'].links[0].from_socket)
            else:
                rt.darken_bark(m)
    ang = random.random() * 6.283
    for o in objs:
        if o.parent is None:
            o.rotation_euler.z += ang
    bpy.context.view_layer.update()
    rt.frame_top(cam, objs)
    size = cam.data.ortho_scale
    out = os.path.join(tmp, f'tree_{idx:02d}.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return out, size


def make_grass_tile(src, out, cam, tmp, T=3.0, count=1100):
    """A seamless top-down tile of dense young grass and clover over dark soil."""
    sc = bpy.context.scene
    rng = random.Random(5)
    plane_mesh = bpy.data.meshes.new('soil')
    plane_mesh.from_pydata([(-1, -1, 0), (T + 1, -1, 0), (T + 1, T + 1, 0), (-1, T + 1, 0)], [], [(0, 1, 2, 3)])
    soil = bpy.data.objects.new('soil', plane_mesh)
    mat = bpy.data.materials.new('soil')
    mat.use_nodes = True
    rt.principled(mat).inputs['Base Color'].default_value = rt.hex_linear('#3a4320')
    soil.data.materials.append(mat)
    sc.collection.objects.link(soil)
    templates = []
    for name, col, weight in (('Grass_Common_Short', '#69a83c', 4), ('Grass_Common_Tall', '#5c9a34', 2),
                              ('Grass_Wispy_Short', '#83b84a', 2), ('Clover_1', '#6aa63f', 1), ('Clover_2', '#78b046', 1)):
        objs = [o for o in rt.import_model(os.path.join(src, name + '.gltf')) if o.type == 'MESH']
        for o in objs:
            for slot in o.material_slots:
                if slot.material:
                    slot.material = slot.material.copy()
                    tint(slot.material, col, 0.5)
        pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
        w = max(max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts)) or 1
        for o in objs:
            o.location.x += 1000            # park the template out of view
        templates += [(objs, 0.32 / w)] * weight
    for _ in range(count):
        objs, k = templates[rng.randrange(len(templates))]
        x, y, rz, s = rng.random() * T, rng.random() * T, rng.random() * 6.283, k * (0.7 + rng.random() * 0.6)
        offs = [(0, 0)] + [(dx, dy) for dx in (-T, 0, T) for dy in (-T, 0, T)
                           if (dx or dy) and -0.4 < x + dx < T + 0.4 and -0.4 < y + dy < T + 0.4]
        for dx, dy in offs:
            for o in objs:
                c = o.copy()
                c.location = (x + dx, y + dy, 0)
                c.rotation_euler = (o.rotation_euler.x, o.rotation_euler.y, rz)
                c.scale = (s, s, s)
                sc.collection.objects.link(c)
    cam.location = (T / 2, T / 2, 20)
    cam.rotation_euler = (0, 0, 0)
    cam.data.ortho_scale = T
    cam.data.clip_end = 100
    sc.render.film_transparent = False
    sc.render.resolution_x = sc.render.resolution_y = 1024
    path = os.path.join(tmp, 'grass_tile.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    g = rt.load_rgba(path)
    g[..., 3] = 1
    rt.save(g, out)
    print('tile spring')


def downsample(a, k):
    h, w = a.shape[:2]
    return a.reshape(h // k, k, w // k, k, a.shape[2]).mean(axis=(1, 3))


def make_tile(src, out, calm, warm, gain):
    img = bpy.data.images.load(src)
    img.scale(1024, 1024)
    g = np.array(img.pixels[:], dtype=np.float32).reshape(1024, 1024, 4)[::-1].copy()
    bpy.data.images.remove(img)
    rgb = g[..., :3]
    mean = rgb.reshape(-1, 3).mean(axis=0)
    # calm: pull dark marks (tracks, debris) towards the mean so the surface stays quiet
    soft = rt.box_blur(rt.box_blur(rgb, 3), 3)
    rgb = rgb * (1 - calm) + soft * calm
    rgb = mean + (rgb - mean) * (1 - calm * 0.5)
    rgb = rgb * np.array(warm) * gain
    g[..., :3] = rgb
    g[..., 3] = 1
    rt.save(g, out)


def main():
    a = parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(11)
    rt.clear_scene()
    cam = rt.setup_render(a.samples)
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = CELL * 2   # render 2x, downsample for clean edges
    tmp = tempfile.mkdtemp(prefix='deskwall-thaw-')
    atlas = np.zeros((CELL * GRID, CELL * GRID, 4), np.float32)
    manifest = []
    for idx, (model, kind, petal, leaf) in enumerate(PLAN):
        path = None
        for ext in ('.gltf', '.glb', '.fbx', '.obj'):
            p = os.path.join(a.src, model + ext)
            if os.path.exists(p):
                path = p
                break
        if path is None:
            raise SystemExit(f'missing model {model}')
        print(f'[{idx + 1}/{len(PLAN)}] {model} -> {kind}')
        png, size = render_sprite(path, petal, leaf, cam, tmp, idx)
        rgba = downsample(rt.load_rgba(png), 2)
        r, c = divmod(idx, GRID)
        atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = rt.bleed(rgba)
        manifest.append({'kind': kind, 'r': round(rt.crown_radius(rgba[..., 3]), 4), 'size': round(size, 3),
                         'model': model})
    rt.save(atlas, os.path.join(a.out, 'thaw-sprites.webp'))
    if not SPRING_EXTRAS:
        with open(os.path.join(a.out, 'thaw-sprites.json'), 'w') as f:
            json.dump({'cell': CELL, 'grid': GRID, 'sprites': manifest}, f, indent=1)
        render_tiles(a)
        print('done:', a.out)
        return
    # spring trees: 2x2 atlas of 512 px crowns, recoloured blossom / young leaves
    sc.render.resolution_x = sc.render.resolution_y = 1024
    tatlas = np.zeros((1024, 1024, 4), np.float32)
    tman = []
    for idx, (model, kind, leaf) in enumerate(TREES):
        path = os.path.join(a.src, model + '.gltf')
        print(f'[tree {idx + 1}/{len(TREES)}] {model} -> {kind}')
        png, size = render_tree_sprite(path, leaf, cam, tmp, idx)
        rgba = downsample(rt.load_rgba(png), 2)
        r, c = divmod(idx, 2)
        tatlas[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512] = rt.bleed(rgba)
        tman.append({'kind': kind, 'r': round(rt.crown_radius(rgba[..., 3]), 4), 'size': round(size, 3), 'model': model})
    rt.save(tatlas, os.path.join(a.out, 'thaw-trees.webp'))
    with open(os.path.join(a.out, 'thaw-sprites.json'), 'w') as f:
        json.dump({'cell': CELL, 'grid': GRID, 'sprites': manifest, 'trees': {'grid': 2, 'items': tman}}, f, indent=1)
    # lush spring grass tile, rendered from the grass models so it matches the sprites
    make_grass_tile(a.src, os.path.join(a.out, 'thaw-spring.webp'), cam, tmp)
    render_tiles(a)
    print('done:', a.out)


def render_tiles(a):
    for name, (stem, opts) in TILES.items():
        src = os.path.join(a.tiles, f'{stem}_diff_2k.jpg')
        if os.path.exists(src):
            make_tile(src, os.path.join(a.out, f'thaw-{name}.webp'), **opts)
            print('tile', name)


if __name__ == '__main__':
    main()
