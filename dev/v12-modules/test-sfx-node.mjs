// Node checks for sfx.js. Run: node dev/v12-modules/test-sfx-node.mjs
//   1. every sound renders (24 kHz): duration range, finite, peak, RMS, quiet first / last 2 ms, deterministic
//   2. the loop variants are seamless (no jump at the seam)
//   3. the engine against a mocked AudioContext: unlock, throttle, voice stealing, loops, mute, dispose
// Exit code 0 only if everything passes.

import { SOUNDS, LOOPS, renderSound, createSfx } from "../../sfx.js";

const SR = 24000;
let failures = 0;
const fail = (msg) => { failures++; console.log("  FAIL  " + msg); };
const check = (ok, msg) => { if (!ok) fail(msg); return ok; };

// expected duration range in seconds (the brief: laser ~0.15, ui-tap ~0.04, explosions 0.35 / 0.8 / 1.6, win ~1.8,
// chest ~1, kill ~0.5, countdown ~0.12, go ~0.35); extras are looser
const EXPECT = {
  laser: [0.12, 0.2], explosion: [0.6, 1.0], boost: [0.6, 1.0], shield: [0.5, 0.9], drill: [0.5, 1.0], dig: [0.45, 0.8],
  land: [0.4, 0.8], takeoff: [1.0, 1.5], chest: [0.85, 1.25], kill: [0.4, 0.6], emp: [0.35, 0.7], ink: [0.4, 0.7],
  tractor: [0.5, 1.0], mine: [0.5, 0.9], "ui-tap": [0.03, 0.06], hint: [0.45, 0.8], countdown: [0.09, 0.16], win: [1.6, 2.0],
  "explosion-small": [0.3, 0.4], "explosion-medium": [0.7, 0.9], "explosion-large": [1.4, 1.8], "countdown-go": [0.3, 0.42],
  hit: [0.1, 0.2], crack: [0.35, 0.65], scan: [0.6, 1.0], flare: [0.4, 0.7], death: [0.6, 1.0], respawn: [0.55, 0.9],
  // v1.3: the steal sting and MY hit-confirm tick; v1.5 (TV only, built on first play): lobby hangar card pop, podium
  // block, results fanfare, star, and the lobby ambience (an 8 s pad, faded in and out)
  steal: [0.5, 0.75], hitmark: [0.09, 0.15], "card-pop": [0.3, 0.45], podium: [0.5, 0.7], fanfare: [1.7, 2.1], star: [1.3, 1.6],
  ambience: [7.5, 8.5],
};
// Sounds whose designed attack is shorter than the 2 ms quiet-onset window: check a shorter window (still no step at 0).
// hitmark is "a crisp, dry confirm on a tiny click" with a 2 ms attack (sfx.js hitmark: finish({ attack: 0.002 })).
const ONSET = { hitmark: 0.001 };
// Loop lengths: the held actions loop in 0.6-2.2 s; the TV lobby's ambience is a slow 8 s pad (sfx.js ambienceLoop).
const LOOP_LEN = { ambience: [7.5, 8.5] };
// Not pre-rendered at idle (sfx.js ORDER): "explosion" (an alias of explosion-medium) and the v1.5 TV-only sounds,
// built on first play so phones never render them.
const TV_ONLY = ["card-pop", "podium", "fanfare", "star", "ambience"];

function stats(x, onset = 0.002) {
  let pk = 0, ss = 0, bad = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v);
    if (a > pk) pk = a;
    ss += v * v;
  }
  const e = Math.round(0.002 * SR), eOn = Math.round(onset * SR);
  let first = 0, last = 0;
  for (let i = 0; i < e; i++) { if (i < eOn) first = Math.max(first, Math.abs(x[i])); last = Math.max(last, Math.abs(x[x.length - 1 - i])); }
  return { dur: x.length / SR, pk, rms: Math.sqrt(ss / x.length), bad, first, last };
}
const equal = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

// ------------------------------------------------------------------------------------------- 1. one-shots
console.log("sfx.js render check, " + SR + " Hz, " + SOUNDS.length + " sounds\n");
console.log("name".padEnd(18) + "dur s".padStart(7) + "  want s".padEnd(14) + "peak".padStart(7) + "rms".padStart(7) + "first2ms".padStart(10) + "last2ms".padStart(9) + "  ms");

const rendered = {}, perMs = {};
const tAll = performance.now();
for (const name of SOUNDS) {
  const t = performance.now();
  rendered[name] = renderSound(name, SR);
  perMs[name] = performance.now() - t;
}
const totalMs = performance.now() - tAll;

check(SOUNDS.length === new Set(SOUNDS).size, "SOUNDS has duplicates");
for (const base of ["laser", "explosion", "boost", "shield", "drill", "dig", "land", "takeoff", "chest", "kill", "emp", "ink", "tractor", "mine", "ui-tap", "hint", "countdown", "win", "explosion-small", "explosion-medium", "explosion-large", "countdown-go"]) {
  check(SOUNDS.includes(base), "SOUNDS misses " + base);
}

for (const name of SOUNDS) {
  const x = rendered[name], s = stats(x, ONSET[name]), want = EXPECT[name];
  const before = failures;
  check(Float32Array.prototype.isPrototypeOf(x) || x instanceof Float32Array, name + ": not a Float32Array");
  check(!!want, name + ": no expected duration in the test");
  if (want) check(s.dur >= want[0] && s.dur <= want[1], name + ": duration " + s.dur.toFixed(3) + " outside " + want.join("-"));
  check(s.bad === 0, name + ": " + s.bad + " NaN / Infinity samples");
  check(s.pk >= 0.5 && s.pk <= 1.0, name + ": peak " + s.pk.toFixed(3) + " outside 0.5-1.0");
  check(s.rms > 0.02, name + ": rms " + s.rms.toFixed(3) + " too low");
  check(s.first < 0.05, name + ": first " + ((ONSET[name] || 0.002) * 1000) + " ms reach " + s.first.toFixed(3));
  check(s.last < 0.05, name + ": last 2 ms reach " + s.last.toFixed(3));
  check(equal(x, renderSound(name, SR)), name + ": two renders differ (not deterministic)");
  console.log(
    name.padEnd(18) + s.dur.toFixed(3).padStart(7) + ("  " + (want ? want.join("-") : "?")).padEnd(14) + s.pk.toFixed(3).padStart(7) +
      s.rms.toFixed(3).padStart(7) + s.first.toFixed(3).padStart(10) + s.last.toFixed(3).padStart(9) + perMs[name].toFixed(1).padStart(6) + (failures > before ? "  <<<" : ""),
  );
}

const sm = rendered["explosion-small"].length, md = rendered["explosion-medium"].length, lg = rendered["explosion-large"].length;
check(sm < md && md < lg, "explosion sizes not ordered: " + [sm, md, lg].join(" < "));
check(equal(renderSound("explosion", SR, { size: "small" }), rendered["explosion-small"]), "explosion {size:small} != explosion-small");
check(equal(renderSound("explosion", SR, { size: "large" }), rendered["explosion-large"]), "explosion {size:large} != explosion-large");
check(equal(renderSound("explosion", SR), rendered["explosion-medium"]), "explosion default != explosion-medium");
check(renderSound("no-such-sound", SR).length === 0, "unknown name should give an empty array");
check(renderSound("laser", 48000).length > 7000 && renderSound("laser", 48000).length < 8400, "laser at 48 kHz has the wrong length");
console.log("\nexplosion lengths: small " + sm + " < medium " + md + " < large " + lg + " samples (" + (sm / SR).toFixed(2) + " / " + (md / SR).toFixed(2) + " / " + (lg / SR).toFixed(2) + " s)");
const totalSec = Object.values(rendered).reduce((n, x) => n + x.length / SR, 0);
console.log("total render time, all " + SOUNDS.length + " sounds (" + totalSec.toFixed(1) + " s of audio): " + totalMs.toFixed(1) + " ms (limit 400)");
check(totalMs < 400, "total render time " + totalMs.toFixed(0) + " ms >= 400 ms");

// ------------------------------------------------------------------------------------------- 2. loops
console.log("\nloop variants (seamless)");
for (const name of LOOPS) {
  const x = renderSound(name, SR, { loop: true }), s = stats(x), N = x.length;
  const d2 = new Float32Array(N);
  for (let i = 0; i < N; i++) d2[i] = x[(i + 1) % N] - 2 * x[i] + x[(i + N - 1) % N]; // wraps around the seam
  const sorted = Array.from(d2, Math.abs).sort((a, b) => a - b), p99 = sorted[Math.floor(N * 0.99)];
  const seam = Math.max(Math.abs(d2[0]), Math.abs(d2[N - 1]));
  const before = failures;
  check(s.bad === 0, "loop " + name + ": NaN");
  const len = LOOP_LEN[name] || [0.6, 2.2];
  check(s.dur >= len[0] && s.dur <= len[1], "loop " + name + ": length " + s.dur.toFixed(2) + " s outside " + len.join("-"));
  check(s.pk >= 0.5 && s.pk <= 1.0, "loop " + name + ": peak " + s.pk.toFixed(2));
  check(s.rms > 0.05, "loop " + name + ": rms " + s.rms.toFixed(3));
  check(seam <= 1.5 * p99 + 1e-6, "loop " + name + ": seam jump " + seam.toFixed(3) + " vs p99 " + p99.toFixed(3));
  check(equal(x, renderSound(name, SR, { loop: true })), "loop " + name + ": not deterministic");
  console.log("  " + name.padEnd(9) + s.dur.toFixed(2) + " s  peak " + s.pk.toFixed(2) + "  rms " + s.rms.toFixed(3) + "  seam d2 " + seam.toFixed(3) + " (p99 " + p99.toFixed(3) + ")" + (failures > before ? "  <<<" : ""));
}

// ----------------------------------------------------------------------------------------- 3. engine (mock)
console.log("\nengine against a mocked AudioContext");

class Param {
  constructor(v = 1) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(["set", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(["ramp", v, t]); return this; }
  setTargetAtTime(v, t, k) { this.events.push(["target", v, t, k]); this.value = v; return this; }
  cancelScheduledValues(t) { this.events.push(["cancel", t]); return this; }
}
class MockNode {
  constructor(ctx) { this.ctx = ctx; this.out = []; }
  connect(n) { this.out.push(n); return n; }
  disconnect() { this.out = []; }
}
class MockGain extends MockNode { constructor(c) { super(c); this.gain = new Param(1); } }
class MockPanner extends MockNode { constructor(c) { super(c); this.pan = new Param(0); } }
class MockComp extends MockNode {
  constructor(c) { super(c); for (const k of ["threshold", "knee", "ratio", "attack", "release"]) this[k] = new Param(0); }
}
class MockSource extends MockNode {
  constructor(c) { super(c); this.buffer = null; this.loop = false; this.playbackRate = new Param(1); this.startedAt = null; this.stoppedAt = null; this.onended = null; }
  start(w) { if (this.startedAt !== null) throw new Error("InvalidStateError: start twice"); this.startedAt = w || 0; this.ctx.sources.push(this); }
  stop(w) { if (this.startedAt === null) throw new Error("InvalidStateError: stop before start"); this.stoppedAt = w === undefined ? 0 : w; }
}
class MockCtx {
  constructor() { this.state = "suspended"; this.currentTime = 0; this.sampleRate = 48000; this.destination = new MockNode(this); this.sources = []; this.buffers = []; this.gains = []; this.panners = []; this.resumeCalls = 0; this.closed = false; this.onstatechange = null; }
  createGain() { const g = new MockGain(this); this.gains.push(g); return g; }
  createStereoPanner() { const p = new MockPanner(this); this.panners.push(p); return p; }
  createDynamicsCompressor() { return new MockComp(this); }
  createBufferSource() { if (MockCtx.failSource) throw new Error("boom"); return new MockSource(this); }
  createBuffer(ch, len, sr) {
    if (sr < 22050 || sr > 96000) throw new Error("NotSupportedError");
    const b = { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, data: new Float32Array(len), getChannelData() { return this.data; } };
    this.buffers.push(b);
    return b;
  }
  resume() {
    this.resumeCalls++;
    if (!globalThis.window.__gesture) return new Promise(() => {}); // like Safari / Chrome: pending until a gesture
    return Promise.resolve().then(() => { this.state = "running"; if (this.onstatechange) this.onstatechange(); });
  }
  close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }
}

const listeners = [];
const docListeners = [];
const win = {
  AudioContext: MockCtx,
  __gesture: false,
  addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }); },
  removeEventListener(type, fn) { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
};
const doc = { hidden: false, addEventListener(t, fn) { docListeners.push({ t, fn }); }, removeEventListener(t, fn) { const i = docListeners.findIndex((l) => l.t === t && l.fn === fn); if (i >= 0) docListeners.splice(i, 1); } };
const realPerf = Object.getOwnPropertyDescriptor(globalThis, "performance");
let clock = 1000;
const fire = (type) => { win.__gesture = true; for (const l of listeners.filter((x) => x.type === type)) l.fn({ type }); };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function engine() {
  // 3a. without window / AudioContext it is inert and never throws
  const inert = createSfx();
  check(inert.play("laser") === false, "inert play should return false");
  check(typeof inert.loop("drill").stop === "function", "inert loop handle");
  inert.loop("drill").stop(); inert.loop("drill").setPan(0.5); inert.loop("drill").setVolume(0.2);
  await inert.unlock();
  await inert.ready;
  check(inert.ctx === null && inert.unlocked === false, "inert ctx / unlocked");
  inert.setVolume(0.4); inert.mute(true);
  check(inert.volume === 0.4 && inert.muted === true, "inert volume / mute round trip");
  inert.dispose();
  console.log("  ok    inert (no window): play false, loop handle, unlock and ready resolve, no throw");

  // 3b. mocked browser
  globalThis.window = win;
  globalThis.document = doc;
  Object.defineProperty(globalThis, "navigator", { value: { audioSession: {} }, configurable: true });
  const sfx = createSfx({ volume: 0.7, voices: 4 });
  const ctx = sfx.ctx;
  check(ctx instanceof MockCtx, "ctx is the AudioContext");
  check(sfx.volume === 0.7 && sfx.muted === false && sfx.unlocked === false, "initial volume / muted / unlocked");
  check(globalThis.navigator.audioSession.type === "playback", "navigator.audioSession.type should be playback, got " + globalThis.navigator.audioSession.type);
  const want = ["pointerdown", "touchend", "click", "keydown"];
  check(want.every((t) => listeners.some((l) => l.type === t && l.opts && l.opts.capture === true && l.opts.passive === true)), "gesture listeners (capture + passive) for " + want.join(", "));
  check(sfx.play("laser") === false && ctx.sources.length === 0, "play before unlock must return false and do nothing");
  check(sfx.loop("drill").stop() === undefined && ctx.sources.length === 0, "loop before unlock is a no-op handle");

  // idle render: does not finish synchronously, finishes soon after
  const tRender = performance.now();
  check(ctx.buffers.length < 5, "buffers must not all be rendered synchronously inside createSfx (" + ctx.buffers.length + ")");
  await sfx.ready;
  const renderWall = performance.now() - tRender;
  const nBuf = ctx.buffers.length;
  const wantBuf = SOUNDS.filter((n) => n !== "explosion" && !TV_ONLY.includes(n)).length + LOOPS.filter((n) => !TV_ONLY.includes(n)).length;
  check(nBuf === wantBuf, "pre-rendered buffers: expected " + wantBuf + " (no TV-only sounds), got " + nBuf);
  check(ctx.buffers.every((b) => b.sampleRate === 24000 && b.numberOfChannels === 1 && b.length > 0), "buffers are mono 24 kHz and not empty");
  check(ctx.buffers.every((b) => b.data.every((v) => Number.isFinite(v))), "buffer data finite");
  check(ctx.buffers.some((b) => b.data.some((v) => v !== 0)), "buffer data copied");
  console.log("  ok    idle pre-render: " + nBuf + " buffers (mono, 24 kHz) in " + renderWall.toFixed(0) + " ms wall, in chunks");

  // iOS: pointerdown is not an audio gesture, so resume() hangs; the touchend right after it must still unlock
  win.__gesture = false;
  for (const l of listeners.filter((x) => x.type === "pointerdown")) l.fn({ type: "pointerdown" });
  await tick(5);
  check(sfx.unlocked === false && listeners.length > 0, "an invalid first gesture leaves audio locked and the listeners armed");
  const callsBefore = ctx.resumeCalls;

  // unlock by gesture: resume() inside the event, silent 1-sample buffer, listeners removed afterwards
  const before = ctx.sources.length;
  fire("touchend"); // resume() is called inside the gesture, while the first attempt is still pending
  check(ctx.resumeCalls === callsBefore + 1, "resume() must be called again inside the next gesture even while the first attempt is pending");
  await tick(5);
  check(sfx.unlocked === true && ctx.state === "running", "unlocked after the first gesture");
  check(listeners.length === 0, "gesture listeners should be removed once running (" + listeners.length + " left)");
  const silent = ctx.sources.slice(before).find((s) => s.buffer && s.buffer.length === 1);
  check(!!silent && silent.startedAt === 0, "iOS unlock: a silent one-sample buffer started");
  console.log("  ok    unlock: a failed first gesture (pointerdown) does not block the touchend after it; silent buffer; listeners removed");
  check((await sfx.unlock()) === undefined, "unlock() resolves to undefined when already unlocked");

  // swap in a fake clock for throttle / voice tests
  Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true });
  const advance = (ms) => { clock += ms; };

  // 3c. every sound plays once
  const results = {};
  for (const n of SOUNDS) { results[n] = sfx.play(n, { pan: -0.4, volume: 0.9 }); advance(40); }
  check(Object.values(results).every((v) => v === true), "play() should be true for every sound: " + Object.entries(results).filter(([, v]) => !v).map(([k]) => k).join(", "));
  check(sfx.play("nope") === false, "unknown name -> false");
  advance(40);
  const lenOf = (opts) => { const n0 = ctx.sources.length; sfx.play("explosion", opts); advance(40); return ctx.sources[n0].buffer.length; };
  const eS = lenOf({ size: "small" }), eM = lenOf({ size: "medium" }), eL = lenOf({ size: "large" }), eD = lenOf({});
  check(eS < eM && eM < eL && eD === eM, "explosion sizes pick different buffers: " + [eS, eM, eL, eD].join(" "));
  const last = ctx.sources[ctx.sources.length - 1];
  check(last.out.length === 1 && last.out[0] instanceof MockGain, "source connects to a pooled voice gain");
  const voice = last.out[0], pan = voice.out[0];
  check(pan instanceof MockPanner && pan.out[0] === ctx.gains[0], "voice chain is gain -> panner -> master");
  console.log("  ok    play: true for all " + SOUNDS.length + " names, unknown -> false, explosion sizes " + [eS, eM, eL].join(" < "));

  // pan / volume / rate land on the chain
  advance(40);
  sfx.play("hint", { pan: 5, volume: 0.5, rate: 2 });
  let s = ctx.sources[ctx.sources.length - 1];
  const g = s.out[0].gain.value, p = s.out[0].out[0].pan.value;
  check(p === 1, "pan clamps to 1, got " + p);
  check(g > 0 && g < 1, "voice gain set from volume x trim: " + g);
  check(s.playbackRate.value === 2, "rate 2 -> playbackRate 2");
  advance(40);
  sfx.play("hint", { pan: -5, volume: 7 });
  s = ctx.sources[ctx.sources.length - 1];
  check(s.out[0].out[0].pan.value === -1, "pan clamps to -1");
  check(s.out[0].gain.value >= g, "volume clamps to 1 (louder than 0.5)");
  console.log("  ok    pan, volume and rate applied to the voice chain and clamped");

  // throttle: the same sound at most once per 30 ms
  advance(100);
  const a = sfx.play("laser"), b = sfx.play("laser");
  advance(10);
  const c = sfx.play("laser");
  advance(25);
  const d = sfx.play("laser");
  const e = sfx.play("hit"); // a different name is not throttled by laser
  check(a === true && b === false && c === false && d === true && e === true, "throttle pattern " + [a, b, c, d, e].join(","));
  console.log("  ok    throttle: 1 per 30 ms per sound (true,false,false,true; other names unaffected)");

  // voice stealing: 4 voices, all busy (ctx time frozen) -> oldest ducked 4 ms, then the new sound starts
  advance(100);
  const names = ["win", "chest", "takeoff", "boost", "tractor", "kill", "mine", "emp"];
  const start = ctx.sources.length;
  const played = names.map((n, i) => { ctx.currentTime = 50 + 0.001 * i; advance(35); return sfx.play(n); }); // audio time moves 1 ms per play
  check(played.every(Boolean), "all plays under voice pressure return true");
  const fresh = ctx.sources.slice(start);
  check(fresh.length === 8, "8 sources created");
  check(fresh.slice(0, 4).every((x) => x.startedAt === 0), "first 4 voices start immediately");
  const stoppedEarly = fresh.slice(0, 4).filter((x) => x.stoppedAt !== null);
  check(stoppedEarly.length === 4, "each of the 4 oldest sources was stopped when stolen (" + stoppedEarly.length + ")");
  // play k (4..7) steals at audio time 50 + 0.001 k: the oldest voice first
  check(fresh.slice(0, 4).every((x, k) => Math.abs(x.stoppedAt - (50 + 0.001 * (k + 4) + 0.004)) < 1e-9), "stolen sources stop after a 4 ms duck, oldest first");
  check(fresh.slice(4).every((x, k) => Math.abs(x.startedAt - (50 + 0.001 * (k + 4) + 0.005)) < 1e-9), "stealing sounds start 5 ms later");
  check(ctx.gains.some((gn) => gn.gain.events.some((ev) => ev[0] === "ramp" && ev[1] === 0)), "duck ramp to 0 on the stolen voice gain");
  check(new Set(fresh.map((x) => x.out[0])).size === 4, "only the 4 pooled voice chains are used");
  check(fresh.slice(4).every((x, k) => x.out[0] === fresh[k].out[0]), "each new sound takes over the voice of the oldest one");
  console.log("  ok    voice stealing: 4 voices, 8 plays, oldest ducked 4 ms and stopped, new ones start at +5 ms");

  // free voices are reused round-robin once their sounds ended
  ctx.currentTime = 500;
  advance(100);
  const rr = [];
  for (const n of ["hit", "hint", "countdown", "ui-tap", "laser"]) { advance(40); sfx.play(n); rr.push(ctx.sources[ctx.sources.length - 1].out[0]); }
  check(new Set(rr.slice(0, 4)).size === 4, "round-robin uses 4 different voices in a row");
  check(rr[4] === rr[0], "5th play wraps to the first voice");
  console.log("  ok    round-robin over free voices");

  // 3d. loops
  advance(100);
  const n0 = ctx.sources.length;
  const h = sfx.loop("drill", { pan: 0.3, volume: 0.6 });
  const ls = ctx.sources[n0];
  check(ctx.sources.length === n0 + 1 && ls.loop === true && ls.startedAt === 0, "loop starts a looping source");
  check(ls.buffer.length === renderSound("drill", SR, { loop: true }).length, "drill loop uses the loop variant buffer");
  check(typeof h.stop === "function" && typeof h.setPan === "function" && typeof h.setVolume === "function", "loop handle has stop / setPan / setVolume");
  h.setPan(-0.5); h.setVolume(0.2);
  check(ls.out[0].out[0].pan.events.some((ev) => ev[0] === "target" && ev[1] === -0.5), "setPan schedules a smooth pan");
  check(ls.out[0].gain.events.some((ev) => ev[0] === "target" && ev[1] > 0 && ev[1] < 0.6), "setVolume schedules a smooth gain");
  ctx.currentTime = 600;
  h.stop(0.1);
  check(ls.stoppedAt !== null && ls.stoppedAt > 600 && ls.stoppedAt < 600.5, "stop(fade) stops the source after the fade: " + ls.stoppedAt);
  h.stop(); h.setPan(0); h.setVolume(1); // idempotent
  const chainGain = ls.out[0];
  ls.onended && ls.onended();
  const h2 = sfx.loop("dig");
  check(ctx.sources[ctx.sources.length - 1].out[0] === chainGain, "loop chain is recycled after the loop ended");
  h2.stop(0.05);
  const hl = sfx.loop("laser"); // a one-shot name loops its one-shot
  check(ctx.sources[ctx.sources.length - 1].loop === true && ctx.sources[ctx.sources.length - 1].buffer.length === rendered.laser.length, "loop(non loop name) repeats the one-shot");
  hl.stop();
  check(sfx.loop("nope") && typeof sfx.loop("nope").stop === "function", "loop(unknown) returns a no-op handle");
  const hs = [];
  const nBefore = ctx.sources.length;
  for (let i = 0; i < 10; i++) hs.push(sfx.loop("boost"));
  const stoppedLoops = ctx.sources.slice(nBefore).filter((x) => x.stoppedAt !== null).length;
  check(stoppedLoops >= 2, "at most 8 loops at once: the oldest are stopped (" + stoppedLoops + ")");
  hs.forEach((x) => x.stop(0.01));
  console.log("  ok    loops: looping source, setPan / setVolume, stop fades and is idempotent, chain recycled, max 8");

  // 3e. volume / mute
  sfx.setVolume(0.33);
  check(sfx.volume === 0.33, "setVolume round trip");
  sfx.setVolume(7);
  check(sfx.volume === 1, "volume clamps to 1");
  sfx.setVolume(-2);
  check(sfx.volume === 0, "volume clamps to 0");
  sfx.setVolume(0.5);
  sfx.mute(true);
  check(sfx.muted === true, "mute(true)");
  advance(100);
  check(sfx.play("hit") === false, "play while muted does nothing");
  sfx.mute(false);
  check(sfx.muted === false && sfx.volume === 0.5, "mute(false) restores");
  advance(100);
  check(sfx.play("hit") === true, "play after unmute");
  console.log("  ok    setVolume / mute round trip, clamping, silent while muted");

  // 3f. never throws
  advance(100);
  MockCtx.failSource = true;
  let threw = false, r1, r2;
  try { r1 = sfx.play("laser"); r2 = sfx.loop("drill"); r2.stop(); } catch { threw = true; }
  MockCtx.failSource = false;
  check(!threw && r1 === false, "play / loop must not throw when the engine fails");
  let threw2 = false;
  try { sfx.play(); sfx.play(null); sfx.play(42, null); sfx.play("laser", { pan: NaN, volume: NaN, rate: NaN }); sfx.loop(); sfx.loop(undefined, 5); } catch { threw2 = true; }
  check(!threw2, "play / loop with junk arguments must not throw");
  console.log("  ok    never throws (engine failure, junk arguments)");

  // 3g. interruption: the context goes away (iOS call, tab hidden) -> locked again until the next gesture
  ctx.state = "interrupted";
  ctx.onstatechange();
  check(sfx.unlocked === false, "unlocked false when the context is interrupted");
  advance(100);
  check(sfx.play("laser") === false, "no sound while interrupted");
  check(listeners.length > 0, "gesture listeners re-armed after an interruption");
  win.__gesture = true;
  fire("touchend");
  await tick(5);
  check(sfx.unlocked === true && ctx.state === "running", "next gesture unlocks again");
  console.log("  ok    interruption: locks, re-arms the gesture listeners, unlocks on the next tap");

  // 3h. dispose
  sfx.dispose();
  check(ctx.closed === true && listeners.length === 0 && docListeners.length === 0, "dispose closes the context and removes listeners");
  check(sfx.play("laser") === false && typeof sfx.loop("drill").stop === "function", "play after dispose is false");
  sfx.dispose();
  console.log("  ok    dispose: context closed, listeners removed, play is false");
}

try {
  await engine();
} catch (err) {
  fail("engine suite crashed: " + (err && err.stack ? err.stack : err));
} finally {
  if (realPerf) Object.defineProperty(globalThis, "performance", realPerf);
}

console.log("\n" + (failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)") + "  (render total " + totalMs.toFixed(1) + " ms for " + totalSec.toFixed(1) + " s of audio)");
process.exit(failures === 0 ? 0 : 1);
