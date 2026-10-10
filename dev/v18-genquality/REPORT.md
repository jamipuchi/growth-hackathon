# v18-genquality: generation "VERY VERY GOOD", within 10 s (10 Oct 2026, 13:06-13:35)

Owner, 13:04: "Make sure generation can take more seconds (up to 10) but it is VERY VERY GOOD".

## What was measured
The real server path (`Astra.generate`, as server.js calls it) for the same 22 drawings as the v14 harnesses: 12 ships
(`dev/v14-ship/drawings.mjs`; `genqa-topview.png` is byte-identical to `E04.png`, so it is a cache hit with no call) and
10 planet characters (`dev/v14-entity3d/drawings.mjs`). Each drawing makes two calls in parallel: the entity READ (type,
parts, skills: the unlock card the phone waits for) and the 3D SPEC (`astra-ship.js` / `astra-body.js`, built by
`ship3d.js` / `entity3d.js`; it reaches the screens through `onShipSpec` when it is later than the card). Latencies are raw
single-call times (no hedge or timeout cut them; the report replays astra's hedge and timeouts). Every spec was rendered
in Chromium next to its drawing (ships: 3 angles; characters: 3 poses x 3 angles) and looked at one by one.

`node dev/v18-genquality/run.mjs calls|renorm|report`, renders with `dev/v14-ship/compare.mjs render --out ...` and
`dev/v14-entity3d/compare.mjs render --out ...`, sheets with `node dev/v18-genquality/sheet.mjs`.

| run | settings |
| --- | --- |
| `base/` | v1.7: every call medium effort, image detail low, read budget 1600, spec budget 1800, v1.4 prompts, old builders |
| `v18/` | all high effort, detail high, read 6000 / spec 8000 tokens, new prompts and builders |
| `v18med/` (**shipped**) | read high effort, spec **medium** effort, detail high, new prompts and builders (spec-only run on v18's reads) |
| `final/` | the shipped settings end to end (read + spec in parallel, 4 drawings) |

## Numbers (ms, measured 13:11-13:24)

| run | READ p50 / p90 / max | SPEC p50 / p90 / max | read out tokens p50 / max | spec out tokens p50 / max | schema failures |
| --- | --- | --- | --- | --- | --- |
| base, all 21 calls | 2602 / 2892 / 3035 | 2867 / 4262 / 4674 | 292 / 481 | 550 / 723 | 0 / 0 |
| v18 (high spec), all | 3143 / 4543 / 5128 | **8609 / 11010 / 13985** | 516 / 970 | 1875 / 3255 | 0 / 0 |
| v18 ships only | 3018 / 5045 / 5128 | 9467 / 11664 / 13985 | | | |
| **v18med (shipped), all** | **3143 / 4543 / 5128** | **4146 / 5520 / 8023** | 516 / 970 | 783 / 1560 | **0 / 0** |
| v18med ships | 3018 / 5045 / 5128 | 4455 / 6314 / 8023 | | | |
| v18med characters | 3177 / 4056 / 4056 | 3660 / 4464 / 4464 | | | |
| final e2e (4 drawings) | 2320-5720 | 3585-5493 | 344-1045 | 699-1114 | 0 / 0 |

- High effort on the SPEC was too slow (ship p90 11.7 s, max 14.0 s, up to 3255 output tokens), so the spec stays at medium
  effort with the new, much more careful prompt. High effort on the READ costs +0.5 s at p50 and +1.7 s at p90 (max 5.1 s
  in the batch, 5.7 s end to end).
- Replaying astra's hedge and timeouts on these numbers (read hedge 6.5 s / timeout 11 s, spec hedge 7 s / timeout 12 s):
  0 timeouts; 0 read hedges and 1 spec hedge in 21 (the 8.0 s spec).
- Image detail high costs nothing on the phone's 512 px drawings: read input tokens are identical (ships 1160, characters
  1407; controllers C06/C08/C19: 1479 at low and high). It matters for larger images only. The spec input grew by about
  350 tokens (the longer prompt).
- Controllers (still medium effort; only the detail changed): C06 (7 controls), C08 (icons only) and C19 (small controls
  far apart) read 15/15 controls at low and at high detail (IoU 0.87/0.93/0.90 vs 0.82/0.93/0.91; read 1.6-2.6 s vs 2.3-2.6 s).
- Readings (types and skills): 0 wrong types in every run. Skills that differ from the old fixtures are the generous rules
  working as designed (a lamp's rays also read as flames, boots read as jump, the robot's bolt emblem as emp, its pincers as
  dig). The fixtures' "land" is no longer read since v1.6, so it is not counted as missing.
- Real OpenAI calls: **119 of 120** (`calls-used.json`).

## What changed and what it fixed (scores: resemblance to the drawing, 1-5, before -> after)

| drawing | before | after | what changed |
| --- | --- | --- | --- |
| E09 rocket (1 porthole, 3 flame jets, base fins, legs) | 3 | 4 | 1 porthole (was always 3), 3 nozzles, fins instead of wings, tail-sitter legs |
| E10 chunky box (1 window) | 4 | 4.5 | 1 window (was 3); one set of legs (the medium spec listed each leg: normalize merges them) |
| photo-E16 (box ship in a shield bubble) | 3 | 4 | no invented wings (prompt: a fin is not a wing), 1 window |
| color-messy (purple dome on a green saucer) | 3 | 4 | the purple dome is purple (the glass tint now shows a drawn cockpit colour) |
| color-person (blue boots, peach hands) | 4 | 5 | blue boots (new `legs.feetColor`), skin-coloured hands (`arms.handColor`) |
| color-robot (red pincers, blue boots) | 3 | 4.5 | red pincers and blue boots (were gold and grey) |
| E01, E04/genqa, E06, E08, jaume-jet, photo-E13, color-topview | 4-5 | same | already faithful; no regression |
| astronaut-shovel, astronaut-drill, car-cannon, bike-lamp, dog-claws, blob, horse-saddle, monster-truck | 4 | same | already faithful; no regression |

Contact sheets: before `base/{ships,bodies}/contact.png`, after `v18med/{ships,bodies}/contact.png` (also `v18/` = high spec,
`final/`); side by side: `before-after-ships.png`, `before-after-bodies.png`.

## Code
- `astra.js`: `effortFor(kind, spec)`: ship / explorer readings `high` (`ASTRA_ENTITY_EFFORT`), their specs `medium`
  (`ASTRA_SPEC_EFFORT`), controller / button readings `medium` (`ASTRA_READ_EFFORT`); `OPENAI_REASONING_EFFORT` still
  overrides all. `IMAGE_DETAIL` `high` (`ASTRA_IMAGE_DETAIL`) on every read and spec call. Budgets: reads controller 3000,
  button 2000, ship / explorer 6000, retry 8000, spec 8000. Timeouts: read 11000 (cap 13000 kept), hedge 6500, retry-before
  5000, spec 12000, spec hedge 7000.
- `astra-ship.js`: prompt v3 (go over every stroke, count and measure, view cues, no wings that are not drawn, the colour of
  each part, windows counted once); `cockpit.windows` (schema + normalize); legs stay on the belly or the tail and merge into
  one set.
- `astra-body.js`: prompt v3 (measure proportions, every part's own colour); `arms.handColor`, `legs.feetColor`; a type
  fixed by the reading keeps the drawn limb colours.
- `ship3d.js`: portholes = `cockpit.windows` (1-6; 0 = the old 3-4); a drawn cockpit colour shows through the glass.
- `entity3d.js`: gloves, pincers, boots and hooves use `handColor` / `feetColor` when drawn.
- Tests: `dev/astra/astra-test.js` 30/30 (efforts, detail, budgets, timings updated); `dev/v14-ship/spec-test.js` 7/7;
  `dev/astra/server-generate-test.js` 7/7; `gen-regression` 103 replayed, 0 failures; `vocab` 415; `anim-wire` 9/9;
  `dev/inflate/astra-entity-test.js` 5/5; `dev/v12-modules/test-astra-html.js` 57/57.
