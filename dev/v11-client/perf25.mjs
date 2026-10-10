// Phone performance in a crowded round, and survival of a burst of entity re-sends (the v1.1 e2e saw 'Target crashed' from
// the assists stage on). One WebKit phone (iPhone UA, 844x390 @3x, touch) plays in a round with 24 bots plus seeded humans
// that have drawn ships (half with the dev kit, half "plain": drawn but nothing unlocked, so the assists change their entity).
//   node dev/v11-client/perf25.mjs [--port 8173] [--bots 24] [--seed 6] [--plain 6] [--measure 30] [--after 26]
//                                  [--assists-at 44] [--burst-rounds 2] [--out dev/v11-client/perf25.json] [--headed]
//                                  [--ignore-hold|--no-wait] [--strict]
// Timeline (seconds of play after START; the big screen is not opened, so only the phone loads the laptop):
//   0-4 warm-up (page settles) · 4-34 window A: cruising in space with everyone nearby · 36 burst: the same drawings are
//   posted again for every seeded player (the same image URL: a page must NOT rebuild those meshes), then new drawings for
//   a few (new image URLs: rebuilds) · 44 assists (v1.4: no skill is ever granted, the chests glow and late "DRAW X" hints go
//   out; v1.1-v1.2 re-sent every plain ship's entity here) · 36-62 window C: burst + assists + the arrival at the boss.
// v1.4: the round starts with POST /start { countdown: false } (no 3-2-1: the timeline starts at GO), and the world holds at
// most 25 players, humans and bots together (a joining human takes the newest bot's seat): config.shipsInWorld is the count.
// Per window: frames, fps, 1% low, p90 and worst frame (from a requestAnimationFrame sampler inside the page) and the page's
// own POST /perf numbers (calls, tris, tier, dpr). Also entity messages seen on /events per window, console errors, page crash.
// Writes dev/v11-client/perf25.json. Exit 0 = the page survived (no crash, still answering) and the budgets hold
// (calls <= 80, tris <= 120k, pixel ratio <= 2); --strict also requires fps >= 55 and 1% low >= 30 (a desktop proxy for an
// iPhone: confirm on a real phone). Phone 1 default: 24 bots + 12 seeded + the phone = 37 ships (nominal 25 players:
// --bots 12 --seed 6 --plain 6).
import fs from "fs";
import path from "path";
import {
  args, makeLogger, installSignalHandlers, runCleanups, waitForCalm, vitals, startServer, seedPlayers, keepAlive, launchPhoneBrowser, watchPage, sp,
  openEvents, post, summarisePerf, browserPaths, summariseConsole, sleep, withTimeout, Samples, HERE, ROOT, startRound, hook,
} from "./lib.mjs";

const A = args();
const log = makeLogger("perf25");
installSignalHandlers(log);

const PORT = A.num("port", 8173);
const BOTS = A.num("bots", 24);
const SEED = A.num("seed", 6);
const PLAIN = A.num("plain", 6);
const MEASURE = A.num("measure", 30);
const AFTER = A.num("after", 26);
const WARM = 4;
const BURST_AT = WARM + MEASURE + 2;
const ASSISTS_AT = A.num("assists-at", 44);
const BURST_ROUNDS = A.num("burst-rounds", 2);
const OUT = path.resolve(A.opt("out", path.join(HERE, "perf25.json")));
const PLAIN_NAMES = ["plainann", "plainbob", "plaincy", "plaindi", "plained", "plainflo", "plaingee", "plainhu", "plainivy", "plainjo", "plainkim", "plainlu"];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
const r1 = (n) => Math.round(n * 10) / 10;
function frameStats(dts) {
  if (!dts.length) return null;
  const sorted = [...dts].sort((a, b) => a - b);
  const mean = dts.reduce((s, x) => s + x, 0) / dts.length;
  return {
    frames: dts.length, fps: r1(1000 / mean), low1: r1(1000 / pct(sorted, 99)), p90ms: r1(pct(sorted, 90)), p99ms: r1(pct(sorted, 99)),
    worstMs: r1(sorted[sorted.length - 1]), framesOver50ms: dts.filter((d) => d > 50).length, framesOver100ms: dts.filter((d) => d > 100).length,
  };
}
const startSampler = (page) => page.evaluate(() => {
  const S = (window.__pf = { dts: [], run: true });
  let last = performance.now();
  const tick = (now) => { if (!S.run) return; S.dts.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const stopSampler = (page) => page.evaluate(() => { const S = window.__pf; S.run = false; return S.dts.slice(1); });

async function main() {
  if (!A.flag("ignore-hold")) {
    const v = vitals();
    if ((v.hold || v.pressure >= 2) && A.flag("no-wait")) { console.error(`the laptop is busy (HOLD ${v.hold || "off"}, pressure ${v.pressure}): not starting (--no-wait)`); return 4; }
    if (!(await waitForCalm({ log }))) { console.error("the laptop stayed busy: not starting"); return 4; }
  }
  const result = { tool: "dev/v11-client/perf25.mjs", measuredAt: new Date().toISOString(), vitalsAtStart: vitals().last, browsers: { webkit: browserPaths().webkit },
    config: { bots: BOTS, seededDevKit: SEED, seededPlain: PLAIN, ships: BOTS + SEED + PLAIN + 1, measureSeconds: MEASURE, afterSeconds: AFTER, assistsAtSeconds: ASSISTS_AT, burstAtSeconds: BURST_AT, burstRounds: BURST_ROUNDS, phone: "WebKit, iPhone UA, 844x390 @3x, touch" } };

  const server = await startServer({ port: PORT, bots: BOTS, serverArgs: ["--assists", String(ASSISTS_AT), "--cap", "600"], env: { PERF_LOG: path.join(HERE, "perf25-server-perf.log") }, logFile: path.join(HERE, "perf25-server.log"), log });
  const base = server.base;
  const devKit = await seedPlayers(base, SEED, { log });
  const plain = await seedPlayers(base, PLAIN, { names: PLAIN_NAMES.slice(0, PLAIN), startAt: 100, log });   // startAt only varies the drawings
  keepAlive(base, [...devKit.ok, ...plain.ok], 60000);

  // What the server sends: entity messages per window, the assists moment.
  const seen = { entity: 0, world: 0, assistsAtMs: null, phases: [] };
  let lastPhase = null;
  const stream = openEvents(base, (m) => {
    if (m.type === "entity") seen.entity++;
    else if (m.type === "world") { seen.world++; if (m.assists && seen.assistsAtMs === null) seen.assistsAtMs = Date.now(); }
    else if (m.type === "tick" && m.phase !== lastPhase) { lastPhase = m.phase; seen.phases.push({ phase: m.phase, clock: m.clock, at: Date.now() }); }
  }, (e) => log(`event stream error: ${e.message}`));
  const phoneBrowser = await launchPhoneBrowser({ headed: A.flag("headed") });
  const { page } = await phoneBrowser.newPhone();
  const sink = watchPage(page, "phone", log);
  await page.goto(`${base}/controller.html`, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__sp, null, { timeout: 15000 });
  await page.fill("#name", "perfphone");
  await page.locator("#joinForm button").first().tap({ timeout: 5000 });
  await page.waitForFunction(() => window.__sp.screen === "draw", null, { timeout: 10000 });
  await sp.tap(page, "useDefault");
  await page.waitForFunction(() => window.__sp.screen === "play", null, { timeout: 10000 });
  log("phone joined and is in play (plain ship, default controller); starting the round");
  await sleep(2000);
  const started = await startRound(base);   // { countdown: false }: play starts at once
  if (started.status !== 200 || !started.phase) throw new Error(`POST /start {countdown:false} answered ${started.status}, phase ${started.phase}`);
  const tStart = Date.now();
  const inWorld = await hook.state(base);
  result.config.shipsInWorld = inWorld ? Object.keys(inWorld.players).length : null;   // v1.4: at most 25 (bots give way)
  const at = (s) => tStart + s * 1000;
  const waitUntilPlay = async (s) => { const ms = at(s) - Date.now(); if (ms > 0) await sleep(ms); };
  // Laptop safety: stop (partial report) when the watchdog raises memory pressure + HOLD during the run.
  const guard = () => {
    const v = vitals();
    if (!A.flag("ignore-hold") && v.pressure >= 2 && v.hold) throw Object.assign(new Error(`aborted: memory pressure ${v.pressure} with HOLD on during the run (${v.last})`), { aborted: true });
  };

  // Window A
  await waitUntilPlay(WARM);
  guard();
  const markA0 = Date.now(), entityA0 = seen.entity;
  await startSampler(page);
  log(`window A: ${MEASURE} s cruising in space with ${result.config.ships} ships`);
  await waitUntilPlay(WARM + MEASURE);
  const dtsA = await stopSampler(page);
  const markA1 = Date.now();
  result.windowA = { label: `space, ${MEASURE} s before the burst`, ...frameStats(dtsA), posted: summarisePerf(sink.perf.filter((p) => p.seen >= markA0 && p.seen <= markA1), { skipFirst: false }), entityMessagesOnEvents: seen.entity - entityA0 };
  log(`window A: ${result.windowA.fps} fps, 1% low ${result.windowA.low1}, worst ${result.windowA.worstMs} ms; posted ${JSON.stringify(result.windowA.posted && { calls: result.windowA.posted.calls, tris: result.windowA.posted.tris, tier: result.windowA.posted.tier })}`);

  // Burst + assists window C
  await waitUntilPlay(BURST_AT);
  guard();
  const markC0 = Date.now(), entityC0 = seen.entity;
  await startSampler(page);
  const all = [...devKit.ok, ...plain.ok];
  let sameImage = 0, varied = 0, failedPosts = 0;
  const repost = async (name, variant) => {
    const r = await post(base, "/generate", { player: name, kind: "ship", image: Samples.dataUrl("ship", variant), source: "draw", speculative: false, requestId: `perf25-${name}-${variant}-${Date.now()}` });
    if (!r.json || !r.json.ok) failedPosts++;
  };
  log(`burst: re-posting the same ship drawings for ${all.length} players x ${BURST_ROUNDS}, then new ones for ${Math.min(6, all.length)}`);
  for (let round = 0; round < BURST_ROUNDS; round++) {
    await Promise.all(all.map((n) => repost(n, devKit.variants[n] || plain.variants[n])));   // the very same drawings again
    sameImage += all.length;
    await sleep(600);
  }
  await Promise.all(all.slice(0, 6).map((n, i) => repost(n, 50 + i)));
  varied += Math.min(6, all.length);
  result.burst = { sameImagePosts: sameImage, newImagePosts: varied, failedPosts, note: "failedPosts are drawings refused (5 final drawings per player per world)" };
  await waitUntilPlay(BURST_AT + AFTER);
  const dtsC = await stopSampler(page);
  const markC1 = Date.now();
  result.windowC = { label: `burst at ${BURST_AT} s, assists at ${ASSISTS_AT} s, arrival at the boss`, ...frameStats(dtsC), posted: summarisePerf(sink.perf.filter((p) => p.seen >= markC0 && p.seen <= markC1), { skipFirst: false }), entityMessagesOnEvents: seen.entity - entityC0 };
  log(`window C: ${result.windowC.fps} fps, 1% low ${result.windowC.low1}, worst ${result.windowC.worstMs} ms; ${result.windowC.entityMessagesOnEvents} entity messages`);

  // Survival
  const alive = await withTimeout(page.evaluate(() => ({ screen: window.__sp && window.__sp.screen, step: window.__sp && window.__sp.step })), 8000, "page liveness").catch((e) => ({ error: e.message }));
  result.assists = { seenOnEvents: seen.assistsAtMs !== null, atSecondsOfPlay: seen.assistsAtMs ? r1((seen.assistsAtMs - tStart) / 1000) : null, phases: seen.phases.map((p) => ({ phase: p.phase, clock: p.clock })) };
  result.crashed = sink.crashed;
  result.aliveAfter = !alive.error && !sink.crashed;
  result.pageState = alive;
  result.pageProblems = summariseConsole([sink]).phone;
  const worst = (a, b, k) => Math.max(a && a.posted ? a.posted[k] || 0 : 0, b && b.posted ? b.posted[k] || 0 : 0);
  const posted = { callsMax: worst(result.windowA, result.windowC, "callsMax"), trisMax: worst(result.windowA, result.windowC, "trisMax"), dpr: worst(result.windowA, result.windowC, "dpr") };
  const num = (w, k) => (w && Number.isFinite(w[k]) ? w[k] : 0);
  const lowFps = Math.min(num(result.windowA, "fps"), num(result.windowC, "fps")), lowLow1 = Math.min(num(result.windowA, "low1"), num(result.windowC, "low1"));
  result.budget = { ...posted, rule: "calls <= 80, tris <= 120000, pixel ratio <= 2 (PLAN.md section 4)" };
  result.gates = {
    survivedWithoutCrash: result.aliveAfter,
    callsLe80: posted.callsMax > 0 && posted.callsMax <= 80,
    trisLe120k: posted.trisMax > 0 && posted.trisMax <= 120000,
    pixelRatioLe2: posted.dpr > 0 && posted.dpr <= 2,
    fpsGe55: lowFps >= 55,
    low1Ge30: lowLow1 >= 30,
    noConsoleErrors: result.pageProblems.errors.length === 0,
  };
  result.pass = result.gates.survivedWithoutCrash && result.gates.callsLe80 && result.gates.trisLe120k && result.gates.pixelRatioLe2;
  result.passStrict = result.pass && result.gates.fpsGe55 && result.gates.low1Ge30;
  result.note = "WebKit on a desktop Mac emulating an iPhone: a proxy only (no touch GPU limits); confirm fps and 1% low on a real phone. posted = the page's own POST /perf samples (renderer.info of the last frame).";
  result.wallSeconds = +log.since().toFixed(1);
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  stream.close();
  await runCleanups();

  const g = result.gates;
  console.log(`\n==== perf25 ${result.pass ? "PASS" : "FAIL"} (${result.config.shipsInWorld ?? "?"} ships in the world; asked ${BOTS} bots + ${SEED + PLAIN} seeded + the phone, 25 at most) ====`);
  console.log(`window A  ${result.windowA.fps} fps, 1% low ${result.windowA.low1}, p90 ${result.windowA.p90ms} ms, worst ${result.windowA.worstMs} ms, ${result.windowA.framesOver50ms} frames > 50 ms; calls ${result.windowA.posted && result.windowA.posted.calls} (max ${result.windowA.posted && result.windowA.posted.callsMax}), tris ${result.windowA.posted && Math.round(result.windowA.posted.tris / 1000)}k, tier ${result.windowA.posted && result.windowA.posted.tier}`);
  console.log(`window C  ${result.windowC.fps} fps, 1% low ${result.windowC.low1}, p90 ${result.windowC.p90ms} ms, worst ${result.windowC.worstMs} ms, ${result.windowC.framesOver50ms} frames > 50 ms; calls ${result.windowC.posted && result.windowC.posted.calls} (max ${result.windowC.posted && result.windowC.posted.callsMax}), tris ${result.windowC.posted && Math.round(result.windowC.posted.tris / 1000)}k; ${result.windowC.entityMessagesOnEvents} entity messages, assists ${result.assists.seenOnEvents ? `at ${result.assists.atSecondsOfPlay} s` : "not seen"}`);
  console.log(`survived: ${g.survivedWithoutCrash} (crashed ${result.crashed}); gates ${Object.entries(g).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`page problems: ${result.pageProblems.errors.length} console errors, ${result.pageProblems.http.length} http errors; report ${path.relative(ROOT, OUT)}`);
  return A.flag("strict") ? (result.passStrict ? 0 : 1) : result.pass ? 0 : 1;
}

main().then((code) => process.exit(code)).catch(async (e) => {
  console.error(`[perf25] failed: ${e.stack || e.message}`);
  try { fs.writeFileSync(OUT, JSON.stringify({ tool: "dev/v11-client/perf25.mjs", pass: false, error: e.message, measuredAt: new Date().toISOString() }, null, 2)); } catch {}
  await runCleanups();
  process.exit(1);
});
