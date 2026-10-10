#!/usr/bin/env node
// v18-genquality (owner 13:04: "Make sure generation can take more seconds (up to 10) but it is VERY VERY GOOD").
// The real server path for every drawing of the ship set (dev/v14-ship/drawings.mjs, 12) and the planet set
// (dev/v14-entity3d/drawings.mjs, 10): Astra.generate({ kind: "ship" | "explorer" }) runs the entity reading and the 3D spec
// call in parallel exactly as server.js does, with astra.js's OWN requests (effort, image detail, budgets, prompts), and the
// late spec comes through onShipSpec like in the game. Identical requests of one drawing (astra's hedge) join one real call,
// so the latency is the raw single-call latency (the hedge is simulated in the report). Every real HTTP request counts in
// dev/v18-genquality/calls-used.json (cap 120 for the lane). The key: astra.js loads it and puts it on its own request; this
// harness forwards that request untouched and never reads, prints or stores the key.
//
//   node dev/v18-genquality/run.mjs calls  --tag base [--set ships|bodies|all] [--only id,id] [--conc 4] [--reads-from <tag>]
//     --reads-from <tag>: only the 3D spec call is made (astra's shipSpec + specFor, as in the game); the entity reading
//     (and its latency) is the one saved by that earlier run (saves one call per drawing when only the spec changed).
//   node dev/v18-genquality/run.mjs renorm --tag v18med [--set ships|bodies|all]   (no call: the saved raw answers through
//     the current astra-ship.js / astra-body.js normalize + reconcile with the saved reading, as astra.js specFor does)
//   node dev/v18-genquality/run.mjs report --tags base,v18 [--hedge 6000 --timeout 11000 --spec-hedge 7000 --spec-timeout 12000]
// calls writes dev/v18-genquality/<tag>/{ships,bodies}/<id>.spec.json + summary.json in the v14 harnesses' format, so
//   node dev/v14-ship/compare.mjs render --out dev/v18-genquality/<tag>/ships --port 8601
//   node dev/v14-entity3d/compare.mjs render --out dev/v18-genquality/<tag>/bodies --port 8602
// render each spec next to its drawing (three angles; bodies in three poses) plus a contact sheet.
import { createRequire } from "module";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { SHIPS, imageOf as shipImage } from "../v14-ship/drawings.mjs";
import { BODIES, imageOf as bodyImage } from "../v14-entity3d/drawings.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const phase = argv[0];
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const CAP = 120;
const USED_FILE = path.join(HERE, "calls-used.json");
const used = () => { try { return JSON.parse(fs.readFileSync(USED_FILE, "utf8")).calls || 0; } catch { return 0; } };
const addUsed = (n, note) => {
  let j = { cap: CAP, calls: 0, log: [] };
  try { j = JSON.parse(fs.readFileSync(USED_FILE, "utf8")); } catch {}
  j.calls = (j.calls || 0) + n;
  (j.log || (j.log = [])).push({ at: new Date().toISOString(), n, note });
  fs.writeFileSync(USED_FILE, JSON.stringify(j, null, 2));
};
const q = (list, p) => (list.length ? list[Math.min(list.length - 1, Math.floor(p * list.length))] : null);
const sorted = (xs) => xs.filter(Number.isFinite).sort((a, b) => a - b);
const usageOf = (data) => (data && data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens,
  reasoning: data.usage.output_tokens_details && data.usage.output_tokens_details.reasoning_tokens } : null);

// controllers (--set controllers, not part of "all"): the first drawn controllers of dev/gen-corpus/index.json, to check
// that the v1.8 image detail does not hurt controller readings (their effort stays medium).
const CORPUS = path.join(ROOT, "dev/gen-corpus");
const CONTROLLERS = (() => { try { return JSON.parse(fs.readFileSync(path.join(CORPUS, "index.json"), "utf8")).filter((c) => c.kind === "controller" && c.source === "draw"); } catch { return []; } })();
const ctlImage = (d) => { const bytes = fs.readFileSync(path.join(CORPUS, d.file)); return { file: `dev/gen-corpus/${d.file}`, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` }; };
const SETS = {
  ships: { kind: "ship", list: SHIPS, imageOf: shipImage, lib: "astra-ship.js" },
  bodies: { kind: "explorer", list: BODIES, imageOf: bodyImage, lib: "astra-body.js" },
  controllers: { kind: "controller", list: CONTROLLERS, imageOf: ctlImage },
};
// Controls read vs the corpus's expected ones: same action and overlapping rectangles (IoU ≥ 0.3).
function matchControls(expected, got) {
  const iou = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.w * a.h + b.w * b.h - i || 1); };
  const left = got.slice();
  let hit = 0, iouSum = 0;
  for (const e of expected) {
    const k = left.findIndex((g) => g.action === e.action && iou(e.rect, g) >= 0.3);
    if (k >= 0) { hit++; iouSum += iou(e.rect, left[k]); left.splice(k, 1); }
  }
  return { expected: expected.length, got: got.length, hit, extra: left.length, meanIou: hit ? Math.round((iouSum / hit) * 100) / 100 : 0 };
}

// ---- calls: the real server path -------------------------------------------------------------------------------------
async function callsPhase() {
  const TAG = opt("tag");
  if (!TAG) throw new Error("--tag required");
  // Raw latency: no hedge and no timeout cut the call short here (the report replays astra's hedge and timeouts on it).
  for (const k of ["ASTRA_SPEC_TIMEOUT_MS", "ASTRA_SPEC_HEDGE_MS", "ASTRA_HEDGE_MS"]) process.env[k] = "90000";
  delete process.env.ASTRA_MOCK;
  const Astra = require(path.join(ROOT, "astra.js"));
  const I = Astra._internals;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v18gq-"));
  I.reset();
  I.setDir(tmp);
  I.setTimeoutMs(90000);
  const ONLY = opt("only") ? new Set(opt("only").split(",")) : null;
  const READS_FROM = opt("reads-from");
  const setNames = (opt("set", "all") === "all" ? ["ships", "bodies"] : [opt("set")]).filter((s) => SETS[s]);
  const jobs = [];
  for (const s of setNames) for (const d of SETS[s].list) if (!ONLY || ONLY.has(d.id)) jobs.push({ set: s, d });
  const byImage = new Map(); // data URL → job context (the fetch hook finds its drawing by the image it carries)
  const realFetch = globalThis.fetch;
  I.setFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    const content = body.input && body.input[0] && body.input[0].content || [];
    const image = (content.find((c) => c && c.type === "input_image") || {}).image_url;
    const ctx = byImage.get(image);
    if (!ctx) throw new TypeError("harness: request for an unknown drawing");
    const fmt = body.text && body.text.format && body.text.format.name;
    const type = /spec$/.test(String(fmt)) ? "spec" : "read";
    const key = crypto.createHash("sha1").update(init.body).digest("hex");
    let call = ctx.calls.get(key);
    if (!call) {
      if (used() >= CAP) throw new TypeError(`harness: call cap ${CAP} reached`);
      addUsed(1, `${TAG} ${ctx.set}/${ctx.d.id} ${type}${body.service_tier ? "" : " (default tier)"}`);
      const t0 = Date.now();
      call = { type, t0, effort: body.reasoning && body.reasoning.effort, detail: (content.find((c) => c && c.type === "input_image") || {}).detail,
        maxTokens: body.max_output_tokens, tier: body.service_tier || "default" };
      call.p = realFetch(url, { method: "POST", headers: init.headers, body: init.body })
        .then(async (res) => ({ status: res.status, text: await res.text(), ms: Date.now() - t0 }), (err) => ({ status: 0, text: String(err && err.message), ms: Date.now() - t0 }));
      ctx.calls.set(key, call);
    }
    const r = await call.p;
    if (r.status === 0) throw new TypeError(r.text);
    return new Response(r.text, { status: r.status, headers: { "Content-Type": "application/json" } });
  });
  const lateSpecs = new Map(); // player → resolve
  Astra.onShipSpec(({ player, spec }) => { const fn = lateSpecs.get(player); if (fn) fn(spec); });

  const conc = Math.max(1, Number(opt("conc", 4)));
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const { set, d } = jobs[i];
      const S = SETS[set];
      const img = S.imageOf(d);
      const ctx = { set, d, calls: new Map() };
      byImage.set(img.dataUrl, ctx);
      const player = `gq${i}`;
      const late = new Promise((resolve) => { lateSpecs.set(player, resolve); setTimeout(() => resolve(null), 95000); });
      const t0 = Date.now();
      const from = READS_FROM ? JSON.parse(fs.readFileSync(path.join(HERE, READS_FROM, set, `${d.id}.spec.json`), "utf8")) : null;
      const answer = from
        ? (from.entity ? { ok: true, entity: { ...from.entity } } : { ok: false, error: from.answerError || "no entity saved" })
        : await Astra.generate({ player, kind: S.kind, image: img.dataUrl, source: d.source, speculative: false }).catch((e) => ({ ok: false, error: String(e && e.message) }));
      const wallMs = from ? (from.read && from.read.ms) : Date.now() - t0;
      let spec = answer && answer.entity && answer.entity.spec;
      if (from && answer.entity) spec = I.specFor(answer.entity, await I.shipSpec(img.dataUrl, d.source, null, S.kind), I.sha1(img.dataUrl));
      else if (!spec && answer && answer.entity) spec = await late;
      const specWallMs = Date.now() - t0;
      const rec = { id: d.id, set, tag: TAG, desc: d.desc, drawing: img.file, source: d.source, expected: { type: d.type || "ship", skills: d.skills }, wallMs, specWallMs };
      if (from) { rec.readsFrom = READS_FROM; if (from.read) rec.read = from.read; }
      for (const call of ctx.calls.values()) {
        const r = await call.p;
        let data = null;
        try { data = JSON.parse(r.text); } catch {}
        const info = { ms: r.ms, status: r.status, usage: usageOf(data), effort: call.effort, detail: call.detail, maxTokens: call.maxTokens, tier: call.tier,
          incomplete: data && data.status === "incomplete" ? (data.incomplete_details && data.incomplete_details.reason) || "unknown" : undefined };
        try { info.raw = I.parseJson(I.extractText(data)); } catch (err) { info.error = r.status !== 200 ? `HTTP ${r.status}` : String(err.message); }
        (rec.httpLog || (rec.httpLog = [])).push({ type: call.type, ...info, raw: undefined });
        // The first call of each type is the one the game used (a later one of the same type is astra's retry).
        if (!rec[call.type]) rec[call.type] = info;
        else rec[call.type].retry = { ms: info.ms, status: info.status, error: info.error, usage: info.usage };
      }
      const e = answer && answer.entity;
      if (S.kind === "controller") {
        rec.layout = answer && answer.layout || null;
        rec.match = matchControls(d.controls || [], rec.layout ? rec.layout.buttons : []);
        if (!answer || !answer.ok) rec.answerError = answer && answer.error;
      } else if (e) {
        const exp = new Set(d.skills);
        const got = new Set(e.verbs.filter((v) => (e.unlocked || []).some((u) => u.verb === v)));
        rec.entity = { type: e.type, verbs: e.verbs, unlocked: e.unlocked, parts: e.parts, source: e.source, card: e.card, fallback: !!answer.fallback };
        rec.typeOk = e.type === (d.type || "ship");
        rec.missing = [...exp].filter((v) => !got.has(v));
        rec.extra = [...got].filter((v) => !exp.has(v));
      } else rec.answerError = answer && answer.error;
      // The v14 harness fields (render + sheet): ms / usage / schemaOk of the SPEC call; spec = what every screen builds.
      rec.ms = rec.spec && rec.spec.ms;
      rec.usage = rec.spec && rec.spec.usage;
      rec.raw = rec.spec && rec.spec.raw;
      rec.schemaOk = !!(spec && spec.source === "model");
      if (!rec.schemaOk) rec.error = (rec.spec && (rec.spec.error || rec.spec.incomplete)) || (spec ? `spec source ${spec.source}` : "no spec");
      rec.specCall = rec.spec;
      rec.spec = spec || null;
      const dir = path.join(HERE, TAG, set);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${d.id}.spec.json`), JSON.stringify(rec, null, 2));
      if (rec.spec) fs.writeFileSync(path.join(dir, `${d.id}.view.json`), JSON.stringify(rec.spec, null, 2));
      results.push(rec);
      const rd = rec.read || {}, sc = rec.specCall || {};
      if (S.kind === "controller") { console.log(`${TAG} ${set}/${d.id}: read ${rd.ms ?? "-"} ms (${rd.usage ? rd.usage.output + " out, " + rd.usage.input + " in" : rd.error || "-"}, detail ${rd.detail}, ${rd.effort}) controls ${rec.match.hit}/${rec.match.expected} matched, ${rec.match.extra} extra, IoU ${rec.match.meanIou} · calls ${used()}/${CAP}`); continue; }
      console.log(`${TAG} ${set}/${d.id}: read ${rd.ms ?? "-"} ms (${rd.usage ? rd.usage.output + " out" : rd.error || "-"}) ${e ? `${e.type} [${e.verbs.join(" ")}]${rec.missing.length ? ` MISSING ${rec.missing}` : ""}${rec.extra.length ? ` EXTRA ${rec.extra}` : ""}` : "NO ENTITY"} · spec ${sc.ms ?? "-"} ms (${sc.usage ? sc.usage.output + " out" : sc.error || "-"}) ${rec.schemaOk ? "ok" : "FAIL " + rec.error} · calls ${used()}/${CAP}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, worker));
  await new Promise((r) => setTimeout(r, 600)); // astra saves the finished drawing asynchronously
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const s of setNames) if (s !== "controllers") writeSummary(TAG, s);
  console.log(`done: real calls used ${used()}/${CAP}`);
}

// summary.json per set (merged with earlier runs of the same tag): what the v14 sheet pages show, plus the read stats.
function writeSummary(tag, set) {
  const dir = path.join(HERE, tag, set);
  if (!fs.existsSync(dir)) return null;
  const order = SETS[set].list.map((d) => d.id);
  const recs = fs.readdirSync(dir).filter((f) => f.endsWith(".spec.json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const specMs = sorted(recs.filter((r) => r.schemaOk).map((r) => r.ms));
  const readMs = sorted(recs.map((r) => r.read && r.read.ms));
  const sum = { tag, set, at: new Date().toISOString(), n: recs.length, schemaFailures: recs.filter((r) => !r.schemaOk).length,
    p50: q(specMs, 0.5), p90: q(specMs, 0.9), max: specMs[specMs.length - 1] ?? null,
    read: { p50: q(readMs, 0.5), p90: q(readMs, 0.9), max: readMs[readMs.length - 1] ?? null, failures: recs.filter((r) => (r.read && r.read.error) || !r.entity || r.entity.source !== "model").length },
    calls: recs.map((r) => ({ id: r.id, ms: r.ms, schemaOk: r.schemaOk, error: r.error, usage: r.usage, readMs: r.read && r.read.ms })) };
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(sum, null, 2));
  return sum;
}

// ---- report: latency per call type, schema failures, reading accuracy; astra's hedge + timeouts replayed ----------------
// A hedged call with raw latency t answers at min(t, H + t2), t2 drawn from the same tag's distribution (the median here:
// the replacement is a fresh call); past the timeout T it is a failure (read: plain entity; spec: one from the entity).
function reportPhase() {
  const tags = String(opt("tags", "base")).split(",");
  const H = Number(opt("hedge", 6000)), T = Number(opt("timeout", 11000)), SH = Number(opt("spec-hedge", 7000)), ST = Number(opt("spec-timeout", 12000));
  const rows = [];
  for (const tag of tags) {
    for (const set of ["ships", "bodies", "all"]) {
      const sets = set === "all" ? ["ships", "bodies"] : [set];
      const recs = [];
      for (const s of sets) {
        const dir = path.join(HERE, tag, s);
        if (!fs.existsSync(dir)) continue;
        writeSummary(tag, s);
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".spec.json"))) recs.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      }
      if (!recs.length) continue;
      const stat = (xs) => { const s = sorted(xs); return { n: s.length, p50: q(s, 0.5), p90: q(s, 0.9), max: s[s.length - 1] ?? null }; };
      const read = stat(recs.map((r) => r.read && r.read.ms)), spec = stat(recs.map((r) => r.specCall && r.specCall.ms));
      const hedged = (xs, h, t) => { const s = sorted(xs); const med = q(s, 0.5); return s.map((x) => Math.min(x, h + med)).map((x) => (x > t ? Infinity : x)); };
      const hr = hedged(recs.map((r) => r.read && r.read.ms), H, T), hs = hedged(recs.map((r) => r.specCall && r.specCall.ms), SH, ST);
      const tok = (k, f) => stat(recs.map((r) => r[k] && r[k].usage && r[k].usage[f]));
      // Expected skills as the game reads them now: "land" is no longer read since v1.6 (every ship lands by itself), so the
      // older fixtures' "land" is not a miss. A drawing whose image repeats another one (genqa-topview == E04) is a cache
      // hit: no call, no failure.
      for (const r of recs) {
        if (!r.entity) continue;
        const exp = new Set((r.expected && r.expected.skills || []).filter((v) => v !== "land"));
        const got = new Set((r.entity.unlocked || []).map((u) => u.verb));
        r.missing = [...exp].filter((v) => !got.has(v));
        r.extra = [...got].filter((v) => !exp.has(v));
      }
      rows.push({ tag, set, n: recs.length, read, spec,
        readSchemaFail: recs.filter((r) => (r.read && r.read.error) || !r.entity || r.entity.source !== "model").length, cacheHits: recs.filter((r) => !r.read && r.entity).length, specSchemaFail: recs.filter((r) => !r.schemaOk).length,
        readOut: tok("read", "output"), specOut: tok("specCall", "output"), readIn: tok("read", "input"), specIn: tok("specCall", "input"),
        typeWrong: recs.filter((r) => r.typeOk === false).map((r) => `${r.id}:${r.entity && r.entity.type}`),
        missing: recs.filter((r) => r.missing && r.missing.length).map((r) => `${r.id}:${r.missing.join("+")}`),
        extra: recs.filter((r) => r.extra && r.extra.length).map((r) => `${r.id}:${r.extra.join("+")}`),
        hedgedRead: { p90: q(hr, 0.9), timeouts: hr.filter((x) => x === Infinity).length, hedgesFired: recs.filter((r) => r.read && r.read.ms > H).length },
        hedgedSpec: { p90: q(hs, 0.9), timeouts: hs.filter((x) => x === Infinity).length, hedgesFired: recs.filter((r) => r.specCall && r.specCall.ms > SH).length } });
    }
  }
  const out = path.join(HERE, `report-${tags.join("-vs-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), hedge: { H, T, SH, ST }, rows }, null, 2));
  for (const r of rows) {
    console.log(`${r.tag.padEnd(10)} ${r.set.padEnd(6)} n=${r.n} (${r.read.n} read calls, ${r.cacheHits} cache hit)  READ p50 ${r.read.p50} p90 ${r.read.p90} max ${r.read.max} (out p50 ${r.readOut.p50}, fail ${r.readSchemaFail})  SPEC p50 ${r.spec.p50} p90 ${r.spec.p90} max ${r.spec.max} (out p50 ${r.specOut.p50}, in p50 ${r.specIn.p50}, fail ${r.specSchemaFail})`);
    console.log(`${"".padEnd(18)} with hedge ${H}/${T}: read p90 ${r.hedgedRead.p90} timeouts ${r.hedgedRead.timeouts} hedges ${r.hedgedRead.hedgesFired}; spec ${SH}/${ST}: p90 ${r.hedgedSpec.p90} timeouts ${r.hedgedSpec.timeouts} hedges ${r.hedgedSpec.hedgesFired}`);
    console.log(`${"".padEnd(18)} type wrong ${r.typeWrong.join(", ") || "-"} · missing ${r.missing.join(", ") || "-"} · extra ${r.extra.join(", ") || "-"}`);
  }
  console.log(`report: ${path.relative(ROOT, out)}`);
}

function renormPhase() {
  const TAG = opt("tag");
  const setNames = opt("set", "all") === "all" ? ["ships", "bodies"] : [opt("set")];
  for (const set of setNames) {
    const S = SETS[set], Lib = require(path.join(ROOT, S.lib)), dir = path.join(HERE, TAG, set);
    if (!fs.existsSync(dir)) continue;
    let n = 0;
    for (const d of S.list) {
      const file = path.join(dir, `${d.id}.spec.json`);
      if (!fs.existsSync(file)) continue;
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!rec.raw || !rec.entity) continue;
      const seed = Lib.seedOf(crypto.createHash("sha1").update(`${S.kind === "explorer" ? "bodyspec" : "shipspec"}${S.imageOf(d).dataUrl}`).digest("hex"));
      rec.spec = Lib.reconcile(Lib.normalize(rec.raw, { seed }), rec.entity);
      rec.spec.source = "model";
      fs.writeFileSync(file, JSON.stringify(rec, null, 2));
      fs.writeFileSync(path.join(dir, `${d.id}.view.json`), JSON.stringify(rec.spec, null, 2));
      n++;
    }
    console.log(`renorm ${TAG}/${set}: ${n} specs`);
  }
}

const PHASES = { calls: callsPhase, report: reportPhase, renorm: renormPhase };
if (!PHASES[phase]) { console.log("usage: node dev/v18-genquality/run.mjs calls --tag <t> [--set ships|bodies|all] [--only ids] [--conc 4] | report --tags a,b"); process.exit(2); }
Promise.resolve(PHASES[phase]()).catch((e) => { console.error(e); process.exit(1); });
