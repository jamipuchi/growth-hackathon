// Renders every generated controller (corpus/out/<name>.html, Sol) and its template (<name>.template.html) through
// ctrl-sandbox.js in WebKit at 844 × 390 (DPR 3, touch, iPhone UA) and measures them against the drawn layout:
// every drawn control present, centres where drawn, buttons ≥ 56 px, sticks ≥ 100 px, nothing off screen, no
// overlaps, nothing covering the game, no violations. Then taps every button and drags every stick for real.
//   node dev/v12-modules/render-corpus.mjs [--tag run] [--port 8210]
// Writes dev/v12-modules/shots/corpus/<name>-{model,template}.png, shots/corpus-sheet.png and corpus/render-<tag>.json.
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const PORT = Number(opt("port", process.env.PORT || 8210));
const TAG = opt("tag", "run");
const BASE = `http://127.0.0.1:${PORT}`;
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const WEBKIT = process.env.E2E_WEBKIT || path.join(CACHE, "webkit-2311", "pw_run.sh");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CORPUS = path.join(HERE, "corpus");
const AstraHtml = require(path.join(HERE, "../../astra-html.js"));
const SHOTS = path.join(HERE, "shots", "corpus");
fs.mkdirSync(SHOTS, { recursive: true });
const W = 844, H = 390;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) => new Promise((resolve) => { const s = net.connect(port, "127.0.0.1", () => (s.end(), resolve(true))); s.on("error", () => resolve(false)); });

let server = null;
async function startServer() {
  if (await portOpen(PORT)) return;
  server = spawn(process.execPath, [path.join(HERE, "serve.mjs"), "--port", String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 50 && !(await portOpen(PORT)); i++) await sleep(100);
}

function measure(layout, ready) {
  const rects = ready.map((c) => ({ ...c, l: c.x * W, t: c.y * H, r: (c.x + c.w) * W, b: (c.y + c.h) * H }));
  const present = [...new Set(layout.buttons.map((b) => b.action))].every((a) => rects.some((c) => c.action === a));
  let maxOffset = 0;
  for (const b of layout.buttons) {
    const bx = (b.x + b.w / 2) * W, by = (b.y + b.h / 2) * H;
    const d = Math.min(...rects.filter((c) => c.action === b.action).map((c) => Math.hypot((c.l + c.r) / 2 - bx, (c.t + c.b) / 2 - by)));
    if (Number.isFinite(d)) maxOffset = Math.max(maxOffset, d);
  }
  const buttons = rects.filter((c) => c.kind !== "stick"), sticks = rects.filter((c) => c.kind === "stick");
  const minButton = buttons.length ? Math.min(...buttons.map((c) => Math.min(c.r - c.l, c.b - c.t))) : null;
  const minStick = sticks.length ? Math.min(...sticks.map((c) => Math.min(c.r - c.l, c.b - c.t))) : null;
  const offscreen = rects.filter((c) => c.l < -2 || c.t < -2 || c.r > W + 2 || c.b > H + 2).map((c) => c.action);
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const ix = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)), iy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    const small = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
    if (small > 0 && (ix * iy) / small > 0.15) overlaps.push(`${a.action}/${b.action}`);
  }
  return { present, controls: rects.length, maxCentreOffsetPx: +maxOffset.toFixed(1), minButtonPx: minButton && +minButton.toFixed(1), minStickPx: minStick && +minStick.toFixed(1), offscreen, overlaps };
}

async function main() {
  const corpus = JSON.parse(fs.readFileSync(path.join(CORPUS, "corpus.json"), "utf8")).filter((d) => fs.existsSync(path.join(CORPUS, "out", `${d.name}.html`)));
  await startServer();
  const { webkit } = require(PW_CORE);
  const browser = await webkit.launch({ executablePath: WEBKIT, headless: true });
  const rows = [];
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });
    const page = await context.newPage();
    await page.goto(`${BASE}/dev/v12-modules/sandbox-demo.html?preset=basic&fallback=0`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 8000 });
    await page.addStyleTag({ content: "#bar,#panel{display:none!important}" });
    for (const d of corpus) {
      const allowedActions = [...new Set(d.layout.buttons.map((b) => b.action))];
      for (const variant of ["model", "template"]) {
        const file = path.join(CORPUS, "out", variant === "model" ? `${d.name}.html` : `${d.name}.template.html`);
        // the template is rebuilt from the current astra-html.js (deterministic), so it never goes stale
        if (variant === "template") fs.writeFileSync(file, AstraHtml.templateHtml(d.layout, { allowedActions }));
        const html = fs.readFileSync(file, "utf8");
        await page.evaluate(([html, allowedActions]) => window.__mount(html, { allowedActions, readyTimeoutMs: 4000 }), [html, allowedActions]);
        const ok = await page.waitForFunction(() => window.__ready, null, { timeout: 5000 }).then(() => true).catch(() => false);
        await sleep(900); // pop-in animations finish; the kit reports settled rectangles
        const state = await page.evaluate(() => ({ ready: window.__handle.controls(), viol: window.__violations.map((v) => `${v.kind}:${v.detail}`), stats: window.__handle.stats() }));
        const m = measure(d.layout, state.ready);
        await page.screenshot({ path: path.join(SHOTS, `${d.name}-${variant}.png`), scale: "css" });
        // Every button pressed by a real tap, every stick dragged.
        let tapped = 0, dragged = 0;
        for (const c of state.ready) {
          const cx = (c.x + c.w / 2) * W, cy = (c.y + c.h / 2) * H;
          await page.evaluate(() => (window.__events.length = 0));
          if (c.kind === "stick") {
            await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy - 30, { steps: 4 }); await sleep(40); await page.mouse.up(); await sleep(60);
            const ev = await page.evaluate(() => window.__events.filter((e) => e.type === "axis"));
            if (ev.length >= 2 && ev.some((e) => e.x > 0.2) && ev.at(-1).x === 0) dragged++;
          } else {
            await page.touchscreen.tap(cx, cy); await sleep(c.kind === "toggle" ? 60 : 40);
            if (c.kind === "toggle") { await page.touchscreen.tap(cx, cy); await sleep(60); }
            const ev = await page.evaluate(() => window.__events.map((e) => e.type + ":" + e.action));
            if (ev.includes(`press:${c.action}`) && ev.includes(`release:${c.action}`)) tapped++;
          }
        }
        const nButtons = state.ready.filter((c) => c.kind !== "stick").length, nSticks = state.ready.length - nButtons;
        const pass = ok && m.present && m.maxCentreOffsetPx <= 40 && (m.minButtonPx == null || m.minButtonPx >= 55) && (m.minStickPx == null || m.minStickPx >= 100) &&
          !m.offscreen.length && !m.overlaps.length && !state.viol.length && !(state.stats.clearedCovers > 0) && tapped === nButtons && dragged === nSticks;
        const row = { name: d.name, variant, pass, bytes: Buffer.byteLength(html), ...m, tapped: `${tapped}/${nButtons}`, dragged: `${dragged}/${nSticks}`, clearedCovers: state.stats.clearedCovers || 0, violations: state.viol };
        rows.push(row);
        console.log(`${pass ? "PASS" : "FAIL"} ${JSON.stringify(row)}`);
      }
    }
    // Contact sheet: the drawing, Sol's controller, the template.
    const sheet = `<!doctype html><body style="margin:0;background:#0b0d1a;color:#cfefff;font:600 11px system-ui;letter-spacing:.15em">
      <div style="display:grid;grid-template-columns:200px 422px 422px;gap:6px;padding:8px">${corpus.map((d) => `
        <div><img src="/dev/v12-modules/corpus/${d.file}" style="width:200px;background:#fff"><div>${d.name}</div></div>
        <div><img src="/dev/v12-modules/shots/corpus/${d.name}-model.png" style="width:422px"><div>SOL ${rows.find((r) => r.name === d.name && r.variant === "model")?.pass ? "PASS" : "FAIL"}</div></div>
        <div><img src="/dev/v12-modules/shots/corpus/${d.name}-template.png" style="width:422px"><div>TEMPLATE</div></div>`).join("")}</div></body>`;
    fs.writeFileSync(path.join(HERE, "shots", "corpus-sheet.html"), sheet);
    const sp = await context.newPage();
    await sp.setViewportSize({ width: 1070, height: 400 });
    await sp.goto(`${BASE}/dev/v12-modules/shots/corpus-sheet.html`, { waitUntil: "load", timeout: 60000 });
    await sp.screenshot({ path: path.join(HERE, "shots", "corpus-sheet.png"), fullPage: true, scale: "css" });
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  const model = rows.filter((r) => r.variant === "model"), template = rows.filter((r) => r.variant === "template");
  const summary = { at: new Date().toISOString(), tag: TAG, modelPass: `${model.filter((r) => r.pass).length}/${model.length}`, templatePass: `${template.filter((r) => r.pass).length}/${template.length}`, rows };
  fs.writeFileSync(path.join(CORPUS, `render-${TAG}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ modelPass: summary.modelPass, templatePass: summary.templatePass }));
}
main().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
