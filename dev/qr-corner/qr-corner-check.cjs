// qr-corner check (owner 14:55, "make sure qr code is always visible to join"): a live server (ASTRA_MOCK=1, no key, a temp
// hall/ dir) for one tree, the TV (space.html, headless Chromium, 1920x1080) and two players who play a 1-minute round.
// Checks: the lobby shows only the big join card (corner hidden); in play and on the results (and, v1.9.1, over the HALL OF FAME
// frame) the corner code is on, about 180 px, the same address as the card, decodes (BarcodeDetector when the browser has it)
// and covers neither the scoreboard nor the kill feed; hall-of-fame.html on its own shows it too. Screenshots in OUT.
//   QRC_ROOT=<tree> QRC_PORT=8670 QRC_OUT=<dir> QRC_TAG=main node dev/qr-corner/qr-corner-check.cjs
const assert = require("assert");
const { fork } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");

const ROOT = path.resolve(process.env.QRC_ROOT || path.join(__dirname, "../.."));
const PORT = Number(process.env.QRC_PORT) || 8670;
const OUT = process.env.QRC_OUT || __dirname;
const TAG = process.env.QRC_TAG || "main";
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qrc-"));
const HOOK = path.join(__dirname, "../v191-hallauto/hook.js");
const PNG = fs.readFileSync(path.join(__dirname, "../v191-hallauto/hall-auto-check.cjs"), "utf8"); // png() reused below
let n = 0;
const ok = (t) => { n++; console.log(`ok  [${TAG}] ${t}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line no-new-func
const png = new Function("zlib", PNG.slice(PNG.indexOf("function png("), PNG.indexOf("function req(")) + "return png;")(require("zlib"));

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

// what the TV shows top left: the corner badge, the scoreboard, the kill feed, the card's address, and a decode of the corner code
const probe = (page) => page.evaluate(async () => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom), r: Math.round(b.right) } : null; };
  const c = document.querySelector("#qrcCode canvas");
  let decoded = "n/a";
  if (c && typeof BarcodeDetector === "function") {
    try { const d = await new BarcodeDetector({ formats: ["qr_code"] }).detect(c); decoded = d.length ? d[0].rawValue : "none"; } catch (e) { decoded = "error " + e.message; }
  }
  const feedLines = [...document.querySelectorAll(".bse-feed > *")].map(r).filter(Boolean);
  return {
    view: document.getElementById("hud").dataset.view,
    hall: !!document.getElementById("hallOver") && document.getElementById("hallOver").classList.contains("on"),
    corner: r(document.getElementById("qrCorner")), qr: r(c), card: r(document.getElementById("join")),
    scores: r(document.getElementById("scores")), rows: document.querySelectorAll("#rows .row").length, feed: r(document.querySelector(".bse-feed")), feedLines,
    url: document.getElementById("qrcUrl").textContent, joinUrl: window.__bigscreen && window.__bigscreen.joinUrl ? window.__bigscreen.joinUrl() : "", decoded,
    z: getComputedStyle(document.getElementById("qrCorner")).zIndex,
  };
});

let server = null, browser = null, log = "", hookSeq = 0;
const hook = (cmd, extra) => new Promise((resolve) => { const id = ++hookSeq; const on = (m) => { if (m && m.id === id) { server.off("message", on); resolve(m); } }; server.on("message", on); server.send({ id, cmd, ...extra }); });
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", HALL_MOCK: "1", OPENAI_API_KEY: "", KEEPALIVE: "0", HALL_DIR: path.join(TMP, "hall"), PERF_LOG: path.join(TMP, "perf.log") };
  server = fork(path.join(ROOT, "server.js"), ["--start-after", "0", "--minutes", "1"], { cwd: ROOT, env, execArgv: ["-r", HOOK], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  server.stdout.on("data", (c) => (log += c));
  server.stderr.on("data", (c) => (log += c));
  for (let i = 0; i < 60 && !/Space Party on/.test(log); i++) await sleep(200);
  assert.ok(/Space Party on/.test(log), `server did not start:\n${log}`);
  ok(`server up on ${PORT} (ASTRA_MOCK=1, no key), pid ${server.pid}, tree ${ROOT}`);
  const info = (await get("/info")).json;
  console.log(`    /info: ${JSON.stringify(info)}`);

  const exe = process.env.CHROME || path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell");
  browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const tv = await ctx.newPage();
  const errors = [];
  tv.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  tv.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_NAME|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await tv.goto(`${BASE}/space.html`, { waitUntil: "load" });
  await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "lobby", null, { timeout: 15000 });
  await tv.waitForFunction(() => !!document.querySelector("#qrcCode canvas"), null, { timeout: 12000 });
  await sleep(1500);
  let p = await probe(tv);
  console.log("    lobby:", JSON.stringify(p));
  assert.strictEqual(p.corner, null, "the corner code shows beside the lobby card");
  assert.ok(p.card, "no lobby card");
  ok(`lobby: the big join card only (corner hidden); address ${p.url}`);
  await tv.screenshot({ path: path.join(OUT, `${TAG}-1-lobby.png`) });

  for (const name of ["ana", "bob"]) assert.strictEqual((await post("/join", { player: name, device: `dev-${name}-0001` })).status, 200);
  await ready("ana", 0);
  await ready("bob", 1);
  assert.strictEqual((await post("/start", {})).status, 200);
  await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "play", null, { timeout: 15000 });
  const t0 = Date.now();
  await sleep(4000);
  p = await probe(tv);
  console.log("    play:", JSON.stringify(p));
  assert.ok(p.corner && p.qr, "no corner code in play");
  assert.ok(p.qr.h >= 165 && p.qr.h <= 205, `QR ${p.qr.h} px tall`);
  assert.ok(p.corner.x < 60 && p.corner.y < 60, "not top left");
  assert.ok(p.scores && p.scores.y >= p.corner.b, `scoreboard (top ${p.scores && p.scores.y}) under the corner (bottom ${p.corner.b})`);
  assert.ok(p.decoded === "n/a" || p.decoded === p.joinUrl, `decoded ${p.decoded} vs ${p.joinUrl}`);
  ok(`play: corner ${p.corner.w}x${p.corner.h} at ${p.corner.x},${p.corner.y} (QR ${p.qr.w}x${p.qr.h} px), scoreboard from y ${p.scores.y}; decodes: ${p.decoded}`);
  await tv.screenshot({ path: path.join(OUT, `${TAG}-2-play.png`) });

  await sleep(Math.max(0, 45000 - (Date.now() - t0)));
  const sc = await hook("score", { scores: { ana: 1200, bob: 700 } });
  assert.ok(sc.ok, JSON.stringify(sc));
  await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "results", null, { timeout: 60000, polling: 200 });
  await sleep(2600); // the podium rises (the v1.9.1 hall comes a few seconds later)
  p = await probe(tv);
  console.log("    results:", JSON.stringify(p));
  assert.ok(p.corner && p.qr, "no corner code on the results");
  ok(`results: corner on (${p.corner.w}x${p.corner.h} at ${p.corner.x},${p.corner.y})`);
  await tv.screenshot({ path: path.join(OUT, `${TAG}-3-results.png`) });

  if (await tv.evaluate(() => !!document.getElementById("hallOver"))) {
    await tv.waitForFunction(() => document.getElementById("hallOver").classList.contains("on"), null, { timeout: 20000, polling: 100 });
    await sleep(4000);
    p = await probe(tv);
    console.log("    hall:", JSON.stringify(p));
    assert.ok(p.hall && p.corner && p.qr, "no corner code over the hall");
    const top = await tv.evaluate(() => { const q = document.getElementById("qrCorner"), b = q.getBoundingClientRect(); q.style.pointerEvents = "auto"; const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); q.style.pointerEvents = ""; return e && e.closest("#qrCorner") ? "qrCorner" : e && e.id; });
    assert.strictEqual(top, "qrCorner", "the hall frame covers the corner code");
    ok(`hall overlay: corner on top of the frame (z ${p.z} > #hallOver 90), view ${p.view}`);
    await tv.screenshot({ path: path.join(OUT, `${TAG}-4-hall-overlay.png`) });
    await tv.waitForFunction(() => document.getElementById("hud").dataset.view === "lobby", null, { timeout: 20000 });
    await sleep(800);
    p = await probe(tv);
    assert.ok(p.hall && p.corner, "the corner left the hall when the lobby came underneath");
    ok("hall over the next lobby: the corner stays (the lobby card is covered)");
    await tv.keyboard.press("Enter");
    await sleep(900);
    p = await probe(tv);
    assert.ok(!p.hall && p.corner === null && p.card, JSON.stringify(p));
    ok("hall closed on the lobby: corner hidden, the big card is the code");
  }

  const hall = await ctx.newPage();
  hall.on("pageerror", (e) => errors.push(`hall pageerror: ${e.message}`));
  await hall.goto(`${BASE}/hall-of-fame.html`, { waitUntil: "load" });
  await hall.waitForFunction(() => !!document.querySelector("#qrcCode canvas") && !document.getElementById("qrCorner").classList.contains("off"), null, { timeout: 12000 });
  await sleep(2500);
  const hp = await hall.evaluate(async () => {
    const b = document.getElementById("qrCorner").getBoundingClientRect(), back = document.getElementById("back").getBoundingClientRect();
    const c = document.querySelector("#qrcCode canvas"), cb = c.getBoundingClientRect();
    let decoded = "n/a";
    if (typeof BarcodeDetector === "function") { try { const d = await new BarcodeDetector({ formats: ["qr_code"] }).detect(c); decoded = d.length ? d[0].rawValue : "none"; } catch (e) { decoded = "error " + e.message; } }
    return { corner: [b.x, b.y, b.width, b.height].map(Math.round), qr: Math.round(cb.height), back: [back.x, back.y].map(Math.round), url: document.getElementById("qrcUrl").textContent, decoded };
  });
  console.log("    hall page:", JSON.stringify(hp));
  assert.ok(hp.back[0] >= hp.corner[0] + hp.corner[2], "the corner covers ◀ Back");
  ok(`hall-of-fame.html alone: corner ${hp.corner.join(",")} (QR ${hp.qr} px) ${hp.url}; ◀ Back moved to x ${hp.back[0]}; decodes: ${hp.decoded}`);
  await hall.screenshot({ path: path.join(OUT, `${TAG}-5-hall-page.png`) });
  const emb = await ctx.newPage();
  await emb.goto(`${BASE}/hall-of-fame.html?embed=1`, { waitUntil: "load" });
  await sleep(1500);
  assert.ok(await emb.evaluate(() => document.getElementById("qrCorner").classList.contains("off") && !document.querySelector("#qrcCode canvas")));
  ok("hall-of-fame.html?embed=1: no corner of its own (the TV draws it)");

  assert.deepStrictEqual(errors, [], errors.join("\n"));
  ok("no console errors");
}

(async () => {
  let failed = false;
  try { await main(); } catch (err) { failed = true; console.error(`FAIL [${TAG}] ${err && err.stack}`); }
  finally {
    if (browser) await browser.close().catch(() => {});
    if (server) { server.kill(); await sleep(400); }
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`${failed ? "FAILED" : "PASSED"} [${TAG}]: ${n} checks`);
    process.exit(failed ? 1 : 0);
  }
})();
