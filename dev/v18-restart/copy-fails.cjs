// v18-restart proof helper, preloaded with `node --require ./dev/v18-restart/copy-fails.cjs server.js`. The first server
// loads normally; the copy that POST /restart spawns (it has SPACE_RESPAWN_OF) fails the way V18R_COPY says:
//   crash: it exits 1 before server.js loads (a broken file); hang: it blocks for 30 s and never says "loaded".
// spawnCopy() passes process.execArgv on, so the copy gets this --require too.
if (process.env.SPACE_RESPAWN_OF) {
  if (process.env.V18R_COPY === "hang") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  else { console.log("copy-fails.cjs: the respawned copy fails on purpose"); process.exit(1); }
}
