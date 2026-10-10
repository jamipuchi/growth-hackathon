// Phone tour (v1.3 phone lane), for the TESTING round (written in the implement-only round, never run there).
// WebKit iPhone 13 (844x390 landscape and 390x844 portrait, DPR 3, touch) against this tree's server with ASTRA_MOCK=1:
//   dev/v12-client/phone/locked.sh 470 node dev/v13-phone/tour.mjs [--port 8364] [--bots 2]
// Every screen through __spTest.go(step), then the new v1.3 pieces through their hooks (hit marker, spawn shield, tool captions,
// mischief, death card), each with a few PASS/MISS checks. Writes dev/v13-phone/shots/<name>.png and dev/v13-phone/tour-report.json.
import fs from "fs";
import path from "path";
import {
  args, makeLogger, installSignalHandlers, runCleanups, startServer, launchPhoneBrowser, watchPage, shootPage, sp, sleep, withTimeout, summariseConsole,
} from "./lib.mjs";

const A = args();
const log = makeLogger("v13-phone");
installSignalHandlers(log);
const HERE = "/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test/data/phone-tour";
const PORT = A.num("port", 8364);
const OUT = "/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test/shots/phone-tour";
fs.mkdirSync(HERE, {recursive:true});
const report = { started: new Date().toISOString(), port: PORT, checks: {}, steps: [], console: null };

const check = (name, ok, detail) => { report.checks[name] = { ok: !!ok, detail }; log(`${ok ? "PASS" : "MISS"} ${name}${detail !== undefined ? ` · ${JSON.stringify(detail)}` : ""}`); };
const shot = async (page, name) => { try { await shootPage(page, path.join(OUT, `${name}.png`)); } catch (e) { log(`screenshot ${name} failed: ${e.message}`); } };
const ev = (page, fn, arg) => page.evaluate(fn, arg).catch((e) => ({ error: String((e && e.message) || e).slice(0, 200) }));
async function step(name, fn) {
  const t0 = Date.now(), rec = { name, ok: true };
  report.steps.push(rec);
  try { await withTimeout(fn(), 45000, name); } catch (e) { rec.ok = false; rec.error = String((e && e.message) || e).slice(0, 300); log(`STEP ${name} FAILED: ${rec.error}`); }
  rec.ms = Date.now() - t0;
}
const go = (page, s) => ev(page, (x) => window.__spTest.go(x), s);
const count = (page, sel) => ev(page, (s) => document.querySelectorAll(s).length, sel);
const text = (page, sel) => ev(page, (s) => { const e = document.querySelector(s); return e ? (e.innerText || e.textContent || "").trim() : null; }, sel);

// Every screen of __spTest.go, and what must be visible on it.
const SCREENS = [
  ["join", ["join", "name"]],
  ["ship", ["draw", "drawTitle", "example", "useDefault"]],
  ["controller", ["draw", "drawTitle", "example"]],
  ["explorerDraw", ["draw", "drawTitle", "example"]],
  ["planetController", ["draw", "drawTitle"]],
  ["gen", ["gen", "genPic", "genTitle", "genSub"]],
  ["genError", ["gen", "genErr", "genRetry", "genBack"]],
  ["wrong", ["wrong", "wrongRedraw", "wrongUse"]],
  ["shipResult", ["result", "unlockCard", "resultNext", "resultRedraw", "resultCount"]],
  ["explorerResult", ["result", "unlockCard", "resultNext"]],
  ["controllerResult", ["result", "ctrlPreview", "resultNext"]],
  ["wait", ["play", "banner", "readyBtn"]],
  ["explorer", ["explorer", "expPhoto", "expDraw", "expDefault"]],
  ["ctrlPrompt", ["ctrlPrompt", "ctrlKeep", "ctrlRedraw"]],
  ["results", ["resultsSheet", "resTitle", "resRank"]],
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer({ port: PORT, bots: A.num("bots", 2), env: { ASTRA_MOCK: "1", OPENAI_API_KEY: "" }, logFile: path.join(HERE, "tour-server.log"), log });
  const { newPhone } = await launchPhoneBrowser();
  const { page } = await newPhone();
  const sink = watchPage(page, "phone", log);

  await step("join", async () => {
    await page.goto(`${server.base}/controller.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__sp && window.__spTest, null, { timeout: 15000 });
    await page.fill("#name", "tourist");
    await page.locator("#joinForm button").tap();
    await page.waitForFunction(() => window.__sp.screen === "draw", null, { timeout: 10000 });
    check("join → ship step", (await sp.step(page)) === "ship");
    check("step title is '1 · DRAW YOUR SHIP'", (await text(page, "#drawTitle")) === "1 · DRAW YOUR SHIP", await text(page, "#drawTitle"));
  });

  for (const [orient, vp] of [["land", { width: 844, height: 390 }], ["port", { width: 390, height: 844 }]]) {
    await page.setViewportSize(vp);
    for (const [s, ids] of SCREENS) {
      await step(`${s}-${orient}`, async () => {
        await go(page, s);
        await sleep(700);                                      // fade-ins (0.22 s) and pops (0.32 s) done
        const vis = await sp.ids(page, ids);
        const hidden = ids.filter((id) => vis[id] !== "visible");
        check(`${s} (${orient}) shows ${ids.join(", ")}`, !hidden.length, hidden.length ? { hidden } : undefined);
        await shot(page, `${s}-${orient}`);
      });
    }
  }
  await page.setViewportSize({ width: 844, height: 390 });

  await step("unlock card", async () => {
    await go(page, "shipResult"); await sleep(900);
    const locked = await count(page, "#unlockCard .ulist li");
    check("ship card lists 1-3 locked skills (demo ship: LAND, EMP)", locked >= 1 && locked <= 3, locked);
    check("ship card sentence", /^Your ship can: /.test(String(await ev(page, () => document.getElementById("unlockCard").dataset.text))));
    const nextBox = await ev(page, () => { const r = document.getElementById("resultNext").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
    check("NEXT button in view without scrolling (844x390)", nextBox.bottom <= nextBox.vh + 1, nextBox);
  });

  await step("failure sheet", async () => {
    await go(page, "genError"); await sleep(400);
    check("blank drawing → DRAW IT AGAIN", (await text(page, "#genRetry")) === "DRAW IT AGAIN", await text(page, "#genRetry"));
    check("says it cost nothing", /did not use a drawing/i.test(String(await text(page, "#genSub"))));
  });

  await step("play hud", async () => {
    await go(page, "play"); await sleep(2500);
    check("score pill visible (not in the lobby: hidden there)", (await sp.ids(page, ["score"])).score !== "missing");
    await ev(page, () => window.__spTest.toolCaps()); await sleep(400);
    check("tool captions on", (await count(page, "#hud.caps")) === 1);
    await shot(page, "play-toolcaps");
  });

  await step("hit marker", async () => {
    for (const [dir, name] of [[Math.PI / 2, "up"], [0, "right"], [-Math.PI / 2, "down"], [Math.PI, "left"]]) {
      await ev(page, (d) => window.__spTest.hit(d, 25), dir);
      await sleep(120);
      await shot(page, `hit-${name}`);
    }
    const n = await count(page, '[data-mfx="hit"]');
    check("hit markers on screen (≤ 4)", n >= 1 && n <= 4, n);
    await sleep(1500);
    check("hit markers gone after their fade", (await count(page, '[data-mfx="hit"]')) === 0);
  });

  await step("spawn shield", async () => {
    await ev(page, () => window.__spTest.spawnShield(true)); await sleep(400);
    check("spawn shield aura on", (await count(page, '[data-mfx="shield"]')) === 1);
    await shot(page, "spawn-shield");
    await ev(page, () => window.__spTest.spawnShield(false)); await sleep(700);
    check("spawn shield aura off", (await count(page, '[data-mfx="shield"]')) === 0);
  });

  await step("mischief + death", async () => {
    for (const kind of ["emp", "inkbomb", "tractor", "mine", "decoy"]) {
      await ev(page, (k) => window.__spTest.mischief({ kind: k, seconds: k === "inkbomb" ? 4 : 5, dir: 0.6, points: 30 }), kind);
      await sleep(900); await shot(page, `mischief-${kind}`); await sleep(kind === "emp" ? 5200 : 4200);
    }
    await ev(page, () => window.__spTest.announce("🔧 bob wrecked tourist's ship (+150)")); await sleep(300);
    check("wrecked chip", /WRECKED/.test(String(await text(page, "#chipTitle"))), await text(page, "#chipTitle"));
    await shot(page, "chip-wrecked");
    await ev(page, () => window.__spTest.dead("bob", 3)); await sleep(500);
    check("death card on", (await count(page, "#dead.on")) === 1);
    await shot(page, "dead");
  });

  report.console = summariseConsole ? summariseConsole([sink]) : { errors: sink.errors.length };
  check("no page errors", !sink.errors.some((e) => e.kind === "pageerror"), sink.errors.filter((e) => e.kind === "pageerror").slice(0, 5));
}

main().catch((e) => { report.fatal = String((e && e.stack) || e).slice(0, 800); log(`FATAL ${report.fatal}`); }).finally(async () => {
  report.ended = new Date().toISOString();
  const checks = Object.values(report.checks);
  report.passed = checks.filter((c) => c.ok).length; report.total = checks.length;
  fs.writeFileSync(path.join(HERE, "tour-report.json"), JSON.stringify(report, null, 2));
  log(`${report.passed}/${report.total} checks passed; report: dev/v13-phone/tour-report.json`);
  await runCleanups();
  process.exit(report.fatal ? 1 : 0);
});
