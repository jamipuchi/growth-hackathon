// Test-only preload for dev/v191-hallauto/hall-auto-check.cjs (node -r ./hook.js server.js, forked with IPC): keeps the
// world server.js creates and, on { cmd: "score", scores: { name: points } }, sets those players' round points, so the
// 1-minute round ends with a winner and the TV plays its full podium ceremony. Never loaded by the game.
const Module = require("module");
const worlds = [];
const load = Module._load;
Module._load = function (request) {
  const out = load.apply(this, arguments);
  if (/(^|\/)world(\.js)?$/.test(request) && out && typeof out.createWorld === "function" && !out.__hallautoHook) {
    const create = out.createWorld;
    out.createWorld = (opts) => { const w = create(opts); worlds.push(w); return w; };
    out.__hallautoHook = true;
  }
  return out;
};
process.on("message", (cmd) => {
  let reply = { ok: false };
  try {
    const W = worlds.find((w) => !w.practice) || null;
    if (cmd.cmd === "score" && W) {
      for (const [name, pts] of Object.entries(cmd.scores || {})) if (W.players[name]) W.players[name].score = Number(pts) || 0;
      reply = { ok: true, phase: W.phase };
    }
  } catch (err) { reply = { ok: false, error: String((err && err.stack) || err) }; }
  process.send({ id: cmd.id, ...reply });
});
