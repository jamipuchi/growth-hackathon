// Render agent: Node smoke test of the new render code against a local three.js (no GL): the mischief layer (mines, decoys, flags, fx), the
// humans-first camera director, the snapshot interpolation of decoys, the HUD copy. node dev/v12-client/render/node-smoke.mjs
import "./node-env.mjs";
import { loadRender } from "./node-env.mjs";
let fails = 0, checks = 0;
const ok = (c, label, extra = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${label} ${extra}`); } else console.log(`  ok   ${label}`); };
const R = await loadRender();
const T = R.__t;
const THREE = await import("three");
console.log(`render.js imported (three r${THREE.REVISION}); exports: ${Object.keys(R).join(", ")}`);
ok(typeof R.startGame === "function" && typeof R.sfx === "object" && typeof R.createEntityPreview === "function", "exports kept: startGame, sfx, createEntityPreview");
ok(["play", "unlock", "setMuted", "muted", "unlocked", "ready"].every((k) => k in R.sfx), "sfx facade has play / unlock / setMuted / muted / unlocked / ready");

// ---------------------------------------------------------------------------------------------------- mischief layer
console.log("mischief layer");
const mkWorld = (phone) => ({ scene: new THREE.Scene(), phone, big: !phone, glow: new T.BillboardBatch(512), particles: new T.Particles(2000), rings: new T.RingPool(8), streaks: new T.StreakBatch(256), camPos: new THREE.Vector3(0, 0, 30) });
const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000); cam.position.set(0, 0, 30); cam.updateMatrixWorld(true);
const player = (name, x, flags = {}, extra = {}) => ({ name, color: 0x22d3ee, mode: "space", x, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, hp: 100, flags, ...extra });
for (const phone of [true, false]) {
  const label = phone ? "phone" : "TV";
  const world = mkWorld(phone), L = new T.MischiefLayer(world, "space");
  ok(world.scene.children.includes(L.mines) && world.scene.children.includes(L.ink.mesh), `${label}: the mines mesh and the ink batch are in the scene`);
  const snap = { players: [player("bob", 0), player("ana", 20, { emp: true }), player("cy", 40, { inked: true }), player("dee", 60, { tractored: true }), player("bot1", 80, { bot: true })],
    mines: [[1, 5, 0, -5, 0, 0xff0000], [2, 8, 0, -8, 0, 0x00ff00], [3, 0, 0, 0, 1, 0x0000ff]], decoys: [], bullets: [], bossShots: [], flares: [] };
  world.glow.begin(); world.streaks.begin();
  for (let f = 0; f < 30; f++) { world.glow.begin(); world.streaks.begin(); L.update(1 / 60, f / 60, snap, {}, cam); world.streaks.end(); world.glow.end(); }
  ok(L.mines.count === 2, `${label}: 2 space mines drawn (the island one is skipped)`, `count ${L.mines.count}`);
  ok(L.mines.instanceColor && L.mines.instanceColor.getX(0) > 0.9, `${label}: mine colour = owner's colour`, `${L.mines.instanceColor && L.mines.instanceColor.getX(0)}`);
  ok(world.glow.n >= 9, `${label}: mine halos / glows / red lights in the glow batch`, `n ${world.glow.n}`);
  ok(world.particles.n > 0, `${label}: EMP sparks emitted on the emp player`, `n ${world.particles.n}`);
  ok(L.ink.n > 0, `${label}: ink drips emitted on the inked player`, `n ${L.ink.n}`);
  ok(world.streaks.n > 0, `${label}: tractor beam + emp arcs in the streak batch`, `n ${world.streaks.n}`);
  // no effects on a dead or cloaked player
  const before = world.particles.n + L.ink.n;
  const snap2 = { ...snap, players: [player("bob", 0), player("ana", 20, { emp: true, dead: true }), player("cy", 40, { inked: true, invisible: true })], mines: [], decoys: [] };
  const w2 = mkWorld(phone), L2 = new T.MischiefLayer(w2, "space");
  for (let f = 0; f < 20; f++) { w2.glow.begin(); w2.streaks.begin(); L2.update(1 / 60, f / 60, snap2, {}, cam); w2.streaks.end(); w2.glow.end(); }
  ok(w2.particles.n === 0 && L2.ink.n === 0 && L2.mines.count === 0, `${label}: nothing on a dead or cloaked player`);
  // fx kinds: none throws, each adds something
  for (const kind of ["emp", "inkbomb", "tractor", "mine", "decoy"]) {
    const p0 = world.particles.n + L.ink.n;
    let threw = null;
    try { L.fx({ kind, mode: "space", pos: { x: 3, y: 1, z: -4 }, color: 0x22d3ee, size: kind === "mine" ? 1.5 : 3 }); if (kind === "mine") L.fx({ kind, mode: "space", pos: { x: 3, y: 1, z: -4 }, color: 0x22d3ee, size: 3 }); } catch (e) { threw = e; }
    ok(!threw && world.particles.n + L.ink.n > p0, `${label}: fx ${kind} bursts`, threw ? String(threw.stack || threw) : "");
  }
  // decoys: appear, flicker, nearest N get meshes, fade out and are freed
  T.entNote("bob", { type: "ship", image: "" });
  const dsnap = (ids) => ({ players: [player("bob", 0)], mines: [], decoys: ids.map((i) => [i, 10 + i * 12, 0, -10, 0.5, 0x22d3ee, "bob", 0]), bullets: [], bossShots: [], flares: [] });
  const dw = mkWorld(phone), DL = new T.MischiefLayer(dw, "space");
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let f = 0; f < 40; f++) { dw.glow.begin(); dw.streaks.begin(); DL.update(1 / 60, f / 60, dsnap(ids), {}, cam); dw.streaks.end(); dw.glow.end(); }
  const meshes = [...DL.decoys.values()].filter((d) => d.model).length;
  ok(DL.decoys.size === 10, `${label}: 10 decoys tracked`, `${DL.decoys.size}`);
  ok(meshes === (phone ? 3 : 8), `${label}: the ${phone ? "phone gives meshes to the 3" : "TV gives meshes to the 8"} nearest decoys`, `${meshes}`);
  const first = [...DL.decoys.values()].find((d) => d.model);
  ok(first.mats.length > 0 && first.mats.every((m) => m.transparent && m.blending === THREE.AdditiveBlending), `${label}: a decoy mesh is a translucent additive hologram`);
  ok(first.mats.every((m) => m.opacity > 0 && m.opacity <= 1), `${label}: hologram opacity in range`);
  ok(dw.scene.children.filter((c) => c.isGroup).length >= meshes, `${label}: decoy groups are in the scene`);
  for (let f = 40; f < 80; f++) { dw.glow.begin(); dw.streaks.begin(); DL.update(1 / 60, f / 60, dsnap([]), {}, cam); dw.streaks.end(); dw.glow.end(); }
  ok(DL.decoys.size === 0, `${label}: decoys fade out (0.4 s) and are freed`, `${DL.decoys.size}`);
  ok(dw.scene.children.filter((c) => c.isGroup).length === 0, `${label}: their groups left the scene`);
  DL.clear();
}
// the island layer owns its streak batch
{
  const w = mkWorld(true); delete w.streaks;
  const L = new T.MischiefLayer(w, "planet");
  ok(!!L.ownStreaks && w.scene.children.includes(L.ownStreaks.mesh), "island: the layer adds its own streak batch");
  const snap = { players: [player("bob", 0, {}, { mode: "planet" }), player("dee", 30, { tractored: true }, { mode: "planet" })], mines: [[1, 4, 0, 4, 1, 0xff0000]], decoys: [[1, 6, 0, 6, 0, 0x22d3ee, "bob", 1]], bullets: [], bossShots: [], flares: [] };
  for (let f = 0; f < 30; f++) { w.glow.begin(); L.update(1 / 60, f / 60, snap, {}, cam); w.glow.end(); }
  ok(L.mines.count === 1 && L.decoys.size === 1 && L.ownStreaks.n > 0, "island: a mine, a decoy and a tractor beam", `${L.mines.count} ${L.decoys.size} ${L.ownStreaks.n}`);
  const dv = [...L.decoys.values()][0];
  ok(dv.model && dv.kind === "stand-in", "island: a decoy without a drawing is a stand-in explorer", dv.kind);
}
// RingPool inward + the ink batch really is normal-blended
{
  const rp = new T.RingPool(2);
  rp.spawn(new THREE.Vector3(), 0xffffff, 10, 1, false, true);
  rp.update(0.5, cam);
  ok(rp.items[0].m.scale.x < 10 && rp.items[0].m.material.opacity > 0, "RingPool: an inward ring shrinks");
  const P = new T.Particles(10, { normal: true });
  ok(P.batch.material.blending === THREE.NormalBlending && P.batch.material.uniforms.uNearFade.value > 0, "ink particles: normal blending, near fade");
  const A = new T.Particles(10);
  ok(A.batch.material.blending === THREE.AdditiveBlending, "ordinary particles stay additive");
}
// the mine geometry
{
  const g = T.mineGeometry();
  ok(g.attributes.color && g.attributes.position.count / 3 <= 120, "mine geometry: vertex colours, <= 120 triangles", `${g.attributes.position.count / 3}`);
}

// ---------------------------------------------------------------------------------------------------- snapshots
console.log("snapshots");
{
  const S = new T.Snapshots();
  const mk = (t, x) => ({ type: "tick", t, round: 1, phase: "playing", clock: 1, left: 100, players: [], bullets: [], bossShots: [], flares: [], mines: [[1, 0, 0, 0, 0, 1]], decoys: [[9, x, 0, 0, 0.5, 2, "bob", 0]] });
  const now = Date.now();
  S.push(mk(now - 400, 0)); S.push(mk(now - 300, 10)); S.push(mk(now - 200, 20));
  const smp = S.sample();
  ok(smp.mines.length === 1 && smp.decoys.length === 1, "sample() carries mines and decoys");
  ok(smp.decoys[0][1] > 0 && smp.decoys[0][1] <= 20, "decoys are interpolated between ticks", `x ${smp.decoys[0][1]}`);
  ok(new T.Snapshots().sample().mines.length === 0, "an empty sample has mines and decoys arrays");
}

// ---------------------------------------------------------------------------------------------------- camera director
console.log("camera director (humans first)");
{
  const cams = new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000);
  const rig = new T.CameraRig(cams);
  const boss = { x: 0, y: 0, z: -1000, hp: 2400, maxHp: 2400, radius: 20, dead: false };
  const game = { space: { bossAlive: () => (boss.dead ? null : boss) }, world: { chests: [], planet: null }, screen: "big", view: "spectator", player: null };
  const bots = Array.from({ length: 24 }, (_, i) => player(`bot${i + 1}`, i, { bot: true }, { z: -900 + i * 4 })); // the bots are the closest to the boss
  const hum = (n, z, flags = {}) => player(n, 0, flags, { z });
  let players = [...bots, hum("ana", 0), hum("ben", -100)];
  let f = rig.pickFocus(game, players, 0);
  ok(f && !f.flags.bot, "24 bots closer to the boss, 2 humans: the camera follows a human", f && f.name);
  f = rig.pickFocus(game, players, 20);
  ok(f && f.name === "ben", "the human closest to the boss", f && f.name);
  players = [...bots, hum("ana", 0, { dead: true }), hum("ben", -100, { dead: true })];
  rig.focus = "ben";
  f = rig.pickFocus(game, players, 30);
  ok(f && f.name === "ben" && !f.flags.bot, "every human down: the camera stays on the human (not a bot) for the respawn", f && f.name);
  players = bots.slice();
  rig.focus = null;
  f = rig.pickFocus(game, players, 40);
  ok(f && f.flags.bot, "no human in the round: bots are followed");
  // key events
  players = [...bots, hum("ana", -500), hum("ben", -100, { landing: true })];
  rig.focus = "ana"; rig.lastCut = 100;
  f = rig.pickFocus(game, players, 101);
  ok(f && f.name === "ben", "a human's landing shot wins at once", f && f.name);
  boss.hp = 300; // below 20 %
  players = [...bots, hum("ana", -100), hum("ben", -900)];
  rig.focus = "ana"; rig.lastCut = 200;
  f = rig.pickFocus(game, players, 204);
  ok(f && f.name === "ben", "boss below 20 %: the human closest to the boss, cut after 3 s", f && f.name);
  boss.hp = 2400;
  rig.focus = "ana"; rig.lastCut = 300;
  f = rig.pickFocus(game, [...bots, hum("ana", -100), hum("ben", -900)], 304);
  ok(f && f.name === "ana", "healthy boss: no cut before 8 s", f && f.name);
  // island: the human digging beats the one walking
  game.world.chests = [{ x: 0, z: 0, open: false }];
  players = [...bots, { ...hum("ana", 0), mode: "planet", z: 50, flags: {} }, { ...hum("ben", 0), mode: "planet", z: 5, flags: { digging: true } }];
  rig.focus = "ana"; rig.lastCut = 0;
  f = rig.pickFocus(game, players, 50);
  ok(f && f.name === "ben", "on the island the human digging a chest is followed", f && f.name);
  // hud().followed never names a bot while a human plays: rig.focus only ever takes pool members
  let sawBot = false;
  for (let i = 0; i < 200; i++) { const pl = [...bots.map((b) => ({ ...b, z: -900 + ((i * 7 + b.z) % 300) })), hum("ana", -((i * 13) % 500)), hum("ben", -((i * 29) % 700), i % 17 === 0 ? { dead: true } : {})]; const r = rig.pickFocus(game, pl, 100 + i * 2); if (r && r.flags.bot) sawBot = true; }
  ok(!sawBot, "200 random frames: the followed player is never a bot while a human plays");
}

// ---------------------------------------------------------------------------------------------------- HUD copy and the LOD plan
console.log("hud copy, lod");
{
  const copy = Object.values(T.HUD_COPY).filter((v) => typeof v === "string").join(" | ");
  ok(!/\bPRESS\b|\bTAP\b|\bHIT\b/.test(copy.replace("PRESS START", "")), "HUD_COPY has no PRESS / TAP / HIT instructions", copy);
  ok(!/\b(LAND|DIG IT|DRILL IT|SHOOT IT|FIRE)\b/.test(copy), "HUD_COPY names no button (LAND, DIG, DRILL, SHOOT, FIRE)", copy);
  const items = Array.from({ length: 25 }, (_, i) => ({ lodDist: 10 + i * 10, forced: i < 2, wantMesh: false, hadMesh: false, keepUntil: 0, dwell: 0 }));
  T.entPlanLod(items, false, 16, 450, 520, [], 0);
  ok(items.filter((s) => s.wantMesh).length === 16, "TV LOD: 16 meshes (the 2 forced + the 14 nearest)", `${items.filter((s) => s.wantMesh).length}`);
  const items2 = items.map((s) => ({ ...s, wantMesh: false, hadMesh: false }));
  T.entPlanLod(items2, true, 8, 450, 520, [], 0);
  ok(items2.filter((s) => s.wantMesh).length === 8, "phone LOD: 8 meshes", `${items2.filter((s) => s.wantMesh).length}`);
}
console.log(`\n${fails ? "FAIL" : "PASS"}: ${checks - fails}/${checks} checks`);
process.exit(fails ? 1 : 0);
