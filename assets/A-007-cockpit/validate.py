"""Validate exported cockpit GLB bytes, transforms and the reference camera view.

Run: python3 assets/A-007-cockpit/validate.py
Writes validation.json beside this script. No Blender or third-party packages.
"""
import hashlib
import json
import math
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FILE = ROOT / "cockpit.glb"
COMPONENTS = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
FOV = 70
ASPECT = 16 / 9
TAN_HALF = math.tan(math.radians(FOV / 2))
IDENTITY = [[1 if i == j else 0 for j in range(4)] for i in range(4)]


def multiply(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def transformed(m, p):
    return tuple(sum(m[i][j] * p[j] for j in range(3)) + m[i][3] for i in range(3))


def node_matrix(node):
    if "matrix" in node:
        assert not any(k in node for k in ("translation", "rotation", "scale")), "node contains both matrix and TRS"
        values = node["matrix"]
        assert len(values) == 16 and all(math.isfinite(v) for v in values)
        return [[values[j * 4 + i] for j in range(4)] for i in range(4)]
    t, s, q = node.get("translation", [0, 0, 0]), node.get("scale", [1, 1, 1]), node.get("rotation", [0, 0, 0, 1])
    assert len(t) == len(s) == 3 and len(q) == 4 and all(math.isfinite(v) for v in t + s + q)
    assert all(abs(v) > 1e-10 for v in s), "singular node scale"
    assert abs(sum(v * v for v in q) - 1) < 1e-5, "rotation quaternion is not normalized"
    x, y, z, w = q
    r = [[1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w)],
         [2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w)],
         [2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)]]
    return [[r[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def normalized(v):
    length = math.sqrt(sum(x * x for x in v))
    assert length > 1e-12
    return [x / length for x in v]


def projected(p):
    x, y, z = p
    assert z < 0, "geometry or socket lies on/behind camera"
    nx, ny = x / (-z * TAN_HALF * ASPECT), y / (-z * TAN_HALF)
    return nx, ny


def conservative_coverage(triangles, width=640, height=360):
    """Pixel-center union of all projected faces, including back faces.

    Ignoring back-face culling makes the occupied estimate conservative for this
    opaque cockpit. This is a reference-camera geometry estimate, not GPU QA.
    """
    mask = bytearray(width * height)
    for triangle in triangles:
        p = [projected(v) for v in triangle]
        p = [((x + 1) * width / 2, (1 - y) * height / 2) for x, y in p]
        area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0])
        if abs(area) < 1e-10:
            continue
        left, right = max(0, math.floor(min(v[0] for v in p))), min(width - 1, math.ceil(max(v[0] for v in p)))
        top, bottom = max(0, math.floor(min(v[1] for v in p))), min(height - 1, math.ceil(max(v[1] for v in p)))
        sign = 1 if area > 0 else -1
        edges = [(p[i], p[(i + 1) % 3]) for i in range(3)]
        for y in range(top, bottom + 1):
            py = y + .5
            for x in range(left, right + 1):
                index = y * width + x
                if mask[index]:
                    continue
                px = x + .5
                if all(sign * ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) >= -1e-7 for a, b in edges):
                    mask[index] = 1
    occupied = sum(mask)
    return {"width": width, "height": height, "occupied_pixels": occupied,
            "occupied_fraction": occupied / len(mask), "clear_fraction": 1 - occupied / len(mask),
            "method": "Projected opaque triangle union including back faces, sampled at pixel centers"}


def main():
    report = {"file": FILE.name, "checks": [], "limitations": [
        "Reference projection assumes vertical FOV 70 degrees, aspect 16:9, camera at origin looking -Z.",
        "Triangle coverage is a geometric estimate; final browser visibility and phone performance require separate evidence."]}
    checks = report["checks"]

    def check(name, passed, detail=None):
        checks.append({"name": name, "pass": bool(passed), "detail": detail})

    try:
        raw = FILE.read_bytes()
        report.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        assert len(raw) >= 28, "file too small for GLB"
        magic, version, length = struct.unpack_from("<4sII", raw)
        check("GLB 2 header and exact file length", magic == b"glTF" and version == 2 and length == len(raw))
        assert magic == b"glTF" and version == 2 and length == len(raw)
        chunks, offset = [], 12
        while offset < len(raw):
            assert offset + 8 <= len(raw), "truncated chunk header"
            size, kind = struct.unpack_from("<II", raw, offset)
            assert size % 4 == 0 and offset + 8 + size <= len(raw), "bad chunk bounds/alignment"
            chunks.append((kind, raw[offset + 8:offset + 8 + size]))
            offset += 8 + size
        check("JSON and BIN chunks are complete and ordered", len(chunks) == 2 and chunks[0][0] == 0x4e4f534a and chunks[1][0] == 0x004e4942)
        assert len(chunks) == 2 and chunks[0][0] == 0x4e4f534a and chunks[1][0] == 0x004e4942
        document, binary = json.loads(chunks[0][1]), chunks[1][1]
        check("glTF asset version is 2.0", document.get("asset", {}).get("version") == "2.0")
        buffers = document.get("buffers", [])
        assert len(buffers) == 1 and "uri" not in buffers[0], "external or multiple buffers"
        size = buffers[0]["byteLength"]
        check("single embedded buffer without external resources", size <= len(binary) <= size + 3 and not document.get("images") and not document.get("textures"))
        extensions = set(document.get("extensionsUsed", [])) | set(document.get("extensionsRequired", []))
        forbidden = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"}
        check("no decoder or unsupported extension is required", not extensions.intersection(forbidden) and extensions <= {"KHR_materials_emissive_strength"}, sorted(extensions))
        views = document.get("bufferViews", [])
        for v in views:
            assert v.get("buffer", 0) == 0 and v.get("byteOffset", 0) >= 0 and v["byteLength"] >= 0
            assert v.get("byteOffset", 0) + v["byteLength"] <= size, "bufferView overruns BIN"
        cache = {}
        extrema_checked = []

        def accessor(index):
            if index in cache:
                return cache[index]
            a = document["accessors"][index]
            assert "sparse" not in a, "sparse accessor unsupported by this validator"
            assert a["componentType"] in COMPONENTS and a["type"] in WIDTHS
            fmt, component_size = COMPONENTS[a["componentType"]]
            count, width = a["count"], WIDTHS[a["type"]]
            assert isinstance(count, int) and count > 0
            view = views[a["bufferView"]]
            start, item_size = a.get("byteOffset", 0), width * component_size
            stride = view.get("byteStride", item_size)
            assert start % component_size == 0 and stride >= item_size and stride % component_size == 0
            assert start + (count - 1) * stride + item_size <= view["byteLength"], "accessor overruns bufferView"
            base = view.get("byteOffset", 0) + start
            rows = [struct.unpack_from("<" + fmt * width, binary, base + i * stride) for i in range(count)]
            for key, reducer in (("min", min), ("max", max)):
                if key in a:
                    actual = [reducer(row[j] for row in rows) for j in range(width)]
                    assert len(a[key]) == width and all(math.isfinite(v) for v in a[key]), "invalid accessor extrema"
                    assert all(abs(x - y) <= max(1e-6, abs(x) * 1e-6) for x, y in zip(actual, a[key])), "accessor extrema do not match binary values"
                    extrema_checked.append({"accessor": index, "kind": key})
            if a.get("normalized"):
                ranges = {5120: (127, -1), 5121: (255, 0), 5122: (32767, -1), 5123: (65535, 0)}
                divisor, minimum = ranges[a["componentType"]]
                rows = [tuple(max(minimum, value / divisor) for value in row) for row in rows]
            assert all(math.isfinite(value) for row in rows for value in row), "non-finite accessor value"
            cache[index] = rows
            return rows

        for index in range(len(document.get("accessors", []))):
            accessor(index)
        check("all buffer views and accessors are bounded and finite", True, {"buffer_views": len(views), "accessors": len(cache)})
        check("declared accessor extrema match exported binary values", bool(extrema_checked), {"extrema_checked": len(extrema_checked)})
        nodes, meshes, materials = document.get("nodes", []), document.get("meshes", []), document.get("materials", [])
        names = [node.get("name", "") for node in nodes]
        check("nodes have unique lowercase underscore names", len(names) == len(set(names)) and all(re.fullmatch(r"[a-z][a-z0-9_]*", name) for name in names), names)
        required = {"cockpit", "cockpit_hull", "cockpit_trim", "cockpit_signals", "socket_gauge_1", "socket_gauge_2", "socket_gauge_3"}
        check("root, three visual parts and three gauge sockets exist", required <= set(names))
        scene_index = document.get("scene", 0)
        roots = document["scenes"][scene_index]["nodes"]
        worlds, active = {}, set()

        def visit(index, parent):
            assert 0 <= index < len(nodes) and index not in active and index not in worlds, "cyclic or multiply-parented node"
            active.add(index)
            worlds[index] = multiply(parent, node_matrix(nodes[index]))
            for child in nodes[index].get("children", []):
                visit(child, worlds[index])
            active.remove(index)

        for root in roots:
            visit(root, IDENTITY)
        check("scene transforms form a finite single-parent hierarchy", len(worlds) == len(nodes), {"reachable_nodes": len(worlds), "total_nodes": len(nodes)})
        check("cockpit has no animation, skin or morph state", not document.get("animations") and not document.get("skins") and not any(p.get("targets") for m in meshes for p in m["primitives"]))
        triangles, points, parts = [], [], []
        normal_error, color_min, color_max, degenerate = 0, math.inf, -math.inf, 0
        for index, world in worlds.items():
            node = nodes[index]
            if "mesh" not in node:
                continue
            for primitive in meshes[node["mesh"]]["primitives"]:
                assert primitive.get("mode", 4) == 4, "only TRIANGLES are supported"
                attributes = primitive["attributes"]
                assert {"POSITION", "NORMAL", "COLOR_0"} <= set(attributes), "positions, normals and vertex colors required"
                position = accessor(attributes["POSITION"])
                assert all(len(v) == 3 for v in position)
                assert document["accessors"][attributes["POSITION"]]["componentType"] == 5126
                assert all(len(accessor(a)) == len(position) for a in attributes.values()), "attribute count mismatch"
                normals, colors = accessor(attributes["NORMAL"]), accessor(attributes["COLOR_0"])
                assert all(len(v) == 3 for v in normals), "NORMAL must be VEC3"
                assert all(len(v) in (3, 4) for v in colors), "COLOR_0 must be VEC3 or VEC4"
                normal_error = max(normal_error, max(abs(math.sqrt(sum(x*x for x in v)) - 1) for v in normals))
                color_min = min(color_min, min(v for row in colors for v in row))
                color_max = max(color_max, max(v for row in colors for v in row))
                indices = [v[0] for v in accessor(primitive["indices"])] if "indices" in primitive else list(range(len(position)))
                assert len(indices) % 3 == 0 and all(isinstance(i, int) and 0 <= i < len(position) for i in indices), "invalid triangle indices"
                assert 0 <= primitive["material"] < len(materials), "missing/invalid material"
                transformed_points = [transformed(world, p) for p in position]
                points.extend(transformed_points)
                for i in range(0, len(indices), 3):
                    triangle = tuple(transformed_points[j] for j in indices[i:i + 3])
                    u = [triangle[1][j] - triangle[0][j] for j in range(3)]
                    v = [triangle[2][j] - triangle[0][j] for j in range(3)]
                    cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
                    if sum(x*x for x in cross) < 1e-20:
                        degenerate += 1
                    triangles.append(triangle)
                parts.append({"node": names[index], "vertices": len(position), "triangles": len(indices) // 3, "material": primitive["material"]})
        assert points and triangles, "no cockpit geometry"
        bounds = {"min": [min(p[i] for p in points) for i in range(3)], "max": [max(p[i] for p in points) for i in range(3)]}
        report.update(triangles=len(triangles), draw_calls=len(parts), textures=len(document.get("textures", [])), materials=len(materials), bounds=bounds, parts=parts)
        check("cockpit fits 8000-triangle / 4-draw-call budget", len(triangles) <= 8000 and len(parts) <= 4, {"triangles": len(triangles), "draw_calls": len(parts)})
        check("all geometry is finite and in front of the camera", all(math.isfinite(v) for p in points for v in p) and bounds["max"][2] < -.01, bounds)
        check("normals are normalized and vertex colors are bounded", normal_error < .01 and color_min >= 0 and color_max <= 1.00001, {"maximum_normal_error": normal_error, "color_range": [color_min, color_max]})
        check("triangle indices form nondegenerate faces", degenerate == 0, {"degenerate_faces": degenerate})
        check("materials are opaque metallic-roughness PBR without textures", len(materials) <= 4 and all("pbrMetallicRoughness" in m and m.get("alphaMode", "OPAQUE") == "OPAQUE" and
              0 <= m["pbrMetallicRoughness"].get("metallicFactor", 1) <= 1 and 0 <= m["pbrMetallicRoughness"].get("roughnessFactor", 1) <= 1 for m in materials) and not document.get("textures"))
        check("closed-solid materials use single-sided face culling", all(not m.get("doubleSided", False) for m in materials),
              {"double_sided_materials": [m.get("name", str(i)) for i, m in enumerate(materials) if m.get("doubleSided", False)],
               "reason": "Single-sided materials avoid separate front/back passes when the helper enables transparent overlay rendering."})
        gauges = []
        for number, expected_x in enumerate([-.47, 0, .47], 1):
            name = f"socket_gauge_{number}"
            index = names.index(name)
            world = worlds[index]
            center = transformed(world, [0, 0, 0])
            axis_x = normalized([world[i][0] for i in range(3)])
            axis_y = normalized([world[i][1] for i in range(3)])
            normal = normalized([axis_x[1]*axis_y[2]-axis_x[2]*axis_y[1], axis_x[2]*axis_y[0]-axis_x[0]*axis_y[2], axis_x[0]*axis_y[1]-axis_x[1]*axis_y[0]])
            ndc = projected(center)
            gauge = {"name": name, "position": list(center), "normal": normal, "x_axis": axis_x, "y_axis": axis_y,
                     "ndc": list(ndc), "screen_fraction": [(ndc[0] + 1) / 2, (1 - ndc[1]) / 2]}
            gauges.append(gauge)
            check(f"{name}: XY display faces camera with upright axes", normal[2] > .9999 and axis_x[0] > .9999 and axis_y[1] > .9999 and "mesh" not in nodes[index], gauge)
            check(f"{name}: visible at the reference dashboard position", abs(center[2] + 1.35) < .001 and abs(ndc[0] - expected_x) < .002 and abs(ndc[1] + .9) < .002, gauge)
        report["reference_camera"] = {"position": [0, 0, 0], "forward": [0, 0, -1], "vertical_fov_degrees": FOV, "aspect": ASPECT, "gauges": gauges}
        manifest_file = ROOT / "geometry-manifest.json"
        manifest_raw = manifest_file.read_bytes()
        manifest = json.loads(manifest_raw)
        report["manifest_sha256"] = hashlib.sha256(manifest_raw).hexdigest()
        manifest_counts = {"bytes": len(raw), "sha256": report["sha256"], "triangles": len(triangles),
                           "draw_calls": len(parts), "materials": len(materials), "textures": len(document.get("textures", []))}
        bounds_match = all(abs(manifest["bounds"][bound][i] - bounds[bound][i]) < 1e-5 for bound in ("min", "max") for i in range(3))
        check("manifest hash, budgets and bounds match the actual GLB", all(manifest.get(k) == v for k, v in manifest_counts.items()) and bounds_match, manifest_counts)
        display_extents = []
        for gauge, declaration in zip(gauges, manifest["gauges"]):
            assert declaration["name"] == gauge["name"], "manifest gauge order/name mismatch"
            width, height = declaration["display_size_metres"]
            assert all(math.isfinite(v) and v > 0 for v in (width, height)), "invalid gauge dimensions"
            world = worlds[names.index(gauge["name"])]
            corners = [projected(transformed(world, [x * width / 2, y * height / 2, 0])) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            projected_width = max(p[0] for p in corners) - min(p[0] for p in corners)
            projected_height = max(p[1] for p in corners) - min(p[1] for p in corners)
            footprint = {"name": gauge["name"], "local_size_metres": [width, height], "ndc_corners": corners,
                         "ndc_size": [projected_width, projected_height]}
            display_extents.append(footprint)
            check(f"{gauge['name']}: declared display fits the visible dashboard band", all(-1 < x < 1 and -1 < y < -.8 for x, y in corners)
                  and abs(projected_width - .28) < .001 and abs(projected_height - .12) < .001
                  and all(abs(a - b) < 1e-5 for a, b in zip(gauge["position"], declaration["position"])), footprint)
        report["reference_camera"]["display_extents"] = display_extents
        if bounds["max"][2] < 0:
            report["reference_coverage"] = conservative_coverage(triangles)
            check("reference cockpit leaves at least 70 percent clear", report["reference_coverage"]["clear_fraction"] >= .7, report["reference_coverage"])
        report["binary_bytes"] = size
        report["node_count"] = len(nodes)
    except Exception as error:
        check("structural validation completed", False, f"{type(error).__name__}: {error}")
    report["pass"] = all(c["pass"] for c in checks)
    (ROOT / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"pass": report["pass"], "checks": len(checks), "failed": [c for c in checks if not c["pass"]],
                      "triangles": report.get("triangles"), "draw_calls": report.get("draw_calls"), "sha256": report.get("sha256"),
                      "reference_coverage": report.get("reference_coverage")}, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
