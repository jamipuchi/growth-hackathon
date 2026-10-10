"""Validate the hostile boss revision and the byte-preserved legacy decoy.

Run after export. Decode actual accessor values rather than trusting metadata.
A successful run writes validation.json; no third-party Python packages needed.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parent
DECOY_SHA256 = '603de7f5577c8c58375492c570e153bae5901755aaaa1bff411ffaa52920ab54'
STATES = ('armour_intact', 'armour_cracked', 'armour_broken')
COMPONENTS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
              5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def finite(values):
    return all(isinstance(x, (int, float)) and math.isfinite(x) for x in values)


def multiply(a, b):
    # glTF matrices are column-major.
    return [sum(a[k*4+r]*b[c*4+k] for k in range(4))
            for c in range(4) for r in range(4)]


def transform(matrix, point):
    return tuple(sum(matrix[c*4+r]*point[c] for c in range(3)) + matrix[12+r]
                 for r in range(3))


def node_matrix(node):
    if 'matrix' in node:
        assert not any(k in node for k in ('translation', 'rotation', 'scale'))
        value = node['matrix']
        assert len(value) == 16 and finite(value)
        assert all(abs(value[i]-expected) < 1e-6
                   for i, expected in ((3, 0), (7, 0), (11, 0), (15, 1)))
        return value
    t, q, s = (node.get('translation', [0, 0, 0]),
               node.get('rotation', [0, 0, 0, 1]), node.get('scale', [1, 1, 1]))
    assert len(t) == 3 and len(q) == 4 and len(s) == 3 and finite(t+q+s)
    assert abs(sum(v*v for v in q)-1) < 1e-4 and all(v > 0 for v in s)
    x, y, z, w = q
    return [(1-2*y*y-2*z*z)*s[0], (2*x*y+2*z*w)*s[0], (2*x*z-2*y*w)*s[0], 0,
            (2*x*y-2*z*w)*s[1], (1-2*x*x-2*z*z)*s[1], (2*y*z+2*x*w)*s[1], 0,
            (2*x*z+2*y*w)*s[2], (2*y*z-2*x*w)*s[2], (1-2*x*x-2*y*y)*s[2], 0,
            *t, 1]


def bounds(points):
    assert points
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    return {'min': [round(v, 6) for v in lo], 'max': [round(v, 6) for v in hi],
            'size': [round(hi[i]-lo[i], 6) for i in range(3)]}


def emission(material):
    strength = material.get('extensions', {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength', 1)
    return [value*strength for value in material.get('emissiveFactor', [0, 0, 0])]


def is_red(material):
    r, g, b = emission(material)
    return r > 0.1 and g <= r*0.25 and b <= r*0.25


class Asset:
    def __init__(self, name):
        self.raw = (ROOT/name).read_bytes()
        assert len(self.raw) >= 28, name
        magic, version, size = struct.unpack_from('<4sII', self.raw)
        assert magic == b'glTF' and version == 2 and size == len(self.raw), name
        chunks, offset = [], 12
        while offset < len(self.raw):
            assert offset+8 <= len(self.raw)
            length, kind = struct.unpack_from('<I4s', self.raw, offset)
            assert length % 4 == 0 and offset+8+length <= len(self.raw)
            chunks.append((kind, self.raw[offset+8:offset+8+length]))
            offset += 8+length
        assert [kind for kind, _ in chunks] == [b'JSON', b'BIN\0']
        self.doc, self.binary = json.loads(chunks[0][1]), chunks[1][1]
        d = self.doc
        assert d['asset']['version'] == '2.0'
        assert len(d.get('buffers', [])) == 1 and 'uri' not in d['buffers'][0]
        assert 0 <= len(self.binary)-d['buffers'][0]['byteLength'] <= 3
        assert not any(d.get(k) for k in ('images', 'textures', 'samplers', 'skins', 'animations'))
        allowed = {'KHR_materials_emissive_strength'}
        assert set(d.get('extensionsUsed', [])) <= allowed
        assert set(d.get('extensionsRequired', [])) <= set(d.get('extensionsUsed', []))
        for view in d['bufferViews']:
            assert view['buffer'] == 0 and not view.get('extensions')
            assert view.get('byteOffset', 0) >= 0 and view['byteLength'] > 0
            assert view.get('byteOffset', 0)+view['byteLength'] <= d['buffers'][0]['byteLength']
        for material in d['materials']:
            assert 'pbrMetallicRoughness' in material
            assert set(material.get('extensions', {})) <= allowed
            assert material.get('alphaMode', 'OPAQUE') == 'OPAQUE'
            pbr = material['pbrMetallicRoughness']
            assert not any('Texture' in key for key in (*pbr, *material))
            color = pbr.get('baseColorFactor', [1, 1, 1, 1])
            assert len(color) == 4 and finite(color) and all(0 <= v <= 1 for v in color)
            for key in ('roughnessFactor', 'metallicFactor'):
                value = pbr.get(key, 1)
                assert finite([value]) and 0 <= value <= 1
            light = material.get('emissiveFactor', [0, 0, 0])
            assert len(light) == 3 and finite(light) and all(0 <= v <= 1 for v in light)
            strength = material.get('extensions', {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength', 1)
            assert finite([strength]) and strength >= 0
        self.values = {}
        for index in range(len(d['accessors'])):
            self.accessor(index)
        self.names = {n['name']: i for i, n in enumerate(d['nodes'])}
        assert len(self.names) == len(d['nodes']), 'Duplicate node names'
        assert all(re.fullmatch('[a-z][a-z0-9_]*', n) for n in self.names)
        self.world = {}

        def walk(index, parent):
            assert 0 <= index < len(d['nodes']) and index not in self.world, 'Invalid/cyclic/shared node'
            node = d['nodes'][index]
            assert not node.get('extensions')
            self.world[index] = multiply(parent, node_matrix(node))
            for child in node.get('children', []):
                walk(child, self.world[index])

        assert len(d['scenes']) == 1 and d.get('scene', 0) == 0
        for root in d['scenes'][0]['nodes']:
            walk(root, IDENTITY)
        assert len(self.world) == len(d['nodes']), 'Unreachable node'
        assert all(key in self.names for key in (*STATES, 'socket_core'))
        socket = d['nodes'][self.names['socket_core']]
        assert 'mesh' not in socket and not socket.get('children')
        assert max(abs(v) for v in transform(self.world[self.names['socket_core']], [0, 0, 0])) < 1e-6
        self.geometry = {}
        for mid, mesh in enumerate(d['meshes']):
            assert not mesh.get('weights')
            for pid, primitive in enumerate(mesh['primitives']):
                self.geometry[mid, pid] = self.check_primitive(primitive)

    def accessor(self, index):
        if index in self.values:
            return self.values[index]
        assert 0 <= index < len(self.doc['accessors'])
        a = self.doc['accessors'][index]
        assert not a.get('sparse') and 'bufferView' in a
        assert a['type'] in WIDTHS and a['componentType'] in COMPONENTS
        assert a['count'] > 0
        fmt, component_size = COMPONENTS[a['componentType']]
        width = WIDTHS[a['type']]
        view = self.doc['bufferViews'][a['bufferView']]
        offset = a.get('byteOffset', 0)
        stride = view.get('byteStride', width*component_size)
        assert offset >= 0 and offset % component_size == 0
        assert stride >= width*component_size and stride % component_size == 0
        assert offset+(a['count']-1)*stride+width*component_size <= view['byteLength']
        start = view.get('byteOffset', 0)+offset
        assert start % component_size == 0
        rows = [struct.unpack_from('<'+fmt*width, self.binary, start+i*stride)
                for i in range(a['count'])]
        assert all(finite(row) for row in rows), f'Nonfinite accessor {index}'
        for key, op in (('min', min), ('max', max)):
            if key in a:
                assert len(a[key]) == width and finite(a[key])
                assert all(math.isclose(a[key][c], op(row[c] for row in rows), rel_tol=1e-5, abs_tol=1e-6)
                           for c in range(width)), f'Incorrect {key} metadata: accessor {index}'
        if a.get('normalized', False):
            assert a['componentType'] in (5120, 5121, 5122, 5123)
            maximum = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[a['componentType']]
            rows = [tuple(max(-1, v/maximum) for v in row) for row in rows]
        self.values[index] = rows
        return rows

    def check_primitive(self, primitive):
        assert primitive.get('mode', 4) == 4 and not primitive.get('extensions')
        assert not primitive.get('targets') and 'indices' in primitive
        assert 0 <= primitive['material'] < len(self.doc['materials'])
        attrs = primitive['attributes']
        assert {'POSITION', 'NORMAL'} <= set(attrs)
        positions, normals = self.accessor(attrs['POSITION']), self.accessor(attrs['NORMAL'])
        assert self.doc['accessors'][attrs['POSITION']]['type'] == 'VEC3'
        assert self.doc['accessors'][attrs['NORMAL']]['type'] == 'VEC3'
        assert len(normals) == len(positions)
        assert all(abs(sum(v*v for v in row)-1) <= 1e-3 for row in normals), 'Nonunit normals'
        for semantic, aid in attrs.items():
            rows = self.accessor(aid)
            assert len(rows) == len(positions), f'Mismatched attribute {semantic}'
            if semantic.startswith('COLOR_'):
                assert self.doc['accessors'][aid]['type'] in ('VEC3', 'VEC4')
                assert all(0 <= value <= 1 for row in rows for value in row)
        a = self.doc['accessors'][primitive['indices']]
        assert a['type'] == 'SCALAR' and a['componentType'] in (5121, 5123, 5125)
        assert not a.get('normalized') and a['count'] % 3 == 0
        indices = [row[0] for row in self.accessor(primitive['indices'])]
        assert all(0 <= i < len(positions) for i in indices), 'Out-of-range index'
        for i in range(0, len(indices), 3):
            p, q, r = [positions[j] for j in indices[i:i+3]]
            u, v = [q[k]-p[k] for k in range(3)], [r[k]-p[k] for k in range(3)]
            cross = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
            assert sum(value*value for value in cross) > 1e-12, 'Degenerate triangle'
        return {'positions': positions, 'triangles': len(indices)//3}

    def primitives(self, name):
        result = []

        def walk(index):
            node = self.doc['nodes'][index]
            if 'mesh' in node:
                for pid, primitive in enumerate(self.doc['meshes'][node['mesh']]['primitives']):
                    data = self.geometry[node['mesh'], pid]
                    result.append((primitive, data, self.world[index]))
            for child in node.get('children', []):
                walk(child)

        walk(self.names[name])
        assert result, name
        return result

    def signature(self, name):
        payload = []
        for primitive, _, matrix in self.primitives(name):
            payload.append({'attributes': {k: self.accessor(v) for k, v in primitive['attributes'].items()},
                            'indices': self.accessor(primitive['indices']), 'world': matrix,
                            'material': self.doc['materials'][primitive['material']]})
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def main():
    boss, decoy = Asset('boss.glb'), Asset('decoy.glb')
    assert hashlib.sha256(decoy.raw).hexdigest() == DECOY_SHA256, 'Legacy decoy changed'
    assert 'core' in boss.names and 'core' not in decoy.names
    core = boss.primitives('core')
    core_lights = [boss.doc['materials'][p['material']] for p, _, _ in core
                   if max(emission(boss.doc['materials'][p['material']])) > 0]
    assert len(core_lights) == 1 and core_lights[0]['name'] == 'core_light'
    assert is_red(core_lights[0]), 'Core must emit red rather than gold'
    stats = {}
    armour_ids = set()
    for name, asset in (('boss', boss), ('decoy', decoy)):
        data = {'bytes': len(asset.raw), 'sha256': hashlib.sha256(asset.raw).hexdigest(),
                'textures': 0, 'materials': len(asset.doc['materials']),
                'stored_triangles': sum(g['triangles'] for g in asset.geometry.values()), 'states': {}}
        for state in STATES:
            shell = asset.primitives(state)
            selected = shell + (core if name == 'boss' and state == 'armour_broken' else [])
            triangles = sum(g['triangles'] for _, g, _ in selected)
            assert triangles <= 15000 and len(selected) <= 4, (name, state, triangles, len(selected))
            points = [transform(matrix, p) for _, g, matrix in selected for p in g['positions']]
            extent = bounds(points)
            assert all(15 < size < 40 for size in extent['size']), (name, state, extent)
            assert all(abs(v) < 20 for p in points for v in p), 'Unexpected scale/origin'
            state_stats = {'triangles': triangles, 'draw_calls': len(selected), 'bounds_metres': extent}
            if name == 'boss':
                seam = [p for p, _, _ in shell if max(emission(asset.doc['materials'][p['material']])) > 0]
                armour = [p for p, _, _ in shell if max(emission(asset.doc['materials'][p['material']])) == 0]
                assert len(seam) == 1 and is_red(asset.doc['materials'][seam[0]['material']]), state
                assert len(armour) == 1 and 'COLOR_0' in armour[0]['attributes'], state
                colors = asset.accessor(armour[0]['attributes']['COLOR_0'])
                assert len(set(colors)) > 1, 'Armour/bevel face colors were lost'
                armour_ids.add(armour[0]['material'])
                state_stats['red_emissive_primitives'] = sum(is_red(asset.doc['materials'][p['material']]) for p, _, _ in selected)
                assert boss.signature(state) != decoy.signature(state), 'Revised boss must differ from legacy decoy'
            data['states'][state] = state_stats
        stats[name] = data
    assert len(armour_ids) == 1, 'Boss states must share one nonemissive vertex-color armour material'
    stats['checks'] = {'actual_accessor_values': True, 'finite_geometry_and_unit_normals': True,
                       'valid_indices_and_nondegenerate_triangles': True, 'accurate_accessor_bounds': True,
                       'names_and_central_socket': True, 'embedded_buffers_zero_textures': True,
                       'pbr_and_supported_extensions_only': True, 'red_seams_each_state_and_red_core': True,
                       'consolidated_vertex_color_armour': True, 'per_state_budget': True,
                       'legacy_decoy_byte_identical': True, 'boss_shells_differ_from_legacy_decoy': True}
    output = json.dumps(stats, indent=2)+'\n'
    (ROOT/'validation.json').write_text(output)
    print(output, end='')


if __name__ == '__main__':
    main()
