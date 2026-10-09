// Live scorecard: runs every corpus image through astra.generate (REAL OpenAI calls) and scores the answers against
// the ground truth. Every network call is counted against a hard cap (CAP, across all runs: calls.log has one JSON
// line per call) and recorded as a fixture for the offline regression test (dev/astra/gen-regression-test.js).
//   node dev/gen-corpus/score.js --label after [--astra path/to/astra.js] [--only C01,E02] [--kinds controller,button]
//        [--concurrency 6] [--no-fixtures] [--no-wrong] [--dry]   (--dry: count the cases, call nothing)
// The key never passes through here: astra.js reads it from the environment or .env itself.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { scoreCase, summarise, table } = require("./scoring.js");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "../..");
const CAP = 250;
const LOG = path.join(HERE, "calls.log");
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(`--${name}`);
const label = arg("label", "run");
const astraPath = path.resolve(arg("astra", path.join(ROOT, "astra.js")));
const only = arg("only") ? new Set(arg("only").split(",")) : null;
const kinds = arg("kinds") ? new Set(arg("kinds").split(",")) : null;
const concurrency = Number(arg("concurrency", 6));
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

const used = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).length : 0);
const cases = JSON.parse(fs.readFileSync(path.join(HERE, "index.json"), "utf8"))
  .filter((c) => (!only || only.has(c.id)) && (!kinds || kinds.has(c.kind)) && !(flag("no-wrong") && c.wrong));
if (!cases.length) { console.log("no cases"); process.exit(1); }
const already = used();
console.log(`${label}: ${cases.length} cases, ${already}/${CAP} real calls used so far, astra = ${path.relative(ROOT, astraPath)}`);
if (flag("dry")) process.exit(0);
if (already + cases.length > CAP) { console.log(`refusing: ${cases.length} more calls would pass the cap of ${CAP}`); process.exit(2); }

const Astra = require(astraPath);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gen-corpus-"));
Astra._internals.setDir(tmp);

// Fetch wrapper: cap, log, fixture capture. The image is identified by its hash; the key header is never touched.
const byImage = new Map(); // sha1(image data URL) → case id
const fixtures = new Map(); // case id → [{ request, status, ms, response }]
let callsThisRun = 0;
const realFetch = globalThis.fetch;
Astra._internals.setFetch(async (url, opts) => {
  if (used() >= CAP) throw new Error(`call cap ${CAP} reached`);
  const req = JSON.parse(opts.body);
  const content = (req.input && req.input[0] && req.input[0].content) || [];
  const image = (content.find((c) => c.type === "input_image") || {}).image_url || "";
  const prompt = (content.find((c) => c.type === "input_text") || {}).text || "";
  const id = byImage.get(sha1(image)) || "?";
  const entry = { at: new Date().toISOString(), run: label, case: id, model: req.model, tier: req.service_tier || null, effort: (req.reasoning && req.reasoning.effort) || null, maxTokens: req.max_output_tokens, detail: (content.find((c) => c.type === "input_image") || {}).detail };
  fs.appendFileSync(LOG, JSON.stringify({ ...entry, pending: true }) + "\n"); // counted before the request leaves
  callsThisRun++;
  const t0 = Date.now();
  let status = 0, text = "", error = null;
  try {
    const res = await realFetch(url, opts);
    status = res.status;
    text = await res.text();
  } catch (err) {
    error = err && err.name === "AbortError" ? "aborted" : String(err && err.message || err);
  }
  const ms = Date.now() - t0;
  let body = null;
  try { body = JSON.parse(text); } catch {}
  const usage = body && body.usage ? { in: body.usage.input_tokens, out: body.usage.output_tokens, reasoning: body.usage.output_tokens_details && body.usage.output_tokens_details.reasoning_tokens } : null;
  const done = { ...entry, status, ms, error, usage, respStatus: body && body.status, incomplete: body && body.incomplete_details ? body.incomplete_details.reason : null, httpError: status && status !== 200 ? (body && body.error && body.error.message || text).slice(0, 300) : null };
  fs.appendFileSync(path.join(HERE, "calls.detail.log"), JSON.stringify(done) + "\n");
  const { text: _t, ...format } = req.text || {};
  const request = { model: req.model, service_tier: req.service_tier, reasoning: req.reasoning, max_output_tokens: req.max_output_tokens, format: req.text && req.text.format && req.text.format.name, detail: entry.detail, promptSha: sha1(prompt).slice(0, 12), prompt };
  if (!fixtures.has(id)) fixtures.set(id, []);
  fixtures.get(id).push({ request, status, ms, error, response: body, text: body ? undefined : text.slice(0, 2000) });
  if (error) throw Object.assign(new Error(error === "aborted" ? "This operation was aborted" : error), { name: error === "aborted" ? "AbortError" : "Error" });
  return { ok: status >= 200 && status < 300, status, json: async () => { if (!body) throw new Error("not JSON"); return body; }, text: async () => text };
});

async function runCase(c, i) {
  const file = path.join(HERE, c.file);
  const image = "data:image/png;base64," + fs.readFileSync(file).toString("base64");
  byImage.set(sha1(image), c.id);
  const body = { player: `gc${label.replace(/[^a-z0-9]/gi, "").slice(0, 8)}${i}`, kind: c.kind, image, source: c.source, speculative: false, requestId: `${label}-${c.id}` };
  if (c.region) body.region = c.region;
  if (c.pad) body.pad = c.pad;
  const t0 = Date.now();
  let result;
  try { result = await Astra.generate(body); } catch (err) { result = { ok: false, error: `threw: ${err.message}` }; }
  const ms = Date.now() - t0;
  return { id: c.id, ms, result, score: scoreCase(c, result) };
}

(async () => {
  const realLog = console.log;
  const astraLines = [];
  console.log = (...a) => { const s = a.join(" "); if (s.startsWith("astra")) astraLines.push(s); else realLog(...a); };
  const t0 = Date.now();
  const out = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (next < cases.length) {
      const i = next++;
      out[i] = await runCase(cases[i], i);
      const r = out[i];
      realLog(`${r.id.padEnd(4)} ${String(r.ms).padStart(5)} ms  ${r.score.pass ? "PASS" : "FAIL"}  ${r.score.note}`);
    }
  }));
  console.log = realLog;
  const summary = summarise(cases, out);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  const report = { label, at: new Date().toISOString(), astra: path.relative(ROOT, astraPath), env: { effort: process.env.OPENAI_REASONING_EFFORT || null, tier: process.env.OPENAI_SERVICE_TIER || null }, calls: callsThisRun, wallSeconds: Number(wall), summary, cases: out.map((r) => ({ id: r.id, ms: r.ms, pass: r.score.pass, note: r.score.note, score: r.score, result: slim(r.result) })) };
  fs.mkdirSync(path.join(HERE, "runs"), { recursive: true });
  fs.writeFileSync(path.join(HERE, "runs", `${label}.json`), JSON.stringify(report, null, 1) + "\n");
  if (!flag("no-fixtures")) {
    const fdir = path.join(HERE, "fixtures", label);
    fs.mkdirSync(fdir, { recursive: true });
    for (const r of out) {
      const c = cases.find((x) => x.id === r.id);
      fs.writeFileSync(path.join(fdir, `${r.id}.json`), JSON.stringify({ id: r.id, file: c.file, kind: c.kind, source: c.source, region: c.region || null, imageSha: sha1("data:image/png;base64," + fs.readFileSync(path.join(HERE, c.file)).toString("base64")), calls: fixtures.get(r.id) || [], result: slim(r.result), pass: r.score.pass }, null, 1) + "\n");
    }
  }
  console.log(`\n${table([{ label, summary }])}`);
  console.log(`\n${label}: ${callsThisRun} real calls this run (${used()}/${CAP} total), ${wall} s wall`);
  fs.writeFileSync(path.join(HERE, "runs", `${label}.astra.log`), astraLines.join("\n") + "\n");
})();

function slim(result) {
  if (!result) return result;
  const r = { ...result };
  if (r.entity) r.entity = { type: r.entity.type, verbs: r.entity.verbs, unlocked: r.entity.unlocked, parts: r.entity.parts, source: r.entity.source };
  return r;
}
