// Mischief hits, own-mischief toasts, announcement chips, the death card, the "drawing" input and the v1.0 cleanups.
import { boot, sleep, makeChecker, KIT_CONTROLS, PAD_HTML, DEFAULT_PAD } from "./env.mjs";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED", e); process.exitCode = 1; });
const { ok, done } = makeChecker();
const only = process.argv[2] || "all";
const run = (name) => only === "all" || only === name;
const joinAs = async (t, name = "tester") => { t.$("name").value = name; await t.$("joinForm").onsubmit({ preventDefault() {} }); await sleep(50); };
const fire = (R, type, m) => (R.handlers[type] || []).forEach((cb) => cb({ type, ...m }));
const lastCall = (MFX, name) => [...MFX.calls].reverse().find((c) => c.name === name);
const ptr = (type, x, y, id = 1, target) => ({ type, pointerId: id, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, target });

if (run("hits")) { // sandbox on: the five kinds, exact arguments
  const t = await boot(); const { $, S, T, R, SB, MFX } = t;
  await joinAs(t); T.go("play"); await sleep(150);
  SB.last.becomeReady(KIT_CONTROLS); await sleep(10);
  const host = $("play");
  fire(R, "mischief", { kind: "emp", player: "tester", from: "bob", seconds: 5 });
  let c = lastCall(MFX, "emp");
  ok("emp: MFX.emp(#play, 5) and NO onSwap (the frame's kit swaps)", c && c.args[0] === host && c.args[1] === 5 && !(c.args[2] && c.args[2].onSwap), c && [c.args[1], Object.keys(c.args[2] || {})]);
  fire(R, "mischief", { kind: "inkbomb", player: "tester", from: "bob", seconds: 4 });
  c = lastCall(MFX, "inkBomb");
  ok("inkbomb: inkBomb(#play, { seconds: 4 })", c && c.args[0] === host && c.args[1].seconds === 4, c && c.args[1]);
  fire(R, "mischief", { kind: "tractor", player: "tester", from: "bob", seconds: 1.5, dir: Math.PI / 2 });
  c = lastCall(MFX, "tractorHit");
  ok("tractor: dir = -dir (server pi/2 = up, mfx pi/2 = down), by = from", c && c.args[1].by === "bob" && c.args[1].dir === -Math.PI / 2 && c.args[1].seconds === 1.5, c && c.args[1]);
  fire(R, "mischief", { kind: "tractor", player: "tester", from: "bob", seconds: 1.5 });
  c = lastCall(MFX, "tractorHit");
  ok("tractor without a dir: 0 (right), not NaN", c.args[1].dir === 0, c.args[1]);
  fire(R, "mischief", { kind: "mine", player: "tester", from: "bob", seconds: 1.5, points: 30 });
  c = lastCall(MFX, "mineHit");
  ok("mine: points -30 (positive 30 from the server), stunSeconds, by, shakeEl #game", c && c.args[1].points === -30 && c.args[1].stunSeconds === 1.5 && c.args[1].by === "bob" && c.args[1].shakeEl === $("game"), c && c.args[1]);
  fire(R, "mischief", { kind: "decoy", player: "tester", from: "bob", seconds: 0 });
  c = lastCall(MFX, "decoyFooled");
  ok("decoy (no victim): you shot bob's decoy -> decoyFooled(#play, { by: from })", c && c.args[1].by === "bob" && !c.args[1].mine, c && c.args[1]);
  fire(R, "mischief", { kind: "decoy", player: "tester", from: "tester", victim: "bob", seconds: 0 });
  c = lastCall(MFX, "decoyFooled");
  ok("decoy (victim): your decoy fooled bob -> { by: victim, mine: true, victim }", c && c.args[1].by === "bob" && c.args[1].mine === true && c.args[1].victim === "bob", c && c.args[1]);
  const n = MFX.calls.length;
  fire(R, "mischief", { kind: "emp", player: "someoneelse", from: "bob", seconds: 5 });
  fire(R, "cooldown", { player: "someoneelse", verb: "emp", seconds: 5 });
  ok("messages for other players are ignored (older render.js sends everyone's)", MFX.calls.length === n && Object.keys(S.cool).length === 0);
  T.mischief({ kind: "mine", points: 30 });
  ok("__spTest.mischief runs the same handler (defaults: me, from bob)", lastCall(MFX, "mineHit").args[1].by === "bob" && MFX.calls.length === n + 1);
}

if (run("legacy")) { // sandbox missing: EMP remap on the DOM controls
  const t = await boot({ sandbox: false }); const { $, S, T, R, MFX, state } = t;
  await joinAs(t); T.go("play"); await sleep(150);
  fire(R, "mischief", { kind: "emp", player: "tester", from: "bob", seconds: 5 });
  await sleep(30);
  const c = lastCall(MFX, "emp");
  ok("legacy emp: onSwap given", c && c.args[0] === $("play") && typeof c.args[2].onSwap === "function");
  ok("each DOM control carries data-action (what mischief-fx keys on)", $("hits").children.map((e) => e.getAttribute("data-action")).join() === "steer,boost,shoot", $("hits").children.map((e) => e.getAttribute("data-action")));
  // boost <-> shoot swapped: a touch on boost's original place presses what is shown there (shoot)
  c.args[2].onSwap({ boost: "shoot", shoot: "boost" });
  state.calls.length = 0;
  const b = DEFAULT_PAD.buttons[1];                                    // boost's place
  $("hits").dispatchEvent(ptr("pointerdown", 844 * (b.x + b.w / 2), 390 * (b.y + b.h / 2), 1, $("hits")));
  await sleep(10);
  const sent = () => state.calls.filter((x) => x.url === "/input").map((x) => `${x.body.action}:${x.body.down}`);
  ok("touch on BOOST's place sends SHOOT (what is shown there)", sent().join() === "shoot:true", sent());
  $("hits").dispatchEvent(ptr("pointerup", 844 * (b.x + b.w / 2), 390 * (b.y + b.h / 2), 1, $("hits")));
  await sleep(10);
  ok("and the release goes to SHOOT too", sent().join() === "shoot:true,shoot:false", sent());
  // sliding: the pointer follows the place box, not the control
  state.calls.length = 0;
  const x0 = 844 * (b.x + b.w / 2), y0 = 390 * (b.y + b.h / 2);
  $("hits").dispatchEvent(ptr("pointerdown", x0, y0, 7, $("hits")));
  $("hits").dispatchEvent(ptr("pointermove", x0 + 3, y0 + 2, 7, $("hits")));
  await sleep(15);
  ok("moving inside the place keeps it pressed", sent().join() === "shoot:true", sent());
  $("hits").dispatchEvent(ptr("pointermove", 20, 20, 7, $("hits")));
  await sleep(15);
  ok("sliding off the place releases it", sent().join() === "shoot:true,shoot:false", sent());
  // pointercancel only releases that pointer
  state.calls.length = 0;
  const s = DEFAULT_PAD.buttons[2];
  $("hits").dispatchEvent(ptr("pointerdown", 844 * (s.x + s.w / 2), 390 * (s.y + s.h / 2), 11, $("hits")));      // SHOOT's place: shows boost now
  $("hits").dispatchEvent(ptr("pointerdown", x0, y0, 12, $("hits")));                                            // BOOST's place: shows shoot
  await sleep(15);
  const before = sent().join();
  $("hits").dispatchEvent(ptr("pointercancel", 0, 0, 11, $("hits")));
  await sleep(15);
  ok("pointercancel releases only that finger", before === "boost:true,shoot:true" && sent().join() === "boost:true,shoot:true,boost:false", [before, sent()]);
  $("hits").dispatchEvent(ptr("pointerup", 0, 0, 12, $("hits")));
  await sleep(15);
  // EMP over: the map is cleared
  c.args[2].onSwap(null);
  state.calls.length = 0;
  $("hits").dispatchEvent(ptr("pointerdown", x0, y0, 21, $("hits"))); $("hits").dispatchEvent(ptr("pointerup", x0, y0, 21, $("hits")));
  await sleep(15);
  ok("EMP over: BOOST's place presses BOOST again", sent().join() === "boost:true,boost:false", sent());
}

if (run("nofx")) { // mischief-fx.js missing
  const t = await boot({ fx: false }); const { $, S, T, R, SB } = t;
  await joinAs(t); T.go("play"); await sleep(150);
  SB.last.becomeReady(KIT_CONTROLS); await sleep(10);
  fire(R, "mischief", { kind: "mine", player: "tester", from: "bob", seconds: 1.5, points: 30 });
  ok("no mischief-fx.js: a plain line says it", $("toastText").textContent === "MINE! YOU LOST 30 POINTS" && !$("toast").classList.contains("off"), $("toastText").textContent);
  fire(R, "mischief", { kind: "emp", player: "tester", from: "bob", seconds: 5 });
  ok("no mischief-fx.js: the frame's own EMP still scrambles (handle.fx)", SB.last.fx.length === 1 && SB.last.fx[0][0] === "emp" && SB.last.fx[0][1].seconds === 5, SB.last.fx);
  fire(R, "announce", { text: "⚡ tester scrambled bob's buttons" });
  ok("own EMP without mischief-fx.js: the chip says it", $("chipTitle").textContent === "BOB'S BUTTONS SCRAMBLED!" && !$("chip").classList.contains("off") && $("chip").dataset.tone === "gold", $("chipTitle").textContent);
}

if (run("moments")) {
  const t = await boot(); const { $, S, T, R, SB, MFX } = t;
  await joinAs(t); T.go("play"); await sleep(150);
  const chip = () => [$("chipTitle").textContent, $("chipSub").textContent, $("chip").dataset.tone, $("chip").classList.contains("off")];
  const say = (text) => fire(R, "announce", { text });
  say("⚡ tester scrambled bob's buttons");
  let c = lastCall(MFX, "toast");
  ok("my EMP hit bob: gold MFX.toast \"BOB'S BUTTONS SCRAMBLED!\"", c && c.args[0] === "BOB'S BUTTONS SCRAMBLED!" && c.args[1].tone === "gold" && c.args[1].screenEl === $("play"), c && [c.args[0], c.args[1]]);
  say("🦑 tester inked bob's screen"); ok("ink: BOB GOT INKED!", lastCall(MFX, "toast").args[0] === "BOB GOT INKED!");
  say("🧲 tester pulled bob in"); ok("tractor: BOB PULLED IN!", lastCall(MFX, "toast").args[0] === "BOB PULLED IN!");
  say("💣 bob hit tester's mine (-30)"); ok("my mine: BOB HIT YOUR MINE!", lastCall(MFX, "toast").args[0] === "BOB HIT YOUR MINE!");
  const n = MFX.calls.length;
  say("⚡ bob scrambled tester's buttons"); say("🎭 bob shot tester's decoy"); say("💣 tester hit bob's mine (-30)");
  ok("lines where I am the victim or a decoy line make no own toast", MFX.calls.length === n);
  say("💥 bob landed the last hit on the boss! REACH THE PLANET");
  ok("chip: boss down + who", JSON.stringify(chip()) === JSON.stringify(["BOSS DOWN!", "BOB LANDED THE LAST HIT", "gold", false]), chip());
  say("💥 tester landed the last hit on the boss (stolen from bob)! REACH THE PLANET");
  ok("chip: boss down, I did it (+1000)", chip()[1] === "YOU LANDED THE LAST HIT! +1000", chip());
  say("💥 The swarm brought the boss down! bob did the most damage: +1000. REACH THE PLANET");
  ok("chip: swarm", chip()[1] === "THE SWARM BROUGHT IT DOWN", chip());
  say("💎 tester opened a chest (+1500)");
  ok("a lesser chip does not push out the boss one", chip()[0] === "BOSS DOWN!", chip());
  await sleep(2600);
  ok("the chip leaves after 2.5 s", chip()[3] === true, chip());
  say("💎 tester opened a chest (+1500)");
  ok("chip: my chest", chip()[0] === "CHEST OPENED!" && chip()[1] === "+1500 POINTS", chip());
  say("💎 ana opened a chest (+1500)");
  ok("another player's chest: cyan, not over mine", chip()[0] === "CHEST OPENED!");
  await sleep(2600);
  say("💎 ana opened a chest (+1500)");
  ok("another player's chest alone: cyan chip", chip()[0] === "ANA OPENED A CHEST" && chip()[2] === "cyan", chip());
  await sleep(2600);
  say("💰 bob stole 750 points from ana!"); ok("steal (others): violet", chip()[0] === "BOB STOLE 750 POINTS" && chip()[1] === "FROM ANA" && chip()[2] === "violet", chip());
  await sleep(2600);
  say("💰 tester stole 750 points from ana!"); ok("steal (me): gold", chip()[0] === "YOU STOLE 750 POINTS!" && chip()[1] === "FROM ANA", chip());
  await sleep(2600);
  say("💰 bob stole 750 points from tester!"); ok("steal (from me): red", chip()[0] === "BOB STOLE 750 POINTS!" && chip()[1] === "FROM YOU" && chip()[2] === "red", chip());
  await sleep(2600);
  R.hud.scores = [{ name: "ana", bot: false }, { name: "bot3", bot: true }];
  say("tester ✕ ana 💣"); ok("my kill: YOU GOT ANA! +200", chip()[0] === "YOU GOT ANA!" && chip()[1] === "+200 POINTS", chip());
  await sleep(2600);
  say("tester ✕ bot3"); ok("my kill of a bot: no points line", chip()[0] === "YOU GOT BOT3!" && chip()[1] === "", chip());
  await sleep(2600);
  say("bob ✕ ana"); ok("someone else's kill: nothing", chip()[3] === true);
  say("Assists on: every gate skill is unlocked and the chests glow!"); ok("all powers on", chip()[0] === "ALL POWERS ON!" && chip()[2] === "violet", chip());
  await sleep(2600);
  say("🏆 TIME'S UP! bob wins round 1 with 4500 points"); ok("round winner: no chip (the results sheet says it)", chip()[3] === true);
}

if (run("death")) {
  const t = await boot(); const { $, S, T, R, SB, MFX } = t;
  await joinAs(t); T.go("play"); await sleep(150);
  SB.last.becomeReady(KIT_CONTROLS);
  SB.last.press("boost"); await sleep(10);
  const rel0 = SB.last.released;
  R.hud.phase = "playing";
  fire(R, "toast", { player: "tester", kind: "info", verb: null, killer: "bob", text: "Destroyed by bob · back in 3 s" });
  ok("the death toast is swallowed (the card says it)", $("toast").classList.contains("off"));
  R.hud.scores = [{ name: "bob", color: 0xf472b6, bot: false }];
  R.hud.me = { ...R.hud.me, hp: 0, flags: { dead: true }, respawnIn: 2.9 };
  await sleep(250);
  ok("death card opens", $("dead").classList.contains("on"));
  ok("DESTROYED! / BY BOB / BACK IN 3 / -50 POINTS", $("deadTitle").textContent === "DESTROYED!" && $("deadBy").textContent === "BY BOB" && $("deadN").textContent === "3" && $("deadPts").textContent === "-50 POINTS", [$("deadTitle").textContent, $("deadBy").textContent, $("deadN").textContent, $("deadPts").textContent]);
  ok("the killer's colour dot", ($("deadBy").querySelector("i").style.background || "") === "#f472b6", $("deadBy").querySelector("i").style.background);
  ok("controls released when it opens (the held BOOST got its up)", SB.last.released > rel0 && t.state.calls.some((c) => c.url === "/input" && c.body.action === "boost" && c.body.down === false));
  R.hud.me.respawnIn = 1.4; await sleep(150);
  ok("countdown follows respawnIn (ceil)", $("deadN").textContent === "2", $("deadN").textContent);
  R.hud.me.respawnIn = 0.3; await sleep(150);
  ok("... down to 1", $("deadN").textContent === "1");
  await sleep(400);
  R.hud.me = { ...R.hud.me, hp: 100, flags: {}, respawnIn: null }; await sleep(250);
  ok("respawn: card off, BACK IN THE FIGHT! pops", !$("dead").classList.contains("on") && $("fight").classList.contains("on") && $("fight").textContent === "BACK IN THE FIGHT!", [$("dead").className, $("fight").className]);
  await sleep(1300);
  ok("the pop goes away", !$("fight").classList.contains("on"));
  // a death by a rock: no killer line
  fire(R, "toast", { player: "tester", kind: "info", verb: null, killer: null, text: "Destroyed · back in 3 s" });
  R.hud.me = { ...R.hud.me, flags: { dead: true }, respawnIn: 2.9 }; await sleep(250);
  ok("no killer: no BY line", $("dead").classList.contains("on") && $("deadBy").textContent === "", $("deadBy").textContent);
  R.hud.me = { ...R.hud.me, flags: {}, respawnIn: null }; await sleep(200);
  // the killer from the kill feed when the toast never comes
  fire(R, "announce", { text: "ana ✕ tester" });
  R.hud.scores = [];
  R.hud.me = { ...R.hud.me, flags: { dead: true }, respawnIn: 2.9 }; await sleep(250);
  ok("killer from the kill feed line (\"ana ✕ me\")", $("deadBy").textContent === "BY ANA", $("deadBy").textContent);
  R.hud.me = { ...R.hud.me, flags: {}, respawnIn: null }; await sleep(200);
  // the test hook
  T.dead("zed", 2); await sleep(250);
  ok("__spTest.dead(killer, seconds)", $("dead").classList.contains("on") && $("deadBy").textContent === "BY ZED");
  await sleep(2100);
  ok("... ends by itself", !$("dead").classList.contains("on"));
  // round over while dead: no card at the results
  R.hud.me = { ...R.hud.me, flags: { dead: true }, respawnIn: 2.9 }; await sleep(150);
  R.hud.phase = "scoreboard"; await sleep(200);
  ok("results screen: no death card", !$("dead").classList.contains("on"));
}

if (run("drawing")) {
  const t = await boot(); const { $, S, T, R, SB, state } = t;
  await joinAs(t);
  const tick = (phase) => fire(R, "tick", { phase, players: [{ name: "tester", drawingsLeft: { space: 5, planet: 5 } }] });
  const draws = () => state.calls.filter((c) => c.url === "/input" && c.body.action === "drawing").map((c) => c.body.down);
  tick("lobby"); await sleep(30);
  ok("draw screen in the lobby: no drawing input", draws().length === 0, draws());
  T.go("play"); await sleep(150);
  tick("playing"); await sleep(30);
  ok("playing on the play screen: nothing", draws().length === 0);
  $("tAdd").onclick(); await sleep(30); tick("playing"); await sleep(30);
  ok("add-a-button sheet opens in a live round: drawing down (once)", draws().join() === "true", draws());
  tick("playing"); tick("playing"); await sleep(30);
  ok("not re-sent on every tick", draws().join() === "true");
  $("addCancel").onclick(); await sleep(30);
  ok("sheet closed: drawing up", draws().join() === "true,false", draws());
  // the redraw tool → the draw screen
  T.go("ship"); await sleep(30);
  ok("draw screen during play: down again", draws().join() === "true,false,true", draws());
  $("useDefault").onclick(); await sleep(60);
  ok("back to the game: up", draws().join() === "true,false,true,false", draws());
  // round starts while a sheet is open: picked up on the next tick
  T.go("ship"); tick("lobby"); await sleep(30);
  const n = draws().length;
  tick("playing"); await sleep(30);
  ok("the round starts under an open draw screen: down", draws().length === n + 1 && draws()[n] === true, draws());
  tick("scoreboard"); await sleep(30);
  ok("the round ends: up (never left down)", draws()[draws().length - 1] === false, draws());
}

if (run("cleanups")) {
  const t = await boot(); const { $, S, T, R, SB, state, doc } = t;
  await joinAs(t);
  ok("draw screen: renderer pause is not called before the game exists", R.pauses.length === 0);
  T.go("play"); await sleep(150);
  ok("name tags: max 25", R.tags && R.tags.max === 25, R.tags);
  ok("play: renderer running", R.pauses[R.pauses.length - 1] === false, R.pauses);
  T.go("ship"); await sleep(20);
  ok("draw screen up: renderer paused", R.pauses[R.pauses.length - 1] === true, R.pauses);
  $("useDefault").onclick(); await sleep(120);
  ok("back in the game: renderer resumed", R.pauses[R.pauses.length - 1] === false, R.pauses);
  doc.hidden = true; doc.dispatchEvent({ type: "visibilitychange" }); await sleep(10);
  ok("page hidden: paused", R.pauses[R.pauses.length - 1] === true);
  doc.hidden = false; doc.dispatchEvent({ type: "visibilitychange" }); await sleep(10);
  ok("page visible again: running", R.pauses[R.pauses.length - 1] === false);
  // ghost + sketch cleared at a new round
  fire(R, "toast", { player: "tester", kind: "hint", need: "button", gate: "land", text: "Draw a LAND button", ghost: { action: "land", x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, sketch: "landing" });
  ok("a ghost box is up", !!$("ghost") && S.ghost && S.ghost.action === "land");
  R.hud.phase = "playing"; await sleep(150);
  R.hud.phase = "scoreboard"; await sleep(150);
  ok("scoreboard: ghost cleared", !$("ghost") && S.ghost === null, !!$("ghost"));
  fire(R, "toast", { player: "tester", kind: "hint", need: "button", gate: "land", text: "Draw a LAND button", ghost: { action: "land", x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, sketch: null });
  R.hud.phase = "lobby"; await sleep(150);
  ok("a new round (lobby): ghost cleared", !$("ghost"), !!$("ghost"));
  // no start / win sound from the page
  R.played.length = 0;
  R.hud.phase = "playing"; await sleep(150);
  R.hud.phase = "scoreboard"; R.hud.result = { reason: "time", winner: "tester", scores: [["tester", 1500]] }; R.hud.round = 2; await sleep(250);
  ok("the page plays no start / win sound (render.js does)", !R.played.includes("start") && !R.played.includes("win"), R.played);
  ok("results: the winner is shown", /WINNER: TESTER/.test($("resWinner").textContent), $("resWinner").textContent);
  R.hud.result = { reason: "time", winner: null, scores: [] }; await sleep(150);
  // explorer prompt shows the planet budget
  t.state.used = 3; fire(R, "tick", { phase: "playing", players: [{ name: "tester", drawingsLeft: { space: 2, planet: 4 } }] });
  T.go("explorer"); await sleep(60);
  ok("explorer prompt: the PLANET budget (4 OF 5 DRAWINGS LEFT ON ...)", /4 OF 5/.test($("expCount").textContent), $("expCount").textContent);
  fire(R, "tick", { phase: "playing", players: [{ name: "tester", drawingsLeft: { space: 2, planet: 0 } }] }); await sleep(30);
  ok("planet budget 0: the prompt says so and the buttons grey out", /NO DRAWINGS LEFT ON THE PLANET/.test($("expCount").textContent) && $("expPhoto").classList.contains("empty") && $("expDraw").classList.contains("empty"), $("expCount").textContent);
}
process.exit(done() ? 1 : 0);
