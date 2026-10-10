# A-009 car progress

Scope: new car files only. Existing ship/explorer GLBs, defaults.js, generate.py and README.md are preserved.

Design agreed with parent: original 4m ivory/slate expedition buggy, open cabin and four chunky wheels. Raw GLB uses three static mesh drawables (body, lights, merged wheels) plus four named wheel pivots. car.js replaces merged wheels with one four-instance batch, driven by those pivots, keeping three calls while allowing wheel rotation/steering.

Complete: deterministic Blender generator, GLB/source/manifest, car.js runtime helper, car-preview.html, car-validate.py with car-validation.json, and car-README.md.

Current export: 420,120 bytes; SHA-256 e0775cab48a7d73cc165567c206ec7cdede4f186b0d8517f8e06aa805ff99a7c. 4,776 triangles (body1,864 + lamps112 + wheels2,800), three raw and helper draws, zero textures. Rest size2.676m wide ×2.094m tall ×4.019m long, Y-up/−Z-forward and minY0.

46 structural checks pass. JS and preview inline-module syntax pass. Fixed mismatched copied-wheel cap triangulation by triangulating the prototype before duplication. Remaining translated-copy normal rounding is measured at5.50e-5 components; helper and validator use1e-4 normal tolerance,1e-5 position/colour tolerance.

Parent owns car-verify.html, car-browser-chrome.json, car-browser-webkit.json, browser visuals and ORCHESTRATE delivery. Its reports now pass19/19 in Chromium and19/19 emulatedWebKit, including actual3calls/4776tri/zeroimage textures, exact raw-to-batch pixels, wheel motion, parent transforms, independent instances and cleanup. Visual review is the parent's remaining step. No physical-phone/full-game claims. No further source edits planned except concrete QA fixes. No game integration edits.

Final parent review complete: desktop hero/front/rear/roof/steering and WebKit portrait390×844/landscape844×390 visually inspected. Final standalone WebKit runtime report is390×844/DPR3,19/19 checks. Responsive preview framing corrected. Ready for integration; no physicalphone or fullgame verdict.
