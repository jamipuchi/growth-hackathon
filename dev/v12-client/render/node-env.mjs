// A just-enough browser for importing render.js in Node (no GL): fake document / canvas 2D context, window, EventSource, ...
import { register } from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
register("./three-loader.mjs", import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
const require = createRequire(import.meta.url);
globalThis.Contract = require(path.join(ROOT, "contract.js"));
globalThis.Terrain = require(path.join(ROOT, "terrain.js"));
globalThis.Verbs = require(path.join(ROOT, "verbs.js"));
// a canvas 2D context that accepts everything
const ctx2d = () => new Proxy({}, { get: (t, k) => (k === "getImageData" ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : k === "createImageData" ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : k === "canvas" ? undefined : (k in t ? t[k] : () => ctx2d())), set: (t, k, v) => ((t[k] = v), true) });
const fakeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d(), addEventListener() {}, removeEventListener() {}, clientWidth: 800, clientHeight: 450, after() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }) });
globalThis.document = { createElement: (n) => (n === "canvas" ? fakeCanvas() : { style: {}, appendChild() {}, remove() {}, addEventListener() {} }), addEventListener() {}, removeEventListener() {}, hidden: false, body: { appendChild() {} } };
globalThis.window = globalThis;
globalThis.location = { search: "" };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 800; globalThis.innerHeight = 450;
globalThis.EventSource = class { constructor(url) { this.url = url; EventSource.opened.push(url); } close() { this.closed = true; } };
globalThis.EventSource.opened = [];
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
try { Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node-test" }, configurable: true }); } catch { /* exists */ }
globalThis.fetch = async () => { throw new Error("no network in the node test"); };

// render.js as a test module: the same source with its relative imports made absolute and an export of the internals.
export async function loadRender() {
  let src = fs.readFileSync(path.join(ROOT, "render.js"), "utf8");
  const abs = (f) => pathToFileURL(path.join(ROOT, f)).href;
  src = src.replace(/import\("\.\/([\w.-]+\.js)"\)/g, (m, f) => `import("${abs(f)}")`);
  src = src.replace(/import\.meta\.url/g, JSON.stringify(abs("render.js")));
  // no GL here: a renderer that accepts everything
  src = src.replace(/new THREE\.WebGLRenderer\(/g, "new __FakeRenderer(");
  src = "const __deep = (o) => new Proxy(function () {}, { get: (t, k) => (k in o ? o[k] : k === Symbol.toPrimitive ? () => 0 : __deep({})), apply: () => __deep({}), construct: () => __deep({}), set: (t, k, v) => ((o[k] = v), true) });\nclass __FakeRenderer { constructor(o) { const info = { autoReset: false, reset() {}, render: { calls: 0, triangles: 0 }, memory: { textures: 0 } }; const self = { info, shadowMap: {}, domElement: o && o.canvas, capabilities: { isWebGL2: true, maxTextureSize: 4096 }, extensions: { has: () => true, get: () => null }, getPixelRatio: () => 1, getSize: (v) => v.set(800, 450), getDrawingBufferSize: (v) => v.set(800, 450), getRenderTarget: () => null, getClearColor: (c) => c, getClearAlpha: () => 0, setRenderTarget() {}, setPixelRatio() {}, setSize() {}, render() { globalThis.__renders = (globalThis.__renders || 0) + 1; }, compile() {}, dispose() {}, clear() {}, setClearColor() {}, copyFramebufferToTexture() {}, getContext: () => __deep({}), autoClear: true, toneMapping: 0, outputColorSpace: 'srgb', xr: { enabled: false }, state: __deep({}), properties: __deep({}), };  return self; } }\n" + src;
  src += `\nexport const __t = { MischiefLayer, DecoyView, Particles, RingPool, BillboardBatch, StreakBatch, CameraRig, Snapshots, Perf, computeHud, entPlanLod, entNote, entReset, entShips, entPlanet, entities, DRAWN, worldSound, SpaceWorld, IslandWorld, ShipModel, ShipView, mineGeometry, HUD_COPY };\n`;
  const out = path.join(HERE, ".tmp");
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, "render-under-test.mjs");
  fs.writeFileSync(file, src);
  return import(pathToFileURL(file).href);
}
