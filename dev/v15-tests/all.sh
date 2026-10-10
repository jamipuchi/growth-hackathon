#!/bin/bash
# Space Party: every test harness in one run, one summary table (v1.4+). Run it from any tree (the main repo or a frozen
# worktree): it tests the tree it lives in.
#   dev/v15-tests/all.sh [--port-base 8490] [--only unit,client,e2e,kit,tour] [--skip group|suite,...] [--bots 24] [--video]
#                        [--no-shots] [--out DIR] [--no-wait]
#   --no-shots: the e2e takes no screenshots (each WebKit screenshot stalls the phone a frame or two: a clean phone 1% low
#   for its phonePerf gate, fps >= 55 and 1% low >= 30; a desktop proxy for an iPhone either way)
# Groups, in this order (browser groups run one at a time, after the node-only ones):
#   unit    the 9 unit suites of the verify protocol: dev/astra astra-test, gen-regression-test, vocab-test, anim-wire-test;
#           dev/netcode sim-test, live-test (LIVE_PORT = base+2, its HTTPS base+3); dev/rules rules-test;
#           dev/inflate astra-entity-test; dev/https test (fixed port 8444: SKIP when that port is busy)
#   client  node-only client suites: dev/v12-client/render unit, node-smoke, node-game; dev/v13-tv/unit-feed;
#           dev/v12-client/tv unit-parse, test-extras-jsdom, test-page-jsdom; dev/v14-ship/spec-test;
#           dev/v12-client/phone/smoke t1-join, t2-sandbox, t3-mischief (controller.html in a fake DOM);
#           dev/v11-client/selftest (the hooked test server, port base+4, no browser)
#   e2e     dev/e2e/run.mjs --route expert (port base) then --route regular (port base+1), --bots 24 (real time: about
#           3 + 4.5 min; the server's 3-2-1 after START is part of it)
#   kit     dev/v13-entity/run.mjs --mock: the entity-creation kit (14 drawings through /generate, built on the TV and the
#           phone: ship3d.js / entity3d.js from the spec), ASTRA_MOCK=1, port base+6, about 25 s
#   tour    dev/v13-phone/tour.mjs --bots 2: the phone tour (every screen, guide card, paper share, full screen, late hints,
#           the 3-2-1), WebKit iPhone, port base+5, about 90 s
# v1.7 (readyGate, owner 12:26): START needs a READY player (a ship and a controller accepted by the server) and only the
# ready players play; server.js starts no bots unless told. The harnesses draw both before START (e2e driver lobbyDraws,
# live-test, selftest, seedPlayers / drawReady in dev/v11-client/lib.mjs) and pass --bots explicitly where they need bots.
# Every harness runs with ASTRA_MOCK=1 where it starts a game server (no real OpenAI call). The ports of the chosen groups
# (base..base+9) must be free: the script refuses to start otherwise (it never kills anything it did not start). Before
# each browser group it waits while the orchestrator's HOLD flag is up (.orch/status/HOLD; --no-wait skips the wait).
# Each harness gets a time limit;
# on timeout it gets SIGTERM (the harnesses stop their own servers and browsers on SIGTERM), then SIGKILL 10 s later.
# Output: DIR (default dev/v15-tests/out/<yyyymmdd-hhmmss>/): <suite>.log per harness, summary.txt (the table) and
# summary.json. Exit 0 only when every suite that ran passed (SKIP is not a failure, TIMEOUT is).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

BASE=8490; ONLY="unit,client,e2e,kit,tour"; SKIP=""; BOTS=24; VIDEO=""; NOSHOTS=""; OUT=""; NOWAIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port-base) BASE="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --skip) SKIP="$2"; shift 2 ;;
    --bots) BOTS="$2"; shift 2 ;;
    --video) VIDEO="--video"; shift ;;
    --no-shots) NOSHOTS="--no-shots"; shift ;;
    --out) OUT="$2"; shift 2 ;;
    --no-wait) NOWAIT=1; shift ;;
    -h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1 (see --help)"; exit 2 ;;
  esac
done
case "$BASE" in ''|*[!0-9]*) echo "--port-base must be a number"; exit 2 ;; esac
wants() { case ",$ONLY," in *",$1,"*) case ",$SKIP," in *",$1,"*) return 1 ;; esac; return 0 ;; esac; return 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${OUT:-$HERE/out/$STAMP}"
mkdir -p "$OUT" || exit 2
SUMMARY_TSV="$OUT/.rows.tsv"; : > "$SUMMARY_TSV"
T_ALL=$(date +%s)

# The orchestrator's status folder: this tree's, else the main repo's (a worktree's git common dir is <main>/.git).
STATUS="$ROOT/.orch/status"
if [ ! -d "$STATUS" ]; then
  COMMON="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null)"
  case "$COMMON" in /*) ;; *) COMMON="$ROOT/$COMMON" ;; esac
  [ -d "$COMMON/../.orch/status" ] && STATUS="$(cd "$COMMON/../.orch/status" && pwd)"
fi

port_busy() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null | head -1; }

# The ports the chosen groups use must be free: e2e base, base+1; unit (live-test) base+2, base+3; client (selftest) base+4;
# tour base+5; kit base+6..base+9.
NEED=""
wants e2e && NEED="$NEED 0 1"; wants unit && NEED="$NEED 2 3"; wants client && NEED="$NEED 4"; wants tour && NEED="$NEED 5"; wants kit && NEED="$NEED 6 7 8 9"
BUSY=""
for i in $NEED; do p=$((BASE + i)); b="$(port_busy $p)"; [ -n "$b" ] && BUSY="$BUSY $p(pid $b)"; done
if [ -n "$BUSY" ]; then echo "ports in use:$BUSY. Pick another --port-base (nothing was killed)."; exit 3; fi

wait_calm() {
  [ "$NOWAIT" = 1 ] && return 0
  local n=0
  while [ -e "$STATUS/HOLD" ] && [ $n -lt 90 ]; do
    [ $((n % 6)) = 0 ] && echo "  HOLD is up ($(cat "$STATUS/HOLD" 2>/dev/null | head -1)): waiting before the browsers"
    sleep 10; n=$((n + 1))
  done
  [ -f "$STATUS/vitals.log" ] && echo "  vitals: $(tail -1 "$STATUS/vitals.log")"
  return 0
}

# run <name> <group> <seconds> <command...>: the command's own exit code decides (0 = PASS); its output goes to <name>.log.
run() {
  local name="$1" group="$2" secs="$3"; shift 3
  local log="$OUT/$name.log" t0 code res wd
  case ",$SKIP," in *",$name,"*) skip "$group" "$name" "skipped (--skip $name)"; return 0 ;; esac
  printf '%-18s %s\n' "$name" "running: $*"
  t0=$(date +%s)
  "$@" > "$log" 2>&1 < /dev/null &
  local pid=$!
  # watchdog: SIGTERM at the limit (the harness cleans up), SIGKILL 10 s later
  perl -e '$SIG{TERM} = sub { exit 0 }; sleep $ARGV[0]; kill "TERM", $ARGV[1] or exit 0; open(my $f, ">", $ARGV[2]); close $f; sleep 10; kill "KILL", $ARGV[1];' "$secs" "$pid" "$log.timeout" &
  wd=$!
  wait $pid; code=$?
  kill $wd 2>/dev/null; wait $wd 2>/dev/null
  if [ -e "$log.timeout" ]; then res="TIMEOUT"; rm -f "$log.timeout"; elif [ $code = 0 ]; then res="PASS"; else res="FAIL"; fi
  local secs_taken=$(( $(date +%s) - t0 ))
  local detail; detail="$(detail_for "$name" "$log")"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$group" "$name" "$res" "$secs_taken" "$code" "$detail" >> "$SUMMARY_TSV"
  printf '%-18s %-7s %4ss  %s\n' "$name" "$res" "$secs_taken" "$detail"
}
skip() { printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "SKIP" "0" "-" "$3" >> "$SUMMARY_TSV"; printf '%-18s %-7s        %s\n' "$2" "SKIP" "$3"; }

# One line of numbers per harness: its report JSON where it writes one, else its last summary-looking line.
detail_for() {
  local name="$1" log="$2"
  case "$name" in
    e2e-expert|e2e-regular)
      node -e '
        // report.json is written last by every run (a crash writes { pass: false, error } there only); report-<route>.json on success
        const fs = require("fs"), read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
        const last = read(process.argv[2]);
        if (last && last.error) { console.log(("error: " + last.error).slice(0, 140)); process.exit(0); }
        const r = last && last.route === process.argv[3] ? last : read(process.argv[1]);
        if (!r) { console.log("no report"); process.exit(0); }
        const g = r.gates || {}, bad = Object.keys(g).filter((k) => !g[k]);
        const ph = r.perf && r.perf.phone, cd = r.countdown;
        console.log(`${r.readyDrawn === false ? "NOT READY · " : ""}round ${r.roundSeconds ?? "-"} s (${r.result && r.result.reason || "-"}), winner ${r.winner || "-"}, chests ${r.chestsOpened}, boss ${r.bossDownClock ?? "-"} s, 3-2-1 ${cd ? (cd.values || []).join("") || "-" : "?"}, phone ${ph ? ph.fps + "/" + ph.low1 : "-"} fps; ${bad.length ? "FAILED " + bad.join(",") : "all " + Object.keys(g).length + " gates"}`.slice(0, 160));
      ' "$ROOT/dev/e2e/report-${name#e2e-}.json" "$ROOT/dev/e2e/report.json" "${name#e2e-}" 2>/dev/null ;;
    *)
      # a tally line first (N/M passed, N checks, ALL OK, "PASS <suite> (N ms)"), else the last pass/fail-looking line
      local l
      l="$(grep -a -E -i '[0-9]+ ?/ ?[0-9]+[^0-9]*(pass|check|case)|(pass|check|case)[^0-9]*[0-9]+ ?/ ?[0-9]+|[0-9]+ (of [0-9]+ )?checks?,? ([0-9]+ )?(failed|passed)|all [0-9]+ (checks )?passed|all (ok|pass)|[0-9]+ (tests? )?passed|[0-9]+ failure\(s\)|^(PASS|FAIL) [a-z].*\([0-9]+ ms\)' "$log" | tail -1)"
      [ -z "$l" ] && l="$(grep -a -E -i '(^|[^a-z])(pass|fail|passed|failed|ok|checks|miss)([^a-z]|$)' "$log" | grep -a -v -E '^[[:space:]]+at |^[[:space:]]*(ok|PASS)[[:space:]]{1,3}[a-z]' | tail -1)"
      printf '%s\n' "$l" | tr -d '\r' | sed -E 's/\x1b\[[0-9;]*m//g' | cut -c1-140 ;;
  esac
}

echo "Space Party tests: $ROOT ($(git -C "$ROOT" log --oneline -1 2>/dev/null | cut -c1-70))"
echo "groups $ONLY${SKIP:+ (skip $SKIP)}, ports $BASE-$((BASE + 9)), logs $OUT"

# ---- unit: the 9 suites of the verify protocol (node only) --------------------------------------------------------------
if wants unit; then
  echo "== unit"
  run astra-test     unit 240 node dev/astra/astra-test.js
  run gen-regression unit 240 node dev/astra/gen-regression-test.js
  run vocab          unit 120 node dev/astra/vocab-test.js
  run anim-wire      unit 120 node dev/astra/anim-wire-test.js
  run sim            unit 600 node dev/netcode/sim-test.js
  run live           unit 240 env LIVE_PORT=$((BASE + 2)) ASTRA_MOCK=1 node dev/netcode/live-test.js
  run rules          unit 120 node dev/rules/rules-test.js
  run astra-entity   unit 180 node dev/inflate/astra-entity-test.js
  if [ -n "$(port_busy 8444)" ]; then skip unit https "port 8444 (fixed in dev/https/test.js) is in use: not run"
  else run https unit 120 node dev/https/test.js; fi
fi

# ---- client: node-only client suites -------------------------------------------------------------------------------------
if wants client; then
  echo "== client"
  run render-unit    client 180 node dev/v12-client/render/unit.mjs
  run render-smoke   client 180 node dev/v12-client/render/node-smoke.mjs
  run render-game    client 180 node dev/v12-client/render/node-game.mjs
  run tv-feed        client 60  node dev/v13-tv/unit-feed.mjs
  run tv-parse       client 60  node dev/v12-client/tv/unit-parse.mjs
  run tv-extras      client 120 node dev/v12-client/tv/test-extras-jsdom.mjs
  run tv-page        client 120 node dev/v12-client/tv/test-page-jsdom.mjs
  run ship-spec      client 120 node dev/v14-ship/spec-test.js
  run phone-join     client 120 node dev/v12-client/phone/smoke/t1-join.mjs
  run phone-sandbox  client 120 node dev/v12-client/phone/smoke/t2-sandbox.mjs
  run phone-mischief client 180 node dev/v12-client/phone/smoke/t3-mischief.mjs
  run harness-self   client 240 node dev/v11-client/selftest.mjs --port $((BASE + 4))
fi

# ---- browsers, one harness at a time -------------------------------------------------------------------------------------
if wants e2e; then
  echo "== e2e (real time, $BOTS bots)"
  wait_calm
  run e2e-expert  e2e 480 node dev/e2e/run.mjs --port "$BASE" --route expert --bots "$BOTS" $VIDEO $NOSHOTS
  wait_calm
  run e2e-regular e2e 540 node dev/e2e/run.mjs --port $((BASE + 1)) --route regular --bots "$BOTS" $VIDEO $NOSHOTS
fi
if wants kit; then
  echo "== entity kit"
  wait_calm
  run entity-kit kit 600 env ASTRA_MOCK=1 node dev/v13-entity/run.mjs --mock --port $((BASE + 6))
fi
if wants tour; then
  echo "== phone tour"
  wait_calm
  run phone-tour tour 420 env ASTRA_MOCK=1 node dev/v13-phone/tour.mjs --port $((BASE + 5)) --bots 2
fi

# ---- summary -------------------------------------------------------------------------------------------------------------
TOTAL=$(( $(date +%s) - T_ALL ))
node -e '
  const fs = require("fs");
  const [tsv, out, root, total, commit] = process.argv.slice(1);
  const rows = fs.readFileSync(tsv, "utf8").split("\n").filter(Boolean).map((l) => { const [group, name, result, seconds, code, ...d] = l.split("\t"); return { group, name, result, seconds: +seconds, code, detail: d.join(" ") }; });
  const n = (r) => rows.filter((x) => x.result === r).length;
  const pad = (s, w) => String(s).padEnd(w);
  const lines = [
    `Space Party tests · ${commit} · ${new Date().toISOString()} · ${total} s`,
    `${pad("group", 7)} ${pad("suite", 15)} ${pad("result", 7)} ${pad("time", 6)} numbers`,
    "-".repeat(120),
    ...rows.map((r) => `${pad(r.group, 7)} ${pad(r.name, 15)} ${pad(r.result, 7)} ${pad(r.seconds + "s", 6)} ${r.detail}`),
    "-".repeat(120),
    `${n("PASS")} pass, ${n("FAIL")} fail, ${n("TIMEOUT")} timeout, ${n("SKIP")} skipped · logs ${out}`,
  ];
  fs.writeFileSync(out + "/summary.txt", lines.join("\n") + "\n");
  fs.writeFileSync(out + "/summary.json", JSON.stringify({ root, commit, at: new Date().toISOString(), seconds: +total, pass: n("FAIL") + n("TIMEOUT") === 0, counts: { pass: n("PASS"), fail: n("FAIL"), timeout: n("TIMEOUT"), skip: n("SKIP") }, suites: rows }, null, 2));
  console.log("\n" + lines.join("\n"));
' "$SUMMARY_TSV" "$OUT" "$ROOT" "$TOTAL" "$(git -C "$ROOT" log --oneline -1 2>/dev/null | cut -c1-60)"
rm -f "$SUMMARY_TSV"
node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pass ? 0 : 1)' "$OUT/summary.json"
