// Screenshots and perf measurement for render.js against the mock server (node dev/render/mock-server.js).
//   node dev/render/shoot.mjs [shots|perf|all]
// Uses the cached Playwright browsers through an existing playwright-core (no install).
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const CACHE = process.env.HOME + "/Library/Caches/ms-playwright";
const BASE = "http://localhost:8102";
const OUT = new URL("./shots/", import.meta.url).pathname;
const mode = process.argv[2] || "all";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const launch = (name) => name === "webkit"
  ? webkit.launch({ executablePath: `${CACHE}/webkit-2311/pw_run.sh` })
  : chromium.launch({ executablePath: `${CACHE}/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
const stage = (s, bots = 8) => fetch(`${BASE}/mock?stage=${s}&bots=${bots}`).then((r) => r.json());

async function page(browser, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: browser.browserType().name() !== "firefox" && browser.browserType().name() === "chromium", hasTouch: true, userAgent: IPHONE_UA }
    : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|status of 404/.test(m.text())) errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  p.on("requestfailed", (r) => errors.push("REQFAIL " + r.url()));
  p.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return { p, ctx, errors };
}

async function measure(p, seconds) {
  await p.waitForTimeout(seconds * 1000);
  return p.evaluate(() => window.__game.perf());
}

const results = [];
async function run(browserName) {
  const browser = await launch(browserName);
  const stamp = new Date().toISOString();
  if (mode === "shots" || mode === "all") {
    const { p, ctx, errors } = await page(browser, false);
    await stage("lobby", 4);
    await p.goto(`${BASE}/space.html?perf`);
    for (const [s, file, wait] of [["lobby", "big-lobby", 4], ["fly", "big-fly", 5], ["boss", "big-boss", 6], ["broken", "big-boss-broken", 5], ["planet", "big-planet", 7], ["island", "big-island", 9], ["assists", "big-assists-island", 6]]) {
      await stage(s, 8);
      await p.waitForTimeout(wait * 1000);
      await p.screenshot({ path: `${OUT}${browserName}-${file}.png` });
      const perf = await p.evaluate(() => window.__game.perf());
      const hud = await p.evaluate(() => { const h = window.__game.hud(); return { phase: h.phase, objective: h.objective, objectiveText: h.objectiveText, bar: +h.bar.toFixed(2), status: h.status, clock: +h.clock.toFixed(1), radar: h.radar.length, scores: h.scores.length, me: h.me?.name, tier: h.tier }; });
      results.push({ at: stamp, browser: browserName, view: "big 1600x900", stage: s, fps: perf.fps, low1: perf.low1, p90ms: perf.p90ms, calls: perf.calls, tris: perf.tris, textures: perf.textures, tier: perf.tier, scene: perf.scene, hud });
    }
    if (errors.length) results.push({ browser: browserName, view: "big", errors: [...new Set(errors)].slice(0, 10) });
    await ctx.close();
    for (const [s, view, file] of [["boss", "chase", "phone-boss-chase"], ["boss", "cockpit", "phone-boss-cockpit"], ["planet", "chase", "phone-planet"], ["island", "chase", "phone-island"]]) {
      const { p: pp, ctx: c2, errors: e2 } = await page(browser, true);
      await stage(s, 8);
      await pp.goto(`${BASE}/dev/render/phone.html?perf&view=${view}&player=ana`);
      await pp.waitForTimeout(7000);
      await pp.screenshot({ path: `${OUT}${browserName}-${file}.png` });
      const perf = await pp.evaluate(() => window.__game.perf());
      results.push({ at: stamp, browser: browserName, view: `phone 844x390@3 ${view}`, stage: s, fps: perf.fps, low1: perf.low1, p90ms: perf.p90ms, calls: perf.calls, tris: perf.tris, textures: perf.textures, tier: perf.tier, dpr: perf.dpr, scene: perf.scene });
      if (e2.length) results.push({ browser: browserName, view: "phone", errors: [...new Set(e2)].slice(0, 10) });
      await c2.close();
    }
  }
  if (mode === "perf" || mode === "all") {
    // Sustained measurement with 8 ships: 20 s per view in the heaviest space stage, then the island.
    for (const [phone, s, url] of [[false, "boss", "/space.html?perf"], [true, "boss", "/dev/render/phone.html?perf&view=chase&player=ana"], [true, "island", "/dev/render/phone.html?perf&view=chase&player=ana"], [false, "island", "/space.html?perf"]]) {
      const { p, ctx, errors } = await page(browser, phone);
      await stage(s, 8);
      await p.goto(BASE + url);
      await p.waitForTimeout(4000);
      const perf = await measure(p, 16);
      results.push({ at: stamp, browser: browserName, kind: "sustained 16s", view: phone ? "phone 844x390@3" : "big 1600x900", stage: s, ...perf, ua: undefined });
      if (errors.length) results.push({ errors: [...new Set(errors)].slice(0, 10) });
      await ctx.close();
    }
  }
  await browser.close();
}

for (const b of (process.env.BROWSERS || "webkit,chromium").split(",")) await run(b);
await stage("auto", 2);
fs.writeFileSync(new URL(`./results-${mode}.json`, import.meta.url), JSON.stringify(results, null, 1));
for (const r of results) console.log(JSON.stringify(r));
