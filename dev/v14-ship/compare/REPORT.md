# Ship spec: gpt-6.1-sol vs gpt-6-astra (v14-ship3d, 10 Oct 2026)

Owner, 09:30: "we will need to improve the ship generation now it looks like a cookie. have some textures ready to apply,
make sure it's generated nicely. let's test 6.1 if that is not good enough let's test 6 astra".

**What was tested.** The same 12 ship drawings (`dev/v14-ship/drawings.mjs`): clean side views (E01 plain fighter, E04 cannon
and flames, E06 nose drill, E10 chunky box ship), a saucer (E08), a nose-up rocket (E09), a top view (genqa), the owner's
own finger-drawn jet (jaume-jet), two PHOTOS of paper drawings (E13 on lined paper; E16 with a thumb in the frame) and two
coloured drawings (a red/yellow top-view fighter; a messy green/purple/orange scribble). Each one goes through ONE vision
call (`astra-ship.js`: strict JSON schema, Responses API, `service_tier: "ultrafast"`, `reasoning.effort: "low"`,
`detail: "low"`, the same prompt for both models), then `normalize` + `reconcile` (the skills the entity reading unlocked
must show as parts), then `ship3d.js` builds it and Chromium renders it from three angles next to the drawing
(`node dev/v14-ship/compare.mjs spec|render --model <id>`).

## Numbers (measured 09:44-09:57)

| | gpt-6.1-sol | gpt-6-astra |
| --- | --- | --- |
| schema failures | 0 / 12 | 0 / 12 |
| latency p50 | 3008 ms | 3447 ms |
| latency p90 | 3301 ms | 4343 ms |
| latency min / max | 1848 / 4358 ms | 2689 / 4810 ms |
| mean latency | 2886 ms | 3635 ms |
| output tokens (mean, incl. reasoning) | 454 | 505 |
| input tokens | 2022 | 2022 |

Real OpenAI calls for the comparison: 25 (12 + 12 + one lost to a harness bug, fixed), out of the lane's cap of 60.

## How the two models read the drawings

Nearly identical part lists: the same hull shape on 11 of 12, the same cockpit, wing count, engines/flames, weapons and
extras on 10 of 12. Both made the same three misreads:
- **E10:** the drill on the nose is read as a "missile" (both still unlock shoot: a drill on a ship is a weapon).
- **photo-E13:** the small cannon on top is read as a window / "other"; `reconcile` adds the cannon back because the
  entity reading unlocked shoot (that is what it is for).
- **E08:** the lamp with rays on the saucer's right is read as an exhaust flame; `reconcile` adds the lamp (flare).

Differences: gpt-6-astra got the **view** right where 6.1 did not (genqa is a top view: astra "top", 6.1 "side"; E06 is a side
view: astra "side", 6.1 "top"), saw a canopy on E06 (6.1: none) and a pair of guns on the owner's jet (6.1: one).
gpt-6.1-sol was faster on 10 of 12 drawings (p90 1 s lower).

## Prompt v2 (after the comparison)
Both models made the same three misreads, so the prompt was the problem, not the model. `astra-ship.js` prompt v2 says
what a drill, a cannon block and a lamp look like, that wings on both sides of the body mean a top view, and that colours
are hex or names. Re-run on gpt-6.1-sol (`compare/gpt-6.1-sol-prompt2/`, 12 calls): **all three fixed** (E08 lamp found,
no false flame; E10 drill, not missile; photo-E13 cannon found), 12/12 schema OK, p50 2943 ms, p90 3832 ms. Side effect:
the near-identical corpus fighters (E01, E04, E06, genqa, photo-E13) now read as top views, which hides their upright tail
fin, so `normalize` gives a top-view plane-like ship an implied tail fin (`implied: true`).

## Renders and scores
Contact sheets: `gpt-6.1-sol-prompt2/contact.png` (the production prompt), `gpt-6.1-sol/contact.png` and
`gpt-6-astra/contact.png` (the like-for-like model comparison, prompt v1); per drawing `<id>.png` = drawing + 3/4 front +
side + chase view (`<id>.kit.png`: with the A-012 hand-made texture kit, which the game now loads). Every ship: 3 draw
calls (2 without a drawing), 3.2k-4.8k triangles at TV quality, 1.4k-2.4k at the phone's game quality, 7-26 ms to build
on the laptop (Chromium, measured 10:06).

Scores out of 5, looked at one by one (R = resembles the drawing, S = reads as a ship, C = cool), prompt v2 on 6.1:

| drawing | R | S | C | notes |
| --- | --- | --- | --- | --- |
| E01 plain fighter | 4 | 5 | 4 | dart, canopy, swept wings, tail fin; correctly no flames, no guns |
| E04 cannon + flames | 4 | 5 | 4 | cannon on top, flame; the corpus fighters are near-identical drawings, so are their ships |
| E06 nose drill | 4 | 5 | 4 | gold hazard-striped drill on the nose |
| E08 saucer | 5 | 5 | 5 | disc, glass dome, 3 portholes, legs, lamp; the drawing as a sticker on the rim |
| E09 rocket | 3 | 4 | 4 | portholes, legs, flames; flies nose-first like every ship, so the drawn fins become small wings |
| E10 chunky box | 4 | 5 | 5 | box hull, drill, cannon, legs, flames, portholes, sticker |
| genqa top view | 4 | 5 | 4 | fighter, gun, flame |
| jaume-jet (owner) | 4 | 5 | 5 | slim dart, the big swept tail fin and the gun under the nose as drawn; wings small (span 0.48) |
| photo-E13 | 4 | 5 | 4 | the cannon is back (prompt v2); sticker dark (a raw JPEG photo: the phone cleans photos to ink first) |
| photo-E16 | 3 | 4 | 3 | box, shield emitter, bomb; the thumb ignored; raw-photo sticker is a dark block (as above) |
| colour top view | 5 | 5 | 5 | red hull, yellow delta wings, blue canopy, wing guns, flames: the drawing's own colours |
| colour messy | 5 | 5 | 5 | teal saucer, purple trim, antenna with a red ball, portholes, flames |
| **mean** | **4.1** | **4.8** | **4.3** | |

gpt-6-astra (prompt v1): visually indistinguishable from gpt-6.1-sol on prompt v1 (same misreads, same ships; it got two
views right that 6.1 did not, which changes nothing visible). Nothing reads as a cookie any more on either model.

## In the game (10:08-10:12, `dev/v14-ship/game-shots.mjs`)
The real server.js + the v14 patch (`dev/v14-ship/server.cjs`), 5 drawn ships + 3 bots, TV in Chromium 1440x900, phone in
WebKit 844x390 DPR 3: every drawn ship is built by ship3d.js on both screens (TV "big" 4.1k-4.8k triangles, 4-24 ms; phone
"lite" 1.6k-2.0k, 4-14 ms; 3 draw calls each). Live run (12 real calls): /generate 2.2-2.7 s with a 700 ms spec grace,
which slowed the unlock card, so the grace is now 100 ms: the replay run (recorded real answers, 0 calls) answers in
1.6 s (= the entity reading), and the model's spec reaches every screen about 1.5 s later through the late path. Shots:
`dev/v14-ship/shots/game-*.png` (the phone's result card builds the 3D ship from the spec it finds by the drawing's hash).

## Recommendation
**Keep gpt-6.1-sol (the pinned model) with prompt v2.** 6.1 is clearly good: 24/24 valid answers, every drawing becomes a
complete, chunky ship that looks like its drawing, and the remaining misreads were fixed by the prompt. gpt-6-astra gave
the same part lists and the same ships, 0.4-1 s slower (p50 3447 vs 3008 ms, p90 4343 vs 3301 ms). No owner decision
needed: the model pin in astra.js stays as it is.

Real OpenAI calls by this lane: 49 of the 60 allowed (comparison 25, prompt v2 12, the live game run 12).
