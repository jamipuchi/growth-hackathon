// v1.9 assets, node only (no browser): the A-008 quadruped clips on entity3d.js animals, against the procedural ones.
// Builds a dog-like and a horse-like animal (big and lite), poses every clip at 24 phases with both clip sets (an instance
// made before the library loads keeps the procedural clips; one made after has the A-008 ones) and measures the skinned
// mesh: lowest point vs the ground (sinking < 0, floating > 0), foot lift and stride, how far the bones turn from rest.
// Also: triangles / draw calls / budgets unchanged, every clip finite, clip names anim.js asks for.
// Run: THREE_JS=/path/to/three.module.js (r160, addons beside it) node dev/v19-assets/quad-probe.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const { THREE, ROOT } = await import("./three-node.mjs");
const any = new Proxy(function () {}, { get: (_, k) => (k === "data" ? new Uint8ClampedArray(4) : k === "width" ? 8 : k === Symbol.toPrimitive ? () => 0 : any), apply: () => any, set: () => true });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return any; } };
globalThis.ProgressEvent ??= class extends Event { constructor(type, o = {}) { super(type); Object.assign(this, o); } }; // FileLoader
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url || String(input);
  if (!url.startsWith("file:")) return realFetch(input, init);
  try { return new Response(fs.readFileSync(fileURLToPath(url)), { status: 200 }); } catch { return new Response("", { status: 404 }); }
};
const E = await import(new URL("entity3d.js", ROOT).href);
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const SPECS = {
  dog: { type: "quadruped", legs: { length: 0.4 }, neck: 0.1, tail: { kind: "bushy" }, head: { size: 0.3, snout: 0.5 } },
  horse: { type: "quadruped", legs: { length: 0.75 }, neck: 0.5, tail: { kind: "long" }, items: [{ kind: "saddle" }] },
};
const proc = {}, budget = {};
for (const [k, spec] of Object.entries(SPECS)) for (const q of ["big", "lite"]) {
  const b = E.buildEntity(spec, { quality: q, color: 0xd97706 });
  proc[`${k}/${q}`] = b;
  budget[`${k}/${q}`] = { tris: b.triangles, calls: b.drawCalls };
}
check(proc["dog/big"].clips.every((c) => !["roar"].includes(c.name)), "before the library: procedural set (no roar)");
const t0 = performance.now();
const ok = await E.loadEntityClips();
console.log(`loadEntityClips -> ${ok} in ${(performance.now() - t0).toFixed(0)} ms`);
const set = E._internals.quadClipSet();
check(set !== E._internals.quadClips() && set.some((c) => c.name === "roar"), `library in: ${set.map((c) => `${c.name} ${c.duration.toFixed(2)}s`).join(", ")}`);
check(set.every((c) => c.tracks.every((t) => t.values.every(Number.isFinite))), "every clip finite");
for (const n of ["idle", "walk", "run", "gallop", "jump", "dig", "sit", "bite", "hit", "die", "roar"]) if (!set.some((c) => c.name === n)) fails.push(`missing ${n}`);
check(!fails.some((f) => f.startsWith("missing")), "anim.js / render.js names all present (idle walk run gallop jump dig sit bite hit die roar)");
// budgets: a build after the library is the same model
for (const [k, spec] of Object.entries(SPECS)) for (const q of ["big", "lite"]) {
  const b = E.buildEntity(spec, { quality: q, color: 0xd97706 });
  const lim = q === "big" ? 5000 : 2600;
  check(b.triangles === budget[`${k}/${q}`].tris && b.triangles <= lim && b.drawCalls <= 3, `${k} ${q}: ${b.triangles} tris (<= ${lim}), ${b.drawCalls} calls, ${b.clips.length} clips`);
  b.dispose();
}
// motion metrics
const v = new THREE.Vector3(), feet = ["front_l", "front_r", "back_l", "back_r"].map((l) => `${l}_foot`);
function measure(view, name, phases = 24) {
  const mesh = view.object3d.children.find((o) => o.isSkinnedMesh);
  const n = mesh.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 1500));
  view.pose("idle", 0); // rest-ish reference: the bones' rest pose
  for (const b of view.bones.values()) b.quaternion.identity();
  view.object3d.updateMatrixWorld(true);
  const rest = {}; for (const f of feet) rest[f] = view.bones.get(f).getWorldPosition(new THREE.Vector3());
  let restMin = Infinity; for (let i = 0; i < n; i += step) restMin = Math.min(restMin, mesh.getVertexPosition(i, v).y);
  let minY = Infinity, maxMinY = -Infinity, endMinY = 0, act = 0;
  const lift = Object.fromEntries(feet.map((f) => [f, 0])), zr = Object.fromEntries(feet.map((f) => [f, [Infinity, -Infinity]]));
  for (let s = 0; s < phases; s++) {
    const ph = s / (phases - 1) * 0.999;
    view.pose(name, ph);
    let lo = Infinity; for (let i = 0; i < n; i += step) lo = Math.min(lo, mesh.getVertexPosition(i, v).y);
    minY = Math.min(minY, lo); maxMinY = Math.max(maxMinY, lo); if (s === phases - 1) endMinY = lo;
    for (const f of feet) { const p = view.bones.get(f).getWorldPosition(v); lift[f] = Math.max(lift[f], p.y - rest[f].y); zr[f][0] = Math.min(zr[f][0], p.z); zr[f][1] = Math.max(zr[f][1], p.z); }
    let a = 0, c = 0; for (const b of view.bones.values()) { a += 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))); c++; } act += a / c;
  }
  const avg = (o) => Object.values(o).reduce((x, y) => x + y, 0) / 4;
  return { sink: minY - restMin, float: maxMinY - restMin, end: endMinY - restMin, lift: avg(lift), stride: avg(Object.fromEntries(feet.map((f) => [f, zr[f][1] - zr[f][0]]))), act: (act / phases) * 180 / Math.PI };
}
const rows = [];
for (const k of ["dog/big", "horse/big"]) {
  const P = proc[k], L = P.instance(); // P: procedural clips (built before the library), L: the A-008 set
  for (const name of ["idle", "walk", "run", "gallop", "jump", "dig", "sit", "bite", "hit", "die", "roar"]) {
    const has = (view) => view.clips.some((c) => c.name === name);
    const a = has(P) ? measure(P, name) : null, b = has(L) ? measure(L, name) : null;
    const f = (m) => (m ? `sink ${m.sink.toFixed(2)} float ${m.float.toFixed(2)} end ${m.end.toFixed(2)} lift ${m.lift.toFixed(2)} stride ${m.stride.toFixed(2)} turn ${m.act.toFixed(0)}°` : "-");
    rows.push(`${k.padEnd(9)} ${name.padEnd(6)} PROC ${f(a).padEnd(72)} | A008 ${f(b)}`);
  }
  L.dispose();
}
console.log(rows.join("\n"));
console.log(fails.length ? `${fails.length} FAILED` : "ALL QUADRUPED CHECKS PASS");
process.exit(fails.length ? 1 : 0);
