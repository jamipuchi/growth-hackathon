// kick-idle (owner, 10 Oct 14:58: "make sure when user is unresponsive (device not reachable or whatever) for 30 seconds they get
// kicked out automatically"). Node only, a live server (ASTRA_MOCK=1, no real API calls) with --kick-after 3 (the 30 s rule in 3 s):
//   node dev/kick-idle/kick-test.js            (KICK_PORT=8661 for another port; 8660 by default)
// 1. a phone joins and opens its stream; the stream closes: after kick-after it is gone from the next tick (lobby, practice and a
//    round being played: the round goes on), the TV hears "ana left" (quiet), and the name can be taken again
// 2. a phone with an open stream and no input for 5 s stays; a phone with no stream that keeps sending requests stays; bots stay
// 3. a kicked phone that comes back: /input, /generate, /default, /practice answer 409 "join first", kicked: true; its stream hears
//    { type: "kicked" }; it is never re-adopted by its open stream; POST /join clears the mark
const assert = require("assert");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const root = path.join(__dirname, "..", "..");

const PORT = Number(process.env.KICK_PORT) || 8660;
const BASE = `http://localhost:${PORT}`;
const KICK_S = 3;
const results = [];
const ok = (name) => { results.push(name); console.log("ok  " + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (n) => `kicktest-device-${n}`;

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
// An event stream: every message kept; waitFor(pred, ms) → the first message (seen or to come) that passes, or null.
function stream(query) {
  const msgs = [], waiters = [];
  let buf = "", req = null, comments = 0;
  const s = {
    msgs, get comments() { return comments; },
    lastTick: () => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].type === "tick") return msgs[i]; return null; },
    waitFor(pred, ms = 4000, { fresh = false } = {}) {
      if (!fresh) { const hit = msgs.find(pred); if (hit) return Promise.resolve(hit); }
      return new Promise((resolve) => {
        const w = { pred, resolve };
        w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); resolve(null); }, ms);
        waiters.push(w);
      });
    },
    close() { try { req.destroy(); } catch {} },
  };
  s.ready = new Promise((resolve, reject) => {
    req = http.get(`${BASE}/events${query}`, (res) => {
      res.setEncoding("utf8");
      resolve(s);
      res.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of block.split("\n")) {
            if (line.startsWith(":")) { comments++; continue; }
            if (!line.startsWith("data: ")) continue;
            let m; try { m = JSON.parse(line.slice(6)); } catch { continue; }
            msgs.push(m);
            if (msgs.length > 4000) msgs.splice(0, 2000);
            for (const w of [...waiters]) if (w.pred(m)) { clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
          }
        }
      });
    });
    req.on("error", (e) => reject(e));
  });
  return s;
}
const names = (t) => (t ? t.players.map((p) => p.name) : []);

async function main() {
  const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", KEEPALIVE: "0", PERF_LOG: path.join(os.tmpdir(), `kickidle-perf-${process.pid}.log`) };
  delete env.OPENAI_API_KEY; delete env.ANTHROPIC_API_KEY; delete env.KICK_AFTER_MS;
  const server = spawn(process.execPath, ["server.js", "--kick-after", String(KICK_S), "--bots", "1", "--start-after", "0"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  console.log(`server pid ${server.pid} on port ${PORT}`);
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  const tv = [];
  try {
    for (let i = 0; i < 100; i++) {
      if (/Space Party on http/.test(out)) break;
      if (server.exitCode !== null) throw new Error(`server exited:\n${out}`);
      await sleep(100);
    }
    assert.ok(/Space Party on http/.test(out), `server did not start:\n${out}`);
    assert.ok(/kick-idle: +a phone unreachable for 3 s leaves/.test(out), "the startup line names the kick-after");
    const big = await stream("?screen=big").ready;
    tv.push(big);

    // ---- 1 + 2 in the lobby: ana's stream closes; bob idles with his stream open; cy has no stream but keeps posting; eve
    // practices and her stream closes; bot1 is a bot
    for (const [n, d] of [["ana", 1], ["bob", 2], ["cy", 3], ["eve", 5]]) assert.strictEqual((await request("POST", "/join", { player: n, device: dev(d) })).status, 200);
    let r = await request("POST", "/default", { player: "eve", device: dev(5), kinds: ["ship", "controller"] });
    assert.strictEqual(r.json && r.json.ready, true, r.text);
    r = await request("POST", "/practice", { player: "eve", device: dev(5), on: true });
    assert.strictEqual(r.json && r.json.practicing, true, r.text);
    const ana = await stream("?player=ana").ready;
    const bob = await stream("?player=bob").ready;
    const eve = await stream("?player=eve").ready;
    const all = await big.waitFor((m) => m.type === "tick" && ["ana", "bob", "cy", "eve", "bot1"].every((n) => names(m).includes(n)) && (m.practicing || []).includes("eve"), 3000, { fresh: true });
    assert.ok(all, "everybody in the lobby, eve practicing");
    await sleep(1200); // the sweep has seen the streams open
    const closedAt = Date.now();
    ana.close(); eve.close();
    const cyPosts = setInterval(() => { request("POST", "/input", { type: "input", player: "cy", action: "fire", down: false, device: dev(3) }).catch(() => {}); }, 1000);
    const gone = await big.waitFor((m) => m.type === "tick" && !names(m).includes("ana") && !names(m).includes("eve"), (KICK_S + 4) * 1000, { fresh: true });
    const after = Date.now() - closedAt;
    assert.ok(gone, `ana and eve are gone from the ticks after ${KICK_S} s:\n${out.slice(-1500)}`);
    assert.ok(after >= KICK_S * 1000 - 300, `not before kick-after (${after} ms)`);
    assert.ok(after <= KICK_S * 1000 + 2500, `soon after kick-after (${after} ms)`);
    assert.ok(!(gone.practicing || []).includes("eve"), "eve is out of the practice too");
    ok(`a phone whose stream closed is gone from the next tick ${(after / 1000).toFixed(1)} s later (kick-after ${KICK_S} s), practice included`);
    const left = await big.waitFor((m) => m.type === "announce" && m.text === "ana left", 1000);
    assert.ok(left && left.quiet === true && !left.big, "the TV hears a quiet \"ana left\"");
    assert.ok(await big.waitFor((m) => m.type === "announce" && m.text === "eve left", 1000), "and \"eve left\"");
    assert.ok(/kick-idle: ana left/.test(out), "the server log says so");
    ok("the TV hears a quiet \"ana left\" (announce, quiet: true), the log says so");

    // bob (open stream, no input) and cy (no stream, a request every second) and bot1 stay; wait 5 s in all
    await sleep(Math.max(0, 5000 - (Date.now() - closedAt)));
    clearInterval(cyPosts);
    const t5 = await big.waitFor((m) => m.type === "tick", 1000, { fresh: true });
    assert.ok(names(t5).includes("bob"), "bob (stream open, idle 5 s) stays");
    assert.ok(names(t5).includes("cy"), "cy (no stream, a request every second) stays");
    assert.ok(names(t5).includes("bot1"), "bots are never kicked");
    assert.ok(!bob.msgs.some((m) => m.type === "kicked"), "bob's stream never hears kicked");
    ok("a phone with an open stream and no input for 5 s stays (kick-after 3); so do a phone that keeps sending requests, and bots");

    // ---- 3: ana comes back
    r = await request("POST", "/input", { type: "input", player: "ana", action: "fire", down: true, device: dev(1) });
    assert.deepStrictEqual([r.status, r.json && r.json.error, r.json && r.json.kicked], [409, "join first", true], r.text);
    assert.ok(/disconnected/.test(r.json.message));
    const ana2 = await stream("?player=ana").ready;
    const kickedMsg = await ana2.waitFor((m) => m.type === "kicked", 2000);
    assert.ok(kickedMsg && kickedMsg.player === "ana" && /join again/.test(kickedMsg.message), "her stream hears { type: kicked }");
    r = await request("POST", "/input", { type: "input", player: "ana", action: "fire", down: true, device: dev(1) });
    assert.strictEqual(r.status, 409, "her open stream does not re-adopt her");
    assert.ok(!names(await big.waitFor((m) => m.type === "tick", 1000, { fresh: true })).includes("ana"), "still not in the tick");
    for (const [p, body] of [["/default", { kinds: ["controller"] }], ["/generate", { kind: "ship", image: "data:image/png;base64,AAAA" }], ["/practice", { on: true }]]) {
      r = await request("POST", p, { player: "ana", device: dev(1), ...body });
      assert.ok(r.json && r.json.error === "join first" && r.json.kicked === true, `${p}: ${r.status} ${r.text}`);
    }
    ok("a kicked phone that comes back: 409 join first + kicked from /input, /generate, /default, /practice; { type: kicked } on its stream; never re-adopted");
    ana2.close();

    // the name and the seat are free: another phone takes "ana" (no rename), and plays
    r = await request("POST", "/join", { player: "ana", device: dev(9) });
    assert.deepStrictEqual([r.status, r.json.player, !!r.json.renamed], [200, "ana", false], r.text);
    r = await request("POST", "/input", { type: "input", player: "ana", action: "fire", down: false, device: dev(9) });
    assert.strictEqual(r.status, 204, r.text);
    assert.ok(await big.waitFor((m) => m.type === "tick" && names(m).includes("ana"), 2000, { fresh: true }), "the new ana is in the tick");
    ok("the kicked name can be taken again (another phone, no rename) and plays");
    const ana3 = await stream("?player=ana").ready; // the new ana keeps her stream open from now on

    // ---- in a round: dee plays, her stream closes: her ship disappears, the round goes on
    assert.strictEqual((await request("POST", "/join", { player: "dee", device: dev(4) })).status, 200);
    r = await request("POST", "/default", { player: "dee", device: dev(4), kinds: ["ship", "controller"] });
    assert.strictEqual(r.json && r.json.ready, true);
    const dee = await stream("?player=dee").ready;
    r = await request("POST", "/start", { countdown: false });
    assert.strictEqual(r.status, 200, r.text);
    const playing = await big.waitFor((m) => m.type === "tick" && m.phase === "playing" && names(m).includes("dee"), 3000, { fresh: true });
    assert.ok(playing, "dee plays the round");
    await sleep(1200);
    dee.close();
    const deeGone = await big.waitFor((m) => m.type === "tick" && !names(m).includes("dee"), (KICK_S + 4) * 1000, { fresh: true });
    assert.ok(deeGone, "dee's ship is gone");
    assert.strictEqual(deeGone.phase, "playing", "the round goes on");
    assert.strictEqual(deeGone.round, playing.round, "the same round");
    ok("in a round: the unreachable player's ship disappears, the round goes on");
    ana3.close(); bob.close();
  } finally {
    for (const s of tv) s.close();
    server.kill("SIGTERM");
    await new Promise((r) => { if (server.exitCode !== null) return r(); const k = setTimeout(() => { try { server.kill("SIGKILL"); } catch {} r(); }, 3000); server.on("exit", () => { clearTimeout(k); r(); }); });
  }
}

main().then(() => { console.log(`\n${results.length} checks passed`); process.exit(0); }, (err) => { console.error(err); process.exit(1); });
