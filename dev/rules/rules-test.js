"use strict";
const assert = require("assert");
const { createHints, createBudget, ghostBox, lateHint } = require("../../rules.js");

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok  " + name); };

const layout = { buttons: [
  { type: "stick", action: "steer", label: "", x: 0.02, y: 0.5, w: 0.3, h: 0.45 },
  { type: "button", action: "fire", label: "FIRE", x: 0.75, y: 0.6, w: 0.2, h: 0.3 },
] };

function rig() {
  let t = 0;
  const hints = createHints({ now: () => t });
  const tickTo = (player, ms, args) => {
    let out = null;
    while (t < ms) { t = Math.min(ms, t + 500); out = hints.update(player, args) || out; }
    return out;
  };
  return { hints, advance: (ms) => (t += ms), get t() { return t; }, tickTo };
}
const A = { gate: "drill", active: true, hasControl: false, assists: false, layout };

test("ladder timings: 6s riddle, +10s sketch, +15s answer with ghost", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  const seen = [];
  for (t = 0; t <= 40000; t += 100) {
    const toast = hints.update("ana", A);
    if (toast) seen.push({ at: t, toast });
  }
  assert.deepStrictEqual(seen.map((s) => s.at), [6000, 16000, 31000]);
  assert.strictEqual(seen[0].toast.text, "Your drill is ready. What starts it?");
  assert.strictEqual(seen[0].toast.sketch, null);
  assert.strictEqual(seen[1].toast.sketch, "drill");
  assert.strictEqual(seen[2].toast.text, "Draw DRILL");
  assert.strictEqual(seen[2].toast.ghost.action, "drill");
  assert.strictEqual(seen[2].toast.type, "toast");
  assert.strictEqual(seen[2].toast.player, "ana");
});

test("riddles and sketches per gate", () => {
  for (const [gate, riddle, sketch, answer] of [
    ["drill", "Your drill is ready. What starts it?", "drill", "Draw DRILL"],
    ["land", "So close you could touch down.", "landing", "Draw LAND"],
    ["dig", "X marks the spot. The treasure isn't on top.", "shovel", "Draw DIG"],
    ["weapon", "Your ship has a gun. Where's the trigger?", "gun", "Draw SHOOT"],
  ]) {
    let t = 0;
    const hints = createHints({ now: () => t });
    const out = [];
    for (t = 0; t <= 32000; t += 1000) { const x = hints.update("p", { ...A, gate }); if (x) out.push(x); }
    assert.strictEqual(out[0].text, riddle);
    assert.strictEqual(out[1].sketch, sketch);
    assert.strictEqual(out[2].text, answer);
  }
});

test("v1.1: a missing skill points at the drawing (no ghost), then the button ladder starts over", () => {
  for (const [gate, riddle, sketch, answer] of [
    ["weapon", "Your ship can't shoot. What would let it?", "gun", "Draw a gun or a cannon on your ship"],
    ["land", "So close you could touch down. What would your ship stand on?", "landing", "Draw landing legs or a parachute on your ship"],
    ["dig", "X marks the spot. Your explorer has nothing to dig with.", "shovel", "Draw a shovel or claws on your explorer"],
    ["drill", "The chest is locked inside the rock. What breaks rock?", "drill", "Draw a drill on your explorer"],
  ]) {
    let t = 0;
    const hints = createHints({ now: () => t });
    const out = [];
    for (t = 0; t <= 32000; t += 1000) { const x = hints.update("p", { ...A, gate, hasSkill: false }); if (x) out.push({ t, x }); }
    assert.deepStrictEqual(out.map((o) => o.t), [6000, 16000, 31000]);
    assert.deepStrictEqual(out.map((o) => o.x.need), ["part", "part", "part"]);
    assert.strictEqual(out[0].x.text, riddle); assert.strictEqual(out[1].x.sketch, sketch); assert.strictEqual(out[2].x.text, answer);
    assert.strictEqual(out[2].x.ghost, null);
    assert.strictEqual(out[2].x.kind, "hint");
    // The skill arrives: the button ladder restarts from the riddle, 6 s later.
    const after = [];
    for (t = 33000; t <= 70000; t += 1000) { const x = hints.update("p", { ...A, gate, hasSkill: true }); if (x) after.push({ t, x }); }
    assert.deepStrictEqual(after.map((o) => o.t), [39000, 49000, 64000]);
    assert.strictEqual(after[0].x.need, "button");
    assert.ok(after[2].x.ghost);
  }
});

test("weapon gate traces the weapon the player has", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  const x = hints.update("p", { ...A, gate: "weapon", assists: true, action: "blast" });
  assert.strictEqual(x.ghost.action, "blast");
});

test("leaving the gate pauses the stuck time", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  const fired = [];
  const step = (args) => { const x = hints.update("p", args); if (x) fired.push(t); };
  for (t = 0; t <= 4000; t += 1000) step(A);          // 4 s active
  for (t = 5000; t <= 60000; t += 1000) step({ ...A, active: false }); // away a long time
  assert.deepStrictEqual(fired, []);
  for (t = 61000; t <= 70000; t += 1000) step(A);      // first active tick back, 2 s more needed
  assert.deepStrictEqual(fired, [63000]);
});

test("assists jump straight to the answer, once", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  const first = hints.update("p", { ...A, assists: true });
  assert.strictEqual(first.text, "Draw DRILL");
  assert.ok(first.ghost);
  for (t = 1000; t < 60000; t += 1000) assert.strictEqual(hints.update("p", { ...A, assists: true }), null);
});

test("assists after earlier steps still give the answer", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  for (t = 0; t <= 7000; t += 1000) hints.update("p", A);
  const toast = hints.update("p", { ...A, assists: true });
  assert.strictEqual(toast.text, "Draw DRILL");
});

test("hasControl stops it for good", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  for (t = 0; t <= 3000; t += 1000) hints.update("p", A);
  assert.strictEqual(hints.update("p", { ...A, hasControl: true }), null);
  for (t = 4000; t <= 80000; t += 1000) assert.strictEqual(hints.update("p", A), null);
  assert.strictEqual(hints.update("p", { ...A, assists: true }), null);
});

test("no duplicates; gates and players are independent; reset restarts", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  const count = { a: 0, b: 0, land: 0 };
  for (t = 0; t <= 100000; t += 500) {
    if (hints.update("a", A)) count.a++;
    if (hints.update("b", A)) count.b++;
    if (hints.update("a", { ...A, gate: "land" })) count.land++;
  }
  assert.deepStrictEqual(count, { a: 3, b: 3, land: 3 });
  hints.reset("a");
  let again = 0;
  const t0 = t;
  for (t = t0; t <= t0 + 40000; t += 500) if (hints.update("a", A)) again++;
  assert.strictEqual(again, 3);
  hints.reset();
  assert.ok(hints.update("b", { ...A, assists: true }));
});

test("a long gap between active ticks does not skip steps", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  hints.update("p", A);
  t = 100000;
  assert.strictEqual(hints.update("p", A).text, "Your drill is ready. What starts it?");
  assert.strictEqual(hints.update("p", A).sketch, "drill");
  assert.strictEqual(hints.update("p", A).text, "Draw DRILL");
  assert.strictEqual(hints.update("p", A), null);
});

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9;

// v1.3: ghost boxes stay below the phone HUD band (rules.js GHOST.top = 0.3), so only room below it counts.
function freeBoxExists(buttons) {
  for (let y = 0.3; y <= 0.82 + 1e-9; y += 0.005) for (let x = 0; x <= 0.78 + 1e-9; x += 0.005) {
    const box = { x, y, w: 0.22, h: 0.18 };
    if (!buttons.some((b) => overlaps(box, b))) return true;
  }
  return false;
}

test("ghost box avoids buttons and stays inside 0..1 for 20 random layouts", () => {
  const rnd = mulberry(7);
  let free = 0;
  for (let n = 0; n < 20; n++) {
    const buttons = [];
    const count = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const w = 0.1 + rnd() * 0.2, h = 0.1 + rnd() * 0.25;
      buttons.push({ type: i === 0 ? "stick" : "button", action: i === 0 ? "steer" : "fire", label: "", x: rnd() * (1 - w), y: rnd() * (1 - h), w, h });
    }
    const g = ghostBox({ buttons }, "drill");
    assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.w <= 1 + 1e-9 && g.y + g.h <= 1 + 1e-9, "inside 0..1 in layout " + n);
    assert.strictEqual(g.action, "drill");
    const hit = buttons.find((b) => overlaps(g, b));
    if (freeBoxExists(buttons)) { free++; assert.ok(!hit, "ghost overlaps a button in layout " + n + " " + JSON.stringify({ g, hit })); }
  }
  assert.ok(free >= 15, "only " + free + " of 20 layouts had room");
});

test("ghost prefers the lower half, opposite the stick", () => {
  const g = ghostBox({ buttons: [{ type: "stick", action: "steer", label: "", x: 0.02, y: 0.55, w: 0.3, h: 0.4 }] }, "land");
  assert.ok(g.y + g.h / 2 > 0.5, "lower half");
  assert.ok(g.x + g.w / 2 > 0.5, "right side");
  const empty = ghostBox({ buttons: [] }, "dig");
  assert.ok(empty.y + empty.h / 2 > 0.5);
});

test("ghost on a full pad still returns a box inside 0..1", () => {
  const g = ghostBox({ buttons: [{ type: "button", action: "fire", label: "", x: 0, y: 0, w: 1, h: 1 }] }, "dig");
  assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.w <= 1 + 1e-9 && g.y + g.h <= 1 + 1e-9);
});

test("budget: counts, limits, per-world separation, reset", () => {
  const b = createBudget({ perWorld: { space: 5, planet: 5 } });
  assert.deepStrictEqual(b.left("a"), { space: 5, planet: 5 });
  for (let i = 0; i < 5; i++) assert.strictEqual(b.spend("a", "space"), true);
  assert.strictEqual(b.spend("a", "space"), false);
  assert.deepStrictEqual(b.left("a"), { space: 0, planet: 5 });
  assert.strictEqual(b.spend("a", "planet"), true);
  assert.deepStrictEqual(b.left("a"), { space: 0, planet: 4 });
  assert.deepStrictEqual(b.left("b"), { space: 5, planet: 5 });
  for (let i = 0; i < 4; i++) b.spend("a", "planet");
  assert.strictEqual(b.spend("a", "planet"), false);
  assert.deepStrictEqual(b.left("a"), { space: 0, planet: 0 });
  b.reset();
  assert.deepStrictEqual(b.left("a"), { space: 5, planet: 5 });
  assert.strictEqual(b.spend("a", "space"), true);
});

test("budget defaults come from Contract.TUNING.drawings", () => {
  const b = createBudget();
  assert.deepStrictEqual(b.left("x"), { space: 5, planet: 5 });
});

test("late hint (v1.4, no free skills at 3:00): one big DRAW X card for a missing part or button", () => {
  const dig = lateHint("ana", { gate: "dig" });
  assert.deepStrictEqual(
    { type: dig.type, player: dig.player, kind: dig.kind, need: dig.need, gate: dig.gate, step: dig.step, late: dig.late, title: dig.title, text: dig.text, part: dig.part, parts: dig.parts, on: dig.on, sketch: dig.sketch, ghost: dig.ghost },
    { type: "toast", player: "ana", kind: "hint", need: "part", gate: "dig", step: 3, late: true, title: "DRAW A SHOVEL", text: "Draw a shovel or claws on your explorer", part: "shovel", parts: ["shovel"], on: "explorer", sketch: null, ghost: null });
  const both = lateHint("ana", { gate: "dig", also: ["drill", "dig", "nope"] });
  assert.strictEqual(both.title, "DRAW A SHOVEL AND A DRILL");
  assert.strictEqual(both.text, "Draw a shovel and a drill on your explorer");
  assert.deepStrictEqual(both.parts, ["shovel", "drill"]);
  assert.strictEqual(lateHint("ana", { gate: "weapon" }).title, "DRAW A GUN");
  assert.strictEqual(lateHint("ana", { gate: "land" }).title, "DRAW LANDING LEGS");
  assert.strictEqual(lateHint("ana", { gate: "land" }).on, "ship");
  const btn = lateHint("ana", { gate: "weapon", need: "button", action: "blast", label: "blast", layout });
  assert.strictEqual(btn.title, "DRAW A BLAST BUTTON");
  assert.strictEqual(btn.text, "Draw a BLAST button on your controller");
  assert.strictEqual(btn.on, "controller");
  assert.strictEqual(btn.ghost.action, "blast");
  assert(btn.ghost.y >= 0.3 - 1e-9, "the ghost box sits below the HUD band");
  assert.strictEqual(lateHint("ana", { gate: "nope" }), null);
});

test("late cards and the ladder never give the same answer twice (v1.4 gaveAnswer / answered)", () => {
  let t = 0;
  const hints = createHints({ now: () => t });
  hints.answered("p", "drill", "part");
  assert.strictEqual(hints.gaveAnswer("p", "drill", "part"), true);
  for (t = 0; t <= 40000; t += 500) assert.strictEqual(hints.update("p", { ...A, hasSkill: false }), null, "a card answered drill:part");
  let got = null; // the drill is drawn, its button is still missing: the button ladder starts from its riddle
  for (t = 40000; t <= 80000 && !got; t += 500) got = hints.update("p", { ...A, hasSkill: true });
  assert(got && got.need === "button" && got.step === 1, JSON.stringify(got));
  assert.strictEqual(hints.gaveAnswer("p", "drill", "button"), false);
  assert.strictEqual(hints.gaveAnswer("q", "drill", "part"), false);
});

console.log(`\n${passed} tests passed`);
