// v1.9 assets: node-only three r160 setup shared by the dev/v19-assets probes (no browser, no server).
// THREE_JS=/path/to/three.module.js (r160); its addons are looked up in THREE_ADDONS, else <dir of THREE_JS>/addons
// (loaders/GLTFLoader.js, utils/BufferGeometryUtils.js, utils/SkeletonUtils.js from three@0.160.0).
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
const threePath = process.env.THREE_JS || "three.module.js";
const addons = process.env.THREE_ADDONS || path.join(path.dirname(threePath), "addons");
const threeUrl = pathToFileURL(threePath).href, addonsUrl = pathToFileURL(addons + "/").href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "three") return { url: ${JSON.stringify(threeUrl)}, shortCircuit: true };
  if (s.startsWith("three/addons/")) return { url: new URL(s.slice(13), ${JSON.stringify(addonsUrl)}).href, shortCircuit: true };
  return n(s, c); }`));
export const THREE = await import(threeUrl);
export const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
export const ROOT = new URL("../../", import.meta.url);
// A loader for local files (node's fetch has no file://): every call parses a fresh scene.
export const fileLoader = { loadAsync: async (url) => {
  const buf = fs.readFileSync(fileURLToPath(url));
  return new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
} };
export const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
