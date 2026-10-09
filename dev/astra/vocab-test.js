// verbs.js and rigs.js integrity. Run: node dev/astra/vocab-test.js
const assert = require("assert");
const Contract = require("../../contract.js");
const Verbs = require("../../verbs.js");
const Rigs = require("../../rigs.js");

let checks = 0;
const ok = (cond, msg) => (assert.ok(cond, msg), checks++);

for (const [id, v] of Object.entries(Verbs.VERBS)) {
  ok(Verbs.SLOTS.includes(v.slot), `${id}: slot`);
  ok(v.requires && typeof v.requires === "object", `${id}: requires`);
  ok(Array.isArray(v.synonyms) && v.synonyms.every((s) => s === s.toUpperCase()), `${id}: synonyms uppercase`);
  ok(Array.isArray(v.tags) && Number.isInteger(v.cost) && v.cost >= 0 && v.cost <= Verbs.POWER_BUDGET, `${id}: tags, cost`);
  ok(Verbs.resolveLabel(id) === id, `${id}: resolves to itself`);
  for (const s of v.synonyms) ok(Verbs.resolveLabel(s) === id, `${s} → ${id}, got ${Verbs.resolveLabel(s)}`);
  for (const s of v.requires.sockets || []) ok(s === "*" || Rigs.TYPES.some((t) => Rigs.get(t).sockets[s]), `${id}: socket ${s} exists on some rig`);
  for (const m of v.requires.moves || []) ok(m === "*" || Rigs.TYPES.some((t) => Rigs.get(t).moves.includes(m)), `${id}: move ${m} exists on some rig`);
}
for (const [alias, verb] of Object.entries(Contract.ALIASES)) ok(Verbs.resolveLabel(alias) === verb, `alias ${alias}`);
const expect = { FIRE: "shoot", "pew!": "shoot", X: "shoot", Landing: "land", Spade: "dig", Torch: "flare", Eye: "scan", Saw: "drill",
  Nuke: "blast", "◀": "left", "→": "right", "strafe left": "strafeleft", Joystick: "steer", Walk: "move", ready: "ready", VIEW: "view", banana: null, "": null };
for (const [label, want] of Object.entries(expect)) ok(Verbs.resolveLabel(label) === want, `resolveLabel(${label}) = ${want}`);
for (const m of Contract.MOVES) ok(Verbs.resolveLabel(m) === m, `move ${m}`);
for (const s of Contract.STICKS) ok(Verbs.resolveLabel(s) === s, `stick ${s}`);
for (const m of Contract.META_ACTIONS) ok(Verbs.resolveLabel(m) === m, `meta ${m}`);
ok(Verbs.supports("dig", { moves: ["walk"], sockets: ["hand_r"] }) && !Verbs.supports("dig", { moves: ["walk"], sockets: [] }), "supports dig");
ok(Verbs.supports("land", {}) && Verbs.supports("fly", { moves: ["walk"], sockets: ["back"] }), "supports land, fly");

ok(Rigs.TYPES.length === 10, "10 rig types");
for (const t of Rigs.TYPES) {
  const r = Rigs.get(t);
  ok(r.type === t && r.zones.length && r.moves.length && r.joints.length, `${t}: basics`);
  const names = new Set(r.bones.map(([b]) => b));
  ok(names.size === r.bones.length, `${t}: unique bones`);
  ok(r.bones.every(([b, p]) => /^[a-z0-9_]+$/.test(b) && (p === null || names.has(p))), `${t}: bone parents`);
  ok(!r.bones.length || r.bones.filter(([, p]) => p === null).length === 1, `${t}: one root bone`);
  ok(Object.values(r.sockets).every((b) => (r.bones.length ? names.has(b) : b === "root")), `${t}: sockets on bones`);
  ok(Verbs.SLOTS.every((s) => typeof r.slots[s] === "string"), `${t}: every slot mapped`);
  ok(["inflate", "extrude"].includes(r.body) && ["smooth", "rigid-parts", "none"].includes(r.skin), `${t}: body, skin`);
}
ok(Rigs.get("person").bones.length === 19, "person: 19 bones");
ok(Rigs.get("nope") === null && Rigs.get(Rigs.FALLBACK).type === "blob", "unknown type, fallback");
ok(Rigs.clipFor("person", "use") === "swing", "clipFor");
console.log(`vocab: ${checks} checks passed`);
