// ENDLESS free-for-all (PLAN.md section 0, owner 10 Oct 11:53): "an unlimited free for all version that can be played
// infinitely, users can explore, get back to space, etc. ... just a toggle to have it". OFF by default: with it off the
// round flow is exactly the v1.5 demo (4:00 cap, every chest open ends it, assists at 3:00).
// Turned on by `node server.js --endless` (or ENDLESS=1), or from the big screen's lobby (the ENDLESS switch next to
// START, host key E: POST /mode { endless: true|false }); it holds for every session until it is switched off again.
// Every world and tick message then carries `mode: "endless"` (absent in the demo, so its messages are unchanged).
//
// The rules, while a session runs (phase "playing"):
// - no clock: no 4:00 cap, no 3:00 assists, no end when every chest is open; the host ends it (END on the big screen,
//   POST /end), then the normal results, then the lobby (a fresh start, as every round).
// - join any time: a late joiner spawns in space with a spawn shield (world.js getPlayer does that in any phase).
// - the boss comes back BOSS_RESPAWN s after it dies, with fresh HP for the players here now (and the rock field is
//   topped up); the planet stays open once it is open.
// - chests: when every chest is open (after a short pause for the gold burst), or every CHEST_REFRESH s, the opened ones
//   are replaced by new chests in new places (closed ones stay, with their digging progress); the count follows the
//   players here now.
// - take off from the planet (every explorer can: the innate "takeoff" skill; the phone shows a TAKE OFF button in
//   endless) and land again as often as you like; nothing is wiped while the session runs.
// - drawings recharge: +1 per world every RECHARGE s, up to the per-world maximum, so a redraw is always possible.
// - points add up; every LEADER s the big screen gets a "LEADER: X" banner (the scoreboard runs all along).
//
// This file is the rule logic only: timers and pure helpers. world.js owns the state and calls in (createEndless's
// hooks, documented there); server.js only flips the switch (world.setEndless) and ends the session (world.endSession).

const ENDLESS = {
  bossRespawnSeconds: 60,   // the boss is back this long after it dies
  bossWarnSeconds: 10,      // "the boss is back in 10 s" on the kill feed
  chestRefreshSeconds: 90,  // opened chests are replaced at least this often
  allOpenDelaySeconds: 5,   // every chest open: new ones after this pause (the treasure burst plays first)
  rechargeSeconds: 60,      // +1 drawing per world, up to the maximum
  leaderSeconds: 180,       // the "LEADER: X" banner
};
const MODE = "endless";

// The leader among the humans here (bots are fillers): most points, ties to whoever is listed first (join order).
function leaderOf(list) {
  let top = null;
  for (const p of list || []) if (p && !p.bot && p.score > 0 && (!top || p.score > top.score)) top = p;
  return top;
}

// New chests for the opened ones (pure). chests: the world's list; want: how many there should be now; at: the landing
// spot { x, z }; spread: how far from it they may lie; ok(x, z): a dry spot reachable on foot from the landing spot;
// random: the world's random. Closed chests stay as they are (ids, kind, digging progress); opened ones go; new ones get
// fresh ids (render.js ChestField starts a new id from its present state, no effects), the kind the field has fewer of,
// at least 8 m from every other chest (old spots included, so a new chest never appears where one was just opened) and
// 12 m from the landing spot. Returns a new list; when no spot fits, fewer new chests (never more than want in all).
function freshChests(chests, { want, at, spread, ok, random = Math.random }) {
  const keep = chests.filter((c) => !c.open);
  const avoid = chests.map((c) => ({ x: c.x, z: c.z }));
  let id = chests.reduce((m, c) => Math.max(m, c.id || 0), 0);
  const out = keep.slice();
  const count = (kind) => out.filter((c) => c.kind === kind).length;
  for (let i = 0; i < 60 * Math.max(1, want) && out.length < want; i++) {
    const ang = random() * Math.PI * 2, d = 12 + random() * Math.max(0, spread - 12);
    const x = at.x + Math.cos(ang) * d, z = at.z + Math.sin(ang) * d;
    if (avoid.some((c) => Math.hypot(c.x - x, c.z - z) <= 8) || !ok(x, z)) continue; // the cheap test first
    const kind = count("rock") < count("buried") ? "rock" : "buried";
    out.push({ id: ++id, kind, x, z, buried: true, dug: 0, open: false, by: null });
    avoid.push({ x, z });
  }
  return out;
}

// The session's timers. world: the hooks world.js gives (all required):
//   announce(text, big)  the kill feed / banner line
//   humans()             the active players [{ name, score, bot }] (bots are skipped here)
//   bossDead()           true while the boss is down
//   respawnBoss()        the boss back where it was: fresh HP for the players here now, alive, the rocks topped up
//   chests()             the world's chest list (read only)
//   refreshChests()      opened chests replaced by new ones (freshChests), the world message sent
//   recharge()           +1 drawing per world for every human below the maximum
// Returns { on, set(on), reset(), step(dt), fields() }: world.js calls reset() at START (and at every new lobby),
// step(dt) in play (phase "playing"), and spreads fields() into its world and tick messages.
function createEndless(world, { on = false } = {}) {
  const S = { on: !!on, boss: null, warned: false, chests: 0, allOpen: null, recharge: 0, leader: 0 };
  function reset() {
    Object.assign(S, { boss: null, warned: false, chests: 0, allOpen: null, recharge: 0, leader: 0 });
  }
  function stepBoss(dt) {
    if (!world.bossDead()) { S.boss = null; S.warned = false; return; }
    if (S.boss == null) { S.boss = ENDLESS.bossRespawnSeconds; S.warned = false; return; }
    S.boss -= dt;
    if (!S.warned && S.boss <= ENDLESS.bossWarnSeconds) { S.warned = true; world.announce(`👾 The boss is back in ${ENDLESS.bossWarnSeconds} s!`); }
    if (S.boss > 0) return;
    S.boss = null; S.warned = false;
    world.respawnBoss();
    world.announce("👾 The boss is back! Shoot it down: the last hit scores", true);
  }
  function stepChests(dt) {
    const list = world.chests() || [];
    const open = list.filter((c) => c.open).length;
    S.chests += dt;
    if (list.length && open === list.length) {
      if (S.allOpen == null) S.allOpen = ENDLESS.allOpenDelaySeconds;
      else if ((S.allOpen -= dt) <= 0) {
        S.allOpen = null; S.chests = 0;
        world.refreshChests();
        world.announce("💎 New chests on the planet!", true);
      }
      return;
    }
    S.allOpen = null;
    if (S.chests < ENDLESS.chestRefreshSeconds) return;
    S.chests = 0;
    if (open > 0) { world.refreshChests(); world.announce("💎 New chests on the planet!"); }
  }
  function step(dt) {
    if (!S.on) return;
    stepBoss(dt);
    stepChests(dt);
    if ((S.recharge += dt) >= ENDLESS.rechargeSeconds) { S.recharge = 0; world.recharge(); }
    if ((S.leader += dt) >= ENDLESS.leaderSeconds) {
      S.leader = 0;
      const top = leaderOf(world.humans());
      if (top) world.announce(`👑 LEADER: ${top.name} · ${top.score} points`, true);
    }
  }
  return {
    get on() { return S.on; },
    set(v) { S.on = !!v; reset(); return S.on; },
    reset, step,
    // Additive message fields: only in endless (the demo's messages stay exactly as they were).
    fields: () => (S.on ? { mode: MODE } : {}),
    debug: () => ({ ...S }),
  };
}

// --endless or ENDLESS=1 (also "true", "on", "yes").
function fromEnv(argv = process.argv, env = process.env) {
  return argv.includes("--endless") || /^(1|true|on|yes)$/i.test(String(env.ENDLESS || ""));
}

module.exports = { ENDLESS, MODE, createEndless, freshChests, leaderOf, fromEnv };
