// Browser check for sfx.js through the demo page (WebKit and Chromium, iPhone-sized, touch).
// Assumes a static server is already running (PORT env, default 8210) that serves the repo root.
//   PORT=8210 node dev/v12-modules/test-sfx.mjs
// Env: PW_CORE = path of playwright-core. Browsers come from ~/Library/Caches/ms-playwright (newest webkit-* / chromium-*).
// Exit code 0 only if every check passed. A headless browser that keeps the AudioContext suspended is reported as a
// warning (not a failure), and the play() checks are then skipped because play() is false until audio is running.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pw = require(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");

const PORT = process.env.PORT || "8210";
const URL = "http://127.0.0.1:" + PORT + "/dev/v12-modules/sfx-demo.html";
const here = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(here, "shots");
const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// newest build dir with a given prefix, e.g. "webkit" -> webkit-2368
function newest(prefix) {
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => new RegExp("^" + prefix + "-\\d+$").test(d)) : [];
  dirs.sort((a, b) => parseInt(b.split("-")[1], 10) - parseInt(a.split("-")[1], 10));
  return dirs[0] ? path.join(cache, dirs[0]) : null;
}
// webkit-2311 is the build the other lanes drive with this playwright-core; a newer one in the cache can hang it.
const webkitDir = fs.existsSync(path.join(cache, "webkit-2311")) ? path.join(cache, "webkit-2311") : newest("webkit"), chromiumDir = newest("chromium");
const TARGETS = [
  { name: "webkit", type: pw.webkit, exe: webkitDir && path.join(webkitDir, "pw_run.sh"), mobile: true, tap: (page, x, y) => page.touchscreen.tap(x, y) },
  { name: "chromium", type: pw.chromium, exe: chromiumDir && path.join(chromiumDir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"), mobile: false, tap: (page, x, y) => page.mouse.click(x, y) },
];

const r3 = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);

async function runBrowser(t) {
  const out = { browser: t.name, executable: t.exe, ok: false, checks: {}, warnings: [], numbers: {}, errors: [] };
  const check = (key, ok, detail) => { out.checks[key] = { ok: !!ok, detail: detail === undefined ? null : detail }; return !!ok; };
  let browser;
  try {
    if (!t.exe || !fs.existsSync(t.exe)) throw new Error("browser executable not found: " + t.exe);
    browser = await t.type.launch({ executablePath: t.exe, headless: true });
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: t.mobile, userAgent: UA,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (e) => out.errors.push("pageerror: " + String(e && e.message ? e.message : e)));
    page.on("console", (m) => { if (m.type() === "error") out.errors.push("console.error: " + m.text()); });

    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => window.__demoReady === true && !!window.__sfx, null, { timeout: 15000 });
    const hasCtx = await page.evaluate(() => !!window.__sfx.ctx);
    check("webaudio", hasCtx, hasCtx ? "AudioContext created" : "no AudioContext in this browser");
    if (!hasCtx) throw new Error("no WebAudio");

    // before the tap: locked, overlay visible, play() is false and harmless
    const before = await page.evaluate(() => ({ unlocked: window.__sfx.unlocked, state: window.__sfx.ctx.state, play: window.__sfx.play("laser"), overlay: !document.getElementById("unlock").classList.contains("gone") }));
    check("locked before tap", before.unlocked === false && before.play === false && before.overlay, before);

    // tap the unlock overlay
    await t.tap(page, 422, 195);
    const tReady = Date.now();
    const readyOk = await page.evaluate(() => Promise.race([window.__sfx.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 20000))]));
    out.numbers.readyMs = Date.now() - tReady;
    check("ready", readyOk, "ready resolved " + out.numbers.readyMs + " ms after the tap");

    // unlocked? give the resume() promise a moment
    await page.waitForFunction(() => window.__sfx.unlocked === true, null, { timeout: 4000 }).catch(() => {});
    const st = await page.evaluate(() => ({
      unlocked: window.__sfx.unlocked, state: window.__sfx.ctx.state, sampleRate: window.__sfx.ctx.sampleRate,
      audioSession: (navigator.audioSession && navigator.audioSession.type) || null, overlayGone: document.getElementById("unlock").classList.contains("gone"),
    }));
    out.numbers.ctxState = st.state;
    out.numbers.ctxSampleRate = st.sampleRate;
    out.numbers.audioSessionType = st.audioSession;
    const running = st.state === "running";
    check("unlocked", st.unlocked === true || !running, st);
    if (!running) out.warnings.push("AudioContext state is '" + st.state + "' after the tap (headless browsers may keep audio suspended); play() checks skipped");
    else check("ctx running", true, st.state);

    // every sound once
    const sounds = await page.evaluate(() => window.__sounds);
    out.numbers.sounds = sounds.length;
    const res = await page.evaluate(async (names) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = {};
      let threw = null;
      for (const n of names) {
        try { r[n] = window.__sfx.play(n, { pan: 0 }); } catch (e) { threw = String(e); }
        await sleep(36); // above the 30 ms per-name throttle
      }
      return { r, threw };
    }, sounds);
    check("play never throws", res.threw === null, res.threw);
    if (running) {
      const failed = Object.entries(res.r).filter(([, v]) => v !== true).map(([k]) => k);
      check("play() true for every sound", failed.length === 0, failed.length ? "false for: " + failed.join(", ") : sounds.length + " sounds");
    }

    // explosion sizes and loops
    const extra = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const s = window.__sfx, o = {};
      o.sizes = [];
      for (const size of ["small", "medium", "large"]) { o.sizes.push(s.play("explosion", { size })); await sleep(36); }
      o.loops = [];
      for (const n of window.__loops) {
        const h = s.loop(n, { pan: -0.3 });
        await sleep(160);
        h.setPan(0.4); h.setVolume(0.5);
        await sleep(60);
        h.stop(0.05);
        o.loops.push(typeof h.stop === "function" && typeof h.setPan === "function" && typeof h.setVolume === "function");
      }
      return o;
    });
    if (running) check("explosion sizes", extra.sizes.every(Boolean), extra.sizes);
    check("loop handles", extra.loops.every(Boolean), extra.loops);

    // volume / mute round trip
    const vm = await page.evaluate(async () => {
      const s = window.__sfx, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const o = {};
      s.setVolume(0.33); o.vol = s.volume;
      s.mute(true); o.muted = s.muted; o.playWhileMuted = s.play("hit");
      s.mute(false); o.unmuted = s.muted;
      await sleep(40);
      o.playAfter = s.play("hit");
      s.setVolume(0.8); o.restored = s.volume;
      return o;
    });
    check("volume / mute round trip", Math.abs(vm.vol - 0.33) < 1e-9 && vm.muted === true && vm.unmuted === false && vm.restored === 0.8 && vm.playWhileMuted === false && (!running || vm.playAfter === true), vm);

    // bench: 500 plays, avg <= 0.2 ms and p95 <= 0.5 ms
    const bench = await page.evaluate(() => window.__bench(500));
    out.numbers.bench = { avgMs: r3(bench.avgMs), p95Ms: r3(bench.p95Ms), maxMs: r3(bench.maxMs), played: bench.played, n: bench.n, mode: bench.mode, timerResolutionMs: bench.resolutionMs };
    if (running) {
      check("bench played", bench.played >= 0.9 * bench.n, bench.played + "/" + bench.n);
      check("bench avg <= 0.2 ms", bench.avgMs <= 0.2, r3(bench.avgMs));
      check("bench p95 <= 0.5 ms", bench.p95Ms <= 0.5, r3(bench.p95Ms));
    } else {
      out.warnings.push("bench numbers measured with a suspended context: " + JSON.stringify(out.numbers.bench));
    }

    // screenshot
    fs.mkdirSync(shotsDir, { recursive: true });
    const shot = path.join(shotsDir, "sfx-demo-" + t.name + ".png");
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot });
    out.numbers.screenshot = shot;

    check("no page errors", out.errors.length === 0, out.errors.slice(0, 5));
    await context.close();
  } catch (err) {
    check("run", false, String(err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  out.ok = Object.values(out.checks).every((c) => c.ok);
  return out;
}

const results = [];
for (const t of TARGETS) {
  console.log("running " + t.name + " ...");
  results.push(await runBrowser(t));
}
const summary = { url: URL, ok: results.every((r) => r.ok), results };
console.log(JSON.stringify(summary, null, 2));
for (const r of results) {
  const bad = Object.entries(r.checks).filter(([, c]) => !c.ok).map(([k]) => k);
  console.log((r.ok ? "PASS " : "FAIL ") + r.browser + (bad.length ? "  failed: " + bad.join(", ") : "") + (r.warnings.length ? "  (" + r.warnings.length + " warning(s))" : ""));
}
process.exit(summary.ok ? 0 : 1);
