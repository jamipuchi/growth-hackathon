# world-cine notes (v13-world lane, render side): cinematic camera + TV director

Status: DONE (implement-only round; `node --check render.js` / `node --check transition.js` OK; not run in a browser).

## render.js (class CameraRig + consts right above it; startGame hooks)
- New consts above CameraRig: MOMENT_N 24, MOMENT_GAP 2, MOMENT_MIN 3, QUIET_PRIO 20, PVP_RANGE 80, INTRO_SECONDS 1.6,
  REVEAL_DELAY 1, REVEAL_SECONDS 3, GLANCE_SECONDS 1.1, RIG_UP, smooth01().
- CameraRig.note(m) (called from handle() "fx" and "announce"): moments in a preallocated pool, stamped in the frame clock
  (this.wall bridges performance.now() and t). Announce parsing (world.js texts): steal 80 (4 s), "A ✕ B" 75 if B human
  else 45 (3.5 s), chest 60, wreck 55, mine hit 40 (subject = the one who hit it), emp/ink/decoy-shot 40, tractor 45.
  fx: hit 0xef4444 (boss) -> boss moment for the human aiming at the spot (aimer(), 320 m), prio QUIET_PRIO, 1.5 s;
  hit 0xf97316 (player) -> victim = player at the spot (7 m), hitAt map; human victim + human aimer within 80 m (or a human
  hit < 3 s ago within 80 m) -> "pvp" 50, other = victim; explode size >= 12 or an announce starting with 💥 -> boomAt.
- pickFocus: landing / take-off unchanged (first); then (not while the focus is landing / taking off) the best live moment
  whose subject is alive and not a bot while humans play: kept if the focus's own moment is at least as big; else cut if
  >= 2 s since the last cut and (>= 3 s or prio > max(shotPrio, QUIET_PRIO)); hold until the moment's TTL; then the old
  quiet-time rules (CUT_SECONDS, bossLow 3 s, island first) unchanged. The sceneOf closure was inlined (no per-frame alloc).
- update(): allocation-free now (temporaries in the constructor; finish() reuses this.out). New: TV scoreboard -> subject =
  winnerOf() (world.result.winner, else top score; never a bot while humans play); spectator PvP/kill/steal/mischief framing
  over the subject's shoulder towards `other` (otherOf(): same mode, < 80 m) in space and on the island; outro orbit;
  the phone's glance; the reveal pose override; introBlend() after the camera write.
- watch(): phase lobby -> playing (or a phone waking up with tick clock < 3 s) -> "intro" (start pose = the live camera if
  the rig saw the lobby, else lobbyShot()); playing/assists -> scoreboard on the TV -> "outro"; boss death (boss.dead with
  seenAlive and planet born < 3 s ago or boomAt < 1.5 s) -> TV "reveal" (after 1 s, 3 s, then a cut back: snapNext,
  lastCut) / phone "glance" (0.3 s later, 1.1 s). fovAdd reset each frame.
- introBlend(): lerp cp0 -> director pose + arc (TV), slerp cq0 -> cq1, phone fovAdd = 7 * sin^2(pi u).
- revealPose(): planet (world.planet, else planetLook.root/R/landRange), from planetLook.approach side, D = 3.3 -> 2.55 x
  (radius + landRange), drift, 0.26 D up.
- startGame: frame loop `cam = shot ? rig.finish("chase","space") : rig.update(...)`; fov = baseFov + kick + rig.fovAdd;
  no subject shake during the TV reveal; endShot cancels an intro / reveal (`rig.cine = ""` unless "outro");
  handle(): `rig.note(m);` in "fx" and "announce".
- transition.js: unchanged (landing / take-off keep working exactly; the new shots live in CameraRig because transition.js
  is lazy-loaded and may be null).

## Left / for the lead
- Not tested at all (owner: implement first). Things to watch in the test round: the TV intro arc height, the reveal
  distance (ring fill), how often boss-hit moments cut (QUIET_PRIO / MOMENT_MIN), PvP aimer false positives.
