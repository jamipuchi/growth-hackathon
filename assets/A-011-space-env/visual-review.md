# A-011 independent visual review

**Pass after fixes — 2026-10-10, Europe/Madrid.** Separate Playwright CLI session
`space-env-review`, Chromium 154 on macOS, DPR 1. Reviewed bright `space` and dim
`nebula` variants at 1440×1000, with hero compositions at 390×844 and 844×390.
These are desktop browser viewports, not physical-phone performance tests.

- Both variants retain blue/violet colour and visible cloud detail. The dim
  version reduces brightness without losing the composition. Boss silhouette,
  armour facets, warm seams, ship and planet remain distinguishable in the
  hero scene; the hero also uses direct lights.
- Forward, opposite and wrap views render without blank regions. The final
  Chromium wrap is continuous. Separately inspected the parent's final
  `preview-webkit-nebula-seam.png`: the earlier thin central dark stripe is gone.
- Both poles now have smooth centres without the original radial pinch or
  centreline. Some elongated stars remain around the outer polar region of the
  source artwork. The delivered helper's polar blending and wrapped-UV gradient
  handling are part of the verified appearance; generic raw-JPEG mapping does
  not include those guards.
- Diffuse-only probe spheres render with the expected strong blue/purple fill;
  their modelling is subdued compared with the direct-lit hero composition.
- Portrait and landscape controls/footer fit. After the portrait adjustment,
  the ship wings and planet rim are within the 390×844 canvas. No horizontal
  document overflow was observed. Footer counts now follow the current view.
- Final independent Chromium run: **37 checks passed**, no failed checks,
  shader errors, console errors or warnings.

All 18 `visual-review-*.png` files were refreshed after the final fixes. The
desktop set covers `{space,nebula}` × `{hero,forward,opposite,seam,north,south,probe}`;
the remaining four capture each variant's hero at both phone-sized viewports.
Sky cost is **1 draw / 12 triangles / 1 active texture**; hero props and probe
spheres have separate costs. Real iPhone FPS, thermal behaviour and final game
contrast remain outside this review.
