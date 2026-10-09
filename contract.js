// The shared contract (PLAN.md step 1): constants, tuning, message shapes and their checks.
// Loaded by the server with require() and by the browser with <script src="contract.js">, like verbs.js and terrain.js.
// Change it only together with every lane that reads it.
(function (root) {
  const SIM_HZ = 30;
  const TICK_HZ = 15;
  const PERF_POST_SECONDS = 5;

  const PHASES = ["lobby", "playing", "sudden", "scoreboard"];
  // A round is winnable in about 2:00 and never runs past 3:00 (PLAN.md section 4, Round clock).
  const ROUND = { lobbySeconds: 20, playSeconds: 180, suddenAt: 150, scoreboardSeconds: 8 };

  // 1 unit = 1 m. Distances are the tuning targets from PLAN.md; playtests adjust them here only.
  const TUNING = {
    worldRadius: 600,
    rockCount: 200,
    spawnSpacing: 8,
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
    nebula: { distance: 380, radius: 60, visibility: 25, flareVisibility: 120, flareSeconds: 14 },
    boss: { radius: 9, armour: 100, hp: 300, drillRange: 14, drillPerSecond: 20, shotEverySeconds: 1.5, shotSpeed: 60, shotDamage: 15, shotLife: 3 },
    decoys: 4,
    scan: { range: 250, seconds: 8 },
    planet: { offset: 150, radius: 40, landRange: 25 },
    island: { chests: 4, buried: 2, chestSpread: 40, walkSpeed: 8, runMultiplier: 2, jumpSpeed: 9, gravity: 24, digSeconds: 1.5, pickupRange: 3, explorerDrawSeconds: 15 },
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

  const SCORING = { rock: 10, crystal: 50, bossLastHit: 1000, chest: 300, kill: 200, killed: -50, hitByRock: -30 };

  const COLORS = [0x22d3ee, 0xf472b6, 0xa3e635, 0xfacc15, 0xfb923c, 0xc084fc, 0x60a5fa, 0xf87171];

  // Input vocabulary. Movement names and sticks are always available; everything else is a verb from verbs.js.
  const MOVES = ["left", "right", "up", "down", "forward", "back", "strafeleft", "straferight", "rise", "sink"];
  const STICKS = ["steer", "move"];
  const META_ACTIONS = ["ready", "view"];
  // Labels people draw that mean an existing verb. The server normalises before the simulation sees them.
  const ALIASES = { fire: "shoot", win: "blast", light: "flare", cloak: "invisible", warp: "teleport" };

  const OBJECTIVES = {
    nebula: "FLY TO THE NEBULA",
    findBoss: "FIND THE BOSS",
    crackBoss: "CRACK THE BOSS",
    destroyBoss: "DESTROY THE BOSS",
    planet: "LAND ON THE PLANET",
    explorer: "DRAW YOUR EXPLORER",
    chest: "DIG UP A CHEST",
  };

  /*
   * Messages. Server → every screen over GET /events (one JSON object per SSE "data:" line):
   *
   * world      { type, round, seed, radius,
   *              rocks: [[id, x, y, z, size, typeIndex, health]],        // typeIndex into ROCK_TYPE_NAMES
   *              nebula: { x, y, z, radius },
   *              targets: [{ id, kind: "boss"|"decoy", x, y, z, radius, armour, hp, maxHp, cracked, dead }],
   *              revealedTo: [playerName],                               // who has scanned the boss; everyone in "sudden"
   *              planet: null | { x, y, z, radius, landRange },          // appears when the boss dies
   *              island: { seed, size },
   *              chests: [{ id, x, z, buried, dug, open }] }             // island coordinates; dug 0..1
   *            Sent on connect and whenever any of it changes.
   *
   * tick       { type, t, round, phase, clock,                           // clock = seconds left in this phase
   *              players: [{ name, color, mode: "space"|"planet", x, y, z, yaw, pitch, roll, hp, score,
   *                          shieldEnergy, boostEnergy,                  // 0..1, drive the HUD meters
   *                          flags: { boost, shield, stun, dead, invisible, drilling, digging, ready, bot },
   *                          action, slot, startedAt }],                 // last verb + animation slot + server ms
   *              bullets: [[id, x, y, z, color]],
   *              bossShots: [[id, x, y, z]],
   *              flares: [[x, y, z, radius, secondsLeft]] }
   *            15 per second. In "planet" mode x, z are island coordinates and y is the feet height.
   *
   * fx         { type, kind, mode, pos: { x, y, z }, color, size }       // kind: explode, blast, spark, flare, scan,
   *                                                                      // drill, crack, land, dig, treasure, hit
   * announce   { type, text, big }                                       // kill feed, boss down, winner
   * toast      { type, player, text, ghost }                             // one player only: "Draw a LAND button".
   *                                                                      // ghost: null | { action, x, y, w, h } on the pad
   *                                                                      // for the trace-it hint (PLAN.md section 4, Hints)
   * generated  { type, player, kind, layout }                            // a controller layout is ready
   *
   * Phone → server:
   * POST /join      { player }                       → { player, color }  (player = the cleaned name)
   * POST /input     { type: "input", player, action, down }
   *                 { type: "axis", player, axis: "steer"|"move", x, y }  // -1..1, at most 20 per second
   * POST /generate  { player, kind: "controller"|"button"|"ship"|"explorer", image, speculative, requestId }
   *                 → { ok: true, layout } | { ok: false, error }        // image: PNG data URL, max 512 px
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
    check(errors, Array.isArray(m.chests) && m.chests.every((c) => isNum(c.x) && isNum(c.z) && typeof c.buried === "boolean"), "world: chests");
    return errors;
  }

  function checkTick(m, errors = []) {
    check(errors, m.type === "tick", "tick: type");
    check(errors, PHASES.includes(m.phase), "tick: phase");
    check(errors, isNum(m.clock), "tick: clock");
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
    MOVES, STICKS, META_ACTIONS, ALIASES, OBJECTIVES, CHECKS, normaliseAction, cleanName,
  };
  root.Contract = Contract;
  if (typeof module !== "undefined") module.exports = Contract;
})(typeof globalThis !== "undefined" ? globalThis : this);
