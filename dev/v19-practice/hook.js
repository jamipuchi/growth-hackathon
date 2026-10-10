// Test-only preload for dev/v19-practice/practice-test.js (node -r ./hook.js server.js, forked with IPC): keeps every world
// server.js creates and answers a few commands from the test over IPC, so a node test can put a practicing ship next to the
// boss or the planet without minutes of flying. Never loaded by the game.
const Module = require("module");
const worlds = [];
const load = Module._load;
Module._load = function (request) {
  const out = load.apply(this, arguments);
  if (/(^|\/)world(\.js)?$/.test(request) && out && typeof out.createWorld === "function" && !out.__practiceHook) {
    const create = out.createWorld;
    out.createWorld = (opts) => { const w = create(opts); worlds.push(w); return w; };
    out.__practiceHook = true;
  }
  return out;
};
const practiceWorld = () => [...worlds].reverse().find((w) => w.practice) || null;
const mainWorld = () => worlds.find((w) => !w.practice) || null;
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
function face(p, goal) {
  const v = { x: goal.x - p.pos.x, y: goal.y - p.pos.y, z: goal.z - p.pos.z };
  p.yaw = Math.atan2(-v.x, -v.z);
  p.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
}
process.on("message", (cmd) => {
  let reply = { ok: false };
  try {
    const P = practiceWorld(), W = mainWorld();
    const p = P && P.players[cmd.player];
    if (cmd.cmd === "near-boss" && p) {
      const boss = P.debug().boss;
      boss.hp = Math.min(boss.hp, 3);
      const out = norm({ x: -boss.pos.x, y: 0, z: -boss.pos.z });
      p.pos = { x: boss.pos.x + out.x * (boss.radius + 25), y: boss.pos.y, z: boss.pos.z + out.z * (boss.radius + 25) };
      p.vel = { x: 0, y: 0, z: 0 };
      face(p, boss.pos);
      p.spawnShield = 0;
      reply = { ok: true, hp: boss.hp };
    } else if (cmd.cmd === "near-planet" && p) {
      const planet = P.debug().planet;
      if (planet) {
        const out = norm({ x: p.pos.x - planet.x, y: p.pos.y - planet.y, z: p.pos.z - planet.z });
        p.pos = { x: planet.x + out.x * (planet.radius + 2.5), y: planet.y + out.y * (planet.radius + 2.5), z: planet.z + out.z * (planet.radius + 2.5) };
        p.vel = { x: 0, y: 0, z: 0 };
        reply = { ok: true };
      }
    } else if (cmd.cmd === "state") {
      const q = W && W.players[cmd.player];
      reply = {
        ok: true, practiceWorlds: worlds.filter((w) => w.practice).length,
        practice: p ? { mode: p.mode, type: p.entity && p.entity.type, source: p.entity && p.entity.source, phase: P.phase, bossDead: P.debug().boss.dead, round: P.round, score: p.score } : null,
        main: q ? { mode: q.mode, type: q.entity && q.entity.type, source: q.entity && q.entity.source, inRound: !!q.inRound, planet: q.drawn.planet, phase: W.phase, round: W.round, left: W.drawingsLeft(cmd.player) } : null,
      };
    }
  } catch (err) { reply = { ok: false, error: String(err && err.stack || err) }; }
  process.send({ id: cmd.id, ...reply });
});
