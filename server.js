// Space Party server: an allowlist of public files, the live event stream to every screen, phone input, generation
// through Astra, and perf samples. The game itself runs in world.js.
// Usage: PORT=8000 node server.js [--bots N]
const http = require("http");
const fs = require("fs");
const path = require("path");
const Contract = require("./contract");
const { createWorld } = require("./world");

const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;
const ASSETS = path.join(ROOT, "assets");
const PERF_LOG = process.env.PERF_LOG || path.join(ROOT, "perf.log");
const BODY_LIMIT = 2 * 1024 * 1024;
const KEEPALIVE_MS = 15000;
const PUBLIC_FILES = new Set(["space.html", "controller.html", "render.js", "contract.js", "verbs.js", "terrain.js", "rigs.js"]);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
};
const ASSET_EXTS = new Set([".png", ".jpg", ".webp", ".glb", ".gltf", ".bin", ".mp3", ".ogg", ".wav", ".js", ".json"]);

const botsArg = process.argv.indexOf("--bots");
const BOTS = botsArg > 0 ? Math.max(0, Math.min(32, Number(process.argv[botsArg + 1]) || 0)) : 0;

// ---- Event stream ------------------------------------------------------------------------------------------------

const streams = new Set();
function writeAll(line) {
  for (const res of streams) res.write(line);
}
const sse = (m) => `data: ${JSON.stringify(m)}\n\n`;
const broadcast = (m) => writeAll(sse(m));

const world = createWorld({ broadcast, autoStart: true });
for (let i = 1; i <= BOTS; i++) world.addBot(`bot${i}`);

setInterval(() => { if (streams.size) writeAll(sse(world.tickMessage())); }, 1000 / Contract.TICK_HZ);
setInterval(() => writeAll(": keepalive\n\n"), KEEPALIVE_MS);

function openStream(req, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 1000\n\n");
  res.write(sse(world.worldMessage()));
  res.write(sse(world.tickMessage()));
  streams.add(res);
  req.on("close", () => streams.delete(res));
}

// ---- Static files: an allowlist only -------------------------------------------------------------------------------

function staticFile(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ""); } catch { return null; }
  if (PUBLIC_FILES.has(rel)) return path.join(ROOT, rel);
  if (!rel.startsWith("assets/") || rel.split("/").some((part) => !part || part.startsWith("."))) return null;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ASSETS + path.sep) || !ASSET_EXTS.has(path.extname(file).toLowerCase())) return null;
  return file;
}

function serveStatic(req, res, url) {
  if (url.pathname === "/") return res.writeHead(302, { Location: "/space.html" }).end();
  const file = staticFile(url.pathname);
  let stat = null;
  try { stat = file && fs.statSync(file); } catch {}
  if (!stat || !stat.isFile()) return res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  const ext = path.extname(file).toLowerCase();
  const cache = ext === ".html" || ext === ".js" ? "no-store" : "public, max-age=300";
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Content-Length": stat.size, "Cache-Control": cache });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---- POST handlers -------------------------------------------------------------------------------------------------

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
      else if (!tooBig) { tooBig = true; chunks.length = 0; reject(Object.assign(new Error("body too large"), { status: 413 })); } // the rest drains unread
    });
    req.on("end", () => {
      if (tooBig) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const json = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));

function input(msg) {
  if (!msg || typeof msg !== "object") return;
  msg = { ...msg, player: Contract.cleanName(msg.player) };
  if (msg.type === "input") msg.action = Contract.normaliseAction(msg.action);
  if (Contract.CHECKS.input(msg).length) return;
  world.handleInput(msg);
}

let astra = null;
async function generate(body) {
  try {
    astra = astra || require("./astra");
    return { status: 200, result: await astra.generate(body) };
  } catch (err) {
    console.log(`generate failed: ${err.message}`);
    return { status: 503, result: { ok: false, error: "generation unavailable" } };
  }
}

function device(ua) {
  ua = String(ua || "");
  for (const [re, name] of [[/iPhone/, "iPhone"], [/iPad/, "iPad"], [/Android/, "Android"], [/Macintosh/, "Mac"], [/Windows/, "Windows"], [/Linux/, "Linux"]]) if (re.test(ua)) return name;
  return "unknown";
}

function perf(sample) {
  const line = { ...sample, at: new Date().toISOString() };
  fs.appendFile(PERF_LOG, JSON.stringify(line) + "\n", () => {});
  const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "?");
  console.log(`perf ${sample.screen} ${Contract.cleanName(sample.player) || "-"} ${device(sample.ua)}: ${n(sample.fps, 1)} fps, 1% low ${n(sample.low1)}, p90 ${n(sample.p90ms, 1)} ms, ${n(sample.calls)} calls, ${Math.round(Number(sample.tris) / 1000)}k tris, tier ${sample.tier ?? "?"}`);
}

async function handlePost(req, res, url) {
  const body = await readJson(req);
  if (url.pathname === "/input") {
    (Array.isArray(body) ? body : [body]).forEach(input);
    return res.writeHead(204).end();
  }
  if (url.pathname === "/join") {
    const joined = world.join(body.player);
    return joined ? json(res, 200, joined) : json(res, 400, { error: "player name required" });
  }
  if (url.pathname === "/generate") {
    const { status, result } = await generate(body);
    const player = Contract.cleanName(body.player);
    if (result && result.ok && player && (body.kind === "controller" || body.kind === "button")) {
      world.setLayout(player, result.layout, body.kind);
      broadcast({ type: "generated", player, kind: body.kind, layout: result.layout });
    }
    return json(res, status, result);
  }
  if (url.pathname === "/perf") {
    if (Contract.CHECKS.perf(body).length) return json(res, 400, { error: Contract.CHECKS.perf(body).join("; ") });
    perf(body);
    return res.writeHead(204).end();
  }
  res.writeHead(404).end();
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/events") openStream(req, res);
    else if (req.method === "POST") await handlePost(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") serveStatic(req, res, url);
    else res.writeHead(405).end();
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 400, { error: err.message });
  }
}).listen(PORT, "0.0.0.0", () => console.log(`Space Party on http://localhost:${PORT}${BOTS ? ` with ${BOTS} bots` : ""}`));
