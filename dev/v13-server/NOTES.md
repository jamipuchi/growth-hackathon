# v13-server: what changed for the client tracks (Oct 10 morning, implement-only round)

All changes are additive: every message type and field the clients read is unchanged.

## Wire fields (new)
- `entity.card` (string, at most 200 chars): the unlock card in plain words, the same everywhere, built by
  `Verbs.cardOf(type, unlocked)` (verbs.js): "Your ship can: fly, shoot (cannon), boost (exhaust flames)",
  "Your explorer can: walk, jump, dig (shovel)", "Your car can: drive". On every `entity` message, on the connect world
  message's `entities`, and on POST /generate answers for ship / explorer. Assist-granted skills are not in it.
- `world.island.parked[].image` (string URL, optional): the owner's ship drawing (`/drawings/<player>-ship.png?v=<hash>`).
  A TV that connects after a player landed shows the drawn parked ship. Re-sent (a world message) when a landed player
  redraws the ship.
- POST /generate answer `fallback: true` (optional): Astra could not answer a finished ship / explorer at all, so the
  server gave the generous dev kit (source "devkit") wearing the player's drawing. The drawing counts as spent.

- `hit` (new personal message, only to the victim's screens, like toast / mischief / cooldown):
  `{ type: "hit", player, from, dir, amount }`: from = the attacker's name or "boss"; dir = where the attacker is on the
  victim's screen (radians, 0 = right, π/2 = up, the tractor convention); at most 4 per second per victim. Drives the
  phone's hit marker. (Sent by world.js; see contract.js once the world sub-worker lands it.)
- Victim toasts (kind "info"): chest points stolen, boss kill stolen, parked ship wrecked ("draw a new ship to take off").

## Server behaviour (new)
- A finished ship / explorer drawing never fails silently: refusals ("looks like a controller", "nothing to read") and
  bad requests keep their plain `message`; anything else (Astra not loaded, threw, timed out, an unknown error) answers
  `{ ok: true, entity: <dev kit + card + anims>, fallback: true }` and keeps the drawing image.
- No ghost players: POST /input for a name that never joined answers **409 `{ ok: false, error: "join first" }`** and is
  dropped (phones: POST /join again with the saved name and device token). Exception: a name whose own event stream is
  open (`/events?player=<name>`, render.js does this) is re-joined automatically, so phones survive a server restart.
- POST /generate from a name that never joined (with an image) joins it first; 400 "the game is full" when full.
- Name-to-device binding (additive): /input messages and /generate bodies may carry `device` (or `token`), the same
  random token the phone sends to /join. A token that differs from the one bound to that name answers
  **403 `{ ok: false, error: "name taken" }`** (/generate adds `message`). Without a token, requests work as before.
  A bot's name is never usable from a phone (403).
- POST /generate passes `where` ("space" | "planet", the player's world) to Astra: the mock and the button reading pick
  the button that world needs (no LAND on the planet).

## Generation (astra.js, astra-html.js)
- Every finished ship / explorer answers an entity (model, else the dev kit) or a plain refusal ("looks like a
  controller", "nothing to read"); a throw anywhere in Astra → the dev kit. anims.js is loaded lazily and guarded.
- Explorer types: two legs → person, four legs → quadruped, bicycle / motorbike / scooter → bike, anything on wheels or
  tracks → car, everything else (and a spaceship drawn as the explorer) → blob. All six types are built by render.js.
- ASTRA_MOCK=1 buttons answer `expect`, else the first missing skill of the player's world (space: land, shoot, boost;
  planet: dig, drill, shoot). Controller / button refusals always carry `thing` (default "object").
- Controller HTML (template and Sol's prompt): every control's top edge stays below the phone HUD band
  (`--hud: clamp(72px, 26vh, 116px)`); a control drawn up there slides down just enough. New icons for the mischief
  skills; an unlabelled control shows the game's word ("INK BOMB"). world.js ghost boxes start below the band too.

## World (world.js, rules.js, contract.js)
- Owner decisions (PLAN.md section 0, 10 Oct 09:05), server side:
  - Time to the boss stays ≈ 60 s cruising / ≈ 40 s holding BOOST (bossDistance 1100). The round grows after the
    boss: boss.hp 2400 → 3000, planet.offset 600 → 800, digSeconds 2 → 3, drillSeconds 2.5 → 3.5, chestSpread
    40 → 48, worldRadius 2000 → 2200 (planet ≈ 1900 m), rockCount 320 → 340. Expected: expert ≈ 2:50, regular hits
    the 4:00 cap, 25 humans open all 20 chests ≈ 3:00 (arithmetic in contract.js). Bots never land: chests are humans'.
  - No free skills at 3:00: assists only make the chests glow and jump every hint to "draw X" (entity.assisted is
    never set any more).
  - Ink bomb: mischief `seconds` 10 = the safety fade; it stays until wiped (contract check: inkbomb ≤ 10 s).
  - 3-2-1 countdown as a real server phase: `POST /start { countdown: true }` → tick phase "countdown" (in
    Contract.PHASES), clock = seconds left (ROUND.countdownSeconds 3), ships frozen on their slots, then "playing"
    (announce "Round N: REACH THE BOSS", every ship gets its spawn shield). A plain POST /start starts at once (the
    TV's own 3-2-1 keeps working until it switches).
  - Player cap 25, humans and bots together: a joining human takes the newest bot's seat (the bot leaves the round);
    25 humans → /join 400 "the game is full". `--bots` is capped at 25.
- Spawn: a sunflower disc of radius `spawnRadius` 130 m across the line to the boss (25 ships ≈ 40 m apart, facing the
  boss, humans on the inner slots); respawns ≥ `spawnClear` 35 m from other ships; `flags.spawnShield` from every
  spawn until the player gives any input or uses a skill, at most `spawnShieldSeconds` 8.
- Scores never go below 0. tick.players, world.entities and result.scores list humans first, then bots; a bot only
  wins a round with no humans (result.winner = scores[0] when it has points).
- Ruthless: chest steals only by human killers (victim toast), "X stole the boss from Y" (+ toast to Y), wreck toast
  "bob wrecked your ship: draw a new ship to take off"; mine / decoy drops announced; EMP / ink / tractor skip a rival
  already under that effect; protected ships pass through rocks and drop a tractor.
- Destroyed rocks are never replaced during a round (render.js hides removed rocks without a rebuild: finding #15).
- Explorer spawns need a straight dry walk from the landing spot (finding #17). Parking bays are picked when the
  landing starts (lowest free), so tick `bay` = the parked entry.
- Hint ghost boxes stay below the HUD band (rules.js GHOST.top 0.3).

## Needed from other tracks
- v13-phone: send `device: DEVICE` in every /input message and /generate body; on a 409 from /input, POST /join again.
- v13-phone / v13-tv: may show `entity.card` as is (the phone already builds the same sentence from `unlocked`).
- v13-world / v13-tv: read `island.parked[].image` first for parked ships (render.js already does).
- v13-phone: the DOM fallback controls (#hits) and the faint ink overlay are placed full-frame; Sol's frame / the
  template now keep controls below the HUD band. Either apply the same band to #hits or accept the small offset.
- v13-phone: `hit` message → hit marker (dir); toasts kind "info" for stolen points / boss kill / wrecked ship;
  flags.spawnShield → shield aura (on from every spawn until the player moves or fires, ≤ 8 s).
- v13-tv: tick.players lists humans first (name tags / mesh caps keep humans); entity.card can be shown as is;
  result.scores and world.leaderboard list humans first. To use the server countdown: POST /start { countdown: true }
  and drop the local 3-2-1 (space.html preStartCountdown); show phase "countdown" from tick.clock. The `?kb` debug
  keyboard player must POST /join again on a 409 from /input (after a server restart).
- v13-phone: phase "countdown" (tick.clock = seconds left) → the same 3-2-1 as the TV; GO on countdown → playing
  (today showGo() only fires on lobby → playing). Ink: keep it until wiped, fade by itself after `seconds` (10).
- v13-world (render.js): end the landing shot on the tick's `bay` (p.bay, sent while landing / taking off) instead of
  bay(index): the server prefers that same index but falls back to the lowest free bay when it is taken.
- v13-world (render.js): world.radius is now 2200 (was 2000) and the planet sits ≈ 1900 m from spawn; the spawn disc
  spans ±130 m (TV framing of the start).
