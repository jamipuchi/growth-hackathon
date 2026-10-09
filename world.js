// Authoritative open-world simulation: every screen and phone just renders what this sends.
const TICK_HZ = 30;
const DT = 1 / TICK_HZ;
const WORLD_RADIUS = 600;
const ROCK_COUNT = 260;
const CRUISE_SPEED = 18;
const THRUST_SPEED = 16;
const BOOST_MULTIPLIER = 2.5;
const STRAFE_SPEED = 14;
const TURN_RATE = 1.8;
const MAX_PITCH = 1.4;
const BULLET_SPEED = 140;
const BULLET_LIFE = 1.4;
const FIRE_COOLDOWN = 0.12;
const STUN_TIME = 1.5;
const TREASURE_RADIUS = 7;
const TREASURES_TO_WIN = 3;
const BLAST_RANGE = 70;
const BLAST_COOLDOWN = 12;
const RESTART_SECONDS = 8;
const COLORS = [0x22d3ee, 0xf472b6, 0xa3e635, 0xfacc15, 0xfb923c, 0xc084fc, 0x60a5fa, 0xf87171];

const rand = (min, max) => min + Math.random() * (max - min);
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const round = (n) => Math.round(n * 100) / 100;

function randomPoint(minR, maxR) {
  const dir = { x: rand(-1, 1), y: rand(-0.5, 0.5), z: rand(-1, 1) };
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  return add({ x: 0, y: 0, z: 0 }, dir, rand(minR, maxR) / len);
}

// Same convention as three.js: yaw around Y, then pitch around the ship's X; nose points to -Z.
function basis(yaw, pitch) {
  const cp = Math.cos(pitch);
  const forward = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const up = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
  return { forward, right, up };
}

function createWorld(broadcast) {
  const players = {};
  let bullets = [];
  let rocks = [];
  let treasure;
  let state = "playing";
  let nextRockId = 1;
  let nextBulletId = 1;

  const fx = (kind, pos, color, size = 1) => broadcast({ type: "fx", kind, pos, color, size });
  const sendWorld = () => broadcast(worldMessage());

  function worldMessage() {
    return { type: "world", rocks: rocks.map((r) => [r.id, round(r.pos.x), round(r.pos.y), round(r.pos.z), round(r.size)]), treasure, radius: WORLD_RADIUS };
  }

  function spawnRock() {
    return { id: nextRockId++, pos: randomPoint(40, WORLD_RADIUS), size: rand(2, 11) };
  }

  function placeTreasure() {
    treasure = randomPoint(250, WORLD_RADIUS - 60);
  }

  function reset() {
    rocks = Array.from({ length: ROCK_COUNT }, spawnRock);
    bullets = [];
    placeTreasure();
    Object.values(players).forEach((p, i) => respawn(p, i));
    Object.values(players).forEach((p) => (p.treasures = 0));
    state = "playing";
    sendWorld();
  }

  function respawn(p, index) {
    p.pos = { x: (index % 4) * 8 - 12, y: Math.floor(index / 4) * 6, z: 0 };
    p.yaw = 0;
    p.pitch = 0;
    p.stun = 0;
  }

  function getPlayer(name) {
    if (!players[name]) {
      const index = Object.keys(players).length;
      players[name] = { name, color: COLORS[index % COLORS.length], keys: {}, axes: {}, cooldown: 0, blastCooldown: 0, treasures: 0, score: 0 };
      respawn(players[name], index);
    }
    players[name].lastSeen = Date.now();
    return players[name];
  }

  function handleInput(msg) {
    const p = getPlayer(msg.player);
    if (msg.type === "input") p.keys[msg.action] = msg.down;
    if (msg.type === "axis") p.axes[msg.axis] = { x: Math.max(-1, Math.min(1, msg.x)), y: Math.max(-1, Math.min(1, msg.y)) };
  }

  function steer(p) {
    const k = p.keys;
    const stick = p.axes.steer || { x: 0, y: 0 };
    const move = p.axes.move || { x: 0, y: 0 };
    return {
      turn: (k.right ? 1 : 0) - (k.left ? 1 : 0) + stick.x,
      pitch: (k.up ? 1 : 0) - (k.down ? 1 : 0) + stick.y,
      thrust: (k.forward ? 1 : 0) - (k.back ? 1 : 0),
      strafeX: (k.straferight ? 1 : 0) - (k.strafeleft ? 1 : 0) + move.x,
      strafeY: (k.rise ? 1 : 0) - (k.sink ? 1 : 0) + move.y,
    };
  }

  function movePlayer(p) {
    p.cooldown = Math.max(0, p.cooldown - DT);
    p.blastCooldown = Math.max(0, p.blastCooldown - DT);
    if (p.stun > 0) {
      p.stun -= DT;
      return;
    }
    const s = steer(p);
    p.yaw -= Math.max(-1, Math.min(1, s.turn)) * TURN_RATE * DT;
    p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch + Math.max(-1, Math.min(1, s.pitch)) * TURN_RATE * DT));
    p.roll = -Math.max(-1, Math.min(1, s.turn + s.strafeX * 0.5)) * 0.6;
    const { forward, right, up } = basis(p.yaw, p.pitch);
    const speed = (CRUISE_SPEED + s.thrust * THRUST_SPEED) * (p.keys.boost ? BOOST_MULTIPLIER : 1);
    p.pos = add(p.pos, forward, speed * DT);
    p.pos = add(p.pos, right, s.strafeX * STRAFE_SPEED * DT);
    p.pos = add(p.pos, up, s.strafeY * STRAFE_SPEED * DT);
    // Soft world edge: past the radius, the ship is pulled back toward the centre.
    const r = Math.hypot(p.pos.x, p.pos.y, p.pos.z);
    if (r > WORLD_RADIUS) p.pos = add(p.pos, p.pos, -(r - WORLD_RADIUS) / r);
    if (p.keys.fire && !p.keys.shield && p.cooldown === 0) {
      bullets.push({ id: nextBulletId++, pos: add(p.pos, forward, 3), dir: forward, owner: p.name, color: p.color, life: BULLET_LIFE });
      p.cooldown = FIRE_COOLDOWN;
    }
    if (p.keys.win && p.blastCooldown === 0) blast(p, forward);
  }

  // The "WIN" button: a shockwave that clears every rock in front of the ship.
  function blast(p, forward) {
    p.blastCooldown = BLAST_COOLDOWN;
    const center = add(p.pos, forward, BLAST_RANGE / 2);
    const hit = rocks.filter((r) => dist(r.pos, center) < BLAST_RANGE);
    hit.forEach((r) => fx("explode", r.pos, 0xa8a29e, r.size));
    p.score += hit.length * 10;
    rocks = rocks.filter((r) => !hit.includes(r)).concat(hit.map(spawnRock));
    fx("blast", center, p.color, BLAST_RANGE);
    if (hit.length) sendWorld();
  }

  function rockHitBy(pos, pad) {
    return rocks.find((r) => dist(r.pos, pos) < r.size + pad);
  }

  function replaceRock(rock) {
    rocks = rocks.filter((r) => r !== rock);
    rocks.push(spawnRock());
  }

  function updateBullets() {
    let isWorldChanged = false;
    bullets = bullets.filter((b) => {
      b.pos = add(b.pos, b.dir, BULLET_SPEED * DT);
      b.life -= DT;
      const rock = rockHitBy(b.pos, 0.5);
      if (rock) {
        fx("explode", rock.pos, 0xa8a29e, rock.size);
        if (players[b.owner]) players[b.owner].score += 10;
        replaceRock(rock);
        isWorldChanged = true;
        return false;
      }
      return b.life > 0;
    });
    return isWorldChanged;
  }

  function collide(p) {
    if (p.stun > 0) return false;
    const rock = rockHitBy(p.pos, p.keys.shield ? 4 : 1.5);
    if (!rock) return false;
    fx("explode", rock.pos, p.keys.shield ? p.color : 0xf97316, rock.size);
    if (!p.keys.shield) {
      p.stun = STUN_TIME;
      p.score = Math.max(0, p.score - 30);
    }
    replaceRock(rock);
    return true;
  }

  function checkTreasure(p) {
    if (dist(p.pos, treasure) > TREASURE_RADIUS + 2) return;
    p.treasures++;
    p.score += 500;
    fx("treasure", treasure, p.color, 20);
    broadcast({ type: "announce", text: `💎 ${p.name} found the treasure! (${p.treasures}/${TREASURES_TO_WIN})` });
    if (p.treasures >= TREASURES_TO_WIN) {
      state = "won";
      broadcast({ type: "announce", text: `🏆 ${p.name} WINS THE HUNT!`, big: true });
      setTimeout(reset, RESTART_SECONDS * 1000);
    }
    placeTreasure();
    sendWorld();
  }

  function tick() {
    const active = Object.values(players).filter((p) => Date.now() - p.lastSeen < 10 * 60 * 1000);
    if (state === "playing") active.forEach(movePlayer);
    let isWorldChanged = updateBullets();
    active.forEach((p) => {
      if (collide(p)) isWorldChanged = true;
      if (state === "playing") checkTreasure(p);
    });
    if (isWorldChanged) sendWorld();
  }

  function snapshot() {
    return {
      type: "tick",
      state,
      players: Object.values(players).map((p) => ({
        name: p.name, color: p.color, x: round(p.pos.x), y: round(p.pos.y), z: round(p.pos.z),
        yaw: round(p.yaw), pitch: round(p.pitch), roll: round(p.roll || 0),
        boost: !!p.keys.boost, shield: !!p.keys.shield, stun: p.stun > 0, score: p.score, treasures: p.treasures,
        blastReady: p.blastCooldown === 0,
      })),
      bullets: bullets.map((b) => [b.id, round(b.pos.x), round(b.pos.y), round(b.pos.z), b.color]),
    };
  }

  reset();
  setInterval(tick, 1000 / TICK_HZ);
  return { handleInput, snapshot, worldMessage };
}

module.exports = { createWorld, TICK_HZ };
