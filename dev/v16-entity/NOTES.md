# v16 entity polish: drawn characters and ships (10 Oct 2026, 11:07-11:25)

All renders replay the saved gpt-6.1-sol specs (0 real model calls). Chromium headless, one browser at a time, ports 8501-8503.

- Characters: `chars/contact.png` (idle / run / dig, 3 angles each), per drawing `chars/<id>.png`.
  Before: `dev/v14-entity3d/compare/gpt-6.1-sol/contact.png`.
- Ships: `ships/contact.png` (3/4 front, side, chase view from behind), per drawing `ships/<id>.png`; with the A-012 kit
  (what the game loads): `ships/{E04-cannon-flames,E08-saucer,jaume-jet,color-messy,photo-E16}.kit.png`.
  Before: `dev/v14-ship/compare/gpt-6.1-sol-prompt2/contact.png` (and `<id>.kit.png`).
- Budgets (`budget.json`, measured 11:18 with `node dev/v14-entity3d/budget.mjs 8503 dev/v16-entity/budget.json`):
  every entity is 2-3 draw calls, at most 2596 triangles at "lite" (phone game view), 3968 at "phone" and 4746 at "big" (TV).
  Builds take 1-5 ms, and the first build of a page takes 21 ms. Every clip plays with no missing-bone warning: person 33/33,
  animal 10/10, vehicle 5/5. A person has 19 A-008 bones, plus one `prop_r` when it holds a digging tool.

## What changed

**entity3d.js**
- **Tool grip per clip.** Shovel, pickaxe, drill and saw now hang from their own bone (`prop_l` / `prop_r`, a child of the
  hand). The 19 A-008 bones, their parents and rest poses are unchanged. At build time, `propClips` replays every A-008 clip and
  adds one track that turns the tool for that clip:
  - shovel / pickaxe: hangs down at the side and swings with the arm.
  - drill / saw: held out forward.
  - dig and kneel: aimed from the fist to the ground in front of the feet.
  The drill is now 0.62-0.78 m long (it was 0.48-0.6) so it can be seen on the TV.
- **Vehicles dig.** Cars and bikes now get their own clips (`vehicleClips`: idle, walk, run, jump, dig), so `play` and
  `pose` work on them. In dig:
  - the chassis dips (0.12 m, 0.22 m on a monster truck), pitches nose-down and shudders;
  - a drilled vehicle's bit sits on its own `tool` bone and turns 3 times per 0.6 s cycle;
  - cream dust puffs grow at the front. They sit on a `dust` bone that stays at scale 0.001 in every other clip, and they are
    left out of `size` and `radius`.
  - The wheels stay with render.js (no wheel tracks).
- **Riders.** Every bike and every saddled animal now carries a small rider in the player's colour: white helmet with a
  coloured stripe, dark visor, hands on the bar or reins, feet on the pedals, pegs or stirrups.
- **Dog.** A small animal now has a longer, level muzzle (even when the model says snout 0), a 10% bigger head, bigger
  upright ears and a thick tail that curls up.
- **Horse.** The neck is 20% shorter, thicker at the base and more forward (0.70 rad instead of 0.88). The face slopes down,
  and the muzzle is a lighter shade of the coat, no longer the pale pink it was.

**ship3d.js**
- **Sticker.** Only the ink is drawn now: no paper card and no rim in the player's colour. `inkLayer` makes the paper
  transparent, using the median paper level, so a grey photo of paper clears too. Black ink becomes dark navy and coloured
  strokes keep their colour. It is also smaller:
  - side: 52% of the hull height and at most 0.36 of the ship's length (was 78% and 0.55);
  - top: at most 0.32 of the length (was 0.5);
  - saucer: smaller as well.
- **Glow.** The flame core is less white (1.55/1.2/0.72, was 1.7/1.45/1.0). The engine glow is smaller (1.15 nozzle radii, was
  1.45) and dimmer. The lamp and shield glows are toned down (lamp 3.0 r at 1.15, was 4.2 r at 1.6).
- **Flame from behind.** The FX shader measures how directly the exhaust points at the camera. Seen from straight behind (the
  phone's chase view), the flame is 60% shorter, 35% narrower and 45% dimmer, and the engine glow is 45% smaller. From the
  side and the front, nothing changes.

**Harnesses** (no change to what they test):
- `dev/v14-entity3d/compare.mjs` and `dev/v14-ship/compare.mjs` take `--out <dir> --from <dir>`, which replays saved specs into
  another folder. Their `sheet.html` pages take `&base=`.
- The entity harness also accepts ports 8500-8509.
- `budget.mjs` takes `[port] [out.json]` and plays every clip.

## Looked at, one by one: before / after

Characters (R = resembles the drawing, L = looks, A = animates; v14 scores from `dev/v14-entity3d/compare/REPORT.md`):

| drawing | v14 R/L/A | v16 R/L/A | what changed (and what did not) |
|---|---|---|---|
| astronaut-shovel | 4 / 4 / 4 | 4 / 4.5 / 4.5 | Idle: the shovel hangs at the side, blade on the ground (it stuck out forward). Run: it swings with the arm. Dig: it stabs the ground in front. Not truly two-handed: the A-008 dig keeps the fists shoulder-width apart, so only the right fist is on the shaft. |
| astronaut-drill | 4 / 4 / 4 | 4.5 / 4 / 4.5 | A bigger drill, held forward at the hip as drawn. In dig it bores straight down. |
| car-cannon | 4 / 4 / 3 | 4 / 4 / 4 | Dig: the car dips nose-down and dust appears at the front. A cannon car has no digging tool, so the dig is generic. |
| bike-lamp | 4 / 3 / 3 | 4 / 4 / 4 | A rider in the player's colour on the bike, so it is no longer thin from far away. Dig: the bike leans and dust appears. The rider's limbs are a little thin. |
| dog-claws | 3 / 3 / 4 | 4 / 3.5 / 4 | Muzzle, big ears and a curled tail: it reads as a dog now. The body is still a stiff tube. |
| blob | 4 / 4 / 3 | 4 / 4 / 3 | unchanged |
| color-person | 5 / 4 / 4 | 5 / 4 / 4 | unchanged (a lamp in the hand, so no prop bone) |
| color-robot | 5 / 4 / 4 | 5 / 4 / 4 | unchanged |
| horse-saddle | 4 / 3 / 4 | 4.5 / 4 / 4 | Forward neck and sloping face, so no longer a llama. A rider sits on the saddle. |
| monster-truck | 4 / 4 / 3 | 4 / 4 / 4 | The drill bit spins on its own bone, the truck dips 0.22 m nose-down, and dust appears. |
| **mean** | **4.1 / 3.7 / 3.6** | **4.3 / 4.0 / 4.0** | |

Ships (R = resembles, S = reads as a ship, C = cool; prompt v2, compared with `gpt-6.1-sol-prompt2`):
- **Sticker.** It is now ink lines on the hull, so the pink label is gone. On E10 the drawing reads as a small line drawing
  on the side and on top. On the saucers it is very subtle (top only).
- **Raw photos.** photo-E16's dark block is gone; what is left are faint, broken lines. Raw photos never reach the game,
  because the phone cleans photos to ink first.
- **Chase view.** It now shows the nozzle ring and a short flame instead of a white blob covering the back of the hull: E04,
  E09, genqa, jaume-jet and color-messy.
- **Side view.** The flame is still long and bright.

| | v14 | v16 |
|---|---|---|
| mean R / S / C | 4.1 / 4.8 / 4.3 | 4.1 / 4.8 / 4.5 |

C changes: E04 4 → 4.5, genqa 4 → 4.5, photo-E16 3 → 4. The rest are unchanged.

Honest limits:
- **Bright spots that are not glows.** The white highlight on the saucer domes is the light's reflection on the glass, not
  a glow, and it stays.
- **Dust tint.** The dust picks up the magenta rim light in the side view.
- **Dig in the game.** In the game, the vehicle dig plays only when render.js picks "dig" (see the follow-ups).

## Follow-ups (render.js: not mine)
1. **Drilling never plays "dig".** ExplorerView picks "dig" only for `p.flags.digging`. A rock chest sets
   `p.flags.drilling`, so drilling explorers stand idle, and a drilling vehicle never shows the spinning bit or the dip.
   Fix: use `p.flags.digging || p.flags.drilling` for the clip choice and for the animator's `st.digging`.
2. **Phone chase camera.** ship3d's own flame now shrinks from behind, but render.js adds its own engine glow and trail at
   the nozzle. They need the same behind-dimming, or a chase camera a little higher and further back, looking down about
   12-15°, so the hull sits above the exhaust.
3. **Vehicles are now clip-driven.** Vehicle views now pass `play` and `clips`, so anim.js treats cars and bikes as
   clip-driven: their dig pitch comes from the clip, not from anim.js. Check them in the live game.
   - kneel and step_out fall back to idle (render.js already checks `hasClip`).
   - render.js still emits its dirt particles on top of the entity3d dust. That is fine; drop one of them if it is too much.
4. **Riders.** Riders are not used by the server or the skills; they are only how the model looks.
