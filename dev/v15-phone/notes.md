# v15-phone: notes (implement-only round, 10 Oct, 10:39-10:52)

Files: controller.html, phone-extras.js (appended v1.5 block, own style id `pe15-styles`), ctrl-sandbox.js (KIT_CSS only).
mischief-fx.js unchanged. Checks: `node --check` / `dev/v11-client/check-syntax.mjs` only; nothing run in a browser.

## 1 · Coach marks (first time a phone plays)
- `PE.createCoach(container, { copy, onDone, stepMs })` -> `{ show(steps, from), hide(), isOpen(), index(), destroy() }`. z 25, only the
  bubble takes taps (NEXT / SKIP / tap the bubble); a pulsing gold ring sits around the target; 4.5 s per bubble.
- controller.html `maybeCoach(h)` (from updateHud): phase playing/assists, step "play", the controller live, 2.5 s after the round went live,
  and `calmNow()` (no hit 5 s, boss out of range 4 s, alive, no sheet / late card / landing shot). A fight hides it; it resumes at the same
  bubble. Steps: the stick (steer/move), the first unlocked drawn button, the pencil tool (`#tRedraw`). Done/skip -> `sp.coachSeen`.
## 2 · Results
- Top 3 + my own row when lower (`li.me.gap`); `#resYou` (YOU WON! ★ / ON THE PODIUM! / GREAT ROUND! / NEXT ROUND IS YOURS!);
  winner: `#resultsSheet.win` (gold sheet, spinning `#resStar` behind the rank), `PE.confetti()` once per scoreboard, buzz("win").
- `#resNextRound`: NEXT ROUND IN n while the scoreboard clock runs, then WAITING FOR THE HOST (`.wait`).
## 3 · 3-2-1 for phones still drawing
- `openEarlyStream()` at the end of join(): a named `/events?player=` stream feeding only `onNetTick` (drawings left, S.net.phase,
  syncDrawing, syncCountdown). `wireGame()` calls `closeEarlyStream()` (sets `gameWired`), so a phone keeps one stream once the game's is up.
  Side effect: a first-time drawer in a live round now sends "drawing" down (hover + no damage while drawing), like a redraw does.
## 4 · Haptics
- `PE.Haptics.{supported, buzz}`: false on every iOS device. `buzz(kind)` in controller.html: hit (>= 160 ms apart, bigger on a heavy hit),
  kill, chest, steal / stolen, emp, other mischief, my death, my win. Switch `#hapBtn` on the wait banner (Android only), `sp.haptics`.
## 5 · Waiting card
- `#gen`: the spinner is replaced by `#genProg` (stage line per COPY.stages[kind] at 0 / 1.4 / 3.6 / 7.5 s, a gold bar easing 4% -> 94% over
  14 s with a shimmer) and `#genTip` (COPY.tips, every 4.5 s). Failure = the unchanged v1.3/v1.4 card (stopProgress first).
- Result sheet `#building` gets `#buildTip` while the 3D model builds.
## 6 · Button juice
- DOM controls: `.hit.down { scale: .9 }` (spring back via transition; the `scale` property composes with the EMP translate; sticks excluded).
- Sandbox frame: KIT_CSS `[data-action].is-down { scale: .9 }` (composes with Sol's own transforms).
- Both: `juice(rect)` = a ring burst in `#cd` at the control + `sfx.play("click", { volume: .3, pitch: 1.25 })`.
- Cooldowns: `.cdchip.ring` = an SVG ring that fills as the skill recharges (`coolDur`), seconds in the middle; a gold flash when ready.

## Test hooks (new)
`__spTest.coach()`, `.coachReset()`, `.haptics()`, `.progress(kind)`, `.stream()`, `.juice(action)`, `.go("resultsLose")`.
