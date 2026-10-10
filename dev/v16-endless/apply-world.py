# v16-endless: the hook edits to world.js (exact patch plan + applier). Each anchor must match exactly once, else
# nothing is written. Run from the repo root once world.js is free (after the "v1.6 sim" commit):
#   python3 dev/v16-endless/apply-world.py [--dry]
# With the ENDLESS switch off every change is a no-op: endless.on is false, endless.fields() is {}, so the demo's
# messages and round flow stay exactly as in v1.5.
import sys

PATH = "world.js"
EDITS = [
  # 1. header note
  ("""// the nearest human rival (mischief()); the victim's phone gets a `mischief` message and the kill feed announces it.
const Contract = require("./contract");""",
   """// the nearest human rival (mischief()); the victim's phone gets a `mischief` message and the kill feed announces it.
// v1.6 ENDLESS (owner, 10 Oct 11:53; endless.js): an optional free-for-all, off by default (setEndless, in the lobby):
// no clock, the boss and the chests come back, drawings recharge, the host ends it (endSession). Off, nothing changes.
const Contract = require("./contract");"""),
  # 2. require
  ("""const Rules = require("./rules");
""",
   """const Rules = require("./rules");
const Endless = require("./endless");
"""),
  # 3. the endless timers and the hooks they call (after dry(): every name they use is declared by then)
  ("""  const dry = (x, z) => Terrain.height(x, z, island.seed) > 0.3 && Math.hypot(x, z) < island.size / 2 - 5;
""",
   """  const dry = (x, z) => Terrain.height(x, z, island.seed) > 0.3 && Math.hypot(x, z) < island.size / 2 - 5;
  // v1.6 ENDLESS (endless.js): the session's timers, off by default; these hooks are all it touches.
  const endless = Endless.createEndless({
    announce: (text, big) => announce(text, big),
    humans: () => active().filter((q) => !q.bot),
    bossDead: () => !!boss && boss.dead,
    respawnBoss: () => respawnBoss(),
    chests: () => chests || [],
    refreshChests: () => refreshChests(),
    // +1 drawing per world for every human below the maximum (rules.js refund)
    recharge: () => { if (typeof budget.refund === "function") for (const q of active()) if (!q.bot) { budget.refund(q.name, "space"); budget.refund(q.name, "planet"); } },
  });
"""),
  # 4. START resets the endless timers
  ("""    for (const p of Object.values(players)) { spawnAt(p); Object.assign(p, { pressed: [], score: 0, lastChest: null, hitBy: {}, run: null, botBoost: false, hitAcc: 0 }); }
""",
   """    for (const p of Object.values(players)) { spawnAt(p); Object.assign(p, { pressed: [], score: 0, lastChest: null, hitBy: {}, run: null, botBoost: false, hitAcc: 0 }); }
    endless.reset(); // v1.6 ENDLESS: the boss, chest, recharge and leader timers start again
"""),
  # 5. the host's END reads as such in the kill feed (the demo never ends with reason "host")
  ("""    const why = reason === "chests" ? "Every chest is open" : "Time's up";""",
   """    const why = reason === "chests" ? "Every chest is open" : reason === "host" ? "Game over" : "Time's up"; // host: v1.6 ENDLESS END"""),
  # 6. the endless hooks and the switch, right after endRound
  ("""    announce(winner ? `🏆 ${why}! ${winner} wins round ${S.round} with ${scores[0][1]} points` : `${why}! Nobody scored this round`, true);
    sendWorld();
  }
""",
   """    announce(winner ? `🏆 ${why}! ${winner} wins round ${S.round} with ${scores[0][1]} points` : `${why}! Nobody scored this round`, true);
    sendWorld();
  }

  // ---- ENDLESS (v1.6, endless.js) -------------------------------------------------------------------------------
  // The big screen's switch (POST /mode): only in the lobby; it holds for every session until switched off. Every screen
  // hears it at once (world.mode).
  function setEndless(on) {
    if (S.phase !== "lobby") return false;
    if (endless.on !== !!on) { endless.set(on); sendWorld(); }
    return true;
  }
  // The host's END (POST /end): an endless session in play ends now: the normal results (reason "host"), then the lobby.
  function endSession() {
    if (!endless.on || (S.phase !== "playing" && S.phase !== "assists")) return false;
    endRound("host");
    return true;
  }
  // The boss back where it died: fresh HP for the players here now, nobody's damage carried over, no shots in flight;
  // the rock field topped up to TUNING.rockCount (new rocks keep 30 m clear of every ship). The planet stays open.
  function respawnBoss() {
    const hp = bossHp(hpCount(active()));
    Object.assign(boss, { hp, maxHp: hp, dead: false, shotCd: T.boss.shotEverySeconds, damageBy: Object.create(null) });
    bossShots = [];
    const ships = active().filter((q) => q.mode === "space" && !q.dead);
    for (let i = 0; i < 3 * T.rockCount && rocks.length < T.rockCount; i++) {
      const rock = spawnRock();
      if (ships.every((q) => dist(q.pos, rock.pos) > rock.size + 30)) rocks.push(rock);
    }
    fx("respawn", boss.pos, 0xef4444, boss.radius);
    sendWorld();
  }
  // Opened chests replaced by new ones in new places (endless.js freshChests), as many as the players here now call for.
  function refreshChests() {
    S.playerCount = scaledCount(active());
    const want = chestCount(S.playerCount);
    chests = Endless.freshChests(chests, { want, at: landing, spread: ISL.chestSpread + ISL.chestSpreadPerChest * want,
      ok: (x, z) => dry(x, z) && dryLine(landing.x, landing.z, x, z), random });
    sendWorld();
  }
"""),
  # 7. every chest open ends only the demo's round (endless.js puts new chests out instead)
  ("""    if (chests.every((c) => c.open)) endRound("chests");""",
   """    if (!endless.on && chests.every((c) => c.open)) endRound("chests"); // v1.6 ENDLESS: new chests instead (endless.js)"""),
  # 8. the clock: no 3:00 assists and no 4:00 cap in endless; its timers run in play
  ("""      S.playT += dt;
      if (S.phase === "playing" && S.playT >= ROUND.assistsAt) startAssists();
      simulate(list, dt);
      if (S.phase !== "scoreboard" && S.playT >= ROUND.maxSeconds) endRound("time");
""",
   """      S.playT += dt;
      if (!endless.on && S.phase === "playing" && S.playT >= ROUND.assistsAt) startAssists();
      simulate(list, dt);
      if (endless.on) { if (S.phase === "playing") endless.step(dt); } // v1.6 ENDLESS: no clock (endless.js)
      else if (S.phase !== "scoreboard" && S.playT >= ROUND.maxSeconds) endRound("time");
"""),
  # 9. world message: mode "endless" (absent in the demo)
  ("""      phase: S.phase, ...countdownField(), // v1.4: a screen that connects mid-countdown counts down at once
""",
   """      phase: S.phase, ...countdownField(), // v1.4: a screen that connects mid-countdown counts down at once
      ...endless.fields(), // v1.6: mode "endless" while it is on, absent in the demo
"""),
  # 10. tick: no cap in endless (left 0), and the same mode field
  ("""      left: S.phase === "playing" || S.phase === "assists" ? r2(Math.max(0, ROUND.maxSeconds - S.playT)) : 0,
      ...countdownField(),
""",
   """      left: (S.phase === "playing" || S.phase === "assists") && !endless.on ? r2(Math.max(0, ROUND.maxSeconds - S.playT)) : 0,
      ...countdownField(),
      ...endless.fields(), // v1.6 ENDLESS: mode "endless" (absent in the demo); left 0 = no cap
"""),
  # 11. the API server.js uses
  ("""    seat: (name) => !!getPlayer(name, false, { create: false }),
""",
   """    seat: (name) => !!getPlayer(name, false, { create: false }),
    // v1.6 ENDLESS (endless.js): the switch (lobby only, false otherwise), the host's END (false unless an endless
    // session is in play), and whether it is on.
    setEndless, endSession,
    get endless() { return endless.on; },
"""),
  # 12. debug view
  ("""    debug: () => ({ ...S, boss, planet, landing, chests, island, parked, rocks, bullets, bossShots, mines, decoys }),""",
   """    debug: () => ({ ...S, boss, planet, landing, chests, island, parked, rocks, bullets, bossShots, mines, decoys, endless: endless.debug() }),"""),
]

def main():
    dry = "--dry" in sys.argv
    src = open(PATH, encoding="utf-8").read()
    if "require(\"./endless\")" in src:
        print("world.js already has the endless hooks: nothing to do")
        return
    bad = [(i + 1, src.count(a)) for i, (a, _) in enumerate(EDITS) if src.count(a) != 1]
    if bad:
        for n, c in bad: print(f"edit {n}: anchor found {c} times (want 1)")
        sys.exit(1)
    for a, b in EDITS: src = src.replace(a, b)
    if dry: print(f"dry run: all {len(EDITS)} anchors match once"); return
    open(PATH, "w", encoding="utf-8").write(src)
    print(f"world.js: {len(EDITS)} endless edits applied")

main()
