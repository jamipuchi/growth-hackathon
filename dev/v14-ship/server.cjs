// v14-ship3d test server: the REAL server.js of this tree with dev/v14-ship/patch-server.py applied in memory (the file
// itself is never written: another lane owns it until it exits), so drawn ships carry their spec end to end.
//   PORT=8402 V14_REAL_MAX=8 node dev/v14-ship/server.cjs [--bots N]     (or V14_REPLAY=<fixtures.json>: no network)
// HTTPS off; Astra's drawing copies go to dev/v14-ship/out/controllers (the repo's controllers/ stays untouched).
// Real OpenAI calls: at most V14_REAL_MAX HTTP requests to api.openai.com (default 0 = none: Astra then answers as with
// no key, the dev kit); each one is added to dev/v14-ship/compare/calls-used.json (the lane's cap is 60). The key is
// whatever Astra finds itself (environment or its own .env read): this file never reads, prints or logs it.
"use strict";
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
process.env.HTTPS_PORT = "0";
process.env.PORT = process.env.PORT || "8402";
fs.mkdirSync(path.join(OUT, "controllers"), { recursive: true });
process.env.PERF_LOG = path.join(OUT, "perf.log");
const REAL_MAX = Math.max(0, Math.floor(Number(process.env.V14_REAL_MAX) || 0));
const USED_FILE = path.join(__dirname, "compare", "calls-used.json");
let real = 0;
const realFetch = globalThis.fetch;
// V14_REPLAY=<fixtures.json>: no network at all. { <sha1 of the image data URL>: { entity, spec } } (real answers
// recorded earlier); entity requests answer after V14_ENTITY_MS (1500), ship_spec requests after V14_SPEC_MS (3000), so
// the late-spec path runs as live; anything else (Sol's HTML, unknown images) gets HTTP 599 (the template / dev kit).
const REPLAY = process.env.V14_REPLAY ? JSON.parse(fs.readFileSync(process.env.V14_REPLAY, "utf8")) : null;
const crypto = require("crypto");
function replayAnswer(init) {
  let req = null;
  try { req = JSON.parse(init.body); } catch {}
  const name = req && req.text && req.text.format && req.text.format.name;
  const image = req && req.input && req.input[0] && req.input[0].content && (req.input[0].content.find((c) => c.type === "input_image") || {}).image_url;
  const fx = image && REPLAY[crypto.createHash("sha1").update(image).digest("hex")];
  const value = fx && (name === "entity" ? { looksLike: "entity", type: "ship", parts: fx.entity.parts, verbs: fx.entity.verbs, unlocked: fx.entity.unlocked } : name === "ship_spec" ? fx.spec : null);
  const ms = name === "ship_spec" ? Number(process.env.V14_SPEC_MS || 3000) : Number(process.env.V14_ENTITY_MS || 1500);
  return new Promise((resolve) => setTimeout(() => resolve(value
    ? new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }), { status: 200, headers: { "Content-Type": "application/json" } })
    : new Response(JSON.stringify({ error: { message: "v14 replay: no fixture" } }), { status: 599 })), value ? ms : 20));
}
globalThis.fetch = async (url, init) => {
  if (REPLAY && String(url).startsWith("https://api.openai.com/")) return replayAnswer(init);
  if (String(url).startsWith("https://api.openai.com/")) {
    if (real >= REAL_MAX) return new Response(JSON.stringify({ error: { message: "v14 test server: real-call cap reached" } }), { status: 599 });
    real++;
    let j = { calls: 0, log: [] };
    try { j = JSON.parse(fs.readFileSync(USED_FILE, "utf8")); } catch {}
    j.calls = (j.calls || 0) + 1;
    (j.log || (j.log = [])).push({ at: new Date().toISOString(), n: 1, note: `server.cjs ${(() => { try { return JSON.parse(init.body).text.format.name; } catch { return "?"; } })()}` });
    fs.writeFileSync(USED_FILE, JSON.stringify(j, null, 2));
  }
  return realFetch(url, init);
};

const astra = require(path.join(ROOT, "astra.js"));
astra._internals.setDir(path.join(OUT, "controllers"));

// The dev pages of this folder (preview.html: the phone's result card) are served next to the game, same origin.
const http = require("http");
const createServer = http.createServer;
http.createServer = function (...args) {
  const handler = args.find((a) => typeof a === "function");
  const wrapped = (req, res) => {
    const u = String(req.url || "");
    const m = /^\/dev\/v14-ship\/([\w-]+\.(html|js|mjs|png))(\?|$)/.exec(u);
    if (req.method === "GET" && m) {
      const f = path.join(__dirname, m[1]);
      return fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": { html: "text/html; charset=utf-8", js: "text/javascript", mjs: "text/javascript", png: "image/png" }[m[2]], "Cache-Control": "no-store" });
        res.end(data);
      });
    }
    return handler(req, res);
  };
  return createServer.apply(this, args.map((a) => (a === handler ? wrapped : a)));
};

const src = execFileSync("python3", [path.join(__dirname, "patch-server.py"), "--stdout"], { encoding: "utf8", maxBuffer: 16 << 20 });
const file = path.join(ROOT, "server.js");
const m = new Module(file, module);
m.filename = file;
m.paths = Module._nodeModulePaths(ROOT);
m._compile(src, file);
console.log(`[v14-ship server] patched server.js running on ${process.env.PORT} (pid ${process.pid}), real-call cap ${REAL_MAX}`);
