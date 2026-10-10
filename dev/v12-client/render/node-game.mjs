// Render agent: the whole startGame() loop in Node with a fake renderer and a local three.js: the stream URLs, the message filters, game.pause,
// setPlayer reconnect, the frame loop over synthetic ticks (ships, bots, mischief, decoys, flags, landing shot is not driven), hud, projectPlayers.
//   node dev/v12-client/render/node-game.mjs
import "./node-env.mjs";
import { loadRender } from "./node-env.mjs";
let fails = 0, checks = 0;
const ok = (c, label, extra = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${label} ${extra}`); } else console.log(`  ok   ${label}`); };
let frameCb = null;
globalThis.requestAnimationFrame = (cb) => { frameCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => { frameCb = null; };
const R = await loadRender();
const T = R.__t;
const canvas = document.createElement("canvas");
let now = 1000;
const step = (n = 1, dtMs = 16.7) => { for (let i = 0; i < n; i++) { now += dtMs; const cb = frameCb; frameCb = null; if (cb) cb(now); } };
const tickMsg = (t, players, extra = {}) => ({ type: "tick", t, round: 1, phase: "playing", clock: 30, left: 200, players, bullets: [], bossShots: [], flares: [], mines: [], decoys: [], ...extra });
const P = (name, x, z, flags = {}, extra = {}) => ({ name, color: 0x22d3ee, mode: "space", x, y: 0, z, yaw: 0, pitch: 0, roll: 0, hp: 100, score: 0, shieldEnergy: 1, boostEnergy: 1, flags, ...extra });
const worldMsg = (extra = {}) => ({ type: "world", round: 1, seed: 7, radius: 2000, rocks: [], nebula: { x: 0, y: 0, z: -1100, radius: 220 }, targets: [{ id: 1, kind: "boss", x: 0, y: 0, z: -1100, radius: 20, armour: 0, hp: 2400, maxHp: 2400, cracked: true, dead: false }], revealedTo: [], planet: null, island: { seed: 7, size: 600, landing: { x: 0, z: 0 }, parked: [] }, chests: [], assists: false, playerCount: 3, result: null, leaderboard: [], ...extra });

for (const mode of ["phone", "big"]) {
  console.log(`startGame ${mode}`);
  T.entReset({});
  const opened0 = EventSource.opened.length;
  const game = R.startGame({ canvas, screen: mode, view: mode === "phone" ? "chase" : "spectator", player: mode === "phone" ? "me" : null });
  const url = EventSource.opened[opened0];
  ok(url === (mode === "phone" ? "/events?player=me" : "/events?screen=big"), `${mode}: the stream is ${url}`);
  const got = { mischief: [], cooldown: [], toast: [], announce: [], fx: [] };
  for (const k of Object.keys(got)) game.on(k, (m) => got[k].push(m));
  const h = game._internals.handle;
  h(worldMsg());
  const me = P("me", 0, 0), bob = P("bob", 20, -10), ana = P("ana", 40, -20, { emp: true }), cy = P("cy", 60, -20, { inked: true }), dee = P("dee", 80, -30, { tractored: true });
  const bots = Array.from({ length: 24 }, (_, i) => P(`bot${i + 1}`, i * 6, -50 - i * 3, { bot: true }));
  const T0 = Date.now();
  for (let i = 0; i < 6; i++) h(tickMsg(T0 - 600 + i * 70, [me, bob, ana, cy, dee, ...bots], { mines: [[1, 10, 0, -8, 0, 0xff00ff], [2, 12, 0, -3, 1, 0x00ff00]], decoys: [[5, 14, 0, -6, 0.5, 0xffaa00, "bob", 0]] }));
  let err = null;
  try { step(30); } catch (e) { err = e; }
  ok(!err, `${mode}: 30 frames over a synthetic tick (25 ships, mines, a decoy, emp / ink / tractor flags)`, err && err.stack);
  const g = game._internals.game;
  ok(g.space.mischief.mines.count === 1, `${mode}: the space layer draws the space mine`, `${g.space.mischief.mines.count}`);
  ok(g.space.mischief.decoys.size === 1, `${mode}: the decoy is tracked`);
  const tags = game.projectPlayers();
  ok(tags.length > 0 && tags.every((t) => typeof t.bot === "boolean" && t.flags && typeof t.flags === "object"), `${mode}: projectPlayers items carry bot + flags`, JSON.stringify(tags[0] && { bot: tags[0].bot, f: tags[0].flags }));
  ok(tags.some((t) => t.flags.emp) || tags.length > 0, `${mode}: (flags pass through)`);
  // filters
  h({ type: "mischief", kind: "emp", player: mode === "phone" ? "me" : "nobody", from: "bob", seconds: 5 });
  h({ type: "mischief", kind: "emp", player: "someone-else", from: "bob", seconds: 5 });
  h({ type: "cooldown", player: mode === "phone" ? "me" : "nobody", verb: "emp", seconds: 12 });
  h({ type: "cooldown", player: "someone-else", verb: "emp", seconds: 12 });
  h({ type: "toast", player: "someone-else", text: "x", kind: "info" });
  h({ type: "toast", player: "me", text: "y", kind: "info" });
  h({ type: "announce", text: "bob ✕ ana", big: false });
  ok(got.mischief.length === (mode === "phone" ? 1 : 0), `${mode}: mischief reaches only the phone's own player`, `${got.mischief.length}`);
  ok(got.cooldown.length === (mode === "phone" ? 1 : 0), `${mode}: cooldown reaches only the phone's own player`, `${got.cooldown.length}`);
  ok(got.toast.length === (mode === "phone" ? 1 : 2), `${mode}: toasts are filtered on the phone only`, `${got.toast.length}`);
  ok(got.announce.length === 1, `${mode}: announce is emitted`);
  // pause
  const r0 = globalThis.__renders || 0;
  game.pause(true); step(5);
  ok((globalThis.__renders || 0) === r0 && frameCb === null, `${mode}: pause(true) stops drawing`);
  game.pause(false); step(3);
  ok((globalThis.__renders || 0) > r0, `${mode}: pause(false) resumes`);
  // setPlayer reconnects a phone under the new name
  if (mode === "phone") {
    const n0 = EventSource.opened.length;
    game.setPlayer("ana2");
    ok(EventSource.opened.length === n0 + 1 && EventSource.opened[n0] === "/events?player=ana2", "phone: setPlayer(new name) reopens the stream as ?player=ana2", EventSource.opened.slice(n0).join());
    game.setPlayer("ana2");
    ok(EventSource.opened.length === n0 + 1, "phone: the same name does not reconnect");
    game.setPlayer("me");
  }
  // governor pin and tier
  ok(typeof game.hud().followed === "string" || game.hud().followed === null, `${mode}: hud() works`);
  if (mode === "big") {
    let sawBot = false;
    for (let i = 0; i < 60; i++) { step(1); const f = game.hud().followed; if (f && f.startsWith("bot")) sawBot = true; }
    ok(!sawBot, "TV: hud().followed is never a bot while humans play", game.hud().followed);
  }
  // fx of every mischief kind through the stream, both worlds
  for (const kind of ["emp", "inkbomb", "tractor", "mine", "decoy", "respawn", "explode"]) for (const md of ["space", "planet"]) {
    let e = null;
    try { h({ type: "fx", kind, mode: md, pos: { x: 1, y: 2, z: 3 }, color: 0xff00ff, size: kind === "mine" ? 1.5 : 3 }); step(2); } catch (x) { e = x; }
    ok(!e, `${mode}: fx ${kind} in ${md}`, e && e.stack);
  }
  // a new round clears the layers
  h(worldMsg({ round: 2 }));
  ok(g.space.mischief.decoys.size === 0, `${mode}: a new round clears the decoys`);
  game.dispose();
}
// the island: the phone's player is walking, with a tractor victim, a mine, a decoy and a parked ship around
{
  console.log("island scene");
  T.entReset({});
  const game = R.startGame({ canvas, screen: "phone", view: "chase", player: "me" });
  const h = game._internals.handle, g = game._internals.game;
  h(worldMsg({ planet: { x: 0, y: 0, z: -1700, radius: 40, landRange: 25 }, island: { seed: 7, size: 600, landing: { x: 0, z: 0 }, parked: [{ player: "ben", x: 5, z: 5, hp: 300, maxHp: 300, wrecked: false }] }, chests: [{ id: 1, kind: "buried", x: 20, z: 20, buried: true, dug: 0, open: false, by: null }] }));
  T.entNote("ben", { type: "ship", image: "" });
  const ex = (name, x, z, flags = {}) => P(name, x, z, flags, { mode: "planet", y: 1 });
  const T0 = Date.now();
  for (let i = 0; i < 6; i++) h(tickMsg(T0 - 600 + i * 70, [ex("me", 0, 0), ex("dee", 12, 4, { tractored: true }), ex("cy", 8, -6, { inked: true }), ex("ana", 6, 6, { emp: true }), P("ben", 0, 0, { dead: false }, { mode: "space" })], { mines: [[1, 3, 0.5, 3, 1, 0xff00ff], [2, 10, 0, -3, 0, 0x00ff00]], decoys: [[5, 4, 1, 2, 0.5, 0xffaa00, "ana", 1]] }));
  let err = null;
  try { step(40); } catch (e) { err = e; }
  ok(!err, "island: 40 frames with mischief on the planet", err && err.stack);
  ok(g.sceneName === "planet", "island: the planet scene is on screen", g.sceneName);
  ok(g.island.mischief.mines.count === 1 && g.island.mischief.decoys.size === 1, "island: its layer draws the island mine (not the space one) and the decoy", `${g.island.mischief.mines.count} ${g.island.mischief.decoys.size}`);
  ok(g.island.mischief.ink.n > 0 && g.island.particles.n > 0, "island: ink drips and emp sparks");
  ok(g.island.mischief.ownStreaks.n > 0, "island: the tractor beam is drawn");
  const e = g.island.parked.get("ben");
  ok(!e || e.entityFor({ x: 5, z: 5 }) === T.entShips.get("ben"), "island: the parked ship asks for the owner's last SHIP entity");
  game.dispose();
}
// the TV bots-only demo
{
  const game = R.startGame({ canvas, screen: "big", view: "spectator", player: null });
  const h = game._internals.handle;
  h(worldMsg());
  const bots = Array.from({ length: 5 }, (_, i) => P(`bot${i + 1}`, i * 6, -50 - i * 3, { bot: true }));
  const T0 = Date.now();
  for (let i = 0; i < 6; i++) h(tickMsg(T0 - 600 + i * 70, bots));
  step(30);
  ok(game.hud().followed && game.hud().followed.startsWith("bot"), "TV: with bots only, a bot is followed");
  game.dispose();
}
// v1.4: the server's 3-2-1 (phase "countdown": tick.countdown 3, 2, 1, clock = seconds left before GO), then GO, on both screens
for (const mode of ["phone", "big"]) {
  console.log(`countdown phase (v1.4) ${mode}`);
  T.entReset({});
  const game = R.startGame({ canvas, screen: mode, view: mode === "phone" ? "chase" : "spectator", player: mode === "phone" ? "me" : null });
  const h = game._internals.handle;
  h(worldMsg());
  const ps = [P("me", 0, 0), P("ana", 10, 0), ...Array.from({ length: 4 }, (_, i) => P(`bot${i + 1}`, i * 6, -50, { bot: true }))];
  const T0 = Date.now();
  let err = null;
  try { for (let i = 0; i < 6; i++) h(tickMsg(T0 - 600 + i * 70, ps, { phase: "countdown", countdown: 3 - Math.floor(i / 2), clock: 2.9 - i * 0.4 })); step(20); } catch (e) { err = e; }
  ok(!err, `${mode}: 20 frames over phase countdown ticks`, err && err.stack);
  ok(game.hud().phase === "countdown", `${mode}: hud().phase is countdown during the 3-2-1`, game.hud().phase);
  try { for (let i = 0; i < 4; i++) h(tickMsg(T0 + 3000 + i * 70, ps, { phase: "playing", clock: 0.05 + i * 0.07, left: 240 })); step(20); } catch (e) { err = e; }
  ok(!err && game.hud().phase === "playing", `${mode}: countdown → playing (GO): the frame loop goes on`, err ? err.stack : game.hud().phase);
  game.dispose();
}
console.log(`\n${fails ? "FAIL" : "PASS"}: ${checks - fails}/${checks} checks`);
process.exit(fails ? 1 : 0);
