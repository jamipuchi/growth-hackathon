// Authoritative simulation (PLAN.md sections 4 and 5): round clock, flight, rocks, the boss, the planet and the island.
// Every screen and phone only renders what this sends. Distances and rates come from contract.js (TUNING), verb
// settings from verbs.js defaults.
// v1.1 (PLAN.md section 0): the host starts the round (start()); it ends at 4:00 or when every chest is open, and most
// points wins (a star on the session leaderboard). An entity can only use the skills drawn on it (Verbs.entityVerbs);
// gates: a weapon for the boss, LAND for the planet, DIG (buried chests) and DRILL (chests inside rocks).
// Bots are fillers, not players: they count TUNING.boss.botWeight for the boss's HP and TUNING.botWeight for the chests
// (v1.4: 0, they never land), fight the boss, never start a fight with a human, never land, and take no prize from a
// human (botThink, canHurt, hitBoss).
// v1.2: the drill is a planet skill only (rock chests); a ship can never drill the boss.
// v1.3 mischief (PLAN.md "Mischief"): mine, tractor, EMP, ink bomb and decoy, each unlocked by a drawn part, aimed at
// the nearest human rival (mischief()); the victim's phone gets a `mischief` message and the kill feed announces it.
const Contract = require("./contract");
const Verbs = require("./verbs");
const Terrain = require("./terrain");
const Rules = require("./rules");

const { TUNING: T, ROUND, SCORING, ROCK_TYPES, ROCK_TYPE_NAMES, COLORS } = Contract;
const ISL = T.island;
const WORLD_SEND_SECONDS = 0.5; // rock changes are coalesced (a world message is ~15 KB); gate changes go out at once
const BOSS_HINT_RANGE = 150; // this close to the boss's surface without a weapon starts the weapon hint
const SHIP_RADIUS = 1.5;
const EXPLORER_RADIUS = 0.9; // a capsule centred EXPLORER_CHEST m above the feet
const EXPLORER_CHEST = 1.1;
const BOT_FIRE_COOLDOWN = 0.5;
const BOT_REVENGE_SECONDS = 10; // a bot shoots back only at a human who hit it this recently
const BOT_RANGE = T.bulletSpeed * T.bulletLife - 6; // a bot fires only when its shot can still arrive
const BOT_ENGAGE = 190; // m from the boss's surface: closer than this a bot makes attack runs
const ROCK_WEIGHTS = { stone: 6, iron: 2, volatile: 1, crystal: 1, magnet: 1, splitter: 1 };
const INACTIVE_MS = 10 * 60 * 1000;
// Name binding and caps (v1.0 review): a device token from /join keeps a second phone from taking over a name in use;
// at most MAX_PLAYERS active players, humans and bots together (a new human takes the newest bot's seat), MAX_RECORDS
// ever.
const TAKEN_MS = 30 * 1000;
const MAX_PLAYERS = 25; // PLAN.md section 0 (owner, 10 Oct 09:05): humans and bots together never exceed 25 (v1.4: MAX_HUMANS 32 is gone)
const MAX_RECORDS = 400;
const MAX_PRESSES = 6; // pressed verbs queued per player per step (a flood of presses in one POST is dropped)
const LAND_HINT_EXTRA = 50; // the LAND ladder starts this far beyond landing range (approaching the planet counts)
const LATE_HINT_GAP = 6;    // s between two late "draw X" cards to the same player (v1.4, from 3:00)
// While the phone's draw sheet is open (input action "drawing", v1.0 playtest: players died photographing a button),
// the ship hovers and cannot be hurt, shoot or be targeted, for at most DRAWING_SHIELD_SECONDS per press.
const DRAWING_SHIELD_SECONDS = 30;
const HIT_PER_SECOND = 4; // hit-marker notices per victim per second (v1.3)
const TICK_MAX_BULLETS = 30; // the newest ones; keeps a tick under 8 KB with 25 players
const PARKED_RADIUS = 2.5;
const SHORE_TURNS = [0.35, 0.7, 1.05, Math.PI / 2]; // radians, either way: walkers slide along the shore

// Every verb's numbers in one place.
const VERB = {
  shoot: { cooldown: T.fireCooldown, damage: T.bulletDamage, speed: T.bulletSpeed, life: T.bulletLife },
  blast: { ...Verbs.clampParams("blast", {}), coneCos: Math.cos(0.6) }, // range 60, damage 50, cooldown 12
  flare: { seconds: T.flare.seconds, radius: T.flare.radius, cooldown: Verbs.clampParams("flare", {}).cooldown },
  scan: { range: T.scan.range, seconds: T.scan.seconds, cooldown: Verbs.clampParams("scan", {}).cooldown },
  invisible: Verbs.clampParams("invisible", {}), // duration 6, cooldown 15
  teleport: Verbs.clampParams("teleport", {}), // distance 40, cooldown 6
  heal: Verbs.clampParams("heal", {}), // amount 30, cooldown 10
  jump: { speed: ISL.jumpSpeed, dash: 12, cooldown: 1 }, // a jump on the island, a quick dash in space
  drill: { seconds: ISL.drillSeconds }, // planet only: opens the chests locked in rocks
  dig: { seconds: ISL.digSeconds, range: ISL.pickupRange },
};
// Mischief numbers (verbs.js defaults; cooldowns 10 to 20 s). On the island the reach is ISLAND_REACH of space's and
// the tractor pulls at ISLAND_PULL of its space speed.
const MISCHIEF = Object.fromEntries(Verbs.MISCHIEF.map((v) => [v, Verbs.clampParams(v, {})]));
const ISLAND_REACH = 0.25;
const ISLAND_PULL = 0.3;
const MINE_RADIUS = { space: 7, planet: 1.8 }; // a rival this close to a mine (centre to centre) sets it off
const MINE_ARM_SECONDS = 0.6;
const MINES_PER_PLAYER = 3;                     // a fourth replaces the oldest
const TICK_MAX_PROPS = 16; // the newest mines, decoys and flares in a tick (25 players must fit the tick budget)
const TRACTOR_ROCK_DAMAGE = 30;                 // a rock hit while being pulled (or 0.5 s after) hurts, credited to the puller
const DECOY_OFFSET = { space: 6, planet: 2.5 };
const MISCHIEF_ICON = { mine: "💣", tractor: "🧲", emp: "⚡", inkbomb: "🦑", decoy: "🎭" };
const HOLD = ["shoot", "boost", "shield", "drill", "dig"];
const PRESS = ["blast", "flare", "scan", "land", "takeoff", "jump", "invisible", "teleport", "heal", "drive", ...Verbs.MISCHIEF];
const V1_VERBS = new Set([...HOLD, ...PRESS]);
// Hint gates (rules.js): the skill must be drawn on the entity AND have a button.
const GATES = ["weapon", "land", "dig", "drill"];
const GATE_MODE = { weapon: "space", land: "space", dig: "planet", drill: "planet" };
// The phone's default controller (controller.html defaultLayout): what a player has until a drawn one arrives.
const DEFAULT_LAYOUT = {
  buttons: [
    { type: "stick", action: "steer", label: "STEER", x: 0.04, y: 0.4, w: 0.3, h: 0.55 },
    { type: "button", action: "boost", label: "BOOST", x: 0.56, y: 0.62, w: 0.17, h: 0.32 },
    { type: "button", action: "shoot", label: "SHOOT", x: 0.76, y: 0.5, w: 0.21, h: 0.44 },
  ],
  source: "default",
};
// top: the phone HUD band (astra-html.js keeps every control's top edge below CSS --hud = clamp(72px, 26vh, 116px),
// about the top 26-30% of a landscape phone): a ghost box above it would slide down away from the traced ink.
const GHOST = { w: 0.22, h: 0.18, scales: [1.4, 1.2, 1, 0.8, 0.6], step: 0.02, margin: 0.03, pad: 0.02, top: 0.3 };

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Distance from p to the segment a→b: a bullet moves 4.7 m per step, more than a ship or explorer is wide.
function segDist(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return dist(p, add(a, ab, t));
}

// Same convention as three.js: yaw around Y, then pitch around the ship's X; the nose points to -Z.
function basis(yaw, pitch) {
  const cp = Math.cos(pitch);
  const forward = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const up = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
  return { forward, right, up };
}

// kind "button" adds the new controls to the pad, replacing any with the same action (as the phone does); anything
// else replaces the whole layout. Pure: server.js previews a speculative button with it.
function mergeLayout(base, layout, kind = "controller") {
  if (kind === "button") {
    const fresh = layout.buttons.map((b) => ({ ...b, action: Contract.normaliseAction(b.action) }));
    const old = (base || DEFAULT_LAYOUT).buttons.filter((b) => !fresh.some((f) => f.action === Contract.normaliseAction(b.action)));
    return { buttons: [...old, ...fresh].slice(-16), source: layout.source || "model" };
  }
  return { buttons: layout.buttons.slice(0, 16), source: layout.source || "model" };
}

// PLAN.md section 7, "Never stuck": a drawn controller with no way to turn (no steer stick, no LEFT / RIGHT) gets a
// steer stick in the roomiest empty spot, bottom left first, marked auto: true. A move stick alone only strafes.
const TURNS = new Set(["steer", "left", "right"]);
function withSteer(layout) {
  if (!layout || !Array.isArray(layout.buttons) || layout.buttons.some((b) => TURNS.has(Contract.normaliseAction(b.action)))) return layout;
  const rects = layout.buttons;
  const gap = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  for (const scale of [1, 0.85, 0.7, 0.55]) {
    const w = 0.26 * scale, h = 0.46 * scale;
    let best = null;
    for (let y = 0.03; y + h <= 0.97 + 1e-9; y += 0.02) {
      for (let x = 0.03; x + w <= 0.97 + 1e-9; x += 0.02) {
        const box = { x, y, w, h };
        const clearance = rects.length ? Math.min(...rects.map((r) => gap(box, r))) : 1;
        if (clearance < 0.015) continue;
        const score = Math.min(clearance, 0.08) - x + 0.5 * y;
        if (!best || score > best.score) best = { ...box, score };
      }
    }
    if (best) return { ...layout, buttons: [...rects.slice(0, 15), { type: "stick", action: "steer", label: "", x: r2(best.x), y: r2(best.y), w: r2(best.w), h: r2(best.h), auto: true }] };
  }
  return { ...layout, buttons: [...rects.slice(0, 15), { type: "stick", action: "steer", label: "", x: 0.03, y: 0.5, w: 0.2, h: 0.45, auto: true }] };
}

const hasControl = (layout, verb) => (layout || DEFAULT_LAYOUT).buttons.some((b) => Contract.normaliseAction(b.action) === verb);

// The chest count for a round: scales with the players at START so 25 can open them all in about 3:00.
const chestCount = (players) => clamp(ISL.chestsBase + Math.ceil(Math.max(1, players) * ISL.chestsPerPlayer - 1e-9), 3, ISL.chestsMax);
const bossHp = (players) => Math.round(T.boss.hp * (1 + T.boss.hpPerExtraPlayer * (Math.max(1, players) - 1)));
// Who the chest count is scaled for: every human counts 1, every bot TUNING.botWeight (bots are fillers, not players;
// v1.4: 0, they never land). The boss's HP counts every bot TUNING.boss.botWeight instead (v1.4: at a close boss a bot
// fires about half as hard as a human): 1 human + 24 bots = 1 for the chests, 13 for the HP.
const scaledCount = (list, botWeight = T.botWeight) => Math.max(1, r2(list.reduce((n, p) => n + (p.bot ? botWeight : 1), 0)));
const hpCount = (list) => scaledCount(list, T.boss.botWeight ?? T.botWeight);

// The largest box that fits on the pad without touching any control, farthest from the others (PLAN.md section 4, Hints).
function ghostBox(layout, action) {
  const rects = (layout || DEFAULT_LAYOUT).buttons;
  const gap = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  for (const s of GHOST.scales) {
    const w = GHOST.w * s, h = GHOST.h * s;
    let best = null;
    for (let y = Math.max(GHOST.margin, GHOST.top); y + h <= 1 - GHOST.margin + 1e-9; y += GHOST.step) {
      for (let x = GHOST.margin; x + w <= 1 - GHOST.margin + 1e-9; x += GHOST.step) {
        const box = { x, y, w, h };
        const clearance = rects.length ? Math.min(...rects.map((r) => gap(box, r))) : 1;
        if (clearance >= GHOST.pad && (!best || clearance > best.clearance)) best = { ...box, clearance };
      }
    }
    if (best) return { action, x: r2(best.x), y: r2(best.y), w: r2(best.w), h: r2(best.h) };
  }
  return { action, x: 0.39, y: 0.32, w: 0.22, h: 0.18 }; // below the HUD band
}

// wireAnimations(type, verbs) → anims (astra.js), optional: called on every entity switch.
// autostartSeconds: the lobby starts by itself after that many seconds (null: only start(), the host's START button).
function createWorld({ broadcast = () => {}, random = Math.random, autoStart = false, wireAnimations = null, autostartSeconds = ROUND.autostartSeconds } = {}) {
  const players = Object.create(null);
  // Hints run on the simulation clock so fast-forward tests see the same ladder as a live round.
  const hints = Rules.createHints({ now: () => Math.round(S.t * 1000) });
  const budget = Rules.createBudget();
  const rand = (min, max) => min + random() * (max - min);
  const S = { round: 0, phase: "lobby", phaseT: 0, playT: 0, t: 0, seed: 1, playerCount: 1, assists: false, result: null };
  const session = Object.create(null); // name → { stars, total }: the evening's leaderboard
  let rocks = [], bullets = [], bossShots = [], flares = [], mines = [], decoys = [];
  let boss, planet, planetAt, nebula, island, landing, chests, parked = [], revealUntil = Object.create(null);
  let nextId = 1, worldDirty = false, lastWorldAt = -1, lastRevealed = "";

  const send = (m) => broadcast(m);
  const fx = (kind, pos, color = 0xffffff, size = 1, mode = "space") =>
    send({ type: "fx", kind, mode, pos: { x: r2(pos.x), y: r2(pos.y), z: r2(pos.z) }, color, size: r2(size) });
  const announce = (text, big = false) => send({ type: "announce", text, big });
  // Broadcast world updates leave out `entities` (about 2 KB each with anims); `entity` messages carry the changes.
  const sendWorld = () => { worldDirty = false; lastWorldAt = S.t; send(worldMessage({ entities: false })); };
  const active = () => Object.values(players).filter((p) => p.bot || Date.now() - p.lastSeen < INACTIVE_MS);
  const assists = () => S.assists;
  const islandFeet = (x, z) => Math.max(0, Terrain.height(x, z, island.seed));
  const dry = (x, z) => Terrain.height(x, z, island.seed) > 0.3 && Math.hypot(x, z) < island.size / 2 - 5;

  // ---- World generation ----------------------------------------------------------------------------------------

  function randomPoint(minR, maxR) {
    const dir = norm({ x: rand(-1, 1), y: rand(-0.5, 0.5), z: rand(-1, 1) });
    return add(v3(), dir, rand(minR, maxR));
  }

  function rockType() {
    const inPlay = T.rockTypesInPlay.filter((n) => ROCK_TYPES[n]);
    let roll = random() * inPlay.reduce((s, n) => s + (ROCK_WEIGHTS[n] || 1), 0);
    for (const n of inPlay) if ((roll -= ROCK_WEIGHTS[n] || 1) < 0) return n;
    return inPlay[0];
  }

  // Rocks keep clear of the spawn disc (spawnRadius + 40 m), the boss and the planet that will appear.
  function rockPlaceOk(pos, size) {
    if (len(pos) < T.spawnRadius + 40 + size) return false;
    if (boss && dist(pos, boss.pos) < boss.radius + 25 + size) return false;
    if (planetAt && dist(pos, planetAt) < T.planet.radius + 20 + size) return false;
    return true;
  }

  // Dense around the boss, thinning out: rockCluster.share of the rocks within rockCluster.radius of it (closer is
  // denser), the rest anywhere in the world.
  function rockPoint() {
    if (boss && random() < T.rockCluster.share) {
      const d = norm({ x: rand(-1, 1), y: rand(-0.6, 0.6), z: rand(-1, 1) });
      return add(boss.pos, d, boss.radius + 20 + Math.pow(random(), 1.5) * T.rockCluster.radius);
    }
    return randomPoint(60, T.worldRadius);
  }

  function spawnRock(type = rockType(), at = null, size = rand(2, 11)) {
    let pos = at;
    for (let i = 0; !pos && i < 50; i++) { const p = rockPoint(); if (rockPlaceOk(p, size) && len(p) < T.worldRadius) pos = p; }
    pos = pos || randomPoint(T.worldRadius * 0.8, T.worldRadius);
    return { id: nextId++, pos, size, type, health: ROCK_TYPES[type].health };
  }

  // All 25 parking bays (bay()) and the spots beside them where explorers step out are on dry land.
  const baysDry = (lx, lz) => {
    for (let i = 0; i < 25; i++) {
      const bx = lx + (i % 5) * 5 - 10, bz = lz + Math.floor(i / 5) * 5;
      if (!dry(bx, bz) || !dry(bx + 2.5, bz)) return false;
    }
    return true;
  };
  function buildIsland(count = chestCount(S.playerCount)) {
    island = { seed: Math.floor(rand(1, 100000)), size: Terrain.ISLAND_SIZE };
    // Landing spot: dry and low enough near the middle, with room for the chests around it.
    let spot = null;
    for (let r = 20; !spot && r < 160; r += 10) {
      for (let a = 0; a < 12 && !spot; a++) {
        const ang = rand(0, Math.PI * 2);
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r, h = Terrain.height(x, z, island.seed);
        if (h > 0.8 && h < 16 && baysDry(x, z) && placeChests(x, z, count)) spot = { x, z };
      }
    }
    if (!spot) { spot = { x: 0, z: 0 }; placeChests(0, 0, count, true); }
    landing = { x: spot.x, z: spot.z };
  }

  // Two kinds, alternating: buried (DIG it out, an X on the sand) and inside a rock (DRILL it open). Every chest can be
  // reached by walking straight out from the landing pad on dry land (no lagoon in the way).
  const dryLine = (ax, az, bx, bz) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
    for (let i = 0; i <= n; i++) if (!dry(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
    return true;
  };
  function placeChests(lx, lz, count, force = false) {
    const list = [];
    const spread = ISL.chestSpread + ISL.chestSpreadPerChest * count;
    for (let i = 0; i < 40 * count && list.length < count; i++) {
      const ang = rand(0, Math.PI * 2), d = rand(12, spread);
      const x = lx + Math.cos(ang) * d, z = lz + Math.sin(ang) * d;
      if ((force || (dry(x, z) && dryLine(lx, lz, x, z))) && list.every((c) => Math.hypot(c.x - x, c.z - z) > 8)) {
        list.push({ id: list.length + 1, kind: list.length % 2 ? "rock" : "buried", x, z, buried: true, dug: 0, open: false, by: null });
      }
    }
    if (list.length < count) return false;
    chests = list;
    return true;
  }

  function buildWorld() {
    S.seed = Math.floor(rand(1, 1e9));
    const ang = rand(0, Math.PI * 2);
    const bossPos = { x: Math.cos(ang) * T.bossDistance, y: rand(-40, 40), z: Math.sin(ang) * T.bossDistance };
    const hp = bossHp(S.playerCount);
    boss = { id: 1, pos: bossPos, radius: T.boss.radius, armour: 0, hp, maxHp: hp, dead: false, shotCd: T.boss.shotEverySeconds, damageBy: Object.create(null) };
    nebula = { ...bossPos, radius: T.nebula.radius };
    // The planet lies beyond the boss, on the line from spawn: fly past the boss to reach it.
    planetAt = add(bossPos, norm(bossPos), T.planet.offset);
    planet = null;
    rocks = Array.from({ length: T.rockCount }, () => spawnRock());
    bullets = []; bossShots = []; flares = []; mines = []; decoys = []; revealUntil = Object.create(null);
    buildIsland();
  }

  // ---- Players -------------------------------------------------------------------------------------------------

  // The entity a player drives (PLAN.md section 0, Unlockable skills). Its verbs come ONLY from the parts drawn on it
  // (p.drawn.space / p.drawn.planet, from Astra), plus what its type does by itself, plus the gate skills once assists
  // are on. With no drawing: a plain ship that only flies, a plain person that walks and jumps. Bots get the dev kit.
  const animCache = {};
  function entityOf(p, mode) {
    const world = mode === "planet" ? "planet" : "space";
    const drawn = p.drawn[world];
    const type = drawn ? drawn.type : world === "space" ? "ship" : "person";
    const unlocked = drawn ? drawn.unlocked : p.bot ? Verbs.DEV_KIT[world].map((u) => ({ ...u })) : [];
    const own = unlocked.map((u) => u.verb);
    // Owner, 10 Oct 09:05: no free skills at 3:00 (the hints jump to "draw X" and the chests glow instead).
    const extra = [];
    const verbs = Verbs.entityVerbs(type, own, extra);
    // card (v1.3): the unlock card in plain words. A drawing keeps the card Astra sent with it (setEntity); a plain or
    // bot entity gets Verbs.cardOf. Assist-granted skills are never on the card (they ride in `assisted`).
    const entity = {
      type, rig: Verbs.RIG_OF[type] || "blob", verbs, unlocked, parts: drawn ? drawn.parts : [],
      source: drawn ? drawn.source : p.bot ? "bot" : "plain",
      card: drawn && drawn.card ? drawn.card : Verbs.cardOf(type, unlocked),
    };
    const assisted = extra.filter((v) => verbs.includes(v) && !own.includes(v));
    if (assisted.length) entity.assisted = assisted;
    const key = `${entity.rig}:${verbs.join(",")}`;
    if (animCache[key]) entity.anims = animCache[key];
    else if (typeof wireAnimations === "function") {
      try { const anims = wireAnimations(entity.rig, verbs); if (anims && Object.keys(anims).length) entity.anims = animCache[key] = anims; } catch {} // an empty table is not cached (anims.js may be mid-edit)
    }
    return entity;
  }

  // Parts and card count too: a redraw with the same skills but a new look must still reach every screen.
  const sameEntity = (a, b) => a && b && a.type === b.type && a.source === b.source && a.card === b.card && a.verbs.join() === b.verbs.join() &&
    JSON.stringify(a.unlocked) === JSON.stringify(b.unlocked) && JSON.stringify(a.parts) === JSON.stringify(b.parts);

  // Every mode switch, redraw and unlock (and the first spawn) tells every screen which entity the player now drives.
  // force true: rebuild even in the same mode (sent only if it changed); force "fresh": a redraw, always sent.
  function setMode(p, mode, force = false) {
    if (p.mode === mode && p.entity && !force) return;
    const next = entityOf(p, mode);
    if (p.mode === mode && force !== "fresh" && sameEntity(p.entity, next)) return;
    p.mode = mode;
    p.entity = next;
    send({ type: "entity", player: p.name, entity: p.entity });
  }
  const can = (p, verb) => !!p.entity && p.entity.verbs.includes(verb);

  // Humans first (join order), then bots (v1.3): tick.players lists them in this order (TVs cap name tags and meshes
  // and must keep the humans), humans take the inner spawn slots, and only humans ever take parking bays.
  const ordered = (list = active()) => [...list.filter((q) => !q.bot), ...list.filter((q) => q.bot)];
  const slotOf = (p) => Math.max(0, ordered().indexOf(p));

  // Spawn (v1.3, ruthless PvP): a wide sunflower disc of radius TUNING.spawnRadius across the line to the boss, so 25
  // ships start about 40 m apart (never closer than about 38 m), side by side, nobody in front of anybody's guns.
  // More than 25: another disc 60 m further back. Every ship faces the boss; a spawn shield until it moves or fires.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  function spawnSlot(i) {
    const d = boss ? norm({ x: boss.pos.x, y: 0, z: boss.pos.z }) : v3(0, 0, -1);
    const u = { x: -d.z, y: 0, z: d.x }; // level and across the line to the boss
    const k = i % 25, r = T.spawnRadius * Math.sqrt((k + 0.5) / 25), a = k * GOLDEN;
    return add(add(add(v3(), u, Math.cos(a) * r), v3(0, 1, 0), Math.sin(a) * r), d, -60 * Math.floor(i / 25));
  }
  function faceGoal(p) {
    const goal = !boss ? null : !boss.dead ? boss.pos : planet || planetAt;
    if (!goal) { p.yaw = 0; p.pitch = 0; return; }
    const v = sub(goal, p.pos);
    p.yaw = Math.atan2(-v.x, -v.z);
    p.pitch = clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)), -T.maxPitch, T.maxPitch);
  }
  function spawnAt(p) {
    setMode(p, "space");
    p.pos = spawnSlot(slotOf(p));
    faceGoal(p);
    p.roll = 0; p.vy = 0;
    p.hp = T.shipHp; p.stun = 0; p.dead = false; p.deadFor = 0;
    p.landingFor = 0; p.takeoffFor = 0;
    // The spawn shield only runs in play (in the lobby it would freeze on: no simulate there); GO hands it out.
    p.spawnShield = S.phase === "playing" || S.phase === "assists" ? T.spawnShieldSeconds : 0;
  }
  // Respawns spread too: of a few spots around `at`, the first at least spawnClear m from every other living ship
  // and clear of rocks, else the roomiest one.
  function clearSpot(p, at, spread) {
    let best = at, bestGap = -1;
    for (let i = 0; i < 10; i++) {
      const c = i === 0 ? at : add(at, randomPoint(spread * 0.4, spread), 1);
      if (rocks.some((r) => dist(r.pos, c) < r.size + 8)) continue;
      let g = Infinity;
      for (const q of active()) if (q !== p && q.mode === "space" && !q.dead) g = Math.min(g, dist(q.pos, c));
      if (g >= T.spawnClear) return c;
      if (g > bestGap) { best = c; bestGap = g; }
    }
    return best;
  }

  // Each human gets a parking bay on the landing pad when the landing starts (land()): the lowest one free, so humans
  // fill the first bays; the explorer stands beside the parked ship. 25 bays (all on dry land, buildIsland), shared
  // beyond 25 humans.
  const bayAt = (i) => ({ x: landing.x + (i % 25 % 5) * 5 - 10, z: landing.z + Math.floor((i % 25) / 5) * 5 });
  function pickBay(p) {
    const used = new Set();
    for (const c of parked) if (c.player !== p.name && players[c.player] && players[c.player].bayIndex != null) used.add(players[c.player].bayIndex);
    for (const q of active()) if (q !== p && q.landingFor > 0 && q.bayIndex != null) used.add(q.bayIndex);
    // render.js ends the landing shot on the bay of the player's index in tick.players (= slotOf): take that one when
    // it is free (humans come first, so they fill the first bays), else the lowest free one (the tick's `bay` says it).
    const want = slotOf(p) % 25;
    let i = used.has(want) ? 0 : want;
    while (used.has(i) && i < 25) i++;
    p.bayIndex = i < 25 ? i : want;
    return p.bayIndex;
  }
  function bay(p) {
    const car = parked.find((c) => c.player === p.name);
    if (car) return { x: car.x, z: car.z };
    return bayAt(p.bayIndex != null ? p.bayIndex : pickBay(p));
  }
  // The nearest walkable spot, in 1 m rings out to 30 m, else the landing spot (v1.0 review: on about 2% of islands an
  // explorer stepped out onto water and stayed stuck for the round, respawning on the same cell).
  // v1.3 (finding #17): the spot must also be reachable, a straight dry walk from the landing spot (from which every
  // chest is), so nobody steps out onto a cut-off sandbar. Used by every island spawn: touchdown and respawn.
  function nearestDry(x, z) {
    const ok = (nx, nz) => dry(nx, nz) && (Math.hypot(nx - landing.x, nz - landing.z) < 2 || dryLine(landing.x, landing.z, nx, nz));
    if (ok(x, z)) return { x, z };
    for (let r = 1; r <= 30; r++) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
        if (ok(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x: landing.x, z: landing.z };
  }
  function standBeside(p) {
    const b = bay(p);
    const { x, z } = nearestDry(b.x + 2.5, b.z);
    p.pos = { x, y: islandFeet(x, z), z };
    p.yaw = 0; p.pitch = 0; p.roll = 0; p.vy = 0; p.stun = 0;
  }

  // Death respawn: in space where the ship died but out of the boss's reach (no minute-long flight back), on the island
  // beside the parked ship; full health and a short spawn shield.
  // v1.3: spread out (clearSpot: at least spawnClear m from every other ship when there is room), facing the goal, and
  // a spawn shield until the player moves or fires (at most spawnShieldSeconds).
  function respawn(p) {
    if (p.mode === "planet") standBeside(p);
    else {
      const died = { ...p.pos };
      spawnAt(p);
      let at = died;
      if (boss && !boss.dead && dist(died, boss.pos) < T.boss.respawnDistance) at = add(boss.pos, norm(dist(died, boss.pos) > 1 ? sub(died, boss.pos) : v3(0, 0, 1)), T.boss.respawnDistance);
      p.pos = clearSpot(p, at, 60);
      if (boss && !boss.dead && dist(p.pos, boss.pos) < T.boss.respawnDistance) p.pos = add(boss.pos, norm(sub(p.pos, boss.pos)), T.boss.respawnDistance);
      if (len(p.pos) > T.worldRadius) p.pos = add(p.pos, p.pos, -(len(p.pos) - T.worldRadius) / len(p.pos));
      faceGoal(p);
    }
    p.hp = T.shipHp; p.dead = false; p.deadFor = 0; p.tractor = null; p.hitAcc = 0;
    p.spawnShield = T.spawnShieldSeconds;
    fx("respawn", p.pos, p.color, 3, p.mode);
  }

  const humansActive = () => Object.values(players).filter((q) => !q.bot && Date.now() - q.lastSeen < INACTIVE_MS).length;
  // create: false only finds an existing player. A new human needs room: at most MAX_PLAYERS active players.
  function getPlayer(name, bot = false, { create = true } = {}) {
    name = Contract.cleanName(name);
    if (!name) return null;
    if (!players[name]) {
      if (!create) return null;
      if (Object.keys(players).length >= MAX_RECORDS) return null;
      // At most MAX_PLAYERS in the round, humans and bots together: a new human takes the place of the newest bot (bots
      // are fillers); 25 humans: the game is full. A bot never takes a seat a human could have.
      const live = active();
      if (live.length >= MAX_PLAYERS) {
        const filler = bot ? null : [...live].reverse().find((q) => q.bot);
        if (!filler) return null;
        dropBot(filler);
      }
      // A colour nobody has (a human who takes a dropped bot's seat must not wear another player's colour).
      const inUse = new Set(Object.values(players).map((q) => q.color));
      const color = COLORS.find((c) => !inUse.has(c)) ?? COLORS[Object.keys(players).length % COLORS.length];
      const p = {
        name, bot, color, score: 0, keys: {}, axes: {}, pressed: [],
        shieldEnergy: 1, boostEnergy: 1, boostLocked: false, shieldLocked: false, cd: {}, fireCd: 0,
        invisibleFor: 0, ready: bot, layout: null, hints: {}, action: "", slot: "", startedAt: 0, mode: null, entity: null,
        drilling: false, digging: false, boosting: false, shielding: false, botFire: 0, botSeed: random() * 100,
        drawn: { space: null, planet: null }, refusedAt: {}, lastChest: null, hitBy: Object.create(null), run: null, vel: v3(),
        device: null, tractor: null, empFor: 0, inkFor: 0, drawingUntil: 0, bayIndex: null, hitSentAt: -Infinity,
        late: {}, lateAt: -Infinity, // v1.4 late hints sent this round ("gate:need") and when the last one went out
        lastSeen: Date.now(), // before spawnAt: slotOf only counts active players
      };
      players[name] = p;
      spawnAt(p);
      // Humans take the inner slots: in the lobby (and the countdown) everybody moves to their slot again, so a human
      // who joins after the bots never sits on top of one.
      if (!bot && (S.phase === "lobby" || S.phase === "countdown")) for (const q of ordered()) if (q !== p) spawnAt(q);
    }
    // A human back after INACTIVE_MS takes a seat again: the newest bot leaves if the round is full (MAX_PLAYERS); with
    // 25 active humans already there is no seat (v1.4: never 26): null, as for a new name (join: "the game is full").
    const back = players[name];
    if (!back.bot && Date.now() - back.lastSeen >= INACTIVE_MS) {
      const live = active();
      if (live.length >= MAX_PLAYERS) {
        const filler = [...live].reverse().find((q) => q.bot);
        if (!filler) return null;
        dropBot(filler);
      }
    }
    back.lastSeen = Date.now();
    return back;
  }

  // A human never takes over a bot's seat: "bot3" joins as "bot3b" (a rejoin with the same name finds that human again).
  // device (optional, a random token the phone keeps): a name in use by another device in the last TAKEN_MS goes to
  // the next free "name2", "name3"... (renamed: true); the same device, or a phone that sends none, gets its ship back.
  const taken = (q, device) => !!device && !!q.device && q.device !== device && Date.now() - q.lastSeen < TAKEN_MS;
  const join = (name, device) => {
    const base = Contract.cleanName(name);
    const token = typeof device === "string" && /^[\w-]{8,64}$/.test(device) ? device : null;
    let clean = base;
    for (let i = 0; clean && players[clean] && players[clean].bot && i < 25; i++) clean = base.slice(0, 19) + "bcdefghijklmnopqrstuvwxyz"[i];
    for (let i = 2; clean && players[clean] && taken(players[clean], token) && i < 100; i++) clean = base.slice(0, 18) + i;
    const p = getPlayer(clean);
    if (!p) return null;
    if (token) p.device = token;
    return clean !== base && players[base] && !players[base].bot ? { player: p.name, color: p.color, renamed: true } : { player: p.name, color: p.color };
  };
  const addBot = (name) => getPlayer(name, true);
  // A bot leaves so a human can play (MAX_PLAYERS): gone from every list, with its mines and decoys.
  function dropBot(q) {
    delete players[q.name];
    bullets = bullets.filter((b) => b.owner !== q.name); // an ownerless bullet would hurt anyone (canHurt)
    mines = mines.filter((m) => m.owner !== q.name);
    decoys = decoys.filter((d) => d.owner !== q.name);
  }

  // Only join() and addBot() create players (v1.0 finding #18: ghost players). Returns true when the player exists,
  // false when the name is unknown (server.js answers 409 "join first").
  function handleInput(msg) {
    const p = msg && getPlayer(msg.player, false, { create: false });
    if (!p) return false;
    if (msg.type === "axis" && Contract.STICKS.includes(msg.axis)) {
      const x = clamp(Number(msg.x) || 0, -1, 1), y = clamp(Number(msg.y) || 0, -1, 1);
      p.axes[msg.axis] = { x, y };
      if (x || y) moved(p);
      return true;
    }
    if (msg.type !== "input") return true;
    const action = Contract.normaliseAction(msg.action);
    const down = !!msg.down;
    if (action === "ready") { if (down) p.ready = true; return true; }
    // The phone's draw sheet opened / closed: hover, protected, no control (re-sending "down" never extends it).
    if (action === "drawing") {
      if (!down) p.drawingUntil = 0;
      else if (!(p.drawingUntil > S.t)) { p.drawingUntil = S.t + DRAWING_SHIELD_SECONDS; p.keys = {}; p.axes = {}; p.pressed = []; }
      return true;
    }
    if (p.drawingUntil > S.t) return true;
    if (p.landingFor > 0 || p.takeoffFor > 0) return true; // the landing / take-off shot plays without control
    if (Contract.MOVES.includes(action)) { p.keys[action] = down; if (down) moved(p); return true; }
    if (!V1_VERBS.has(action)) return true;
    if (!down) { p.keys[action] = false; return true; }
    if (!can(p, action)) { refuse(p, action); return true; }
    p.keys[action] = down;
    if (down) {
      moved(p); // using any skill drops the spawn shield
      if (PRESS.includes(action) && p.pressed.length < MAX_PRESSES) p.pressed.push(action);
      p.action = action;
      p.slot = (Verbs.VERBS[action] && Verbs.VERBS[action].slot) || "use";
      p.startedAt = Date.now();
    }
    return true;
  }

  // A verb the entity has not unlocked: a toast explains what to draw, at most once per refusalToastSeconds per verb.
  function refuse(p, verb) {
    if (p.bot || S.t - (p.refusedAt[verb] ?? -Infinity) < T.refusalToastSeconds) return;
    p.refusedAt[verb] = S.t;
    const type = p.entity ? p.entity.type : "ship";
    const what = type === "ship" ? "ship" : "explorer";
    const world = Verbs.worldOf(type);
    let text;
    const name = Verbs.labelOf(verb);
    if (verb === "jump" && (type === "car" || type === "bike")) text = `JUMP · ${type}s can't jump`;
    else if (verb === "takeoff" || (Verbs.VERBS[verb] && !Verbs.VERBS[verb].modes.includes(world))) text = `${name} · not here: ${world === "space" ? "only on the planet" : "only in space"}`;
    else if (verb === "drive") text = "DRIVE · draw a car or a bike as your explorer";
    else text = `${name} · draw ${Verbs.PARTS[verb] || "it"} on your ${what}`;
    send({ type: "toast", player: p.name, kind: "refused", verb, text, sketch: null, ghost: null });
  }

  // A finished ship / explorer drawing (Astra's entity: type, unlocked, parts, source). Full redraws only: it replaces
  // that world's entity. A new ship also repairs a wrecked parked ship (that is how a wreck is fixed).
  // Never creates a player (finding #18): server.js joins first. type: the ship is always "ship"; a planet entity keeps
  // person / car / bike / quadruped / blob, anything else becomes "person" (render.js builds exactly those six).
  // card: the unlock card Astra sent (≤ 200 chars), else Verbs.cardOf. The new entity always reaches every screen.
  function setEntity(name, kind, entity) {
    const p = getPlayer(name, false, { create: false });
    if (!p || !entity) return null;
    const world = kind === "ship" ? "space" : "planet";
    const type = world === "space" ? "ship" : Verbs.PLANET_TYPES.includes(entity.type) ? entity.type : "person";
    const skills = Verbs.SKILLS[world];
    const unlocked = (Array.isArray(entity.unlocked) ? entity.unlocked : []).filter((u) => u && skills.includes(u.verb)).map((u) => ({ verb: u.verb, part: String(u.part || "drawing") }));
    const card = typeof entity.card === "string" && entity.card.trim() ? entity.card.slice(0, 200) : Verbs.cardOf(type, unlocked);
    p.drawn[world] = { type, unlocked, parts: Array.isArray(entity.parts) ? entity.parts.slice(0, 12) : [], source: entity.source || "model", card };
    if (world === "space") {
      const car = parked.find((x) => x.player === p.name);
      if (car && car.wrecked) { car.wrecked = false; car.hp = car.maxHp; announce(`🔧 ${p.name} rebuilt their ship`); sendWorld(); }
    }
    if (p.mode === world) setMode(p, p.mode, "fresh");
    return p.entity;
  }

  // kind "button" adds the new controls to the current layout, replacing any with the same action (as the phone
  // does); anything else replaces the whole layout. Never creates a player (finding #18).
  function setLayout(name, layout, kind = "controller") {
    const p = getPlayer(name, false, { create: false });
    if (!p || !layout || !Array.isArray(layout.buttons)) return;
    p.layout = mergeLayout(p.layout, layout, kind);
  }
  // The player's whole pad now: their drawn controller plus added buttons, else the phone's default.
  const layoutOf = (name) => { const p = players[Contract.cleanName(name)]; return (p && p.layout) || DEFAULT_LAYOUT; };

  // Drawing budget (rules.js): lobby and space drawings count toward "space", island ones toward "planet".
  const drawingWorld = (name) => { const p = players[Contract.cleanName(name)]; return p && p.mode === "planet" ? "planet" : "space"; };
  const drawingsLeft = (name) => budget.left(Contract.cleanName(name));
  const spendDrawing = (name, world = drawingWorld(name)) => budget.spend(Contract.cleanName(name), world);

  // ---- Round clock ---------------------------------------------------------------------------------------------

  // The lobby: players join and draw; the host presses START (start()). Players, drawings and layouts are kept.
  function newRound() {
    S.round++; S.phase = "lobby"; S.phaseT = 0; S.playT = 0; S.assists = false; S.result = null;
    S.playerCount = scaledCount(active());
    buildWorld();
    hints.reset(); budget.reset(); parked = [];
    for (const p of Object.values(players)) {
      spawnAt(p);
      Object.assign(p, { ready: p.bot, hints: {}, keys: {}, axes: {}, drawingUntil: 0, pressed: [], cd: {}, invisibleFor: 0, shieldEnergy: 1, boostEnergy: 1, boostLocked: false, shieldLocked: false, lastChest: null, refusedAt: {}, tractor: null, empFor: 0, inkFor: 0, late: {}, lateAt: -Infinity });
      setMode(p, "space", true); // assists from the last round are gone
    }
    sendWorld();
  }

  // START: the boss's HP and the chest count scale with the players in the round now (bots count boss.botWeight each
  // for the HP, botWeight each for the chests).
  // countdown (owner, 10 Oct 09:05: a real server phase so every phone counts with the big screen): phase "countdown"
  // for ROUND.countdownSeconds (tick.countdown 3, 2, 1), then GO (go()). Meanwhile nothing moves, fires or thinks,
  // bots included (step() runs no simulate), and presses are dropped; held keys and sticks count from GO. server.js
  // asks for it on every POST /start (v1.4); without it (world.start() in tests, --autostart) play starts at once.
  function start({ countdown = false } = {}) {
    if (S.phase !== "lobby") return false;
    S.playerCount = scaledCount(active());
    const hp = bossHp(hpCount(active()));
    Object.assign(boss, { hp, maxHp: hp });
    buildIsland(chestCount(S.playerCount));
    const wait = countdown ? Math.max(0, Number(ROUND.countdownSeconds) || 0) : 0;
    S.phase = wait > 0 ? "countdown" : "playing"; S.phaseT = 0; S.playT = 0;
    for (const p of Object.values(players)) { spawnAt(p); Object.assign(p, { pressed: [], score: 0, lastChest: null, hitBy: {}, run: null, botBoost: false, hitAcc: 0 }); }
    // v1.4: the kill feed only (not big): every screen shows its own big 3-2-1 from the phase, so a banner would cover it.
    if (wait > 0) announce(`Round ${S.round} starts in ${Math.round(wait)}…`);
    else go();
    sendWorld();
    return true;
  }
  function go() {
    if (S.phase === "countdown") {
      // Somebody joined (or a bot left) during the 3-2-1: the round is scaled for who is here at GO. The island keeps
      // its shape (a new seed would rebuild the terrain on every screen at GO): only the chests are placed again, and
      // if they do not fit, the START ones stay.
      const n = scaledCount(active()), hp = bossHp(hpCount(active()));
      if (n !== S.playerCount || hp !== boss.maxHp) {
        S.playerCount = n;
        Object.assign(boss, { hp, maxHp: hp });
        const count = chestCount(n);
        if (count !== chests.length) placeChests(landing.x, landing.z, count); // false: chests unchanged
      }
    }
    S.phase = "playing"; S.phaseT = 0; S.playT = 0;
    for (const p of Object.values(players)) { p.pressed = []; p.spawnShield = T.spawnShieldSeconds; }
    announce(`Round ${S.round}: ${Contract.OBJECTIVES.boss}`, true);
  }

  // 3:00 (world.assists): the chests glow, every hint jumps to its last step ("Draw a shovel or claws on your
  // explorer", "Draw DIG") and every human still missing a gate skill gets a big "draw X" card (lateHint); no skill is
  // ever given (owner, 10 Oct 09:05).
  function startAssists() {
    S.phase = "assists"; S.assists = true;
    announce("3:00! The chests glow. Missing a skill? Draw it now!", true);
    sendWorld();
  }

  // 4:00, or every chest open: most points wins and earns a star; ties go to whoever got there first (join order).
  function endRound(reason) {
    S.phase = "scoreboard"; S.phaseT = 0;
    const list = active();
    // v1.3: bots are fillers: every human ranks above every bot (each group by points, ties in join order), so a bot
    // only wins a round with no humans in it, and the banner and the scoreboard always name the same winner.
    const byScore = (a, b) => b[1] - a[1];
    const rows = (bots) => ordered(list).filter((p) => !!p.bot === bots).map((p) => [p.name, p.score]).sort(byScore);
    const scores = [...rows(false), ...rows(true)];
    const winner = scores.length && scores[0][1] > 0 ? scores[0][0] : null;
    for (const [name, score] of scores) {
      const row = session[name] || (session[name] = { stars: 0, total: 0 });
      row.total += score;
      if (name === winner) row.stars++;
    }
    S.result = { round: S.round, reason, winner, scores };
    for (const p of list) { p.keys = {}; p.drilling = false; p.digging = false; }
    const why = reason === "chests" ? "Every chest is open" : "Time's up";
    announce(winner ? `🏆 ${why}! ${winner} wins round ${S.round} with ${scores[0][1]} points` : `${why}! Nobody scored this round`, true);
    sendWorld();
  }

  // ---- Space ---------------------------------------------------------------------------------------------------

  function controls(p) {
    const k = p.keys, steer = p.axes.steer || { x: 0, y: 0 }, move = p.axes.move || { x: 0, y: 0 };
    return {
      turn: clamp((k.right ? 1 : 0) - (k.left ? 1 : 0) + steer.x, -1, 1),
      pitch: clamp((k.up ? 1 : 0) - (k.down ? 1 : 0) + steer.y, -1, 1),
      thrust: clamp((k.forward ? 1 : 0) - (k.back ? 1 : 0), -1, 1),
      strafeX: clamp((k.straferight ? 1 : 0) - (k.strafeleft ? 1 : 0) + move.x, -1, 1),
      strafeY: clamp((k.rise ? 1 : 0) - (k.sink ? 1 : 0) + move.y, -1, 1),
    };
  }

  // Energy meters drain while held and recharge otherwise; at 0 they lock until 20% is back.
  function energy(p, held, key, lockKey, cfg, dt) {
    if (p[lockKey] && p[key] >= 0.2) p[lockKey] = false;
    const on = held && !p[lockKey] && p[key] > 0;
    if (on) { p[key] = Math.max(0, p[key] - cfg.drainPerSecond * dt); if (p[key] === 0) p[lockKey] = true; }
    else p[key] = Math.min(1, p[key] + cfg.rechargePerSecond * dt);
    return on;
  }

  function pushOut(p, center, radius) {
    const d = dist(p.pos, center);
    if (d < radius) p.pos = add(center, norm(d > 0.01 ? sub(p.pos, center) : v3(0, 1, 0)), radius);
  }

  function moveShip(p, dt) {
    p.boosting = energy(p, !!p.keys.boost, "boostEnergy", "boostLocked", T.boost, dt);
    p.shielding = energy(p, !!p.keys.shield, "shieldEnergy", "shieldLocked", T.shield, dt);
    if (p.stun > 0) { p.stun -= dt; p.vel = v3(); return; }
    // Drawing: hover on (BACK held, about 3 m/s), no turning.
    const s = p.drawingUntil > S.t ? { turn: 0, pitch: 0, thrust: -1, strafeX: 0, strafeY: 0 } : controls(p);
    p.yaw = wrap(p.yaw - s.turn * T.turnRate * dt);
    p.pitch = clamp(p.pitch + s.pitch * T.turnRate * dt, -T.maxPitch, T.maxPitch);
    p.roll = -clamp(s.turn + s.strafeX * 0.5, -1, 1) * 0.6;
    const { forward, right, up } = basis(p.yaw, p.pitch);
    // FORWARD nudges the cruise up a little, BACK brakes almost to a hover; BOOST is the real speed-up.
    const speed = (T.cruiseSpeed + s.thrust * (s.thrust > 0 ? T.thrustSpeed : T.brakeSpeed)) * (p.boosting ? T.boostMultiplier : 1);
    const was = p.pos;
    p.pos = add(p.pos, forward, speed * dt);
    p.pos = add(p.pos, right, s.strafeX * T.strafeSpeed * dt);
    p.pos = add(p.pos, up, s.strafeY * T.strafeSpeed * dt);
    pull(p, dt);
    // Soft world edge: past the radius, the ship is pulled back toward the centre.
    const r = len(p.pos);
    if (r > T.worldRadius) p.pos = add(p.pos, p.pos, -(r - T.worldRadius) / r);
    if (!boss.dead) pushOut(p, boss.pos, boss.radius + SHIP_RADIUS);
    if (planet) pushOut(p, planet, planet.radius + SHIP_RADIUS);
    for (const rock of rocks) {
      const pull = ROCK_TYPES[rock.type].pullRange;
      if (pull && dist(rock.pos, p.pos) < pull) p.pos = add(p.pos, norm(sub(rock.pos, p.pos)), ROCK_TYPES[rock.type].pullSpeed * dt);
    }
    p.vel = { x: (p.pos.x - was.x) / dt, y: (p.pos.y - was.y) / dt, z: (p.pos.z - was.z) / dt }; // bots lead their shots
  }

  // Ships shoot in space, explorers on the island (level, from chest height); a bullet only meets its own mode.
  function fire(p, dt) {
    p.fireCd = Math.max(0, p.fireCd - dt);
    if (!p.keys.shoot || p.shielding || p.fireCd > 0 || p.stun > 0) return;
    const space = p.mode === "space";
    const { forward } = basis(p.yaw, space ? p.pitch : 0);
    const from = space ? add(p.pos, forward, 3) : add(add(p.pos, v3(0, EXPLORER_CHEST, 0)), forward, 1);
    // A human's shot that is on its way to the boss flies through the bots in the swarm (stray hits would start
    // revenge fights the human never asked for); aimed anywhere else it hurts them.
    const atBoss = space && !p.bot && !boss.dead && onLine({ pos: from }, forward, boss.pos, boss.radius);
    bullets.push({ id: nextId++, mode: p.mode, pos: from, dir: forward, owner: p.name, color: p.color, life: VERB.shoot.life, damage: VERB.shoot.damage, atBoss });
    p.fireCd = p.bot ? BOT_FIRE_COOLDOWN : VERB.shoot.cooldown;
  }

  function damageRock(rock, owner, amount = 1) {
    rock.health -= amount;
    worldDirty = true;
    if (rock.health > 0) { fx("spark", rock.pos, 0xd6d3d1, 1); return; }
    const type = ROCK_TYPES[rock.type];
    fx("explode", rock.pos, rock.type === "crystal" ? 0x67e8f9 : 0xa8a29e, rock.size);
    const p = players[owner];
    if (p) {
      addScore(p, SCORING[rock.type] != null ? SCORING[rock.type] : SCORING.rock);
      if (type.heal) p.hp = Math.min(T.shipHp, p.hp + type.heal);
    }
    // Finding #15: a destroyed rock is gone for the round, never replaced: a new rock id makes every screen rebuild its
    // whole rock field (render.js setRocks), and a field of TUNING.rockCount rocks lasts a 4:00 round.
    rocks = rocks.filter((r) => r !== rock);
    if (type.blastRadius) for (const q of active()) if (q.mode === "space" && dist(q.pos, rock.pos) < type.blastRadius) hurt(q, type.blastDamage, null);
    // Splitters (not in play in v1) are the one exception: their halves are new rocks (a rebuild on every screen).
    if (type.splitInto) for (let i = 0; i < type.splitInto; i++) rocks.push(spawnRock("stone", add(rock.pos, randomPoint(rock.size, rock.size + 2)), rock.size / 2));
  }

  const invulnerable = (p) => p.landingFor > 0 || p.takeoffFor > 0 || p.spawnShield > 0 || p.drawingUntil > S.t;
  // The spawn shield lasts until the player moves (any non-zero input) or uses any skill, at most spawnShieldSeconds.
  const moved = (p) => { if (S.phase === "playing" || S.phase === "assists") p.spawnShield = 0; };
  const inputOn = (p) => Object.values(p.keys).some(Boolean) || Object.values(p.axes).some((a) => a && (a.x || a.y));
  // Scores never go below 0 (v1.3): returns the change actually made.
  const addScore = (p, n) => { const was = p.score; p.score = Math.max(0, p.score + n); return p.score - was; };
  // A personal plain-words line on one human's phone (toast kind "info").
  const tell = (name, text, verb = null) => { const q = players[name]; if (q && !q.bot) send({ type: "toast", player: q.name, kind: "info", verb, text, sketch: null, ghost: null }); };

  // The hit marker (v1.3): a human hurt by a player or the boss hears from where, at most HIT_PER_SECOND times a
  // second (the damage in between adds up). dir: where the attacker is on the victim's screen, as the tractor's.
  function hitNotice(p, amount, from, src) {
    if (p.bot || !from) return;
    p.hitAcc = (p.hitAcc || 0) + amount;
    if (S.t - p.hitSentAt < 1 / HIT_PER_SECOND) return;
    const m = { type: "hit", player: p.name, from, amount: Math.round(p.hitAcc) };
    if (src) m.dir = screenDir(p, { pos: src });
    p.hitSentAt = S.t; p.hitAcc = 0;
    send(m);
  }

  // PvP everywhere: ships in space, explorers on the island. Ruthless: a kill within stealSeconds of the victim
  // opening a chest steals stealShare of that chest's points (only a human killer steals). how: a mischief kind
  // (mine, tractor) or "boss"; src: where the hit came from (the hit marker), default the attacker's position.
  function hurt(p, amount, by, how = null, src = null) {
    if (p.dead || invulnerable(p)) return;
    // A bot remembers the humans who hit it: it shoots back at them for BOT_REVENGE_SECONDS (botThink).
    if (p.bot && by && players[by] && !players[by].bot) p.hitBy[by] = S.t;
    if (p.shielding) { fx("spark", p.pos, p.color, 2, p.mode); return; }
    p.hp -= amount;
    fx("hit", p.pos, 0xf97316, 1, p.mode);
    const attacker = by && by !== p.name ? players[by] : null;
    hitNotice(p, amount, attacker ? attacker.name : how === "boss" ? "boss" : null, src || (attacker && attacker.mode === p.mode ? attacker.pos : null));
    if (p.hp > 0) return;
    p.hp = 0; p.dead = true; p.deadFor = 0; p.drilling = false; p.digging = false; p.tractor = null;
    fx("explode", p.pos, p.color, p.mode === "space" ? 8 : 3, p.mode);
    const killer = attacker;
    addScore(p, SCORING.killed); // dying costs points however it happens (never below 0)
    if (killer) {
      if (!p.bot) addScore(killer, SCORING.kill); // bots are fillers: farming them pays nothing
      announce(`${killer.name} ✕ ${p.name}${how && MISCHIEF_ICON[how] ? ` ${MISCHIEF_ICON[how]}` : ""}`);
      const chest = p.lastChest;
      if (chest && !killer.bot && S.playT - chest.at <= T.stealSeconds) {
        const stolen = -addScore(p, -Math.round(chest.points * T.stealShare));
        if (stolen > 0) {
          addScore(killer, stolen);
          announce(`💰 ${killer.name} stole ${stolen} points from ${p.name}!`);
          tell(p.name, `${killer.name} stole ${stolen} of your points`);
        }
      }
    } else announce(`${p.name} was destroyed`);
    // The victim's own phone says who and when it comes back (v1.0 playtest: 7 deaths with no message).
    if (!p.bot) send({ type: "toast", player: p.name, kind: "info", verb: null, killer: killer ? killer.name : null, text: `${killer ? `Destroyed by ${killer.name}` : "Destroyed"} · back in ${T.respawnSeconds} s`, sketch: null, ghost: null });
    p.lastChest = null;
  }

  // Any weapon hurts the boss. The last hit scores, whoever lands it: stealing it from the top damage dealer is allowed
  // ("X stole the boss from Y", and Y's phone hears it). Bots are fillers: when one lands the final blow, the +1000 goes
  // to the human who did the most damage.
  function hitBoss(amount, owner, at) {
    if (boss.dead) return;
    boss.hp = Math.max(0, boss.hp - amount);
    if (owner) boss.damageBy[owner] = (boss.damageBy[owner] || 0) + amount;
    if (at) fx("hit", at, 0xef4444, 2);
    worldDirty = true;
    if (boss.hp > 0) return;
    boss.dead = true;
    const p = players[owner];
    const humanTop = Object.entries(boss.damageBy).filter(([n]) => players[n] && !players[n].bot).sort((a, b) => b[1] - a[1])[0];
    const scorer = p && !p.bot ? p : humanTop ? players[humanTop[0]] : null;
    if (scorer) addScore(scorer, SCORING.bossLastHit);
    fx("explode", boss.pos, 0xef4444, 30);
    planet = { x: planetAt.x, y: planetAt.y, z: planetAt.z, radius: T.planet.radius, landRange: T.planet.landRange };
    // Rocks where the planet appears are removed, never replaced (finding #15: a new rock id rebuilds every field).
    rocks = rocks.filter((r) => dist(r.pos, planet) >= planet.radius + 10 + r.size);
    if (p && p.bot) announce(`💥 The swarm brought the boss down!${scorer ? ` ${scorer.name} did the most damage: +${SCORING.bossLastHit}.` : ""} ${Contract.OBJECTIVES.planet}`, true);
    else if (p && humanTop && humanTop[0] !== p.name) {
      announce(`💥 ${p.name} stole the boss from ${humanTop[0]}! +${SCORING.bossLastHit}. ${Contract.OBJECTIVES.planet}`, true);
      tell(humanTop[0], `${p.name} stole the boss kill`);
    } else announce(`💥 ${p ? p.name : "Someone"} destroyed the boss!${p ? ` +${SCORING.bossLastHit}.` : ""} ${Contract.OBJECTIVES.planet}`, true);
    bossShots = [];
    sendWorld();
  }

  // Parked ships on the pad can be shot by explorers (not their owner's); a wrecked one needs a new ship drawing.
  // Ruthless: the wrecker scores SCORING.wreck, announced in the kill feed; the owner is told how to fix it.
  function hitParked(car, amount, by) {
    if (car.wrecked) return;
    car.hp = Math.max(0, car.hp - amount);
    const pos = { x: car.x, y: islandFeet(car.x, car.z) + 1.5, z: car.z };
    fx("hit", pos, 0xf97316, 1, "planet");
    worldDirty = true;
    if (car.hp > 0) return;
    car.wrecked = true;
    fx("explode", pos, 0xf97316, 6, "planet");
    const wrecker = by && by !== car.player ? players[by] : null;
    if (wrecker) addScore(wrecker, SCORING.wreck);
    announce(wrecker ? `🔧 ${wrecker.name} wrecked ${car.player}'s ship (+${SCORING.wreck})` : `🔧 ${car.player}'s ship was wrecked`);
    tell(car.player, `${wrecker ? wrecker.name : "Someone"} wrecked your ship: draw a new ship to take off`, "takeoff");
    sendWorld();
  }
  const leaving = (c) => players[c.player] && players[c.player].takeoffFor > 0; // its owner is taking off in it
  const parkedHit = (from, to, owner) => parked.find((c) => c.player !== owner && !c.wrecked && !leaving(c) && segDist({ x: c.x, y: islandFeet(c.x, c.z) + 1.5, z: c.z }, from, to) < PARKED_RADIUS);
  // Bots never start a fight: a bot's bullet passes through other bots and through every human who has not hit that
  // bot in the last BOT_REVENGE_SECONDS. Humans' bullets hurt anyone.
  const grudge = (bot, q) => S.t - (bot.hitBy[q.name] ?? -Infinity) <= BOT_REVENGE_SECONDS;
  const canHurt = (owner, q) => { const o = players[owner]; return !o || !o.bot || (!q.bot && grudge(o, q)); };

  function updateBullets(dt) {
    bullets = bullets.filter((b) => {
      const from = b.pos;
      b.pos = add(b.pos, b.dir, VERB.shoot.speed * dt);
      b.life -= dt;
      const decoy = decoys.length && !b.atBoss && players[b.owner] && !players[b.owner].bot ? decoyHit(b, from) : null;
      if (decoy) { hitDecoy(decoy, b.damage, b.owner); return false; }
      if (b.mode === "planet") {
        const hit = active().find((q) => q.name !== b.owner && q.mode === "planet" && !q.dead && canHurt(b.owner, q) && segDist(add(q.pos, v3(0, EXPLORER_CHEST, 0)), from, b.pos) < EXPLORER_RADIUS + 0.3);
        if (hit) { hurt(hit, b.damage, b.owner); return false; }
        const car = parkedHit(from, b.pos, b.owner);
        if (car) { hitParked(car, b.damage, b.owner); return false; }
        if (b.pos.y < Terrain.height(b.pos.x, b.pos.z, island.seed)) return false; // into a hill
        return b.life > 0;
      }
      if (!boss.dead && dist(b.pos, boss.pos) < boss.radius + 0.5) { hitBoss(b.damage, b.owner, b.pos); return false; }
      const rock = rocks.find((r) => dist(r.pos, b.pos) < r.size + 0.5);
      if (rock) { damageRock(rock, b.owner); return false; }
      const ship = active().find((q) => q.name !== b.owner && q.mode === "space" && !q.dead && !(b.atBoss && q.bot) && canHurt(b.owner, q) && segDist(q.pos, from, b.pos) < SHIP_RADIUS + 0.5);
      if (ship) { hurt(ship, b.damage, b.owner); return false; }
      return b.life > 0;
    });
  }

  // The boss shoots back at a random ship within shotRange, faster the more ships there are (contract TUNING.boss).
  function updateBoss(dt) {
    if (boss.dead) return;
    boss.shotCd -= dt;
    if (boss.shotCd <= 0) {
      const near = active().filter((p) => p.mode === "space" && !p.dead && p.invisibleFor <= 0 && !invulnerable(p) && dist(p.pos, boss.pos) < T.boss.shotRange);
      // Decoys draw its fire: each counts as one more ship it may pick.
      for (const d of decoys) if (d.mode === "space" && dist(d.pos, boss.pos) < T.boss.shotRange) near.push(d);
      boss.shotCd = T.boss.shotEverySeconds / Math.sqrt(Math.max(1, near.length));
      const target = near.length ? near[Math.floor(random() * near.length)] : null;
      if (target) {
        const dir = norm(sub(target.pos, boss.pos));
        bossShots.push({ id: nextId++, pos: add(boss.pos, dir, boss.radius + 1), dir, life: T.boss.shotLife });
      }
    }
    bossShots = bossShots.filter((s) => {
      s.pos = add(s.pos, s.dir, T.boss.shotSpeed * dt);
      s.life -= dt;
      const lure = decoys.length ? decoys.find((d) => d.mode === "space" && dist(d.pos, s.pos) < SHIP_RADIUS + 1) : null;
      if (lure) { hitDecoy(lure, T.boss.shotDamage, null); return false; }
      const ship = active().find((q) => q.mode === "space" && !q.dead && dist(q.pos, s.pos) < SHIP_RADIUS + 1);
      if (ship) { hurt(ship, T.boss.shotDamage, null, "boss", boss.pos); return false; }
      return s.life > 0;
    });
  }

  function rockCollisions(p) {
    if (p.stun > 0 || p.dead || p.mode !== "space" || invulnerable(p)) return; // spawn shield, drawing, landing: pass through
    const rock = rocks.find((r) => dist(r.pos, p.pos) < r.size + (p.shielding ? 4 : SHIP_RADIUS));
    if (!rock) return;
    fx("explode", rock.pos, p.shielding ? p.color : 0xf97316, rock.size);
    if (!p.shielding) { p.stun = T.stunSeconds; addScore(p, SCORING.hitByRock); }
    if (!p.shielding && p.tractor && p.tractor.until + 0.5 > S.t) { const by = p.tractor.by; p.tractor = null; hurt(p, TRACTOR_ROCK_DAMAGE, by, "tractor"); }
    rocks = rocks.filter((r) => r !== rock); // gone for the round (finding #15)
    worldDirty = true;
  }

  // ---- Island --------------------------------------------------------------------------------------------------

  // Landing and take-off are predefined animations (PLAN.md, The space-to-planet transition): the player has no
  // control and cannot be hurt while flags.landing / flags.takingOff are on; render plays the shot from
  // action "land" / "takeoff" + startedAt.
  function startAnim(p, action) {
    p.keys = {}; p.axes = {}; p.pressed = []; p.tractor = null;
    p.boosting = false; p.shielding = false; p.drilling = false; p.digging = false;
    p.action = action; p.slot = (Verbs.VERBS[action] && Verbs.VERBS[action].slot) || "mount"; p.startedAt = Date.now();
  }

  function land(p) {
    if (!planet || p.mode !== "space" || p.landingFor > 0 || dist(p.pos, planet) > planet.radius + planet.landRange) return;
    startAnim(p, "land");
    pickBay(p); // the bay the shot ends on (tick bay) and the ship parks in (touchdown)
    p.landingFor = T.planet.landingSeconds;
    fx("land", p.pos, p.color, 6);
  }

  function touchdown(p) {
    p.landingFor = 0;
    const b = bay(p);
    parked = parked.filter((x) => x.player !== p.name).concat([{ player: p.name, x: r2(b.x), z: r2(b.z), hp: T.planet.parkedShipHp, maxHp: T.planet.parkedShipHp, wrecked: false }]);
    setMode(p, "planet");
    standBeside(p);
    p.keys = {}; p.axes = {}; // buttons held in the ship don't carry over to the explorer
    fx("land", { x: b.x, y: islandFeet(b.x, b.z), z: b.z }, p.color, 6, "planet");
    announce(`${p.name} landed on the planet. ${Contract.OBJECTIVES.openChests}`); // v1.4: was "DIG UP A CHEST" (the TV parses the prefix)
    sendWorld();
  }

  function takeoff(p) {
    if (p.mode !== "planet" || !planet || p.takeoffFor > 0) return;
    const car = parked.find((x) => x.player === p.name);
    if (car && car.wrecked) {
      if (S.t - (p.refusedAt.wreck ?? -Infinity) >= T.refusalToastSeconds) {
        p.refusedAt.wreck = S.t;
        send({ type: "toast", player: p.name, kind: "info", verb: "takeoff", text: "Your ship is wrecked: draw a new ship to take off", sketch: null, ghost: null });
      }
      return;
    }
    startAnim(p, "takeoff");
    p.takeoffFor = T.planet.takeoffSeconds;
  }

  function liftoff(p) {
    p.takeoffFor = 0;
    parked = parked.filter((x) => x.player !== p.name);
    const out = norm(sub(v3(), planet));
    setMode(p, "space");
    p.keys = {}; p.axes = {};
    p.pos = add(planet, out, planet.radius + 15);
    p.yaw = Math.atan2(-out.x, -out.z); p.pitch = 0; p.roll = 0;
    fx("land", p.pos, p.color, 6);
    sendWorld();
  }

  function moveWalker(p, dt) {
    const k = p.keys, steer = p.axes.steer || { x: 0, y: 0 }, move = p.axes.move || { x: 0, y: 0 };
    // Steer stick turns (and walks with its y so a default controller is never stuck); move stick walks and strafes.
    // Stunned (a mine) the explorer stands still for a moment.
    const still = p.stun > 0;
    if (still) p.stun -= dt;
    const turn = still ? 0 : clamp((k.right ? 1 : 0) - (k.left ? 1 : 0) + steer.x, -1, 1);
    const fwd = still ? 0 : clamp((k.forward || k.up ? 1 : 0) - (k.back || k.down ? 1 : 0) + steer.y + move.y, -1, 1);
    const side = still ? 0 : clamp((k.straferight ? 1 : 0) - (k.strafeleft ? 1 : 0) + move.x, -1, 1);
    p.boosting = !!k.boost;
    p.shielding = energy(p, !!k.shield, "shieldEnergy", "shieldLocked", T.shield, dt);
    p.boostEnergy = Math.min(1, p.boostEnergy + T.boost.rechargePerSecond * dt);
    p.yaw = wrap(p.yaw - turn * T.turnRate * dt);
    // Movement per entity type: a person walks, cars and bikes drive fast, a quadruped runs, a blob bounces.
    const type = p.entity ? p.entity.type : "person";
    const speed = ISL.walkSpeed * (ISL.speeds[type] || 1) * (p.boosting ? ISL.runMultiplier : 1);
    if (type === "blob" && (fwd || side) && p.pos.y <= islandFeet(p.pos.x, p.pos.z) + 0.05) p.vy = ISL.jumpSpeed * 0.45;
    const fx_ = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const mx = (fx_ * fwd + rx * side) * speed * dt, mz = (fz * fwd + rz * side) * speed * dt;
    if (mx || mz) walk(p, mx, mz);
    pull(p, dt);
    p.vy -= ISL.gravity * dt;
    p.pos.y += p.vy * dt;
    const ground = islandFeet(p.pos.x, p.pos.z);
    if (p.pos.y <= ground) { p.pos.y = ground; p.vy = 0; }
  }

  // One walking step. Into the water it slides along the shore where it can: the dry heading closest to the one asked
  // for (the more inland side when both are dry), down to half speed along the shoreline itself, then the plain axis
  // slides; only a corner of the coastline stops it. Standing in the water, any step to higher ground wades out.
  function walk(p, mx, mz) {
    const { x, z } = p.pos;
    const ok = dry(x, z) ? (nx, nz) => dry(nx, nz) : (nx, nz) => dry(nx, nz) || Terrain.height(nx, nz, island.seed) > Terrain.height(x, z, island.seed);
    if (ok(x + mx, z + mz)) { p.pos.x = x + mx; p.pos.z = z + mz; return; }
    for (const turn of SHORE_TURNS) {
      const k = Math.max(Math.cos(turn), 0.5);
      let best = null;
      for (const t of [turn, -turn]) {
        const c = Math.cos(t), s = Math.sin(t), nx = x + (mx * c - mz * s) * k, nz = z + (mx * s + mz * c) * k;
        if (!ok(nx, nz)) continue;
        const h = Terrain.height(nx, nz, island.seed);
        if (!best || h > best.h) best = { nx, nz, h };
      }
      if (best) { p.pos.x = best.nx; p.pos.z = best.nz; return; }
    }
    if (ok(x + mx, z)) p.pos.x = x + mx;
    else if (ok(x, z + mz)) p.pos.z = z + mz;
  }

  // DIG opens buried chests, DRILL the ones inside rocks: hold it next to the chest until dug reaches 1.
  function openChest(p, dt, verb, kind, seconds) {
    if (!p.keys[verb]) return false;
    const chest = chests.find((c) => c.kind === kind && c.buried && dist2(c, p.pos) <= VERB.dig.range);
    if (!chest) return false;
    chest.dug = Math.min(1, chest.dug + dt / seconds);
    worldDirty = true;
    p.digFx = (p.digFx || 0) - dt;
    if (p.digFx <= 0) { p.digFx = 0.4; fx(verb, { x: chest.x, y: islandFeet(chest.x, chest.z), z: chest.z }, p.color, 1.5, "planet"); }
    if (chest.dug >= 1) { chest.buried = false; sendWorld(); }
    return true;
  }
  function dig(p, dt) { p.digging = openChest(p, dt, "dig", "buried", VERB.dig.seconds); }
  function drillRock(p, dt) { p.drilling = openChest(p, dt, "drill", "rock", VERB.drill.seconds); }

  // Walking onto an open chest collects it: +1500, and a kill in the next stealSeconds steals half (hurt()).
  function pickup(p) {
    const chest = chests.find((c) => !c.buried && !c.open && dist2(c, p.pos) <= ISL.pickupRange);
    if (!chest) return;
    chest.open = true; chest.by = p.name;
    addScore(p, SCORING.chest);
    p.lastChest = { at: S.playT, points: SCORING.chest };
    fx("treasure", { x: chest.x, y: islandFeet(chest.x, chest.z), z: chest.z }, p.color, 20, "planet");
    announce(`💎 ${p.name} opened a chest (+${SCORING.chest})`);
    sendWorld();
    if (chests.every((c) => c.open)) endRound("chests");
  }

  // ---- Verbs that are pressed once -----------------------------------------------------------------------------

  function ready(p, verb, cooldown) {
    if ((p.cd[verb] || 0) > 0) return false;
    cool(p, verb, cooldown);
    return true;
  }
  // A verb with a cooldown just fired: its owner's phone hears when it is ready again (a personal message, so 25
  // players' cooldowns never ride in the broadcast tick).
  function cool(p, verb, seconds) {
    p.cd[verb] = seconds;
    if (!p.bot && seconds >= 2) send({ type: "cooldown", player: p.name, verb, seconds });
  }

  function press(p, verb) {
    const space = p.mode === "space";
    const mode = p.mode;
    const { forward } = basis(p.yaw, space ? p.pitch : 0);
    if (MISCHIEF[verb]) mischief(p, verb);
    else if (verb === "land") land(p);
    else if (verb === "takeoff") takeoff(p);
    else if (verb === "flare") {
      if (!ready(p, "flare", VERB.flare.cooldown)) return;
      if (space) flares.push({ pos: { ...p.pos }, radius: VERB.flare.radius, until: S.t + VERB.flare.seconds });
      fx("flare", p.pos, 0xfff7c2, VERB.flare.radius, mode);
    } else if (verb === "scan") {
      if (!ready(p, "scan", VERB.scan.cooldown)) return;
      fx("scan", p.pos, p.color, VERB.scan.range, mode);
      if (!space || (!boss.dead && dist(p.pos, boss.pos) <= VERB.scan.range) || (planet && dist(p.pos, planet) <= VERB.scan.range)) revealUntil[p.name] = S.t + VERB.scan.seconds;
    } else if (verb === "jump") {
      if (!space) { if (ISL.jumpers.includes(p.entity.type) && p.pos.y <= islandFeet(p.pos.x, p.pos.z) + 0.05) p.vy = VERB.jump.speed; }
      else if (ready(p, "jump", VERB.jump.cooldown)) p.pos = add(p.pos, forward, VERB.jump.dash);
    } else if (verb === "invisible") {
      if (ready(p, "invisible", VERB.invisible.cooldown)) p.invisibleFor = VERB.invisible.duration;
    } else if (verb === "heal") {
      if (ready(p, "heal", VERB.heal.cooldown)) { p.hp = Math.min(T.shipHp, p.hp + VERB.heal.amount); fx("hit", p.pos, 0x4ade80, 2, mode); }
    } else if (verb === "teleport") {
      if (!ready(p, "teleport", VERB.teleport.cooldown)) return;
      if (space) p.pos = add(p.pos, forward, VERB.teleport.distance);
      else {
        for (let d = VERB.teleport.distance; d > 0; d -= 5) {
          const x = p.pos.x + forward.x * d, z = p.pos.z + forward.z * d;
          if (dry(x, z)) { p.pos = { x, y: islandFeet(x, z), z }; break; }
        }
      }
      fx("flare", p.pos, p.color, 4, mode);
    } else if (verb === "blast") {
      if (!ready(p, "blast", VERB.blast.cooldown)) return;
      fx("blast", add(p.pos, forward, VERB.blast.range / 2), p.color, VERB.blast.range, mode);
      const inCone = (pos, pad = 0) => { const d = sub(pos, p.pos); const l = len(d); return l < VERB.blast.range + pad && (l < pad || dot(d, forward) / l >= VERB.blast.coneCos); };
      for (const q of active()) if (q !== p && q.mode === p.mode && inCone(q.pos)) hurt(q, VERB.blast.damage, p.name);
      for (const d of decoys.filter((d) => d.mode === p.mode && d.owner !== p.name && inCone(d.pos, 2))) hitDecoy(d, VERB.blast.damage, p.name);
      if (!space) { for (const car of parked.filter((c) => c.player !== p.name && !leaving(c) && inCone({ x: c.x, y: p.pos.y, z: c.z }, PARKED_RADIUS))) hitParked(car, VERB.blast.damage, p.name); return; }
      for (const rock of rocks.filter((r) => inCone(r.pos, r.size))) damageRock(rock, p.name, rock.health);
      if (!boss.dead && inCone(boss.pos, boss.radius)) hitBoss(VERB.blast.damage, p.name, boss.pos);
    }
  }

  // ---- Mischief (PLAN.md "Mischief", v1.3) ------------------------------------------------------------------------
  // Each is unlocked by a drawn part (verbs.js grantedBy) and has a cooldown of 10 to 20 s, spent only when it fires.
  // EMP, ink bomb and tractor hit the nearest human rival in the same world within reach (bots are fillers, never
  // targets); a mine waits behind you for a rival to touch it; a decoy is a fake you that soaks fire. Nobody in the
  // lobby, landing, taking off, dead, cloaked or behind a spawn shield can be hit (exposed()). The victim's phone gets
  // { type: "mischief", kind, player, from, seconds, ... } and the kill feed announces it; a mischief kill (a mine, a
  // pull into a rock) is a kill: +200, -50 and the ruthless chest steal (hurt()).

  const exposed = (q) => !q.bot && !q.dead && !invulnerable(q) && q.invisibleFor <= 0;
  const gap = (a, b) => (a.mode === "space" ? dist(a.pos, b.pos) : dist2(a.pos, b.pos));
  const reach = (p, verb) => MISCHIEF[verb].range * (p.mode === "planet" ? ISLAND_REACH : 1);

  // 25 players: a rival already under that same effect is skipped (the next nearest gets it), so nobody is kept
  // scrambled, inked or pulled for good by a crowd.
  const underIt = (q, verb) => (verb === "emp" && q.empFor > 0) || (verb === "inkbomb" && q.inkFor > 0) || (verb === "tractor" && !!q.tractor && q.tractor.until > S.t);
  function rivalNear(p, range, verb = null) {
    let best = null, bestD = Infinity;
    for (const q of active()) {
      if (q === p || q.mode !== p.mode || !exposed(q) || (verb && underIt(q, verb))) continue;
      const d = gap(p, q);
      if (d <= range && d < bestD) { best = q; bestD = d; }
    }
    return best;
  }

  // Where `to` is on `from`'s screen: radians, 0 = right, π/2 = up (the direction of a tractor's pull).
  function screenDir(from, to) {
    const { forward, right, up } = basis(from.yaw, from.mode === "space" ? from.pitch : 0);
    const v = sub(to.pos, from.pos);
    return r2(Math.atan2(from.mode === "space" ? dot(v, up) : dot(v, forward), dot(v, right)));
  }

  // The victim's phone plays it, every screen sees a burst on the victim, the kill feed says who did it.
  function strike(victim, kind, by, extra, text) {
    send({ type: "mischief", kind, player: victim.name, from: by.name, seconds: 0, ...extra });
    fx(kind, victim.pos, by.color, 3, victim.mode);
    announce(`${MISCHIEF_ICON[kind]} ${text}`);
  }

  // Nobody in reach: say so (once per refusalToastSeconds per verb); the cooldown is not spent.
  function nobody(p, verb) {
    const key = `none:${verb}`;
    if (S.t - (p.refusedAt[key] ?? -Infinity) < T.refusalToastSeconds) return;
    p.refusedAt[key] = S.t;
    send({ type: "toast", player: p.name, kind: "info", verb, text: `${Verbs.labelOf(verb)} · no rival close enough`, sketch: null, ghost: null });
  }

  function mischief(p, verb) {
    const cfg = MISCHIEF[verb];
    if ((p.cd[verb] || 0) > 0) return;
    if (verb === "mine") return dropMine(p, cfg);
    if (verb === "decoy") return dropDecoy(p, cfg);
    const q = rivalNear(p, reach(p, verb), verb);
    if (!q) return nobody(p, verb);
    cool(p, verb, cfg.cooldown);
    if (verb === "emp") {
      q.empFor = cfg.seconds;
      strike(q, "emp", p, { seconds: cfg.seconds }, `${p.name} scrambled ${q.name}'s buttons`);
    } else if (verb === "inkbomb") {
      q.inkFor = cfg.seconds;
      strike(q, "inkbomb", p, { seconds: cfg.seconds }, `${p.name} inked ${q.name}'s screen`);
    } else if (verb === "tractor") {
      q.tractor = { by: p.name, until: S.t + cfg.seconds, speed: cfg.speed * (p.mode === "planet" ? ISLAND_PULL : 1) };
      strike(q, "tractor", p, { seconds: cfg.seconds, dir: screenDir(q, p) }, `${p.name} pulled ${q.name} in`);
    }
  }

  // The tractor beam: toward the puller for its seconds (on the island along the ground, never into the sea).
  function pull(p, dt) {
    const t = p.tractor;
    if (!t || t.until <= S.t) return;
    const by = players[t.by];
    if (!by || by.dead || by.mode !== p.mode || invulnerable(p)) { p.tractor = null; return; }
    const v = p.mode === "space" ? sub(by.pos, p.pos) : { x: by.pos.x - p.pos.x, y: 0, z: by.pos.z - p.pos.z };
    const d = len(v), step = Math.min(Math.max(0, d - 4), t.speed * dt);
    if (step <= 0) return;
    if (p.mode === "space") p.pos = add(p.pos, v, step / d);
    else walk(p, (v.x / d) * step, (v.z / d) * step);
  }

  function dropMine(p, cfg) {
    cool(p, "mine", cfg.cooldown);
    const at = p.mode === "space" ? add(p.pos, basis(p.yaw, p.pitch).forward, -4) : { x: p.pos.x, y: islandFeet(p.pos.x, p.pos.z), z: p.pos.z };
    const own = mines.filter((m) => m.owner === p.name);
    if (own.length >= MINES_PER_PLAYER) mines = mines.filter((m) => m !== own[0]);
    mines.push({ id: nextId++, owner: p.name, mode: p.mode, pos: at, until: S.t + cfg.life, armedAt: S.t + MINE_ARM_SECONDS, color: p.color, damage: cfg.damage });
    fx("mine", at, p.color, 1.5, p.mode);
    announce(`${MISCHIEF_ICON.mine} ${p.name} dropped a mine`);
  }

  // A human rival who comes close sets it off: stunned, SCORING.mineHit points and hurt (a shield eats it whole).
  function updateMines() {
    if (!mines.length) return;
    mines = mines.filter((m) => {
      if (m.until <= S.t) return false;
      if (m.armedAt > S.t) return true;
      const q = active().find((q) => q.name !== m.owner && q.mode === m.mode && !q.bot && !q.dead && !invulnerable(q) && gap(q, m) < MINE_RADIUS[m.mode]);
      if (!q) return true;
      fx("explode", m.pos, m.color, m.mode === "space" ? 4 : 2, m.mode);
      if (q.shielding) { fx("spark", q.pos, q.color, 2, q.mode); return false; }
      q.stun = Math.max(q.stun, T.stunSeconds);
      const lost = Math.abs(addScore(q, SCORING.mineHit)); // what the score floor actually let it take (never -0)
      strike(q, "mine", players[m.owner] || { name: m.owner, color: m.color }, { seconds: T.stunSeconds, points: lost }, `${q.name} hit ${m.owner}'s mine${lost ? ` (-${lost})` : ""}`);
      hurt(q, m.damage, m.owner, "mine");
      return false;
    });
  }

  // A fake copy of the owner beside them (same colour and drawing on every screen), flying or walking straight on.
  // It soaks fire: the boss may pick it and rivals' shots hit it; when it pops the shooter learns they were fooled.
  function dropDecoy(p, cfg) {
    cool(p, "decoy", cfg.cooldown);
    decoys = decoys.filter((d) => d.owner !== p.name);
    const space = p.mode === "space";
    const { forward, right } = basis(p.yaw, space ? p.pitch : 0);
    let pos = add(p.pos, right, DECOY_OFFSET[p.mode]);
    if (!space) {
      if (!dry(pos.x, pos.z)) pos = add(p.pos, right, -DECOY_OFFSET.planet);
      if (!dry(pos.x, pos.z)) pos = { ...p.pos };
      pos = { x: pos.x, y: islandFeet(pos.x, pos.z), z: pos.z };
    }
    decoys.push({ id: nextId++, owner: p.name, mode: p.mode, pos, dir: space ? forward : { x: forward.x, y: 0, z: forward.z }, yaw: p.yaw,
      until: S.t + cfg.seconds, hp: cfg.hp, color: p.color, speed: space ? T.cruiseSpeed : ISL.walkSpeed * 0.6 });
    fx("decoy", pos, p.color, 3, p.mode);
    announce(`${MISCHIEF_ICON.decoy} ${p.name} sent out a decoy`);
  }

  function updateDecoys(dt) {
    if (!decoys.length) return;
    decoys = decoys.filter((d) => {
      if (d.until <= S.t) { fx("respawn", d.pos, d.color, 2, d.mode); return false; }
      const next = add(d.pos, d.dir, d.speed * dt);
      if (d.mode === "planet") { if (dry(next.x, next.z)) d.pos = { x: next.x, y: islandFeet(next.x, next.z), z: next.z }; }
      else if (boss.dead || dist(next, boss.pos) > boss.radius + 3) d.pos = next;
      return true;
    });
  }

  const decoyCentre = (d) => (d.mode === "planet" ? add(d.pos, v3(0, EXPLORER_CHEST, 0)) : d.pos);
  const decoyHit = (b, from) => decoys.find((d) => d.mode === b.mode && d.owner !== b.owner && segDist(decoyCentre(d), from, b.pos) < (d.mode === "space" ? SHIP_RADIUS + 0.5 : EXPLORER_RADIUS + 0.3));

  function hitDecoy(d, amount, by) {
    d.hp -= amount;
    fx("hit", decoyCentre(d), 0xf97316, 1, d.mode);
    if (d.hp > 0) return;
    decoys = decoys.filter((x) => x !== d);
    fx("explode", decoyCentre(d), d.color, d.mode === "space" ? 6 : 3, d.mode);
    const shooter = by ? players[by] : null;
    if (!shooter || shooter.bot || shooter.name === d.owner) return;
    send({ type: "mischief", kind: "decoy", player: shooter.name, from: d.owner, seconds: 0 });
    send({ type: "mischief", kind: "decoy", player: d.owner, from: d.owner, victim: shooter.name, seconds: 0 });
    announce(`${MISCHIEF_ICON.decoy} ${shooter.name} shot ${d.owner}'s decoy`);
  }

  // ---- Hints (PLAN.md section 4, rules.js): riddle at 6 s stuck, faint sketch 10 s later, the answer with a ghost
  // box 15 s after that (at once in assists). A player is stuck at a gate once they have reached it (near the boss with
  // no usable weapon; in landing range; next to a closed chest) for as long as the gate is open and they are in its
  // world. The ladder points at the drawing while the skill is missing, then at the button (rules.js need).

  function gateOpen(gate) {
    if (gate === "weapon") return !boss.dead;
    if (gate === "land") return !!planet;
    const kind = gate === "dig" ? "buried" : "rock";
    return chests.some((c) => c.kind === kind && c.buried);
  }

  function atGate(p, gate) {
    if (gate === "weapon") return dist(p.pos, boss.pos) - boss.radius < BOSS_HINT_RANGE;
    // Ships can't hover: anyone flying within LAND_HINT_EXTRA m of landing range has reached the LAND gate (the
    // v1.0 e2e saw a player circling just outside landing range get no LAND hint).
    if (gate === "land") return dist(p.pos, planet) <= planet.radius + planet.landRange + LAND_HINT_EXTRA;
    const kind = gate === "dig" ? "buried" : "rock";
    return chests.some((c) => c.kind === kind && c.buried && dist2(c, p.pos) <= VERB.dig.range + 2);
  }

  // The gate's skill on the entity, and a button for it. The weapon gate takes any weapon (shoot, blast, drill).
  function gateNeeds(p, gate) {
    if (gate !== "weapon") return { hasSkill: can(p, gate), hasControl: hasControl(p.layout, gate), action: gate };
    const mine = Verbs.WEAPONS.filter((v) => can(p, v));
    const bound = mine.find((v) => hasControl(p.layout, v));
    return { hasSkill: mine.length > 0, hasControl: !!bound, action: bound || mine[0] || "shoot" };
  }

  function updateHints(p) {
    if (p.bot) return;
    const busy = p.dead || p.landingFor > 0 || p.takeoffFor > 0;
    let sent = false;
    for (const gate of GATES) {
      const open = gateOpen(gate) && p.mode === GATE_MODE[gate];
      if (open && !busy && atGate(p, gate)) p.hints[gate] = true;
      const toast = hints.update(p.name, { gate, active: open && !busy && !!p.hints[gate], ...gateNeeds(p, gate), assists: assists(), layout: p.layout || DEFAULT_LAYOUT });
      if (toast && toast.ghost) for (const k of ["x", "y", "w", "h"]) toast.ghost[k] = Math.round(toast.ghost[k] * 1000) / 1000;
      if (toast) { send(toast); sent = true; }
    }
    // One message per player per step: a ladder toast this step means the late card waits for a later one.
    if (assists() && !busy && !sent) lateHint(p);
  }

  // v1.4 late hints (owner, 10 Oct 09:05: no free skills at 3:00). From 3:00 every human still missing what the gate
  // ahead of them needs gets one big card per gate and need (rules.js lateHint): "DRAW A SHOVEL" (the part, on the
  // explorer) or "DRAW A DIG BUTTON" (the controller, with the ghost box). The gate ahead is the one open in the
  // player's world: in space the weapon while the boss lives, then LAND; on the island DIG and DRILL while such a chest
  // is closed (both parts missing: one card, one redraw). The part comes before the button. Never while the draw sheet
  // is open, nor with no drawing left for that world (a redraw or an added button costs one); at most one card per
  // LATE_HINT_GAP seconds; never the answer the hint ladder already gave, and the ladder never repeats a card's
  // (rules.js gaveAnswer / answered). Nothing is granted.
  function lateHint(p) {
    if (p.drawingUntil > S.t || S.t - (p.lateAt ?? -Infinity) < LATE_HINT_GAP) return;
    if (budget.left(p.name)[p.mode === "planet" ? "planet" : "space"] <= 0) return;
    const late = p.late || (p.late = {});
    const ahead = [];
    for (const gate of GATES) {
      if (p.mode !== GATE_MODE[gate] || !gateOpen(gate)) continue;
      const n = gateNeeds(p, gate);
      const need = !n.hasSkill ? "part" : !n.hasControl ? "button" : null;
      if (!need || late[`${gate}:${need}`]) continue;
      // The ladder already gave this answer ("Draw ...", the phone's big card): no second card for it.
      if (hints.gaveAnswer(p.name, gate, need)) { late[`${gate}:${need}`] = true; continue; }
      ahead.push({ gate, need, action: n.action });
    }
    const parts = ahead.filter((a) => a.need === "part");
    const first = parts[0] || ahead[0];
    if (!first) return;
    const also = first.need === "part" ? parts.slice(1).map((a) => a.gate) : [];
    // The card is the answer for every gate on it: the ladder says nothing more about them this round.
    for (const gate of [first.gate, ...also]) { late[`${gate}:${first.need}`] = true; hints.answered(p.name, gate, first.need); }
    p.lateAt = S.t;
    const toast = Rules.lateHint(p.name, { gate: first.gate, also, need: first.need, layout: p.layout || DEFAULT_LAYOUT, action: first.action, label: Verbs.labelOf(first.action) });
    if (!toast) return;
    if (toast.ghost) for (const k of ["x", "y", "w", "h"]) toast.ghost[k] = Math.round(toast.ghost[k] * 1000) / 1000;
    send(toast);
  }

  // ---- Bots: fillers, not players (PLAN.md section 0) ---------------------------------------------------------------
  // They fly to the boss and make attack runs at it, firing whenever it is in range and in front of them, and clear the
  // rocks in their way. They never start a fight with a human: they only shoot back at a human who hit them in the last
  // BOT_REVENGE_SECONDS (canHurt lets those bullets through). Once the boss is down they patrol around the planet;
  // they never land and never take a chest.

  // Would a shot fired now along `forward` hit a sphere (centre c, radius r) within the bullet's range?
  function onLine(p, forward, c, r) {
    const v = sub(c, p.pos), along = dot(v, forward);
    if (along <= 0 || along - r > BOT_RANGE) return false;
    return len(add(v, forward, -along)) < r;
  }

  // The human this bot is paying back: the latest one to hit it within BOT_REVENGE_SECONDS, alive and in its world.
  function revengeTarget(p) {
    let best = null, at = -Infinity;
    for (const name in p.hitBy) {
      const q = players[name];
      if (!q || q.dead || q.mode !== p.mode || !grudge(p, q) || p.hitBy[name] <= at) continue;
      best = q; at = p.hitBy[name];
    }
    return best;
  }

  // An attack run: in toward the boss (firing) until 38 to 60 m off its surface (each bot its own), then out to a point
  // 120 to 175 m beside it, then in again, so the swarm spreads around the boss instead of queueing on one line.
  function attackRun(p, dt) {
    const rel = sub(p.pos, boss.pos), surface = len(rel) - boss.radius;
    const run = p.run || (p.run = { leg: "in", t: 0 });
    run.t += dt;
    if (run.leg === "in" && surface < 38 + (p.botSeed % 1) * 22) {
      const out = norm(rel);
      let side = norm({ x: rand(-1, 1), y: rand(-0.4, 0.4), z: rand(-1, 1) });
      side = norm(add(side, out, -dot(side, out)));
      Object.assign(run, { leg: "out", t: 0, to: add(boss.pos, norm(add(out, side, 1.6)), boss.radius + rand(120, 175)) });
    } else if (run.leg === "out" && (dist(p.pos, run.to) < 25 || run.t > 12)) Object.assign(run, { leg: "in", t: 0 });
    return run.leg === "in" ? boss.pos : run.to;
  }

  function botThink(p, dt) {
    p.keys = { boost: false, shoot: false };
    if (p.dead || p.mode !== "space") { p.axes.steer = { x: 0, y: 0 }; return; }
    const { forward } = basis(p.yaw, p.pitch);
    const foe = revengeTarget(p);
    let aim, far = 0;
    if (foe) {
      // Shoot back, leading the target by the bullet's flight time.
      const t = dist(p.pos, foe.pos) / VERB.shoot.speed;
      aim = add(foe.pos, foe.vel || v3(), t);
      far = dist(p.pos, foe.pos) - 120;
      p.keys.shoot = onLine(p, forward, aim, SHIP_RADIUS + 1.5);
    } else if (!boss.dead) {
      const surface = dist(p.pos, boss.pos) - boss.radius;
      if (surface > BOT_ENGAGE) { aim = boss.pos; far = surface - BOT_ENGAGE; p.run = null; }
      else aim = attackRun(p, dt);
    } else {
      // Patrol a ring around the planet (or where it will be), each bot at its own height and pace.
      const goal = planet || planetAt;
      const ang = S.t * 0.15 + p.botSeed;
      aim = add(goal, { x: Math.cos(ang) * 110, y: Math.sin(ang * 0.7 + p.botSeed) * 30, z: Math.sin(ang) * 110 });
      far = dist(p.pos, goal) - 200;
    }
    steerToward(p, aim);
    // Fire at the boss whenever a shot would hit it, and at any rock in the way (it would hit the ship otherwise).
    if (!p.keys.shoot && !boss.dead && onLine(p, forward, boss.pos, boss.radius)) p.keys.shoot = true;
    const rockAhead = rocks.some((r) => dist(r.pos, p.pos) < 110 && onLine(p, forward, r.pos, r.size + SHIP_RADIUS));
    if (rockAhead) p.keys.shoot = true;
    // Boost in whole bursts (full tank to empty, then a full recharge) so the engine flame does not flicker.
    p.botBoost = far > 60 && !rockAhead && (p.botBoost ? p.boostEnergy > 0 && !p.boostLocked : p.boostEnergy > 0.95);
    p.keys.boost = p.botBoost;
  }

  function steerToward(p, aim) {
    const v = sub(aim, p.pos);
    const yaw = Math.atan2(-v.x, -v.z), pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    p.axes.steer = { x: clamp(-wrap(yaw - p.yaw) * 2, -1, 1), y: clamp((pitch - p.pitch) * 2, -1, 1) };
  }

  // ---- Step ----------------------------------------------------------------------------------------------------

  function step(dt = 1 / Contract.SIM_HZ) {
    S.t += dt; S.phaseT += dt;
    const list = active();
    if (S.phase === "lobby") {
      for (const p of list) p.pressed = [];
      if (autostartSeconds != null && S.phaseT >= autostartSeconds) start();
    } else if (S.phase === "countdown") {
      for (const p of list) p.pressed = [];
      if (S.phaseT >= (Number(ROUND.countdownSeconds) || 0)) { go(); sendWorld(); }
    } else if (S.phase === "scoreboard") {
      for (const p of list) p.pressed = [];
      if (S.phaseT >= ROUND.scoreboardSeconds) newRound();
    } else {
      S.playT += dt;
      if (S.phase === "playing" && S.playT >= ROUND.assistsAt) startAssists();
      simulate(list, dt);
      if (S.phase !== "scoreboard" && S.playT >= ROUND.maxSeconds) endRound("time");
    }
    const revealed = revealedTo().join(",");
    if (revealed !== lastRevealed) { lastRevealed = revealed; worldDirty = true; }
    if (worldDirty && S.t - lastWorldAt >= WORLD_SEND_SECONDS) sendWorld();
  }

  function simulate(list, dt) {
    for (const p of list) {
      for (const k of Object.keys(p.cd)) p.cd[k] = Math.max(0, p.cd[k] - dt);
      p.invisibleFor = Math.max(0, p.invisibleFor - dt);
      p.empFor = Math.max(0, p.empFor - dt); p.inkFor = Math.max(0, p.inkFor - dt);
      if (p.tractor && p.tractor.until + 0.5 <= S.t) p.tractor = null;
      p.spawnShield = Math.max(0, p.spawnShield - dt);
      if (p.dead) {
        p.pressed = []; p.drilling = false; p.digging = false;
        p.deadFor += dt;
        if (p.deadFor >= T.respawnSeconds) respawn(p);
        continue;
      }
      // The landing / take-off shot: inputs ignored until it ends.
      if (p.landingFor > 0 || p.takeoffFor > 0) {
        p.pressed = []; p.keys = {};
        if (p.landingFor > 0 && (p.landingFor -= dt) <= 1e-9) touchdown(p);
        else if (p.takeoffFor > 0 && (p.takeoffFor -= dt) <= 1e-9) liftoff(p);
        continue;
      }
      if (p.bot) botThink(p, dt);
      const presses = p.pressed; p.pressed = [];
      if (p.spawnShield > 0 && (presses.length || inputOn(p))) p.spawnShield = 0; // moved or used a skill
      for (const verb of presses) if (S.phase !== "scoreboard") press(p, verb);
      if (S.phase === "scoreboard") return;
      if (p.landingFor > 0 || p.takeoffFor > 0) continue;
      if (p.mode === "space") { moveShip(p, dt); fire(p, dt); p.drilling = false; p.digging = false; } // no drill in space (v1.2)
      else { moveWalker(p, dt); fire(p, dt); drillRock(p, dt); dig(p, dt); pickup(p); if (S.phase === "scoreboard") return; }
    }
    updateBullets(dt);
    updateBoss(dt);
    updateMines();
    updateDecoys(dt);
    for (const p of list) rockCollisions(p);
    flares = flares.filter((f) => f.until > S.t);
    for (const p of list) updateHints(p);
  }

  // ---- Messages ------------------------------------------------------------------------------------------------

  function revealedTo() {
    if (assists()) return active().map((p) => p.name);
    return Object.keys(revealUntil).filter((n) => revealUntil[n] > S.t);
  }

  // entities: true (the default, used on connect) adds every player's entity so late screens get them.
  function worldMessage({ entities = true } = {}) {
    const m = {
      type: "world", round: S.round, seed: S.seed, radius: T.worldRadius,
      rocks: rocks.map((r) => [r.id, r2(r.pos.x), r2(r.pos.y), r2(r.pos.z), r2(r.size), ROCK_TYPE_NAMES.indexOf(r.type), r.health]),
      nebula: { x: r2(nebula.x), y: r2(nebula.y), z: r2(nebula.z), radius: nebula.radius },
      targets: [{ id: boss.id, kind: "boss", x: r2(boss.pos.x), y: r2(boss.pos.y), z: r2(boss.pos.z), radius: boss.radius, armour: 0, hp: Math.round(boss.hp), maxHp: boss.maxHp, cracked: true, dead: boss.dead }],
      revealedTo: revealedTo(),
      planet: planet && { x: r2(planet.x), y: r2(planet.y), z: r2(planet.z), radius: planet.radius, landRange: planet.landRange },
      island: { seed: island.seed, size: island.size, landing: { x: r2(landing.x), z: r2(landing.z) }, parked },
      chests: chests.map((c) => ({ id: c.id, kind: c.kind, x: r2(c.x), z: r2(c.z), buried: c.buried, dug: r2(c.dug), open: c.open, by: c.by })),
      assists: S.assists, playerCount: S.playerCount, result: S.result,
      leaderboard: leaderboard(),
      phase: S.phase, ...countdownField(), // v1.4: a screen that connects mid-countdown counts down at once
    };
    if (entities) m.entities = Object.fromEntries(ordered().filter((p) => p.entity).map((p) => [p.name, p.entity]));
    return m;
  }

  // The session leaderboard: stars (rounds won), then total points; players still here only.
  function leaderboard() {
    // v1.3: humans first (bots are fillers), each group by stars, then points.
    return active().map((p) => ({ name: p.name, bot: !!p.bot, stars: (session[p.name] || {}).stars || 0, total: (session[p.name] || {}).total || 0 }))
      .sort((a, b) => a.bot - b.bot || b.stars - a.stars || b.total - a.total).map(({ bot, ...row }) => row);
  }

  // v1.4: the 3-2-1 after START as whole seconds left (3, then 2, then 1; GO at 0), only in phase "countdown" (the
  // field is absent otherwise, keeping ticks small). clock() keeps the exact seconds left.
  function countdownField() {
    if (S.phase !== "countdown") return {};
    return { countdown: Math.max(1, Math.ceil((Number(ROUND.countdownSeconds) || 0) - S.phaseT - 1e-9)) };
  }

  function clock() {
    if (S.phase === "lobby") return autostartSeconds == null ? 0 : r2(Math.max(0, autostartSeconds - S.phaseT));
    if (S.phase === "scoreboard") return r2(Math.max(0, ROUND.scoreboardSeconds - S.phaseT));
    if (S.phase === "countdown") return r2(Math.max(0, (Number(ROUND.countdownSeconds) || 0) - S.phaseT));
    return r2(S.playT);
  }

  // Only the flags that are on, to keep ticks small: a missing flag means false.
  function flags(p) {
    const all = {
      boost: p.boosting, shield: p.shielding, stun: p.stun > 0, dead: p.dead, invisible: p.invisibleFor > 0, drilling: p.drilling, digging: p.digging, ready: p.ready && S.phase === "lobby", bot: p.bot,
      landing: p.landingFor > 0, takingOff: p.takeoffFor > 0, spawnShield: p.spawnShield > 0,
      emp: p.empFor > 0, inked: p.inkFor > 0, tractored: !!(p.tractor && p.tractor.until > S.t), drawing: p.drawingUntil > S.t,
    };
    const out = {};
    for (const k in all) if (all[k]) out[k] = true;
    return out;
  }

  function tickMessage() {
    return {
      type: "tick", t: Date.now(), round: S.round, phase: S.phase, clock: clock(),
      left: S.phase === "playing" || S.phase === "assists" ? r2(Math.max(0, ROUND.maxSeconds - S.playT)) : 0,
      ...countdownField(),
      players: ordered().map((p) => { // humans first, then bots
        const out = {
          name: p.name, color: p.color, mode: p.mode, x: r1(p.pos.x), y: r1(p.pos.y), z: r1(p.pos.z),
          yaw: r2(p.yaw), pitch: r2(p.pitch), roll: r2(p.roll || 0), hp: Math.round(p.hp), score: p.score,
          shieldEnergy: r2(p.shieldEnergy), boostEnergy: r2(p.boostEnergy),
          flags: flags(p),
        };
        // 25 players must fit in 8 KB: the last verb only once there is one (render reads startedAt || 0).
        if (p.action) Object.assign(out, { action: p.action, slot: p.slot, startedAt: p.startedAt });
        if (!p.bot) out.drawingsLeft = budget.left(p.name); // bots never draw: keeps the tick small
        if (p.dead) out.respawnIn = r2(Math.max(0, T.respawnSeconds - p.deadFor));
        // The landing / take-off shot ends on this bay (island x, z): the same slot the server parks the ship in.
        if ((p.landingFor > 0 || p.takeoffFor > 0) && landing) { const b = bay(p); out.bay = [r1(b.x), r1(b.z)]; } // = its parked entry
        return out;
      }),
      bullets: bullets.slice(-TICK_MAX_BULLETS).map((b) => [b.id, r1(b.pos.x), r1(b.pos.y), r1(b.pos.z), b.color, b.mode === "planet" ? 1 : 0]),
      bossShots: bossShots.map((s) => [s.id, r1(s.pos.x), r1(s.pos.y), r1(s.pos.z)]),
      flares: flares.slice(-TICK_MAX_PROPS).map((f) => [r1(f.pos.x), r1(f.pos.y), r1(f.pos.z), f.radius, r1(f.until - S.t)]),
      mines: mines.slice(-TICK_MAX_PROPS).map((m) => [m.id, r1(m.pos.x), r1(m.pos.y), r1(m.pos.z), m.mode === "planet" ? 1 : 0, m.color]),
      decoys: decoys.slice(-TICK_MAX_PROPS).map((d) => [d.id, r1(d.pos.x), r1(d.pos.y), r1(d.pos.z), r2(d.yaw), d.color, d.owner, d.mode === "planet" ? 1 : 0]),
    };
  }

  // A bug in one step must not stop the game (or the server): log it, at most once per message per 10 s, and go on.
  const errorsAt = new Map();
  function safeStep(dt) {
    try { step(dt); } catch (err) {
      const key = String(err && err.message);
      if (Date.now() - (errorsAt.get(key) || 0) > 10000) { errorsAt.set(key, Date.now()); console.log(`world step failed: ${(err && err.stack) || err}`); }
    }
  }

  newRound();
  if (autoStart) setInterval(() => safeStep(1 / Contract.SIM_HZ), 1000 / Contract.SIM_HZ);

  return {
    handleInput, setLayout, layoutOf, setEntity, start, step, safeStep, worldMessage, tickMessage, addBot, join, players,
    budget, drawingWorld, drawingsLeft, spendDrawing, hints,
    // v1.4: true when that player holds a seat now (an existing human back after INACTIVE_MS takes one, a bot leaving
    // for them if needed); false when unknown or the round is full of active humans (server.js: "the game is full").
    seat: (name) => !!getPlayer(name, false, { create: false }),
    get phase() { return S.phase; },
    get round() { return S.round; },
    get countdown() { return countdownField().countdown; }, // v1.4: whole seconds left in phase "countdown", else undefined
    debug: () => ({ ...S, boss, planet, landing, chests, island, parked, rocks, bullets, bossShots, mines, decoys }),
  };
}

module.exports = { createWorld, ghostBox, hasControl, mergeLayout, withSteer, chestCount, bossHp, DEFAULT_LAYOUT, VERB };
