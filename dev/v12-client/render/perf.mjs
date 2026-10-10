// Render agent: draw calls / triangles / fps at 25 players (24 bots + 2 humans), TV (Chromium 1440x900) and phone (WebKit iPhone
// 844x390 @3x) at once, in four windows: lobby, cruise, boss fight (everyone teleported next to the boss), mischief (mines + EMP).
//   dev/v12-client/render/locked.sh 470 node dev/v12-client/render/perf.mjs --label before [--port 8264] [--bots 24] [--tier N]
// Writes dev/v12-client/render/perf-<label>.json and screenshots under dev/v12-client/shots/render/. Uses the lead's hook server.
import fs from "fs";
import path from "path";
import { args, makeLogger, installSignalHandlers, runCleanups, startServer, launchBig, launchPhoneBrowser, watchPage, post, sleep, hook, input, ROOT, RHERE, serveHost, openHost, installSampler, resetSampler, readSampler, summarise, joinWithShip, shootPage, summariseConsole } from "./lib2.mjs";

const A = args();
const log = makeLogger("render-perf");
installSignalHandlers(log);
const PORT = A.num("port", 8264), BOTS = A.num("bots", 24), LABEL = A.opt("label", "run"), TIER = A.opt("tier", null);
const SHOTS = path.join(ROOT, "dev/v12-client/shots/render");
const OUT = path.join(RHERE, `perf-${LABEL}.json`);

async function main() {
  const server = await startServer({ port: PORT, bots: BOTS, serverArgs: ["--cap", "900", "--assists", "800"], env: { PERF_LOG: path.join(RHERE, `perf-${LABEL}.log`) }, logFile: path.join(RHERE, `server-${LABEL}.log`), script: "dev/v12-client/server.cjs", log });
  const base = server.base;
  const result = { label: LABEL, at: new Date().toISOString(), bots: BOTS, tier: TIER, windows: {} };
  const humans = [];
  for (const [i, n] of ["phoneguy", "ana"].entries()) { const r = await joinWithShip(base, n, i + 1); humans.push(r); log(`${n}: join ${JSON.stringify(r.join)} gen ${JSON.stringify(r.gen && { ok: r.gen.ok, verbs: r.gen.verbs })}`); }
  const big = await launchBig();
  await serveHost(big.context);
  const tvSink = watchPage(big.page, "tv", log);
  const pb = await launchPhoneBrowser();
  const { context: phoneCtx, page: phone } = await pb.newPhone();
  await serveHost(phoneCtx);
  const phoneSink = watchPage(phone, "phone", log);
  await openHost(big.page, base, { screen: "big", perf: true });
  await openHost(phone, base, { screen: "phone", player: "phoneguy", view: "chase" });
  if (TIER !== null) { for (const pg of [big.page, phone]) await pg.evaluate((t) => { window.__game._internals.game.perf.pin = Number(t); }, TIER); }
  await installSampler(big.page); await installSampler(phone);
  const window_ = async (name, seconds, extra) => {
    await resetSampler(big.page); await resetSampler(phone);
    if (extra) await extra();
    await sleep(seconds * 1000);
    const [tv, ph] = [await readSampler(big.page), await readSampler(phone)];
    result.windows[name] = { tv: summarise(tv), phone: summarise(ph) };
    log(`${name}: TV ${JSON.stringify(result.windows[name].tv)}`);
    log(`${name}: PHONE ${JSON.stringify(result.windows[name].phone)}`);
    await shootPage(big.page, path.join(SHOTS, `${LABEL}-${name}-tv.png`)).catch(() => {});
    await shootPage(phone, path.join(SHOTS, `${LABEL}-${name}-phone.png`)).catch(() => {});
  };
  await sleep(2500); // shaders, first inflates
  await window_("lobby", 8);
  const st = await post(base, "/start"); log(`start: ${st.status}`);
  await sleep(5000);
  await window_("cruise", 12);
  // everyone to the boss: bots included (the hook teleports any player by name)
  const state = await hook.state(base);
  const b = state && state.boss;
  if (b) {
    const names = Object.keys(state.players);
    let k = 0;
    for (const n of names) { await hook.teleport(base, { player: n, near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 45 + (k++ % 9) * 12, face: { x: b.x, y: b.y, z: b.z }, heal: true }); }
    await hook.boss(base, { hp: 4000 });
    for (const n of ["phoneguy", "ana"]) await input(base, n, "shoot", true);
    log(`teleported ${names.length} players to the boss`);
  }
  await window_("boss", 20);
  // mischief: ana mines and EMPs the phone player (they are both at the boss)
  await window_("mischief", 14, async () => {
    await hook.teleport(base, { player: "ana", near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 70, face: { x: b.x, y: b.y, z: b.z }, heal: true });
    await hook.teleport(base, { player: "phoneguy", near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 80, face: { x: b.x, y: b.y, z: b.z }, heal: true });
    for (let i = 0; i < 3; i++) { await input(base, "ana", "mine", true); await sleep(120); await input(base, "ana", "mine", false); await sleep(700); }
    await input(base, "ana", "emp", true); await sleep(150); await input(base, "ana", "emp", false);
  });
  await input(base, "phoneguy", "shoot", false); await input(base, "ana", "shoot", false);
  result.console = summariseConsole([tvSink, phoneSink]);
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log(`wrote ${path.relative(ROOT, OUT)}`);
  await runCleanups();
}
main().then(() => process.exit(0)).catch(async (e) => { console.error(`[render-perf] failed: ${e.stack || e.message}`); await runCleanups(); process.exit(1); });
