// Authoritative simulation (PLAN.md sections 4 and 5): round clock, flight, rocks, the boss, the planet and the island.
// Every screen and phone only renders what this sends. Distances and rates come from contract.js (TUNING), verb
// settings from verbs.js defaults.
// v1.1 (PLAN.md section 0): the host starts the round (start()); it ends at 4:00 or when every chest is open, and most
// points wins (a star on the session leaderboard). An entity can only use the skills drawn on it (Verbs.entityVerbs);
// gates: a weapon for the boss, LAND for the planet, DIG (buried chests) and DRILL (chests inside rocks).
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
const SPAWN_SHIELD_SECONDS = 2;
const BOT_FIRE_COOLDOWN = 0.5;
const ROCK_WEIGHTS = { stone: 6, iron: 2, volatile: 1, crystal: 1, magnet: 1, splitter: 1 };
const INACTIVE_MS = 10 * 60 * 1000;
const TICK_MAX_BULLETS = 30; // the newest ones; keeps a tick under 8 KB with 25 players
const PARKED_RADIUS = 2.5;

// Every verb's numbers in one place.
const VERB = {
  shoot: { cooldown: T.fireCooldown, damage: T.bulletDamage, speed: T.bulletSpeed, life: T.bulletLife },
  blast: { ...Verbs.clampParams("blast", {}), coneCos: Math.cos(0.6) }, // range 60, damage 50, cooldown 12
  flare: { seconds: T.flare.seconds, radius: T.flare.radius },
  scan: { range: T.scan.range, seconds: T.scan.seconds },
  invisible: Verbs.clampParams("invisible", {}), // duration 6, cooldown 15
  teleport: Verbs.clampParams("teleport", {}), // distance 40, cooldown 6
  heal: Verbs.clampParams("heal", {}), // amount 30, cooldown 10
  jump: { speed: ISL.jumpSpeed, dash: 12, cooldown: 1 }, // a jump on the island, a quick dash in space
  drill: { range: T.boss.drillRange, perSecond: T.boss.drillPerSecond, seconds: ISL.drillSeconds },
  dig: { seconds: ISL.digSeconds, range: ISL.pickupRange },
};
const HOLD = ["shoot", "boost", "shield", "drill", "dig"];
const PRESS = ["blast", "flare", "scan", "land", "takeoff", "jump", "invisible", "teleport", "heal", "drive"];
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
const GHOST = { w: 0.22, h: 0.18, scales: [1.4, 1.2, 1, 0.8, 0.6], step: 0.02, margin: 0.03, pad: 0.02 };

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

const hasControl = (layout, verb) => (layout || DEFAULT_LAYOUT).buttons.some((b) => Contract.normaliseAction(b.action) === verb);

// The chest count for a round: scales with the players at START so 25 can open them all in about 3:00.
const chestCount = (players) => clamp(ISL.chestsBase + Math.ceil(Math.max(1, players) * ISL.chestsPerPlayer), 3, ISL.chestsMax);
const bossHp = (players) => Math.round(T.boss.hp * (1 + T.boss.hpPerExtraPlayer * (Math.max(1, players) - 1)));

// The largest box that fits on the pad without touching any control, farthest from the others (PLAN.md section 4, Hints).
function ghostBox(layout, action) {
  const rects = (layout || DEFAULT_LAYOUT).buttons;
  const gap = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  for (const s of GHOST.scales) {
    const w = GHOST.w * s, h = GHOST.h * s;
    let best = null;
    for (let y = GHOST.margin; y + h <= 1 - GHOST.margin + 1e-9; y += GHOST.step) {
      for (let x = GHOST.margin; x + w <= 1 - GHOST.margin + 1e-9; x += GHOST.step) {
        const box = { x, y, w, h };
        const clearance = rects.length ? Math.min(...rects.map((r) => gap(box, r))) : 1;
        if (clearance >= GHOST.pad && (!best || clearance > best.clearance)) best = { ...box, clearance };
      }
    }
    if (best) return { action, x: r2(best.x), y: r2(best.y), w: r2(best.w), h: r2(best.h) };
  }
  return { action, x: 0.39, y: 0.05, w: 0.22, h: 0.18 };
}

// wireAnimations(type, verbs) → anims (astra.js), optional: called on every entity switch.
// autostartSeconds: the lobby starts by itself after that many seconds (null: only start(), the host's START button).
function createWorld({ broadcast = () => {}, random = Math.random, autoStart = false, wireAnimations = null, autostartSeconds = ROUND.autostartSeconds } = {}) {
  const players = {};
  // Hints run on the simulation clock so fast-forward tests see the same ladder as a live round.
  const hints = Rules.createHints({ now: () => Math.round(S.t * 1000) });
  const budget = Rules.createBudget();
  const rand = (min, max) => min + random() * (max - min);
  const S = { round: 0, phase: "lobby", phaseT: 0, playT: 0, t: 0, seed: 1, playerCount: 1, assists: false, result: null };
  const session = {}; // name → { stars, total }: the evening's leaderboard
  let rocks = [], bullets = [], bossShots = [], flares = [];
  let boss, planet, planetAt, nebula, island, landing, chests, parked = [], revealUntil = {};
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

  // Rocks keep clear of spawn, the boss and the planet that will appear.
  function rockPlaceOk(pos, size) {
    if (len(pos) < 60 + size) return false;
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

  function buildIsland(count = chestCount(S.playerCount)) {
    island = { seed: Math.floor(rand(1, 100000)), size: Terrain.ISLAND_SIZE };
    // Landing spot: dry and low enough near the middle, with room for the chests around it.
    let spot = null;
    for (let r = 20; !spot && r < 160; r += 10) {
      for (let a = 0; a < 12 && !spot; a++) {
        const ang = rand(0, Math.PI * 2);
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r, h = Terrain.height(x, z, island.seed);
        if (h > 0.8 && h < 16 && placeChests(x, z, count)) spot = { x, z };
      }
    }
    if (!spot) { spot = { x: 0, z: 0 }; placeChests(0, 0, count, true); }
    landing = { x: spot.x, z: spot.z };
  }

  // Two kinds, alternating: buried (DIG it out, an X on the sand) and inside a rock (DRILL it open).
  function placeChests(lx, lz, count, force = false) {
    const list = [];
    const spread = ISL.chestSpread + ISL.chestSpreadPerChest * count;
    for (let i = 0; i < 40 * count && list.length < count; i++) {
      const ang = rand(0, Math.PI * 2), d = rand(12, spread);
      const x = lx + Math.cos(ang) * d, z = lz + Math.sin(ang) * d;
      if ((force || dry(x, z)) && list.every((c) => Math.hypot(c.x - x, c.z - z) > 8)) {
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
    boss = { id: 1, pos: bossPos, radius: T.boss.radius, armour: 0, hp, maxHp: hp, dead: false, shotCd: T.boss.shotEverySeconds, drillFx: 0, damageBy: {} };
    nebula = { ...bossPos, radius: T.nebula.radius };
    // The planet lies beyond the boss, on the line from spawn: fly past the boss to reach it.
    planetAt = add(bossPos, norm(bossPos), T.planet.offset);
    planet = null;
    rocks = Array.from({ length: T.rockCount }, () => spawnRock());
    bullets = []; bossShots = []; flares = []; revealUntil = {};
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
    const extra = S.assists ? Verbs.GATE_SKILLS[world] : [];
    const verbs = Verbs.entityVerbs(type, own, extra);
    const entity = {
      type, rig: Verbs.RIG_OF[type] || "blob", verbs, unlocked, parts: drawn ? drawn.parts : [],
      source: drawn ? drawn.source : p.bot ? "bot" : "plain",
    };
    const assisted = extra.filter((v) => verbs.includes(v) && !own.includes(v));
    if (assisted.length) entity.assisted = assisted;
    const key = `${entity.rig}:${verbs.join(",")}`;
    if (animCache[key]) entity.anims = animCache[key];
    else if (typeof wireAnimations === "function") {
      try { const anims = wireAnimations(entity.rig, verbs); if (anims) entity.anims = animCache[key] = anims; } catch {}
    }
    return entity;
  }

  const sameEntity = (a, b) => a && b && a.type === b.type && a.source === b.source && a.verbs.join() === b.verbs.join() && JSON.stringify(a.unlocked) === JSON.stringify(b.unlocked);

  // Every mode switch, redraw and unlock (and the first spawn) tells every screen which entity the player now drives.
  function setMode(p, mode, force = false) {
    if (p.mode === mode && p.entity && !force) return;
    const next = entityOf(p, mode);
    if (p.mode === mode && sameEntity(p.entity, next)) return;
    p.mode = mode;
    p.entity = next;
    send({ type: "entity", player: p.name, entity: p.entity });
  }
  const can = (p, verb) => !!p.entity && p.entity.verbs.includes(verb);

  const slotOf = (p) => Math.max(0, Object.keys(players).indexOf(p.name));

  // A 5 × 5 grid (25 players), facing the boss.
  function spawnAt(p) {
    const i = slotOf(p);
    setMode(p, "space");
    p.pos = { x: ((i % 5) - 2) * T.spawnSpacing, y: (Math.floor(i / 5) % 5 - 2) * T.spawnSpacing * 0.6, z: Math.floor(i / 25) * T.spawnSpacing };
    p.yaw = boss ? Math.atan2(-boss.pos.x, -boss.pos.z) : 0;
    p.pitch = 0; p.roll = 0; p.vy = 0;
    p.hp = T.shipHp; p.stun = 0; p.dead = false; p.deadFor = 0;
    p.landingFor = 0; p.takeoffFor = 0; p.spawnShield = 0;
  }

  // Each player has a parking bay on the landing pad; the explorer stands beside the parked ship.
  function bay(p) {
    const i = slotOf(p);
    return { x: landing.x + (i % 5) * 5 - 10, z: landing.z + Math.floor(i / 5) * 5 };
  }
  function standBeside(p) {
    const b = bay(p);
    const x = b.x + 2.5, z = b.z;
    p.pos = { x, y: islandFeet(x, z), z };
    p.yaw = 0; p.pitch = 0; p.roll = 0; p.vy = 0; p.stun = 0;
  }

  // Death respawn: in space where the ship died but out of the boss's reach (no minute-long flight back), on the island
  // beside the parked ship; full health and a short spawn shield.
  function respawn(p) {
    if (p.mode === "planet") standBeside(p);
    else {
      const at = { ...p.pos };
      spawnAt(p);
      if (boss && !boss.dead && dist(at, boss.pos) < T.boss.respawnDistance) p.pos = add(boss.pos, norm(dist(at, boss.pos) > 1 ? sub(at, boss.pos) : v3(0, 0, 1)), T.boss.respawnDistance);
      else p.pos = at;
      const goal = boss.dead && planet ? planet : boss.pos;
      p.yaw = Math.atan2(-(goal.x - p.pos.x), -(goal.z - p.pos.z));
    }
    p.hp = T.shipHp; p.dead = false; p.deadFor = 0;
    p.spawnShield = SPAWN_SHIELD_SECONDS;
    fx("respawn", p.pos, p.color, 3, p.mode);
  }

  function getPlayer(name, bot = false) {
    name = Contract.cleanName(name);
    if (!name) return null;
    if (!players[name]) {
      const p = {
        name, bot, color: COLORS[Object.keys(players).length % COLORS.length], score: 0, keys: {}, axes: {}, pressed: [],
        shieldEnergy: 1, boostEnergy: 1, boostLocked: false, shieldLocked: false, cd: {}, fireCd: 0,
        invisibleFor: 0, ready: bot, layout: null, hints: {}, action: "", slot: "", startedAt: 0, mode: null, entity: null,
        drilling: false, digging: false, boosting: false, shielding: false, botFire: 0, botSeed: random() * 100,
        drawn: { space: null, planet: null }, refusedAt: {}, lastChest: null,
      };
      players[name] = p;
      spawnAt(p);
    }
    players[name].lastSeen = Date.now();
    return players[name];
  }

  const join = (name) => { const p = getPlayer(name); return p && { player: p.name, color: p.color }; };
  const addBot = (name) => getPlayer(name, true);

  function handleInput(msg) {
    const p = msg && getPlayer(msg.player);
    if (!p) return;
    if (msg.type === "axis" && Contract.STICKS.includes(msg.axis)) {
      p.axes[msg.axis] = { x: clamp(Number(msg.x) || 0, -1, 1), y: clamp(Number(msg.y) || 0, -1, 1) };
      return;
    }
    if (msg.type !== "input") return;
    const action = Contract.normaliseAction(msg.action);
    const down = !!msg.down;
    if (action === "ready") { if (down) p.ready = true; return; }
    if (p.landingFor > 0 || p.takeoffFor > 0) return; // the landing / take-off shot plays without control
    if (Contract.MOVES.includes(action)) { p.keys[action] = down; return; }
    if (!V1_VERBS.has(action)) return;
    if (!down) { p.keys[action] = false; return; }
    if (!can(p, action)) { refuse(p, action); return; }
    p.keys[action] = down;
    if (down) {
      if (PRESS.includes(action)) p.pressed.push(action);
      p.action = action;
      p.slot = (Verbs.VERBS[action] && Verbs.VERBS[action].slot) || "use";
      p.startedAt = Date.now();
    }
  }

  // A verb the entity has not unlocked: a toast explains what to draw, at most once per refusalToastSeconds per verb.
  function refuse(p, verb) {
    if (p.bot || S.t - (p.refusedAt[verb] ?? -Infinity) < T.refusalToastSeconds) return;
    p.refusedAt[verb] = S.t;
    const type = p.entity ? p.entity.type : "ship";
    const what = type === "ship" ? "ship" : "explorer";
    const world = Verbs.worldOf(type);
    let text;
    if (verb === "jump" && (type === "car" || type === "bike")) text = `JUMP · ${type}s can't jump`;
    else if (verb === "takeoff" || (Verbs.VERBS[verb] && !Verbs.VERBS[verb].modes.includes(world))) text = `${verb.toUpperCase()} · not here: ${world === "space" ? "only on the planet" : "only in space"}`;
    else if (verb === "drive") text = "DRIVE · draw a car or a bike as your explorer";
    else text = `${verb.toUpperCase()} · draw ${Verbs.PARTS[verb] || "it"} on your ${what}`;
    send({ type: "toast", player: p.name, kind: "refused", verb, text, sketch: null, ghost: null });
  }

  // A finished ship / explorer drawing (Astra's entity: type, unlocked, parts, source). Full redraws only: it replaces
  // that world's entity. A new ship also repairs a wrecked parked ship (that is how a wreck is fixed).
  function setEntity(name, kind, entity) {
    const p = getPlayer(name);
    if (!p || !entity) return null;
    const world = kind === "ship" ? "space" : "planet";
    const type = world === "space" ? "ship" : Verbs.PLANET_TYPES.includes(entity.type) ? entity.type : "person";
    const skills = Verbs.SKILLS[world];
    const unlocked = (Array.isArray(entity.unlocked) ? entity.unlocked : []).filter((u) => u && skills.includes(u.verb)).map((u) => ({ verb: u.verb, part: String(u.part || "drawing") }));
    p.drawn[world] = { type, unlocked, parts: Array.isArray(entity.parts) ? entity.parts.slice(0, 12) : [], source: entity.source || "model" };
    if (world === "space") {
      const car = parked.find((x) => x.player === p.name);
      if (car && car.wrecked) { car.wrecked = false; car.hp = car.maxHp; announce(`${p.name} rebuilt their ship`); sendWorld(); }
    }
    if (p.mode === (world === "space" ? "space" : "planet")) setMode(p, p.mode, true);
    return p.entity;
  }

  // kind "button" adds the new controls to the current layout, replacing any with the same action (as the phone
  // does); anything else replaces the whole layout.
  function setLayout(name, layout, kind = "controller") {
    const p = getPlayer(name);
    if (!p || !layout || !Array.isArray(layout.buttons)) return;
    if (kind === "button") {
      const fresh = layout.buttons.map((b) => ({ ...b, action: Contract.normaliseAction(b.action) }));
      const old = (p.layout || DEFAULT_LAYOUT).buttons.filter((b) => !fresh.some((f) => f.action === Contract.normaliseAction(b.action)));
      p.layout = { buttons: [...old, ...fresh].slice(-16), source: layout.source || "model" };
    } else {
      p.layout = { buttons: layout.buttons.slice(0, 16), source: layout.source || "model" };
    }
  }

  // Drawing budget (rules.js): lobby and space drawings count toward "space", island ones toward "planet".
  const drawingWorld = (name) => { const p = players[Contract.cleanName(name)]; return p && p.mode === "planet" ? "planet" : "space"; };
  const drawingsLeft = (name) => budget.left(Contract.cleanName(name));
  const spendDrawing = (name, world = drawingWorld(name)) => budget.spend(Contract.cleanName(name), world);

  // ---- Round clock ---------------------------------------------------------------------------------------------

  // The lobby: players join and draw; the host presses START (start()). Players, drawings and layouts are kept.
  function newRound() {
    S.round++; S.phase = "lobby"; S.phaseT = 0; S.playT = 0; S.assists = false; S.result = null;
    S.playerCount = Math.max(1, active().length);
    buildWorld();
    hints.reset(); budget.reset(); parked = [];
    for (const p of Object.values(players)) {
      spawnAt(p);
      Object.assign(p, { ready: p.bot, hints: {}, keys: {}, pressed: [], cd: {}, invisibleFor: 0, shieldEnergy: 1, boostEnergy: 1, boostLocked: false, shieldLocked: false, lastChest: null, refusedAt: {} });
      setMode(p, "space", true); // assists from the last round are gone
    }
    sendWorld();
  }

  // START: the boss's HP and the chest count scale with the players in the round now.
  function start() {
    if (S.phase !== "lobby") return false;
    S.playerCount = Math.max(1, active().length);
    const hp = bossHp(S.playerCount);
    Object.assign(boss, { hp, maxHp: hp });
    buildIsland(chestCount(S.playerCount));
    S.phase = "playing"; S.phaseT = 0; S.playT = 0;
    for (const p of Object.values(players)) { spawnAt(p); p.pressed = []; p.score = 0; p.lastChest = null; }
    announce(`Round ${S.round}: ${Contract.OBJECTIVES.boss}`, true);
    sendWorld();
    return true;
  }

  // 3:00: the gate skills unlock for everyone still missing them and the chests glow (world.assists).
  function startAssists() {
    S.phase = "assists"; S.assists = true;
    for (const p of active()) setMode(p, p.mode, true);
    announce("Assists on: every gate skill is unlocked and the chests glow!", true);
    sendWorld();
  }

  // 4:00, or every chest open: most points wins and earns a star; ties go to whoever got there first (join order).
  function endRound(reason) {
    S.phase = "scoreboard"; S.phaseT = 0;
    const list = active();
    const scores = list.map((p) => [p.name, p.score]).sort((a, b) => b[1] - a[1]);
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
    if (p.stun > 0) { p.stun -= dt; return; }
    const s = controls(p);
    p.yaw = wrap(p.yaw - s.turn * T.turnRate * dt);
    p.pitch = clamp(p.pitch + s.pitch * T.turnRate * dt, -T.maxPitch, T.maxPitch);
    p.roll = -clamp(s.turn + s.strafeX * 0.5, -1, 1) * 0.6;
    const { forward, right, up } = basis(p.yaw, p.pitch);
    const speed = (T.cruiseSpeed + s.thrust * T.thrustSpeed) * (p.boosting ? T.boostMultiplier : 1);
    p.pos = add(p.pos, forward, speed * dt);
    p.pos = add(p.pos, right, s.strafeX * T.strafeSpeed * dt);
    p.pos = add(p.pos, up, s.strafeY * T.strafeSpeed * dt);
    // Soft world edge: past the radius, the ship is pulled back toward the centre.
    const r = len(p.pos);
    if (r > T.worldRadius) p.pos = add(p.pos, p.pos, -(r - T.worldRadius) / r);
    if (!boss.dead) pushOut(p, boss.pos, boss.radius + SHIP_RADIUS);
    if (planet) pushOut(p, planet, planet.radius + SHIP_RADIUS);
    for (const rock of rocks) {
      const pull = ROCK_TYPES[rock.type].pullRange;
      if (pull && dist(rock.pos, p.pos) < pull) p.pos = add(p.pos, norm(sub(rock.pos, p.pos)), ROCK_TYPES[rock.type].pullSpeed * dt);
    }
  }

  // Ships shoot in space, explorers on the island (level, from chest height); a bullet only meets its own mode.
  function fire(p, dt) {
    p.fireCd = Math.max(0, p.fireCd - dt);
    if (!p.keys.shoot || p.shielding || p.fireCd > 0 || p.stun > 0) return;
    const space = p.mode === "space";
    const { forward } = basis(p.yaw, space ? p.pitch : 0);
    const from = space ? add(p.pos, forward, 3) : add(add(p.pos, v3(0, EXPLORER_CHEST, 0)), forward, 1);
    bullets.push({ id: nextId++, mode: p.mode, pos: from, dir: forward, owner: p.name, color: p.color, life: VERB.shoot.life, damage: VERB.shoot.damage });
    p.fireCd = p.bot ? BOT_FIRE_COOLDOWN : VERB.shoot.cooldown;
  }

  // DRILL in space grinds the boss (any weapon hurts it); on the planet it opens the chests locked in rocks.
  function drill(p, dt) {
    p.drilling = false;
    if (!p.keys.drill || boss.dead || p.stun > 0) return;
    if (dist(p.pos, boss.pos) - boss.radius > VERB.drill.range) return;
    p.drilling = true;
    boss.drillFx -= dt;
    if (boss.drillFx <= 0) { boss.drillFx = 0.3; fx("drill", add(boss.pos, norm(sub(p.pos, boss.pos)), boss.radius), p.color, 2); }
    hitBoss(VERB.drill.perSecond * dt, p.name, null);
  }

  function damageRock(rock, owner, amount = 1) {
    rock.health -= amount;
    worldDirty = true;
    if (rock.health > 0) { fx("spark", rock.pos, 0xd6d3d1, 1); return; }
    const type = ROCK_TYPES[rock.type];
    fx("explode", rock.pos, rock.type === "crystal" ? 0x67e8f9 : 0xa8a29e, rock.size);
    const p = players[owner];
    if (p) {
      p.score += SCORING[rock.type] != null ? SCORING[rock.type] : SCORING.rock;
      if (type.heal) p.hp = Math.min(T.shipHp, p.hp + type.heal);
    }
    rocks = rocks.filter((r) => r !== rock);
    rocks.push(spawnRock());
    if (type.blastRadius) for (const q of active()) if (q.mode === "space" && dist(q.pos, rock.pos) < type.blastRadius) hurt(q, type.blastDamage, null);
    if (type.splitInto) for (let i = 0; i < type.splitInto; i++) rocks.push(spawnRock("stone", add(rock.pos, randomPoint(rock.size, rock.size + 2)), rock.size / 2));
  }

  const invulnerable = (p) => p.landingFor > 0 || p.takeoffFor > 0 || p.spawnShield > 0;

  // PvP everywhere: ships in space, explorers on the island. Ruthless: a kill within stealSeconds of the victim
  // opening a chest steals stealShare of that chest's points.
  function hurt(p, amount, by) {
    if (p.dead || invulnerable(p)) return;
    if (p.shielding) { fx("spark", p.pos, p.color, 2, p.mode); return; }
    p.hp -= amount;
    fx("hit", p.pos, 0xf97316, 1, p.mode);
    if (p.hp > 0) return;
    p.hp = 0; p.dead = true; p.deadFor = 0; p.drilling = false; p.digging = false;
    fx("explode", p.pos, p.color, p.mode === "space" ? 8 : 3, p.mode);
    const killer = by && by !== p.name ? players[by] : null;
    p.score += SCORING.killed; // dying costs points however it happens
    if (killer) {
      killer.score += SCORING.kill;
      announce(`${killer.name} ✕ ${p.name}`);
      const chest = p.lastChest;
      if (chest && S.playT - chest.at <= T.stealSeconds) {
        const stolen = Math.round(chest.points * T.stealShare);
        killer.score += stolen; p.score -= stolen;
        announce(`💰 ${killer.name} stole ${stolen} points from ${p.name}!`);
      }
    } else announce(`${p.name} was destroyed`);
    p.lastChest = null;
  }

  // Any weapon hurts the boss. The last hit scores, whoever lands it: stealing it from the top damage dealer is allowed.
  function hitBoss(amount, owner, at) {
    if (boss.dead) return;
    boss.hp = Math.max(0, boss.hp - amount);
    if (owner) boss.damageBy[owner] = (boss.damageBy[owner] || 0) + amount;
    if (at) fx("hit", at, 0xef4444, 2);
    worldDirty = true;
    if (boss.hp > 0) return;
    boss.dead = true;
    const p = players[owner];
    if (p) p.score += SCORING.bossLastHit;
    fx("explode", boss.pos, 0xef4444, 30);
    planet = { x: planetAt.x, y: planetAt.y, z: planetAt.z, radius: T.planet.radius, landRange: T.planet.landRange };
    rocks = rocks.map((r) => (dist(r.pos, planet) < planet.radius + 10 + r.size ? spawnRock() : r));
    const top = Object.entries(boss.damageBy).sort((a, b) => b[1] - a[1])[0];
    const stole = p && top && top[0] !== p.name ? ` (stolen from ${top[0]})` : "";
    announce(`💥 ${p ? p.name : "Someone"} landed the last hit on the boss${stole}! ${Contract.OBJECTIVES.planet}`, true);
    bossShots = [];
    sendWorld();
  }

  // Parked ships on the pad can be shot by explorers (not their owner's); a wrecked one needs a new ship drawing.
  function hitParked(car, amount, by) {
    if (car.wrecked) return;
    car.hp = Math.max(0, car.hp - amount);
    const pos = { x: car.x, y: islandFeet(car.x, car.z) + 1.5, z: car.z };
    fx("hit", pos, 0xf97316, 1, "planet");
    worldDirty = true;
    if (car.hp > 0) return;
    car.wrecked = true;
    fx("explode", pos, 0xf97316, 6, "planet");
    announce(`🔧 ${by || "Someone"} wrecked ${car.player}'s ship! They must draw a new one to take off`);
    sendWorld();
  }
  const parkedHit = (from, to, owner) => parked.find((c) => c.player !== owner && !c.wrecked && segDist({ x: c.x, y: islandFeet(c.x, c.z) + 1.5, z: c.z }, from, to) < PARKED_RADIUS);

  function updateBullets(dt) {
    bullets = bullets.filter((b) => {
      const from = b.pos;
      b.pos = add(b.pos, b.dir, VERB.shoot.speed * dt);
      b.life -= dt;
      if (b.mode === "planet") {
        const hit = active().find((q) => q.name !== b.owner && q.mode === "planet" && !q.dead && segDist(add(q.pos, v3(0, EXPLORER_CHEST, 0)), from, b.pos) < EXPLORER_RADIUS + 0.3);
        if (hit) { hurt(hit, b.damage, b.owner); return false; }
        const car = parkedHit(from, b.pos, b.owner);
        if (car) { hitParked(car, b.damage, b.owner); return false; }
        if (b.pos.y < Terrain.height(b.pos.x, b.pos.z, island.seed)) return false; // into a hill
        return b.life > 0;
      }
      if (!boss.dead && dist(b.pos, boss.pos) < boss.radius + 0.5) { hitBoss(b.damage, b.owner, b.pos); return false; }
      const rock = rocks.find((r) => dist(r.pos, b.pos) < r.size + 0.5);
      if (rock) { damageRock(rock, b.owner); return false; }
      const ship = active().find((q) => q.name !== b.owner && q.mode === "space" && !q.dead && segDist(q.pos, from, b.pos) < SHIP_RADIUS + 0.5);
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
      const ship = active().find((q) => q.mode === "space" && !q.dead && dist(q.pos, s.pos) < SHIP_RADIUS + 1);
      if (ship) { hurt(ship, T.boss.shotDamage, null); return false; }
      return s.life > 0;
    });
  }

  function rockCollisions(p) {
    if (p.stun > 0 || p.dead || p.mode !== "space") return;
    const rock = rocks.find((r) => dist(r.pos, p.pos) < r.size + (p.shielding ? 4 : SHIP_RADIUS));
    if (!rock) return;
    fx("explode", rock.pos, p.shielding ? p.color : 0xf97316, rock.size);
    if (!p.shielding) { p.stun = T.stunSeconds; p.score += SCORING.hitByRock; }
    rocks = rocks.filter((r) => r !== rock);
    rocks.push(spawnRock());
    worldDirty = true;
  }

  // ---- Island --------------------------------------------------------------------------------------------------

  // Landing and take-off are predefined animations (PLAN.md, The space-to-planet transition): the player has no
  // control and cannot be hurt while flags.landing / flags.takingOff are on; render plays the shot from
  // action "land" / "takeoff" + startedAt.
  function startAnim(p, action) {
    p.keys = {}; p.axes = {}; p.pressed = [];
    p.boosting = false; p.shielding = false; p.drilling = false; p.digging = false;
    p.action = action; p.slot = (Verbs.VERBS[action] && Verbs.VERBS[action].slot) || "mount"; p.startedAt = Date.now();
  }

  function land(p) {
    if (!planet || p.mode !== "space" || p.landingFor > 0 || dist(p.pos, planet) > planet.radius + planet.landRange) return;
    startAnim(p, "land");
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
    announce(`${p.name} landed on the planet. ${Contract.OBJECTIVES.chest}`);
    sendWorld();
  }

  function takeoff(p) {
    if (p.mode !== "planet" || !planet || p.takeoffFor > 0) return;
    const car = parked.find((x) => x.player === p.name);
    if (car && car.wrecked) {
      if (S.t - (p.refusedAt.wreck ?? -Infinity) >= T.refusalToastSeconds) {
        p.refusedAt.wreck = S.t;
        send({ type: "toast", player: p.name, kind: "info", verb: "takeoff", text: "Your ship is wrecked. Draw a new ship to take off", sketch: null, ghost: null });
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
    const turn = clamp((k.right ? 1 : 0) - (k.left ? 1 : 0) + steer.x, -1, 1);
    const fwd = clamp((k.forward || k.up ? 1 : 0) - (k.back || k.down ? 1 : 0) + steer.y + move.y, -1, 1);
    const side = clamp((k.straferight ? 1 : 0) - (k.strafeleft ? 1 : 0) + move.x, -1, 1);
    p.boosting = !!k.boost;
    p.shielding = energy(p, !!k.shield, "shieldEnergy", "shieldLocked", T.shield, dt);
    p.boostEnergy = Math.min(1, p.boostEnergy + T.boost.rechargePerSecond * dt);
    p.yaw = wrap(p.yaw - turn * T.turnRate * dt);
    // Movement per entity type: a person walks, cars and bikes drive fast, a quadruped runs, a blob bounces.
    const type = p.entity ? p.entity.type : "person";
    const speed = ISL.walkSpeed * (ISL.speeds[type] || 1) * (p.boosting ? ISL.runMultiplier : 1);
    if (type === "blob" && (fwd || side) && p.pos.y <= islandFeet(p.pos.x, p.pos.z) + 0.05) p.vy = ISL.jumpSpeed * 0.45;
    const fx_ = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const nx = p.pos.x + (fx_ * fwd + rx * side) * speed * dt, nz = p.pos.z + (fz * fwd + rz * side) * speed * dt;
    if (dry(nx, nz)) { p.pos.x = nx; p.pos.z = nz; }
    else if (dry(nx, p.pos.z)) p.pos.x = nx;
    else if (dry(p.pos.x, nz)) p.pos.z = nz;
    p.vy -= ISL.gravity * dt;
    p.pos.y += p.vy * dt;
    const ground = islandFeet(p.pos.x, p.pos.z);
    if (p.pos.y <= ground) { p.pos.y = ground; p.vy = 0; }
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
    p.score += SCORING.chest;
    p.lastChest = { at: S.playT, points: SCORING.chest };
    fx("treasure", { x: chest.x, y: islandFeet(chest.x, chest.z), z: chest.z }, p.color, 20, "planet");
    announce(`💎 ${p.name} opened a chest (+${SCORING.chest})`);
    sendWorld();
    if (chests.every((c) => c.open)) endRound("chests");
  }

  // ---- Verbs that are pressed once -----------------------------------------------------------------------------

  function ready(p, verb, cooldown) {
    if ((p.cd[verb] || 0) > 0) return false;
    p.cd[verb] = cooldown;
    return true;
  }

  function press(p, verb) {
    const space = p.mode === "space";
    const mode = p.mode;
    const { forward } = basis(p.yaw, space ? p.pitch : 0);
    if (verb === "land") land(p);
    else if (verb === "takeoff") takeoff(p);
    else if (verb === "flare") {
      if (space) flares.push({ pos: { ...p.pos }, radius: VERB.flare.radius, until: S.t + VERB.flare.seconds });
      fx("flare", p.pos, 0xfff7c2, VERB.flare.radius, mode);
    } else if (verb === "scan") {
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
      if (!space) { for (const car of parked.filter((c) => c.player !== p.name && inCone({ x: c.x, y: p.pos.y, z: c.z }, PARKED_RADIUS))) hitParked(car, VERB.blast.damage, p.name); return; }
      for (const rock of rocks.filter((r) => inCone(r.pos, r.size))) damageRock(rock, p.name, rock.health);
      if (!boss.dead && inCone(boss.pos, boss.radius)) hitBoss(VERB.blast.damage, p.name, boss.pos);
    }
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
    if (gate === "land") return dist(p.pos, planet) <= planet.radius + planet.landRange;
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
    for (const gate of GATES) {
      const open = gateOpen(gate) && p.mode === GATE_MODE[gate];
      if (open && !busy && atGate(p, gate)) p.hints[gate] = true;
      const toast = hints.update(p.name, { gate, active: open && !busy && !!p.hints[gate], ...gateNeeds(p, gate), assists: assists(), layout: p.layout || DEFAULT_LAYOUT });
      if (toast && toast.ghost) for (const k of ["x", "y", "w", "h"]) toast.ghost[k] = Math.round(toast.ghost[k] * 1000) / 1000;
      if (toast) send(toast);
    }
  }

  // ---- Bots: fly toward the current objective and shoot rocks ---------------------------------------------------

  function botThink(p) {
    p.keys = { boost: false };
    if (p.dead || p.mode !== "space") { p.axes.steer = { x: 0, y: 0 }; return; }
    const goal = !boss.dead ? boss.pos : planet ? planet : v3();
    const d = dist(p.pos, goal);
    let aim = goal;
    if (d < 70) {
      // Orbit the objective instead of crashing into it.
      const ang = S.t * 0.4 + p.botSeed;
      aim = add(goal, { x: Math.cos(ang) * 60, y: Math.sin(ang * 0.7) * 15, z: Math.sin(ang) * 60 });
    }
    const { forward } = basis(p.yaw, p.pitch);
    const near = rocks.find((r) => { const v = sub(r.pos, p.pos); const l = len(v); return l < 100 && dot(v, forward) / l > 0.8; });
    steerToward(p, near ? near.pos : aim);
    p.keys.boost = !near && d > 150 && p.boostEnergy > 0.5;
    const ahead = (pos) => { const v = sub(pos, p.pos); const l = len(v); return l < 120 && dot(v, forward) / l > 0.97; };
    p.keys.shoot = rocks.some((r) => ahead(r.pos)) || (!boss.dead && ahead(boss.pos));
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
      if (p.bot) botThink(p);
      const presses = p.pressed; p.pressed = [];
      for (const verb of presses) if (S.phase !== "scoreboard") press(p, verb);
      if (S.phase === "scoreboard") return;
      if (p.landingFor > 0 || p.takeoffFor > 0) continue;
      if (p.mode === "space") { moveShip(p, dt); fire(p, dt); drill(p, dt); p.digging = false; }
      else { moveWalker(p, dt); fire(p, dt); drillRock(p, dt); dig(p, dt); pickup(p); if (S.phase === "scoreboard") return; }
    }
    updateBullets(dt);
    updateBoss(dt);
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
    };
    if (entities) m.entities = Object.fromEntries(active().filter((p) => p.entity).map((p) => [p.name, p.entity]));
    return m;
  }

  // The session leaderboard: stars (rounds won), then total points; players still here only.
  function leaderboard() {
    return active().map((p) => ({ name: p.name, stars: (session[p.name] || {}).stars || 0, total: (session[p.name] || {}).total || 0 }))
      .sort((a, b) => b.stars - a.stars || b.total - a.total);
  }

  function clock() {
    if (S.phase === "lobby") return autostartSeconds == null ? 0 : r2(Math.max(0, autostartSeconds - S.phaseT));
    if (S.phase === "scoreboard") return r2(Math.max(0, ROUND.scoreboardSeconds - S.phaseT));
    return r2(S.playT);
  }

  // Only the flags that are on, to keep ticks small: a missing flag means false.
  function flags(p) {
    const all = {
      boost: p.boosting, shield: p.shielding, stun: p.stun > 0, dead: p.dead, invisible: p.invisibleFor > 0, drilling: p.drilling, digging: p.digging, ready: p.ready && S.phase === "lobby", bot: p.bot,
      landing: p.landingFor > 0, takingOff: p.takeoffFor > 0, spawnShield: p.spawnShield > 0,
    };
    const out = {};
    for (const k in all) if (all[k]) out[k] = true;
    return out;
  }

  function tickMessage() {
    return {
      type: "tick", t: Date.now(), round: S.round, phase: S.phase, clock: clock(),
      left: S.phase === "playing" || S.phase === "assists" ? r2(Math.max(0, ROUND.maxSeconds - S.playT)) : 0,
      players: active().map((p) => {
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
        return out;
      }),
      bullets: bullets.slice(-TICK_MAX_BULLETS).map((b) => [b.id, r1(b.pos.x), r1(b.pos.y), r1(b.pos.z), b.color, b.mode === "planet" ? 1 : 0]),
      bossShots: bossShots.map((s) => [s.id, r1(s.pos.x), r1(s.pos.y), r1(s.pos.z)]),
      flares: flares.map((f) => [r2(f.pos.x), r2(f.pos.y), r2(f.pos.z), f.radius, r2(f.until - S.t)]),
    };
  }

  newRound();
  if (autoStart) setInterval(() => step(1 / Contract.SIM_HZ), 1000 / Contract.SIM_HZ);

  return {
    handleInput, setLayout, setEntity, start, step, worldMessage, tickMessage, addBot, join, players,
    budget, drawingWorld, drawingsLeft, spendDrawing, hints,
    get phase() { return S.phase; },
    get round() { return S.round; },
    debug: () => ({ ...S, boss, planet, landing, chests, island, parked, rocks, bullets, bossShots }),
  };
}

module.exports = { createWorld, ghostBox, hasControl, chestCount, bossHp, DEFAULT_LAYOUT, VERB };
