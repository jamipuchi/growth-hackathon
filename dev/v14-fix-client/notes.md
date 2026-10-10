# v14-fix-client: notes (implement-only round, 10 Oct, 09:32-)

Sub-notes: `notes-tv.md` (space.html, bigscreen-extras.js), `notes-ink.md` (mischief-fx.js ink, icons, manifest),
`notes-pe.md` (phone-extras.js components).

## controller.html

### 6 · More space for drawing
- `#draw` is now `#stage` (the paper, `flex: 1`) + `#drawRail` (`.rail`, 52 px: PHOTO/DRAW, UNDO, CLEAR, COLOR, DONE).
  Landscape: rail on the right edge; portrait: rail on the bottom edge. Padding is only the safe areas + 4 px.
  Estimated canvas share of the safe-area viewport: 844x390 landscape about 92% x 98%; 390x844 portrait about 98% x 92%.
- The instruction is `.dline`, one line over the paper's top edge: `#drawHeader` (icon, `#drawTitle` = step title,
  `#drawSub` = the step's hint, hidden in portrait, and a "?" chip) + `#useDefault` (short "SKIP", the full sentence in
  its aria-label and in the card) / `#drawCancel`. Tapping it toggles `#guide`, the example card (example image, hint,
  the controller line, the skip sentence, GOT IT). The card opens by itself the first time each step is drawn on this
  phone (`localStorage sp.guideSeen`). It covers only the paper; the line (z 9) and the rail stay usable, so
  `#useDefault` stays tappable for the e2e harness.
- `.dstat` (status + drawings-left counter) floats over the paper's bottom edge. While a finger draws, `#draw.inking`
  fades the line and the status to 18% and lets strokes pass under them (back 0.9 s after the finger lifts).
- `#padHint` now holds `#padHintBig` (DRAW YOUR SHIP HERE) and `#padHintLine` (the controller line or the hint).
- Pen colours (ship and explorer only): `#inkBtn` opens `#inkPick` (6 saturated pens, none light enough to be lost by
  an ink threshold). A stroke keeps its colour as `pts.c`; `drawStrokes(..., color = null)` draws each stroke in its
  own colour; the entity export uses `color: null`. The controller pad always draws dark ink (its export and white
  overlay are unchanged).
- Resize: unchanged mechanism (ResizeObserver on `#padWrap` -> `sizePad()`; strokes are pad fractions, so rotation and
  entering full screen keep them). The controller pad keeps `playAspect()`.
- Add-a-button: the top toolbar became `.addrail` (right edge, 52 px); a photo makes the preview fill the sheet
  (`#addCam.shot` shrinks the camera button and hides the hint).
- `@media (max-height: 380px)` compacts the rail so it fits Safari's landscape viewport with its bars (~300 px).

### 1 · Full screen
- `<link rel="manifest" href="controller.webmanifest">`, `<link rel="apple-touch-icon" href="icons/icon-180.png">`,
  `apple-mobile-web-app-title`; the existing capable / black-translucent / viewport-fit=cover tags kept.
- `#fsBtn` (join screen, top right) and `#tFull` (HUD tool, only when the API exists and full screen is off).
- The first JOIN tap calls `PE.Fullscreen.request()` synchronously inside the submit (user gesture), which also locks
  landscape where allowed. iPhone Safari (no API): `#fsBtn` opens the install hint; the hint also shows once by itself
  on the join screen (`sp.a2hsSeen`). Standalone: no button.
- `FS.onChange` -> `onResize()` so pads and the play area follow the new size.

### 2 · Countdown
- `syncCountdown(tick)` runs on every tick (all screens): phase "countdown" -> big number
  (`tick.countdown`, else `ceil(tick.clock)`), one beep per number; lobby/countdown -> playing -> GO!
  (`PE.createCountdown().go()`, else the old `#go`). `onPhase` no longer plays GO (it ran only from the HUD and only for
  lobby -> playing). Objective panel and timer hidden during the countdown.

### 3 · Ink
- `MFX.inkBomb(host, { seconds: m.seconds || 10 })` (the server's 10 s is the safety fade; was 4).

### 4 · Late hint
- `showToast` -> `lateHint(m)`: the server's late card (world.js / rules.js `lateHint`: hint toast with `late: true`,
  `step: 3`, `title` "DRAW A SHOVEL" / "DRAW A SHOVEL AND A DRILL" / "DRAW A DIG BUTTON", `parts`, `on`, `ghost`) shows
  `PE.createLateHint`: the title, the part sketch(es) side by side, one line (ON YOUR EXPLORER · THEN A DIG BUTTON), one
  tap: REDRAW MY SHIP / REDRAW MY EXPLORER (`startRedraw`), or DRAW THE BUTTON (`openAdd(ghost)`; the word comes from
  the server's title, e.g. BLAST). An older server: its ladder's answer step once assists are on. The ladder's answer
  before 3:00 stays the plain toast. Once per card and round, not with no drawing left, closes after 15 s and whenever a
  draw or add sheet opens. Nothing is unlocked.

### Review (read-only adversarial pass, 10:07) applied
- late card follows the server's `late: true` shape (title, both parts, the real weapon word); no card for pre-3:00
  ladder answers; closes on enterDraw/openAdd and after 15 s.
- the example card never covers a fresh photo (`showPhoto` closes it; the photo-first explorer path skips it).
- auto full screen only for `pointer: coarse` (not touch laptops); the iPhone hint only on the join screen before a
  name is saved, hidden by `show()` on any other screen; `#tFull` only in the lobby (5 tools in play).
- open, for render.js: GO! is silent after a countdown (WorldSound plays "start" only on lobby -> playing).

### Test hooks added
`__spTest.countdown(n)` (live ticks win), `__spTest.lateHint(gate, need, parts)` (the server's late shape), `__spTest.fullscreen()`, `__spTest.installHint()`.
