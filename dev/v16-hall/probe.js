// dev/v16-hall/probe.js: proves the Decisions API call shape hall.js sends, through hall.js itself, with at most 3 real
// calls (HALL_MAX_CALLS=3: retries count). Never prints the key. Writes only to a temp HALL_DIR.
//   node dev/v16-hall/probe.js [png ...]          (default: one ship, one explorer, one controller from dev/)
//   ASTRA_MOCK=1 node dev/v16-hall/probe.js       (no network: the mock path)
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
process.env.HALL_MAX_CALLS = "3";
process.env.HALL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hall-probe-"));
const hall = require(path.join(ROOT, "hall.js"));
hall.init();

const args = process.argv.slice(2);
const files = args.length ? args.map((f) => [f, "ship"]) : [
  ["dev/v16-entity/ships/E09-rocket.png", "ship"],
  ["dev/v16-entity/chars/astronaut-shovel.png", "explorer"],
  ["dev/astra/test-controller.png", "controller"],
];
const I = hall._internals;
console.log(`endpoint ${I.API_URL}, model ${I.MODEL}, cap ${I.MAX_CALLS}, key present: ${I.apiKeyPresent()}`);
const shape = I.buildRequest("ship", "data:image/png;base64,<...>");
console.log("request shape:", JSON.stringify({ ...shape, questions: shape.questions.map((q) => ({ type: q.type, name: q.name, n: (q.levels || q.choices || []).length })) }));
files.slice(0, 3).forEach(([f, kind], i) => {
  const buf = fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f));
  hall.archive({ player: `probe${i + 1}`, color: 0x22d3ee, round: 1, kind, image: buf, type: kind === "explorer" ? "person" : undefined });
});
console.log("judge:", JSON.stringify(hall.judge()));
const t0 = Date.now();
(function wait() {
  const s = hall.status();
  if (s.running && Date.now() - t0 < 60000) return setTimeout(wait, 300);
  for (const e of hall.list().entries) console.log(`#${e.rank ?? "-"} ${e.player} ${e.kind}: ${e.judge}${e.error ? ` (${e.error})` : ""} score ${e.score} ${JSON.stringify(e.scores)} "${e.comment}"`);
  console.log("status:", JSON.stringify(hall.status()));
  fs.rmSync(process.env.HALL_DIR, { recursive: true, force: true });
})();
