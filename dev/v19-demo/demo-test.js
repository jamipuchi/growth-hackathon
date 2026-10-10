// v1.9 demo (owner 13:41): round length, 1-minute pacing, lobby auto-start, quick explorer. node dev/v19-demo/demo-test.js
const assert = require("assert");
const Contract = require("../../contract.js");
const { createWorld, chestCount, bossHp } = require("../../world.js");
let n = 0; const ok = (t) => { n++; console.log(`ok  ${t}`); };
const DT = 1 / Contract.SIM_HZ;
const steps = (w, s) => { for (let i = 0; i < Math.round(s * Contract.SIM_HZ); i++) w.step(DT); };

const p4 = Contract.pacing(4), T = Contract.TUNING;
assert.deepStrictEqual([p4.maxSeconds, p4.assistsAt, p4.bossDistance, p4.bossHp, p4.planetOffset, p4.chestsBase, p4.digSeconds], [240, 180, T.bossDistance, T.boss.hp, T.planet.offset, T.island.chestsBase, T.island.digSeconds]);
assert.deepStrictEqual([chestCount(1), chestCount(25), bossHp(1)], [chestCount(1, p4), chestCount(25, p4), bossHp(1, p4)]);
ok("4 minutes = the pre-v1.9 tuning; chestCount / bossHp unchanged without a pace");
const p1 = Contract.pacing(1);
assert.deepStrictEqual([p1.maxSeconds, p1.assistsAt, p1.quickExplorerSeconds, chestCount(1, p1), bossHp(1, p1)], [60, 45, 12, 3, 300]);
assert.strictEqual(Contract.pacing(9).minutes, 4);
ok("1 minute: 60 s cap, assists at 0:45, quick explorer after 12 s, 3 chests and 300 HP solo");

const w = createWorld({ minutes: 1, startAfter: 30, readyGate: true });
let m = w.worldMessage();
assert.deepStrictEqual([m.minutes, m.roundMinutes, m.startAfter, m.startIn], [1, 1, 30, undefined]);
const bd = Math.hypot(m.targets[0].x, m.targets[0].z);
assert.ok(Math.abs(bd - p1.bossDistance) < 0.1, `boss at ${bd}`);
assert.strictEqual(w.setRoundLength(2), true);
m = w.worldMessage();
assert.deepStrictEqual([m.minutes, Math.round(Math.hypot(m.targets[0].x, m.targets[0].z))], [2, Contract.pacing(2).bossDistance]);
assert.strictEqual(w.setRoundLength(7), false);
w.setRoundLength(1);
ok("setRoundLength (lobby only, 1-4): the world is built again for the new length, minutes on the wire");

w.setEndless(true);
assert.strictEqual(w.worldMessage().minutes, 4); assert.strictEqual(w.worldMessage().roundMinutes, 1);
w.setEndless(false);
assert.strictEqual(w.worldMessage().minutes, 1);
ok("ENDLESS plays the 4-minute tuning; off again, the picked length is back");

w.join("ana"); w.join("bob");
steps(w, 5);
assert.strictEqual(w.tickMessage().startIn, undefined, "no READY player: no auto-start");
w.useDefault("ana", "ship"); w.useDefault("ana", "controller");
steps(w, 1);
let t = w.tickMessage();
assert.ok(t.startIn >= 28 && t.startIn <= 30, `startIn ${t.startIn}`);
assert.strictEqual(t.minutes, 1);
assert.strictEqual(w.quickExplorer("ana"), null, "no quick explorer in the lobby");
steps(w, 29.5);
assert.strictEqual(w.phase, "countdown", "the auto-start plays the 3-2-1");
steps(w, 3.2);
assert.strictEqual(w.phase, "playing");
assert.deepStrictEqual(w.tickMessage().players.map((p) => p.name), ["ana"], "only the READY player is in");
ok("lobby auto-start: 30 s after the first READY player, the 3-2-1, then the ready players play (bob waits)");

assert.strictEqual(w.quickExplorer("bob"), null, "a waiting player gets none");
const e = w.quickExplorer("ana");
assert.ok(e, "an entity back");
assert.deepStrictEqual(w.players.ana.drawn.planet.unlocked.map((u) => u.verb), ["dig", "drill"], "dig + drill (the explorer drives it on landing)");
assert.strictEqual(w.players.ana.drawn.planet.source, "quick");
ok("quick explorer: only for a player in the round; a person who can DIG and DRILL, counted as the planet drawing");

steps(w, 45);
assert.ok(w.debug().assists, "assists at 0:45");
steps(w, 15.2);
assert.strictEqual(w.phase, "scoreboard", "time's up at 1:00");
assert.strictEqual(w.debug().result.reason, "time");
ok("the 1-minute round: assists at 0:45, ends at 1:00");

const w4 = createWorld({});
assert.deepStrictEqual([w4.minutes, w4.startAfter, w4.worldMessage().minutes], [4, 0, 4]);
ok("createWorld defaults: 4 minutes, no auto-start (every pre-v1.9 test)");
console.log(`\n${n} tests passed`);
