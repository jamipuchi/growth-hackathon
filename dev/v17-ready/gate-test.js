// v1.7 ready gate (owner, 10 Oct 12:26: "all players and can start whenever (only the ready ones get in)"), node only:
//   node dev/v17-ready/gate-test.js
// READY = a ship drawing + a controller; START needs one ready human; only the ready ones play; the others wait (tick.waiting)
// and keep their drawings, controller and budget for the next round; ENDLESS lets a waiting player in once ready.
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const Contract = require(path.join(root, "contract"));
const Verbs = require(path.join(root, "verbs"));
const { createWorld } = require(path.join(root, "world"));

const ship = () => ({ type: "ship", unlocked: Verbs.DEV_KIT.space, parts: [], source: "devkit" });
const LAYOUT = { buttons: [{ type: "stick", action: "steer", label: "", x: 0.04, y: 0.4, w: 0.3, h: 0.55 }, { type: "button", action: "shoot", label: "SHOOT", x: 0.6, y: 0.5, w: 0.2, h: 0.2 }], source: "model" };
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const msgs = [];
let resetNames = null;
const w = createWorld({ broadcast: (m) => msgs.push(m), random, autostartSeconds: null, readyGate: true, onRoundReset: (round, names) => { resetNames = names; } });
const tick = () => { const t = w.tickMessage(); assert.deepStrictEqual(Contract.CHECKS.tick(t), []); return t; };
const run = (until, max = 600, dt = 0.5) => { for (let i = 0; i < max / dt && !until(); i++) w.step(dt); assert.ok(until(), "timed out"); };
const results = [];
const ok = (name) => { results.push(name); console.log("ok  " + name); };

// lobby: nobody ready, START refused
w.join("ana"); w.join("bob");
assert.strictEqual(w.readyCount(), 0);
assert.strictEqual(w.start(), false);
assert.strictEqual(w.phase, "lobby");
ok("START with nobody ready is refused (the lobby stays)");

// ana: ship + controller = READY; bob only a ship
w.setEntity("ana", "ship", ship()); w.setLayout("ana", LAYOUT);
w.setEntity("bob", "ship", ship());
assert.ok(w.budget.spend("bob", "space")); assert.ok(w.budget.spend("bob", "space")); // bob used 2 drawings this round
assert.strictEqual(w.readyCount(), 1);
let t = tick();
assert.ok(t.players.find((p) => p.name === "ana").flags.ready, "ana READY in the lobby");
assert.ok(!t.players.find((p) => p.name === "bob").flags.ready, "bob not READY (no controller)");
assert.strictEqual(t.waiting, undefined, "no waiting list in the lobby");
ok("READY = ship + controller (lobby flags.ready), readyCount 1");

// START: only ana plays
assert.strictEqual(w.start({ countdown: true }), true);
t = tick();
assert.strictEqual(t.phase, "countdown");
assert.deepStrictEqual(t.players.map((p) => p.name), ["ana"]);
assert.deepStrictEqual(t.waiting.map((x) => x.name), ["bob"]);
assert.strictEqual(t.waiting[0].ready, false);
assert.strictEqual(w.isWaiting("bob"), true);
assert.strictEqual(w.debug().playerCount >= 1, true);
run(() => w.phase === "playing", 10, 0.1);
ok("START: only the ready player is in the round; bob waits (tick.waiting)");

// a late joiner waits too; bob finishes his controller during the round: ready, still waiting
w.join("cy");
w.setLayout("bob", LAYOUT);
t = tick();
assert.deepStrictEqual(t.players.map((p) => p.name), ["ana"]);
assert.deepStrictEqual(t.waiting.map((x) => [x.name, x.ready]), [["bob", true], ["cy", false]]);
const bobPos = { ...w.players.bob.pos };
w.handleInput({ type: "input", player: "bob", action: "forward", down: true });
for (let i = 0; i < 20; i++) w.step(0.1);
assert.deepStrictEqual(w.players.bob.pos, bobPos, "a waiting player is not simulated");
w.handleInput({ type: "input", player: "bob", action: "forward", down: false });
ok("late joiners wait; a waiting player is not simulated");

// the round ends: only ana starts from scratch; bob keeps his ship, controller and budget
run(() => w.phase === "scoreboard", 400);
assert.deepStrictEqual(w.debug().result.scores.map((s) => s[0]), ["ana"], "results list only who played");
run(() => w.phase === "lobby", 60);
assert.deepStrictEqual(resetNames, ["ana"], "onRoundReset gets only who played");
assert.strictEqual(w.players.ana.drawn.space, null); assert.strictEqual(w.players.ana.layout, null);
assert.ok(w.players.bob.drawn.space && w.players.bob.layout, "bob keeps ship + controller");
assert.strictEqual(w.drawingsLeft("bob").space, Contract.TUNING.drawings.space - 2, "bob keeps his budget");
assert.strictEqual(w.drawingsLeft("ana").space, Contract.TUNING.drawings.space);
assert.strictEqual(w.readyCount(), 1, "bob is ready at once");
t = tick();
assert.ok(t.players.find((p) => p.name === "bob").flags.ready);
ok("next round: who played starts from scratch; who waited keeps drawings, controller and budget (ready at once)");

// ENDLESS: a waiting player enters as soon as they are ready
assert.strictEqual(w.setEndless(true), true);
assert.strictEqual(w.start({ countdown: false }), true);
t = tick();
assert.deepStrictEqual(t.players.map((p) => p.name), ["bob"]);
assert.deepStrictEqual(t.waiting.map((x) => x.name).sort(), ["ana", "cy"]);
w.setEntity("cy", "ship", ship()); w.setLayout("cy", LAYOUT);
w.step(0.1);
t = tick();
assert.deepStrictEqual(t.players.map((p) => p.name).sort(), ["bob", "cy"]);
assert.deepStrictEqual(t.waiting.map((x) => x.name), ["ana"]);
assert.ok(w.players.cy.spawnShield > 0, "enters with a spawn shield");
ok("ENDLESS: a waiting player jumps in once ready");

// gate off (tests, tools): everybody plays as before
const open = createWorld({ random, autostartSeconds: null });
open.join("ana"); open.join("bob");
assert.strictEqual(open.start(), true);
assert.deepStrictEqual(open.tickMessage().players.map((p) => p.name), ["ana", "bob"]);
assert.strictEqual(open.tickMessage().waiting, undefined);
ok("readyGate off: everybody plays, no waiting list");

console.log(`\n${results.length} tests passed`);
