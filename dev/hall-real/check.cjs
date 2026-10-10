// dev/hall-real/check.cjs: the hall page shows no MOCK / EXAMPLES label (?mock=1 and ?embed=1), and (v1.9.1 tree)
// ?round=N shows only that round, ranked among itself, with JUDGING n/m while it is judged; T switches to ALL ROUNDS.
// No server: the page's files come from ROOT, /hall is a synthetic live hall built from hall-mock/hall.json.
//   node dev/hall-real/check.cjs [ROOT]
const { chromium } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2] || path.join(__dirname, "..", "..");
const BASE = "http://hall.test";
const mock = JSON.parse(fs.readFileSync(path.join(ROOT, "hall-mock", "hall.json"), "utf8"));
// live: round 2 is still being judged (no scores yet), rounds 1 and 3 are scored
const liveEntries = mock.entries.map((e) => (e.round === 2 ? { ...e, judge: "judging", scores: null, score: null, comment: null, rank: null } : e));
const live = { ok: true, session: "scheck", judging: { running: true, done: 11, judged: 11, failed: 0, skipped: 0, pending: 5, unjudged: 0, total: 16, calls: 16, maxCalls: 60, api: "openai decisions", model: "gpt-6-luna", mock: false }, entries: liveEntries };
const TYPES = { html: "text/html", js: "text/javascript", mjs: "text/javascript", json: "application/json", png: "image/png" };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/Users/jaumepuig/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${BASE}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/hall") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(live) });
    if (u.pathname.startsWith("/hall/")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, judging: live.judging }) });
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(f).slice(1)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
  const labels = async () => page.evaluate(() => /\bMOCK\b|\bEXAMPLES\b/i.test(document.body.innerText));
  const shown = async () => page.evaluate(() => [...document.querySelectorAll("#podium .card, #list .row")].map((el) => ({ rank: (el.querySelector(".medal, .rk") || {}).textContent, name: el.querySelector(".name").textContent, kind: el.querySelector(".kind").textContent })));
  const out = {};
  for (const q of ["?mock=1", "?mock=1&embed=1"]) {
    await page.goto(`${BASE}/hall-of-fame.html${q}`);
    await page.waitForFunction(() => document.querySelectorAll(".card, .row").length >= 12, null, { timeout: 10000 });
    out[q] = { entries: (await shown()).length, labelText: await labels(), status: await page.textContent("#statusText") };
  }
  const hasScope = await page.evaluate(() => !!document.querySelector(".scope"));
  if (hasScope) {
    await page.goto(`${BASE}/hall-of-fame.html?embed=1&judge=1&round=2`);
    await page.waitForFunction(() => document.querySelectorAll(".card, .row").length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const r2 = await shown();
    out.round2 = { n: r2.length, allRound2: r2.every((x) => / Round 2/.test(x.kind)), status: await page.textContent("#statusText"), labelText: await labels(),
      pressed: await page.getAttribute('.scope button[aria-pressed="true"]', "data-s"), scopeVisible: await page.isVisible(".scope") };
    await page.keyboard.press("t");
    await page.waitForTimeout(300);
    const all = await shown();
    out.afterT = { n: all.length, pressed: await page.getAttribute('.scope button[aria-pressed="true"]', "data-s"), status: await page.textContent("#statusText"), top3: all.slice(0, 3).map((x) => `${x.rank} ${x.name}`) };
    await page.evaluate(() => window.postMessage({ type: "hall-scope", scope: "toggle" }, location.origin));
    await page.waitForTimeout(300);
    out.afterMessage = { n: (await shown()).length, pressed: await page.getAttribute('.scope button[aria-pressed="true"]', "data-s") };
    // round 3 (scored): ranks restart at #1 within the round
    await page.goto(`${BASE}/hall-of-fame.html?embed=1&round=3`);
    await page.waitForFunction(() => document.querySelectorAll(".card, .row").length > 0, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    out.round3 = (await shown()).map((x) => `${x.rank} ${x.name}`);
    await page.screenshot({ path: path.join(__dirname, "hall-round3-embed.png") });
  }
  out.errors = errors.filter((e) => !/three|fetch|import/i.test(e));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
