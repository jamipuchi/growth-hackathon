# Quadruped and flyer lane

Scope: new quadruped/flyer generator, GLBs, editable Blender sources, clip manifests and prefixed evidence only. Existing person files and shared channel/README remain untouched.

Current: both references, editable sources and complete clip sets are exported. Quadruped: 4,344 triangles, 19 bones, 10 clips, 742,356-byte GLB. Flyer: 3,088 triangles, 8 bones, 6 clips, 443,184-byte GLB. Both have one skinned mesh, one primitive, one vertex-colour PBR material, zero textures and one influence per vertex. Front legs parent to `spine_2`; hind legs to `hips`; flyer claws are body-weighted because the contract has no claw bones.

Verification: Blender 5.2.2 export succeeded; `quadruped-flyer-validation.json` records binary/static checks for finite geometry, unit normals, valid indices, normalized weights, exact bones/hierarchy, sockets, material/texture budget, all named clips, 30 fps-aligned quaternion-only channels and matching loop endpoints. Source saves have no active action and are reset to rest pose. Run `Blender --background --python assets/A-008-rigs/generate_quadruped_flyer.py` to regenerate both. The generator writes only this lane's new files.

Handoff: parent has both files for standalone browser/proportion/visual QA. No browser or server was launched in this lane. Browser results, phone performance and arbitrary generated-mesh retargeting are not established by these static checks.

Integration limitation: root travel/height, gravity, ground contact and landing/seated/death placement stay external; clips do not key translation or scale.

Independent retarget follow-up: added `creatures-retarget-check.js`, exporting `checkRetargetBases(type)`. It constructs an identity-local-quaternion target with the same rest joint positions, checks all clips at five phases for actor-frame position and world-rotation-delta equivalence within 1e-4, and repeats under different actor translations/rotations. `node --check` passes. Runtime result is pending parent invocation through the standalone verifier; no browser/server was launched in this lane. The check intentionally does not claim generated game-mesh/skin-weight coverage.
