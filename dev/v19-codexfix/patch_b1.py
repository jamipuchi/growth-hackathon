#!/usr/bin/env python3
# v19-codexfix B1 patch for render.js: one draw-call budget for the island's actors (TV <= 120, phone <= 80 calls in every frame).
# Usage: python3 -I patch_b1.py <path/to/render.js>   (every anchor must match exactly once; nothing is written otherwise)
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
edits = []

def rep(old, new, count=1):
    edits.append((old, new, count))

def alt(*pairs):
    # exactly one of these (old, new) variants must match once (the main tree vs the frozen HEAD)
    hits = [(o, n) for o, n in pairs if src.count(o) == 1]
    if len(hits) != 1:
        sys.exit("no single variant matches:\n" + pairs[0][0][:300])
    edits.append((hits[0][0], hits[0][1], 1))

# 1. Cost helpers + a budget-aware entPlanLod (returns the draw calls it gave out).
rep(
"""function entPlanLod(items, phone, cap, near, far, order, t) {
  let forced = 0;
  order.length = 0;
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    s.hadMesh = s.wantMesh;
    if (s.forced) { s.wantMesh = true; forced++; continue; }""",
"""// v1.9 (Codex B1): `budget` = draw calls left for these views this frame (IslandWorld.actorBudget); the forced ones always get their
// mesh, the others nearest first while their cost fits (meshCost(): the model's draws, a guess before it is built). Returns the calls
// given out. Without a budget (space) only the cap counts, as before.
function entPlanLod(items, phone, cap, near, far, order, t, budget = Infinity) {
  let forced = 0, used = 0;
  const costs = budget !== Infinity;
  order.length = 0;
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    s.hadMesh = s.wantMesh;
    if (s.forced) { s.wantMesh = true; forced++; if (costs) used += s.meshCost(); continue; }""")
rep(
"""  const room = Math.max(0, cap - forced);
  for (let i = 0; i < order.length; i++) order[i].wantMesh = i < room;
  for (let i = 0; i < items.length; i++) { const s = items[i]; if (s.wantMesh && !s.hadMesh) s.keepUntil = t + (s.dwell || 0); }
}""",
"""  const room = Math.max(0, cap - forced);
  let full = false; // nearest first: once one does not fit, the farther ones stay impostors too (no far mesh next to a near glow)
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    let want = i < room && !full;
    if (want && costs) { const c = s.meshCost(); if (used + c > budget) { want = false; full = true; } else used += c; }
    s.wantMesh = want;
  }
  for (let i = 0; i < items.length; i++) { const s = items[i]; if (s.wantMesh && !s.hadMesh) s.keepUntil = t + (s.dwell || 0); }
  return used;
}

// v1.9 (Codex B1): what a model costs in draw calls: meshes x material groups (three draws a double-sided transparent material twice),
// counted again every 2 s (a model may grow parts after it is built). An upper bound: parts that hide count anyway.
let entCallsClock = 0; // IslandWorld.update's frame counter
function entCallsOf(o) {
  if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return 0;
  const arr = Array.isArray(o.material), m = arr ? o.material[0] : o.material;
  const groups = arr && o.geometry && o.geometry.groups.length ? o.geometry.groups.length : 1;
  return groups * (m && m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass ? 2 : 1);
}
function entCalls(model) {
  if (!model || !model.object3d) return 0;
  if (model._calls === undefined || entCallsClock - model._callsAt > 120) {
    let n = 0;
    model.object3d.traverse((o) => { n += entCallsOf(o); });
    model._calls = n;
    model._callsAt = entCallsClock;
  }
  return model._calls;
}
const ENT_COST_GUESS = 3; // draws of a view's model before it is built (the A-008 person, the A-009 ship and car: 3)""")

# 2. lodHumans: the TV forces the nearest humans only while their meshes fit the budget.
rep(
"""function lodHumans(items, cap) {
  let n = 0;
  for (let i = 0; i < items.length; i++) if (items[i].forced) n++;
  while (n < cap) {""",
"""function lodHumans(items, cap, budget = Infinity) {
  let n = 0, used = 0;
  const costs = budget !== Infinity; // v1.9 (Codex B1): the nearest humans while their meshes fit (IslandWorld.actorBudget)
  for (let i = 0; i < items.length; i++) if (items[i].forced) { n++; if (costs) used += items[i].meshCost(); }
  while (n < cap) {""")
rep(
"""    if (!best) break;
    best.forced = true;
    n++;
  }
}""",
"""    if (!best) break;
    if (costs) { const c = best.meshCost(); if (used + c > budget) break; used += c; }
    best.forced = true;
    n++;
  }
}""")

# 3. meshCost on the three kinds of island actors, and their groups marked (IslandWorld.countFixed skips them).
rep(
"""  beforeSwap() {}
  afterSwap() {}""",
"""  beforeSwap() {}
  afterSwap() {}
  meshCost() { return this.model ? entCalls(this.model) : ENT_COST_GUESS; } // v1.9 (Codex B1): draws of its mesh (entPlanLod budget)""")
rep(
"""    this.smokeAcc = 0;
    this.popT = -1;
    island.scene.add(group);""",
"""    this.smokeAcc = 0;
    this.popT = -1;
    group.userData.actor = true; // v1.9: an actor (its draws are in the actor budget, not in IslandWorld.countFixed)
    island.scene.add(group);""")
rep(
"""    this.setType("person");
    island.scene.add(this.group);
  }""",
"""    this.setType("person");
    this.group.userData.actor = true; // v1.9: an actor (its draws are in the actor budget, not in IslandWorld.countFixed)
    island.scene.add(this.group);
  }
  // v1.9 (Codex B1): draws of its mesh for the actor budget (a guess before it is built; the fallback shield bubble counts too).
  meshCost() { return (this.model ? entCalls(this.model) : ENT_COST_GUESS) + (this.shield.visible ? 1 : 0); }""")

# 4. Decoys: a one-draw stand-in, the layer's budget, meshCost.
rep(
"""// One decoy on screen: the owner's DRAWN ship (space) or explorer (island) from the drawing cache, else a plain stand-in, as a hologram""",
"""// v1.9 (Codex B1): a decoy's stand-in in ONE draw (the hologram tints it anyway): the placeholder explorer / ship merged into one
// vertex-coloured mesh (they were 4 / 2 draws: 8 TV decoys were 32 of the crowded island's 144 calls); a toy as it is (one material).
function holoStandIn(type, colorHex) {
  if (type !== "person" && type !== "ship") return entToy(type, colorHex);
  const parts = [];
  if (type === "person") {
    parts.push(entPart(new THREE.CapsuleGeometry(0.33, 0.7, 3, 8), colorHex, 0, 0.75, 0));
    parts.push(entPart(new THREE.SphereGeometry(0.3, 12, 8), 0xf1f5f9, 0, 1.5, 0));
    parts.push(entPart(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI).rotateY(Math.PI), 0x0e7490, 0, 1.52, -0.14));
    parts.push(entPart(new THREE.BoxGeometry(0.45, 0.5, 0.22), 0xf1f5f9, 0, 0.95, 0.3));
  } else {
    parts.push(entPart(new THREE.ConeGeometry(0.6, 3, 6).rotateX(-Math.PI / 2), colorHex));
    parts.push(entPart(new THREE.BoxGeometry(3.2, 0.12, 0.9), 0x1e293b, 0, 0, 0.6));
  }
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: true });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  return { object3d: group, materials: [mat], engines: ENT_ENGINES, dispose() { group.removeFromParent(); geo.dispose(); mat.dispose(); } };
}

// One decoy on screen: the owner's DRAWN ship (space) or explorer (island) from the drawing cache, else a plain stand-in, as a hologram""")
rep(
"""    this.group = new THREE.Group();
    this.group.visible = false;
    layer.world.scene.add(this.group);""",
"""    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.userData.actor = true; // v1.9: an actor (its draws are in the actor budget, not in IslandWorld.countFixed)
    layer.world.scene.add(this.group);""")
MESHCOST_DECOY = """
  // v1.9 (Codex B1): draws of its mesh for the layer's budget (a drawing on its way: a guess; the stand-in: one draw).
  meshCost() { return this.model ? entCalls(this.model) : this.claim.e ? ENT_COST_GUESS : 1; }"""
alt(
# main tree after v19-assets (the A-009 car stand-in for a car decoy)
("""    if (!this.model) this.use(this.mode ? (type === "person" ? placeholderExplorer(this.colorHex) : (type === "car" && defaultCarMake(this.colorHex)) || entToy(type, this.colorHex)) : placeholderShip(this.colorHex), "stand-in");
  }""",
"""    if (!this.model) this.use((this.mode && type === "car" && defaultCarMake(this.colorHex)) || holoStandIn(this.mode ? type : "ship", this.colorHex), "stand-in"); // v1.9: a person / ship stand-in in one draw (was 4 / 2)
  }""" + MESHCOST_DECOY),
# HEAD 2640c2d
("""    if (!this.model) this.use(this.mode ? (type === "person" ? placeholderExplorer(this.colorHex) : entToy(type, this.colorHex)) : placeholderShip(this.colorHex), "stand-in");
  }""",
"""    if (!this.model) this.use(holoStandIn(this.mode ? type : "ship", this.colorHex), "stand-in"); // v1.9: one draw (was 4 / 2)
  }""" + MESHCOST_DECOY))
rep(
"""    this.streaks = world.streaks || (this.ownStreaks = new StreakBatch(48));
    if (this.ownStreaks) world.scene.add(this.ownStreaks.mesh);
  }""",
"""    this.streaks = world.streaks || (this.ownStreaks = new StreakBatch(48));
    if (this.ownStreaks) world.scene.add(this.ownStreaks.mesh);
    this.budget = Infinity; // v1.9 (Codex B1): draw calls the decoys may use this frame (IslandWorld sets it; space: no limit but the cap)
    this.used = 0; // ... and what they used
  }""")
rep(
"""    const cap = this.phone ? 3 : 8;
    for (let i = 0; i < order.length; i++) {
      const v = order[i];
      v.wantMesh = i < cap && v.lodDist < 420;
      try { v.step(t, dt, glow); } catch (e) { entWarn("decoy", e); }
    }""",
"""    const cap = this.phone ? 3 : 8, budget = this.budget;
    let used = 0;
    for (let i = 0; i < order.length; i++) {
      const v = order[i];
      let want = i < cap && v.lodDist < 420;
      if (want && budget !== Infinity) { const c = v.meshCost(); if (used + c > budget) want = false; else used += c; } // nearest first
      v.wantMesh = want;
      try { v.step(t, dt, glow); } catch (e) { entWarn("decoy", e); }
    }
    this.used = used;""")

# 5. IslandWorld: the budget (limit - margin - bloom passes - the scene's own draws), explorers -> decoys -> parked ships.
rep(
"""    const ecap = this.phone ? 8 : 14;
    lodHumans(items, ecap);
    entPlanLod(items, this.phone, ecap, this.big ? 300 : 220, this.big ? 360 : 260, this.lodOrder || (this.lodOrder = []), t);""",
"""    // v1.9 (Codex B1): ONE draw-call budget for the actors, so a crowded island (25 players, 25 parked ships, 8 decoys, effects) stays
    // inside the screen's limit in every frame: explorers first (the TV's humans nearest first), then decoys, then parked ships, each
    // nearest first while its mesh fits; the rest are the usual glow impostors. Up close nothing changes: the nearest keep their meshes.
    entCallsClock++;
    let budget = this.actorBudget(ctx.bloom !== false);
    const ecap = this.phone ? 8 : 14;
    lodHumans(items, ecap, budget);
    budget -= entPlanLod(items, this.phone, ecap, this.big ? 300 : 220, this.big ? 360 : 260, this.lodOrder || (this.lodOrder = []), t, budget);""")
rep(
"""    for (const e of this.explorers.values()) if (e.seen !== this.frame) { e.dispose(); this.explorers.delete(e.name); }
    this.shieldMat.uniforms.uTime.value = t;""",
"""    for (const e of this.explorers.values()) if (e.seen !== this.frame) { e.dispose(); this.explorers.delete(e.name); }
    this.shieldMat.uniforms.uTime.value = t;
    // Mines, decoys (inside the budget, before the parked ships), emp / ink / tractor looks.
    this.mischief.budget = Math.max(0, budget);
    this.mischief.update(dt, t, snap, ctx, camera);
    budget -= this.mischief.used;""")
rep(
"""    entPlanLod(pitems, this.phone, this.phone ? 6 : 10, this.big ? 300 : 220, this.big ? 360 : 260, this.lodOrderParked || (this.lodOrderParked = []), t);""",
"""    entPlanLod(pitems, this.phone, this.phone ? 6 : 10, this.big ? 300 : 220, this.big ? 360 : 260, this.lodOrderParked || (this.lodOrderParked = []), t, Math.max(0, budget));""")
rep(
"""    // Island bullets (mode 1).
    writeBullets(this.bullets, this.dummy, snap.bullets, 1);
    this.mischief.update(dt, t, snap, ctx, camera);""",
"""    // Island bullets (mode 1).
    writeBullets(this.bullets, this.dummy, snap.bullets, 1);""")
rep(
"""  clearForRound() {
    this.particles.clear();
    this.mischief.clear();
    this.efx.clear();
  }""",
"""  clearForRound() {
    this.particles.clear();
    this.mischief.clear();
    this.efx.clear();
  }

  // v1.9 (Codex B1): draw calls left for the actors this frame: the screen's limit (TV 120, phone 80) minus a margin, the bloom passes
  // (14 on the bloom tiers) and the scene's own draws (kit, water, sky, chests, glows, particles, mines, effects, the cockpit), counted
  // as if all of them were in view (an upper bound, so a camera cut never overshoots).
  actorBudget(bloom) {
    this.fixedDraws = this.countFixed();
    return (this.phone ? 80 : 120) - 2 - (bloom ? 14 : 0) - this.fixedDraws;
  }
  // Every frame (a walk of the scene without the actors: ~100 nodes). A-010's system counts in full, shown or not (its shields and
  // delayed blasts may show up later in this frame's update); everything else shows or hides between frames (stream messages).
  countFixed() {
    if (this.efx.sys && this.efx.sys.object3d) this.efx.sys.object3d.userData.pool = true;
    let n = 0;
    const walk = (o, all) => {
      if (o.userData.actor || (!all && !o.visible)) return;
      if (o.userData.pool) all = true;
      n += entCallsOf(o);
      const c = o.children;
      for (let i = 0; i < c.length; i++) walk(c[i], all);
    };
    walk(this.scene, false);
    return n;
  }""")

# 6. The frame loop tells the worlds whether bloom is on (its passes are draw calls too).
rep(
"""  const frameCtx = { me: null, mePlayer: null, subject: null, cockpit: false, phone, big, t: 0, serverNow: 0, planet: null, lobby: undefined };""",
"""  const frameCtx = { me: null, mePlayer: null, subject: null, cockpit: false, phone, big, t: 0, serverNow: 0, planet: null, lobby: undefined, bloom: true };""")
rep(
"""    ctx.t = t; ctx.serverNow = serverNow(); ctx.planet = game.space.planet; ctx.lobby = undefined;""",
"""    ctx.t = t; ctx.serverNow = serverNow(); ctx.planet = game.space.planet; ctx.lobby = undefined;
    ctx.bloom = TIERS[game.perf.tier].bloom; // v1.9: the bloom passes count in the island's draw-call budget (IslandWorld.actorBudget)""")

out = src
for old, new, count in edits:
    n = out.count(old)
    if n != count:
        sys.exit(f"anchor found {n} times (want {count}):\n{old[:300]}")
    out = out.replace(old, new)
open(path, "w", encoding="utf-8").write(out)
print(f"patched {path}: {len(edits)} edits")
