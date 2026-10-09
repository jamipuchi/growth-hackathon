// Self-test of the harness wiring, NO browser: starts dev/v11-client/server.cjs (our own child process) and checks that the wrapper
// and its test hooks still work against the current server.js / world.js / astra.js. Run it after any change to those files.
//   node dev/v11-client/selftest.mjs [--port 8174] [--timing]
//   --timing  also watches a real --fast round: assists at ~25 s and the cap at ~60 s of play (about 75 s more)
// Checks: GET /inflate.js (200, JavaScript, the whole file), files server.js does not serve are reported (not hidden), private
// files stay private; the generate overrides by player name (car, bike, dog, blob, plain, wrong, wrongsoft, slow, fail); Astra's
// drawing copies stay out of the repo's controllers/ folder; seeding; the hooks: kill the boss, land, a landing party of
// explorers (car, bike, quadruped), drill a rock chest open, the round hook (assists now, end now, scoreboard time).
// Exit code 0 when everything passes.
import fs from "fs";
import path from "path";
import { args, makeLogger, installSignalHandlers, runCleanups, startServer, seedPlayers, request, get, post, hook, input, killBoss, pressLand, waitForMode, landParty, standByRockChest, waitFor, sleep, Samples, ROOT, HERE } from "./lib.mjs";

const A = args();
const log = makeLogger("selftest");
installSignalHandlers(log);
const PORT = A.num("port", 8174);

let failed = 0, total = 0;
const check = (name, pass, detail = "") => { total++; if (!pass) failed++; console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); return !!pass; };
const PNG = Samples.dataUrl("ship", 0);
const gen = (player, kind, extra = {}) => post(`http://127.0.0.1:${PORT}`, "/generate", { player, kind, image: PNG, source: "draw", speculative: false, ...extra }).then((r) => r.json);

async function main() {
  const controllersBefore = fs.existsSync(path.join(ROOT, "controllers")) ? fs.readdirSync(path.join(ROOT, "controllers")).length : 0;
  const server = await startServer({ port: PORT, bots: 2, serverArgs: ["--assists", "40", "--cap", "90", "--scoreboard", "3"], logFile: path.join(HERE, "selftest-server.log"), log });
  const base = server.base;
  try {
    // ---- files
    const inflate = await get(base, "/inflate.js");
    const file = fs.readFileSync(path.join(ROOT, "inflate.js"), "utf8");
    check("GET /inflate.js is served", inflate.status === 200 && inflate.text === file, `${inflate.status}, ${inflate.text.length} of ${file.length} bytes`);
    const head = await request(base, "HEAD", "/inflate.js");
    check("HEAD /inflate.js is 200", head.status === 200);
    const infoNow = await hook.info(base);
    console.log(`INFO server.js lists inflate.js in PUBLIC_FILES by itself: ${infoNow && infoNow.serverJsServesInflate} (the wrapper serves it either way)`);
    check("space.html and controller.html are served", (await get(base, "/space.html")).status === 200 && (await get(base, "/controller.html")).status === 200);
    check("server.js stays private (404)", (await get(base, "/server.js")).status === 404);
    await get(base, "/definitely-not-there.js");
    const info = await hook.info(base);
    check("a 404 is reported, not hidden", info && info.missing && info.missing["/definitely-not-there.js"] === 1, JSON.stringify(info && info.missing));
    check("timing flags are in force", info && info.round.assistsAt === 40 && info.round.maxSeconds === 90 && info.round.scoreboardSeconds === 3, JSON.stringify(info && info.round));

    // ---- generate overrides
    const forced = { carx: "car", bikex: "bike", dogx: "quadruped", blobx: "blob", zed: "person" };
    for (const [name, type] of Object.entries(forced)) {
      const r = await gen(name, "explorer");
      const rigs = { car: "car", bike: "car", quadruped: "quadruped", blob: "blob", person: "person" };
      check(`explorer by ${name} -> ${type}`, r && r.ok && r.entity.type === type && r.entity.rig === rigs[type] && r.entity.verbs.includes("dig"), r && r.entity && `${r.entity.type}/${r.entity.rig} [${r.entity.verbs.join(" ")}]`);
    }
    const car = await gen("carx", "explorer", { speculative: true });
    check("a car can drive and not jump", car.entity.verbs.includes("drive") && !car.entity.verbs.includes("jump"));
    check("anims are wired for a forced type", car.entity.anims && Object.keys(car.entity.anims).length > 3);
    const ship = await gen("carx", "ship");
    check("a ship by car... stays a ship with the dev kit", ship.ok && ship.entity.type === "ship" && ship.entity.verbs.includes("land") && ship.entity.verbs.includes("shoot"));
    const plain = await gen("plainpat", "ship");
    check("plain... ship: drawn, nothing unlocked", plain.ok && plain.entity.verbs.length === 0 && plain.entity.unlocked.length === 0 && plain.entity.source === "model");
    const wrong = await gen("wrongo", "ship");
    check("wrong... ship is refused with looksLike controller", wrong.ok === false && wrong.looksLike === "controller" && wrong.drawingsLeft.space === 5, JSON.stringify(wrong));
    const wrongX = await gen("wrongo", "explorer", { speculative: true });
    check("wrong... explorer (speculative) is refused too", wrongX.ok === false && wrongX.looksLike === "controller");
    const anyway = await gen("wrongo", "ship", { anyway: true });
    check("wrong... with anyway:true answers ok and still carries looksLike", anyway.ok === true && anyway.looksLike === "controller" && anyway.drawingsLeft.space === 4, `left ${JSON.stringify(anyway.drawingsLeft)}`);
    const wrongC = await gen("wrongo", "controller");
    check("wrong... controller is refused with looksLike entity", wrongC.ok === false && wrongC.looksLike === "entity" && wrongC.thing === "ship", JSON.stringify(wrongC));
    const soft = await gen("wrongsoftie", "ship");
    check("wrongsoft... is never refused, the ok answer carries looksLike", soft.ok === true && soft.looksLike === "controller");
    const fail = await gen("failer", "ship");
    check("fail... answers generation unavailable", fail.ok === false && /unavailable/.test(fail.error));
    const t0 = Date.now();
    await gen("slowpoke", "ship", { speculative: true });
    check("slow... answers 2.5 s late", Date.now() - t0 >= 2400, `${Date.now() - t0} ms`);
    const drawn = await get(base, "/drawings/carx-explorer.png");
    check("drawn images are served at /drawings/", drawn.status === 200, `${drawn.status}`);
    await sleep(300);
    const controllersAfter = fs.existsSync(path.join(ROOT, "controllers")) ? fs.readdirSync(path.join(ROOT, "controllers")).length : 0;
    check("Astra's drawing copies stay out of the repo's controllers/ folder", controllersAfter === controllersBefore && fs.existsSync(path.join(HERE, "controllers-out")), `${controllersBefore} -> ${controllersAfter} files`);

    // ---- seeding and the hooks
    const seeded = await seedPlayers(base, 6, { startAt: 0, explorers: true, log });
    check("6 players seeded with drawn ships and explorers", seeded.ok.length === 6 && seeded.failed.length === 0 && Object.values(seeded.entities).every((e) => e.ship.verbs.includes("land")), JSON.stringify(seeded.failed));
    check("seeded explorers follow their name (carla car, bikeboy bike, doggo quadruped, blobby blob)", seeded.entities.carla.explorer.type === "car" && seeded.entities.bikeboy.explorer.type === "bike" && seeded.entities.doggo.explorer.type === "quadruped" && seeded.entities.blobby.explorer.type === "blob");
    await post(base, "/join", { player: "carol" });
    await gen("carol", "ship");
    const carolExplorer = await gen("carol", "explorer");
    check("carol (the phone's player) draws a car", carolExplorer.ok && carolExplorer.entity.type === "car");

    const lobby = await hook.state(base);
    check("state hook answers in the lobby", lobby && lobby.phase === "lobby" && lobby.boss && !lobby.boss.dead && lobby.chests.length >= 3, lobby && `${lobby.phase}, ${lobby.chests.length} chests`);
    check("POST /start starts the round", (await post(base, "/start")).status === 200);
    await sleep(800);
    const boss = await killBoss(base, "carol", { log });
    check("killBoss: the boss dies and the planet appears", boss && boss.boss.dead && boss.planet && boss.players.carol.score >= 1000, boss && `play clock ${boss.playT} s`);
    await pressLand(base, "carol", { log });
    const landed = await waitForMode(base, "carol", "planet", 12000);
    check("LAND: carol is on the island as a car", landed && landed.players.carol.type === "car" && landed.parked.some((p) => p.player === "carol"));
    await landParty(base, seeded.ok, { log });
    const party = await waitFor(async () => { const s = await hook.state(base); return s && seeded.ok.every((n) => s.players[n].mode === "planet") ? s : null; }, { timeout: 12000 });
    check("landing party: every seeded player lands with their explorer type", party && party.players.carla.type === "car" && party.players.bikeboy.type === "bike" && party.players.doggo.type === "quadruped" && party.players.blobby.type === "blob" && party.players.ana.type === "person", party && seeded.ok.map((n) => `${n}:${party.players[n].type}`).join(" "));
    const chest = await standByRockChest(base, "carol");
    check("a closed rock chest exists and carol stands next to it", !!chest && chest.kind === "rock");
    if (chest) {
      await input(base, "carol", "drill", true);
      const opened = await waitFor(async () => { const s = await hook.state(base); const c = s.chests.find((x) => x.id === chest.id); return c && c.open ? s : null; }, { timeout: 7000, every: 300 });
      await input(base, "carol", "drill", false);
      check("DRILL opens the rock chest and carol collects it", !!opened && opened.players.carol.score >= 2500, opened && `score ${opened.players.carol.score}`);
    }
    const r1 = await hook.round(base, { assistsAt: 0 });
    const assist = await waitFor(async () => { const s = await hook.state(base); return s && s.phase === "assists" ? s : null; }, { timeout: 3000 });
    check("round hook: assistsAt 0 starts the assists", r1.ok && !!assist);
    await hook.round(base, { maxSeconds: 0 });
    const score = await waitFor(async () => { const s = await hook.state(base); return s && s.phase === "scoreboard" ? s : null; }, { timeout: 3000 });
    check("round hook: maxSeconds 0 ends the round (scoreboard)", !!score);
    const back = await waitFor(async () => { const s = await hook.state(base); return s && s.phase === "lobby" && s.round === 2 ? s : null; }, { timeout: 6000 });
    check("scoreboardSeconds 3 is read at run time: back in the lobby after ~3 s", !!back);
    const reset = await hook.round(base, { reset: true });
    check("round hook: reset restores the defaults", reset.round.assistsAt === 180 && reset.round.maxSeconds === 240 && reset.round.scoreboardSeconds === 10, JSON.stringify(reset.round));
  } finally {
    await server.stop();
  }

  if (A.flag("timing")) {
    log("timing: a real --fast round (about 75 s)");
    const fast = await startServer({ port: PORT, bots: 2, serverArgs: ["--fast"], log });
    try {
      await post(fast.base, "/start");
      const t = Date.now();
      const at = {};
      while (Date.now() - t < 70000 && !at.scoreboard) {
        const s = await hook.state(fast.base);
        if (s && s.phase === "assists" && !at.assists) at.assists = (Date.now() - t) / 1000;
        if (s && s.phase === "scoreboard") at.scoreboard = (Date.now() - t) / 1000;
        await sleep(500);
      }
      check("--fast: assists at about 25 s of play", at.assists > 23 && at.assists < 28, `${at.assists && at.assists.toFixed(1)} s`);
      check("--fast: the round ends at about 60 s of play", at.scoreboard > 58 && at.scoreboard < 64, `${at.scoreboard && at.scoreboard.toFixed(1)} s`);
    } finally { await fast.stop(); }
  }
  console.log(`\n${failed ? `${failed} of ${total} checks FAILED` : `all ${total} checks passed`}`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code)).catch(async (e) => { console.error(`[selftest] failed: ${e.stack || e.message}`); await runCleanups(); process.exit(1); });
