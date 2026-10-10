// v1.8 render probe (node only, no browser): builds every recorded entity spec plus a stress set of vehicles (every car body x
// cabin x 4 / 8 wheels x no items / six heavy items, every bike body with and without a rider) and busy people / animals / blobs
// with the real entity3d.js in all three qualities, and checks each build stays inside its triangle budget
// (lite 2600, phone 4000, big 5000: entity3d.js Q).
// Needs three r160: THREE_JS=/path/to/three.module.js node dev/v18-render/entity-budget.mjs [--all]
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
const ROOT = new URL("../../", import.meta.url);
const threeUrl = pathToFileURL(process.env.THREE_JS || "three.module.js").href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) { return s === "three" ? { url: ${JSON.stringify(threeUrl)}, shortCircuit: true } : n(s, c); }`));
const any = new Proxy(function () {}, { get: (_, k) => (k === "data" ? new Uint8ClampedArray(4) : k === "width" ? 8 : k === Symbol.toPrimitive ? () => 0 : any), apply: () => any, set: () => true });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return any; } };
await import(threeUrl);
const { buildEntity } = await import(new URL("entity3d.js", ROOT).href);
const BUDGET = { lite: 2600, phone: 4000, big: 5000 };
const dir = new URL("dev/v14-entity3d/compare/gpt-6.1-sol/", ROOT);
const specs = fs.readdirSync(dir).filter((f) => f.endsWith(".spec.json")).map((f) => ({ name: f.replace(".spec.json", ""), spec: JSON.parse(fs.readFileSync(new URL(f, dir))).spec }));
const heavyCar = [{ kind: "cannon" }, { kind: "drill" }, { kind: "lamp", where: "roof" }, { kind: "jetpack" }, { kind: "star", where: "side" }, { kind: "lamp" }];
const heavyBike = [{ kind: "drill" }, { kind: "cannon" }, { kind: "lamp" }, { kind: "jetpack" }, { kind: "star" }, { kind: "antenna", where: "head" }];
for (const body of ["sedan", "truck", "monster truck", "race car", "buggy", "tank", "rover"])
  for (const cabin of ["closed", "bubble", "open", "none"])
    for (const wheels of [4, 8])
      for (const items of [[], heavyCar])
        specs.push({ name: `car ${body}/${cabin}/${wheels}w${items.length ? "/heavy" : ""}`, spec: { type: "car", vehicle: { body, cabin, wheels, wheelSize: 0.3, color: "#cc3344" }, items } });
for (const body of ["bicycle", "motorbike", "scooter"])
  for (const rider of [false, true])
    for (const items of [[], heavyBike])
      specs.push({ name: `bike ${body}${rider ? "/rider" : ""}${items.length ? "/heavy" : ""}`, spec: { type: "bike", vehicle: { body, rider, wheelSize: 0.4, color: "#3344cc" }, items } });
specs.push({ name: "person heavy", spec: { type: "person", head: { gear: "helmet" }, items: [{ kind: "drill", where: "hand" }, { kind: "jetpack" }, { kind: "lamp", where: "head" }, { kind: "claws" }, { kind: "springs" }, { kind: "star" }] } });
specs.push({ name: "quadruped heavy", spec: { type: "quadruped", tail: { kind: "bushy" }, items: [{ kind: "saddle" }, { kind: "claws" }, { kind: "lamp", where: "head" }, { kind: "cannon" }, { kind: "antenna" }, { kind: "jetpack" }] } });
specs.push({ name: "blob heavy", spec: { type: "blob", items: [{ kind: "antenna", where: "head" }, { kind: "eye", where: "head" }, { kind: "cannon" }, { kind: "drill" }, { kind: "lamp" }, { kind: "jetpack" }] } });
const all = process.argv.includes("--all");
let over = 0, n = 0, msMax = 0;
const worst = { lite: null, phone: null, big: null };
const rows = [];
for (const { name, spec } of specs) {
  for (const quality of ["lite", "phone", "big"]) {
    const x = buildEntity(spec, { quality, color: 0x2cbbff });
    n++;
    msMax = Math.max(msMax, x.ms);
    const ok = x.triangles <= BUDGET[quality];
    if (!ok) over++;
    if (!worst[quality] || x.triangles > worst[quality].tris) worst[quality] = { name, tris: x.triangles, detail: x.detail };
    if (!ok || all) rows.push(`${ok ? "ok  " : "OVER"} ${name.padEnd(34)} ${quality.padEnd(5)} ${String(x.triangles).padStart(5)} tris (budget ${BUDGET[quality]}), detail ${x.detail}, ${x.ms} ms`);
    x.dispose && x.dispose();
  }
}
if (rows.length) console.log(rows.join("\n"));
for (const q of Object.keys(worst)) console.log(`worst ${q.padEnd(5)}: ${worst[q].name} ${worst[q].tris} tris (budget ${BUDGET[q]}), detail ${worst[q].detail}`);
console.log(`${n} builds (${specs.length} specs x 3 qualities), slowest build ${msMax.toFixed(1)} ms`);
console.log(over ? `${over} OVER BUDGET` : "ALL INSIDE BUDGET");
process.exit(over ? 1 : 0);
