# v13-world lead notes (render side)

Round: IMPLEMENT ONLY (CONTRACT 08:50): only `node --check` per edited file; nothing run in a browser.

## Task 0: drawn entity pipeline (traced end to end, lead)
Path: server `entity` {player, entity:{type, rig, verbs, anims, image:"/drawings/<p>-<ship|explorer>.png?v=<hash>"}}
-> render.js handle() case "entity" -> entNote() (entities + entShips / entPlanet by family) -> views:
ShipView / ParkedShip (ShipModel.sync: entity.type==="ship" && image) and ExplorerView.sync (planet types) -> DrawnClaim ->
DrawnCache (one fetch+inflate per frame, LRU, phone 16 / TV 40) -> inflate.js inflateDrawing(img, {kind, quality, color}) ->
instance({color}) -> view.use(model) -> anim.js createAnimator(entRig[type]) (bike -> car rig) -> per-frame animate/LOD.
Fixed:
- inflate.js: a person is now 1.8 m TALL (was: longest side 1.8 m, so a drawing with spread arms became a ~1.2 m child);
  width capped at 1.6 x height. Car 2.8 -> 4.0 m, bike 1.9 -> 2.0 m (brief: car ~4 m). Body tint 38% -> 46% player colour.
- render.js: entSize / entShield / entMarkY for the 4 m car; the procedural toy car scales to 4 m (wheel radius too: spin).
- render.js ParkedShip.entityFor(q, p): a screen that connected / reloaded after a player landed now asks the server's fixed
  path /drawings/<name>-ship.png (unversioned) when no ship entity was seen (not for bots); 404 x3 -> default ship.
  Server follow-up (v13-server): put `image` on world.island.parked[] entries so no guess is needed.
- rigs.js untouched (a bike template would break dev/astra/vocab-test.js "10 rig types"; bike uses the car rig).
Checked OK: ship faces -Z with the drawing on top, person faces -Z (drawing = front), side kinds show the drawing on the right
flank with the nose at -Z; default A-009 ship only while no drawing (3 s wait, failed -> default); animator dispose restores children.

## Task 4: sound (lead)
- sfx.js: new "steal" (swipe + coin pings + falling bwoop) and "hitmark" (crisp confirm tick); LEVEL/VARY/ORDER entries.
- render.js WorldSound: held loops (LOOP_KINDS: boost = subject only, drill/dig = nearest player doing it; the server sends no
  drill/dig fx, so these loops are their only sound), started after LOOP_HOLD_MS = 300 ms of holding (a tap = the one-shot
  whoosh only, so dev/v12-client/render/unit.mjs "boost on: one boost" still holds), re-aimed every 100 ms, renewed every 24 s,
  hush() on reset / game.pause(true) / hidden tab; hit-confirm tick ("hitmark") when a hit/spark/explode lands just AHEAD of
  where MY bullet was last drawn, within its line (myShots ring of 24 with the bullet's direction from sample() b[6..8]; a
  bullet seen once has no direction and never counts); a hit ON me (phone, fx within 4 m) = heavy close thump; boss hit = deep
  clang heard from 150 m; steal sting for the thief (after the kill sting) / the victim (lower) / the TV, from the announce
  text; the winner's phone gets the fanfare at full volume, other phones softer (one sound either way).
- inflate.js quality "lite" (2.6k tris, same 384 px texture) for the phone's GAME view (DrawnCache.configure(phone)): up to 8 ships
  + 8 explorers + 6 parked drawings at 4k each was ~88k tris on its own (budget 120k with the world); now ~57k worst case. The phone's
  preview card (createEntityPreview) keeps "phone" (4k).
- Fallback synth (sfx.js missing) maps steal -> chest 0.8, hitmark -> click 1.6.

## Review round 1 (09:21, read-only reviewer on lead + assets + cine): no runtime exceptions found. Fixed by the lead:
- hitmark: reach 28 m + r in both worlds (bullets 140 m/s everywhere); rock chips (size 1) allow 11 m off-line; heals excluded.
- fx "hit" by colour: green 0x4ade80 = heal → soft shimmer (respawn, pitch 1.4); red 0xef4444 (space) = boss clang; orange = hits.
- CameraRig.wall starts at performance.now()/1000 (moments noted before the first frame are stamped in the frame clock).
- Director: boss-hit moments rotate at CUT_SECONDS (8 s) per hitter, the focus's own boss hits stop holding after 8 s.
- Held loops hushed on webglcontextlost too.
- Sky variant: TV only (phone keeps the bright sky: no 2048 px decode mid-fight), hysteresis 0.75 / 1.6 x radius, >= 20 s apart.
- A-002 foreground rocks keep hull + radius + 240 m from the boss (the dogfight zone; opaque rocks without collision).
- setBoss death puffs x0.33 when A-010 is loaded (its explode chain draws the blast); TV one-time recompile once A-010's lights exist.

## Review round 2 (09:27, read-only reviewer on the fx regions): no crash / API / GLSL errors. Fixed by the lead:
- WorldFx: BOTH worlds' A-010 systems are updated every frame (the frame loop updates the hidden one), so effects spawned into a
  hidden scene age instead of all playing at its first view; the stale-drop rule is now a > 2 s gap (pause / hidden tab) only, so a
  single long frame no longer wipes the visible world's effects and the boss chain.
- WorldFx.shield: scale-change respawn checked every 16 frames (no respawn + fade-in restart every frame during a pop-in);
  setPosition only after a 2 cm move (A-010 allocates per call: the lobby bob of 25 shielded ships).
- WorldFx.clear keeps the TV's flare light in the light count (no recompile after a round reset).
