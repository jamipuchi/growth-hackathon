// Phone tour (v1.2 client track, phone agent): WebKit iPhone 13 landscape (844x390 @3, touch) against the real v1.2 server of this tree
// through dev/v12-client/server.cjs (ASTRA_MOCK, HTTPS off, serves ctrl-sandbox.js / mischief-fx.js / sfx.js).
//   dev/v12-client/phone/locked.sh 470 node dev/v12-client/phone/tour.mjs [--port 8262] [--bots 4] [--part a|b]
// part a: join (renamed toast) → ship → controller → play with Sol's template in the sandbox → a REAL second human ("rival", joined by API, DEV_KIT
//   ship = emp + mine) scrambles the phone → a custom pad (locked tip, hold tip, cooldown) → every mischief overlay through the page's own hooks
//   → death card → "drawing" input → Sol's HTML swap → results.
// part b: the plain controls: ctrl-sandbox.js blocked (404 like an old server) → DOM controls, EMP remap, and no mischief-fx.js at all.
// Writes dev/v12-client/shots/phone/<step>.png and dev/v12-client/phone/tour-report-<part>.json.
import fs from "fs";
import path from "path";
import {
  args, makeLogger, installSignalHandlers, runCleanups, startServer, launchPhoneBrowser, watchPage, shootPage, sp, drawSample, hook, input, post, get,
  waitFor, sleep, withTimeout, Samples, ROOT, nodeRequire, openEvents,
} from "../../v11-client/lib.mjs";

const A = args();
const log = makeLogger("phone");
installSignalHandlers(log);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = A.num("port", 8262);
const PART = A.opt("part", "a");
const OUT = path.resolve(HERE, "..", "shots", "phone");
const report = { started: new Date().toISOString(), part: PART, port: PORT, checks: {}, steps: [], console: {} };
const T = {};
const ME_WANT = "rival", RIVAL = "rival";   // the phone asks for "rival" while another phone holds it: it becomes "rival2" and the API human stays "rival"

const check = (name, ok, detail) => { report.checks[name] = { ok: !!ok, detail }; log(`${ok ? "PASS" : "MISS"} ${name}${detail !== undefined ? ` · ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); };
const shot = async (page, name) => { try { await shootPage(page, path.join(OUT, `${name}.png`)); log(`shot ${name}`); } catch (e) { log(`screenshot ${name} failed: ${e.message}`); } };
const ev = (page, fn, arg) => page.evaluate(fn, arg).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
async function step(name, fn) {
  const t0 = Date.now(), rec = { name, ok: true };
  report.steps.push(rec);
  try { await withTimeout(fn(), 60000, name); } catch (e) { rec.ok = false; rec.error = String((e && e.message) || e).slice(0, 300); log(`STEP ${name} FAILED: ${rec.error}`); }
  rec.ms = Date.now() - t0;
  log(`${rec.ok ? "ok  " : "FAIL"} ${name} (${rec.ms} ms)`);
}
const ctlInfo = (page) => ev(page, () => window.__spTest.ctl());
async function controlXY(page, action) {
  return ev(page, (a) => {
    const c = window.__spTest.ctl().controls.find((o) => o.action === a);
    const r = document.getElementById("ctl").getBoundingClientRect();
    return c ? { x: r.left + (c.x + c.w / 2) * r.width, y: r.top + (c.y + c.h / 2) * r.height } : null;
  }, action);
}
const waitLive = (page, ms = 9000) => waitFor(async () => { const c = await ctlInfo(page); return c && c.live ? c : null; }, { timeout: ms, every: 150 });
const count = (page, sel) => ev(page, (s) => document.querySelectorAll(s).length, sel);
const visibleText = (page, id) => ev(page, (i) => { const e = document.getElementById(i); return e ? e.textContent : null; }, id);
async function holdOn(page, action, ms, fn) {      // press a control of the frame with the mouse, hold, run fn, release
  const p = await controlXY(page, action);
  if (!p) throw new Error(`no control ${action}`);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await sleep(ms);
  const out = fn ? await fn(p) : null;
  await page.mouse.up();
  return out;
}

// The custom pad: every skill of the DEV_KIT ship that matters plus locked ones (heal and decoy are not on the ship, drill is planet-only).
function customPad() {
  process.env.OPENAI_API_KEY = ""; process.env.ASTRA_MOCK = "1";
  const H = nodeRequire(path.join(ROOT, "astra-html.js"));
  const layout = { source: "test", buttons: [
    { type: "stick", action: "steer", label: "STEER", x: 0.03, y: 0.4, w: 0.26, h: 0.55 },
    { type: "button", action: "shoot", label: "FIRE", x: 0.74, y: 0.5, w: 0.14, h: 0.3 },
    { type: "button", action: "boost", label: "BOOST", x: 0.58, y: 0.68, w: 0.14, h: 0.26 },
    { type: "button", action: "emp", label: "EMP", x: 0.42, y: 0.5, w: 0.13, h: 0.24 },
    { type: "button", action: "mine", label: "MINE", x: 0.9, y: 0.5, w: 0.09, h: 0.24 },
    { type: "button", action: "drill", label: "DRILL", x: 0.88, y: 0.76, w: 0.1, h: 0.2 },
    { type: "button", action: "heal", label: "HEAL", x: 0.32, y: 0.74, w: 0.1, h: 0.22 },
    { type: "button", action: "decoy", label: "DECOY", x: 0.44, y: 0.78, w: 0.12, h: 0.18 },
  ] };
  const allowedActions = layout.buttons.map((b) => b.action);
  return { layout, html: H.templateHtml(layout, { allowedActions }), html2: H.templateHtml(layout, { allowedActions, style: { accent: "#ff3b5c" } }) };
}

async function partA() {
  const base = T.base;
  // The other human first: it holds the name "rival" (device token A), so the phone's "rival" becomes "rival2".
  const j = await post(base, "/join", { player: RIVAL, device: "rival-api-device-0001" });
  check("api rival joined", j.status === 200 && j.json && j.json.player === RIVAL, j.json);
  const g = await post(base, "/generate", { player: RIVAL, kind: "ship", image: Samples.dataUrl("ship", 3), source: "draw", speculative: false, requestId: "rv-ship" });
  check("api rival ship has emp + mine", g.json && g.json.ok && g.json.entity.verbs.includes("emp") && g.json.entity.verbs.includes("mine"), g.json && g.json.entity && g.json.entity.verbs);
  const keep = setInterval(() => post(base, "/input", { type: "input", player: RIVAL, action: "view", down: false }), 20000);
  T.keep = keep;

  const { newPhone } = T.pb;
  const { page, context } = await newPhone();
  T.page = page;
  T.sink = watchPage(page, "phone", log);
  const joinBodies = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/join")) joinBodies.push(r.postData()); });
  await page.goto(`${base}/controller.html`, { waitUntil: "load" });

  await step("join-renamed", async () => {
    await shot(page, "00-join");
    await page.fill("#name", ME_WANT);
    await page.locator("#joinForm button[type=submit]").tap().catch(() => page.locator("#joinForm button[type=submit]").click());
    await sp.waitStep(page, ["ship"], 12000);
    await sleep(500);
    const st = await ev(page, () => ({ player: window.__sp.player, notice: document.getElementById("noticeText").textContent, shown: !document.getElementById("notice").classList.contains("off") }));
    check("renamed to rival2", st.player === "rival2", st);
    check("renamed notice text", /RIVAL WAS TAKEN/.test(st.notice) && /YOU ARE RIVAL2/.test(st.notice) && st.shown, st.notice);
    const body = JSON.parse(joinBodies[0] || "{}");
    check("join sends device + token (>= 16 chars of [A-Za-z0-9_-])", /^[A-Za-z0-9_-]{16,64}$/.test(body.device || "") && body.token === body.device, { device: body.device, token: body.token === body.device });
    await shot(page, "01-renamed-toast");
  });

  await step("ship", async () => {
    await drawSample(page, "ship");
    await sleep(400);
    await sp.tap(page, "done");
    await sp.waitStep(page, ["shipResult"], 15000);
    await sleep(1200);
    await shot(page, "02-ship-result");
    await sp.tap(page, "resultNext");
    await sp.waitStep(page, ["controller"], 8000);
  });
  await step("controller", async () => {
    await drawSample(page, "controller");
    await sleep(500);
    await sp.tap(page, "done");
    await sp.waitStep(page, ["controllerResult"], 15000);
    await sleep(600);
    const c = await ctlInfo(page);
    check("controller answer carried the pad as html", c.pad && c.pad.bytes > 500 && c.pad.source === "template", c.pad);
    await shot(page, "03-controller-result");
    await sp.tap(page, "resultNext");
    await sp.waitStep(page, ["wait", "play"], 8000);
  });

  await step("lobby", async () => {
    await sleep(1200);
    const c = await waitLive(page, 9000);
    check("sandbox live in the lobby", !!c, c && { source: c.source, controls: c.controls.map((o) => o.action) });
    await shot(page, "04-lobby");
  });

  await step("start-and-play", async () => {
    const s = await post(base, "/start", {});
    check("round started", s.status === 200, s.json);
    await sp.waitStep(page, ["play"], 10000);
    await sleep(700);
    await shot(page, "05-play-go");
    await sleep(900);
    await shot(page, "06-play-legend");
    const c = await waitLive(page, 9000);
    check("sandbox live while playing", !!c, c && { source: c.source, actions: c.actions });
    const info = await ev(page, () => ({
      hits: getComputedStyle(document.getElementById("hits")).display, sb: document.getElementById("area").classList.contains("sb"),
      frames: document.querySelectorAll("#ctl iframe").length, ink: getComputedStyle(document.getElementById("ink")).opacity,
    }));
    check("DOM controls hidden, one frame, faint ink", info.hits === "none" && info.sb && info.frames === 1 && Number(info.ink) < 0.3, info);
    await sleep(2400);
    await shot(page, "07-play-sandbox");
  });

  // press the real controls: input messages reach the server
  await step("press-input", async () => {
    const seen = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/input")) seen.push(r.postData()); });
    await holdOn(page, "boost", 700, async () => { await shot(page, "08-boost-hold-tip"); });
    await sleep(300);
    const downs = seen.filter((b) => /"action":"boost","down":true/.test(b)).length, ups = seen.filter((b) => /"action":"boost","down":false/.test(b)).length;
    check("press + release of BOOST reach the server", downs === 1 && ups === 1, { downs, ups });
    // steer stick: drag
    const st = await controlXY(page, "steer");
    await page.mouse.move(st.x, st.y); await page.mouse.down(); await page.mouse.move(st.x + 30, st.y - 20, { steps: 4 }); await sleep(200);
    const axisSent = seen.some((b) => /"type":"axis","player":"rival2","axis":"steer"/.test(b));
    await page.mouse.up(); await sleep(250);
    const centred = seen.some((b) => /"axis":"steer","x":0,"y":0/.test(b));
    check("steer stick sends axis and a force-centred 0,0 on release", axisSent && centred, { axisSent, centred });
  });

  // ---- the real second human scrambles the phone ----
  await step("real-emp", async () => {
    await sleep(2200);       // the spawn shield (2 s) is over
    const before = await ctlInfo(page);
    const pos0 = Object.fromEntries(before.controls.map((c) => [c.action, [Math.round(c.x * 1000), Math.round(c.y * 1000)]]));
    const msgs = [];
    const ev1 = openEvents(base, (m) => { if (m.type === "mischief" || m.type === "cooldown") msgs.push(m); });
    await input(base, RIVAL, "emp", true); await sleep(200); await input(base, RIVAL, "emp", false);
    const gotEmp = await waitFor(async () => (await count(page, '[data-mfx="emp"]')) > 0, { timeout: 4000, every: 100 });
    check("rival's EMP: the page runs the emp overlay", !!gotEmp, { msgs: msgs.map((m) => `${m.type}:${m.kind || m.verb}:${m.player}`) });
    await sleep(900);
    await shot(page, "09-emp-real");
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const inFrame = frame ? await frame.evaluate(() => document.documentElement.classList.contains("is-emp")).catch((e) => `err ${e.message}`) : "no frame";
    check("rival's EMP: the frame's kit scrambled its controls (is-emp)", inFrame === true, inFrame);
    await sleep(600);
    const during = await ctlInfo(page);
    const pos1 = Object.fromEntries(during.controls.map((c) => [c.action, [Math.round(c.x * 1000), Math.round(c.y * 1000)]]));
    const moved = Object.keys(pos0).filter((a) => a !== "steer" && JSON.stringify(pos0[a]) !== JSON.stringify(pos1[a])).length;
    check("EMP moved the buttons to other places", moved >= 2, { before: pos0, during: pos1 });
    // EMP ends after 5 s
    const gone = await waitFor(async () => (await count(page, '[data-mfx="emp"]')) === 0, { timeout: 9000, every: 200 });
    await sleep(500);
    const after = await ctlInfo(page);
    const pos2 = Object.fromEntries(after.controls.map((c) => [c.action, [Math.round(c.x * 1000), Math.round(c.y * 1000)]]));
    check("EMP over: overlay gone and buttons back", !!gone && JSON.stringify(pos2) === JSON.stringify(pos0), { gone: !!gone, same: JSON.stringify(pos2) === JSON.stringify(pos0) });
    ev1.close();
    // the rival's mine: drop behind it; the rival moves nowhere, so it hits nobody (just check the cooldown message for the rival is not mine)
  });

  // ---- the custom pad ----
  const pad = customPad();
  await step("custom-pad", async () => {
    await ev(page, (a) => window.__spTest.html(a.html, "controller", a.layout), pad);
    const c = await waitLive(page, 9000);
    check("custom pad mounted (remount: other actions)", !!c && c.actions.includes("decoy"), c && c.actions);
    await sleep(1500);
    await shot(page, "10-custom-pad");
  });
  await step("locked-tip", async () => {
    // HEAL is not drawn on the ship: pressing it explains what to draw, above the control
    const tip = await holdOn(page, "heal", 250, () => ev(page, () => ({ on: document.getElementById("tip").classList.contains("on"), lock: document.getElementById("tip").classList.contains("lock"), text: document.getElementById("tipText").textContent })));
    check("locked HEAL: tip says what to draw", tip.on && tip.lock && /HEAL/.test(tip.text) && /draw/.test(tip.text), tip);
    await holdOn(page, "heal", 300, async () => { await shot(page, "11-locked-tip"); });
    const tip2 = await holdOn(page, "drill", 250, () => ev(page, () => document.getElementById("tipText").textContent));
    check("locked DRILL: only on the planet", /only on the planet/.test(tip2), tip2);
    await holdOn(page, "decoy", 250, () => null);
    const disabled = await frameClasses(page, ["heal", "drill", "decoy", "emp", "mine", "shoot"]);
    check("locked controls wear is-disabled, usable ones do not", disabled.heal && disabled.drill && disabled.decoy && !disabled.emp && !disabled.mine && !disabled.shoot, disabled);
    await sleep(1200);
  });
  await step("hold-tip", async () => {
    const tip = await holdOn(page, "emp", 700, () => ev(page, () => ({ on: document.getElementById("tip").classList.contains("on"), title: document.getElementById("tipTitle").textContent, text: document.getElementById("tipText").textContent })));
    check("holding EMP 450 ms: what it does", tip.on && /EMP/.test(tip.title) && /Scramble/i.test(tip.text), tip);
    await holdOn(page, "mine", 700, async () => { await shot(page, "12-hold-tip-mine"); });
  });
  await step("cooldown", async () => {
    await ev(page, () => window.__spTest.cooldown("emp", 12));
    await sleep(400);
    const dis = await frameClasses(page, ["emp"]);
    const chip = await ev(page, () => { const c = document.querySelector("#cd .cdchip"); return c ? c.textContent : null; });
    check("EMP cooling down: greyed with a countdown chip", dis.emp && /^(11|12)$/.test(String(chip)), { disabled: dis.emp, chip });
    const tip = await holdOn(page, "emp", 250, () => ev(page, () => document.getElementById("tipText").textContent));
    check("pressing a cooling control: READY IN n S", /EMP · READY IN (11|12|10) S/.test(tip), tip);
    await holdOn(page, "emp", 200, async () => { await shot(page, "13-cooldown"); });
  });

  // ---- mischief overlays through the page's own hook ----
  await step("ink", async () => {
    await ev(page, () => window.__spTest.mischief({ kind: "inkbomb", seconds: 4, from: "rival" }));
    await sleep(450);
    await shot(page, "14-ink");
    const n0 = await count(page, '[data-mfx="ink"]');
    // wipe it off with a finger: zig-zag over the screen
    for (let row = 0; row < 7; row++) {
      const y = 40 + row * 48;
      await page.mouse.move(20, y); await page.mouse.down();
      await page.mouse.move(820, y + 6, { steps: 14 });
      await page.mouse.up();
      if ((await count(page, '[data-mfx="ink"]')) === 0) break;
      if (row === 2) await shot(page, "15-ink-wiping");
    }
    await sleep(700);
    const n1 = await count(page, '[data-mfx="ink"]');
    check("ink: shows, and wiping it off clears it", n0 === 1 && n1 === 0, { before: n0, after: n1 });
  });
  await step("tractor", async () => { await ev(page, () => window.__spTest.mischief({ kind: "tractor", seconds: 1.5, from: "rival", dir: Math.PI / 2 })); await sleep(550); await shot(page, "16-tractor"); await sleep(1500); });
  await step("mine", async () => { await ev(page, () => window.__spTest.mischief({ kind: "mine", seconds: 1.5, from: "rival", points: 30 })); await sleep(550); await shot(page, "17-mine"); await sleep(1800); });
  await step("decoy", async () => {
    await ev(page, () => window.__spTest.mischief({ kind: "decoy", from: "rival", seconds: 0 })); await sleep(500); await shot(page, "18-decoy-shot");
    await sleep(1800);
    await ev(page, () => window.__spTest.mischief({ kind: "decoy", from: "rival2", victim: "rival", seconds: 0 })); await sleep(500); await shot(page, "19-decoy-yours");
    await sleep(1800);
  });
  await step("own-mischief-toast", async () => {
    await ev(page, () => window.__spTest.announce("⚡ rival2 scrambled ana's buttons"));
    await sleep(500);
    const t = await ev(page, () => { const e = document.querySelector('[data-mfx="toast"]'); return e ? e.textContent : null; });
    check("my EMP hit a rival: gold toast", /ANA'S BUTTONS SCRAMBLED/.test(String(t)), t);
    await shot(page, "20-own-emp-toast");
    await sleep(2600);
  });
  await step("moments", async () => {
    await ev(page, () => window.__spTest.announce("💥 rival landed the last hit on the boss! REACH THE PLANET", true));
    await sleep(450);
    const t = await visibleText(page, "chipTitle");
    check("announcement chip: boss down", /BOSS DOWN/.test(String(t)), t);
    await shot(page, "21-chip-boss");
    await sleep(2800);
    await ev(page, () => window.__spTest.announce("rival2 ✕ ana"));
    await sleep(450);
    await shot(page, "22-chip-kill");
    await sleep(2800);
  });
  await step("death-card", async () => {
    await ev(page, () => window.__spTest.dead("ana", 3));
    await sleep(900);
    const d = await ev(page, () => ({ on: document.getElementById("dead").classList.contains("on"), by: document.getElementById("deadBy").textContent, n: document.getElementById("deadN").textContent, pts: document.getElementById("deadPts").textContent, title: document.getElementById("deadTitle").textContent }));
    check("death card", d.on && /ANA/.test(d.by) && /DESTROYED/.test(d.title) && /-50/.test(d.pts) && d.n === "3", d);
    await shot(page, "23-death-card");
    await sleep(1500);
    await shot(page, "24-death-card-2");
    await sleep(1400);
    const f = await ev(page, () => document.getElementById("fight").classList.contains("on"));
    await shot(page, "25-back-in-the-fight");
    check("respawn pop", f, f);
  });

  // ---- the "drawing" input ----
  await step("drawing-input", async () => {
    const flagsSeen = [];
    const es = openEvents(base, (m) => { if (m.type === "tick") { const me = m.players.find((p) => p.name === "rival2"); flagsSeen.push(!!(me && me.flags && me.flags.drawing)); } });
    await sleep(400);
    await page.locator("#tAdd").tap().catch(() => page.locator("#tAdd").click());
    await sleep(900);
    const down = await ev(page, () => window.__spTest.ctl().drawingDown);
    const on = flagsSeen.slice(-5).some(Boolean);
    check("add-a-button sheet open: drawing is down and the server hovers the ship (flags.drawing)", down === true && on, { down, on });
    await shot(page, "26-add-sheet");
    await page.locator("#addCancel").tap().catch(() => page.locator("#addCancel").click());
    await sleep(800);
    const down2 = await ev(page, () => window.__spTest.ctl().drawingDown);
    const off = !flagsSeen.slice(-3).some(Boolean);
    check("sheet closed: drawing is up again", down2 === false && off, { down2, off });
    es.close();
  });

  // ---- Sol's own HTML arrives later: swapped in place ----
  await step("html-swap", async () => {
    const before = await ctlInfo(page);
    const iframeId = await ev(page, () => { const f = document.querySelector("#ctl iframe"); f.dataset.t = "first"; return true; });
    await ev(page, (h) => window.__spTest.html(h, "html"), pad.html2);
    const swapped = await waitFor(async () => { const c = await ctlInfo(page); return c.source === "model" ? c : null; }, { timeout: 8000, every: 200 });
    await sleep(900);
    const frames = await count(page, "#ctl iframe");
    const firstGone = await ev(page, () => !document.querySelector('#ctl iframe[data-t="first"]'));
    check("Sol's HTML (kind html) swapped in place", !!swapped && frames === 1 && firstGone, { source: swapped && swapped.source, frames, firstGone, was: before.source });
    await shot(page, "27-html-swap");
  });

  // ---- results ----
  await step("results", async () => {
    await post(base, "/__test/round", { maxSeconds: 2, scoreboardSeconds: 25 });
    await sp.waitStep(page, ["results"], 25000);
    await sleep(900);
    await shot(page, "28-results");
    const r = await ev(page, () => ({ title: document.getElementById("resTitle").textContent, winner: document.getElementById("resWinner").textContent, rank: document.getElementById("resRank").textContent }));
    check("results sheet", !!r.title, r);
  });
}

async function frameClasses(page, actions) {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) return {};
  return frame.evaluate((list) => Object.fromEntries(list.map((a) => { const el = document.querySelector(`[data-action="${a}"]`); return [a, !!el && el.classList.contains("is-disabled")]; })), actions).catch(() => ({}));
}

async function partB() {
  const base = T.base;
  const { browser } = T.pb;
  // the plain controls: ctrl-sandbox.js answers 404 (an old server), mischief-fx.js still loads
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  await ctx.route("**/ctrl-sandbox.js", (r) => r.fulfill({ status: 404, body: "not found" }));
  const page = await ctx.newPage();
  T.page = page;
  T.sink = watchPage(page, "phone-legacy", log);
  const inputs = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/input")) inputs.push(r.postData()); });
  await page.goto(`${base}/controller.html`, { waitUntil: "load" });
  await step("legacy-join-play", async () => {
    await page.fill("#name", "legacy");
    await page.locator("#joinForm button[type=submit]").tap().catch(() => page.locator("#joinForm button[type=submit]").click());
    await sp.waitStep(page, ["ship"], 12000);
    await ev(page, () => window.__spTest.go("play"));
    await sp.waitStep(page, ["wait", "play"], 8000);
    await post(base, "/start", {});
    await sp.waitStep(page, ["play"], 10000);
    await sleep(2500);
    const c = await ctlInfo(page);
    const dom = await ev(page, () => ({ hits: getComputedStyle(document.getElementById("hits")).display, n: document.querySelectorAll("#hits .hit").length, sb: document.getElementById("area").classList.contains("sb") }));
    check("no sandbox module: the DOM controls are used", !c.mounted && dom.hits !== "none" && dom.n >= 3 && !dom.sb, { c: { mounted: c.mounted, padFailed: c.padFailed }, dom });
    await shot(page, "30-legacy-play");
  });
  await step("legacy-press", async () => {
    const hit = await ev(page, () => { const e = document.querySelector('#hits .hit[data-action="boost"]'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    inputs.length = 0;
    await page.mouse.move(hit.x, hit.y); await page.mouse.down(); await sleep(150); await page.mouse.up(); await sleep(200);
    check("legacy: pressing BOOST sends down + up", inputs.some((b) => /"action":"boost","down":true/.test(b)) && inputs.some((b) => /"action":"boost","down":false/.test(b)), inputs.slice(-3));
  });
  await step("legacy-emp", async () => {
    inputs.length = 0;
    await ev(page, () => window.__spTest.mischief({ kind: "emp", seconds: 5, from: "rival" }));
    await sleep(900);
    const st = await ev(page, () => ({ map: window.__spTest.ctl().empMap, overlay: document.querySelectorAll('[data-mfx="emp"]').length }));
    check("legacy EMP: the overlay runs and onSwap gave a permutation", st.overlay === 1 && st.map && Object.keys(st.map).length >= 2, st);
    await shot(page, "31-legacy-emp");
    // a touch where BOOST was now triggers the action shown there
    const map = st.map;
    const place = Object.keys(map).find((a) => a !== "steer" && map[a] !== a && map[a] !== "steer");
    if (place) {
      const hit = await ev(page, (a) => { const e = document.querySelector(`#hits .hit[data-action="${a}"]`); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2 - (parseFloat(getComputedStyle(e).translate.split(" ")[0]) || 0), y: r.top + r.height / 2 }; }, place);
      // the box of `place` moved away; its ORIGINAL place is where the finger goes
      const orig = await ev(page, (a) => { const b = window.__sp.layout.buttons.find((x) => x.action === a); const r = document.getElementById("hits").getBoundingClientRect(); return { x: r.left + (b.x + b.w / 2) * r.width, y: r.top + (b.y + b.h / 2) * r.height }; }, place);
      await page.mouse.move(orig.x, orig.y); await page.mouse.down(); await sleep(120); await page.mouse.up(); await sleep(200);
      const want = map[place];
      check(`legacy EMP: touching ${place}'s place sends ${want} (what is shown there)`, inputs.some((b) => b.includes(`"action":"${want}","down":true`)) && !inputs.some((b) => b.includes(`"action":"${place}","down":true`)), { want, inputs: inputs.slice(-4) });
    } else check("legacy EMP remap", false, map);
    await sleep(5200);
    const done = await ev(page, () => ({ overlay: document.querySelectorAll('[data-mfx="emp"]').length, map: window.__spTest.ctl().empMap }));
    check("legacy EMP over: no overlay, map cleared", done.overlay === 0 && !done.map, done);
  });
  await step("legacy-no-fx-module", async () => {
    // a third context with BOTH modules missing: the page still plays and says things in words
    const ctx2 = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx2.route(/\/(ctrl-sandbox|mischief-fx)\.js/, (r) => r.fulfill({ status: 404, body: "not found" }));
    const p2 = await ctx2.newPage();
    const sink2 = watchPage(p2, "phone-nomodules", log);
    await p2.goto(`${base}/controller.html`, { waitUntil: "load" });
    await p2.fill("#name", "nomods");
    await p2.locator("#joinForm button[type=submit]").tap().catch(() => p2.locator("#joinForm button[type=submit]").click());
    await sp.waitStep(p2, ["ship"], 12000);
    await ev(p2, () => window.__spTest.go("play"));
    await sp.waitStep(p2, ["wait", "play"], 8000);
    await sleep(1200);
    await ev(p2, () => window.__spTest.mischief({ kind: "mine", points: 30 }));
    await sleep(400);
    const t = await ev(p2, () => document.getElementById("toastText").textContent);
    check("no mischief-fx.js: a plain line says what happened", /MINE/.test(String(t)), t);
    report.console["phone-nomodules"] = { errors: sink2.errors.map((e) => e.text) };
    await ctx2.close();
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const server = await startServer({ port: PORT, bots: A.num("bots", 4), script: "dev/v12-client/server.cjs", logFile: path.join(HERE, `tour-server-${PART}.log`), log });
  T.base = server.base;
  T.pb = await launchPhoneBrowser();
  try {
    if (PART === "a") await partA(); else await partB();
  } finally {
    if (T.keep) clearInterval(T.keep);
    report.console.phone = T.sink ? { errors: T.sink.errors.map((e) => `${e.kind}: ${e.text}`), http: T.sink.http, failed: T.sink.failed, warnings: T.sink.warnings.map((w) => w.text).slice(0, 20) } : null;
    report.seconds = Math.round((Date.now() - t0) / 1000);
    fs.writeFileSync(path.join(HERE, `tour-report-${PART}.json`), JSON.stringify(report, null, 1));
    const bad = Object.entries(report.checks).filter(([, v]) => !v.ok).map(([k]) => k);
    log(`done in ${report.seconds}s · ${Object.keys(report.checks).length} checks, ${bad.length} missed${bad.length ? ": " + bad.join(" | ") : ""}`);
    await runCleanups();
  }
}
main().then(() => process.exit(0), async (e) => { log(`FAILED: ${(e && e.stack) || e}`); try { await runCleanups(); } catch {} process.exit(1); });
