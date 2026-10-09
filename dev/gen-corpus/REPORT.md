# Generation quality: corpus, live scorecard, fixes (v1-gen-quality, 9–10 October)

The owner hit "UNREADABLE BUTTON · TRY AGAIN" and a spaceship read as one giant `fly` button. This folder is the test bed:
103 drawings with ground truth, run live through `astra.generate` (gpt-6.1-sol, ultrafast, reasoning effort low), and
the recorded answers as offline fixtures.

## Corpus (`node dev/gen-corpus/build.mjs`, ~7 s, one headless Chromium)
Every drawing is made of hand-drawn strokes (`lib/hand.js`: single-stroke font in caps and lowercase, smooth hand wobble,
sticks, D-pads, arrows, boxes, circles, icons, ships, astronauts, robots, cars, bikes, dogs, blobs, snakes, parts) and goes
through **the phone's own code**, cut verbatim out of `controller.html` at build time: `strokesPNG` for finger drawings
(whole pad for controllers, cropped for buttons and entities) and `analysePhoto` + `renderPhoto` for notebook photos
(`lib/photo.js`: ruled, squared or plain paper, pen / marker / pencil, rotation, keystone perspective, shadow gradient,
a thumb at the edge, noise, blur, JPEG). Ground-truth rectangles follow the same chain (units → page → homography →
crop → 512 px). Contact sheets: `sheets/*.png`; raw simulated photos: `photos/*.jpg`.

| set | cases | what |
|---|---|---|
| `controller/` | C01–C34 | 20 finger drawings + 14 notebook photos: knob sticks, D-pads, loose arrow clusters, two sticks, single arrows, 1–8 buttons, caps / lowercase / mixed labels, icon-only, icon + word, words under shapes, a word with an arrow to its circle, crossed-out buttons, a drawn switch, tiny far-apart controls, very messy writing, planet controllers |
| `button/` | B01–B19 | one added button: word in box / circle / none, icon only (drill, shovel, parachute, crosshair), icon + word, messy, 6 photos, and B18–B19: **a photo of the whole page** with the new button drawn next to the old controller |
| `entity/` | E01–E35 | 16 ships (plain, flames, cannon, legs, nose drill, bubble shield, antenna, lamp, red cross, bomb, saucer, rocket, chunky) and 19 explorers (astronaut + shovel / hand drill / blaster / jetpack / torch / shield, robot, car ± cannon / drill, bike ± lamp, dog ± claws, blob, snake); 7 photos |
| `wrong/` | W01–W13 | entity in the controller step (6), entity as an added button (2), controller in the ship / explorer step (5) |
| `real/` | R01–R02 | the owner's two real failures (ship in the controller step; figure drawn as a button) |

## Scorecard (live, `node dev/gen-corpus/score.js --label <run>`)

| metric | before (86) | after (101) | confirm (14) | pad (8) |
|---|---|---|---|---|
| cases passed | 76/86 | 99/101 | 14/14 | 8/8 |
| controls found, clean (≥95%) | 100 | 100 | - | - |
| controls found, photo (≥85%) | 98.1 | 86.8 ¹ | 100 | - |
| kinds right (stick vs button) | 100 | 100 | 100 | 100 |
| labels → right verb (≥95%) | 96.5 | 95.1 ¹ | 100 | 100 |
| added buttons right | 82.4 | 100 | - | 100 |
| rectangles IoU ≥ 0.5 | 100 | 100 | 100 | - |
| invented controls | 2 | 0 | 0 | 0 |
| crossed-out returned | 2 | 0 | 0 | 0 |
| entity type (≥90%) | 100 | 100 | - | - |
| unlocked verbs (≥85%) | 89.7 | 100 | - | - |
| gate verb missing | 1 | 0 | 0 | 0 |
| spurious unlocks | 13 | 5 ² | 0 | 0 |
| wrong kind caught (≥90%) | 0 ³ | 100 (15/15) | - | - |
| false wrong-kind alarms | 0 | 0 | 0 | 0 |
| fallbacks (default/devkit) | 0 | 2 ¹ | 0 | 0 |
| errors | 1 | 0 | 0 | 0 |
| latency p50 ms | 1665 | 1532 | 1498 | 1421 |
| latency p90 ms (≤2500) | 2368 | 1972 | 1766 | 1511 |

- **before**: astra.js as committed in 7f895ea (copy in `baseline/astra-before.js`) with the owner's hotfix env
  `OPENAI_REASONING_EFFORT=low`. ³ The 15 wrong-kind cases were not called: the old code has no wrong-kind answer, so 0%
  by construction (R01 is the owner's logged `fly` button).
- **after**: the new astra.js on all 101 cases (fixtures in `fixtures/after/`). ¹ C21 and C24 were two calls that hung
  past the 4 s timeout at the same instant (an API latency spike; both answered in 1.5–2.1 s in every other run), so
  they fell back to the default layout and count as 7 missed controls. Fixed afterwards with the hedged request, then
  **confirm** re-ran all 14 photo controllers: 14/14, photo controls found 100%, labels 100%.
- ² The 5 "spurious" unlocks are the generous double unlocks the prompt now asks for on ambiguous parts (a pointed tool
  → drill + shoot on E15, E18, E24; lamp rays → flare + boost on E08; a cross painted on a shield → heal on E35).
- **pad**: buttons with the player's pad known (as in play), including B18–B19 whole-page photos: 8/8.
- Offline replay (`node dev/astra/gen-regression-test.js`): 103/103, every gate, 0.1 s, no key.

Calls: 238 of 250 (before 86, tune1 25, tune2 4, after 101, confirm 14, pad 8). 236 completed, 2 aborted by the 4 s
timeout, **0 incomplete, 0 HTTP errors**. Every call is a line in `calls.log`; status, ms and token usage in `calls.detail.log`.
Token use (after): answers ≤ 313 output tokens including ≤ 105 reasoning tokens; the old button budget of 200 was hit
by up to 184 tokens in the before run, which is the owner's "incomplete: max_output_tokens".

## What was wrong and what changed in astra.js
1. **Added buttons were read with the wrong picture in mind.** The phone sends only the new strokes, cropped; the old prompt
   said "the image is the whole pad, read only inside x, y, w, h", so the model looked at a corner of the button (B10:
   "unreadable button"; B04: a drill bit read as a `right` arrow). The prompt now says the image is the one new control and
   the region is only where it goes. Buttons: 82% → 100%.
2. **No idea of the wrong drawing.** Every schema now has `looksLike` ("controller" | "entity" | "nothing") (+ `thing` for
   controllers and buttons). An entity in the controller or button step → `{ ok: false, error: "looks like a ship",
   looksLike: "entity", thing: "ship" }`; a controller in the ship / explorer step → `{ ok: false, error: "looks like a
   controller", looksLike: "controller" }`. Refusals cost no drawing (the server only spends on ok). Posting the same image
   with `anyway: true` answers from the cache at once. 15/15 caught, 0 false alarms on the 86 right-kind drawings of the
   after run (and the 22 re-run in confirm + pad).
3. **Budgets**: 2000 / 1200 / 1600 output tokens (controller / button / entity), effort `low` by default; one retry with 4000
   tokens after an `incomplete` answer; one stricter retry when a controller or button answer has no usable control.
4. **Tail latency**: a hedged second request if the first has not answered after 2.2 s (fires on ~6% of calls: 7 of 123
   final-prompt calls were over 2.2 s, 2 over 4 s); the first answer wins and the other is aborted.
5. **Prompt rules from the failures**: crossed-out controls are deleted (C10, C25 returned them); icons map to verbs
   (C24 flame → shoot, legs missed; B15 parachute → shoot); entity parts described by look (E06, E10 drills missed; E18
   hand drill read as a gun, a missed gate skill); ambiguous parts unlock both; a face's eyes and a visor unlock nothing
   (13 spurious `scan` in the before run).
6. **Whole-page photos of a new button**: Astra remembers each player's pad (last finished controller + added buttons) and
   tells the model to answer with the control that is not on the pad yet (B18, B19). The phone may also send `pad`.
7. `expect` (the button a ghost box asked for) fills a button the model could not read; `no skill called "BANANA"` when a
   word does not map; labels or controls read twice are de-duplicated.
8. **Independent review (10 Oct 00:25, nothing serious, 8 smaller issues, all fixed and re-proved with the reviewer's own
   scripts):** a blank ship / explorer (`looksLike: "nothing"`, no parts) is refused with "nothing to read" instead of
   costing a drawing; "Use it anyway" on a refused button binds the ghost box's `expect` verb (still refused without one);
   a slow stricter retry reports the first definite answer instead of the timeout's charged default layout (retry window
   now 1.8 s); a truncated `incomplete` answer is retried; hostile `expect` / `pad` values and prototype kinds
   (`__proto__`, `constructor`) are refused cleanly; a refused entity no longer overwrites the kept drawing on disk; pad
   labels are reduced to letters, digits, spaces and + before they reach the prompt; a button region under 0.02 is
   refused ("region too small") before any call. Fuzz after the fixes: 30,000 hedge interleavings and 400 random
   generate calls, 0 problems, 0 unhandled rejections, nothing left in flight; mock answers identical to HEAD.

## Tests
- `node dev/astra/astra-test.js`: 27/27 (16 old, 4 pinned assertions updated to the intended new behaviour: effort low
  by default, budget ≥ 1200, `looksLike` in the `required` lists; 11 new: wrong kind both ways, anyway, looksLike on right
  answers, button prompt + expect, retries, pad memory, hedge, and the 4 review-fix tests).
- `node dev/astra/gen-regression-test.js`: replays every recorded answer (fixtures/after, confirm, pad) through
  astra.generate; fails if any answer changes, a live pass turns into a fail, "anyway" makes a call, or a gate drops.
  Mutation check: run against the old astra (`GEN_REGRESSION_ASTRA=dev/gen-corpus/baseline/astra-before.js`) it fails.
- `node dev/astra/server-generate-test.js`: the real server.js on port 8182 with OpenAI answered from fixtures
  (`fake-openai.cjs` preload): the owner's ship refused with no drawing spent, anyway spends one, C01 / B01 / E04 bind,
  the figure-as-button and the controller-as-ship refused, `generated` and `entity` broadcasts arrive. 7/7.

## Phone changes needed (client track)
- On `{ ok: false, looksLike }` with the other kind, show "That looks like your ship. Draw your buttons here." (controller
  or button step, `thing` names it) or "This looks like a controller. Did you mean to draw your ship?" (entity step) with
  **Redraw** / **Use it anyway**; Use it anyway re-posts the same image with `anyway: true` (instant, cached; it then
  costs a drawing). The refusal itself costs nothing.
- Add-a-button from a ghost box: send `expect: addState.action`. Optionally send `pad: S.layout.buttons.map(b => b.action)`
  (Astra remembers the pad itself; this only helps after a server restart).
- `analysePhoto` turns any ink box taller than wide by 270° (`turns = 3`), so an upright astronaut, rocket or a tall
  button photo arrives sideways (E15, E32, E35, B14, B15). The model still reads them, but the inflated 3D entity would
  be sideways: rotate only controller photos.

### Snippet for controller.html (field semantics)
```js
// After any POST /generate answer `res` for `kind` ("controller" | "button" | "ship" | "explorer"):
const STEP_IS = { controller: "controller", button: "controller", ship: "entity", explorer: "entity" };
const wrongKind = !res.ok && (res.looksLike === "entity" || res.looksLike === "controller") && res.looksLike !== STEP_IS[kind];
const canUseAnyway = kind !== "button" || !!addState.action;   // a refused button only binds the ghost box's verb
if (wrongKind) {
  // entity in the controller / button step: res.thing is ship | person | car | bike | animal | creature | object (or absent)
  //   "That looks like your ship. Draw your buttons here."              [Redraw]  [Use it anyway]
  // controller in the ship / explorer step:
  //   "This looks like a controller. Did you mean to draw your ship?"   [Redraw]  [Use it anyway]
  // Redraw: nothing was spent. Use it anyway: post the SAME image again with anyway: true (answered at once from
  // Astra's cache; it costs one drawing like any finished drawing). Show it only when canUseAnyway: for a button it needs
  // expect (the ghost box's verb), else the answer stays refused.
}
// res.looksLike === "nothing" (any step, error "no controls found" or "nothing to read") → "Nothing to read there. Draw
// bigger and darker." (no drawing spent). Send the same expect / pad on a speculative call and its confirm (cache key).
// Add-a-button from a ghost box: body.expect = addState.action;  optional: body.pad = S.layout.buttons.map((b) => b.action)
```
