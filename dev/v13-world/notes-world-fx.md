# world-fx notes (v13-world lane, render side): A-010 effects, hex shields, boss flash, draw-call caps, sample pooling

Owner: world-fx sub-agent. File: render.js only (my regions). Implement-only round (Oct 10 morning): the only check is
`node --check render.js` (OK after every edit, last at the end). NOT tested in a browser (owner: implement first).

## Done (render.js, by function / area)
1. ASSETS.fx (appended): `import(assetUrl("A-010-fx/fx.js"))`, through loadAsset (null + warning on failure).
2. class WorldFx (new, right after RingPool): one A-010 system per world scene, built lazily from ASSETS.fx with
   `createFxSystem({scene, seed, maxParticles, maxRings, maxShields, maxEmitters: 0, maxLights})` (signature checked in fx.js:187).
   - Pools: phone 448 particles / 12 rings / 26 shields / 0 lights; TV 1024 / 24 / 32 / 1 light. No boost emitters (streak trails stay).
   - `ok` (false until loaded: every caller keeps its ad hoc Particles / RingPool path), `size(p, base, cap)` (base x clamp(d / ref, 1, grow)
     so effects read on the TV, capped at cap x camera distance), `toCam(p)`, `spawn(kind, p, s, color, dir, duration)` (try/catch, one
     warning), `later(...)` (delayed spawns: the boss chain), `shield(view, x, y, z, s)`, `update(dt, t)`, `clear()`.
   - Hidden scene: only the world on screen is updated by the frame loop; a world whose update comes back after > 0.5 s drops all its
     effects / bubbles / pending spawns (README: paused effects would resume otherwise).
   - TV light: A-010's flare light is kept visible at intensity 0 (it hides it between flares) so the PBR light-count shader variant is
     compiled once at load, never at the first flare. Phone: maxLights 0.
3. SpaceWorld: constructor appends `this.efx = new WorldFx(this, "space")`; update() ends with `this.efx.update(dt, t)` (after the ships
   asked for bubbles); clearForRound() calls `this.efx.clear()`.
   SpaceWorld.fx(m): A-010 when loaded (mischief kinds and `crack` keep their old paths; worldSound.fx / this.mischief.fx untouched):
   explode small (<4, A-010 size 0.6 x m.size) / medium (<12, 0.5 x) + a small debris burst in m.color (A-010 has no colour identity);
   large (>= 12 = the boss, size 30): explosion_large at the core + a chain of 6 (TV) / 3 (phone) medium blasts over the hull
   (radius TUNING.boss.radius x BOSS_HULL_K x 0.8) over ~1.3 s via WorldFx.later; flash bump kept. blast (size range/12, player colour),
   flare (A-010 flare, size <= 2.5, + `this.nebulaFlare?.(pos, strength)` strength = size / TUNING.flare.radius in 0.15..1, called in both
   paths), scan (rings to 8 x size, size capped 0.15 x distance: still fly past the screen edges like the old 250 m ring), drill, respawn
   (scan rings in the player colour), land (a ping in the player colour: dust makes no sense in space), hit / spark / default (drill sparks
   in m.color). Rings face the camera, sparks fly at it (toCam). Fallback explode: puff sizes clamped at size 6 (was 78 m puffs at 30).
4. IslandWorld: constructor appends `this.efx = new WorldFx(this, "planet")`; update() ends with `this.efx.update(dt, t)`;
   clearForRound() clears it. IslandWorld.fx(m): dig (A-010 dig at ground + 0.2), drill (sparks up off the boulder, y + 0.9), treasure
   (A-010 gold at the lid's height y + 1, the delivery's depth-test warning, + a flat gold scan ripple), land (landing dust), explode
   (A-010 explosion at body height, size 0.35 x m.size, + 14 colour sparks), respawn (flat scan rings in the player colour), flare (size
   <= 1.2: light <= 100 cd on the TV), scan, blast, hit / spark. Rings lie flat (normal up). Old chain kept verbatim as the fallback.
5. ChestField.sync chest-open burst: skipped when A-010 is loaded (the server's `treasure` fx of the same pickup draws the gold; world.js
   pickup() always sends both), kept as the fallback otherwise.
6. Hex shields: ShipView / ExplorerView `this.shield.visible` lines now ask `efx.shield(...)` (A-010 batched hex bubble, ONE draw call for
   all; the SHIELD_MAT meshes stay as the fallback until A-010 loads, hidden once it has). No bubble for an invisible rival (my own stays),
   in my own cockpit, or in a landing dive. Ship bubble radius 2.6 (size 1.04 x group scale; respawned if the scale changes > 40 %, e.g.
   the lobby showcase); explorer bubble = round, radius 1.25 x the type's largest shield axis, centred at the type's shield height (the
   per-type ellipsoid shape of the old mesh becomes a sphere). Handles: a view that does not ask in a frame (dead, impostor / dropped,
   transit shot, disposed, flag off) is stopped in that frame's efx.update(); slots recycled or cleared are detected (handle.active,
   checked every 16 frames) and respawned. startShot's `owner.shield.visible = false` still works (the mesh object is kept).
7. Particles / BillboardBatch: new `maxAng` option / `uMaxAng` uniform in BB_VERT; Particles use 0.5: a puff never spans more than half
   its distance (~14 degree half-angle) however big it was emitted (other batches: 0 = off, unchanged).
8. Frame loop flash lines: `flash` eased with smoothstep, bloom dim 0.65 -> 0.7, exposure dim 0.3 (unchanged).
9. Caps: FAR_PARTS 70 -> 45 (hull-only default ships beyond 45 m, hysteresis 36 m); TV ship mesh cap in play 16 -> 12 (lobby 30, phone 8);
   new `lodHumans(items, cap)`: the TV used to FORCE every human's mesh (25 humans = 25 meshes x 3 calls, unbounded); now the nearest
   humans are forced up to the cap (a human that already has a mesh counts 25 % closer), the rest compete with the bots. Same on the
   island TV (explorer cap 14). Phone decoy cap left at 3 (not needed, see the table).
10. Snapshots.sample() pooled: one result object, its players / bullets / bossShots arrays, one interpolated player object per name
    (stale keys deleted, then Object.assign of the tick player, then the interpolated fields), bullet rows (9 long with a direction, 6 long
    when new, separate pools) and boss-shot rows by index; a new boss shot is still the tick's own row; mines / decoys use a frozen empty
    array when absent. Decoys stay fresh arrays: MischiefLayer keeps a vanished decoy's row (v.q) 0.4 s to fade it out. The empty case
    returns one pooled empty result (no phase key, as before). Consumers checked: SpaceWorld / IslandWorld / ShipView / ExplorerView /
    MischiefLayer (players in-frame; v.q decoys -> unpooled), WorldSound (names, ids, numbers only), CameraRig (focus = a name),
    computeHud (copies values; flags are tick objects, not pooled), projectPlayers (reads game.lastSnap in-frame; flags from the tick),
    startShot / shotSubject (in-frame), pages via game.hud() / projectPlayers() (no direct sample access), dev/e2e (no lastSnap use).
    Nobody mutates a sample or compares samples by identity.

## Budget table (by construction; baseline = measured v1.2, dev/v12-client/notes-render.md)
| tier / scene | v1.2 measured max | new bounds this round | worst case now | budget |
| --- | --- | --- | --- | --- |
| TV space, boss fight (calls) | 115 (post ~14; ~17 ship meshes x 3 = ~51 incl. 2 humans; rest ~64) | ships <= 12 meshes x 3 = 36 (was 16 + every human); A-010 +3; A-002 foreground +1; A-003 nebula 0 (replaces puffs); shields 0 (in A-010's batch, were 1 per bubble); fewer RingPool rings (A-010 took scan / respawn / blast / explode / flare rings) | ~64 + 36 + 3 + 1 = 104 (116 before A-010 loads with 12 old shield meshes) | 120 |
| phone space, boss fight (calls) | 60 (post ~20) | ship cap 8 x 3 = 24 unchanged; A-010 +3; foreground +1; A-007 cockpit +2 (cockpit view only); old shields (<= 8 calls) gone | 60 + 3 + 1 + 2 = 66 | 80 |
| phone mischief (calls) | 58 | same deltas, decoy cap 3 kept | 64 | 80 |
| phone space (triangles) | 70k | A-010 <= 448 x 2 + 12 x 2 + <= 9 bubbles x 720 = ~7.4k, replacing the old shield spheres (8 x 952 = 7.6k); + foreground rocks (256 each, count = world-assets) + cockpit (A-007) | ~70k + 0.9k + rocks + cockpit | 120k |
| TV / phone island | not measured in v1.2 | explorers TV <= 14 (humans no longer unbounded), phone 8; parked 10 / 6; A-010 +3 | unmeasured | 120 / 80 |

## Boss-death flash: the worst case, bounded by construction
- The white-out came mainly from SpaceWorld.fx `explode` size 30: 8 additive puffs 78 m wide (boost 4) + 50 puffs 48 m wide (boost 3.2):
  one such puff covers the whole view from anywhere within ~60-100 m. Now: A-010 blasts, each sized min(base x distance growth,
  0.06 x camera distance) when it goes off (fireball ~3 x size: within ~10 degrees of its centre), a chain instead of one giant; the
  fallback without A-010 clamps puff sizes at size 6.
- setBoss's own death burst (world-assets region, untouched): 90 + 40 additive puffs (5-7 m, boost 1.9). Bounded on screen by the new
  Particles maxAng (a puff <= half its distance wide) + the old nearFade. Its overlap at the core is a short (~0.3 s) flash, not a sheet.
  Suggestion for the world-assets agent / lead: drop it (or halve it) when `this.efx.ok`, since the fx explode now draws the A-010 chain.
- Bloom / exposure: dimmed 70 % / 30 % at the peak with a smoothstep ease over FLASH_SECONDS (2.5 s).
- Lights: the boss blast has none; A-010's flare light exists only on the TV, <= 70 x 2.5^2 = 437 cd (60 m range) in space, <= 100 cd on
  the island, decaying over 2.2 s.
- Residual (not boundable without editing assets/): A-010's particle shader has no near-camera fade, so a camera that flies INTO a blast
  after it spawned can sit inside its fading fireball for the rest of its 1.65 s. Needs the browser check ("mean canvas brightness after
  the kill must not stay near white").

## Assumptions / for the lead
- A-010 is imported from `assets/A-010-fx/fx.js` with the bare `three` specifier (page import map), like the other assets. The server
  must serve it (static assets/ path; other assets already load from there).
- TV only: one extra always-visible zero-intensity point light per scene (A-010's), so one shader compile at load; if warm() ran before
  A-010 loaded, the island programs compile once more at the first island view on the TV.
- Per-frame garbage left: A-010 itself allocates two small Vector3 per shield setPosition (only for moving shielded ships) and in
  handle.active; spawn() allocates per effect (events only). Decoy rows stay fresh (few).
- The explorer bubble is now a sphere for every entity type (was a per-type ellipsoid mesh).
- lodHumans changes a product rule on the TV (all humans always meshed -> the nearest 12 / 14); needed for the cap to hold by construction.

## Left
- Browser verification of everything above (calls / triangles per tier, the boss-death brightness, shield look, effect sizes on TV).
- Optional: A-010 boost emitter for boosting ships near the camera (skipped: CPU temporaries per frame; the streak trails stay).
- Optional: prewarm compile after A-010 loads (startGame warm(): lead's code).
