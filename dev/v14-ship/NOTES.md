# v14-ship3d: drawn ships as real 3D ships (not cookies)

Owner, 10 Oct 09:30: "we will need to improve the ship generation now it looks like a cookie. have some textures ready to
apply, make sure it's generated nicely. let's test 6.1 if that is not good enough let's test 6 astra".

## How a drawn ship becomes 3D now
1. **Astra (astra.js)**: a ship drawing (speculative or finished) starts TWO vision calls at once: the entity reading (type,
   parts, skills, card: unchanged) and the **ship spec** (astra-ship.js: one strict-JSON call returning the drawing as 3D
   parts). The answer waits for the spec at most `SPEC_GRACE_MS` = 100 ms after the entity reading (a 700 ms grace
   measurably slowed the unlock card at 10:08), so the card is never slower than before. Measured on gpt-6.1-sol: p50
   2.9-3.0 s, p90 3.3-3.8 s, 200-630 output tokens.
   - `entity.spec` (ship entities only) = the model's spec reconciled with the reading (every unlocked skill shows as a
     part: a cannon for shoot, flames for boost, legs for land, ...), `source: "model"`. ASTRA_MOCK=1, no key or a failed
     spec call: built from the entity's own parts (`astra-ship.js fromEntity`, varied by the drawing's hash), `source:
     "entity"`. Still running after the grace: the answer has NO spec (screens show the drawing inflated for about a
     second) and the model's spec follows through `astra.onShipSpec(fn)` listeners (server.js re-sends the entity).
   - Spec calls are cached by image and owned per request: when every request for an image was superseded (the player
     kept drawing) its spec call is aborted, unless a finished answer counts on it.
   - `astra.generate(body, { signal })`: server.js's abort signal is honoured now (the phone closed its request): the
     request resolves "superseded" and its model call is aborted when nobody else waits for that drawing.
2. **Server (server.js, patch in `dev/v14-ship/patch-server.py`, applied once v14-fix-server exits)**: the spec is kept by
   the drawing's hash (the `?v=` of `/drawings/<player>-ship.png?v=<sha1 10 hex>`) and attached as `spec` to every ship
   entity message and `world.island.parked[]` entry, next to `image` (world.js whitelists entity fields, so it rides the
   same way `image` does). `GET /ship-spec?v=<hash>` → `{ ok, spec }` | 404 for the phone's result card. A late model spec
   re-sends the player's entity (and the world message when they are parked on the planet). ship3d.js is a public file.
3. **Every screen (render.js)**: a ship entity with `image` + `spec` is built by `ship3d.js buildShip(spec, { drawingImage,
   color, quality })` through the same DrawnCache as inflate.js (one build per frame, LRU, per-view instances): flying
   ShipView, the parked ship on the island, the landing / take-off shot. No spec, ship3d.js missing, or a build that
   throws: inflate.js as before. A new spec for the same drawing is a new cache entry; the old model stays on show until
   the new one is ready. ship3d models bring `setEnginePower` (flames: 0 parked, 0.35 idle on the pad, 1 flying, 2.2
   boost) and `setOpacity` (lit parts fade, additive flames stay additive).
4. **Phone result card (render.js createEntityPreview)**: `show({ image, kind, color, spec? })`. controller.html passes no
   spec today, so the preview finds it by the drawing's hash: the entity messages it has seen, else `GET /ship-spec`
   (SHA-1 in JS when `crypto.subtle` is missing: a phone on plain HTTP). It shows the inflated drawing at once when no
   spec is known yet and swaps to the built ship when the model's spec lands (polls ≤ 8 s). 3/4 camera for built ships.

## Field semantics (astra-ship.js header has the full shape)
- Ship frame: nose -Z, up +Y, right +X, ~3.2 m long. `at` 0 = nose tip … 1 = tail; `size` = fraction of the length.
- Colours "#rrggbb" or "" (not drawn: the player's colour). The model often answers colour NAMES ("teal"): accepted. A
  near-black / grey colour is the pen, not a colour ("").
- `weapons[].verb`, `extras[].verb`, `engines.verb`: the skill the part stands for when that skill is unlocked, else null
  (decoration). `added: true` = put there by reconcile (the reading saw it, the spec did not).

## Files
- `astra-ship.js` (new): SCHEMA, prompt, request, normalize, reconcile, fromEntity, verbOfPart, seedOf.
- `ship3d.js` (new): the builder + procedural texture set (see its header).
- `astra.js`: the parallel spec call, `onShipSpec`, `generate(body, { signal })`.
- `render.js`: ship3d loader, spec-keyed DrawnCache entries, ShipModel / ParkedShip / ShipView.setOpacity, preview.
- `dev/v14-ship/`: compare.mjs (model comparison), drawings.mjs (the 12 drawings), view.html (3-angle render), sheet.html
  (contact sheet), serve.mjs (static server), server.cjs (the real server + the patch, in memory), game-shots.mjs (TV +
  WebKit phone screenshots in the game), preview.html (the phone's result card), spec-test.js (unit checks),
  patch-server.py / patch-contract.py (to apply once the server lane exits).
