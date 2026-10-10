# v1.2 client track: shared spec (lead: v12-client worker, 2026-10-10 01:55)

Headline: Sol writes your controller, mischief, and the v1.0 / Codex fixes. Source of truth: PLAN.md section 0
(style like Fortnite, SUPER CLEAR copy, 25 players, mischief table in section 5). Rules: .orch/CONTRACT.md (no git
writes, no npm, no pattern kills, never read .env, edit only your files, re-read a file right before editing it).

## Who owns what (edit ONLY your files; everything else is read-only for you)
| Agent | Files | Ports |
| --- | --- | --- |
| phone | controller.html, phone-extras.js, ctrl-sandbox.js, mischief-fx.js | 8262-8263 |
| render | render.js, sfx.js, inflate.js, anim.js, anims.js, transition.js | 8264-8265 |
| tv | space.html, bigscreen-extras.js | 8266-8267 |
| lead | dev/v12-client/** (tour harness, e2e runs, review) | 8260-8261, 8268-8269 |
Scratch scripts: dev/v12-client/<agent>/ (yours alone). Notes: dev/v12-client/notes-<agent>.md (keep it current:
done / left / how to resume; you can be cut off any time).

## Test environment: the v1.2 server with this tree's client
The v1.2 server was MERGED into this tree at 01:56 (commit a929336), but its server.js does not serve
ctrl-sandbox.js, mischief-fx.js or sfx.js yet (PUBLIC_FILES; reported to the orchestrator; nobody here may edit
server.js). So test in the stage: `dev/v12-client/stage.sh` (already run) builds /tmp/v12c-stage = symlinks to this
tree (edits are live) + a copy of server.js with those three files added to PUBLIC_FILES + a real copy of dev/e2e. Start a server there on YOUR port:
`cd /tmp/v12c-stage && ASTRA_MOCK=1 HTTPS_PORT=0 PORT=<port> node server.js --bots 24 > /tmp/v12c-<agent>.log 2>&1 &`
and stop it by port when done: `lsof -ti tcp:<port> | xargs kill`. Never touch other ports.
The client must still degrade gracefully when those three files 404 (the tree's own server.js today) or an old
v1.1 server answers (no /info, no html, no mischief): dynamic imports with .catch, legacy controls, render.js synth.

## Browsers and servers: ONE agent at a time (laptop safety)
- Node-only checks (syntax, unit replays) any time: `node --check` does not work on .html; use
  `node dev/v11-client/check-syntax.mjs` (checks every client file's module script).
- Before ANY browser or server run: `test -e .orch/status/HOLD` (if it exists: wait, poll every 60 s; if it stays
  >15 min, ask the lead) and take the lock: `mkdir dev/v12-client/.browser-lock` (atomic; fails if held). Write
  `echo "<agent> $(date +%T)" > dev/v12-client/.browser-lock/owner`. Hold it ≤ 8 minutes, then `rm -rf
  dev/v12-client/.browser-lock` (ALWAYS, also on failure). If held by someone else, poll every 30 s.
- Browsers: playwright-core at /Users/jaumepuig/Documents/linkedin/node_modules/playwright-core; WebKit pinned to
  ~/Library/Caches/ms-playwright/webkit-2311 (webkit-2368 hangs). Helpers you can import:
  dev/v11-client/lib.mjs (launchPhoneBrowser = iPhone 13 WebKit 844x390 DPR 3 touch; launchBig = Chromium; sp.*
  phone helpers; seedPlayers; input/axis posts). One phone + one TV at most per run. Close browsers at the end.
- Screenshots: dev/v12-client/shots/<agent>/ (look at them: the Read tool shows PNGs).

## Server contract you code against (v1.2 server; shapes from its contract.js)
- `GET /events?player=<name>` (phone) / `?screen=big` (TV): personal messages (toast, mischief, cooldown) and the
  controller html go only to that player's streams; the TV gets no toasts. (render.js opens the stream.)
- `GET /info` → `{ lanUrl, httpsUrl|null, controllerUrl, bigScreenUrl }`. The join QR opens controllerUrl.
- `POST /join { player, device }` → `{ player, color, renamed? }`. device = a random token the phone keeps
  (localStorage) and sends on every join (also send it as `token` for forward compat). A name held by another device
  comes back as "ana2" with renamed: true (the phone must say so). 400 when empty/full.
- `POST /generate` (controller|button, ok) → `{ ok, layout, html, controls:[{action,kind,label}], htmlSource:
  "template"|"model", padLayout, drawingsLeft, looksLike? }`. padLayout = the WHOLE pad now (drawn controller + added
  buttons). Errors: `{ ok:false, error, message, looksLike?, thing?, drawingsLeft }`: message = plain words to show
  as is ("" = show nothing). Send `inkRegions` with controller calls (already done).
- `generated { player, kind: "controller"|"button"|"html", layout, html, controls, htmlSource, padLayout }`: kind
  "html" = Sol's own HTML for the same pad arrived later (only the owner's stream gets html): swap it in.
- `POST /controller-html { player, wait? }` → `{ ok, html, controls, htmlSource, padLayout, pending }` (a reloaded
  phone, or a phone with no html yet, e.g. after SKIP). 404 on the old server.
- `POST /input { type:"input", player, action:"drawing", down }`: down when a draw / add-a-button sheet opens during
  play, up when it closes: the ship hovers and cannot be hurt (server caps it at 30 s per press).
- `mischief { kind: emp|inkbomb|tractor|mine|decoy, player (victim), from, seconds, points?, dir?, victim? }` (one
  player). emp: buttons swap places for seconds (5). inkbomb: ink for seconds (≤4), wiped with a finger. tractor:
  pulled for seconds; dir = where the puller is on the victim's screen, radians, 0 = right, π/2 = UP. mine: stunned
  seconds, points = points LOST (positive, 30). decoy: seconds 0: (no victim) "you shot <from>'s decoy";
  (victim set, player = from = owner) "your decoy fooled <victim>".
- `cooldown { player, verb, seconds }` (one player): that verb fired and is ready again in seconds.
- `toast` on death: `{ kind:"info", killer: name|null, text:"Destroyed by bob · back in 3 s" }`; nobody in reach:
  `{ kind:"info", verb, text:"EMP · no rival close enough" }`.
- tick: players[].flags += emp, inked, tractored, drawing (only when on); players[].bay [x,z] while landing /
  takingOff; `mines: [[id,x,y,z,mode,color]]`, `decoys: [[id,x,y,z,yaw,color,owner,mode]]` (mode 0 space, 1 planet:
  island x,z, feet y), newest 16 each. respawnIn while dead.
- fx kinds += emp, inkbomb, tractor, mine (dropped / hit), decoy (appears), respawn.
- announce lines: kill "bob ✕ ana" (+ " 💣"/" 🧲" for a mischief kill); mischief "⚡ bob scrambled ana's buttons",
  "🦑 bob inked ana's screen", "🧲 bob pulled ana in", "💣 ana hit bob's mine (-30)", "🎭 ana shot bob's decoy";
  steal "💰 bob stole 750 points from ana!"; round end "🏆 … wins round N with P points" (big).
- world.result `{ round, reason: "chests"|"time", winner, scores: [[name, score]] }`: winner = MOST POINTS (or null).
  Scores reset every round; leaderboard (stars) carries.
- verbs.js gains mine, tractor, emp, inkbomb, decoy (labels via Verbs.labelOf). Old trees lack them: guard lookups.
- Contract.COLORS has 25 colours on the new server.

## Shared rules
- SOUND: exactly ONE engine. render.js's exported `sfx` is the only entry point for both pages. The render agent
  makes it a facade over sfx.js (createSfx, loaded by dynamic import inside render.js) with render.js's own synth as
  the fallback only if sfx.js fails to load (404 on the old server). API stays: unlock(), play(name, opts) →
  bool, setMuted(bool), muted, unlocked, ready. Names pages may use: click, pop, unlock, hint (UI only).
  render.js (WorldSound) plays EVERY game sound: world fx (incl. emp/inkbomb/tractor/mine/decoy fx), start (lobby →
  playing), win (scoreboard), countdown, my own death and respawn (phone), my personal mischief hits (phone: from
  the mischief message; then the same-kind fx sound is skipped for 600 ms so nothing plays twice). Pages must NOT
  play start, win, countdown, death, mischief or world sounds (the phone page plays "start" in showGo and "win" in
  renderResults today: the phone agent removes those).
- render.js on the phone also filters `mischief` and `cooldown` to game.player (like toast) and emits them
  (game.on("mischief"), game.on("cooldown")). game.pause(bool) stops/resumes rendering (the phone pauses while the
  opaque draw screen is up). projectPlayers() items gain `bot` (bool) and `flags` (the tick flags object, read-only).
- STYLE: PLAN §0 "Style like Fortnite": chunky slanted panels, heavy condensed italic caps (Barlow Condensed 800/900
  italic), white text with a dark outline, blue/purple/gold accents, pop-ins. COPY: every screen answers "what do I do
  now?" in ≤ 2 short lines, plain verbs, no internal words (never verb/entity/slot/layout/assists/mischief). Every
  new string goes in the page's COPY table.
- PERF (hard, PLAN §4): phone ≤ 80 draw calls, ≤ 120k triangles, 60 fps target; TV budget at 25 players (1 human +
  24 bots): ≤ 120 draw calls, 60 fps on the laptop. No per-frame allocations in hot loops, no backdrop-filter over WebGL.
- z-order on the phone: #game canvas < #area (ink, sketch, controller frame / legacy hits, ghost) < name tags (z 1
  inside #play) < #hud (4) < tips/legend/banner/toast < sheets (8-9) < mischief overlays (mfx: emp 60 in its
  container, ink 9000 fixed) < death card. The ghost box must stay tappable above the controller frame.

## Agent: phone (controller.html, phone-extras.js, ctrl-sandbox.js, mischief-fx.js)
1. Join: device token (localStorage "sp.device", 16+ chars [A-Za-z0-9_-], made once) sent as `device` and `token`
   with every /join (incl. the refresh rejoin). renamed: true → keep going as the new name and show a clear toast
   ("ANA WAS TAKEN · YOU ARE ANA2"), COPY table.
2. Sol's controller in the sandbox (ctrl-sandbox.js; read its header): a container `#ctl` in #area covering the play
   area. On a successful controller/button /generate with `html`: mount (or destroy + remount when the allowed
   actions change) with allowedActions = requiredActions = the pad's actions (controls/padLayout), fallbackHtml =
   the same html, onPress/onRelease → sendInput, onAxis → sendAxis (force on 0,0). Adopt `padLayout` as S.layout
   (sketch/ghost placement, lock lists, layoutHas, legend). `generated` kind "html" for me → ctl.replace(html).
   No html (old server, SKIP / default buttons, reload) → POST /controller-html {player}; ok → mount its html and
   adopt its padLayout; 404/failure → the existing legacy DOM controls (ink + .hit boxes), unchanged. While the
   sandbox is mounted: #hits hidden and inert, #ink faint (≈0.2, or hidden if it clashes; your call, look at it).
   Locked skills: setDisabled(locked ∪ cooling actions) on every entity/cooldown change; onPress of a locked action
   → the existing lock tip above that control (rect from ctl.controls() fractions × #ctl rect); hold ≥ 450 ms → the
   existing "what it does" tip; legend after a new controller from controls() labels. Multi-touch is the kit's.
   Release everything (ctl.releaseAll / legacy releaseAll) on window blur, page hidden, landing/take-off lock, any
   sheet opening, death, round end. Dynamic-import ctrl-sandbox.js and mischief-fx.js with .catch (old servers 404
   them): never break the page.
3. Mischief on the phone (mischief-fx.js; read its header): game.on("mischief") for me →
   emp: MFX.emp(#ctl, seconds) (sandbox: the kit swaps; legacy DOM: use onSwap(permutation) to remap hit-testing so
   a touch triggers the action now SHOWN there); inkbomb: MFX.inkBomb(#play, {seconds}); tractor:
   MFX.tractorHit(#play, {by: from, dir: -dir}) (server π/2 = up, mfx π/2 = down); mine: MFX.mineHit(#play, {by:
   from, points: -abs(points||30), stunSeconds: seconds, shakeEl: #game}); decoy: victim ? decoyFooled(#play,{by:
   victim, mine:true, victim}) : decoyFooled(#play,{by: from}) (check the function's own arg meaning). Your own
   mischief: on `cooldown` grey that control with a countdown (setDisabled + a tip "EMP · READY IN 12 S" on press);
   on announce lines where you are the actor ("⚡ me scrambled bob…") a gold MFX.toast ("BOB'S BUTTONS
   SCRAMBLED!"). No sounds here (render.js plays them). Test hook: __spTest.mischief(msg) runs the same handler.
4. "drawing" input: sendInput("drawing", true) when a draw / add-a-button / explorer sheet opens while the round is
   playing (phase playing|assists), false when it closes (and on leaving play). Never leave it down.
5. Death: a big centre card while me.flags.dead: "DESTROYED!" + "BY BOB" (killer from the death toast's `killer`,
   else from an announce "bob ✕ me") + "BACK IN 3 · 2 · 1" from me.respawnIn + "-50"; fades out on respawn (a short
   "BACK IN THE FIGHT!" pop). Controls released while dead. Test hook __spTest.dead(killer, seconds).
6. Announcements on the phone: one short chip under the objective for 2.5 s for big moments (boss down, all powers
   on, a chest opened, a steal, my kill / my death, the round winner). Not every kill-feed line.
7. Cleanups from the v1.0 list: ghost box + sketch cleared at a new round; `pointercancel` releases only that pointer
   (legacy); pause the renderer while the opaque draw screen is up (S.game.pause(true/false)); the explorer prompt
   shows the PLANET budget; name tags: createNameTags({ max: 25 }) (the tv agent declutters them); remove the page's
   "start"/"win" sound plays (render.js plays them); radar: confirm ahead = up (phone-extras createRadar does
   y = c - dz·k; hud.radar dz > 0 = ahead) and leave a note.
8. COPY: review every phone string as a first-timer (two short lines, plain verbs). New strings in COPY.
Checks: check-syntax; a WebKit tour of: join → renamed toast; ship → controller → controller result → play with the
sandbox controller (template html from the stage server; press/hold tips; locked tip); a fake `generated` html
swap (__spTest or a real kind "html"); EMP / ink (wipe it) / tractor / mine / decoy (both variants) via
__spTest.mischief; death card; results. Two real humans on the stage server: a second player joined by API with a
mock ship (DEV_KIT space = emp + mine) fires `emp` at you → your phone scrambles. Screenshots in shots/phone/.

## Agent: render (render.js, sfx.js, inflate.js, anim.js, anims.js, transition.js)
1. Event stream URL: phone `/events?player=<encodeURIComponent(game.player)>` (reconnect on setPlayer with a new
   name), TV `/events?screen=big`. Filter `mischief`/`cooldown` to game.player on the phone and emit them.
2. ONE sound engine (see Shared rules): `sfx` facade over sfx.js (dynamic import inside render.js; render.js's own
   synth stays only as the fallback when that import fails). Map names: click→ui-tap, pop/hint→hint (or ui-tap),
   unlock→chest (or another sfx.js sound that reads as a reward), start→countdown-go, win→win, countdown→countdown,
   laser→laser, bossLaser→laser (rate ~0.6), explosion→explosion (size small/medium/large), explosionBig→
   explosion-large, hit, crack, drill, dig, land, takeoff, chest, scan, flare, boost, touch→land, emp, ink, tractor,
   mine, death, respawn, kill. pitch → rate. Mute + unlock keep working (iOS: unlocked in the first tap; pages
   already call unlock in a capture listener). WorldSound adds: fx emp/inkbomb/tractor/mine/decoy/respawn; my death
   (flags.dead edge for game.player on the phone) and respawn; my personal mischief hits (mischief message) with
   the 600 ms same-kind fx suppression; kill when an announce says "<me> ✕ …". No sound twice: verify by counting
   plays in a test (wrap play() and count per event).
3. Mischief in the world (readable on the TV and the phones): tick.mines → small spiky mines in the owner's colour
   with a blinking red light (instanced, ≤ 2 draw calls per scene); tick.decoys → a translucent flickering hologram
   copy of the owner's ship / explorer (their drawing when cached; ≤ 16; cheap), fading in/out; fx emp → cyan
   lightning ring burst; inkbomb → dark purple ink splash; tractor → cyan beam pulse; mine dropped → small pop;
   decoy → hologram shimmer burst. Flags while on: emp → crackling cyan sparks on that ship/explorer; inked → purple
   ink drips/smoke; tractored → a beam to the nearest other player within 160 m (the puller). Big and clear from the
   TV camera distance; cheap on the phone (reuse Particles / RingPool / StreakBatch).
4. TV camera director (CameraRig.pickFocus): humans first (players without flags.bot); bots only when no human is
   alive or present. Key events still win (a landing/take-off shot; the human digging/drilling a chest; the human
   closest to the boss when it is below 20 %). hud().followed never names a bot while a human plays.
5. Performance at 25 players (1 human + 24 bots, stage server, e2e or your own run with ?perf and perf.log): phone ≤ 80
   draw calls / ≤ 120k tris in every sample, TV ≤ 120 calls. Measure first (perf.log in the stage dir has calls/tris
   per sample), then cut: impostors for far ships, merge per-ship parts, shared materials, cap trails/names, etc.
   Report before/after numbers with times.
6. Quality governor: step down at p90 > 20 ms (was 18: 60 Hz screens sit at ~17-18.6 ms); do not step down when the
   frames sit at a steady 30 Hz cap (p10 ≥ 30 ms and p90 ≤ 36 ms with CPU work p90 < 8 ms: iOS Low Power Mode).
7. Parked ships show their owner's DRAWN ship: keep the last ship entity per player (entity messages of type ship,
   world.entities) separately from the current entity; ParkedShip uses island.parked[].image || that ship entity's
   image. Also check the boss-death flash: clamp its bloom/white so the screen never whites out for seconds.
8. game.pause(bool), projectPlayers() items gain bot + flags (see Shared rules). HUD_COPY: never give a button name
   away before the hints do ("CLOSE ENOUGH · PRESS LAND" → "CLOSE ENOUGH TO TOUCH DOWN", check every line).
Checks: node --check render.js sfx.js etc.; a render smoke in a browser on the stage (TV + phone, 24 bots) with
?perf; numbers before/after; screenshots of mines, decoys, emp/ink/tractor fx (two humans: the second joined by API
with a mock ship, DEV_KIT space = emp + mine; planet = inkbomb + tractor), TV following a human.

## Agent: tv (space.html, bigscreen-extras.js)
1. Join QR from GET /info: QR + text = controllerUrl (HTTPS when up), works when the TV is opened on localhost. ?join=
   still overrides. /info missing (old server) → today's logic. Show the address big enough to type.
2. Results (phase scoreboard): ONE winner = world.result.winner (most points), the same name in the podium, the
   title and any banner; nobody → "NOBODY SCORED". 25 rows fit at 1440x900 (also 1920x1080, 1280x720) with no
   overlap and no clipping (measure with getBoundingClientRect in a test: every row inside the viewport, no two rows
   intersecting, the banner hidden). Session leaderboard visible.
3. Kill feed: keep and show the mischief icons (⚡ EMP, 🦑 INK, 🧲 PULL, 💣 MINE, 🎭 DECOY, 💰 STEAL) as chunky
   coloured icon chips, names in their colours, "bob ✕ ana" with a clear KO mark. Readable from the sofa (≥ 22 px at
   1440x900). Max 5 lines. The assists rewrite stays.
4. Name tags for EVERY visible player in play (25), not the nearest 12: declutter (a tag that would overlap a nearer
   one shrinks or hides its name, keeps a dot); the phone uses the same createNameTags (max 25), keep it cheap (DOM
   transforms only, no layout thrash). Status chips on a tag from projectPlayers flags: ⚡ (emp), 🦑 (inked), 🧲
   (tractored), STUN. Lobby cards unchanged (but must not paint over the lobby text: check).
5. Death / respawn obvious: the followed player's panel shows "DESTROYED · BACK IN 3" big and red while dead; the kill
   feed line pops. The TV never shows private hints (the v1.2 server sends none to screen=big; with the old server
   drop hint texts that start with "Draw" (answers)).
6. TV copy review as a first-timer on the sofa (COPY table); the keyboard legend hidden unless H; "FOLLOWING <name>"
   readable.
Checks: check-syntax; Chromium 1440x900 screenshots via ?mock=results&players=25 (and 1920x1080, 1280x720) with the
overlap measurement; lobby with the QR from /info on the stage; play with 24 bots and the kill feed showing mischief
lines (two humans by API firing emp/mine, or inject announce lines with a test hook __bigscreen.feed(text)).
Screenshots in shots/tv/.
