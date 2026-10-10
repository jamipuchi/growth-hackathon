// v1.8 render probe (node only, no browser): the water's height map (render.js waterHeightData, read from render.js itself) vs
// the v1.7 one (128 x 128, one 8-bit channel, sampled at i / (N - 1)). For three island seeds it reports
//  - build time (median of 7 runs after a warm-up, plus the cold first run) and how many terrain height calls it makes,
//  - texture memory,
//  - shoreline accuracy: at 4000 random points where the true height is -1.3..0.2 m (the foam edge and the ripple band) the
//    height the shader reconstructs (GPU bilinear filtering at texel centres, its decode) vs Terrain.height, and that error as
//    a sideways shift of the foam line in metres (height error / slope).
// node dev/v18-render/shore-probe.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ROOT = new URL("../../", import.meta.url);
const Terrain = require(new URL("terrain.js", ROOT).pathname);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const src = fs.readFileSync(new URL("render.js", ROOT), "utf8");
const at = src.indexOf("function waterHeightData(");
if (at < 0) throw new Error("render.js has no waterHeightData");
const fnSrc = src.slice(at, src.indexOf("\n}\n", at) + 2);
const waterHeightData = new Function("Terrain", "clamp", `${fnSrc}; return waterHeightData;`)(Terrain, clamp);
const N_NEW = Number(/const N = (\d+), data = waterHeightData/.exec(src)?.[1]);
// The v1.7 build (render.js before v1.8), for comparison.
function oldData(H, size, N = 128) {
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / (N - 1) - 0.5) * size, z = (j / (N - 1) - 0.5) * size;
    const v = clamp((H(x, z) + 8) / 48, 0, 1) * 255;
    data.set([v, v, v, 255], (j * N + i) * 4);
  }
  return data;
}
// GPU bilinear filtering of channel c (texel centres at (i + 0.5) / N, clamp to edge).
function sample(data, N, c, u, v) {
  const x = u * N - 0.5, y = v * N - 0.5, i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0;
  const g = (i, j) => data[(clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)) * 4 + c] / 255;
  return (g(i0, j0) * (1 - fx) + g(i0 + 1, j0) * fx) * (1 - fy) + (g(i0, j0 + 1) * (1 - fx) + g(i0 + 1, j0 + 1) * fx) * fy;
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const decodeOld = (d, N, u, v) => sample(d, N, 0, u, v) * 48 - 8;
const decodeNew = (d, N, u, v) => { const hc = sample(d, N, 0, u, v) * 48 - 8, hf = sample(d, N, 1, u, v) * 8 - 4; return hc + (hf - hc) * (1 - smooth(3.0, 3.8, Math.abs(hf))); };
const size = Terrain.ISLAND_SIZE * 1.35; // render.js IslandWorld.build
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, (a.length * p) | 0)];
function time(fn) { const t0 = performance.now(); fn(); const cold = performance.now() - t0; const runs = []; for (let k = 0; k < 7; k++) { const t = performance.now(); fn(); runs.push(performance.now() - t); } return { cold, med: med(runs) }; }
let worstNewMs = 0, fail = 0;
for (const seed of [1, 7, 42]) {
  let calls = 0;
  const H = (x, z) => { calls++; return Terrain.height(x, z, seed); };
  calls = 0; const dOld = oldData(H, size); const callsOld = calls;
  calls = 0; const dNew = waterHeightData(H, size, N_NEW); const callsNew = calls;
  const tOld = time(() => oldData(H, size)), tNew = time(() => waterHeightData(H, size, N_NEW));
  worstNewMs = Math.max(worstNewMs, tNew.cold, tNew.med);
  let rnd = seed * 9301 + 49297; const R = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  const sOld = [], sNew = [], eOld = [], eNew = [];
  while (sOld.length < 4000) {
    const x = (R() - 0.5) * 900, z = (R() - 0.5) * 900, h = Terrain.height(x, z, seed);
    if (h < -1.3 || h > 0.2) continue;
    const g = Math.hypot(Terrain.height(x + 0.25, z, seed) - Terrain.height(x - 0.25, z, seed), Terrain.height(x, z + 0.25, seed) - Terrain.height(x, z - 0.25, seed)) / 0.5;
    if (g < 0.005) continue;
    const u = x / size + 0.5, v = z / size + 0.5;
    const a = Math.abs(decodeOld(dOld, 128, u, v) - h), b = Math.abs(decodeNew(dNew, N_NEW, u, v) - h);
    eOld.push(a); eNew.push(b); sOld.push(a / g); sNew.push(b / g);
  }
  if (!(pct(sNew, 0.9) < pct(sOld, 0.9) / 2)) fail++;
  console.log(`seed ${seed}:
  v1.7 128 x 128: ${(size / 128).toFixed(1)} m a texel, ${(dOld.length / 1024) | 0} KB, ${callsOld} height calls, build ${tOld.med.toFixed(1)} ms (cold ${tOld.cold.toFixed(1)}), foam line shift median ${med(sOld).toFixed(2)} m p90 ${pct(sOld, 0.9).toFixed(2)} m, height error median ${med(eOld).toFixed(3)} m p90 ${pct(eOld, 0.9).toFixed(3)} m
  v1.8 ${N_NEW} x ${N_NEW}: ${(size / N_NEW).toFixed(1)} m a texel, ${(dNew.length / 1024) | 0} KB, ${callsNew} height calls, build ${tNew.med.toFixed(1)} ms (cold ${tNew.cold.toFixed(1)}), foam line shift median ${med(sNew).toFixed(2)} m p90 ${pct(sNew, 0.9).toFixed(2)} m, height error median ${med(eNew).toFixed(3)} m p90 ${pct(eNew, 0.9).toFixed(3)} m`);
}
console.log(`slowest v1.8 build ${worstNewMs.toFixed(1)} ms on this machine`);
console.log(fail ? `${fail} seed(s) without a 2x sharper foam line: FAIL` : "PASS: the foam line is at least 2x sharper (p90) on every seed");
process.exit(fail ? 1 : 0);
