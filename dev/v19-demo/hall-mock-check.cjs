// Checks the MOCK hall of fame (hall-of-fame.html?mock=1): 12-16 ranked entries, each with its drawing, a live 3D model,
// a score and a comment; no console errors; no /hall, /hall/judge or /hall/reset request in mock mode; the MOCK toggle
// switches to the live hall and back. Screenshots dev/v19-demo/hall-mock.png (desktop) and hall-mock-phone.png.
//   BASE=http://localhost:8191 node dev/v19-demo/hall-mock-check.cjs   (a scratch server: HALL_DIR=... HALL_MOCK=1 ...)
const { chromium } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8191";
const OUT = __dirname;

async function check(browser, name, viewport, shot) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [], reqs = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => reqs.push(`${r.method()} ${r.url()}`));
  await page.goto(`${BASE}/hall-of-fame.html?mock=1`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll(".card, .row").length >= 12, null, { timeout: 15000 });
  // let the 3D models build (one per frame; visible first): scroll through the page so every view gets a turn
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= h; y += Math.round(viewport.height * 0.6)) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(700); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll("#podium .card, #list .row")];
    return {
      mockOn: document.getElementById("mockBtn").getAttribute("aria-pressed"),
      judgeVisible: getComputedStyle(document.getElementById("judgeBtn")).visibility,
      status: document.getElementById("statusText").textContent,
      entries: els.map((el) => {
        const img = el.querySelector(".pane.draw img"), cv = el.querySelector(".pane.gen canvas"), note = el.querySelector(".pane.gen .note");
        let lit = 0;
        if (cv && cv.width > 1) { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) lit++; }
        return { rank: (el.querySelector(".medal, .rk") || {}).textContent, name: el.querySelector(".name").textContent, score: el.querySelector(".score").textContent.trim(),
          comment: el.querySelector(".comment").textContent, img: img && img.complete && img.naturalWidth > 0, canvasPx: lit, note: note ? note.textContent : "" };
      }),
    };
  });
  if (shot) await page.screenshot({ path: path.join(OUT, shot), fullPage: name === "desktop" ? false : false });
  // the toggle: off (live /hall) and back on
  let toggled = null;
  if (name === "desktop") {
    if (shot) await page.screenshot({ path: path.join(OUT, "hall-mock-full.png"), fullPage: true });
    const before = reqs.length;
    await page.click("#mockBtn");
    await page.waitForTimeout(1500);
    const live = await page.evaluate(() => ({ url: location.search, pressed: document.getElementById("mockBtn").getAttribute("aria-pressed"), n: document.querySelectorAll(".card, .row").length, status: document.getElementById("statusText").textContent }));
    const liveReqs = reqs.slice(before).filter((r) => /\/hall(\?|$|\/)/.test(new URL(r.split(" ")[1]).pathname + "?"));
    await page.click("#mockBtn");
    await page.waitForTimeout(1500);
    const back = await page.evaluate(() => ({ url: location.search, n: document.querySelectorAll(".card, .row").length }));
    toggled = { live, liveHallRequests: liveReqs.length, back };
    reqs.length = before; // only the mock-mode requests are judged below
  }
  const apiReqs = reqs.filter((r) => { const p = new URL(r.split(" ")[1]).pathname; return p === "/hall" || p.startsWith("/hall/"); });
  await ctx.close();
  return { name, errors, apiReqs, ...info, toggled };
}

(async () => {
  const exe = `${require("os").homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const browser = await chromium.launch({ ...(fs.existsSync(exe) ? { executablePath: exe } : {}), args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const out = [];
  out.push(await check(browser, "desktop", { width: 1440, height: 900 }, "hall-mock.png"));
  out.push(await check(browser, "phone", { width: 390, height: 844 }, "hall-mock-phone.png"));
  await browser.close();
  for (const r of out) {
    const no3d = r.entries.filter((e) => e.canvasPx < 50).map((e) => e.name);
    const noImg = r.entries.filter((e) => !e.img).map((e) => e.name);
    console.log(`\n== ${r.name}: ${r.entries.length} entries, mock toggle pressed=${r.mockOn}, judge button ${r.judgeVisible}, status "${r.status}"`);
    console.log(`console errors: ${r.errors.length}${r.errors.length ? "\n  " + r.errors.join("\n  ") : ""}`);
    console.log(`/hall API requests in mock mode: ${r.apiReqs.length}${r.apiReqs.length ? "\n  " + r.apiReqs.join("\n  ") : ""}`);
    console.log(`drawings missing: ${noImg.length ? noImg.join(", ") : "none"}; 3D views empty: ${no3d.length ? no3d.join(", ") : "none"}`);
    for (const e of r.entries) console.log(`  ${e.rank} ${e.name} ${e.score} 3Dpx=${e.canvasPx} ${e.note ? "[" + e.note + "] " : ""}"${e.comment}"`);
    if (r.toggled) console.log(`toggle: ${JSON.stringify(r.toggled)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
