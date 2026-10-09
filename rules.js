"use strict";
// Server-side rules: the hint ladder (PLAN.md "Hints: make people think") and the per-round drawing budget.

const Contract = require("./contract.js");

// v1.1 (PLAN.md section 0): a gate needs a SKILL drawn on the entity and a BUTTON on the controller. While the skill
// is missing the ladder points at the drawing (need "part"); once it is unlocked, at the button (need "button").
// Riddles never write the button's name; only the last step does.
const GATES = {
  weapon: {
    part: { riddle: "Your ship can't shoot. What would let it?", sketch: "gun", answer: "Draw a gun or a cannon on your ship" },
    button: { riddle: "Your ship has a gun. Where's the trigger?", sketch: "gun", answer: "Draw SHOOT" },
    action: "shoot",
  },
  land: {
    part: { riddle: "So close you could touch down. What would your ship stand on?", sketch: "landing", answer: "Draw landing legs or a parachute on your ship" },
    button: { riddle: "So close you could touch down.", sketch: "landing", answer: "Draw LAND" },
    action: "land",
  },
  dig: {
    part: { riddle: "X marks the spot. Your explorer has nothing to dig with.", sketch: "shovel", answer: "Draw a shovel or claws on your explorer" },
    button: { riddle: "X marks the spot. The treasure isn't on top.", sketch: "shovel", answer: "Draw DIG" },
    action: "dig",
  },
  drill: {
    part: { riddle: "The chest is locked inside the rock. What breaks rock?", sketch: "drill", answer: "Draw a drill on your explorer" },
    button: { riddle: "Your drill is ready. What starts it?", sketch: "drill", answer: "Draw DRILL" },
    action: "drill",
  },
};

const STEP_MS = [6000, 16000, 31000]; // stuck time at which riddle, sketch, answer are due
const GHOST = { w: 0.22, h: 0.18, grid: 0.01 };
const EPS = 1e-9;

const overlapArea = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > EPS && h > EPS ? w * h : 0;
};

function ghostBox(layout, action) {
  const buttons = ((layout && layout.buttons) || []).filter((b) => b && ["x", "y", "w", "h"].every((k) => Number.isFinite(b[k])));
  const sticks = buttons.filter((b) => b.type === "stick");
  const stickX = sticks.length ? sticks.reduce((s, b) => s + b.x + b.w / 2, 0) / sticks.length : 0.5;
  const maxX = 1 - GHOST.w;
  const maxY = 1 - GHOST.h;
  const axis = (max, size, lo, hi) => {
    const set = new Set();
    for (let v = 0; v <= max + EPS; v += GHOST.grid) set.add(Math.min(max, v));
    set.add(max);
    for (const b of buttons) for (const v of [b[hi] + b[lo === "x" ? "w" : "h"], b[lo] - size]) set.add(Math.min(max, Math.max(0, v)));
    return [...set];
  };
  const xs = axis(maxX, GHOST.w, "x", "x");
  const ys = axis(maxY, GHOST.h, "y", "y");
  let best = null;
  for (const y of ys) {
    for (const x of xs) {
      const box = { x, y, w: GHOST.w, h: GHOST.h };
      const overlap = buttons.reduce((s, b) => s + overlapArea(box, b), 0);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const score = cy + Math.abs(cx - stickX) - overlap * 1000;
      if (!best || score > best.score) best = { score, box };
    }
  }
  return { action, x: best.box.x, y: best.box.y, w: GHOST.w, h: GHOST.h };
}

function createHints({ now = Date.now } = {}) {
  const states = new Map();
  const stateFor = (player, gate) => {
    let perPlayer = states.get(player);
    if (!perPlayer) states.set(player, (perPlayer = {}));
    return perPlayer[gate] || (perPlayer[gate] = { stuck: 0, last: null, sent: 0, done: false, need: null });
  };

  // hasSkill: the entity has the gate's skill (default true: button-only ladders, as in v1). action: the ghost box's
  // action when it differs from the gate's (the weapon gate traces the weapon the player has).
  function update(player, { gate, active, hasSkill = true, hasControl, assists, layout, action } = {}) {
    const def = GATES[gate];
    if (!def) return null;
    const st = stateFor(player, gate);
    if (hasSkill && hasControl) {
      st.done = true;
      st.last = null;
      return null;
    }
    const need = hasSkill ? "button" : "part";
    if (st.need !== need) Object.assign(st, { need, stuck: 0, last: null, sent: 0, done: false });
    if (st.done) return null;
    const t = now();
    if (!active) {
      st.last = null;
      return null;
    }
    if (st.last !== null) st.stuck += Math.max(0, t - st.last);
    st.last = t;

    let step = st.sent + 1;
    if (assists && st.sent < 3) step = 3;
    if (step > 3 || (step < 3 && st.stuck < STEP_MS[step - 1])) return null;
    if (step === 3 && !assists && st.stuck < STEP_MS[2]) return null;

    st.sent = step;
    const text = def[need];
    const base = { type: "toast", player, kind: "hint", need, gate };
    if (step === 1) return { ...base, text: text.riddle, sketch: null, ghost: null };
    if (step === 2) return { ...base, text: "", sketch: text.sketch, ghost: null };
    return { ...base, text: text.answer, sketch: null, ghost: need === "button" ? ghostBox(layout, action || def.action) : null };
  }

  function reset(player) {
    if (player === undefined) states.clear();
    else states.delete(player);
  }

  return { update, reset };
}

function createBudget({ perWorld = Contract.TUNING.drawings } = {}) {
  let used = new Map();
  const worldOf = (world) => (world === "planet" ? "planet" : "space");
  const usedBy = (player) => {
    let u = used.get(player);
    if (!u) used.set(player, (u = { space: 0, planet: 0 }));
    return u;
  };
  return {
    left(player) {
      const u = usedBy(player);
      return { space: Math.max(0, perWorld.space - u.space), planet: Math.max(0, perWorld.planet - u.planet) };
    },
    spend(player, world) {
      const w = worldOf(world);
      const u = usedBy(player);
      if (u[w] >= perWorld[w]) return false;
      u[w]++;
      return true;
    },
    reset() {
      used = new Map();
    },
  };
}

module.exports = { createHints, createBudget, ghostBox, GATES, STEP_MS };
