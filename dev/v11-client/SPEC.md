# v1.1 client track: shared spec for every agent (lead: v11-client)

Read this whole file first. It is the contract between the agents of this track. Source of truth for the game:
`PLAN.md` section 0 ("Design decisions", including "Style and copy") and "World look"; `contract.js` (message shapes);
`.orch/CONTRACT.md` (rules). Repo: `/Users/jaumepuig/Documents/growth-hackathon`, branch v1. Today 2026-10-09.

## 0. Hard rules (from .orch/CONTRACT.md, they win over everything)
- Edit ONLY the files your agent owns (table below). Re-read a file right before you edit it: other agents edit other
  regions of the same repo at the same time (render.js is shared by two agents, see 2).
- No git commands that change state. No npm install, no new dependencies. three@0.160.0 from cdn.jsdelivr.net only.
- Never read/print `.env` or keys. Never `pkill -f` / `killall`: stop only processes you started, by PID or port.
- Do NOT edit: world.js, server.js, astra.js, contract.js, verbs.js, rules.js, terrain.js, rigs.js, anything under
  assets/ or dev/e2e/ (other lanes own them). Read them freely.
- Browsers / servers / the e2e harness: ONLY the `harness` agent runs them (laptop safety). Everyone else checks
  syntax only: `node --check file.js` for plain scripts, `node dev/v11-client/check-syntax.mjs <file>` for ES modules
  and HTML inline module scripts (the harness agent writes that tool first; until it exists use
  `node --input-type=module --check < file.js` for modules).
- Ports for this track: 8170-8179 (harness 8170-8175, lead 8176-8179).

## 1. Owners
| agent | owns (edits only these) |
| --- | --- |
| entities | render.js "entities" regions (see 2), inflate.js, anim.js, anims.js, transition.js |
| world | render.js "world look" regions (see 2) incl. the sound synth |
| phone | controller.html, phone-extras.js |
| bigscreen | space.html, bigscreen-extras.js |
| harness | dev/v11-client/** except SPEC.md (tests, server wrapper, screenshots) |
| lead | SPEC.md, render.js `computeHud` + `COPY` table, final integration |

## 2. render.js: who edits what (two agents in one file)
- entities: `ShipView` (drawn ships, LOD/impostors), `IslandWorld.addExplorer/ensureExplorerAnim` and the explorer
  loop inside `IslandWorld.update` (planet entity types), parked ships (`makeParked`, `bay`), `CameraRig` lobby framing,
  `projectPlayers`, the new entity cache / inflation queue, the new `createEntityPreview` export, `loadAsset` entries
  for ships/explorers, `warm()`. Add new code as new top-level classes/functions placed just ABOVE the line
  `// Space scene.` (search for it).
- world: `nebulaBackdropTexture`, `makeStars`, `SpaceWorld` constructor lights/fog/background, `setWorld` nebula,
  rocks (`setRocks`, decorative fields), `setBoss/applyBossState/boss update block`, `setPlanet` + planet update block,
  boss shots (red lasers), trails tuning inside ShipView ONLY the two lines that emit the trail particles (tell the
  entities agent if you need more), `fx()` methods, chests (inside `IslandWorld.setWorld` and the chest loop in
  `IslandWorld.update`), island lights/sky colours, bloom/exposure lines in `frame()`, the new sound synth. Add new code
  as new top-level classes/functions placed just ABOVE the line `// Island scene (mode "planet")` (search for it).
- lead: `computeHud`, `formatClock`, the `COPY` table at the top. Nobody else edits these.
- Both agents may add ONE small hook line each inside `startGame` (e.g. `game.sfx = sfx`) — keep hooks short, re-read
  before editing, never reformat code you do not own. If an Edit fails because the text moved, re-read and retry.

## 3. Server messages you consume (exact, from contract.js + world.js as of 23:50)
- `world` (on connect and on change): `round, seed, radius (2000), rocks [[id,x,y,z,size,typeIndex,health]],
  nebula {x,y,z,radius}, targets [{kind:"boss", x,y,z, radius 20, armour 0, hp, maxHp, cracked:true, dead}],
  planet: null | {x,y,z,radius 40,landRange 25}` (null until the boss dies), `island {seed,size,landing{x,z},
  parked:[{player,x,z,hp,maxHp,wrecked}]}`, `chests [{id, kind:"buried"|"rock", x, z, buried, dug 0..1, open, by}]`,
  `assists`, `playerCount`, `result: null | {round, reason:"chests"|"time", winner|null, scores:[[name,score]]}`,
  `leaderboard [{name, stars, total}]` (sorted), `entities {[player]: entity}` ONLY in the connect message (keep the
  map when the key is absent).
- `tick` 15/s: `t, round, phase ("lobby"|"playing"|"assists"|"scoreboard"), clock, left` (seconds to the 4:00 cap
  while playing/assists, else 0), `players [{name,color,mode,x,y,z,yaw,pitch,roll,hp,score,shieldEnergy,boostEnergy,
  flags{only true ones: boost shield stun dead invisible drilling digging ready bot landing takingOff spawnShield},
  action?, slot?, startedAt?, drawingsLeft? {space,planet} (humans only), respawnIn? (dead only)}]`,
  `bullets [[id,x,y,z,color,mode 0 space|1 planet]]`, `bossShots [[id,x,y,z]]`, `flares [[x,y,z,r,left]]`.
- `entity {player, entity}`: on join, every mode switch, redraw, unlock, assists. `entity = {type: "ship"|"person"|
  "car"|"bike"|"quadruped"|"blob", rig, verbs (everything it can do now), unlocked:[{verb, part}] (what the drawing
  unlocked, e.g. {verb:"boost", part:"exhaust flames"}), parts:[{name,x,y}], source:"plain"|"model"|"devkit"|"bot",
  assisted?:[verbs given by assists], anims?, image?: "/drawings/<player>-ship.png?v=<hash>" or "-explorer.png"}`.
  The SAME entity is re-sent often (assists, mode switches): never rebuild a mesh whose image URL did not change.
- `toast {player, text, kind:"hint"|"refused"|"info", verb, need:"part"|"button", gate, sketch: null|"drill"|"landing"|
  "shovel"|"gun", ghost: null|{action,x,y,w,h}}` (empty text = sketch-only step: no bubble).
- `fx {kind, mode:"space"|"planet", pos{x,y,z}, color, size}` kinds: explode blast spark flare scan drill crack land
  dig treasure hit respawn. `announce {text, big}`. `generated {player, kind, layout}`.
- HTTP: `POST /join {player}` → `{player, color}`; `POST /start {}` → `{ok, round}` | 409; `POST /input`;
  `POST /generate {player, kind:"ship"|"explorer"|"controller"|"button", image (PNG data URL ≤512 px), source,
  speculative, requestId, region?}` → `{ok, entity|layout, drawingsLeft}` | `{ok:false, error, drawingsLeft}`.
  Speculative calls are free and change nothing; the final (speculative:false) call costs one drawing (5 per world).
  v1.2 (may already be there, handle it if present): the answer may carry `looksLike: "entity"|"controller"` (top level,
  or inside entity/layout). Drawn images are served at `/drawings/<player>-<ship|explorer>.png?v=…`.
- RESOLVED 00:42: server.js now serves `/inflate.js` (PUBLIC_FILES). The harness wrapper's own route is redundant. All code must degrade gracefully when `import("./inflate.js")` fails (default meshes / flat image).
- Mock generation (ASTRA_MOCK=1): ship → dev kit (shoot, boost, shield, drill, land, scan, flare); explorer → type
  "person" with dig, drill, shoot, shield, scan, flare. The harness wrapper can force other types (car, bike…).

## 4. render.js API additions (implemented by the agent named in brackets)
- [lead] `game.hud()` gains: `left` (seconds to the 4:00 cap, counts down smoothly; 0 outside play), `leftText`
  ("3:59"), `leaderboard` (world.leaderboard or []), `result` (world.result or null), `playerCount`, `round`,
  `chests: {total, open, buried, rock}`, `me.entity` (that player's entity or null), `entities` (Map name → entity).
  Existing fields stay (phase, clock, clockText, objective, objectiveText, bar, status, me, radar, scores, tier,
  transition, overlayAlpha). Statuses are plain copy ("BOSS 850 M AWAY", "DIG IT UP", "DRILL THE ROCK").
- [entities] `game.entityOf(name)` → latest entity or null. `game.on("entity", cb)` already exists.
- [entities] export `createEntityPreview({ canvas, quality: "phone" })` → `{ show({ image, kind, color }) → Promise,
  clear(), setVisible(bool), dispose() }`: a small turntable (own WebGLRenderer, alpha, DPR ≤ 2, renders only while
  visible) that inflates `image` (URL, data URL, HTMLImageElement or canvas) with inflate.js for kind
  "ship"|"person"|"car"|"bike"|"quadruped"|"blob" and spins it with bright toon-like light. If inflate.js fails to
  load it resolves `{ ok:false }` and the page shows the flat drawing instead.
- [entities] The big screen in phase "lobby": the spectator camera frames the spawn grid (ships at their spawn spots,
  5 × 5, spacing 12 m), every ship spins slowly on the spot and pops in (scale bounce) when it first appears; drawn
  ships use their drawing. `projectPlayers()` includes everyone visible, nearest first, so capped name tags pick the
  nearest; each item `{name, color, x, y, hp, maxHp, visible, dist}` (CSS px).
- [world] export `sfx` (singleton, also `game.sfx`): `sfx.unlock()` (call inside the first user gesture: iOS),
  `sfx.play(name, {volume, pitch})`, `sfx.setMuted(bool)`, `sfx.muted`. Names: "laser", "explosion", "explosionBig",
  "boost", "drill" (short loop burst), "dig", "land", "takeoff", "chest", "hit", "zap" (mischief), "click", "pop",
  "unlock" (the unlock card), "countdown", "start", "win". The game plays world sounds by itself from fx/tick
  (phone: near its own player; big screen: near the camera's subject). Pages only call unlock() and UI sounds.

## 5. Style: Fortnite-like (owner, 23:55) — both pages
- Fonts: `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect"
  href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;0,800;1,800;1,900&family=Barlow:wght@500;600;700;800&display=swap" rel="stylesheet">`.
  Headings: "Barlow Condensed" 800/900 italic, UPPERCASE; body "Barlow" 600/700. Fallbacks: Impact, "Arial Narrow",
  system-ui. The page must look right before the font loads (fallback sizes close).
- Text: white with a dark outline + drop shadow: `-webkit-text-stroke: 1.5px #120a2e; paint-order: stroke fill;
  text-shadow: 0 3px 0 rgb(10 6 30 / .55)` (headings thicker).
- Palette: blue #2b7bff / #1f5dff, purple #8a3dff / #b45cff, gold #ffcb3d / #ffb000, deep navy #0d0b2e, green
  #4ade5a (ok/ready), red #ff3b5c (danger). Rarity-like accents: blue (common UI), purple (epic), gold (primary
  action, win). ENTITY mode accent: warm orange #ff8a1f (frame, header); CONTROLLER mode accent: cyan #19d3ff.
- Shapes: chunky slanted panels and buttons (`transform: skewX(-8deg)` on the box, `skewX(8deg)` on its content, or
  `clip-path: polygon(…)`), 3–4 px borders, a hard bottom shadow (`box-shadow: 0 6px 0 #0a0830`), gradients
  blue→purple for panels, gold for primary buttons with dark text. Big sizes: phone buttons ≥ 48 px tall, body ≥ 15 px;
  big screen headings ≥ 40 px at 1440×900.
- Motion: pop-in (scale .6 → 1.08 → 1, ease-out-back, ~280 ms), bounce on new list items, press squash on buttons
  (scale .94). Respect `prefers-reduced-motion`. Never animate layout per frame (transform/opacity only).
- Replace the thin-line HUD everywhere (meters, objective, radar ring, scoreboard rows, toasts, banners).

## 6. Copy (owner, 23:20 + 23:55): SUPER CLEAR
- Every user-facing string of a page lives in ONE `const COPY = {…}` table at the top of that page's script (HTML
  text is filled from it; no string literals for players elsewhere). render.js keeps its HUD statuses in its own COPY.
- Every screen answers "what do I do now?" in at most two short lines. Numbered steps. Plain verbs. One example
  image per drawing step. The same words everywhere: SHIP (the ship you draw), EXPLORER (what explores the planet:
  astronaut, car, bike, animal…), CONTROLLER, BUTTON. Never: verb, entity, slot, layout, devkit, speculative, mode.
- Mandatory strings (verbatim):
  - "STEP 1 OF 2 · DRAW YOUR SPACESHIP — it becomes your 3D ship"
  - "STEP 2 OF 2 · DRAW YOUR CONTROLLER — these become your buttons"
  - planet: "DRAW WHAT EXPLORES THE PLANET — astronaut, car, bike…" and "REDRAW YOUR CONTROLLER (optional)"
  - ship hint: "Draw the ship itself. What you draw on it gives it powers: flames → boost, a cannon → shoot"
  - controller hint: "Draw your buttons: a circle to steer, boxes with words like FIRE, BOOST, LAND"
  - unlock card: "Your ship can: fly, shoot (cannon), boost (flames)" (built from entity.unlocked + innate moves)
  - wrong drawing: "This looks like a controller. Did you mean to draw your ship?" (and the mirror sentence) with
    "Redraw" / "Use it anyway".

## 7. Budgets (PLAN.md section 4, hard on the phone)
Phone: ≤ 80 draw calls, ≤ 120k triangles, pixel ratio ≤ 2, textures ≤ 1024 px. 25 players in a round: far ships are
cheap impostors (glow sprite, no mesh), at most 8 full ship meshes on the phone, name tags capped (8 phone, 12 big).
Never build more than ONE inflated mesh per frame; cache inflated geometry by image URL (+ kind + quality). No
allocation-heavy work per frame. The phone page must not crash WebKit (the v1.1 e2e saw 'Target crashed' from the
assists stage on, when entities are re-sent for every player).

## 8. e2e compatibility (dev/e2e/run.mjs drives these; keep them working)
Phone: `window.__sp` with `.screen` ("join" | "draw" | "play") and `.player`; `#name` input + `#joinForm button`;
right after join `__sp.screen === "draw"` and a visible, tappable `#useDefault` that goes straight to play (`screen
"play"`) with a plain ship and the default controller; `#readyBtn` visible in the lobby wait screen; the planet
prompt keeps `id="explorer"` (class `hidden` when closed) with a tappable `#expDefault` (skip). Big screen:
`window.__game`, a visible clickable `#startBtn` in the lobby (it POSTs /start).

## 9. Phone ids and test hooks (phone agent implements, harness agent drives them)
- `window.__sp` (state, for tests): `.screen` "join"|"draw"|"play", `.step` one of "join", "ship", "shipResult",
  "controller", "controllerResult", "wait" (lobby, waiting for START), "play", "explorer", "explorerResult",
  "planetController", "results"; `.player`, `.entity` (my latest entity message), `.layout`.
- `window.__spTest.drawSample(name)` draws a built-in sample into the visible drawing pad as real strokes (names:
  "ship" rocket with flames + cannon, "controller" stick circle + FIRE + BOOST boxes, "car" side view with two wheels,
  "astronaut"), switching the pad to Draw mode first. `window.__spTest.looksLike(value)` makes the NEXT generate answer
  carry `looksLike: value` (to screenshot the wrong-drawing warning without server support).
- Ids: join `#name`, `#joinForm button`; drawing screen `#draw` with `data-kind="ship"|"controller"|"explorer"|
  "planetController"`, header `#drawHeader`, example image `#example`, mode toggle `#modePhoto` / `#modeDraw`, pad
  `#drawPad`, `#undo`, `#clear`, `#done`, `#useDefault` (skip), photo input `#camInput`, `#camUse`; result sheet
  `#result` (`data-kind`), 3D preview `#previewCanvas`, unlock card `#unlockCard`, controller preview `#ctrlPreview`,
  `#resultNext`, `#resultRedraw`; wrong-drawing dialog `#wrong` with `#wrongRedraw`, `#wrongUse`; lobby wait banner
  `#banner` with `#readyBtn`; locked-skill tooltip `#tip`; planet prompt sheet `#explorer` (class `hidden` when
  closed) with `#expPhoto`, `#expDraw`, `#expDefault`; optional controller redraw prompt `#ctrlPrompt` with
  `#ctrlKeep`, `#ctrlRedraw`; results `#resultsSheet`.
- Big screen ids: `#startBtn`, `#lobby`, `#qr`, `#leaderboard`, `#timer` (shows hud.leftText), `#results`.
