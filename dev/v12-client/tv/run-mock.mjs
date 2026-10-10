// tv agent, browser run 1 (hold the lock: dev/v12-client/.browser-lock): the mock screens + the lobby join code.
//   node dev/v12-client/tv/run-mock.mjs        server on :8266 (dev/v12-client/server.cjs, 24 bots, mock Astra), Chromium
// Measures every result row (rects inside the viewport, no two intersecting, banner hidden) at 1440x900, 1920x1080, 1280x720
// and prints the numbers; screenshots to dev/v12-client/shots/tv/.
import fs from "fs";
import path from "path";
import { measureResults as measure } from "./measure.mjs";
import { ROOT, sleep, makeLogger, installSignalHandlers, startServer, launchBig, watchPage, shootPage, runCleanups } from "../../v11-client/lib.mjs";

const PORT = 8266, BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, "dev/v12-client/shots/tv");
const log = makeLogger("tv-mock");
installSignalHandlers(log);
fs.mkdirSync(OUT, { recursive: true });
const only = new Set((process.argv[2] || "results,lobby,play").split(","));
const report = { when: new Date().toISOString(), results: {}, lobby: {}, play: {} };

const server = await startServer({ port: PORT, bots: 24, script: "dev/v12-client/server.cjs", logFile: "/tmp/v12-tv-server.log", log });
const { page } = await launchBig();
const sink = watchPage(page, "tv", log);
try {
  // ---- results at three sizes, 25 players ----
  if (only.has("results")) for (const [w, h] of [[1440, 900], [1920, 1080], [1280, 720]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${BASE}/space.html?mock=results&players=25`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hud[data-view=results] .pc", { timeout: 20000 });
    await sleep(3200); // every pop-in animation has ended (the last row starts at 1.2 s)
    const m = await page.evaluate(measure);
    report.results[`${w}x${h}`] = m;
    log(`results 25 @ ${w}x${h}: rows ${m.podium}+${m.rest}=${m.players}, board ${m.boardRows}, lowest row bottom ${m.lowestRowBottom}/${h}, card bottom ${m.cardBottom}, board lowest ${m.boardLowest}, next-round y ${m.nextRect}, banner hidden ${m.bannerHidden}, min name ${m.minNamePx}px, problems ${m.problems.length}`);
    for (const p of m.problems) log("   PROBLEM " + p);
    await shootPage(page, path.join(OUT, `results-25-${w}x${h}.png`));
  }
  // ---- other results variants at 1440x900 ----
  await page.setViewportSize({ width: 1440, height: 900 });
  if (only.has("results")) for (const [name, q] of [["nobody", "players=25&nobody"], ["players-8-chests", "players=8&reason=chests"], ["players-3", "players=3"], ["players-1", "players=1"], ["players-14", "players=14"]]) {
    await page.goto(`${BASE}/space.html?mock=results&${q}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hud[data-view=results] #resTitle", { timeout: 20000 });
    await sleep(2600);
    const m = await page.evaluate(measure);
    report.results[name] = m;
    log(`results ${name}: "${m.title}" / "${m.sub}" rows ${m.podium}+${m.rest}, lowest ${m.lowestRowBottom}, problems ${m.problems.length}`);
    for (const p of m.problems) log("   PROBLEM " + p);
    await shootPage(page, path.join(OUT, `results-${name}-1440x900.png`));
  }
  // ---- lobby with the join code from GET /info (the TV opened on 127.0.0.1) ----
  if (only.has("lobby")) for (const [w, h] of [[1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${BASE}/space.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#hud[data-view=lobby]", { timeout: 25000 });
    await sleep(3500);
    const info = await (await page.request.get(`${BASE}/info`)).json();
    const lob = await page.evaluate(async () => {
      const url = window.__bigscreen.joinUrl();
      const mod = await import("/bigscreen-extras.js");
      const canvas = document.querySelector("#qr canvas");
      let mism = -1, size = 0;
      if (canvas && url) {
        const q = mod.encodeQR(url), cells = q.size + 8, s = canvas.width / cells, g = canvas.getContext("2d");
        mism = 0; size = canvas.clientWidth;
        for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
          const px = g.getImageData(Math.round((x + 4.5) * s), Math.round((y + 4.5) * s), 1, 1).data[0];
          if ((px < 128) !== (q.modules[y * q.size + x] === 1)) mism++;
        }
      }
      const ju = document.getElementById("joinUrl"), r = ju.getBoundingClientRect(), card = document.getElementById("join").getBoundingClientRect();
      return { url, qrMismatches: mism, qrCssPx: size, text: ju.innerText, jhFontPx: parseFloat(getComputedStyle(ju.querySelector(".jh")).fontSize), urlRect: [r.left | 0, r.top | 0, r.right | 0, r.bottom | 0], cardRect: [card.left | 0, card.top | 0, card.right | 0, card.bottom | 0], hint: !!document.querySelector("#qr .qr-empty") };
    });
    report.lobby[`${w}x${h}`] = { info, ...lob };
    log(`lobby @ ${w}x${h}: /info controllerUrl ${info.controllerUrl} | QR encodes ${lob.url} (module mismatches ${lob.qrMismatches}, ${lob.qrCssPx}px) | text ${JSON.stringify(lob.text)} @ ${lob.jhFontPx}px | hint shown ${lob.hint}`);
    await shootPage(page, path.join(OUT, `lobby-info-${w}x${h}.png`));
  }
  // the override still wins; a mock lobby with 25 cards
  if (only.has("lobby")) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/space.html?join=${encodeURIComponent("https://192.168.1.77:8443/controller.html")}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hud[data-view=lobby]", { timeout: 25000 });
  await sleep(1500);
  report.lobby.override = await page.evaluate(() => {
    const jh = document.querySelector("#joinUrl .jh"), r = jh.getBoundingClientRect(), card = document.getElementById("join").getBoundingClientRect();
    return { url: window.__bigscreen.joinUrl(), text: document.getElementById("joinUrl").innerText, hostFontPx: +parseFloat(getComputedStyle(jh).fontSize).toFixed(1), hostW: Math.round(r.width), hostH: Math.round(r.height), hostInsideCard: r.left >= card.left && r.right <= card.right, cardW: Math.round(card.width) };
  });
  log("lobby ?join= override:", JSON.stringify(report.lobby.override));
  await shootPage(page, path.join(OUT, "lobby-join-override-1440x900.png"));
  await page.goto(`${BASE}/space.html?mock=lobby&players=25&bots=18`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hud[data-view=lobby]", { timeout: 25000 });
  await sleep(2500);
  await shootPage(page, path.join(OUT, "lobby-mock-25-1440x900.png"));
  }
  // ---- mock play: dense name tags with status chips, kill feed lines, the dead panel ----
  if (only.has("play")) {
  await page.goto(`${BASE}/space.html?mock=play&players=25&bots=20`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hud[data-view=play]", { timeout: 25000 });
  await sleep(1800);
  for (const t of ["⚡ ana scrambled ben's buttons", "🦑 carla inked dani's screen", "🧲 eli pulled fran in", "💣 gina hit hugo's mine (-30)", "ivan ✕ julia 💣", "💰 kai stole 750 points from lara!", "marc ✕ nora"]) { await page.evaluate((x) => window.__bigscreen.feed(x), t); await sleep(250); }
  await sleep(900);
  await shootPage(page, path.join(OUT, "play-mock-25-feed-1440x900.png"));
  report.play.tags = await page.evaluate(() => { const tags = [...document.querySelectorAll(".bse-tag")].filter((e) => e.style.display !== "none"); const modes = { m0: 0, m1: 0, m2: 0 }; for (const t of tags) modes[(t.className.match(/m\d/) || ["m0"])[0]]++; return { shown: tags.length, ...modes, chips: document.querySelectorAll(".bse-tag-st .bse-chip.on").length }; });
  log("mock play tags:", JSON.stringify(report.play.tags));
  report.play.feed = await page.evaluate(() => { const items = [...document.querySelectorAll(".bse-feed-item")]; return { lines: items.length, fontPx: items[0] ? parseFloat(getComputedStyle(items[0]).fontSize) : null, chips: document.querySelectorAll(".bse-feed-item .bse-chip").length, kos: document.querySelectorAll(".bse-feed-item.ko").length, quiet: document.querySelectorAll(".bse-feed-item.quiet").length }; });
  log("mock play feed:", JSON.stringify(report.play.feed));
  await page.goto(`${BASE}/space.html?mock=play&players=25&bots=20&dead`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hud[data-view=play]", { timeout: 25000 });
  await sleep(1800);
  await page.evaluate(() => window.__bigscreen.feed("julia ✕ ana"));
  await sleep(700);
  await shootPage(page, path.join(OUT, "play-mock-dead-1440x900.png"));
  report.play.dead = await page.evaluate(() => ({ title: document.getElementById("deadTitle").textContent, sub: document.getElementById("deadSub").textContent, whoName: document.getElementById("whoName").textContent, classes: document.getElementById("meters").className }));
  log("mock dead panel:", JSON.stringify(report.play.dead));
  await page.goto(`${BASE}/space.html?mock=play&players=25&bots=18&crowd`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hud[data-view=play]", { timeout: 25000 });
  await sleep(1800);
  await shootPage(page, path.join(OUT, "play-mock-crowd-1440x900.png"));
  report.play.crowd = await page.evaluate(() => { const tags = [...document.querySelectorAll(".bse-tag")].filter((e) => e.style.display !== "none"); const modes = { m0: 0, m1: 0, m2: 0 }; for (const t of tags) modes[(t.className.match(/m\d/) || ["m0"])[0]]++; return { shown: tags.length, ...modes }; });
  log("mock crowd tags:", JSON.stringify(report.play.crowd));
  }
} catch (e) {
  log("RUN FAILED: " + ((e && e.stack) || e));
  report.failed = String((e && e.message) || e);
} finally {
  report.console = { errors: sink.errors.map((x) => x.text).slice(0, 12), http: sink.http.slice(0, 12), warnings: sink.warnings.length };
  fs.writeFileSync(path.join(ROOT, "dev/v12-client/tv/report-mock.json"), JSON.stringify(report, null, 1));
  await runCleanups();
  log("done");
  process.exit(0);
}
