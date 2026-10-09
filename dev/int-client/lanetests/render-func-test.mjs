// Functional checks: keyboard player joins and flies, POST /perf arrives with contract fields, context loss/restore.
//   node dev/render/func-test.mjs   (mock server on 8102 must be running)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { webkit } = require(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const BASE = "http://localhost:8122";
const b = await webkit.launch({ executablePath: process.env.HOME + "/Library/Caches/ms-playwright/webkit-2311/pw_run.sh" });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await fetch(`${BASE}/mock?stage=fly&bots=3`);
await p.goto(`${BASE}/space.html?perf`);
await p.waitForTimeout(2000);
const ok = (name, cond, info = "") => console.log(`${cond ? "PASS" : "FAIL"} ${name} ${info}`);
// Keyboard: thrust + turn, then the keyboard ship appears in the scores and moves.
await p.keyboard.down("w");
await p.keyboard.down("ArrowLeft");
await p.waitForTimeout(1500);
const k1 = await p.evaluate(() => window.__game._internals.game.snaps.latest.players.find((q) => q.name === "keyboard"));
await p.waitForTimeout(1000);
const k2 = await p.evaluate(() => window.__game._internals.game.snaps.latest.players.find((q) => q.name === "keyboard"));
await p.keyboard.up("w");
await p.keyboard.up("ArrowLeft");
ok("keyboard joins", !!k1);
ok("keyboard ship moves and turns", k1 && k2 && Math.hypot(k2.x - k1.x, k2.z - k1.z) > 10 && k2.yaw !== k1.yaw, k1 && k2 ? `moved ${Math.hypot(k2.x - k1.x, k2.z - k1.z).toFixed(1)} m, yaw ${k1.yaw}→${k2.yaw}` : "");
// Perf POST every 5 s.
await p.waitForTimeout(4000);
const perf = await (await fetch(`${BASE}/mock/perf`)).json();
const last = perf.filter((s) => s.screen === "big").pop();
ok("POST /perf received and contract-valid", last && last.errors.length === 0 && ["fps", "low1", "p90ms", "calls", "tris", "textures", "tier", "w", "h", "dpr", "ua"].every((k) => k in last), last ? `fps ${last.fps} calls ${last.calls} tris ${last.tris}` : "none");
// Context loss and restore.
const before = await p.evaluate(() => window.__game._internals.game.frames);
await p.evaluate(() => { const gl = window.__game._internals.renderer.getContext(); window.__lc = gl.getExtension("WEBGL_lose_context"); window.__lc.loseContext(); });
await p.waitForTimeout(800);
const during = await p.evaluate(() => window.__game._internals.game.frames);
await p.waitForTimeout(400);
const during2 = await p.evaluate(() => window.__game._internals.game.frames);
await p.evaluate(() => window.__lc.restoreContext());
await p.waitForTimeout(2000);
const after = await p.evaluate(() => window.__game._internals.game.frames);
const info = await p.evaluate(() => window.__game.perf());
ok("rendering stops while the context is lost", during2 === during, `${before}→${during}→${during2}`);
ok("rendering resumes after restore", after > during2 + 30 && info.calls > 10, `frames +${after - during2}, calls ${info.calls}`);
// Hidden page stops rendering (simulated via visibility override).
const hv = await p.evaluate(async () => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new Event("visibilitychange"));
  const n0 = window.__game._internals.game.frames;
  await new Promise((r) => setTimeout(r, 700));
  const n1 = window.__game._internals.game.frames;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 700));
  return [n0, n1, window.__game._internals.game.frames];
});
ok("stops while hidden, resumes when visible", hv[0] === hv[1] && hv[2] > hv[1], hv.join("→"));
// Toast filter on a phone: only the matching player's toasts.
const ph = await b.newPage({ viewport: { width: 844, height: 390 } });
await ph.goto(`${BASE}/dev/render/phone.html?player=ana`);
await ph.evaluate(() => { window.__toasts = []; window.__game.on("toast", (m) => window.__toasts.push(m.player)); });
await fetch(`${BASE}/mock?stage=fly&bots=3`);
await ph.waitForTimeout(500);
await fetch(`${BASE}/mock?stage=island&bots=3`);
await ph.waitForTimeout(1500);
const toasts = await ph.evaluate(() => window.__toasts);
ok("phone gets its own toasts only", toasts.length > 0 && toasts.every((n) => n === "ana"), JSON.stringify(toasts));
ok("no page errors", errs.length === 0, errs.join(" | "));
await fetch(`${BASE}/mock?stage=auto&bots=2`);
await b.close();
