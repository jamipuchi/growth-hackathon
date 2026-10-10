#!/bin/sh
# v16-docs: run every offline dev/astra suite (no network, no key; never live-smoke.js / make-samples.js).
#   sh dev/v16-docs/run-astra.sh [label]     -> dev/v16-docs/runs/<label>-<suite>.log + a summary line per suite
cd "$(dirname "$0")/../.." || exit 1
L=${1:-final}
mkdir -p dev/v16-docs/runs
for s in astra-test vocab-test anim-wire-test check-samples gen-regression-test server-generate-test; do
  t0=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000')
  GEN_PORT=${GEN_PORT:-8187} node dev/astra/$s.js > dev/v16-docs/runs/$L-$s.log 2>&1
  rc=$?
  t1=$(perl -MTime::HiRes=time -e 'printf "%.0f", time*1000')
  echo "$(date +%H:%M:%S) $s exit=$rc $((t1 - t0)) ms :: $(grep -E -i 'passed|failure|checks|PASS|FAIL|valid' dev/v16-docs/runs/$L-$s.log | tail -1)"
done
