# mischief-fx.js: v13-phone additions (implement-only round, not tested)

Existing exports unchanged (names, signatures, timings, DOM, `.mfx-toasts` class). Syntax check: `node dev/v11-client/check-syntax.mjs mischief-fx.js` → OK.

## New API
- `MFX.hitMarker(screenEl, { angle = null, strength = 1, seconds = 0.9 } = {})` → `{ done, cancel(), el }`
  - Where the hit came from. `angle` is in radians, heading-up compass: 0 = ahead (top edge), +PI/2 = right, ±PI = behind (bottom), -PI/2 = left.
    `null`, undefined, "" or not finite = direction unknown: a red inset vignette on every edge.
  - Red crescent (84 px across, 16 px thick, #ff8095→#ff3b5c, #120a2e outline, gloss line) with a faint red glow toward the edge. It sits where the
    ray at `angle` meets the ellipse inscribed in the safe area, 8 % in from its edges, and is rotated to point at the attacker.
  - `strength` 0..1: opacity 0.55..1, size 0.75..1. It pops in (scale .7→1.05→1 in 120 ms), holds, then fades out over `seconds` (0.2..10).
  - At most 4 crescents (the least recently hit goes). A hit within 25° of a live crescent, or a second unknown-direction hit while the vignette shows,
    restarts that one (new angle, max strength, a small bump, fade from the start) and returns its handle.
  - One fixed full-screen layer per host (`.mfx-hl`, z-index 8500). It is made on the first hit and kept, empty, for reuse. It has no `data-mfx`;
    each crescent or vignette has `data-mfx="hit"` and is removed when it ends.
- `MFX.shieldAura(screenEl, { on = true, label = "" } = {})` → `{ done, cancel(), el }`. One per host, idempotent.
  - on: a fixed cyan frame (`data-mfx="shield"`, z-index 8400): the inset glow from the brief with an opacity pulse, plus a faint masked hex band on the edges.
    A non-empty `label` adds a slanted cyan chip at the bottom centre (Barlow Condensed 900 italic 18 px, stroked).
  - on: true while shown changes only the label: a string replaces it, "" removes the chip, omitted keeps it. No restart.
    on: true while fading out cancels the fade and returns to full.
  - on: false fades everything out over 0.3 s and then removes it. It returns the fading handle, or `{ el: null }` if nothing was shown.
  - Suggested use: `shieldAura($("play"), { on: true, label: "SPAWN SHIELD" })` on respawn, then `shieldAura($("play"), { on: false })` when it ends.

## Other changes
- prefers-reduced-motion: no pop or bump on the markers, no pulses on the shield, a softer vignette.
- Effect texts now use the phone's heading style (`-webkit-text-stroke` #120a2e + `paint-order: stroke fill` + `0 2px 0` drop) instead of the
  4-way text-shadow outline: the EMP chip label, the toast title and subtitle (which cover the ink hint and the tractor, mine and decoy banners), and the DECOY! stamp.
  CSS only. The unused `TEXT_OUTLINE` constant was removed.
- `__test` also exports `hitSpot(angle, rx/ry)`, `angDiff`, `MAX_HITS`, `HIT_SAME`.

## z-index map (inside the host)
EMP 60 · shield 8400 · hit markers 8500 · tractor / mine / decoy 8800 · ink 9000 · toasts 9100 · (controller.html death card 9300 stays on top).

## Not done / for the test round
- Nothing has been run in a browser. Check on iOS Safari: `paint-order` on the crescent and on HTML text, the masked hex band, and the gradient `url(#id)` refs.
- controller.html does not call the two new exports yet (that is outside this file).
