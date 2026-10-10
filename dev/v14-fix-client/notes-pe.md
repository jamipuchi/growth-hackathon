# phone-extras.js, v1.4 additions (sub-agent of v14-fix-client)

Only `phone-extras.js` was edited. Existing exports and their behaviour are unchanged (createVitals, createSketchHint,
createDrawCounter, createRadar, exampleSvg, SKETCHES, injectStyles); the new CSS is appended to the same `CSS` string,
under new `pe-` classes. Check: `node --check phone-extras.js` passes. Nothing was run in a browser.

## New exports

- `createCountdown(container = document.body, copy = { go: "GO!", sub: "" })` returns `{ show(n), go(), hide(), destroy() }`
  - `show(n)`: does nothing if n is the same as last time, so call it on every tick. Numbers are rounded up with Math.ceil.
    null, "" or NaN act like hide(). A new n pops in (scale 0.4 → 1.15 → 1 in about 350 ms), then shrinks and fades
    (holding at 35 % opacity) until the next number.
  - `go()`: a bigger gold "GO!" tilted -6deg that pops, fades out and hides itself after 1.1 s. Calling it again while it
    plays does nothing. Call it **once**, when the phase goes from countdown to playing.
  - `hide()`: fades out in 0.15 s and also cancels a GO! that is playing. **Do not call it on every playing tick** or GO! is
    cut off. Calling it when nothing is shown does nothing.
  - `copy.sub` (e.g. "GET READY") is a small line on a plate above the number. It is hidden while GO! plays.
- `partSketchSvg(name, { stroke = "#2a2a34", width = 4 } = {})` returns an SVG string. It is the same drawing as the faint
  hint sketch (same seed), drawn at full ink with inline attributes and viewBox `-4 -4 108 108`. It returns "" for names
  that are not drill / landing / shovel / gun.
- `createLateHint(container = document.body, { copy = { go: "DRAW IT NOW", later: "LATER" }, onAction, onLater })` returns
  `{ show({ title, sub, sketch, action, cta }), hide(), isOpen(), destroy() }`
  - Both buttons **hide the card first**, then call `onAction(action)` or `onLater()`. The card sits above the draw sheets
    (8/9), so it must close itself.
  - `show()` while the card is open updates only the parts that changed. It does not replay the pop, so calling it every
    tick is cheap.
  - The title, sub line and paper hide themselves when empty. An unknown `sketch` gives no paper.
  - Layout:
    - Portrait: a column (title, paper of min(46vw, 190px), sub line, full-width gold button 58 px, LATER 48 px).
    - Landscape (`orientation: landscape`): the paper (min(150px, 38vh)) on the left; title, sub line and
      [gold button | LATER] on the right. That is about 190 px tall at 844x390.
- `createInstallHint(container = document.body, { copy = { text: "For full screen: tap {share} Share, then Add to Home Screen", close: "Close" }, onClose })`
  returns `{ show(), hide(), destroy() }`
  - `{share}` becomes the inline iOS share icon. The text is built from text nodes, so copy cannot inject HTML.
    `copy.close` is the aria-label of the ✕.
  - ✕ (44 px) hides the card and calls `onClose()`. Calling hide() from code does not call onClose. The caller stores the
    "seen" flag.
- `Fullscreen` (frozen object):
  - `supported()`: false on iPhone/iPod. Otherwise true when the element has a request method, and
    fullscreenEnabled / webkitFullscreenEnabled allow it when the browser has them.
  - `active()`
  - `request(el = document.documentElement)` returns Promise<boolean> and never rejects. The request runs synchronously,
    so call it straight from the tap handler. If the argument is not an element (for example an Event), it uses
    documentElement. Prefixed requests wait up to 1.5 s for the change or error event. When fullscreen is on, it starts
    `lockLandscape()` and does not wait for it.
  - `exit()` returns Promise<void> and does nothing when not in fullscreen.
  - `standalone()`
  - `iosSafari()`: iPhone/iPod/iPad UA, or MacIntel with touch, AND Safari AND not CriOS/FxiOS/EdgiOS/OPiOS AND not
    standalone.
  - `lockLandscape()` returns Promise<boolean> (true when locked) and never rejects.
  - `onChange(cb)`: `cb(active)` runs once per real on/off change, even in browsers that fire both the prefixed and the
    plain event. Returns an unsubscribe function.

## Classes and z-indexes

| z | element | pointer events |
|---|---------|----------------|
| 20 | `.pe-late` overlay (`.pe-late-card`, `-t`, `-p`, `-s`, `-go`, `-ico`, `-gt`, `-later`) | card only |
| 30 | `.pe-cd` (`.pe-cd-sub`, `.pe-cd-n`, `.pe-cd-n.pe-cd-go`, state `.pe-on` / `.pe-cd-going`) | none |
| 35 | `.pe-inst` (`.pe-inst-txt`, `-share`, `-x`, `-xi`) | itself |

All three are `position: fixed`, so append them to `document.body` or a container that is not transformed. `#rotate` in
controller.html is also at z 30; the countdown appended later will paint over it. Reduced motion turns off the
countdown's scaling, the card pop and the install slide; they just show and hide. Keyframes: `pe-cd-pop`, `pe-cd-go`,
`pe-pop`, `pe-inst-in`.
