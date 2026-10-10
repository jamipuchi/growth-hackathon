"""Original CC0 Space Party cockpit. Run: blender -b --python generate.py.

Geometry is authored in camera-projected coordinates for an origin camera
looking along engine -Z. P() converts engine Y-up coordinates to Blender Z-up;
the glTF export converts them back. No external meshes or textures are used.
"""
import bpy
import math
import json
import hashlib
import struct
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
FOV = 70.0
ASPECT = 16 / 9
TAN = math.tan(math.radians(FOV) / 2)
DEPTH = 1.5
OPENING = [(-.82, .94), (.82, .94), (.94, .82), (.94, -.68), (.82, -.80), (-.82, -.80), (-.94, -.68), (-.94, .82)]
OUTER = [(-.94, 1.12), (.94, 1.12), (1.12, .94), (1.12, -.94), (.94, -1.12), (-.94, -1.12), (-1.12, -.94), (-1.12, .94)]
IVORY = (.73, .82, .84, 1)
PALE = (.46, .66, .73, 1)
BLUE = (.065, .23, .34, 1)
TEAL = (.045, .33, .43, 1)
NAVY = (.018, .040, .062, 1)
RUBBER = (.008, .018, .025, 1)
ORANGE = (.94, .34, .058, 1)
CYAN = (.045, .55, .72, 1)


def P(value):
    x, y, z = value
    return (x, -z, y)


def projected(x, y, depth):
    return (x * TAN * ASPECT * depth, y * TAN * depth, -depth)


def material(name, roughness, metallic, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    paint = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    paint.layer_name = 'cockpit_paint'
    mat.node_tree.links.new(paint.outputs['Color'], shader.inputs['Base Color'])
    if emission:
        shader.inputs['Emission Color'].default_value = (*emission, 1)
        shader.inputs['Emission Strength'].default_value = 1.8
    return mat


class Builder:
    def __init__(self, name, mat):
        self.name, self.material = name, mat
        self.vertices, self.faces, self.paint = [], [], []
        self.pieces = []

    def solid(self, name, vertices, faces, color):
        center = sum((Vector(v) for v in vertices), Vector()) / len(vertices)
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        for face in faces:
            points = [Vector(vertices[i]) for i in face]
            normal = (points[1] - points[0]).cross(points[2] - points[0])
            face_center = sum(points, Vector()) / len(points)
            if normal.dot(face_center - center) < 0:
                face = tuple(reversed(face))
                normal.negate()
            normal.normalize()
            # Front faces are clean and light, chamfers receive a cooler shade.
            shade = .82 + .18 * max(0, normal.z)
            self.faces.append(tuple(offset + i for i in face))
            self.paint.append(tuple(min(1, channel * shade) for channel in color[:3]) + (1,))
        self.pieces.append(name)

    def prism(self, name, polygon, front, back, color, bevel=0):
        points = list(polygon)
        count = len(points)
        if bevel:
            cx = sum(p[0] for p in points) / count
            cy = sum(p[1] for p in points) / count
            inner = [(cx + (x - cx) * (1 - bevel), cy + (y - cy) * (1 - bevel)) for x, y in points]
            # The shoulder retains the polygon's projected outline at a
            # different depth; no near bevel encroaches on the clear opening.
            vertices = [projected(x, y, front) for x, y in inner]
            vertices += [projected(x, y, front + .025) for x, y in points]
            vertices += [projected(x, y, back) for x, y in points]
            faces = [tuple(range(count)), tuple(range(count * 2, count * 3))]
            for i in range(count):
                j = (i + 1) % count
                faces.extend([(i, j, j + count, i + count), (i + count, j + count, j + count * 2, i + count * 2)])
        else:
            vertices = [projected(x, y, front) for x, y in points]
            vertices += [projected(x, y, back) for x, y in points]
            faces = [tuple(range(count)), tuple(range(count, count * 2))]
            for i in range(count):
                j = (i + 1) % count
                faces.append((i, j, j + count, i + count))
        self.solid(name, vertices, faces, color)

    def rect(self, name, cx, cy, width, height, front, back, color, bevel=0):
        self.prism(name, [(cx - width / 2, cy - height / 2), (cx + width / 2, cy - height / 2), (cx + width / 2, cy + height / 2), (cx - width / 2, cy + height / 2)], front, back, color, bevel)

    def ring(self, name, inner, outer, front, back, color, bevel=0):
        for i in range(len(inner)):
            j = (i + 1) % len(inner)
            self.prism(f'{name}_{i}', [inner[i], inner[j], outer[j], outer[i]], front, back, color, bevel)

    def finish(self, parent):
        mesh = bpy.data.meshes.new(self.name + '_geometry')
        mesh.from_pydata([P(v) for v in self.vertices], [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        mesh.materials.append(self.material)
        paint = mesh.color_attributes.new(name='cockpit_paint', type='FLOAT_COLOR', domain='CORNER')
        for face, color in zip(mesh.polygons, self.paint):
            face.use_smooth = False
            for loop in face.loop_indices:
                paint.data[loop].color = color
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        triangulate = obj.modifiers.new('triangles', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=triangulate.name)
        obj.select_set(False)
        return obj


def expanded(points, dx, dy):
    return [(x + math.copysign(dx, x), y + math.copysign(dy, y)) for x, y in points]


def rectangle(cx, cy, width, height):
    return [(cx - width / 2, cy - height / 2), (cx + width / 2, cy - height / 2), (cx + width / 2, cy + height / 2), (cx - width / 2, cy + height / 2)]


root = bpy.data.objects.new('cockpit', None)
bpy.context.collection.objects.link(root)
root['license'] = 'CC0-1.0'
root['reference_vertical_fov_degrees'] = FOV
root['reference_aspect'] = ASPECT
root['camera_forward'] = '-Z'
root['camera_origin'] = [0, 0, 0]

hull = Builder('cockpit_hull', material('cockpit_painted_hull', .5, .22))
trim = Builder('cockpit_trim', material('cockpit_dark_trim', .64, .12))
signals = Builder('cockpit_signals', material('cockpit_cyan_signal', .34, .12, (.025, .62, .9)))

# A broad chamfered octagonal frame. All surfaces remain outside the opening
# in the reference camera, including the bevel shoulders and their back faces.
trim.ring('window_inner_seal', OPENING, expanded(OPENING, .032, .025), 1.405, 1.70, NAVY)
hull.ring('structural_frame', expanded(OPENING, .024, .020), OUTER, 1.445, 1.79, IVORY, .15)
# The far edge adds a visible sloping blue reveal around the window.
hull.ring('window_blue_reveal', expanded(OPENING, .010, .008), expanded(OPENING, .027, .024), 1.50, 1.72, BLUE)

# Strong corner cheeks and shallow panel insets give the frame readable depth.
for side in (-1, 1):
    hull.prism('upper_corner_cheek', [(side * .95, .83), (side * 1.10, .87), (side * 1.09, 1.08), (side * .83, 1.08)], 1.39, 1.68, PALE, .12)
    hull.prism('lower_corner_cheek', [(side * .85, -.82), (side * 1.09, -.69), (side * 1.10, -1.09), (side * .84, -1.09)], 1.40, 1.72, BLUE, .08)
    trim.rect('side_grip', side * 1.003, .045, .066, .71, 1.365, 1.56, RUBBER, .16)
    hull.rect('grip_backplate', side * 1.002, .045, .086, .77, 1.405, 1.59, TEAL, .1)
    signals.rect('vertical_status_strip', side * .966, .20, .009, .23, 1.36, 1.43, CYAN)
    signals.rect('vertical_status_short', side * .966, -.14, .009, .115, 1.36, 1.43, CYAN)
    for y in (.59, -.48):
        hull.rect('corner_fastener_plate', side * .997, y, .037, .043, 1.35, 1.47, PALE, .24)
        trim.rect('corner_fastener_slot', side * .997, y, .017, .006, 1.343, 1.37, NAVY)
    hull.prism('caution_chevron', [(side * .953, -.73), (side * 1.016, -.68), (side * 1.020, -.71), (side * .959, -.76)], 1.35, 1.40, ORANGE)

hull.rect('overhead_recess', 0, 1.012, .81, .086, 1.405, 1.58, BLUE, .15)
trim.rect('overhead_dark_inset', 0, 1.011, .49, .041, 1.36, 1.42, NAVY, .08)
signals.rect('overhead_status', 0, .972, .27, .007, 1.355, 1.41, CYAN)
for side in (-1, 1):
    hull.rect('overhead_panel', side * .65, 1.015, .32, .08, 1.40, 1.57, PALE, .12)

# Dashboard top stays below the opening. Gauge bezels are inset in its angled
# front rather than protruding into the window; their display planes face +Z.
dashboard = [(-.85, -.807), (.85, -.807), (.90, -.85), (.92, -1.11), (-.92, -1.11), (-.90, -.85)]
hull.prism('dashboard_body', dashboard, 1.415, 1.73, BLUE, .045)
hull.rect('dashboard_lip', 0, -.812, 1.62, .012, 1.365, 1.48, PALE)
gauge_depth = 1.35
gauge_width = .28 * TAN * ASPECT * gauge_depth
gauge_height = .12 * TAN * gauge_depth
gauge_specs = []
for index, x in enumerate((-.47, 0, .47), 1):
    outer = rectangle(x, -.9, .326, .157)
    inner = rectangle(x, -.9, .28, .12)
    hull.ring(f'gauge_bezel_{index}', inner, outer, 1.325, 1.405, PALE, .10)
    trim.rect(f'gauge_backing_{index}', x, -.9, .284, .124, 1.367, 1.408, RUBBER)
    signals.rect(f'gauge_indicator_{index}', x - .117, -.971, .022, .004, 1.318, 1.35, CYAN)
    position = projected(x, -.9, gauge_depth)
    socket = bpy.data.objects.new(f'socket_gauge_{index}', None)
    bpy.context.collection.objects.link(socket)
    socket.parent = root
    socket.location = P(position)
    socket.empty_display_type = 'ARROWS'
    socket.empty_display_size = .08
    # Identity exported axes: local XY is the display plane, local +Z toward
    # the origin camera. The export validator checks these actual GLB axes.
    socket['display_width'] = gauge_width
    socket['display_height'] = gauge_height
    socket['display_normal'] = '+Z'
    gauge_specs.append({'name': socket.name, 'position': list(position), 'ndc_center': [x, -.9], 'ndc_size': [.28, .12], 'display_size_metres': [gauge_width, gauge_height], 'normal': [0, 0, 1], 'suggested_forward_offset_metres': .002})

for side in (-1, 1):
    trim.rect('dashboard_button_bank', side * .805, -.925, .067, .13, 1.355, 1.43, NAVY, .15)
    for row in range(3):
        trim.rect('dashboard_button', side * .805, -.881 - row * .042, .034, .020, 1.332, 1.39, ORANGE if row == 0 else PALE, .16)

# A narrow padded seat/armrest glimpse anchors the first-person viewpoint.
trim.prism('seat_edge', [(-1.08, -1.12), (-.82, -1.12), (-.81, -1.018), (-.87, -.982), (-1.035, -.994)], 1.20, 1.46, RUBBER, .13)
trim.prism('seat_piping', [(-1.025, -.998), (-.873, -.986), (-.824, -1.025), (-.826, -1.038), (-.881, -1.005), (-1.025, -1.013)], 1.183, 1.24, TEAL)

objects = [builder.finish(root) for builder in (hull, trim, signals)]
bpy.ops.object.select_all(action='DESELECT')
for obj in [root] + list(root.children):
    obj.select_set(True)
glb_path = OUT / 'cockpit.glb'
bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_extras=True, export_animations=False,
    export_materials='EXPORT', export_cameras=False, export_lights=False)

# Source-only review camera and lights are excluded from the exported GLB.
camera_data = bpy.data.cameras.new('preview_camera')
camera = bpy.data.objects.new('preview_camera', camera_data)
bpy.context.collection.objects.link(camera)
camera.rotation_euler = (math.pi / 2, 0, 0)
camera_data.sensor_fit = 'VERTICAL'
camera_data.lens = camera_data.sensor_height / (2 * TAN)
camera_data.clip_start = .01
bpy.context.scene.camera = camera
bpy.context.scene.render.resolution_x = 1920
bpy.context.scene.render.resolution_y = 1080
bpy.context.scene.render.resolution_percentage = 100
for name, location, energy, size in [('preview_key', (-1.2, 1.8, -.1), 450, 5), ('preview_fill', (1.4, .4, -.3), 180, 4)]:
    light_data = bpy.data.lights.new(name, 'AREA')
    light_data.energy, light_data.shape, light_data.size = energy, 'DISK', size
    light = bpy.data.objects.new(name, light_data)
    bpy.context.collection.objects.link(light)
    light.location = P(location)
    target = Vector(P((0, 0, -1.5)))
    light.rotation_euler = (target - light.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.world.color = (.025, .035, .055)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'cockpit_source.blend'))

raw = glb_path.read_bytes()
json_length, json_kind = struct.unpack_from('<II', raw, 12)
assert json_kind == 0x4E4F534A
gltf = json.loads(raw[20:20 + json_length])
triangles = sum(gltf['accessors'][primitive['indices']]['count'] // 3 for mesh in gltf['meshes'] for primitive in mesh['primitives'])
calls = sum(len(mesh['primitives']) for mesh in gltf['meshes'])
signed_area = sum(OPENING[i][0] * OPENING[(i + 1) % len(OPENING)][1] - OPENING[(i + 1) % len(OPENING)][0] * OPENING[i][1] for i in range(len(OPENING))) / 2
all_vertices = [v for builder in (hull, trim, signals) for v in builder.vertices]
manifest = {
    'asset': 'cockpit', 'license': 'CC0-1.0', 'authoring': 'Original procedural geometry and vertex paint, Blender 5.2; no textures or external artwork',
    'file': 'cockpit.glb', 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
    'triangles': triangles, 'draw_calls': calls, 'materials': len(gltf.get('materials', [])), 'textures': len(gltf.get('textures', [])),
    'mesh_names': [m['name'] for m in gltf['meshes']], 'camera': {'position': [0, 0, 0], 'forward': [0, 0, -1], 'up': [0, 1, 0], 'vertical_fov_degrees': FOV, 'aspect': ASPECT, 'reference_depth': DEPTH, 'projected_unit_metres': [TAN * ASPECT * DEPTH, TAN * DEPTH]},
    'opening_ndc': [list(p) for p in OPENING], 'opening_polygon_fraction': abs(signed_area) / 4,
    'opening_note': 'Nominal polygon is the protected window aperture. Small frame details remain in the peripheral band; actual raster coverage is separately browser-tested.',
    'gauges': gauge_specs,
    'bounds': {'min': [min(v[i] for v in all_vertices) for i in range(3)], 'max': [max(v[i] for v in all_vertices) for i in range(3)]},
    'fit_scale': {'x': '(aspect / (16/9)) * tan(verticalFov/2) / tan(35deg)', 'y': 'tan(verticalFov/2) / tan(35deg)', 'z': 1},
    'source_piece_counts': {builder.name: len(builder.pieces) for builder in (hull, trim, signals)},
}
assert triangles <= 8000 and calls <= 4 and manifest['textures'] == 0
(OUT / 'geometry-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
