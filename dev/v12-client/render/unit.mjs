// Render agent: Node unit tests that need no browser and no three.js. They read render.js's own source:
//   1. the sound block (between "// <sound>" and "// </sound>": the facade, the fallback synth, WorldSound) runs over the REAL sfx.js engine and
//      a fake AudioContext that counts every voice started: "nothing plays twice" is a count per event;
//   2. the quality governor (class Perf) with frame-time traces.
//   node dev/v12-client/render/unit.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = fs.readFileSync(path.join(ROOT, "render.js"), "utf8");
let fails = 0, checks = 0;
const ok = (cond, label, extra = "") => { checks++; if (!cond) { fails++; console.log(`  FAIL ${label} ${extra}`); } else console.log(`  ok   ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------------------------------------ fake WebAudio
const starts = []; // every voice the engine started: { len, rate, loop }
class FakeParam { constructor(v = 0) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} cancelScheduledValues() {} setTargetAtTime() {} }
class FakeNode { constructor(o = {}) { Object.assign(this, o); } connect() {} disconnect() {} }
class FakeAC {
  constructor() { this.state = "suspended"; this.sampleRate = 48000; this.t0 = performance.now(); this.destination = new FakeNode(); this.onstatechange = null; }
  get currentTime() { return (performance.now() - this.t0) / 1000; }
  createGain() { return new FakeNode({ gain: new FakeParam(1) }); }
  createDynamicsCompressor() { return new FakeNode({ threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() }); }
  createStereoPanner() { return new FakeNode({ pan: new FakeParam() }); }
  createBuffer(ch, len, sr) { return { length: len, sampleRate: sr, duration: len / sr, getChannelData: () => new Float32Array(len) }; }
  createBufferSource() {
    const n = new FakeNode({ buffer: null, loop: false, playbackRate: new FakeParam(1), onended: null });
    n.start = () => starts.push({ len: n.buffer.length, rate: n.playbackRate.value, loop: n.loop });
    n.stop = () => {};
    return n;
  }
  resume() { this.state = "running"; if (this.onstatechange) this.onstatechange(); return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
globalThis.window = { AudioContext: FakeAC, addEventListener() {}, removeEventListener() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };

// ------------------------------------------------------------------------------------------------ the sound block
const a = src.indexOf("// <sound>"), b = src.indexOf("// </sound>");
if (a < 0 || b < 0) { console.log("no sound block markers in render.js"); process.exit(1); }
const sfxMod = await import(path.join(ROOT, "sfx.js"));
let loadMode = "ok";
const __loadSfx = () => (loadMode === "ok" ? Promise.resolve(sfxMod) : Promise.reject(new Error("404")));
const block = src.slice(a, b).replace('() => import("./sfx.js")', "() => __loadSfx()");
const build = () => new Function("clamp", "__loadSfx", `"use strict"; ${block}; return { sfx, worldSound, SFX_MAP };`)(clamp, __loadSfx);

console.log("sound facade over sfx.js");
let { sfx, worldSound, SFX_MAP } = build();
await sleep(20);
ok(sfx.engine === "sfx.js", "engine is sfx.js", sfx.engine);
ok(sfx.play("laser") === false && starts.length === 0, "play() is false before the first gesture");
sfx.unlock(); await sleep(30);
ok(sfx.unlocked === true && sfx.ready === true, "unlock() inside a gesture: unlocked and ready");
const len = (name, opts) => sfxMod.renderSound(name, 24000, opts).length;
// every game name → the sfx.js sound it must start (buffer length identifies the recipe), rate where it is fixed
const cases = [
  ["click", "ui-tap"], ["pop", "hint"], ["hint", "hint"], ["unlock", "chest"], ["start", "countdown-go"], ["win", "win"], ["countdown", "countdown"], ["laser", "laser"],
  ["bossLaser", "laser", 0.6], ["hit", "hit"], ["crack", "crack"], ["drill", "drill"], ["dig", "dig"], ["land", "land"], ["touch", "land", 1.15], ["takeoff", "takeoff"], ["chest", "chest"],
  ["scan", "scan"], ["flare", "flare"], ["boost", "boost"], ["emp", "emp"], ["ink", "ink"], ["tractor", "tractor"], ["mine", "mine"], ["death", "death"], ["respawn", "respawn"], ["kill", "kill"],
  ["explosionBig", "explosion-large"], ["zap", "emp"],
];
for (const [name, key, rate] of cases) {
  const n0 = starts.length;
  const r = sfx.play(name, { volume: 0.6, ...(rate ? {} : {}) });
  await sleep(36);
  const s = starts[starts.length - 1];
  ok(r === true && starts.length === n0 + 1 && s.len === len(key) && (!rate || Math.abs(s.rate - rate) < 1e-9), `play("${name}") starts exactly one "${key}"${rate ? ` at rate ${rate}` : ""}`, JSON.stringify({ r, n: starts.length - n0, len: s && s.len, want: len(key), rate: s && s.rate }));
}
for (const [size, key] of [["small", "explosion-small"], ["medium", "explosion-medium"], ["large", "explosion-large"]]) {
  const n0 = starts.length;
  sfx.play("explosion", { size, volume: 0.6 }); await sleep(36);
  ok(starts.length === n0 + 1 && starts[starts.length - 1].len === len(key), `play("explosion", { size: "${size}" }) starts "${key}"`);
}
{ const n0 = starts.length; sfx.play("laser", { pitch: 1.5, volume: 0.5 }); await sleep(36); ok(starts.length === n0 + 1 && Math.abs(starts[starts.length - 1].rate - 1.5) < 1e-9, "pitch → rate (laser at 1.5)"); }
sfx.setMuted(true);
{ const n0 = starts.length; const r = sfx.play("laser"); await sleep(36); ok(r === false && starts.length === n0 && sfx.muted === true, "muted: nothing starts"); }
sfx.setMuted(false);
ok(sfx.unlocked === true, "unmuted again, still unlocked");

console.log("fallback synth when sfx.js 404s (and the engine is not built twice)");
{
  loadMode = "fail";
  const warn = console.warn; console.warn = () => {};
  const before = starts.length;
  const f = build(); await sleep(30);
  console.warn = warn;
  ok(f.sfx.engine === "synth", "sfx.js failed to load: the synth stands in", f.sfx.engine);
  ok(f.sfx.play("laser") === false, "synth: play() is false until unlocked (no context yet)");
  ok(starts.length === before, "the fallback never starts an sfx.js voice");
  loadMode = "ok";
}

// ------------------------------------------------------------------------------------------------ WorldSound: a count per event
console.log("WorldSound: one sound per event");
const played = [];
const origPlay = sfx.play.bind(sfx);
sfx.play = (n, o) => { played.push(n); return origPlay(n, o); };
const game = { screen: "phone", player: "me", snaps: { latest: null, latestAt: 0 } };
worldSound.attach(game);
const cam = { position: { x: 0, y: 0, z: 0 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
const me = { name: "me", x: 0, y: 0, z: 0, mode: "space", color: 0x3366ff, flags: {} };
const mk = (over = {}) => ({ players: [me, ...(over.players || [])], bullets: over.bullets || [], bossShots: [], flares: [], phase: over.phase || "playing" });
const ctx = () => ({ subject: me, mePlayer: me });
const tickWith = (over, mp) => { me.flags = mp || {}; worldSound.tick(mk(over), ctx(), cam, "space"); };
// one event → { names the facade was asked for, voices the engine started }
async function event(label, fn, wantNames, wantVoices = wantNames.length) {
  played.length = 0;
  const v0 = starts.length;
  fn();
  await sleep(36);
  const got = played.slice(), voices = starts.length - v0;
  ok(JSON.stringify(got) === JSON.stringify(wantNames) && voices === wantVoices, label, `asked ${JSON.stringify(got)} want ${JSON.stringify(wantNames)}; voices ${voices} want ${wantVoices}`);
}
const P = { x: 20, y: 0, z: -10 };
tickWith({}); // L ok
await event("fx emp near me: one emp", () => worldSound.fx({ kind: "emp", mode: "space", pos: P, color: 1, size: 3 }), ["emp"]);
await sleep(700);
await event("mischief emp (mine) then its fx within 600 ms: ONE emp", () => { worldSound.mischief({ kind: "emp", player: "me", from: "bob", seconds: 5 }); worldSound.fx({ kind: "emp", mode: "space", pos: me, color: 1, size: 3 }); }, ["emp"]);
await sleep(700);
await event("fx emp first, then the mischief message: ONE emp", () => { worldSound.fx({ kind: "emp", mode: "space", pos: me, color: 1, size: 3 }); worldSound.mischief({ kind: "emp", player: "me", from: "bob", seconds: 5 }); }, ["emp"]);
await sleep(700);
await event("mischief inkbomb + its fx: ONE ink", () => { worldSound.mischief({ kind: "inkbomb", player: "me", from: "bob", seconds: 4 }); worldSound.fx({ kind: "inkbomb", mode: "space", pos: me, color: 1, size: 3 }); }, ["ink"]);
await sleep(700);
await event("mischief tractor + its fx: ONE tractor", () => { worldSound.mischief({ kind: "tractor", player: "me", from: "bob", seconds: 3, dir: 1 }); worldSound.fx({ kind: "tractor", mode: "space", pos: me, color: 1, size: 3 }); }, ["tractor"]);
await sleep(700);
await event("mine hit: mischief + fx mine(size 3) + the explosion = one mine, one explosion", () => { worldSound.mischief({ kind: "mine", player: "me", from: "bob", seconds: 1.5, points: 30 }); worldSound.fx({ kind: "mine", mode: "space", pos: me, color: 1, size: 3 }); worldSound.fx({ kind: "explode", mode: "space", pos: P, color: 1, size: 4 }); }, ["mine", "explosion"]);
await sleep(700);
await event("mine dropped (fx size 1.5): one soft tick", () => worldSound.fx({ kind: "mine", mode: "space", pos: P, color: 1, size: 1.5 }), ["hit"]);
await event("decoy appears: one shimmer", () => worldSound.fx({ kind: "decoy", mode: "space", pos: P, color: 1, size: 3 }), ["scan"]);
await sleep(700);
await event("my decoy fooled someone (mischief with victim): one chime", () => worldSound.mischief({ kind: "decoy", player: "me", from: "me", victim: "bob", seconds: 0 }), ["chest"]);
await event("I shot a decoy (no victim): silent (its explosion is the fx)", () => worldSound.mischief({ kind: "decoy", player: "me", from: "bob", seconds: 0 }), [], 0);
await sleep(700);
// my death and respawn
await event("my ship goes down: one death", () => tickWith({}, { dead: true }), ["death"]);
await event("still down next tick: nothing", () => tickWith({}, { dead: true }), [], 0);
await event("my explosion fx: one explosion (not a second death)", () => worldSound.fx({ kind: "explode", mode: "space", pos: me, color: 0x3366ff, size: 8 }), ["explosion"]);
await event("back: one respawn (flag edge)", () => tickWith({}, {}), ["respawn"]);
await event("the respawn fx of MY colour adds nothing", () => worldSound.fx({ kind: "respawn", mode: "space", pos: me, color: 0x3366ff, size: 3 }), [], 0);
await event("another player's respawn fx: one respawn", () => worldSound.fx({ kind: "respawn", mode: "space", pos: P, color: 0xff00ff, size: 3 }), ["respawn"]);
await event("a decoy that ran out (respawn fx size 2): silent", () => worldSound.fx({ kind: "respawn", mode: "space", pos: P, color: 0xff00ff, size: 2 }), [], 0);
// my kills
await event('announce "me ✕ bob 💣": one kill', () => worldSound.announce({ type: "announce", text: "me ✕ bob 💣" }), ["kill"]);
await event('announce "bob ✕ me": nothing', () => worldSound.announce({ type: "announce", text: "bob ✕ me" }), [], 0);
await event('announce "me2 ✕ bob" (another player): nothing', () => worldSound.announce({ type: "announce", text: "me2 ✕ bob" }), [], 0);
// phases and ticks
await event("lobby → playing: one start", () => { worldSound.phase = "lobby"; tickWith({ phase: "playing" }); }, ["start"]);
await event("playing → playing: nothing", () => tickWith({ phase: "playing" }), [], 0);
await event("playing → scoreboard: one win", () => tickWith({ phase: "scoreboard" }), ["win"]);
await event("scoreboard → scoreboard: nothing", () => tickWith({ phase: "scoreboard" }), [], 0);
// v1.4: START plays the server's 3-2-1 first (phase "countdown", contract.js ROUND.countdownSeconds): lobby → countdown → playing.
// The pages beep each number; the start fanfare is render.js's, once, at GO (space.html and controller.html never play it).
await event("v1.4 lobby → countdown: nothing yet (the pages beep the 3-2-1)", () => { worldSound.phase = "lobby"; tickWith({ phase: "countdown" }); }, [], 0);
await event("v1.4 countdown → playing (GO!): one start", () => tickWith({ phase: "playing" }), ["start"]);
tickWith({ phase: "playing" });
// v1.6: the TV page plays its own podium fanfare (space.html startGame({ winJingle: false })): render.js plays no "win" there
game.winJingle = false;
await event("v1.6 winJingle false (the TV): playing → scoreboard plays no win", () => tickWith({ phase: "scoreboard" }), [], 0);
delete game.winJingle;
worldSound.phase = "lobby";
tickWith({ phase: "playing" });
await sleep(40);
await event("boost on: one boost", () => tickWith({}, { boost: true }), ["boost"]);
await event("boost held: nothing", () => tickWith({}, { boost: true }), [], 0);
await event("a new bullet: one laser; the same bullet next tick: none", () => { tickWith({ bullets: [[7, 5, 0, -5, 0x3366ff, 0]] }); tickWith({ bullets: [[7, 6, 0, -6, 0x3366ff, 0]] }); }, ["laser"]);
for (const [size, key] of [[2, "explosion-small"], [8, "explosion-medium"], [20, "explosion-large"]]) {
  const n0 = starts.length;
  played.length = 0;
  worldSound.fx({ kind: "explode", mode: "space", pos: P, color: 1, size }); await sleep(36);
  ok(starts.length === n0 + 1 && starts[starts.length - 1].len === len(key), `explode size ${size} starts "${key}" once`, `${played}`);
}
await event("an event in the other world is silent", () => worldSound.fx({ kind: "emp", mode: "planet", pos: P, color: 1, size: 3 }), [], 0);
await event("a far event (900 m) is silent", () => worldSound.fx({ kind: "emp", mode: "space", pos: { x: 900, y: 0, z: 0 }, color: 1, size: 3 }), [], 0);
{
  // panning: a sound on the right of the screen pans right, on the left pans left
  let pan = null; sfx.play = (n, o) => { pan = o.pan; return true; };
  worldSound.fx({ kind: "hit", mode: "space", pos: { x: 30, y: 0, z: -30 }, color: 1, size: 1 }); const right = pan;
  worldSound.fx({ kind: "hit", mode: "space", pos: { x: -30, y: 0, z: -30 }, color: 1, size: 1 }); const left = pan;
  ok(right > 0.2 && left < -0.2, "pan follows the screen side", `right ${right} left ${left}`);
  sfx.play = (n, o) => { played.push(n); return origPlay(n, o); };
}
// the TV: no personal sounds, no kill, no death edge
{
  const tv = build(); await sleep(20); tv.sfx.unlock(); await sleep(30);
  const names = []; tv.sfx.play = (n) => { names.push(n); return true; };
  tv.worldSound.attach({ screen: "big", player: null, snaps: { latest: null, latestAt: 0 } });
  tv.worldSound.announce({ text: "me ✕ bob" });
  tv.worldSound.tick({ players: [{ ...me, flags: { dead: true } }], bullets: [], bossShots: [], flares: [], phase: "playing" }, { subject: { ...me, flags: {} }, mePlayer: null }, cam, "space");
  ok(names.length === 0, "TV: no kill sound and no death edge", JSON.stringify(names));
}

// ------------------------------------------------------------------------------------------------ the governor
console.log("quality governor (class Perf)");
const g0 = src.indexOf("const TIERS = ["), g1 = src.indexOf("// HUD model (game.hud()).");
const govSrc = src.slice(g0, g1);
const Perf = new Function("clamp", `${govSrc}; return { Perf, TIERS, STEP_DOWN_MS };`)(clamp);
const run = (frames, pin) => { // frames: [dtMs, workMs]
  const p = new Perf.Perf(); if (pin !== undefined) p.pin = pin;
  let t = 0, changes = 0;
  for (const [dt, w] of frames) { t += dt / 1000; if (p.frame(dt, w, t)) changes++; }
  return { tier: p.tier, changes, capped: p.capped };
};
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i));
ok(Perf.STEP_DOWN_MS === 20, "step-down threshold is 20 ms");
{ const r = run(rep(600, (i) => [i % 10 === 9 ? 18.6 : 16.7, 5])); ok(r.tier === 0, "a 60 Hz screen at p90 18.6 ms does NOT step down", JSON.stringify(r)); }
{ const r = run(rep(300, () => [24, 12])); ok(r.tier > 0, "steady 24 ms frames with real CPU work step down", JSON.stringify(r)); }
{ const r = run(rep(900, () => [33.3, 3])); ok(r.tier === 0 && r.capped, "a steady 30 Hz cap (33.3 ms, CPU 3 ms) does NOT step down", JSON.stringify(r)); }
{ const r = run(rep(900, () => [33.3, 14])); ok(r.tier > 0, "30 Hz frames with heavy CPU work (14 ms) DO step down", JSON.stringify(r)); }
{ const r = run(rep(900, (i) => [i % 3 === 0 ? 50 : 17, 5])); ok(r.tier > 0, "an uneven 17/50 ms trace is slow (not a clean 30 Hz cap): step down", JSON.stringify(r)); }
{ const r = run(rep(900, () => [40, 3])); ok(r.tier > 0, "steady 40 ms (p90 over 36) is too slow even if the CPU is idle: step down", JSON.stringify(r)); }
{ const r = run(rep(2000, (i) => [i < 400 ? 26 : 16, 4])); ok(r.tier >= 1 && r.changes >= 2, "steps down, then climbs back after 5 s of headroom", JSON.stringify(r)); }
{ const r = run(rep(300, () => [60, 20]), 0); ok(r.tier === 0 && r.changes === 0, "pinned tier 0 never moves", JSON.stringify(r)); }
{ const r = run(rep(10, () => [16.7, 5]), 3); ok(r.tier === 3, "pin sets the tier", JSON.stringify(r)); }

console.log(`\n${fails ? "FAIL" : "PASS"}: ${checks - fails}/${checks} checks`);
process.exit(fails ? 1 : 0);
