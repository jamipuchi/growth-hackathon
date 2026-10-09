"""Structural delivery checks, including exact shell equality across both files."""
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent


def load(name):
    raw = (ROOT/name).read_bytes()
    magic, version, size = struct.unpack_from('<4sII', raw)
    assert magic == b'glTF' and version == 2 and size == len(raw)
    length, kind = struct.unpack_from('<I4s', raw, 12)
    assert kind == b'JSON'
    doc = json.loads(raw[20:20+length])
    offset = 20+length
    binary_size, binary_kind = struct.unpack_from('<I4s', raw, offset)
    assert binary_kind == b'BIN\0'
    binary = raw[offset+8:offset+8+binary_size]
    assert len(binary) == binary_size
    assert not any(b.get('uri') for b in doc.get('buffers', []))
    assert not doc.get('images') and not doc.get('textures')
    assert not any(e in doc.get('extensionsUsed', []) for e in ('KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'))
    for node in doc['nodes']:
        assert all(c.islower() or c.isdigit() or c == '_' for c in node['name']), node['name']
    for view in doc['bufferViews']:
        assert view.get('byteOffset', 0)+view['byteLength'] <= len(binary)
    return doc, binary, raw


def meshes(doc, node):
    result = [doc['meshes'][node['mesh']]] if 'mesh' in node else []
    for child in node.get('children', []):
        result += meshes(doc, doc['nodes'][child])
    return result


def signatures(doc, binary, state):
    node = next(n for n in doc['nodes'] if n['name'] == state)
    result = []
    for mesh in meshes(doc, node):
        for primitive in mesh['primitives']:
            sig = {}
            for key, aid in {**primitive['attributes'], 'INDICES': primitive['indices']}.items():
                a = doc['accessors'][aid]
                view = doc['bufferViews'][a['bufferView']]
                offset = view.get('byteOffset',0)
                sig[key] = hashlib.sha256(binary[offset:offset+view['byteLength']]).hexdigest()
            sig['material'] = doc['materials'][primitive['material']]
            result.append(sig)
    return result


boss, bb, raw_boss = load('boss.glb')
decoy, db, raw_decoy = load('decoy.glb')
assert 'core' in [n['name'] for n in boss['nodes']]
assert 'core' not in [n['name'] for n in decoy['nodes']]
for doc in (boss,decoy):
    assert 'socket_core' in [n['name'] for n in doc['nodes']]

states = ('armour_intact','armour_cracked','armour_broken')
stats = {}
for name, doc, binary, raw in (('boss',boss,bb,raw_boss),('decoy',decoy,db,raw_decoy)):
    stats[name] = {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'textures':0,'states':{}}
    for state in states:
        selected = [n for n in doc['nodes'] if n['name'] == state or (name == 'boss' and state == 'armour_broken' and n['name'] == 'core')]
        primitives = [p for n in selected for m in meshes(doc,n) for p in m['primitives']]
        triangles = sum(doc['accessors'][p['indices']]['count']//3 for p in primitives)
        assert triangles <= 15000 and len(primitives) <= 4
        stats[name]['states'][state] = {'triangles':triangles,'draw_calls':len(primitives)}
for state in states:
    assert signatures(boss,bb,state) == signatures(decoy,db,state), state
stats['checks'] = {'shells_identical':True,'embedded_buffers':True,'no_decoders':True,'names_and_sockets':True,'within_budget':True}
(ROOT/'validation.json').write_text(json.dumps(stats,indent=2)+'\n')
print(json.dumps(stats,indent=2))
