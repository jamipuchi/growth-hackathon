// v1.8 skipready (bug found by v18-tests, present in v1.7): a player who taps SKIP on the drawing steps ("plain ship + default
// buttons" / "use the default buttons") was never READY under the v1.7 readyGate, so START never let them in. Node only:
//   node dev/v18-skipready/skip-test.js            (SKIP_PORT=8650 on another lane's port; --world-only skips the live server)
// Part 1, world.js: useDefault counts for READY (lobby flags.ready, readyCount, START → in the round, ENDLESS entry), a fresh round
// clears it for who played, a waiting player keeps it. Part 2, server.js: POST /default (what controller.html's SKIP now sends)
// makes the player READY and POST /start lets them into the round (tick.players), with ASTRA_MOCK=1 and no bots.
const assert = require("assert");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const root = path.join(__dirname, "..", "..");
const Contract = require(path.join(root, "contract"));
const Verbs = require(path.join(root, "verbs"));
const { createWorld } = require(path.join(root, "world"));

const results = [];
const ok = (name) => { results.push(name); console.log("ok  " + name); };

// ---------------------------------------------------------------- part 1: world.js
function worldPart() {
  const ship = () => ({ type: "ship", unlocked: Verbs.DEV_KIT.space, parts: [], source: "devkit" });
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let resetNames = null;
  const w = createWorld({ random, autostartSeconds: null, readyGate: true, onRoundReset: (round, names) => { resetNames = names; } });
  const tick = () => { const t = w.tickMessage(); assert.deepStrictEqual(Contract.CHECKS.tick(t), []); return t; };
  const flag = (t, name) => !!t.players.find((p) => p.name === name).flags.ready;
  const run = (until, max = 600, dt = 0.5) => { for (let i = 0; i < max / dt && !until(); i++) w.step(dt); assert.ok(until(), "timed out"); };

  // the bug as found: ana taps SKIP on step 1, bob draws a ship and SKIPs the controller, cy is still drawing
  w.join("ana"); w.join("bob"); w.join("cy");
  w.setEntity("bob", "ship", ship());
  assert.strictEqual(w.readyCount(), 0);
  assert.strictEqual(w.start(), false, "nobody ready yet");
  assert.strictEqual(w.useDefault("ana", "ship"), false, "the plain ship alone is not READY (no controller yet)");
  assert.strictEqual(w.useDefault("ana", "controller"), true, "plain ship + default buttons = READY");
  assert.strictEqual(w.useDefault("bob", "controller"), true, "drawn ship + default buttons = READY");
  assert.strictEqual(w.readyCount(), 2);
  let t = tick();
  assert.ok(flag(t, "ana") && flag(t, "bob") && !flag(t, "cy"), "the TV hangar shows ana and bob READY, cy not");
  assert.strictEqual(w.isReady("ana"), true); assert.strictEqual(w.isReady("cy"), false);
  ok("SKIP (plain ship + default buttons, or default buttons after a drawn ship) is READY: flags.ready, readyCount 2");

  // nothing else changes: the skipper flies the plain ship with the default pad, and the drawn ship stays drawn
  assert.strictEqual(w.players.ana.drawn.space, null);
  assert.strictEqual(w.players.ana.layout, null);
  assert.strictEqual(w.players.ana.entity.source, "plain");
  assert.ok(w.layoutOf("ana").buttons.some((b) => b.action === "steer"), "the default layout");
  assert.strictEqual(w.players.bob.drawn.space.source, "devkit");
  ok("the plain ship and the default buttons are what a skipper flies (no fake drawing, no layout written)");

  // bad calls never create or ready anybody
  assert.strictEqual(w.useDefault("nobody", "ship"), null);
  assert.strictEqual(w.players.nobody, undefined, "never creates a player");
  assert.strictEqual(w.useDefault("cy", "explorer"), null, "only ship / controller");
  assert.strictEqual(w.isReady("cy"), false);
  w.addBot("bot1");
  assert.strictEqual(w.useDefault("bot1", "ship"), null, "not for bots");
  ok("useDefault: unknown names, bots and other kinds are refused (null)");

  // START: the skippers are in the round, cy waits
  assert.strictEqual(w.start({ countdown: true }), true);
  t = tick();
  assert.deepStrictEqual(t.players.filter((p) => !(p.flags && p.flags.bot)).map((p) => p.name).sort(), ["ana", "bob"]);
  assert.deepStrictEqual(t.waiting.map((x) => x.name), ["cy"]);
  run(() => w.phase === "playing", 10, 0.1);
  t = tick();
  assert.ok(t.players.some((p) => p.name === "ana"), "ana plays");
  ok("START: the skipping players enter the round like anyone else; the one still drawing waits");

  // cy skips while waiting: ready for the next round
  w.useDefault("cy", "ship"); w.useDefault("cy", "controller");
  t = tick();
  assert.deepStrictEqual(t.waiting.map((x) => [x.name, x.ready]), [["cy", true]]);
  run(() => w.phase === "scoreboard", 400);
  run(() => w.phase === "lobby", 60);
  assert.deepStrictEqual(resetNames.filter((n) => !n.startsWith("bot")).sort(), ["ana", "bob"]);
  assert.strictEqual(w.isReady("ana"), false, "who played starts from scratch: SKIP again");
  assert.strictEqual(w.isReady("bob"), false);
  assert.strictEqual(w.isReady("cy"), true, "who waited keeps the SKIP choice (ready at once)");
  assert.strictEqual(w.readyCount(), 1);
  ok("next round: who played must SKIP (or draw) again; who waited keeps the choice");

  // ENDLESS: a waiting player who skips jumps in at once
  assert.strictEqual(w.setEndless(true), true);
  assert.strictEqual(w.start({ countdown: false }), true);
  t = tick();
  assert.deepStrictEqual(t.players.filter((p) => !(p.flags && p.flags.bot)).map((p) => p.name), ["cy"]);
  w.useDefault("ana", "ship"); w.useDefault("ana", "controller");
  w.step(0.1);
  t = tick();
  assert.deepStrictEqual(t.players.filter((p) => !(p.flags && p.flags.bot)).map((p) => p.name).sort(), ["ana", "cy"]);
  ok("ENDLESS: a waiting player who skips enters at once");
}

// ---------------------------------------------------------------- part 2: server.js (POST /default, /start, /events)
const PORT = Number(process.env.SKIP_PORT) || 8640;
const BASE = `http://localhost:${PORT}`;
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(BASE + url, { method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json, text }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
// the first tick from /events that passes `want`, or null after ms
function nextTick(want, ms = 4000) {
  return new Promise((resolve) => {
    let buf = "", done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { req.destroy(); } catch {} resolve(v); };
    const timer = setTimeout(() => finish(null), ms);
    const req = http.get(`${BASE}/events`, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            let m; try { m = JSON.parse(line.slice(6)); } catch { continue; }
            if (m && m.type === "tick" && want(m)) return finish(m);
          }
        }
      });
    });
    req.on("error", () => finish(null));
  });
}

async function serverPart() {
  const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", KEEPALIVE: "0", PERF_LOG: path.join(os.tmpdir(), `skipready-perf-${process.pid}.log`) };
  delete env.OPENAI_API_KEY;
  const server = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  try {
    for (let i = 0; i < 100; i++) {
      if (/Space Party on http/.test(out)) break;
      if (server.exitCode !== null) throw new Error(`server exited:\n${out}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(/Space Party on http/.test(out), `server did not start:\n${out}`);

    const dev = (n) => `skiptest-device-${n}`;
    assert.strictEqual((await request("POST", "/join", { player: "ana", device: dev(1) })).status, 200);
    assert.strictEqual((await request("POST", "/join", { player: "bob", device: dev(2) })).status, 200);
    let r = await request("POST", "/start", { countdown: false });
    assert.strictEqual(r.status, 409, "START before anybody is ready");
    assert.strictEqual(r.json.error, "nobody is ready");
    ok("server: START is refused while nobody is ready (the bug's starting point)");

    // the phone's SKIP on step 1 (controller.html tellDefault)
    r = await request("POST", "/default", { player: "ana", device: dev(1), token: dev(1), kinds: ["ship", "controller"] });
    assert.strictEqual(r.status, 200, r.text);
    assert.deepStrictEqual([r.json.ok, r.json.ready], [true, true]);
    let t = await nextTick((m) => m.phase === "lobby" && m.players.some((p) => p.name === "ana"));
    assert.ok(t, "a lobby tick");
    assert.ok(t.players.find((p) => p.name === "ana").flags.ready, "ana READY on the TV hangar");
    assert.ok(!t.players.find((p) => p.name === "bob").flags.ready, "bob still drawing");
    ok("server: POST /default (SKIP) makes the player READY (tick flags.ready)");

    // refusals: wrong phone, bad kind, no name
    r = await request("POST", "/default", { player: "bob", device: dev(9), kinds: ["controller"] });
    assert.strictEqual(r.status, 403, "a name bound to another phone");
    r = await request("POST", "/default", { player: "bob", device: dev(2), kinds: ["explorer"] });
    assert.strictEqual(r.status, 400);
    r = await request("POST", "/default", { kinds: ["ship"] });
    assert.strictEqual(r.status, 400);
    // a phone that outlived a server restart: SKIP joins it first (as /generate does)
    r = await request("POST", "/default", { player: "dee", device: dev(4), kind: "controller" });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.ready, false, "default buttons alone: no ship yet");
    ok("server: /default refuses another phone's name, other kinds and no name; joins a forgotten name");

    // START: ana is in the round, bob waits
    r = await request("POST", "/start", { countdown: false });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.ready, 1);
    t = await nextTick((m) => m.phase === "playing");
    assert.ok(t, "a playing tick");
    assert.deepStrictEqual(t.players.map((p) => p.name), ["ana"], "the skipper plays");
    assert.deepStrictEqual((t.waiting || []).map((x) => x.name).sort(), ["bob", "dee"]);
    ok("server: START lets the skipping player into the round (tick.players), the others wait");
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => { if (server.exitCode !== null) return r(); const k = setTimeout(() => { try { server.kill("SIGKILL"); } catch {} r(); }, 3000); server.on("exit", () => { clearTimeout(k); r(); }); });
  }
}

(async () => {
  worldPart();
  if (!process.argv.includes("--world-only")) await serverPart();
  console.log(`\n${results.length} tests passed`);
})().catch((err) => { console.error(err); process.exit(1); });
