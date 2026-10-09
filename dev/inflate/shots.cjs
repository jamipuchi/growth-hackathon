// Screenshots + measurements of the inflate demo in WebKit (iPhone size) and Chromium.
// Usage: node dev/inflate/serve.mjs & node dev/inflate/shots.cjs   (server on 8130)
const { webkit, chromium } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:8130/dev/inflate/demo.html";
const OUT = path.join(__dirname, "shots");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function run(browserType, name, ctxOpts, query, shots) {
  const home = require("os").homedir() + "/Library/Caches/ms-playwright";
  const exe = browserType === webkit ? `${home}/webkit-2311/pw_run.sh` : `${home}/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const browser = await browserType.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  const { throttle, ...contextOpts } = ctxOpts;
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  if (throttle) { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle }); }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const results = await page.evaluate(() => window.__results);
  await page.evaluate(() => window.__fps());
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(() => window.__fps());
  for (const [file, scroll] of shots) {
    await page.evaluate((y) => window.scrollTo(0, y), scroll);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, file) });
  }
  await browser.close();
  return { name, query, fps: +fps.toFixed(1), errors, results };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA };
  const report = [];
  report.push(await run(webkit, "webkit-iphone-portrait", iphone, "quality=phone", [["webkit-390x844-top.png", 0], ["webkit-390x844-bottom.png", 900]]));
  report.push(await run(webkit, "webkit-iphone-landscape", { ...iphone, viewport: { width: 844, height: 390 } }, "quality=phone", [["webkit-844x390.png", 0]]));
  // Phone-class CPU: Chromium with the CPU throttled 6x (an M-series Mac core / 6 is about an older iPhone core).
  report.push(await run(chromium, "chromium-phone-cpu6x", { ...iphone, isMobile: false, throttle: 6 }, "quality=phone", [["chromium-phone-cpu6x.png", 0]]));
  report.push(await run(chromium, "chromium-big", { viewport: { width: 1400, height: 900 } }, "quality=big", [["chromium-big.png", 0]]));
  report.push(await run(chromium, "chromium-rocket-close", { viewport: { width: 700, height: 700 } }, "quality=big&only=rocket&still&sockets", [["chromium-rocket-sockets.png", 0]]));
  report.push(await run(chromium, "chromium-stick-close", { viewport: { width: 700, height: 700 } }, "quality=big&only=stick&still&sockets", [["chromium-stick-sockets.png", 0]]));
  report.measuredAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ measuredAt: new Date().toISOString(), report }, null, 2));
  for (const r of report) {
    console.log(`${r.name}: fps ${r.fps}, errors ${r.errors.length}${r.errors.length ? " " + r.errors.slice(0, 3).join(" | ") : ""}`);
    for (const x of r.results) console.log(`  ${x.name.padEnd(16)} ${x.kind.padEnd(6)} ${String(x.ms).padStart(6)} ms  ${String(x.triangles).padStart(6)} tris  tex ${x.texture.w}x${x.texture.h}  size ${JSON.stringify(x.size)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
