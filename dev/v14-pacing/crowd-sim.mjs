// A room full of humans, fast-forward (v1.4 pacing, owner 10 Oct 10:00: "we want most of the time to be spent on the
// planet"). Like dev/netcode/balance-sim.mjs, but every seat is a human played by the e2e route driver
// (dev/e2e/driver.mjs): a share of experts (draw ship + explorer in the lobby, boost), the rest regulars (draw at each
// gate after its hint, 12 s per drawing). No browsers, no server: world.js on simulated time, /generate answered like
// ASTRA_MOCK=1. Prints per seed when the boss falls, when the humans land, when every chest is open and the share of
// the round each human spent on the planet.
//   node dev/v14-pacing/crowd-sim.mjs [--humans 25] [--bots 0] [--experts 0.4] [--seeds 1-4] [--spread] [--root <repo>] [--verbose]
// The driver walks to the nearest chest, so by default the crowd moves as one blob (and several diggers share a chest:
// dig progress adds up), the slow bound. --spread: every human only sees the chests it is the nearest landed human to
// (all of them when it is nearest to none), so the crowd fans out, the fast bound. Real rooms sit in between.
// --root runs another checkout's contract.js / world.js (a tuning worktree) with this driver.
import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const ROOT = path.resolve(opt("root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")));
const require = createRequire(import.meta.url);
const Contract = require(path.join(ROOT, "contract.js"));
const Verbs = require(path.join(ROOT, "verbs.js"));
const { createWorld } = require(path.join(ROOT, "world.js"));
const { createDriver } = await import(pathToFileURL(path.join(ROOT, "dev/e2e/driver.mjs")).href);

const HUMANS = Number(opt("humans", 25));
const BOTS = Number(opt("bots", 0));
const EXPERTS = Number(opt("experts", 0.4));
const [S0, S1] = String(opt("seeds", "1-4")).split("-").map(Number);
const VERBOSE = argv.includes("--verbose");
const SPREAD = argv.includes("--spread");
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

// --spread: each unopened chest belongs to the nearest landed human; a human sees its own chests (all when it has none).
function spreadChests(drivers, tick, world) {
  if (!world || !world.chests) return;
  const landed = tick.players.filter((p) => p.mode !== "space" && !(p.flags && p.flags.dead) && drivers.some((d) => d.me === p.name));
  const owner = new Map();
  for (const c of world.chests) {
    if (c.open || !landed.length) continue;
    let best = null, bd = Infinity;
    for (const p of landed) { const dd = Math.hypot(p.x - c.x, p.z - c.z); if (dd < bd) { bd = dd; best = p.name; } }
    owner.set(c.id, best);
  }
  for (const d of drivers) {
    const mine = world.chests.filter((c) => c.open || owner.get(c.id) === d.me);
    d.D.world = { ...d.D.world, chests: mine.some((c) => !c.open) ? mine : world.chests };
  }
}

async function run(seed) {
  let simMs = 0;
  const later = [];
  const listeners = [];
  const w = createWorld({ random: mulberry32(seed), broadcast: (m) => { for (const f of listeners) f(m); } });
  for (let i = 1; i <= BOTS; i++) w.addBot(`bot${i}`);
  const names = Array.from({ length: HUMANS }, (_, i) => `h${String(i + 1).padStart(2, "0")}`);
  const nExperts = Math.round(HUMANS * EXPERTS);
  for (const n of names) w.join(n);

  // POST /input and POST /generate, as server.js answers them (ASTRA_MOCK=1 timings, as balance-sim.mjs).
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
          const asked = body.expect ? Contract.normaliseAction(body.expect) : "";
          const action = Verbs.VERBS[asked] ? asked : "land";
          const layout = { buttons: [{ type: "button", action, label: action.toUpperCase(), ...body.region }], source: "model" };
          w.setLayout(player, layout, body.kind);
          json = { ok: true, layout };
        }
        resolve({ status: 200, json: { ...json, drawingsLeft: w.drawingsLeft(player) } });
      }]));
    }
    return Promise.resolve({ status: 404, json: null });
  }

  const drivers = names.map((me, i) => {
    const route = i < nExperts ? "expert" : "regular";
    return { me, route, ...createDriver({ route, me, drawSeconds: route === "regular" ? 12 : 3, now: () => simMs, post, Contract }) };
  });
  let lastWorld = null; // the broadcast world (--spread hands each driver a filtered copy)
  listeners.push((m) => { if (m.type === "world") lastWorld = m; if (m.type !== "tick") for (const d of drivers) d.onMessage(m); });
  const flushLater = async () => {
    for (let i = 0; i < later.length; i++) if (later[i][0] <= simMs) { later.splice(i, 1)[0][1](); i--; }
    await new Promise((r) => setImmediate(r));
  };
  const hello = w.worldMessage();
  for (const d of drivers) { d.onMessage(hello); post("/input", { type: "input", player: d.me, action: "ready", down: true }); }
  const lobby = Promise.all(drivers.map((d) => d.lobbyDraws()));
  for (let i = 0; i < 10; i++) await flushLater();
  await lobby;
  simMs += 1500;
  w.start();
  let steps = 0, firstHit = null, bossDead = null;
  while (w.phase !== "scoreboard" && steps < 270 * Contract.SIM_HZ) {
    w.step(DT); steps++; simMs += DT * 1000;
    const b = w.debug().boss, playT = steps * DT;
    if (firstHit == null && b.hp < b.maxHp) firstHit = playT;
    if (bossDead == null && b.dead) bossDead = playT;
    if (steps % (Contract.SIM_HZ / Contract.TICK_HZ) === 0) {
      const tick = w.tickMessage();
      if (SPREAD) spreadChests(drivers, tick, lastWorld);
      for (const d of drivers) d.onMessage(tick);
      await flushLater();
    }
  }
  const dbg = w.debug();
  const D0 = drivers[0].D;
  const end = D0.result ? { reason: D0.result.reason, clock: D0.wonClock } : { reason: "none", clock: null };
  const endClock = end.clock ?? Contract.ROUND.maxSeconds;
  const clockOf = (D, k) => (D.stages[k] ? D.stages[k].clock : null);
  const per = drivers.map((d) => {
    const landed = clockOf(d.D, "landed");
    return { me: d.me, route: d.route, landed, chests: d.D.chestsOpened, deaths: d.D.deaths, planetShare: landed == null ? 0 : (endClock - landed) / endClock };
  });
  const bossDown = drivers.map((d) => clockOf(d.D, "bossDead") ?? clockOf(d.D, "bossDown")).filter((c) => c != null);
  return { seed, end, endClock, per, fight: firstHit != null && bossDead != null ? bossDead - firstHit : null, firstHit, bossDown: bossDown.length ? Math.min(...bossDown) : null, bossHp: dbg.boss.maxHp, count: w.worldMessage().playerCount, chests: dbg.chests.length, opened: dbg.chests.filter((c) => c.open).length };
}

const fmt = (c) => (c == null ? " -  " : `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, "0")}`);
const q = (xs, f) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : null; };
const t0 = Date.now();
console.log(`\n== crowd${SPREAD ? " (spread)" : " (blob)"}: ${HUMANS} humans (${Math.round(HUMANS * EXPERTS)} experts), ${BOTS} bots, seeds ${S0}-${S1} ==`);
console.log("seed bossDown (fight) landed(first/med/last) end            chests  planet share (expert / regular / all)  lost  deaths");
const shares = [];
for (let seed = S0; seed <= S1; seed++) {
  const r = await run(seed);
  const landed = r.per.map((p) => p.landed).filter((c) => c != null);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const share = (route) => mean(r.per.filter((p) => !route || p.route === route).map((p) => p.planetShare));
  shares.push(share());
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(`${String(seed).padEnd(4)} ${fmt(r.bossDown)} (${r.fight == null ? " - " : r.fight.toFixed(0).padStart(3)} s)  ${fmt(q(landed, 0))} / ${fmt(q(landed, 0.5))} / ${fmt(q(landed, 1))}   ${(r.end.reason + "@" + fmt(r.end.clock)).padEnd(14)} ${r.opened}/${r.chests}   ${pct(share("expert"))} / ${pct(share("regular"))} / ${pct(share())}${" ".repeat(18)}${r.per.length - landed.length}     ${r.per.reduce((n, p) => n + p.deaths, 0)}   (hp ${r.bossHp}, count ${r.count})`);
  if (VERBOSE) for (const p of r.per) console.log(`   ${p.me} ${p.route.padEnd(7)} landed ${fmt(p.landed)} chests ${p.chests} deaths ${p.deaths}`);
}
console.log(`\nmean planet share ${Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 100)}% in ${((Date.now() - t0) / 1000).toFixed(1)} s at ${new Date().toISOString()}`);
