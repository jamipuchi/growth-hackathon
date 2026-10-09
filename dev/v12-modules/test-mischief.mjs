// Browser test for /mischief-fx.js on WebKit as an iPhone in landscape (844 x 390 CSS px, DPR 3, touch).
// Needs the static server already up on PORT (default 8210), serving the repo root:
//   node dev/v12-modules/test-mischief.mjs
// Env: PORT, PW_CORE (path of a playwright-core). Progress goes to stderr, one JSON summary to stdout; the exit code is 0
// only when every check passed. Screenshots: dev/v12-modules/shots/mischief-*.png
//
//   1  dom mode, EMP: buttons swap places (centre to centre), real taps follow the scramble, everything comes back
//   2  ink bomb: blocks real taps, finger wipes (synthetic touch pointers) open cells, two fingers at once, self-clears
//   3  tractor / mine / decoy / toast: overlays appear and are gone by duration + 0.6 s; toast stacking; cancel(); bad input
//   4  sandbox mode: the EMP overlay over the controller frame, the promise resolves, the kit's own scramble matches
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { webkit } = require(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
const PORT = process.env.PORT || "8210";
const DEMO = `http://127.0.0.1:${PORT}/dev/v12-modules/mischief-demo.html`;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const metrics = {};
const errors = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
  console.error(`${pass ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
}

// the newest Playwright WebKit in the cache (pw_run.sh is its launcher)
function webkitExecutable() {
  const dir = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  // webkit-2311 is the build the other lanes drive with this playwright-core; a newer one in the cache can hang it.
  if (process.env.E2E_WEBKIT) return process.env.E2E_WEBKIT;
  if (fs.existsSync(path.join(dir, "webkit-2311", "pw_run.sh"))) return path.join(dir, "webkit-2311", "pw_run.sh");
  const found = fs
    .readdirSync(dir)
    .filter((d) => /^webkit-\d+$/.test(d) && fs.existsSync(path.join(dir, d, "pw_run.sh")))
    .sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)));
  if (!found.length) throw new Error("no webkit-* directory with pw_run.sh in " + dir);
  return path.join(dir, found[0], "pw_run.sh");
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `mischief-${name}.png`) });
const readControls = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#controller [data-action], #controller [data-stick]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.getAttribute("data-action") || el.getAttribute("data-stick"), kind: el.hasAttribute("data-stick") ? "stick" : "button", x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })
  );
const clearLog = (page) => page.evaluate(() => (window.__log.length = 0));
const presses = (page) => page.evaluate(() => window.__log.filter((l) => l.type === "press").map((l) => l.action));
const openDemo = async (page, mode) => {
  await page.goto(`${DEMO}?mode=${mode}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
};

// ------------------------------------------------------------------------------------------------ 1. EMP, dom mode
async function testEmpDom(page) {
  await openDemo(page, "dom");
  const home = await readControls(page);
  const buttons = home.filter((c) => c.kind === "button");
  const byKey = (list, k) => list.find((c) => c.key === k);
  check("emp/dom: the demo has 4 buttons and 1 stick", buttons.length === 4 && home.length === 5, home.map((c) => c.key));

  const t0 = Date.now();
  const started = await page.evaluate(() => {
    window.__swaps = [];
    const h = window.__mfx.emp(document.getElementById("controller"), 1.5, { seed: 7, onSwap: (p) => window.__swaps.push(p ? "perm:" + JSON.stringify(p) : "null") });
    window.__empH = h;
    return { overlays: document.querySelectorAll('[data-mfx="emp"]').length, perm: h.permutation, until: h.until, now: Date.now(), isEmpClass: document.getElementById("controller").classList.contains("is-emp") };
  });
  check("emp/dom: the overlay exists in the same task as the call (visible within one frame)", started.overlays === 1, started.overlays);
  check("emp/dom: until is about now + 1500 ms", Math.abs(started.until - started.now - 1500) < 100, started.until - started.now);

  await sleep(400);
  const mid = await readControls(page);
  const rows = buttons.map((b) => {
    const m = byKey(mid, b.key);
    const dest = buttons.find((o) => o.key !== b.key && dist(m, o) <= 3);
    return { key: b.key, movedPx: Math.round(dist(m, b)), landedOn: dest ? dest.key : null };
  });
  check("emp/dom: after 400 ms every button's centre moved more than 20 px", rows.every((r) => r.movedPx > 20), rows);
  check("emp/dom: every button sits on another button's old centre (within 3 px)", rows.every((r) => r.landedOn), rows);
  check("emp/dom: the destinations are all different (a real permutation)", new Set(rows.map((r) => r.landedOn)).size === rows.length, rows.map((r) => r.landedOn));
  check("emp/dom: permutation maps each place to the control now there", rows.every((r) => r.landedOn && started.perm[r.landedOn] === r.key), started.perm);
  const sHome = byKey(home, "steer");
  const sMid = byKey(mid, "steer");
  check("emp/dom: a lone stick mirrors to the other side (the kit's rule)", Math.abs(sMid.x - (844 - sHome.x)) <= 3 && Math.abs(sMid.y - sHome.y) <= 3, { home: sHome, mid: sMid });

  // a real tap at FIRE's old centre presses whatever moved there
  const fireHome = byKey(home, "shoot");
  const mover = rows.find((r) => r.landedOn === "shoot");
  await clearLog(page);
  await page.touchscreen.tap(fireHome.x, fireHome.y);
  await sleep(150);
  const p1 = await presses(page);
  check("emp/dom: a real tap at FIRE's old centre presses the control that moved there", !!mover && p1.length === 1 && p1[0] === mover.key, { expected: mover && mover.key, presses: p1 });

  // wait for the end (1.5 s + 0.4 s), then everything must be home again
  const wait = 1900 - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const back = await readControls(page);
  const worst = Math.max(...home.map((h) => dist(h, byKey(back, h.key))));
  metrics.empRestoreWorstPx = +worst.toFixed(2);
  check("emp/dom: 1.5 s + 400 ms later every control is back (within 2 px)", worst <= 2, +worst.toFixed(2));
  await page.waitForFunction(() => document.querySelectorAll("[data-mfx]").length === 0, null, { timeout: 1500 }).then(
    () => check("emp/dom: the overlay is gone", true),
    () => check("emp/dom: the overlay is gone", false, "still there")
  );
  await clearLog(page);
  await page.touchscreen.tap(fireHome.x, fireHome.y);
  await sleep(150);
  const p2 = await presses(page);
  check("emp/dom: a real tap at FIRE's centre logs shoot again", p2.length === 1 && p2[0] === "shoot", p2);
  const swaps = await page.evaluate(() => window.__swaps);
  check("emp/dom: onSwap(permutation) at the start, onSwap(null) at the restore", swaps.length === 2 && swaps[0].startsWith("perm:") && swaps[1] === "null", swaps);
  const left = await page.evaluate(() => [...document.querySelectorAll("#controller [data-action], #controller [data-stick]")].filter((e) => e.style.translate || e.style.transition).length);
  check("emp/dom: no inline translate or transition is left on the controls", left === 0, left);

  // a second emp() while one runs restarts the timer instead of stacking
  const again = await page.evaluate(async () => {
    const el = document.getElementById("controller");
    const t = performance.now();
    const a = window.__mfx.emp(el, 1, { seed: 3 });
    await new Promise((r) => setTimeout(r, 400));
    const b = window.__mfx.emp(el, 1.5, { seed: 3 });
    const overlays = document.querySelectorAll('[data-mfx="emp"]').length;
    await b.done;
    return { overlays, same: a.done === b.done, totalMs: Math.round(performance.now() - t), left: document.querySelectorAll("[data-mfx]").length };
  });
  check("emp/dom: a second emp() restarts (one overlay, same promise, total about 0.4 + 1.5 s)", again.overlays === 1 && again.same && again.totalMs >= 1800 && again.totalMs <= 2600 && again.left === 0, again);

  // screenshot mid-EMP (its own, longer, EMP so a slow screenshot cannot miss it)
  await page.evaluate(() => (window.__empH = window.__mfx.emp(document.getElementById("controller"), 4, { seed: 7 })));
  await sleep(550);
  await shot(page, "emp-dom");
  await page.evaluate(() => window.__empH.cancel());
  await sleep(100);
  const after = await page.evaluate(() => document.querySelectorAll("[data-mfx]").length);
  check("emp/dom: cancel() removes the overlay at once", after === 0, after);
}

// ------------------------------------------------------------------------------------------------ 2. ink bomb
async function testInk(page) {
  await openDemo(page, "dom");
  const fire = await page.evaluate(() => {
    const r = document.querySelector('#controller [data-action="shoot"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom };
  });

  // seed 3, or the first seed that really inks the cell over FIRE
  let bomb = null;
  for (const seed of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const info = await page.evaluate(({ seed, x, y }) => {
      if (window.__ink) window.__ink.cancel();
      window.__ink = window.__mfx.inkBomb(document.body, { seconds: 8, seed });
      const top = document.elementFromPoint(x, y);
      return { cov: window.__ink.coverage(), cells: document.querySelectorAll("[data-ink-cell]").length, roots: document.querySelectorAll('[data-mfx="ink"]').length, fireInked: !!(top && top.hasAttribute("data-ink-cell")) };
    }, { seed, x: fire.x, y: fire.y });
    if (info.fireInked) {
      bomb = { seed, ...info };
      break;
    }
  }
  if (!bomb) return check("ink: some seed puts ink over FIRE", false, "none of the seeds tried covers FIRE's cell");
  metrics.ink = bomb;
  check("ink: coverage() is above 0.35 right after the bomb", bomb.cov > 0.35 && bomb.cov <= 1, bomb.cov);
  check("ink: one root with 72 blocker cells", bomb.roots === 1 && bomb.cells === 72, bomb);
  await sleep(350); // let the splat intro finish
  await shot(page, "ink-before");

  await clearLog(page);
  await page.touchscreen.tap(fire.x, fire.y);
  await sleep(200);
  const tap1 = await page.evaluate(() => window.__log.filter((l) => l.type === "press" || l.type === "release"));
  check("ink: a real tap on the inked cell over FIRE does not press FIRE", tap1.length === 0, tap1);

  // a finger wipe over FIRE: synthetic touch pointer 21 (pointerdown, 30 moves in a zig-zag, pointerup)
  const wipe = await page.evaluate(({ fire }) => {
    const ink = window.__ink;
    const cell = document.elementFromPoint(fire.x, fire.y);
    const cr = cell.getBoundingClientRect();
    const region = { l: Math.min(cr.left, fire.l), t: Math.min(cr.top, fire.t), r: Math.max(cr.right, fire.r), b: Math.max(cr.bottom, fire.b) };
    const ev = (type, x, y) =>
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(
        new PointerEvent(type, { pointerId: 21, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 })
      );
    const before = ink.coverage();
    ev("pointerdown", fire.x, fire.y);
    for (let i = 0; i < 30; i++) ev("pointermove", i % 2 ? region.r : region.l, region.t + (i / 29) * (region.b - region.t));
    ev("pointerup", region.r, region.b);
    const top = document.elementFromPoint(fire.x, fire.y);
    window.__fireCell = cell;
    return { before, after: ink.coverage(), cellPointerEvents: getComputedStyle(cell).pointerEvents, blockerAtFire: !!(top && top.hasAttribute("data-ink-cell")), region };
  }, { fire });
  metrics.inkWipe = wipe;
  check("ink: the wipe lowers coverage by a measurable amount (more than 0.015)", wipe.before - wipe.after > 0.015, { before: +wipe.before.toFixed(3), after: +wipe.after.toFixed(3) });
  check("ink: the cell over FIRE now has pointer-events none and nothing blocks FIRE's centre", wipe.cellPointerEvents === "none" && !wipe.blockerAtFire, wipe);
  await sleep(100);
  await shot(page, "ink-after");
  await clearLog(page);
  await page.touchscreen.tap(fire.x, fire.y);
  await sleep(200);
  const tap2 = await presses(page);
  check("ink: a real tap on FIRE now logs shoot", tap2.length === 1 && tap2[0] === "shoot", tap2);
  await page.evaluate(() => window.__ink.cancel());
  check("ink: cancel() removes the root at once", (await page.evaluate(() => document.querySelectorAll("[data-mfx]").length)) === 0);

  // two fingers at once: pointers 31 and 32 wipe two far-apart cells, their events interleaved
  const two = await page.evaluate(() => {
    const h = window.__mfx.inkBomb(document.body, { seconds: 8, seed: 3 });
    window.__ink2 = h;
    const closed = [...document.querySelectorAll("[data-ink-cell]")].filter((c) => getComputedStyle(c).pointerEvents === "auto").map((c) => ({ c, r: c.getBoundingClientRect() }));
    closed.sort((a, b) => a.r.left - b.r.left);
    const A = closed[0], B = closed[closed.length - 1];
    const ev = (type, id, x, y) =>
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 31, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 }));
    const centre = (o) => [o.r.left + o.r.width / 2, o.r.top + o.r.height / 2];
    const before = h.coverage();
    ev("pointerdown", 31, ...centre(A));
    ev("pointerdown", 32, ...centre(B));
    for (let i = 0; i < 30; i++) {
      const u = i / 29;
      ev("pointermove", 31, i % 2 ? A.r.right : A.r.left, A.r.top + u * A.r.height);
      ev("pointermove", 32, i % 2 ? B.r.right : B.r.left, B.r.top + u * B.r.height);
    }
    ev("pointerup", 31, A.r.right, A.r.bottom);
    ev("pointerup", 32, B.r.right, B.r.bottom);
    return { closedBefore: closed.length, before, after: h.coverage(), aOpen: getComputedStyle(A.c).pointerEvents === "none", bOpen: getComputedStyle(B.c).pointerEvents === "none", apart: Math.round(Math.abs(A.r.left - B.r.left)) };
  });
  metrics.inkTwoFingers = two;
  check("ink: two fingers wipe two far-apart cells at once (both open)", two.aOpen && two.bOpen && two.apart > 300 && two.after < two.before, two);
  await page.evaluate(() => window.__ink2.cancel());

  // a short bomb clears itself, measured inside the page (no test latency)
  const self = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let info = null;
        const h = window.__mfx.inkBomb(document.body, { seconds: 1, seed: 5, onClear: (r) => (info = r) });
        const poll = () => {
          const gone = !document.querySelector('[data-mfx="ink"]');
          const ms = performance.now() - t0;
          if (gone) h.done.then((v) => resolve({ ms: Math.round(ms), onClear: info, done: v, coverage: h.coverage() }));
          else if (ms > 5000) resolve({ ms: -1, onClear: info });
          else setTimeout(poll, 15);
        };
        poll();
      })
  );
  metrics.inkSelfClearMs = self.ms;
  check("ink: a bomb with seconds 1 removes its root within 1.6 s", self.ms >= 1000 && self.ms <= 1600, self);
  check("ink: onClear reports { wiped: false, ms } for a timeout", !!self.onClear && self.onClear.wiped === false && self.onClear.ms >= 900 && self.onClear.ms <= 1300, self.onClear);
}

// ------------------------------------------------------------------------------------------------ 3. the other effects
const EFFECT_CALLS = `
  tractor: () => m.tractorHit(document.body, { by: "ANA", dir: 0.6 }),
  mine: () => m.mineHit(document.body, { by: "BEN", points: -30, stunSeconds: 1.5, shakeEl: document.getElementById("stage") }),
  decoy: () => m.decoyFooled(document.body, { by: "CAL" }),
  decoyMine: () => m.decoyFooled(document.body, { mine: true, victim: "DEE" }),
  toast: () => m.toast("NICE SHOT", { sub: "+200 POINTS", tone: "gold" }),
`;
const timeEffect = (page, key) =>
  page.evaluate(
    ({ key, calls }) =>
      new Promise((resolve) => {
        const m = window.__mfx;
        const table = new Function("m", "return {" + calls + "}")(m);
        const kinds = new Set();
        let peak = 0;
        const t0 = performance.now();
        const h = table[key]();
        const poll = () => {
          const els = document.querySelectorAll("[data-mfx]");
          els.forEach((e) => kinds.add(e.getAttribute("data-mfx")));
          peak = Math.max(peak, els.length);
          const ms = performance.now() - t0;
          if (els.length === 0) h.done.then(() => resolve({ ms: Math.round(ms), peak, kinds: [...kinds].sort() }));
          else if (ms > 7000) resolve({ ms: -1, peak, kinds: [...kinds].sort() });
          else setTimeout(poll, 20);
        };
        poll();
      }),
    { key, calls: EFFECT_CALLS }
  );

async function testEffects(page) {
  await openDemo(page, "dom");
  const plan = [
    { key: "tractor", dur: 1.6, kinds: ["toast", "tractor"] },
    { key: "mine", dur: 1.5, kinds: ["mine", "toast"] },
    { key: "decoy", dur: 1.7, kinds: ["decoy", "toast"] },
    { key: "decoyMine", dur: 1.7, kinds: ["decoy", "toast"] },
    { key: "toast", dur: 2.2, kinds: ["toast"] },
  ];
  for (const p of plan) {
    const r = await timeEffect(page, p.key);
    metrics["gone_" + p.key + "_ms"] = r.ms;
    check(`${p.key}: adds its overlay (${p.kinds.join(" + ")}) and removes everything by duration + 0.6 s`, r.ms > 0 && r.ms <= p.dur * 1000 + 600 && p.kinds.every((k) => r.kinds.includes(k)), { ...r, limitMs: p.dur * 1000 + 600 });
  }

  // screenshots at the peak (longer runs where the duration is a parameter, so a slow screenshot cannot miss them)
  const peaks = [
    { name: "tractor", at: 600, run: () => window.__mfx.tractorHit(document.body, { by: "ANA", dir: 0.6, seconds: 4 }) },
    { name: "mine", at: 450, run: () => window.__mfx.mineHit(document.body, { by: "BEN", points: -30, stunSeconds: 3, shakeEl: document.getElementById("stage") }) },
    { name: "decoy", at: 420, run: () => window.__mfx.decoyFooled(document.body, { by: "CAL" }) },
    { name: "decoy-mine", at: 420, run: () => window.__mfx.decoyFooled(document.body, { mine: true, victim: "DEE" }) },
    { name: "toast", at: 500, run: () => window.__mfx.toast("NICE SHOT", { sub: "+200 POINTS", tone: "gold", seconds: 4 }) },
  ];
  for (const p of peaks) {
    await page.evaluate(`window.__peak = (${p.run.toString()})()`);
    await sleep(p.at);
    const n = await page.evaluate(() => document.querySelectorAll("[data-mfx]").length);
    await shot(page, p.name);
    await page.evaluate(() => window.__peak.cancel());
    check(`${p.name}: overlay on screen at its peak (screenshot taken)`, n >= 1, n);
  }

  // toasts stack: at most 3, newest on top
  const stack = await page.evaluate(async () => {
    const hs = ["A", "B", "C", "D"].map((t, i) => window.__mfx.toast("TOAST " + t, { sub: "number " + (i + 1), seconds: 5, tone: ["cyan", "gold", "violet", "red"][i] }));
    window.__stack = hs;
    await new Promise((r) => setTimeout(r, 520));
    return [...document.querySelectorAll('[data-mfx="toast"]')].map((e) => ({ text: e.querySelector(".mfx-tt").textContent, top: Math.round(e.getBoundingClientRect().top) }));
  });
  await shot(page, "toast-stack");
  const order = stack.slice().sort((a, b) => a.top - b.top).map((s) => s.text);
  check("toast: four quick toasts leave three, newest (D) on top, oldest (A) gone", stack.length === 3 && order.join("|") === "TOAST D|TOAST C|TOAST B", stack);
  await page.evaluate(() => window.__stack.forEach((h) => h.cancel()));

  // cancel() cleans up at once, for every effect; one style tag only
  const cancelled = await page.evaluate(async () => {
    const m = window.__mfx;
    const layer = document.getElementById("controller");
    const out = {};
    const runs = { tractor: () => m.tractorHit(document.body), mine: () => m.mineHit(document.body), decoy: () => m.decoyFooled(document.body), toast: () => m.toast("X"), ink: () => m.inkBomb(document.body, { seconds: 5 }), emp: () => m.emp(layer, 5) };
    for (const [k, fn] of Object.entries(runs)) {
      const h = fn();
      const during = document.querySelectorAll("[data-mfx]").length;
      h.cancel();
      const v = await Promise.race([h.done, new Promise((r) => setTimeout(() => r("timeout"), 500))]);
      out[k] = { during, after: document.querySelectorAll("[data-mfx]").length, cancelled: !!(v && v.cancelled) };
    }
    out.styleTags = document.querySelectorAll("#mfx-styles").length;
    out.inlineLeft = [...layer.querySelectorAll("[data-action], [data-stick]")].filter((e) => e.style.translate || e.style.transition).length;
    return out;
  });
  const okCancel = ["tractor", "mine", "decoy", "toast", "ink", "emp"].every((k) => cancelled[k].during >= 1 && cancelled[k].after === 0 && cancelled[k].cancelled);
  check("cancel(): every effect leaves nothing behind and its promise resolves", okCancel && cancelled.styleTags === 1 && cancelled.inlineLeft === 0, cancelled);

  // never throws, whatever it is given
  const bad = await page.evaluate(() => {
    const m = window.__mfx;
    const calls = [() => m.emp(null), () => m.emp({}, "x", null), () => m.inkBomb(null, null), () => m.inkBomb(42, { splats: "many", seconds: -3 }), () => m.tractorHit(null, { dir: "x" }), () => m.mineHit(5, { points: "no", shakeEl: {} }), () => m.decoyFooled({}, null), () => m.toast(undefined, null), () => m.toast("x", { tone: "pink", seconds: NaN })];
    return calls.map((fn) => {
      try {
        const h = fn();
        const ok = !!(h && h.done && typeof h.cancel === "function");
        h.cancel();
        return ok ? "ok" : "bad handle";
      } catch (e) {
        return "THREW " + e;
      }
    });
  });
  check("bad input never throws and always returns { done, cancel }", bad.every((b) => b === "ok"), bad);
  check("no overlay left after the bad-input calls", (await page.evaluate(() => document.querySelectorAll("[data-mfx]").length)) === 0);
}

// ------------------------------------------------------------------------------------------------ 4. sandbox mode
async function testSandbox(page) {
  const ready = await openDemo(page, "sandbox").then(() => true, () => false);
  check("sandbox: the controller is mounted (window.__ready)", ready, ready ? undefined : await page.evaluate(() => window.__error || "timeout").catch(() => "no page"));
  if (!ready) return;
  const kit = await page.waitForFunction(() => window.__sandboxReady === true, null, { timeout: 6000 }).then(() => true, () => false);
  metrics.sandboxKitReported = kit;
  await sleep(200);
  const info = await page.evaluate(() => {
    const layer = document.getElementById("controller");
    const h = window.__mfx.emp(layer, 1.2, { seed: 7 });
    window.__empH = h;
    window.__doneAt = 0;
    h.done.then(() => (window.__doneAt = performance.now()));
    window.__t0 = performance.now();
    const handle = layer.ctrlSandbox;
    const frame = layer.querySelector("iframe");
    return {
      overlays: document.querySelectorAll('[data-mfx="emp"]').length,
      handle: !!handle,
      controls: handle ? handle.controls().map((c) => ({ action: c.action, kind: c.kind })) : [],
      perm: h.permutation,
      frameAnimations: frame && frame.getAnimations ? frame.getAnimations().length : -1,
    };
  });
  check("sandbox: the EMP overlay appears at once over the controller frame", info.overlays === 1 && info.handle, { overlays: info.overlays, handle: info.handle });
  check("sandbox: the frame element gets the jitter animation", info.frameAnimations >= 1, info.frameAnimations);
  await sleep(450);
  await shot(page, "emp-sandbox");
  const doneAt = await page.waitForFunction(() => window.__doneAt > 0, null, { timeout: 5000 }).then(() => page.evaluate(() => Math.round(window.__doneAt - window.__t0)), () => -1);
  metrics.sandboxEmpDoneMs = doneAt;
  check("sandbox: the promise from emp() resolves (about 1.2 s plus the fade)", doneAt >= 1100 && doneAt <= 2200, doneAt);
  check("sandbox: the overlay is gone afterwards", (await page.evaluate(() => document.querySelectorAll("[data-mfx]").length)) === 0);

  if (kit) {
    // the kit's own scramble (returned by handle.fx) must equal empPermutation() applied to handle.controls()
    const cmp = await page.evaluate(async () => {
      const handle = document.getElementById("controller").ctrlSandbox;
      const items = handle.controls().map((c) => ({ key: c.action, kind: c.kind }));
      const mine = window.__mfx.empPermutation(items, 7).map;
      const r = await handle.fx("emp", { seconds: 0.3, seed: 7 });
      const norm = (o) => JSON.stringify(Object.entries(o || {}).sort());
      return { equal: norm(mine) === norm(r && r.map), mine, kit: r && r.map };
    });
    check("sandbox: empPermutation() equals the kit's own scramble for the same seed", cmp.equal && Object.keys(cmp.mine).length >= 2, cmp);
  } else {
    check("sandbox: the frame reported its controls (kit ready)", false, "no ready message within 6 s; permutation comparison skipped");
  }
}

// ------------------------------------------------------------------------------------------------ main
let browser;
try {
  fs.mkdirSync(SHOTS, { recursive: true });
  browser = await webkit.launch({ executablePath: webkitExecutable() });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: UA });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  for (const [name, fn] of [["emp/dom", testEmpDom], ["ink", testInk], ["effects", testEffects], ["sandbox", testSandbox]]) {
    try {
      await fn(page);
    } catch (e) {
      check(`${name}: test section ran to the end`, false, String((e && e.stack) || e).split("\n").slice(0, 4).join(" | "));
    }
  }
  check("no uncaught page errors", errors.length === 0, errors);
} catch (e) {
  check("browser launched and the run completed", false, String((e && e.stack) || e));
} finally {
  if (browser) await browser.close().catch(() => {});
}

const failed = checks.filter((c) => !c.pass);
const summary = { ok: failed.length === 0, passed: checks.length - failed.length, failed: failed.length, failedNames: failed.map((c) => c.name), checks, metrics, shots: fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).filter((f) => f.startsWith("mischief-")).sort() : [] };
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.ok ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 1500).unref(); // only if something keeps the loop alive after the browser closed
