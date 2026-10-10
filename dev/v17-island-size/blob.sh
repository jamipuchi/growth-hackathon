#!/bin/bash
# The sim-test "25 explorers as one blob" scenario (dev/v14-pacing/explorers.mjs --together --via-pad) for a spread pair.
#   bash dev/v17-island-size/blob.sh <chestSpread> <chestSpreadPerChest> <seeds> [walkSpeed]
cd "$(dirname "$0")/../.."
PACING="{\"island\":{\"chestSpread\":$1,\"chestSpreadPerChest\":$2,\"walkSpeed\":${4:-12}}}" node --require ./dev/v14-pacing/tune.cjs dev/v14-pacing/explorers.mjs --seeds $3 --together --via-pad | grep '^seed' | sed -E 's/ chests \(farthest/ (far/; s/ from touchdown at [0-9.]+ s//'
