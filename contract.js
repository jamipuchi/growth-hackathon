// The shared contract (PLAN.md step 1): constants, tuning, message shapes and their checks.
// Loaded by the server with require() and by the browser with <script src="contract.js">, like verbs.js and terrain.js.
// Change it only together with every lane that reads it.
(function (root) {
  const SIM_HZ = 30;
  const TICK_HZ = 15;
  const PERF_POST_SECONDS = 5;

  const PHASES = ["lobby", "playing", "assists", "scoreboard"];
  // v1.1 (PLAN.md section 0): the lobby lasts until the host presses START on the big screen (POST /start), or
  // autostartSeconds when the server runs with --autostart N (null = never). Playing lasts at most maxSeconds, or ends
  // earlier when every chest is open; most points wins. Assists at assistsAt: the gate skills unlock for everyone still
  // missing them and the chests glow. Then a scoreboardSeconds scoreboard and back to the lobby.
  const ROUND = { autostartSeconds: null, maxSeconds: 240, assistsAt: 180, scoreboardSeconds: 10 };
  // 1 unit = 1 m. Distances are the tuning targets from PLAN.md; playtests adjust them here only.
  const TUNING = {
    // The boss is about a minute of cruise flight from spawn (bossDistance / cruiseSpeed ≈ 61 s), the planet
    // planetBeyond m further on along the same line; the rocks are dense around the boss and thin out.
    worldRadius: 2000,
    bossDistance: 1100,
    rockCount: 320,
    rockCluster: { share: 0.6, radius: 320 },   // share of the rocks within radius m of the boss
    spawnSpacing: 12,                           // 5 × 5 grid for 25 players
    cruiseSpeed: 18,
    thrustSpeed: 16,
    boostMultiplier: 2.5,
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
    boost: { drainPerSecond: 0.25, rechargePerSecond: 0.2 },
    // The boss floats in a colourful (decorative) nebula at bossDistance, visible from far away.
    nebula: { distance: 1100, radius: 220 },
    flare: { seconds: 14, radius: 120 },
    // No armour gate any more (armour is always 0 on the wire; TUNING.boss.armour stays for old readers). Any weapon
    // hurts it. maxHp = hp × (1 + hpPerExtraPlayer × (players − 1)), players counted at START: solo ≈ 30 s of
    // steady fire (one gun lands ≈ 80 dps), 25 players ≈ 16 s all firing. A ship's drill does drillPerSecond within drillRange.
    // It shoots back: every shotEverySeconds / √(ships in shotRange), at a random one of them. A ship destroyed in
    // space respawns where it died, but at least respawnDistance m from a living boss.
    boss: { radius: 20, armour: 100, hp: 2400, hpPerExtraPlayer: 0.5, drillRange: 14, drillPerSecond: 100, shotEverySeconds: 1.2, shotRange: 260, shotSpeed: 70, shotDamage: 10, shotLife: 4, respawnDistance: 300 },
    scan: { range: 250, seconds: 8 },
    drawings: { space: 5, planet: 5 },   // finished drawings per player per round (PLAN.md, Drawing budget)
    // v1 keeps the world simple: plain rocks plus bonus crystals. The other types stay defined for later.
    rockTypesInPlay: ["stone", "crystal"],
    planet: { offset: 600, radius: 40, landRange: 25, landingSeconds: 3, takeoffSeconds: 2, parkedShipHp: 300 },
    // Chests: count = clamp(chestsBase + ceil(players × chestsPerPlayer), 3, chestsMax), half buried (DIG), half in
    // rocks (DRILL). chestSpread grows by chestSpreadPerChest per chest. Planet movement per entity type: walkSpeed ×
    // speeds[type]; jumps only for the types in jumpers.
    island: { chests: 3, chestsBase: 2, chestsPerPlayer: 0.7, chestsMax: 20, chestSpread: 40, chestSpreadPerChest: 2,
      walkSpeed: 8, runMultiplier: 2, jumpSpeed: 9, gravity: 24, digSeconds: 2, drillSeconds: 2.5, pickupRange: 3, explorerDrawSeconds: 15,
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
  const SCORING = { rock: 10, crystal: 50, bossLastHit: 1000, chest: 1500, kill: 200, killed: -50, hitByRock: -30 };

  const COLORS = [0x22d3ee, 0xf472b6, 0xa3e635, 0xfacc15, 0xfb923c, 0xc084fc, 0x60a5fa, 0xf87171, 0x34d399, 0xe879f9, 0xfbbf24, 0x38bdf8];

  // Input vocabulary. Movement names and sticks are always available; everything else is a verb from verbs.js.
  const MOVES = ["left", "right", "up", "down", "forward", "back", "strafeleft", "straferight", "rise", "sink"];
  const STICKS = ["steer", "move"];
  const META_ACTIONS = ["ready", "view"];
  // Labels people draw that mean an existing verb. The server normalises before the simulation sees them.
  const ALIASES = { fire: "shoot", win: "blast", light: "flare", cloak: "invisible", warp: "teleport" };

  const OBJECTIVES = {
    boss: "REACH THE BOSS",
    crackBoss: "CRACK THE BOSS",
    destroyBoss: "DESTROY THE BOSS",
    planet: "LAND ON THE PLANET",
    explorer: "DRAW YOUR EXPLORER",
    chest: "DIG UP A CHEST",
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
                        parked: [{ player, x, z, hp, maxHp, wrecked }] },   // v1.1: parked ships can be shot; a wrecked
                                                                      // one needs a new ship drawing before take-off
   *              entities: { [player]: entity },                         // only in the world message sent on connect
   *              chests: [{ id, kind: "buried"|"rock", x, z, buried, dug, open, by }],  // island coordinates. kind buried:
                                                                      // DIG it out; kind rock: DRILL the rock open.
                                                                      // buried = still closed (in the ground / the
                                                                      // rock), dug 0..1 progress, open = collected,
                                                                      // by = who opened it (or null)
   *              assists: bool,                                      // v1.1: the chests glow, gate skills are free
   *              playerCount: n,                                     // players counted at START (boss HP, chests)
   *              result: null | { round, winner, scores: [[name, score]] },   // the scoreboard (phase "scoreboard")
   *              leaderboard: [{ name, stars, total }] }             // session: stars = rounds won, total = points
   *            Sent on connect and whenever any of it changes.
   *
   * tick       { type, t, round, phase, clock, left,                     // clock: lobby = seconds to autostart (0 with no
   *                                                                      // autostart: the host presses START); scoreboard =
   *                                                                      // seconds left; playing/assists = seconds since
   *                                                                      // the start. left = seconds until the 4:00 cap
   *              players: [{ name, color, mode: "space"|"planet", x, y, z, yaw, pitch, roll, hp, score,
   *                          shieldEnergy, boostEnergy,                  // 0..1, drive the HUD meters
   *                          drawingsLeft: { space, planet },            // humans only; bots omit it
   *                          respawnIn,                                  // seconds, only while flags.dead
   *                          flags: { boost, shield, stun, dead, invisible, drilling, digging, ready, bot,
   *                                   landing, takingOff, spawnShield },  // flags list only what is on; landing/takingOff:
   *                                                                      // the predefined animation plays, no control
   *                          action, slot, startedAt }],                 // last verb + animation slot + server ms
   *              bullets: [[id, x, y, z, color, mode]],                   // mode 0 = space, 1 = planet (island x, z, height y)
   *              bossShots: [[id, x, y, z]],
   *              flares: [[x, y, z, radius, secondsLeft]] }
   *            15 per second. In "planet" mode x, z are island coordinates and y is the feet height.
   *
   * fx         { type, kind, mode, pos: { x, y, z }, color, size }       // kind: explode, blast, spark, flare, scan,
   *                                                                      // drill, crack, land, dig, treasure, hit
   * announce   { type, text, big }                                       // kill feed, boss down, winner
   * toast      { type, player, text, sketch, ghost, kind, verb }         // one player only. Hints are riddles first:
   *                                                                      // kind "hint" (ladder) | "refused" (a verb the
   *                                                                      // entity has not unlocked; verb set) | "info".
   *                                                                      // need: "part" (draw it on the entity) | "button"
   *                                                                      // sketch: null | "drill"|"landing"|"shovel"|"gun", drawn faintly
   *                                                                      // on the pad; ghost: null | { action, x, y, w, h }, only in
   *                                                                      // the last step (PLAN.md section 4, Hints)
   * generated  { type, player, kind, layout }                            // a controller layout is ready
   * entity     { type, player, entity }                                  // on join, every mode switch, redraw, unlock
   *              entity: { type: "ship"|"person"|"car"|"bike"|"quadruped"|"blob", rig,   // rig: the rigs.js template
   *                        verbs,                                        // EVERYTHING it can do now (innate + drawn
   *                                                                      // + assists); world.js refuses the rest
   *                        unlocked: [{ verb, part }],                   // the card: what the drawing unlocked and why
   *                        parts: [{ name, x, y }],                      // drawn parts, x, y fractions of the drawing
   *                        source: "plain"|"model"|"devkit"|"bot", anims, image? }
   *
   * Phone → server:
   * POST /join      { player }                       → { player, color }  (player = the cleaned name)
   * POST /start     {}                               → { ok, round } | 409 { ok: false, error: "not in the lobby" }
   *                                                  // the big screen's START button
   * POST /input     { type: "input", player, action, down }
   *                 { type: "axis", player, axis: "steer"|"move", x, y }  // -1..1, at most 20 per second
   * POST /generate  { player, kind: "controller"|"button"|"ship"|"explorer", image, speculative, requestId }
   *                 → { ok: true, layout | entity, drawingsLeft } | { ok: false, error }   // image: PNG data URL, max 512 px;
   *                                                                      // error "no drawings left" when the world's 5 are used
   * POST /perf      { player, screen: "phone"|"big", ua, fps, low1, p90ms, calls, tris, textures, tier, w, h, dpr }
   *
   * Controller layout v2 (PLAN.md section 3):
   *   { buttons: [{ type: "button"|"stick"|"toggle", action, label, x, y, w, h }], source: "model"|"default"|"manual" }
   *   x, y, w, h are fractions of the drawing pad. A stick's action is "steer" or "move".
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
    return errors;
  }

  function checkTick(m, errors = []) {
    check(errors, m.type === "tick", "tick: type");
    check(errors, PHASES.includes(m.phase), "tick: phase");
    check(errors, isNum(m.clock), "tick: clock");
    check(errors, isNum(m.left), "tick: left");
    check(errors, Array.isArray(m.players), "tick: players");
    (m.players || []).forEach((p, i) => {
      check(errors, isStr(p.name), `tick: players[${i}].name`);
      check(errors, ["space", "planet"].includes(p.mode), `tick: players[${i}].mode`);
      check(errors, ["x", "y", "z", "yaw", "pitch", "roll", "hp", "score", "shieldEnergy", "boostEnergy"].every((k) => isNum(p[k])), `tick: players[${i}] numbers`);
      check(errors, p.flags && typeof p.flags === "object", `tick: players[${i}].flags`);
    });
    check(errors, Array.isArray(m.bullets) && Array.isArray(m.bossShots) && Array.isArray(m.flares), "tick: bullets, bossShots, flares");
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

  const CHECKS = { world: checkWorld, tick: checkTick, layout: checkLayout, input: checkInput, perf: checkPerf };

  const normaliseAction = (action) => ALIASES[String(action).toLowerCase()] || String(action).toLowerCase();
  const cleanName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);

  const Contract = {
    SIM_HZ, TICK_HZ, PERF_POST_SECONDS, PHASES, ROUND, TUNING, ROCK_TYPES, ROCK_TYPE_NAMES, SCORING, COLORS,
    MOVES, STICKS, META_ACTIONS, ALIASES, OBJECTIVES, CHECKS, CHEST_KINDS, normaliseAction, cleanName,
  };
  root.Contract = Contract;
  if (typeof module !== "undefined") module.exports = Contract;
})(typeof globalThis !== "undefined" ? globalThis : this);
