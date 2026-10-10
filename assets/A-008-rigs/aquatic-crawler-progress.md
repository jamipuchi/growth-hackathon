# Swimmer, crawler and serpent work

Scope: new aquatic/crawler source, three reference GLBs, their blend files and clip manifests only. Existing person assets, shared README, helpers and request channels are preserved.

- Contract read: ORCHESTRATE section 4 and rigs.js bone/socket parents.
- Design: rounded toy swimmer with continuous body and broad fins; friendly eight-legged shell crawler with articulated legs; long toy serpent with continuous weighted body and a directional face.
- Target: one skinned mesh, one vertex-colour PBR material, zero textures, fewer than 5,000 triangles each; quaternion-only 30 fps clips with exact looping endpoints.
- Export/validation: complete. One skinned mesh, one PBR vertex-colour material and zero textures each. The independent binary audit passes embedded resources, legal names, exact hierarchy/clip names, rotation-only tracks, 30 fps sample times, normalised weights/quaternions and exact loop endpoints.
- Swimmer: 2,356 triangles, 374,704 bytes, six bones, at most two influences. Clips: swim (1.4 s, loop), dart (0.8 s), hit (0.5 s), die (1.4 s).
- Crawler: 4,956 triangles, 683,948 bytes, 17 bones, one influence. Clips: idle (2.4 s, loop), hit (0.5 s), die (1.4 s). Walking remains procedural IK. Six decorative spots were simplified to meet the 5,000-triangle ceiling without changing silhouette.
- Serpent: 2,340 triangles, 380,660 bytes, eight bones, at most two influences. Clips: slither (1.8 s, loop), strike (0.9 s), coil (2.4 s, loop), hit (0.5 s), die (1.4 s).
- Deformation: every authored frame sampled in Blender, 127/132/215 frames respectively; all coordinates finite. Min/max posed edge-length ratios: swimmer 0.775–1.220, crawler 0.99998–1.00002, serpent 0.523–1.450. No sampled collapsed or exploding edges. Source blends save at rest with no active action and identity bone poses. Exact socket parents and world rest positions pass.
- Visual evidence: six 640×640 Blender renders inspected for rest/swim, rest/hit and rest/coil. Faces remain directional, crawler leg joints remain connected, and the continuous swimmer/serpent skins remain connected in the rendered poses. These are asset-only offline renders, not game performance evidence.
- Evidence: `aquatic-crawler-validation.json`, `aquatic-crawler-deformation.json`, `aquatic-crawler-files.json`, `aquatic-crawler-review.py`, and the six `aquatic-crawler-*.png` renders. Generation is reproducible with `generate_aquatic_crawler.py`; review never saves over a source blend.
- Browser/physical-device validation: handled separately by the parent; no performance claim here.
- Original person file hashes below were rechecked after export and remain identical. No shared helper, README, request channel or game source was edited by this subtask.

Person preservation snapshot before work:

```json
{
  "person_source.blend": "c323e29d22a660715fd56376acdf83973b198d8fc3dacf07c5522c351c475923",
  "generate.py": "5034118c46530fc97544370a998e4b521904d889b7960d38ac79d077273509dd",
  "person.js": "77b3f296e7b52d77924c68de95ce77f97ef6398f5c70ca71658c240d258d82ab",
  "person-clips.json": "725d69276aea4e6c8ed487bee4bde3cc4c7859ed661494941e9e2e90c9389270",
  "person.glb": "f4b4f58c8a0433019eade256dd99d710e9f2d88920fbc7cf120983772bc84827"
}
```
