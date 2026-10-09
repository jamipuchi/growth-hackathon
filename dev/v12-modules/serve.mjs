// Dev server for the v1.2 / v1.3 module demos and browser tests. Port 8210 (PORT env), 127.0.0.1 only.
//   node dev/v12-modules/serve.mjs [--port 8210]
// Serves an allowlist: the four modules at the repo root and dev/v12-modules/**. Endpoints:
//   GET  /api/layout?preset=basic|full|planet|arrows       → contract layout v2 JSON
//   GET  /api/template?preset=…[&accent=%235ee7ff]          → the astra-html.js template for that layout (text/html)
//   POST /api/template { layout, allowedActions, style }    → same, for any layout
//   ANY  /beacon/… (204), /beacon-page/… (200 page)         → recorded (a controller that reaches the network)
//   GET  /api/beacons   POST /api/beacons/reset             → the recorded hits
import http from "http";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const AstraHtml = require(path.join(ROOT, "astra-html.js"));

const argv = process.argv.slice(2);
const PORT = Number((argv.includes("--port") && argv[argv.indexOf("--port") + 1]) || process.env.PORT || 8210);

export const PRESETS = {
  basic: { buttons: [
    { type: "stick", action: "steer", label: "", x: 0.04, y: 0.35, w: 0.3, h: 0.55 },
    { type: "button", action: "shoot", label: "FIRE", x: 0.74, y: 0.5, w: 0.22, h: 0.36 },
    { type: "button", action: "boost", label: "BOOST", x: 0.5, y: 0.6, w: 0.2, h: 0.3 },
  ], source: "manual" },
  full: { buttons: [
    { type: "stick", action: "steer", label: "", x: 0.03, y: 0.4, w: 0.27, h: 0.56 },
    { type: "stick", action: "move", label: "", x: 0.7, y: 0.42, w: 0.27, h: 0.54 },
    { type: "button", action: "shoot", label: "FIRE", x: 0.38, y: 0.66, w: 0.12, h: 0.24 },
    { type: "button", action: "boost", label: "BOOST", x: 0.52, y: 0.66, w: 0.12, h: 0.24 },
    { type: "button", action: "shield", label: "SHIELD", x: 0.38, y: 0.36, w: 0.12, h: 0.22 },
    { type: "button", action: "drill", label: "DRILL", x: 0.52, y: 0.36, w: 0.12, h: 0.22 },
    { type: "button", action: "land", label: "LAND", x: 0.8, y: 0.18, w: 0.12, h: 0.18 },
    { type: "toggle", action: "view", label: "CAM", x: 0.06, y: 0.18, w: 0.1, h: 0.14 },
  ], source: "manual" },
  planet: { buttons: [
    { type: "stick", action: "move", label: "WALK", x: 0.04, y: 0.38, w: 0.3, h: 0.56 },
    { type: "button", action: "dig", label: "DIG", x: 0.76, y: 0.56, w: 0.18, h: 0.3 },
    { type: "button", action: "jump", label: "JUMP", x: 0.56, y: 0.66, w: 0.16, h: 0.26 },
    { type: "button", action: "drill", label: "DRILL", x: 0.62, y: 0.3, w: 0.14, h: 0.22 },
    { type: "button", action: "takeoff", label: "TAKE OFF", x: 0.8, y: 0.18, w: 0.17, h: 0.18 },
  ], source: "manual" },
  arrows: { buttons: [
    { type: "button", action: "left", label: "◀", x: 0.03, y: 0.55, w: 0.1, h: 0.2 },
    { type: "button", action: "right", label: "▶", x: 0.25, y: 0.55, w: 0.1, h: 0.2 },
    { type: "button", action: "up", label: "▲", x: 0.14, y: 0.33, w: 0.1, h: 0.2 },
    { type: "button", action: "down", label: "▼", x: 0.14, y: 0.76, w: 0.1, h: 0.2 },
    { type: "button", action: "shoot", label: "PEW", x: 0.78, y: 0.55, w: 0.16, h: 0.3 },
    { type: "button", action: "scan", label: "SCAN", x: 0.6, y: 0.7, w: 0.14, h: 0.22 },
  ], source: "manual" },
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8" };
const ROOT_FILES = new Set(["/ctrl-sandbox.js", "/mischief-fx.js", "/sfx.js", "/contract.js", "/verbs.js"]);
const beacons = [];

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith("/beacon")) { // /beacon-page/… answers a real page (a navigation commits), /beacon/… a 204
    beacons.push({ t: Date.now(), method: req.method, path: p + url.search, ua: String(req.headers["user-agent"] || "").slice(0, 60) });
    console.log(`BEACON ${req.method} ${p}${url.search}`);
    return p.startsWith("/beacon-page") ? send(res, 200, "<!doctype html><title>escaped</title><h1>escaped</h1>", TYPES[".html"]) : send(res, 204, "");
  }
  if (p === "/api/beacons") return send(res, 200, beacons);
  if (p === "/api/beacons/reset") { beacons.length = 0; return send(res, 200, { ok: true }); }
  if (p === "/api/layout") {
    const preset = PRESETS[url.searchParams.get("preset") || "basic"];
    return preset ? send(res, 200, preset) : send(res, 404, { error: "unknown preset" });
  }
  if (p === "/api/template") {
    let layout = PRESETS[url.searchParams.get("preset") || "basic"], allowedActions, style = { accent: url.searchParams.get("accent") || undefined };
    if (req.method === "POST") {
      try { ({ layout, allowedActions, style = {} } = JSON.parse(await readBody(req))); } catch { return send(res, 400, { error: "bad json" }); }
    }
    if (!layout) return send(res, 404, { error: "unknown preset" });
    return send(res, 200, AstraHtml.templateHtml(layout, { allowedActions, style }), TYPES[".html"]);
  }
  if (p === "/api/log" && req.method === "POST") { console.log("page:", (await readBody(req)).slice(0, 400)); return send(res, 204, ""); }
  if (p === "/favicon.ico") return send(res, 204, "");
  const allowed = ROOT_FILES.has(p) || (p.startsWith("/dev/v12-modules/") && !p.includes(".."));
  const file = path.join(ROOT, p);
  if (!allowed || !TYPES[path.extname(file)] || !file.startsWith(ROOT + path.sep)) return send(res, 404, { error: "not found" });
  fs.readFile(file, (err, data) => (err ? send(res, 404, { error: "not found" }) : send(res, 200, data, TYPES[path.extname(file)])));
});

server.listen(PORT, "127.0.0.1", () => console.log(`v12-modules dev server on http://127.0.0.1:${PORT}/dev/v12-modules/`));
