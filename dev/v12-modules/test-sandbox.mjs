// WebKit test for ctrl-sandbox.js on an iPhone landscape viewport (844 × 390, DPR 3, touch, iPhone UA).
//   node dev/v12-modules/test-sandbox.mjs [--port 8210] [--headed]
// Starts dev/v12-modules/serve.mjs on the port unless something already listens there (and stops it after).
// Proves: real touch taps, a stick drag and synthetic multi-touch reach the page as press / release / axis; held
// controls are released on destroy and on visibility change; the kit's 56 px hit minimum, slide-off and EMP swap
// work; and the hostile fixtures (network, escapes, forged messages, floods, navigation) are contained.
// Writes dev/v12-modules/shots/sandbox-*.png and dev/v12-modules/report-sandbox.json; exit 0 only if every check passed.
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const PORT = Number((argv.includes("--port") && argv[argv.indexOf("--port") + 1]) || process.env.PORT || 8210);
const HEADED = argv.includes("--headed");
const BASE = `http://127.0.0.1:${PORT}`;
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = process.env.PW_CACHE || path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
// webkit-2311 is the build the other lanes drive with this playwright-core; a newer one in the cache can hang it.
const WEBKIT = process.env.E2E_WEBKIT || path.join(CACHE, fs.existsSync(path.join(CACHE, "webkit-2311")) ? "webkit-2311" : newest("webkit"), "pw_run.sh");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const SHOTS = path.join(HERE, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, data = {}) => { results.push({ name, ok: !!ok, ...data }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(data)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) => new Promise((resolve) => { const s = net.connect(port, "127.0.0.1", () => (s.end(), resolve(true))); s.on("error", () => resolve(false)); });

let server = null;
async function startServer() {
  if (await portOpen(PORT)) return;
  server = spawn(process.execPath, [path.join(HERE, "serve.mjs"), "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  for (let i = 0; i < 50 && !(await portOpen(PORT)); i++) await sleep(100);
}
const getJson = async (p, init) => (await fetch(BASE + p, init)).json();

// Synthetic touch pointer inside the controller frame (the kit listens on its window).
async function ptr(frame, type, id, x, y) {
  await frame.evaluate(([type, id, x, y]) => {
    const target = type === "pointerdown" ? (document.elementFromPoint(x, y) || document.documentElement) : document.documentElement;
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: false, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, pressure: type === "pointerup" ? 0 : 0.5, width: 18, height: 18 }));
  }, [type, id, x, y]);
}
const ctrlFrame = (page) => page.frames().find((f) => f !== page.mainFrame());
const events = (page) => page.evaluate(() => window.__events.map((e) => ({ ...e })));
const centre = (c, W, H) => ({ x: (c.x + c.w / 2) * W, y: (c.y + c.h / 2) * H });

async function main() {
  await startServer();
  await fetch(BASE + "/api/beacons/reset");
  const { webkit } = require(PW_CORE);
  const browser = await webkit.launch({ executablePath: WEBKIT, headless: !HEADED });
  const W = 844, H = 390;
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  try {
    // ---- A. The template controller (preset full: two sticks, five buttons, a toggle) -------------------------------
    const t0 = Date.now();
    await page.goto(`${BASE}/dev/v12-modules/sandbox-demo.html?preset=full`);
    await page.waitForFunction(() => window.__ready && window.__ready.length > 0, null, { timeout: 8000 });
    const mountMs = Date.now() - t0;
    const ready = await page.evaluate(() => window.__ready);
    const layout = await page.evaluate(() => window.__layout);
    const by = (a) => ready.find((c) => c.action === a);
    check("A1 ready reports every drawn control", layout.buttons.every((b) => by(b.action)), { controls: ready.length, pageLoadToReadyMs: mountMs });
    // centres within 2% of where they were drawn, and every button at least 56 px, every stick at least 110 px
    const offsets = layout.buttons.map((b) => { const c = by(b.action); return Math.hypot((c.x + c.w / 2) - (b.x + b.w / 2), ((c.y + c.h / 2) - (b.y + b.h / 2)) * H / W); });
    const minPx = Math.min(...ready.filter((c) => c.kind !== "stick").map((c) => Math.min(c.w * W, c.h * H)));
    const minStick = Math.min(...ready.filter((c) => c.kind === "stick").map((c) => Math.min(c.w * W, c.h * H)));
    check("A2 layout: centres where drawn, buttons >= 56 px, sticks >= 110 px", Math.max(...offsets) < 0.02 && minPx >= 55.5 && minStick >= 109.5, { maxCentreOffset: +Math.max(...offsets).toFixed(4), minButtonPx: +minPx.toFixed(1), minStickPx: +minStick.toFixed(1) });
    await page.screenshot({ path: path.join(SHOTS, "sandbox-template-full.png") });

    // A3 real touch taps (WebKit touch pipeline): FIRE, then latency over 10 taps
    const fire = centre(by("shoot"), W, H);
    const lat = [];
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => (window.__events.length = 0));
      const before = await page.evaluate(() => performance.timeOrigin + performance.now());
      await page.touchscreen.tap(fire.x, fire.y);
      await page.waitForFunction(() => window.__events.some((e) => e.type === "release" && e.action === "shoot"), null, { timeout: 2000 }).catch(() => {});
      const ev = await page.evaluate(() => ({ list: window.__events.map((e) => ({ ...e })), origin: performance.timeOrigin }));
      const p = ev.list.find((e) => e.type === "press" && e.action === "shoot");
      if (p) lat.push(ev.origin + p.t - before);
    }
    const ev3 = await events(page);
    lat.sort((a, b) => a - b);
    check("A3 real touch tap → press + release shoot (10 taps)", lat.length === 10 && ev3.at(-1).type === "release", { taps: lat.length, medianTapToPressMs: +(lat[5] || 0).toFixed(1), maxMs: +(lat.at(-1) || 0).toFixed(1) });

    // A4 toggle CAM: tap on, tap off
    const cam = centre(by("view"), W, H);
    await page.evaluate(() => (window.__events.length = 0));
    await page.touchscreen.tap(cam.x, cam.y);
    await sleep(150);
    await page.touchscreen.tap(cam.x, cam.y);
    await sleep(200);
    const ev4 = (await events(page)).filter((e) => e.action === "view").map((e) => e.type);
    check("A4 toggle: tap on → press view, tap off → release view", ev4.join(",") === "press,release", { seq: ev4 });

    // A5 mouse drag on the steer stick (real pointer pipeline): right and up, then release → back to 0
    const steer = centre(by("steer"), W, H);
    await page.evaluate(() => (window.__events.length = 0));
    await page.mouse.move(steer.x, steer.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(steer.x + i * 12, steer.y - i * 8); await sleep(16); }
    await sleep(60);
    const mid5 = await page.evaluate(() => window.__events.filter((e) => e.type === "axis").at(-1));
    await page.screenshot({ path: path.join(SHOTS, "sandbox-stick-drag.png") });
    await page.mouse.up();
    await sleep(120);
    const ax5 = (await events(page)).filter((e) => e.type === "axis" && e.axis === "steer");
    check("A5 stick drag → steer axis (x > 0.6, y > 0.4 up), then 0,0 on release", mid5 && mid5.x > 0.6 && mid5.y > 0.4 && ax5.at(-1).x === 0 && ax5.at(-1).y === 0 && ax5.every((e) => Math.hypot(e.x, e.y) <= 1.0005), { axisMessages: ax5.length, peak: mid5 && [mid5.x, mid5.y], last: ax5.at(-1) && [ax5.at(-1).x, ax5.at(-1).y] });

    // A6 multi-touch: finger 11 drags the steer stick left while finger 12 holds BOOST and finger 13 holds FIRE
    const frame = ctrlFrame(page);
    const boost = centre(by("boost"), W, H);
    await page.evaluate(() => (window.__events.length = 0));
    await ptr(frame, "pointerdown", 11, steer.x, steer.y);
    await ptr(frame, "pointerdown", 12, boost.x, boost.y);
    await ptr(frame, "pointerdown", 13, fire.x, fire.y);
    for (let i = 1; i <= 6; i++) { await ptr(frame, "pointermove", 11, steer.x - i * 14, steer.y); await sleep(20); }
    await sleep(60);
    const mid6 = await page.evaluate(() => ({ down: [...document.querySelectorAll("#lamps i.on")].map((i) => i.textContent), axis: window.__events.filter((e) => e.type === "axis").at(-1) }));
    await ptr(frame, "pointerup", 12, boost.x, boost.y);
    await ptr(frame, "pointerup", 13, fire.x, fire.y);
    await ptr(frame, "pointerup", 11, steer.x - 84, steer.y);
    await sleep(100);
    const ev6 = await events(page);
    const okMulti = mid6.down.includes("boost") && mid6.down.includes("shoot") && mid6.axis && mid6.axis.x < -0.6 &&
      ev6.filter((e) => e.type === "release").length === 2 && ev6.filter((e) => e.type === "axis").at(-1).x === 0;
    check("A6 multi-touch: stick + two held buttons at once, all released", okMulti, { heldTogether: mid6.down, axisWhileHeld: mid6.axis && [mid6.axis.x, mid6.axis.y] });

    // A7 slide off a button releases it while the finger is still down
    await page.evaluate(() => (window.__events.length = 0));
    await ptr(frame, "pointerdown", 14, fire.x, fire.y);
    await ptr(frame, "pointermove", 14, fire.x - 200, fire.y - 150);
    await sleep(50);
    const ev7 = (await events(page)).map((e) => e.type + ":" + e.action);
    await ptr(frame, "pointerup", 14, fire.x - 200, fire.y - 150);
    check("A7 slide off FIRE → release before lift", ev7.join(",") === "press:shoot,release:shoot", { seq: ev7 });

    // A8 held controls are released on visibility change and on destroy (page side)
    await page.evaluate(() => (window.__events.length = 0));
    await ptr(frame, "pointerdown", 15, fire.x, fire.y);
    await ptr(frame, "pointerdown", 16, steer.x, steer.y);
    await ptr(frame, "pointermove", 16, steer.x + 60, steer.y);
    await sleep(60);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); delete document.hidden; });
    await sleep(50);
    const ev8 = await events(page);
    const relVis = ev8.some((e) => e.type === "release" && e.action === "shoot") && ev8.filter((e) => e.type === "axis").at(-1).x === 0;
    await ptr(frame, "pointerup", 15, fire.x, fire.y);
    await ptr(frame, "pointerup", 16, steer.x, steer.y);
    await page.evaluate(() => (window.__events.length = 0));
    await ptr(frame, "pointerdown", 17, boost.x, boost.y);
    await sleep(50);
    await page.evaluate(() => window.__handle.destroy());
    await sleep(50);
    const ev8b = (await events(page)).map((e) => e.type + ":" + e.action);
    const frameGone = await page.evaluate(() => !document.querySelector("#area iframe"));
    check("A8 release on visibility change and on destroy", relVis && ev8b.join(",") === "press:boost,release:boost" && frameGone, { visibility: relVis, destroySeq: ev8b, frameRemoved: frameGone });

    // A9 EMP through the kit: controls swap places, a tap at FIRE's old centre presses what moved there, then restore
    await page.evaluate(() => window.__mount(window.__template, { allowedActions: [...new Set(window.__layout.buttons.map((b) => b.action))] }));
    await page.waitForFunction(() => window.__ready, null, { timeout: 5000 });
    await page.evaluate(() => { window.__empDone = null; window.__handle.fx("emp", { seconds: 1.6, seed: 7 }).then((r) => (window.__empDone = r)); });
    await sleep(450);
    const swapped = await page.evaluate(() => window.__handle.controls());
    await page.screenshot({ path: path.join(SHOTS, "sandbox-emp.png") });
    const movedTo = swapped.find((c) => c.kind !== "stick" && Math.hypot((c.x + c.w / 2) * W - fire.x, (c.y + c.h / 2) * H - fire.y) < 6);
    await page.evaluate(() => (window.__events.length = 0));
    await page.touchscreen.tap(fire.x, fire.y);
    await sleep(150);
    const ev9 = (await events(page)).find((e) => e.type === "press");
    const movedCount = swapped.filter((c) => { const o = by(c.action); return Math.hypot((c.x - o.x) * W, (c.y - o.y) * H) > 20; }).length;
    await page.waitForFunction(() => window.__empDone, null, { timeout: 4000 });
    await sleep(400);
    const back = await page.evaluate(() => window.__handle.controls());
    const restored = back.every((c) => { const o = by(c.action); return Math.hypot((c.x - o.x) * W, (c.y - o.y) * H) < 2; });
    check("A9 EMP: every control moved, tap at FIRE's old place presses the one now there, restored after", movedCount === ready.length && movedTo && ev9 && ev9.action === movedTo.action && movedTo.action !== "shoot" && restored,
      { moved: movedCount, of: ready.length, tapAtOldFire: ev9 && ev9.action, map: await page.evaluate(() => window.__empDone && window.__empDone.map), restored });

    // A10 the 56 px minimum: a 20 px dot still takes a tap 24 px from its centre; disabled controls are greyed but still press
    await page.evaluate(() => window.__mount('<!doctype html><html><body><div data-action="shoot" style="position:absolute;left:400px;top:180px;width:20px;height:20px;background:#5ee7ff;border-radius:50%"></div></body></html>', { allowedActions: ["shoot"] }));
    await page.waitForFunction(() => window.__ready, null, { timeout: 5000 });
    await page.evaluate(() => (window.__events.length = 0));
    await page.touchscreen.tap(410 + 24, 190);
    await sleep(120);
    const hitFar = (await events(page)).some((e) => e.type === "press" && e.action === "shoot");
    await page.evaluate(() => window.__handle.setDisabled(["shoot"]));
    await sleep(80);
    const greyed = await ctrlFrame(page).evaluate(() => document.querySelector("[data-action]").classList.contains("is-disabled"));
    await page.evaluate(() => (window.__events.length = 0));
    await page.touchscreen.tap(410, 190);
    await sleep(120);
    const stillPress = (await events(page)).some((e) => e.type === "press");
    await page.touchscreen.tap(410 + 50, 190);
    await sleep(120);
    const tooFar = (await events(page)).filter((e) => e.type === "press").length === 1;
    check("A10 56 px hit minimum (a 20 px dot, tap 24 px off-centre), greyed controls still press, 50 px off misses", hitFar && greyed && stillPress && tooFar, { hitAt24px: hitFar, greyed, pressWhileGreyed: stillPress, missAt50px: tooFar });

    // A11 replace(): Sol's document loads hidden and goes live only after the held FIRE is released; one frame left
    const solHtml = fs.readFileSync(path.join(HERE, "corpus/out/c01-basic.html"), "utf8");
    await page.evaluate(() => window.__mount(window.__template, { allowedActions: ["steer", "shoot", "boost"], requiredActions: ["steer", "shoot", "boost"] }));
    await page.waitForFunction(() => window.__ready, null, { timeout: 5000 });
    const basicFire = await page.evaluate(() => { const c = window.__ready.find((k) => k.action === "shoot"); return { x: (c.x + c.w / 2) * innerWidth, y: (c.y + c.h / 2) * innerHeight }; });
    const oldFrame = ctrlFrame(page);
    await page.evaluate(() => (window.__events.length = 0));
    await ptr(oldFrame, "pointerdown", 21, basicFire.x, basicFire.y);
    await page.evaluate((html) => { window.__replaced = null; window.__handle.replace(html).then((ok) => (window.__replaced = { ok, at: performance.now() })); }, solHtml);
    await sleep(700);
    const whileHeld = await page.evaluate(() => ({ replaced: window.__replaced, frames: document.querySelectorAll("#area iframe").length, busy: window.__handle.busy() }));
    const releasedAt = await page.evaluate(() => performance.now());
    await ptr(oldFrame, "pointerup", 21, basicFire.x, basicFire.y);
    await page.waitForFunction(() => window.__replaced, null, { timeout: 3000 }).catch(() => {});
    const after = await page.evaluate(() => ({ replaced: window.__replaced, frames: document.querySelectorAll("#area iframe").length, ev: window.__events.map((e) => e.type + ":" + e.action), opacity: getComputedStyle(document.querySelector("#area iframe")).opacity }));
    // onReady fires again for the new document: tap FIRE where Sol put it
    const solFire = await page.evaluate(() => { const c = window.__ready.find((k) => k.action === "shoot"); return { x: (c.x + c.w / 2) * innerWidth, y: (c.y + c.h / 2) * innerHeight }; });
    await page.evaluate(() => (window.__events.length = 0));
    await page.touchscreen.tap(solFire.x, solFire.y);
    await sleep(150);
    const evNew = (await events(page)).map((e) => e.type + ":" + e.action);
    const swapMs = after.replaced ? after.replaced.at - releasedAt : null;
    check("A11 replace(): waits while FIRE is held, swaps right after release, one frame left, new FIRE works", !whileHeld.replaced && whileHeld.frames === 2 && whileHeld.busy && after.replaced && after.replaced.ok && after.frames === 1 && after.ev.join(",") === "press:shoot,release:shoot" && evNew.join(",") === "press:shoot,release:shoot",
      { heldNoSwap: !whileHeld.replaced, framesWhileLoading: whileHeld.frames, swapAfterReleaseMs: swapMs && +swapMs.toFixed(0), framesAfter: after.frames, newTap: evNew });
    const bad = await page.evaluate(() => window.__handle.replace('<!doctype html><body><div data-action="shoot" style="position:absolute;left:10px;top:10px;width:80px;height:80px">only fire</div></body>'));
    const stillOne = await page.evaluate(() => document.querySelectorAll("#area iframe").length);
    check("A12 replace() with a document missing drawn controls is discarded; the live one stays", bad === false && stillOne === 1, { result: bad, frames: stillOne });
    await page.screenshot({ path: path.join(SHOTS, "sandbox-replaced-sol.png") });

    // ---- B. A hostile controller: everything contained ----------------------------------------------------------------
    await fetch(BASE + "/api/beacons/reset");
    const hostile = fs.readFileSync(path.join(HERE, "fixtures/malicious.html"), "utf8");
    const pagesBefore = context.pages().length;
    const urlBefore = page.url();
    await page.evaluate((html) => window.__mount(html, { allowedActions: ["shoot", "steer"] }), hostile);
    await page.waitForFunction(() => window.__ready, null, { timeout: 5000 });
    await sleep(3200); // the burst flood runs at 600 ms; the last axis value is due one window later
    const b = await page.evaluate(() => ({ ev: window.__events.map((e) => ({ ...e })), viol: window.__violations.map((v) => v.kind + ":" + v.detail), ready: window.__ready, bodyOk: !!document.getElementById("area"), stats: window.__handle.stats() }));
    const beacons = await getJson("/api/beacons");
    const ch = await ctrlFrame(page).evaluate(() => window.__ch).catch(() => null);
    const presses = b.ev.filter((e) => e.type === "press"), releases = b.ev.filter((e) => e.type === "release");
    const steerAx = b.ev.filter((e) => e.type === "axis" && e.axis === "steer");
    check("B1 no request leaves the frame (fetch, XHR, WebSocket, beacon, img, css, link, import, worker, iframe, form, popup)", beacons.length === 0, { beaconHits: beacons.length, hits: beacons.map((x) => x.path) });
    check("B2 no escape: page URL, page DOM and page count unchanged", page.url() === urlBefore && b.bodyOk && context.pages().length === pagesBefore, { url: page.url() === urlBefore, dom: b.bodyOk, pages: context.pages().length });
    check("B3 forged messages: unknown action, stick press, disallowed axis, NaN, bad type, wrong channel all dropped", !presses.some((e) => e.action !== "shoot") && b.viol.some((v) => v.startsWith("action:nuke")) && b.viol.some((v) => v.startsWith("action:move")) && !b.ready.some((c) => c.action === "nuke") && !!ch,
      { attackerReadNonce: !!ch, violations: b.viol.slice(0, 8), dropped: b.stats.dropped });
    check("B4 flood: ≤ 60 presses per second, every press released, nothing stuck", presses.length <= 61 && presses.length === releases.length && b.stats.down.length === 0, { pressesDelivered: presses.length, releasesDelivered: releases.length, droppedByRate: b.stats.dropped.rate });
    check("B5 axis: clamped to -1..1 and the last value still arrives (0.25, -0.5)", steerAx.every((e) => Math.abs(e.x) <= 1 && Math.abs(e.y) <= 1) && steerAx.length <= 62 && steerAx.at(-1).x === 0.25 && steerAx.at(-1).y === -0.5,
      { axisDelivered: steerAx.length, first: steerAx[0] && [steerAx[0].x, steerAx[0].y], last: steerAx.at(-1) && [steerAx.at(-1).x, steerAx.at(-1).y] });
    await page.evaluate(() => (window.__events.length = 0));
    await page.touchscreen.tap(0.72 * W + 75, 0.55 * H + 45); // FIRE
    await page.touchscreen.tap(0.40 * W + 50, 0.62 * H + 35); // NUKE
    await sleep(200);
    const ev10 = (await events(page)).map((e) => e.type + ":" + e.action);
    check("B6 inside the hostile document a real FIRE tap still works and NUKE does nothing", ev10.join(",") === "press:shoot,release:shoot", { seq: ev10 });
    await page.screenshot({ path: path.join(SHOTS, "sandbox-hostile.png") });

    // ---- C. A sustained flood is cut off: the fallback controller takes over ----------------------------------------
    const flood = fs.readFileSync(path.join(HERE, "fixtures/malicious-flood.html"), "utf8");
    await page.evaluate((html) => window.__mount(html, { allowedActions: ["shoot", "boost", "steer"], fallbackHtml: window.__template.replace(/x/, "x") }), flood);
    await page.waitForFunction(() => window.__handle.usingFallback, null, { timeout: 9000 }).catch(() => {});
    await page.waitForFunction(() => window.__ready && window.__handle.usingFallback, null, { timeout: 4000 }).catch(() => {});
    const c = await page.evaluate(() => ({ fb: window.__handle.usingFallback, viol: window.__violations.map((v) => v.kind), stats: window.__handle.stats() }));
    check("C1 sustained flood → 'flood' violation and the fallback controller mounted", c.fb && c.viol.includes("flood"), { usingFallback: c.fb, droppedByRate: c.stats.dropped.rate, fallbackReason: c.stats.fallbackReason });

    // ---- D. Navigation away: refused by the page CSP mountController adds; without it, caught by the second load ----
    const nav = fs.readFileSync(path.join(HERE, "fixtures/malicious-nav.html"), "utf8");
    const mountNav = (pg) => pg.evaluate((html) => window.__mount(html, { allowedActions: ["shoot", "boost", "steer"], requiredActions: ["shoot"], fallbackHtml: window.__template }), nav);
    await fetch(BASE + "/api/beacons/reset");
    const page2 = await context.newPage();
    await page2.goto(`${BASE}/dev/v12-modules/sandbox-demo.html?preset=basic&pagecsp=0`);
    await page2.waitForFunction(() => window.__ready, null, { timeout: 5000 });
    await mountNav(page2);
    await page2.waitForFunction(() => window.__violations.some((v) => v.kind === "navigate"), null, { timeout: 5000 }).catch(() => {});
    await page2.waitForFunction(() => window.__handle.usingFallback && window.__ready && window.__ready.length === 3, null, { timeout: 3000 }).catch(() => {});
    const d = await page2.evaluate(() => ({ fb: window.__handle.usingFallback, viol: window.__violations.map((v) => v.kind), ready: window.__ready && window.__ready.length }));
    const navHits = (await getJson("/api/beacons")).length;
    check("D1 without the page CSP: the frame navigating itself is caught (second load) and the fallback mounted", d.fb && d.viol.includes("navigate") && d.ready === 3, { usingFallback: d.fb, violations: d.viol, fallbackControls: d.ready, requestLeft: navHits });
    await page2.close();
    await fetch(BASE + "/api/beacons/reset");
    const page3 = await context.newPage();
    await page3.goto(`${BASE}/dev/v12-modules/sandbox-demo.html?preset=basic`);
    await page3.waitForFunction(() => window.__ready, null, { timeout: 5000 });
    await mountNav(page3);
    const mountedWithCsp = await page3.waitForFunction(() => window.__ready, null, { timeout: 5000 }).then(() => true).catch(() => false);
    await sleep(1500);
    const navHits2 = (await getJson("/api/beacons")).length;
    const d2 = await page3.evaluate(() => ({ csp: !!document.querySelector("meta[data-ctrl-sandbox-csp]"), viol: window.__violations.map((v) => v.kind), fb: window.__handle.usingFallback }));
    check("D2 default page CSP (frame-src 'none'): srcdoc frame still mounts, the navigation request never leaves", mountedWithCsp && navHits2 === 0 && d2.csp, { mounted: mountedWithCsp, cspMeta: d2.csp, beaconHits: navHits2, violations: d2.viol, usingFallback: d2.fb });
    await page3.close();
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  const pass = results.every((r) => r.ok);
  const report = { at: new Date().toISOString(), browser: "webkit", viewport: "844x390@3 touch", pass, results };
  fs.writeFileSync(path.join(HERE, "report-sandbox.json"), JSON.stringify(report, null, 2));
  console.log(`\n${pass ? "ALL PASS" : "FAILED"}: ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error(err); if (server) server.kill(); process.exit(1); });
