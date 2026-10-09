// wireAnimations + anims.js table tests. Pure, no network. Run: node dev/astra/anim-wire-test.js
process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
const assert = require("assert");
const Astra = require("../../astra.js");
const Anims = require("../../anims.js");
const Rigs = require("../../rigs.js");
const Verbs = require("../../verbs.js");

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok", name); };
const FIELDS = ["clip", "profile", "fx", "shake", "hitStop"];

test("every row of the table is complete and uses known profiles and fx kinds", () => {
  for (const [type, row] of Object.entries(Anims.ROWS)) {
    for (const slot of Anims.SLOTS) {
      assert(row[slot], `${type}.${slot} missing`);
      const entries = [row[slot], ...Object.values(row[slot].byVerb || {})];
      for (const e of entries) {
        for (const f of FIELDS) assert(f in e, `${type}.${slot}.${f}`);
        assert(Anims.PROFILES.includes(e.profile), `${type}.${slot} profile ${e.profile}`);
        for (const x of e.fx) assert(x.kind && x.at >= 0 && x.socket, `${type}.${slot} fx`);
        assert(e.hitStop >= 0 && e.hitStop <= 4 && e.shake >= 0 && e.shake <= 1);
      }
    }
    for (const verb of Object.keys(Verbs.VERBS)) void verb;
  }
});

test("byVerb keys are real verbs of that slot", () => {
  for (const row of Object.values(Anims.ROWS)) {
    for (const slot of Anims.SLOTS) {
      for (const v of Object.keys(row[slot].byVerb || {})) {
        assert(Verbs.VERBS[v], `unknown verb ${v}`);
        assert.strictEqual(Verbs.VERBS[v].slot, slot, `${v} is slot ${Verbs.VERBS[v].slot}, not ${slot}`);
      }
    }
  }
});

test("clips agree with the rig template", () => {
  for (const type of Object.keys(Anims.ROWS)) {
    const t = Rigs.get(type);
    for (const slot of Verbs.SLOTS) {
      const e = Anims.ROWS[type][slot];
      if (!e) continue;
      const rig = Rigs.clipFor(type, slot);
      if (e.clip) assert(t.clips.includes(e.clip), `${type}.${slot} clip ${e.clip} not in rig`);
      if (!t.clips.length) assert.strictEqual(e.clip, null, `${type} is rigid, ${slot} has a clip`);
      void rig;
    }
  }
});

test("ship with shoot+boost gets exactly its slots plus the always-on ones", () => {
  const a = Astra.wireAnimations("ship", ["shoot", "boost"]);
  assert.deepStrictEqual(Object.keys(a).sort(), ["die", "hit", "idle", "move", "primary", "respawn"]);
  assert.strictEqual(a.primary.profile, "recoil");
  assert(!a.primary.byVerb, "shoot uses the base entry");
  assert.strictEqual(a.move.byVerb.boost.profile, "boostSurge");
  assert(!a.move.byVerb.teleport);
});

test("verbs given as objects, unknown verbs ignored, drill and blast override primary", () => {
  const a = Astra.wireAnimations("ship", [{ verb: "drill" }, { verb: "blast" }, "nonsense"]);
  assert.strictEqual(a.primary.byVerb.drill.profile, "drillShake");
  assert.strictEqual(a.primary.byVerb.blast.profile, "blastRecoil");
  assert(!a.defend && !a.use);
});

test("person dig + jump uses the explorer clips", () => {
  const a = Astra.wireAnimations("person", ["jump", "dig"]);
  assert.strictEqual(a.jump.clip, "jump");
  assert.strictEqual(a.use.byVerb.dig.clip, "dig");
  assert.strictEqual(a.use.byVerb.dig.profile, "digLoop");
  assert.strictEqual(a.move.clip, "walk");
});

test("unknown type falls back to the blob row; bad input does not throw", () => {
  const a = Astra.wireAnimations("dragon", ["jump"]);
  assert.strictEqual(a.idle.profile, "wobbleIdle");
  assert.strictEqual(a.jump.profile, "jumpSquash");
  assert.deepStrictEqual(Object.keys(Astra.wireAnimations("ship", null)).sort(), ["die", "hit", "idle", "move", "respawn"]);
  Astra.wireAnimations(undefined, undefined);
});

test("output is a copy: mutating it never changes the table", () => {
  const a = Astra.wireAnimations("ship", ["shoot"]);
  a.primary.fx[0].kind = "x";
  a.hit.shake = 99;
  assert.strictEqual(Anims.ROWS.ship.primary.fx[0].kind, "muzzle");
  assert(Anims.ROWS.ship.hit.shake < 1);
});

test("every verb of every type wires, fast", () => {
  const verbs = Object.keys(Verbs.VERBS);
  const t0 = process.hrtime.bigint();
  const N = 2000;
  for (let i = 0; i < N; i++) for (const type of [...Rigs.TYPES]) Astra.wireAnimations(type, verbs);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const per = ms / (N * Rigs.TYPES.length);
  console.log(`   wireAnimations all verbs: ${per.toFixed(4)} ms per call`);
  assert(per < 0.2);
  for (const type of Rigs.TYPES) {
    const a = Astra.wireAnimations(type, verbs);
    for (const v of verbs) assert(a[Verbs.VERBS[v].slot], `${type} ${v}`);
  }
});

console.log(`${n} passed`);
