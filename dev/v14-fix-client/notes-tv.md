# v1.4 fix, client track: the TV (space.html, bigscreen-extras.js)

Implement-only round: only the syntax check was run (`node dev/v11-client/check-syntax.mjs space.html bigscreen-extras.js`: both OK).

## 1. The 3-2-1 is the server's phase "countdown"
- `startRound()` (space.html ~731) posts `/start` straight away with `{"countdown": true}`; `?nocountdown` posts `{"countdown": false}`
  (play starts at once). The TV-only 3-2-1 before the POST (`preStartCountdown`) is gone. START does nothing while the phase is
  "countdown". 409 behaves as before ("ALREADY STARTED", then START again after 1.8 s); the reset timer never resets START during the countdown.
- `countdownTick(m)` (~756), called from the `tick` handler (~716, not while mocked):
  `n = Number.isFinite(tick.countdown) ? tick.countdown : Math.ceil(tick.clock)`; when `n >= 1` and it changed, `countdownDigit(n)`
  shows the old digit sting (big digit, GET READY!, rays, dim) and beeps once (`countdown`, pitch 1.5 on 1). A tick back in the
  lobby with a digit up hides it. `n = 0` (the last tick can round to 0) shows nothing.
- View: the countdown keeps the **lobby** on screen (`enterPhase` ~1070 maps "countdown" to "lobby"), START busy (STARTING…), the
  digits over it, as the old pre-START 3-2-1 looked. The lobby holds still during the countdown (`onHud` ~1094): world.js drops
  `flags.ready` outside the lobby, so redrawing would flip every chip to DRAWING…. A page opened mid-countdown draws the lobby once and keeps its digit.
- GO!: as before, `enterPhase` shows it once when the view goes lobby → play. That covers countdown → playing and an older server's
  lobby → playing, so there is never a second GO!.
- `__bigscreen.countdown()` now runs `localCountdown()` (~767): the same digits and beeps, one a second, cleared at the end. It still
  resolves true, or false if the screen left the lobby.
- Reduced motion no longer skips the digits: the countdown is now server time that everyone waits through. The CSS already stops the animation.

## 2. Lobby steps
`COPY.lobby.steps = ["1 · DRAW YOUR SHIP", "2 · DRAW YOUR CONTROLLER"]` (~458), the phone's own strings. The step renderer (~586)
puts the "N" in the gold chip and the words next to it, so the TV keeps its chip style. "SCAN THE CODE" is dropped: the card's ribbon already says SCAN TO JOIN.

## 3. Announce parsing (world.js wording checked with `grep "announce(" world.js`)
- bigscreen-extras.js FUN (~547): new `^X stole the boss from Y` (renders like the old "(stolen from Y)" line) and `^X destroyed the boss`
  (like the old "landed the last hit"). The old wording still parses. The swarm pattern is unchanged: it already reads
  "… X did the most damage". No points are added to the boss lines, so dev/v13-tv/unit-feed.mjs expectations still hold.
- space.html `bossDownSting` (~1156): stole the boss from / (old) stolen from → "X STOLE THE LAST HIT!"; destroyed the boss / (old)
  landed the last hit → "X LANDED THE LAST HIT" ("Someone" = no killer known → the plain sub); swarm + scorer → new
  `COPY.sting.topDamage` "X DID THE MOST DAMAGE" (gold); swarm alone → "THE PLANET IS OPEN". `onAnnounce` (~1202) sends all four to the sting.
- "Round N starts in 3…" is **dropped entirely** (~1192, not even in the feed): the big digits say it, and a feed line pushed under the
  lobby would only appear, stale, after GO!. "Round N: REACH THE BOSS" stays in the feed with no banner, as before.
- Checked and unchanged: kills (✕ + 💣/🧲, "was destroyed"), the steal, the wreck/rebuilt lines, the chest, the landing, the emp/ink/pull/
  mine-hit/decoy-shot lines, the round result. "💣 A dropped a mine" and "🎭 A sent out a decoy" have no fun pattern: they show as
  the chip plus the plain line (as in v1.3).
- These match render.js's parsing (`^💥 X stole the boss from Y!`, the v1.2 fallback, `X ✕ Y`).

## 4. Sound
space.html never beeps a round's last seconds: the 5-4-3-2-1 red digits in `renderPlay` are silent, and render.js beeps them.
The page's only sounds are click, pop and the 3-2-1 beeps.

## For the render track (render.js; not fixed here)
1. **GO fanfare missing after a countdown**: `WorldSound.tick` (~3642) plays `start` only for `was === "lobby" && phase === "playing"`.
   With the countdown, the change is countdown → playing, so no screen plays it. Fix: `(was === "lobby" || was === "countdown")`.
   The TV page deliberately does not play it, so there is no double once this is fixed.
2. **hud.clock in "countdown" runs the wrong way between ticks**: `computeHud` (~5849) counts down only for lobby and scoreboard. Add
   "countdown". (The TV takes its digit from the raw tick, so it is not affected.)
3. **TV camera during the countdown**: the director treats "countdown" as play (it follows a ship, ~5550/5610), and the intro shot at GO
   starts from a computed lobby shot (`was === "lobby"` ~5672), not the live framing. Probably hold the lobby fleet shot during "countdown"
   and treat `was === "countdown"` like "lobby" there. `ctx.lobby` (~2755) and the tag projection (~6264) are lobby-only too, so decide
   whether ships keep their lobby look during the 3-2-1.
4. render.js does not beep during the countdown: it beeps only in playing/assists with `left > 0`, and `left` is 0 then. So the
   TV page beeps the 3-2-1 itself (`countdownDigit`). If render.js ever beeps the 3-2-1, remove the page's `sfxPlay` there.
