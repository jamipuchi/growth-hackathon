# Render agent notes (v1.2 client track): done / left / how to resume

Owner: render agent. Files: render.js (+ sfx.js, inflate.js, anim.js, anims.js, transition.js untouched), dev/v12-client/render/**, shots/render/.
Last update 02:27. You can resume from this file alone.

## State in one paragraph
All code of the "Agent: render" list is in render.js and passes node --check, 85 sound / governor unit checks, 65 smoke checks of the new classes
against a local three.js, and 66 checks of the whole startGame() loop with a fake renderer (details below). NOTHING of it has been seen in a real
browser yet: browser launches have been broken machine-wide since ~02:13 (Chromium aborts with SIGABRT, no DNS, `id` fails). Pending: the
"after" perf numbers and the screenshots (mines, decoys, emp / ink / tractor fx and flags, TV following a human, boss-death flash).

## Commands (all from the repo root)
- `node --check render.js`
- `node dev/v12-client/render/unit.mjs`      85 checks: sound facade over the REAL sfx.js + fake AudioContext (one voice per event), fallback synth, governor (class Perf)
- `node dev/v12-client/render/node-smoke.mjs` 65 checks: the real render.js loaded in Node with a local three.js (r179 from another project's node_modules; THREE_ROOT=... overrides):
  MischiefLayer (mines, decoys, flags, fx, both phone and TV caps), Snapshots, CameraRig.pickFocus (humans first), HUD_COPY, LOD caps
- `node dev/v12-client/render/node-game.mjs`  66 checks: startGame() end to end with a fake renderer: stream URLs, mischief / cooldown / toast filters, pause, setPlayer
  reconnect, 30 frames over 25 ships + mines + decoys + flags in space and on the island, every fx kind in both worlds, followed never a bot
- Browser (when browsers work again; wait for the HOLD file, the wrapper takes `dev/v12-client/.browser-lock` and ALWAYS releases it):
  `dev/v12-client/render/locked.sh 470 node dev/v12-client/render/perf.mjs --label after`   (server on :8264 with 24 bots, TV Chromium + phone WebKit; compare with perf-before.json)
  `dev/v12-client/render/locked.sh 300 node dev/v12-client/render/diag.mjs --label after`   (draw calls per scene object)
  `... perf.mjs --label t0 --tier 0` pins the quality tier (bloom on = the most draw calls).
  Visual shots (mines, decoys, emp / ink / tractor, flags, TV following a human, boss death) still need a script: `shots.mjs` is NOT written yet (see "Left").

## Baseline: BEFORE any change (02:03, unchanged render.js, 24 bots + 2 humans, perf-before.json, diag-before.json)
| scene | TV 1440x900 (Chromium, 120 Hz screen, tier 0-1) | phone 844x390 @3x (WebKit, tier 1) |
| --- | --- | --- |
| lobby 8 s | 101 calls, 182k tris, 120 fps | 53 calls, 63k tris, 60 fps |
| cruise 12 s | avg 66, max 82 calls, max 172k tris | max 60 calls, 68k tris |
| boss fight 20 s (all 26 teleported to the boss) | avg 63, p95 109, MAX 115 calls, max 206k tris | max 58 calls, 70k tris, 1% low 40 fps |
| mischief 14 s (boss already dead) | max 37 calls | max 58 calls |
Where the calls go (diag-before): a default ship (A-009: ONE mesh, three materials) = 3 calls, 1328 tris: 24 bots = 72 calls in the TV lobby. Bloom + output
passes add 14 (TV) to 20-22 (phone) calls on top of the scene's own. The TV was 5 calls under its 120 budget in the boss fight; the phone had 20 spare.

## Done (render.js; every item of SPEC "Agent: render")
1. Event stream: phone `/events?player=<encodeURIComponent name>` (reconnects in setPlayer when the name changes), TV `/events?screen=big`. `mischief` / `cooldown`
   filtered to game.player and emitted (game.on). `announce` also reaches WorldSound. `_internals.handle(m)` injects a message (tests).
2. ONE sound engine: `sfx` (export, = game.sfx) is a facade over sfx.js by dynamic import; the old synth is `makeSynth()`, built ONLY when the import fails (no second engine,
   no listeners installed otherwise). API kept (unlock, play -> bool, setMuted, muted, unlocked, ready) + mute(), loop(), engine ("loading" | "sfx.js" | "synth").
   Name map in SFX_MAP: click -> ui-tap, pop / hint -> hint, unlock -> chest, start -> countdown-go, touch -> land (rate 1.15), bossLaser -> laser (rate 0.6),
   explosionBig -> explosion-large, zap -> emp, inkbomb -> ink; pitch -> rate; explosion has size small | medium | large.
   WorldSound plays EVERYTHING: world fx incl. emp / inkbomb / tractor / mine (dropped = soft tick, hit = the warning + boom) / decoy (scan chirp) / respawn;
   MY death and respawn from the flags.dead edge (phone only; my own respawn fx is skipped, a decoy running out is silent); MY kill from an announce "<me> ✕ ...";
   MY personal mischief hits from the `mischief` message with a 600 ms same-kind suppression in BOTH orders (mischief first or fx first: exactly one sound);
   pan by screen side from the camera. Counted in unit.mjs: every event = one voice.
3. Mischief in the world (class MischiefLayer, one per world): mines = ONE InstancedMesh (spiky ball, owner colour, ~80 tris each, <= 16) + glows in the scene's glow batch
   (danger halo of the trigger radius, body glow, blinking red light), pop-in; decoys = DecoyView per id: the owner's DRAWN ship / explorer from the DRAWN cache as a translucent additive
   hologram (flicker, glitch frames, glow behind, fade in 0.45 s / out 0.4 s), a plain stand-in without a drawing, meshes only for the 3 nearest (phone) / 8 (TV), the rest glow;
   flags: emp = cyan sparks + flickering halo + short jagged arcs; inked = purple drips / smoke in a NEW normal-blended particle batch (ink must read on the bright island too) + violet glow;
   tractored = a pulsing 5-segment beam from the nearest other player within 160 m (humans first) + glows + sparks flowing to the puller; no effects on dead or cloaked players;
   fx: emp = cyan ring + sparks + arcs, inkbomb = ink splash + ring, tractor = ring pulled INWARDS + converging sparks, mine dropped = small pop / hit = stun burst, decoy = shimmer + ring.
   All sizes scale with the camera distance (x1 .. x4) so they read from the TV. New draw calls: mines 1, ink 1 (only while particles live), decoy meshes (<= 3 / 8). RingPool +2 (space 10, island 6).
4. TV camera director (CameraRig.pickFocus, allocation-free now): humans first (flags.bot false); bots only when no human is in the round; a human who is down keeps the camera for the
   respawn; landing / take-off shot at once; the human digging OR drilling wins on the island; boss below 20 %: the human closest to the boss, cut allowed after 3 s (8 s otherwise).
   hud().followed never names a bot while a human plays (checked over 200 random frames).
5. Performance: TV mesh cap 16 ships (+ every human forced), 14 explorers, 10 parked; phone caps unchanged (8 / 8 / 6). Default ships past 70 m draw only their hull (the engine and trim
   materials are switched off: 3 calls -> 1; hysteresis 56 m). `entPlanLod` applies the cap on both screens. After-numbers: PENDING (browser).
6. Governor: step down at p90 > 20 ms (was 18), not on a steady 30 Hz cap (p10 >= 30, p90 <= 36, CPU p90 < 8 ms), step up at <= 18.8 ms + CPU < 12 ms for 5 s, never into a tier left < 20 s ago;
   `?tier=N` (or perf.pin) pins the tier (tests); the ?perf overlay says "30 Hz cap".
7. Parked ships: island.parked[].image first, else the LAST ship entity of that owner (entShips, kept apart from the current entity which is the explorer once landed). A screen that connects
   after they landed only has the drawing if the server sends it (`world.entities` carries the current entity only): server follow-up, see below. Boss-death flash: 90 + 40 puffs
   (was 160 + 80) at boost 1.9 (was 3), Particles fade near the camera, `space.flash` dims bloom by 65 % and exposure by 30 % for 2.5 s. NOT yet looked at in a browser.
8. game.pause(bool); projectPlayers items have bot + flags; HUD_COPY has no button names: landNow "CLOSE ENOUGH TO TOUCH DOWN", chests "FIND THE X" / "GET IT OPEN", noWeapon "YOUR SHIP HAS NO WEAPON
   YET", bossHp "... TAKE IT DOWN", waitStart "WAITING FOR THE HOST TO START". `armed` = shoot | blast (ships have no drill since v1.2; no drill-near-boss hint existed in render.js any more).

## Left (in order)
1. Browser (when it works again, max 3 tries ~5 min apart): perf.mjs --label after (TV <= 120 calls, phone <= 80 calls and <= 120k tris in EVERY sample), diag.mjs, then a `shots.mjs`:
   two humans on the hook server, ana (dev kit: emp + mine in space) mines and EMPs the phone player, screenshots of mines / flags / fx on the TV and the phone; decoys, inkbomb and tractor via
   `game._internals.handle({type:"tick"...})` injection (the dev kit has no decoy; planet = inkbomb + tractor needs boss kill + LAND via /__test/boss); the TV following a human; the
   boss-death flash (mean brightness of the canvas per frame after the kill must not stay near white for seconds).
2. If TV calls are still > 110 in the boss fight: lower the TV cap (16 -> 12) or the FAR_PARTS distance (70 -> 45); if the phone is > 70: decoy cap 3 -> 2.
3. Not done, optional: sample() still allocates per frame (25 player objects + bullet arrays): pool them if the phone shows GC hitches; loops (sfx.loop) for boost / drill / dig;
   look at the mine glow sizes and the ink colours on a real screen (they are first guesses: INK_DARK 0x6a22c8, INK_LIGHT 0xb454ff).

## For the other agents / the lead
- phone: `game.on("mischief")` / `game.on("cooldown")` exist and are already filtered to game.player (no sounds on the page: render.js plays them; do not play start / win / countdown /
  death / mischief on the page). `game.pause(true/false)` works. projectPlayers items: `bot`, `flags`. The stream is `?player=<name>`; call `game.setPlayer(newName)` after a rename.
- tv: same sfx facade, `game.projectPlayers()` items carry `bot` and `flags`; the camera follows humans first (name tags / "FOLLOWING" read `game.hud().followed`).
- server (follow-up, not mine): put the owner's ship drawing URL on `world.island.parked[].image`, or keep the last ship entity in `world.entities` for landed players, so a TV that connects
  after they landed shows the drawn parked ships; serve sfx.js, ctrl-sandbox.js, mischief-fx.js in server.js PUBLIC_FILES (the facade degrades to the old synth on a 404, with a console warning).
- test tools: THREE_ROOT for node-*.mjs defaults to /Users/jaumepuig/Documents/enginy-sales-video/node_modules/three (r179); any three >= r160 copy works (no GL needed).
