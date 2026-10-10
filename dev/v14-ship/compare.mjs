#!/usr/bin/env node
// v14 ship-spec model comparison (owner, 09:30: "let's test 6.1, if that is not good enough let's test 6 astra").
// The same 12 drawings (drawings.mjs) through one model: one vision call each returns the ship spec (astra-ship.js), it
// is checked (normalize) and reconciled with the skills the entity reading unlocked; then every spec is built with
// ship3d.js and rendered in Chromium from three angles next to its drawing, plus a contact sheet.
//
//   node dev/v14-ship/compare.mjs spec   --model gpt-6.1-sol [--only id,id] [--effort low] [--tier ultrafast]
//   node dev/v14-ship/compare.mjs render --model gpt-6.1-sol [--port 8401] [--only id,id]
//   node dev/v14-ship/compare.mjs sheet  --model gpt-6.1-sol [--port 8401]
//   node dev/v14-ship/compare.mjs renorm --model gpt-6.1-sol          (re-check saved answers with the current astra-ship.js)
//
// Writes dev/v14-ship/compare/<model>/<id>.spec.json (raw answer, spec, latency, usage, errors), <id>.png, contact.png and
// summary.json. Real OpenAI calls: capped at 60 for the whole lane (compare/calls-used.json counts every HTTP request).
// The key: astra.js loads it (OPENAI_API_KEY or the git-ignored .env) and puts it on its own request; this harness only
// swaps that request's JSON body for the ship-spec body (astra's fetch hook), never reads, prints or stores the key.
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { SHIPS, imageOf } from "./drawings.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const Ship = require(path.join(ROOT, "astra-ship.js"));

const argv = process.argv.slice(2);
const phase = argv[0];
const opt = (name, def = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const MODEL = opt("model", "gpt-6.1-sol");
const ONLY = opt("only") ? new Set(opt("only").split(",")) : null;
const PORT = Number(opt("port", 8401));
const KIT = argv.includes("--kit"); // render with the A-012 texture kit (view.html &kit=1): <id>.kit.png
const TAG = opt("tag"); // a variant run (e.g. --tag prompt2) goes to compare/<model>-<tag>/
// --out <dir> (from the repo root): render into another folder (v16: dev/v16-entity/ships), seeded from --from <dir> (the saved
// specs and summary of an earlier run, e.g. dev/v14-ship/compare/gpt-6.1-sol-prompt2): replays them, no model call.
const OUT = opt("out") ? path.resolve(ROOT, opt("out")) : path.join(HERE, "compare", TAG ? `${MODEL}-${TAG}` : MODEL);
const FROM = opt("from") ? path.resolve(ROOT, opt("from")) : null;
const OUT_URL = "/" + path.relative(ROOT, OUT).split(path.sep).join("/");
const CAP = 60;
const USED_FILE = path.join(HERE, "compare", "calls-used.json");
const ships = SHIPS.filter((d) => !ONLY || ONLY.has(d.id));
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

// ---- Phase: spec (real model calls) ----------------------------------------------------------------------------------

async function specPhase() {
  const Astra = require(path.join(ROOT, "astra.js"));
  const I = Astra._internals;
  const realFetch = globalThis.fetch;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v14ship-"));
  I.setDir(tmp);
  const effort = opt("effort", "low"), tier = opt("tier", "ultrafast");
  const summary = [];
  for (const d of ships) {
    if (used() >= CAP) { console.log(`call cap ${CAP} reached: stopping`); break; }
    const img = imageOf(d);
    const req = Ship.request(img.dataUrl, { source: d.source, model: MODEL, effort, tier });
    // One real request per drawing and tier: astra's hedge (a second identical request after 2.2 s) and its retries get
    // the same answer. Without the tier (astra retries a 4xx naming the tier on the default tier) is a second request.
    const shared = new Map();
    let http = 0, firstErr = null;
    I.reset();
    I.setTimeoutMs(90000);
    I.setFetch(async (url, init) => {
      const astraBody = JSON.parse(init.body);
      const withTier = "service_tier" in astraBody;
      if (!shared.has(withTier)) {
        const body = { ...req };
        if (!withTier) delete body.service_tier;
        http++;
        addUsed(1, `${MODEL} ${d.id}${withTier ? "" : " (default tier)"}`);
        const t0 = Date.now();
        shared.set(withTier, realFetch(url, { method: "POST", headers: init.headers, body: JSON.stringify(body) })
          .then(async (res) => ({ status: res.status, text: await res.text(), ms: Date.now() - t0 }), (err) => ({ status: 0, text: String(err && err.message), ms: Date.now() - t0 })));
      }
      const r = await shared.get(withTier);
      if (r.status === 0) throw new TypeError(r.text);
      return new Response(r.text, { status: r.status, headers: { "Content-Type": "application/json" } });
    });
    const t0 = Date.now();
    await Astra.generate({ player: "shipcmp", kind: "ship", image: img.dataUrl, source: d.source, speculative: true }).catch(() => null);
    const wall = Date.now() - t0;
    const last = await (shared.get(false) || shared.get(true) || null);
    const rec = { id: d.id, model: MODEL, effort, tier: shared.has(false) ? "default" : tier, desc: d.desc, view: d.view, drawing: img.file, http, wallMs: wall, ms: last ? last.ms : null, status: last ? last.status : null };
    try {
      if (!last) throw new Error("no request made");
      const data = JSON.parse(last.text);
      if (last.status !== 200) throw new Error(`HTTP ${last.status}: ${String(data && data.error && data.error.message || "").slice(0, 200)}`);
      rec.usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens, reasoning: data.usage.output_tokens_details && data.usage.output_tokens_details.reasoning_tokens } : null;
      const raw = I.parseJson(I.extractText(data));
      rec.raw = raw;
      const spec = Ship.normalize(raw, { seed: Ship.seedOf(img.dataUrl) });
      rec.spec = Ship.reconcile(spec, { unlocked: d.skills.map((verb) => ({ verb, part: "drawing" })) });
      rec.schemaOk = true;
    } catch (err) {
      firstErr = String(err && err.message || err);
      rec.schemaOk = false;
      rec.error = firstErr;
      rec.spec = Ship.fromEntity({ unlocked: d.skills.map((verb) => ({ verb, part: "drawing" })) }, d.id);
    }
    fs.writeFileSync(path.join(OUT, `${d.id}.spec.json`), JSON.stringify(rec, null, 2));
    summary.push({ id: d.id, ms: rec.ms, http, status: rec.status, schemaOk: rec.schemaOk, error: rec.error, usage: rec.usage });
    console.log(`${MODEL} ${d.id}: ${rec.schemaOk ? "ok" : "FAIL " + rec.error} ${rec.ms} ms (http ${http}, wall ${wall} ms) out=${rec.usage ? rec.usage.output : "-"} tok`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, "summary.json"), "utf8")); } catch { return { calls: [] }; } })();
  const merged = [...prev.calls.filter((c) => !summary.some((s) => s.id === c.id)), ...summary];
  const ok = merged.filter((c) => c.schemaOk), ms = ok.map((c) => c.ms).sort((a, b) => a - b);
  const q = (p) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null;
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ model: MODEL, at: new Date().toISOString(), n: merged.length, schemaFailures: merged.length - ok.length, p50: q(0.5), p90: q(0.9), max: ms[ms.length - 1] ?? null, calls: merged }, null, 2));
  console.log(`${MODEL}: ${ok.length}/${merged.length} specs ok, p50 ${q(0.5)} ms, p90 ${q(0.9)} ms; real calls used ${used()}/${CAP}`);
}

// ---- Phases: render, sheet (Chromium) ----------------------------------------------------------------------------------

const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((x) => new RegExp(`^${prefix}-\\d+$`).test(x)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

async function withBrowser(fn) {
  const server = spawn(process.execPath, [path.join(HERE, "serve.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => { server.stdout.once("data", resolve); server.once("exit", () => reject(new Error("serve.mjs exited"))); });
  const pw = require(PW_CORE);
  const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
  try { return await fn(browser); } finally { await browser.close().catch(() => {}); server.kill(); }
}

async function renderPhase() {
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 500 } });
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    for (const d of ships) {
      const specFile = path.join(OUT, `${d.id}.spec.json`);
      if (!fs.existsSync(specFile)) { console.log(`${d.id}: no spec yet`); continue; }
      const rec = JSON.parse(fs.readFileSync(specFile, "utf8"));
      fs.writeFileSync(path.join(OUT, `${d.id}.view.json`), JSON.stringify(rec.spec, null, 2)); // the bare spec view.html loads
      const specUrl = `${OUT_URL}/${d.id}.view.json`;
      const imgUrl = `/${imageOf(d).file}`;
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:${PORT}/dev/v14-ship/view.html?spec=${encodeURIComponent(specUrl)}&img=${encodeURIComponent(imgUrl)}&color=22d3ee&quality=big&w=1500&h=500${KIT ? "&kit=1" : ""}`);
      const ready = await page.waitForFunction(() => window.__ready, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch((e) => ({ ok: false, error: e.message }));
      await page.screenshot({ path: path.join(OUT, `${d.id}${KIT ? ".kit" : ""}.png`) });
      rec[KIT ? "renderKit" : "render"] = { ...ready, wallMs: Date.now() - t0 };
      fs.writeFileSync(specFile, JSON.stringify(rec, null, 2));
      console.log(`${d.id}: ${ready.ok ? `tris ${ready.triangles} calls ${ready.drawCalls} build ${ready.ms} ms` : `RENDER FAIL ${ready.error}`}`);
    }
  });
  if (!KIT) await sheetPhase();
}

async function sheetPhase() {
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 400 } });
    await page.goto(`http://127.0.0.1:${PORT}/dev/v14-ship/sheet.html?model=${encodeURIComponent(path.basename(OUT))}&base=${encodeURIComponent(OUT_URL + "/")}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
    await page.screenshot({ path: path.join(OUT, "contact.png"), fullPage: true });
    console.log(`contact sheet: ${path.relative(ROOT, path.join(OUT, "contact.png"))}`);
  });
}

// Re-check every saved answer with the current astra-ship.js (no calls): normalize + reconcile again from the raw answer.
async function renormPhase() {
  for (const d of ships) {
    const file = path.join(OUT, `${d.id}.spec.json`);
    if (!fs.existsSync(file)) continue;
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!rec.raw) continue;
    rec.spec = Ship.reconcile(Ship.normalize(rec.raw, { seed: Ship.seedOf(imageOf(d).dataUrl) }), { unlocked: d.skills.map((verb) => ({ verb, part: "drawing" })) });
    rec.spec.source = "model";
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    fs.writeFileSync(path.join(OUT, `${d.id}.view.json`), JSON.stringify(rec.spec, null, 2)); // the bare spec view.html loads
  }
  console.log(`re-normalized ${ships.length} specs of ${MODEL}`);
}

const PHASES = { spec: specPhase, render: renderPhase, sheet: sheetPhase, renorm: renormPhase };
if (!PHASES[phase]) { console.log("usage: node dev/v14-ship/compare.mjs spec|render|sheet --model <id> [--only ids]"); process.exit(2); }
PHASES[phase]().catch((e) => { console.error(e); process.exit(1); });
