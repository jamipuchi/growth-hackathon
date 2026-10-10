# phone agent: notes (v1.2 client track)

Owner of: controller.html, phone-extras.js, ctrl-sandbox.js, mischief-fx.js, dev/v12-client/phone/, shots/phone/. Ports 8262-8263.
Read first: .orch/CONTRACT.md, dev/v12-client/SPEC.md ("Agent: phone"). Can be cut off any time: this file says where I am.
Updated 02:25.

## STATE IN ONE LINE
All 8 items of the phone list are IMPLEMENTED in controller.html (+ COPY). `node dev/v11-client/check-syntax.mjs controller.html phone-extras.js
ctrl-sandbox.js mischief-fx.js` passes. NO BROWSER RUN YET: browsers abort machine-wide since ~02:13 (SIGABRT in HIServices _RegisterApplication, no
GUI session: Chromium and WebKit both). Node-only fake-DOM smoke tests are the only verification so far (see "Verified").

## Done (code in controller.html unless stated)
1. Join: `DEVICE` token (localStorage "sp.device", 24 chars [A-Za-z0-9_-], made once, sessionStorage backup) sent as `device` AND `token` with every /join (also the
   refresh rejoin). `renamed: true` -> body-level notice `#notice` "RIVAL WAS TAKEN · YOU ARE RIVAL2" (5 s, any screen). 400 "game is full" /
   "player name required" stay on the join screen with a message (before: the phone went on as if joined).
2. Sol's controller in the sandbox: `#ctl` in `#area` (z 2, ghost z 3 above). ensureCtl() on every enterPlay: dynamic import of ctrl-sandbox.js (.catch ->
   DOM controls); S.pad (from the /generate answer `html/controls/htmlSource/padLayout`, from `generated`, or POST /controller-html {player}) ->
   mountController(allowedActions = requiredActions = padLayout actions, fallbackHtml = same html, readyTimeoutMs 6000). Same action set: handle.replace()
   (kind "html" = Sol's swap, no flash); other set: destroy + remount. padLayout is adopted as S.layout (applyLayout keeps the ink). `#area.sb` hides `#hits`
   and makes `#ink` faint (0.2). Frame never ready / lacks a pad control / reports none -> dropCtl(): the DOM controls (always built) come back; pad.bad stops
   remount loops. Locks + cooldowns: `syncDisabled()` -> handle.setDisabled(locked U cooling) on entity change, cooldown start/end, every onReady. onPress of
   a locked action -> lock tip above the control (rect = controls() fractions x #ctl rect); cooling -> "EMP · READY IN 12 S"; hold >= 450 ms -> "what it does"
   (first 3 holds). The input is still sent (server is the authority). Legend after a new controller waits for the frame (`maybeLegend`). Releases:
   `releaseAll()` = DOM controls + handle.releaseAll() on blur, hidden, landing/take-off, results, explorer / ctrl prompt / add sheet / redraw menu, death.
   Cooldown chips `#cd .cdchip` (seconds on the greyed control, 4 Hz timer only while something cools). "view" control toggles the camera locally.
3. Mischief (`onMischief`): emp -> `MFX.emp(#play, seconds, DOM controls only: {onSwap})` (target #play: the overlay + countdown chip sit ABOVE the HUD; the frame
   is found inside it); inkbomb -> `inkBomb(#play,{seconds})`; tractor -> `tractorHit(#play,{by: from, dir: -dir})` (server pi/2 = up, mfx pi/2 = down);
   mine -> `mineHit(#play,{by: from, points: -abs(points||30), stunSeconds: seconds, shakeEl: #game})`; decoy -> victim ? `decoyFooled(#play,{by: victim, mine:
   true, victim})` : `decoyFooled(#play,{by: from})`. Own mischief: announce lines "⚡ me scrambled bob's buttons" / "🦑 me inked" / "🧲 me pulled" /
   "💣 bob hit me's mine" -> gold `MFX.toast` ("BOB'S BUTTONS SCRAMBLED!"), my chip when mischief-fx is missing. Without mischief-fx.js: a plain toast (EMP still
   scrambles through the frame's own handle.fx). Legacy DOM controls + EMP: `data-action` on each `.hit`, `empMap` from onSwap, a touch on a place triggers
   the action SHOWN there (`actualOf(place)`; pointers hold `{ctl, place}`). All messages are filtered to `m.player === S.player` (old render.js sends every
   player's mischief/cooldown to every phone).
4. "drawing": `syncDrawing()` = phase playing|assists (from every `tick`) AND (draw screen | add sheet | explorer | ctrlPrompt) -> sendInput("drawing", true/false),
   re-evaluated on every tick and screen change: never left down (server caps 30 s per press).
5. Death card `#dead`: flags.dead (hud.me) -> "DESTROYED!" / "BY BOB" (killer from the death toast `killer`, or an announce "bob ✕ me") / big BACK IN n
   (ceil(respawnIn)) / "-50 POINTS" (C.SCORING.killed); controls released; the death toast is swallowed (the card says it); respawn -> `#fight` "BACK IN THE FIGHT!"
   pop. z 9300 (above mfx ink 9000 / toasts 9100).
6. Announcement chip `#chip` (under the objective, 2.5 s, priority so a lesser one never pushes out a better one): boss down (+ who), all powers on, chest opened
   (mine gold, others cyan), steal (mine / mine-victim / others), my kill (+200, no points text for a bot). NOT shown: the round winner (the results sheet
   covers the chip within 100 ms and already names the winner), my death (the card).
7. Cleanups: ghost + sketch + tip memory cleared on scoreboard/lobby; `pointercancel` releases only that pointer; `S.game.pause()` while the draw screen / join
   / hidden page (syncRendering; guarded: render.js lacks it today); explorer prompt has `#expCount` = PLANET budget (+ buttons greyed at 0); name tags
   `createNameTags({max: 25})`; page no longer plays "start" or "win" (render.js plays them); RADAR CONFIRMED: render.js computeHud rel(): dz = dot(e, forward) >
   0 = ahead; phone-extras createRadar y = c - dz*k -> ahead = UP. No change needed.
8. COPY: new table entries (join.renamed/full, cool.tip, dead.*, moment.*, mischief.*, skills + does for the 5 mischief skills), plain-word rewrites: rotate "Turn
   your phone sideways", tilt toasts, join.badName, results.noWinner "NOBODY SCORED" (matches the TV).
Test hooks (window.__spTest, all old ones kept): mischief(msg), announce(text), cooldown(verb, s), dead(killer, s), html(html, kind, padLayout), ctl().

## Verified (node only, no browser)
- check-syntax: all 4 files OK.
- fake-DOM smoke (dev/v12-client/phone/smoke/*.mjs): see the list at the bottom (filled in as they pass).

## NOT verified (needs a browser)  <- retry <= 3 times, 5 min apart, when the lock is free
`dev/v12-client/phone/locked.sh 470 node dev/v12-client/phone/tour.mjs --part a` (sandbox, real 2-human EMP, hooks, death card, drawing, swap, results; 60+ checks)
`dev/v12-client/phone/locked.sh 470 node dev/v12-client/phone/tour.mjs --part b` (ctrl-sandbox.js 404 -> DOM controls, legacy EMP remap, no mischief-fx.js)
Shots go to dev/v12-client/shots/phone/, reports to dev/v12-client/phone/tour-report-{a,b}.json. Things to LOOK at in the shots: ink opacity under the tiles
(0.2 now), the EMP chip above the HUD, `.mfx-toasts` moved to top 156 px (!important rule in controller.html), chip position (top st+118) vs the toast (st+160),
death card size at 844x390, locked / cooldown tips, the renamed notice on the draw screen.

## How to resume
controller.html is the source of truth; `const COPY` at the top of its module script holds every string. Sections: `// ---- hit areas` (DOM controls + shared tips),
`// Sol's controller` (sandbox glue, cooldowns, onGenerated), `// What rivals do to me` (mischief, chip, death card), test hooks at the end. Scratch blocks I spliced
in are kept in dev/v12-client/phone/block-*.js (documentation only; controller.html is the truth).
