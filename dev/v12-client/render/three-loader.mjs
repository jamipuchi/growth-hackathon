// Node module-resolution hook for the render tests: "three" and "three/addons/*" come from a local copy of three.js (the browser gets
// r160 from the CDN; the test only needs the API, no GL). THREE_ROOT overrides the default copy.
import { pathToFileURL } from "node:url";
const ROOT = process.env.THREE_ROOT || "/Users/jaumepuig/Documents/enginy-sales-video/node_modules/three";
export async function resolve(spec, ctx, next) {
  if (spec === "three") return { url: pathToFileURL(`${ROOT}/build/three.module.js`).href, shortCircuit: true };
  if (spec.startsWith("three/addons/")) return { url: pathToFileURL(`${ROOT}/examples/jsm/${spec.slice(13)}`).href, shortCircuit: true };
  return next(spec, ctx);
}
