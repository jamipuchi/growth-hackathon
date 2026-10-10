// Fast-forward balance check (no browsers, no server): one human played by the e2e route driver (dev/e2e/driver.mjs,
// the same code dev/e2e/run.mjs uses) plus N bots, against world.js on simulated time. It mirrors server.js: inputs
// are cleaned and checked as POST /input does, /generate spends the drawing budget and answers like ASTRA_MOCK=1
// (ship / explorer → the dev kit at once, a button → LAND after 300 ms). Prints the stage clocks per seed.
//   node dev/netcode/balance-sim.mjs [--route expert|regular|both] [--bots 24] [--seeds 1-6] [--verbose]
// v1.9 demo copy (dev/v19-demo/balance-1min.mjs): + [--minutes 1|2|3|4] (default 1) passed to createWorld (Contract.pacing).
// Exit code 0 when every run passes its route's verdict (driver.mjs judge).
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { createDriver, judge } from "../e2e/driver.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const Contract = require(path.join(ROOT, "contract.js"));
const Verbs = require(path.join(ROOT, "verbs.js"));
const { defaultLayout } = require(path.join(ROOT, "astra.js")); // the pad a drawn controller gets in mock mode
const { createWorld } = require(path.join(ROOT, "world.js"));

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const ROUTES = opt("route", "both") === "both" ? ["expert", "regular"] : [opt("route", "expert")];
const BOTS = Number(opt("bots", 24));
const [S0, S1] = String(opt("seeds", "1-6")).split("-").map(Number);
const VERBOSE = argv.includes("--verbose");
const MINUTES = Number(opt("minutes", "1"));
const ME = "e2e";
const DT = 1 / Contract.SIM_HZ;
const MOCK_BUTTON_MS = 300;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const devKitEntity = (kind) => {
  const world = kind === "ship" ? "space" : "planet";
  const type = kind === "ship" ? "ship" : "person";
  const unlocked = Verbs.DEV_KIT[world].map((u) => ({ ...u }));
  return { type, rig: Verbs.RIG_OF[type], verbs: Verbs.entityVerbs(type, unlocked.map((u) => u.verb)), unlocked, parts: [], source: "devkit", card: Verbs.cardOf(type, unlocked) };
};

async function run(route, seed) {
  let simMs = 0;
  const later = []; // [atMs, fn]: replies that arrive after a simulated delay
  const listeners = [];
  const w = createWorld({ random: mulberry32(seed), broadcast: (m) => { for (const f of listeners) f(m); }, minutes: MINUTES });
  for (let i = 1; i <= BOTS; i++) w.addBot(`bot${i}`);
  w.join(ME);

  function post(pathname, body) {
    if (pathname === "/input") {
      for (let msg of Array.isArray(body) ? body : [body]) {
        msg = { ...msg, player: Contract.cleanName(msg.player) };
        if (msg.type === "input") msg.action = Contract.normaliseAction(msg.action);
        if (!Contract.CHECKS.input(msg).length) w.handleInput(msg);
      }
      return Promise.resolve({ status: 204, json: null });
    }
    if (pathname === "/generate") {
      const player = Contract.cleanName(body.player), where = w.drawingWorld(player);
      if (w.drawingsLeft(player)[where] <= 0) return Promise.resolve({ status: 200, json: { ok: false, error: "no drawings left", drawingsLeft: w.drawingsLeft(player) } });
      const entity = body.kind === "ship" || body.kind === "explorer";
      return new Promise((resolve) => later.push([simMs + (entity ? 0 : MOCK_BUTTON_MS), () => {
        if (!w.spendDrawing(player, where)) return resolve({ status: 200, json: { ok: false, error: "no drawings left" } });
        let json;
        if (entity) {
          const e = devKitEntity(body.kind);
          w.setEntity(player, body.kind, e);
          json = { ok: true, entity: e };
        } else {
          // As ASTRA_MOCK=1 does: a drawn controller (v1.7: the driver draws one in the lobby) → the default pad; a button →
          // the one the player was asked for (expect, the gate verb), else LAND.
          const asked = body.expect ? Contract.normaliseAction(body.expect) : "";
          const action = Verbs.VERBS[asked] ? asked : "land";
          const layout = body.kind === "controller" ? { ...defaultLayout(), source: "model" } : { buttons: [{ type: "button", action, label: action.toUpperCase(), ...body.region }], source: "model" };
          w.setLayout(player, layout, body.kind);
          json = { ok: true, layout };
        }
        resolve({ status: 200, json: { ...json, drawingsLeft: w.drawingsLeft(player) } });
      }]));
    }
    return Promise.resolve({ status: 404, json: null });
  }

  const lines = [];
  const { D, onMessage, lobbyDraws } = createDriver({ route, me: ME, drawSeconds: route === "regular" ? 12 : 3, now: () => simMs, post, Contract, log: (...a) => lines.push(`[${(simMs / 1000).toFixed(1)}] ${a.join(" ")}`) });
  listeners.push((m) => { if (m.type !== "tick") onMessage(m); });
  const flushLater = async () => {
    for (let i = 0; i < later.length; i++) if (later[i][0] <= simMs) { later.splice(i, 1)[0][1](); i--; }
    await new Promise((r) => setImmediate(r)); // let the driver's .then() callbacks run
  };
  onMessage(w.worldMessage());
  post("/input", { type: "input", player: ME, action: "ready", down: true });
  const lobby = lobbyDraws();
  // v1.7: the lobby drawings include the controller (a MOCK_BUTTON_MS answer): the lobby clock runs until they are in
  let lobbyDone = false;
  lobby.then(() => (lobbyDone = true));
  for (let i = 0; i < 400 && !lobbyDone; i++) { await flushLater(); if (!lobbyDone) simMs += 50; }
  await lobby;
  simMs += 1500;
  w.start();
  let steps = 0;
  while (w.phase !== "scoreboard" && steps < 270 * Contract.SIM_HZ) {
    w.step(DT); steps++; simMs += DT * 1000;
    if (steps % (Contract.SIM_HZ / Contract.TICK_HZ) === 0) { onMessage(w.tickMessage()); await flushLater(); }
  }
  for (let i = 0; i < 3; i++) { w.step(DT); onMessage(w.tickMessage()); await flushLater(); }
  const v = judge(D, { route, me: ME, maxSeconds: Contract.pacing(MINUTES).maxSeconds });
  const dbg = w.debug();
  const players = Object.values(w.players);
  const bots = players.filter((p) => p.bot);
  const scores = (D.result && D.result.scores) || [];
  const human = scores.find(([n]) => n === ME);
  const kills = D.announces.filter((a) => / ✕ /.test(a.text));
  return {
    route, seed, pass: Object.values(v.gates).every(Boolean), gates: v.gates,
    end: D.result ? `${D.result.reason}@${D.wonClock}` : "none", winner: D.winner,
    me: human ? human[1] : null, topBot: Math.max(...bots.map((b) => b.score)),
    bossHp: dbg.boss.maxHp, players: w.worldMessage().playerCount, chests: dbg.chests.length, mine: D.chestsOpened,
    deaths: D.deaths, kills: kills.length, killsOnMe: kills.filter((a) => a.text.endsWith(`✕ ${ME}`)).length,
    clocks: Object.fromEntries(Object.entries(D.stages).map(([k, s]) => [k, s.clock])), issues: D.issues, lines,
  };
}

const fmt = (c) => (c == null ? "  -  " : `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, "0")}`);
const t0 = Date.now();
let allPass = true;
for (const route of ROUTES) {
  console.log(`\n== ${route}, ${MINUTES}-minute round, ${BOTS} bots, seeds ${S0}-${S1} ==`);
  console.log("seed pass  boss  bossDown planet landed chest1 end         winner  me     topBot chests deaths killsOnMe");
  for (let seed = S0; seed <= S1; seed++) {
    const r = await run(route, seed);
    allPass = allPass && r.pass;
    const c = r.clocks;
    console.log(`${String(seed).padEnd(4)} ${r.pass ? "PASS" : "FAIL"}  ${fmt(c.boss)} ${fmt(c.bossDead)}    ${fmt(c.planet)}  ${fmt(c.landed)}  ${fmt(c["chest-1"])}  ${r.end.padEnd(11)} ${String(r.winner).padEnd(7)} ${String(r.me).padEnd(6)} ${String(r.topBot).padEnd(6)} ${r.mine}/${r.chests}    ${r.deaths}      ${r.killsOnMe}   (hp ${r.bossHp}, count ${r.players})${r.pass ? "" : " " + JSON.stringify(r.gates)}`);
    if (VERBOSE || !r.pass) { console.log("   stages", JSON.stringify(r.clocks)); if (r.issues.length) console.log("   issues", r.issues.join(" | ")); }
    if (VERBOSE) console.log(r.lines.filter((l) => /stage|died|toast/.test(l)).map((l) => "   " + l).join("\n"));
  }
}
console.log(`\n${allPass ? "ALL PASS" : "SOME FAIL"} in ${((Date.now() - t0) / 1000).toFixed(1)} s at ${new Date().toISOString()}`);
process.exit(allPass ? 0 : 1);
