// node dev/https/perf-test.js: writes a synthetic dev/https/perf.log and checks perf-report.js against known answers.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { spawnSync } = require("child_process");
const { uaFamily } = require("../../perf-report");

const LOG = path.join(__dirname, "perf.log");
const REPORT = path.join(__dirname, "../../perf-report.js");
const UA = {
  iphone18: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphone16: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

// Deterministic jitter so the expected numbers are exact.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const now = Date.now();
const lines = [];
function series({ player, screen, ua, n, fps, low1, p90ms, calls, tris, tier = () => 0, ageS = 0, prefix = false }) {
  for (let i = 0; i < n; i++) {
    const t = now - ageS * 1000 - (n - i) * 5000;
    const s = { t, player, screen, ua, fps: fps(i), low1: low1(i), p90ms: p90ms(i), calls: calls(i), tris: tris(i), textures: 14, tier: tier(i), w: 844, h: 390, dpr: 3 };
    if (prefix) { delete s.t; lines.push(`${new Date(t).toISOString()} ${JSON.stringify(s)}`); }
    else lines.push(JSON.stringify(s));
  }
}
// ana: iPhone 15 on iOS 18, healthy (PASS). One loading hitch (low1 12) is ignored by the 5th percentile with 40 samples.
series({ player: "ana", screen: "phone", ua: UA.iphone18, n: 40, fps: () => 59 + rnd(), low1: (i) => (i === 3 ? 12 : 45 + rnd() * 5), p90ms: () => 14 + rnd(), calls: () => 60 + Math.floor(rnd() * 10), tris: () => 80000 + Math.floor(rnd() * 20000) });
// ben: iPhone XR on iOS 16, too slow; governor dropped tiers 0..2 (FAIL avg and 1% low). Timestamp-prefix line format.
series({ player: "ben", screen: "phone", ua: UA.iphone16, n: 12, fps: () => 45 + rnd() * 4, low1: () => 22 + rnd() * 4, p90ms: () => 24 + rnd() * 3, calls: () => 70, tris: () => 100000, tier: (i) => Math.min(3, i >> 2), prefix: true });
// cat: Android Chrome, fast but over the draw-call budget (FAIL calls).
series({ player: "cat", screen: "phone", ua: UA.android, n: 10, fps: () => 59.5, low1: () => 50, p90ms: () => 13, calls: (i) => (i === 5 ? 95 : 70), tris: () => 90000 });
// big screen: Chrome on the laptop (PASS) and Safari on a second Mac at 57 fps (FAIL avg < 58).
series({ player: "", screen: "big", ua: UA.chromeMac, n: 30, fps: () => 59.6 + rnd() * 0.4, low1: () => 52, p90ms: () => 16.9, calls: () => 140, tris: () => 400000 });
series({ player: "", screen: "big", ua: UA.safariMac, n: 6, fps: () => 57, low1: () => 40, p90ms: () => 18, calls: () => 140, tris: () => 400000 });
// dan: 30 minutes old; --since 10m must drop him.
series({ player: "dan", screen: "phone", ua: UA.iphone18, n: 5, fps: () => 20, low1: () => 10, p90ms: () => 60, calls: () => 70, tris: () => 100000, ageS: 1800 });
lines.push("not json at all", '{"broken": ');
fs.writeFileSync(LOG, lines.join("\n") + "\n");

assert.strictEqual(uaFamily(UA.iphone18), "iPhone (iOS 18)");
assert.strictEqual(uaFamily(UA.iphone16), "iPhone (iOS 16)");
assert.strictEqual(uaFamily(UA.android), "Chrome Android 14");
assert.strictEqual(uaFamily(UA.chromeMac), "Chrome macOS");
assert.strictEqual(uaFamily(UA.safariMac), "Safari macOS");
console.log("PASS ua families");

const t0 = Date.now();
const text = spawnSync("node", [REPORT, LOG, "--since", "10m"], { encoding: "utf8" });
const ms = Date.now() - t0;
console.log(text.stdout);
assert.strictEqual(text.status, 1, "exit 1 when any row fails");

const out = JSON.parse(spawnSync("node", [REPORT, LOG, "--since", "10m", "--json"], { encoding: "utf8" }).stdout).rows;
const row = (player, device) => out.find((r) => r.player === player && r.device === device);
assert.strictEqual(out.length, 5, "dan dropped by --since");
const ana = row("ana", "iPhone (iOS 18)");
assert.ok(ana.pass && ana.samples === 40 && ana.avgFps > 59 && ana.low1 >= 45, "ana passes; the one hitch is ignored");
const ben = row("ben", "iPhone (iOS 16)");
assert.deepStrictEqual([ben.pass, ben.fails, ben.tiers], [false, ["avg<55", "1%low<30"], [0, 1, 2]]);
assert.deepStrictEqual([row("cat", "Chrome Android 14").fails, row("cat", "Chrome Android 14").maxCalls], [["calls>80"], 95]);
assert.ok(row("-", "Chrome macOS").pass, "big Chrome passes");
assert.deepStrictEqual(row("-", "Safari macOS").fails, ["avg<58"]);
console.log(`PASS report rows (5 devices, dan filtered, 2 bad lines skipped) in ${ms} ms`);

const all = spawnSync("node", [REPORT, LOG, "--json"], { encoding: "utf8" });
assert.strictEqual(JSON.parse(all.stdout).rows.length, 6, "without --since dan is back");
const none = spawnSync("node", [REPORT, path.join(__dirname, "missing.log")], { encoding: "utf8" });
assert.strictEqual(none.status, 2);
console.log("PASS no --since keeps all 6; missing log exits 2");
console.log("ALL PASS");
