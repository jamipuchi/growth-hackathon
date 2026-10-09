"""Original Space Party assets. Rebuild: blender -b --python assets/A-001-boss-rock/generate.py

All geometry is authored procedurally here; no external assets or textures.
Blender's +Y becomes glTF -Z; Blender's +Z becomes glTF +Y.
"""
import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
SEED = 240109
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, metallic, roughness, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 5.5
    return mat


BASALT = material('basalt_armour', (0.13, 0.155, 0.17), 0.24, 0.88)
EDGE = material('weathered_alloy', (0.26, 0.22, 0.155), 0.66, 0.57)
OBSIDIAN = material('core_crust', (0.075, 0.053, 0.03), 0.63, 0.38)
LIGHT = material('core_light', (0.9, 0.66, 0.3), 0.2, 0.36, (1.0, 0.68, 0.25))


class MeshBuilder:
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.materials = []

    def vertex(self, position):
        self.vertices.append(tuple(position))
        return len(self.vertices) - 1

    def face(self, indices, material_id=0):
        # Explicit triangles give deterministic triangle counts across exporters.
        for n in range(1, len(indices)-1):
            self.faces.append((indices[0], indices[n], indices[n+1]))
            self.materials.append(material_id)

    def object(self, name, materials):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        for mat in materials:
            mesh.materials.append(mat)
        for face, material_id in zip(mesh.polygons, self.materials):
            face.material_index = material_id
        # Ensure outward consistent winding on closed independently modelled plates.
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)
        return obj


def empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return obj


# A dual icosphere gives pentagonal and hexagonal armour plates, with shared
# irregular boundaries. Each is a watertight tapered block, not a paper surface.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
ico = bpy.context.object
points = [v.co.copy().normalized() for v in ico.data.vertices]
centres = [sum((points[i] for i in p.vertices), Vector()).normalized() for p in ico.data.polygons]
polys = []
for index, normal in enumerate(points):
    adjacent = [centres[p.index] for p in ico.data.polygons if index in p.vertices]
    u = normal.cross(Vector((0, 0, 1)))
    if u.length < 0.001:
        u = normal.cross(Vector((0, 1, 0)))
    u.normalize()
    v = normal.cross(u).normalized()
    adjacent.sort(key=lambda c: math.atan2(c.dot(v), c.dot(u)))
    polys.append((normal, adjacent))
bpy.data.objects.remove(ico, do_unlink=True)


def radius(p):
    return 13.0 + 1.1*math.sin(p.x*5+p.y*3) + 1.05*math.sin(p.z*7-p.x*2) + 0.3*math.sin(p.y*13+p.z*4)


def plate(builder, index, normal, corners, state):
    rng = random.Random(SEED + index*79)
    gap = [0.965, 0.83, 0.76][state]
    offset = (rng.uniform(0.18, 0.7) if state == 1 else rng.uniform(0.3, 1.2)) if state else 0
    # Off-axis impacts produce a broad, readable opening on the front (-Z glTF).
    hit = normal.dot(Vector((0.18, 1.0, 0.16)).normalized())
    if state == 1 and (hit > 0.77 or index in (4, 29)):
        return
    if state == 2 and (hit > -0.02 or index in (3, 5, 17, 29)):
        return
    n = len(corners)
    directions = [(normal.lerp(c, gap)).normalized() for c in corners]
    outer = [p*(radius(p)+offset) for p in directions]
    bevel = [normal.lerp(p, 0.86).normalized()*(radius(p)+offset+0.31) for p in directions]
    bottom = [p*(radius(p)-1.7+offset) for p in directions]
    rings = [[builder.vertex(p) for p in ring] for ring in (outer, bevel, bottom)]
    crown = builder.vertex(normal*(radius(normal)+offset+rng.uniform(0.35, 0.72)))
    inner = builder.vertex(normal*(radius(normal)-1.9+offset))
    for j in range(n):
        k = (j+1) % n
        builder.face([rings[0][j], rings[0][k], rings[1][k], rings[1][j]], 1)
        builder.face([rings[1][j], rings[1][k], crown])
        builder.face([rings[0][k], rings[0][j], rings[2][j], rings[2][k]])
        builder.face([rings[2][k], rings[2][j], inner])
root = empty('boss_rock')
root['default_state'] = 'armour_intact'
root['seed'] = SEED
root['license'] = 'CC0-1.0; original procedural geometry'
states = []
for number, name in enumerate(('armour_intact', 'armour_cracked', 'armour_broken')):
    group = empty(name, root)
    group['initially_visible'] = number == 0
    mesh = MeshBuilder()
    for index, (normal, corners) in enumerate(polys):
        plate(mesh, index, normal, corners, number)
    obj = mesh.object(name+'_shell', [BASALT, EDGE])
    obj.parent = group
    states.append(group)


# Luminous heart with dark floating geode facets. Two primitives / draw calls.
core_group = empty('core', root)
core_group['initially_visible'] = False
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=4.6)
heart = bpy.context.object
heart.name = 'core_light_mesh'
heart.data.name = 'core_light_mesh'
heart.parent = core_group
heart.data.materials.append(LIGHT)
heart.select_set(False)
core_mesh = MeshBuilder()
for index, (normal, corners) in enumerate(polys):
    if index % 4 == 1:
        continue
    boundary = [normal.lerp(c, .75).normalized() for c in corners]
    outside = [core_mesh.vertex(p*5.0) for p in boundary]
    inside = [core_mesh.vertex(p*4.65) for p in boundary]
    crown = core_mesh.vertex(normal*(5.22 + .25*math.sin(index*2.4)))
    for j in range(len(boundary)):
        k = (j+1) % len(boundary)
        core_mesh.face([outside[j],outside[k],crown])
        core_mesh.face([outside[k],outside[j],inside[j],inside[k]])
    core_mesh.face(list(reversed(inside)))
crust = core_mesh.object('core_crust_mesh', [OBSIDIAN])
crust.parent = core_group
socket = empty('socket_core', root)


def descendants(obj):
    return [obj] + [child for ch in obj.children for child in descendants(ch)]


def export(name, include_core):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in descendants(root):
        if include_core or obj not in descendants(core_group):
            obj.select_set(True)
    root.name = 'boss_rock' if include_core else 'decoy_rock'
    root['asset_kind'] = 'boss' if include_core else 'decoy'
    bpy.ops.export_scene.gltf(filepath=str(OUT/name), export_format='GLB',
        use_selection=True, export_yup=True, export_apply=True,
        export_extras=True, export_animations=False, export_materials='EXPORT')


export('boss.glb', True)
export('decoy.glb', False)
root.name = 'boss_rock'
root['asset_kind'] = 'boss'
for obj in descendants(root):
    obj.select_set(False)
# Source .blend opens with the intact state; the glTF load helper applies this too.
for group in states[1:]+[core_group]:
    for obj in descendants(group):
        obj.hide_render = True
        obj.hide_set(True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'boss_source.blend'))
print('ASSETS_EXPORTED', json.dumps({'seed':SEED, 'plates':len(polys), 'directory':str(OUT)}))
