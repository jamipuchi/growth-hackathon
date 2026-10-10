// Sol's controller in the sandbox: mount, locks, cooldowns, tips, swaps, fallbacks (fake ctrl-sandbox.js records what the page asks of it)
import { boot, sleep, makeChecker, KIT_CONTROLS, PAD_HTML, DEFAULT_PAD } from "./env.mjs";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED", e); process.exitCode = 1; });
const { ok, done } = makeChecker();
const only = process.argv[2] || "all";
const run = (name) => only === "all" || only === name;
const joinAs = async (t, name = "tester") => { t.$("name").value = name; await t.$("joinForm").onsubmit({ preventDefault() {} }); await sleep(50); };
const PAD2 = { buttons: [...DEFAULT_PAD.buttons,
  { type: "button", action: "land", label: "LAND", x: 0.4, y: 0.2, w: 0.2, h: 0.2 },
  { type: "button", action: "heal", label: "HEAL", x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
  { type: "button", action: "emp", label: "EMP", x: 0.6, y: 0.2, w: 0.2, h: 0.2 }] };
const kit2 = PAD2.buttons.map((b) => ({ action: b.action, kind: b.type, label: b.label, x: b.x, y: b.y, w: b.w, h: b.h }));
const SHIP = { type: "ship", rig: "ship", verbs: ["shoot", "boost", "shield", "land", "emp", "mine"], unlocked: [] };

if (run("main")) {
  const t = await boot();
  const { $, S, T, state, R, SB } = t;
  state.padLayout = PAD2;
  await joinAs(t);
  T.go("play");
  await sleep(150);
  ok("play screen, DOM controls built from the layout", S.screen === "play" && $("hits").children.length === 6, [S.screen, $("hits").children.length]);
  ok("no pad yet: asked the server (POST /controller-html {player})", state.htmlCalls === 1 && state.calls.some((c) => c.url === "/controller-html" && c.body.player === "tester"), state.htmlCalls);
  ok("one sandbox mounted in #ctl", SB.mounts.length === 1 && SB.last.container === $("ctl"), SB.mounts.length);
  const o = SB.last.opts;
  ok("allowedActions = requiredActions = the pad's actions", JSON.stringify([...o.allowedActions].sort()) === JSON.stringify(["boost", "emp", "heal", "land", "shoot", "steer"]) && JSON.stringify(o.requiredActions) === JSON.stringify(o.allowedActions), o.allowedActions);
  ok("fallbackHtml = the same html, ready timeout 6 s", o.fallbackHtml === SB.last.html && o.readyTimeoutMs === 6000);
  ok("DOM controls hide at once (area.sb)", $("area").classList.contains("sb"));
  ok("S.layout adopted from padLayout (6 controls)", S.layout.buttons.length === 6, S.layout.buttons.map((b) => b.action));
  ok("not live yet", S.ctl && S.ctl.live === false && T.ctl().live === false);
  SB.last.becomeReady(kit2);
  await sleep(20);
  ok("live after the frame reports its controls", S.ctl.live === true);
  ok("setDisabled([]) with no entity yet (nothing known to be locked)", JSON.stringify(SB.last.disabled[SB.last.disabled.length - 1]) === "[]", SB.last.disabled);

  // entity: HEAL is not on the ship, LAND and EMP are
  R.handlers.entity.forEach((cb) => cb({ player: "tester", entity: SHIP }));
  ok("entity change: heal is locked, setDisabled(['heal'])", JSON.stringify(SB.last.disabled[SB.last.disabled.length - 1]) === '["heal"]', SB.last.disabled.slice(-2));
  R.handlers.entity.forEach((cb) => cb({ player: "someoneelse", entity: { type: "ship", verbs: [] } }));
  ok("another player's entity is ignored", JSON.stringify(SB.last.disabled[SB.last.disabled.length - 1]) === '["heal"]');

  // press / release reach the server
  const inputs = () => state.calls.filter((c) => c.url === "/input").map((c) => c.body);
  SB.last.press("boost"); await sleep(10); SB.last.release("boost"); await sleep(20);
  ok("press + release of BOOST: input down, input up", inputs().filter((b) => b.action === "boost").map((b) => b.down).join() === "true,false", inputs().filter((b) => b.action === "boost"));
  SB.last.opts.onAxis("steer", 0.5, -0.25); await sleep(10); SB.last.opts.onAxis("steer", 0, 0); await sleep(30);
  const ax = inputs().filter((b) => b.type === "axis");
  ok("axis out, then a forced 0,0", ax.length >= 2 && ax[0].x === 0.5 && ax[0].y === -0.25 && ax[ax.length - 1].x === 0 && ax[ax.length - 1].y === 0, ax);
  ok("stick held state cleared", !S.held.steer);

  // locked tip
  state.calls.length = 0;
  SB.last.press("heal"); await sleep(10);
  ok("press on a locked control: lock tip with what to draw", $("tip").classList.contains("on") && $("tip").classList.contains("lock") && $("tipText").textContent === "🔒 HEAL · draw a red cross on your ship", $("tipText").textContent);
  ok("the input is still sent (server is the authority)", inputs().some((b) => b.action === "heal" && b.down === true));
  SB.last.release("heal");
  R.handlers.toast.forEach((cb) => cb({ player: "tester", kind: "refused", verb: "heal", text: "HEAL · draw a red cross on your ship" }));
  ok("the server's own refusal for that skill stays quiet", $("toast").classList.contains("off"));

  // cooldown
  R.handlers.cooldown.forEach((cb) => cb({ type: "cooldown", player: "someoneelse", verb: "emp", seconds: 5 }));
  ok("someone else's cooldown is ignored", Object.keys(S.cool).length === 0);
  R.handlers.cooldown.forEach((cb) => cb({ type: "cooldown", player: "tester", verb: "emp", seconds: 1.3 }));
  const last = () => SB.last.disabled[SB.last.disabled.length - 1].slice().sort().join();
  ok("cooldown: emp greyed together with the locked heal", last() === "emp,heal", last());
  const chip = $("cd").querySelector(".cdchip");
  ok("a countdown chip sits on the control", chip && chip.textContent === "2" && /^\d+(\.\d+)?%$/.test(chip.style.left), chip && [chip.textContent, chip.style.left, chip.style.top]);
  SB.last.press("emp"); await sleep(10);
  ok("press on a cooling control: READY IN n S", $("tip").classList.contains("on") && !$("tip").classList.contains("lock") && $("tipText").textContent === "EMP · READY IN 2 S", $("tipText").textContent);
  SB.last.release("emp");
  await sleep(1600);
  ok("cooldown over: emp usable again, chip gone", last() === "heal" && !$("cd").querySelector(".cdchip") && !S.cool.emp, [last(), $("cd").children.length]);

  // hold tip (first 3 holds)
  SB.last.press("shoot");
  await sleep(520);
  ok("hold >= 450 ms: what it does", $("tip").classList.contains("on") && $("tipTitle").textContent === "SHOOT" && $("tipText").textContent === "Hold to fire your gun", [$("tipTitle").textContent, $("tipText").textContent]);
  SB.last.release("shoot");
  ok("released: the hold tip goes", !$("tip").classList.contains("on"));
  SB.last.press("emp"); await sleep(520);
  ok("EMP has its own one-line explanation", $("tipText").textContent === "Scramble the buttons of the closest rival", $("tipText").textContent);
  SB.last.release("emp");

  // Sol's own HTML for the same pad: replace in place
  const mounts0 = SB.mounts.length;
  T.html("<!doctype html><html>MODEL " + "x".repeat(40) + "</html>", "html");
  await sleep(10);
  ok("kind html with the same actions: handle.replace(), no remount", SB.mounts.length === mounts0 && SB.last.replaced.length === 1, [SB.mounts.length, SB.last.replaced.length]);
  SB.last.pendingReplace(true); await sleep(10);
  ok("replace resolved true: source model", S.ctl.source === "model" && S.ctl.html.includes("MODEL"), S.ctl.source);
  T.html("<!doctype html><html>REFUSED " + "y".repeat(40) + "</html>", "html"); await sleep(10);
  SB.last.pendingReplace(false); await sleep(10);
  ok("replace refused: the working document stays, the pad forgets the bad one", S.ctl.html.includes("MODEL") && S.pad.html.includes("MODEL"), S.pad.html.slice(0, 30));
  // duplicate: the same html again does nothing
  const rep0 = SB.last.replaced.length;
  T.html(S.pad.html, "html"); await sleep(10);
  ok("the same html again: nothing", SB.last.replaced.length === rep0);
  // other player's pad message: ignored
  R.handlers.generated.forEach((cb) => cb({ type: "generated", player: "someoneelse", kind: "html", html: "<!doctype html><html>NOT MINE " + "z".repeat(30) + "</html>", controls: [], htmlSource: "model", padLayout: PAD2 }));
  await sleep(10);
  ok("another player's generated is ignored", SB.last.replaced.length === rep0 && !S.pad.html.includes("NOT MINE"));

  // new actions: destroy + remount (a held SHOOT must still get its release)
  SB.last.press("shoot"); await sleep(10);
  state.calls.length = 0;
  const old = SB.last;
  T.html('<!doctype html><html><div data-stick="steer"></div><div data-action="shoot"></div><div data-action="scan"></div> ' + "w".repeat(30) + "</html>", "controller");
  await sleep(10);
  ok("other action set: the old frame is destroyed and a new one mounted", old.destroyed === true && SB.mounts.length === mounts0 + 1 && SB.last !== old, [old.destroyed, SB.mounts.length]);
  await sleep(20);
  ok("a held control gets its release when the frame is replaced (no stuck fire)", state.calls.some((c) => c.url === "/input" && c.body.action === "shoot" && c.body.down === false), state.calls.map((c) => c.body && c.body.action + ":" + c.body.down));
  ok("allowed actions of the new mount", JSON.stringify([...SB.last.opts.allowedActions].sort()) === '["scan","shoot","steer"]', SB.last.opts.allowedActions);
}

if (run("fail")) {
  { // the frame lacks a drawn control: the DOM controls come back
    const t = await boot(); const { $, S, T, SB, state } = t;
    await joinAs(t); T.go("play"); await sleep(120);
    SB.last.becomeReady(KIT_CONTROLS.filter((c) => c.action !== "shoot")); await sleep(10);
    ok("missing control: sandbox dropped, DOM controls back, pad marked bad", S.ctl === null && !$("area").classList.contains("sb") && S.pad.bad === true && SB.mounts[0].destroyed, [S.ctl, S.pad.bad]);
    T.go("play"); await sleep(120);
    ok("a bad pad is not mounted again and again", SB.mounts.length === 1 && state.htmlCalls === 1, [SB.mounts.length, state.htmlCalls]);
  }
  { // frame removed by the kit (hostile): ready resolves with no controls
    const t = await boot(); const { $, S, T, SB } = t;
    await joinAs(t); T.go("play"); await sleep(120);
    SB.last.resolveReady([]); await sleep(20);
    ok("frame reported no controls: DOM controls", S.ctl === null && !$("area").classList.contains("sb"));
  }
  { // /controller-html answers 404 (old server)
    const t = await boot({ padApi: "404" }); const { $, S, T, SB, state } = t;
    await joinAs(t); T.go("play"); await sleep(150);
    ok("404 on /controller-html: no sandbox, padFailed, DOM controls", SB.mounts.length === 0 && S.padFailed === true && !$("area").classList.contains("sb") && $("hits").children.length === 3, [SB.mounts.length, S.padFailed]);
    T.go("play"); await sleep(100);
    ok("and it does not ask again on every screen change", state.htmlCalls === 1, state.htmlCalls);
  }
  { // ctrl-sandbox.js missing (404)
    const t = await boot({ sandbox: false }); const { $, S, T, SB, state } = t;
    await joinAs(t); T.go("play"); await sleep(150);
    ok("no ctrl-sandbox.js: DOM controls, no /controller-html call", SB.mounts.length === 0 && !$("area").classList.contains("sb") && state.htmlCalls === 0 && $("hits").children.length === 3, [state.htmlCalls]);
  }
}

if (run("flow")) { // the real drawing flow: the controller answer carries the pad
  const t = await boot(); const { $, S, T, SB, state, R } = t;
  await joinAs(t);
  T.drawSample("ship"); await sleep(1400); $("done").click(); await sleep(200);
  $("resultNext").onclick(); await sleep(20);
  T.drawSample("controller"); await sleep(1400); $("done").click(); await sleep(250);
  ok("controller result: the pad came with the answer (no /controller-html needed)", S.pad && S.pad.html === PAD_HTML && S.pad.source === "template" && state.htmlCalls === 0, [S.step, S.pad && S.pad.source]);
  ok("S.layout is the server's padLayout (4 controls)", S.layout.buttons.length === 4 && S.step === "controllerResult");
  ok("nothing mounted while on the result sheet", SB.mounts.length === 0);
  ok("legend pending", S.legendPending === true);
  $("resultNext").onclick(); await sleep(150);
  ok("PLAY: sandbox mounted with the answer's pad, no extra request", SB.mounts.length === 1 && state.htmlCalls === 0 && S.screen === "play", [SB.mounts.length, state.htmlCalls]);
  ok("legend waits for the frame", !$("legend").classList.contains("on") && S.legendPending === true);
  SB.last.becomeReady([{ action: "steer", kind: "stick", label: "STEER", x: 0.04, y: 0.4, w: 0.3, h: 0.55 }, { action: "shoot", kind: "button", label: "FIRE", x: 0.6, y: 0.3, w: 0.2, h: 0.3 }, { action: "boost", kind: "button", label: "BOOST", x: 0.55, y: 0.65, w: 0.2, h: 0.3 }, { action: "land", kind: "button", label: "LAND", x: 0.8, y: 0.65, w: 0.15, h: 0.3 }]);
  await sleep(20);
  ok("legend from the frame's own labels, after it is live", $("legend").classList.contains("on") && $("legend").textContent === "STEERFIREBOOSTLAND", $("legend").textContent);
  // entity of the ship (no scan): a SCAN button added later is locked in the legend of the next pad
  // add a button: the server merges it into the pad and answers with the whole pad as HTML
  state.padLayout = S.layout;
  state.padHtml = PAD_HTML + "<!-- with the new button -->";
  $("tAdd").onclick(); await sleep(20);
  ok("add sheet: opens", !$("add").classList.contains("hidden"));
  T.drawSample("ship"); await sleep(20);
  await $("addDone").onclick(); await sleep(150);
  ok("add-a-button: the whole pad html from the answer is adopted (replace in place, same actions)", SB.last.replaced.length === 1 && SB.last.replaced[0].includes("with the new button"), SB.last.replaced.length);
  ok("add sheet closed again", $("add").classList.contains("hidden"));
}
process.exit(done() ? 1 : 0);
