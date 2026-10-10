// dev/hall-real/apply.js: writes the genuine judgments of dev/hall-real/results.json (judge.js: real Decisions API calls)
// into hall-mock/hall.json of each tree given (default: this repo). Scores and comment come only from results.json; an
// entry without a result is dropped, never kept with an old score. Re-ranked like hall.js list(): overall score, ties
// by the earlier drawing.
//   node dev/hall-real/apply.js [treeRoot ...]
const fs = require("fs");
const path = require("path");
const out = JSON.parse(fs.readFileSync(path.join(__dirname, "results.json"), "utf8"));
const roots = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(__dirname, "..", "..")];
for (const root of roots) {
  const file = path.join(root, "hall-mock", "hall.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const kept = doc.entries.filter((e) => out.results[e.id]).map((e) => {
    const r = out.results[e.id];
    return { ...e, judge: "done", error: null, scores: r.scores, score: r.score, comment: r.comment, mock: false, cached: false };
  });
  kept.sort((a, b) => b.score - a.score || a.at - b.at);
  kept.forEach((e, i) => (e.rank = i + 1));
  delete doc.mockHall;
  doc.examples = true; // sample drawings, genuinely judged (not this session's): the TV falls back to them when it has none
  doc.judgedAt = out.judgedAt;
  doc.judging = { ...doc.judging, running: false, done: kept.length, judged: kept.length, failed: 0, skipped: 0, pending: 0, unjudged: 0, total: kept.length, calls: out.calls, api: "openai decisions", model: out.model, mock: false };
  doc.entries = kept;
  fs.writeFileSync(file, JSON.stringify(doc, null, 1) + "\n");
  console.log(`${file}: ${kept.length} entries, ${doc.entries.map((e) => `${e.rank}. ${e.id} ${e.score}`).join(", ")}`);
}
