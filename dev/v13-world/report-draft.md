# v13-world report draft (lead) — kept current in case of cut-off

## Followups (for the orchestrator)
- CONTRACT conflict: the brief asked for verification "with numbers"; .orch/CONTRACT.md "Morning implementation round" says implement
  only (syntax checks only, no browsers/tests). CONTRACT won: verification = node --check + API greps; nothing measured.
- dev/v12-client/render/unit.mjs: expectations kept (boost tap = one "boost" voice: the loop starts only after 300 ms of holding;
  hitmark needs a bullet direction, absent in the test's raw ticks). node-smoke.mjs / node-game.mjs may need updates for the new
  CameraRig (moments, finish(), reused result object) and pooled Snapshots.sample().
- Server (v13-server): already added island.parked[].image (used). Announce wording is parsed by render.js (WorldSound steal sting,
  CameraRig moments): "💰 A stole N points from B!", "💥 A stole the boss from B!", "A ✕ B", "💎 A opened a chest", "🔧 A wrecked
  B's ship", "💣 A hit B's mine", "⚡/🦑/🧲/🎭 A scrambled|inked|pulled|shot B..."; fx colours 0xef4444 (boss hit) / 0xf97316
  (player hit). Changing them silently disables those moments / stings.
- terrain.js (v13-server): A-005's 840 m island revision needs Terrain.ISLAND_SIZE (still 420) + server physics first.
- rigs.js: no bike template (bike uses the car rig, as verbs.js RIG_OF); dev/astra/vocab-test.js asserts 10 rig types.
- TV page (v13-tv): render.js plays the GO (lobby → playing), the last-10-s countdown beeps, the win jingle, steals and kills;
  the page's own 3-2-1 before POST /start is fine, but it must not also beep the last seconds.

## Summary draft
- Task 0 (lead): drawn entity pipeline traced end to end (entity msg → entNote → views → DrawnClaim/DrawnCache → inflate.js →
  instance → anim.js rig); fixes: person 1.8 m TALL (was longest side), car 4 m / bike 2 m (+ toy car, shield, marker), "lite"
  2.6k-tri phone game quality (22 drawings fit the 120k budget), more saturated plush tint; parked ships use island.parked[].image.
- Task 4 (lead): sfx.js steal + hitmark; WorldSound held loops boost/drill/dig (300 ms hold, re-aim, renew, hush on pause/hidden/
  dispose/new round), hit confirm (ahead of my bullet's path), hurt thump, boss clang, steal sting (both server wordings), winner
  fanfare; nothing twice (dev/v12-client unit expectations kept).
- Tasks 1-2 (world-assets): A-011 nebula sky variant, A-003 cloud replaces the puff batch (fallback kept), A-001 far red eye,
  A-002 foreground (TV 12 / phone 6, clear of the v1.3 spawn disc), A-007 cockpit on the phone, corridor density 55/35/10.
- Tasks 5-6 (world-cine): CameraRig moments (steal 80, human kill 75, chest 60, wreck 55, PvP 50, mischief 40-45, boss hit 20),
  min shot 3 s, no cut within 2 s, humans first; intro (lobby→play), reveal (boss→planet, TV 3 s / phone glance), outro (scoreboard
  orbit round the winner, TV); landing shot unchanged.
- Tasks 1/3 (world-fx): see its notes (A-010 WorldFx per scene, shields, flash cap, caps, sample pooling).
