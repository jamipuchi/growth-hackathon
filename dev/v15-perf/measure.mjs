// v15-perf: the phone's frame pacing at 25 players (24 bots + 2 humans), before / after, in four windows: lobby, round start
// (3-2-1 + cruise: every drawn ship is built), boss fight (everyone teleported to the boss), planet (boss down, both humans land).
// Per window and screen: fps, 1% low, p90, the longest frame, frames over 50 ms, draw calls, triangles, the quality tier (min /
// max / last) and what the window cost the GPU driver: shader programs compiled, textures added, drawn models built.
//
//   node dev/v15-perf/measure.mjs --label after [--port 8480] [--bots 24] [--root <tree>] [--tier N] [--no-tv]
//                                 [--phone webkit|chromium] [--throttle 4]
//
//   --root      serve another tree (the "before": `git archive <commit> | tar -x -C /tmp/v15-before`, then --root /tmp/v15-before);
//               default: this repo. The hook server (dev/v12-client/server.cjs: ASTRA_MOCK=1, HTTPS off) runs from that tree.
//   --phone     webkit (default: iPhone 844x390 @3, touch, iPhone UA; no CPU throttling in WebKit) or chromium (the same
//               emulation, with --throttle N: CDP CPU throttling, 4 = a mid iPhone CPU on a laptop).
//   --tier N    pins the quality tier on both screens (?tier=N): compares tiers without the governor.
// Writes dev/v15-perf/out/measure-<label>.json and prints one table. Uses only ports --port (server); one browser per screen.
import fs from "fs";
import path from "path";
import { args, makeLogger, installSignalHandlers, runCleanups, startServer, launchBig, launchPhoneBrowser, watchPage, post, sleep, hook, input, ROOT, serveHost, openHost, joinWithShip, summariseConsole, onCleanup } from "../v12-client/render/lib2.mjs";

const A = args();
const log = makeLogger("v15-perf");
installSignalHandlers(log);
const PORT = A.num("port", 8480), BOTS = A.num("bots", 24), LABEL = A.opt("label", "run"), TIER = A.opt("tier", null);
const TREE = path.resolve(A.opt("root", ROOT));
const PHONE = A.opt("phone", "webkit"), THROTTLE = A.num("throttle", 0), TV = !A.flag("no-tv");
const OUT = path.join(ROOT, "dev/v15-perf/out", `measure-${LABEL}.json`);
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// In the page: one sample per frame (the game's "frame" event) plus the renderer's program / texture counts and DrawnCache builds.
const install = (page) => page.evaluate(() => {
  const g = window.__game, I = g._internals, R = I.renderer;
  const S = (window.__v15 = { dt: [], calls: [], tris: [], tier: [], scene: [], last: performance.now(), p0: 0, x0: 0, b0: 0 });
  S.mark = () => { S.dt.length = S.calls.length = S.tris.length = S.tier.length = S.scene.length = 0; S.last = performance.now(); S.p0 = R.info.programs ? R.info.programs.length : 0; S.x0 = R.info.memory.textures; S.b0 = I.drawn.built; };
  S.read = () => ({ dt: S.dt.slice(1), calls: S.calls.slice(), tris: S.tris.slice(), tier: S.tier.slice(), scene: S.scene.slice(),
    programs: (R.info.programs ? R.info.programs.length : 0) - S.p0, textures: R.info.memory.textures - S.x0, built: I.drawn.built - S.b0,
    programsTotal: R.info.programs ? R.info.programs.length : 0, texturesTotal: R.info.memory.textures });
  g.on("frame", () => {
    const n = performance.now();
    S.dt.push(n - S.last); S.last = n;
    S.calls.push(R.info.render.calls); S.tris.push(R.info.render.triangles); S.tier.push(I.game.perf.tier); S.scene.push(I.game.sceneName);
  });
  S.mark();
});
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };
const r1 = (n) => Math.round(n * 10) / 10;
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function summarise(s) {
  if (!s || !s.dt.length) return null;
  const worst = [...s.dt].sort((x, y) => y - x), k = Math.max(1, Math.ceil(s.dt.length * 0.01));
  return {
    frames: s.dt.length, fps: r1(1000 / avg(s.dt)), low1: r1(1000 / avg(worst.slice(0, k))), p90ms: r1(pct(s.dt, 90)), worstMs: r1(worst[0]),
    over50: s.dt.filter((d) => d > 50).length, over100: s.dt.filter((d) => d > 100).length,
    calls: { avg: r1(avg(s.calls)), max: Math.max(...s.calls) }, tris: { avg: Math.round(avg(s.tris)), max: Math.max(...s.tris) },
    tier: { min: Math.min(...s.tier), max: Math.max(...s.tier), last: s.tier[s.tier.length - 1] }, scenes: [...new Set(s.scene)],
    programs: s.programs, textures: s.textures, built: s.built, programsTotal: s.programsTotal, texturesTotal: s.texturesTotal,
  };
}

async function phonePage() {
  if (PHONE === "chromium") {
    const big = await launchBig(); // a Chromium; the phone gets its own emulated context in it
    const context = await big.browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
    onCleanup(() => context.close().catch(() => {}));
    const page = await context.newPage();
    if (THROTTLE > 1) { const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); }
    return { context, page };
  }
  const pb = await launchPhoneBrowser();
  return pb.newPhone();
}

async function main() {
  const script = path.join(TREE, "dev/v12-client/server.cjs");
  if (!fs.existsSync(script)) throw new Error(`no hook server in ${TREE} (dev/v12-client/server.cjs)`);
  const server = await startServer({ port: PORT, bots: BOTS, serverArgs: ["--cap", "900", "--assists", "800"], env: { ASTRA_MOCK: "1", PERF_LOG: path.join(ROOT, "dev/v15-perf/out", `perf-${LABEL}.log`) }, logFile: path.join(ROOT, "dev/v15-perf/out", `server-${LABEL}.log`), script, log });
  const base = server.base;
  const result = { label: LABEL, at: new Date().toISOString(), tree: TREE, bots: BOTS, tier: TIER, phone: PHONE, throttle: THROTTLE, windows: {} };
  for (const [i, n] of ["phoneguy", "ana"].entries()) { const r = await joinWithShip(base, n, i + 1); log(`${n}: join ${JSON.stringify(r.join)} gen ${JSON.stringify(r.gen && { ok: r.gen.ok, verbs: r.gen.verbs })}`); }
  const pages = [];
  if (TV) {
    const big = await launchBig();
    await serveHost(big.context);
    pages.push({ label: "tv", page: big.page, sink: watchPage(big.page, "tv", log) });
    await openHost(big.page, base, { screen: "big", perf: true });
  }
  const ph = await phonePage();
  await serveHost(ph.context);
  pages.push({ label: "phone", page: ph.page, sink: watchPage(ph.page, "phone", log) });
  await openHost(ph.page, base, { screen: "phone", player: "phoneguy", view: "chase" });
  for (const p of pages) {
    if (TIER !== null) await p.page.evaluate((t) => { window.__game._internals.game.perf.pin = Number(t); }, TIER);
    await install(p.page);
  }
  const window_ = async (name, seconds, during) => {
    for (const p of pages) await p.page.evaluate(() => window.__v15.mark());
    if (during) await during();
    await sleep(seconds * 1000);
    result.windows[name] = {};
    for (const p of pages) result.windows[name][p.label] = summarise(await p.page.evaluate(() => window.__v15.read()));
    for (const p of pages) log(`${name} ${p.label}: ${JSON.stringify(result.windows[name][p.label])}`);
  };
  await window_("lobby", 8);
  await window_("start", 15, async () => { const st = await post(base, "/start", {}); log(`start: ${st.status}`); });
  const state = await hook.state(base);
  const b = state && state.boss;
  const names = state ? Object.keys(state.players) : [];
  if (b) {
    let k = 0;
    for (const n of names) await hook.teleport(base, { player: n, near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 45 + (k++ % 9) * 12, face: { x: b.x, y: b.y, z: b.z }, heal: true });
    await hook.boss(base, { hp: 4000 });
    for (const n of ["phoneguy", "ana"]) await input(base, n, "shoot", true);
  }
  await window_("boss", 15);
  // The boss goes down (low hp under fire), then both humans fly to the planet and land: the landing shot + the island.
  if (b) await hook.boss(base, { hp: 1 });
  await sleep(3000);
  for (const n of ["phoneguy", "ana"]) await input(base, n, "shoot", false);
  const s2 = await hook.state(base);
  const pl = s2 && s2.planet;
  await window_("planet", 18, async () => {
    if (!pl) { log("no planet in /__test/state: the planet window measures space"); return; }
    for (const n of ["phoneguy", "ana"]) {
      await hook.teleport(base, { player: n, near: { x: pl.x, y: pl.y, z: pl.z }, distance: pl.radius + Math.max(2, (pl.landRange || 20) * 0.5), face: { x: pl.x, y: pl.y, z: pl.z }, heal: true });
      await input(base, n, "land", true); await sleep(150); await input(base, n, "land", false);
    }
  });
  result.console = summariseConsole(pages.map((p) => p.sink));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  const row = (w, s) => s ? `${w.padEnd(7)} ${String(s.fps).padStart(5)} fps  1% ${String(s.low1).padStart(5)}  p90 ${String(s.p90ms).padStart(5)}  worst ${String(s.worstMs).padStart(6)} ms  >50ms ${String(s.over50).padStart(3)}  calls ${s.calls.avg}  tris ${(s.tris.avg / 1000).toFixed(1)}k  tier ${s.tier.min}-${s.tier.max} (${s.tier.last})  +prog ${s.programs}  +tex ${s.textures}  built ${s.built}  ${s.scenes.join("/")}` : `${w.padEnd(7)} (no frames)`;
  for (const p of pages) { console.log(`\n${LABEL} · ${p.label}`); for (const w of Object.keys(result.windows)) console.log(row(w, result.windows[w][p.label])); }
  log(`wrote ${path.relative(ROOT, OUT)}`);
  await runCleanups();
}
main().then(() => process.exit(0)).catch(async (e) => { console.error(`[v15-perf] failed: ${e.stack || e.message}`); await runCleanups(); process.exit(1); });
