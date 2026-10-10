# world-assets notes (v13-world lane, render side; sub-agent of the lead)

IMPLEMENT ONLY round (no browsers/tests). Only check: `node --check render.js` -> OK after every edit (last run at the end).
Region: ASSETS table, nebula/stars/puff textures, SpaceWorld (ctor, setWorld, setLook, rocks, boss, planet, update block),
deco rocks, boss structures, PlanetLook, cockpitFrame + the cockpit lines in startGame, the two nebula-fade lines in startGame.

## Done (render.js)
- ASSETS: `nebula` (A-003 module's createNebula), `foreground` ({seed, rocks} -> createForegroundRocks), `cockpit` (createCockpit(),
  no camera arg on purpose: loadAsset JSON-stringifies its args for the cache key).
- Consts after puffTexture: NEBULA_SCALE 1.15 (cloud radius = server nebula radius x 1.15), NEBULA_OPACITY {phone .34, big .3}
  (A-003 default .22 reads faint on A-011's bright sky), SKY_NEBULA_IN 1.0 / SKY_NEBULA_OUT 1.3 (sky variant hysteresis).
- SpaceWorld ctor: puff batch kept as the FALLBACK (`this.nebula`, still filled in setWorld; diag.mjs reads nebula.mesh), A-003 loaded
  lazily (`cloudMake`), state cloud/cloudSeed/cloudFade/cloudTmp, skyBusy/skyFailed, fore.
- New SpaceWorld methods: buildCloud() (per round at w.nebula, 'low' phone / 'high' TV, hides the puff batch while alive),
  cloudOpacity(), setNebulaFade(k) (A-003 setOpacity(base*k) + puff uFade), nebulaFlare(pos, strength) (world -> root-local,
  ignores flares > 2x cloud radius away; world-fx calls `this.nebulaFlare?.(pos, s)` from fx(), NOT wired by me),
  updateSky(camPos) (A-011 setVariant 'nebula' inside / 'space' outside, hysteresis, one switch in flight, a failure stops it;
  clearForRound resets skyFailed).
- SpaceWorld.update: one grouped block after updatePlanet: cloud.update(dt, camera) (a throw retires it for the puffs) + updateSky.
- setLook: A-002 foreground (plan.fore) loaded per round (gen-guarded), previous round's disposed; when it arrives the procedural
  huge DecoField is disposed and removed from this.deco (deco[0] stays the small field for the farRocks toggle).
- planDecoRocks: small field 55% round the boss / 35% spawn->boss corridor (rad 1.5-11 m, 40-320 m off the line) / 10% beyond the
  boss; phone 400 (x20 tris), TV 900 (x80). Returns `fore`: TV 12 / phone 6 records (2 near the boss, 2/1 near the planet, rest in
  the corridor 150-450 m off the line, golden-angle round it). All big rocks keep clear of the v1.3 spawn disc: centre >= rad +
  spawnRadius + spawnClear + 40 (~205 m) from the origin, >= rad + 70 m from the spawn->boss segment (rad = 0.6 x diameter);
  small rocks >= spawnRadius + 20 + rad from the origin; procedural huge ones the same disc rule + line clearance.
- updateBoss: far "eye" (glow quad, constant ~2 deg, in front of the hull towards the camera, fades in 350..800 m) + halo x(1+.6 farK).
  updateBoss already runs every frame on the rendered object (ASSETS.boss update -> m.updateBoss(boss) on the gltf.scene added to
  the group); states follow hp fraction from world messages (armour 0 on the wire).
- startGame: cockpit block (frames kept as fallback; A-007 loaded on the phone only, camera.add(cockpit.object3d), fitCockpit after
  load / in applySize / when fov or aspect changed; showCockpit parents the CAMERA to the drawn scene only while the cockpit shows,
  else detaches it (a parented camera in an undrawn scene would keep a stale matrixWorld)); visibility = phone && cockpit view &&
  !shot. endShot / updateShot now call game.space.setNebulaFade(...).

## Cost per tier (delivery numbers)
- Phone chase view: A-003 low 1 call / 48 tris (replaces puff batch 1 / 80); small deco 2 calls / 8,000 tris (was 5,000);
  A-002 6 x 256 = 1,536 tris / 1 call (replaces procedural huge 3 calls / 2,560) => net -2 calls, about +1.9k tris. Textures: +0
  (A-003 128 px instead of the 128 px puff canvas; A-002 / A-007 none). Eye: 0 calls.
- Phone cockpit view: + A-007 3 calls / 1,366 tris (replaces the 1-call frame) => net 0 calls vs before, about +3.3k tris.
- TV: A-003 high 1 / 160; small 2 calls / 72,000 tris (was 48,000); A-002 12 x 256 = 3,072 / 1 call (replaces 3 / 4,480) => -2 calls,
  about +22.6k tris. No cockpit on the TV.
- A-011 sky unchanged (1 call / 12 tris / 1 texture); a variant switch briefly holds two textures (phone 1024x512 each).

## Left / assumptions (for the lead)
- world-fx must add `this.nebulaFlare?.(pos, strength)` in SpaceWorld.fx "flare" (not my region).
- game.dispose() does not dispose the cockpit (startGame's returned dispose is not mine): add `cockpit?.dispose()` there if wanted.
- A-006 chest GLB is only pre-warmed: gameplay chests are the procedural ChestField (one call) -> open()/setGlow/states unused.
- A-005 840 m revision needs server island physics (Terrain.ISLAND_SIZE is still 420): integration matches 420 now.
- A-009 setVisorTexture (selfie) and A-004 getLandingPoint unused (outside my region).
- Tunables not seen in a browser: NEBULA_SCALE/OPACITY, eye size/intensity, corridor density, sky switch radii. The phone's
  first sky switch decodes a 2048 jpg into a 1024 canvas (possible one-frame hitch when entering / leaving the nebula).
