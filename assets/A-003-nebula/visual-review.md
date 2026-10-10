# A-003 independent visual review

**Pass with visual limits — 2026-10-10, Europe/Madrid.** Separate Playwright CLI
session `nebula-independent`, Chromium 154 on macOS, DPR 1. Preview `?final=41`:
**41 checks passed**, zero shader errors, zero console errors or warnings.

- The boss remains readable in the 100 m approach against both dim and bright
  backgrounds. Its silhouette, armour faces and warm seams remain distinct;
  decorative cloud wisps do not obscure the centre.
- Isolated low/medium/high captures show irregular violet wisps with textured,
  soft edges, rather than flat circular discs or exposed billboard rectangles.
  High quality gives a denser, brighter volume; low quality keeps the same broad
  shape. The effect is deliberately translucent and becomes subtle against the
  brightest sky regions.
- The bright-background high-quality inside view remains open. A crossing was
  captured from 0–26 simulated seconds at 2 s intervals in an 844×390 viewport.
  Representative entry, centre and exit frames show no obvious hard quad edges,
  near-plane cut lines or opaque flashes. This sampled review does **not** prove
  the absence of every-frame popping or measure real-time frame pacing.
- At 390×844 the controls, sliders, footer and boss fit without overlap or
  horizontal overflow. Landscape controls also fit. The full-height canvas was
  confirmed after resize before capturing.
- Existing isolated flare captures at ages 0, 7 and 14 show a subtle pale local
  lift fading back to violet. They support the visual progression only; exact
  timer behaviour is covered by the separate automated checks.

Independent captures: `visual-review-bright-approach.png`,
`visual-review-bright-high-inside.png`, `visual-review-bright-portrait.png`, and
`visual-review-crossing-00.png` through `visual-review-crossing-26.png` in 2 s
steps. Also inspected the existing Chromium overview, approach, inside,
isolated, low/high and flare 0/7/14 captures.

The nebula alone reports **1 draw / 160 triangles / 1 alpha texture** at high
quality. Sky and boss costs are separate. This review adds no physical-iPhone
FPS, thermal, full-game integration or multiplayer-performance claim.
