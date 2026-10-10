"""Independent binary and geometry checks for the additive foreground-rock set.

Run: python3 assets/A-002-rocks/validate_foreground.py
Writes only foreground-validation.json. Uses the Python standard library.
"""
import hashlib
import json
import math
import struct
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ORIGINALS = {
    "rocks.glb": (175020, "b27753fc5e263cc565276e490a0acfa99371f3b15f780ef2efacdb467608273d"),
    "rocks.js": (5642, "073adfa764fe8def2d36c1f56dc9c578c88aa661aaf0505ccf5321c81353bc80"),
    "rocks_color.png": (13239, "73410ab483d278beeadb761a8847632933422141052151311ce7f72978f8f4ab"),
    "rocks_emissive.png": (11044, "c1ca90ec2ef249c5daded95c98de78d5c2e371bf48e509c93275c3c28c4840eb"),
}
NAMES = [f"foreground_stone_{i}" for i in range(1, 4)]
COMPONENTS = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
IDENTITY = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


def fingerprint(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def cross(a, b):
    return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def matrix(node):
    if "matrix" in node:
        assert not any(k in node for k in ("translation", "rotation", "scale"))
        m = node["matrix"]
        assert len(m) == 16 and all(math.isfinite(v) for v in m)
        return [[m[j*4+i] for j in range(4)] for i in range(4)]
    t, s, q = node.get("translation", [0, 0, 0]), node.get("scale", [1, 1, 1]), node.get("rotation", [0, 0, 0, 1])
    assert len(t) == len(s) == 3 and len(q) == 4 and all(math.isfinite(v) for v in t + s + q)
    assert all(abs(v) > 1e-10 for v in s) and abs(dot(q, q) - 1) < 1e-5
    x, y, z, w = q
    r = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
         [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
         [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
    return [[r[i][j]*s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def multiply(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def transform(m, p):
    return tuple(sum(m[i][j]*p[j] for j in range(3)) + m[i][3] for i in range(3))


def main():
    report = {"file": "foreground.glb", "validated_at_utc": datetime.now(timezone.utc).isoformat(), "checks": [], "variants": [],
              "limitations": ["Structural checks do not measure GPU timing or physical-phone performance.",
                              "Topology equivalence is checked on exported expanded triangle corners; browser loading/rendering is separate evidence."]}

    def check(name, passed, detail=None):
        report["checks"].append({"name": name, "pass": bool(passed), "detail": detail})

    try:
        preserved = {}
        for name, (size, digest) in ORIGINALS.items():
            actual = fingerprint(ROOT / name)
            preserved[name] = {**actual, "matches_snapshot": actual == {"bytes": size, "sha256": digest}}
        report["original_assets"] = preserved
        check("delivered field-rock GLB, helper and both maps are byte-identical", all(v["matches_snapshot"] for v in preserved.values()), preserved)
        raw = (ROOT / "foreground.glb").read_bytes()
        report.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        assert len(raw) >= 28, "truncated GLB"
        magic, version, length = struct.unpack_from("<4sII", raw)
        check("GLB 2 header and exact file length", magic == b"glTF" and version == 2 and length == len(raw))
        assert magic == b"glTF" and version == 2 and length == len(raw)
        chunks, offset = [], 12
        while offset < len(raw):
            assert offset + 8 <= len(raw), "truncated chunk header"
            size, kind = struct.unpack_from("<II", raw, offset)
            assert size % 4 == 0 and offset + 8 + size <= len(raw), "invalid chunk alignment or bounds"
            chunks.append((kind, raw[offset+8:offset+8+size]))
            offset += 8 + size
        assert len(chunks) == 2 and chunks[0][0] == 0x4e4f534a and chunks[1][0] == 0x004e4942, "expected JSON then BIN chunks"
        doc, binary = json.loads(chunks[0][1]), chunks[1][1]
        buffers = doc.get("buffers", [])
        assert len(buffers) == 1 and "uri" not in buffers[0] and buffers[0]["byteLength"] <= len(binary) <= buffers[0]["byteLength"] + 3
        check("glTF 2 uses embedded geometry without textures or decoder extensions", doc.get("asset", {}).get("version") == "2.0"
              and not any(doc.get(k) for k in ("images", "textures", "extensionsUsed", "extensionsRequired")))
        views, accessors, cache, extrema = doc.get("bufferViews", []), doc.get("accessors", []), {}, 0
        for view in views:
            assert view.get("buffer", 0) == 0 and view.get("byteOffset", 0) >= 0 and view["byteLength"] > 0
            assert view.get("byteOffset", 0) + view["byteLength"] <= buffers[0]["byteLength"], "view overrun"

        def decode(index):
            nonlocal extrema
            if index in cache:
                return cache[index]
            assert isinstance(index, int) and 0 <= index < len(accessors), "invalid accessor index"
            a = accessors[index]
            assert "sparse" not in a and a["type"] in WIDTHS and a["componentType"] in COMPONENTS
            fmt, size = COMPONENTS[a["componentType"]]
            width, count = WIDTHS[a["type"]], a["count"]
            assert isinstance(count, int) and count > 0
            view = views[a["bufferView"]]
            start, stride = a.get("byteOffset", 0), view.get("byteStride", width*size)
            assert start >= 0 and start % size == 0 and stride >= width*size and stride % size == 0
            assert start + (count-1)*stride + width*size <= view["byteLength"], "accessor overrun"
            base = view.get("byteOffset", 0) + start
            assert base % size == 0, "misaligned binary accessor"
            rows = [struct.unpack_from("<" + fmt*width, binary, base+i*stride) for i in range(count)]
            assert all(math.isfinite(v) for row in rows for v in row), "non-finite binary values"
            for key, reducer in (("min", min), ("max", max)):
                if key in a:
                    actual = [reducer(row[j] for row in rows) for j in range(width)]
                    assert len(a[key]) == width and all(math.isfinite(v) for v in a[key])
                    assert all(abs(x-y) <= max(1e-6, abs(x)*1e-6) for x, y in zip(actual, a[key])), "declared accessor bounds differ from binary"
                    extrema += 1
            if a.get("normalized"):
                divisor, minimum = {5120: (127, -1), 5121: (255, 0), 5122: (32767, -1), 5123: (65535, 0)}[a["componentType"]]
                rows = [tuple(max(minimum, v/divisor) for v in row) for row in rows]
            cache[index] = rows
            return rows

        for index in range(len(accessors)):
            decode(index)
        check("all buffer views, accessors and declared extrema match finite binary data", extrema >= 6,
              {"buffer_views": len(views), "accessors": len(accessors), "extrema": extrema})
        nodes, meshes, materials = doc.get("nodes", []), doc.get("meshes", []), doc.get("materials", [])
        worlds = {}

        def visit(index, parent):
            assert isinstance(index, int) and 0 <= index < len(nodes) and index not in worlds, "cycle or multiple parents"
            worlds[index] = multiply(parent, matrix(nodes[index]))
            for child in nodes[index].get("children", []):
                visit(child, worlds[index])

        for root in doc["scenes"][doc.get("scene", 0)]["nodes"]:
            visit(root, IDENTITY)
        mesh_nodes = {n.get("name"): i for i, n in enumerate(nodes) if "mesh" in n}
        check("three uniquely named variants are the only reachable mesh nodes", set(mesh_nodes) == set(NAMES)
              and len([n for n in nodes if "mesh" in n]) == 3 and len(worlds) == len(nodes) and len(meshes) == 3, list(mesh_nodes))
        assert set(mesh_nodes) == set(NAMES), "variant names differ from contract"
        check("static rocks contain no skin, animation, cameras or lights", not any(doc.get(k) for k in ("skins", "animations", "cameras"))
              and not any(n.get("extensions") for n in nodes) and not any(p.get("targets") for m in meshes for p in m["primitives"]))
        material_indices, topology_sequences, exported = [], [], {}
        for name in NAMES:
            ni = mesh_nodes[name]
            primitives = meshes[nodes[ni]["mesh"]]["primitives"]
            assert len(primitives) == 1, "each variant must have one primitive"
            primitive = primitives[0]
            assert primitive.get("mode", 4) == 4, "only triangle topology is supported"
            attrs = primitive["attributes"]
            assert {"POSITION", "NORMAL", "COLOR_0"} <= set(attrs), "missing required attributes"
            pos, normals, colors = (decode(attrs[k]) for k in ("POSITION", "NORMAL", "COLOR_0"))
            assert accessors[attrs["POSITION"]]["type"] == "VEC3" and accessors[attrs["POSITION"]]["componentType"] == 5126
            assert accessors[attrs["NORMAL"]]["type"] == "VEC3" and accessors[attrs["COLOR_0"]]["type"] in ("VEC3", "VEC4")
            assert all(len(decode(ai)) == len(pos) for ai in attrs.values()), "mismatched attribute counts"
            if "indices" in primitive:
                ia = accessors[primitive["indices"]]
                assert ia["type"] == "SCALAR" and ia["componentType"] in (5121, 5123, 5125) and not ia.get("normalized")
                indices = [v[0] for v in decode(primitive["indices"])]
            else:
                indices = list(range(len(pos)))
            assert len(indices) % 3 == 0 and all(0 <= i < len(pos) for i in indices), "invalid indices"
            assert "TEXCOORD_0" in attrs and accessors[attrs["TEXCOORD_0"]]["type"] == "VEC2", "missing source identity UVs"
            uv = decode(attrs["TEXCOORD_0"])
            material_indices.append(primitive["material"])
            world_pos = [transform(worlds[ni], p) for p in pos]
            exported[name] = {"positions": [world_pos[i] for i in indices], "uv": [uv[i] for i in indices]}
            bounds = {"min": [min(p[k] for p in world_pos) for k in range(3)], "max": [max(p[k] for p in world_pos) for k in range(3)]}
            extents = [bounds["max"][k] - bounds["min"][k] for k in range(3)]
            welded, sequence, unique = {}, [], []
            for index in indices:
                key = tuple(round(v, 7) for v in world_pos[index])
                if key not in welded:
                    welded[key] = len(welded)
                    unique.append(world_pos[index])
                sequence.append(welded[key])
            topology_sequences.append(sequence)
            edges, adjacency = Counter(), defaultdict(set)
            volume6, moment, degenerate, reversed_faces = 0.0, [0.0]*3, 0, 0
            for start in range(0, len(indices), 3):
                triangle = indices[start:start+3]
                p, q, r = (world_pos[i] for i in triangle)
                determinant = dot(p, cross(q, r))
                volume6 += determinant
                for k in range(3):
                    moment[k] += determinant*(p[k]+q[k]+r[k])
                # Local-space winding agrees with the exported local normals.
                lp, lq, lr = (pos[i] for i in triangle)
                face = cross([lq[k]-lp[k] for k in range(3)], [lr[k]-lp[k] for k in range(3)])
                degenerate += dot(face, face) < 1e-18
                reversed_faces += dot(face, [sum(normals[i][k] for i in triangle) for k in range(3)]) <= 0
                ids = sequence[start:start+3]
                for a, b in zip(ids, ids[1:] + ids[:1]):
                    edges[(a, b)] += 1
                    adjacency[a].add(b)
                    adjacency[b].add(a)
            assert abs(volume6) > 1e-10, "zero enclosed volume"
            centroid = [v/(4*volume6) for v in moment]
            connected, todo = set(), [0]
            while todo:
                i = todo.pop()
                if i not in connected:
                    connected.add(i)
                    todo.extend(adjacency[i] - connected)
            manifold = all(count == 1 and edges[(b, a)] == 1 for (a, b), count in edges.items())
            topology_hash = hashlib.sha256(struct.pack("<"+"I"*len(sequence), *sequence)).hexdigest()
            normal_error = max(abs(math.sqrt(dot(v, v)) - 1) for v in normals)
            values = [v for row in colors for v in row]
            result = {"name": name, "vertices": len(pos), "expanded_vertices": len(indices), "triangles": len(indices)//3,
                      "material": primitive["material"], "bounds": bounds, "extents": extents, "longest_extent": max(extents),
                      "signed_volume": volume6/6, "volume_centroid": centroid, "welded_vertices": len(welded),
                      "unique_edges": len(edges)//2, "topology_sha256": topology_hash, "maximum_normal_error": normal_error,
                      "degenerate_faces": degenerate, "reversed_faces": reversed_faces, "color_range": [min(values), max(values)]}
            report["variants"].append(result)
            check(f"{name}: one primitive stays within the 300-triangle budget", 0 < len(indices)//3 <= 300, {"triangles": len(indices)//3})
            check(f"{name}: finite 2-metre diameter bounds and unit normals/vertex colours", abs(max(extents)-2) < 1e-5
                  and min(extents) > 0 and normal_error < 1e-4 and min(values) >= 0 and max(values) <= 1.00001, result)
            check(f"{name}: closed connected solid with positive outward volume", manifold and len(connected) == len(welded)
                  and volume6 > 0 and degenerate == 0 and reversed_faces == 0,
                  {"closed_oriented_manifold": manifold, "connected_vertices": len(connected), "volume": volume6/6,
                   "degenerate_faces": degenerate, "reversed_faces": reversed_faces})
            check(f"{name}: volume centre of mass is at the origin", max(abs(v) for v in centroid) < 1e-5, centroid)
        material_ok = len(materials) == 1 and material_indices == [0, 0, 0]
        if material_ok:
            mat = materials[0]
            pbr = mat.get("pbrMetallicRoughness", {})
            material_ok = bool(mat.get("name")) and bool(pbr) and mat.get("alphaMode", "OPAQUE") == "OPAQUE" and not mat.get("doubleSided", False)
            material_ok = material_ok and all(0 <= pbr.get(k, 1) <= 1 for k in ("metallicFactor", "roughnessFactor"))
        check("all variants share one named opaque single-sided PBR material", material_ok, {"materials": [m.get("name") for m in materials], "indices": material_indices})
        check("expanded vertices preserve identical triangle topology and order across variants", all(s == topology_sequences[0] for s in topology_sequences[1:]),
              {"expanded_vertices": [len(s) for s in topology_sequences], "topology_hashes": [v["topology_sha256"] for v in report["variants"]]})
        report["totals"] = {"triangles": sum(v["triangles"] for v in report["variants"]), "direct_template_draw_calls": 3,
                            "shared_materials": len(materials), "textures": len(doc.get("textures", []))}
        manifest_path = ROOT / "foreground-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        report["manifest"] = {"file": manifest_path.name, **fingerprint(manifest_path)}
        expected_metadata = {"file": report["file"], "bytes": report["bytes"], "sha256": report["sha256"],
                             "materials": len(materials), "textures": len(doc.get("textures", [])),
                             "material": materials[0]["name"], "stored_triangles": report["totals"]["triangles"]}
        check("manifest file hash, bytes, shared material and budgets match exported data", all(manifest.get(k) == v for k, v in expected_metadata.items())
              and all(v["triangles"] == manifest["triangles_per_variant"] for v in report["variants"]), expected_metadata)
        declarations = {v["name"]: v for v in manifest["variants"]}
        assert set(declarations) == set(NAMES), "manifest variant names mismatch"
        source_count, source_triangles = manifest["source_vertex_count"], manifest["triangles"]
        assert source_count > 1 and len(source_triangles) == manifest["triangles_per_variant"]
        assert all(len(t) == 3 and all(isinstance(i, int) and 0 <= i < source_count for i in t) for t in source_triangles)
        expected_ids = [i for triangle in source_triangles for i in triangle]
        expected_faces = [i//3 for i in range(len(expected_ids))]
        expanded_ids = []
        for actual in report["variants"]:
            name, declaration = actual["name"], declarations[actual["name"]]
            bounds_match = all(abs(actual["bounds"][key][i] - declaration["bounds"][key][i]) < 1e-6 for key in ("min", "max") for i in range(3))
            centroid_error = max(abs(x-y) for x, y in zip(actual["volume_centroid"], declaration["center_of_mass"]))
            check(f"{name}: manifest bounds, volume and centroid match independent measurements", bounds_match
                  and abs(actual["signed_volume"] - declaration["signed_volume"]) < 1e-6 and centroid_error < 1e-6
                  and abs(actual["longest_extent"] - declaration["longest_extent"]) < 1e-6 and actual["triangles"] == declaration["triangles"],
                  {"centroid_difference": centroid_error, "volume_difference": abs(actual["signed_volume"] - declaration["signed_volume"])})
            encoded = exported[name]["uv"]
            float_ids = [u*(source_count-1) for u, v in encoded]
            float_faces = [(1-v)*(len(source_triangles)-1) for u, v in encoded]
            ids, faces = [round(v) for v in float_ids], [round(v) for v in float_faces]
            expanded_ids.append(ids)
            rounding_error = max([abs(x-y) for x, y in zip(float_ids, ids)] + [abs(x-y) for x, y in zip(float_faces, faces)])
            check(f"{name}: expanded UV identities prove exact source triangle and vertex order", ids == expected_ids
                  and faces == expected_faces and rounding_error < 1e-3,
                  {"source_vertices": source_count, "expanded_corners": len(ids), "maximum_id_rounding_error": rounding_error,
                   "source_vertex_order_sha256": hashlib.sha256(struct.pack("<"+"I"*len(ids), *ids)).hexdigest()})
            sources = declaration["source_positions"]
            assert len(sources) == source_count and all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in sources)
            assert len(exported[name]["positions"]) == len(expected_ids)
            position_error = max(abs(p[k] - sources[expected_ids[i]][k]) for i, p in enumerate(exported[name]["positions"]) for k in range(3))
            check(f"{name}: every expanded corner matches its normalized source vertex", position_error < 1e-6,
                  {"maximum_position_error_metres": position_error})
        check("all variants expose identical verified source IDs after toNonIndexed expansion", all(ids == expanded_ids[0] for ids in expanded_ids[1:]),
              {"expanded_vertices_per_variant": [len(ids) for ids in expanded_ids], "source_triangles": len(source_triangles)})
    except Exception as error:
        check("foreground structural validation completed", False, f"{type(error).__name__}: {error}")
    report["pass"] = all(c["pass"] for c in report["checks"])
    (ROOT / "foreground-validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"pass": report["pass"], "checks": len(report["checks"]), "failed": [c for c in report["checks"] if not c["pass"]],
                      "bytes": report.get("bytes"), "sha256": report.get("sha256"), "totals": report.get("totals")}, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
