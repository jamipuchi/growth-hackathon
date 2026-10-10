// v13-server check, for the TEST round (the Oct 10 morning round was implement-only: this was written, not run).
//   node dev/v13-server/check-server.mjs [port]        (default 8260; uses only that port, ASTRA_MOCK=1, no OpenAI)
// Part 1, in process: Astra with every network call failing (a fake fetch, never the real API) still answers a
//   finished ship / explorer with a usable entity (dev kit, card, anims).
// Part 2, a real server child on its own port: ghost players (409), auto-join on /generate, device binding (403),
//   entity.card + entity.image on the answer and on the `entity` broadcast, the drawing served, where-aware mock buttons.
// Prints one line per check and a summary; exit code 1 on any failure. Stops its server by PID.
import http from "http";
import path from "path";
import os from "os";
import fs from "fs";
import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { pngDataUrl } from "../e2e/driver.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const PORT = Number(process.argv[2]) || 8260;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// ---- Part 1: Astra never fails an entity silently ------------------------------------------------------------------
async function astraPart() {
  const A = require(path.join(ROOT, "astra.js"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "v13s-astra-"));
  A._internals.setDir(out);
  A._internals.setTimeoutMs(1500);
  A._internals.setFetch(() => Promise.reject(new TypeError("fetch failed"))); // every call fails: no real request
  const prevMock = process.env.ASTRA_MOCK;
  delete process.env.ASTRA_MOCK;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key"; // apiKey() must not fall back to .env
  for (const kind of ["ship", "explorer"]) {
    const t0 = Date.now();
    const r = await A.generate({ player: "checker", kind, image: pngDataUrl(`${kind}-fail`, 128, 96), source: "draw" });
    const e = r && r.entity;
    check(`astra ${kind} with a failing network → usable entity`, r && r.ok && e && e.type && Array.isArray(e.verbs) && e.verbs.length > 0,
      `${Date.now() - t0} ms, source ${e && e.source}, verbs ${e && e.verbs.join(" ")}`);
    check(`astra ${kind} entity has a card`, e && typeof e.card === "string" && /^Your (ship|explorer) can: /.test(e.card), e && e.card);
    check(`astra ${kind} entity has anims`, e && e.anims && typeof e.anims === "object");
  }
  if (prevMock === undefined) delete process.env.ASTRA_MOCK; else process.env.ASTRA_MOCK = prevMock;
  delete process.env.OPENAI_API_KEY;
}

// ---- Part 2: the server ---------------------------------------------------------------------------------------------
function request(method, pathname, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, method, headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(buf.toString("utf8")); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, bytes: buf.length });
      });
    });
    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    if (data) req.write(data);
    req.end();
  });
}

function stream(query, messages) {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: `/events?${query}` }, (res) => {
    let buf = "";
    res.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (line) { try { messages.push(JSON.parse(line.slice(6))); } catch {} }
      }
    });
  });
  req.on("error", () => {});
  return req;
}

const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };

async function serverPart() {
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", OPENAI_API_KEY: "", PERF_LOG: path.join(os.tmpdir(), `v13s-perf-${PORT}.log`) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  try {
    const up = await until(() => /Space Party on/.test(log), 8000);
    check("server starts", up, `pid ${child.pid}, port ${PORT}`);
    if (!up) return;
    const tv = [];
    const tvReq = stream("screen=big", tv);
    await until(() => tv.some((m) => m.type === "world"));

    // Ghost players: never joined, no stream → 409, and no player appears.
    let r = await request("POST", "/input", [{ type: "input", player: "ghost1", action: "left", down: true }, { type: "axis", player: "ghost2", axis: "steer", x: 1, y: 0 }]);
    check("/input from a name that never joined → 409 join first", r.status === 409 && r.json && r.json.error === "join first", `status ${r.status}`);
    await new Promise((res) => setTimeout(res, 300));
    const lastTick = [...tv].reverse().find((m) => m.type === "tick");
    check("no ghost players in the tick", lastTick && !lastTick.players.some((p) => /^ghost/.test(p.name)), `${lastTick ? lastTick.players.length : "?"} players`);

    // Join with a device token; the entity answer and broadcast carry card + image.
    r = await request("POST", "/join", { player: "alice", device: "device-alice-0001" });
    check("/join alice", r.status === 200 && r.json && r.json.player === "alice", `status ${r.status}`);
    const t0 = Date.now();
    r = await request("POST", "/generate", { player: "alice", kind: "ship", image: pngDataUrl("alice-ship", 128, 96), source: "draw", device: "device-alice-0001" });
    const e = r.json && r.json.entity;
    check("/generate ship → entity", r.status === 200 && r.json.ok && e && e.type === "ship", `${Date.now() - t0} ms, source ${e && e.source}`);
    check("ship answer has card and image", e && typeof e.card === "string" && /^\/drawings\/alice-ship\.png\?v=/.test(e.image || ""), `${e && e.card} · ${e && e.image}`);
    const ent = await until(() => tv.find((m) => m.type === "entity" && m.player === "alice" && m.entity && m.entity.image));
    check("TV gets alice's entity with image and card", ent && typeof ent.entity.card === "string", ent ? ent.entity.image : "none");
    const img = e && e.image ? await request("GET", e.image) : { status: 0 };
    check("the drawing is served", img.status === 200 && /image\/png/.test(img.headers["content-type"] || ""), `${img.bytes || 0} bytes`);

    // Device binding.
    r = await request("POST", "/generate", { player: "alice", kind: "ship", image: pngDataUrl("evil", 128, 96), source: "draw", device: "device-mallory-01" });
    check("/generate with another phone's token → 403 name taken", r.status === 403 && r.json && r.json.error === "name taken", `status ${r.status}`);
    r = await request("POST", "/input", { type: "input", player: "alice", action: "left", down: true, device: "device-mallory-01" });
    check("/input with another phone's token → 403", r.status === 403, `status ${r.status}`);
    r = await request("POST", "/input", { type: "input", player: "alice", action: "left", down: false });
    check("/input without a token still works (older phones)", r.status === 204, `status ${r.status}`);

    // Auto-join on /generate (a phone that outlived a restart), explorer card.
    r = await request("POST", "/generate", { player: "bob", kind: "explorer", image: pngDataUrl("bob-explorer", 128, 96), source: "draw" });
    check("/generate explorer from an unknown name joins it", r.status === 200 && r.json && r.json.ok && r.json.entity && /^Your /.test(r.json.entity.card || ""), r.json && r.json.entity && r.json.entity.card);

    // Mock buttons answer the asked verb (expect), and a space button without expect is not DIG.
    r = await request("POST", "/generate", { player: "alice", kind: "button", image: pngDataUrl("DIG"), region: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, expect: "dig", source: "draw" });
    const a1 = r.json && r.json.layout && r.json.layout.buttons.map((b) => b.action).join(",");
    check("mock button with expect dig → dig", a1 === "dig", a1 || `status ${r.status}`);
    r = await request("POST", "/generate", { player: "alice", kind: "button", image: pngDataUrl("SOMETHING"), region: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 }, source: "draw" });
    const a2 = r.json && r.json.layout && r.json.layout.buttons.map((b) => b.action).join(",");
    check("mock button in space without expect → a space skill", ["land", "shoot", "boost"].includes(a2), a2 || `status ${r.status}`);
    tvReq.destroy();
  } finally {
    child.kill();
  }
}

const started = Date.now();
await astraPart();
await serverPart();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s (${new Date().toISOString()})`);
process.exit(failed.length ? 1 : 0);
