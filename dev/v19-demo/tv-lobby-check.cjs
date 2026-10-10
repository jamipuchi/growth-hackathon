// v1.9 demo: the TV lobby's ROUND 1-4 MIN / AUTO-START selector, STARTING IN n, and the pacing on the TV.
//   BASE=http://localhost:8193 node dev/v19-demo/tv-lobby-check.cjs   (a scratch server: HALL_DIR=... ASTRA_MOCK=1 ...)
const { chromium } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const BASE = process.env.BASE || "http://localhost:8193";
const post = (p, b) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
(async () => {
  const exe = "/Users/jaumepuig/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
  const browser = await chromium.launch({ ...(require("fs").existsSync(exe) ? { executablePath: exe } : {}), args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/space.html`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const read = () => page.evaluate(() => ({
    on: [...document.querySelectorAll("#lenSeg button.on, #waitSeg button.on")].map((b) => b.textContent),
    bar: document.querySelector("#autoStartBar").classList.contains("hidden") ? null : document.querySelector("#autoStartBar").textContent,
    offset: Contract.TUNING.planet.offset, max: Contract.ROUND.maxSeconds,
  }));
  const out = { initial: await read() };
  await page.click("#lenSeg button:nth-of-type(2)"); // 2 MIN
  await page.waitForTimeout(800);
  out.after2 = await read();
  await page.click("#lenSeg button:nth-of-type(1)"); // back to 1 MIN
  await page.waitForTimeout(800);
  out.after1 = await read();
  // a ready player (SKIP: plain ship + default buttons) starts the 30 s auto-start
  await post("/join", { player: "demo1", device: "tvcheck-1" });
  out.skip = (await post("/default", { player: "demo1", device: "tvcheck-1", token: "tvcheck-1", kinds: ["ship", "controller"] })).json;
  await page.waitForTimeout(2200);
  out.counting = await read();
  await page.screenshot({ path: __dirname + "/tv-lobby.png" });
  await page.click("#waitSeg button:nth-of-type(4)"); // OFF
  await page.waitForTimeout(800);
  out.off = await read();
  await page.click("#waitSeg button:nth-of-type(2)"); // 30 S again
  await page.waitForTimeout(600);
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
