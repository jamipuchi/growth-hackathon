// Renders every recorded Sol controller (dev/astra/sol-html/out/*.html) and the template for the same layout over a
// game screenshot, at iPhone landscape size (844 × 390 CSS px, DPR 2), into dev/astra/sol-html/shots/ (git-ignored),
// plus one contact sheet per kind. Chromium only, one browser.
//   node dev/astra/sol-html/render.mjs [--bg dev/e2e/shots/expert/<file>.png]
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const AstraHtml = require(path.join(ROOT, "astra-html.js"));
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(process.env.HOME, "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((d) => d.startsWith(prefix + "-")).sort().pop();
const CHROME = process.env.E2E_CHROME || path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

const argv = process.argv.slice(2);
const bgArg = argv.includes("--bg") ? argv[argv.indexOf("--bg") + 1] : null;
const pickBg = () => {
  if (bgArg) return path.resolve(ROOT, bgArg);
  const dir = path.join(ROOT, "dev/e2e/shots/expert");
  const shot = fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => /phone\.png$/.test(f)).sort().find((f) => /boss|shoot|fly|play/.test(f));
  return shot ? path.join(dir, shot) : null;
};
const bgFile = pickBg();
const bg = bgFile && fs.existsSync(bgFile) ? `url(data:image/png;base64,${fs.readFileSync(bgFile).toString("base64")}) center/cover` : "radial-gradient(circle at 60% 40%,#5a2c8f,#140a33 70%)";
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "dev/v12-modules/corpus/corpus.json"), "utf8"));
const OUT = path.join(HERE, "out");
const SHOTS = path.join(HERE, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const page = (html) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${bg}}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent}</style></head>` +
  `<body><iframe sandbox="allow-scripts" srcdoc="${html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></body></html>`;

const { chromium } = require(PW_CORE);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const shots = [];
for (const d of corpus) {
  const file = path.join(OUT, `${d.name}.html`);
  if (!fs.existsSync(file)) continue;
  const allowedActions = [...new Set(d.layout.buttons.map((b) => b.action))];
  for (const [kind, html] of [["sol", fs.readFileSync(file, "utf8")], ["template", AstraHtml.templateHtml(d.layout, { allowedActions })]]) {
    await p.setContent(page(html), { waitUntil: "load" });
    await p.waitForTimeout(1300); // the pop-in settles
    const shot = path.join(SHOTS, `${d.name}-${kind}.png`);
    await p.screenshot({ path: shot });
    shots.push({ name: d.name, kind, shot });
  }
}
// Contact sheets: every Sol answer on one image, every template on another.
for (const kind of ["sol", "template"]) {
  const list = shots.filter((s) => s.kind === kind);
  const tiles = list.map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(s.shot).toString("base64")}"><figcaption>${s.name}</figcaption></figure>`).join("");
  await p.setViewportSize({ width: 1700, height: 900 });
  await p.setContent(`<!doctype html><style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px;font:13px system-ui;color:#ddd}img{width:100%;display:block}figure{margin:0}</style>${tiles}`, { waitUntil: "load" });
  await p.screenshot({ path: path.join(SHOTS, `sheet-${kind}.png`), fullPage: true });
  await p.setViewportSize({ width: 844, height: 390 });
}
await browser.close();
console.log(`${shots.length} renders in ${path.relative(ROOT, SHOTS)} (background ${bgFile ? path.relative(ROOT, bgFile) : "gradient"}), sheets sheet-sol.png and sheet-template.png`);
