// v1.9 PRACTICE (owner, 10 Oct 14:08: "a lobby for people waiting ... they can go to planet and generate etc."): a live
// server (ASTRA_MOCK=1, no key, its own port, hall/ and perf.log in a temp dir) with the test hook (hook.js, IPC) that only
// moves the practicing ship next to the boss / the planet. A READY player practices (their phone's own stream switches to
// the practice world by name), shoots the boss, lands, draws an explorer (real /generate, mock reader), then the host's
// START pulls them back: their stream gets the lobby (their ship) and the 3-2-1, and they play the round with their lobby
// ship and no explorer. Also: not-ready players cannot practice, the TV hears `practicing`, BACK TO LOBBY works, the
// lobby auto-start's seconds reach the practice banner (practiceStartIn) and the auto-start pulls everybody back.
//   node dev/v19-practice/practice-test.js            (PRACTICE_PORT=8660 by default)
const assert = require("assert");
const { fork } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PRACTICE_PORT) || 8660;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "practice-test-"));
let n = 0;
const ok = (t) => { n++; console.log(`ok  ${t}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A 160 px PNG: white with a chunky black ship (body, wings, nose).
function png(w = 160, h = 160) {
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  const ink = (x, y) => { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = raw[o + 1] = raw[o + 2] = 20; };
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const body = Math.abs(x - 80) < 14 && y > 30 && y < 130, wings = y > 80 && y < 105 && Math.abs(x - 80) < 60 - (y - 80), nose = y >= 15 && y <= 30 && Math.abs(x - 80) < (y - 15);
      if (body || wings || nose) ink(x, y);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => { let json = null; try { json = text ? JSON.parse(text) : null; } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject);
    req.end(data);
  });
}
// An event stream: every message kept in order; waitFor(pred) resolves with the first match after `from`.
function stream(query) {
  const s = { msgs: [], req: null };
  s.req = http.get({ host: "127.0.0.1", port: PORT, path: `/events?${query}` }, (res) => {
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split("\n")) if (line.startsWith("data: ")) { try { s.msgs.push(JSON.parse(line.slice(6))); } catch {} }
      }
    });
  });
  s.req.on("error", () => {});
  s.mark = () => s.msgs.length;
  s.waitFor = async (pred, ms = 8000, from = 0) => {
    const t0 = Date.now();
    for (;;) {
      for (let i = from; i < s.msgs.length; i++) if (pred(s.msgs[i])) return s.msgs[i];
      if (Date.now() - t0 > ms) throw new Error(`stream ${query}: no matching message in ${ms} ms`);
      await sleep(30);
    }
  };
  s.last = (type) => { for (let i = s.msgs.length - 1; i >= 0; i--) if (s.msgs[i].type === type) return s.msgs[i]; return null; };
  s.close = () => { try { s.req.destroy(); } catch {} };
  return s;
}

let server = null, reqId = 0;
const pending = new Map();
function hook(cmd, player) {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    pending.set(id, resolve);
    server.send({ id, cmd, player });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`hook ${cmd}: no answer`)); } }, 3000);
  });
}

async function main() {
  const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", OPENAI_API_KEY: "", KEEPALIVE: "0", HALL_DIR: path.join(TMP, "hall"), PERF_LOG: path.join(TMP, "perf.log") };
  // --start-after 0 at first (nothing starts by itself); the test turns the 15 s auto-start on later (POST /mode)
  server = fork(path.join(ROOT, "server.js"), ["--start-after", "0"], { cwd: ROOT, env, execArgv: ["-r", path.join(__dirname, "hook.js")], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let log = "";
  server.stdout.on("data", (c) => (log += c)); server.stderr.on("data", (c) => (log += c));
  server.on("message", (m) => { const r = pending.get(m && m.id); if (r) { pending.delete(m.id); r(m); } });
  for (let i = 0; i < 100 && !/Space Party on/.test(log); i++) await sleep(100);
  assert.ok(/Space Party on/.test(log), `server did not start:\n${log}`);

  const tv = stream("screen=big");
  // ---- join; not ready → no practice ----
  for (const name of ["ana", "bob"]) assert.strictEqual((await post("/join", { player: name, device: `dev-${name}-0001` })).status, 200);
  const phone = stream("player=ana");
  await phone.waitFor((m) => m.type === "tick");
  let r = await post("/practice", { player: "ana", device: "dev-ana-0001", on: true });
  assert.deepStrictEqual([r.status, r.json.error], [409, "not ready"]);
  ok("a player still drawing cannot practice (409 not ready)");

  // ---- ana READY: a drawn ship (mock reader: the dev kit, shoot included) + the default buttons ----
  r = await post("/generate", { player: "ana", device: "dev-ana-0001", kind: "ship", image: png() });
  assert.ok(r.json && r.json.ok && r.json.entity && r.json.entity.type === "ship", JSON.stringify(r.json));
  const shipImage = r.json.entity.image;
  assert.ok(/^\/drawings\/ana-ship\.png\?v=/.test(shipImage), shipImage);
  r = await post("/default", { player: "ana", device: "dev-ana-0001", kinds: ["controller"] });
  assert.ok(r.json.ok && r.json.ready, JSON.stringify(r.json));
  const left0 = (await hook("state", "ana")).main.left;
  ok("ana is READY (drawn ship + default buttons)");

  // ---- PLAY WHILE YOU WAIT ----
  let mark = phone.mark();
  r = await post("/practice", { player: "ana", device: "dev-ana-0001", on: true });
  assert.deepStrictEqual([r.status, r.json.ok, r.json.practicing], [200, true, true], JSON.stringify(r.json));
  const pw = await phone.waitFor((m) => m.type === "world" && m.practice === true, 3000, mark);
  const mainRound = (await hook("state", "ana")).main.round;
  assert.strictEqual(pw.round, mainRound, "the practice world carries the real round's number (the phone keeps its drawings)");
  assert.strictEqual(pw.phase, "playing"); assert.strictEqual(pw.mode, "endless");
  assert.strictEqual(pw.entities.ana.type, "ship");
  assert.strictEqual(pw.entities.ana.image, shipImage, "the lobby ship's drawing rides along");
  assert.deepStrictEqual(pw.entities.ana.unlocked.map((u) => u.verb).sort(), (await hook("state", "ana")).practice && pw.entities.ana.unlocked.map((u) => u.verb).sort());
  const pt = await phone.waitFor((m) => m.type === "tick" && m.practice === true && m.players.some((p) => p.name === "ana"), 3000, mark);
  assert.strictEqual(pt.round, mainRound); assert.strictEqual(pt.phase, "playing");
  assert.ok(!pt.players.some((p) => p.name === "bob"), "only practicing players are in the practice world");
  const tvTick = await tv.waitFor((m) => m.type === "tick" && Array.isArray(m.practicing) && m.practicing.includes("ana"), 3000, tv.mark());
  assert.strictEqual(tvTick.phase, "lobby");
  assert.ok(tvTick.players.some((p) => p.name === "ana" && p.flags.ready), "ana stays READY in the lobby");
  assert.ok(!tv.msgs.slice(-30).some((m) => m.practice), "the TV never gets practice messages");
  ok("practice on: ana's own stream switches to the practice world (real round number, endless, her drawn ship); the TV hears practicing: [ana]");

  // ---- fly, shoot the boss, land (the hook only moves the ship) ----
  await hook("near-boss", "ana");
  for (let i = 0; i < 30 && !(await hook("state", "ana")).practice.bossDead; i++) {
    await post("/input", { type: "input", player: "ana", device: "dev-ana-0001", action: "shoot", down: true });
    await sleep(150);
  }
  await post("/input", { type: "input", player: "ana", device: "dev-ana-0001", action: "shoot", down: false });
  let st = await hook("state", "ana");
  assert.ok(st.practice.bossDead, "ana's shots (POST /input) took the practice boss down");
  assert.ok(st.practice.score >= 1000, `boss last hit scored in practice (${st.practice.score})`);
  assert.strictEqual(st.main.phase, "lobby");
  await hook("near-planet", "ana");
  await phone.waitFor((m) => m.type === "tick" && m.practice && m.players.some((p) => p.name === "ana" && p.mode === "planet" && !p.flags.landing), 8000, phone.mark());
  ok("ana's inputs drive her practice ship: the boss falls to her shots, she lands on the planet");

  // ---- draw an explorer (real /generate, mock reader) ----
  mark = phone.mark();
  r = await post("/generate", { player: "ana", device: "dev-ana-0001", kind: "explorer", image: png() });
  assert.ok(r.json && r.json.ok && r.json.entity, JSON.stringify(r.json));
  assert.ok(/\/drawings\/ana-explorer\.png\?v=[0-9a-f]+&practice=1$/.test(r.json.entity.image), r.json.entity.image);
  const ent = await phone.waitFor((m) => m.type === "entity" && m.player === "ana" && m.entity.type !== "ship", 3000, mark);
  assert.strictEqual(ent.entity.image, r.json.entity.image);
  st = await hook("state", "ana");
  assert.strictEqual(st.practice.mode, "planet"); assert.notStrictEqual(st.practice.type, "ship");
  assert.strictEqual(st.main.planet, null, "the lobby player has no explorer drawing");
  assert.deepStrictEqual(st.main.left, left0, "the real drawing budget is untouched");
  const img = await new Promise((resolve) => http.get({ host: "127.0.0.1", port: PORT, path: r.json.entity.image }, (res) => { res.resume(); resolve(res.statusCode); }));
  assert.strictEqual(img, 200, "the practice drawing is served");
  r = await post("/generate", { player: "ana", device: "dev-ana-0001", kind: "ship", image: png() });
  assert.deepStrictEqual([r.json.ok, r.json.error], [false, "practice"], "a ship redraw waits for the lobby");
  ok("ana draws an explorer while practicing: her practice explorer (served with &practice=1), the lobby player and budget untouched");

  // ---- BACK TO LOBBY, then in again: a fresh practice ship (the practice explorer is forgotten) ----
  mark = phone.mark();
  r = await post("/practice", { player: "ana", device: "dev-ana-0001", on: false });
  assert.deepStrictEqual([r.status, r.json.practicing], [200, false]);
  const lobby = await phone.waitFor((m) => m.type === "world" && !m.practice, 3000, mark);
  assert.deepStrictEqual([lobby.phase, lobby.entities.ana.type, lobby.entities.ana.image], ["lobby", "ship", shipImage]);
  await phone.waitFor((m) => m.type === "tick" && !m.practice && m.phase === "lobby", 3000, mark);
  await tv.waitFor((m) => m.type === "tick" && m.phase === "lobby" && !m.practicing, 3000, tv.mark());
  const gone = await new Promise((resolve) => http.get({ host: "127.0.0.1", port: PORT, path: ent.entity.image }, (res) => { res.resume(); resolve(res.statusCode); }));
  assert.strictEqual(gone, 404, "the practice explorer drawing is forgotten");
  ok("BACK TO LOBBY: ana's stream is the lobby again (her ship), the TV's practicing is gone, so is the practice drawing");

  // ---- the lobby auto-start (15 s) counts on the practice banner, then pulls ana back for the 3-2-1 ----
  assert.strictEqual((await post("/mode", { startAfter: 15 })).status, 200);
  await post("/default", { player: "bob", device: "dev-bob-0001", kinds: ["ship", "controller"] });
  mark = phone.mark();
  r = await post("/practice", { player: "ana", device: "dev-ana-0001", on: true });
  assert.strictEqual(r.json.practicing, true);
  const pw2 = await phone.waitFor((m) => m.type === "world" && m.practice === true, 3000, mark);
  assert.strictEqual(pw2.entities.ana.type, "ship", "in again: a fresh practice ship");
  const t2 = await phone.waitFor((m) => m.type === "tick" && m.practice && typeof m.practiceStartIn === "number", 3000, mark);
  assert.ok(t2.practiceStartIn >= 1 && t2.practiceStartIn <= 15, `practiceStartIn ${t2.practiceStartIn}`);
  ok(`practice again with the auto-start on: practice ticks carry practiceStartIn (${t2.practiceStartIn})`);
  mark = phone.mark();
  const back = await phone.waitFor((m) => m.type === "world" && !m.practice, 17000, mark);
  assert.strictEqual(back.round, mainRound);
  assert.strictEqual(back.entities.ana.type, "ship", "back in the lobby with her ship");
  assert.strictEqual(back.entities.ana.image, shipImage);
  const cd = await phone.waitFor((m) => m.type === "tick" && !m.practice && m.phase === "countdown", 3000, mark);
  assert.ok(cd.players.some((p) => p.name === "ana" && p.mode === "space"), "ana is in the round, in space");
  assert.ok(!phone.msgs.slice(phone.msgs.indexOf(back)).some((m) => m.practice), "no practice message after the pull-out");
  st = await hook("state", "ana");
  assert.deepStrictEqual([st.main.inRound, st.main.mode, st.main.type, st.main.planet, st.practice], [true, "space", "ship", null, null]);
  assert.strictEqual(st.main.source, "devkit", "the round's ship is her lobby drawing's entity");
  r = await post("/practice", { player: "ana", device: "dev-ana-0001", on: true });
  assert.deepStrictEqual([r.status, r.json.error], [409, "not in the lobby"]);
  await phone.waitFor((m) => m.type === "tick" && m.phase === "playing" && m.players.some((p) => p.name === "ana"), 6000, phone.mark());
  ok("the AUTO-START: ana is pulled back before the 3-2-1 (lobby world with her ship, then the countdown), plays the round with her lobby ship, no explorer; practice is lobby-only");

  // ---- the input of the round reaches the real world again ----
  await post("/input", { type: "axis", player: "ana", device: "dev-ana-0001", axis: "steer", x: 1, y: 0 });
  const yaw0 = (await phone.waitFor((m) => m.type === "tick" && m.phase === "playing", 3000, phone.mark())).players.find((p) => p.name === "ana").yaw;
  await sleep(600);
  const yaw1 = phone.last("tick").players.find((p) => p.name === "ana").yaw;
  assert.notStrictEqual(yaw0, yaw1, "ana steers her round ship");
  ok("after the pull-out ana's /input drives her ship in the real round");

  tv.close(); phone.close();
  console.log(`\n${n} checks passed`);
}

main().then(() => { server.kill(); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(0); }, (err) => {
  console.error(err);
  if (server) server.kill();
  process.exit(1);
});
