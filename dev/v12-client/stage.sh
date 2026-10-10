#!/bin/bash
# Builds a staging tree for the v1.2 client track: the v1.2 SERVER (merged into this tree at 01:56; V12_SERVER=<dir>
# overrides) with THIS tree's client files (symlinks, so edits are live) and this tree's assets. Nothing in either tree is
# written: server.js is copied and patched in the stage only (PUBLIC_FILES += ctrl-sandbox.js, mischief-fx.js, sfx.js,
# which the client imports; reported to the server lane). .env and .git are never linked (ASTRA_MOCK=1 only).
#   dev/v12-client/stage.sh [STAGE_DIR]          default /tmp/v12c-stage
# Then:  cd $STAGE && ASTRA_MOCK=1 HTTPS_PORT=0 PORT=8260 node server.js --bots 24
#        cd $STAGE && HTTPS_PORT=0 E2E_WEBKIT=~/Library/Caches/ms-playwright/webkit-2311/pw_run.sh node dev/e2e/run.mjs --port 8261 --route expert --bots 24
set -euo pipefail
MAIN="$(cd "$(dirname "$0")/../.." && pwd)"
SRV="${V12_SERVER:-$MAIN}"   # the v1.2 server was merged into this tree at 01:56
SRV="$(cd "$SRV" && pwd)"
STAGE="${1:-/tmp/v12c-stage}"
CLIENT="render.js space.html controller.html inflate.js anim.js anims.js phone-extras.js bigscreen-extras.js transition.js ctrl-sandbox.js mischief-fx.js sfx.js"
case "$STAGE" in /tmp/*|/private/tmp/*) ;; *) echo "stage must live under /tmp" >&2; exit 2;; esac
rm -rf "$STAGE"; mkdir -p "$STAGE/controllers" "$STAGE/dev"
for e in "$SRV"/* "$SRV"/.gitignore; do
  n="$(basename "$e")"
  case "$n" in .env|.git|.orch-certs|controllers|dev|assets|server.js|perf.log) continue;; esac
  ln -s "$e" "$STAGE/$n"
done
for f in $CLIENT; do rm -f "$STAGE/$f"; ln -s "$MAIN/$f" "$STAGE/$f"; done
ln -s "$MAIN/assets" "$STAGE/assets"
# the e2e harness computes ROOT from its own path: real copies, so it runs the staged server
cp -R "$SRV/dev/e2e" "$STAGE/dev/e2e"
rm -rf "$STAGE/dev/e2e/shots" "$STAGE/dev/e2e/video"
for d in astra netcode v12-modules; do [ -d "$SRV/dev/$d" ] && ln -s "$SRV/dev/$d" "$STAGE/dev/$d"; done
cp "$SRV/server.js" "$STAGE/server.js"
perl -0pi -e 's/"bigscreen-extras\.js", "inflate\.js",/"bigscreen-extras.js", "inflate.js", "ctrl-sandbox.js", "mischief-fx.js", "sfx.js",/' "$STAGE/server.js"
grep -q '"ctrl-sandbox.js", "mischief-fx.js", "sfx.js"' "$STAGE/server.js" || { echo "PUBLIC_FILES patch failed" >&2; exit 3; }
echo "stage ready: $STAGE (server from $SRV, client from $MAIN)"
