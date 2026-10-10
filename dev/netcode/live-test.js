// Live test of server.js: starts it on port LIVE_PORT (default 8160; HTTPS on the next port) with --bots 24 (25 players with the test), reads /events for 3 s, checks the
// allowlist, the POST endpoints, the drawing budget, entity messages and HTTPS, then kills it. Astra runs in mock mode
// (ASTRA_MOCK=1, no network, no API key).
// Run: node dev/netcode/live-test.js            (LIVE_PORT=8190 node dev/netcode/live-test.js on another lane's port)
const assert = require("assert");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const Contract = require("../../contract");

const PORT = Number(process.env.LIVE_PORT) || 8160;
const HTTPS_PORT = PORT + 1;
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
function readEvents(ms, during, events = "/events") {
  return new Promise((resolve, reject) => {
    const messages = [];
    let buf = "";
    const req = http.get(BASE + events, (res) => {
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

// One raw HTTP/1.1 request line on a socket → the status code (or "closed").
function rawRequest(line) {
  return new Promise((resolve) => {
    const net = require("net");
    const sock = net.connect(PORT, "127.0.0.1", () => sock.write(`${line}\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
    let data = "";
    sock.on("data", (d) => (data += d));
    sock.on("close", () => resolve((/^HTTP\/1\.1 (\d{3})/.exec(data) || [])[1] || "closed"));
    sock.on("error", () => resolve("error"));
    setTimeout(() => sock.destroy(), 2000);
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
  // A real 1 × 1 PNG: drawings must be PNGs with an IHDR of at most 1024 px to be kept and served (v1.0 review).
  const shipPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const ship = JSON.parse((await request("POST", "/generate", { player: "livetest", kind: "ship", image: shipPng })).body);
  assert(ship.ok && ship.entity.verbs.includes("shoot") && ship.entity.source === "devkit" && ship.entity.unlocked.length > 0, `ship → ${JSON.stringify(ship).slice(0, 160)}`);
  // v1.7 readyGate (owner 12:26): START needs a READY human (a ship drawing AND a controller accepted); bots do not count.
  const early = await request("POST", "/start", {});
  assert.strictEqual(early.status, 409, "START with nobody ready → 409");
  assert.strictEqual(JSON.parse(early.body).error, "nobody is ready");
  const pad0 = JSON.parse((await request("POST", "/generate", { player: "livetest", kind: "controller", image: shipPng })).body);
  assert(pad0.ok && pad0.layout && pad0.layout.buttons.length > 0, `controller → ${JSON.stringify(pad0).slice(0, 160)}`);
  // v1.4: START plays the server's 3-2-1 (phase "countdown", tick.countdown 3, 2, 1) before play.
  const started = await request("POST", "/start", {});
  assert.strictEqual(started.status, 200, "START from the lobby");
  const startBody = JSON.parse(started.body);
  assert.strictEqual(startBody.ready, 1, "START answers how many humans were ready");
  assert.strictEqual(startBody.phase, "countdown", "START → the 3-2-1 first");
  assert.strictEqual(startBody.countdown, 3);
  const again = await request("POST", "/start", {});
  assert.strictEqual(again.status, 409, "START during the countdown → 409");
  const counting = (await readEvents(1200)).filter((x) => x.m.type === "tick");
  assert(counting.length > 0 && counting.every((t) => t.m.phase === "countdown" && [3, 2, 1].includes(t.m.countdown)), "ticks count down");
  for (const t of counting) assert.deepStrictEqual(Contract.CHECKS.tick(t.m), []);
  for (let i = 0; i < 40; i++) { // GO: the first tick in play (a loaded machine runs the 30 Hz clock a little late)
    const t = (await readEvents(250)).filter((x) => x.m.type === "tick").pop();
    if (t && t.m.phase === "playing") break;
  }
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
  assert.deepStrictEqual(me.drawingsLeft, { space: 3, planet: 5 }, "tick drawingsLeft: the lobby ship and controller count toward space");
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
  const extras = ["transition.js", "anim.js", "anims.js", "rigs.js", "phone-extras.js", "bigscreen-extras.js", "inflate.js"];
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
  // v1.4: the phone's home-screen web app files (v14-fix-client writes them): 200 with their types when present.
  const manifest = await request("GET", "/controller.webmanifest");
  assert.strictEqual(manifest.status, fs.existsSync(path.join(ROOT, "controller.webmanifest")) ? 200 : 404, `/controller.webmanifest → ${manifest.status}`);
  if (manifest.status === 200) assert(manifest.headers["content-type"].startsWith("application/manifest+json"), `manifest type ${manifest.headers["content-type"]}`);
  const iconNames = fs.existsSync(path.join(ROOT, "icons")) ? fs.readdirSync(path.join(ROOT, "icons")).filter((n) => /^[a-z0-9][a-z0-9_.-]*\.png$/i.test(n)) : [];
  for (const n of iconNames) {
    const r = await request("GET", `/icons/${n}`);
    assert(r.status === 200 && r.headers["content-type"] === "image/png", `/icons/${n} → ${r.status}`);
  }
  for (const url of ["/icons/../server.js", "/icons/%2e%2e/server.js", "/icons/.hidden.png", "/icons/x.js", "/icons/a/b.png"]) {
    assert.strictEqual((await request("GET", url)).status, 404, `${url} stays private`);
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
  assert.deepStrictEqual(g.drawingsLeft, { space: 2, planet: 5 }, "a finished drawing spends one (the ship and the controller were the first two)");
  assert(genMsgs.some((x) => x.m.type === "generated" && x.m.player === "livetest" && x.m.kind === "button"), "generated broadcast");

  // Budget: speculative calls are free and never broadcast; 2 more finished drawings, then "no drawings left"
  // before Astra is called.
  const img = (i) => "data:image/png;base64," + Buffer.from(`drawing ${i}`).toString("base64");
  const genBody = (i, speculative) => ({ player: "livetest", kind: "button", image: img(i), region: { x: 0.1, y: 0.05, w: 0.2, h: 0.2 }, speculative, requestId: `r${i}` });
  const spec = JSON.parse((await request("POST", "/generate", genBody(100, true))).body);
  assert(spec.ok && spec.drawingsLeft.space === 2, "speculative not counted");
  for (let i = 1; i <= 2; i++) {
    const r = JSON.parse((await request("POST", "/generate", genBody(i, false))).body);
    assert(r.ok && r.drawingsLeft.space === 2 - i, `drawing ${i + 3}: ${JSON.stringify(r).slice(0, 120)}`);
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

  // v1.2: Sol writes the controller. A controller drawing answers with the whole pad as HTML at once (the template in
  // mock mode); `generated` carries it to the player's own screens only (the TV gets it without the HTML); a reloaded
  // phone gets it from POST /controller-html. inkRegions with no stick → the regions layout plus a steer stick.
  await request("POST", "/join", { player: "pad" });
  const ink = [{ x: 0.62, y: 0.5, w: 0.15, h: 0.3 }, { x: 0.8, y: 0.45, w: 0.15, h: 0.35 }];
  const padImg = "data:image/png;base64," + Buffer.from("pad controller drawing").toString("base64");
  const [anyMsgs, bigMsgs, mineMsgs, ctlRes] = await Promise.all([
    readEvents(1500),
    readEvents(1500, null, "/events?screen=big"),
    readEvents(1500, null, "/events?player=pad"),
    new Promise((r) => setTimeout(r, 250)).then(() => request("POST", "/generate", { player: "pad", kind: "controller", image: padImg, source: "draw", inkRegions: ink })),
  ]);
  const ctl = JSON.parse(ctlRes.body);
  assert(ctl.ok && ctl.layout.source === "regions" && /^<!doctype html/i.test(ctl.html) && ctl.htmlSource === "template", `controller → ${ctlRes.body.slice(0, 160)}`);
  assert.deepStrictEqual(ctl.layout.buttons.map((b) => [b.type, b.action, !!b.auto]), [["button", "shoot", false], ["button", "boost", false], ["stick", "steer", true]], "regions → shoot, boost + an auto steer stick (never stuck)");
  assert.deepStrictEqual(ctl.controls.map((c) => c.action).sort(), ["boost", "shoot", "steer"], "controls = the allowed actions");
  assert.deepStrictEqual(ctl.padLayout.buttons.length, 3);
  const genOf = (list) => list.filter((x) => x.m.type === "generated" && x.m.player === "pad").map((x) => x.m);
  const [gAny, gBig, gMine] = [genOf(anyMsgs), genOf(bigMsgs), genOf(mineMsgs)];
  assert(gAny.length === 1 && gAny[0].html === ctl.html && gMine.length === 1 && gMine[0].html === ctl.html, "generated with the html to the player (and to unnamed screens)");
  assert(gBig.length === 1 && gBig[0].html === undefined && gBig[0].layout && gBig[0].htmlSource === "template", "the TV gets generated without the html");
  for (const m of [...gAny, ...gBig]) assert.deepStrictEqual(Contract.CHECKS.generated(m), [], "generated passes CHECKS.generated");
  const cur = JSON.parse((await request("POST", "/controller-html", { player: "pad" })).body);
  assert(cur.ok && cur.html === ctl.html && cur.pending === false && cur.htmlSource === "template", "POST /controller-html → the same pad");
  assert.strictEqual((await request("POST", "/controller-html", { player: "nobody" })).status, 404);
  report.push(`controller html: ${Buffer.byteLength(ctl.html)} B template with ${ctl.controls.length} controls (auto steer stick added), generated to the player (TV without html), /controller-html ok`);

  // Personal messages go to the player's own streams: a refused verb's toast reaches /events?player=pad, not the TV.
  const [toAny, toBig, toPad, toOther] = await Promise.all([
    readEvents(800), readEvents(800, null, "/events?screen=big"), readEvents(800, null, "/events?player=pad"), readEvents(800, null, "/events?player=late"),
    new Promise((r) => setTimeout(r, 200)).then(() => request("POST", "/input", { type: "input", player: "pad", action: "dig", down: true })),
  ]);
  const toastsOf = (list) => list.filter((x) => x.m.type === "toast" && x.m.player === "pad").length;
  assert.deepStrictEqual([toastsOf(toAny), toastsOf(toBig), toastsOf(toPad), toastsOf(toOther)], [1, 0, 1, 0], "toast: unnamed and own stream yes, TV and other phones no");
  // A verb with a cooldown (the dev-kit ship's FLARE): only its owner's phone hears when it is ready again.
  const [cdBig, cdMine, cdOther] = await Promise.all([
    readEvents(800, null, "/events?screen=big"), readEvents(800, null, "/events?player=livetest"), readEvents(800, null, "/events?player=pad"),
    new Promise((r) => setTimeout(r, 200)).then(() => request("POST", "/input", { type: "input", player: "livetest", action: "flare", down: true })),
  ]);
  const cdOf = (list) => list.filter((x) => x.m.type === "cooldown");
  assert.deepStrictEqual([cdOf(cdBig).length, cdOf(cdMine).length, cdOf(cdOther).length], [0, 1, 0], "cooldown: the owner's phone only");
  assert.deepStrictEqual(Contract.CHECKS.cooldown(cdOf(cdMine)[0].m), [], `cooldown message ${JSON.stringify(cdOf(cdMine)[0].m)}`);
  report.push(`streams: toasts and cooldowns (${JSON.stringify(cdOf(cdMine)[0].m)}) only to the player's own phone (and unnamed streams), never to ?screen=big`);

  // Speculative calls: at most 8 per player per 10 s.
  const specs = [];
  for (let i = 0; i < 9; i++) specs.push(JSON.parse((await request("POST", "/generate", { player: "spammer", kind: "button", image: img(200 + i), region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, speculative: true })).body));
  assert(specs.slice(0, 8).every((r) => r.ok) && specs[8].ok === false && specs[8].error === "slow down", `9th speculative → ${JSON.stringify(specs[8])}`);
  // Names: a second device asking for a name in use gets name2; the first device keeps it.
  const d1 = JSON.parse((await request("POST", "/join", { player: "dev", device: "device-aaaa-1111" })).body);
  const d2 = JSON.parse((await request("POST", "/join", { player: "dev", device: "device-bbbb-2222" })).body);
  assert.deepStrictEqual([d1.player, d2.player, d2.renamed], ["dev", "dev2", true], "device tokens");
  // GET /info for the join QR.
  const inf = JSON.parse((await request("GET", "/info")).body);
  assert(/^http:\/\/[0-9a-z.]+:\d+$/.test(inf.lanUrl) && inf.bigScreenUrl === `${inf.lanUrl}/space.html`, `/info → ${JSON.stringify(inf)}`);
  if (HAS_HTTPS) assert(inf.httpsUrl === inf.lanUrl.replace("http:", "https:").replace(`:${PORT}`, `:${HTTPS_PORT}`) && inf.controllerUrl === `${inf.httpsUrl}/controller.html`, "/info: the QR opens the HTTPS controller");
  report.push(`speculative: 9th in 10 s → "slow down"; join: a second device → dev2; /info ${inf.controllerUrl}`);

  // Robustness: malformed request targets never take the server down.
  const raw = [];
  for (const line of ["GET // HTTP/1.1", "GET //evil.example/x HTTP/1.1", "GET /%E0%A4%A HTTP/1.1", "GET http://x/ HTTP/1.1", "BREW / HTTP/1.1", "GET /a b c HTTP/1.1"]) raw.push(`${line.split(" ")[1]} → ${await rawRequest(line)}`);
  const alive = await request("GET", "/contract.js");
  assert.strictEqual(alive.status, 200, `still serving after: ${raw.join(", ")}`);
  assert.strictEqual(await rawRequest("GET // HTTP/1.1"), "404");
  // A fake PNG (the signature, then junk) is not kept as a drawing.
  await request("POST", "/join", { player: "fake" });
  const fakePng = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]).toString("base64");
  const fake = JSON.parse((await request("POST", "/generate", { player: "fake", kind: "ship", image: fakePng })).body);
  assert(fake.ok && !fake.entity.image, "a fake PNG unlocks skills but is never served as a drawing");
  assert.strictEqual((await request("GET", "/drawings/fake-ship.png")).status, 404);
  assert.strictEqual((await request("POST", "/perf", { ...sample, ua: "x".repeat(20000) })).status, 413, "/perf body cap");
  report.push(`robustness: ${raw.join(", ")}; still serving; fake PNG not kept; /perf 16 KB cap`);

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
    if (/^(livetest|pad|fake|spammer|dev2?|late)-/.test(f)) fs.rmSync(path.join(ROOT, "controllers", f), { force: true });
  }
  process.exit(code);
}
