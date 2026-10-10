// astra.js kinds "ship" and "explorer" (v1-ship-drawing): answered at once with the world's default rig, verbs and
// wired animations; no network; the finished drawing is kept as controllers/<player>-<kind>.png.
// v1.8 tests: since v1.5 (QA M1) only development (ASTRA_MOCK=1 or no key) gets the generous dev kit; with a key, a
// failed call reads nothing, so it gets the plain entity (only its type's innate skills, source "fallback", free) and
// the drawing is not kept. The dev-kit cases below run with ASTRA_MOCK=1; the last case checks the plain fallback.
// Run: node dev/inflate/astra-entity-test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
delete process.env.ASTRA_MOCK;
const Verbs = require("../../verbs.js");
const Astra = require("../../astra.js");
const { _internals } = Astra;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astra-entity-"));
_internals.setDir(tmp);
_internals.setFetch(() => { throw new Error("network used"); });
const realLog = console.log;
console.log = () => {};
const png = (tag) => "data:image/png;base64," + Buffer.from(`fake-png-${tag}`).toString("base64");

const results = [];
async function test(name, fn) {
  const t0 = performance.now();
  try { await fn(); results.push({ name, ok: true, ms: performance.now() - t0 }); }
  catch (err) { results.push({ name, ok: false, err, ms: performance.now() - t0 }); }
}

const mock = (on) => { if (on) process.env.ASTRA_MOCK = "1"; else delete process.env.ASTRA_MOCK; };

(async () => {
  mock(true); // development: the dev kit (astra.js devMode), still no network
  await test("ship → ok at once: type ship, space verbs, anims for those verbs, no network", async () => {
    const t0 = performance.now();
    const r = await Astra.generate({ player: "Ana", kind: "ship", image: png("ship") });
    const ms = performance.now() - t0;
    assert.ok(ms < 20, `took ${ms} ms`);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entity.type, "ship");
    // The space gate skills (Verbs.GATE_SKILLS.space: a weapon and LAND) come with the dev kit; no planet-only skills.
    for (const v of Verbs.GATE_SKILLS.space) assert.ok(r.entity.verbs.includes(v), `ship has ${v}`);
    assert.ok(!r.entity.verbs.includes("dig") && !r.entity.verbs.includes("takeoff"));
    assert.ok(r.entity.verbs.every((v) => Verbs.VERBS[v].modes.includes("space")));
    for (const slot of ["idle", "move", "hit", "die", "respawn", "primary"]) assert.ok(r.entity.anims[slot], `anims.${slot}`);
    // PLAN.md section 0: the drill belongs to planet entities. If a ship still carries one, it is wired in primary.
    if (r.entity.verbs.includes("drill")) assert.ok(r.entity.anims.primary.byVerb && r.entity.anims.primary.byVerb.drill, "drill wired in primary");
    assert.deepStrictEqual(r.entity.anims, Astra.wireAnimations("ship", r.entity.verbs));
  });

  // PLAN.md section 0: drill is a planet skill now. Buried chests need DIG, chests locked in rocks need DRILL, so the
  // explorer's dev kit carries both planet gate skills (Verbs.GATE_SKILLS.planet); LAND stays a ship skill.
  await test("explorer → type person with planet verbs (dig, drill, takeoff; no land)", async () => {
    const r = await Astra.generate({ player: "Ana", kind: "explorer", image: png("exp") });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entity.type, "person");
    for (const v of [...Verbs.GATE_SKILLS.planet, "dig", "drill", "takeoff"]) assert.ok(r.entity.verbs.includes(v), `explorer has ${v}`);
    assert.ok(!r.entity.verbs.includes("land"), "no LAND on the planet");
    assert.ok(r.entity.verbs.every((v) => Verbs.VERBS[v].modes.includes("planet")));
    assert.ok(r.entity.anims.use && r.entity.anims.use.byVerb.dig, "dig wired (use slot)");
    assert.ok(r.entity.anims.primary, "drill has its slot (primary)");
    assert.deepStrictEqual(r.entity.anims, Astra.wireAnimations(r.entity.rig, r.entity.verbs));
  });

  await test("finished drawing saved as controllers/<player>-<kind>.png (+ .json); speculative is not saved", async () => {
    await Astra.generate({ player: "Bo!", kind: "ship", image: png("bo-ship") });
    await Astra.generate({ player: "Cy", kind: "ship", image: png("cy-spec"), speculative: true });
    await new Promise((res) => setTimeout(res, 50));
    assert.strictEqual(fs.readFileSync(path.join(tmp, "bo-ship.png")).toString(), "fake-png-bo-ship");
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmp, "bo-ship.json"), "utf8")).type, "ship");
    assert.ok(!fs.existsSync(path.join(tmp, "cy-ship.png")));
  });

  // v1.5 (QA M1): with a key and a call that fails (no network here), nothing was read, so nothing is unlocked: the
  // plain entity of that type (innate skills only), free, never kept as a drawing.
  mock(false);
  await test("key + failed call → plain entity (innate skills only), fallback + free, drawing not kept", async () => {
    const s = await Astra.generate({ player: "Di", kind: "ship", image: png("di-ship") });
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.fallback, true, "fallback: true");
    assert.strictEqual(s.free, true, "free: true (server.js spends no drawing)");
    assert.ok(["error", "timeout"].includes(s.failed), `failed ${s.failed}`);
    assert.strictEqual(s.entity.type, "ship");
    assert.strictEqual(s.entity.source, "fallback");
    assert.deepStrictEqual(s.entity.verbs, Verbs.entityVerbs("ship", []), "a plain ship only flies");
    assert.deepStrictEqual(s.entity.anims, Astra.wireAnimations("ship", s.entity.verbs));
    const e = await Astra.generate({ player: "Di", kind: "explorer", image: png("di-exp") });
    assert.strictEqual(e.ok, true);
    assert.strictEqual(e.fallback, true);
    assert.strictEqual(e.entity.type, "person");
    assert.strictEqual(e.entity.source, "fallback");
    assert.deepStrictEqual(e.entity.verbs, Verbs.entityVerbs("person", []), "innate skills only (jump, takeoff)");
    for (const v of Verbs.GATE_SKILLS.planet) assert.ok(!e.entity.verbs.includes(v), `plain explorer has no ${v}`);
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(!fs.existsSync(path.join(tmp, "di-ship.png")) && !fs.existsSync(path.join(tmp, "di-explorer.png")), "a fallback is not kept");
  });

  await test("bad input refused cleanly: no player, no image, not a data URL, unknown kind", async () => {
    assert.deepStrictEqual(await Astra.generate({ kind: "ship", image: png("x") }), { ok: false, error: "player required" });
    assert.strictEqual((await Astra.generate({ player: "a", kind: "ship" })).ok, false);
    assert.strictEqual((await Astra.generate({ player: "a", kind: "explorer", image: "http://x/y.png" })).ok, false);
    assert.strictEqual((await Astra.generate({ player: "a", kind: "car", image: png("c") })).ok, false);
  });

  console.log = realLog;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms.toFixed(1)} ms)${r.ok ? "" : "\n     " + (r.err && r.err.stack)}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
