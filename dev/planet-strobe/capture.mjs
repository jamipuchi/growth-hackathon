// planet-strobe capture: frames of the TV and the phone while a ship flies into / orbits the unlocked planet (mock server).
//   node dev/planet-strobe/capture.mjs <port> <label> [tv|phone|phone-steady|all]
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const CACHE = process.env.HOME + "/Library/Caches/ms-playwright";
const [port, label, which = "all"] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const OUT = new URL(`./frames/${label}/`, import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const stage = (s, bots = 4) => fetch(`${BASE}/mock?stage=${s}&bots=${bots}`).then((r) => r.json());
async function shoot(p, name, n, gap) {
  const t0 = Date.now(), times = [];
  for (let i = 0; i < n; i++) {
    const s = Date.now();
    await p.screenshot({ path: `${OUT}${name}-${String(i).padStart(3, "0")}.jpg`, type: "jpeg", quality: 85 });
    times.push(Date.now() - t0);
    const w = gap - (Date.now() - s); if (w > 0) await p.waitForTimeout(w);
  }
  return times;
}
const meta = {};
if (which === "tv" || which === "all") {
  const b = await chromium.launch({ executablePath: `${CACHE}/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await stage("planet");
  await p.goto(`${BASE}/space.html`); await p.waitForTimeout(9000);
  meta.tv = { times: await shoot(p, "tv", 30, 60), errs };
  await b.close();
}
for (const [key, st, player] of [["phone", "planet", "ana"], ["phone-steady", "island", "ben"]]) {
  if (!(which === key || which === "all")) continue;
  const b = await webkit.launch({ executablePath: `${CACHE}/webkit-2311/pw_run.sh` });
  const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, userAgent: IPHONE_UA })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await stage(st);
  await p.goto(`${BASE}/dev/render/phone.html?view=chase&player=${player}`); await p.waitForTimeout(9000);
  meta[key] = { times: await shoot(p, key, 30, 60), errs };
  await b.close();
}
fs.writeFileSync(`${OUT}meta.json`, JSON.stringify(meta));
console.log(JSON.stringify(Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { span: v.times.at(-1), errs: v.errs.slice(0, 3) }]))));
