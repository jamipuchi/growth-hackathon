#!/usr/bin/env node
// v14 planet-entity body-spec test (owner 10:12: "We're doing the character 3d modelling as well?"), modelled on
// dev/v14-ship/compare.mjs. The 10 drawings of drawings.mjs through one model: one vision call each returns the body spec
// (astra-body.js), it is checked (normalize) and reconciled with the type and skills the entity reading gave; then every
// spec is built with entity3d.js and rendered in Chromium (3 poses × 3 angles next to its drawing), plus a contact sheet.
//
//   node dev/v14-entity3d/compare.mjs spec   --model gpt-6.1-sol [--only id,id] [--effort low] [--tier ultrafast] [--tag t]
//   node dev/v14-entity3d/compare.mjs render --model gpt-6.1-sol [--port 8441] [--only id,id] [--kit] [--poses idle,walk,dig]
//   node dev/v14-entity3d/compare.mjs sheet  --model gpt-6.1-sol [--port 8441]
//   node dev/v14-entity3d/compare.mjs renorm --model gpt-6.1-sol          (re-check saved answers with the current astra-body.js)
//
// Writes dev/v14-entity3d/compare/<model>[-<tag>]/<id>.spec.json (raw answer, spec, latency, usage, errors), <id>.view.json
// (the bare spec view.html loads), <id>.png, contact.png and summary.json. Real OpenAI calls: capped at 40 for the whole
// lane (compare/calls-used.json counts every HTTP request). The key: astra.js loads it (OPENAI_API_KEY or the git-ignored
// .env) and puts it on its own request; this harness only swaps that request's JSON body for the body-spec body (astra's
// fetch hook), never reads, prints or stores the key.
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { BODIES, imageOf } from "./drawings.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const Body = require(path.join(ROOT, "astra-body.js"));

const argv = process.argv.slice(2);
const phase = argv[0];
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const MODEL = opt("model", "gpt-6.1-sol");
const ONLY = opt("only") ? new Set(opt("only").split(",")) : null;
const PORT = Number(opt("port", 8441));
const KIT = argv.includes("--kit"); // render with the A-012 texture kit (view.html &kit=1): <id>.kit.png
const POSES = opt("poses"); // view.html &poses=idle,walk,dig (rows)
const TAG = opt("tag"); // a variant run (e.g. --tag prompt2) goes to compare/<model>-<tag>/
// --out <dir> (from the repo root): render into another folder (v16: dev/v16-entity/chars), seeded from --from <dir> (the saved
// specs and summary of an earlier run, e.g. dev/v14-entity3d/compare/gpt-6.1-sol): replays them, no model call.
const OUT = opt("out") ? path.resolve(ROOT, opt("out")) : path.join(HERE, "compare", TAG ? `${MODEL}-${TAG}` : MODEL);
const FROM = opt("from") ? path.resolve(ROOT, opt("from")) : null;
const OUT_URL = "/" + path.relative(ROOT, OUT).split(path.sep).join("/");
const CAP = 40;
const USED_FILE = path.join(HERE, "compare", "calls-used.json");
const bodies = BODIES.filter((d) => !ONLY || ONLY.has(d.id));
fs.mkdirSync(OUT, { recursive: true });
if (FROM) for (const f of fs.readdirSync(FROM)) if (/\.spec\.json$|^summary\.json$/.test(f) && !fs.existsSync(path.join(OUT, f))) fs.copyFileSync(path.join(FROM, f), path.join(OUT, f));

const used = () => { try { return JSON.parse(fs.readFileSync(USED_FILE, "utf8")).calls || 0; } catch { return 0; } };
const addUsed = (n, note) => {
  let j = { calls: 0, log: [] };
  try { j = JSON.parse(fs.readFileSync(USED_FILE, "utf8")); } catch {}
  j.calls = (j.calls || 0) + n;
  (j.log || (j.log = [])).push({ at: new Date().toISOString(), n, note });
  fs.writeFileSync(USED_FILE, JSON.stringify(j, null, 2));
};
const entityOf = (d) => ({ type: d.type, unlocked: d.skills.map((verb) => ({ verb, part: "drawing" })) });

// ---- Phase: spec (real model calls) ----------------------------------------------------------------------------------

async function specPhase() {
  const Astra = require(path.join(ROOT, "astra.js"));
  const I = Astra._internals;
  const realFetch = globalThis.fetch;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v14body-"));
  I.setDir(tmp);
  const effort = opt("effort", "low"), tier = opt("tier", "ultrafast");
  const summary = [];
  for (const d of bodies) {
    if (used() >= CAP) { console.log(`call cap ${CAP} reached: stopping`); break; }
    const img = imageOf(d);
    const req = Body.request(img.dataUrl, { source: d.source, model: MODEL, effort, tier });
    // One real request per drawing and tier: astra's hedge (a second identical request after 2.2 s) and its retries get
    // the same answer. Without the tier (astra retries a 4xx naming the tier on the default tier) is a second request.
    const shared = new Map();
    let http = 0;
    I.reset();
    I.setTimeoutMs(90000);
    I.setFetch(async (url, init) => {
      const astraBody = JSON.parse(init.body);
      const withTier = "service_tier" in astraBody;
      if (!shared.has(withTier)) {
        if (used() >= CAP) { shared.set(withTier, Promise.resolve({ status: 0, text: `call cap ${CAP} reached`, ms: 0 })); }
        else {
          const body = { ...req };
          if (!withTier) delete body.service_tier;
          http++;
          addUsed(1, `${MODEL} ${d.id}${withTier ? "" : " (default tier)"}${TAG ? ` [${TAG}]` : ""}`);
          const t0 = Date.now();
          shared.set(withTier, realFetch(url, { method: "POST", headers: init.headers, body: JSON.stringify(body) })
            .then(async (res) => ({ status: res.status, text: await res.text(), ms: Date.now() - t0 }), (err) => ({ status: 0, text: String(err && err.message), ms: Date.now() - t0 })));
        }
      }
      const r = await shared.get(withTier);
      if (r.status === 0) throw new TypeError(r.text);
      return new Response(r.text, { status: r.status, headers: { "Content-Type": "application/json" } });
    });
    const t0 = Date.now();
    await Astra.generate({ player: "bodycmp", kind: "explorer", image: img.dataUrl, source: d.source, speculative: true }).catch(() => null);
    const wall = Date.now() - t0;
    const last = await (shared.get(false) || shared.get(true) || null);
    const rec = { id: d.id, model: MODEL, tag: TAG, effort, tier: shared.has(false) ? "default" : tier, desc: d.desc, type: d.type, skills: d.skills, drawing: img.file, http, wallMs: wall, ms: last ? last.ms : null, status: last ? last.status : null };
    try {
      if (!last) throw new Error("no request made");
      if (last.status === 0) throw new Error(last.text);
      const data = JSON.parse(last.text);
      if (last.status !== 200) throw new Error(`HTTP ${last.status}: ${String(data && data.error && data.error.message || "").slice(0, 200)}`);
      rec.usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens, reasoning: data.usage.output_tokens_details && data.usage.output_tokens_details.reasoning_tokens } : null;
      const raw = I.parseJson(I.extractText(data));
      rec.raw = raw;
      rec.spec = Body.reconcile(Body.normalize(raw, { seed: Body.seedOf(img.dataUrl) }), entityOf(d));
      rec.spec.source = "model";
      rec.schemaOk = true;
    } catch (err) {
      rec.schemaOk = false;
      rec.error = String(err && err.message || err);
      rec.spec = Body.fromEntity(entityOf(d), d.id);
      rec.spec.source = "entity";
    }
    fs.writeFileSync(path.join(OUT, `${d.id}.spec.json`), JSON.stringify(rec, null, 2));
    fs.writeFileSync(path.join(OUT, `${d.id}.view.json`), JSON.stringify(rec.spec, null, 2));
    summary.push({ id: d.id, ms: rec.ms, http, status: rec.status, schemaOk: rec.schemaOk, error: rec.error, usage: rec.usage });
    console.log(`${MODEL} ${d.id}: ${rec.schemaOk ? "ok" : "FAIL " + rec.error} ${rec.ms} ms (http ${http}, wall ${wall} ms) out=${rec.usage ? rec.usage.output : "-"} tok; calls used ${used()}/${CAP}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, "summary.json"), "utf8")); } catch { return { calls: [] }; } })();
  const merged = [...prev.calls.filter((c) => !summary.some((s) => s.id === c.id)), ...summary];
  const ok = merged.filter((c) => c.schemaOk), ms = ok.map((c) => c.ms).sort((a, b) => a - b);
  const q = (list, p) => list.length ? list[Math.min(list.length - 1, Math.floor(p * list.length))] : null;
  const out = ok.map((c) => c.usage && c.usage.output).filter(Number.isFinite).sort((a, b) => a - b);
  const outTokens = { p50: q(out, 0.5), max: out[out.length - 1] ?? null, total: out.reduce((a, b) => a + b, 0) };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ model: MODEL, tag: TAG, at: new Date().toISOString(), n: merged.length, schemaFailures: merged.length - ok.length,
    p50: q(ms, 0.5), p90: q(ms, 0.9), max: ms[ms.length - 1] ?? null, outTokens, callsUsed: used(), cap: CAP, calls: merged }, null, 2));
  console.log(`${MODEL}${TAG ? `-${TAG}` : ""}: ${ok.length}/${merged.length} specs ok, p50 ${q(ms, 0.5)} ms, p90 ${q(ms, 0.9)} ms, max ${ms[ms.length - 1] ?? "-"} ms; out tokens p50 ${outTokens.p50} max ${outTokens.max}; real calls used ${used()}/${CAP}`);
}

// ---- Phases: render, sheet (Chromium) ----------------------------------------------------------------------------------

const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((x) => new RegExp(`^${prefix}-\\d+$`).test(x)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = () => path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

// A port is free when nothing answers on it and it can be bound on 127.0.0.1.
async function portFree(port) {
  const answers = await new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
  if (answers) return false;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function withBrowser(fn) {
  if (!((PORT >= 8440 && PORT <= 8449) || (PORT >= 8500 && PORT <= 8509))) throw new Error(`--port ${PORT}: this lane uses 8440-8449 (v16: 8500-8509)`);
  if (!(await portFree(PORT))) throw new Error(`port ${PORT} is busy: pick another one in 8440-8449 with --port`);
  const server = spawn(process.execPath, [path.join(HERE, "serve.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  let browser = null;
  try {
    await new Promise((resolve, reject) => { server.stdout.once("data", resolve); server.once("exit", () => reject(new Error("serve.mjs exited"))); });
    const pw = require(PW_CORE);
    browser = await pw.chromium.launch({ executablePath: CHROME(), headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
    return await fn(browser);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}

async function renderPhase() {
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1300, height: 960 } });
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
    for (const d of bodies) {
      const specFile = path.join(OUT, `${d.id}.spec.json`);
      if (!fs.existsSync(specFile)) { console.log(`${d.id}: no spec yet`); continue; }
      const rec = JSON.parse(fs.readFileSync(specFile, "utf8"));
      fs.writeFileSync(path.join(OUT, `${d.id}.view.json`), JSON.stringify(rec.spec, null, 2)); // the bare spec view.html loads
      const specUrl = `${OUT_URL}/${d.id}.view.json`;
      const imgUrl = `/${imageOf(d).file}`;
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:${PORT}/dev/v14-entity3d/view.html?spec=${encodeURIComponent(specUrl)}&img=${encodeURIComponent(imgUrl)}&color=22d3ee&quality=big${KIT ? "&kit=1" : ""}${POSES ? `&poses=${encodeURIComponent(POSES)}` : ""}`);
      const ready = await page.waitForFunction(() => window.__ready, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch((e) => ({ ok: false, error: e.message }));
      const shot = path.join(OUT, `${d.id}${KIT ? ".kit" : ""}.png`);
      const sheet = page.locator("#sheet");
      if (await sheet.count()) await sheet.screenshot({ path: shot });
      else await page.screenshot({ path: shot });
      rec[KIT ? "renderKit" : "render"] = { ...ready, wallMs: Date.now() - t0 };
      fs.writeFileSync(specFile, JSON.stringify(rec, null, 2));
      console.log(`${d.id}: ${ready.ok ? `${ready.rig} tris ${ready.triangles} calls ${ready.drawCalls} build ${ready.ms} ms clips ${ready.clipsLoaded ? "A-008" : "none"}` : `RENDER FAIL ${ready.error}`}`);
    }
    if (!KIT) await sheetIn(browser);
  });
}

async function sheetIn(browser) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 400 } });
  await page.goto(`http://127.0.0.1:${PORT}/dev/v14-entity3d/sheet.html?model=${encodeURIComponent(path.basename(OUT))}&base=${encodeURIComponent(OUT_URL + "/")}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  await page.screenshot({ path: path.join(OUT, "contact.png"), fullPage: true });
  console.log(`contact sheet: ${path.relative(ROOT, path.join(OUT, "contact.png"))}`);
}
const sheetPhase = () => withBrowser(sheetIn);

// Re-check every saved answer with the current astra-body.js (no calls): normalize + reconcile again from the raw answer.
async function renormPhase() {
  let n = 0;
  for (const d of bodies) {
    const file = path.join(OUT, `${d.id}.spec.json`);
    if (!fs.existsSync(file)) continue;
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!rec.raw) continue;
    rec.spec = Body.reconcile(Body.normalize(rec.raw, { seed: Body.seedOf(imageOf(d).dataUrl) }), entityOf(d));
    rec.spec.source = "model";
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    fs.writeFileSync(path.join(OUT, `${d.id}.view.json`), JSON.stringify(rec.spec, null, 2)); // the bare spec view.html loads
    n++;
  }
  console.log(`re-normalized ${n} specs of ${path.basename(OUT)}`);
}

const PHASES = { spec: specPhase, render: renderPhase, sheet: sheetPhase, renorm: renormPhase };
if (!PHASES[phase]) { console.log("usage: node dev/v14-entity3d/compare.mjs spec|render|sheet|renorm --model <id> [--only ids] [--tag t] [--port 8441]"); process.exit(2); }
PHASES[phase]().catch((e) => { console.error(e); process.exit(1); });
