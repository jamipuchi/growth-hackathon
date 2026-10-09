// Live corpus run of astra-html.js against the real OpenAI API (gpt-6.1-sol, ultrafast, effort low).
//   node dev/v12-modules/live-corpus.js [--only c01-basic,c05-gates] [--limit 10] [--tag run1]
// Reads dev/v12-modules/corpus/corpus.json (drawings + the layout Astra reads from each), calls
// generateControllerHtml for each, writes corpus/out/<name>.html (and <name>.template.html), and
// corpus/results-<tag>.json. Every HTTP call to OpenAI is appended to dev/v12-modules/calls.log; the run stops
// before the log reaches CALL_CAP (80 for this lane). The key comes from the env or .env and is never printed.
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const CORPUS = path.join(HERE, "corpus");
const OUT = path.join(CORPUS, "out");
const CALL_LOG = path.join(HERE, "calls.log");
const CALL_CAP = 80;
process.env.ASTRA_HTML_CALL_LOG = CALL_LOG;
const AstraHtml = require(path.join(HERE, "../../astra-html.js"));

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const only = opt("only", "") ? opt("only", "").split(",") : null;
const limit = Number(opt("limit", 10));
const tag = opt("tag", "run");
const callsUsed = () => (fs.existsSync(CALL_LOG) ? fs.readFileSync(CALL_LOG, "utf8").split("\n").filter(Boolean).length : 0);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const corpus = JSON.parse(fs.readFileSync(path.join(CORPUS, "corpus.json"), "utf8")).filter((d) => !only || only.includes(d.name)).slice(0, limit);
  const results = [];
  for (const d of corpus) {
    if (callsUsed() >= CALL_CAP - 2) { console.log(`call cap reached (${callsUsed()} of ${CALL_CAP}); stopping`); break; }
    const image = "data:image/png;base64," + fs.readFileSync(path.join(CORPUS, d.file)).toString("base64");
    const allowedActions = [...new Set(d.layout.buttons.map((b) => b.action))];
    const t0 = Date.now();
    const r = await AstraHtml.generateControllerHtml({ image, layout: d.layout, allowedActions, player: d.name });
    const ms = Date.now() - t0;
    fs.writeFileSync(path.join(OUT, `${d.name}.html`), r.html || "");
    fs.writeFileSync(path.join(OUT, `${d.name}.template.html`), AstraHtml.templateHtml(d.layout, { allowedActions }));
    const row = { name: d.name, ok: r.ok, source: r.source, ms, bytes: r.bytes, controls: (r.controls || []).length, drawn: d.layout.buttons.length, error: r.error || null, warnings: r.warnings || null };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  const model = results.filter((r) => r.source === "model");
  const times = model.map((r) => r.ms).sort((a, b) => a - b);
  const summary = {
    at: new Date().toISOString(), tag, n: results.length, model: model.length, template: results.length - model.length,
    medianMs: times[Math.floor(times.length / 2)] || null, maxMs: times.at(-1) || null,
    medianBytes: model.map((r) => r.bytes).sort((a, b) => a - b)[Math.floor(model.length / 2)] || null,
    callsUsedTotal: callsUsed(), results,
  };
  fs.writeFileSync(path.join(CORPUS, `results-${tag}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, results: undefined }));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
