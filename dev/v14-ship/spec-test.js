// Unit checks of astra-ship.js (no network): node dev/v14-ship/spec-test.js
// normalize (garbage in → a full, clamped spec; colour names and hex; pen-black is no colour), reconcile (every unlocked
// skill shows as a part, parts tagged with their skill), fromEntity (deterministic per seed, different across seeds), the
// request shape (strict schema, every object closed), and every recorded real answer (compare/<model>/*.spec.json).
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const S = require("../../astra-ship.js");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

t("garbage → a complete default ship", () => {
  for (const raw of [{}, { hull: null, wings: "x", fins: 7, weapons: [null, 3], extras: "no" }, { hull: { shape: "banana", width: 99, height: -5 } }]) {
    const s = S.normalize(raw, { seed: 1 });
    assert.strictEqual(s.v, 1);
    assert(S.HULLS.includes(s.hull.shape));
    assert(s.hull.width >= 0.1 && s.hull.width <= 1.1 && s.hull.height >= 0.08 && s.hull.height <= 0.7);
    assert(Array.isArray(s.fins) && Array.isArray(s.weapons) && Array.isArray(s.extras));
    assert([0, 2, 4].includes(s.wings.count));
  }
  assert.throws(() => S.normalize(null));
  assert.throws(() => S.normalize([1, 2]));
});
t("colours: names, hex, short hex; pen black/grey is no colour", () => {
  const s = S.normalize({ hull: { color: "teal", stripe: "#FF0000" }, wings: { color: "#0f0" }, cockpit: { color: "black" }, fins: [{ color: "#333333" }], palette: { colored: true, main: "red", second: "nope", accent: "light blue" } }, { seed: 2 });
  assert.strictEqual(s.hull.color, "#2a9d8f");
  assert.strictEqual(s.hull.stripe, "#ff0000");
  assert.strictEqual(s.wings.color, "#00ff00");
  assert.strictEqual(s.cockpit.color, "");
  assert.strictEqual(s.fins[0].color, "");
  assert.deepStrictEqual(s.palette, { colored: true, main: "#e63946", second: "", accent: "#4cc9f0" });
  const plain = S.normalize({ palette: { colored: false, main: "red" } }, { seed: 2 });
  assert.strictEqual(plain.palette.main, "");
});
t("caps: ≤ 3 fins, ≤ 4 weapons, ≤ 6 extras; counts clamped", () => {
  const many = (k) => Array.from({ length: 20 }, () => ({ kind: k }));
  const s = S.normalize({ fins: many("tail"), weapons: many("laser"), extras: many("star"), engines: { count: 99, flame: true }, wings: { count: 3 } }, { seed: 3 });
  assert.strictEqual(s.fins.length, 3);
  assert.strictEqual(s.weapons.length, 4);
  assert.strictEqual(s.extras.length, 6);
  assert.strictEqual(s.engines.count, 4);
  assert.strictEqual(s.wings.count, 4);
  assert.strictEqual(S.normalize({ engines: { count: 0, flame: true } }).engines.count, 1); // flames need a nozzle
});
t("reconcile: every unlocked skill is visible and tagged", () => {
  const base = S.normalize({ weapons: [], extras: [{ kind: "star" }], engines: { count: 0, flame: false } }, { seed: 4 });
  const verbs = ["shoot", "boost", "land", "shield", "scan", "flare", "heal", "mine", "tractor", "emp", "inkbomb", "decoy", "blast", "teleport", "invisible"];
  const s = S.reconcile(base, { unlocked: verbs.map((verb) => ({ verb, part: "x" })) });
  assert(s.engines.flame && s.engines.count >= 1 && s.engines.verb === "boost");
  const tagged = new Set([...s.weapons, ...s.extras].map((p) => p.verb).filter(Boolean));
  for (const v of verbs.filter((v) => v !== "boost")) assert(tagged.has(v) || s.extras.length === 6, `missing ${v}`);
  assert(s.weapons.length <= 4 && s.extras.length <= 6);
  // a drawn part keeps its own place; nothing is added for it
  const own = S.reconcile(S.normalize({ extras: [{ kind: "legs", at: 0.7 }] }, { seed: 5 }), { unlocked: [{ verb: "land", part: "legs" }] });
  assert.strictEqual(own.extras.length, 1);
  assert.strictEqual(own.extras[0].verb, "land");
  assert(!own.extras[0].added);
  // a drawn weapon whose skill was not unlocked stays as decoration (verb null)
  const deco = S.reconcile(S.normalize({ weapons: [{ kind: "cannon" }] }, { seed: 6 }), { unlocked: [] });
  assert.strictEqual(deco.weapons[0].verb, null);
});
t("fromEntity: deterministic per seed, varied across seeds", () => {
  const e = { unlocked: [{ verb: "shoot", part: "cannon" }, { verb: "boost", part: "flames" }] };
  assert.deepStrictEqual(S.fromEntity(e, "abc"), S.fromEntity(e, "abc"));
  const shapes = new Set(Array.from({ length: 30 }, (_, i) => S.fromEntity(e, `seed${i}`).hull.shape));
  assert(shapes.size >= 3, `only ${[...shapes]}`);
});
t("request: strict closed schema, image + prompt", () => {
  const req = S.request("data:image/png;base64,AAAA", { source: "draw", model: "gpt-6.1-sol" });
  assert.strictEqual(req.text.format.strict, true);
  const walk = (o) => {
    if (o.type === "object") { assert.strictEqual(o.additionalProperties, false); assert.deepStrictEqual(o.required.slice().sort(), Object.keys(o.properties).sort()); Object.values(o.properties).forEach(walk); }
    if (o.type === "array") walk(o.items);
  };
  walk(req.text.format.schema);
  assert.strictEqual(req.input[0].content[1].image_url, "data:image/png;base64,AAAA");
  assert.strictEqual(req.service_tier, "ultrafast");
  assert(!("service_tier" in S.request("x", { tier: "none" })));
});
t("every recorded real answer normalizes and reconciles", () => {
  let k = 0;
  for (const model of ["gpt-6.1-sol", "gpt-6-astra"]) {
    const dir = path.join(__dirname, "compare", model);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".spec.json"))) {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (!rec.raw) continue;
      const s = S.reconcile(S.normalize(rec.raw, { seed: 7 }), { unlocked: [{ verb: "shoot", part: "gun" }] });
      assert(s.weapons.some((w) => w.verb === "shoot"));
      assert(JSON.stringify(s).length < 4000, `${f}: spec too big (${JSON.stringify(s).length} chars)`);
      k++;
    }
  }
  console.log(`   ${k} recorded answers`);
});
console.log(`all ${n} passed`);
