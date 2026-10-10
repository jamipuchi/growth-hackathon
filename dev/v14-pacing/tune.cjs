// Preload for tuning sweeps (v1.4 pacing): patches contract.js TUNING / ROUND in memory before world.js loads, so one
// sim run tries a set of numbers without editing any file.
//   PACING='{"bossDistance":400,"boss":{"hp":1200}}' node --require ./dev/v14-pacing/tune.cjs dev/netcode/balance-sim.mjs
// PACING deep-merges into TUNING, PACING_ROUND into ROUND; PACING_ROOT points at another checkout (default this repo).
const path = require("path");
const root = process.env.PACING_ROOT || path.resolve(__dirname, "../..");
const C = require(path.join(root, "contract.js"));
const merge = (t, s) => {
  for (const k in s) {
    if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k]) && t[k] && typeof t[k] === "object") merge(t[k], s[k]);
    else t[k] = s[k];
  }
};
if (process.env.PACING) merge(C.TUNING, JSON.parse(process.env.PACING));
if (process.env.PACING_ROUND) merge(C.ROUND, JSON.parse(process.env.PACING_ROUND));
