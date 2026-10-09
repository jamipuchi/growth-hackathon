// Generation regression test, offline: every corpus image (dev/gen-corpus) goes through astra.generate with a fake
// fetch that replays the model's REAL recorded answers (dev/gen-corpus/fixtures/<run>/<id>.json, recorded by
// dev/gen-corpus/score.js). No key, no network. It fails if any post-processing change (label binding, wrong-kind
// refusal, looksLike, entity skills, retries) changes an answer that was right, or the scorecard drops under the gates.
//   node dev/astra/gen-regression-test.js            (re-record fixtures with a key: node dev/gen-corpus/score.js --label after)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");

process.env.OPENAI_API_KEY = "sk-test-not-a-real-key"; // never a real key: the fake fetch answers everything
for (const k of ["OPENAI_MODEL", "OPENAI_SERVICE_TIER", "OPENAI_REASONING_EFFORT", "ASTRA_MOCK"]) delete process.env[k];

// GEN_REGRESSION_ASTRA=<path>: replay against another astra.js (a mutation check: the old one must fail).
const Astra = require(process.env.GEN_REGRESSION_ASTRA ? path.resolve(process.env.GEN_REGRESSION_ASTRA) : "../../astra.js");
const { scoreCase, summarise, table } = require("../gen-corpus/scoring.js");
const CORPUS = path.join(__dirname, "../gen-corpus");
const RUNS = ["after", "confirm", "pad"]; // later runs win when they hold a complete answer for a case
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

const cases = JSON.parse(fs.readFileSync(path.join(CORPUS, "index.json"), "utf8"));
// v1.2 (PLAN.md section 0): the drill is a planet skill only. A ship drawing can no longer unlock it (astra keeps the
// model's reading and filters the skill out), so for ship cases the expectation and the recorded answer drop it.
// Nothing else is adjusted: every other answer must still match its recording exactly.
const NOT_ON_SHIPS = ["drill"];
for (const c of cases) if (c.kind === "ship" && c.entity) for (const k of ["must", "ok"]) c.entity[k] = c.entity[k].filter((v) => !NOT_ON_SHIPS.includes(v));
const asShipToday = (r) => (r && r.entity && r.entity.type === "ship"
  ? { ...r, entity: { ...r.entity, verbs: r.entity.verbs.filter((v) => !NOT_ON_SHIPS.includes(v)), unlocked: r.entity.unlocked.filter((u) => !NOT_ON_SHIPS.includes(u.verb)) } }
  : r);
const answered = (f) => f && f.calls.some((c) => c.status === 200 && c.response);
const fixtures = new Map();
for (const run of RUNS) {
  const dir = path.join(CORPUS, "fixtures", run);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    const f = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (answered(f)) fixtures.set(f.id, { ...f, run });
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gen-regression-"));
Astra._internals.setDir(tmp);
const realLog = console.log;
console.log = () => {};

// The fake fetch: the recorded calls of the case whose image this is, in order (aborted calls are skipped: they never
// answered). Anything unexpected is a test failure, never a network call.
let queues = new Map(), served = 0, unexpected = [], lastPromptSha = null;
const imageOf = (req) => ((req.input[0].content.find((c) => c.type === "input_image") || {}).image_url) || "";
Astra._internals.setFetch(async (url, opts) => {
  const req = JSON.parse(opts.body);
  const key = sha1(imageOf(req));
  lastPromptSha = sha1((req.input[0].content.find((c) => c.type === "input_text") || {}).text || "").slice(0, 12);
  const q = queues.get(key);
  const call = q && q.shift();
  if (!call) { unexpected.push(key.slice(0, 8)); return { ok: false, status: 599, json: async () => ({}), text: async () => "no fixture" }; }
  served++;
  const body = call.response;
  return { ok: call.status >= 200 && call.status < 300, status: call.status, json: async () => body, text: async () => JSON.stringify(body) };
});

// The essentials of an answer, for exact comparison with the recorded one.
const essence = (r) => r && {
  ok: !!r.ok, error: r.error || null, looksLike: r.looksLike || null, thing: r.thing || null,
  buttons: r.layout ? r.layout.buttons.map((b) => [b.type, b.action, b.label, b.x, b.y, b.w, b.h]) : null,
  source: r.layout ? r.layout.source : r.entity ? r.entity.source : null,
  entity: r.entity ? [r.entity.type, r.entity.verbs.join(" "), r.entity.unlocked.map((u) => u.verb).join(" ")] : null,
};

(async () => {
  const t0 = Date.now();
  const out = [], failures = [];
  let promptDrift = 0;
  for (const [i, c] of cases.entries()) {
    const f = fixtures.get(c.id);
    if (!f) { failures.push(`${c.id}: no recorded answer (run node dev/gen-corpus/score.js --label confirm --only ${c.id})`); continue; }
    const image = "data:image/png;base64," + fs.readFileSync(path.join(CORPUS, c.file)).toString("base64");
    assert.strictEqual(sha1(image), f.imageSha, `${c.id}: the corpus image changed since the fixture was recorded`);
    queues = new Map([[sha1(image), f.calls.filter((x) => x.status && (x.response || x.status !== 200)).map((x) => ({ ...x }))]]);
    const body = { player: `reg${i}`, kind: c.kind, image, source: c.source, speculative: false };
    if (c.region) body.region = c.region;
    if (c.pad) body.pad = c.pad;
    lastPromptSha = null;
    const t = Date.now();
    const r = await Astra.generate(body);
    if (lastPromptSha && f.calls[0] && f.calls[0].request.promptSha !== lastPromptSha) promptDrift++;
    const ms = Date.now() - t;
    const score = scoreCase(c, r);
    out.push({ id: c.id, ms, result: r, score });
    // 1. the same answer as recorded live (post-processing unchanged)
    const was = asShipToday(f.result);
    try { assert.deepStrictEqual(essence(r), essence(was)); } catch { failures.push(`${c.id}: answer changed\n     now ${JSON.stringify(essence(r))}\n     was ${JSON.stringify(essence(was))}`); }
    // 2. a case that passed live still passes
    if (f.pass && !score.pass) failures.push(`${c.id}: passed live, fails now: ${score.note}`);
    // 3. "Use it anyway" on a refused drawing: answered from the cache, no new call
    if (!r.ok && r.looksLike && c.wrong) {
      const before = served;
      const again = await Astra.generate({ ...body, anyway: true });
      if (served !== before) failures.push(`${c.id}: anyway made a new model call`);
      if (c.kind !== "button" && !again.ok) failures.push(`${c.id}: anyway refused: ${again.error}`);
    }
  }
  console.log = realLog;
  const summary = summarise(cases.filter((c) => out.some((o) => o.id === c.id)), out);
  console.log(table([{ label: "offline replay", summary }]));
  // 4. the scorecard gates (PLAN: the v1-gen-quality bar), on the replayed answers
  const gates = [
    ["controls found, clean ≥ 95%", summary.controlsFoundClean >= 95],
    ["controls found, photo ≥ 85%", summary.controlsFoundPhoto >= 85],
    ["labels right ≥ 95%", summary.labelsRight >= 95],
    ["entity type ≥ 90%", summary.entityType >= 90],
    ["unlocked verbs ≥ 85%", summary.unlockedVerbs >= 85],
    ["no gate verb missing", summary.gateVerbsMissing === 0],
    ["wrong kind caught ≥ 90%", summary.wrongKindCaught >= 90],
    ["no false wrong-kind alarm", summary.falseAlarms === 0],
    ["no invented control", summary.extraControls === 0],
    ["every recorded call replayed, nothing unexpected", unexpected.length === 0],
  ];
  for (const [name, ok] of gates) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failures.push(`gate: ${name}`); }
  for (const f of failures) console.log(`FAIL ${f}`);
  if (promptDrift) console.log(`note: ${promptDrift} fixture(s) were recorded with a different prompt than astra.js sends today (older wording, or no pad); the replay checks the code only. Re-record with a key after prompt changes: node dev/gen-corpus/score.js --label after`);
  console.log(`\n${out.length} cases replayed from ${new Set([...fixtures.values()].map((f) => f.run)).size} run(s), ${served} recorded calls, ${failures.length} failure(s), ${Date.now() - t0} ms`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
})();
