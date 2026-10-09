// Phone lane browser test: WebKit, iPhone 390x844 / 844x390, DPR 3, iPhone UA, touch.
// Needs the mock server running: node dev/phone/mock-server.js
// Playwright is not a repo dependency; point PW_CORE at any existing playwright-core and WK at a cached WebKit:
//   PW_CORE=/path/to/node_modules/playwright-core WK=~/Library/Caches/ms-playwright/webkit-XXXX/pw_run.sh node dev/phone/test.cjs
const path = require("path");
const fs = require("fs");
const { webkit } = require(process.env.PW_CORE);
const BASE = "http://localhost:8103";
const SHOTS = path.join(__dirname, "shots");
const LOG = path.join(__dirname, "mock.log");
fs.mkdirSync(SHOTS, { recursive: true });
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`); };
const logLines = () => fs.readFileSync(LOG, "utf8").split("\n");
const since = (mark) => logLines().slice(mark);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = (page, m) => page.evaluate((m) => fetch("/mock", { method: "POST", body: JSON.stringify(m) }).then((r) => r.json()), m);

(async () => {
  const browser = await webkit.launch({ executablePath: process.env.WK });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + ".png") });
  const go = async (url) => { await page.goto(BASE + url, { waitUntil: "commit" }); await page.waitForFunction(() => document.readyState === "complete"); };
  const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none"; }, sel);

  // 0. sample notebook photos
  await go("/dev/phone/sample.html");
  await page.waitForFunction(() => document.title === "saved", null, { timeout: 15000 });
  ok("sample photos made", fs.existsSync(path.join(__dirname, "sample-notebook.jpg")) && fs.existsSync(path.join(__dirname, "sample-button.jpg")));

  // 1. join (portrait)
  await go("/controller.html");
  await page.evaluate(() => localStorage.clear());
  await go("/controller.html");
  await shot("01-join-390x844");
  let mark = logLines().length - 1;
  await page.fill("#name", "Ada Lovelace!");
  await page.tap("#joinForm button");
  await page.waitForFunction(() => window.__sp.screen === "draw");
  ok("join cleans the name", (await page.evaluate(() => window.__sp.player)) === "adalovelace", await page.evaluate(() => window.__sp.player + " " + window.__sp.color));
  ok("join stored", (await page.evaluate(() => localStorage.getItem("sp.player"))) === '"adalovelace"');
  ok("camera is the default draw mode", await vis("#camCard") && !(await vis("#drawPad")));
  await shot("02-camera-390x844");

  // 2. camera flow with the sample notebook photo
  mark = logLines().length - 1;
  await page.setInputFiles("#camInput", path.join(__dirname, "sample-notebook.jpg"));
  await page.waitForFunction(() => !document.getElementById("camPreview").classList.contains("hidden"), null, { timeout: 10000 });
  const photoMs = await page.evaluate(() => window.__lastPhotoMs);
  const dims = await page.evaluate(() => { const i = document.getElementById("camPreview"); return [i.naturalWidth, i.naturalHeight]; });
  ok("photo processed to landscape 512 px", dims[0] === 512 && dims[1] < 512 && dims[1] > 150, `${dims[0]}x${dims[1]} in ${photoMs} ms`);
  await shot("03-photo-preview-390x844");
  await sleep(300);
  let gen = since(mark).filter((l) => l.includes("GENERATE"));
  ok("photo sent as soon as processed", gen.some((l) => /kind=controller source=photo speculative=true/.test(l) && /png=512x/.test(l)), gen.join(" | "));
  await page.tap("#camUse");
  await page.waitForFunction(() => window.__sp.screen === "play", null, { timeout: 5000 });
  ok("Use it → playable layout", (await page.evaluate(() => window.__sp.layout.buttons.length)) === 3);
  await shot("04-play-portrait-rotate-390x844");
  ok("rotate overlay in portrait during play", await vis("#rotate"));

  // 3. landscape: play screen, lobby banner
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(400);
  ok("no rotate overlay in landscape", !(await vis("#rotate")));
  ok("lobby banner with Ready", await vis("#banner") && await vis("#readyBtn"));
  await shot("05-lobby-844x390");
  mark = logLines().length - 1;
  await page.tap("#readyBtn");
  await sleep(400);
  ok("Ready sends the ready action", since(mark).some((l) => l.includes('"action":"ready","down":true')));

  // 4. redraw with the draw toggle, speculative generate, Done
  await page.tap("#redrawBtn");
  await page.waitForFunction(() => window.__sp.screen === "draw");
  await page.tap('#drawSeg [data-mode="draw"]');
  ok("draw toggle shows the pad", await vis("#drawPad"));
  ok("draw mode remembered", (await page.evaluate(() => localStorage.getItem("sp.drawMode"))) === '"draw"');
  mark = logLines().length - 1;
  const stroke = async (pts) => { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 4 }); await page.mouse.up(); };
  await stroke([[150, 250], [200, 200], [250, 250], [200, 300], [150, 250]]);   // stick circle
  await stroke([[620, 220], [760, 220], [760, 330], [620, 330], [620, 220]]);   // FIRE box
  await sleep(600);
  ok("no speculative call before 1.2 s", !since(mark).some((l) => l.includes("GENERATE")));
  await sleep(1000);
  gen = since(mark).filter((l) => l.includes("GENERATE"));
  ok("speculative generate 1.2 s after the last stroke", gen.length === 1 && /source=draw speculative=true/.test(gen[0]) && /png=512x/.test(gen[0]), gen.join(" | "));
  await shot("06-draw-844x390");
  const t0 = Date.now();
  await page.tap("#done");
  await sleep(150);
  await shot("07-generating-844x390");
  await page.waitForFunction(() => window.__sp.screen === "play", null, { timeout: 5000 });
  const doneMs = Date.now() - t0;
  gen = since(mark).filter((l) => l.includes("GENERATE"));
  ok("Done confirms the speculative answer (non-speculative call counts the drawing)", gen.length === 2 && /speculative=true/.test(gen[0]) && /speculative=false/.test(gen[1]), `${gen.length} generate calls, play after ${doneMs} ms`);
  // render.js compiles shaders and loads assets on its first frames; let it warm up before timing the stick
  await page.waitForFunction(() => new Promise((ok) => { let n = 0, last = performance.now(), worst = 0; const f = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (++n < 30) requestAnimationFrame(f); else ok(worst < 100); }; requestAnimationFrame(f); }), null, { timeout: 20000, polling: 500 });
  await shot("08-play-844x390");

  // 5. multi-touch: drag the stick while pressing FIRE (synthetic touch pointers with distinct ids)
  mark = logLines().length - 1;
  const res = await page.evaluate(async () => {
    const hits = document.getElementById("hits"), r = hits.getBoundingClientRect();
    const L = window.__sp.layout.buttons;
    const stick = L.find((b) => b.type === "stick"), fire = L.find((b) => b.action === "shoot");
    const at = (b, fx = 0.5, fy = 0.5) => ({ clientX: r.left + (b.x + b.w * fx) * r.width, clientY: r.top + (b.y + b.h * fy) * r.height });
    const ev = (type, id, p) => hits.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 11, bubbles: true, cancelable: true, ...p }));
    ev("pointerdown", 11, at(stick));
    const t = performance.now();
    let moves = 0;
    while (performance.now() - t < 1000) { const k = (performance.now() - t) / 1000; ev("pointermove", 11, at(stick, 0.5 + 0.45 * Math.cos(k * 6), 0.5 + 0.45 * Math.sin(k * 6))); moves++; if (moves === 10) ev("pointerdown", 12, at(fire)); await new Promise((r) => setTimeout(r, 8)); }
    const fireDown = document.querySelector(".hit.down:not(.stick)") !== null;
    ev("pointerup", 12, at(fire));
    ev("pointerup", 11, at(stick));
    return { moves, fireDown };
  });
  await sleep(500);
  let lines = since(mark).filter((l) => l.includes("INPUT"));
  const axisLines = lines.filter((l) => l.includes('"axis":"steer"'));
  const times = axisLines.map((l) => l.slice(0, 12));
  ok("stick sends steer axis at most 20/s", axisLines.length >= 15 && axisLines.length <= 22, `${axisLines.length} axis messages for ${res.moves} moves in ~1 s`);
  ok("stick sends a zero on release", /"x":0,"y":0/.test(axisLines[axisLines.length - 1] || ""), axisLines[axisLines.length - 1]);
  ok("FIRE pressed during the drag", res.fireDown && lines.some((l) => l.includes('"action":"shoot","down":true')) && lines.some((l) => l.includes('"action":"shoot","down":false')), "fire is normalised to shoot");
  ok("all inputs contract-valid", !lines.some((l) => l.includes("INVALID")));
  fs.writeFileSync(path.join(__dirname, "input-lines.txt"), lines.join("\n"));

  // sliding off a button releases it; pointercancel releases all
  mark = logLines().length - 1;
  await page.evaluate(() => {
    const hits = document.getElementById("hits"), r = hits.getBoundingClientRect();
    const b = window.__sp.layout.buttons.find((b) => b.action === "boost");
    const ev = (type, id, x, y) => hits.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", bubbles: true, cancelable: true, clientX: r.left + x * r.width, clientY: r.top + y * r.height }));
    ev("pointerdown", 21, b.x + b.w / 2, b.y + b.h / 2);
    ev("pointermove", 21, b.x - 0.05, b.y + b.h / 2);
    const fire = window.__sp.layout.buttons.find((b) => b.action === "shoot");
    ev("pointerdown", 22, fire.x + fire.w / 2, fire.y + fire.h / 2);
    ev("pointercancel", 22, fire.x + fire.w / 2, fire.y + fire.h / 2);
  });
  await sleep(400);
  lines = since(mark).filter((l) => l.includes("INPUT"));
  const bi = lines.findIndex((l) => l.includes('"action":"boost","down":true')), bo = lines.findIndex((l) => l.includes('"action":"boost","down":false'));
  ok("sliding off a button releases it (down arrives before up)", bi >= 0 && bo > bi, lines.join(" | "));
  ok("pointercancel releases all", lines.some((l) => l.includes('"action":"shoot","down":false')));
  fs.appendFileSync(path.join(__dirname, "input-lines.txt"), "\n" + lines.join("\n"));

  // real WebKit touch tap on BOOST
  mark = logLines().length - 1;
  const boostBox = await page.evaluate(() => { const r = document.getElementById("hits").getBoundingClientRect(); const b = window.__sp.layout.buttons.find((b) => b.action === "boost"); return { x: r.left + (b.x + b.w / 2) * r.width, y: r.top + (b.y + b.h / 2) * r.height }; });
  await page.touchscreen.tap(boostBox.x, boostBox.y);
  await sleep(400);
  lines = since(mark).filter((l) => l.includes("INPUT"));
  ok("touchscreen tap presses BOOST", lines.some((l) => l.includes('"action":"boost","down":true')) && lines.some((l) => l.includes('"action":"boost","down":false')), lines.join(" | "));
  fs.appendFileSync(path.join(__dirname, "input-lines.txt"), "\n" + lines.join("\n"));

  // 6. HUD: DOM work per second while playing
  await mock(page, { phase: "playing" });
  await sleep(500);
  const dom = await page.evaluate(() => new Promise((done) => {
    let n = 0; const mo = new MutationObserver((m) => (n += m.length));
    mo.observe(document.getElementById("play"), { subtree: true, childList: true, attributes: true, characterData: true });
    setTimeout(() => { mo.disconnect(); done(n); }, 3000);
  }));
  const clockA = await page.textContent("#clock"); await sleep(1100); const clockB = await page.textContent("#clock");
  ok("clock counts up while playing", clockA !== clockB && clockB.startsWith("0:0"), `${clockA} → ${clockB}`);
  ok("objective from the contract", (await page.textContent("#obj")) === "REACH THE BOSS", await page.textContent("#obj"));
  ok("DOM HUD work is small", dom / 3 <= 60, `${(dom / 3).toFixed(1)} DOM mutations per second (HUD at 10 Hz)`);
  await shot("09-hud-playing-844x390");

  // 7a. sketch hint (riddle step 2): faint drawing on an empty corner of the pad, no word
  await mock(page, { toast: { player: "adalovelace", text: "Too tough to shoot through. What breaks rock?", sketch: "drill", ghost: null } });
  await page.waitForFunction(() => document.getElementById("sketch").classList.contains("on"), null, { timeout: 3000 });
  await sleep(1600);
  await shot("09b-sketch-hint-844x390");
  ok("sketch hint drawn faintly", (await page.evaluate(() => document.getElementById("sketch").dataset.sketch)) === "drill");

  // 7. ghost toast → add a button by drawing
  const toastSeen = await page.waitForFunction(() => !!document.getElementById("ghost"), null, { timeout: 12000 }).then(() => true).catch(() => false);
  if (!toastSeen) await mock(page, { toast: { player: "adalovelace", text: "Draw a LAND button", ghost: { action: "land", x: 0.4, y: 0.3, w: 0.2, h: 0.3 } } });
  await page.waitForSelector("#ghost", { timeout: 3000 });
  ok("ghost box from the server toast (10 s after join)", toastSeen);
  await shot("10-ghost-toast-844x390");
  await page.tap("#ghost");
  ok("tapping the ghost opens add-a-button in draw mode", await vis("#add") && await vis("#addPad"));
  const g = await page.evaluate(() => document.getElementById("addRegion").getBoundingClientRect().toJSON());
  await stroke([[g.x + 10, g.y + 10], [g.x + g.width - 10, g.y + 10], [g.x + g.width - 10, g.y + g.height - 10], [g.x + 10, g.y + g.height - 10], [g.x + 10, g.y + 10]]);
  await stroke([[g.x + 30, g.y + 40], [g.x + 30, g.y + 80], [g.x + 55, g.y + 80]]);
  await shot("11-add-draw-844x390");
  mark = logLines().length - 1;
  await page.tap("#addDone");
  await page.waitForFunction(() => window.__sp.layout.buttons.some((b) => b.action === "land"), null, { timeout: 5000 });
  gen = since(mark).filter((l) => l.includes("GENERATE"));
  ok("add-a-button posts kind=button with the ghost region", gen.length === 1 && /kind=button/.test(gen[0]) && gen[0].includes('region={"x":0.4,"y":0.3,"w":0.2,"h":0.3}'), gen.join(" | "));
  ok("ghost cleared once LAND exists", !(await page.$("#ghost")));
  await sleep(300);
  await shot("12-land-added-844x390");
  mark = logLines().length - 1;
  const landBox = await page.evaluate(() => { const r = document.getElementById("hits").getBoundingClientRect(); const b = window.__sp.layout.buttons.find((b) => b.action === "land"); return { x: r.left + (b.x + b.w / 2) * r.width, y: r.top + (b.y + b.h / 2) * r.height }; });
  await page.touchscreen.tap(landBox.x, landBox.y);
  await sleep(400);
  lines = since(mark).filter((l) => l.includes("INPUT"));
  ok("LAND button sends land", lines.some((l) => l.includes('"action":"land","down":true')), lines.join(" | "));
  fs.appendFileSync(path.join(__dirname, "input-lines.txt"), "\n" + lines.join("\n"));

  // add a button by photo with "+"
  await page.tap("#tAdd");
  await page.tap('#addSeg [data-mode="camera"]');
  mark = logLines().length - 1;
  await page.setInputFiles("#addInput", path.join(__dirname, "sample-button.jpg"));
  await page.waitForFunction(() => !document.getElementById("addPreview").classList.contains("hidden"), null, { timeout: 10000 });
  await shot("13-add-photo-844x390");
  await page.tap("#addDone");
  await page.waitForFunction(() => document.getElementById("add").classList.contains("hidden"), null, { timeout: 5000 });
  gen = since(mark).filter((l) => l.includes("GENERATE"));
  const nLand = await page.evaluate(() => window.__sp.layout.buttons.filter((b) => b.action === "land").length);
  ok("photo button merges (replaces same action)", gen.length === 1 && /kind=button source=photo/.test(gen[0]) && nLand === 1, gen.join(" | "));
  await sleep(300);
  ok("drawings left shown (4 finished: photo, draw, LAND x2)", (await page.textContent("#leftBadge")) === "1", await page.textContent("#leftBadge"));
  await mock(page, { left: { space: 0 } });
  await sleep(300);
  await page.tap("#tAdd");
  await sleep(200);
  ok("no drawings left closes add-a-button", !(await vis("#add")) && (await page.textContent("#toast")).includes("No drawings left"), await page.textContent("#toast"));
  await mock(page, { left: { space: 5 } });

  // 8. view toggle + tilt toggle
  await page.tap("#tView");
  ok("view toggle → cockpit", (await page.evaluate(() => window.__sp.view)) === "cockpit");
  await page.tap("#tTilt");
  await sleep(200);
  ok("tilt toggle responds", (await page.evaluate(() => !!window.__sp.tilt || document.getElementById("toast").textContent.includes("HTTPS"))), await page.evaluate(() => document.getElementById("toast").textContent));

  // 9. landing: no control while the animation plays, then the explorer prompt after touchdown
  await mock(page, { landing: true });
  await sleep(400);
  mark = logLines().length - 1;
  await page.touchscreen.tap(landBox.x, landBox.y);
  await sleep(300);
  ok("controls locked and faded while landing", (await page.evaluate(() => getComputedStyle(document.getElementById("area")).opacity)) < 0.5 && !since(mark).some((l) => l.includes("INPUT")));
  await shot("13b-landing-locked-844x390");
  await mock(page, { mode: "planet" });
  await sleep(500);
  ok("no explorer prompt during the landing animation", !(await vis("#explorer")));
  await mock(page, { landing: false });
  await page.waitForFunction(() => !document.getElementById("explorer").classList.contains("hidden"), null, { timeout: 3000 });
  ok("explorer prompt on landing, camera by default", await vis("#expShot"));
  await shot("14-explorer-prompt-844x390");
  mark = logLines().length - 1;
  await page.setInputFiles("#expInput", path.join(__dirname, "sample-button.jpg"));
  await page.waitForFunction(() => document.getElementById("explorer").classList.contains("hidden"), null, { timeout: 5000 });
  ok("explorer photo posted as kind=explorer", since(mark).some((l) => /GENERATE kind=explorer source=photo/.test(l)));

  // 10. scoreboard
  await mock(page, { phase: "scoreboard", mode: "space" });
  await sleep(400);
  ok("scoreboard shows scores", await vis("#scores") && (await page.evaluate(() => document.querySelectorAll("#scores li").length)) >= 1);
  await shot("15-scoreboard-844x390");

  // 11. refresh rejoins and keeps the layout
  mark = logLines().length - 1;
  await go("/controller.html");
  await page.waitForFunction(() => window.__sp && window.__sp.screen === "play", null, { timeout: 5000 });
  ok("refresh rejoins with the same name and layout", since(mark).some((l) => l.includes("JOIN adalovelace")) && (await page.evaluate(() => window.__sp.layout.buttons.length)) === 4);
  await sleep(500);
  await shot("16-after-refresh-844x390");

  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
