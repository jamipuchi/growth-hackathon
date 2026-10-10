#!/bin/sh
# v13-world: the only checks allowed this round (CONTRACT morning implementation round): syntax + API surface greps.
cd "$(dirname "$0")/../.." || exit 1
fail=0
for f in render.js transition.js sfx.js inflate.js anim.js anims.js rigs.js; do
  if node --check "$f" 2>/tmp/v13w-check.txt; then echo "syntax OK  $f"; else echo "SYNTAX FAIL $f"; cat /tmp/v13w-check.txt; fail=1; fi
done
# API surface other lanes and the e2e harness rely on (startGame's returned object, exports, hooks).
for pat in "export function startGame" "export function createEntityPreview" "export { sfx }" "setView(v)" "setPlayer(name)" "pause(on)" \
  "on(event, cb)" "hud: () => computeHud(game)" "entityOf: (name)" "projectPlayers," "_internals: {" "dispose() {" "export function playLanding" "export function playTakeoff"; do
  if grep -qF "$pat" render.js transition.js; then echo "api OK     $pat"; else echo "API MISSING $pat"; fail=1; fi
done
exit $fail
