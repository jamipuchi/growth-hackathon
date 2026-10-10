"""Original CC0 foreground rocks. blender -b --python generate_foreground.py.
Only writes foreground.glb, foreground_source.blend and foreground-manifest.json.
"""
import bpy
import math
import json
import struct
import hashlib
import random
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
SEGMENTS, RINGS = 16, 8
BASE = [(0, 1, 0)]
for ring in range(RINGS):
    theta = math.pi * (ring + 1) / (RINGS + 1)
    for segment in range(SEGMENTS):
        phi = math.tau * segment / SEGMENTS
        BASE.append((math.sin(theta) * math.cos(phi), math.cos(theta), math.sin(theta) * math.sin(phi)))
BASE.append((0, -1, 0))
FACES = []
for i in range(SEGMENTS):
    FACES.append((0, 1 + (i + 1) % SEGMENTS, 1 + i))
for ring in range(RINGS - 1):
    for i in range(SEGMENTS):
        a = 1 + ring * SEGMENTS + i
        b = 1 + ring * SEGMENTS + (i + 1) % SEGMENTS
        c, d = a + SEGMENTS, b + SEGMENTS
        FACES.extend([(a, b, c), (b, d, c)])
bottom = len(BASE) - 1
for i in range(SEGMENTS):
    FACES.append((bottom, 1 + (RINGS - 1) * SEGMENTS + i, 1 + (RINGS - 1) * SEGMENTS + (i + 1) % SEGMENTS))
# Fix the common sphere winding once, never reorder triangles per variant.
for index, face in enumerate(FACES):
    a, b, c = [Vector(BASE[i]) for i in face]
    if (b - a).cross(c - a).dot((a + b + c) / 3) < 0:
        FACES[index] = tuple(reversed(face))
assert len(BASE) == 130 and len(FACES) == 256


def center_of_mass(vertices):
    volume, moment = 0.0, Vector()
    for face in FACES:
        a, b, c = [Vector(vertices[i]) for i in face]
        tetra = a.dot(b.cross(c)) / 6
        volume += tetra
        moment += (a + b + c) * (tetra / 4)
    assert volume > 1e-9
    return moment / volume, volume


def shape(variant):
    rng = random.Random(20800 + variant)
    vertices = []
    for index, (x, y, z) in enumerate(BASE):
        phi = math.atan2(z, x)
        theta = math.acos(max(-1, min(1, y)))
        radial = 1 + .09 * math.sin(phi * 3 + theta * 1.8 + variant) + .065 * math.cos(phi * 5 - theta * 2.4) + rng.uniform(-.075, .075)
        x, y, z = x * radial, y * radial, z * radial
        if variant == 1:
            x, y, z = x * 1.05 + .055 * y, y * .92, z * .97
            y = min(y, .79 + .07 * x)
            if x > .18 and y > .05 and z > .35:
                x, z = x * .83, z * .88
            z += .055 * x * y
        elif variant == 2:
            x, y, z = x * 1.46, y * .61, z * .92
            y = min(y, .48 + .06 * x)
            y = max(y, -.49 + .03 * z)
            x += .11 * y
            z += .10 * x * y
            if x < -.6 and z > .15:
                z *= .78
        else:
            x, y, z = x * .90, y * 1.40, z * .83
            # A deep saddle below two offset upper shoulders makes a split
            # crest while retaining the same closed spherical topology.
            if y > .45:
                y -= .42 * math.exp(-((x + .035) / .24) ** 2) * ((y - .45) / .95)
            x += .09 * y
            z += .09 * math.sin(y * 2.1)
            if x > .35 and y < -.1 and z < -.15:
                x *= .79
        vertices.append((x, y, z))
    center, _ = center_of_mass(vertices)
    vertices = [tuple(Vector(v) - center) for v in vertices]
    extent = max(max(v[axis] for v in vertices) - min(v[axis] for v in vertices) for axis in range(3))
    vertices = [tuple(Vector(v) * (2 / extent)) for v in vertices]
    return vertices


material = bpy.data.materials.new('foreground_stone_paint')
material.use_nodes = True
material.use_backface_culling = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
shader.inputs['Roughness'].default_value = .84
shader.inputs['Metallic'].default_value = .025
paint_node = material.node_tree.nodes.new('ShaderNodeVertexColor')
paint_node.layer_name = 'stone_paint'
material.node_tree.links.new(paint_node.outputs['Color'], shader.inputs['Base Color'])
root = bpy.data.objects.new('foreground_stones', None)
bpy.context.collection.objects.link(root)
root['license'] = 'CC0-1.0'
root['source_vertex_count'] = len(BASE)
root['triangles_per_variant'] = len(FACES)
root['uv_identity_contract'] = 'UV.x=source_vertex_id/129; exported UV.y=1-source_triangle_id/255; stripped by foreground.js'
variants = []
for variant in (1, 2, 3):
    name = f'foreground_stone_{variant}'
    positions = shape(variant)
    mesh = bpy.data.meshes.new(name + '_geometry')
    # Engine (x,y,z) -> Blender (x,-z,y); export_yup reverses the conversion.
    mesh.from_pydata([(x, -z, y) for x, y, z in positions], [], FACES)
    mesh.update()
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    obj['variant'] = variant
    obj['diameter_convention'] = 'longest unrotated local bounding-box span is 2 metres'
    paint = mesh.color_attributes.new(name='stone_paint', type='FLOAT_COLOR', domain='CORNER')
    identity = mesh.uv_layers.new(name='source_identity')
    rng = random.Random(21300 + variant)
    base_color = [( .43, .315, .235), (.46, .337, .251), (.395, .304, .247)][variant - 1]
    for face_id, polygon in enumerate(mesh.polygons):
        polygon.use_smooth = False
        # Continuous stone colour with subtle per-facet sediment variation.
        face_y = sum(positions[i][1] for i in FACES[face_id]) / 3
        shade = .85 + rng.random() * .23 + .045 * math.sin(face_y * 4 + variant)
        color = tuple(min(1, c * shade) for c in base_color) + (1,)
        for loop in polygon.loop_indices:
            vertex_id = mesh.loops[loop].vertex_index
            paint.data[loop].color = color
            identity.data[loop].uv = (vertex_id / (len(BASE) - 1), face_id / (len(FACES) - 1))
    center, volume = center_of_mass(positions)
    mins = [min(v[i] for v in positions) for i in range(3)]
    maxs = [max(v[i] for v in positions) for i in range(3)]
    variants.append({'name': name, 'variant': variant, 'design': ['stocky chipped boulder', 'broad angular slab', 'tall split crest'][variant - 1], 'source_positions': positions, 'bounds': {'min': mins, 'max': maxs}, 'longest_extent': max(b - a for a, b in zip(mins, maxs)), 'signed_volume': volume, 'center_of_mass': list(center), 'triangles': len(FACES)})

bpy.ops.object.select_all(action='DESELECT')
for obj in [root] + list(root.children):
    obj.select_set(True)
glb_path = OUT / 'foreground.glb'
bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_extras=True, export_animations=False,
    export_materials='EXPORT', export_texcoords=True, export_cameras=False, export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'foreground_source.blend'))
raw = glb_path.read_bytes()
length, kind = struct.unpack_from('<II', raw, 12)
assert kind == 0x4E4F534A
gltf = json.loads(raw[20:20 + length])
assert len(gltf.get('materials', [])) == 1 and not gltf.get('textures')
manifest = {'asset': 'foreground_stones', 'license': 'CC0-1.0', 'file': 'foreground.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'source': 'Original deterministic procedural geometry and vertex paint; no external meshes or images', 'normalization': 'signed-volume centre of mass at origin; longest local bounding-box dimension 2 metres', 'diameter_scale': 'instance uniform scale=diameter/2; rotation changes world-axis AABB extents', 'material': 'foreground_stone_paint', 'materials': 1, 'textures': 0, 'triangles_per_variant': len(FACES), 'stored_triangles': len(FACES) * 3, 'source_vertex_count': len(BASE), 'triangles': FACES, 'uv_identity': {'u': 'source_vertex_id/129', 'v_gltf': '1-source_triangle_id/255', 'purpose': 'verify matching expanded triangle order; helper discards UV before rendering'}, 'variants': variants}
(OUT / 'foreground-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({k: manifest[k] for k in ['file', 'bytes', 'sha256', 'materials', 'textures', 'triangles_per_variant', 'stored_triangles', 'source_vertex_count']}, indent=2))
