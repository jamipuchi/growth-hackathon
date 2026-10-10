// tv agent, browser run 2 (hold the lock): a live round on the real server (23 bots + 2 humans: ana and bob, mock ships with the
// dev kit emp + mine). Kill feed lines from real announcements, status chips on the tags, the death panel, the real results.
//   node dev/v12-client/tv/run-play.mjs
import fs from "fs";
import path from "path";
import { measureResults } from "./measure.mjs";
import { ROOT, Samples, sleep, makeLogger, installSignalHandlers, startServer, launchBig, watchPage, shootPage, runCleanups, post, get, hook, input } from "../../v11-client/lib.mjs";

const PORT = 8266, BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, "dev/v12-client/shots/tv");
const log = makeLogger("tv-play");
installSignalHandlers(log);
fs.mkdirSync(OUT, { recursive: true });
const report = { when: new Date().toISOString(), steps: {} };
const step = async (name, fn) => { try { const r = await fn(); report.steps[name] = r === undefined ? "ok" : r; return r; } catch (e) { report.steps[name] = "FAILED: " + (e && e.message); log(`step ${name} FAILED: ${(e && e.stack) || e}`); } };

const server = await startServer({ port: PORT, bots: 23, script: "dev/v12-client/server.cjs", logFile: "/tmp/v12-tv-server-play.log", log });
const { page } = await launchBig();
const sink = watchPage(page, "tv", log);
const feedLines = () => page.evaluate(() => [...document.querySelectorAll(".bse-feed-item")].map((e) => ({ text: e.textContent.trim(), cls: e.className.replace("bse-feed-item", "").trim(), chips: [...e.querySelectorAll(".bse-chip")].map((c) => c.className.replace("bse-chip", "").trim()) })));
const tagsInfo = () => page.evaluate(() => {
  const shown = [...document.querySelectorAll(".bse-tag")].filter((e) => e.style.display !== "none");
  const modes = { m0: 0, m1: 0, m2: 0 };
  for (const t of shown) modes[(t.className.match(/m\d/) || ["m0"])[0]]++;
  const chips = shown.flatMap((t) => [...t.querySelectorAll(".bse-tag-st .bse-chip.on")].map((c) => `${t.querySelector(".bse-tag-name").textContent}:${c.className.replace(/bse-chip|on/g, "").trim()}`));
  const g = window.__game, pp = g && g.projectPlayers ? g.projectPlayers() : [];
  return { shown: shown.length, ...modes, chips, followed: g && g.followed, projectPlayers: pp.length, sample: pp.slice(0, 2).map((p) => ({ name: p.name, bot: p.bot, flags: p.flags, visible: p.visible, dist: Math.round(p.dist) })) };
});
const view = () => page.evaluate(() => document.getElementById("hud").dataset.view);
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/space.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hud[data-view=lobby]", { timeout: 25000 });
  // two humans with mock ships
  const humans = ["ana", "bob"];
  for (const [i, name] of humans.entries()) {
    const j = await post(BASE, "/join", { player: name, device: `tv-device-${name}-0123456789`, token: `tv-device-${name}-0123456789` });
    log(`join ${name}: ${j.status} ${JSON.stringify(j.json)}`);
    const g = await post(BASE, "/generate", { player: name, kind: "ship", image: Samples.dataUrl("ship", i + 1), source: "draw", speculative: false, requestId: `tv-${name}` });
    log(`ship ${name}: ${g.status} ok=${g.json && g.json.ok} verbs=${g.json && g.json.entity && g.json.entity.verbs}`);
  }
  await input(BASE, "ana", "ready", true);
  await sleep(2500);
  await step("lobby-shot", () => shootPage(page, path.join(OUT, "lobby-2humans-1440x900.png")));
  const st = await post(BASE, "/start", { countdown: false });   // v1.4: no 3-2-1, play starts at once
  log("start:", st.status);
  await page.waitForSelector("#hud[data-view=play]", { timeout: 15000 });
  await sleep(4500);
  log("followed:", JSON.stringify(await tagsInfo()));
  await step("play-shot-start", () => shootPage(page, path.join(OUT, "play-live-start-1440x900.png")));

  // ---- EMP: ana scrambles bob ----
  await step("emp", async () => {
    const s = await hook.state(BASE);
    const b = s.players.bob;
    await hook.teleport(BASE, { player: "ana", near: { x: b.x, y: b.y, z: b.z }, distance: 45, face: { x: b.x, y: b.y, z: b.z } });
    await sleep(600);
    await input(BASE, "ana", "emp", true); await sleep(150); await input(BASE, "ana", "emp", false);
    await sleep(900);
    const lines = await feedLines(), tags = await tagsInfo();
    await shootPage(page, path.join(OUT, "play-live-emp-1440x900.png"));
    return { lines, tags };
  });
  log("emp:", JSON.stringify(report.steps.emp));

  // ---- mine: ana drops one, bob flies into it ----
  await step("mine", async () => {
    await sleep(1200);
    let s = await hook.state(BASE);
    const a = s.players.ana;
    await input(BASE, "ana", "mine", true); await sleep(150); await input(BASE, "ana", "mine", false);
    await sleep(300);
    const fwd = { x: -Math.sin(a.yaw) * Math.cos(a.pitch), y: Math.sin(a.pitch), z: -Math.cos(a.yaw) * Math.cos(a.pitch) };
    await hook.teleport(BASE, { player: "bob", x: a.x - fwd.x * 4, y: a.y - fwd.y * 4, z: a.z - fwd.z * 4 });
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) { await sleep(100); const l = await feedLines(); hit = l.find((x) => /mine/i.test(x.text)); }
    await sleep(250);
    const lines = await feedLines(), tags = await tagsInfo();
    await shootPage(page, path.join(OUT, "play-live-mine-1440x900.png"));
    return { hit: !!hit, lines, tags };
  });
  log("mine:", JSON.stringify(report.steps.mine));

  // ---- a kill line and a dim bot kill, through the test hook ----
  await step("feed-hook", async () => {
    await page.evaluate(() => { window.__bigscreen.feed("bob ✕ ana 💣"); window.__bigscreen.feed("🦑 ana inked bob's screen"); window.__bigscreen.feed("🎭 bob shot ana's decoy"); });
    await sleep(900);
    const lines = await feedLines();
    await shootPage(page, path.join(OUT, "play-live-feed-1440x900.png"));
    return { lines };
  });

  // ---- death: both humans next to the boss, wait for a real death on the followed panel ----
  await step("death", async () => {
    const s = await hook.state(BASE);
    const b = s.boss;
    for (const n of ["ana", "bob"]) await hook.teleport(BASE, { player: n, near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 6, face: { x: b.x, y: b.y, z: b.z }, heal: true });
    const seen = [];
    for (let i = 0; i < 70; i++) {
      await sleep(250);
      const o = await page.evaluate(() => { const m = document.getElementById("meters"); return { cls: m.className, who: document.getElementById("whoName").textContent, title: document.getElementById("deadTitle").textContent, sub: document.getElementById("deadSub").textContent }; });
      if (/\bdead\b/.test(o.cls)) { seen.push(o); if (seen.length === 2) { await shootPage(page, path.join(OUT, "play-live-dead-1440x900.png")); } }
      if (/\bback\b/.test(o.cls)) { await shootPage(page, path.join(OUT, "play-live-back-1440x900.png")); seen.push(o); break; }
      if (seen.length > 8) break;
    }
    return { seen: seen.slice(0, 5), lines: await feedLines() };
  });
  log("death:", JSON.stringify(report.steps.death));

  // ---- the real results: end the round now ----
  await step("results", async () => {
    const s = await hook.state(BASE);
    await hook.round(BASE, { maxSeconds: 1, scoreboardSeconds: 90 });
    await page.waitForSelector("#hud[data-view=results] .pc, #hud[data-view=results] .nobody", { timeout: 15000 });
    await sleep(3500);
    const m = await page.evaluate(measureResults);
    const server = await page.evaluate(() => { const r = window.__game.world && window.__game.world.result; return r ? { winner: r.winner, reason: r.reason, first: r.scores[0], n: r.scores.length } : null; });
    await shootPage(page, path.join(OUT, "results-live-1440x900.png"));
    await hook.round(BASE, { reset: true });
    return { measured: m, serverResult: server, titleMatches: server && server.winner ? m.title.toUpperCase().includes(String(server.winner).toUpperCase()) && String(m.firstRowName).toUpperCase() === String(server.winner).toUpperCase() : null };
  });
  log("results:", JSON.stringify(report.steps.results));
} catch (e) {
  log("RUN FAILED: " + ((e && e.stack) || e));
  report.failed = String((e && e.message) || e);
} finally {
  report.console = { errors: sink.errors.map((x) => x.text).slice(0, 12), http: sink.http.slice(0, 12), warnings: sink.warnings.length };
  fs.writeFileSync(path.join(ROOT, "dev/v12-client/tv/report-play.json"), JSON.stringify(report, null, 1));
  await runCleanups();
  log("done");
  process.exit(0);
}
