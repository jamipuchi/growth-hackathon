// Live test of server.js: starts it on port 8160 (HTTPS 8161) with --bots 24 (25 players with the test), reads /events for 3 s, checks the
// allowlist, the POST endpoints, the drawing budget, entity messages and HTTPS, then kills it. Astra runs in mock mode
// (ASTRA_MOCK=1, no network, no API key).
// Run: node dev/netcode/live-test.js
const assert = require("assert");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Contract = require("../../contract");

const PORT = 8160;
const HTTPS_PORT = 8161;
const HAS_HTTPS = fs.existsSync(path.join(__dirname, "..", "..", "https.js"));
const ROOT = path.join(__dirname, "..", "..");
const PERF_LOG = path.join(__dirname, "perf-test.log");
const BASE = `http://localhost:${PORT}`;

const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: String(HTTPS_PORT), ASTRA_MOCK: "1", PERF_LOG };
delete env.OPENAI_API_KEY;
const server = spawn(process.execPath, ["server.js", "--bots", "24"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
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

  // Event stream with 24 bots in play: the lobby waits for START (POST /start, the big screen's button).
  const posted = JSON.parse((await request("POST", "/join", { player: "Live Test!" })).body);
  await request("POST", "/input", { type: "input", player: "livetest", action: "ready", down: true });
  await new Promise((r) => setTimeout(r, 300));
  const lobbyTick = (await readEvents(300)).find((x) => x.m.type === "tick");
  assert.strictEqual(lobbyTick.m.phase, "lobby", "ready alone no longer starts the round");
  // A drawn ship (Astra mock → the dev kit) unlocks shoot; a plain ship could not fire.
  const shipPng = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("live-ship")]).toString("base64");
  const ship = JSON.parse((await request("POST", "/generate", { player: "livetest", kind: "ship", image: shipPng })).body);
  assert(ship.ok && ship.entity.verbs.includes("shoot") && ship.entity.source === "devkit" && ship.entity.unlocked.length > 0, `ship → ${JSON.stringify(ship).slice(0, 160)}`);
  const started = await request("POST", "/start", {});
  assert.strictEqual(started.status, 200, "START from the lobby");
  const again = await request("POST", "/start", {});
  assert.strictEqual(again.status, 409, "START during play → 409");
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
  assert(maxBytes < 8192, `max tick ${maxBytes} bytes`);
  assert(players.filter((p) => p.flags.bot).length === 24, "24 bots in the tick");
  assert(ticks.every((t) => t.m.phase === "playing"), "in play");
  assert.deepStrictEqual(posted, { player: "livetest", color: Contract.COLORS[24 % Contract.COLORS.length] }, "join cleans the name");
  const me = players.find((p) => p.name === "livetest");
  assert(me && me.action === "shoot" && me.slot === "primary", "input normalised FIRE → shoot");
  assert.deepStrictEqual(me.drawingsLeft, { space: 4, planet: 5 }, "tick drawingsLeft: the lobby ship counts toward space");
  assert(players.filter((p) => p.flags.bot).every((p) => p.drawingsLeft === undefined), "bots carry no drawingsLeft");
  const ents = worlds[0].m.entities;
  assert(ents && ents.livetest && ents.livetest.type === "ship" && Array.isArray(ents.livetest.verbs) && Object.keys(ents).length === 25, "world.entities for every player");
  assert(ticks.every((t) => t.m.bullets.every((b) => b.length === 6 && (b[5] === 0 || b[5] === 1))), "bullets carry their mode");
  assert(worlds.slice(1).every((w) => w.m.entities === undefined), "broadcast world updates leave entities out");
  report.push(`${ticks.length} ticks in ${span.toFixed(2)} s = ${tps.toFixed(2)}/s, max tick ${maxBytes} B (avg ${Math.round(ticks.reduce((s, t) => s + t.bytes, 0) / ticks.length)} B), ${players.length} players, max ${Math.max(...ticks.map((t) => t.m.bullets.length))} bullets, ${worlds.length} world msgs (connect ${worlds[0].bytes} B with entities, broadcast max ${Math.max(0, ...worlds.slice(1).map((w) => w.bytes))} B)`);

  // Allowlist.
  const privatePaths = ["/.env", "/server.js", "/world.js", "/astra.js", "/rules.js", "/https.js", "/perf-report.js", "/perf.log", "/controllers/x.json", "/.orch/CONTRACT.md", "/.orch-certs/key.pem", "/assets/../server.js", "/assets/%2e%2e/server.js", "/PLAN.md", "/assets/A-001-boss-rock/generate.py", "/assets/A-001-boss-rock/boss_source.blend"];
  for (const url of privatePaths) {
    const r = await request("GET", url);
    assert.strictEqual(r.status, 404, `${url} → ${r.status}`);
  }
  const types = { "/space.html": "text/html", "/controller.html": "text/html", "/contract.js": "text/javascript", "/verbs.js": "text/javascript", "/terrain.js": "text/javascript", "/assets/A-001-boss-rock/boss.glb": "model/gltf-binary", "/assets/A-001-boss-rock/boss.js": "text/javascript" };
  // The new public modules: 200 when the file exists (other lanes may not have written it yet), else 404.
  const extras = ["transition.js", "anim.js", "anims.js", "rigs.js", "phone-extras.js", "bigscreen-extras.js"];
  let extrasServed = 0;
  for (const f of extras) {
    const r = await request("GET", "/" + f);
    const exists = fs.existsSync(path.join(ROOT, f));
    assert.strictEqual(r.status, exists ? 200 : 404, `/${f} → ${r.status}`);
    if (exists) { extrasServed++; assert(r.headers["content-type"].startsWith("text/javascript")); }
  }
  for (const [url, type] of Object.entries(types)) {
    const r = await request("GET", url);
    assert.strictEqual(r.status, 200, `${url} → ${r.status}`);
    assert(r.headers["content-type"].startsWith(type), `${url} type ${r.headers["content-type"]}`);
    if (/\.(html|js)$/.test(url)) assert.strictEqual(r.headers["cache-control"], "no-store", `${url} no-store`);
  }
  const root = await request("GET", "/");
  assert(root.status === 302 && root.headers.location === "/space.html", "/ redirects to /space.html");
  report.push(`allowlist: ${privatePaths.length} private paths 404, ${Object.keys(types).length} public files 200 with the right types, ${extrasServed}/${extras.length} new modules present and served, / → /space.html`);

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
  assert.deepStrictEqual(g.drawingsLeft, { space: 3, planet: 5 }, "a finished drawing spends one (the ship was the first)");
  assert(genMsgs.some((x) => x.m.type === "generated" && x.m.player === "livetest" && x.m.kind === "button"), "generated broadcast");

  // Budget: speculative calls are free and never broadcast; 3 more finished drawings, then "no drawings left"
  // before Astra is called.
  const img = (i) => "data:image/png;base64," + Buffer.from(`drawing ${i}`).toString("base64");
  const genBody = (i, speculative) => ({ player: "livetest", kind: "button", image: img(i), region: { x: 0.1, y: 0.05, w: 0.2, h: 0.2 }, speculative, requestId: `r${i}` });
  const spec = JSON.parse((await request("POST", "/generate", genBody(100, true))).body);
  assert(spec.ok && spec.drawingsLeft.space === 3, "speculative not counted");
  for (let i = 1; i <= 3; i++) {
    const r = JSON.parse((await request("POST", "/generate", genBody(i, false))).body);
    assert(r.ok && r.drawingsLeft.space === 3 - i, `drawing ${i + 1}: ${JSON.stringify(r).slice(0, 120)}`);
  }
  const astraLines = () => (serverOut.match(/^astra button livetest/gm) || []).length;
  const linesBefore = astraLines();
  const t1 = Date.now();
  const refused = await request("POST", "/generate", genBody(9, false));
  const refusedMs = Date.now() - t1;
  const rj = JSON.parse(refused.body);
  assert(refused.status === 200 && rj.ok === false && rj.error === "no drawings left" && rj.drawingsLeft.space === 0 && rj.drawingsLeft.planet === 5, `refusal → ${refused.body}`);
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(astraLines(), linesBefore, "refused before Astra was called");
  const spec2 = JSON.parse((await request("POST", "/generate", genBody(101, true))).body);
  assert(spec2.ok, "speculative calls still work at 0 left");
  report.push(`budget: 5 finished drawings in space, speculative free, 6th refused in ${refusedMs} ms without calling Astra`);

  // Entity messages: a late joiner's ship is broadcast; HTTPS serves the same handler.
  const [entMsgs] = await Promise.all([
    readEvents(600),
    new Promise((r) => setTimeout(r, 150)).then(() => request("POST", "/join", { player: "late" })),
  ]);
  const ent = entMsgs.find((x) => x.m.type === "entity" && x.m.player === "late");
  assert(ent && ent.m.entity.type === "ship" && ent.m.entity.source === "plain" && ent.m.entity.verbs.length === 0, "entity on join: a plain ship only flies");
  assert(entMsgs[0].m.entities.livetest.verbs.includes("shoot") && /\/drawings\/livetest-ship\.png\?v=/.test(entMsgs[0].m.entities.livetest.image), "the drawn ship: unlocked skills + image");
  assert(entMsgs[0].m.type === "world" && entMsgs[0].m.entities.livetest.type === "ship", "world.entities for late screens");
  report.push(`entity: on join ${JSON.stringify(ent.m.entity).slice(0, 80)}…, anims ${ent.m.entity.anims ? "wired" : "omitted (no astra.wireAnimations)"}`);
  if (HAS_HTTPS) {
    const r = await new Promise((resolve, reject) => {
      https.get(`https://localhost:${HTTPS_PORT}/contract.js`, { rejectUnauthorized: false }, (res) => { res.resume(); res.on("end", () => resolve(res)); }).on("error", reject);
    });
    assert.strictEqual(r.statusCode, 200, "HTTPS contract.js");
    const r404 = await new Promise((resolve, reject) => {
      https.get(`https://localhost:${HTTPS_PORT}/server.js`, { rejectUnauthorized: false }, (res) => { res.resume(); res.on("end", () => resolve(res)); }).on("error", reject);
    });
    assert.strictEqual(r404.statusCode, 404, "HTTPS allowlist");
    assert(new RegExp(`https://[0-9.]+:${HTTPS_PORT}`).test(serverOut) && new RegExp(`http://[0-9a-z.]+:${PORT}/controller.html`).test(serverOut), "both URLs printed with the LAN IP");
    report.push(`https: :${HTTPS_PORT} serves the same handler (200 / 404), both URLs printed`);
  } else report.push("https: https.js missing, skipped");
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
