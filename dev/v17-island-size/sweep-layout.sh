#!/bin/bash
# Chest layouts on the 840 m island for chestSpread / chestSpreadPerChest pairs (instant: world.js only, no simulation).
#   bash dev/v17-island-size/sweep-layout.sh "34 4" "60 7" ...
cd "$(dirname "$0")/../.."
for sp in "$@"; do
  set -- $sp
  echo "=== chestSpread $1 chestSpreadPerChest $2"
  for h in 1 10 25; do
    PACING="{\"island\":{\"chestSpread\":$1,\"chestSpreadPerChest\":$2}}" node --require ./dev/v14-pacing/tune.cjs dev/v14-pacing/islands.mjs --humans $h --bots $((25-h)) --seeds 1-200 | sed -n '1,4p' | sed 's/^  */  /' | tr '\n' ' '
    echo
  done
done
