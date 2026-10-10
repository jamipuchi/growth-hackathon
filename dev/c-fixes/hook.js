// Test-only preload for dev/c-fixes/test.js (node -r ./hook.js server.js, forked with IPC). Never loaded by the game.
// 1. the mock reader (ASTRA_MOCK=1: the dev kit) answers every explorer with a jetpack among its parts (no fly in its unlocked
//    list, its card unchanged), as a real reading of a person with a jetpack does;
// 2. IPC { cmd: "planet", player }: puts that player of the main world on the planet (mode "planet") without minutes of flying,
//    so the next explorer drawing is committed on the planet; { cmd: "state", player } → mode and entity of that player.
const Module = require("module");
const worlds = [];
const load = Module._load;
Module._load = function (request) {
  const out = load.apply(this, arguments);
  if (/(^|\/)world(\.js)?$/.test(request) && out && typeof out.createWorld === "function" && !out.__cfixHook) {
    const create = out.createWorld;
    out.createWorld = (opts) => { const w = create(opts); worlds.push(w); return w; };
    out.__cfixHook = true;
  }
  if (/(^|\/)astra(\.js)?$/.test(request) && out && typeof out.generate === "function" && !out.__cfixHook) {
    const gen = out.generate;
    out.generate = async (body, opts) => {
      const r = await gen(body, opts);
      if (body && body.kind === "explorer" && r && r.ok && r.entity) {
        r.entity = { ...r.entity, parts: [...(r.entity.parts || []), { name: "jetpack", x: 0.5, y: 0.4 }] };
      }
      return r;
    };
    out.__cfixHook = true;
  }
  return out;
};
const mainWorld = () => worlds.find((w) => !w.practice) || null;
process.on("message", (cmd) => {
  let reply = { ok: false };
  try {
    const W = mainWorld();
    const p = W && W.players[cmd.player];
    if (cmd.cmd === "planet" && p) {
      p.mode = "planet";
      reply = { ok: true };
    } else if (cmd.cmd === "state" && p) {
      reply = { ok: true, mode: p.mode, entity: p.entity, drawn: p.drawn };
    }
  } catch (err) { reply = { ok: false, error: String((err && err.stack) || err) }; }
  process.send({ id: cmd.id, ...reply });
});
