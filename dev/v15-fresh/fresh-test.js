// v1.5 "every round starts from scratch" (owner, 10 Oct 11:31): world.js and astra.js checks, no server, no network.
// Run: ASTRA_MOCK=1 node dev/v15-fresh/fresh-test.js
// World: a drawn ship, a controller and a spent drawing in round 1 are all gone in the round 2 lobby (plain ship, no layout,
// full budget, no parked ships), onRoundReset fires once with the new round and the names, and the player keeps their
// colour. Astra: the same drawing sent in round 2 is not a cache hit of round 1 (newRound clears and re-keys the cache).
process.env.ASTRA_MOCK = "1";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const Contract = require("../../contract");
const { createWorld } = require("../../world");

const resets = [];
const msgs = [];
const w = createWorld({ broadcast: (m) => msgs.push(m), onRoundReset: (round, names) => resets.push({ round, names }) });
const joined = w.join("ana");
w.setEntity("ana", "ship", { type: "ship", unlocked: [{ verb: "shoot", part: "gun" }], parts: [{ name: "gun", x: 0.5, y: 0.5 }], source: "model" });
w.setLayout("ana", { buttons: [{ type: "button", action: "shoot", label: "FIRE", x: 0.7, y: 0.5, w: 0.2, h: 0.3 }], source: "model" });
w.spendDrawing("ana", "space");
assert.strictEqual(w.players.ana.entity.source, "model");
assert.ok(w.layoutOf("ana").buttons.some((b) => b.action === "shoot"));
const leftBefore = w.drawingsLeft("ana").space;
assert.strictEqual(resets.length, 0, "no reset for the first lobby");
assert.ok(w.start());
const dt = 1 / Contract.SIM_HZ;
const limit = Contract.ROUND.maxSeconds + Contract.ROUND.scoreboardSeconds + 5;
for (let t = 0; t < limit && w.round === 1; t += dt) w.step(dt);
assert.strictEqual(w.round, 2, "round 2 began");
assert.strictEqual(w.phase, "lobby");
assert.deepStrictEqual(resets, [{ round: 2, names: ["ana"] }], "onRoundReset once, with the round and the names");
const p = w.players.ana;
assert.deepStrictEqual(p.drawn, { space: null, planet: null }, "drawings cleared");
assert.strictEqual(p.layout, null, "controller cleared");
assert.notStrictEqual(p.entity.source, "model", "the plain ship again");
assert.ok(!p.entity.verbs.includes("shoot"), "no skill carried over");
assert.ok(w.drawingsLeft("ana").space > leftBefore, "the drawing budget is full again");
assert.strictEqual(p.color, joined.color, "the colour carries over");
assert.ok(w.debug().parked.length === 0, "no parked ships");
const lastEntity = [...msgs].reverse().find((m) => m.type === "entity" && m.player === "ana");
assert.ok(lastEntity && lastEntity.entity.source !== "model", "every screen got the plain ship");
console.log("world: ok");

(async () => {
  const astra = require("../../astra");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v15-fresh-"));
  astra._internals.setDir(dir);
  astra._internals.reset();
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const body = { player: "ana", kind: "controller", image: png, source: "draw" };
  await astra.generate(body);
  await new Promise((r) => setTimeout(r, 50)); // round 1's saved copy is on disk
  assert.ok(fs.existsSync(path.join(dir, "ana-controller.png")), "round 1 saved its copy");
  assert.ok(astra._internals.state().cache > 0, "round 1 cached the reading");
  astra.newRound({ players: ["ana"] });
  assert.strictEqual(astra._internals.state().cache, 0, "newRound clears the cache");
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(path.join(dir, "ana-controller.png")), "the saved copy is deleted");
  await astra.generate(body);
  await new Promise((r) => setTimeout(r, 50)); // save() writes in the background
  assert.ok(fs.existsSync(path.join(dir, "ana-controller.png")), "the new round's drawing is saved again");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("astra: ok");
})().catch((err) => { console.error(err); process.exit(1); });
