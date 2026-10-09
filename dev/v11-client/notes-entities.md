# entities agent: notes (v1.1 client track)

Owner of: render.js "entities" regions, inflate.js, anim.js, anims.js, transition.js. Can be cut off any time: read this first.

## Status
- [x] inflate.js: kinds ship / person / car / bike / quadruped / blob; `findWheels` (circle matching on the ink, car + bike) with
      drawn wheel discs (a pivot per wheel, spin `pivot.rotation.x -= v / radius * dt`) or two plain chunky wheels;
      `result.instance({color})` per-view clones (shared geometry + texture, own material); `loadDrawing(url, {fresh})`;
      `warmMaterial()`; `KINDS`; `__test`. Tested in Node with a mock canvas (see "Test harness").
- [x] render.js, block above `// Space scene.`: DrawnCache / DrawnClaim / `DRAWN` (queue, one inflate per frame, LRU 16 phone /
      40 big), `entToy` (car, bike, quadruped, blob toys), `entPlanLod`, `ShipModel` (+ `ParkedShip`), `ExplorerView`,
      `createEntityPreview`.
- [x] ShipView extends ShipModel (drawn / default / placeholder, lobby spin + bob + 1.7x showcase, pop-in, impostors),
      `SpaceWorld.planLod`, island explorers + parked ships in `IslandWorld.update`, `CameraRig.lobbyShot`,
      `projectPlayers` (visible first, nearest first, lobby: everyone), `game.entityOf`, startGame hooks (see below).
- [ ] left: see "Not done / ideas".

## API others rely on
- `game.entityOf(name)` -> latest entity message of that player or null (any type).
- `createEntityPreview({ canvas, quality: "phone" })` -> `{ show({image, kind, color}) -> Promise<{ok, triangles, ms, kind, wheels}>,
  clear(), setVisible(bool), dispose() }`. image: URL, data URL, HTMLImageElement, canvas, ImageBitmap. `{ok:false, error}` when
  inflate.js / WebGL / the image is missing. Calls made while one is running are coalesced (all resolve with the last result).
- `game.projectPlayers()` -> items `{name, color, x, y, hp, maxHp, visible, dist}`, visible first, nearest first, the array and
  its items are REUSED (read before the next call). In the lobby every ship is listed (visible = on screen).
- Big-screen lobby (phase "lobby", spectator view): `CameraRig.lobbyShot` frames the box of all ships inside the free middle of
  the lobby page (x 26-74 %, y 15-70 % of the screen, per notes-bigscreen.md; checked for 1 / 4 / 9 / 25 ships at 16:9 and 16:10:
  ships span x 32-70 %, y 23-59 %), ~35 deg down, slow drift, smooth as players join; ships spin on the spot, bob, are 1.7x bigger, pop in (scale 0 -> 1.15 -> 1, 0.5 s) when their model appears.
- `game._internals.drawn.stats()` -> `{entries, cap, quality, built, loading, users, states, inflate}` (inflate: 0 not asked,
  1 loading, 2 ready, -1 missing).
- Entity maps: `entities` (latest of any type, read by computeHud: name kept), `entShips` / `entPlanet` (latest per family).

## startGame hooks I added (one line each, search for them)
`DRAWN.configure(phone)` (top), `entReset` / `entNote` in the `world` / `entity` cases (+ `warmDrawn()`), `owner.ensureModel?.()` in
`startShot`, `entityOf` in the returned object, `drawn: DRAWN` in `_internals`, explorers / parked / DRAWN cleanup in `dispose()`.
`DRAWN.pump()` runs at the top of `SpaceWorld.update` and `IslandWorld.update` (no hook in `frame()`).

## Rules I follow in the views (so a successor does not re-derive them)
- A mesh is built once per (url, kind, quality, colour); re-sent entities never rebuild (tested: 5 re-sends, 0 extra inflations).
- A view only holds a model while the LOD plan wants a mesh: phone 8 nearest ships (own + followed always), big < 450 m (520 to drop);
  explorers phone 8 / big 300 m; parked ships phone 6. Others are glow impostors (no mesh, no animator).
- Ship waits up to 3 s for its drawing before showing the default; person waits up to 3 s, the other planet types show their toy meanwhile.
- A landed player's latest entity is the explorer: parked ships read `entShips` (their last ship entity).
- `ExplorerView.step` asks `island.buriedChestNear(x, z, r)` for the kneel-on-X hint: if the world agent changes chest storage
  they only have to keep that one method working.

## Lead notes received
- `entities` stays the module-level Map name (computeHud reads it). Phone texture budget: texPx 384 (inflate Q.phone), textures shared
  through the cache (one per entry), per-view materials only.

## Test harness (outside the repo, rebuild if /tmp is gone)
- `/tmp/ent-test`: Node + mock OffscreenCanvas + sharp (from ../genesy-grok) + a z-buffer rasteriser: `inflate-test.mjs`,
  `wheel-debug.mjs`, `toy-view.mjs`, `lobby-shot.mjs` (renders PNGs to look at).
- `/tmp/ent-render`: `run.sh smokeN.mjs` copies the repo's render.js / anim.js / inflate.js ... next to a `three` shim (stub
  WebGLRenderer + composer), fake DOM, fake SSE and fake /drawings, then drives startGame with synthetic world / tick / entity
  messages: smoke1 (25 lobby), smoke2 (phone LOD), smoke3 (landing, planet types, parked, take-off), smoke4 (no rebuilds, redraw,
  reconnect, death), smoke5 (cache LRU / failures), smoke6 (preview), smoke7 (A-008 default person, toys), budget.mjs.
- Numbers (Node, stub GL): phone 8 ship meshes = 14 draw calls / 22k tris; big 25 ships = 59 calls / 111k tris.

## Wheel detection rules (inflate.js findWheels, car + bike only)
Rings of ink touching the bottom of the drawing, matched on the ink thickened by 1 px: >= 78 % of the circle on ink, >= 7 of 8
octants mostly ink, the circle 3.5 px outside mostly empty, radius 5.5-23 % of the length, best score first (bigger wins ties), later
wheels must be 0.75-1.35x the first's radius and may only touch it; one wheel found -> a mirrored twin; none -> two plain chunky wheels
(dark tyre, light hub) at 20 % / 80 % of the length and the body lifted 0.55 R. Car: a disc on each side of the body per wheel (an axle
pivot), bike: one fat disc in the middle plane. Checked on the 35 corpus drawings x 6 kinds x 2 qualities (no exception, no NaN) and
on synthetic wobbly / solid / ground-line / elliptical / tiny / hub / three-wheel cars (test scripts in /tmp/ent-test).

## Not done / ideas
- Nothing was run in a browser (rule): needs the harness agent: iPhone WebKit memory with 8 drawn meshes, the look of the plush
  ships in the real lights, the wheel spin, the lobby shot on a real 16:9 screen.
- server.js does not serve /inflate.js yet (PUBLIC_FILES): drawn meshes are silently off until it does.
- A screen that connects after a player landed only knows that player's explorer entity: their parked ship shows the default ship
  unless the server puts the ship drawing URL on the parked entry (`island.parked[].image`, supported by ParkedShip.entityFor).
- Look tuning knobs if the plush ships bloom too much or look flat in the real lights: inflate.js `makeTexture` (body colour mix 0.38),
  `makeMaterial` (emissiveIntensity 0.3, rim 0.45), `KIND` thick / bevel / minHalf; render.js lobby showcase scale `1 + 0.7 * bobAmt`.
