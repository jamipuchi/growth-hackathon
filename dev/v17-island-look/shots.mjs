#!/usr/bin/env node
// v17-island-look: screenshots of the island (landing shot, explorer chase view on a phone-sized page, TV spectator) against
// the real server (dev/v11-client/server.cjs, ASTRA_MOCK=1, its test hooks only skip travel). One Chromium, closed at the end.
//   node dev/v17-island-look/shots.mjs <tag> [--port 8510]
// Writes dev/v17-island-look/shots/<tag>-*.png and <tag>-stats.json (renderer calls / triangles on each page).
import fs from "fs";
import path from "path";
import { startServer, launchBig, post, sleep, hook, input, Samples, Terrain, waitFor, waitForPlay, waitForMode, installSignalHandlers, runCleanups, ROOT } from "../v11-client/lib.mjs";

const argv = process.argv.slice(2);
const TAG = argv[0] && !argv[0].startsWith("--") ? argv[0] : "shot";
const PORT = Number((argv.indexOf("--port") >= 0 && argv[argv.indexOf("--port") + 1]) || 8510);
const OUT = path.join(ROOT, "dev/v17-island-look/shots");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const stats = { tag: TAG, at: new Date().toISOString(), pages: {} };
installSignalHandlers();

async function main() {
  const s = await startServer({ port: PORT, bots: 3, env: { ASTRA_MOCK: "1" }, logFile: path.join(OUT, `${TAG}-server.log`), log });
  const base = s.base, me = "ace";
  await post(base, "/join", { player: me, device: "v17-look-ace" });
  await post(base, "/generate", { player: me, kind: "ship", image: Samples.dataUrl("ship", 9), source: "draw", speculative: false, requestId: "v17-ship" });
  // v1.7 readyGate: a player is ready with a ship AND a controller drawing.
  await post(base, "/generate", { player: me, kind: "controller", image: Samples.dataUrl("controller", 1), source: "draw", speculative: false, requestId: "v17-ctrl" });
  const CROWD = Number((argv.indexOf("--crowd") >= 0 && argv[argv.indexOf("--crowd") + 1]) || 0);
  const crowd = Array.from({ length: CROWD }, (_, i) => `crew${i + 1}`);
  for (const [i, n] of crowd.entries()) {
    await post(base, "/join", { player: n, device: `v17-look-${n}` });
    await post(base, "/generate", { player: n, kind: "ship", image: Samples.dataUrl("ship", i % 8), source: "draw", speculative: false, requestId: `v17-s-${n}` });
    await post(base, "/generate", { player: n, kind: "controller", image: Samples.dataUrl("controller", 1), source: "draw", speculative: false, requestId: `v17-c-${n}` });
  }
  for (let i = 0; i < 40; i++) { const r = await post(base, "/start", { countdown: false }); if (r.status === 200) break; await sleep(250); }
  if (!(await waitForPlay(base, 8000))) throw new Error("not playing");
  const { browser, context, page: tv } = await launchBig();
  tv.on("pageerror", (e) => log("tv pageerror", e.message));
  await tv.goto(`${base}/space.html?perf`, { waitUntil: "load" });
  const phoneCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phoneCtx.route(/\/__render\/host\.html/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: fs.readFileSync(path.join(ROOT, "dev/v12-client/render/host.html"), "utf8") }));
  const phone = await phoneCtx.newPage();
  phone.on("pageerror", (e) => log("phone pageerror", e.message));
  await phone.goto(`${base}/__render/host.html?screen=phone&player=${me}&perf`, { waitUntil: "load" });
  await phone.waitForFunction(() => window.__hostReady === true, null, { timeout: 40000 });
  await sleep(4000);
  // Kill the boss.
  let st = await hook.state(base);
  const b = st.boss;
  await hook.boss(base, { hp: 24 });
  await hook.teleport(base, { player: me, near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 25, face: { x: b.x, y: b.y, z: b.z }, heal: true });
  await input(base, me, "shoot", true);
  st = await waitFor(async () => { const q = await hook.state(base); return q && q.boss && q.boss.dead ? q : null; }, { timeout: 10000, every: 200 });
  await input(base, me, "shoot", false);
  if (!st) throw new Error("boss did not die");
  log("boss down");
  await sleep(1500);
  st = await hook.state(base);
  const p = st.planet;
  // Auto-landing (v1.6): touching the planet lands; teleport just outside and fly in.
  await hook.teleport(base, { player: me, near: { x: p.x, y: p.y, z: p.z }, distance: p.radius + 6, face: { x: p.x, y: p.y, z: p.z }, heal: true });
  for (const n of crowd) await hook.teleport(base, { player: n, near: { x: p.x, y: p.y, z: p.z }, distance: p.radius + 3, face: { x: p.x, y: p.y, z: p.z }, heal: true });
  await input(base, me, "land", true);
  await post(base, "/input", { type: "axis", player: me, axis: "throttle", x: 0, y: 1 });
  await sleep(200);
  await input(base, me, "land", false);
  const t0 = Date.now();
  // Landing shot frames.
  for (const ms of [900, 1800, 2700]) {
    await sleep(Math.max(0, ms - (Date.now() - t0)));
    await phone.screenshot({ path: path.join(OUT, `${TAG}-phone-landing-${ms}.png`) });
  }
  const landed = await waitForMode(base, me, "planet", 15000);
  log("mode planet:", !!landed);
  await sleep(6000); // kit loaded, shot over
  const grab = async (pg, name) => {
    await pg.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`) });
    stats.pages[name] = await pg.evaluate(() => {
      const g = window.__game || (window.__sp && window.__sp.game);
      const I = g && g._internals;
      if (!I) return null;
      return { scene: I.game.sceneName, calls: I.renderer.info.render.calls, tris: I.renderer.info.render.triangles, textures: I.renderer.info.memory.textures, tier: I.game.perf.tier, kit: !!I.game.island.kit, kitStats: I.game.island.kit ? I.game.island.kit.getStats() : null };
    }).catch((e) => ({ error: e.message }));
    log(name, JSON.stringify(stats.pages[name]).slice(0, 300));
  };
  await grab(phone, "phone-island");
  await grab(tv, "tv-island");
  // Walk a little so the chase view turns.
  await post(base, "/input", { type: "axis", player: me, axis: "steer", x: 0.6, y: 0.9 });
  await sleep(2500);
  await post(base, "/input", { type: "axis", player: me, axis: "steer", x: 0, y: 0 });
  await sleep(800);
  await grab(phone, "phone-island-walk");
  await grab(tv, "tv-island-walk");
  // The shore: the first dry -> wet crossing out from the landing spot, the explorer 7 m inland facing the sea.
  st = await hook.state(base);
  const seed = st.island.seed, L = st.landing || { x: 0, z: 0 };
  let spot = null;
  for (let k = 0; k < 24 && !spot; k++) {
    const a = (k / 24) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    for (let r = 10; r < 600; r += 2) if (Terrain.height(L.x + dx * r, L.z + dz * r, seed) < 0.2) { spot = { x: L.x + dx * (r - 7), z: L.z + dz * (r - 7), fx: L.x + dx * (r + 60), fz: L.z + dz * (r + 60) }; break; }
  }
  if (spot) {
    await hook.teleport(base, { player: me, x: spot.x, z: spot.z, face: { x: spot.fx, y: 0, z: spot.fz } });
    await sleep(2500);
    await grab(phone, "phone-shore");
    await grab(tv, "tv-shore");
  }
  if (argv.includes("--probe")) {
    for (const [what, js] of [["noglow", "I.game.island.glow.mesh.visible=false"], ["noparticles", "I.game.island.glow.mesh.visible=true;I.game.island.particles.mesh.visible=false"]]) {
      await phone.evaluate((code) => { const I = window.__game._internals; new Function("I", code)(I); }, js);
      await sleep(300);
      await phone.screenshot({ path: path.join(OUT, `${TAG}-probe-${what}.png`) });
    }
  }
  await browser.close();
}
main().catch((e) => { stats.fatal = String(e.stack || e); log("FAILED", e); }).finally(async () => {
  fs.writeFileSync(path.join(OUT, `${TAG}-stats.json`), JSON.stringify(stats, null, 2));
  await runCleanups();
  process.exit(stats.fatal ? 1 : 0);
});
