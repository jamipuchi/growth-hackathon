// Phone tour (v1.3 phone lane; brought up to v1.4 in the v15 test round).
// WebKit iPhone 13 (844x390 landscape and 390x844 portrait, DPR 3, touch) against this tree's server with ASTRA_MOCK=1:
//   node dev/v13-phone/tour.mjs [--port 8364] [--bots 2]          (about 2 min; one WebKit, one server on --port)
// Every screen through __spTest.go(step), then the v1.3 pieces through their hooks (hit marker, spawn shield, tool captions,
// mischief, death card) and the v1.4 ones: the FULL SCREEN button and the iPhone hint on the join screen, the drawing screen
// (paper + rail, the example card: opens by itself once per step, the instruction line reopens it, SKIP stays tappable over
// it; the paper's share of the safe area), the late "DRAW X" card and its one-tap action, the big 3-2-1 (hook), and the
// server's countdown phase after POST /start (last step: it starts the round). Each with PASS/MISS checks.
// Writes dev/v13-phone/shots/<name>.png and dev/v13-phone/tour-report.json.
// Exit code: 0 = every check passed and every step ran; 1 = a check missed or a step failed; 3 = fatal (server or browser).
import fs from "fs";
import path from "path";
import {
  args, makeLogger, installSignalHandlers, runCleanups, startServer, launchPhoneBrowser, watchPage, shootPage, sp, sleep, withTimeout, summariseConsole,
  post, waitFor,
} from "../v11-client/lib.mjs";

const A = args();
const log = makeLogger("v13-phone");
installSignalHandlers(log);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = A.num("port", 8364);
const OUT = path.join(HERE, "shots");
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
// A selector's state (the overlays of phone-extras.js have classes, no ids): missing | hidden | visible, its text and size.
const look = (page, sel) => ev(page, (q) => {
  const el = document.querySelector(q);
  if (!el) return { state: "missing" };
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const shown = el.getClientRects().length > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01 && !el.classList.contains("hidden");
  return { state: shown ? "visible" : "hidden", text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120), w: Math.round(r.width), h: Math.round(r.height) };
}, sel);
const tapSel = (page, sel) => page.locator(sel).first().tap({ timeout: 5000 });
const ORIENTS = [["land", { width: 844, height: 390 }], ["port", { width: 390, height: 844 }]];

// Every screen of __spTest.go, and what must be visible on it. v1.4 drawing screen: #stage (the paper) + #drawRail (the tools),
// the instruction line #drawHeader (#drawTitle) over the paper, and the example card #guide (#example) that opens by itself the
// first time each step is drawn on this phone (localStorage sp.guideSeen: the tour forgets it before each drawing screen).
const DRAW_IDS = ["draw", "stage", "drawRail", "drawHeader", "drawTitle"];
const DRAW_SCREENS = new Set(["ship", "controller", "explorerDraw", "planetController"]);
const SCREENS = [
  ["join", ["join", "name", "fsBtn"]],
  ["ship", [...DRAW_IDS, "guide", "example", "useDefault"]],
  ["controller", [...DRAW_IDS, "guide", "example"]],
  ["explorerDraw", [...DRAW_IDS, "guide", "example"]],
  ["planetController", DRAW_IDS],
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
    // v1.4 full screen. iPhone Safari has no element full screen: #fsBtn shows the "Add to Home Screen" hint instead, and that
    // hint also comes once by itself 0.9 s after a first visit (no player, no sp.a2hsSeen). It is closed before JOIN.
    await sleep(1300);
    check("FULL SCREEN button (#fsBtn) on the join screen", await sp.visible(page, "fsBtn"), await sp.ids(page, ["fsBtn"]));
    const fsInfo = await ev(page, () => window.__spTest.fullscreen());
    check("__spTest.fullscreen(): iPhone Safari, no element full screen, not active", !!fsInfo && fsInfo.iosSafari === true && fsInfo.supported === false && fsInfo.active === false && fsInfo.standalone === false, fsInfo);
    check("iPhone hint opens by itself on a first visit", (await look(page, ".pe-inst")).state === "visible", await look(page, ".pe-inst"));
    await shot(page, "join-install-hint");
    await tapSel(page, ".pe-inst-x"); await sleep(300);
    check("iPhone hint closes with ✕ and is remembered (sp.a2hsSeen)", (await look(page, ".pe-inst")).state !== "visible" && (await ev(page, () => localStorage.getItem("sp.a2hsSeen"))) === "true");
    await sp.tap(page, "fsBtn"); await sleep(500);
    check("FULL SCREEN on an iPhone shows the Add to Home Screen hint", (await look(page, ".pe-inst")).state === "visible", await look(page, ".pe-inst"));
    await shot(page, "join-fsbtn-hint");
    await tapSel(page, ".pe-inst-x"); await sleep(300);
    check("__spTest.installHint() shows the hint", (await ev(page, () => window.__spTest.installHint())) === true && (await look(page, ".pe-inst")).state === "visible");
    await tapSel(page, ".pe-inst-x"); await sleep(300);
    await page.fill("#name", "tourist");
    await page.locator("#joinForm button").tap();
    await page.waitForFunction(() => window.__sp.screen === "draw", null, { timeout: 10000 });
    check("join → ship step", (await sp.step(page)) === "ship");
    check("step title is '1 · DRAW YOUR SHIP'", (await text(page, "#drawTitle")) === "1 · DRAW YOUR SHIP", await text(page, "#drawTitle"));
    const after = await ev(page, () => ({ w: innerWidth, h: innerHeight, fs: window.__spTest.fullscreen() }));
    check("JOIN under automation asks no full screen (viewport unchanged)", after.w === 844 && after.h === 390 && after.fs && after.fs.active === false, after);
  });

  for (const [orient, vp] of ORIENTS) {
    await page.setViewportSize(vp);
    for (const [s, ids] of SCREENS) {
      await step(`${s}-${orient}`, async () => {
        // v1.4: the example card opens by itself only the first time per step: forget that, so it must open here
        if (DRAW_SCREENS.has(s)) await ev(page, () => localStorage.removeItem("sp.guideSeen"));
        await go(page, s);
        await sleep(700);                                      // fade-ins (0.22 s) and pops (0.32 s) done
        const vis = await sp.ids(page, ids);
        const hidden = ids.filter((id) => vis[id] !== "visible");
        check(`${s} (${orient}) shows ${ids.join(", ")}`, !hidden.length, hidden.length ? { hidden } : undefined);
        await shot(page, `${s}-${orient}`);
      });
    }
  }
  // v1.4 drawing screen, in both orientations: the example card over the paper (opens by itself once, the instruction line
  // reopens it, GOT IT closes it), SKIP above it stays tappable, the rail works under it, and the paper's share of the screen.
  report.paper = {};
  for (const [orient, vp] of ORIENTS) {
    await page.setViewportSize(vp);
    await step(`guide + paper (${orient})`, async () => {
      await ev(page, () => localStorage.removeItem("sp.guideSeen"));
      await go(page, "ship"); await sleep(700);
      let v = await sp.ids(page, ["guide", "example", "useDefault"]);
      check(`example card opens by itself on the first visit (${orient})`, v.guide === "visible" && v.example === "visible", v);
      const ud = await ev(page, () => {
        const b = document.getElementById("useDefault"), r = b.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { onTop: !!at && (at === b || b.contains(at)), w: Math.round(r.width), h: Math.round(r.height), at: at ? at.id || String(at.className) || at.tagName : null };
      });
      const trial = await page.locator("#useDefault").tap({ trial: true, timeout: 3000 }).then(() => true, (e) => String(e.message).split("\n")[0].slice(0, 160));
      check(`SKIP (#useDefault) tappable with the example card open (${orient})`, ud.onTop && trial === true, { ...ud, trial });
      await shot(page, `guide-auto-${orient}`);
      await sp.tap(page, "modeDraw"); await sleep(500);              // the rail works while the card covers the paper
      const m = await ev(page, () => {
        const probe = document.createElement("div");
        probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
        document.body.appendChild(probe);
        const p = getComputedStyle(probe), px = (x) => parseFloat(x) || 0;
        const ins = { t: px(p.paddingTop), r: px(p.paddingRight), b: px(p.paddingBottom), l: px(p.paddingLeft) };
        probe.remove();
        const W = innerWidth, H = innerHeight, safe = Math.max(1, (W - ins.l - ins.r) * (H - ins.t - ins.b));
        const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), a: r.width * r.height }; };
        const pad = box("drawPad"), stage = box("stage"), rail = box("drawRail");
        return { viewport: `${W}x${H}`, insets: ins, mode: window.__sp.drawMode, pad: `${pad.w}x${pad.h}`, stage: `${stage.w}x${stage.h}`, rail: `${rail.w}x${rail.h}`,
          padShare: Math.round((pad.a / safe) * 1000) / 1000, stageShare: Math.round((stage.a / safe) * 1000) / 1000 };
      });
      report.paper[orient] = m;
      check(`DRAW on the rail shows the paper under the open card (${orient})`, m && m.mode === "draw" && (await sp.visible(page, "drawPad")) && (await sp.visible(page, "guide")), m && m.mode);
      check(`paper (#drawPad) fills ≥ 75% of the safe area (${orient}; lane target 90%)`, m && m.padShare >= 0.75, m);
      await go(page, "ship"); await sleep(500);
      check(`example card stays closed on a second visit (${orient})`, (await sp.ids(page, ["guide"])).guide === "hidden");
      await sp.tap(page, "drawHeader"); await sleep(450);
      v = await sp.ids(page, ["guide", "example"]);
      check(`tapping the instruction line opens the example card (${orient})`, v.guide === "visible" && v.example === "visible", v);
      await shot(page, `guide-tap-${orient}`);
      await sp.tap(page, "guideOk"); await sleep(350);
      check(`GOT IT closes the example card (${orient})`, (await sp.ids(page, ["guide"])).guide === "hidden");
      await shot(page, `paper-${orient}`);
      if (orient === "land") {                                         // a real SKIP tap over the open card: the ship step → play
        await sp.tap(page, "drawHeader"); await sleep(400);
        await page.locator("#useDefault").tap({ timeout: 4000 }); await sleep(600);
        check("SKIP tapped over the open card leaves the ship step (→ play)", (await sp.screen(page)) === "play", { screen: await sp.screen(page), step: await sp.step(page) });
      }
    });
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

  // v1.4 late hints: the server's "DRAW X" card (toast kind "hint", late: true, step 3) with ONE big action.
  await step("late hints (DRAW X card)", async () => {
    await waitFor(async () => (await count(page, "#dead.on")) === 0, { timeout: 6000 });   // the death card (z 9300) would take the taps
    await go(page, "play"); await sleep(600);
    const r1 = await ev(page, () => window.__spTest.lateHint("dig", "part", ["shovel", "drill"]));
    await sleep(500);
    const t1 = await look(page, ".pe-late-t"), c1 = await look(page, ".pe-late-gt");
    check("late card: dig part (shovel + drill) shows", r1 === true && (await look(page, ".pe-late")).state === "visible" && t1.state === "visible", { returned: r1, title: t1.text });
    check("late card (dig part): one tap REDRAW MY EXPLORER", c1.state === "visible" && c1.text === "REDRAW MY EXPLORER", c1.text);
    await shot(page, "late-dig-part");
    await tapSel(page, ".pe-late-go"); await sleep(700);
    const where1 = { screen: await sp.screen(page), step: await sp.step(page), card: (await look(page, ".pe-late")).state };
    check("REDRAW MY EXPLORER opens the explorer drawing", where1.screen === "draw" && where1.step === "explorer" && where1.card !== "visible", where1);
    await shot(page, "late-dig-redraw");
    await go(page, "play"); await sleep(600);
    const r2 = await ev(page, () => window.__spTest.lateHint("weapon", "button"));
    await sleep(500);
    const t2 = await look(page, ".pe-late-t"), c2 = await look(page, ".pe-late-gt");
    check("late card: weapon button shows", r2 === true && (await look(page, ".pe-late")).state === "visible", { returned: r2, title: t2.text });
    check("late card (weapon button): one tap DRAW THE BUTTON", c2.state === "visible" && c2.text === "DRAW THE BUTTON", c2.text);
    await shot(page, "late-weapon-button");
    await tapSel(page, ".pe-late-go"); await sleep(700);
    check("DRAW THE BUTTON opens the add-a-button sheet", (await sp.visible(page, "add")) && (await look(page, ".pe-late")).state !== "visible", await sp.ids(page, ["add"]));
    await shot(page, "late-weapon-add");
    await sp.tap(page, "addCancel"); await sleep(400);
    check("CANCEL closes the add-a-button sheet", !(await sp.visible(page, "add")));
  });

  // v1.4 big 3-2-1 (phone-extras.js createCountdown: .pe-cd / .pe-cd-n). The lobby's live ticks win over the hook (they hide it
  // within a tick), so the first check reads the overlay in the same task as the call, and the shot keeps calling it.
  await step("countdown 3-2-1 (hook)", async () => {
    await go(page, "play"); await sleep(400);
    const r = await ev(page, () => {
      window.__spTest.countdown(3);
      const root = document.querySelector(".pe-cd"), n = root && root.querySelector(".pe-cd-n");
      return { exists: !!root, on: !!root && root.classList.contains("pe-on"), text: n ? n.textContent : null, visibility: root ? getComputedStyle(root).visibility : null,
        fontPx: n ? Math.round(parseFloat(getComputedStyle(n).fontSize)) : 0, vmin: Math.min(innerWidth, innerHeight) };
    });
    check("countdown(3) shows a big 3 over the screen", r && r.exists && r.on && r.text === "3" && r.visibility === "visible" && r.fontPx >= 0.4 * r.vmin, r);
    await ev(page, () => { window.__tourCd = setInterval(() => window.__spTest.countdown(3), 30); });
    await sleep(450); await shot(page, "countdown-3");
    await ev(page, () => clearInterval(window.__tourCd));
    const g = await ev(page, () => { window.__spTest.countdown(0); const n = document.querySelector(".pe-cd .pe-cd-n"); return { text: n && n.textContent, go: !!n && n.classList.contains("pe-cd-go") }; });
    check("countdown(0) pops GO!", g && g.go && /GO/.test(g.text || ""), g);
    await sleep(250); await shot(page, "countdown-go");
  });

  // v1.4 server countdown (last: it starts the round): POST /start {} → phase "countdown" (tick.countdown 3, 2, 1) → GO! →
  // "playing". The phone must count with the server.
  await step("server countdown (POST /start)", async () => {
    await go(page, "play"); await sleep(1500);                                       // GO! of the hook above is gone
    await ev(page, () => {
      window.__tourSeen = [];
      window.__tourCdT = setInterval(() => {
        const r = document.querySelector(".pe-cd"), n = r && r.classList.contains("pe-on") && r.querySelector(".pe-cd-n");
        const t = n ? n.textContent : "", a = window.__tourSeen;
        if (t && a[a.length - 1] !== t) a.push(t);
      }, 40);
    });
    const res = await post(server.base, "/start", {});
    check("POST /start {} answers phase countdown", res.status === 200 && res.json && res.json.phase === "countdown", { status: res.status, json: res.json });
    await sleep(1100); await shot(page, "server-countdown");
    const phase = await waitFor(async () => { const p = await ev(page, () => window.__sp.net && window.__sp.net.phase); return p === "playing" || p === "assists" ? p : null; }, { timeout: 7000, every: 150 });
    await sleep(400);
    const seen = await ev(page, () => { clearInterval(window.__tourCdT); return window.__tourSeen; });
    const nums = (Array.isArray(seen) ? seen : []).filter((t) => /^\d+$/.test(t));
    check("phone counts 3, 2, 1 with the server, then GO!", nums.join(",") === "3,2,1" && Array.isArray(seen) && /GO/.test(seen[seen.length - 1] || ""), seen);
    check("phone's phase is playing after the countdown", !!phase, phase);
  });

  report.console = summariseConsole ? summariseConsole([sink]) : { errors: sink.errors.length };
  check("no page errors", !sink.errors.some((e) => e.kind === "pageerror"), sink.errors.filter((e) => e.kind === "pageerror").slice(0, 5));
}

main().catch((e) => { report.fatal = String((e && e.stack) || e).slice(0, 800); log(`FATAL ${report.fatal}`); }).finally(async () => {
  report.ended = new Date().toISOString();
  const checks = Object.values(report.checks);
  report.passed = checks.filter((c) => c.ok).length; report.total = checks.length;
  const missed = Object.entries(report.checks).filter(([, c]) => !c.ok).map(([n]) => n), failedSteps = report.steps.filter((x) => !x.ok).map((x) => x.name);
  report.missed = missed; report.failedSteps = failedSteps; report.seconds = Math.round(log.since());
  fs.writeFileSync(path.join(HERE, "tour-report.json"), JSON.stringify(report, null, 2));
  for (const n of missed) log(`MISSED: ${n}`);
  for (const n of failedSteps) log(`STEP FAILED: ${n}`);
  log(`${report.passed}/${report.total} checks passed, ${failedSteps.length} step(s) failed, ${report.seconds} s; report: dev/v13-phone/tour-report.json`);
  await runCleanups();
  process.exit(report.fatal ? 3 : missed.length || failedSteps.length ? 1 : 0);
});
