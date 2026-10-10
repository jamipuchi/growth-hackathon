# Space Party: multiplayer game plan

**Goal:** a party game for up to 25 players: one big screen everyone watches, and each player's own phone. Every player draws two things, on paper or on the phone: an **entity** (their spaceship, then on the planet an astronaut, car, bike or animal) that becomes a 3D object whose skills come only from what is drawn on it, and a **controller** whose drawn buttons become the phone's controls. A round lasts at most 4:00 and the most points wins.

**How to use this doc:** section 0 holds the owner's decisions and wins over everything else. Sections 1 to 12 explain how the game works and how it is built, and must agree with section 0. Exact numbers and message shapes live in code, in `contract.js` (tuning, scoring, messages and their checks) and `verbs.js` (skills). What each version added and how it was checked is in `VERSIONS.md`.

**Generation and wiring:** **Astra**, a server module, reads each drawing or photo with an OpenAI vision model: a controller becomes a checked button layout, an entity becomes a type plus the skills its drawn parts unlock. **Sol** (`gpt-6.1-sol`) then writes the controller as HTML. Everything after the model answers is plain code. The key comes from the `OPENAI_API_KEY` environment variable or a git-ignored `.env`, and is never committed.

---

## 0. Design decisions, 9 October 23:10 (these override anything below that disagrees)

The owner answered a long round of questions after the first playtest. Where an older section says otherwise, this list wins; the sections below are being rewritten to match.

**Round and winning**
- A round ends at **4:00 at the latest, or earlier when every chest has been opened**. **Most points wins.** Tune so **25 players open all chests in about 3:00**; an expert about 3:00, a regular player about 4:00.
- **Session leaderboard:** each round's winner earns a star; the big screen keeps the running total for the evening.
- **Points:** chest +1500, boss last hit +1000, kill +200, killed -50.
- **Up to 25 players** per round (network, server and phone budgets must hold for 25).
- **Lobby started from the big screen:** players join from their phones; the host starts the round with a START button on `space.html` (no auto-start timer).

**World and pacing**
- **Much more space:** at least about a minute of flying to reach the boss rock, then more to the planet.
- **The boss** is armoured but **any weapon hurts it; it just takes many hits**. Its HP scales with the number of players. No special gate in space beyond having drawn a weapon.
- **The planet:** each player lands on their own once the boss is dead. Chests are of **two kinds: buried (needs a shovel or claws to DIG) and locked inside rocks (needs a drill to DRILL)**. The drill belongs to planet entities, not ships.

**Drawing, entities and controllers**
- **Two separate drawings, always:** the **entity** (the spaceship, then on the planet an astronaut, car, bike, animal…) becomes a 3D object in the world; the **controller** becomes the buttons on the phone screen.
- **Skills unlock only from what is drawn on the entity.** A plain ship only flies. Shoot needs a drawn gun, boost needs an exhaust with fire, and so on. **Nothing is automatic: the player must also draw the button** for every skill on their controller.
- **Sol is generous** when a drawn part is unclear (it unlocks the closest skill), and **a card shows what the drawing unlocked** ("Your ship can: fly, shoot (cannon), boost (flames)").
- **Full redraws only** (no add-a-part); each redraw costs one drawing from the world's budget (5 in space, 5 on the planet).
- **The controller is written by Sol as HTML:** a clean sci-fi UI matching the HUD, laid out the way the player drew it, running in a sandboxed frame that can only call the game's real actions. On the planet a new controller is **optional** (the space one is kept; a prompt suggests a redraw).

**PvP and mischief (ruthless, free-for-all)**
- Free-for-all, no teams. Dying costs -50 and a 3 s respawn; drawings are kept.
- Rivals can **steal chest points, steal the boss's last hit, and wreck parked ships** (a wrecked ship must be redrawn to take off).
- Mischief skills, each unlocked by drawing: **EMP** (a rival's buttons swap places for 5 s), **ink bomb** (ink covers a rival's screen until wiped), **tractor** (pulls rivals into rocks) and **mines**, **decoy** (a fake copy that draws fire).

**Style and copy (owner, 23:55)**
- **Style like Fortnite:** bright, saturated, cartoony 3D with chunky shapes and soft toon-like lighting (the plush inflated drawings fit right in); the UI is bold and chunky: slanted panels and buttons, heavy condensed italic capitals (Google Fonts "Bebas Neue" or "Barlow Condensed" 800 italic for headings, "Barlow" for body), white text with a dark outline or shadow, blue / purple / gold accents like Fortnite's rarity colours, big readable sizes, playful motion (pop-ins, bounces). This replaces the earlier "thin lines" HUD direction; `assets/reference/world-look.png` still sets the world's composition and palette.
- **Instructions must be SUPER CLEAR:** every screen answers "what do I do now?" in at most two short lines; numbered steps ("1 · DRAW YOUR SHIP on paper"), plain verbs, one example image per drawing step, the same three words everywhere (SHIP or ENTITY you draw, CONTROLLER, BUTTON), no jargon, no internal names (never "verb", "entity", "slot", "layout"). Every new copy string is checked by the first-timer persona of the playtest panel.

**Presentation**
- **Big screen = spectator TV:** cinematic camera, session leaderboard, kill feed, map, join QR. Not playable.
- **Simple synthesized sound effects** in v1. **English** only.
- **Iterate in playable versions:** every version runs end to end, is better than the last and adds more, until it is AAA-polished.

**Owner decisions, 10 October 09:05** (answers to the open questions; "all recommended")
- **No free skills at 3:00:** a player still missing a gate skill gets a big "draw X" hint (for example DRAW A SHOVEL) and the chests glow; the skill itself is never granted.
- **Ink bomb** stays until the player wipes it with a finger, with a 10 s automatic fade as a safety net.
- **Adding one button** to the controller stays (it costs one drawing); adding a part to an entity stays ruled out.
- **Time to the boss:** about 60 s cruising, about 40 s holding BOOST (boost should feel rewarding).
- **The 3-2-1 countdown** after START is a real server phase, so the phones count down together with the big screen.
- **Big-screen scoreboard during play:** 7 rows plus the followed player.
- **Player cap:** 25 (humans and bots together never exceed it).

## 1. Components

One Node server, `node server.js`, runs everything: HTTP on port 8000 and HTTPS on port 8443 (a self-signed certificate, so phones get tilt and the camera). Phones join over the LAN by scanning the QR code on the big screen.

| File | Responsibility |
| --- | --- |
| `server.js` | Serves an allowlist of public files. Endpoints: the live event stream (`GET /events`), the join address for the QR (`GET /info`), join (`POST /join`), START (`POST /start`), phone input (`POST /input`), generation (`POST /generate`), the controller page (`POST /controller-html`), perf samples (`POST /perf`). `--bots N` adds scripted ships |
| `https.js` | HTTPS next to HTTP, with a self-signed certificate for the laptop's LAN address (made once with `openssl`, kept in `.orch-certs/`) |
| `contract.js` | The shared contract: round timings, tuning, scoring, the 25 player colours, every message shape and its check. Used by the server and the browser |
| `world.js` | The authoritative simulation at 30 Hz: lobby and round clock, flight, rocks, the boss, the planet and island, chests, PvP, mischief, bots, scoring |
| `rules.js` | The hint ladder (riddle, sketch, answer) and the drawing budget |
| `verbs.js` | The skills: every verb with its settings, what to draw to unlock it, the mischief skills, the button labels that mean it. Server and browser |
| `rigs.js` | The 10 entity rig templates (section 6). Server and browser |
| `terrain.js` | The island heightmap. Server (walking) and browser (drawing it) |
| `astra.js` | OpenAI calls plus wiring: a controller drawing becomes a checked layout; an entity drawing becomes a type, its drawn parts and the skills they unlock |
| `astra-html.js` | Sol writes the controller as one HTML page in the Fortnite style; a ready-made template is used whenever Sol is slow or its page fails the checks |
| `anims.js` | The shared animation table: clip, motion profile and effects per entity type and animation slot |
| `render.js` | The shared three.js renderer of the phone and the big screen: both worlds, ships and entities, effects, HUD data, the TV camera director, adaptive quality, the `?perf` overlay |
| `inflate.js` | A drawing becomes a plush 3D body on the device, with no model call |
| `anim.js` | Procedural animation for any entity |
| `transition.js` | Landing and take-off as one continuous shot |
| `sfx.js` | Every sound effect, synthesized with WebAudio. No audio files |
| `controller.html` | The phone: join, draw the ship and the controller (photo or finger), the unlock card, play with its own 3D view, the explorer step, results |
| `ctrl-sandbox.js` | Runs Sol's controller page in a sandboxed frame that can only send the game's real actions |
| `mischief-fx.js` | What rivals do to your phone: EMP, ink, tractor, mine and decoy effects |
| `phone-extras.js` | Phone HUD pieces: HP, SHIELD and BOOST bars, the radar, the drawings-left counter, hint sketches, example drawings |
| `space.html` | The big screen, a spectator TV: lobby with QR and START, cinematic view, kill feed, map, session leaderboard, results |
| `bigscreen-extras.js` | Big-screen pieces: the join QR, the kill feed, name tags |
| `perf-report.js` | Reads `perf.log` and checks every device against the budgets (section 4, Performance) |
| `samples/*.json` | One sample of each message; the contract checks run on them |
| `controllers/` | Each player's drawings and generated layouts. Never served |
| `perf.log` | Performance samples from every screen. Never served |
| `ORCHESTRATE.md`, `assets/` | The channel with the 3D asset model: requests, deliveries and the asset contract. Delivered assets live in `assets/<id>-<slug>/` |
| `dev/` | Tests, harnesses and notes, one folder per track (section 9) |

**Flow:** the phone sends a drawing. Astra reads and checks it, saves it in `controllers/`, and the server broadcasts the result. The phone and every screen pick it up at once.

---

## 2. Decisions taken

- three.js 0.160.0 from a CDN for all 3D. Plain Node 20+, no dependencies, no build step.
- **The server owns the game.** Every screen only draws what the server sends, which is what lets each phone show its own view.
- **Generation model:** always OpenAI `gpt-6.1-sol` on the Responses API with `service_tier: "ultrafast"` and low reasoning effort; strict JSON when it reads a drawing. Never `gpt-6-astra` or any other model. The only fallback is `gpt-6.1-sol` on its default tier.
- **Drawing input:** a photo of a drawing on paper by default; drawing with a finger on the phone is the backup, one toggle away (PHOTO / DRAW).
- **Entities look like the drawing:** the drawing itself is inflated into 3D on the device (section 6). No model call for looks.
- **A skill needs two things:** the drawn part on the entity (it grants the skill) and a button on the controller (it triggers it). See section 5.
- **Rigs and binding are generic:** a skill says what it requires, never which entity owns it; binding a drawn button to a skill is code and runs again on every entity switch.
- **Phone view:** third-person chase by default, cockpit as a toggle.
- **The island is full 3D.**
- **Bots are fillers, not players:** `--bots N` adds scripted ships for tests and small groups (section 4, Bots).

---

## 3. Architecture

```
 phones (controller.html)                     big screen (space.html)
  ├─ Sol's controller in a sandbox              ├─ lobby: QR, players, START
  ├─ own 3D view (chase / cockpit) + HUD        └─ spectator TV: camera director, kill feed,
  └─ input: buttons, sticks, tilt                  map, leaderboard, results
            │ POST /join /input /generate                ▲ GET /events (live stream)
            ▼                                           │
        server.js ── world.js (authoritative: simulation 30 Hz, ticks 15 Hz)
                     rules.js, verbs.js, rigs.js, terrain.js, contract.js
                     astra.js ────── gpt-6.1-sol (reads the drawing)
                     astra-html.js ─ gpt-6.1-sol (writes the controller page)
```

### Messages
`contract.js` is the reference for every shape (its comments and its checks); `samples/*.json` holds one of each.

Server to screens, over `GET /events` (one stream per screen; a phone opens it with `?player=<name>` and alone gets its private messages; the TV opens it with `?screen=big`):
- `world`: rocks, the decorative nebula, the boss, the planet (once the boss is down), the island with the parked ships, the chests (`buried` or `rock`), the assists flag, the player count the round is scaled for, the round result and the session leaderboard. Sent on connect and whenever any of it changes.
- `tick`: 15 a second. Phase (`lobby`, `playing`, `assists`, `scoreboard`), clock, `left` (seconds until the 4:00 cap), players (position, angles, health, score, SHIELD and BOOST energy, drawings left, flags such as dead, landing, emp, inked, tractored, drawing, and the last skill for animation), bullets, boss shots, flares, mines, decoys. Under 8 KB with 25 players.
- `fx`: explosions, sparks, landing dust, mischief bursts. `announce`: kill feed, boss down, chests, the winner.
- Private, for one player only: `toast` (hints, refusals, who destroyed you), `mischief` (play this effect on this phone), `cooldown` (a skill is ready again in n seconds), `generated` (a controller is ready, with its page; kind `html` when Sol's own page arrives later).
- `entity`: a player's wired entity: type, rig, skills, what unlocked them (`unlocked: [{verb, part}]`), drawn parts, animations, the drawing.

Phone to server:
- `POST /join {player, device}`: the phone keeps a random device token; a name already used by another phone becomes `name2`.
- `POST /start`: the big screen's START button (lobby only).
- `POST /input`: buttons `{type:"input", player, action, down}`; sticks and tilt `{type:"axis", player, axis:"steer"|"move", x, y}` from -1 to 1, at most 20 a second. The action `drawing` says the draw sheet is open: the ship hovers and cannot be hurt, for at most 30 s.
- `POST /generate` (below), `POST /controller-html` (a reloaded phone gets its controller page back), `GET /info` (the address the QR opens: HTTPS when it is up), `POST /perf`.

### Generation (`POST /generate`, handled by Astra)
- The phone sends `{player, kind: "ship"|"explorer"|"controller"|"button", image, source: "photo"|"draw", speculative}`. A photo is cleaned on the phone first: orientation fixed, paper lines and shadows dropped with an adaptive threshold, cropped to the ink, scaled to 512 px. Controller photos are turned landscape.
- **Speculative:** the phone posts 1.2 s after the last stroke; if drawing goes on, the call is aborted. Most answers are ready before the player taps DONE. More than 8 speculative calls in 10 s get "slow down".
- **Entity (ship or explorer):** one vision call returns the type (a ship in space; a person, car, bike, animal or blob on the planet), the drawn parts and the skills they unlock (section 5). Only skills of that world are kept.
- **Controller:** one vision call reads the drawn controls as a layout (below). Labels bind to skills through the `verbs.js` synonyms, rectangles are clamped, and `contract.js` has the last word. A layout with no way to steer gets a steer stick.
- **Add a button:** `kind:"button"` sends only the new control, cropped, and Astra adds that one control to the pad. It costs one drawing.
- **Wrong kind:** a ship drawn in the controller step, or a controller in the ship step, is refused ("looks like a ship"). It costs nothing, and "Use it anyway" is one tap.
- Answers are cached by drawing hash. Each call has a 4 s timeout and a second, hedged request when the first is slow. With no answer: an entity gets the dev kit (every gate skill, `source: "devkit"`); a controller is built from the ink shapes the phone found, or the phone keeps its old controller and says "try again". Refused and failed drawings cost nothing.
- `ASTRA_MOCK=1` (or no key) answers offline: the dev kit for entities, fixed layouts after 300 ms, the template page for controllers.

### The controller page (Sol: `astra-html.js` and `ctrl-sandbox.js`)
- As soon as a controller or button is read, `/generate` answers with the whole pad as a page built from a fixed template (Fortnite style, always works). Sol writes its own page in the background; it reaches the player's phone as `generated` kind `html` and is swapped in without a flash.
- Sol gets the drawing and the layout and writes one self-contained page: chunky slanted tiles in rarity colours, heavy italic capitals, every control where the player drew it. The server checks it (size, no network, no storage, only allowed actions, every drawn control present, a Fortnite style check); any failure keeps the template.
- The phone runs the page in `<iframe sandbox="allow-scripts">` under a strict content policy. A trusted kit inside the frame does all the input (multi-touch, sticks, toggles, touch areas of at least 56 px) and talks to the phone page only through `postMessage`. The phone page accepts only allowed actions, clamped stick values and a capped rate. EMP swaps the controls through the same kit.
- If the frame never becomes ready, the phone falls back to its own hit areas over the drawing.

### Controller layout v2 (what Astra reads from the drawing)
```json
{ "buttons": [
  { "action": "shoot", "label": "FIRE", "x": 0.6, "y": 0.3, "w": 0.2, "h": 0.15 },
  { "type": "stick", "action": "steer", "x": 0.05, "y": 0.4, "w": 0.3, "h": 0.4 }
] }
```
- 1 to 16 controls; `type` is `button` (default), `stick` (a real analog stick: `steer` or `move`, it sends `axis` messages while dragged) or `toggle`. `x, y, w, h` are fractions of the drawing, which maps onto the whole play area.
- Tilt steering is a phone toggle that sends `steer` axes from the motion sensors. It needs HTTPS.

---

## 4. Game design

### A round, from a player's phone
1. **Join:** scan the QR on the big screen, type a name.
2. **STEP 1 · Draw your spaceship** (on paper, then a photo; or with a finger). It becomes your 3D ship, and a card says what the drawing unlocked: "Your ship can: fly, shoot (cannon), boost (flames)". Skipping gives a plain ship that only flies.
3. **STEP 2 · Draw your controller:** a circle to steer and a box with a word for each button (FIRE, BOOST, LAND). Locked buttons show what to draw on the ship.
4. **Wait for START:** the host starts the round from the big screen.
5. **Fly to the boss** (about a minute) and shoot it with any weapon you drew. It shoots back.
6. **The planet** appears when the boss dies. Fly close and press LAND (landing legs or a parachute drawn on the ship, and a LAND button). Landing plays a 3 s shot.
7. **Draw your explorer** (astronaut, car, bike, animal…). Redrawing the controller for the planet is optional.
8. **Open chests:** DIG the buried ones (a shovel or claws), DRILL the ones locked in rocks (a drill). Each is worth +1500.
9. **The round ends** at 4:00, or earlier when every chest is open. Most points wins and gets a star on the session leaderboard. After 10 s of results everyone is back in the lobby with their drawings.

Throughout the round, rivals can shoot you, steal your points and play mischief on you (PvP and mischief, below).

### Round clock and pacing
| Phase | When | What happens |
| --- | --- | --- |
| `lobby` | until the host presses START | join, draw the ship and the controller, tap READY |
| `playing` | from 0:00 | the flight to the boss, the boss fight, the planet, the chests |
| `assists` | from 3:00 | the gate skills unlock for everyone still missing them ("ALL POWERS ON"), the chests glow, hints jump to the answer (open question, section 10) |
| `scoreboard` | at 4:00, or when every chest is open | 10 s of results with one winner and their star, then the lobby |

- Targets (section 0): 25 players open every chest in about 3:00; an expert alone takes about 3:00, a regular player about 4:00.
- Measured in v1.2 (one scripted human with 24 bots, mock generation, 7 chests): the expert route had the boss down at 1:09, the first chest at 1:38 and all 7 at 2:19; the regular route (waits for each hint) at 1:14, 2:38 and 3:38.
- Tuning knobs are all in `contract.js` `TUNING`: distances, speeds, the boss's HP, the chest count and spread. Tighten the distances first if rounds run long.
- `--autostart S` starts every lobby after S seconds. It is for tests only; a real party always starts from the big screen.

### World
- Open space with no fixed direction of travel: a sphere 2,000 m in radius with a soft edge that turns ships back. About 320 rocks, 60% of them within 320 m of the boss, thinning out toward open space.
- **Much more space:** the boss is 1,100 m from the spawn grid (5 × 5, for 25 players): about 60 s cruising, about 40 s holding BOOST. FORWARD adds a little speed and BACK brakes almost to a hover; BOOST is the real speed-up and needs a drawn exhaust. The planet is 600 m further on.
- The boss floats in a colourful nebula (decoration only) and is visible from anywhere; the radar points at the current objective.
- Rocks: v1 uses stone (1 hit, +10) and crystal (2 hits, +50 and heals you). Iron, volatile, magnet and splitter rocks are defined in `contract.js` for later. Hitting a rock costs 30 points.

### The boss
- Armoured, but **any weapon hurts it** (shoot, blast); it just takes many hits. No gate beyond having drawn a weapon.
- HP = 2400 × (1 + 0.5 × (players − 1)), counted at START (each bot counts 0.25): about 30 s of steady fire alone, about 16 s with 25 players firing.
- It shoots back at a random ship within 260 m, more often the more ships are near (every 1.2 s ÷ √ships), 10 damage per shot. Decoys count as ships.
- The last hit scores +1000, whoever lands it: stealing it is allowed.
- A ship destroyed in space comes back where it died, but at least 300 m from a living boss.

### The planet and the island
- The planet is in view from the start, locked behind a faint shield until the boss dies; then its landing ring lights up.
- Each player lands on their own: within 25 m, press LAND. Landing (3 s) and take-off (2 s) are predefined shots with no control and no damage.
- The ship stays parked in its own bay on the landing pad. Rivals can shoot a parked ship (300 HP); wrecking one scores +150, and its owner must redraw the ship to take off again.
- **Chests:** clamp(2 + ⌈0.7 × players⌉, 3, 20) of them, half **buried** (hold DIG next to it, 2 s) and half **locked inside rocks** (hold DRILL, 2.5 s), spread around the landing pad. Walk onto an opened chest to collect it: +1500.
- How the explorer moves depends on what was drawn: a person walks and jumps; an animal runs (1.6×) and jumps; a car (2.4×) or bike (2.2×) drives fast but cannot jump; a blob bounces. Walkers slide along the shore instead of walking into the sea.
- TAKE OFF (free on the planet) goes back to space.

### Drawing budget: 5 in space, 5 on the planet
Each player has 10 finished drawings per round: 5 in space (lobby drawings count here) and 5 on the planet. Every finished drawing counts: ship, controller, an added button, explorer, any redraw. Speculative calls, refused drawings and failed generations do not. Redraws are full redraws; there is no adding a part to an entity. The phone shows "3 OF 5 DRAWINGS LEFT"; at zero, drawing is closed for that world and the server answers "no drawings left". The budget resets every round.

### The space-to-planet transition
Landing and take-off are one continuous shot, never a cut, on the phone and on the big screen:
1. **Approach (0 to 1 s):** the camera swings behind the ship as it glides onto the pulsing landing ring; the controller fades to 20%.
2. **Entry (1 to 2 s):** the ship tilts nose-down into the atmosphere: heat glow, streaks, the stars fade to sky blue, a soft white bloom.
3. **Touchdown (2 to 3 s):** the bloom clears to the island seen from above, the ship settles into its bay, dust bursts.
4. **Step out:** the explorer appears next to the parked ship, and the phone slides in "draw what explores the planet" while the island is already live behind it.

Take-off plays it in reverse. On the big screen the camera director cuts to a landing as it starts.

### Hints: make people think
Hints guide without giving the answer away. The world hints first; then a riddle, then a sketch, and only then the answer. Each gate has two ladders: while the skill is missing, the hints point at the **drawing** (the part to draw on the entity); once it is unlocked, at the **button**.

| Gate | Stuck when | The part to draw | The button |
| --- | --- | --- | --- |
| Weapon (the boss) | within 150 m of the boss with no usable weapon | a gun or a cannon on the ship | SHOOT |
| Land | near the planet's landing range | landing legs or a parachute on the ship | LAND |
| Dig | next to a closed buried chest | a shovel or claws on the explorer | DIG |
| Drill | next to a chest locked in a rock | a drill on the explorer | DRILL |

- Timing (`rules.js`): a riddle after 6 s stuck ("X marks the spot. The treasure isn't on top."), a faint sketch on the pad 10 s later, the answer ("Draw DIG") with a ghost box to trace 15 s after that, or at once in `assists`.
- World hints, always on: the landing ring pulses as you approach, each X glints, rock chests glow along their seams.
- Riddles and sketches never write the button's name; any drawing or word that means the right thing works (SHOVEL, SPADE or a drawn shovel all mean DIG).
- Hints show only on the player's own phone, never on the TV and never in the lobby. A hint stops as soon as the player has both the skill and the button. The ghost box sits in the largest empty area of the pad.

### Scoring
Scores reset every round; the session leaderboard keeps stars (rounds won) and total points.

| Event | Points |
| --- | --- |
| Chest opened | +1500 |
| Boss last hit | +1000 |
| Kill a player | +200 (a bot: 0) |
| Destroyed (by anything) | −50 |
| Wreck a rival's parked ship | +150 |
| Rock / crystal rock | +10 / +50 |
| Hit by a rock | −30 |
| Run into a rival's mine | −30 |

**Steal:** a kill within 15 s of the victim opening a chest takes half that chest's points.

### PvP and mischief (ruthless, free-for-all)
- No teams. Ships fight in space and explorers on the island. Destroyed: −50, back in 3 s with a 2 s spawn shield, drawings kept. The phone shows a big card: who did it, the countdown, the points lost.
- Rivals can steal chest points (above), steal the boss's last hit, and wreck parked ships.
- While a player's draw sheet is open their ship hovers and cannot be hurt (at most 30 s).
- **Mischief skills**, each unlocked by drawing its part and pressed once:

| Mischief | Draw on your entity | What it does to a rival | Cooldown |
| --- | --- | --- | --- |
| EMP | a lightning bolt | their buttons swap places for 5 s | 20 s |
| Ink bomb | an octopus, a squid or an ink bottle | ink covers their screen until they wipe it off with a finger | 15 s |
| Tractor | a magnet | pulls them toward you for 1.5 s, into a rock if one is in the way | 12 s |
| Mine | spikes or bombs on the back | drops a mine behind you (45 s); whoever touches it is stunned and loses 30 points | 10 s |
| Decoy | a second, smaller copy of your entity | a fake you for 8 s that draws fire, the boss's too; the shooter learns they were fooled | 18 s |

- EMP, ink and tractor hit the nearest human rival in the same world within reach (150 m for EMP and ink, 120 m for the tractor; a quarter of that on the island). Never a bot, and never anyone in the lobby, landing, taking off, dead, invisible or spawn-shielded. With nobody in reach the phone says so and the cooldown is not spent.
- The victim's phone plays the effect, every screen shows a burst on the victim, and the kill feed says who did it. A mischief kill (a mine, a pull into a rock) counts as a kill.

### Bots
`node server.js --bots N` adds up to 32 scripted ships for tests and small groups. They are fillers: each counts 0.25 of a player for the boss's HP and the chest count; they fly to the boss and make attack runs on it; they never start a fight with a human and only shoot back at a human who hit them in the last 10 s; they never land or take a chest, and mischief never targets them. Killing a bot pays nothing, and a bot's last hit on the boss pays the human who did the most damage.

### Views
- **Phone:** your own entity, third-person chase by default, cockpit as a toggle. Sol's controller sits on top. The HUD keeps to the top edge: objective and time left in the middle, the radar top right, HP, SHIELD and BOOST bars top left, the drawings-left counter. A locked control explains itself when pressed ("🔒 BOOST · draw an exhaust with fire on your ship"); a control cooling down greys out with a countdown. Short chips announce big moments (boss down, a chest opened, a steal, your kill).
- **Big screen = spectator TV, not playable:** the lobby shows a big join QR (from `GET /info`), the players with their ships, START and the session leaderboard. In play, a camera director follows humans first and cuts to the big moments (a landing, someone digging or drilling, the boss's last 20%). Kill feed with icon chips, name tags for all 25 (shrinking to a name or a dot in a crowd), the map, time left, chests left, the followed player's death panel. The results fit 25 players at 1280×720 to 1920×1080, with one winner.

### Look and HUD: Fortnite style (section 0)
- **3D:** bright, saturated and cartoony, chunky flat-shaded rocks, plush drawn entities, bloom on everything that glows, long engine trails, a cyan hex shield bubble. `assets/reference/world-look.png` sets the composition and palette.
- **Colour meaning:** red is hostile (the boss and its shots); cyan is yours (shield, meters, your arrow on the radar); each player keeps one of the 25 player colours on their ship, trail, bullets and name tag.
- **UI:** headings in Bebas Neue or Barlow Condensed 800 italic, body in Barlow; white text with a dark outline; chunky slanted panels and buttons in blue, purple and gold; pop-ins and bounces. Text sits on an outline or a scrim so bright scenes never wash it out.
- **Copy:** every screen answers "what do I do now?" in at most two short lines, with numbered steps and one example image per drawing step. The same words everywhere: SHIP (or EXPLORER on the planet), CONTROLLER, BUTTON. No internal names. The strings live in one COPY table per page (`controller.html`, `space.html`, and `HUD_COPY` in `render.js`). The HUD never names the button that solves a gate; hints do that, on the player's own phone.

### World look (reference: `assets/reference/world-look.png`)
A dense, deep, saturated space battle:
- **Depth:** hundreds of small chunky rocks in the middle and far distance, a few huge ones drifting close to the camera.
- **The boss is huge:** mothership-scale against the ships, grey armour with red glowing lights, seams and a pulsing red core. It reads as THE enemy from anywhere on the map.
- **The planet is in view from the start:** big, Earth-like, with clouds, oceans and night-side city lights.
- **Light and colour:** blue, violet and magenta nebula clouds, bloom on every engine, red streaks for hostile fire, a player-coloured trail behind every ship.
- **Later (not v1):** small hostile drones around the boss, for PvE.

### Performance: iPhone first
The game must run perfectly on an iPhone in Safari. That is the target device, and it is measured, not assumed.
- **Targets:** 60 fps on iPhone 12 and newer; never below 30 fps on iPhone XR or 11. The big screen holds 60 fps on the host laptop. These must hold with 25 players.
- **Phone budget:** at most 80 draw calls and 120k triangles, pixel ratio at most 2, textures at most 1024 px and 48 MB in total, 12 ms of CPU per frame. No shadow maps or reflection passes on phones. Rocks are instanced, static geometry merged, fog limits the draw distance.
- **Big screen budget:** at most 120 draw calls with 25 players. Full meshes only for the nearest ships (and every human); far default ships draw only their hull.
- **Adaptive quality:** a governor watches the last 60 frames. When the 90th-percentile frame time goes over 20 ms it drops one step (pixel ratio 2 → 1.5 → 1.25 → 1, then bloom off, then far rocks off); after 5 s under about 19 ms it steps back up. A steady 30 Hz screen is not stepped down.
- **iOS specifics:** `viewport-fit=cover` with safe-area insets; `touch-action: none` and no double-tap or pinch zoom; full screen from the home screen; a "turn your phone sideways" prompt; motion permission through `DeviceMotionEvent.requestPermission()` on a tap (needs HTTPS); `navigator.vibrate` does nothing on iOS; handle `webglcontextlost`; stop drawing while the page is hidden; WebAudio unlocked on the first tap.
- **Measurement is built in:** `?perf` shows an overlay on any screen (fps, 1% low, frame ms, draw calls, triangles, quality step). Every screen posts a sample to `POST /perf` every 5 s; the server appends it to `perf.log` and prints one line per device. `node perf-report.js --since 10m` checks each device: phones need an average of 55 fps or more, a 1% low of 30 or more, at most 80 draw calls and 120k triangles; the big screen 58 fps or more.
- **Network:** ticks at 15 Hz with compact arrays, under 8 KB per tick with 25 players (about 5.5 KB measured), one event stream per screen, private messages only to their player's stream.

---

## 5. Skills: one list of verbs

Every button maps to a **verb** (a skill), and the engine implements each verb once, with settings. `verbs.js` is the list.

**A skill needs the drawn part and the button.** The drawing grants the power; the controller button triggers it. A plain ship only flies. Pressing a button whose skill is not drawn does nothing, and the phone explains what to draw. Sol reads the entity drawing and returns the drawn parts and the skills they unlock.
- **What each type does by itself:** a ship flies; a person walks and jumps; a car or bike drives; an animal runs and jumps; a blob bounces and jumps. TAKE OFF is free on the planet. Everything else must be drawn.
- **Sol is generous:** an unclear part unlocks the closest skill, and a part that could be two things unlocks both. Ordinary eyes and helmet visors unlock nothing; a blank drawing is refused and costs nothing.
- **The unlock card** after every entity drawing lists what it can do and why: "Your ship can: fly, shoot (cannon), boost (flames)".
- **Without a model answer** (`ASTRA_MOCK=1`, no key, a timeout) the entity gets the dev kit so the game stays playable. Space: shoot, boost, shield, land, scan, flare, EMP, mine. Planet: dig, drill, shoot, shield, scan, flare, ink bomb, tractor.

| Skill | Draw this on your entity | Where | Notes |
| --- | --- | --- | --- |
| Shoot | a gun, cannon or laser | both | a weapon: hurts the boss |
| Boost | an exhaust with fire or flames | both | the real speed-up |
| Shield | a shield or a bubble | both | |
| Land | landing legs or a parachute | space | the planet gate |
| Dig | a shovel or claws | planet | buried chests |
| Drill | a drill or a saw | planet | chests locked in rocks; ships never drill |
| Jump | legs or springs | planet | innate for walkers; cars and bikes cannot jump |
| Drive | wheels (draw a car or a bike) | planet | |
| Scan | an antenna, a radar dish or one big eye | both | shows extra things on your radar |
| Flare | a lamp or a torch | both | a bright light everyone can see |
| Invisible | a cape or a ghost | both | |
| Heal | a red cross | both | |
| Blast | a bomb | both | a weapon: one big explosion in front of you |
| Teleport | a portal or a magic wand | both | |
| EMP, ink bomb, tractor, mine, decoy | see Mischief (section 4) | both | the five mischief skills |

Shapeshift, fly (on the planet), swim and grapple are defined in `verbs.js` but no drawing unlocks them yet.

Movement is always available: sticks, arrows and tilt mean turn, pitch, thrust, brake, strafe, rise and sink.

### `verbs.js` format
Each verb has `modes` (space, planet), `hold`, `params` (`[min, max, default]`, clamped), `hint`, and:
- `requires: {moves, sockets}`: who can use it.
- `slot`: the generic animation intent, one of move, look, jump, primary, secondary, use, defend, interact, mount, emote, hit, die.
- `synonyms`: button labels that mean it.
- `tags`: what obstacles check.
- `cost`: for a later power budget of 10 points per entity (not enforced in v1).
- `grantedBy` (mischief) and `label` (how players read it, "INK BOMB").

Next to the verbs: `INNATE` (what each type does by itself), `SKILLS` (what a drawing can unlock in each world), `PARTS` (what to draw for each skill, used by the refusal tips and the hints), `GATE_SKILLS`, `MISCHIEF` and `DEV_KIT`.

```js
dig: {
  modes: ["planet"], hold: true,
  params: { speed: [0.5, 2, 1] },
  hint: "shovels, spades, claws",
  requires: { sockets: ["hand_r", "hand_l", "mouth", "front"] },
  slot: "use",
  synonyms: ["DIG", "SHOVEL", "SPADE", "CLAW", "SCOOP", "EXCAVATE"],
  tags: ["dig"],
  cost: 2,
},
```

### More verbs, same format, after v1
- **Movement:** hover, roll, sprint, crouch, dodge, climb, glide, jetpack, sail.
- **Attack:** missile, scatter, melee, throw.
- **Defence:** block, smoke, heat shield, armour.
- **Tools:** cut, build, tow, bait, fish, plant, freeze, fire.
- **Sensing:** binoculars, map, companion.
- **Interaction:** pick up, push, revive, repair, horn, eject.
- **Meta:** emote, ping.

Some labels already map to existing verbs: FIRE = shoot, WIN = blast, LIGHT = flare, CLOAK = invisible, WARP = teleport.

---

## 6. Entities: drawn look and generic rigs

### Look
- The drawing itself becomes the 3D body, on the device, in about 100 ms (`inflate.js`): a distance transform inside the silhouette gives each pixel a height, so living things are round like plush toys. Machines are extruded with a bevel instead.
- The drawing is the front texture; the back is mirrored and darker. No model call for looks.
- The phone shows the 3D result turning, with the unlock card, right after each entity drawing; every screen builds it once per drawing and caches it.
- A parked ship on the island shows its owner's ship drawing.

### Entity types
In play: **ship** (space) and, on the planet, **person**, **car**, **bike** (uses the car rig), **quadruped** (animals) and **blob** (the fallback). `rigs.js` holds 10 templates; boat, flyer, swimmer, crawler and serpent are for later.

| Type | Zone | Moves | Skeleton | Sockets | Procedural motion |
| --- | --- | --- | --- | --- | --- |
| ship | space | fly6dof | none, rigid | nose, wing_l, wing_r, back, belly, seat | banking, engine flame |
| person | planet | walk | 19-bone biped | hand_l, hand_r, head, back, feet | foot planting |
| quadruped | planet | walk, rideable | spine, 4 legs, neck, head, tail | mouth, back (seat), tail | gait cycle |
| car | planet | drive | rigid; wheels from drawn circles | seat, roof, front, back | wheel spin, suspension, steer tilt |
| boat | planet water | float | rigid | seat, mast, bow, stern | buoyancy bob, wake |
| flyer | planet | fly | wing chains for animals, rigid for machines | seat, nose, wing_l, wing_r | flap or propeller spin |
| swimmer | planet water | swim | 6-bone spine | mouth, back (seat) | body wave |
| crawler | planet | crawl, walls too | body plus a 2-bone chain per leg | mouth, back, front | leg IK |
| serpent | planet | slither | 8-bone spine | mouth, tail | spine follows the path |
| blob | both | bounce | none | centre, top | squash and stretch (fallback) |

```js
// One template per type. Adding an 11th type is one entry.
{ type, zones, moves, joints /* 2D points Astra places */, bones /* [bone, parent] */,
  sockets /* socket -> bone */, body /* "inflate" | "extrude" */, skin /* "smooth" | "rigid-parts" | "none" */,
  procedural, slots /* slot -> this type's clip or effect */ }
```

Bone, socket and node names are lowercase with underscores (`hand_r`, `socket_seat`): three.js strips dots from animation track names, so `hand.R` would silently break clips. The full bone lists are in `ORCHESTRATE.md` section 4.

### Rigging, the same steps for every type
1. The entity call returns the type, the joints its template asks for, each drawn part with its place, and the skills.
2. Snap joints to the ink's medial axis. On a bad fit, place joints by bounding-box proportion, or fall back to blob.
3. Build the body (inflate or extrude), then the bones from the joints. Rigid types are cut into parts instead.
4. Skin weights: each vertex to its 2 nearest bones by distance to the bone segment.
5. Attach drawn items to their socket as `Object3D` children, so a gun in `hand_r` follows the animation and its effects start there.
6. One `AnimationMixer` per entity: a locomotion layer blended by speed, an upper-body layer for one-shots, procedural motion on top.
7. Clips are rotation-only keyframes on template bone names, so any clip plays on any proportions.

### Animations: Astra wires them too, and they must feel great
When Astra wires an entity it also wires its **animations**: for every skill the entity has, the slot's clip and a **motion profile** (anticipation, overshoot, easing, squash and stretch, secondary motion, hit-stop, camera shake, effect timing). The wired entity carries `anims: { slot: { clip, profile, fx } }`; `render.js` plays it through `anim.js`. The table lives in `anims.js`, shared by the server and the browser.
- **Ship:** hover bob at idle, banking into turns, boost (stretch, flame surge, a small field-of-view kick), shoot (recoil, muzzle flash), shield (bubble pops in with overshoot), hit (knockback, white flash), death (spin-out, explosion, debris), respawn (warp-in), flare and scan pulses. Landing and take-off are the transition shot (`transition.js`).
- **Explorer:** breathing idle, walk and run with bob and lean, jump (crouch, stretch, landing squash, dust), dig and drill loops (dirt, sparks), shoot, hit, fall on death, respawn, a celebration when a chest opens, stepping out of the ship.
- **Rules:** every animation reads clearly at phone size, costs under 0.2 ms per entity per frame, allocates nothing per frame, and works on default meshes without bones (procedural motion on parts) and on rigged entities (clips by slot).

### Later: mounts and selfies
- **Mounting** would parent the rider to the mount's `seat` socket; the mount's skills take over the controller and the rider keeps `primary`.
- **A selfie** would go on the `head` socket, or on a ship's cockpit glass.
- **The server never simulates bones:** one capsule per entity, sized from the ink. Clients animate from `action`, `slot` and `startedAt`.

---

## 7. Controllers: generic binding

The controller is always its own drawing, separate from the entity. Binding a drawn control to a skill is code, not a model call.
- A control binds by **label** (the verb's `synonyms`) and by **kind**: a stick feeds move or look; a button or toggle feeds a skill; tilt steers whatever moves.
- **On every entity switch** (land, take off, redraw) the same controller re-binds in under 5 ms:
  - skill drawn on this entity: live;
  - not drawn: locked, with the reason ("🔒 BOOST · draw an exhaust with fire on your ship", "🔒 DIG · only on the planet");
  - drawn on the entity but no button: a tip ("New power: tap + to draw a button for DIG").
- **On the planet** the space controller is kept; a prompt suggests a redraw with DIG and DRILL buttons ("KEEP MY BUTTONS" or "REDRAW").
- **Never stuck:** a layout with no way to steer gets a steer stick; the left stick always moves and the right stick always looks, whatever their labels.
- Pressing a skill that is cooling down shows when it is ready ("EMP · READY IN 12 S"). Holding a control for a moment says what it does, the first few times.

---

## 8. Obstacles you solve by drawing

**v1, every round:** four gates, each solved by drawing a part on the entity and a button on the controller: a **weapon** for the boss, **LAND** for the planet, **DIG** for buried chests and **DRILL** for chests locked in rocks. Nothing else.

**After v1, once rounds feel good:** at most one random twist per round, each solvable in 20 s or less, picked from:

| # | Twist | Draw |
| --- | --- | --- |
| 1 | Black hole pulling you in | REVERSE / ANCHOR / a hook |
| 2 | Asteroid storm too dense | TELEPORT / WARP |
| 3 | Space pirate wants a password | write the password |
| 4 | Fuel runs out | REFUEL / SOLAR SAIL / a tow from another player |
| 5 | Frozen comet in the way | HEAT / FIRE |
| 6 | Mirror maze reflects shots | CLOAK / a harpoon |
| 7 | Gap only a tiny ship fits | SHRINK / redraw a smaller ship |
| 8 | Crate too heavy alone | TOW / CABLE (two players) |
| 9 | Alien that only reacts to music | HORN / MUSIC |
| 10 | Treasure under water | DIVE / a boat |
| 11 | Space whale blocks the way | FEED / bait |
| 12 | Gravity flips | FLIP |
| 13 | Door with two locks | KEY ×2, pressed together |
| 14 | Gate locked with a symbol (△ ○ ☆) | that symbol |
| 15 | Turret field around the planet | CLOAK / DECOY |
| 16 | Re-entry burn | a heat shield under the hull |
| 17 | River gap on the island | a bridge or plank |
| 18 | Cliff | a ladder, rope or jetpack |
| 19 | Jungle wall | a machete or saw |
| 20 | Boss immune until it's "sad" | JOKE / HUG |

---

## 9. How it is built: playable versions

The game grows in **playable versions**: each one runs end to end, is better than the last and adds more, until it is AAA-polished (section 0). `VERSIONS.md` records each version: what changed, the checks with numbers, the videos and the decisions.

**Tracks:** each version is built by a few parallel tracks (server and simulation, phone, render and world, big screen, generation), each owning its own files and working against `contract.js`. The rules every worker follows are in `.orch/CONTRACT.md`; each keeps notes in `.orch/progress/<label>.md` and `dev/<track>/`.

**The gate for every version:**
- The unit suites pass: `node dev/astra/astra-test.js`, `node dev/astra/gen-regression-test.js`, `node dev/astra/vocab-test.js`, `node dev/astra/anim-wire-test.js`, `node dev/netcode/sim-test.js`, `LIVE_PORT=8222 node dev/netcode/live-test.js`, `node dev/rules/rules-test.js`, `node dev/inflate/astra-entity-test.js`, `node dev/https/test.js`.
- A full round on both routes with 24 bots: `node dev/e2e/run.mjs --route expert --bots 24` (wins the round with the boss down early) and `--route regular` (waits for each hint, still opens a chest before 4:00). One WebKit phone (iPhone 13 landscape) and the big screen, against the real server with mock generation. Messages valid, a skill unlocked by drawing, no console errors, the phone perf budget.
- Videos of both routes in `videos/<version>/`; then an end-to-end test by the tester (`TESTING.md`) and a playtest panel.

| Version | What it brought |
| --- | --- |
| v1.0 | The first integrated round: boss, planet, landing shot, island, chest; riddle hints; animations; delivered assets |
| v1.1 | Section 0's round: lobby with START, 4:00 rounds on points, session stars, two drawings with skills from drawn parts and the unlock card, buried and rock chests, planet entity types, the Fortnite look, 25 players, synthesized sound |
| v1.2 | Sol writes the controller page (sandboxed), the five mischief skills, the drill on the planet only, the death card, one sound engine, a TV that fits 25 players, robustness fixes |
| v1.3 (building, Oct 10 morning) | Clearer phone flow and copy, a readable HUD and PvP feedback, the unlock card on every screen, fairer ruthless PvP, the spectator TV, the world look with the delivered assets and effects, cinematic transitions, these docs |
| Later | Toward AAA: the remaining rig types, mounts, round twists (section 8), PvE drones |

**Rule:** every version must play a whole round end to end before more skills, types or twists are added.

---

## 10. Decisions made

- **Island:** full 3D.
- **OpenAI model:** always `gpt-6.1-sol`, Responses API, `service_tier: "ultrafast"`; never `gpt-6-astra` or another model. The only fallback is `gpt-6.1-sol` on its default tier.
- **A simple world, rich players:** the four gates (weapon, LAND, DIG, DRILL), two rock types, no twists in v1. The nebula is decoration only.
- **Drawing input:** a photo of the drawing on paper by default; drawing on the phone as the backup.
- **Decisions taken overnight** (Oct 9 to 10) while the owner slept are logged in `VERSIONS.md` ("Decisions taken overnight"): bots as fillers, the boost and FORWARD speeds, +150 for a wreck, what unlocks SCAN, generous unlocks, blank drawings refused.

**Open questions for the owner:** none open; the 10 October 09:05 answers are in section 0.

## 11. Risks and notes

- **API key:** read from `OPENAI_API_KEY` or a git-ignored `.env`. Never hard-code it, log it, or send it to the browser. A key pasted into a chat or channel must be rotated.
- **Static files:** the server serves only its allowlist of public files and `assets/`. `/.env`, `/controllers/…`, `/server.js` and the private modules (`astra.js`, `world.js`, `rules.js`…) must answer 404.
- **Sol's controller page is untrusted code:** it runs only inside the sandboxed frame, and the phone accepts only allowed actions at a capped rate. The template is always there as the fallback.
- **Round length:** if playtests run long, tighten the distances first, then the boss's HP and the chest spread (all in `contract.js`).
- **Photos of paper:** lighting, lined paper and perspective vary; the phone crops and thresholds before sending, and "Retake" or the DRAW toggle is one tap away.
- **HTTPS:** tilt and the camera need it. The certificate is self-signed, so each iPhone accepts it once ("Show Details" → "visit this website"). Fallback: a tunnel with a real HTTPS address (`node https.js --tunnel` prints the command), and sticks instead of tilt.
- **Bad joints from the model:** snap to the ink, sanity-check limb lengths, fall back to proportional joints or the blob type.
- **iPhone performance** with 25 players is the main technical risk: every render step is checked against `perf.log`. The harness numbers come from WebKit on a Mac emulating an iPhone: a proxy until a real iPhone is measured.
- **Generation speed and cost:** aim for under 3 s per drawing, most of it hidden by the speculative call. Cache by drawing hash; show a "reading your drawing…" state.
- **No login:** anyone on the Wi-Fi can join. A device token keeps a second phone from taking a name in use. Fine for a party, not for anything public.

## 12. Run it

```
PORT=8000 HTTPS_PORT=8443 node server.js [--bots N]
big screen: http://<laptop-ip>:8000/space.html
phones:     scan the QR on the big screen, or open https://<laptop-ip>:8443/controller.html
```

`README.md` has the details: the `.env` key, offline mode (`ASTRA_MOCK=1`), the iPhone certificate step and the tests.
