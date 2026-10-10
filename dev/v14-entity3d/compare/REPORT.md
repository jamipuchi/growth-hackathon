# Planet entities from parts (v14-entity3d, 10 Oct 2026)

Drawn persons, animals, cars, bikes and blobs become chunky 3D models built from a gpt-6.1-sol "body spec"
(astra-body.js) by entity3d.js; parts ride a skeleton (person = the exact A-008 skeleton, so all 33 clips play;
quadrupeds get built-in clips; cars/bikes spin wheel bones; blobs squash procedurally). Black-ink drawings take the
player's colour; coloured drawings keep theirs. Textures: the shared ship atlas (A-012 kit).

- Spec call (10:33): 0/10 schema failures, latency p50 1922 ms, p90/max 3806 ms.
- Budgets (budget.mjs, 10:44): <= 2.6k tris phone game quality, <= 4k result card, <= 5k TV; <= 3 draw calls; 1-17 ms builds.
- Real game (game-check.mjs --real 10, 10:40): /generate 1.6-2.1 s; all 4 explorers built by entity3d on the TV island
  and the phone result card (3-7 ms, 3.1-4k tris), 0 page errors. Real calls used: 28/40.
- Contact sheet: compare/gpt-6.1-sol/contact.png (idle / run / dig, 3 angles).

| drawing | resembles | looks | animates | note |
|---|---|---|---|---|
| astronaut-shovel | 4 | 4 | 4 | shovel forward in idle |
| astronaut-drill | 4 | 4 | 4 | drill small at TV distance |
| car-cannon | 4 | 4 | 3 | no vehicle dig pose |
| bike-lamp | 4 | 3 | 3 | no rider, thin from afar |
| dog-claws | 3 | 3 | 4 | generic cat/dog |
| blob | 4 | 4 | 3 | procedural squash only |
| color-person | 5 | 4 | 4 | clearly her |
| color-robot | 5 | 4 | 4 | clearly the robot |
| horse-saddle | 4 | 3 | 4 | neck a little llama-like |
| monster-truck | 4 | 4 | 3 | lifted body, drill, flames |
| mean | 4.1 | 3.7 | 3.6 | |

Next: per-clip tool grip, vehicle dig/drill motion, riders on bikes/saddles, clearer dog silhouette; astra-test call
counts (two calls per explorer drawing now); phone fps with 8 animated explorers.
