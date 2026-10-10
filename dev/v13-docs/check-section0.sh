#!/bin/sh
# Checks that PLAN.md section 0 ("Design decisions") is byte-identical to the copy saved before the v13-docs rewrite.
# Usage: sh dev/v13-docs/check-section0.sh   (run from the repo root)
set -e
cd "$(dirname "$0")/../.."
awk '/^## 0\. /{f=1} /^## 1\. /{f=0} f' PLAN.md > /tmp/.section0.now.$$
if cmp -s /tmp/.section0.now.$$ dev/v13-docs/section0.orig.md; then
  echo "section 0 identical: $(shasum -a 256 dev/v13-docs/section0.orig.md | cut -c1-16) ($(wc -c < dev/v13-docs/section0.orig.md | tr -d ' ') bytes)"
  rm -f /tmp/.section0.now.$$
else
  diff dev/v13-docs/section0.orig.md /tmp/.section0.now.$$ || true
  rm -f /tmp/.section0.now.$$
  echo "section 0 CHANGED" >&2
  exit 1
fi
