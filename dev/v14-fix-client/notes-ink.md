# v1.4 client fix: ink bomb "WIPE IT!" cue, app icons, web manifest

Owner decision (PLAN.md section 0, 10 Oct 09:05): the ink stays until the player wipes it with a finger, with a
10 s automatic fade as a safety net.

## mischief-fx.js, inkBomb

`inkBomb(screenEl, { seconds = 10, seed, splats = 3, onClear, hint = true })` returns `{ done, cancel, coverage() }`,
the same handle as before.

- `seconds` now defaults to 10 (clamp 0.3..30 kept). It is only the safety net: the server sends `mischief.seconds = 10`.
- Drying: over the last `min(1.5 s, 30 % of seconds)` the root fades 1 to 0 (`cubic-bezier(.45,0,.75,1)`). The ink can
  still be wiped while it dries, and the cells keep blocking until `seconds`. At `seconds`: `mfx-off`,
  `onClear({ wiped: false, ms })`, root removed 40 ms later. With `seconds: 1` that is about 1.04 s, so the old
  v12 test bounds still hold (removed within 1.6 s, onClear.ms 900..1300).
- Wiped (coverage < 0.12): `onClear({ wiped: true, ms })`, then the 0.38 s fade as before. While drying it fades on from
  the current opacity, without jumping back to 1.
- The cue replaces the old "INK! / WIPE IT OFF WITH YOUR FINGER" toast, so there is one text only (`hint: false` turns
  the cue off). `.mfx-fill.mfx-ink-cue[data-ink-cue]`, the last child of the `[data-mfx="ink"]` root, centred,
  `pointer-events: none !important` on it and on all its children:
  - `.mfx-ink-cue-s` is the state scale wrapper, `.mfx-ink-cue-pop` the pop-in (0.42 s overshoot, 0.15 s delay).
  - `.mfx-ink-cue-k` is the gold "INK!" kicker. `.mfx-ink-cue-p` is "WIPE IT!" on a slanted violet plate with a gold
    border (`var(--f-head, Barlow Condensed...)` 900 italic, white, `-webkit-text-stroke .13em #120a2e` +
    `paint-order`), with a gentle 5 % pulse.
  - `.mfx-ink-trail` is a white/ink double arrow along the plate's bottom edge, pulsing in opacity. `.mfx-ink-hand` is
    an inline SVG pointing hand, fingertip on the arrow, swiping +-1.45em, 1.1 s each way.
  - Size: `clamp(34px, 11.5vmin, 68px)`, about 45 px on a 390x844 or 844x390 phone. The cue is about 4.7em wide and
    3.5em tall, so it fits both orientations.
  - First wipe (pointerdown on a cell): `.mfx-ink-wiping` on the cue. The hand fades out and pauses, the arrow hides,
    the label shrinks to 0.72. 1.8 s after the last finger lifts (`CUE_IDLE_MS`) the hand comes back.
  - Gone (`.mfx-ink-cue-out`: fades and shrinks to 0.5, removed after 260 ms) once coverage < 60 % of the starting
    coverage (`CUE_BELOW`), when the ink starts drying, or when it fades.
  - prefers-reduced-motion (`.mfx-rm` on the root): no pop, pulse or swipe. A static hand on a static double arrow, an
    opacity fade-in, and the shrink happens without a transition.
- `__test` gained `CUE_BELOW` and `DRY_MS`. Nothing else changed, and the other effects are untouched.
- Caller note (controller.html, not touched here): `MFX.inkBomb(host, { seconds: secs > 0 ? secs : 4 })` still passes
  4 when the message has no seconds. Switching it to 10, or passing `undefined`, matches the owner decision. The v12
  smoke test `t3-mischief.mjs` asserts `seconds === 4` for that call.

## Icons: dev/v14-fix-client/make-icons.mjs

Pure Node (fs, path, zlib, url), 207 lines, deterministic. It has an 8-bit RGB PNG encoder (filter 0 per row, zlib
level 9, CRC32), signed-distance shapes painted back to front, and 4x4 supersampling. Fully opaque. The rocket is
measured once, then fitted. After the main worker's review, the edge-on centre fin was dropped: it read as a stray
bar across the body. The rocket now has a white body, a red nose cone, a window, two red side fins, a violet nozzle
and a gold flame.

| file | size | bytes | rocket |
| --- | --- | --- | --- |
| icons/icon-180.png | 180x180 | 19017 | box 80 % of the side |
| icons/icon-192.png | 192x192 | 20526 | box 80 % |
| icons/icon-512.png | 512x512 | 60017 | box 80 % |
| icons/icon-maskable-512.png | 512x512 | 55137 | box 62 %, farthest pixel 40 % from the centre (safe circle) |

## controller.webmanifest (repo root)

`start_url /controller.html`, `scope /`, `display fullscreen`, `display_override [fullscreen, standalone]`, landscape,
theme and background `#0d0b2e`, and the four icons above as `/icons/...` (192 and 512 `any`, maskable 512
`maskable`, 180 with no purpose). It needs the server to send `application/manifest+json` and to serve
`/icons/*.png`. It also needs `<link rel="manifest">` and `<link rel="apple-touch-icon" href="icons/icon-180.png">`
in controller.html (main worker).
