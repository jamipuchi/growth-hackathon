// dev/hall-real/judge.js: genuine scores for the 16 example Hall of Fame drawings (owner 14:45: nothing shown is fake).
// Judges every hall-mock/*.png in hall-mock/hall.json through hall.js itself (same Decisions API call, model gpt-6-luna,
// same questions, same key loader, same comment pick), at most 20 real calls (HALL_MAX_CALLS=20: retries count).
// A drawing that fails is judged once more (hall.js MAX_TRIES); one that still fails is left out of results.json.
// Never prints the key. Writes dev/hall-real/results.json; apply.js writes it into hall-mock/hall.json.
//   node dev/hall-real/judge.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
delete process.env.ASTRA_MOCK;
delete process.env.HALL_MOCK;
process.env.HALL_MAX_CALLS = "20";
process.env.HALL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hall-real-"));
const hall = require(path.join(ROOT, "hall.js"));
hall.init();
const I = hall._internals;
console.log(`endpoint ${I.API_URL}, model ${I.MODEL}, cap ${I.MAX_CALLS}, key present: ${I.apiKeyPresent()}`);
if (!I.apiKeyPresent()) { console.log("no key: nothing judged"); process.exit(1); }

const mockDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "hall-mock", "hall.json"), "utf8"));
const byHallId = new Map();
for (const e of mockDoc.entries) {
  const buf = fs.readFileSync(path.join(ROOT, "hall-mock", `${e.id}.png`));
  const hid = hall.archive({ player: e.id, color: e.color, round: e.round, kind: e.kind, type: e.type, image: buf });
  if (!hid) throw new Error(`archive refused ${e.id}`);
  byHallId.set(hid, e.id);
}

const settle = () => new Promise((resolve) => {
  const t0 = Date.now();
  (function wait() {
    if (hall.status().running && Date.now() - t0 < 240000) return setTimeout(wait, 300);
    resolve();
  })();
});

(async () => {
  console.log("judge:", JSON.stringify(hall.judge()));
  await settle();
  const failed = hall.list().entries.filter((e) => e.judge === "failed");
  if (failed.length) {
    console.log(`retrying ${failed.length}: ${failed.map((e) => `${e.player} (${e.error})`).join(", ")}`);
    hall.judge(); // failed entries with tries < 2 go again
    await settle();
  }
  const list = hall.list();
  const results = {};
  for (const e of list.entries) {
    console.log(`#${e.rank ?? "-"} ${e.player} ${e.kind}: ${e.judge}${e.error ? ` (${e.error})` : ""} score ${e.score} ${JSON.stringify(e.scores)} "${e.comment}"${e.cached ? " cached" : ""}`);
    if (e.judge === "done" && !e.mock && Number.isFinite(e.score)) results[byHallId.get(e.id)] = { scores: e.scores, score: e.score, comment: e.comment };
  }
  const status = hall.status();
  console.log("status:", JSON.stringify(status));
  const out = { judgedAt: new Date().toISOString(), api: I.API_URL, model: I.MODEL, calls: status.calls, judged: Object.keys(results).length, results };
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(out, null, 1) + "\n");
  fs.rmSync(process.env.HALL_DIR, { recursive: true, force: true });
  console.log(`wrote dev/hall-real/results.json: ${out.judged} judged, ${out.calls} real calls`);
})();
