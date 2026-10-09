// astra.js kinds "ship" and "explorer" (v1-ship-drawing): answered at once with the world's default rig, verbs and
// wired animations; no network; the finished drawing is kept as controllers/<player>-<kind>.png.
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

(async () => {
  await test("ship → ok at once: type ship, space verbs, anims for those verbs, no network", async () => {
    const t0 = performance.now();
    const r = await Astra.generate({ player: "Ana", kind: "ship", image: png("ship") });
    const ms = performance.now() - t0;
    assert.ok(ms < 20, `took ${ms} ms`);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entity.type, "ship");
    assert.ok(r.entity.verbs.includes("drill") && r.entity.verbs.includes("land") && r.entity.verbs.includes("shoot"));
    assert.ok(!r.entity.verbs.includes("dig") && !r.entity.verbs.includes("takeoff"));
    assert.ok(r.entity.verbs.every((v) => Verbs.VERBS[v].modes.includes("space")));
    for (const slot of ["idle", "move", "hit", "die", "respawn", "primary"]) assert.ok(r.entity.anims[slot], `anims.${slot}`);
    assert.ok(r.entity.anims.primary.byVerb && r.entity.anims.primary.byVerb.drill, "drill wired in primary");
    assert.deepStrictEqual(r.entity.anims, Astra.wireAnimations("ship", r.entity.verbs));
  });

  await test("explorer → type person with planet verbs (dig, takeoff; no drill, land)", async () => {
    const r = await Astra.generate({ player: "Ana", kind: "explorer", image: png("exp") });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entity.type, "person");
    assert.ok(r.entity.verbs.includes("dig") && r.entity.verbs.includes("takeoff"));
    assert.ok(!r.entity.verbs.includes("drill") && !r.entity.verbs.includes("land"));
    assert.ok(r.entity.anims.use && r.entity.anims.use.byVerb.dig, "dig wired (use slot)");
  });

  await test("finished drawing saved as controllers/<player>-<kind>.png (+ .json); speculative is not saved", async () => {
    await Astra.generate({ player: "Bo!", kind: "ship", image: png("bo-ship") });
    await Astra.generate({ player: "Cy", kind: "ship", image: png("cy-spec"), speculative: true });
    await new Promise((res) => setTimeout(res, 50));
    assert.strictEqual(fs.readFileSync(path.join(tmp, "bo-ship.png")).toString(), "fake-png-bo-ship");
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmp, "bo-ship.json"), "utf8")).type, "ship");
    assert.ok(!fs.existsSync(path.join(tmp, "cy-ship.png")));
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
