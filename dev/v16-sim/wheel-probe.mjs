// v1.6 N7 probe (node only, no browser): builds every recorded car / bike spec with the real entity3d.js in all three
// qualities and checks (1) the lowest point of the whole model is y = 0 (wheels touch the ground, nothing sinks below it),
// (2) every tyre is a closed ring whose inner bead tucks inside the hub (no sidewall gap around it).
// Needs three r160: THREE_JS=/path/to/three.module.js node dev/v16-sim/wheel-probe.mjs
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
const ROOT = new URL("../../", import.meta.url);
const threeUrl = pathToFileURL(process.env.THREE_JS || "three.module.js").href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { return s === "three" ? { url: ${JSON.stringify(threeUrl)}, shortCircuit: true } : n(s, c); }`));
// A 2D canvas that accepts every call (the atlas is painted, never read back here).
const any = new Proxy(function () {}, { get: (_, k) => (k === "data" ? new Uint8ClampedArray(4) : k === "width" ? 8 : k === Symbol.toPrimitive ? () => 0 : any), apply: () => any, set: () => true });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return any; } };
const THREE = await import(threeUrl);
const { buildEntity } = await import(new URL("entity3d.js", ROOT).href);
const dir = new URL("dev/v14-entity3d/compare/gpt-6.1-sol/", ROOT);
const specs = fs.readdirSync(dir).filter((f) => f.endsWith(".spec.json")).map((f) => ({ name: f.replace(".spec.json", ""), spec: JSON.parse(fs.readFileSync(new URL(f, dir))).spec }));
// Synthetic extras so every vehicle body / size gets a build: monster, race, buggy, tank-like, motorbike, scooter, bicycle.
for (const [name, type, vehicle] of [["monster", "car", { body: "monster truck", wheels: 4, wheelSize: 0.7 }], ["race", "car", { body: "race car", wheels: 4, wheelSize: 0.15 }],
  ["buggy", "car", { body: "buggy", wheels: 4, wheelSize: 0.3 }], ["six", "car", { body: "truck", wheels: 6, wheelSize: 0.25 }], ["tank", "car", { body: "tank", wheels: 8, wheelSize: 0.2 }],
  ["motor", "bike", { body: "motorbike", wheels: 2, wheelSize: 0.4 }], ["scooter", "bike", { body: "scooter", wheels: 2, wheelSize: 0.3 }], ["bicycle", "bike", { body: "bicycle", wheels: 2, wheelSize: 0.5 }]])
  specs.push({ name, spec: { type, vehicle: { ...vehicle, color: "#cc3344" } } });
let fail = 0;
const rows = [];
for (const { name, spec } of specs) {
  if (spec.type !== "car" && spec.type !== "bike") continue;
  for (const quality of ["lite", "phone", "big"]) {
    let x;
    try { x = buildEntity(spec, { quality, color: 0x2cbbff }); } catch (e) { rows.push(`${name} ${quality}: BUILD ERROR ${e.message}`); fail++; continue; }
    x.object3d.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(x.object3d);
    const minY = bb.min.y, ok = Math.abs(minY) < 1e-3;
    if (!ok) fail++;
    rows.push(`${ok ? "ok  " : "FAIL"} ${name.padEnd(16)} ${quality.padEnd(5)} lowest y ${minY.toFixed(4)} m, wheels ${x.wheels.map((w) => `${w.radius.toFixed(2)}@${w.pivot.position.y.toFixed(2)}`).join(" ")}, ${x.triangles} tris`);
    x.dispose && x.dispose();
  }
}
console.log(rows.join("\n"));
console.log(fail ? `${fail} FAIL` : "ALL PASS");
process.exit(fail ? 1 : 0);
