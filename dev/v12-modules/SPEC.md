# v1.2 / v1.3 standalone modules: shared interfaces

Look: PLAN.md section 0 "Style like Fortnite" (bold, chunky, slanted tiles in rarity colours, heavy condensed
capitals in white with a dark outline, pop-ins and bounces). It replaced the thin-line HUD direction on 9 October;
the controller template, the Sol prompt and the mischief toasts follow it. The controller frame cannot load web fonts
(CSP), so it uses the condensed heavy faces every iPhone has (Futura Condensed ExtraBold, Avenir Next Condensed).

Four new files at the repo root, wired later by the v1.2 (Sol writes the controller as HTML) and v1.3 (mischief)
tracks. Nothing here edits an existing file.

| File | Kind | What |
| --- | --- | --- |
| `astra-html.js` | CommonJS, server | `generateControllerHtml({ image, layout, allowedActions, style })`: one Sol call → validated controller HTML, else a deterministic template with the same look |
| `ctrl-sandbox.js` | ES module, browser | `mountController(container, html, opts)`: runs controller HTML in `<iframe sandbox="allow-scripts">` with a strict CSP, injects the bridge + input kit, validates every message |
| `mischief-fx.js` | ES module, phone | `emp`, `inkBomb`, `tractorHit`, `mineHit`, `decoyFooled`, `toast` |
| `sfx.js` | ES module, browser | `createSfx()` → `play(name, { pan, volume })`, WebAudio, no files |

## 1. Controller markup contract ("kit v1")

Both the Sol HTML and the template use declarative markup; the kit that `ctrl-sandbox.js` injects into the frame
does all input handling (multi-touch pointer events, hit areas of at least 56 CSS px, sticks, toggles, pressed
states). The controller HTML never writes its own touch handlers.

- Button: any element with `data-action="<action>"`, e.g. `<button data-action="shoot" data-label="FIRE">`.
- Toggle: add the `data-toggle` attribute. A tap flips it: on → press, off → release.
- Stick: an element with `data-stick="steer"` or `data-stick="move"`, with one child marked `data-knob`. The kit
  moves the knob (`translate`, px) and sets `--x` and `--y` (-1..1, y up = +1) on the stick element.
- Label: `data-label`, else the element's text.
- States set by the kit: `.is-down` (button held, stick dragged), `.is-on` (toggle on), `.is-disabled` (the parent
  greyed it: the entity lacks that skill; presses still go through so the server can explain), `html.is-emp`
  while an EMP scramble runs.
- Hit testing is geometric: each control's hit rectangle is its rendered box grown to at least 56 × 56 px plus
  6 px of slop; the smallest containing rectangle wins. Sliding off a button releases it; a stick keeps its
  finger until it lifts.
- Inside the frame: `window.game = { press(action), release(action), axis(name, x, y) }` (frozen). Messages go to
  the parent with `postMessage`; nothing else leaves the frame.

## 2. Frame ↔ parent messages

Frame → parent (`{ ch: <mount nonce>, type, ... }`), validated by the parent: `event.source` is this frame,
`event.origin === "null"`, known type, action ∈ allowedActions, axis values clamped to -1..1, at most `rate`
(60) messages per second per control (presses over budget are dropped, releases always pass, the latest axis
value is delivered at the next slot so a stick always comes back to 0).

| type | fields |
| --- | --- |
| `ready` | `controls: [{ action, kind: "button"\|"stick"\|"toggle", label, x, y, w, h }]` (fractions of the frame), `cleared` (covers made transparent); sent once finite animations settle (≤ 1.2 s), again on any structural change |
| `press` / `release` | `action` |
| `axis` | `axis: "steer"\|"move"`, `x`, `y` |
| `fxdone` | `kind` |

Parent → frame: `{ ch, type: "reset" }` (release everything), `{ ch, type: "disabled", actions: [...] }`,
`{ ch, type: "fx", kind: "emp", seconds, seed }`.

## 3. Module APIs (see each file's header for the full contract)

```js
// astra-html.js (server)
const { generateControllerHtml, templateHtml, validateHtml } = require("./astra-html.js");
await generateControllerHtml({ image, layout, allowedActions, style: { accent }, signal, timeoutMs })
//  → { ok: true, html, controls: [{ action, kind, label }], source: "model"|"template", ms, error? }

// ctrl-sandbox.js (browser)
import { mountController } from "./ctrl-sandbox.js";
const ctl = mountController(container, html, { allowedActions, onPress, onRelease, onAxis, onReady, onViolation, fallbackHtml });
ctl.fx("emp", { seconds: 5 }); ctl.setDisabled(["drill"]); ctl.releaseAll(); ctl.destroy();
await ctl.replace(solHtml);   // template now, Sol's HTML when it arrives: loads hidden, swaps when no finger is down
// mountController also adds <meta http-equiv="Content-Security-Policy" content="frame-src 'none'"> to the page
// (opt out: { pageCsp: false }): the only request a sandboxed frame's own CSP cannot stop is navigating itself.

// mischief-fx.js (phone)
import { emp, inkBomb, tractorHit, mineHit, decoyFooled, toast } from "./mischief-fx.js";
emp(controllerEl, 5);  inkBomb(screenEl, { seconds: 4 });   // ink shows "INK! WIPE IT OFF WITH YOUR FINGER" itself  tractorHit(screenEl, { by });  mineHit(screenEl, { by });  decoyFooled(screenEl, { by });

// sfx.js (browser)
import { createSfx } from "./sfx.js";
const sfx = createSfx();  sfx.play("laser", { pan: -0.3, volume: 0.8 });  sfx.setVolume(0.7);
```
