# v16-endless: the client edits (exact patch plan + applier) for render.js, space.html and controller.html. Each anchor
# must match exactly once in its file, else that file is left untouched. Run from the repo root once the files are free
# (after the "v1.6 render" commit):
#   python3 dev/v16-endless/apply-clients.py [render.js] [space.html] [controller.html] [--dry]
# Everything keys off world.mode / tick.mode === "endless" (absent in the demo), so the demo looks and plays as before;
# the one thing the demo shows is the ENDLESS switch (OFF) beside START on the big screen's lobby.
import sys

RENDER = [
  # the HUD words
  ("""  allOpen: "EVERY CHEST IS OPEN",
""",
   """  allOpen: "EVERY CHEST IS OPEN",
  // v1.6 ENDLESS (endless.js, world.mode "endless"): no clock (the timer shows ∞), new chests keep coming, the host ends the game.
  endless: "∞",
  allOpenEndless: "EVERY CHEST IS OPEN · NEW ONES SOON",
  gameOver: "GAME OVER",
"""),
  ("""  const H = HUD_COPY;
  let objective = null, bar = 0, status = "", objPos = null;
""",
   """  const H = HUD_COPY;
  const endless = world?.mode === "endless"; // v1.6 ENDLESS: no cap (tick.left is 0), the timer shows ∞
  let objective = null, bar = 0, status = "", objPos = null;
"""),
  ("""    } else status = H.allOpen;
""",
   """    } else status = endless ? H.allOpenEndless : H.allOpen;
"""),
  ("""  if (phase === "scoreboard") { objective = null; status = world?.result?.reason === "chests" ? H.allChests : H.timeUp; }""",
   """  if (phase === "scoreboard") { objective = null; status = world?.result?.reason === "chests" ? H.allChests : world?.result?.reason === "host" ? H.gameOver : H.timeUp; }"""),
  ("""  const left = tick && playing && Number.isFinite(tick.left) ? Math.max(0, tick.left - elapsed) : 0;
""",
   """  // v1.6 ENDLESS: no cap: a time left that never runs low (the pages flag the last 30 s from it), ∞ as its text
  const left = endless && playing ? 3600 : tick && playing && Number.isFinite(tick.left) ? Math.max(0, tick.left - elapsed) : 0;
"""),
  ("""    left, leftText: formatClock(Math.ceil(left)),
""",
   """    left, leftText: endless && playing ? H.endless : formatClock(Math.ceil(left)), endless, // v1.6: endless = world.mode "endless"
"""),
]

SPACE = [
  # CSS: the switch beside START and END under the timer
  ("""  #startNote { font-size: 1.15rem; color: #e4dfff; text-align: center; }
""",
   """  #startNote { font-size: 1.15rem; color: #e4dfff; text-align: center; }
  /* v1.6 ENDLESS (endless.js): the switch beside START (host key E) and, in an endless game, END under the timer (or ENTER twice) */
  #startRow { display: flex; align-items: center; gap: 1.8rem; }
  #endlessBtn { pointer-events: auto; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .35rem; width: 12rem; height: 6.2rem;
                border: 0; background: none; font: inherit; color: #fff; --bg: linear-gradient(180deg, rgb(46 34 150 / .96), rgb(22 14 78 / .96)); transition: transform .12s, filter .12s; }
  #endlessBtn.on { --bg: linear-gradient(180deg, #b45cff, #8a3dff); }
  #endlessBtn.on::before { animation: glow 1.6s ease-in-out infinite; }
  #endlessBtn:hover { filter: brightness(1.12); }
  #endlessBtn:active { transform: translateY(.2rem) scale(.95); }
  #endlessBtn:focus-visible { outline: .3rem solid #fff; outline-offset: .4rem; }
  #endlessBtn > .h:first-child { font-size: 2.2rem; }
  #endlessState { font-size: 1.5rem; padding: .1rem .7rem .15rem; border-radius: .3rem; background: rgb(0 0 0 / .35); }
  #endlessBtn.on #endlessState { background: #ffd34d; color: #1a0f3a; }
  #endWrap { position: absolute; left: 0; right: 0; top: 100%; margin-top: 1rem; display: flex; justify-content: center; }
  #endBtn { pointer-events: auto; cursor: pointer; padding: .35rem 1.1rem .45rem; border: 0; background: none; font: inherit; font-size: 1.5rem; white-space: nowrap;
            --bg: linear-gradient(180deg, #ff7b92, #ff3b5c); }
  #endBtn.off { display: none; }
  #endBtn.armed { animation: throb .8s ease-in-out infinite; }
"""),
  # markup: the timer label gets an id (ENDLESS in an endless game), END under it
  ("""      <div class="lbl h dk" data-copy="play.timeLeft"></div>
      <div id="timer" class="h hh dk">0:00</div>
      <div id="assistWrap"><div id="assist" class="sk green"><span class="h" data-copy="play.assists"></span></div></div>
""",
   """      <div id="timeLbl" class="lbl h dk" data-copy="play.timeLeft"></div>
      <div id="timer" class="h hh dk">0:00</div>
      <div id="assistWrap"><div id="assist" class="sk green"><span class="h" data-copy="play.assists"></span></div></div>
      <div id="endWrap"><button id="endBtn" class="sk off" type="button"><span id="endLabel" class="h hh" data-copy="endless.end"></span></button></div>
"""),
  # markup: START and the ENDLESS switch side by side
  ("""      <button id="startBtn" class="sk" type="button">
""",
   """      <div id="startRow">
      <button id="startBtn" class="sk" type="button">
"""),
  ("""        <span id="startLabel" class="h hh" data-copy="lobby.start"></span></button>
""",
   """        <span id="startLabel" class="h hh" data-copy="lobby.start"></span></button>
      <button id="endlessBtn" class="sk" type="button" aria-pressed="false"><span class="h hh" data-copy="endless.title"></span><small id="endlessState" class="h" data-copy="endless.off"></small></button>
      </div>
"""),
  # words
  ("""  sound: { on: "SOUND ON", off: "SOUND OFF" },
""",
   """  sound: { on: "SOUND ON", off: "SOUND OFF" },
  // v1.6 ENDLESS free-for-all (endless.js): the lobby switch, the timer label, END and the toasts.
  endless: { title: "ENDLESS", on: "ON", off: "OFF", label: "ENDLESS", end: "END GAME", confirm: "ENTER AGAIN TO END",
    toastOn: "ENDLESS ON · NO CLOCK · PLAY AS LONG AS YOU LIKE", toastOff: "ENDLESS OFF · 4:00 ROUNDS", lobbyOnly: "SWITCH ENDLESS IN THE LOBBY" },
"""),
  ("""    allChests: "EVERY CHEST IS OPEN!",
""",
   """    allChests: "EVERY CHEST IS OPEN!",
    gameOver: "GAME OVER!", // v1.6 ENDLESS: the host ended the game
"""),
  ("""  help: "HOST KEYS · ENTER start (or skip the podium) · M sound · H hide this",""",
   """  help: "HOST KEYS · ENTER start (or skip the podium) · E endless on / off · ENTER twice ends an endless game · M sound · H hide this","""),
  # the switch, END and their state
  ("""$("startBtn").addEventListener("keyup", (e) => { if (e.key === " ") e.preventDefault(); });
""",
   """$("startBtn").addEventListener("keyup", (e) => { if (e.key === " ") e.preventDefault(); });

// ================= ENDLESS (v1.6, owner 10 Oct 11:53; endless.js) =================
// The switch beside START (host key E) posts /mode in the lobby; what is on comes back in the world message (world.mode
// "endless"), so every screen agrees. In an endless game END under the timer (or ENTER twice within 3 s) posts /end: the
// normal results, then the lobby. The demo (switch OFF) is unchanged.
const isEndless = () => !!(world && world.mode === "endless");
let endlessBusy = false, endArmedUntil = 0;
function syncEndless() {
  const on = isEndless();
  flag($("endlessBtn"), "on", on);
  $("endlessBtn").setAttribute("aria-pressed", on ? "true" : "false");
  setText($("endlessState"), on ? COPY.endless.on : COPY.endless.off);
  const armed = on && performance.now() < endArmedUntil;
  flag($("endBtn"), "off", !on || view !== "play");
  flag($("endBtn"), "armed", armed);
  setText($("endLabel"), armed ? COPY.endless.confirm : COPY.endless.end);
  setText($("timeLbl"), on ? COPY.endless.label : COPY.play.timeLeft);
}
async function toggleEndless() {
  sfxUnlock();
  sfxPlay("click");
  $("endlessBtn").blur();
  if (endlessBusy || starting) return;
  if (view !== "lobby" || phase !== "lobby") { ptoast(esc(COPY.endless.lobbyOnly), 1400); return; }
  endlessBusy = true;
  const want = !isEndless();
  try {
    const res = await fetch("/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endless: want }) });
    const j = await res.json().catch(() => null);
    if (res.ok && j) ptoast(esc(j.mode === "endless" ? COPY.endless.toastOn : COPY.endless.toastOff), 1800);
  } catch (e) { /* the world message says what is on */ }
  endlessBusy = false;
  syncEndless();
}
async function endGame() {
  sfxUnlock();
  if (!isEndless() || view !== "play") return;
  const now = performance.now();
  if (now >= endArmedUntil) { endArmedUntil = now + 3000; sfxPlay("click"); syncEndless(); setTimeout(syncEndless, 3100); return; }
  endArmedUntil = 0;
  syncEndless();
  try { await fetch("/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch (e) { /* the ticks say when it ends */ }
}
$("endlessBtn").addEventListener("click", toggleEndless);
$("endlessBtn").addEventListener("keyup", (e) => { if (e.key === " ") e.preventDefault(); });
$("endBtn").addEventListener("click", endGame);
"""),
  ("""  else if (view === "results") renderResults(h);
  syncAmbience();
""",
   """  else if (view === "results") renderResults(h);
  syncAmbience();
  syncEndless(); // v1.6 ENDLESS: the switch, END and the timer label
"""),
  # keys: E toggles in the lobby; ENTER twice ends an endless game
  ("""  if (view === "results" && key === "Enter") { e.preventDefault(); if (!e.repeat) cerFinish(); return; } // the host skips the podium
""",
   """  if (view === "results" && key === "Enter") { e.preventDefault(); if (!e.repeat) cerFinish(); return; } // the host skips the podium
  if (view === "lobby" && key === "e") { e.preventDefault(); if (!e.repeat) toggleEndless(); return; } // v1.6 ENDLESS switch
  if (view === "play" && key === "Enter" && isEndless()) { e.preventDefault(); if (!e.repeat) endGame(); return; } // v1.6: ENTER twice ends it
"""),
  # results title for the host's END
  ("""  cer.reason = have ? (r.reason === "chests" ? COPY.results.allChests : COPY.results.timesUp) : "";""",
   """  cer.reason = have ? (r.reason === "chests" ? COPY.results.allChests : r.reason === "host" ? COPY.results.gameOver : COPY.results.timesUp) : "";"""),
]

CONTROLLER = [
  # a rocket icon
  ("""    <symbol id="i-full" viewBox="0 0 24 24">""",
   """    <symbol id="i-rocket" viewBox="0 0 24 24"><path d="M12 2.5c3 2.4 4.4 5.8 4.4 9.6v4.2H7.6v-4.2c0-3.8 1.4-7.2 4.4-9.6z"/><circle cx="12" cy="9.5" r="1.7"/><path d="M7.6 13 5 15.8v3.4l2.6-1.6M16.4 13l2.6 2.8v3.4l-2.6-1.6M10 19c.4 1.1 1.1 2 2 2.6.9-.6 1.6-1.5 2-2.6"/></symbol>
    <symbol id="i-full" viewBox="0 0 24 24">"""),
  # the TAKE OFF tool (gold, first in the row), only in an endless game on the planet
  ("""        <button id="tAdd" class="tool" type="button">""",
   """        <button id="tTakeoff" class="tool on hidden" type="button" aria-label="Take off: back to space"><svg viewBox="0 0 24 24"><use href="#i-rocket"/></svg></button>
        <button id="tAdd" class="tool" type="button">"""),
  # words
  ("""timeLeft: "TIME LEFT",""",
   """timeLeft: "TIME LEFT", endless: "ENDLESS","""),
  # the mode from every tick
  ("""  S.net.phase = m.phase;
""",
   """  S.net.phase = m.phase;
  S.endless = m.mode === "endless"; // v1.6 ENDLESS (tick.mode, absent in the demo)
"""),
  # the explorer prompt: once per endless game, not at every landing
  ("""  if (mode === "space") S.explorerAsked = false;
""",
   """  if (mode === "space" && !S.endless) S.explorerAsked = false; // v1.6 ENDLESS: asked once per game, not at every landing
"""),
  # the HUD: ENDLESS over the ∞ timer, and the TAKE OFF tool on the planet
  ("""  setCached("clock", hudEls.clock, playing ? (typeof h.leftText === "string" ? h.leftText : fmt(left)) : "");
""",
   """  setCached("clock", hudEls.clock, playing ? (typeof h.leftText === "string" ? h.leftText : fmt(left)) : "");
  // v1.6 ENDLESS: the timer says ENDLESS (render.js gives ∞), and an explorer can always TAKE OFF back to space (the rocket tool)
  setCached("tl", hudEls.timer.firstElementChild, S.endless ? COPY.hud.endless : COPY.hud.timeLeft);
  const canTakeoff = !!(S.endless && playing && me && me.mode === "planet" && !(me.flags && (me.flags.dead || me.flags.landing || me.flags.takingOff)));
  if (hudCache.takeoff !== canTakeoff) { hudCache.takeoff = canTakeoff; $("tTakeoff").classList.toggle("hidden", !canTakeoff); }
"""),
  ("""$("tView").onclick = toggleView;
""",
   """$("tView").onclick = toggleView;
// v1.6 ENDLESS: TAKE OFF from the planet (every explorer can: the innate skill), then land again, as often as you like
$("tTakeoff").onclick = () => { sendInput("takeoff", true); setTimeout(() => sendInput("takeoff", false), 120); };
"""),
  # the fallback HUD (no render.js): no 0:00 in endless
  ("""      return { phase: tick.phase, clock: tick.clock, left: tick.left, objective,""",
   """      return { phase: tick.phase, clock: tick.clock, left: tick.left, ...(tick.mode === "endless" ? { left: 3600, leftText: "∞" } : {}), objective,"""),
]

FILES = {"render.js": RENDER, "space.html": SPACE, "controller.html": CONTROLLER}
MARK = {"render.js": "allOpenEndless", "space.html": "endlessBtn", "controller.html": "tTakeoff"}

def apply(path, edits, dry):
    src = open(path, encoding="utf-8").read()
    if MARK[path] in src:
        print(f"{path}: already has the endless edits"); return True
    bad = [(i + 1, src.count(a)) for i, (a, _) in enumerate(edits) if src.count(a) != 1]
    if bad:
        for n, c in bad: print(f"{path} edit {n}: anchor found {c} times (want 1)")
        return False
    for a, b in edits: src = src.replace(a, b)
    if dry: print(f"{path}: dry run, all {len(edits)} anchors match once"); return True
    open(path, "w", encoding="utf-8").write(src)
    print(f"{path}: {len(edits)} endless edits applied")
    return True

def main():
    dry = "--dry" in sys.argv
    names = [a for a in sys.argv[1:] if a in FILES] or list(FILES)
    ok = all([apply(n, FILES[n], dry) for n in names])
    sys.exit(0 if ok else 1)

main()
