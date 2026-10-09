// Phone island soak: WebKit at iPhone 13 landscape on the render mock (stage island), N seconds, reports crash + perf.
//   node dev/int-client/island-phone.mjs [--port 8122] [--seconds 40]   (mock: node dev/render/mock-server.js --port 8122)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const BASE = `http://localhost:${arg("port", 8122)}`;
const { webkit } = require(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const b = await webkit.launch({ executablePath: process.env.HOME + "/Library/Caches/ms-playwright/webkit-2311/pw_run.sh" });
const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" })).newPage();
let crashed = false; p.on("crash", () => (crashed = true));
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await fetch(`${BASE}/mock?stage=island&bots=3`);
await p.goto(`${BASE}/${arg("page", "dev/render/phone.html")}?player=ana&perf&island=${arg("island", "kit")}`);
const secs = Number(arg("seconds", 40));
let perf = null;
for (let i = 0; i < secs && !crashed; i++) { await p.waitForTimeout(1000); perf = await p.evaluate(() => window.__game?.perf?.()).catch(() => perf); }
if (!crashed && arg("shot", null)) await p.screenshot({ path: arg("shot", null) }).catch(() => {});
const kit = crashed ? null : await p.evaluate(() => !!window.__game?._internals.game.island.kit).catch(() => null);
console.log(JSON.stringify({ crashed, kit, errs: errs.slice(0, 3), perf: perf && { fps: perf.fps, low1: perf.low1, calls: perf.calls, tris: perf.tris, tier: perf.tier, scene: perf.scene } }));
await b.close();
