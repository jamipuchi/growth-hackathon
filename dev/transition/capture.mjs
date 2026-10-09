import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const pw = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const kinds = (process.argv[2] || "land,take").split(",");
const engine = process.argv[3] || "chromium";
const times = { land: [0, 0.5, 1, 1.5, 2, 2.5, 3], take: [0, 0.4, 0.8, 1.2, 1.6, 2] };
const exe = process.env.PW_EXE;
const browser = await pw[engine].launch(exe ? { executablePath: exe, args: engine !== "chromium" ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } : {});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://127.0.0.1:8110/dev/transition/demo.html?manual=1");
await page.waitForFunction(() => window.__demo);
for (const kind of kinds) {
  await page.evaluate((k) => { window.__demo.reset(); if (k === "take") window.__demo.parkOnPad(); window.__demo.start(k); }, kind);
  let t = 0;
  for (const target of times[kind]) {
    const dt = target - t + (target === times[kind].at(-1) ? 0.05 : 0);
    if (dt > 0) {
      const n = Math.ceil(dt / (1 / 60));
      for (let i = 0; i < n; i++) await page.evaluate((d) => window.__demo.step(d), dt / n);
    }
    t = target;
    await page.screenshot({ path: path.join(here, "shots", `${engine}-${kind}-${String(target).replace(".", "_")}.png`) });
  }
}
console.log(JSON.stringify(await page.evaluate(() => window.__demo.log)));
if (process.argv[4] === "bench") {
  const r = await page.evaluate(() => window.__demo.bench());
  const ms = r.map((x) => x.msPerFrame);
  console.log("bench ms/frame mean", (ms.reduce((a, b) => a + b) / ms.length).toFixed(4), "max", Math.max(...ms).toFixed(4), "heapDelta", JSON.stringify(r.slice(0, 4).map((x) => x.heapDelta)));
}
await browser.close();
