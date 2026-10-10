// v1.9.1 hallauto check (owner 14:25: "make sure 1.9.1 shows hall of fame after finishing the seconds"): a live server
// (ASTRA_MOCK=1, no key, port 8650, hall/ and perf.log in a temp dir), the TV (space.html, headless Chromium), two players
// who draw a ship each and play a 1-minute round. Checks: the round's end starts judging on the server by itself; the TV
// opens the HALL OF FAME full screen after the podium ceremony (hall-of-fame.html?embed=1 in a frame) with the drawings
// ranked; Enter closes it without starting a round; an empty session shows the examples (EXAMPLES label); the next
// round's 3-2-1 closes it. Screenshots in this folder.
//   node dev/v191-hallauto/hall-auto-check.cjs            (HALLAUTO_PORT=8650 by default)
const assert = require("assert");
const { fork } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.HALLAUTO_PORT) || 8650;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hallauto-"));
const OUT = __dirname;
let n = 0;
const ok = (t) => { n++; console.log(`ok  ${t}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A 160 px PNG: white with a chunky black ship; `v` moves the wings so every player's drawing differs.
function png(v = 0, w = 160, h = 160) {
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  const ink = (x, y) => { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 20 + v * 40; raw[o + 1] = 20; raw[o + 2] = 20 + v * 60; };
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const body = Math.abs(x - 80) < 14 && y > 30 && y < 130, wings = y > 80 + v * 8 && y < 105 + v * 8 && Math.abs(x - 80) < 60 - (y - 80 - v * 8), nose = y >= 15 && y <= 30 && Math.abs(x - 80) < (y - 15);
      if (body || wings || nose) ink(x, y);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port: PORT, path: pathname, method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => { let json = null; try { json = text ? JSON.parse(text) : null; } catch {} resolve({ status: res.statusCode, json }); });
    });
    r.on("error", reject);
    r.end(data || undefined);
  });
}
const post = (p, b) => req("POST", p, b || {});
const get = (p) => req("GET", p);

async function ready(name, v) {
  const device = `dev-${name}-0001`;
  let r = await post("/generate", { player: name, device, kind: "ship", image: png(v) });
  assert.ok(r.json && r.json.ok, `${name} ship: ${JSON.stringify(r.json)}`);
  r = await post("/default", { player: name, device, kinds: ["controller"] });
  assert.ok(r.json && r.json.ok && r.json.ready, `${name} ready: ${JSON.stringify(r.json)}`);
}

let server = null, browser = null, log = "", hookSeq = 0;
// the test-only hook (hook.js): sets round points so the round ends with a winner (the full podium ceremony)
const hook = (cmd, extra) => new Promise((resolve) => { const id = ++hookSeq; const on = (m) => { if (m && m.id === id) { server.off("message", on); resolve(m); } }; server.on("message", on); server.send({ id, cmd, ...extra }); });
async function main() {
  const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", OPENAI_API_KEY: "", KEEPALIVE: "0", HALL_DIR: path.join(TMP, "hall"), PERF_LOG: path.join(TMP, "perf.log") };
  server = fork(path.join(ROOT, "server.js"), ["--start-after", "0", "--minutes", "1"], { cwd: ROOT, env, execArgv: ["-r", path.join(__dirname, "hook.js")], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  server.stdout.on("data", (c) => (log += c));
  server.stderr.on("data", (c) => (log += c));
  for (let i = 0; i < 50 && !/Space Party on/.test(log); i++) await sleep(200);
  assert.ok(/Space Party on/.test(log), `server did not start:\n${log}`);
  ok(`server up on ${PORT} (ASTRA_MOCK=1, no key)`);

  const exe = process.env.CHROME || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell");
  browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const tv = await ctx.newPage();
  const errors = [];
  tv.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  tv.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_NAME|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await tv.goto(`${BASE}/space.html`, { waitUntil: "load" });
  await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "lobby", null, { timeout: 15000 });
  ok("TV in the lobby");

  for (const name of ["ana", "bob"]) assert.strictEqual((await post("/join", { player: name, device: `dev-${name}-0001` })).status, 200);
  await ready("ana", 0);
  await ready("bob", 1);
  let hall = (await get("/hall")).json;
  assert.strictEqual(hall.entries.length, 2, JSON.stringify(hall.judging));
  assert.strictEqual(hall.judging.unjudged, 2);
  ok("two ships drawn and archived, none judged yet");

  assert.strictEqual((await post("/start", {})).status, 200);
  await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "play", null, { timeout: 15000 });
  const t0 = Date.now();
  ok("round 1 started (1 minute)");

  await sleep(45000);
  const sc = await hook("score", { scores: { ana: 1200, bob: 700 } });
  assert.ok(sc.ok, JSON.stringify(sc));
  ok("round points set (ana 1200, bob 700): the round ends with a winner and the full ceremony");
  await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "results", null, { timeout: 60000, polling: 200 });
  const tRes = Date.now();
  ok(`results after ${((tRes - t0) / 1000).toFixed(1)} s of play (time up)`);
  await sleep(1200);
  assert.ok(/hall: round 1 over \(\w+ → results\): judging 2 of 2/.test(log), `no auto-judge line:\n${log.split("\n").filter((l) => /hall/.test(l)).join("\n")}`);
  hall = (await get("/hall")).json;
  assert.ok(hall.judging.judged + hall.judging.pending === 2, JSON.stringify(hall.judging));
  ok(`the round's end started judging by itself (server: ${hall.judging.judged} judged, ${hall.judging.pending} pending)`);
  assert.strictEqual(await tv.evaluate(() => document.getElementById("hallOver").classList.contains("on")), false);
  ok("no hall during the podium ceremony");
  await tv.screenshot({ path: path.join(OUT, "tv-1-results.png") });

  await tv.waitForFunction(() => document.getElementById("hallOver").classList.contains("on"), null, { timeout: 15000, polling: 100 });
  const tHall = Date.now();
  const after = (tHall - tRes) / 1000;
  assert.ok(after >= 5 && after <= 10.5, `the hall opened ${after.toFixed(1)} s into the results`);
  ok(`the hall opened full screen ${after.toFixed(1)} s after the results began (after the ceremony)`);
  const frame = tv.frames().find((f) => /hall-of-fame\.html\?embed=1/.test(f.url()));
  assert.ok(frame, "no hall frame");
  await frame.waitForFunction(() => document.querySelectorAll("#podium .card, #list .row").length >= 2 && /ranked/i.test(document.getElementById("statusText").textContent), null, { timeout: 15000, polling: 200 });
  await sleep(3500); // the 3D turntables build
  const inner = await frame.evaluate(() => ({
    embed: document.documentElement.classList.contains("embed"),
    mock: document.body.classList.contains("mockmode"),
    examples: getComputedStyle(document.getElementById("examples")).display,
    chrome: ["back", "judgeBtn", "mockBtn"].map((id) => getComputedStyle(document.getElementById(id)).display),
    status: document.getElementById("statusText").textContent,
    cards: [...document.querySelectorAll("#podium .card")].map((c) => ({ name: c.querySelector(".name").textContent, score: c.querySelector(".score").textContent.trim(), img: !!c.querySelector(".pane.draw img"), canvas: !!c.querySelector(".pane.gen canvas") })),
  }));
  console.log("    frame:", JSON.stringify(inner));
  assert.ok(inner.embed && !inner.mock && inner.examples === "none", JSON.stringify(inner));
  assert.deepStrictEqual(inner.chrome, ["none", "none", "none"]);
  assert.strictEqual(inner.cards.length, 2);
  assert.ok(inner.cards.every((c) => /^\d+/.test(c.score) && c.img && c.canvas), JSON.stringify(inner.cards));
  ok(`the live hall in embed mode: ${inner.status}; podium ${inner.cards.map((c) => `${c.name} ${c.score.replace(/\s+/g, " ")}`).join(", ")}`);
  await tv.screenshot({ path: path.join(OUT, "tv-2-hall-live.png") });

  // the lobby underneath; Enter closes the hall and does NOT start a round
  await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "lobby", null, { timeout: 15000 });
  assert.ok(await tv.evaluate(() => document.getElementById("hallOver").classList.contains("on")), "the hall stays over the new lobby");
  ok("the hall stays on while the next lobby begins underneath");
  await tv.keyboard.press("Enter");
  await sleep(600);
  const closed = await tv.evaluate(() => ({ on: document.getElementById("hallOver").classList.contains("on"), frames: document.querySelectorAll("#hallOver iframe").length, view: document.getElementById("hud").dataset.view }));
  assert.deepStrictEqual(closed, { on: false, frames: 0, view: "lobby" });
  await sleep(1500);
  assert.strictEqual(await tv.evaluate(() => document.getElementById("hud").dataset.view), "lobby");
  ok("Enter closes it (frame gone) and does not START: still the lobby");
  await sleep(1500);
  assert.strictEqual(await tv.evaluate(() => document.getElementById("hallOver").classList.contains("on")), false);
  ok("once per round: it does not come back");
  await tv.screenshot({ path: path.join(OUT, "tv-3-lobby-after.png") });

  // an empty session: the examples with the EXAMPLES label
  assert.strictEqual((await post("/hall/reset", { confirm: true })).status, 200);
  await tv.evaluate(() => window.__bigscreen.hall(true));
  await sleep(500);
  const f2 = tv.frames().find((f) => /hall-of-fame\.html\?/.test(f.url()) && f !== frame);
  assert.ok(f2, "no examples frame");
  await f2.waitForFunction(() => document.body.classList.contains("mockmode") && document.querySelectorAll("#podium .card, #list .row").length >= 12, null, { timeout: 15000, polling: 200 });
  await sleep(3500);
  const ex = await f2.evaluate(() => ({ examples: getComputedStyle(document.getElementById("examples")).display, text: document.getElementById("examples").textContent, rows: document.querySelectorAll("#podium .card, #list .row").length }));
  assert.ok(ex.examples === "block" && /examples/i.test(ex.text), JSON.stringify(ex));
  ok(`an empty session shows the examples (${ex.rows} sample drawings, EXAMPLES label)`);
  await tv.screenshot({ path: path.join(OUT, "tv-4-hall-examples.png") });

  // the next round's 3-2-1 closes it
  await ready("ana", 2);
  assert.strictEqual((await post("/start", {})).status, 200);
  await tv.waitForFunction(() => !document.getElementById("hallOver").classList.contains("on"), null, { timeout: 5000, polling: 100 });
  ok("the next round's 3-2-1 closes it");

  assert.deepStrictEqual(errors, [], errors.join("\n"));
  ok("no console errors on the TV");
}

(async () => {
  let failed = false;
  try { await main(); } catch (err) { failed = true; console.error(`FAIL ${err && err.stack}`); }
  finally {
    if (browser) await browser.close().catch(() => {});
    if (server) { server.kill(); await sleep(400); }
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`${failed ? "FAILED" : "PASSED"}: ${n} checks`);
    fs.writeFileSync(path.join(OUT, "hall-auto-check.log"), `${failed ? "FAILED" : "PASSED"}: ${n} checks\n--- server log (hall lines) ---\n${log.split("\n").filter((l) => /hall|round/.test(l)).join("\n")}\n`);
    process.exit(failed ? 1 : 0);
  }
})();
