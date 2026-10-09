// Re-records the Sol controller HTML for the corpus drawings with the CURRENT prompt of astra-html.js (the Fortnite
// look), against the real OpenAI API (gpt-6.1-sol, ultrafast, effort low).
//   node dev/astra/sol-html/record.js [--only c01-basic,c05-gates] [--limit 10] [--tag run1]
// Reads dev/v12-modules/corpus/corpus.json and its PNGs (the drawings and the layout Astra reads from each; read-only),
// calls generateControllerHtml for each drawing (allowedActions = the layout's own actions) and writes
//   out/<name>.html            what the player would get: Sol's answer, or the template when Sol's was refused
//   out/<name>.rejected.html   Sol's raw answer when it was refused (validator or style gate), for the prompt work
//   results-<tag>.json         per drawing: ms, bytes, source, error, warnings, style score, tokens; plus a summary
// Every HTTP request to OpenAI is appended to calls.log next to this file (ASTRA_HTML_CALL_LOG, one line per request,
// a retry on another tier counts twice). HARD CAP: the run stops before that log reaches CALL_CAP lines (30 for this
// lane, over all runs: the log is only ever appended to), and the fetch hook below refuses a request at the cap too.
// The key is read by astra-html.js itself (env or .env); this script never reads or prints it.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const CORPUS = path.join(HERE, "../../v12-modules/corpus");
const OUT = path.join(HERE, "out");
const CALL_LOG = path.join(HERE, "calls.log");
const CALL_CAP = 30;
process.env.ASTRA_HTML_CALL_LOG = CALL_LOG;
if (process.env.ASTRA_MOCK === "1") { console.error("ASTRA_MOCK=1 is set: that is the template without any call. Unset it for a live recording."); process.exit(1); }
const AstraHtml = require(path.join(HERE, "../../../astra-html.js"));
const I = AstraHtml._internals;

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const only = opt("only", "") ? opt("only", "").split(",") : null;
const limit = Number(opt("limit", 10));
const tag = opt("tag", "run");
const callsUsed = () => (fs.existsSync(CALL_LOG) ? fs.readFileSync(CALL_LOG, "utf8").split("\n").filter(Boolean).length : 0);

// The real fetch, plus: the cap, and a copy of the raw answer so a refused one can be saved and studied.
let last = null;
I.setFetch(async (url, init) => {
  if (callsUsed() >= CALL_CAP) throw new Error(`call cap reached (${CALL_CAP})`);
  const res = await globalThis.fetch(url, init);
  let raw = null;
  try { raw = await res.clone().text(); } catch {}
  last = { status: res.status, raw };
  return res;
});

const rawAnswer = () => {
  try {
    const data = JSON.parse(last.raw);
    const usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens, reasoning: data.usage.output_tokens_details && data.usage.output_tokens_details.reasoning_tokens } : null;
    let html = null;
    try { html = I.extractHtml(I.extractText(data)); } catch {}
    return { html, usage };
  } catch { return { html: null, usage: null }; }
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const corpus = JSON.parse(fs.readFileSync(path.join(CORPUS, "corpus.json"), "utf8")).filter((d) => !only || only.includes(d.name)).slice(0, limit);
  const results = [];
  for (const d of corpus) {
    if (callsUsed() >= CALL_CAP - 2) { console.log(`call cap reached (${callsUsed()} of ${CALL_CAP} in calls.log); stopping before ${d.name}`); break; }
    const image = "data:image/png;base64," + fs.readFileSync(path.join(CORPUS, d.file)).toString("base64");
    const allowedActions = [...new Set(d.layout.buttons.map((b) => b.action))];
    last = null;
    const t0 = Date.now();
    const r = await AstraHtml.generateControllerHtml({ image, layout: d.layout, allowedActions, player: d.name });
    const ms = Date.now() - t0;
    fs.writeFileSync(path.join(OUT, `${d.name}.html`), r.html || "");
    const raw = last ? rawAnswer() : { html: null, usage: null };
    const rejectedFile = path.join(OUT, `${d.name}.rejected.html`);
    if (r.source !== "model" && raw.html) fs.writeFileSync(rejectedFile, raw.html); else fs.rmSync(rejectedFile, { force: true });
    const row = {
      name: d.name, ok: r.ok, source: r.source, ms, bytes: r.bytes, controls: (r.controls || []).length, drawn: d.layout.buttons.length,
      style: r.style ? { score: r.style.score, of: r.style.of, missing: r.style.missing, italic: r.style.italic } : null,
      error: r.error || null, warnings: r.warnings || null, tokens: raw.usage,
      ...(r.source !== "model" && raw.html ? { rejectedStyle: (() => { const v = AstraHtml.validateHtml(raw.html, { allowedActions, layout: d.layout }); return { ok: v.ok, errors: v.errors.slice(0, 4), style: v.style }; })() } : {}),
    };
    results.push(row);
    console.log(JSON.stringify(row));
    if (results.length >= 2 && results.slice(-2).every((x) => /^OpenAI HTTP 4\d\d|no OPENAI_API_KEY|call cap/.test(x.error || ""))) { console.log("two requests in a row failed on the request itself; stopping to save calls"); break; }
  }
  const model = results.filter((x) => x.source === "model");
  const med = (list) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const summary = {
    at: new Date().toISOString(), tag, promptSha1: crypto.createHash("sha1").update(I.INSTRUCTIONS).digest("hex").slice(0, 12), promptChars: I.INSTRUCTIONS.length,
    n: results.length, model: model.length, template: results.length - model.length,
    fullStyle: model.filter((x) => x.style && x.style.score === x.style.of).length, italic: model.filter((x) => x.style && x.style.italic).length,
    medianMs: med(model.map((x) => x.ms)), maxMs: model.length ? Math.max(...model.map((x) => x.ms)) : null, medianBytes: med(model.map((x) => x.bytes)),
    callsUsedTotal: callsUsed(), callCap: CALL_CAP,
  };
  fs.writeFileSync(path.join(HERE, `results-${tag}.json`), JSON.stringify({ ...summary, results }, null, 2));
  console.log(JSON.stringify(summary));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
