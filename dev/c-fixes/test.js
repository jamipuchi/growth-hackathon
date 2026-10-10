// v1.9.2 release check C fixes (dev/v191-release/C.md P1, P2). Node only.
//   node dev/c-fixes/test.js            (CFIX_PORT=8800 by default; ASTRA_MOCK=1, no key, hall/ and perf.log in a temp dir)
// P1: a live server with the test hook (hook.js: the mock reader adds a jetpack to every explorer; IPC puts a player on the
//     planet). An explorer committed on the planet: the /generate answer's entity has FLY in verbs and unlocked and the card
//     says fly (as the world's entity); the drawing's image stays; the phone's prompt rule (controller.html explorerNeedsPrompt:
//     an unlocked verb with no button) asks for a FLY button on the default pad. An explorer drawn in space keeps its own answer
//     (never the ship). The hall archive keeps the normalized skills.
// P2: controller.html's lobbySub / syncLobbySub / syncStartIn run in a vm with stub elements: while the auto-start counts down
//     the READY subtitle says "Starting automatically · or the host can start now.", without a countdown the old text.
const assert = require("assert");
const { fork } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.CFIX_PORT) || 8800;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cfix-test-"));
let n = 0;
const ok = (t) => { n++; console.log(`ok  ${t}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function png(w = 120, h = 120) {
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) if (Math.abs(x - 60) < 12 && y > 20 && y < 100) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = raw[o + 1] = raw[o + 2] = 20; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`http://localhost:${PORT}${url}`, { method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json, text }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const post = (url, body) => request("POST", url, body);

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

// controller.html's rule for "draw a button for your new explorer" (explorerNeedsPrompt + layoutHas on the default pad)
const DEFAULT_ACTIONS = () => {
  const src = fs.readFileSync(path.join(ROOT, "world.js"), "utf8");
  const m = /const DEFAULT_LAYOUT = \{[\s\S]*?\n\};/.exec(src);
  return m ? [...m[0].matchAll(/action: "([a-z]+)"/g)].map((x) => x[1]) : [];
};

async function p1() {
  const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", KEEPALIVE: "0", HALL_DIR: path.join(TMP, "hall"), PERF_LOG: path.join(TMP, "perf.log") };
  delete env.KICK_AFTER_MS;
  server = fork(path.join(ROOT, "server.js"), ["--start-after", "0", "--kick-after", "0"], { cwd: ROOT, env, execArgv: ["-r", path.join(__dirname, "hook.js")], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let log = "";
  server.stdout.on("data", (c) => (log += c)); server.stderr.on("data", (c) => (log += c));
  server.on("message", (m) => { const r = pending.get(m && m.id); if (r) { pending.delete(m.id); r(m); } });
  for (let i = 0; i < 100 && !/Space Party on/.test(log); i++) await sleep(100);
  assert.ok(/Space Party on/.test(log), `server did not start:\n${log}`);

  for (const name of ["ana", "bob"]) assert.strictEqual((await post("/join", { player: name, device: `dev-${name}-0001` })).status, 200);
  for (const name of ["ana", "bob"]) {
    const r = await post("/generate", { player: name, device: `dev-${name}-0001`, kind: "ship", image: png() });
    assert.ok(r.json && r.json.ok && r.json.entity.type === "ship", JSON.stringify(r.json));
  }

  // ---- ana on the planet draws an explorer with a jetpack ----
  assert.ok((await hook("planet", "ana")).ok);
  let r = await post("/generate", { player: "ana", device: "dev-ana-0001", kind: "explorer", image: png() });
  assert.ok(r.json && r.json.ok && r.json.entity, JSON.stringify(r.json));
  const e = r.json.entity;
  const st = await hook("state", "ana");
  assert.strictEqual(st.mode, "planet");
  assert.ok(st.entity.verbs.includes("fly"), "the world's entity flies (world.setEntity)");
  assert.ok(Array.isArray(e.verbs) && e.verbs.includes("fly"), `answer verbs: ${JSON.stringify(e.verbs)}`);
  const fly = (e.unlocked || []).find((u) => u.verb === "fly");
  assert.ok(fly && /jetpack/.test(fly.part), `answer unlocked: ${JSON.stringify(e.unlocked)}`);
  assert.deepStrictEqual(e.verbs, st.entity.verbs);
  assert.deepStrictEqual(e.unlocked, st.entity.unlocked);
  assert.strictEqual(e.card, st.entity.card);
  assert.ok(/fly/i.test(e.card), `answer card: ${e.card}`);
  assert.ok(/^\/drawings\/ana-explorer\.png\?v=[0-9a-f]+/.test(e.image), `the drawing's image stays: ${e.image}`);
  assert.ok(e.parts.some((x) => x.name === "jetpack"), "the drawing's own parts stay");
  ok(`P1 explorer with a jetpack committed on the planet: the /generate answer has fly (verbs, unlocked "${fly.part}", card "${e.card}"), image kept`);

  const actions = DEFAULT_ACTIONS();
  assert.ok(actions.length && !actions.includes("fly"), `default pad: ${actions}`);
  const needsPrompt = (e.unlocked || []).some((u) => !actions.includes(u.verb));
  assert.ok(needsPrompt && (e.unlocked || []).filter((u) => !actions.includes(u.verb)).some((u) => u.verb === "fly"));
  ok("P1 the phone's rule (an unlocked verb with no button) now asks for a FLY button on the default pad");

  // ---- bob in space draws an explorer: his answer stays the drawing's own (never the ship) ----
  r = await post("/generate", { player: "bob", device: "dev-bob-0001", kind: "explorer", image: png() });
  assert.ok(r.json && r.json.ok && r.json.entity, JSON.stringify(r.json));
  const sb = await hook("state", "bob");
  assert.strictEqual(sb.mode, "space");
  assert.notStrictEqual(r.json.entity.type, "ship");
  assert.ok(!r.json.entity.unlocked.some((u) => ["boost", "emp", "mine", "land"].includes(u.verb)), "no ship skills in an off-world explorer answer");
  assert.ok(sb.drawn.planet.unlocked.some((u) => u.verb === "fly"), "bob's explorer flies once he lands (world.setEntity)");
  ok("P1 an explorer drawn in space keeps its own answer (not the ship); the world keeps its fly for landing");

  // ---- the hall archive keeps the normalized skills ----
  let hall = null;
  for (let i = 0; i < 20 && !hall; i++) { const h = await request("GET", "/hall"); if (h.status === 200 && /ana/.test(h.text) && /explorer/.test(h.text)) hall = h; else await sleep(100); }
  if (hall) {
    const items = JSON.stringify(hall.json);
    assert.ok(/"verb":"fly"/.test(items), "the hall archive has the fly skill");
    ok("P1 the hall archive keeps the normalized skills (fly)");
  } else console.log("--  hall archive not listed (skipped)");

  assert.ok(!/TypeError|ReferenceError|step failed/i.test(log), `server log:\n${log}`);
  ok("P1 server log clean");
}

function p2() {
  const html = fs.readFileSync(path.join(ROOT, "controller.html"), "utf8");
  const start = html.indexOf("const lobbySub");
  const fn = html.indexOf("function syncStartIn", start);
  const end = html.indexOf("\n}\n", fn) + 3;
  assert.ok(start > 0 && fn > start && end > fn, "lobbySub / syncStartIn found");
  const subAuto = /subAuto: "([^"]+)"/.exec(html)[1];
  const sub = /title: "YOU'RE IN!", sub: "([^"]+)"/.exec(html)[1];
  assert.strictEqual(subAuto, "Starting automatically · or the host can start now.");
  assert.ok(/if \(!on\) \$\("bannerSub"\)\.textContent = lobbySub\(\);/.test(html), "syncWaiting's reset uses lobbySub");
  const el = (extra = {}) => ({ textContent: "", classList: { add() {}, remove() {}, toggle() {} }, offsetHeight: 0, ...extra });
  const els = { bannerSub: el({ textContent: sub }), startStrip: el({ children: [el(), el()] }) };
  const ctx = {
    $: (id) => els[id], S: { waiting: false, screen: "play" }, document: { body: { classList: { add() {}, remove() {} }, style: { setProperty() {} } } },
    COPY: { wait: { sub, subAuto }, startIn: { ready: "STARTING IN {n}", readySub: "GET READY!", draw: "GAME STARTS IN {n}", drawSub: "x" } },
    tpl: (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]),
  };
  vm.createContext(ctx);
  vm.runInContext(`let startShown = "";\n${html.slice(start, end)}\nglobalThis.api = { syncStartIn };`, ctx);
  const me = { flags: { ready: true } };
  ctx.api.syncStartIn({ phase: "lobby", startIn: 29 }, me);
  assert.strictEqual(els.startStrip.children[0].textContent, "STARTING IN 29");
  assert.strictEqual(els.bannerSub.textContent, subAuto);
  ctx.api.syncStartIn({ phase: "lobby", startIn: 12.2 }, me);
  assert.strictEqual(els.bannerSub.textContent, subAuto);
  ok(`P2 READY while the auto-start counts down: "${subAuto}"`);
  ctx.api.syncStartIn({ phase: "lobby" }, me);
  assert.strictEqual(els.bannerSub.textContent, sub);
  ctx.api.syncStartIn({ phase: "lobby", startIn: Infinity }, me);
  assert.strictEqual(els.bannerSub.textContent, sub);
  ok(`P2 no countdown: "${sub}"`);
  ctx.S.waiting = true; els.bannerSub.textContent = "YOU'RE IN THE NEXT ROUND";
  ctx.api.syncStartIn({ phase: "lobby", startIn: 20 }, me);
  assert.strictEqual(els.bannerSub.textContent, "YOU'RE IN THE NEXT ROUND");
  ok("P2 the ROUND IN PROGRESS banner keeps its own line");
}

(async () => {
  try {
    p2();
    await p1();
    console.log(`\n${n}/${n} passed`);
  } catch (err) {
    console.error(`FAIL ${err && err.stack || err}`);
    process.exitCode = 1;
  } finally {
    if (server) { try { server.kill(); } catch {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  }
})();
