// v1.8 render probe (node only, no browser): hud().me while the phone pauses rendering. Takes render.js's own Snapshots class
// and the two snapTick lines (hudNow's re-sample and the frame loop's mark) out of render.js and replays the round-2 case:
// a frame samples round 1 (me on the planet, hp 40), the draw screen pauses the loop, round 2's ticks arrive (me in space,
// hp 100, lobby), then the page reads hud(). Checks: the read sees round 2 (v1.7 saw round 1), a second read with no new
// tick does not sample again, a frame's own sample is never redone by a read inside that frame, and the sample is the pooled
// object (no new allocation per read).
// node dev/v18-render/hud-probe.mjs
import fs from "node:fs";
const src = fs.readFileSync(new URL("../../render.js", import.meta.url), "utf8");
const cut = (start, end = "\n}\n") => { const a = src.indexOf(start); if (a < 0) throw new Error(`render.js: no ${start}`); return src.slice(a, src.indexOf(end, a) + end.length); };
const snapshots = cut("class Snapshots {");
const reread = /\n\s*(if \(S\.latest && snapTick !== S\.latest\) \{[^\n]*\})/.exec(src)?.[1];
const mark = /\n\s*(snapTick = game\.snaps\.latest;)/.exec(src)?.[1];
if (!reread || !mark) throw new Error("render.js: hudNow re-sample or frame mark not found");
let now = 1_000_000;
const clock = { now: () => now };
const make = new Function("Date", `
  const INTERP_DELAY_MS = 100, SNAP_NONE = Object.freeze([]);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  function lerpAngle(a, b, u) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * u; }
  ${snapshots}
  return (fixed) => {
    const game = { snaps: new Snapshots(), lastSnap: null };
    let snapTick = null, samples = 0;
    const sample0 = game.snaps.sample.bind(game.snaps);
    game.snaps.sample = () => { samples++; return sample0(); };
    const frame = () => { game.lastSnap = game.snaps.sample(); ${mark} };
    const read = () => { const me = (game.lastSnap || { players: [] }).players.find((p) => p.name === "ana"); return me ? { mode: me.mode, hp: me.hp, flags: me.flags } : null; };
    const hud = fixed ? () => { const S = game.snaps; ${reread} return read(); } : read;
    return { game, frame, hud, samples: () => samples };
  };`)(clock);
const tick = (t, round, mode, hp, phase) => ({ t, round, phase, clock: 0, left: 240, players: [{ name: "ana", color: 1, mode, hp, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, shieldEnergy: 1, boostEnergy: 1, score: 0, flags: mode === "planet" ? { digging: true } : {} }], bullets: [], bossShots: [] });
let fail = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fail++; };
for (const fixed of [false, true]) {
  const g = make(fixed);
  for (let k = 0; k < 5; k++) { now += 50; g.game.snaps.push(tick(now, 1, "planet", 40, "playing")); }
  now += 16; g.frame(); // the last frame before the draw screen
  const beforePause = g.hud();
  for (let k = 0; k < 40; k++) { now += 50; g.game.snaps.push(tick(now, 2, "space", 100, "lobby")); } // 2 s paused: round 2 starts
  now += 10;
  const s0 = g.samples(), snapObj = g.game.lastSnap, read1 = g.hud(), s1 = g.samples(), read2 = g.hud(), s2 = g.samples();
  if (!fixed) { check(read1.mode === "planet" && read1.hp === 40, `v1.7 (no re-sample): the paused read is stale (round 1: ${read1.mode}, hp ${read1.hp}), the bug this fixes`); continue; }
  check(beforePause.mode === "planet" && beforePause.hp === 40, `before the pause: hud().me = ${beforePause.mode}, hp ${beforePause.hp}`);
  check(read1.mode === "space" && read1.hp === 100 && !read1.flags.digging, `paused, round 2's ticks in: hud().me = ${read1.mode}, hp ${read1.hp}, digging ${!!read1.flags.digging}`);
  check(s1 - s0 === 1, `the first read after new ticks samples once (${s1 - s0})`);
  check(s2 - s1 === 0 && read2.mode === "space", `a second read with no new tick does not sample again (${s2 - s1})`);
  check(g.game.lastSnap === snapObj, "the re-sample reuses the pooled sample object (no allocation per read)");
  now += 16; g.frame(); const s3 = g.samples(); g.hud(); check(g.samples() === s3, "a read right after a frame (no newer tick) keeps the frame's sample");
  now += 50; g.game.snaps.push(tick(now, 2, "space", 90, "playing")); now += 5; g.hud(); check(g.samples() === s3 + 1, "a new tick between frames: the next read samples once");
}
console.log(fail ? `${fail} FAIL` : "ALL PASS");
process.exit(fail ? 1 : 0);
