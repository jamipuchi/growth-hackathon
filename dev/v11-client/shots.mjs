// The v1.1 screenshot tour: every screen of the client, on the big screen (Chromium 1440x900 @1) and the phone (WebKit,
// iPhone UA, touch, DPR 3, 844x390 landscape; 390x844 portrait for join and the first drawing step).
//   node dev/v11-client/shots.mjs [--port 8171] [--only name,name] [--seed 8] [--bots 0] [--name carol] [--out dir]
//                                 [--limit 900] [--no-deps] [--headed] [--fast] [--assists S] [--cap S] [--ignore-hold|--no-wait] [--dry]
// It starts dev/v11-client/server.cjs itself (ASTRA_MOCK, our own child process), seeds players with drawn ships, opens both
// browsers, drives the phone through the real UI with the ids and hooks of SPEC section 9, and saves
//   dev/v11-client/shots/<name>.png, shots/contact-{big,phone,portrait}.png (downscaled overviews) and shots/report.json
// (console errors per page and per step, missing ids, timings, game.perf() / POST /perf numbers: calls, tris, fps, tier).
// Every step runs in its own try/catch: a missing id or hook is logged ("MISSING #id") and the tour carries on.
// The phone player is "carol" (starts with "car": its explorer drawing comes back as a car). Test hooks (server.cjs
// /__test/*) skip only the minutes of travel: kill the boss, fly to the planet, stand at a rock chest, end the round.
//
// Steps in tour order (files they write; (x) = extra beyond the lead's list; internal steps take no screenshot):
//   phone-join (+ phone-join-portrait x) · phone-do-join · phone-step1-ship (-photo, -draw, -portrait x) ·
//   phone-wrong-drawing (+ phone-wrong-redraw x) · phone-ship-result · phone-step2-controller ·
//   phone-wrong-drawing-controller (x) · phone-controller-result · phone-wait · big-lobby · big-lobby-25 · big-start-click ·
//   big-play-hud · phone-play-hud · phone-locked-tooltip · phone-landing (+ big-landing-shot x) · phone-explorer-result
//   (+ phone-ctrl-prompt x) · island-party (x) · island-car (+ island-car-spectator x) · island-rock-chest (+ phone-drilling x,
//   island-chest-open x) · assists (big-assists x, phone-assists x) · results (big-results, phone-results)
// --only runs the listed steps AND the steps they depend on (without screenshots); --no-deps runs exactly the listed ones.
// A name matches a step or a step's file exactly (--only big-lobby is just big-lobby); when nothing matches exactly it
// is a prefix up to a dash (--only phone-step1 = every phone-step1-* step; --only island = every island-* step).
import fs from "fs";
import path from "path";
import {
  args, makeLogger, installSignalHandlers, runCleanups, waitForCalm, vitals, startServer, seedPlayers, keepAlive, launchBig, launchPhoneBrowser, watchPage,
  shootPage, readGamePerf, summarisePerf, sp, drawSample, hook, input, axis, post, killBoss, pressLand, waitForMode, landParty, standByRockChest,
  waitFor, sleep, withTimeout, summariseConsole, browserPaths, HERE, ROOT,
} from "./lib.mjs";
import { makeSheets } from "./sheet.mjs";

const A = args();
const log = makeLogger("shots");
installSignalHandlers(log);

const PORT = A.num("port", 8171);
const OUT = path.resolve(A.opt("out", path.join(HERE, "shots")));
const ONLY = A.list("only");
const NAME = A.opt("name", "carol");
const SEED_N = A.num("seed", 8);
const BOTS = A.num("bots", 0);
const LIMIT_S = A.num("limit", 900);
const HEADED = A.flag("headed");
const NO_DEPS = A.flag("no-deps");
const REPORT = path.join(OUT, "report.json");

// Strings the phone must show (SPEC section 6), compared case-insensitively with the page text.
const COPY = {
  step1: "STEP 1 OF 2 · DRAW YOUR SPACESHIP — it becomes your 3D ship",
  step2: "STEP 2 OF 2 · DRAW YOUR CONTROLLER — these become your buttons",
  planetExplorer: "DRAW WHAT EXPLORES THE PLANET — astronaut, car, bike…",
  planetController: "REDRAW YOUR CONTROLLER (optional)",
  shipHint: "Draw the ship itself. What you draw on it gives it powers: flames → boost, a cannon → shoot",
  controllerHint: "Draw your buttons: a circle to steer, boxes with words like FIRE, BOOST, LAND",
  unlock: "Your ship can:",
  wrongShip: "This looks like a controller. Did you mean to draw your ship?",
  wrongController: "This looks like",
  redraw: "Redraw",
  useAnyway: "Use it anyway",
};
const norm = (s) => String(s || "").toLowerCase().replace(/[’‘]/g, "'").replace(/\.\.\./g, "…").replace(/\s+/g, " ").trim();
async function copyCheck(page, keys) {
  const text = norm(await page.evaluate(() => document.body.innerText).catch(() => ""));
  return Object.fromEntries(keys.map((k) => [k, text.includes(norm(COPY[k]))]));
}

// ---- Runtime state -----------------------------------------------------------------------------------------------------------------

const T = { server: null, big: null, phone: null, phone2: null, bigSink: null, phoneSink: null, phone2Sink: null, seeded: null, phoneBrowser: null, aborted: null };
let cur = null;            // the record of the step that is running
const records = [];
const STEPS = [];
const step = (name, opts, run) => STEPS.push({ name, deps: [], files: [name], uses: [], ...opts, run });

const note = (text) => { cur.notes.push(typeof text === "string" ? text : JSON.stringify(text)); };
const miss = (what) => { if (!cur.missing.includes(what)) cur.missing.push(what); log(`MISSING ${what}`); };
async function need(page, id, timeout = 5000, why = "") {
  const ok = await sp.waitVisible(page, id, timeout);
  if (!ok) { const st = (await sp.ids(page, [id]))[id] || "?"; miss(`#${id} (${st})${why ? `: ${why}` : ""}`); }
  return ok;
}
async function tap(page, id, opts) {
  try { const how = await sp.tap(page, id, opts); if (how !== "tap") note(`#${id} pressed by ${how}`); return true; } catch (e) { miss(/^hidden/.test(e.message) ? `#${id} (hidden)` : `#${id}`); return false; }
}
async function tapSelector(page, selector, timeout = 3000) {
  try { await page.locator(selector).first().tap({ timeout }); return true; } catch { return false; }
}
async function shoot(file, which = "phone") {
  if (cur.noShots) return null;
  const page = which === "big" ? T.big : which === "phone2" ? T.phone2 : T.phone;
  const out = path.join(OUT, `${file}.png`);
  try {
    await shootPage(page, out);
    cur.files.push(path.relative(ROOT, out));
    log(`shot ${file}`);
  } catch (e) {
    note(`screenshot ${file} failed: ${e.message.split("\n")[0]}`);
    log(`screenshot ${file} FAILED: ${e.message.split("\n")[0]}`);
    return null;
  }
  if (which === "big") { const p = await readGamePerf(T.big); if (p) cur.perf.big = p; else if (T.bigSink.perf.length) cur.perf.big = lastPerf(T.bigSink); }
  else {
    const sink = which === "phone2" ? T.phone2Sink : T.phoneSink;
    if (sink.perf.length) cur.perf.phone = lastPerf(sink);
    const gp = await readGamePerf(page);
    if (gp) cur.perf.phoneGame = gp;
  }
  return out;
}
const lastPerf = (sink) => { const l = sink.perf[sink.perf.length - 1]; return { fps: l.fps, low1: l.low1, p90ms: l.p90ms, calls: l.calls, tris: l.tris, tier: l.tier, dpr: l.dpr, size: `${l.w}x${l.h}`, ageSec: +((Date.now() - l.seen) / 1000).toFixed(1) }; };

async function switchMode(which) {
  const id = which === "photo" ? "modePhoto" : "modeDraw";
  if (await sp.exists(T.phone, id)) return tap(T.phone, id);
  const fallback = which === "photo" ? '#drawSeg [data-mode="camera"]' : '#drawSeg [data-mode="draw"]';
  miss(`#${id} (the v1.0 toggle ${fallback} was tried)`);
  return tapSelector(T.phone, fallback);
}
async function phoneState() {
  return T.phone.evaluate(() => (window.__sp ? { screen: window.__sp.screen, step: window.__sp.step, player: window.__sp.player } : null)).catch(() => null);
}
// The e2e-compatible way into play (SPEC section 8): the plain ship and the default controller.
async function ensurePhonePlay() {
  const s = await phoneState();
  if (s && s.screen === "play") return true;
  if (s && s.screen === "draw" && (await sp.visible(T.phone, "useDefault"))) { await tap(T.phone, "useDefault"); note("fell back to #useDefault to reach play"); return !!(await waitFor(async () => (await phoneState())?.screen === "play", { timeout: 8000 })); }
  return false;
}
const setFollow = (name, view) => T.big.evaluate(([n, v]) => { const g = window.__game; if (!g) return false; g.setPlayer(n); g.setView(v); return true; }, [name, view]).catch(() => false);
const bigHasHook = () => T.big.evaluate(() => !!(window.__game && window.__game.setPlayer)).catch(() => false);

// ---- Steps -------------------------------------------------------------------------------------------------------------------------

step("phone-join", { uses: ["phone"], files: ["phone-join", "phone-join-portrait"] }, async () => {
  const ids = await sp.ids(T.phone, ["name", "joinForm"]);
  note(`ids ${JSON.stringify(ids)}`);
  if (ids.name !== "visible") miss("#name");
  await sleep(700);
  await shoot("phone-join");
  await T.phone.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  await shoot("phone-join-portrait");
  await T.phone.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
});

step("phone-do-join", { uses: ["phone"], internal: true }, async () => {
  await T.phone.fill("#name", NAME);
  let how = "tap";
  try { await T.phone.locator("#joinForm button").first().tap({ timeout: 5000 }); } catch { how = "enter"; await T.phone.press("#name", "Enter").catch(() => {}); }
  note(`joined as ${NAME} (${how})`);
  const joined = await waitFor(async () => (await phoneState())?.player, { timeout: 8000 });
  if (!joined) throw new Error("the phone did not join (no __sp.player)");
  await sleep(800);
  note(`after join: ${JSON.stringify(await phoneState())}`);
});

step("phone-step1-ship", { uses: ["phone"], deps: ["phone-do-join"], files: ["phone-step1-ship-photo", "phone-step1-ship-draw", "phone-step1-ship-portrait"] }, async () => {
  await sp.waitStep(T.phone, ["ship"], 10000).catch((e) => { miss("__sp.step === 'ship'"); note(e.message); });
  await sleep(700);
  const ids = await sp.ids(T.phone, ["draw", "drawHeader", "example", "modePhoto", "modeDraw", "drawPad", "undo", "clear", "done", "useDefault", "camInput", "camUse"]);
  note(`ids ${JSON.stringify(ids)}`);
  for (const [id, st] of Object.entries(ids)) if (st === "missing") miss(`#${id}`);
  note(`kind ${await sp.attr(T.phone, "draw", "data-kind")}`);
  // portrait, empty pad
  await T.phone.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  await shoot("phone-step1-ship-portrait");
  await T.phone.setViewportSize({ width: 844, height: 390 });
  await sleep(600);
  // photo mode
  await switchMode("photo");
  await sleep(600);
  await shoot("phone-step1-ship-photo");
  // draw mode with the sample
  await switchMode("draw");
  await sleep(500);
  const how = await drawSample(T.phone, "ship", { variant: 0 });
  note(`ship sample drawn by ${how}`);
  await sleep(600);
  await shoot("phone-step1-ship-draw");
  cur.copy = await copyCheck(T.phone, ["step1", "shipHint"]);
  note({ headerText: await sp.text(T.phone, "drawHeader") });
  for (const [k, v] of Object.entries(cur.copy)) if (!v) miss(`copy "${COPY[k]}"`);
});

step("phone-wrong-drawing", { uses: ["phone"], deps: ["phone-step1-ship"], files: ["phone-wrong-drawing", "phone-wrong-redraw"] }, async () => {
  if (!(await sp.hasHook(T.phone, "looksLike"))) { miss("window.__spTest.looksLike"); return; }
  await T.phone.evaluate(() => window.__spTest.looksLike("controller"));
  if (!(await tap(T.phone, "done"))) return;
  const shown = await need(T.phone, "wrong", 9000, "the wrong-drawing dialog after DONE");
  await sleep(600);
  await shoot("phone-wrong-drawing");
  cur.copy = await copyCheck(T.phone, ["wrongShip", "redraw", "useAnyway"]);
  for (const [k, v] of Object.entries(cur.copy)) if (!v) miss(`copy "${COPY[k]}"`);
  if (!shown) return;
  if (await tap(T.phone, "wrongRedraw")) {
    await sleep(800);
    await shoot("phone-wrong-redraw");
    if (await sp.visible(T.phone, "clear")) await tap(T.phone, "clear");
    note(`redraw sample by ${await drawSample(T.phone, "ship", { variant: 0 })}`);
    await sleep(500);
  }
});

step("phone-ship-result", { uses: ["phone"], deps: ["phone-step1-ship"], files: ["phone-ship-result"] }, async () => {
  if ((await sp.step(T.phone)) === "ship") await tap(T.phone, "done");
  await sp.waitStep(T.phone, ["shipResult"], 15000).catch((e) => { miss("__sp.step === 'shipResult'"); note(e.message); });
  await sleep(3000);   // the 3D preview inflates and starts its turntable
  await shoot("phone-ship-result");
  const ids = await sp.ids(T.phone, ["result", "previewCanvas", "unlockCard", "resultNext", "resultRedraw"]);
  note(`ids ${JSON.stringify(ids)}`);
  for (const [id, st] of Object.entries(ids)) if (st !== "visible") miss(`#${id} (${st})`);
  note({ unlockCard: await sp.text(T.phone, "unlockCard") });
  cur.copy = await copyCheck(T.phone, ["unlock"]);
  if (!cur.copy.unlock) miss(`copy "${COPY.unlock}"`);
  note({ entity: await T.phone.evaluate(() => { const e = window.__sp && window.__sp.entity; return e ? { type: e.type, verbs: e.verbs, source: e.source, image: e.image } : null; }).catch(() => null) });
});

step("phone-step2-controller", { uses: ["phone"], deps: ["phone-ship-result"], files: ["phone-step2-controller"] }, async () => {
  await tap(T.phone, "resultNext");
  await sp.waitStep(T.phone, ["controller"], 10000).catch((e) => { miss("__sp.step === 'controller'"); note(e.message); });
  await sleep(700);
  await switchMode("draw");
  await sleep(400);
  note(`controller sample drawn by ${await drawSample(T.phone, "controller", { variant: 0 })}`);
  await sleep(600);
  await shoot("phone-step2-controller");
  cur.copy = await copyCheck(T.phone, ["step2", "controllerHint"]);
  note({ headerText: await sp.text(T.phone, "drawHeader") });
  for (const [k, v] of Object.entries(cur.copy)) if (!v) miss(`copy "${COPY[k]}"`);
});

step("phone-wrong-drawing-controller", { uses: ["phone"], deps: ["phone-step2-controller"], files: ["phone-wrong-drawing-controller"] }, async () => {
  if (!(await sp.hasHook(T.phone, "looksLike"))) { miss("window.__spTest.looksLike"); return; }
  await T.phone.evaluate(() => window.__spTest.looksLike("entity"));
  if (!(await tap(T.phone, "done"))) return;
  const shown = await need(T.phone, "wrong", 9000, "the mirror dialog (looks like a ship) after DONE in the controller step");
  await sleep(600);
  await shoot("phone-wrong-drawing-controller");
  cur.copy = await copyCheck(T.phone, ["wrongController", "redraw", "useAnyway"]);
  if (shown) await tap(T.phone, "wrongUse");
});

step("phone-controller-result", { uses: ["phone"], deps: ["phone-step2-controller"], files: ["phone-controller-result"] }, async () => {
  if ((await sp.step(T.phone)) === "controller") await tap(T.phone, "done");
  await sp.waitStep(T.phone, ["controllerResult"], 15000).catch((e) => { miss("__sp.step === 'controllerResult'"); note(e.message); });
  await sleep(1500);
  await shoot("phone-controller-result");
  const ids = await sp.ids(T.phone, ["result", "ctrlPreview", "resultNext", "resultRedraw"]);
  note(`ids ${JSON.stringify(ids)}`);
  for (const [id, st] of Object.entries(ids)) if (st !== "visible") miss(`#${id} (${st})`);
  note({ layout: await T.phone.evaluate(() => (window.__sp && window.__sp.layout ? { source: window.__sp.layout.source, buttons: window.__sp.layout.buttons.map((b) => `${b.type}:${b.action}`) } : null)).catch(() => null) });
});

step("phone-wait", { uses: ["phone"], deps: ["phone-controller-result"], files: ["phone-wait"] }, async () => {
  await tap(T.phone, "resultNext");
  await sp.waitStep(T.phone, ["wait", "play"], 10000).catch((e) => { miss("__sp.step === 'wait'"); note(e.message); });
  await sleep(1200);
  await shoot("phone-wait");
  const ids = await sp.ids(T.phone, ["banner", "readyBtn"]);
  note(`ids ${JSON.stringify(ids)}`);
  for (const [id, st] of Object.entries(ids)) if (st !== "visible") miss(`#${id} (${st})`);
  if (ids.readyBtn === "visible") { await tap(T.phone, "readyBtn"); note("tapped Ready"); }
});

step("big-lobby", { uses: ["big"], deps: ["phone-wait"], files: ["big-lobby"] }, async () => {
  const ids = await Promise.all(["lobby", "qr", "startBtn", "leaderboard"].map(async (id) => [id, (await sp.ids(T.big, [id]))[id]]));
  note(`ids ${JSON.stringify(Object.fromEntries(ids))}`);
  for (const [id, st] of ids) if (st === "missing") miss(`#${id}`);
  await sleep(3500);   // drawn ships inflate (one per frame) and pop in
  await shoot("big-lobby", "big");
  const st = await hook.state(T.server.base);
  if (st) note(`players in the lobby: ${Object.keys(st.players).length} (${Object.values(st.players).filter((p) => !p.bot).length} humans)`);
});

step("big-lobby-25", { uses: ["big"], files: ["big-lobby-25"] }, async () => {
  const st = await hook.state(T.server.base);
  const have = st ? Object.keys(st.players).length : SEED_N + 1;
  const add = 25 - have;
  if (add > 0) {
    const start = T.seeded ? T.seeded.names.length : SEED_N;
    const r = await seedPlayers(T.server.base, add, { startAt: start, explorers: true, log });
    T.seeded.names.push(...r.names); T.seeded.ok.push(...r.ok);
    keepAlive(T.server.base, r.ok, 60000);
  }
  note(`25 players (${have} + ${Math.max(0, add)} seeded)`);
  await sleep(6000);
  await shoot("big-lobby-25", "big");
});

step("big-start-click", { uses: ["big"], deps: [], files: ["big-start-click"] }, async () => {
  let how = "click #startBtn";
  if (await sp.visible(T.big, "startBtn") || (await waitFor(() => sp.visible(T.big, "startBtn"), { timeout: 8000 }))) {
    try { await T.big.locator("#startBtn").click({ timeout: 4000 }); } catch (e) { how = `click failed (${e.message.split("\n")[0]}): POST /start`; await post(T.server.base, "/start"); }
  } else { miss("#startBtn"); how = "POST /start (no #startBtn)"; await post(T.server.base, "/start"); }
  note(how);
  await sleep(700);
  await shoot("big-start-click", "big");
  const st = await waitFor(async () => { const s = await hook.state(T.server.base); return s && s.phase === "playing" ? s : null; }, { timeout: 5000 });
  note(`phase after START: ${st ? st.phase : "not playing"}`);
  if (!st) throw new Error("the round did not start");
});

step("big-play-hud", { uses: ["big"], deps: ["big-start-click"], files: ["big-play-hud"] }, async () => {
  await sleep(3500);
  await shoot("big-play-hud", "big");
  const ids = await sp.ids(T.big, ["timer", "leaderboard", "startBtn"]);
  note(`ids ${JSON.stringify(ids)}`);
  if (ids.timer === "missing") miss("#timer");
  note({ timer: await sp.text(T.big, "timer") });
});

step("phone-play-hud", { uses: ["phone"], deps: ["phone-wait", "big-start-click"], files: ["phone-play-hud"] }, async () => {
  await sp.waitStep(T.phone, ["play"], 8000).catch(() => miss("__sp.step === 'play' after START"));
  if (!(await ensurePhonePlay())) note("the phone is not in play");
  await sleep(1500);
  await shoot("phone-play-hud");
  note(`state ${JSON.stringify(await phoneState())}`);
});

step("phone-locked-tooltip", { uses: ["phone"], deps: ["big-start-click"], files: ["phone-locked-tooltip"], timeout: 90000 }, async () => {
  // A second phone (its own context) joins with the plain default ship, so SHOOT is locked, and taps SHOOT.
  const { context, page } = await T.phoneBrowser.newPhone();
  T.phone2 = page;
  T.phone2Sink = watchPage(page, "phone2", log);
  try {
    await page.goto(`${T.server.base}/controller.html`, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__sp, null, { timeout: 15000 });
    await page.fill("#name", "plainpat");
    await page.locator("#joinForm button").first().tap({ timeout: 5000 });
    await page.waitForFunction(() => window.__sp.screen === "draw", null, { timeout: 10000 });
    if (!(await tap(page, "useDefault"))) return;
    await page.waitForFunction(() => window.__sp.screen === "play", null, { timeout: 10000 });
    await sleep(2500);
    // SHOOT's rectangle on the pad (fractions), else where the default layout puts it.
    const target = await page.evaluate(() => {
      const L = window.__sp && window.__sp.layout, b = L && L.buttons && L.buttons.find((x) => x.action === "shoot");
      const areaEl = ["area", "hits", "ink"].map((i) => document.getElementById(i)).find((e) => e && e.getBoundingClientRect().width > 50);
      const r = areaEl ? areaEl.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const f = b || { x: 0.76, y: 0.5, w: 0.21, h: 0.44 };
      return { x: r.left + (f.x + f.w / 2) * r.width, y: r.top + (f.y + f.h / 2) * r.height, fromLayout: !!b };
    });
    note(`tapping SHOOT at ${Math.round(target.x)},${Math.round(target.y)} (${target.fromLayout ? "from __sp.layout" : "default layout position"})`);
    await page.touchscreen.tap(target.x, target.y);
    await sleep(450);
    const tip = await sp.visible(page, "tip");
    if (!tip) miss("#tip (locked-skill tooltip) after tapping SHOOT");
    await shoot("phone-locked-tooltip", "phone2");
    note({ tip: await sp.text(page, "tip") });
  } finally {
    await context.close().catch(() => {});
    T.phone2 = null;
  }
});

step("phone-landing", { uses: ["phone", "big"], deps: ["phone-wait", "big-start-click"], files: ["big-landing-shot", "phone-landing"], timeout: 120000 }, async () => {
  await ensurePhonePlay();
  await killBoss(T.server.base, NAME, { log });
  await sleep(600);
  await pressLand(T.server.base, NAME, { log });
  await sleep(1300);
  await shoot("big-landing-shot", "big");
  const st = await waitForMode(T.server.base, NAME, "planet", 10000);
  note(`mode after LAND: ${st ? "planet" : "still in space"}`);
  const shown = await need(T.phone, "explorer", 14000, "the explorer prompt after landing");
  await sleep(900);
  await shoot("phone-landing");
  const ids = await sp.ids(T.phone, ["explorer", "expPhoto", "expDraw", "expDefault"]);
  note(`ids ${JSON.stringify(ids)}`);
  for (const [id, s] of Object.entries(ids)) if (s === "missing") miss(`#${id}`);
  cur.copy = await copyCheck(T.phone, ["planetExplorer"]);
  if (shown && !cur.copy.planetExplorer) miss(`copy "${COPY.planetExplorer}"`);
  note({ step: await sp.step(T.phone) });
});

step("phone-explorer-result", { uses: ["phone"], deps: ["phone-landing"], files: ["phone-explorer-result", "phone-ctrl-prompt"], timeout: 90000 }, async () => {
  const tappedDraw = (await sp.exists(T.phone, "expDraw")) ? await tap(T.phone, "expDraw") : (miss("#expDraw (the v1.0 toggle was tried)"), await tapSelector(T.phone, '#expSeg [data-mode="draw"]'));
  await sleep(800);
  const padId = (await sp.visible(T.phone, "drawPad")) ? "drawPad" : "expPad";
  note(`explorer pad #${padId}, kind ${await sp.attr(T.phone, "draw", "data-kind")}`);
  if (tappedDraw !== false) note(`explorer sample (car) drawn by ${await drawSample(T.phone, "car", { variant: 0, padId })}`);
  await sleep(500);
  if (!(await tap(T.phone, "done"))) await tap(T.phone, "expDone");
  await sp.waitStep(T.phone, ["explorerResult"], 14000).catch((e) => { miss("__sp.step === 'explorerResult'"); note(e.message); });
  await sleep(3000);
  await shoot("phone-explorer-result");
  note({ unlockCard: await sp.text(T.phone, "unlockCard") });
  note({ entity: await T.phone.evaluate(() => { const e = window.__sp && window.__sp.entity; return e ? { type: e.type, verbs: e.verbs, source: e.source } : null; }).catch(() => null) });
  if (await sp.visible(T.phone, "resultNext")) {
    await tap(T.phone, "resultNext");
    await sleep(900);
    if (await sp.visible(T.phone, "ctrlPrompt")) {
      await shoot("phone-ctrl-prompt");
      cur.copy = await copyCheck(T.phone, ["planetController"]);
      await tap(T.phone, "ctrlKeep");
    } else if ((await sp.step(T.phone)) === "planetController") await shoot("phone-ctrl-prompt");
    else note({ afterNext: await sp.step(T.phone) });
  }
});

step("island-party", { uses: ["big"], deps: ["phone-landing"], files: ["island-party"], timeout: 60000 }, async () => {
  const names = (T.seeded ? T.seeded.ok : []).slice(0, 8);
  if (!names.length) { note("no seeded players to land"); return; }
  await landParty(T.server.base, names, { log });
  await waitFor(async () => { const s = await hook.state(T.server.base); return s && names.every((n) => s.players[n] && s.players[n].mode === "planet") ? s : null; }, { timeout: 12000 });
  await setFollow(NAME, "spectator");
  await sleep(5000);
  await shoot("island-party", "big");
  const st = await hook.state(T.server.base);
  if (st) note(`on the island: ${Object.entries(st.players).filter(([, p]) => p.mode === "planet").map(([n, p]) => `${n}/${p.type}`).join(" ")}`);
});

step("island-car", { uses: ["big"], deps: ["phone-explorer-result"], files: ["island-car", "island-car-spectator"], timeout: 60000 }, async () => {
  if (!(await bigHasHook())) { miss("window.__game.setPlayer/setView"); }
  await setFollow(NAME, "chase");
  await sleep(1200);
  await axis(T.server.base, NAME, "move", 0, 1);
  await input(T.server.base, NAME, "boost", true);
  await sleep(1600);
  await shoot("island-car", "big");
  await axis(T.server.base, NAME, "move", 0, 0);
  await input(T.server.base, NAME, "boost", false);
  await setFollow(NAME, "spectator");
  await sleep(1800);
  await shoot("island-car-spectator", "big");
  const st = await hook.state(T.server.base);
  note(`${NAME} on the island: ${st && st.players[NAME] ? `${st.players[NAME].mode}/${st.players[NAME].type}` : "?"}`);
});

step("island-rock-chest", { uses: ["big", "phone"], deps: ["phone-landing"], files: ["island-rock-chest", "phone-drilling", "island-chest-open"], timeout: 60000 }, async () => {
  const chest = await standByRockChest(T.server.base, NAME);
  if (!chest) { note("no closed rock chest to drill"); return; }
  note(`rock chest #${chest.id} at ${chest.x},${chest.z}`);
  await setFollow(NAME, "chase");
  await sleep(900);
  await input(T.server.base, NAME, "drill", true);
  await sleep(1100);
  await shoot("island-rock-chest", "big");
  await shoot("phone-drilling");
  await sleep(2300);
  await shoot("island-chest-open", "big");
  await input(T.server.base, NAME, "drill", false);
  const st = await hook.state(T.server.base);
  const c = st && st.chests.find((x) => x.id === chest.id);
  note(`chest #${chest.id} open: ${c ? c.open : "?"}`);
});

step("assists", { uses: ["big", "phone"], deps: ["big-start-click"], files: ["big-assists", "phone-assists"] }, async () => {
  await hook.round(T.server.base, { assistsAt: 0 });
  await sleep(1800);
  await shoot("big-assists", "big");
  await shoot("phone-assists");
});

step("results", { uses: ["big", "phone"], deps: ["big-start-click"], files: ["big-results", "phone-results"], timeout: 60000 }, async () => {
  await hook.round(T.server.base, { maxSeconds: 0 });
  const st = await waitFor(async () => { const s = await hook.state(T.server.base); return s && s.phase === "scoreboard" ? s : null; }, { timeout: 8000 });
  note(`phase: ${st ? st.phase : "never reached the scoreboard"}`);
  await sleep(2600);
  await shoot("big-results", "big");
  const bigIds = await sp.ids(T.big, ["results", "leaderboard"]);
  note(`big ids ${JSON.stringify(bigIds)}`);
  for (const [id, s] of Object.entries(bigIds)) if (s === "missing") miss(`big #${id}`);
  note({ bigResults: await sp.text(T.big, "results") });
  await sp.waitStep(T.phone, ["results"], 6000).catch(() => miss("__sp.step === 'results'"));
  await shoot("phone-results");
  const ids = await sp.ids(T.phone, ["resultsSheet"]);
  if (ids.resultsSheet !== "visible") miss(`#resultsSheet (${ids.resultsSheet})`);
});

// ---- Selection ---------------------------------------------------------------------------------------------------------------------

// An exact step name or file name wins; only when nothing matches exactly does a selector match as a prefix up to a dash.
const exactly = (s, sel) => s.name === sel || s.files.includes(sel);
const byPrefix = (s, sel) => s.name.startsWith(`${sel}-`) || s.files.some((f) => f.startsWith(`${sel}-`));
const matches = (s, sel) => (STEPS.some((x) => exactly(x, sel)) ? exactly(s, sel) : byPrefix(s, sel));
const isWanted = (s) => !ONLY.length || ONLY.some((sel) => matches(s, sel));
function selectSteps() {
  const byName = new Map(STEPS.map((s) => [s.name, s]));
  for (const sel of ONLY) if (!STEPS.some((s) => matches(s, sel))) log(`--only ${sel}: no such step or file (steps: ${STEPS.map((s) => s.name).join(", ")})`);
  const wanted = new Set(STEPS.filter(isWanted).map((s) => s.name));
  const included = new Set(wanted);
  if (!NO_DEPS) {
    const add = (n) => { for (const d of byName.get(n).deps) if (!included.has(d)) { included.add(d); add(d); } };
    for (const n of [...wanted]) add(n);
  }
  return STEPS.filter((s) => included.has(s.name)).map((s) => ({ ...s, wanted: wanted.has(s.name) }));
}

async function runStep(def) {
  cur = { name: def.name, ok: true, ms: 0, files: [], missing: [], notes: [], consoleErrors: [], perf: {}, noShots: !def.wanted, copy: null };
  const t0 = Date.now();
  log(`--- ${def.name}${def.wanted ? "" : " (dependency: no screenshots)"}`);
  try { await withTimeout(def.run(), def.timeout || 60000, def.name); }
  catch (e) { cur.ok = false; cur.error = e.message.split("\n")[0]; log(`FAIL ${def.name}: ${cur.error}`); }
  cur.ms = Date.now() - t0;
  for (const sink of [T.bigSink, T.phoneSink, T.phone2Sink].filter(Boolean)) {
    const d = sink.drain();
    for (const e of d.errors) cur.consoleErrors.push({ page: sink.label, kind: e.kind, text: e.text });
    for (const h of d.http) cur.consoleErrors.push({ page: sink.label, kind: `http ${h.status}`, text: h.url });
    for (const f of d.failed) cur.consoleErrors.push({ page: sink.label, kind: "request failed", text: `${f.url} ${f.error || ""}`.trim() });
  }
  if (cur.consoleErrors.length) log(`  ${cur.consoleErrors.length} page problem(s) in this step, first: [${cur.consoleErrors[0].page}] ${cur.consoleErrors[0].kind} ${cur.consoleErrors[0].text.slice(0, 140)}`);
  records.push(cur);
  const v = vitals();
  if (!A.flag("ignore-hold") && v.pressure >= 2 && v.hold) { T.aborted = `memory pressure ${v.pressure} with HOLD on during the run: ${v.last}`; }
  if ((T.phoneSink && T.phoneSink.crashed) || (T.bigSink && T.bigSink.crashed)) T.aborted = `a page crashed (${[T.bigSink, T.phoneSink].filter((s) => s && s.crashed).map((s) => s.label).join(", ")})`;
}

// ---- Main --------------------------------------------------------------------------------------------------------------------------

async function writeReport(extra = {}) {
  const missingIds = {};
  for (const r of records) for (const m of r.missing) (missingIds[m] = missingIds[m] || []).push(r.name);
  let info = null;
  try { info = T.server ? await hook.info(T.server.base) : null; } catch {}
  const report = {
    tool: "dev/v11-client/shots.mjs", measuredAt: new Date().toISOString(), wallSeconds: +log.since().toFixed(1), port: PORT, out: path.relative(ROOT, OUT),
    options: { only: ONLY, seed: SEED_N, bots: BOTS, name: NAME, noDeps: NO_DEPS },
    browsers: browserPaths(), vitalsAtStart: T.vitalsAtStart,
    server: info ? { argv: info.argv, round: info.round, notServedByServerJs: info.missing } : null,
    aborted: T.aborted || null, ...extra,
    steps: records.map((r) => ({ name: r.name, ok: r.ok, seconds: +(r.ms / 1000).toFixed(1), files: r.files, missing: r.missing, error: r.error || null, copy: r.copy, notes: r.notes, perf: r.perf, pageProblems: r.consoleErrors })),
    missingIds,
    pages: summariseConsole([T.bigSink, T.phoneSink, T.phone2Sink].filter(Boolean)),
    perf: { big: T.bigSink && T.bigSink.perf.length ? summarisePerf(T.bigSink.perf) : null, phone: T.phoneSink && T.phoneSink.perf.length ? summarisePerf(T.phoneSink.perf) : null,
      note: "WebKit on a desktop Mac emulating an iPhone (844x390 @3x): a proxy only; confirm on a real phone" },
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  return report;
}

function printSummary(report) {
  const line = (s = "") => console.log(s);
  line(); line(`==== shots: ${report.steps.filter((s) => s.ok).length}/${report.steps.length} steps ok, ${report.steps.reduce((n, s) => n + s.files.length, 0)} screenshots, ${report.wallSeconds} s ====`);
  for (const s of report.steps) {
    line(`${s.ok ? "ok  " : "FAIL"} ${s.name.padEnd(30)} ${String(s.seconds).padStart(5)} s  ${s.files.map((f) => path.basename(f)).join(" ")}${s.error ? `  ERROR ${s.error}` : ""}`);
    if (s.missing.length) line(`       missing: ${s.missing.join(", ")}`);
  }
  const ids = Object.keys(report.missingIds);
  line(`missing ids / hooks / copy: ${ids.length ? ids.join(", ") : "none"}`);
  for (const [label, p] of Object.entries(report.pages)) line(`page ${label}: ${p.errors.length} console errors, ${p.http.length} http errors, ${p.failed.length} failed requests${p.crashed ? ", CRASHED" : ""}`);
  if (report.server && Object.keys(report.server.notServedByServerJs || {}).length) line(`files the pages asked for that server.js does not serve: ${Object.keys(report.server.notServedByServerJs).join(", ")}`);
  if (report.perf.big) line(`perf big:   ${report.perf.big.fps} fps, ${report.perf.big.calls} calls, ${Math.round(report.perf.big.tris / 1000)}k tris, tier ${report.perf.big.tier}`);
  if (report.perf.phone) line(`perf phone: ${report.perf.phone.fps} fps (1% low ${report.perf.phone.low1}), ${report.perf.phone.calls} calls, ${Math.round(report.perf.phone.tris / 1000)}k tris, tier ${report.perf.phone.tier}, ${report.perf.phone.size}`);
  if (report.aborted) line(`ABORTED: ${report.aborted}`);
  if (report.sheets && report.sheets.length) line(`contact sheets: ${report.sheets.map((x) => `${x.file} (${x.shots})`).join(", ")}`);
  line(`report ${path.relative(ROOT, REPORT)}`);
}

async function main() {
  const todo = selectSteps();
  if (!todo.length) { console.error("nothing to do: no step matches --only"); return 2; }
  log(`steps: ${todo.map((s) => (s.wanted ? s.name : `(${s.name})`)).join(" ")}`);
  if (A.flag("dry") || A.flag("list")) {
    for (const s of todo) console.log(`${s.wanted && !s.internal ? "shoot" : "drive"} ${s.name.padEnd(30)} uses ${s.uses.join("+") || "-"}  files ${s.internal ? "-" : s.files.join(" ")}`);
    console.log("(dry run: no server, no browser)");
    return 0;
  }
  const needsBig = todo.some((s) => s.uses.includes("big")), needsPhone = todo.some((s) => s.uses.includes("phone"));
  T.vitalsAtStart = vitals().last;
  if (!A.flag("ignore-hold")) {
    const v = vitals();
    if ((v.hold || v.pressure >= 2) && A.flag("no-wait")) { console.error(`the laptop is busy (HOLD ${v.hold || "off"}, memory pressure ${v.pressure}): not starting (--no-wait)`); return 4; }
    if (!(await waitForCalm({ log }))) { console.error("the laptop stayed busy: not starting"); return 4; }
  }

  // The time limit counts from here (waiting for the laptop to calm down does not use it up).
  const deadline = setTimeout(async () => {
    log(`global limit of ${LIMIT_S} s reached: stopping`);
    T.aborted = `the ${LIMIT_S} s limit`;
    try { await writeReport(); } catch {}
    await runCleanups();
    process.exit(2);
  }, LIMIT_S * 1000);

  fs.mkdirSync(OUT, { recursive: true });
  const serverArgs = [];
  if (A.flag("fast")) serverArgs.push("--fast");
  for (const o of ["assists", "cap", "scoreboard"]) if (A.opt(o) != null) serverArgs.push(`--${o}`, A.opt(o));
  T.server = await startServer({ port: PORT, bots: BOTS, serverArgs, env: { PERF_LOG: path.join(OUT, "server-perf.log") }, logFile: path.join(OUT, "server.log"), log });
  T.seeded = await seedPlayers(T.server.base, SEED_N, { explorers: true, ready: true, log });
  keepAlive(T.server.base, T.seeded.ok, 60000);

  if (needsBig) {
    const { page } = await launchBig({ headed: HEADED });
    T.big = page; T.bigSink = watchPage(page, "big", log);
    // A LAN-style join address (as on the party night) so the lobby shows its real QR code; localhost hides it on purpose.
    await page.goto(`${T.server.base}/space.html?join=${encodeURIComponent(`http://192.168.1.20:${PORT}/controller.html`)}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__game, null, { timeout: 15000 }).catch(() => log("window.__game not there after 15 s"));
    log("big screen open");
  }
  if (needsPhone) {
    T.phoneBrowser = await launchPhoneBrowser({ headed: HEADED });
    const { page } = await T.phoneBrowser.newPhone();
    T.phone = page; T.phoneSink = watchPage(page, "phone", log);
    await page.goto(`${T.server.base}/controller.html`, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__sp, null, { timeout: 15000 }).catch(() => log("window.__sp not there after 15 s"));
    log("phone open");
  }

  for (const def of todo) {
    if (T.aborted) break;
    await runStep(def);
  }
  clearTimeout(deadline);
  // Contact sheets of this run's screenshots (a few downscaled overview PNGs for a quick look).
  let sheets = [];
  try {
    const files = records.flatMap((r) => r.files).map((f) => path.join(ROOT, f));
    if (files.length) sheets = makeSheets({ dir: OUT, files, order: records.flatMap((r) => r.files.map((f) => path.basename(f, ".png"))) }).map((x) => ({ file: path.relative(ROOT, x.file), shots: x.shots }));
  } catch (e) { log(`contact sheets failed: ${e.message}`); }
  const report = await writeReport({ sheets });
  printSummary(report);
  await runCleanups();
  const crashed = Object.values(report.pages).some((p) => p.crashed);
  return crashed || report.aborted || report.steps.some((s) => !s.ok && !s.name.startsWith("phone-wrong")) ? 1 : 0;
}

main().then((code) => process.exit(code)).catch(async (e) => {
  console.error(`[shots] failed: ${e.stack || e.message}`);
  T.aborted = T.aborted || e.message;
  try { const r = await writeReport(); printSummary(r); } catch {}
  await runCleanups();
  process.exit(1);
});
