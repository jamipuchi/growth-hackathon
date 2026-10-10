# v1.9.1 jetpack flight (lane v191-jetpack, Oct 10 14:20-14:40)

Owner 14:16: real jetpack flight on the planet, as v1.9.1 (v1.9 stays frozen).

## What it does
- An explorer whose drawing has a flight part (a part name holding one of `TUNING.flight.parts`: jetpack, jets, rockets,
  thruster, wings, propeller, rotor, helicopter, balloon, glider, hover...) gets FLY. A model-sent `fly` is kept too.
  Needed because verbs.js `SKILLS.planet` has no `fly` and astra.js reads "a jetpack -> boost", so FLY was never unlockable.
- Hold FLY (a drawn FLY / JETPACK / WINGS / HOVER... button): the jets lift at up to 8 m/s, fly at 1.5x walk (18 m/s, any
  type), steer with the stick, over land and water, inside the island's edge; climb to at most 40 m over the ground under
  it, never above y 60; hover there. 6 s of fuel; empty, the jets cut and it sinks at most 6 m/s (no fall damage);
  refills only on the ground in 4 s (locked until 25 % is back).
- DIG / DRILL only with the feet on the ground (a toast "DIG · land next to the chest first"); an open chest is collected
  within 3 m of the ground (a low swoop); a planet mine only fires within 2 m of its height.
- Wire: `players[].fuel` (only for a planet player who can fly), `flags.thrust` (jets on) / `flags.glide` (sinking after).
- Phone: a FUEL bar under the vitals (red under 25 %, glows while the jets fire). Render: lean into flight, the `glide`
  clip (else `jump`), two jet flames + hot glow for jet-like parts (flames-free for wings / propeller / balloon /
  hoverboard), downwash dust low over the ground; sound: the "jet" lift-off whoosh + the "jet" held loop (LOOP_KINDS).

## Numbers (node dev/netcode/sim-test.js, 14:38)
up 6.8 m after 1 s of FLY · 18.0 m/s · tank 6.03 s · peak 39.4 m over the ground (y <= 47.8) · fell 6.7 s at <= 6.0 m/s ·
recharged in 4 s · max tick 7339 B with 25 explorers flying (8 KB budget) · 42/42 sim tests.
