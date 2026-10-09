"""Validate actual exported island geometry, indices, palette and water normals."""
import hashlib, json, math, re, struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
raw = (ROOT / 'island_props.glb').read_bytes()
magic, version, total = struct.unpack_from('<4sII', raw)
assert magic == b'glTF' and version == 2 and total == len(raw)
size, kind = struct.unpack_from('<I4s', raw, 12)
assert kind == b'JSON'
d = json.loads(raw[20:20+size])
bin_size, bin_kind = struct.unpack_from('<I4s', raw, 20+size)
b = raw[28+size:]
assert bin_kind == b'BIN\x00' and len(b) == bin_size
assert len(d['buffers']) == 1 and 'uri' not in d['buffers'][0]
assert not d.get('images') and not d.get('textures') and not d.get('animations')
assert not d.get('extensionsRequired') and not d.get('extensionsUsed')
assert len(d['materials']) == 1
material = d['materials'][0]
assert material['doubleSided'] and not material.get('emissiveFactor')
assert material['pbrMetallicRoughness']['metallicFactor'] == 0
assert material['pbrMetallicRoughness']['roughnessFactor'] > .9

def values(index):
    a = d['accessors'][index]; view = d['bufferViews'][a['bufferView']]
    channels = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    fmt = {5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']]
    width = struct.calcsize('<'+fmt*channels); stride = view.get('byteStride',width)
    offset = view.get('byteOffset',0)+a.get('byteOffset',0)
    assert offset+(a['count']-1)*stride+width <= len(b)
    return [struct.unpack_from('<'+fmt*channels,b,offset+i*stride) for i in range(a['count'])]

expected = {f'palm_{i}':482 for i in range(1,4)}
expected.update({f'palm_{i}_lod':140 for i in range(1,4)})
expected.update({f'bush_{i}':100 for i in range(1,3)})
expected.update({f'beach_rock_{i}':80 for i in range(1,4)})
expected.update({f'cliff_{i}':52 for i in range(1,3)})
assert {node['name'] for node in d['nodes']} == set(expected)
assert len(d['nodes']) == len(d['meshes']) == 13
meshes = {}
for node in d['nodes']:
    name = node['name']; assert re.fullmatch('[a-z][a-z0-9_]*',name)
    assert not any(k in node for k in ('translation','rotation','scale','matrix','children'))
    primitives = d['meshes'][node['mesh']]['primitives']; assert len(primitives) == 1
    p = primitives[0]; assert p.get('mode',4) == 4 and p['material'] == 0
    assert {'POSITION','NORMAL','COLOR_0'} <= set(p['attributes'])
    points = values(p['attributes']['POSITION']); normals = values(p['attributes']['NORMAL'])
    colors = values(p['attributes']['COLOR_0']); indices = values(p['indices'])
    assert all(math.isfinite(v) for row in points+normals+colors for v in row)
    assert all(0 <= i[0] < len(points) for i in indices)
    assert len(indices)%3 == 0 and len(indices)//3 == expected[name]
    assert all(abs(sum(c*c for c in n)-1)<1e-4 for n in normals)
    assert all(0 <= c <= 1 for row in colors for c in row)
    minimum = [min(p[i] for p in points) for i in range(3)]
    maximum = [max(p[i] for p in points) for i in range(3)]
    assert abs(minimum[1])<1e-5 and maximum[1]>0
    meshes[name] = {'triangles':len(indices)//3,'calls':1,'bounds':[minimum,maximum]}
for i in range(1,4):
    assert expected[f'palm_{i}']<=1500
    assert abs(meshes[f'palm_{i}']['bounds'][1][1]-meshes[f'palm_{i}_lod']['bounds'][1][1])<1e-5

normal_raw = (ROOT/'water_normals.png').read_bytes()
normal = Image.open(ROOT/'water_normals.png').convert('RGB')
assert normal.size == (512,512)
extrema = normal.getextrema()
assert all(hi-lo>10 for lo,hi in extrema[:2]) and extrema[2][0]>128
checks = dict.fromkeys(['glb_binary','embedded_buffer','names_and_base_origins','one_primitive_shared_pbr',
    'finite_geometry_and_valid_indices','unit_normals_and_vertex_palette','palm_budgets_and_lod_heights',
    'no_textures_or_decoders_in_glb','linear_normal_map_dimensions'],True)
report = {'checks':checks,'glb':{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
    'total_catalog_triangles':sum(expected.values()),'materials':1,'textures':0,'meshes':meshes},
    'water_normals':{'bytes':len(normal_raw),'sha256':hashlib.sha256(normal_raw).hexdigest(),
    'size':list(normal.size),'channel_ranges':extrema}}
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'checks':checks,'glb_bytes':len(raw),'catalog_triangles':sum(expected.values()),'normal_bytes':len(normal_raw)},indent=2))
