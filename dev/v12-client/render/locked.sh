#!/bin/bash
# Runs a command under the browser lock of dev/v12-client/SPEC.md: waits for .orch/status/HOLD to go away and for the lock,
# holds it for the command (<= 8 minutes, killed after that), and ALWAYS releases it.
#   dev/v12-client/render/locked.sh <timeout-seconds> <command...>
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LOCK="$ROOT/dev/v12-client/.browser-lock"
T="${1:-470}"; shift
while [ -e "$ROOT/.orch/status/HOLD" ]; do echo "HOLD present, waiting 60 s"; sleep 60; done
until mkdir "$LOCK" 2>/dev/null; do echo "browser lock held by: $(cat "$LOCK/owner" 2>/dev/null); waiting 30 s"; sleep 30; done
echo "render $(date +%T)" > "$LOCK/owner"
trap 'rm -rf "$LOCK"' EXIT INT TERM HUP
"$@" &
PID=$!
( sleep "$T"; kill -TERM $PID 2>/dev/null; sleep 5; kill -KILL $PID 2>/dev/null ) &
WD=$!
wait $PID; RC=$?
kill $WD 2>/dev/null
exit $RC
