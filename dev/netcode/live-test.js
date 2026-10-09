// Live test of server.js: starts it on port 8101 with --bots 8, reads /events for 3 s, checks the allowlist and the
// POST endpoints, then kills it. Astra runs in mock mode (ASTRA_MOCK=1, no network, no API key).
// Run: node dev/netcode/live-test.js
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Contract = require("../../contract");

const PORT = 8101;
const ROOT = path.join(__dirname, "..", "..");
const PERF_LOG = path.join(__dirname, "perf-test.log");
const BASE = `http://localhost:${PORT}`;

const env = { ...process.env, PORT: String(PORT), ASTRA_MOCK: "1", PERF_LOG };
delete env.OPENAI_API_KEY;
const server = spawn(process.execPath, ["server.js", "--bots", "8"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(BASE + url, { method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Read the event stream for `ms` and return every message with its byte size.
function readEvents(ms, during) {
  return new Promise((resolve, reject) => {
    const messages = [];
    let buf = "";
    const req = http.get(BASE + "/events", (res) => {
      assert.strictEqual(res.headers["content-type"], "text/event-stream");
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of block.split("\n")) if (line.startsWith("data: ")) messages.push({ at: Date.now(), bytes: Buffer.byteLength(line.slice(6)), m: JSON.parse(line.slice(6)) });
        }
      });
      if (during) during().catch(reject);
      setTimeout(() => { req.destroy(); resolve(messages); }, ms);
    });
    req.on("error", (err) => { if (err.code !== "ECONNRESET") reject(err); });
  });
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { await request("GET", "/contract.js"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("server did not start:\n" + serverOut);
}

async function main() {
  const t0 = Date.now();
  await waitForServer();
  const report = [];

  // Event stream with 8 bots in play (the only human is ready, so the lobby ends): ticks per second and bytes.
  const posted = JSON.parse((await request("POST", "/join", { player: "Live Test!" })).body);
  await request("POST", "/input", { type: "input", player: "livetest", action: "ready", down: true });
  await new Promise((r) => setTimeout(r, 100)); // the next sim step ends the lobby
  const msgs = await readEvents(3000, async () => {
    await request("POST", "/input", { type: "input", player: "livetest", action: "FIRE", down: true });
    await request("POST", "/input", { type: "axis", player: "livetest", axis: "steer", x: 0.5, y: 0 });
    await request("POST", "/input", { type: "input", player: "livetest", action: 42, down: "yes" }); // ignored
  });
  assert.strictEqual(msgs[0].m.type, "world", "world first on connect");
  const worlds = msgs.filter((x) => x.m.type === "world");
  const ticks = msgs.filter((x) => x.m.type === "tick");
  for (const w of worlds) assert.deepStrictEqual(Contract.CHECKS.world(w.m), []);
  for (const t of ticks) assert.deepStrictEqual(Contract.CHECKS.tick(t.m), []);
  const span = (ticks[ticks.length - 1].at - ticks[0].at) / 1000;
  const tps = (ticks.length - 1) / span;
  const maxBytes = Math.max(...ticks.map((t) => t.bytes));
  const players = ticks[ticks.length - 1].m.players;
  assert(tps > 13.5 && tps < 16.5, `ticks per second ${tps.toFixed(2)}`);
  assert(maxBytes < 4096, `max tick ${maxBytes} bytes`);
  assert(players.filter((p) => p.flags.bot).length === 8, "8 bots in the tick");
  assert(ticks.every((t) => t.m.phase === "playing"), "in play");
  assert.deepStrictEqual(posted, { player: "livetest", color: Contract.COLORS[8 % Contract.COLORS.length] }, "join cleans the name");
  const me = players.find((p) => p.name === "livetest");
  assert(me && me.action === "shoot" && me.slot === "primary", "input normalised FIRE → shoot");
  report.push(`${ticks.length} ticks in ${span.toFixed(2)} s = ${tps.toFixed(2)}/s, max tick ${maxBytes} B (avg ${Math.round(ticks.reduce((s, t) => s + t.bytes, 0) / ticks.length)} B), ${players.length} players, max ${Math.max(...ticks.map((t) => t.m.bullets.length))} bullets, ${worlds.length} world msgs (max ${Math.max(...worlds.map((w) => w.bytes))} B)`);

  // Allowlist.
  for (const url of ["/.env", "/server.js", "/world.js", "/astra.js", "/perf.log", "/controllers/x.json", "/.orch/CONTRACT.md", "/assets/../server.js", "/assets/%2e%2e/server.js", "/PLAN.md", "/assets/A-001-boss-rock/generate.py", "/assets/A-001-boss-rock/boss_source.blend"]) {
    const r = await request("GET", url);
    assert.strictEqual(r.status, 404, `${url} → ${r.status}`);
  }
  const types = { "/space.html": "text/html", "/controller.html": "text/html", "/contract.js": "text/javascript", "/verbs.js": "text/javascript", "/terrain.js": "text/javascript", "/assets/A-001-boss-rock/boss.glb": "model/gltf-binary", "/assets/A-001-boss-rock/boss.js": "text/javascript" };
  for (const [url, type] of Object.entries(types)) {
    const r = await request("GET", url);
    assert.strictEqual(r.status, 200, `${url} → ${r.status}`);
    assert(r.headers["content-type"].startsWith(type), `${url} type ${r.headers["content-type"]}`);
    if (/\.(html|js)$/.test(url)) assert.strictEqual(r.headers["cache-control"], "no-store", `${url} no-store`);
  }
  const root = await request("GET", "/");
  assert(root.status === 302 && root.headers.location === "/space.html", "/ redirects to /space.html");
  report.push("allowlist: 12 private paths 404, 7 public files 200 with the right types, / → /space.html");

  // /perf: validated, appended with a server timestamp, one console line.
  const sample = { player: "livetest", screen: "phone", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", fps: 58.9, low1: 41, p90ms: 21, calls: 64, tris: 98000, textures: 12, tier: 2, w: 844, h: 390, dpr: 3 };
  assert.strictEqual((await request("POST", "/perf", sample)).status, 204);
  assert.strictEqual((await request("POST", "/perf", { screen: "tv" })).status, 400);
  await new Promise((r) => setTimeout(r, 100));
  const logged = fs.readFileSync(PERF_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert(logged.length === 1 && logged[0].at && logged[0].fps === 58.9, "perf.log line");
  assert(serverOut.includes("perf phone livetest iPhone: 58.9 fps, 1% low 41, p90 21.0 ms, 64 calls, 98k tris, tier 2"), "perf console line");
  report.push("perf: logged with timestamp, bad sample 400, console line ok");

  // /generate (Astra mock): a button merges into the layout and is broadcast as `generated`.
  const png = "data:image/png;base64," + Buffer.from("not really a png but astra mock only hashes it").toString("base64");
  const [genMsgs, gen] = await Promise.all([
    readEvents(1500),
    new Promise((r) => setTimeout(r, 200)).then(() => request("POST", "/generate", { player: "livetest", kind: "button", image: png, region: { x: 0.4, y: 0.05, w: 0.2, h: 0.2 } })),
  ]);
  const g = JSON.parse(gen.body);
  assert(gen.status === 200 && g.ok && g.layout.buttons[0].action === "land", `generate → ${gen.body.slice(0, 120)}`);
  assert(genMsgs.some((x) => x.m.type === "generated" && x.m.player === "livetest" && x.m.kind === "button"), "generated broadcast");
  const big = await request("POST", "/generate", "x".repeat(2 * 1024 * 1024 + 10));
  assert.strictEqual(big.status, 413, "2 MB body limit");
  report.push(`generate (mock): ok, broadcast, 2 MB limit → 413`);

  console.log(`PASS live test (${Date.now() - t0} ms) at ${new Date().toISOString()}\n  ` + report.join("\n  "));
}

main()
  .then(() => finish(0))
  .catch((err) => { console.log("FAIL live test\n" + err.stack + "\n--- server output ---\n" + serverOut); finish(1); });

function finish(code) {
  server.kill();
  fs.rmSync(PERF_LOG, { force: true });
  for (const f of fs.existsSync(path.join(ROOT, "controllers")) ? fs.readdirSync(path.join(ROOT, "controllers")) : []) {
    if (f.startsWith("livetest-")) fs.rmSync(path.join(ROOT, "controllers", f), { force: true });
  }
  process.exit(code);
}
