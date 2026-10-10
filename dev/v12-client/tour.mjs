// The v1.2 client tour: every NEW screen of v1.2 on the phone (WebKit iPhone 13 landscape, 844x390 @3, touch) and the
// TV (Chromium 1440x900 @1), against the real server of this tree (v1.2, merged 01:56) through dev/v12-client/server.cjs
// (ASTRA_MOCK, HTTPS off, serves ctrl-sandbox.js / mischief-fx.js / sfx.js, /__test hooks to skip travel).
//   node dev/v12-client/tour.mjs [--port 8260] [--bots 24] [--out dir] [--ignore-hold] [--headed]
// Real two-player mischief: a second human "rival" joins by API with a mock ship (DEV_KIT space = emp + mine) and is
// teleported next to the phone's player "carol" to fire EMP, drop a mine and shoot her down. Ink, tractor and decoy
// need the island kit, so the phone's own test hook (__spTest.mischief) plays them. Then the round is cut short to
// reach the real results (25 players) and a second phone joins as "carol" to see the renamed toast.
// Writes dev/v12-client/shots/tour/<step>.png and dev/v12-client/tour-report.json (checks, console errors, perf).
import fs from "fs";
import path from "path";
import {
  args, makeLogger, installSignalHandlers, runCleanups, waitForCalm, startServer, seedPlayers, keepAlive, launchBig, launchPhoneBrowser,
  watchPage, shootPage, summarisePerf, sp, drawSample, hook, input, post, get, waitFor, sleep, withTimeout, summariseConsole, Samples, ROOT,
} from "../v11-client/lib.mjs";

const A = args();
const log = makeLogger("tour");
installSignalHandlers(log);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = A.num("port", 8260);
const BOTS = A.num("bots", 24);
const OUT = path.resolve(A.opt("out", path.join(HERE, "shots", "tour")));
const REPORT = path.join(HERE, "tour-report.json");
const ME = "carol", RIVAL = "rival";
const report = { started: new Date().toISOString(), port: PORT, bots: BOTS, steps: [], checks: {}, perf: {}, console: {} };
const T = {};

async function step(name, fn) {
  const t0 = Date.now();
  const rec = { name, ok: true, notes: [], ms: 0 };
  report.steps.push(rec);
  try { await withTimeout(fn((n) => rec.notes.push(typeof n === "string" ? n : JSON.stringify(n))), 90000, name); }
  catch (e) { rec.ok = false; rec.error = String((e && e.message) || e).slice(0, 300); log(`STEP ${name} FAILED: ${rec.error}`); }
  rec.ms = Date.now() - t0;
  log(`${rec.ok ? "ok  " : "FAIL"} ${name} (${rec.ms} ms)${rec.notes.length ? " · " + rec.notes.join(" · ") : ""}`);
}
const check = (name, ok, detail) => { report.checks[name] = { ok: !!ok, detail }; log(`${ok ? "PASS" : "MISS"} ${name}${detail !== undefined ? ` · ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); };
const shot = async (page, name) => { try { await shootPage(page, path.join(OUT, `${name}.png`)); } catch (e) { log(`screenshot ${name} failed: ${e.message}`); } };
const evalSafe = (page, fn, arg) => page.evaluate(fn, arg).catch((e) => ({ error: String(e.message || e).slice(0, 200) }));
const state = () => hook.state(T.base);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!(await waitForCalm({ log, skip: A.flag("ignore-hold"), maxWaitMs: 20 * 60 * 1000 }))) throw new Error("the laptop stayed under pressure");
  const server = await startServer({ port: PORT, bots: BOTS, script: "dev/v12-client/server.cjs", logFile: path.join(HERE, "tour-server.log"), log });
  T.base = server.base;

  await step("rival-joins", async (note) => {
    const s = await seedPlayers(T.base, 1, { names: [RIVAL], log });
    note(`rival verbs: ${((s.entities[RIVAL] || {}).ship || {}).verbs}`);
    keepAlive(T.base, [RIVAL]);
  });

  // ---- TV lobby: the join QR comes from GET /info even on localhost ----
  T.big = await launchBig({ headed: A.flag("headed") });
  T.bigSink = watchPage(T.big.page, "big", log);
  await T.big.page.goto(`${T.base}/space.html`, { waitUntil: "load" });
  await step("big-lobby", async (note) => {
    const info = (await get(T.base, "/info")).json;
    await sleep(3500);
    const q = await evalSafe(T.big.page, () => ({ qr: !!document.querySelector("#qr canvas, #qr svg, #qr img"), url: (document.getElementById("joinUrl") || {}).innerText || "" }));
    const want = String(info.controllerUrl || "").replace(/^https?:\/\//, "");
    check("tv-qr-from-info", q.qr && q.url.replace(/[​\s]/g, "").includes(want), { shown: q.url, controllerUrl: info.controllerUrl });
    await shot(T.big.page, "big-lobby");
  });

  // ---- Phone: join, ship, controller, wait ----
  const phones = await launchPhoneBrowser({ headed: A.flag("headed") });
  T.phone = await phones.newPhone();
  T.phoneSink = watchPage(T.phone.page, "phone", log);
  const page = T.phone.page;
  await page.goto(`${T.base}/controller.html`, { waitUntil: "load" });
  await step("phone-join", async (note) => {
    await sp.waitVisible(page, "name", 8000);
    await page.fill("#name", ME);
    await page.locator("#joinForm button[type=submit]").tap({ timeout: 4000 }).catch(() => page.press("#name", "Enter"));
    await sp.waitStep(page, ["ship"], 12000);
    const dev = await evalSafe(page, () => localStorage.getItem("sp.device"));
    check("phone-device-token", typeof dev === "string" && dev.replace(/"/g, "").length >= 16, dev);
  });
  await step("phone-ship", async () => {
    await drawSample(page, "ship");
    await sleep(1500);
    await sp.tap(page, "done");
    await sp.waitStep(page, ["shipResult"], 15000);
    await sleep(2200);
    await shot(page, "phone-ship-result");
    await sp.tap(page, "resultNext");
    await sp.waitStep(page, ["controller"], 8000);
  });
  await step("phone-controller", async (note) => {
    await drawSample(page, "controller");
    await sleep(1500);
    await sp.tap(page, "done");
    await sp.waitStep(page, ["controllerResult"], 15000);
    await sleep(800);
    await shot(page, "phone-controller-result");
    await sp.tap(page, "resultNext");
    await sp.waitStep(page, ["wait", "play"], 8000);
    await sleep(1500);
    await shot(page, "phone-wait");
  });

  // ---- START from the TV ----
  await step("start", async (note) => {
    const clicked = await T.big.page.click("#startBtn", { timeout: 3000 }).then(() => true).catch(() => false);
    if (!clicked) await post(T.base, "/start", {});
    const st = await waitFor(async () => { const s = await state(); return s && (s.phase === "playing" || s.phase === "assists") ? s : null; }, { timeout: 8000 });
    note(`phase ${st && st.phase}, via ${clicked ? "the START button" : "POST /start"}`);
    await sp.waitStep(page, ["play"], 8000);
  });

  // ---- The sandbox controller (Sol / template HTML) ----
  await step("phone-sandbox", async (note) => {
    await sleep(2500);
    const s = await evalSafe(page, () => {
      const f = document.querySelector("#play iframe");
      const hits = document.getElementById("hits");
      const r = f ? f.getBoundingClientRect() : null;
      return { frame: !!f, sandbox: f ? f.getAttribute("sandbox") : null, rect: r ? [Math.round(r.width), Math.round(r.height)] : null, hitsShown: !!hits && getComputedStyle(hits).display !== "none" && hits.children.length > 0 && [...hits.children].some((c) => getComputedStyle(c).display !== "none" && getComputedStyle(c).visibility !== "hidden" && parseFloat(getComputedStyle(c).opacity) > 0.05) };
    });
    check("phone-sandbox-mounted", s.frame && s.sandbox === "allow-scripts" && !s.hitsShown, s);
    await shot(page, "phone-play-sandbox");
    await shot(T.big.page, "big-play");
    const h = await evalSafe(T.big.page, () => { const x = window.__game && window.__game.hud(); return x ? { followed: x.followed } : null; });
    const st = await state();
    const followedBot = h && h.followed && st && st.players[h.followed] && st.players[h.followed].bot;
    check("tv-follows-a-human", h && h.followed && !followedBot, h);
  });

  // ---- Sol's own HTML swapped in (a recorded Sol answer, through the page's test hook) ----
  await step("phone-sol-swap", async (note) => {
    const file = path.join(ROOT, "dev/astra/sol-html/out/c01-basic.html");
    if (!fs.existsSync(file)) return note("no recorded Sol answer");
    const hasHook = await evalSafe(page, () => !!(window.__spTest && typeof window.__spTest.html === "function"));
    if (hasHook !== true) return note("no __spTest.html hook");
    const r = await evalSafe(page, (html) => window.__spTest.html(html), fs.readFileSync(file, "utf8"));
    await sleep(2500);
    note(`swap → ${JSON.stringify(r)}`);
    await shot(page, "phone-play-sol");
  });

  // ---- Real mischief from a second human ----
  const near = async (distance = 30) => {
    const st = await state();
    const c = st && st.players[ME];
    if (!c) throw new Error("carol is not in the state");
    await hook.teleport(T.base, { player: RIVAL, near: { x: c.x, y: c.y, z: c.z }, distance, face: { x: c.x, y: c.y, z: c.z }, heal: true });
    return c;
  };
  await step("mischief-emp", async (note) => {
    await near(30);
    const before = await evalSafe(page, () => document.querySelectorAll("[data-mfx]").length);
    await input(T.base, RIVAL, "emp", true); await sleep(150); await input(T.base, RIVAL, "emp", false);
    await sleep(900);
    const after = await evalSafe(page, () => ({ mfx: [...document.querySelectorAll("[data-mfx]")].map((e) => e.dataset.mfx), emp: document.documentElement.classList.contains("is-emp") }));
    check("phone-emp-overlay", Array.isArray(after.mfx) && after.mfx.some((k) => /emp/.test(k)), { before, after });
    await shot(page, "phone-emp");
    await shot(T.big.page, "big-emp");
    const feed = await evalSafe(T.big.page, () => document.body.innerText);
    check("tv-feed-emp-line", typeof feed === "string" && /scrambled/i.test(feed), "kill feed text contains 'scrambled'");
    await sleep(5200);
  });
  await step("mischief-mine", async (note) => {
    const st = await state();
    const c = st.players[ME];
    // The rival 10 m ahead of carol, facing the same way: its mine drops 4 m behind it, in carol's path.
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    await hook.teleport(T.base, { player: RIVAL, x: c.x + fx * 10, y: c.y, z: c.z + fz * 10, yaw: c.yaw, pitch: 0, heal: true });
    await input(T.base, RIVAL, "mine", true); await sleep(150); await input(T.base, RIVAL, "mine", false);
    const hit = await waitFor(async () => { const k = await evalSafe(page, () => [...document.querySelectorAll("[data-mfx]")].map((e) => e.dataset.mfx)); return Array.isArray(k) && k.some((x) => /mine/.test(x)) ? k : null; }, { timeout: 5000, every: 150 });
    check("phone-mine-overlay", !!hit, hit);
    await shot(page, "phone-mine");
    await shot(T.big.page, "big-mine");
  });
  // ---- Ink, tractor, decoys (island kit / decoy owner): through the page's own hook ----
  for (const [name, msg] of [
    ["inkbomb", { kind: "inkbomb", from: RIVAL, seconds: 4 }],
    ["tractor", { kind: "tractor", from: RIVAL, seconds: 1.5, dir: Math.PI / 2 }],
    ["decoy-fooled", { kind: "decoy", from: RIVAL, seconds: 0 }],
    ["decoy-worked", { kind: "decoy", from: ME, victim: RIVAL, seconds: 0 }],
  ]) {
    await step(`mischief-${name}`, async (note) => {
      const ok = await evalSafe(page, (m) => { if (!window.__spTest || typeof window.__spTest.mischief !== "function") return "no hook"; window.__spTest.mischief({ type: "mischief", player: window.__sp.player, ...m }); return "ok"; }, msg);
      note(ok);
      await sleep(name === "inkbomb" ? 700 : 450);
      await shot(page, `phone-${name}`);
      if (name === "inkbomb") {
        // Wipe it with a finger: a zigzag drag across the screen.
        const box = { w: 844, h: 390 };
        await page.mouse.move(80, 80); await page.mouse.down();
        for (let i = 0; i <= 24; i++) await page.mouse.move(80 + (i % 2 ? 680 : 0), 80 + i * 10, { steps: 4 });
        await page.mouse.up();
        await sleep(500);
        await shot(page, "phone-inkbomb-wiped");
        await sleep(3000);
      } else await sleep(2200);
    });
  }

  // ---- Death: the rival shoots carol down ----
  await step("death", async (note) => {
    await near(22);
    await input(T.base, RIVAL, "shoot", true);
    const dead = await waitFor(async () => { const s = await state(); return s && s.players[ME] && s.players[ME].dead ? s : null; }, { timeout: 12000, every: 200 });
    await input(T.base, RIVAL, "shoot", false);
    note(dead ? "carol died" : "carol survived 12 s of fire");
    await sleep(500);
    const card = await evalSafe(page, () => document.body.innerText);
    check("phone-death-card", !!dead && typeof card === "string" && /DESTROYED/i.test(card) && /BACK IN/i.test(card), dead ? "card text found" : "no death");
    await shot(page, "phone-death");
    await shot(T.big.page, "big-death");
    await sleep(3500);
    await shot(page, "phone-respawned");
  });

  // ---- Perf so far (25 players in space) ----
  report.perf.phoneSpace = summarisePerf(T.phoneSink.perf);
  report.perf.bigSpace = summarisePerf(T.bigSink.perf);

  // ---- The round ends: real results with 25 players ----
  await step("results", async (note) => {
    const st = await state();
    await hook.round(T.base, { maxSeconds: Math.ceil((st && st.playT) || 0) + 2, scoreboardSeconds: 30 });
    await waitFor(async () => { const s = await state(); return s && s.phase === "scoreboard" ? s : null; }, { timeout: 10000 });
    await sleep(2600);
    await shot(T.big.page, "big-results");
    await shot(page, "phone-results");
    const m = await evalSafe(T.big.page, () => {
      const vw = innerWidth, vh = innerHeight;
      const els = [...document.querySelectorAll("#results .pc, #results .rr, #resBoard .lrow")].filter((e) => e.getClientRects().length);
      const rects = els.map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className, x: r.left, y: r.top, r: r.right, b: r.bottom }; });
      const outside = rects.filter((r) => r.x < 0 || r.y < 0 || r.r > vw + 0.5 || r.b > vh + 0.5).length;
      let overlaps = 0;
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1) overlaps++; }
      const banner = document.getElementById("bannerBox");
      const bannerOn = !!banner && banner.classList.contains("show");
      const title = (document.getElementById("resTitle") || {}).innerText || "";
      const winnerEl = document.querySelector("#podium .p1 .nm");
      return { vw, vh, rows: rects.length, outside, overlaps, bannerOn, title, winner: winnerEl ? winnerEl.innerText : null };
    });
    const res = (await state()) || {};
    const scores = (res.result && res.result.scores) || [];
    const top = scores.slice().sort((a, b) => b[1] - a[1])[0];
    check("tv-results-fit-25", m.rows >= 25 && !m.outside && !m.overlaps && !m.bannerOn, m);
    check("tv-one-winner", !res.result || !res.result.winner || (m.winner || "").toLowerCase() === String(res.result.winner).toLowerCase() && top && top[0] === res.result.winner, { winner: res.result && res.result.winner, shown: m.winner, top });
  });

  // ---- A second phone takes the same name: renamed ----
  await step("renamed", async (note) => {
    const p2 = await phones.newPhone();
    T.phone2Sink = watchPage(p2.page, "phone2", log);
    await p2.page.goto(`${T.base}/controller.html`, { waitUntil: "load" });
    await sp.waitVisible(p2.page, "name", 8000);
    await p2.page.fill("#name", ME);
    await p2.page.locator("#joinForm button[type=submit]").tap({ timeout: 4000 }).catch(() => p2.page.press("#name", "Enter"));
    await sleep(1800);
    const who = await evalSafe(p2.page, () => (window.__sp ? window.__sp.player : null));
    const text = await evalSafe(p2.page, () => document.body.innerText);
    check("phone-renamed", who && who !== ME && typeof text === "string" && /taken/i.test(text), { player: who });
    await shot(p2.page, "phone-renamed");
  });

  report.perf.phone = summarisePerf(T.phoneSink.perf);
  report.perf.big = summarisePerf(T.bigSink.perf);
  report.console = summariseConsole([T.bigSink, T.phoneSink, T.phone2Sink].filter(Boolean));
  for (const s of [T.bigSink, T.phoneSink, T.phone2Sink].filter(Boolean)) check(`console-clean-${s.label}`, !s.errors.length && !s.crashed, s.errors.slice(0, 3).map((e) => e.text));
}

main().catch((e) => { report.fatal = String((e && e.stack) || e).slice(0, 800); log(`FATAL ${report.fatal}`); })
  .finally(async () => {
    report.finished = new Date().toISOString();
    report.pass = !report.fatal && report.steps.every((s) => s.ok) && Object.values(report.checks).every((c) => c.ok);
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    log(`report ${path.relative(ROOT, REPORT)}: ${report.pass ? "PASS" : "FAIL"} · ${Object.values(report.checks).filter((c) => c.ok).length}/${Object.keys(report.checks).length} checks · phone ${JSON.stringify(report.perf.phone)} · big ${JSON.stringify(report.perf.big)}`);
    await runCleanups();
    process.exit(report.pass ? 0 : 1);
  });
