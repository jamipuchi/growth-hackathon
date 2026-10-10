// The shared contract (PLAN.md step 1): constants, tuning, message shapes and their checks.
// Loaded by the server with require() and by the browser with <script src="contract.js">, like verbs.js and terrain.js.
// Change it only together with every lane that reads it.
(function (root) {
  const SIM_HZ = 30;
  const TICK_HZ = 15;
  const PERF_POST_SECONDS = 5;

  const PHASES = ["lobby", "playing", "assists", "scoreboard", "countdown"]; // v1.3: countdown (3-2-1 after START);
  // v1.4: a real server phase between the lobby and "playing" (see ROUND below, tick.countdown and POST /start)
  // v1.1 (PLAN.md section 0): the lobby lasts until the host presses START on the big screen (POST /start), or
  // autostartSeconds when the server runs with --autostart N (null = never). Playing lasts at most maxSeconds, or ends
  // earlier when every chest is open; most points wins. Assists at assistsAt: the chests glow and every hint jumps to
  // its last step ("draw X"); v1.3 (owner, 10 Oct 09:05): no skill is ever given, every human still missing a gate
  // skill gets one big "draw X" hint instead (toast late: true). Then a scoreboardSeconds scoreboard and back to the
  // lobby. v1.4 countdown (owner, 10 Oct 09:05: a real server phase): POST /start plays phase "countdown" for
  // countdownSeconds (3-2-1: ships, bots and bullets frozen on their spawn slots, tick.countdown = whole seconds left,
  // clock = exact seconds left) before "playing", so every phone counts down with the big screen. POST /start
  // { countdown: false } (tests), world.start() without options and --autostart start at once, as before.
  const ROUND = { autostartSeconds: null, maxSeconds: 240, assistsAt: 180, scoreboardSeconds: 10, countdownSeconds: 3 };
  // 1 unit = 1 m. Distances are the tuning targets from PLAN.md; playtests adjust them here only.
  const TUNING = {
    // v1.4 pacing (PLAN.md section 0, owner 10 Oct 10:00: "make sure you are not that far away from the boss + it has
    // less life so it can be completed faster"; "we want most of the time to be spent on the planet"). Space is a short
    // opening act: the boss about 20 s cruising (15 s with BOOST), down in about 10-15 s of shared fire, the planet
    // close behind it; most of the round is on the planet (more chests, spread wider, a little more digging and
    // drilling). A round still ends at 4:00 or when every chest is open. Old → new: bossDistance 1100 → 400
    // (nebula.distance too), boss.hp 3000 → 1200, boss.hpPerExtraPlayer 0.5 → 0.3, boss.botWeight new 0.5 (the boss's
    // HP counts a bot as half a player: at a close boss 24 bots fire ≈ 450 dps), botWeight 0.25 → 0 (only the chests
    // use it now: bots never land), boss.respawnDistance 300 → 200, rockCluster.radius 320 → 220, planet.offset
    // 800 → 350, island.chestsBase 2 → 15, chestsPerPlayer 0.7 → 0.65, chestsMax 20 → 32 (render.js draws at most 32
    // chests), chestSpread 48 → 34, chestSpreadPerChest 2 → 4, digSeconds 3 → 4, drillSeconds 3.5 → 4.5.
    // Speeds (unchanged): cruise 18, FORWARD +3 = 21 m/s; BOOST ×1.7 drains a full tank in 3.3 s, then pulses (1 s
    // recharge to 20%, 0.67 s boost): 40% duty = ×1.28. Spawn centre → boss: cruise 21 s, holding BOOST 15 s, FORWARD +
    // BOOST 13 s; boss → the planet's landing range 16 s at cruise (dev/v14-pacing/flight.mjs).
    // dev/netcode/balance-sim.mjs, 1 human + 24 bots (boss 5520 HP, 16 chests up to 98 m from the pad), seeds 1-6:
    //   expert (boosts, draws in the lobby): boss reached 0:11 · down 0:19-0:20 (11-12 s from the first hit) · landed
    //     0:35-0:39 · 16 chests (8 × 4 s dig + 8 × 4.5 s drill + walking) → every chest open at 2:54-3:12.
    //   regular (no boost, waits for each hint, draws in 12 s): boss 0:15 · down (bots) 0:27-0:28 · planet 0:43-0:45 ·
    //     a new ship with legs + the LAND button → landed 1:19-1:22 · explorer + DIG + DRILL → first chest 2:02-2:05 ·
    //     still opening chests at the 4:00 cap (11-13 of 16).
    //   25 humans (boss 9840 HP, 32 chests up to 162 m out; dev/v14-pacing/crowd-sim.mjs, 4 experts + 21 regulars):
    //     boss down 0:30 (the regulars' guns come with their drawings) · experts land 0:45, regulars 1:04-1:22 · every
    //     chest open at 2:09-2:20 when each human takes the chest nearest to them, 3:01-3:59 when the crowd bunches on
    //     one chest at a time: ≈ 3:00 for a real room in between, 52-74% (≈ 63%) of the round on the planet.
    //     First-timers only (no experts), spread out: 2:43-3:14, 59-65% on the planet.
    // v1.7 island 420 → 840 m (owner, 10 Oct 12:22; terrain.js): chests spread across it (16 up to 172 m from the pad, 32
    // up to 284 m) and explorers 1.5× faster (walkSpeed 8 → 12). balance-sim, seeds 1-6 (v1.6 auto-landing, both
    // islands): expert every chest open 2:54-3:12 → 3:00-3:19; regular 14-16 → 13-15 of 16 at the 4:00 cap (first
    // chest 1:28-1:31 either way). crowd-sim, 25 humans (10 experts), seeds 1-4: spread out 1:28-1:46 → 1:39-2:05,
    // bunched 2:09-3:23 → 3:05-4:00 (one bunched seed 30/32 at the cap), 62% → 67% (spread) of the round on the planet.
    // Bots never land, so they never open a chest: the chests are the humans' alone.
    worldRadius: 2200,
    bossDistance: 400,
    rockCount: 340,
    rockCluster: { share: 0.6, radius: 220 },   // share of the rocks within radius m of the boss
    spawnSpacing: 12,                           // unused since v1.3 (old readers): spawns use spawnRadius
    // v1.3 spawn (ruthless PvP): ships start on a sunflower disc of radius spawnRadius m across the line to the boss
    // (25 ships ≈ 40 m apart, side by side, all facing the boss; humans take the inner slots); rocks keep 40 m clear
    // of it. A respawn picks a spot at least spawnClear m from every other ship when there is room. flags.spawnShield
    // (invulnerable, cannot be hit by mischief) is on from every spawn and respawn until the player gives any input
    // or uses any skill, at most spawnShieldSeconds.
    spawnRadius: 130, spawnClear: 35, spawnShieldSeconds: 8,
    cruiseSpeed: 18,
    thrustSpeed: 3,
    brakeSpeed: 15,
    boostMultiplier: 1.7,
    strafeSpeed: 14,
    turnRate: 1.8,
    maxPitch: 1.4,
    bulletSpeed: 140,
    bulletLife: 1.4,
    fireCooldown: 0.12,
    bulletDamage: 12,
    shipHp: 100,
    respawnSeconds: 3,
    stunSeconds: 1.5,
    shield: { drainPerSecond: 0.35, rechargePerSecond: 0.15 },
    boost: { drainPerSecond: 0.3, rechargePerSecond: 0.2 },
    // The boss floats in a colourful (decorative) nebula at bossDistance, visible from far away.
    nebula: { distance: 400, radius: 220 },   // = bossDistance (world.js centres it on the boss)
    flare: { seconds: 14, radius: 120 },
    // No armour gate any more (armour is always 0 on the wire; TUNING.boss.armour stays for old readers). Any weapon
    // hurts it. maxHp = hp × (1 + hpPerExtraPlayer × (players − 1)), players counted at START as humans +
    // boss.botWeight × bots (bots are fillers, not players, but at a close boss they fire about half as hard as a
    // human): solo ≈ 15 s of steady fire (one gun lands ≈ 80 dps; v1.4 hp 1200, was 3000), 1 human + 24 bots 5520 HP ≈
    // 12 s, 25 players 9840 HP ≈ 10 s once 10 guns fire. v1.2: ships have no drill (it is a planet skill for the chests
    // locked in rocks); boss.drillRange / drillPerSecond are unused and stay only for old readers.
    botWeight: 0, // v1.4: the chest count only (humans + botWeight × bots); bots never land, so they add no chest
    // It shoots back: every shotEverySeconds / √(ships in shotRange), at a random one of them. A ship destroyed in
    // space respawns where it died, but at least respawnDistance m from a living boss.
    boss: { radius: 20, armour: 100, hp: 1200, hpPerExtraPlayer: 0.3, botWeight: 0.5, drillRange: 14, drillPerSecond: 100, shotEverySeconds: 1.2, shotRange: 260, shotSpeed: 70, shotDamage: 10, shotLife: 4, respawnDistance: 200 },
    scan: { range: 250, seconds: 8 },
    drawings: { space: 5, planet: 5 },   // finished drawings per player per round (PLAN.md, Drawing budget)
    // v1 keeps the world simple: plain rocks plus bonus crystals. The other types stay defined for later.
    rockTypesInPlay: ["stone", "crystal"],
    planet: { offset: 350, radius: 40, landRange: 25, landingSeconds: 3, takeoffSeconds: 2, parkedShipHp: 300 },
    // Chests: count = clamp(chestsBase + ceil(players × chestsPerPlayer), 3, chestsMax), players = humans + botWeight ×
    // bots (v1.4: humans only): 16 for one human, 19 for 5, 22 for 10, 32 for 25 (render.js draws at most 32). Half
    // buried (DIG), half in rocks (DRILL). chestSpread grows by chestSpreadPerChest per chest (v1.7, 840 m island: 16
    // chests up to 172 m from the pad, 22 up to 214 m, 32 up to 284 m: a full room covers most of the island). Planet
    // movement per entity type: walkSpeed × speeds[type] (× runMultiplier while running: BOOST on the planet); jumps only
    // for the types in jumpers. v1.7: walkSpeed 8 → 12 (run 24 m/s, car 29 / 58 m/s), chestSpread 34 → 60,
    // chestSpreadPerChest 4 → 7 (terrain.js ISLAND_SIZE 420 → 840).
    island: { chests: 3, chestsBase: 15, chestsPerPlayer: 0.65, chestsMax: 32, chestSpread: 60, chestSpreadPerChest: 7,
      walkSpeed: 12, runMultiplier: 2, jumpSpeed: 9, gravity: 24, digSeconds: 4, drillSeconds: 4.5, pickupRange: 3, explorerDrawSeconds: 15,
      speeds: { person: 1, quadruped: 1.6, car: 2.4, bike: 2.2, blob: 1.1 }, jumpers: ["person", "quadruped", "blob"] },
    // Ruthless (PLAN.md section 0): killing a player within stealSeconds after they opened a chest steals stealShare of
    // its points. Refused verbs explain themselves at most once per refusalToastSeconds per verb.
    stealSeconds: 15, stealShare: 0.5, refusalToastSeconds: 8,
  };

  const ROCK_TYPES = {
    stone: { health: 1 },
    iron: { health: 4 },
    volatile: { health: 1, blastRadius: 12, blastDamage: 30 },
    crystal: { health: 2, bonus: 50, heal: 30 },
    magnet: { health: 3, pullRange: 40, pullSpeed: 6 },
    splitter: { health: 2, splitInto: 2 },
  };
  const ROCK_TYPE_NAMES = Object.keys(ROCK_TYPES);

  // Most points wins the round; the winner gets a star on the session leaderboard. Scores reset every round.
  // wreck: wrecking a rival's parked ship on the landing pad (ruthless, announced in the kill feed).
  // mineHit: running into a rival's mine (v1.3 mischief, PLAN.md: "stunned and loses 30 points"). A kill by mischief
  // (a mine, or a tractor pull into a rock) scores like any kill.
  const SCORING = { rock: 10, crystal: 50, bossLastHit: 1000, chest: 1500, kill: 200, killed: -50, hitByRock: -30, wreck: 150, mineHit: -30 };

  // 25 player colours, one per player of a full round (the first 12 are the original set).
  const COLORS = [0x22d3ee, 0xf472b6, 0xa3e635, 0xfacc15, 0xfb923c, 0xc084fc, 0x60a5fa, 0xf87171, 0x34d399, 0xe879f9, 0xfbbf24, 0x38bdf8,
    0x2dd4bf, 0xa78bfa, 0xfde047, 0x4ade80, 0xfb7185, 0x818cf8, 0xf97316, 0x84cc16, 0x06b6d4, 0xd946ef, 0xeab308, 0x10b981, 0x3b82f6];

  // Input vocabulary. Movement names and sticks are always available; everything else is a verb from verbs.js.
  const MOVES = ["left", "right", "up", "down", "forward", "back", "strafeleft", "straferight", "rise", "sink"];
  const STICKS = ["steer", "move"];
  const META_ACTIONS = ["ready", "view"];
  // Labels people draw that mean an existing verb. The server normalises before the simulation sees them.
  const ALIASES = { fire: "shoot", win: "blast", light: "flare", cloak: "invisible", warp: "teleport" };

  // Objective titles (render.js game.hud() objectiveText, the phone's fallback HUD, the round's first announce). v1.4:
  // the old design's crackBoss ("CRACK THE BOSS": no armour gate since v1.1) and chest ("DIG UP A CHEST": chests are
  // buried or locked in rocks since v1.1) are gone; the planet's objective is openChests.
  const OBJECTIVES = {
    boss: "REACH THE BOSS",
    destroyBoss: "DESTROY THE BOSS",
    planet: "LAND ON THE PLANET",
    explorer: "DRAW YOUR EXPLORER",
    weapon: "DRAW A WEAPON",
    openChests: "OPEN THE CHESTS",
  };

  /*
   * Messages. Server → every screen over GET /events (one JSON object per SSE "data:" line):
   *
   * world      { type, round, seed, radius,
   *              rocks: [[id, x, y, z, size, typeIndex, health]],        // typeIndex into ROCK_TYPE_NAMES
   *              nebula: { x, y, z, radius },
   *              targets: [{ id, kind: "boss", x, y, z, radius, armour, hp, maxHp, cracked, dead }],  // one boss; v1.1: armour
                                                                      // is always 0 and cracked true (no gate), maxHp scales
   *              revealedTo: [playerName],                               // who has used SCAN (radar extras); everyone in "assists"
   *              planet: null | { x, y, z, radius, landRange },          // appears when the boss dies
   *              island: { seed, size, landing: { x, z },
                        parked: [{ player, x, z, hp, maxHp, wrecked, image?, spec? }] },   // v1.1: parked ships can be
                                                                      // shot; a wrecked one needs a new ship drawing
                                                                      // before take-off. image (v1.3, added by server.js
                                                                      // to every world message): the owner's ship
                                                                      // drawing, /drawings/<player>-ship.png?v=<hash>;
                                                                      // re-sent when a landed player redraws the ship
   *              entities: { [player]: entity },                         // only in the world message sent on connect
   *              chests: [{ id, kind: "buried"|"rock", x, z, buried, dug, open, by }],  // island coordinates. kind buried:
                                                                      // DIG it out; kind rock: DRILL the rock open.
                                                                      // buried = still closed (in the ground / the
                                                                      // rock), dug 0..1 progress, open = collected,
                                                                      // by = who opened it (or null)
   *              assists: bool,                                      // v1.1: the chests glow; v1.3: no free skills
   *                                                                  // (owner, 10 Oct 09:05), the hints say "draw X"
   *              playerCount: n,                                     // who the round is scaled for, counted at START:
   *                                                                  // humans + TUNING.botWeight (0.25) × bots, so it
   *                                                                  // can be fractional (1 human + 24 bots = 7). Boss
   *                                                                  // HP and the chest count use it
   *              result: null | { round, winner, scores: [[name, score]] },   // the scoreboard (phase "scoreboard").
   *                                                                  // v1.3: humans first (by points), then bots;
   *                                                                  // winner = scores[0] when it has points
   *              leaderboard: [{ name, stars, total }],              // session: stars = rounds won, total = points;
   *                                                                  // v1.3: humans first, then bots
   *              phase,                                              // v1.4: as tick.phase (a world message goes out
   *                                                                  // on every phase change: START, GO, 3:00, the end)
   *              countdown?,                                         // v1.4: only in phase "countdown", as tick.countdown
   *              mode? }                                             // v1.6: "endless" while the ENDLESS free-for-all is
   *                                                                  // on (endless.js; absent in the demo). Then: no
   *                                                                  // clock, result.reason "host" when the host ends it
   *            Sent on connect and whenever any of it changes.
   *
   * tick       { type, t, round, phase, clock, left,                     // clock: lobby = seconds to autostart (0 with no
   *                                                                      // autostart: the host presses START); scoreboard =
   *                                                                      // seconds left; playing/assists = seconds since
   *                                                                      // the start. left = seconds until the 4:00 cap.
   *                                                                      // v1.3 countdown = seconds left before GO
   *              countdown?,                                             // v1.4, only in phase "countdown" (the 3-2-1
   *                                                                      // after START): whole seconds left, 3 then 2
   *                                                                      // then 1; then phase "playing" (GO!). Nothing
   *                                                                      // moves or fires meanwhile, bots included
   *              players: [{ name, color, mode: "space"|"planet", x, y, z, yaw, pitch, roll, hp, score,   // v1.3:
   *                                                                      // humans first, then bots; score never < 0
   *                          shieldEnergy, boostEnergy,                  // 0..1, drive the HUD meters
   *                          drawingsLeft: { space, planet },            // humans only; bots omit it
   *                          respawnIn,                                  // seconds, only while flags.dead
   *                          bay: [x, z],                                // v1.2: only while landing / takingOff: the
   *                                                                      // island parking bay the shot ends on (= its
   *                                                                      // world.island.parked entry after touchdown)
   *                          flags: { boost, shield, stun, dead, invisible, drilling, digging, ready, bot,
   *                                   landing, takingOff, spawnShield,
   *                                   emp, inked, tractored, drawing },  // flags list only what is on; landing/takingOff:
   *                                                                      // the predefined animation plays, no control.
   *                                                                      // v1.3: emp / inked while that mischief runs on
   *                                                                      // the player's phone, tractored while pulled.
   *                                                                      // drawing: the phone's draw sheet is open (input
   *                                                                      // action "drawing"): hovering, protected, ≤ 30 s
   *                          action, slot, startedAt }],                 // last verb + animation slot + server ms
   *              bullets: [[id, x, y, z, color, mode]],                   // mode 0 = space, 1 = planet (island x, z, height y)
   *              bossShots: [[id, x, y, z]],
   *              flares: [[x, y, z, radius, secondsLeft]],                // the newest 16
   *              mines: [[id, x, y, z, mode, color]],                     // v1.3: mines (newest 16), mode as bullets;
   *                                                                      // color = the owner's
   *              decoys: [[id, x, y, z, yaw, color, owner, mode]],        // v1.3 (newest 16): draw the owner's entity
   *              mode?,                                                  // v1.6: "endless" as world.mode (absent in the
   *                                                                      // demo); left is then 0: no cap (HUD shows ∞)
   *              waiting?: [{ name, color, ready, drawingsLeft }] }      // v1.7 (owner 12:26, server readyGate): out of
   *                                                                      // the lobby, the players NOT in this round (not
   *                                                                      // ready at START, or joined later): no ship, no
   *                                                                      // score, not in players; their phone keeps
   *                                                                      // drawing and they play the next round with
   *                                                                      // those drawings. ready = ship + controller
   *                                                                      // done (ENDLESS: they enter as soon as ready).
   *                                                                      // In the lobby flags.ready = ship + controller.
   *                                                                      // (their drawing) there, facing yaw
   *            15 per second. In "planet" mode x, z are island coordinates and y is the feet height.
   *
   * fx         { type, kind, mode, pos: { x, y, z }, color, size }       // kind: explode, blast, spark, flare, scan,
   *                                                                      // drill, crack, land, dig, treasure, hit, respawn;
   *                                                                      // v1.3: emp, inkbomb, tractor, mine (dropped or
   *                                                                      // hit), decoy (appears). Unknown kinds: a burst
   * announce   { type, text, big }                                       // kill feed, boss down, winner. A kill is
   *                                                                      // "killer ✕ victim", plus 💣 / 🧲 for a mischief
   *                                                                      // kill; mischief lines start with ⚡ 🦑 🧲 💣 🎭
   * toast      { type, player, text, sketch, ghost, kind, verb, need, gate }  // one player only. Hints are riddles first:
   *                                                                      // kind "hint" (ladder) | "refused" (a verb the
   *                                                                      // entity has not unlocked; verb set) | "info".
   *                                                                      // need: "part" (draw it on the entity) | "button";
   *                                                                      // gate: weapon | land | dig | drill (hints only).
   *                                                                      // On death the victim gets kind "info" with
   *                                                                      // killer (name | null): "Destroyed by bob · back
   *                                                                      // in 3 s"
   *                                                                      // sketch: null | "drill"|"landing"|"shovel"|"gun", drawn faintly
   *                                                                      // on the pad; ghost: null | { action, x, y, w, h }, only in
   *                                                                      // the last step (PLAN.md section 4, Hints)
   *                                                                      // step (v1.4, hints): 1 riddle | 2 sketch | 3 the
   *                                                                      // answer ("Draw ...", the phone's big card).
   *                                                                      // v1.4 late hint (owner, 10 Oct 09:05: no free
   *                                                                      // skills at 3:00): from 3:00 a human still
   *                                                                      // missing what the gate ahead needs gets ONE
   *                                                                      // per gate and need: kind "hint", late: true,
   *                                                                      // title ("DRAW A SHOVEL": the big card's
   *                                                                      // headline), text (one short line, all an older
   *                                                                      // phone shows), part (the example sketch: gun |
   *                                                                      // landing | shovel | drill), parts (every part
   *                                                                      // to draw in that one redraw, usually one), on
   *                                                                      // ("ship" | "explorer": the drawing one tap
   *                                                                      // opens; "controller" for need "button", with
   *                                                                      // the ghost box), need, gate, step: 3, sketch:
   *                                                                      // null.
   *                                                                      // Nothing is ever granted
   *                                                                      // (entity.assisted is never set any more)
   * mischief   { type, kind, player, from, seconds, points?, dir?, victim? }   // v1.3, one player only: play it on that
   *                                                                      // phone. kind: emp (the buttons swap places for
   *                                                                      // seconds, 5) | inkbomb (ink over the screen,
   *                                                                      // v1.3: seconds 10 = the safety fade, it stays
   *                                                                      // until wiped with a finger) | tractor
   *                                                                      // (pulled for seconds; dir = where the puller is
   *                                                                      // on this player's screen, radians, 0 = right,
   *                                                                      // π/2 = up) | mine (stunned for seconds; points
   *                                                                      // lost, 30) | decoy (seconds 0: this player shot
   *                                                                      // from's decoy; with victim: your decoy fooled
   *                                                                      // victim, player = from = the owner)
   * hit        { type, player, from, amount, dir? }                      // v1.3, one player only (the hit marker): a
   *                                                                      // human was hurt by a player or the boss. from:
   *                                                                      // the attacker's name | "boss"; amount: damage
   *                                                                      // since the last one (at most 4 per second per
   *                                                                      // player); dir: where the attacker is on this
   *                                                                      // player's screen, as tractor (radians, 0 =
   *                                                                      // right, π/2 = up); absent when unknown.
   *                                                                      // Ruthless steals also send that player a toast
   *                                                                      // kind "info": "bob stole 750 of your points",
   *                                                                      // "bob stole the boss kill", "bob wrecked your
   *                                                                      // ship: draw a new ship to take off". server.js
   *                                                                      // sends hit only to the victim's streams, like
   *                                                                      // toast, mischief and cooldown
   * cooldown   { type, player, verb, seconds }                           // v1.3, one player only: that verb just fired
   *                                                                      // and is ready again in seconds (mischief, blast,
   *                                                                      // invisible, teleport, heal, flare, scan)
   * generated  { type, player, kind, layout, html, controls, htmlSource, padLayout }   // a controller layout is ready.
   *                                                                      // kind controller | button: layout as Astra read
   *                                                                      // it (button: the new control only); padLayout:
   *                                                                      // the whole pad now; html: the pad as one
   *                                                                      // controller document (kit v1, ctrl-sandbox.js);
   *                                                                      // controls: [{ action, kind, label }] in it =
   *                                                                      // the allowed actions; htmlSource "template" |
   *                                                                      // "model". kind "html": Sol's own HTML for the
   *                                                                      // same pad arrived later (no layout): swap it in.
   *                                                                      // Only the player's own screens get html.
   * entity     { type, player, entity }                                  // on join, every mode switch, redraw, unlock
   *              entity: { type: "ship"|"person"|"car"|"bike"|"quadruped"|"blob", rig,   // rig: the rigs.js template
   *                        verbs,                                        // EVERYTHING it can do now (innate + drawn;
   *                                                                      // v1.3: nothing is ever granted); world.js
   *                                                                      // refuses the rest
   *                        unlocked: [{ verb, part }],                   // the card: what the drawing unlocked and why
   *                        parts: [{ name, x, y }],                      // drawn parts, x, y fractions of the drawing
   *                        source: "plain"|"model"|"devkit"|"fallback"|"bot", anims, image?,
   *                                                                      // v1.5 source "fallback": a ship / explorer
   *                                                                      // drawing nobody could read (a timeout or a
   *                                                                      // failed model call): only its type's innate
   *                                                                      // skills (a ship flies, a person walks and
   *                                                                      // jumps), unlocked [], free (POST /generate)
   *                        spec?,                                        // v1.4, ships: the drawing as 3D parts
   *                                                                      // (astra-ship.js: hull, cockpit, wings, fins,
   *                                                                      // engines, weapons, extras, palette; source
   *                                                                      // "model" | "entity"), built by ship3d.js on
   *                                                                      // every screen; also on island.parked[].
   *                                                                      // Explorers (person, quadruped, car, bike,
   *                                                                      // blob): the BODY spec (astra-body.js: type,
   *                                                                      // head, torso, arms, legs, tail, vehicle,
   *                                                                      // items, palette; source "model" | "entity"),
   *                                                                      // built rigged by entity3d.js. A model spec
   *                                                                      // that lands after the /generate answer
   *                                                                      // re-sends the entity
   *                                                                      // Spec source "model": the spec call (one
   *                                                                      // more strict-JSON call per ship / explorer
   *                                                                      // drawing since v1.4, next to the entity
   *                                                                      // reading, cached by image; the answer waits
   *                                                                      // for it at most 100 ms); "entity": made
   *                                                                      // from the entity's own parts (ASTRA_MOCK,
   *                                                                      // no key, a failed spec call). Still running
   *                                                                      // after 100 ms: no spec yet (inflate.js
   *                                                                      // builds the plush body), then the re-send
   *                        card,                                         // v1.3: the unlock card in plain words, ≤ 200
   *                                                                      // chars ("Your ship can: fly, shoot (cannon)"):
   *                                                                      // Astra's for a drawing, else Verbs.cardOf
   *                        assisted? }                                   // old readers only: never set since v1.3 (no
   *                                                                      // free skills at 3:00, owner 10 Oct 09:05)
   *              Every redraw sends a fresh entity message, even with the same skills (a new look or card).
   *              verbs may include the v1.3 mischief skills: mine, tractor, emp, inkbomb, decoy (verbs.js MISCHIEF).
   *
   * Phone → server:
   * GET  /events?player=<name> | ?screen=big          // SSE. A phone names itself (it alone gets its toast, mischief
   *                                                  // and controller html); the TV says screen=big (no toasts).
   *                                                  // A stream with neither gets everything, as before
   * GET  /ship-spec?v=<hash>                          → { ok, spec } | 404   // v1.4: the spec of a ship (or explorer: body spec) drawing by the
   *                                                  // ?v= of its /drawings URL (sha1 of the PNG, 10 hex): the phone's
   *                                                  // result card (its first ship comes before its event stream)
   *                                                  // Both kinds: spec = a ship spec (astra-ship.js) for a ship
   *                                                  // drawing, a body spec (astra-body.js, with its type) for an
   *                                                  // explorer drawing. 404 { ok: false, error: "no spec" } until a
   *                                                  // spec is known (the /generate answer's, or the model's late
   *                                                  // one); the newest 200 drawings are kept
   * GET  /info                                        → { lanUrl, httpsUrl, controllerUrl, bigScreenUrl }   // v1.2: the
   *                                                  // join QR opens controllerUrl (HTTPS when it is up, else HTTP);
   *                                                  // httpsUrl is null when HTTPS is off
   * GET  /controller.webmanifest, /icons/<name>.png  // v1.4: the phone as a home-screen web app (manifest served as
   *                                                  // application/manifest+json); /apple-touch-icon[-WxH][-precomposed].png
   * POST /join      { player, device? }              → { player, color, renamed? }  (player = the cleaned name;
   *                                                  // device: a random token the phone keeps; a name in use by
   *                                                  // another device gets "name2" and renamed: true; 400 when the
   *                                                  // name is empty or the game is full: v1.3, 25 players, humans
   *                                                  // and bots together; a new human takes the newest bot's place)
   * POST /start     { countdown? }                   → { ok, round, phase, countdown? } | 409 { ok: false, error: "not in
   *                                                  // the lobby", phase }. The big screen's START button. v1.4: the
   *                                                  // world plays phase "countdown" for ROUND.countdownSeconds (3 s:
   *                                                  // tick.countdown 3, 2, 1), then "playing"; countdown: false (or 0)
   *                                                  // starts at once (tests). The TV posts at once and shows the 3-2-1
   *                                                  // from the phase (no local countdown before the POST)
   *                                                  // v1.7: 409 { ok: false, error: "nobody is ready", ready: 0 }
   *                                                  // when no human has a ship and a controller yet; only the ready
   *                                                  // players enter (the rest wait: tick.waiting). 200 adds ready: n
   * POST /mode      { endless: true | false }        → { ok, mode: "endless"|"demo", phase } | 409 { ok: false, error:
   *                                                  // "not in the lobby", phase, mode } | 501 (no endless mode). v1.6:
   *                                                  // the big screen's ENDLESS switch (host key E); it holds until
   *                                                  // switched off; `node server.js --endless` / ENDLESS=1 starts on
   * POST /end       {}                               → { ok, round, phase: "scoreboard" } | 409 { ok: false, error: "no
   *                                                  // endless session to end", phase, mode }. v1.6: the big screen's
   *                                                  // END in an endless session: results (reason "host"), then lobby
   * POST /input     { type: "input", player, action, down }    // v1.3: only a joined player (else 409 "join first";
   *                                                  // world.handleInput returns false for an unknown name; a
   *                                                  // never-joined name whose own /events?player= stream is open
   *                                                  // is re-joined automatically, e.g. after a server restart).
   *                                                  // device? (or token?): 403 { ok: false, error: "name taken" }
   *                                                  // when it differs from the token the name joined with (none =
   *                                                  // accepted as before).
   *                                                  // action "drawing" (not a verb, never on a control):
   *                                                  // down when the draw / add-a-button sheet opens, up when it
   *                                                  // closes: the ship hovers and cannot be hurt (≤ 30 s per press)
   *                 { type: "axis", player, axis: "steer"|"move", x, y }  // -1..1, at most 20 per second
   * POST /generate  { player, kind: "controller"|"button"|"ship"|"explorer", image, speculative, requestId,
   *                   source?: "photo"|"draw", region?, expect?, pad?, anyway?, inkRegions?, device? }
   *                 // v1.3: device as /input (403 "name taken" + message); a never-joined name with an image is
   *                 // joined first (400 "the game is full" when full); the server adds where: "space"|"planet" (the
   *                 // player's world) before calling Astra.
   *                 → { ok: true, layout | entity, looksLike?, drawingsLeft, fallback?,   // fallback: true = Astra
   *                                                                      // could not answer a finished ship / explorer:
   *                                                                      // the generous dev kit (source "devkit")
   *                                                                      // wearing the drawing; it counts as a drawing
   *                                                                      // (v1.3). v1.5 (QA M1): the PLAIN entity
   *                                                                      // instead (source "fallback", nothing
   *                                                                      // unlocked) and it is free:
   *                     free?, failed?, kept?,                           // free: true = no drawing spent (always with
   *                                                                      // fallback); failed: "timeout" | "error";
   *                                                                      // kept: true = a redraw nobody could read
   *                                                                      // while the player already has a read entity
   *                                                                      // in that world: the answer carries that
   *                                                                      // entity and nothing changes. The phone says
   *                                                                      // so and offers TRY AGAIN. Never cached.
   *                                                                      // ASTRA_MOCK / no key: Astra still answers
   *                                                                      // the dev kit
   *                     html, controls, htmlSource, padLayout }          // controller | button only: the pad as HTML now
   *                                                                      // (see generated); Sol's own follows
   *                 | { ok: false, error, message, looksLike?, thing?, drawingsLeft }   // image: PNG data URL, max 512 px.
   *                 // message: plain words to show the player as they are ("" = show nothing, e.g. "slow down").
   *                 // region (button): its rectangle on the pad. expect (button): the verb the game asked for (a ghost
   *                 // box). pad (button): the controls on the phone now (action ids). anyway: true = "Use it anyway" on
   *                 // a refused drawing (answered from the cache). inkRegions (controller): [{ x, y, w, h, round }] the
   *                 // phone's ink components, used when the model cannot answer. Refusals (looksLike = the other
   *                 // kind; thing: ship|person|car|bike|animal|creature|object) and errors spend no drawing. Errors:
   *                 // "no drawings left", "slow down" (more than 8 speculative calls in 10 s), "timeout",
   *                 // "generation unavailable", refusal texts ("looks like a ship"...). v1.4: a request the phone
   *                 // gives up on (it aborts the fetch: the connection closes before the answer) spends no drawing and
   *                 // changes nothing (no layout, entity or generated message); Astra drops its model call when
   *                 // nobody else waits for that drawing, so tapping Done again reads it afresh
   * POST /controller-html { player, wait? }          → { ok, html, controls, htmlSource, padLayout, pending }  // v1.2:
   *                                                  // the player's controller document now (a reloaded phone);
   *                                                  // wait: true waits for a Sol call still running
   * POST /perf      { player, screen: "phone"|"big", ua, fps, low1, p90ms, calls, tris, textures, tier, w, h, dpr }
   *
   * Hall of fame (v1.6, owner 10 Oct 11:57; hall.js, hall-of-fame.html). Every finished ship, explorer and controller
   * drawing of the session is archived when the server accepts it (before a new round wipes gameplay state), in memory
   * and in hall/ (git-ignored); a server restart or POST /hall/reset starts a new session. Judged by the OpenAI
   * Decisions API (POST https://api.openai.com/v1/decisions, gpt-6-luna; developers.openai.com/api/docs/guides/decisions):
   * four score questions (creativity, effort, readability, fun → 0-100 each, score = their mean) and one choice question
   * (the playful comment, from hall.js COMMENTS). One call per drawing, at most 60 per session, cached by the PNG's hash;
   * a drawing that could not be judged keeps score null and still shows. ASTRA_MOCK=1 / HALL_MOCK=1: mock scores.
   * GET  /hall-of-fame.html[?judge=1]                 // the ranked wall (podium + list), each drawing side by side
   *                                                  // with its generation (3D from spec, or the controller HTML);
   *                                                  // ?judge=1 starts judging on open (the TV's HALL OF FAME button)
   * GET  /hall      → { ok, session, startedAt, judging, entries }   // ranked: scored by score (rank 1..n), then
   *                                                  // the rest (rank null)
   *   judging: { running, done, judged, failed, skipped, pending, unjudged, total, calls, maxCalls, api, model, mock }
   *   entries[]: { rank, id, player, color: "#rrggbb", round, kind: "ship"|"explorer"|"controller", type, at, final,
   *                image: "/hall/img/<id>.png", spec (ship / body spec) | null, layout (controller pad) | null,
   *                ctrl: "/hall/ctrl/<id>.html" | null, htmlSource, skills: [{ verb, part }], card, source,
   *                judge: "unjudged"|"queued"|"judging"|"done"|"failed"|"skipped", error, scores: { creativity, effort,
   *                readability, fun } | null, score: 0-100 | null, comment | null, mock, cached }
   *                final: false = the player redrew it later in that round
   * GET  /hall/img/<id>.png | /hall/ctrl/<id>.html    // an archived drawing; an archived controller's HTML (served
   *                                                  // with a CSP sandbox: no script runs)
   * POST /hall/judge {}                               → { ok, judging }   // queue every drawing not judged yet
   *                                                  // (idempotent: a running judge goes on; a failure is retried once)
   * POST /hall/reset { confirm: true }                → { ok, session }   // a brand-new session: the archive is emptied
   *
   * Controller layout v2 (PLAN.md section 3):
   *   { buttons: [{ type: "button"|"stick"|"toggle", action, label, x, y, w, h, auto? }],
   *     source: "model"|"default"|"manual"|"regions" }
   *   x, y, w, h are fractions of the drawing pad. A stick's action is "steer" or "move". source "regions": built from
   *   the phone's inkRegions (no model answer). auto: true = a steer stick the server added because the drawing had no
   *   way to turn (PLAN.md section 7, "Never stuck"). v1.5 (QA N1): ink: true (with auto: true) = that stick sits on a
   *   circle (or roughly square blob on the left half) the player drew that no control covers, found in the phone's
   *   inkRegions; without ink the stick went to the roomiest empty spot. The result card does not call it "added".
   *
   * render.js (ES module, shared by space.html and controller.html):
   *   startGame({ canvas, screen: "big"|"phone", view: "spectator"|"chase"|"cockpit", player }) → game
   *   game.setView(view)      game.setPlayer(name)      game.dispose()
   *   game.on(event, cb)      events: world, tick, fx, announce, toast, generated, hud
   *   game.hud() → { phase, clock, objective, objectiveText, bar, status, me, radar, scores, tier }
   *     me:    { name, mode, hp, score, shieldEnergy, boostEnergy, flags } | null
   *     radar: [{ kind: "you"|"player"|"boss"|"target"|"objective", dx, dz, dy }]   // relative to me, metres
   *   It owns the /events connection, interpolation, adaptive quality and the perf overlay (?perf) and POST /perf.
   */

  const CHEST_KINDS = ["buried", "rock"];
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const isStr = (v) => typeof v === "string" && v.length > 0;

  function check(errors, ok, message) {
    if (!ok) errors.push(message);
  }

  function checkWorld(m, errors = []) {
    check(errors, m.type === "world", "world: type");
    check(errors, Array.isArray(m.rocks) && m.rocks.every((r) => Array.isArray(r) && r.length === 7 && r.every(isNum)), "world: rocks are [id,x,y,z,size,typeIndex,health]");
    check(errors, m.nebula && ["x", "y", "z", "radius"].every((k) => isNum(m.nebula[k])), "world: nebula");
    check(errors, Array.isArray(m.targets) && m.targets.every((t) => ["boss", "decoy"].includes(t.kind) && ["x", "y", "z", "radius", "armour", "hp", "maxHp"].every((k) => isNum(t[k]))), "world: targets");
    check(errors, Array.isArray(m.targets) && m.targets.filter((t) => t.kind === "boss").length === 1, "world: exactly one boss");
    check(errors, Array.isArray(m.revealedTo), "world: revealedTo");
    check(errors, m.planet === null || ["x", "y", "z", "radius", "landRange"].every((k) => isNum(m.planet[k])), "world: planet");
    check(errors, m.island && isNum(m.island.seed) && isNum(m.island.size), "world: island");
    check(errors, Array.isArray(m.chests) && m.chests.every((c) => isNum(c.x) && isNum(c.z) && typeof c.buried === "boolean" && CHEST_KINDS.includes(c.kind)), "world: chests");
    check(errors, Array.isArray(m.leaderboard) && m.leaderboard.every((r) => isStr(r.name) && isNum(r.stars) && isNum(r.total)), "world: leaderboard");
    check(errors, m.result === null || (m.result && Array.isArray(m.result.scores)), "world: result");
    check(errors, m.mode === undefined || m.mode === "endless", "world: mode is absent or \"endless\""); // v1.6
    return errors;
  }

  function checkTick(m, errors = []) {
    check(errors, m.type === "tick", "tick: type");
    check(errors, PHASES.includes(m.phase), "tick: phase");
    check(errors, isNum(m.clock), "tick: clock");
    check(errors, isNum(m.left), "tick: left");
    check(errors, m.countdown === undefined || (m.phase === "countdown" && Number.isInteger(m.countdown) && m.countdown >= 1), "tick: countdown is a whole number of seconds, only in phase countdown");
    check(errors, Array.isArray(m.players), "tick: players");
    (m.players || []).forEach((p, i) => {
      check(errors, isStr(p.name), `tick: players[${i}].name`);
      check(errors, ["space", "planet"].includes(p.mode), `tick: players[${i}].mode`);
      check(errors, ["x", "y", "z", "yaw", "pitch", "roll", "hp", "score", "shieldEnergy", "boostEnergy"].every((k) => isNum(p[k])), `tick: players[${i}] numbers`);
      check(errors, p.flags && typeof p.flags === "object", `tick: players[${i}].flags`);
    });
    check(errors, Array.isArray(m.bullets) && Array.isArray(m.bossShots) && Array.isArray(m.flares), "tick: bullets, bossShots, flares");
    check(errors, (m.mines === undefined || Array.isArray(m.mines)) && (m.decoys === undefined || Array.isArray(m.decoys)), "tick: mines, decoys");
    check(errors, m.mode === undefined || m.mode === "endless", "tick: mode is absent or \"endless\""); // v1.6
    check(errors, m.waiting === undefined || (Array.isArray(m.waiting) && m.waiting.every((w) => w && isStr(w.name))), "tick: waiting is absent or a list of { name }"); // v1.7
    return errors;
  }

  const MISCHIEF_KINDS = ["mine", "tractor", "emp", "inkbomb", "decoy"];
  function checkMischief(m, errors = []) {
    check(errors, m.type === "mischief", "mischief: type");
    check(errors, MISCHIEF_KINDS.includes(m.kind), "mischief: kind");
    check(errors, isStr(m.player) && isStr(m.from), "mischief: player and from");
    check(errors, isNum(m.seconds) && m.seconds >= 0 && m.seconds <= 10, "mischief: seconds");
    check(errors, m.kind !== "inkbomb" || m.seconds <= 10, "mischief: ink fades by itself after at most 10 s");
    check(errors, m.dir === undefined || isNum(m.dir), "mischief: dir");
    return errors;
  }

  function checkCooldown(m, errors = []) {
    check(errors, m.type === "cooldown" && isStr(m.player) && isStr(m.verb), "cooldown: type, player, verb");
    check(errors, isNum(m.seconds) && m.seconds > 0 && m.seconds <= 60, "cooldown: seconds");
    return errors;
  }

  function checkGenerated(m, errors = []) {
    check(errors, m.type === "generated", "generated: type");
    check(errors, isStr(m.player), "generated: player");
    check(errors, ["controller", "button", "html"].includes(m.kind), "generated: kind");
    if (m.kind !== "html") checkLayout(m.layout || {}, errors);
    check(errors, m.html === undefined || (typeof m.html === "string" && /^\s*(<!doctype html|<html[\s>])/i.test(m.html)), "generated: html");
    check(errors, m.html === undefined || (["template", "model"].includes(m.htmlSource) && Array.isArray(m.controls) && m.padLayout && Array.isArray(m.padLayout.buttons)), "generated: htmlSource, controls, padLayout");
    return errors;
  }

  function checkLayout(m, errors = []) {
    check(errors, Array.isArray(m.buttons) && m.buttons.length > 0 && m.buttons.length <= 16, "layout: 1 to 16 buttons");
    (m.buttons || []).forEach((b, i) => {
      const kind = b.type || "button";
      check(errors, ["button", "stick", "toggle"].includes(kind), `layout: buttons[${i}].type`);
      check(errors, isStr(b.action), `layout: buttons[${i}].action`);
      check(errors, kind !== "stick" || STICKS.includes(b.action), `layout: buttons[${i}] stick action is steer or move`);
      check(errors, ["x", "y", "w", "h"].every((k) => isNum(b[k]) && b[k] >= 0 && b[k] <= 1), `layout: buttons[${i}] rectangle in 0..1`);
    });
    return errors;
  }

  function checkInput(m, errors = []) {
    check(errors, isStr(m.player), "input: player");
    if (m.type === "input") check(errors, isStr(m.action) && typeof m.down === "boolean", "input: action and down");
    else if (m.type === "axis") check(errors, STICKS.includes(m.axis) && isNum(m.x) && isNum(m.y), "axis: axis, x, y");
    else errors.push("input: type is input or axis");
    return errors;
  }

  function checkPerf(m, errors = []) {
    check(errors, ["phone", "big"].includes(m.screen), "perf: screen");
    check(errors, ["fps", "low1", "p90ms", "calls", "tris"].every((k) => isNum(m[k])), "perf: numbers");
    return errors;
  }

  const CHECKS = { world: checkWorld, tick: checkTick, layout: checkLayout, input: checkInput, perf: checkPerf, mischief: checkMischief, cooldown: checkCooldown, generated: checkGenerated };

  const normaliseAction = (action) => ALIASES[String(action).toLowerCase()] || String(action).toLowerCase();
  const cleanName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);

  const Contract = {
    SIM_HZ, TICK_HZ, PERF_POST_SECONDS, PHASES, ROUND, TUNING, ROCK_TYPES, ROCK_TYPE_NAMES, SCORING, COLORS,
    MOVES, STICKS, META_ACTIONS, ALIASES, OBJECTIVES, CHECKS, CHEST_KINDS, MISCHIEF_KINDS, normaliseAction, cleanName,
  };
  root.Contract = Contract;
  if (typeof module !== "undefined") module.exports = Contract;
})(typeof globalThis !== "undefined" ? globalThis : this);
