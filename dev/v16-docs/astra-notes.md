# dev/astra test suites: v1.4/v1.5 update notes (v16-docs)

Status: DONE 11:30: final re-run of all 6 suites green (`sh dev/v16-docs/run-astra.sh final`, summary in runs/final-summary.txt)

## Scope
Edit only dev/astra/** and this file. Product files are read-only.
No network: fake fetch / fixture replay only. Never live-smoke.js / make-samples.js.

## Baseline (11:25, before any test edit; logs in dev/v16-docs/runs/base-*.log)
- astra-test.js: 26/29. FAIL "ship and explorer: one strict-JSON vision call" (line 324: 2 calls !== 1),
  "dev kit: ... a failed call -> every gate skill" (line 364: source 'fallback' !== 'devkit'),
  "wrong kind: a figure as an added button; a controller in the ship / explorer step" (line 424: 2 !== 1).
- gen-regression-test.js: 103 cases, 83 failures (the fake fetch answers the v1.4 ship_spec/body_spec calls with
  the entity fixture, so readings shift; wrong-kind cases now come back as the v1.5 plain "fallback" entity).
- vocab-test.js 415 checks pass; anim-wire-test.js 9 pass; check-samples.js all valid.
- server-generate-test.js: 7/7 PASS at 11:29 with no edit (GEN_PORT=8187, 0.9 s; log runs/base-server-generate-test.log).

## Changes
- astra-test.js (11:28, 29/29 PASS in 11.8 s): helpers `formatOf(call)` / `readings()` next to the fake fetch.
  - "ship and explorer": now asserts the TWO calls by design (`entity` + `ship_spec`; then `entity` + `body_spec` for the
    explorer), the spec calls answered 500 so the spec is built from the entity's parts (`spec.source === "entity"`) and
    rides on both entities; the entity request checks read the `entity` call, not `calls[0]` (the spec call fires first).
  - "dev kit": ASTRA_MOCK / no key still the dev kit; a failed call (HTTP 500) is now the v1.5 plain entity:
    source "fallback", fallback/free true, failed "error", ship verbs [] / unlocked []; explorer: person, jumps, no dig.
  - "wrong kind ... controller in the ship step": "anyway" from the cache counts entity readings only (`readings()`).
- gen-regression-test.js (11:28, 103/103 cases, 0 failures, 58 ms): the fake fetch answers the v1.4 spec calls
  (format name `*_spec`) with 599 apart from the fixture queues (the fixtures predate v1.4), so they no longer eat the
  entity call's recording; the summary line counts them (+45 spec calls). Every gate PASS, "fallbacks 0".

## Final run (11:30, `sh dev/v16-docs/run-astra.sh final`)
- astra-test 29/29 (11.8 s), vocab-test 415 checks, anim-wire-test 9, check-samples all valid,
  gen-regression-test 103/103 0 failures (+45 spec calls answered 599), server-generate-test 7/7 (port 8187, 0.9 s).

## Real product failures
- none found by these suites: every baseline failure was the test encoding the pre-v1.4 behaviour (one call per
  ship/explorer drawing; a failed call = the dev kit).
