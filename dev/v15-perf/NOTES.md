# v15-perf: iPhone performance (Oct 10, 10:43 to 11:30)

Real iPhones (perf.log, owner's session): v1.3 "41-45 fps, 1% low 4-5" / "47-59 fps, 1% low 5-24"; v1.4 (3D ships)
"60 fps, 1% low 27, 25 calls, 59k tris, tier 5". Target (PLAN.md s4): 60 fps on iPhone 12+, never under 30 on an XR, no
multi-frame hitches, without dropping to the ugliest tier; a steady 60 on tiers 2-3 with 25 players.

Round rule: CONTRACT.md's morning round is IMPLEMENT ONLY (syntax checks only); the brief allowed WebKit measurement. The
contract wins (the preamble says so), so nothing here was run: `measure.mjs` is ready for the test round.

## What caused the hitches (from reading the code and three r160)
1. **The pre-warm compiled the wrong shader variants.** three r160 keys a program on the render target too
   (`toneMapping` and `outputColorSpace` in `getProgramCacheKey`): the bloom tiers 0-3 draw a scene into the composer's
   target (no tone mapping, linear), tiers 4-5 straight to the screen (ACES, sRGB). `warm()` called `renderer.compile()`
   with no target bound, so it only covered tiers 4-5: on the bloom tiers every model still compiled at first sight, and a
   step from tier 3 to 4 compiled everything in view again (a long hitch that reads as "slow", so the governor steps again).
2. **Content that arrives after the pre-warm** compiled at first sight: A-011's sky brings a `LightProbe`
   (`numLightProbes` is in the r160 program key, so every lit material in space recompiles when it loads), A-010's TV flare
   lights, the A-005 island kit and its textures (first drawn in the middle of the landing shot), this round's planet / boss /
   cloud, transition.js's shot materials (glow, sky dome, streaks, dust: built when the landing starts), ship3d.js /
   entity3d.js models and their faded (transparent) variants.
3. **A drawn model's first frame** built it, compiled it (if new), uploaded its sticker / atlas and drew it, all in one frame.
4. **The governor read one-off jobs as a slow phone.** 25 ship builds at round start (7-13 ms each on a laptop, 3-4x that on a
   phone) push the 60-frame p90 over 20 ms: one tier per second, straight down to tier 5, and the climb back needed CPU work
   under 12 ms and 5 s of headroom per step (never into a tier left less than 20 s ago).
5. **Per-frame garbage** (GC pauses): Perf.frame sliced and sorted 5 arrays per frame; computeHud ran 20 times a second on the
   phone with no listener (12-14 KB each); every boss hit spawned an A-010 spark (~30 particles of fresh objects in fx.js);
   swap-remove arrays per dying particle; animator state objects per view per frame; a colour string per name tag per frame.

## What changed
(second sweep, 11:15: three r160 deletes a program when the last material using it is disposed, so "compile a sample, then free
it" warmed nothing. Every warm sample is now kept alive for the session.)

render.js
- `compileFor(obj, scene)`: compiles BOTH render-target variants, for the scene's lights / probe / fog (obj need not be in it).
- Warm queue: one job per 40 ms timer step (compile one object for one scene, or send one texture with
  `renderer.initTexture`); it runs while the phone's draw screen pauses the frame loop; never a long stall.
- `warmScene()` every second: a scene whose light key (directional / point / spot / hemisphere / probe / area counts, fog,
  environment) changed is queued again (every visible top-level object), else only its new top-level objects; their
  textures are queued too (so the island's textures are on the GPU before the landing).
- `keepAlive` samples, compiled opaque and faded for the scenes they show in: one ship3d ship and one entity3d person (as soon
  as their module loads), inflate's warm mesh, the A-009 default ship, the placeholder ship / explorer and the four toys,
  the landing shot's four materials (transition.js frees its own after every shot; these keep the programs). The phone's
  A-007 cockpit is compiled when it loads (not at the first CAMERA toggle). No A-006 chest any more (unused in the game).
- A zero `LightProbe` in space from the start, swapped for A-011's probe when the sky loads: the probe count (in every lit
  program's key) never changes, so the sky's arrival no longer recompiles every lit material in space.
- `warmScene` splits a big group (the island kit) into one job per visible part (hidden water / sky skipped); each round's
  A-004 planet is warmed through `warmLater` (PlanetLook.root was warmed in round 1 only).
- `forceSinglePass` on RingPool, the fallback hex shield and faded default ships: one program instead of two, and three r160
  no longer flags those materials for a program check twice per draw.
- DrawnCache: `prepare` hook right after a build compiles it for its scene (a ship queues the island too) and sends its
  textures; the entry is `built` and becomes `ready` 3 pumps later, so its first frame on screen neither compiles nor uploads.
- Perf governor: `excuse(n)` (frames with a build, a compile, a texture upload, a scene switch or a warm step are not judged;
  90 in a row at most), the last two tiers need two slow windows in a row, the climb tolerates 14 ms of CPU, a typed-array
  window (no garbage). The unit.mjs traces still hold (worked through by hand: 9/9).
- Phones start at tier 2 (pr 1.25, bloom) and climb after 5 s of headroom (no cascade from pr 2 at round start).
- Garbage: phone hit sparks capped to one A-010 spawn per 60 ms (a pooled burst otherwise), hud computed only for a listener
  and memoized 90 ms (game.hud() polls share it), Particles swap-remove without arrays, animator state objects reused, the
  frame ctx reused, emit / shotSubject loops, name-tag colour string cached, Snapshots offset min without a spread, and
  Snapshots.push reuses the entry (and its four maps) that falls off its 30-tick list.
- `loadShrunkTexture` / `shrinkPlanetMaps` / the A-012 kit: `img.decode()` before drawImage (Safari decodes off the main thread).

## Review (11:37, read-only agent)
No crash, TDZ or three r160 API misuse; the 9 unit.mjs governor traces pass (traced). Four low defects, fixed: groups that hold a
light are split (compile() counts a light twice when the object is inside its target scene: A-011's probe); hidden parts are
compiled (ring pools, A-010 pools), only the kit's water / sky are left out (userData.noWarm); a queued island compile skips a
drawn model freed meanwhile; the warm queue waits while the WebGL context is lost. Kept samples are re-queued when a scene's
lights change (the TV's A-010 flare light).

## Not done (followups)
- A-009 default explorer (skinned, double-sided, 512 visor): first compiled at the first landing. Warming it means building one
  (plain, no A-008 retarget, kept alive); the code notes a WebKit crash when a retargeted one was built and disposed early, so
  it needs a WebKit check first.
- Decoys (holoLook copies), per-round rebuilds (rocks, deco, foreground, cloud, island kit: disposed before the new one is
  built, so round 2+ recompiles them at round start), the TV's A-011 sky swap (2048 panorama decoded mid-fight).
- Garbage still per frame: WorldSound.tick's Set rebuilds; the island's
  byName / want rebuild; A-010 fx.js allocates ~30 particles of objects per spawn (asset: write()/vector()); bigscreen-extras
  name-tag transform strings per tag per frame (v15-tv's file); A-005 kit LOD sorts allocate every 0.25 s (asset).
- entity3d.js has the same five-pass triangle-budget loop as ship3d.js had (the sqrt jump would apply).
ship3d.js
- The triangle-budget loop jumps to the detail that fits (triangles ~ d²): two passes instead of up to five.

## How to measure (test round)
    git archive HEAD | tar -x -C /tmp/v15-before      # the tree before these changes (HEAD = a1bf429 + cd6ff5c)
    node dev/v15-perf/measure.mjs --label before --root /tmp/v15-before --port 8480
    node dev/v15-perf/measure.mjs --label after --port 8481
    node dev/v15-perf/measure.mjs --label after-throttle4 --phone chromium --throttle 4 --port 8482
Compare per window (lobby, start, boss, planet): `+prog` (shader programs compiled in the window: should be ~0 after the
lobby), `+tex`, worst frame, frames over 50 ms, 1% low, tier min/max. On a real iPhone: `?perf` overlay and perf.log (tier).
