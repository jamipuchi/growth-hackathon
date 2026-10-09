# phone agent: notes (v1.1 client track)

Owner of: controller.html, phone-extras.js. Can be cut off any time: read this first.

## Status (00:50)
- [x] phone-extras.js rewritten (Fortnite vitals, counter, sketches incl. "gun", createRadar, exampleSvg). Backward compatible:
      injectStyles, createVitals(container, copy?), createSketchHint, createDrawCounter(container, copy?), SKETCHES; new:
      createRadar(canvas, {size, range}), exampleSvg(kind, labels). All strings come in through `copy`.
- [x] controller.html rewritten and INSTALLED in the repo (2538 lines). `node dev/v11-client/check-syntax.mjs controller.html
      phone-extras.js` is OK. One module script, `const COPY = {...}` at line ~690 (top of the script, every player-facing string).
- [x] Fake-DOM smoke tests (Node only, no browser, no server) in /tmp/phone-build/smoke (t2 flows, t3 flows, t4 photo + ink
      regions): join → ship → unlock card → controller → wait → GO → results, wrong-drawing dialog (both ways), locked tips, hold
      tooltips, explorer prompt, planet controller prompt, add-a-button, redraw menu, sound, `__spTest.go()` for every screen.
- [ ] NOT verified on a real browser: every pixel of layout and CSS (see "Check visually" below). The harness agent takes the
      WebKit screenshots; the lead sends fixes.

## Screens and ids (SPEC section 9, all implemented)
- join: `#join`, `#name`, `#joinForm button` (exactly one button in the form), steps strip. `__sp.step` "join".
- draw screen `#draw[data-kind=ship|controller|explorer|planetController]` (step "ship" | "controller" | "explorer" |
  "planetController"): `#drawHeader` (text = "STEP 1 OF 2 · DRAW YOUR SPACESHIP — it becomes your 3D ship" etc.), `#example`
  (inline SVG), `#modePhoto` / `#modeDraw`, `#camInput` (+ `#camInput2` retake, `#camUse`, `#camRotate`), pad `#drawPad`,
  `#undo` `#clear` `#done`, `#useDefault` (skip; hidden during a redraw), `#drawCancel` (only during a redraw), counter `#drawCount`.
- `#gen` (reading… / error with `#genRetry` `#genBack`), `#wrong` (`#wrongRedraw`, `#wrongUse`).
- `#result[data-kind=ship|explorer|controller|planetController][data-group=entity|controller]`: steps "shipResult",
  "explorerResult", "controllerResult" (both controller kinds). `#previewCanvas` (render.js createEntityPreview) with a flat spinning
  card fallback, `#unlockCard` (+ `data-text` = "Your ship can: fly, shoot (cannon), boost (flames)"), `#unlockTip`, `#ctrlPreview`
  (+ `#ctrlList`), `#resultNext`, `#resultRedraw`, `#resultCount`.
- play: `#play`, `#banner` (`#readyBtn`, `#redrawShip`, `#redrawCtrl`), `#go`, HUD (`#vitals`, `#obj`, `#status`, `#clock`, `#timer`,
  `#radar`, tools `#tAdd` `#tRedraw` `#tView` `#tTilt` `#tSound`), `#tip`, `#legend`, `#toast` (`#toastAct`), `#redrawMenu`,
  `#add` (add-a-button, as before, restyled), `#resultsSheet` (step "results").
- planet: `#explorer` (class hidden when closed; `#expPhoto` `#expDraw` `#expDefault`), `#ctrlPrompt` (`#ctrlKeep` `#ctrlRedraw`).
- `__sp` = state: `.screen` join|draw|play, `.step`, `.player`, `.entity` (server's latest for me), `.layout`, `.drawn.ship|explorer`.
- `__spTest.drawSample("ship"|"controller"|"car"|"astronaut")`, `.looksLike("controller"|"entity")` (next generate answer),
  `.go(step)` (extra, for screenshots): join, ship, controller, explorerDraw, planetController, shipResult, explorerResult,
  controllerResult, wrong, wait|play, explorer, ctrlPrompt, results.

## Decisions (so a successor does not re-derive them)
- Wrong drawing: the free speculative answer is checked when the player taps DONE / USE THIS PHOTO (a small status line warns
  earlier: "Hmm, that looks like a controller, not a ship"). REDRAW clears; USE IT ANYWAY re-sends with `anyway:true`.
  Also handled: `{ok:false, looksLike:"nothing"}` (blank page, free) → "Nothing to read there…".
- Photo mode is the default; the controller drawing pad is letterboxed to the PLAY AREA's aspect so nothing is stretched later.
  Controller draw mode needs landscape (rotate overlay); ship / explorer draw mode does not.
- inkRegions: sent with every controller / button /generate (connected blobs, `round` = closed ring in every direction), tested.
- Locked controls: dimmed + lock badge; pressing shows `#tip` "🔒 BOOST · draw an exhaust with fire on your ship" and drops the
  server's own refused toast for that verb for 5 s. The input is STILL sent (the server stays the authority).
- Hold tooltips only the first 3 times per control (steering would otherwise show one every time).
- hud().radar is heading-up (+dz = ahead): the radar draws ahead = up (the old phone radar had it upside down).
- Result sheet right column scrolls (`data-scroll`) if it ever overflows; with more than 5 skills the chips get smaller and drop
  the part names (the dev kit unlocks 7).
- The lobby hides the add and redraw tools (the banner has its own REDRAW buttons).
- No backdrop-filter anywhere (slow over WebGL on iPhone). The preview renderer is created lazily, ONE for the whole session,
  `setVisible(false)` + `clear()` whenever the result sheet closes.

## Check visually (not verified, no browser allowed for me)
- 844x390: draw screen guide column (example + hint + skip must all fit, example shrinks first), result sheet right column with
  8 chips, wait banner vs tools, HUD centre column vs toast (toast top = safe top + 124 px), explorer sheet.
- 390x844: draw header wraps to 2 lines and the PHOTO | DRAW toggle sits on its own row; result stage 270 px.
- Fonts: Barlow Condensed from Google Fonts needs internet on the phone; fallback is Avenir Next Condensed (iOS has it).
- `paint-order` + `-webkit-text-stroke` outlines on headings (WebKit supports it; if the outline looks thin, raise the stroke px).

## Needs from others
- render.js: `createEntityPreview` and `sfx` (guarded: without them the flat card and silence are used), `hud().left/leftText/result/
  me.entity` (already there), `game.pause` is called if it exists.
- server: nothing required. astra.js already answers wrong kinds with looksLike (handled) and honours `anyway:true`.

## How to resume
controller.html is the source of truth now (edit it directly; keep `const COPY` the only place with player-facing words).
Sections (grep the `// ====` banners): COPY, helpers/state/sound/network, screens + join, sketch pads, ink regions, photo pipeline,
generation, drawing steps (KINDS, DR, commit), result sheets (preview, unlock card, locks, controller preview), budget, controls
(hits, tips, legend), play screen + HUD + phases + results, toasts + sketches + ghost, add-a-button, redraw menu, tilt/view/sound,
explorer prompt, lifecycle, test hooks, start.
The scratch workflow (optional, may be gone): /tmp/phone-build/parts/*.{html,css,js} → ./build.sh [install] assembles, runs
check-syntax and the fake-DOM tests (/tmp/phone-build/smoke/t2..t4c.mjs, dom.mjs, env.mjs), then copies to the repo.
