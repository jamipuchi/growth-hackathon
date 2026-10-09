// Scoring of one astra.generate answer against a corpus case's ground truth, and the scorecard over a run.
// Shared by the live scorer (score.js) and the offline regression test (dev/astra/gen-regression-test.js).
const Verbs = require("../../verbs.js");

const iou = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};
const inside = (p, r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const kindOf = (t) => (t === "stick" ? "stick" : "button"); // toggles count as buttons
const EXPECTED_LOOKS = { controller: "controller", button: "controller", ship: "entity", explorer: "entity" };

// Greedy matching of predicted controls to ground-truth controls: best IoU first; a pair also matches when either
// centre lies inside the other rectangle (a loose rectangle still found the control).
function match(gt, pred) {
  const pairs = [];
  gt.forEach((g, i) => pred.forEach((p, j) => {
    const v = iou(g.rect, p);
    if (v >= 0.2 || inside(centre(p), g.rect) || inside(centre(g.rect), p)) pairs.push({ i, j, v });
  }));
  pairs.sort((a, b) => b.v - a.v);
  const gi = new Map(), pj = new Set();
  for (const p of pairs) if (!gi.has(p.i) && !pj.has(p.j)) { gi.set(p.i, p); pj.add(p.j); }
  return { gi, extras: pred.filter((_, j) => !pj.has(j)) };
}

function scoreCase(c, result) {
  const r = result || { ok: false, error: "no result" };
  const s = { id: c.id, kind: c.kind, source: c.source, group: c.wrong ? "wrong" : c.kind === "ship" || c.kind === "explorer" ? "entity" : c.kind, ok: !!r.ok, error: r.ok ? null : r.error, looksLike: r.looksLike || null };
  const notes = [];
  // the fallbacks hide failures: count them as failures
  if (r.ok && r.layout && r.layout.source === "default") { s.fallback = "default layout"; notes.push("FALLBACK default layout"); }
  if (r.ok && r.entity && r.entity.source === "devkit") { s.fallback = "devkit"; notes.push("FALLBACK dev kit"); }
  if (c.wrong) {
    s.caught = !r.ok && r.looksLike === c.wrong.looksLike;
    s.pass = s.caught;
    notes.push(s.caught ? `caught: ${r.error}` : `NOT caught (ok=${!!r.ok} looksLike=${r.looksLike || "-"} ${r.error || summary(r)})`);
    s.note = notes.join("; ");
    return s;
  }
  s.falseAlarm = !r.ok && !!r.looksLike && r.looksLike !== EXPECTED_LOOKS[c.kind];
  if (s.falseAlarm) notes.push(`FALSE ALARM looksLike=${r.looksLike}`);
  if (c.kind === "controller") {
    const pred = r.ok && r.layout ? r.layout.buttons.filter(() => !s.fallback) : [];
    const { gi, extras } = match(c.controls, pred);
    s.total = c.controls.length;
    s.found = gi.size; s.kindRight = 0; s.labelRight = 0; s.iou50 = 0; s.labelTotal = 0;
    c.controls.forEach((g, i) => {
      const m = gi.get(i);
      s.labelTotal++;
      if (!m) { notes.push(`missed ${g.label || g.icon || g.type}(${g.action})`); return; }
      const p = pred[m.j];
      if (kindOf(p.type) === kindOf(g.type)) s.kindRight++; else notes.push(`kind ${g.label || g.type}: ${p.type}≠${g.type}`);
      if (p.action === g.action) s.labelRight++; else notes.push(`action ${g.label || g.icon || g.type}: ${p.action}≠${g.action}`);
      if (m.v >= 0.5) s.iou50++; else notes.push(`iou ${g.label || g.icon || g.type} ${m.v.toFixed(2)}`);
    });
    s.extras = extras.length;
    s.crossedReturned = (c.excluded || []).filter((e) => extras.some((p) => iou(e.rect, p) >= 0.2 || inside(centre(p), e.rect))).length;
    if (extras.length) notes.push(`extra ${extras.map((p) => `${p.label || p.type}(${p.action})`).join(",")}`);
    if (!r.ok) notes.push(`error: ${r.error}`);
    s.pass = r.ok && !s.fallback && s.found === s.total && s.kindRight === s.total && s.labelRight === s.total && s.extras === 0;
  } else if (c.kind === "button") {
    const b = r.ok && r.layout && r.layout.buttons && r.layout.buttons[0];
    s.total = 1; s.labelTotal = 1;
    s.found = b ? 1 : 0;
    s.kindRight = b && kindOf(b.type) === kindOf(c.expect.type) ? 1 : 0;
    s.labelRight = b && b.action === c.expect.action ? 1 : 0;
    if (!b) notes.push(`error: ${r.error}`);
    else if (!s.labelRight) notes.push(`action ${b.action}≠${c.expect.action} (label "${b.label}")`);
    s.pass = !!b && !!s.kindRight && !!s.labelRight;
  } else {
    const e = r.ok && r.entity && !s.fallback ? r.entity : null;
    const world = c.kind === "ship" ? "space" : "planet";
    s.typeRight = !!e && c.entity.types.includes(e.type);
    const unlocked = new Set(e ? e.unlocked.map((u) => u.verb) : []);
    s.must = c.entity.must.length;
    s.mustHit = c.entity.must.filter((v) => unlocked.has(v)).length;
    s.gateMissing = c.entity.must.filter((v) => Verbs.GATE_SKILLS[world].includes(v) && !unlocked.has(v));
    s.spurious = [...unlocked].filter((v) => !c.entity.must.includes(v) && !c.entity.ok.includes(v));
    if (!e) notes.push(`error: ${r.error || s.fallback}`);
    else {
      if (!s.typeRight) notes.push(`type ${e.type}∉${c.entity.types}`);
      const missing = c.entity.must.filter((v) => !unlocked.has(v));
      if (missing.length) notes.push(`missing ${missing.join(",")}`);
      if (s.spurious.length) notes.push(`spurious ${s.spurious.join(",")}`);
      notes.push(`[${[...unlocked].join(" ") || "-"}] parts: ${e.parts.map((p) => p.name).join(", ")}`);
    }
    s.pass = !!e && s.typeRight && s.mustHit === s.must && !s.falseAlarm;
  }
  if (s.falseAlarm) s.pass = false;
  s.note = notes.join("; ") || "ok";
  return s;
}

function summary(r) {
  if (r.layout) return `${r.layout.buttons.length} control(s): ${r.layout.buttons.map((b) => `${b.label || b.type}→${b.action}`).join(", ")}`;
  if (r.entity) return `${r.entity.type} [${r.entity.unlocked.map((u) => u.verb).join(" ")}]`;
  return "";
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };

function summarise(cases, out) {
  const S = out.map((r) => r.score);
  const ctl = (src) => S.filter((s) => s.group === "controller" && (!src || s.source === src));
  const sum = (list, k) => list.reduce((a, s) => a + (s[k] || 0), 0);
  const btn = S.filter((s) => s.group === "button");
  const ent = S.filter((s) => s.group === "entity");
  const wrong = S.filter((s) => s.group === "wrong");
  const right = S.filter((s) => s.group !== "wrong");
  const ms = out.map((r) => r.ms);
  const labelled = [...ctl(), ...btn];
  return {
    cases: S.length,
    passed: S.filter((s) => s.pass).length,
    controlsFoundClean: pct(sum(ctl("draw"), "found"), sum(ctl("draw"), "total")),
    controlsFoundPhoto: pct(sum(ctl("photo"), "found"), sum(ctl("photo"), "total")),
    kindsRight: pct(sum(labelled, "kindRight"), sum(labelled, "found")),
    labelsRight: pct(sum(labelled, "labelRight"), sum(labelled, "labelTotal")),
    labelsRightControllers: pct(sum(ctl(), "labelRight"), sum(ctl(), "labelTotal")),
    buttonsRight: pct(btn.filter((s) => s.pass).length, btn.length),
    iou50: pct(sum(ctl(), "iou50"), sum(ctl(), "found")),
    extraControls: sum(ctl(), "extras"),
    crossedOutReturned: sum(ctl(), "crossedReturned"),
    entityType: pct(ent.filter((s) => s.typeRight).length, ent.length),
    unlockedVerbs: pct(sum(ent, "mustHit"), sum(ent, "must")),
    gateVerbsMissing: ent.reduce((a, s) => a + s.gateMissing.length, 0),
    spuriousUnlocks: ent.reduce((a, s) => a + s.spurious.length, 0),
    wrongKindCaught: pct(wrong.filter((s) => s.caught).length, wrong.length),
    falseAlarms: right.filter((s) => s.falseAlarm).length,
    fallbacks: S.filter((s) => s.fallback).length,
    errors: S.filter((s) => !s.ok && !s.looksLike).length,
    p50ms: quantile(ms, 0.5),
    p90ms: quantile(ms, 0.9),
    maxMs: Math.max(...ms),
  };
}

const ROWS = [
  ["cases passed", (s) => `${s.passed}/${s.cases}`],
  ["controls found, clean (≥95%)", (s) => s.controlsFoundClean],
  ["controls found, photo (≥85%)", (s) => s.controlsFoundPhoto],
  ["kinds right (stick vs button)", (s) => s.kindsRight],
  ["labels → right verb (≥95%)", (s) => s.labelsRight],
  ["added buttons right", (s) => s.buttonsRight],
  ["rectangles IoU ≥ 0.5", (s) => s.iou50],
  ["invented controls", (s) => s.extraControls],
  ["crossed-out returned", (s) => s.crossedOutReturned],
  ["entity type (≥90%)", (s) => s.entityType],
  ["unlocked verbs (≥85%)", (s) => s.unlockedVerbs],
  ["gate verb missing", (s) => s.gateVerbsMissing],
  ["spurious unlocks", (s) => s.spuriousUnlocks],
  ["wrong kind caught (≥90%)", (s) => s.wrongKindCaught],
  ["false wrong-kind alarms", (s) => s.falseAlarms],
  ["fallbacks (default/devkit)", (s) => s.fallbacks],
  ["errors", (s) => s.errors],
  ["latency p50 ms", (s) => s.p50ms],
  ["latency p90 ms (≤2500)", (s) => s.p90ms],
];
function table(runs) {
  const head = `| metric | ${runs.map((r) => r.label).join(" | ")} |\n|---|${runs.map(() => "---").join("|")}|`;
  return head + "\n" + ROWS.map(([name, f]) => `| ${name} | ${runs.map((r) => { const v = f(r.summary); return v == null ? "-" : v; }).join(" | ")} |`).join("\n");
}

module.exports = { scoreCase, summarise, table, iou, match };
