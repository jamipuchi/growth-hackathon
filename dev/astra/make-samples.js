// Writes samples/*.json from a real, seeded world.js round (so the samples are exactly what the server sends today),
// trimmed to a few rocks. Checked by dev/astra/check-samples.js. Run after a contract change:
//   node dev/astra/make-samples.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const Contract = require(path.join(ROOT, "contract.js"));
const Verbs = require(path.join(ROOT, "verbs.js"));
const { createWorld } = require(path.join(ROOT, "world.js"));
const AstraHtml = require(path.join(ROOT, "astra-html.js"));

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const msgs = [];
const w = createWorld({ random: mulberry32(4242), broadcast: (m) => msgs.push(m) });
const press = (player, action) => { w.handleInput({ type: "input", player, action, down: true }); w.handleInput({ type: "input", player, action, down: false }); };
const steps = (seconds) => { for (let i = 0; i < seconds * Contract.SIM_HZ; i++) w.step(1 / Contract.SIM_HZ); };
const T_STUN = Contract.TUNING.stunSeconds;
const kit = (type, extra) => ({ type, unlocked: [...Verbs.DEV_KIT[type === "ship" ? "space" : "planet"], ...extra], parts: [{ name: "cannon", x: 0.62, y: 0.4 }], source: "model" });

w.join("ana"); w.join("ben"); w.addBot("bot1");
w.start();
w.debug().rocks.splice(6);
w.setEntity("ana", "ship", kit("ship", [{ verb: "decoy", part: "a second, smaller copy of it" }, { verb: "tractor", part: "magnet" }, { verb: "inkbomb", part: "octopus" }]));
w.setEntity("ben", "ship", kit("ship", []));
const ana = w.players.ana, ben = w.players.ben;
Object.assign(ana, { pos: { x: 0, y: 0, z: -400 }, yaw: 0, pitch: 0 });
Object.assign(ben, { pos: { x: 40, y: 0, z: -400 }, yaw: 0, pitch: 0 });
w.handleInput({ type: "input", player: "ana", action: "boost", down: true });
press("ana", "emp"); steps(0.1);
press("ana", "inkbomb"); steps(0.1);
press("ana", "tractor"); steps(0.1);
press("ana", "mine"); press("ana", "decoy"); steps(0.2);
const tick = w.tickMessage();
// ben runs into the (armed) mine, waits out the stun, then shoots ana's decoy from 25 m behind it.
steps(0.8);
Object.assign(ben, { pos: { ...w.debug().mines[0].pos }, spawnShield: 0 }); steps(0.1);
steps(T_STUN + 0.2);
const d = w.debug().decoys[0];
if (d) { Object.assign(ben, { pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z + 25 }, yaw: 0, pitch: 0 }); w.handleInput({ type: "input", player: "ben", action: "shoot", down: true }); steps(1.5); }

const world = w.worldMessage({ entities: false });
const mischief = msgs.filter((m) => m.type === "mischief");
const cooldowns = msgs.filter((m) => m.type === "cooldown");
const kinds = new Set(mischief.map((m) => m.kind + (m.victim ? ":owner" : "")));

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, "samples/layout.json"), "utf8"));
const allowedActions = [...new Set(layout.buttons.map((b) => b.action))];
const html = AstraHtml.templateHtml(layout, { allowedActions });
const generated = { type: "generated", player: "ana", kind: "controller", layout, html, controls: AstraHtml.validateHtml(html, { allowedActions }).controls, htmlSource: "template", padLayout: layout };
const upgrade = { type: "generated", player: "ana", kind: "html", html, controls: generated.controls, htmlSource: "model", padLayout: layout };

const write = (file, value) => fs.writeFileSync(path.join(ROOT, "samples", file), JSON.stringify(value, null, 2) + "\n");
write("world.json", world);
write("tick.json", tick);
write("mischief.json", mischief);
write("cooldown.json", cooldowns);
write("generated.json", [generated, upgrade]);
write("info.json", { lanUrl: "http://192.168.1.20:8000", httpsUrl: "https://192.168.1.20:8443", controllerUrl: "https://192.168.1.20:8443/controller.html", bigScreenUrl: "http://192.168.1.20:8000/space.html" });
console.log(`samples written: world ${JSON.stringify(world).length} B (${world.rocks.length} rocks), tick ${JSON.stringify(tick).length} B (mines ${tick.mines.length}, decoys ${tick.decoys.length}), mischief ${mischief.length} (${[...kinds].join(", ")}), generated 2`);
if (kinds.size < 6) { console.log("expected all six mischief messages (emp, inkbomb, tractor, mine, decoy, decoy:owner)"); process.exit(1); }
