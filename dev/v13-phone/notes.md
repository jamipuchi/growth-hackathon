# v13-phone notes (Oct 10 morning, implement-only round)

Files: controller.html (me), mischief-fx.js (sub-agent, see notes-mfx.md), phone-extras.js (sub-agent, see notes-pe.md).
ctrl-sandbox.js unchanged: its kit already does multi-touch, 56 px hit areas, release on hide, fade between documents.

## Entity steps traced (step 0)
join -> enterDraw("ship") "1 · DRAW YOUR SHIP" (photo default, DRAW toggle) -> photo: analysePhoto(file, { turn: false }) (only controller
photos turn landscape now; a nose-up rocket used to be turned 270° and flew backwards) -> speculative POST /generate kind "ship" ->
DONE / USE THIS PHOTO -> commit(): waits for the early answer (#gen: the drawing on a card + "Your drawing is becoming a 3D ship") ->
wrong kind -> #wrong (REDRAW free / USE IT ANYWAY = anyway: true) | blank -> #gen failure (DRAW IT AGAIN, free) | ok -> showResult:
unlock card (chips = innate + unlocked with parts; "🔒 DRAW IT TO UNLOCK" up to 3 locked skills with V.PARTS), 3D turntable
(render.js createEntityPreview, show({ image, kind: entity.type, color })), REDRAW SHIP · uses 1 drawing + "4 OF 5 DRAWINGS LEFT" ->
NEXT: DRAW YOUR CONTROLLER -> enterDraw("controller") -> result with every control labelled -> PLAY -> wait banner.
Planet: touchdown -> #explorer prompt -> enterDraw("explorer") -> same path (wire "explorer", kind = entity.type for the preview) ->
NEXT -> #ctrlPrompt when the explorer unlocked skills with no button -> enterDraw("planetController") -> result -> back to the game.

## Failure words
post() aborts after 15 s (speculative 12 s): "client timeout" / "network" -> COPY.errors.slow / offline. Otherwise the server's own
`message` (server.js plainMessage) is shown. failureKind(): none (no drawings left: BACK TO THE GAME), redo (the drawing could not be
read: DRAW IT AGAIN, opens the camera in photo mode), retry (TRY AGAIN resends). Every failure says "This did not use a drawing".

## New messages used (contract.js v1.3 from the server lane)
- `hit { player, from, amount, dir? }` -> onHit: dir (0 = right, PI/2 = up) -> heading-up angle PI/2 - dir -> MFX.hitMarker; without dir
  the radar bearing of the boss / nearest rival. Older servers: an hp drop triggers the radar guess (off once a hit message is seen).
- `entity.card` -> the unlock card's data-text / aria-label.
- `flags.spawnShield` -> MFX.shieldAura(#play, { on, label }) or #play.spawn.
- 409 from POST /input -> rejoinSoon() (same name + device token).

## Hooks kept (and new)
window.__sp, window.__spTest (drawSample, looksLike, mischief, announce, cooldown, dead, html, ctl, go); e2e selectors #name,
#joinForm button, #useDefault (ship step -> play), #readyBtn, #explorer, #expDefault. New: __spTest.hit(dir, amount, from),
spawnShield(on), toolCaps(), go("gen" | "genError"). Testing-round tour: dev/v13-phone/tour.mjs (not run in this round).

## ctrl-sandbox.js (kit)
mountController(..., { momentaryActions }): a data-toggle bound to one of them fires press + release (120 ms) per tap and never
latches; the page passes every non-hold verb of the pad. The kit's releaseAll also turns latched switches off (no lost tap after a reset).

## Review (read-only agent, 09:18) and fixes
1 boss-kill lines of the v1.3 server ("destroyed the boss", "stole the boss from X") matched; 2 "🔧 X rebuilt their ship" matched;
3 one-shot switches fixed in the kit (above); 4 a switch tap hides its hold tip; 5 CANCEL during an add applies the late answer
(the server spent the drawing); 6 enterDraw closes the add sheet; 7 no "did not use a drawing" after a phone timeout / lost connection;
8 coloured pens compared with the paper's own brightness (coloured paper is not ink), "touches the edge" only for thin strokes that ran
off; 9 the renderer starts under the current name; 10 the plain spawn frame never sticks.

## For the other lanes (also in the report's followups)
- v13-tv: the phone's steps read "1 · DRAW YOUR SHIP", "2 · DRAW YOUR CONTROLLER" (space.html COPY.lobby.steps still says
  "DRAW YOUR SPACESHIP").
- v13-world: keep render.js handle() `default: emit(m.type, m)` (the phone listens to "hit"), and createEntityPreview().show() → { ok }.
- v13-server: the phone shows /generate `message` verbatim and branches on `error`: "no drawings left" (back to the game),
  "name taken" (pick a new name), "join first" (rejoin), nothing to read / no controls found / unreadable button / region too small /
  no skill called / looks like… (draw it again), anything else (try again). Announce lines matched: "X ✕ Y", "… X landed the last hit on
  the boss", "🔧 X wrecked Y's ship (+N)", "… Y's ship was wrecked", "X rebuilt their ship", "… X stole N points from Y",
  "… X opened a chest (+N)". The wreck toast gets a REDRAW SHIP button when verb is "takeoff" or its text says "wrecked your" /
  "draw a new ship". /generate bodies now carry `device` (the phone's token).
