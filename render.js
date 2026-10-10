// Shared three.js renderer for the big screen (space.html) and the phones (controller.html).
// API (contract.js): startGame({ canvas, screen: "big"|"phone", view: "spectator"|"chase"|"cockpit", player }) → game
//   game.setView(view)  game.setPlayer(name)  game.dispose()  game.on(event, cb) → off()  game.hud()
//   game.entityOf(name) → the player's latest entity message or null
//   game.projectPlayers() → name-tag positions, nearest first: { name, color, x, y, hp, maxHp, visible, dist, bot, flags } (flags = the tick's flags)
//   game.pause(bool)    stop / resume drawing (the phone's opaque draw screen); the stream and the state keep up
//   game.on("mischief" | "cooldown", cb)   the phone's OWN mischief hit / verb cooldown (filtered to game.player; the sound is played here)
//   game.sfx (= the `sfx` export)          the one sound engine (sfx.js through a facade; see "Sound." below)
//   createEntityPreview({ canvas, quality }) → { show({ image, kind, color, spec? }), clear(), setVisible(bool), dispose() } (exported)
// It owns the /events connection (a phone `?player=<name>`, the TV `?screen=big`), interpolation (~100 ms behind the newest tick), the two
// scenes (space and island) incl. the mischief layer (mines, decoys, emp / ink / tractor), adaptive quality (?tier=N pins it), the ?perf
// overlay and POST /perf. contract.js and terrain.js must be loaded first (globals).
// Drawn ships and explorers come from inflate.js through the cache above `// Space scene.` (one mesh built per frame at most); a drawn
// SHIP whose entity carries a spec (v1.4, astra-ship.js) is built from its parts by ship3d.js instead (inflate.js when that fails), and
// a drawn EXPLORER whose entity carries a body spec (v1.4, astra-body.js) by entity3d.js (rigged: the clips play on it).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const Contract = globalThis.Contract;
const Terrain = globalThis.Terrain;
const { TUNING, ROCK_TYPE_NAMES, OBJECTIVES, PERF_POST_SECONDS } = Contract;
const INTERP_DELAY_MS = 100;
const CUT_SECONDS = 8;

// Every player-facing string render.js produces (game.hud() statuses), in one place for review. {m} = metres,
// {pct} = a percentage. Plain words, what to do next; the objective titles come from Contract.OBJECTIVES. A status never
// names a button or a skill before the game's own hints do (no "PRESS LAND", "DIG IT UP"): it says where to go and how it
// stands; only the progress lines name the work, and only once the player is doing it.
const HUD_COPY = {
  getReady: "GET READY",
  waitStart: "WAITING FOR THE HOST TO START",
  roundOver: "ROUND OVER",
  timeUp: "TIME'S UP",
  allChests: "EVERY CHEST IS OPEN",
  assists: "ALL POWERS ON",
  noWeapon: "YOUR SHIP HAS NO WEAPON YET",
  bossAway: "BOSS {m} M AWAY · FLY TO IT",
  bossHp: "BOSS HEALTH {pct} · TAKE IT DOWN",
  planetAway: "PLANET {m} M AWAY · FLY TO IT",
  landNow: "CLOSE ENOUGH TO TOUCH DOWN",
  planetOpen: "THE PLANET IS OPEN",
  buriedChest: "BURIED CHEST {m} M · FIND THE X",
  rockChest: "ROCK CHEST {m} M · GET IT OPEN",
  digging: "DIGGING {pct}",
  drilling: "DRILLING {pct}",
  allOpen: "EVERY CHEST IS OPEN",
  // Used only if contract.js has no title for an objective.
  objectives: { boss: "REACH THE BOSS", destroyBoss: "DESTROY THE BOSS", planet: "LAND ON THE PLANET", openChests: "OPEN THE CHESTS", weapon: "DRAW A WEAPON" },
};

// ---------------------------------------------------------------------------------------------------------------
// Asset loader: every delivery from assets/ goes through this table. Swapping a placeholder for a delivery is one
// line here; each entry resolves to null when the asset is missing or fails, and the caller falls back to a
// procedural placeholder that follows the art direction.
const assetUrl = (p) => new URL(`./assets/${p}`, import.meta.url).href;
const ASSETS = {
  boss: async () => {
    const m = await import(assetUrl("A-001-boss-rock/boss.js"));
    const { boss } = await m.createBossEncounter({ decoyCount: 0 });
    return { object3d: boss, setState: (s) => m.setArmourState(boss, s), update: m.updateBoss ? (dt) => m.updateBoss(boss, dt) : null };
  },
  rocks: async () => {
    const m = await import(assetUrl("A-002-rocks/rocks.js"));
    return { templates: await m.loadRocks(), createRockField: m.createRockField };
  },
  ship: async (color) => (await import(assetUrl("A-009-defaults/defaults.js"))).createDefaultShip({ color }),
  // A-009 explorer driven by the A-008 person library (33 clips: kneel, step_out, climb_in…); A-009's own 8 clips if
  // the library fails to load.
  explorer: async (color) => {
    const D = await import(assetUrl("A-009-defaults/defaults.js"));
    try {
      const P = await import(assetUrl("A-008-rigs/person.js"));
      const ex = await D.createDefaultExplorer({ color, animation: null });
      const motion = await P.createPersonAnimator(ex.object3d, { animation: "idle" });
      return { ...ex, clips: motion.clips, play: motion.play, update: (dt) => motion.update(dt), dispose() { motion.dispose(); ex.dispose(); } };
    } catch (e) {
      console.warn("[render] A-008 clips unavailable, using A-009 clips:", e?.message || e);
      return D.createDefaultExplorer({ color, animation: "idle" });
    }
  },
  chest: async (state) => (await import(assetUrl("A-006-chest/chest.js"))).createChest({ state }),
  // A-004 Earth-like planet (World look: PlanetLook): built per round from the seed and the scene's sun, shown locked from the
  // start. On the phone its two 2048 x 1024 maps are shrunk to 1024 x 512 first (texture budget). Null on failure: the
  // caller draws the procedural planet instead.
  planet: async ({ seed, radius, unlocked, sun, phone }) => {
    const m = await import(assetUrl("A-004-planet/planet.js"));
    if (phone) await shrinkPlanetMaps(m);
    const planet = await m.createPlanet({ seed, radius, unlocked, sunDirection: sun });
    planet.surface.material.fog = false; // a far planet must not dissolve into the fog
    return planet;
  },
  // A-011 blue / violet / magenta nebula panorama + diffuse light probe (World look). On the phone its 2048 x 1024 jpg is
  // shrunk to 1024 x 512. Null on failure: the procedural backdrop stays.
  spaceEnv: async ({ phone }) => {
    const m = await import(assetUrl("A-011-space-env/environment.js"));
    const loader = phone ? { loadAsync: (url) => loadShrunkTexture(url, 1024, 512) } : undefined;
    return m.createSpaceEnvironment({ variant: "space", intensity: 1, lightingIntensity: 0.4, ...(loader ? { loader } : {}) });
  },
  // A-003 decorative violet / magenta cloud arcs round the boss: the module's createNebula, built per round by
  // SpaceWorld.buildCloud at the server's nebula. Null on failure: the old additive puff batch stays.
  nebula: async () => (await import(assetUrl("A-003-nebula/nebula.js"))).createNebula,
  // A-002 giant foreground rocks (60-120 m, ONE draw call for all, 256 triangles each), placed per round by SpaceWorld.setLook
  // beside the spawn -> boss corridor. Null on failure: the procedural huge decorative rocks stay.
  foreground: async ({ seed, rocks }) => (await import(assetUrl("A-002-rocks/foreground.js"))).createForegroundRocks({ seed, rocks }),
  // A-007 camera-mounted cockpit (1,366 triangles, 3 calls, no textures), phone only: startGame hangs it on the camera and
  // fits it (fitToCamera). Null on failure: the procedural clip-space frame stays.
  cockpit: async () => (await import(assetUrl("A-007-cockpit/cockpit.js"))).createCockpit(),
  // A-005 island kit: its terrain and instanced props (palms with LOD and breeze, bushes, rocks, cliffs). The game
  // keeps its own cheap water, sky and lights (the Water add-on stays off the phone, PLAN.md section 4). Phones get
  // fewer props and a triangle cap that leaves room for players, chests and effects.
  island: async ({ seed, clearings, phone }) => {
    const m = await import(assetUrl("A-005-island/island.js"));
    const counts = phone ? { resolution: 110, palmCount: 110, bushCount: 50, rockCount: 40, cliffCount: 10, triangleBudget: 55000, palmDetailDistance: 40 } : {};
    const kit = await m.createIsland({ seed, size: Terrain.ISLAND_SIZE, heightAt: (x, z) => Terrain.height(x, z, seed), clearings, ...counts });
    for (const o of [kit.water, kit.sky, kit.sunlight, kit.ambient]) if (o) o.visible = false;
    return kit;
  },
  // A-010 pooled effects (explosions, sparks, flare, scan rings, hex shields, dust, dirt, gold): the module itself; each world
  // builds its own system from it (WorldFx). The browser caches the import, so both worlds share one module.
  fx: async () => import(assetUrl("A-010-fx/fx.js")),
};
const assetCache = new Map();
function loadAsset(name, ...args) {
  const fn = ASSETS[name];
  if (!fn) return Promise.resolve(null);
  const key = name + JSON.stringify(args);
  // Per-instance assets (ships, explorers) are not cached; shared ones (boss, rocks) are.
  const shared = name === "boss" || name === "rocks";
  if (shared && assetCache.has(key)) return assetCache.get(key);
  const p = fn(...args).catch((e) => {
    console.warn(`[render] asset ${name} unavailable, using placeholder:`, e?.message || e);
    return null;
  });
  if (shared) assetCache.set(key, p);
  return p;
}

// Optional modules, loaded lazily so the game still runs without them: anim.js (procedural animation per entity)
// and transition.js (the landing / take-off shot).
let Anim = null, Transition = null;
import("./anim.js").then((m) => (Anim = m)).catch((e) => console.warn("[render] anim.js unavailable:", e?.message || e));
import("./transition.js").then((m) => (Transition = m)).catch((e) => console.warn("[render] transition.js unavailable:", e?.message || e));
// Player entities from the `entity` messages ({ [player]: { type, verbs, anims } }), for the animators.
const entities = new Map();
const animsFor = (player, type) => {
  const e = entities.get(player);
  return e && e.type === type && e.anims ? e.anims : undefined;
};
// Particles for the animators' effects (muzzle, sparks, bursts): reuse the scene's own batch, no extra draw calls.
function animFx(particles, color) {
  return (kind, socket, k, pos, dir) => {
    const big = kind === "muzzleBig" || kind === "warp" ? 2 : 1;
    particles.burst(pos, color, Math.round(6 * k * big), 6 * big, 0.35, 0.5 * big, 0.05, { boost: 2.5, drag: 2 });
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers.
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
function lerpAngle(a, b, u) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}
// Same convention as world.js: yaw around Y, then pitch around the ship's X; nose points to −Z.
function forwardOf(yaw, pitch, out = v3()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const hexColor = (c) => "#" + (c >>> 0).toString(16).padStart(6, "0");

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// Billboard batch: camera-facing quads in one draw call (instanced). Used for glows, flares, nebula puffs, particles.
// Unlike THREE.Points it has no point-size limit, and puffs fade out when the camera gets close (no overdraw).
const BB_VERT = /* glsl */ `
  attribute vec3 iPos; attribute float iSize; attribute vec4 iColor;
  uniform float uNearFade; uniform float uMaxAng;
  varying vec2 vUv; varying vec4 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float a = iColor.a;
    if (uNearFade > 0.0) a *= smoothstep(iSize * 0.2 * uNearFade, iSize * 0.8 * uNearFade, -mv.z);
    if (a < 0.003 || iSize <= 0.0 || mv.z > 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // uMaxAng (particles): a quad never spans more than uMaxAng x its distance, so a puff next to the camera cannot fill the view
    float sz = uMaxAng > 0.0 ? min(iSize, uMaxAng * -mv.z) : iSize;
    mv.xy += position.xy * sz;
    gl_Position = projectionMatrix * mv;
    vUv = uv; vColor = vec4(iColor.rgb, a);
  }`;
const BB_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform float uUseMap; uniform float uFade;
  varying vec2 vUv; varying vec4 vColor;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float g = uUseMap > 0.5 ? texture2D(uMap, vUv).a : exp(-d * d * 3.5) * (1.0 - smoothstep(0.85, 1.0, d)) + 0.6 * exp(-d * d * 40.0);
    gl_FragColor = vec4(vColor.rgb * g * vColor.a * uFade, 1.0);
  }`;
// The same quads with normal alpha blending (not additive): dark ink blobs, which an additive batch cannot draw.
const BB_FRAG_NORMAL = /* glsl */ `
  uniform sampler2D uMap; uniform float uUseMap; uniform float uFade;
  varying vec2 vUv; varying vec4 vColor;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float g = (1.0 - smoothstep(0.55, 1.0, d)) * (0.75 + 0.25 * (1.0 - d));
    gl_FragColor = vec4(vColor.rgb, g * vColor.a * uFade);
  }`;
class BillboardBatch {
  constructor(capacity, { map = null, nearFade = 0, renderOrder = 10, normal = false, maxAng = 0 } = {}) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", this.aPos);
    g.setAttribute("iSize", this.aSize);
    g.setAttribute("iColor", this.aColor);
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: BB_VERT,
      fragmentShader: normal ? BB_FRAG_NORMAL : BB_FRAG,
      uniforms: { uMap: { value: map }, uUseMap: { value: map ? 1 : 0 }, uNearFade: { value: nearFade }, uMaxAng: { value: maxAng }, uFade: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.geometry = g;
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, size, r, gr, b, a = 1) {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.color[i * 4] = r; this.color[i * 4 + 1] = gr; this.color[i * 4 + 2] = b; this.color[i * 4 + 3] = a;
  }
  addColor(p, size, c, a = 1, boost = 1) { this.add(p.x, p.y, p.z, size, c.r * boost, c.g * boost, c.b * boost, a); }
  end() {
    this.geometry.instanceCount = this.n;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aColor.needsUpdate = true;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

// Pooled particles drawn through one BillboardBatch: trails, sparks, explosions, dust, gold bursts.
class Particles {
  constructor(capacity, { normal = false, renderOrder = 12 } = {}) {
    // nearFade: a puff that fills the screen (a fireball the camera sits in) fades out instead of whiting it out; maxAng: and it
    // never spans more than half its distance (a ~14 degree half-angle, under half the TV's height), however big it was emitted
    this.batch = new BillboardBatch(capacity, { renderOrder, nearFade: 1, normal, maxAng: 0.5 });
    this.mesh = this.batch.mesh;
    this.cap = capacity;
    this.n = 0;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.c = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, col, boost = 1, drag = 0, grav = 0) {
    let i = this.n;
    if (i >= this.cap) i = Math.floor(Math.random() * this.cap); // pool full: recycle a random one
    else this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 3] = col.r * boost; this.c[i * 3 + 1] = col.g * boost; this.c[i * 3 + 2] = col.b * boost;
    this.life[i] = this.max[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.drag[i] = drag; this.grav[i] = grav;
  }
  burst(pos, col, count, speed, life, s0, s1, { boost = 2, drag = 1.5, grav = 0, spread = 0 } = {}) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.emit(pos.x + (Math.random() - 0.5) * spread, pos.y + (Math.random() - 0.5) * spread, pos.z + (Math.random() - 0.5) * spread,
        Math.cos(th) * s * sp, u * sp, Math.sin(th) * s * sp, life * (0.6 + Math.random() * 0.4), s0, s1, col, boost, drag, grav);
    }
  }
  update(dt) {
    const b = this.batch;
    b.begin();
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (const arr of [this.p, this.v, this.c]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
          for (const arr of [this.life, this.max, this.s0, this.s1, this.drag, this.grav]) arr[i] = arr[j];
        }
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const u = this.life[i] / this.max[i];
      const a = Math.min(1, u * 2.5);
      b.add(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2], lerp(this.s1[i], this.s0[i], u), this.c[i * 3], this.c[i * 3 + 1], this.c[i * 3 + 2], a);
    }
    b.end();
  }
  clear() { this.n = 0; }
}

// Pooled expanding rings (scan ping, blast shockwave, landing dust): flat ring that faces the camera or lies flat.
class RingPool {
  constructor(count) {
    this.items = [];
    this.group = new THREE.Group();
    const geo = new THREE.RingGeometry(0.92, 1, 96, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.visible = false;
      m.renderOrder = 11;
      this.group.add(m);
      this.items.push({ m, t: 0, dur: 1, size: 1, flat: false, inward: false });
    }
    this.next = 0;
  }
  // inward: the ring closes in on the spot instead of spreading from it (a tractor pulling someone in)
  spawn(pos, color, size, dur = 1.2, flat = false, inward = false) {
    const it = this.items[this.next++ % this.items.length];
    it.m.position.copy(pos);
    it.m.material.color.set(color).multiplyScalar(2.5);
    it.t = 0; it.dur = dur; it.size = size; it.flat = flat; it.inward = inward; it.m.visible = true;
  }
  update(dt, camera) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t += dt;
      const u = it.t / it.dur;
      if (u >= 1) { it.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - u, 3);
      it.m.scale.setScalar(Math.max(0.01, it.size * (it.inward ? 1 - 0.92 * e : e)));
      it.m.material.opacity = it.inward ? (1 - u * u) * 0.85 : (1 - u) * 0.9;
      if (it.flat) it.m.rotation.set(-Math.PI / 2, 0, 0);
      else it.m.quaternion.copy(camera.quaternion);
    }
  }
}

// A-010 effects (assets/A-010-fx): one pooled system per world scene (billboard sprites, planar rings, hex shields: at most 3 draw
// calls however many effects overlap), built lazily from ASSETS.fx. Null-safe: until (unless) it loads, `ok` is false and the
// callers keep their ad hoc Particles / RingPool effects. Sizes go through size(): grown with the camera distance so they read on
// the TV, never wider on screen than `cap` x their distance (a burst next to the camera cannot fill the view and white it out
// under bloom). The frame loop updates only the world on screen: a world that comes back after a gap drops what it held (A-010
// would resume the paused effects). Shields: shield() for each shielded view every frame; a view that stops asking (flag off,
// impostor, dead, in the landing shot, disposed) loses its bubble in the next update().
class WorldFx {
  constructor(world, mode) {
    this.world = world;
    this.sys = null;
    this.lights = [];
    this.frame = 0;
    this.lastT = -1;
    this.shields = new Map(); // view → { h, f, s, x, y, z }: its bubble's handle, the frame it was last asked for, its size and place
    this.queue = []; // delayed spawns (the boss's chain of blasts): { at, kind, x, y, z, base, cap, color, face }
    this.o = { size: 1, color: undefined, direction: undefined, normal: undefined, duration: undefined }; // spawn options (A-010 copies them)
    this.p = v3();
    this.d = v3();
    this.warned = false;
    const phone = world.phone, island = mode === "planet";
    this.ref = island ? (phone ? 25 : 30) : phone ? 50 : 70; // m: past this an effect grows with its distance (x1 .. this.grow)
    this.grow = phone ? 2 : 3.5;
    this.sweep = (r, v) => { if (r.f !== this.frame) { r.h.stop(); this.shields.delete(v); } };
    loadAsset("fx").then((m) => {
      if (!m) return;
      try {
        // Phone: smaller pools and no light (a light switching on recompiles the PBR shaders: a hitch on iPhone). Shields for 25 on
        // both (a slot holds a bubble only while its ship has a mesh, so their triangles follow the mesh cap). No boost emitters:
        // the streak engine trails stay.
        this.sys = m.createFxSystem({ scene: world.scene, seed: island ? 29 : 17, maxParticles: phone ? 448 : 1024, maxRings: phone ? 12 : 24, maxShields: phone ? 26 : 32, maxEmitters: 0, maxLights: phone ? 0 : 1 });
        // The TV's flare light stays in the light count at intensity 0 (A-010 hides it between flares): the PBR shader variant of
        // that light count is compiled once at load, never at the first flare mid-round.
        this.sys.object3d.traverse((o) => { if (o.isLight) { o.visible = true; this.lights.push(o); } });
      } catch (e) { console.warn("[render] A-010 effects unavailable:", e?.message || e); this.sys = null; }
    });
  }
  get ok() { return !!this.sys; }
  // An effect's size at p: `base` grown with the camera distance (x1 .. this.grow past this.ref m) so it reads on the TV, capped at
  // `cap` x the distance. A-010 at size s spans ~3 s (an explosion's fireball), so cap 0.06 keeps a blast within ~10 degrees of its
  // centre however close to the camera it goes off.
  size(p, base, cap) {
    const c = this.world.camPos, d = Math.max(1, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z));
    return Math.max(0.05, Math.min(base * clamp(d / this.ref, 1, this.grow), cap * d));
  }
  // From p towards the camera (space: rings face it, sparks fly at it), or undefined right at the camera.
  toCam(p) {
    const c = this.world.camPos, d = this.d.set(c.x - p.x, c.y - p.y, c.z - p.z);
    return d.lengthSq() > 1e-4 ? d : undefined;
  }
  // One effect (an A-010 kind or alias) at p, size s; dir = the sparks' direction and the rings' normal (default: up). A handle, or
  // null without A-010 (or when it refuses the input, e.g. a non-finite position).
  spawn(kind, p, s, color, dir, duration) {
    if (!this.sys) return null;
    const o = this.o;
    o.size = s; o.color = color; o.direction = o.normal = dir; o.duration = duration;
    try { return this.sys.spawn(kind, p, o); } catch (e) {
      if (!this.warned) { this.warned = true; console.warn("[render] A-010 spawn failed:", e?.message || e); }
      return null;
    }
  }
  // The same `delay` seconds from now, sized from the camera when it goes off (face: its rings face the camera).
  later(delay, kind, x, y, z, base, cap, color, face) {
    if (this.sys) this.queue.push({ at: this.lastT + delay, kind, x, y, z, base, cap, color, face });
  }
  // The hex bubble of `view` this frame at (x, y, z), size s (radius 2.5 s): true when A-010 draws it (the caller hides its own
  // mesh), false without A-010 (the caller's mesh stays). Not asked this frame = no bubble (swept in update()).
  shield(view, x, y, z, s) {
    if (!this.sys) return false;
    let r = this.shields.get(view);
    // a fresh bubble when its slot was cleared or recycled, or its ship's scale changed a lot (the lobby showcase, a landing dive);
    // checked every 16 frames only: a pop-in (scale 0 → 1.15 → 1 in 0.3 s) must not respawn it, and restart its fade-in, every frame
    if (r && (this.frame & 15) === 0 && (!r.h.active || s > r.s * 1.4 || s < r.s * 0.7)) { r.h.stop(); this.shields.delete(view); r = null; }
    if (!r) {
      const h = this.spawn("shield", this.p.set(x, y, z), s, undefined, undefined, Infinity);
      if (!h) return false;
      r = { h, f: 0, s, x, y, z };
      this.shields.set(view, r);
    } else if ((r.x - x) * (r.x - x) + (r.y - y) * (r.y - y) + (r.z - z) * (r.z - z) > 4e-4) {
      // moved 2 cm or more (A-010's setPosition allocates: the lobby bob of 25 shielded ships must not call it every frame)
      r.h.setPosition(this.p.set(x, y, z));
      r.x = x; r.y = y; r.z = z;
    }
    r.f = this.frame;
    return true;
  }
  // Once per frame for BOTH worlds (A-010's README: a hidden scene's effects must age too, or what was spawned into it while hidden
  // would all play at once on its first view): the shown world calls it at the end of its update(), after its views asked for their
  // bubbles; the frame loop calls the hidden world's (nobody asks: its bubbles go). A gap of more than 2 s (the page was paused or
  // hidden) drops what it held instead of resuming it; a single long frame does not.
  update(dt, t) {
    const S = this.sys;
    if (!S) return;
    if (this.lastT >= 0 && t - this.lastT > 2) { S.clear(); this.shields.clear(); this.queue.length = 0; }
    this.lastT = t;
    this.shields.forEach(this.sweep); // the bubbles nobody asked for this frame
    this.frame++;
    const q = this.queue;
    if (q.length) {
      let n = 0;
      for (let i = 0; i < q.length; i++) {
        const e = q[i];
        if (e.at > t) { q[n++] = e; continue; }
        const p = this.p.set(e.x, e.y, e.z);
        this.spawn(e.kind, p, this.size(p, e.base, e.cap), e.color, e.face ? this.toCam(p) : undefined);
      }
      q.length = n;
    }
    S.update(dt);
    for (let i = 0; i < this.lights.length; i++) this.lights[i].visible = true;
  }
  // A new round: every effect and bubble goes (the pools stay). The TV's flare light stays in the light count (no recompile).
  clear() { this.sys?.clear(); this.shields.clear(); this.queue.length = 0; for (let i = 0; i < this.lights.length; i++) this.lights[i].visible = true; }
}

// ---------------------------------------------------------------------------------------------------------------
// Drawn entities (inflate.js). The server sends every entity again on each mode switch, redraw and unlock (and for
// every player at once), so a drawing is inflated ONCE per (URL, kind, quality, colour): a queue builds at most one mesh
// per frame (DRAWN.pump, called from the world updates), views get cheap instances (shared geometry and texture, their
// own material) and a small LRU frees what no view uses any more. If inflate.js cannot be loaded (the server does not
// serve it yet) every view keeps its default mesh and nothing is logged.
let entInflate = null, entInflateState = 0, entInflatePromise = null; // state: 0 not asked yet, 1 loading, 2 ready, -1 missing
function entLoadInflate() {
  if (entInflateState === 0) {
    entInflateState = 1;
    entInflatePromise = import("./inflate.js").then((m) => { entInflate = m; entInflateState = 2; return m; }).catch(() => { entInflateState = -1; return null; });
  }
  return entInflateState;
}
// v1.4 (owner 09:30: "it looks like a cookie"): a drawn ship whose entity carries a spec (the part list Astra read from the drawing,
// astra-ship.js) is built by ship3d.js: hull, cockpit, wings, fins, engines with flames, weapons and extras, the drawing on it as a
// sticker. Loaded lazily like inflate.js; when it is missing or a build throws, the drawing is inflated as before.
let entShip3d = null, entShip3dState = 0, entShip3dPromise = null; // state: 0 not asked yet, 1 loading, 2 ready, -1 missing
function entLoadShip3d() {
  if (entShip3dState === 0) {
    entShip3dState = 1;
    entShip3dPromise = import("./ship3d.js").then(async (m) => {
      if (!m || typeof m.buildShip !== "function") throw new Error("no buildShip");
      // A-012, the hand-made ship texture kit, skins every built ship when it loads within 2.5 s (else, or when it is missing,
      // ship3d.js keeps its own procedural textures). Applied before the first build, so no ship changes look mid-game.
      if (typeof m.useShipKit === "function") {
        try {
          const kitMod = await import(assetUrl("A-012-ship-kit/ship-kit.js"));
          const kit = await Promise.race([kitMod.loadShipKit(), new Promise((resolve) => setTimeout(() => resolve(null), 2500))]);
          if (kit) m.useShipKit(kit);
        } catch (e) { console.warn("[render] A-012 ship kit unavailable, procedural ship textures:", e?.message || e); }
      }
      entShip3d = m;
      entShip3dState = 2;
      return m;
    }).catch((e) => { console.warn("[render] ship3d.js unavailable, drawn ships are inflated:", e?.message || e); entShip3dState = -1; return null; });
  }
  return entShip3dState;
}
// v1.4 (owner 10:12: "We're doing the character 3d modelling as well?"): a drawn PLANET entity (person, quadruped, car, bike, blob)
// whose entity carries a body spec (entity.spec from astra-body.js: head, torso, limbs or wheels, items, colours) is built by
// entity3d.js: a chunky model whose rigid parts ride a skeleton (the A-008 person bones, so the A-008 clips play on it; the rigs.js
// quadruped bones with its own clips; a chassis with spinning wheel bones). It shares ship3d.js's atlas (the A-012 kit skins it
// too) and loads the A-008 clips before its first build. Missing, failing or a spec of another type: the drawing is inflated.
let entEntity3d = null, entEntity3dState = 0, entEntity3dPromise = null; // state: 0 not asked yet, 1 loading, 2 ready, -1 missing
function entLoadEntity3d() {
  if (entEntity3dState === 0) {
    entEntity3dState = 1;
    entLoadShip3d();
    entEntity3dPromise = import("./entity3d.js").then(async (m) => {
      if (!m || typeof m.buildEntity !== "function") throw new Error("no buildEntity");
      const clips = typeof m.loadEntityClips === "function" ? m.loadEntityClips() : null;
      await Promise.race([Promise.all([clips, entShip3dPromise]), new Promise((resolve) => setTimeout(resolve, 5000))]);
      entEntity3d = m;
      entEntity3dState = 2;
      return m;
    }).catch((e) => { console.warn("[render] entity3d.js unavailable, drawn explorers are inflated:", e?.message || e); entEntity3dState = -1; return null; });
  }
  return entEntity3dState;
}
// Which builder a spec is for: a ship spec has a hull (astra-ship.js), a body spec a planet type (astra-body.js).
const entIsShipSpec = (spec) => !!spec && typeof spec === "object" && !!spec.hull;
const entIsBodySpec = (spec, type) => !!spec && typeof spec === "object" && !spec.hull && typeof spec.type === "string" && (!type || spec.type === type);
// The spec that goes with a view's drawing: the entity's own when it is of the right family (null otherwise).
function entSpecFor(ent, type) {
  const spec = ent && ent.spec;
  if (!spec) return null;
  return type === "ship" ? (entIsShipSpec(spec) ? spec : null) : (entIsBodySpec(spec, type) ? spec : null);
}
// A spec's identity for the cache key (computed once per spec object: messages bring new objects, the same spec hashes the same).
const entSpecKeys = new WeakMap();
function entSpecKey(spec) {
  if (!spec || typeof spec !== "object") return "";
  let k = entSpecKeys.get(spec);
  if (k === undefined) {
    const text = JSON.stringify(spec);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    k = `s${(h >>> 0).toString(36)}${text.length.toString(36)}`;
    entSpecKeys.set(spec, k);
  }
  return k;
}
// Specs by drawing hash (the ?v=<sha1 of the PNG, 10 hex> the server puts on every drawing URL): from entity messages and parked
// ships, and for the phone's result card (its first ship comes before its event stream opens) from GET /ship-spec?v=<hash>.
const entSpecByV = new Map();
const entSpecWaiters = new Set(); // fn(v, spec): a spec just arrived
const entVOf = (url) => { const m = typeof url === "string" && /[?&]v=([0-9a-f]{6,40})/.exec(url); return m ? m[1] : ""; };
function entSpecNote(url, spec) {
  const v = entVOf(url);
  if (!v || !spec || typeof spec !== "object" || entSpecByV.get(v) === spec) return;
  entSpecByV.delete(v);
  entSpecByV.set(v, spec);
  if (entSpecByV.size > 64) entSpecByV.delete(entSpecByV.keys().next().value);
  for (const fn of entSpecWaiters) { try { fn(v, spec); } catch { /* a closed preview */ } }
}
// SHA-1 hex of bytes (crypto.subtle only exists on HTTPS / localhost; a phone on the plain LAN address uses this).
function entSha1Hex(bytes) {
  const ml = bytes.length, nb = ((ml + 8) >> 6) + 1, w = new Uint32Array(nb * 16), x = new Uint32Array(80);
  for (let i = 0; i < ml; i++) w[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  w[ml >> 2] |= 0x80 << (24 - (ml & 3) * 8);
  w[nb * 16 - 1] = ml * 8;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  for (let b = 0; b < w.length; b += 16) {
    for (let t = 0; t < 16; t++) x[t] = w[b + t];
    for (let t = 16; t < 80; t++) { const v = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16]; x[t] = (v << 1) | (v >>> 31); }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 ? bb ^ c ^ d : t < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + x[t]) >>> 0;
      e = d; d = c; c = ((bb << 30) | (bb >>> 2)) >>> 0; bb = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((v) => v.toString(16).padStart(8, "0")).join("");
}
// The server's hash of a drawing: from its URL (?v=), or of a PNG data URL's bytes (the phone's own drawing). "" otherwise.
async function entImageV(image) {
  if (typeof image !== "string") return "";
  const v = entVOf(image);
  if (v) return v;
  const d = /^data:image\/png;base64,(.+)$/.exec(image);
  if (!d) return "";
  try {
    const bin = atob(d[1]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (globalThis.crypto && crypto.subtle && globalThis.isSecureContext) {
      try {
        const buf = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
        return Array.from(buf.slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
      } catch { /* fall through */ }
    }
    return entSha1Hex(bytes).slice(0, 10);
  } catch { return ""; }
}
// GET /ship-spec?v=<hash> → the spec the server keeps for that drawing, or null (none yet, an older server: 404).
async function entFetchSpec(v) {
  if (!v) return null;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 1500) : 0; // the result card never waits on a hung request
  try {
    const r = await fetch(`/ship-spec?v=${v}`, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.spec && typeof j.spec === "object" ? j.spec : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

class DrawnCache {
  constructor() {
    this.map = new Map(); // key → entry { key, url, kind, color, state, users, last, prio, wanted, img, result, tries, retryAt, dead }
    this.cap = 16;
    this.quality = "phone";
    this.tick = 0;
    this.cool = 0; // frames to wait before the next build: a slow one lets the frame rate recover
    this.loading = 0;
    this.built = 0;
  }
  // The phone's game view inflates at "lite" (2.6k triangles a body: up to 22 drawings share the 120k budget with the world; an old
  // inflate.js without it falls back to "phone"); the TV at "big".
  configure(phone) { this.cap = phone ? 16 : 40; this.quality = phone ? "lite" : "big"; }
  usable() { return entInflateState >= 0; }
  // A view's claim on a drawing. Entry states: queued → loading → loaded → ready | failed.
  acquire(url, kind, color, spec = null) {
    entLoadInflate();
    if (spec) { if (kind === "ship") entLoadShip3d(); else entLoadEntity3d(); }
    const sk = spec ? entSpecKey(spec) : "";
    const key = `${url}|${kind}|${this.quality}|${color}${sk ? `|${sk}` : ""}`;
    let e = this.map.get(key);
    if (!e) {
      e = { key, url, kind, color, spec: sk ? spec : null, ship3d: false, entity3d: false, state: "queued", users: 0, last: this.tick, prio: 1e9, wanted: -1, img: null, result: null, tries: 0, retryAt: 0, dead: false };
      this.map.set(key, e);
    }
    e.users++;
    return e;
  }
  retain(e) { e.users++; }
  release(e) { if (e && --e.users <= 0) { e.users = 0; e.last = this.tick; } }
  // Views say how much they want an entry each frame (a distance: nearest first).
  want(e, prio) {
    if (e.wanted !== this.tick) { e.wanted = this.tick; e.prio = prio; } else if (prio < e.prio) e.prio = prio;
  }
  // Once per frame: start a load, and inflate at most ONE loaded drawing.
  pump() {
    this.tick++;
    if (!this.map.size) return;
    if (entInflateState < 0) { for (const e of this.map.values()) if (e.state !== "ready") e.state = "failed"; return; }
    if (entInflateState !== 2) return;
    const now = performance.now();
    let load = null, build = null;
    for (const e of this.map.values()) {
      if (e.users <= 0 || e.dead) continue;
      if (e.state === "loaded") { if ((!e.spec || (e.kind === "ship" ? entShip3dState : entEntity3dState) !== 1) && (!build || e.prio < build.prio)) build = e; } // a spec waits for its builder
      else if (e.state === "queued" && e.retryAt <= now && (!load || e.prio < load.prio)) load = e;
    }
    if (load && this.loading < 3) this.fetch(load);
    if (this.cool > 0) this.cool--;
    else if (build) this.build(build);
    if (this.map.size > this.cap) this.trim();
  }
  fetch(e) {
    e.state = "loading";
    this.loading++;
    entInflate.loadDrawing(e.url, { fresh: true }).then((img) => {
      this.loading--;
      if (e.dead) { try { img.close?.(); } catch { /* already closed */ } return; }
      e.img = img;
      e.state = "loaded";
    }, () => {
      this.loading--;
      if (e.dead) return;
      if (++e.tries >= 3) e.state = "failed";
      else { e.state = "queued"; e.retryAt = performance.now() + 2000 * e.tries; }
    });
  }
  build(e) {
    const t0 = performance.now();
    e.result = null;
    if (e.spec && e.kind === "ship" && entShip3d) {
      try {
        e.result = entShip3d.buildShip(e.spec, { drawingImage: e.img, color: e.color, quality: this.quality });
        e.ship3d = true;
      } catch (err) { entWarn("ship3d.js buildShip", err); e.result = null; }
    } else if (e.spec && e.kind !== "ship" && entEntity3d && entIsBodySpec(e.spec, e.kind)) {
      try {
        e.result = entEntity3d.buildEntity(e.spec, { drawingImage: e.img, color: e.color, quality: this.quality });
        e.entity3d = true;
      } catch (err) { entWarn("entity3d.js buildEntity", err); e.result = null; }
    }
    try {
      if (!e.result) e.result = entInflate.inflateDrawing(e.img, { kind: e.kind, quality: this.quality, color: e.color });
      e.state = "ready";
    } catch (err) {
      e.state = "failed";
    }
    try { e.img.close?.(); } catch { /* an HTMLImageElement has no close */ }
    e.img = null;
    const ms = performance.now() - t0;
    this.cool = ms > 45 ? 2 : ms > 25 ? 1 : 0;
    this.built++;
  }
  // Over the cap: the least recently released entries that no view uses go (geometry, texture and material freed).
  trim() {
    while (this.map.size > this.cap) {
      let victim = null;
      for (const e of this.map.values()) if (e.users <= 0 && (!victim || e.last < victim.last)) victim = e;
      if (!victim) return;
      this.map.delete(victim.key);
      this.free(victim);
    }
  }
  free(e) {
    e.dead = true;
    if (e.img) { try { e.img.close?.(); } catch { /* ignore */ } e.img = null; }
    if (e.result) { try { e.result.dispose(); } catch { /* ignore */ } e.result = null; }
  }
  clear() {
    for (const e of this.map.values()) this.free(e);
    this.map.clear();
  }
  // For tests and the ?perf overlay: how the cache stands.
  stats() {
    const states = {};
    let users = 0;
    for (const e of this.map.values()) { states[e.state] = (states[e.state] || 0) + 1; users += e.users; }
    return { entries: this.map.size, cap: this.cap, quality: this.quality, built: this.built, loading: this.loading, users, states, inflate: entInflateState };
  }
}
const DRAWN = new DrawnCache();
// A bug in one view must not stop the frame (an exception before renderer.render freezes the screen): the loops below
// catch per view and warn once per distinct message.
const entWarned = new Set();
function entWarn(where, e) {
  const key = where + (e && e.message);
  if (entWarned.has(key) || entWarned.size > 40) return;
  entWarned.add(key);
  console.warn(`[render] ${where}:`, (e && e.stack) || e);
}

// One view's ask for a drawing: goes to the cache only when the URL, kind or colour changed.
class DrawnClaim {
  constructor() { this.e = null; this.url = ""; this.kind = ""; this.color = 0; this.sk = ""; }
  // spec (ships, v1.4): the part list ship3d.js builds; a new spec for the same drawing is a new cache entry (the old model stays on
  // show until the new one is ready).
  set(url, kind, color, spec = null) {
    const sk = url && spec ? entSpecKey(spec) : "";
    if (url !== this.url || (url && (kind !== this.kind || color !== this.color || sk !== this.sk))) {
      if (this.e) DRAWN.release(this.e);
      this.e = url ? DRAWN.acquire(url, kind, color, sk ? spec : null) : null;
      this.url = url;
      this.kind = kind;
      this.color = color;
      this.sk = sk;
    }
    return this.e;
  }
  clear() { this.set("", "", 0); }
}

// Entities by player: `entities` (above) holds the latest of any type; a landed player's latest is the explorer, but the
// parked ship still needs the ship drawing, so each family is remembered too.
const entShips = new Map(), entPlanet = new Map();
const entPlanetTypes = new Set(["person", "car", "bike", "quadruped", "blob"]);
function entNote(player, entity) {
  if (entity && entity.spec && entity.image) entSpecNote(entity.image, entity.spec); // ship and body specs alike (by drawing hash)
  entities.set(player, entity);
  (entity.type === "ship" ? entShips : entPlanet).set(player, entity);
}
// The connect message: every player's current entity. `entities` is replaced; the per-family memories are only added to (a
// landed player's current entity is the explorer, their parked ship still wants the ship drawing seen earlier).
function entReset(map) {
  entities.clear();
  for (const [k, v] of Object.entries(map)) if (v) entNote(k, v);
}
const entRig = { person: "person", car: "car", bike: "car", quadruped: "quadruped", blob: "blob" };
// Longest side in metres, the same as inflate.js KIND[type].size (a drawn car is ~4 m like a real one, a person 1.8 m tall).
const entSize = { person: 1.8, car: 4.0, bike: 2.0, quadruped: 2.0, blob: 1.4 };
// Shield bubble [centre height, scale x, y, z] (the island's bubble has a 1.25 m radius) and the marker height above the head, per planet type.
const entShield = { person: [0.95, 1, 1.15, 1], car: [0.85, 1.1, 1.0, 1.75], bike: [0.75, 0.7, 0.95, 1.15], quadruped: [0.85, 0.85, 0.9, 1.3], blob: [0.7, 0.75, 0.75, 0.75] };
const entMarkY = { person: 2.3, car: 2.3, bike: 1.9, quadruped: 1.7, blob: 1.4 };
const ENT_TAU = Math.PI * 2;
function entHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
}
// Pop-in scale: 0 → 1.15 → 1 in half a second.
function entPop(k) {
  if (k >= 1) return 1;
  return Math.max(0.02, k < 0.62 ? 1.15 * (1 - Math.pow(1 - k / 0.62, 3)) : 1.15 - 0.15 * ((k - 0.62) / 0.38));
}

// Which views get a full mesh this frame. items: views with { lodDist, forced, wantMesh }. `forced` ones (mine, the one the
// camera follows, one in a landing / take-off shot, and on the big screen every human) always do. The others get one within `near`
// metres (`far` for a view that already has one: hysteresis), at most `cap` of them, the nearest (a phone keeps 8, the TV 16: 25
// default ships are 75 draw calls); a view that already has a mesh counts as 25 % closer, so two ships swapping places do not
// flicker between mesh and impostor.
function entPlanLod(items, phone, cap, near, far, order, t) {
  let forced = 0;
  order.length = 0;
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    s.hadMesh = s.wantMesh;
    if (s.forced) { s.wantMesh = true; forced++; continue; }
    if (s.lodDist > (s.hadMesh ? far : near)) { s.wantMesh = false; continue; }
    // A view that has a mesh counts as 25 % closer, and as 60 % closer for its first `dwell` seconds (a heavy model is
    // not worth building again and again as the nearest set shuffles).
    s.lodScore = s.lodDist * (s.hadMesh ? (t < s.keepUntil ? 0.4 : 0.75) : 1);
    order.push(s);
  }
  for (let i = 1; i < order.length; i++) {
    const x = order[i];
    let j = i - 1;
    while (j >= 0 && order[j].lodScore > x.lodScore) { order[j + 1] = order[j]; j--; }
    order[j + 1] = x;
  }
  const room = Math.max(0, cap - forced);
  for (let i = 0; i < order.length; i++) order[i].wantMesh = i < room;
  for (let i = 0; i < items.length; i++) { const s = items[i]; if (s.wantMesh && !s.hadMesh) s.keepUntil = t + (s.dwell || 0); }
}

// ---- Procedural toys: the placeholder of a car, bike, quadruped or blob without a drawing (player colour, low-poly) ----
const _entM = new THREE.Matrix4();
function entPart(geo, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.applyMatrix4(_entM.makeScale(sx, sy, sz).setPosition(x, y, z));
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  return g;
}
const entBox = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const entBall = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const entCyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
// A wheel pivot with a tyre and a hub on each side (xs) around the X axis.
function entToyWheel(R, w, xs, tyre, hub) {
  const parts = [];
  for (const x of xs) {
    parts.push(entPart(entCyl(R, R, w, 12).rotateZ(Math.PI / 2), tyre, x, 0, 0));
    parts.push(entPart(entCyl(R * 0.55, R * 0.55, w + 0.03, 10).rotateZ(Math.PI / 2), hub, x, 0, 0));
  }
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return geo;
}
function entToy(type, colorHex) {
  const body = new THREE.Color(colorHex);
  const hex = body.getHex();
  const light = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.7).getHex();
  const dark = new THREE.Color(colorHex).lerp(new THREE.Color(0x101828), 0.55).getHex();
  const parts = [], wheels = [], geos = [];
  const sock = {};
  const S = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = `socket_${name}`; o.position.set(x, y, z); sock[name] = o; return o; };
  let socketList = [];
  const root = new THREE.Group();
  root.name = `toy_${type}`;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: true });
  if (type === "car") {
    parts.push(entPart(entBox(1.3, 0.5, 2.5), hex, 0, 0.6, 0));
    parts.push(entPart(entBox(1.12, 0.46, 1.25), light, 0, 1.08, 0.18));
    parts.push(entPart(entBox(0.96, 0.3, 0.06), 0x8bd3ff, 0, 1.1, -0.46));
    parts.push(entPart(entBox(1.34, 0.16, 0.14), 0x1f2937, 0, 0.45, -1.27));
    parts.push(entPart(entBox(1.34, 0.16, 0.14), 0x1f2937, 0, 0.45, 1.27));
    for (const sx of [-1, 1]) {
      parts.push(entPart(entBox(0.22, 0.14, 0.08), 0xfde047, sx * 0.45, 0.68, -1.27));
      parts.push(entPart(entBox(0.22, 0.14, 0.08), 0xef4444, sx * 0.45, 0.68, 1.27));
    }
    socketList = [S("front", 0, 0.62, -1.3), S("back", 0, 0.62, 1.3), S("roof", 0, 1.34, 0.18), S("top", 0, 1.34, 0.18), S("seat", 0, 1.0, 0.1), S("mouth", 0, 0.62, -1.3), S("tail", 0, 0.62, 1.3), S("centre", 0, 0.7, 0)];
    for (const z of [-0.82, 0.82]) wheels.push({ z, R: 0.36, geo: entToyWheel(0.36, 0.26, [-0.72, 0.72], 0x111827, 0xe5e7eb), y: 0.36 });
  } else if (type === "bike") {
    parts.push(entPart(entBox(0.12, 0.12, 1.2), hex, 0, 0.62, 0));
    parts.push(entPart(entBox(0.12, 0.5, 0.12), hex, 0, 0.82, -0.62));
    parts.push(entPart(entBox(0.12, 0.45, 0.12), hex, 0, 0.78, 0.45));
    parts.push(entPart(entBox(0.2, 0.09, 0.4), 0x1f2937, 0, 1.02, 0.4));
    parts.push(entPart(entBox(0.8, 0.07, 0.07), 0x1f2937, 0, 1.12, -0.66));
    parts.push(entPart(entBall(0.09, 8, 6), 0xfde047, 0, 0.98, -0.8));
    socketList = [S("front", 0, 0.7, -1.0), S("back", 0, 0.7, 1.0), S("roof", 0, 1.1, 0), S("top", 0, 1.1, 0), S("seat", 0, 1.05, 0.4), S("mouth", 0, 0.7, -1.0), S("tail", 0, 0.7, 1.0), S("centre", 0, 0.7, 0)];
    for (const z of [-0.7, 0.7]) wheels.push({ z, R: 0.4, geo: entToyWheel(0.4, 0.14, [0], 0x111827, light), y: 0.4 });
  } else if (type === "quadruped") {
    parts.push(entPart(entBall(1, 12, 9), hex, 0, 0.74, 0.05, 0.34, 0.32, 0.62));
    parts.push(entPart(entBall(0.27, 10, 8), hex, 0, 1.0, -0.64));
    parts.push(entPart(entBall(1, 8, 6), light, 0, 0.92, -0.9, 0.14, 0.12, 0.17));
    parts.push(entPart(entBall(0.05, 6, 5), 0x111827, 0, 0.95, -1.05));
    for (const sx of [-1, 1]) {
      parts.push(entPart(new THREE.ConeGeometry(0.09, 0.22, 5), dark, sx * 0.15, 1.27, -0.6));
      parts.push(entPart(entBall(0.05, 6, 5), 0x111827, sx * 0.11, 1.05, -0.85));
      for (const z of [-0.36, 0.4]) parts.push(entPart(entCyl(0.09, 0.075, 0.5, 6), dark, sx * 0.2, 0.25, z));
    }
    parts.push(entPart(entCyl(0.035, 0.07, 0.5, 6).rotateX(0.9), hex, 0, 0.98, 0.76));
    socketList = [S("mouth", 0, 0.93, -1.0), S("front", 0, 0.93, -1.0), S("seat", 0, 1.08, 0.1), S("back", 0, 1.08, 0.1), S("roof", 0, 1.08, 0.1), S("top", 0, 1.3, -0.6), S("tail", 0, 1.1, 0.98), S("centre", 0, 0.75, 0)];
  } else { // blob
    parts.push(entPart(entBall(1, 14, 10), hex, 0, 0.6, 0, 0.62, 0.56, 0.62));
    for (const sx of [-1, 1]) {
      parts.push(entPart(entBall(0.14, 8, 6), 0xffffff, sx * 0.21, 0.8, -0.5));
      parts.push(entPart(entBall(0.07, 6, 5), 0x111827, sx * 0.21, 0.8, -0.62));
    }
    parts.push(entPart(entBox(0.26, 0.04, 0.05), 0x111827, 0, 0.52, -0.6));
    socketList = [S("centre", 0, 0.6, 0), S("top", 0, 1.15, 0), S("front", 0, 0.6, -0.62), S("back", 0, 0.6, 0.62), S("roof", 0, 1.15, 0), S("seat", 0, 1.1, 0), S("mouth", 0, 0.52, -0.6), S("tail", 0, 0.5, 0.6)];
  }
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  geos.push(geo);
  root.add(new THREE.Mesh(geo, mat));
  for (const o of socketList) root.add(o);
  // The toy is modelled ~2.6 m long; a car is shown ~4 m like a drawn one (entSize), so the whole toy scales (wheel radii too: spin speed).
  const k = type === "car" ? entSize.car / 2.6 : 1;
  root.scale.setScalar(k);
  const out = [];
  for (const w of wheels) {
    const pivot = new THREE.Group();
    pivot.name = "wheel";
    pivot.position.set(0, w.y, w.z);
    pivot.add(new THREE.Mesh(w.geo, mat));
    root.add(pivot);
    geos.push(w.geo);
    out.push({ pivot, radius: w.R * k, drawn: false });
  }
  return { object3d: root, sockets: sock, materials: [mat], wheels: out, toy: true, dispose() { root.removeFromParent(); mat.dispose(); for (const g of geos) g.dispose(); } };
}

// Local engine positions (in the group's space) of a ship model: its engine sockets, else the default pair at the tail.
const ENT_ENGINES = [v3(-0.35, 0, 1.5), v3(0.35, 0, 1.5)];
function entEngines(model, group) {
  if (model.engines) return model.engines;
  const out = [];
  group.updateMatrixWorld(true);
  for (const k of ["engine_l", "engine_r"]) {
    const o = model.sockets && model.sockets[k];
    if (!o) continue;
    const p = v3();
    o.getWorldPosition(p);
    group.worldToLocal(p);
    out.push(p);
  }
  // One nozzle with both sockets on it (ship3d.js puts a single engine's two sockets ±0.15 m apart): one glow and one trail.
  if (out.length === 2 && out[0].distanceTo(out[1]) < 0.5) { out[0].lerp(out[1], 0.5); out.length = 1; }
  return out.length ? out : ENT_ENGINES;
}

// The model of one ship on screen: its drawing once that is built, else the A-009 default ship (a plain dart if even that
// fails). The flying ShipView and the parked ship on the island both use it. Subclasses hook beforeSwap / afterSwap.
class ShipModel {
  constructor(root, name, colorHex) {
    this.root = root; // the group the model hangs under
    this.name = name;
    this.colorHex = colorHex;
    this.model = null; // { object3d, sockets, materials, wheels?, engines?, setEnginePower?, dispose }
    this.kind = ""; // "drawn" | "default" | "placeholder" | ""
    this.claim = new DrawnClaim();
    this.shown = null; // the cache entry of the drawn model on show
    this.loadingDefault = false;
    this.defaultFailed = false;
    this.waitSince = -1;
    this.swapped = false; // the last model replaced another one (a reveal burst)
    this.popPending = false;
    this.disposed = false;
    this.wantMesh = false;
    this.hadMesh = false;
    this.forced = false;
    this.lodDist = 0;
    this.lodScore = 0;
    this.keepUntil = 0;
    this.dwell = 1.5; // seconds a fresh mesh is protected from being swapped out by a nearer one (see entPlanLod)
  }
  beforeSwap() {}
  afterSwap() {}
  use(model, kind) {
    this.beforeSwap();
    const old = this.model;
    if (old) { this.root.remove(old.object3d); old.dispose?.(); }
    this.model = model;
    this.kind = kind;
    if (model) this.root.add(model.object3d);
    this.swapped = !!old;
    this.popPending = !!model;
    this.afterSwap();
  }
  // No mesh wanted (an impostor, hidden, gone): free the model and its claims. Cheap to get back: the cache keeps the mesh.
  drop() {
    if (this.model || this.shown) {
      this.beforeSwap();
      if (this.model) { this.root.remove(this.model.object3d); this.model.dispose?.(); }
      this.model = null;
      this.kind = "";
      if (this.shown) { DRAWN.release(this.shown); this.shown = null; }
      this.afterSwap();
    }
    this.claim.clear();
    this.waitSince = -1;
  }
  // The drawing (when the entity has one) beats the default; while it is on its way the default waits, 3 s at most.
  sync(t, prio, entity) {
    const url = entity && entity.type === "ship" && entity.image ? entity.image : "";
    const spec = url && entity.spec && typeof entity.spec === "object" ? entity.spec : null;
    const e = this.claim.set(url && DRAWN.usable() ? url : "", "ship", this.colorHex, spec);
    if (e) {
      DRAWN.want(e, this.forced ? 0 : prio); // mine and the followed one first, then nearest first
      if (e.state === "ready") {
        if (!this.shown || this.shown.key !== e.key) this.adopt(e);
        return;
      }
      if (e.state !== "failed" && !this.model) {
        if (this.waitSince < 0) this.waitSince = t;
        if (t - this.waitSince < 3) return;
      }
    } else if (this.kind === "drawn") this.drop();
    if (!this.model || this.kind === "placeholder") {
      if (this.defaultFailed) { if (!this.model) this.use(placeholderShip(this.colorHex), "placeholder"); }
      else if (!this.loadingDefault) this.loadDefault();
    }
  }
  adopt(e) {
    let inst;
    try { inst = e.result.instance({ color: this.colorHex }); } catch (err) { e.state = "failed"; return; }
    DRAWN.retain(e);
    if (this.shown) DRAWN.release(this.shown);
    this.shown = e;
    // ship3d.js models also bring their engines (setEnginePower: flames follow 0 parked … 1 flying … 2.2 boost) and a fade that keeps
    // the additive flames additive (setOpacity).
    this.use({ object3d: inst.object3d, sockets: inst.sockets, materials: inst.materials, wheels: inst.wheels, dispose: inst.dispose, drawn: true,
      setEnginePower: inst.setEnginePower, setOpacity: inst.setOpacity, ship3d: !!e.ship3d }, "drawn");
  }
  loadDefault() {
    this.loadingDefault = true;
    loadAsset("ship", this.colorHex).then((asset) => {
      this.loadingDefault = false;
      if (!asset) { this.defaultFailed = true; return; }
      if (this.disposed || !this.wantMesh || (this.model && this.kind !== "placeholder")) { asset.dispose?.(); return; }
      // Normalise to about 3.2 m long so every ship reads the same.
      const box = new THREE.Box3().setFromObject(asset.object3d);
      const len = Math.max(box.max.z - box.min.z, box.max.x - box.min.x, 0.01);
      asset.object3d.scale.setScalar(3.2 / len);
      this.use(asset, "default");
    });
  }
  // A shot (landing, take-off) needs something to show at once.
  ensureModel() {
    if (!this.model) this.use(placeholderShip(this.colorHex), "placeholder");
  }
  dispose() {
    this.disposed = true;
    this.drop();
  }
}

// A ship parked on the landing pad (world.island.parked): its drawing, charred and smoking when wrecked.
class ParkedShip extends ShipModel {
  constructor(island, player, colorHex) {
    const group = new THREE.Group();
    super(group, player, colorHex);
    this.island = island;
    this.group = group;
    this.color = new THREE.Color(colorHex);
    this.transit = false;
    this.hidden = false;
    this.charred = false;
    this.saved = null;
    this.smokeAcc = 0;
    this.popT = -1;
    island.scene.add(group);
  }
  afterSwap() {
    this.charred = false;
    this.saved = null;
    if (this.model && this.model.setEnginePower) this.model.setEnginePower(0.35);
  }
  // The owner's DRAWN ship: the drawing URL the server puts on the parked entry itself (island.parked[].image, v1.3 server: also for a
  // screen that connected or reloaded after they landed), else the last SHIP entity seen for that player (entShips: kept apart from the
  // current entity, which is the explorer once they have landed). No drawing at all: the default ship.
  entityFor(q) {
    if (q.image) {
      // v1.4: its spec rides on the parked entry (server.js), else the one any ship entity with this drawing brought.
      if (q.spec) entSpecNote(q.image, q.spec);
      const spec = (q.spec && typeof q.spec === "object" ? q.spec : entSpecByV.get(entVOf(q.image))) || null;
      if (!this.imgEnt || this.imgEnt.image !== q.image || this.imgEnt.spec !== spec) this.imgEnt = { type: "ship", image: q.image, spec };
      return this.imgEnt;
    }
    return entShips.get(this.name) || null;
  }
  // Wrecked: every material darkened, the engines out. Restored if the ship is repaired.
  setWrecked(on) {
    if (on === this.charred || !this.model) return;
    this.charred = on;
    const mats = this.model.materials || [];
    if (on) {
      this.saved = mats.map((m) => ({ c: m.color ? m.color.clone() : null, e: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity }));
      mats.forEach((m) => {
        if (m.color) m.color.multiplyScalar(0.2);
        if (m.emissive) { m.emissive.setScalar(0); m.emissiveIntensity = 0; }
        if (m.userData && m.userData.rimK) m.userData.rimK.value = 0; // a drawn body's coloured rim goes out too
      });
      if (this.model.setEnginePower) this.model.setEnginePower(0);
    } else if (this.saved) {
      mats.forEach((m, i) => {
        const s = this.saved[i];
        if (!s) return;
        if (s.c) m.color.copy(s.c);
        if (s.e) m.emissive.copy(s.e);
        m.emissiveIntensity = s.ei;
        if (m.userData && m.userData.rimK) m.userData.rimK.value = 1;
      });
      this.saved = null;
      if (this.model.setEnginePower) this.model.setEnginePower(0.35);
    }
  }
  // One frame on the pad: q = the world.island.parked entry, p = the owner's tick entry (or undefined).
  step(q, p, dt, t, ctx) {
    const isl = this.island, g = this.group;
    g.visible = !this.hidden;
    g.position.set(q.x, isl.groundAt(q.x, q.z) + 0.55, q.z);
    g.rotation.set(0, isl.parkYaw, 0);
    if (this.wantMesh) this.sync(t, this.lodDist, this.entityFor(q));
    else if (this.model || this.claim.e) this.drop();
    if (this.popPending) { this.popPending = false; this.popT = t; }
    let pop = 1;
    if (this.popT >= 0) { const k = (t - this.popT) / 0.5; if (k >= 1) this.popT = -1; else pop = entPop(k); }
    g.scale.setScalar(pop);
    const c = this.color;
    this.setWrecked(!!q.wrecked);
    if (q.wrecked) {
      // Crashed: a little askew, smoking, with the odd ember.
      g.rotation.z = 0.14;
      g.rotation.x = -0.09;
      this.smokeAcc += dt * 8;
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        isl.particles.emit(q.x + (Math.random() - 0.5) * 1.4, g.position.y + 0.9, q.z + (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 0.8, 1.2 + Math.random(), (Math.random() - 0.5) * 0.8,
          1.7, 0.5, 2.6, isl.smokeCol || (isl.smokeCol = new THREE.Color(0xa8a8b8)), 0.5, 0.4, -0.5);
      }
      if (Math.random() < dt * 3) isl.particles.emit(q.x, g.position.y + 0.8, q.z, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2, 0.8, 0.35, 0.05, isl.emberCol || (isl.emberCol = new THREE.Color(0xff7a2a)), 2.5, 0.5, 4);
    }
    // An impostor (no mesh): a glow in the player colour on the pad.
    if (!this.model) isl.glow.add(q.x, g.position.y + 0.6, q.z, 2.6, c.r * 1.5, c.g * 1.5, c.b * 1.5, 0.9);
    if (p && p.flags.takingOff) {
      // Someone else's take-off lifts it away (the followed player gets the full shot).
      const k = clamp((ctx.serverNow - (p.startedAt || 0)) / (TUNING.planet.takeoffSeconds * 1000), 0, 1);
      g.position.y += k * k * 60;
      g.rotation.x = k * 0.6;
      if (k > 0.97) g.visible = false;
      if (Math.random() < dt * 30) isl.particles.emit(g.position.x, g.position.y - 0.4, g.position.z, (Math.random() - 0.5) * 2, -6, (Math.random() - 0.5) * 2, 0.6, 1.0, 0.2, c, 2.5, 0.5);
    }
  }
  dispose() {
    this.group.removeFromParent();
    super.dispose();
  }
}

// One explorer on the island (any planet type): the A-009 / A-008 person, a drawing, or a cheerful toy; the animator
// from anim.js (bike uses the car rig); wheels spin with the ground speed. The model is rebuilt only when its (type,
// image URL) changes, and only while the view is among the meshes (the phone keeps at most 8).
class ExplorerView {
  constructor(island, p, ctx) {
    this.island = island;
    this.name = p.name;
    this.colorHex = p.color;
    this.color = new THREE.Color(p.color);
    this.group = new THREE.Group();
    this.shield = new THREE.Mesh(island.shieldGeo, island.shieldMat);
    this.shield.visible = false;
    this.shield.renderOrder = 13;
    this.group.add(this.shield);
    this.model = null;
    this.kind = ""; // "drawn" | "default" | "placeholder" | "toy"
    this.modelType = "";
    this.type = "person";
    this.claim = new DrawnClaim();
    this.shown = null;
    this.loadingDefault = false;
    this.waitSince = -1;
    this.clip = null;
    this.clipSet = null;
    this.anim = null;
    this.lastStarted = undefined;
    this.lastHp = null;
    this.prev = { x: 0, y: 0, z: 0 };
    this.hasPrev = false;
    this.speedRef = TUNING.island.walkSpeed * TUNING.island.runMultiplier;
    this.stepOutUntil = 0;
    this.pendingStepOut = false;
    this.wantMesh = false;
    this.hadMesh = false;
    this.forced = false;
    this.lodDist = 0;
    this.lodScore = 0;
    this.keepUntil = 0;
    this.dwell = 12; // the default person (A-008) is heavy to build: keep it a while
    this.seen = 0;
    this.hiddenSince = -1;
    this.popPending = false;
    this.swapped = false;
    this.popT = -1;
    this.disposed = false;
    // Just landed: the explorer climbs out next to the parked ship (A-008 step_out + the animator's stepOut).
    if (p.action === "land" && ctx.serverNow - (p.startedAt || 0) < TUNING.planet.landingSeconds * 1000 + 2500) {
      this.pendingStepOut = true;
      this.stepOutUntil = ctx.t + 1.5;
    }
    this.setType("person");
    island.scene.add(this.group);
  }
  setType(type) {
    this.type = type;
    this.speedRef = TUNING.island.walkSpeed * (TUNING.island.speeds[type] || 1) * TUNING.island.runMultiplier;
    const sh = entShield[type] || entShield.person;
    this.shield.position.y = sh[0];
    this.shield.scale.set(sh[1], sh[2], sh[3]);
    this.markY = entMarkY[type] || 2.3;
  }
  hasClip(n) { return !!this.clipSet && this.clipSet.has(n); }
  disposeAnim() {
    if (this.anim && this.anim.dispose) { try { this.anim.dispose(); } catch { /* ignore */ } }
    this.anim = null;
  }
  use(model, kind, type) {
    this.disposeAnim();
    const old = this.model;
    if (old) { this.group.remove(old.object3d); old.dispose?.(); }
    this.model = model;
    this.kind = kind;
    this.modelType = type;
    this.clip = null;
    this.clipSet = model && model.clips ? new Set(model.clips.map((c) => c.name)) : null;
    if (model) this.group.add(model.object3d);
    this.swapped = !!old;
    this.popPending = !!model;
  }
  drop() {
    if (this.model || this.shown) {
      this.disposeAnim();
      if (this.model) { this.group.remove(this.model.object3d); this.model.dispose?.(); }
      this.model = null;
      this.kind = "";
      this.modelType = "";
      this.clipSet = null;
      if (this.shown) { DRAWN.release(this.shown); this.shown = null; }
    }
    this.claim.clear();
    this.waitSince = -1;
  }
  // The model for (type, drawing): a built drawing beats everything; the person keeps its place empty for up to 3 s while
  // the drawing is on its way (the default person is heavy to build); the other types show their toy meanwhile.
  sync(t, prio, ent) {
    const type = ent && entPlanetTypes.has(ent.type) ? ent.type : "person";
    const url = ent && ent.type !== "ship" && ent.image ? ent.image : "";
    if (type !== this.type) this.setType(type);
    const e = this.claim.set(url && DRAWN.usable() ? url : "", type, this.colorHex, entSpecFor(ent, type));
    if (e) {
      DRAWN.want(e, this.forced ? 0 : prio); // mine and the followed one first, then nearest first
      if (e.state === "ready") {
        if (!this.shown || this.shown.key !== e.key) this.adopt(e, type);
        return;
      }
      if (e.state !== "failed" && !this.model && type === "person") {
        if (this.waitSince < 0) this.waitSince = t;
        if (t - this.waitSince < 3) return;
      }
    } else if (this.kind === "drawn") this.drop();
    if (this.model && this.modelType === type) return; // a drawing or fallback of this type is on show
    if (type === "person") {
      if (!this.model || this.modelType !== "person") this.use(placeholderExplorer(this.colorHex), "placeholder", "person");
      if (!this.loadingDefault && this.kind !== "default") this.loadDefault();
    } else this.use(entToy(type, this.colorHex), "toy", type);
  }
  adopt(e, type) {
    let inst;
    try { inst = e.result.instance({ color: this.colorHex }); } catch (err) { e.state = "failed"; return; }
    DRAWN.retain(e);
    if (this.shown) DRAWN.release(this.shown);
    this.shown = e;
    // entity3d.js models bring their clips (the A-008 library on a person, entity3d.js's own on an animal): the explorer plays
    // dig / jump / run / walk / idle on them like on the default explorer, and anim.js layers its procedural motion on top.
    this.use({ object3d: inst.object3d, sockets: inst.sockets, materials: inst.materials, wheels: inst.wheels, dispose: inst.dispose, drawn: true,
      clips: inst.play ? inst.clips : undefined, play: inst.play, update: inst.update, entity3d: !!e.entity3d }, "drawn", type);
  }
  loadDefault() {
    this.loadingDefault = true;
    loadAsset("explorer", this.colorHex).then((asset) => {
      this.loadingDefault = false;
      if (!asset) return;
      if (this.disposed || !this.wantMesh || this.type !== "person" || this.kind === "drawn" || this.kind === "default") { asset.dispose?.(); return; }
      const box = new THREE.Box3().setFromObject(asset.object3d);
      asset.object3d.scale.setScalar(1.8 / Math.max(box.max.y - box.min.y, 0.01));
      this.use(asset, "default", "person");
    });
  }
  ensureAnim() {
    if (this.anim !== null || !Anim || !this.model || this.disposed) return;
    try {
      // Root = the explorer group; the animator moves the model (and the bubble) under its own pivot.
      const ent = entPlanet.get(this.name);
      this.anim = Anim.createAnimator(entRig[this.modelType] || "person", this.group, {
        anims: ent && ent.anims ? ent.anims : undefined, sockets: this.model.sockets, clips: this.model.clips, play: this.model.play,
        size: entSize[this.modelType] || 1.8, fx: false, onFx: animFx(this.island.particles, this.color),
      });
    } catch (err) { console.warn("[render] explorer animator failed:", err?.message || err); this.anim = false; }
  }
  // One frame for this explorer (it is among the live planet players).
  step(p, dt, t, ctx) {
    const isl = this.island, g = this.group;
    if (this.wantMesh) this.sync(t, this.lodDist, entPlanet.get(this.name));
    else if (this.model || this.claim.e) this.drop();
    const pv = this.prev, inv = 1 / Math.max(dt, 1e-3);
    const dx = this.hasPrev ? p.x - pv.x : 0, dz = this.hasPrev ? p.z - pv.z : 0;
    const speed = Math.hypot(dx, dz) * inv;
    const fwdSpeed = (dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw)) * inv; // signed: negative when reversing
    pv.x = p.x; pv.y = p.y; pv.z = p.z;
    this.hasPrev = true;
    g.position.set(p.x, p.y, p.z);
    g.rotation.set(0, p.yaw, 0);
    if (this.popPending) {
      this.popPending = false;
      this.popT = t;
      if (this.swapped && g.visible) isl.particles.burst(g.position, this.color, 14, 4, 0.5, 0.5, 0.05, { boost: 2.5, drag: 2 });
    }
    let pop = 1;
    if (this.popT >= 0) { const k = (t - this.popT) / 0.5; if (k >= 1) this.popT = -1; else pop = entPop(k); }
    g.scale.setScalar(pop);
    const flick = p.flags.stun && Math.floor(t * 14) % 2 === 0;
    g.visible = !(ctx.cockpit && p.name === ctx.me) && !flick;
    const ground = isl.groundAt(p.x, p.z);
    const person = this.modelType === "person";
    // World hint: standing still on an X, the explorer kneels and pats the ground.
    const onX = person && !p.flags.digging && speed < 0.8 && p.y <= ground + 0.4 ? isl.buriedChestNear(p.x, p.z, TUNING.island.pickupRange || 3) : null;
    const model = this.model;
    if (model && model.play && this.clipSet) {
      const stepping = this.stepOutUntil > t;
      let clip = p.flags.digging ? "dig" : p.y > ground + 0.4 ? "jump" : speed > TUNING.island.walkSpeed * 1.3 ? "run" : speed > 0.6 ? "walk" : onX ? "kneel" : "idle";
      if (stepping && clip === "idle") clip = "step_out";
      if (clip === "kneel" && !this.hasClip("kneel")) clip = "idle";
      if (clip === "step_out" && !this.hasClip("step_out")) clip = "idle";
      if (clip !== this.clip) { this.clip = clip; try { model.play(clip, clip === "step_out" ? { loop: false, restart: true } : undefined); } catch { /* clip missing in the placeholder */ } }
    }
    // Without a kneel clip, crouch procedurally (the animator owns the model's own transform, the root is ours).
    if (onX && !this.hasClip("kneel")) g.position.y -= 0.35;
    if (onX && Math.random() < dt * 2.2) {
      const f = forwardOf(p.yaw, 0, isl.tmp);
      isl.particles.burst(v3(p.x + f.x * 0.6, ground + 0.1, p.z + f.z * 0.6), DIRT, 5, 1.6, 0.6, 0.3, 0.1, { boost: 1, grav: 8, drag: 1 });
    }
    // Procedural layer (anim.js) on top of the clips; its dt feeds the mixer (hit-stop freezes it).
    this.ensureAnim();
    let animDt = dt;
    if (this.anim) {
      if (this.pendingStepOut) { this.pendingStepOut = false; this.anim.trigger("stepOut", {}); }
      if (this.lastStarted !== undefined && p.startedAt !== this.lastStarted && p.slot && p.slot !== "mount") this.anim.trigger(p.slot, { verb: p.action });
      if (this.lastHp !== null && p.hp < this.lastHp - 0.5) this.anim.trigger("hit", { intensity: clamp((this.lastHp - p.hp) / 20, 0.4, 1.5) });
      animDt = this.anim.update(dt, { speed: clamp(speed / this.speedRef, 0, 1), grounded: p.y <= ground + 0.4, digging: !!p.flags.digging });
      if (!Number.isFinite(animDt)) animDt = dt;
    }
    this.lastStarted = p.startedAt;
    this.lastHp = p.hp;
    if (model) {
      if (model.update) model.update(animDt);
      const wh = model.wheels;
      if (wh) for (let i = 0; i < wh.length; i++) wh[i].pivot.rotation.x -= (clamp(fwdSpeed, -40, 40) * dt) / wh[i].radius;
    }
    // Hex bubble (radius 1.25 x the type's shape): A-010's batched round shield once loaded (one draw for all of them; none for an
    // invisible rival or in my own cockpit), else this mesh; a bubble nobody asks for is swept by efx.update().
    const shS = this.shield.scale;
    this.shield.visible = !!model && !!(p.flags.spawnShield || p.flags.shield) && !(ctx.cockpit && p.name === ctx.me) && !(p.flags.invisible && p.name !== ctx.me) &&
      !isl.efx.shield(this, g.position.x, g.position.y + this.shield.position.y * g.scale.y, g.position.z, 0.5 * Math.max(shS.x, shS.y, shS.z) * g.scale.x);
    if (p.flags.digging && Math.random() < dt * 14) {
      const f = forwardOf(p.yaw, 0, isl.tmp);
      isl.particles.emit(p.x + f.x * 0.8, ground + 0.2, p.z + f.z * 0.8, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.8, 0.35, 0.15, DIRT, 1.0, 0.5, 12);
    }
    const c = this.color;
    // An impostor (no mesh): a glow in the player colour at body height.
    if (!model) isl.glow.add(p.x, p.y + 0.9, p.z, 2.0, c.r * 1.6, c.g * 1.6, c.b * 1.6, 0.9);
    isl.glow.add(p.x, p.y + this.markY, p.z, 0.5, c.r * 3, c.g * 3, c.b * 3, 1);
  }
  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    this.drop();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Entity preview: a small turntable of a drawing in 3D (the phone's result card, the lobby). Its own renderer, drawn only
// while visible.
//   const preview = createEntityPreview({ canvas, quality: "phone" });
//   preview.show({ image, kind, color, spec? }) → Promise<{ ok, triangles, ms, ship3d?, entity3d? }>   image: URL, data URL, <img>, canvas,
//       ImageBitmap; kind: "ship" | "person" | "car" | "bike" | "quadruped" | "blob"; ok is false when inflate.js (or WebGL) is missing
//       A ship is built from its spec by ship3d.js, an explorer from its body spec by entity3d.js (v1.4): `spec` when given, else the one
//       the server keeps for that drawing (found by the drawing's hash: entity messages, then GET /ship-spec, which serves both kinds);
//       the drawing is inflated meanwhile, and the card swaps to the built model when the model's spec lands (a few seconds at most).
//   preview.clear()   preview.setVisible(bool)   preview.dispose()
export function createEntityPreview({ canvas, quality = "phone" } = {}) {
  if (!canvas) throw new TypeError("createEntityPreview needs a canvas");
  const q = quality === "big" ? "big" : "phone";
  let renderer = null, scene = null, camera = null, spin = null, tilt = null, shadow = null, rim = null, shadowTex = null;
  let entity = null, standing = false, fitted = "", built3d = false, specPoll = 0;
  let raf = 0, visible = true, disposed = false, lost = false, lastT = 0, angle = 0.6, seq = 0, latest = null;

  function init() {
    if (renderer) return true;
    if (disposed) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (e) { renderer = null; return false; }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    // Bright, toon-like light: a sky / ground fill, a warm key from the front left, a rim in the player colour behind.
    scene.add(new THREE.HemisphereLight(0xeaf6ff, 0xffd8b0, 1.3));
    const key = new THREE.DirectionalLight(0xfff0d6, 2.6);
    key.position.set(2.5, 4, 3);
    rim = new THREE.DirectionalLight(0xffffff, 1.8);
    rim.position.set(-3, 1.5, -2.5);
    scene.add(key, rim);
    tilt = new THREE.Group();
    spin = new THREE.Group();
    tilt.add(spin);
    scene.add(tilt);
    shadowTex = canvasTexture(64, 64, (g) => {
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, "rgba(10,6,30,0.55)");
      rg.addColorStop(0.6, "rgba(10,6,30,0.25)");
      rg.addColorStop(1, "rgba(10,6,30,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
    });
    shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);
    return true;
  }

  // Size the drawing buffer to the canvas and put the camera where the unit sphere around the drawing fits.
  function fit() {
    const w = Math.max(1, canvas.clientWidth | 0), h = Math.max(1, canvas.clientHeight | 0);
    const key = `${w}x${h}:${devicePixelRatio || 1}:${standing}`;
    if (key === fitted) return;
    fitted = key;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const vf = (camera.fov * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
    const dist = 1.2 / Math.sin(Math.min(vf, hf));
    const el = standing ? 0.2 : built3d ? 0.34 : 0.55; // a flat (inflated) ship is seen from above so its drawing reads; a built one at 3/4
    camera.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist);
    camera.lookAt(0, 0, 0);
  }

  function draw(dt) {
    if (!renderer || !canvas.clientWidth || !canvas.clientHeight) return;
    fit();
    if (entity) {
      angle += dt * 0.8;
      spin.rotation.y = angle;
      if (entity.setEnginePower) entity.setEnginePower(1); // ship3d.js: the flames flicker
      if (entity.update) entity.update(dt); // entity3d.js: the explorer breathes and looks around (its idle clip)
      tilt.rotation.x = standing ? 0.06 : 0.3 + Math.sin(angle * 0.6) * 0.04;
      tilt.rotation.z = Math.sin(angle * 0.5) * 0.04;
      const wh = entity.wheels;
      if (wh) for (let i = 0; i < wh.length; i++) wh[i].pivot.rotation.x -= (dt * 3.2) / Math.max(0.2, wh[i].radius);
    }
    renderer.render(scene, camera);
  }
  function frame(now) {
    raf = 0;
    if (disposed || !visible || lost || document.hidden) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    draw(dt);
  }
  function start() {
    if (!raf && entity && visible && !disposed && !lost && !document.hidden) { lastT = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  const onVis = () => (document.hidden ? stop() : start());
  const onLost = (e) => { e.preventDefault(); lost = true; stop(); };
  const onRestored = () => { lost = false; fitted = ""; draw(0); start(); };
  document.addEventListener("visibilitychange", onVis);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  function clearEntity() {
    if (!entity) return;
    spin.remove(entity.object3d);
    try { entity.dispose(); } catch { /* ignore */ }
    entity = null;
  }
  // A ship's spec: given, known for this drawing (entity messages), or asked from the server.
  async function specOf(image, given) {
    if (given && typeof given === "object") return { spec: given, v: "" };
    const v = await entImageV(image);
    if (!v) return { spec: null, v };
    return { spec: entSpecByV.get(v) || (await entFetchSpec(v)), v };
  }
  // Until the model's own spec is in (source "model"), look again for a few seconds; a newer show() or clear() stops it.
  function watchSpec(my, opts, v, have) {
    if (!v || (have && have.source === "model")) return;
    let tries = 0;
    clearTimeout(specPoll);
    const look = async () => {
      if (my !== seq || disposed) return;
      const found = entSpecByV.get(v) || (await entFetchSpec(v));
      if (my !== seq || disposed) return;
      if (found && found !== have && (found.source === "model" || !have)) { latest = run({ ...opts, spec: found }); return; }
      if (++tries < 10) specPoll = setTimeout(look, 800);
    };
    specPoll = setTimeout(look, 600);
  }
  async function run(opts = {}) {
    const { image, kind = "ship", color = 0x22d3ee } = opts;
    const my = ++seq;
    clearTimeout(specPoll);
    entLoadInflate();
    const isShip = kind === "ship", isBody = entPlanetTypes.has(kind);
    if (isShip) entLoadShip3d();
    else if (isBody) entLoadEntity3d();
    const [inf, s3, found] = await Promise.all([entInflatePromise, isShip ? entShip3dPromise : isBody ? entEntity3dPromise : null, isShip || isBody ? specOf(image, opts.spec) : null]);
    if (!inf || disposed) return { ok: false, error: "inflate.js unavailable" };
    if (my !== seq) return latest; // a newer show() took over
    const spec = found && found.spec && s3 && (isShip ? entIsShipSpec(found.spec) : entIsBodySpec(found.spec, kind)) ? found.spec : null;
    let img = null, owned = false;
    try {
      if (typeof image === "string" && /^data:/.test(image)) {
        img = new Image();
        img.src = image;
        await img.decode();
      } else if (typeof image === "string") {
        img = await inf.loadDrawing(image, { fresh: true });
        owned = true;
      } else if (image && typeof image === "object") {
        img = image;
        if (img.complete === false && img.decode) await img.decode();
      } else return { ok: false, error: "no image" };
    } catch (err) { return { ok: false, error: "image did not load" }; }
    if (my !== seq) { if (owned) try { img.close?.(); } catch { /* ignore */ } return latest; } // a newer show() took over
    if (!init()) { if (owned) try { img.close?.(); } catch { /* ignore */ } return { ok: false, error: "webgl unavailable" }; }
    const col = new THREE.Color(color);
    const useKind = inf.KINDS && inf.KINDS.includes(kind) ? kind : "ship";
    let result = null, is3d = false;
    try {
      if (spec) {
        try { result = isShip ? s3.buildShip(spec, { drawingImage: img, color: col.getHex(), quality: q }) : s3.buildEntity(spec, { drawingImage: img, color: col.getHex(), quality: q }); is3d = true; } catch (err) { console.warn(`[render] ${isShip ? "ship3d" : "entity3d"}.js preview build failed:`, err?.message || err); result = null; }
      }
      if (!result) result = inf.inflateDrawing(img, { kind: useKind, quality: q, color: col.getHex() });
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    } finally {
      if (owned) try { img.close?.(); } catch { /* ignore */ }
    }
    clearEntity();
    entity = result;
    built3d = is3d;
    standing = useKind !== "ship";
    if ((isShip || isBody) && found) watchSpec(my, opts, found.v, is3d ? spec : null);
    // Centre the drawing on the turntable and scale it to a unit sphere (the camera is fitted to that).
    const obj = result.object3d;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const s = 1 / Math.max(sph.radius, 1e-3);
    obj.scale.setScalar(s);
    obj.position.copy(sph.center).multiplyScalar(-s);
    spin.add(obj);
    shadow.position.y = standing ? (box.min.y - sph.center.y) * s - 0.01 : -0.62;
    shadow.scale.setScalar(standing ? Math.max(0.5, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * s * 0.7) : 0.95);
    rim.color.copy(col).lerp(new THREE.Color(0xffffff), 0.35);
    fitted = "";
    draw(0);
    start();
    return { ok: true, triangles: result.triangles, ms: result.ms, kind: useKind, wheels: result.wheels ? result.wheels.length : 0, ship3d: is3d && isShip, entity3d: is3d && isBody };
  }
  return {
    show(opts) { return (latest = run(opts || {})); },
    clear() { seq++; clearTimeout(specPoll); latest = Promise.resolve({ ok: false, cleared: true }); if (entity) clearEntity(); if (renderer) renderer.clear(); stop(); },
    setVisible(v) { visible = !!v; if (visible) start(); else stop(); },
    dispose() {
      disposed = true;
      seq++;
      clearTimeout(specPoll);
      latest = Promise.resolve({ ok: false, error: "disposed" });
      stop();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (scene) clearEntity();
      if (shadow) { shadow.geometry.dispose(); shadow.material.dispose(); }
      if (shadowTex) shadowTex.dispose();
      if (renderer) { renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ } renderer = null; }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Space scene.
function nebulaBackdropTexture() {
  // The fallback backdrop (A-011's panorama replaces it once it loads): an equirectangular nebula in saturated blue, violet and
  // magenta like the reference. Cloud density, colour mix and bright filaments come from tileable fractal noise (computed once
  // at 256 x 128 and stretched), then a few big soft glows add colour variety; baked once and box-filtered so the browser's
  // gradient dithering does not show up as a grid when magnified.
  const w = 512, h = 256, NW = 256, NH = 128;
  const hash2 = (ix, iy, seed) => {
    let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) & 0xffffff) / 16777215;
  };
  const vnoise = (u, v, px, py, seed) => {
    const x = u * px, y = v * py, x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const X0 = ((x0 % px) + px) % px, X1 = (X0 + 1) % px;
    const a = hash2(X0, y0, seed), b = hash2(X1, y0, seed), c = hash2(X0, y0 + 1, seed), d = hash2(X1, y0 + 1, seed);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  const fbm = (u, v, px, py, oct, seed) => {
    let s = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < oct; o++) { s += amp * vnoise(u, v, px << o, py << o, seed + o * 7); tot += amp; amp *= 0.5; }
    return s / tot;
  };
  return canvasTexture(w, h, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0b0b52");
    grad.addColorStop(0.3, "#14148a");
    grad.addColorStop(0.5, "#1d159f");
    grad.addColorStop(0.72, "#111178");
    grad.addColorStop(1, "#080638");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Clouds and filaments.
    const nc = document.createElement("canvas");
    nc.width = NW; nc.height = NH;
    const ng = nc.getContext("2d");
    const img = ng.createImageData(NW, NH);
    const blue = [37, 99, 235], violet = [124, 58, 237], pink = [236, 72, 153], sky = [56, 189, 248];
    const mix3 = (a, b, k, out) => { out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k; };
    const col = [0, 0, 0];
    for (let j = 0; j < NH; j++) {
      for (let i = 0; i < NW; i++) {
        const u = (i + 0.5) / NW, v = (j + 0.5) / NH;
        const wp = fbm(u, v, 3, 2, 3, 11);
        const uw = (u + 0.12 * (wp - 0.5) + 1) % 1, vw = Math.min(0.9999, Math.max(0, v + 0.08 * (wp - 0.5)));
        const n1 = fbm(uw, vw, 4, 3, 6, 101), n2 = fbm(uw, vw, 6, 4, 5, 202), n3 = fbm(uw, vw, 9, 6, 5, 303);
        const band = Math.exp(-(((v - 0.5) / 0.28) ** 2));
        let dens = Math.min(1, Math.max(0, (n1 - 0.38) * 2.6)) * (0.35 + 0.9 * band);
        dens = Math.pow(dens, 1.2);
        const t = Math.min(1, Math.max(0, n2 * 1.6 - 0.3));
        if (t < 0.5) mix3(blue, violet, t * 2, col); else mix3(violet, pink, t * 2 - 1, col);
        const ridge = Math.pow(Math.min(1, Math.max(0, (1 - Math.abs(2 * n3 - 1) - 0.72) * 3.5)), 1.5) * dens;
        const o = (j * NW + i) * 4;
        img.data[o] = Math.min(255, col[0] * dens * 0.95 + (sky[0] * 0.6 + pink[0] * 0.4) * ridge * 0.65);
        img.data[o + 1] = Math.min(255, col[1] * dens * 0.95 + (sky[1] * 0.6 + pink[1] * 0.4) * ridge * 0.65);
        img.data[o + 2] = Math.min(255, col[2] * dens * 0.95 + (sky[2] * 0.6 + pink[2] * 0.4) * ridge * 0.65);
        img.data[o + 3] = 255;
      }
    }
    ng.putImageData(img, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(nc, 0, 0, w, h);
    // A few big soft glows for colour variety.
    const rnd = seeded(1337);
    const palette = ["37,99,235", "79,70,229", "124,58,237", "168,85,247", "217,70,239", "236,72,153", "56,189,248", "14,165,233"];
    const blob = (x, y, r, c, a) => {
      for (const ox of [-w, 0, w]) {
        const rg = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        rg.addColorStop(0, `rgba(${c},${a})`);
        rg.addColorStop(0.5, `rgba(${c},${a * 0.35})`);
        rg.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = rg;
        g.fillRect(x + ox - r, y - r, r * 2, r * 2);
      }
    };
    for (let i = 0; i < 9; i++) blob(rnd() * w, h * (0.35 + rnd() * 0.3), (0.06 + rnd() * 0.08) * w, palette[Math.floor(rnd() * palette.length)], 0.1 + rnd() * 0.08);
    // Box filter: average shifted copies to remove dithering.
    g.globalCompositeOperation = "source-over";
    const copy = document.createElement("canvas");
    copy.width = w; copy.height = h;
    const cg = copy.getContext("2d");
    for (const [dx, dy, a] of [[0, 0, 1], [1, 0, 0.5], [0, 1, 0.33], [-1, 0, 0.25], [0, -1, 0.2], [2, 2, 0.17], [-2, -2, 0.14]]) {
      cg.globalAlpha = a;
      cg.drawImage(g.canvas, dx, dy);
    }
    g.drawImage(copy, 0, 0);
  });
}

// Stars: many small ones plus a few big bright ones (HDR colours, so the brightest bloom). Two Points objects in one group;
// they stay THREE.Points with a PointsMaterial because transition.js fades the stars' material opacity during the landing.
function makeStars(count) {
  const tints = [0xffffff, 0x93c5fd, 0xfde68a, 0xf9a8d4, 0xc4b5fd, 0x7dd3fc].map((c) => new THREE.Color(c));
  const rnd = seeded(99);
  const dot = canvasTexture(32, 32, (c) => {
    const rg = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.3, "rgba(255,255,255,0.6)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = rg;
    c.fillRect(0, 0, 32, 32);
  });
  const layer = (n, size, bMin, bRange) => {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 2500;
      pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
      const c = tints[i % tints.length], b = bMin + rnd() * bRange;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    pts.frustumCulled = false;
    pts.renderOrder = -1;
    return pts;
  };
  const group = new THREE.Group();
  group.add(layer(count, 2.8, 0.7, 1.7), layer(Math.max(40, Math.round(count / 50)), 6, 1.6, 1.8));
  return group;
}

// Soft cloud puff texture (alpha) for the decorative nebula around the boss.
function puffTexture() {
  const t = canvasTexture(128, 128, (g) => {
    const rnd = seeded(7);
    for (let i = 0; i < 18; i++) {
      const x = 64 + (rnd() - 0.5) * 50, y = 64 + (rnd() - 0.5) * 50, r = 18 + rnd() * 30;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(255,255,255,0.22)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, 128, 128);
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
// The A-003 cloud (SpaceWorld.buildCloud): its radius against the server's nebula radius (220 m: the arcs sit ~150-170 m out,
// round the mothership and the fight, its hollow centre keeps the boss clear) and its additive opacity (A-003's 0.22 default
// reads faint against A-011's bright sky; the phone's 24 puffs get a little more than the TV's 80).
const NEBULA_SCALE = 1.15, NEBULA_OPACITY = { phone: 0.34, big: 0.3 };
// A-011's dim nebula-interior sky (SpaceWorld.updateSky, TV only): in when the camera is closer to the nebula centre than IN x its
// radius, out again past OUT x (the gap stops flapping on the edge), at most one switch per SKY_SWITCH_GAP s: every switch decodes a
// 2048 x 1024 panorama (the helper frees the other one), and the boss fight, right at the nebula's edge, would cross it constantly.
const SKY_NEBULA_IN = 0.75, SKY_NEBULA_OUT = 1.6, SKY_SWITCH_GAP = 20;

// Hex shield bubble (cyan, translucent, fresnel rim), shared material, one mesh per ship (hidden when off).
const SHIELD_MAT = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x22d3ee) } },
  vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    float hexd(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0,1.732))), p.x); }
    void main(){
      vec2 p = vUv * vec2(28.0, 14.0);
      vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5;
      vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h;
      vec2 gv = dot(a,a) < dot(b,b) ? a : b;
      float edge = smoothstep(0.42, 0.5, hexd(gv));
      float fres = pow(1.0 - abs(dot(vN, vV)), 2.2);
      float pulse = 0.75 + 0.25 * sin(uTime * 4.0 + vUv.y * 20.0);
      float a2 = (0.08 + edge * 0.55 * pulse) * (0.35 + fres * 1.4);
      gl_FragColor = vec4(uColor * 2.2 * a2, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// Procedural ship (fallback while A-009 loads or if it fails): chunky dart in the player colour.
function placeholderShip(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, metalness: 0.35, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e293b, flatShading: true, metalness: 0.6, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3, 6), mat);
  body.rotation.x = -Math.PI / 2;
  const wings = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.9), dark);
  wings.position.z = 0.6;
  group.add(body, wings);
  return { object3d: group, materials: [mat, dark], engines: ENT_ENGINES, dispose() { group.removeFromParent(); body.geometry.dispose(); wings.geometry.dispose(); mat.dispose(); dark.dispose(); } };
}

function placeholderExplorer(color) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5, flatShading: true });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0e7490, emissive: 0x0e7490, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.7, 3, 8), suit);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), white);
  head.position.y = 1.5;
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI), visor);
  vis.position.set(0, 1.52, -0.14);
  vis.rotation.y = Math.PI;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.22), white);
  pack.position.set(0, 0.95, 0.3);
  group.add(body, head, vis, pack);
  return { object3d: group, materials: [suit, white, visor], play() {}, update() {}, dispose() { group.removeFromParent(); group.traverse((o) => o.geometry?.dispose()); suit.dispose(); white.dispose(); visor.dispose(); } };
}

// One ship: its drawing or the A-009 default ship (see ShipModel) in the player colour, engine glow + trail, hex shield,
// animator. A far ship is an impostor (SpaceWorld.planLod): no mesh, a glow sprite plus its engine glow. In the lobby
// every ship spins slowly on the spot and pops in (a scale bounce) when its model first appears.
// metres: a default ship further from the camera than this draws only its hull (1 call instead of 3; was 70: the TV boss fight
// peaked at 115 of its 120 calls before A-010 and A-002's foreground came in)
const FAR_PARTS = 45;
// The TV forces the humans' drawings on screen (s.human), but only the nearest of them up to the mesh cap: 25 humans must not
// mean 25 x 3 draw calls. The others compete with the bots by distance in entPlanLod; one that has a mesh counts 25 % closer
// (no flicker between two humans at the same distance).
function lodHumans(items, cap) {
  let n = 0;
  for (let i = 0; i < items.length; i++) if (items[i].forced) n++;
  while (n < cap) {
    let best = null, bd = Infinity;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s.human || s.forced) continue;
      const d = s.lodDist * (s.wantMesh ? 0.75 : 1);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) break;
    best.forced = true;
    n++;
  }
}
class ShipView extends ShipModel {
  constructor(space, name, color) {
    // body: the animator's root (its transform stays identity; the animator moves the model under its own pivot).
    const body = new THREE.Group();
    super(body, name, color);
    this.space = space;
    this.color = new THREE.Color(color);
    this.group = new THREE.Group();
    this.body = body;
    body.visible = false; // until a model is on show
    this.group.add(body);
    this.engines = ENT_ENGINES;
    this.shield = new THREE.Mesh(space.shieldGeo, space.shieldMat);
    this.shield.visible = false;
    this.shield.renderOrder = 13;
    this.group.add(this.shield);
    this.vel = v3();
    this.prev = v3();
    this.hasPrev = false;
    this.trailAcc = 0;
    this.opacity = 1;
    this.transit = false; // true while transition.js owns the group (the landing / take-off shot)
    this.anim = null;
    this.lastStarted = undefined;
    this.lastHp = null;
    this.seen = 0;
    this.seed = entHash(name);
    this.yawOff = null; // the lobby spin, set on the first update
    this.bobAmt = 0;
    this.popT = -1;
    space.scene.add(this.group);
  }
  beforeSwap() { this.disposeAnim(); }
  afterSwap() {
    this.body.visible = !!this.model;
    this.engines = this.model ? entEngines(this.model, this.group) : ENT_ENGINES;
    this.opacity = -1; // force material refresh
    this.partsFar = false;
  }
  // The default ship (A-009) is ONE mesh with three materials = three draw calls. Past FAR_PARTS m only the hull is drawn (the engines are
  // glow sprites anyway): 24 bots on the TV cost 24 + a few instead of 72.
  farParts(on) {
    if (on === this.partsFar || !this.model || this.kind !== "default") return;
    this.partsFar = on;
    for (const m of this.model.materials || []) if (m.name !== "paper_suit") m.visible = !on;
  }
  disposeAnim() {
    if (this.anim && this.anim.dispose) { try { this.anim.dispose(); } catch { /* ignore */ } }
    this.anim = null;
  }
  setOpacity(a) {
    if (this.opacity === a) return;
    this.opacity = a;
    if (this.model.setOpacity) { this.model.setOpacity(a); return; } // ship3d.js: lit parts and additive flames fade correctly
    for (const m of this.model.materials || []) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
      m.needsUpdate = true;
    }
  }
  ensureAnim() {
    if (this.anim !== null || !Anim || !this.model || this.disposed) return;
    try {
      this.anim = Anim.createAnimator("ship", this.body, { anims: animsFor(this.name, "ship"), sockets: this.model.sockets, size: 3.2, fx: false, onFx: animFx(this.space.particles, this.color) });
    } catch (e) { console.warn("[render] ship animator failed:", e?.message || e); this.anim = false; }
  }
  update(p, dt, t, ctx) {
    const g = this.group;
    // The shot places, reparents and hides it; the model may still arrive meanwhile.
    if (this.transit) { if (this.wantMesh || !this.model) this.sync(t, this.lodDist, entShips.get(this.name)); return; }
    const dead = p.flags.dead || p.mode !== "space";
    const hideSelf = ctx.cockpit && p.name === ctx.me;
    const flicker = p.flags.stun && Math.floor(t * 14) % 2 === 0;
    g.visible = !dead && !hideSelf && !flicker;
    // A mesh only while the LOD plan wants one; an impostor frees its model and animator.
    if (this.wantMesh) this.sync(t, this.lodDist, entShips.get(this.name));
    else if (this.model || this.claim.e) this.drop();
    if (dead) { this.hasPrev = false; this.lastHp = null; return; }
    if (this.hasPrev) this.vel.set(p.x - this.prev.x, p.y - this.prev.y, p.z - this.prev.z).divideScalar(Math.max(dt, 1e-3));
    this.prev.set(p.x, p.y, p.z);
    this.hasPrev = true;
    // Lobby showcase: every ship spins slowly on the spot and bobs; at START it eases back to its heading.
    const lobby = !!ctx.lobby;
    if (this.yawOff === null) this.yawOff = lobby ? this.seed * ENT_TAU : 0;
    if (lobby) this.yawOff += dt * 0.55;
    else if (this.yawOff !== 0) {
      const home = Math.round(this.yawOff / ENT_TAU) * ENT_TAU;
      this.yawOff = Math.abs(this.yawOff - home) < 1e-3 ? 0 : damp(this.yawOff, home, 4, dt);
    }
    this.bobAmt = damp(this.bobAmt, lobby ? 1 : 0, 3, dt);
    const yaw = p.yaw + this.yawOff;
    g.position.set(p.x, p.y + Math.sin(t * 1.6 + this.seed * ENT_TAU) * 0.22 * this.bobAmt, p.z);
    g.rotation.set(p.pitch, yaw, p.roll, "YXZ");
    // Pop-in: a scale bounce (0 → 1.15 → 1) when the model first appears; a swap (default → drawing) adds a burst.
    if (this.popPending) {
      this.popPending = false;
      this.popT = t;
      if (this.swapped && g.visible) this.space.particles.burst(g.position, this.color, 16, 5, 0.5, 0.7, 0.05, { boost: 2.5, drag: 2 });
    }
    let pop = 1;
    if (this.popT >= 0) { const k = (t - this.popT) / 0.5; if (k >= 1) this.popT = -1; else pop = entPop(k); }
    // a showcase in the lobby: bigger so the drawings on their tops read from afar (the TV frames 25 of them at once)
    pop *= 1 + (this.space.big ? 1.9 : 0.7) * this.bobAmt;
    g.scale.setScalar(pop);
    const P = ctx.planet;
    if (P && p.flags.landing) {
      // Someone else's landing (the followed player gets the full shot): a dive into the planet.
      const k = clamp((ctx.serverNow - (p.startedAt || 0)) / (TUNING.planet.landingSeconds * 1000), 0, 1);
      const e = k * k;
      g.position.set(lerp(p.x, P.x, e * 0.92), lerp(p.y, P.y, e * 0.92), lerp(p.z, P.z, e * 0.92));
      g.scale.setScalar((1 - 0.7 * e) * pop);
      if (k > 0.95) g.visible = false;
    } else if (P) {
      // World hint: near the planet the ship wobbles above the pulsing landing ring.
      const d = Math.hypot(p.x - P.x, p.y - P.y, p.z - P.z);
      const near = clamp(1 - (d - P.radius - P.landRange) / 30, 0, 1);
      if (near > 0) {
        g.rotation.z += Math.sin(t * 7.3) * 0.09 * near;
        g.rotation.x += Math.sin(t * 5.1) * 0.05 * near;
        g.position.y += Math.sin(t * 3.4) * 0.25 * near;
      }
    }
    const shown = !!this.model;
    if (shown) this.farParts(!lobby && this.lodDist > (this.partsFar ? FAR_PARTS * 0.8 : FAR_PARTS)); // hysteresis; the lobby showcase keeps every part
    // Hex bubble (radius 2.6): A-010's batched shield once loaded (one draw for all of them; none for an invisible rival, in my own
    // cockpit or in a dive), else this mesh. A bubble nobody asks for (dead, impostor, landing shot, gone) is swept by efx.update().
    this.shield.visible = shown && !!(p.flags.shield || p.flags.spawnShield) && !hideSelf && !p.flags.landing && !(p.flags.invisible && p.name !== ctx.me) &&
      !this.space.efx.shield(this, g.position.x, g.position.y, g.position.z, 1.04 * g.scale.x);
    if (shown) {
      this.setOpacity(p.flags.invisible ? (p.name === ctx.me ? 0.35 : 0.12) : 1);
      if (this.model.setEnginePower) this.model.setEnginePower(p.flags.boost ? 2.2 : 1);
    }
    // Procedural animation (anim.js): triggered by the tick's action / startedAt, hits from health drops.
    this.ensureAnim();
    if (this.anim) {
      if (this.lastStarted !== undefined && p.startedAt !== this.lastStarted && p.slot && p.slot !== "mount") this.anim.trigger(p.slot, { verb: p.action });
      if (this.lastHp !== null && p.hp < this.lastHp - 0.5) this.anim.trigger("hit", { intensity: clamp((this.lastHp - p.hp) / 20, 0.4, 1.5) });
      const sp = this.vel.length() / (TUNING.cruiseSpeed * TUNING.boostMultiplier);
      this.anim.update(dt, { speed: clamp(sp, 0, 1), turn: clamp((p.roll || 0) * 1.5, -1, 1), boost: !!p.flags.boost, drilling: !!p.flags.drilling, grounded: false });
    }
    this.lastStarted = p.startedAt;
    this.lastHp = p.hp;
    if (hideSelf || p.flags.invisible) return;
    // Engine glow and trail.
    const boost = p.flags.boost ? 1 : 0;
    const glow = this.space.glow, parts = this.space.particles;
    const fwd = forwardOf(yaw, p.pitch, this.space.tmp);
    g.updateMatrixWorld();
    // An impostor (no mesh): a glow in the ship's colour where the ship is.
    if (!shown) {
      const c = this.color;
      glow.add(g.position.x, g.position.y, g.position.z, 3.2, c.r * 1.8, c.g * 1.8, c.b * 1.8, 0.9);
      glow.add(g.position.x, g.position.y, g.position.z, 1.1, 2.2, 2.2, 2.2, 0.8);
    }
    // A ship3d.js model has its own nozzle glow and flames: a smaller coloured glow and no white core here, so the chase camera
    // right behind it still sees the ship.
    const own = !!(this.model && this.model.ship3d);
    for (const e of this.engines) {
      const w = this.space.tmp2.copy(e).applyMatrix4(g.matrixWorld);
      glow.addColor(w, (1.2 + boost * 1.0) * (own ? 0.6 : 1), this.color, 1, 2.5);
      if (!own) glow.add(w.x, w.y, w.z, 0.45 + boost * 0.3, 2.5, 2.5, 2.5, 1);
      if (ctx.lobby) continue; // spinning on the spot: the glow is enough, no trail
      // World look: a long, bright ribbon in the player's colour behind each engine (one tapering streak, so it is smooth at any
      // speed) plus a few sparks; far ships get a thicker, sparser one and none beyond 500 m (the pool is shared by all 25).
      const cd = this.space.camPos.distanceTo(g.position);
      if (cd > 500) continue;
      const sp = this.vel.length(), lod = cd < 90 ? 1 : cd < 220 ? 2 : 4;
      this.space.streaks.add(w.x, w.y, w.z, fwd.x, fwd.y, fwd.z, Math.min(36, Math.max(3, sp * (0.9 + boost * 0.5))), Math.max(1.5 + boost * 0.6, cd * 0.008),
        this.color.r * 1.8, this.color.g * 1.8, this.color.b * 1.8, 1, 2);
      const n = Math.min(3, Math.max((dt * 12) / lod, (sp * dt) / (1.2 * lod)) + (this.trailAcc % 1));
      this.trailAcc = n;
      for (let k = 0; k < Math.floor(n); k++) {
        const j = ((k + Math.random()) / Math.max(1, Math.floor(n))) * dt;
        parts.emit(w.x - this.vel.x * j, w.y - this.vel.y * j, w.z - this.vel.z * j, -fwd.x * 2.5, -fwd.y * 2.5, -fwd.z * 2.5,
          0.7 + boost * 0.4, 0.5 + boost * 0.3, 0.04, this.color, 1.8, 0.6);
      }
    }
  }
  dispose() {
    this.disposeAnim();
    this.group.removeFromParent();
    super.dispose();
  }
}

// Billboarded health bar above the boss (big screen): red → orange gradient fill.
function bossBar() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFill: { value: 1 }, uSize: { value: new THREE.Vector2(16, 1.1) } },
    vertexShader: /* glsl */ `uniform vec2 uSize; varying vec2 vUv;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uFill; varying vec2 vUv;
      void main(){
        vec2 p = vUv;
        float border = step(p.x, 0.012) + step(0.988, p.x) + step(p.y, 0.12) + step(0.88, p.y);
        vec3 fill = mix(vec3(1.6,0.15,0.12), vec3(1.8,0.6,0.1), p.x);
        vec3 col = p.x < uFill ? fill : vec3(0.08,0.03,0.08);
        col = mix(col, vec3(1.2,0.4,0.3), clamp(border,0.0,1.0));
        gl_FragColor = vec4(col, 0.92);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.frustumCulled = false;
  m.renderOrder = 30;
  return m;
}

// Procedural planet (A-004 placeholder): continents from 3D noise, night-side city lights, clouds, atmosphere rim.
const NOISE_GLSL = /* glsl */ `
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h3(i+vec3(0,0,0)),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
  float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }`;
function makePlanet(radius, landRange, phone, sun) {
  const group = new THREE.Group();
  const sunDir = sun ? sun.clone().normalize() : v3(0.8, 0.35, 0.5).normalize();
  const detail = phone ? 4 : 5;
  const surf = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } },
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: NOISE_GLSL + /* glsl */ `uniform vec3 uSun; varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 p = normalize(vP);
        float n = fbm3(p * 2.6 + 4.0);
        float land = smoothstep(0.5, 0.53, n);
        float lat = abs(p.y);
        vec3 ocean = mix(vec3(0.03,0.16,0.45), vec3(0.06,0.38,0.62), smoothstep(0.42,0.5,n));
        vec3 ground = mix(vec3(0.16,0.42,0.14), vec3(0.55,0.48,0.28), smoothstep(0.58,0.68,n));
        ground = mix(ground, vec3(0.9), smoothstep(0.8,0.9,lat));
        vec3 base = mix(ocean, ground, land);
        vec3 V = normalize(cameraPosition - vW);
        float d = dot(normalize(vN), uSun);
        float day = smoothstep(-0.15, 0.25, d);
        vec3 col = base * (0.06 + 1.25 * max(d, 0.0));
        float spec = pow(max(dot(reflect(-uSun, normalize(vN)), V), 0.0), 40.0) * (1.0 - land) * day;
        col += vec3(0.6,0.7,0.9) * spec * 0.6;
        float city = land * step(0.6, n3(p * 60.0)) * smoothstep(0.55, 0.62, n) * (1.0 - day);
        col += vec3(1.8,1.2,0.5) * city;
        float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
        col += vec3(0.25,0.55,1.4) * rim * (0.3 + day);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, detail), surf);
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN;
      void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: NOISE_GLSL + /* glsl */ `uniform vec3 uSun; uniform float uTime; varying vec3 vP; varying vec3 vN;
      void main(){
        vec3 p = normalize(vP);
        float c = smoothstep(0.52, 0.72, fbm3(p * 4.0 + vec3(uTime * 0.02, 0.0, 0.0)));
        float d = max(dot(normalize(vN), uSun), 0.0);
        gl_FragColor = vec4(vec3(0.95) * (0.08 + d), c * 0.85);
      }`,
    transparent: true, depthWrite: false,
  });
  const clouds = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.02, detail - 1), cloudMat);
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float f = 1.0 - abs(dot(normalize(vN), V));
        float glow = pow(f, 5.0) * smoothstep(1.0, 0.9, f);
        float lit = 0.35 + 0.65 * max(dot(normalize(vN), uSun) + 0.3, 0.0);
        gl_FragColor = vec4(vec3(0.3,0.6,1.6) * glow * lit * 2.2, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
  const atmo = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.08, phone ? 3 : 4), atmoMat);
  // The landing-range ring and the locked shimmer belong to PlanetLook (World look), not to this fallback planet.
  group.add(body, clouds, atmo);
  return {
    group,
    update(dt, t) {
      clouds.rotation.y += dt * 0.02;
      body.rotation.y += dt * 0.004;
      cloudMat.uniforms.uTime.value = t;
    },
    dispose() { group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); },
  };
}

// Writes the bullets of one mode (0 = space, 1 = island) into an instanced streak mesh, oriented along their motion.
const _bulletCol = new THREE.Color();
function makeBulletMesh(len, thick, capacity) {
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(thick, thick, len), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), capacity);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color());
  m.count = 0;
  m.frustumCulled = false;
  return m;
}
function writeBullets(mesh, d, bullets, mode) {
  let n = 0;
  const cap = mesh.instanceMatrix.count;
  for (const b of bullets) {
    if (n >= cap) break;
    if ((b[5] || 0) !== mode) continue;
    d.position.set(b[1], b[2], b[3]);
    const dx = b[6] || 0, dy = b[7] || 0, dz = b[8] || 0;
    if (dx * dx + dy * dy + dz * dz > 1e-6) d.lookAt(b[1] + dx, b[2] + dy, b[3] + dz);
    d.updateMatrix();
    mesh.setMatrixAt(n, d.matrix);
    mesh.setColorAt(n, _bulletCol.set(b[4] || 0xffffff).multiplyScalar(5));
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------------------------
// Mischief in the world (PLAN.md section 5, v1.2). What the tick and the fx stream say about mines, decoys and the three attacks that
// land on a player's phone, made readable on the TV from the camera's distance and cheap on the phone (everything batches into the
// scene's existing glow / particle / streak draws; the only new draw calls are ONE instanced mesh for all mines, ONE normal-blended
// batch for ink, and the decoys' own meshes, a few at most). One layer per world (space, island):
//   tick.mines  [id, x, y, z, mode, color]   small spiky mines in the owner's colour: a danger halo the size of the blast trigger, a
//                                            blinking red light. Instanced (<= 16), pop in when they are dropped.
//   tick.decoys [id, x, y, z, yaw, color, owner, mode]
//                                            a flickering translucent hologram copy of the owner's drawn ship / explorer (the DRAWN
//                                            cache; a plain stand-in when there is no drawing), faded in and out; the phone gives
//                                            meshes to the 3 nearest, the TV to 8, the rest are glows.
//   flags emp / inked / tractored            on that player: crackling cyan sparks and arcs / purple ink drips and smoke / a beam to
//                                            the puller (the nearest other player within 160 m, humans first).
//   fx emp, inkbomb, tractor, mine, decoy    cyan lightning ring burst / dark purple ink splash / a ring pulled inwards with cyan
//                                            sparks / a small pop (dropped) or a stun burst (hit) / a hologram shimmer.
const MINE_HALO = { space: 14, planet: 3.6 }; // the server's trigger radius x 2 (world.js MINE_RADIUS 7 / 1.8): the danger zone on the ground
const EMP_COL = new THREE.Color(0x5ff3ff), INK_DARK = new THREE.Color(0x6a22c8), INK_LIGHT = new THREE.Color(0xb454ff), BEAM_COL = new THREE.Color(0x4fd8ff), STUN_COL = new THREE.Color(0xffe066);
const TRACTOR_RANGE = 160;

// A spiky ball: a 20-face core (vertex colour 1: takes the owner's colour fully) with 12 cone spikes (darker). ~80 triangles, one geometry for every mine.
function mineGeometry() {
  const paint = (g, r, gr, b) => {
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute("uv");
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = gr; col[i * 3 + 2] = b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  };
  const parts = [paint(new THREE.IcosahedronGeometry(0.62, 0), 1, 1, 1)];
  const f = (1 + Math.sqrt(5)) / 2, up = v3(0, 1, 0), q = new THREE.Quaternion();
  for (const d of [[-1, f, 0], [1, f, 0], [-1, -f, 0], [1, -f, 0], [0, -1, f], [0, 1, f], [0, -1, -f], [0, 1, -f], [f, 0, -1], [f, 0, 1], [-f, 0, -1], [-f, 0, 1]]) {
    const dir = v3(d[0], d[1], d[2]).normalize();
    const spike = new THREE.ConeGeometry(0.17, 0.62, 5, 1, true);
    spike.applyQuaternion(q.setFromUnitVectors(up, dir));
    spike.translate(dir.x * 0.86, dir.y * 0.86, dir.z * 0.86);
    parts.push(paint(spike, 0.42, 0.42, 0.5));
  }
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return geo;
}

// The look of a hologram: the model's own materials made translucent and additive, tinted by an emissive in the owner's colour.
function holoLook(mats, color) {
  for (const m of mats || []) {
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
    m.opacity = 0.5;
    if (m.emissive) { m.emissive.copy(color); m.emissiveIntensity = 0.8; }
    m.needsUpdate = true;
  }
}

// One decoy on screen: the owner's DRAWN ship (space) or explorer (island) from the drawing cache, else a plain stand-in, as a hologram
// (flicker, a glow behind it, a fade in / out). Only built while the layer's LOD plan wants a mesh; otherwise a glow in the owner's colour.
class DecoyView {
  constructor(layer, id, owner, colorHex, mode) {
    this.layer = layer;
    this.id = id;
    this.owner = owner;
    this.mode = mode; // 0 space, 1 island
    this.colorHex = colorHex;
    this.color = new THREE.Color(colorHex);
    this.group = new THREE.Group();
    this.group.visible = false;
    layer.world.scene.add(this.group);
    this.model = null;
    this.mats = null;
    this.kind = ""; // "drawn" | "stand-in" | ""
    this.claim = new DrawnClaim();
    this.shown = null;
    this.q = null;
    this.seen = 0;
    this.born = -1;
    this.gone = -1;
    this.wantMesh = false;
    this.lodDist = 0;
    this.seed = entHash(owner + id) * 6.28;
    this.glitch = 0;
  }
  // The model for the owner's latest drawing of the right family; a stand-in while it is not built (or never drawn).
  ensureModel() {
    const ent = this.mode ? entPlanet.get(this.owner) : entShips.get(this.owner);
    const type = this.mode ? (ent && entPlanetTypes.has(ent.type) ? ent.type : "person") : "ship";
    const url = ent && ent.image ? ent.image : "";
    const e = this.claim.set(url && DRAWN.usable() ? url : "", type, this.colorHex, entSpecFor(ent, type));
    if (e) {
      DRAWN.want(e, this.lodDist);
      if (e.state === "ready" && (!this.shown || this.shown.key !== e.key)) {
        try {
          const inst = e.result.instance({ color: this.colorHex });
          DRAWN.retain(e);
          if (this.shown) DRAWN.release(this.shown);
          this.shown = e;
          this.use({ object3d: inst.object3d, materials: inst.materials, dispose: inst.dispose }, "drawn");
        } catch (err) { e.state = "failed"; }
      }
    }
    if (!this.model) this.use(this.mode ? (type === "person" ? placeholderExplorer(this.colorHex) : entToy(type, this.colorHex)) : placeholderShip(this.colorHex), "stand-in");
  }
  use(model, kind) {
    if (this.model) { this.group.remove(this.model.object3d); this.model.dispose?.(); }
    this.model = model;
    this.kind = kind;
    this.mats = model.materials || [];
    holoLook(this.mats, this.color);
    this.group.add(model.object3d);
  }
  drop() {
    if (this.model) { this.group.remove(this.model.object3d); this.model.dispose?.(); this.model = null; this.mats = null; this.kind = ""; }
    if (this.shown) { DRAWN.release(this.shown); this.shown = null; }
    this.claim.clear();
  }
  // One frame. fade = 0..1 (in on arrival, out when the server stops listing it).
  step(t, dt, glow) {
    const q = this.q, g = this.group;
    if (this.born < 0) this.born = t;
    const fade = this.gone >= 0 ? clamp(1 - (t - this.gone) / 0.4, 0, 1) : clamp((t - this.born) / 0.45, 0, 1);
    const grow = 0.6 + 0.4 * (1 - Math.pow(1 - fade, 2));
    if (this.wantMesh) this.ensureModel(); else if (this.model || this.claim.e) this.drop();
    // glitch: now and then a frame or two where it breaks up
    if (this.glitch > 0) this.glitch -= dt; else if (Math.random() < dt * 3.5) this.glitch = 0.05 + Math.random() * 0.08;
    const flick = this.glitch > 0 ? 0.12 : 0.62 + 0.2 * Math.sin(t * 19 + this.seed) + 0.12 * Math.sin(t * 47 + this.seed * 2);
    const op = clamp(flick, 0.05, 1) * fade;
    const space = this.mode === 0;
    g.visible = !!this.model;
    g.position.set(q[1], q[2], q[3]);
    g.rotation.set(0, q[4], 0);
    g.scale.setScalar((space ? 0.85 : 1) * grow);
    if (this.mats) for (let i = 0; i < this.mats.length; i++) this.mats[i].opacity = op * 0.9;
    // the glow behind it (also the whole decoy when it has no mesh): a cyan-white halo with the owner's colour in it
    const c = this.color, y = q[2] + (space ? 0 : 0.9), big = space ? 4.2 : 2.2;
    glow.add(q[1], y, q[3], big * grow, EMP_COL.r * 0.9 + c.r * 0.6, EMP_COL.g * 0.9 + c.g * 0.6, EMP_COL.b * 0.9 + c.b * 0.6, 0.5 * op);
    if (!this.model) glow.add(q[1], y, q[3], big * 0.45 * grow, c.r * 2.2, c.g * 2.2, c.b * 2.2, 0.9 * fade * (this.glitch > 0 ? 0.3 : 1));
  }
  dispose() {
    this.drop();
    this.group.removeFromParent();
  }
}

class MischiefLayer {
  constructor(world, mode) {
    this.world = world;
    this.mode = mode; // "space" | "planet"
    this.M = mode === "planet" ? 1 : 0; // the tick's mode number
    this.phone = world.phone;
    this.frame = 0;
    // Mines: one instanced mesh for all of them.
    this.mineGeo = mineGeometry();
    this.mineMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.45, metalness: 0.3 });
    this.mines = new THREE.InstancedMesh(this.mineGeo, this.mineMat, 16);
    this.mines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mines.setColorAt(0, new THREE.Color());
    this.mines.count = 0;
    this.mines.frustumCulled = false;
    world.scene.add(this.mines);
    this.seen = new Map(); // mine id → { t0, stamp }
    // Ink: dark blobs need normal blending (an additive batch cannot draw them, and they must read on the bright island).
    this.ink = new Particles(this.phone ? 240 : 520, { normal: true, renderOrder: 13 });
    world.scene.add(this.ink.mesh);
    this.decoys = new Map();
    this.order = [];
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    this.tmp = v3();
    // Lightning arcs of an EMP burst (fx): jagged segments, kept for a few tenths of a second and re-added to the streak batch each frame.
    this.arcs = new Float32Array(8 * 4 * 6); // 8 arcs x 4 segments x (x0 y0 z0 x1 y1 z1)
    this.arcLife = new Float32Array(8);
    this.arcN = 0;
    this.streaks = world.streaks || (this.ownStreaks = new StreakBatch(48));
    if (this.ownStreaks) world.scene.add(this.ownStreaks.mesh);
  }
  clear() {
    this.ink.clear();
    this.arcLife.fill(0);
    for (const v of this.decoys.values()) v.dispose();
    this.decoys.clear();
    this.seen.clear();
    this.mines.count = 0;
  }
  // Whole frames of emission from a rate (per second): the fraction becomes a chance.
  rate(r, dt) { const n = r * dt; return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); }

  update(dt, t, snap, ctx, camera) {
    const world = this.world, M = this.M, glow = world.glow, cp = camera.position, S = this.streaks, own = this.ownStreaks;
    this.frame++;
    if (own) own.begin();
    // ---- mines
    const d = this.dummy, col = this.col;
    let n = 0;
    const list = snap.mines || [];
    for (let i = 0; i < list.length && n < 16; i++) {
      const q = list[i];
      if ((q[4] || 0) !== M) continue;
      let s = this.seen.get(q[0]);
      if (!s) { s = { t0: t, stamp: 0 }; this.seen.set(q[0], s); }
      s.stamp = this.frame;
      const k = entPop(clamp((t - s.t0) / 0.5, 0, 1)), R = M ? 0.5 : 1.0;
      const x = q[1], z = q[3], y = q[2] + (M ? 0.4 : Math.sin(t * 1.7 + q[0]) * 0.12);
      d.position.set(x, y, z);
      d.rotation.set(t * 0.35 + q[0], t * 0.55, 0);
      d.scale.setScalar(R * k);
      d.updateMatrix();
      this.mines.setMatrixAt(n, d.matrix);
      col.set(q[5] ?? 0xffffff);
      this.mines.setColorAt(n, col);
      n++;
      // the glows (all in the scene's one glow draw): the danger halo, a soft body glow, the blinking red light on top
      const ph = (t * 1.15 + q[0] * 0.37) % 1, on = ph < 0.16 ? 1 : 0.1;
      glow.add(x, y, z, MINE_HALO[this.mode] * k, col.r * 0.9, col.g * 0.9, col.b * 0.9, 0.11);
      glow.add(x, y, z, R * 3.2 * k, col.r * 1.6, col.g * 1.6, col.b * 1.6, 0.35);
      glow.add(x, y + R * 0.95, z, R * 2.0 * k, 4 * on, 0.3 * on, 0.22 * on, 1);
    }
    this.mines.count = n;
    this.mines.instanceMatrix.needsUpdate = true;
    if (this.mines.instanceColor) this.mines.instanceColor.needsUpdate = true;
    for (const [id, s] of this.seen) if (s.stamp !== this.frame) this.seen.delete(id);

    // ---- decoys
    const order = this.order;
    order.length = 0;
    const dl = snap.decoys || [];
    for (let i = 0; i < dl.length; i++) {
      const q = dl[i];
      if ((q[7] || 0) !== M) continue;
      let v = this.decoys.get(q[0]);
      if (!v) { v = new DecoyView(this, q[0], q[6], q[5], M); this.decoys.set(q[0], v); }
      v.seen = this.frame;
      v.q = q;
      v.gone = -1;
      order.push(v);
    }
    for (const v of this.decoys.values()) {
      if (v.seen === this.frame) continue;
      if (v.gone < 0) v.gone = t;
      if (t - v.gone > 0.4) { v.dispose(); this.decoys.delete(v.id); } else order.push(v); // fading out where it was
    }
    for (let i = 0; i < order.length; i++) {
      const v = order[i], q = v.q;
      v.lodDist = Math.hypot(q[1] - cp.x, q[2] - cp.y, q[3] - cp.z);
      let j = i - 1;
      while (j >= 0 && order[j].lodDist > v.lodDist) { order[j + 1] = order[j]; j--; }
      order[j + 1] = v;
    }
    const cap = this.phone ? 3 : 8;
    for (let i = 0; i < order.length; i++) {
      const v = order[i];
      v.wantMesh = i < cap && v.lodDist < 420;
      try { v.step(t, dt, glow); } catch (e) { entWarn("decoy", e); }
    }

    // ---- flags on players: emp sparks and arcs, ink drips and smoke, the tractor beam to the puller
    const players = snap.players, small = this.phone;
    for (let i = 0; i < players.length; i++) {
      const p = players[i], f = p.flags;
      if (!(f.emp || f.inked || f.tractored) || p.mode !== this.mode || f.dead || f.invisible) continue;
      const space = this.M === 0, cy = p.y + (space ? 0 : 1.0);
      const dist = Math.hypot(p.x - cp.x, cy - cp.y, p.z - cp.z), kd = clamp(dist / 55, 1, 3.5), r = space ? 1.8 : 0.9;
      if (f.emp) {
        // crackling cyan: sparks off the hull, a flickering halo, now and then a short jagged arc
        const P = world.particles, flick = Math.sin(t * 61 + i) > -0.2 ? 1 : 0.25;
        for (let k = this.rate(small ? 26 : 44, dt); k > 0; k--) {
          const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u), ca = Math.cos(th) * s, cb = u, cc = Math.sin(th) * s;
          P.emit(p.x + ca * r, cy + cb * r, p.z + cc * r, ca * 5, cb * 5, cc * 5, 0.16 + Math.random() * 0.14, (space ? 0.55 : 0.3) * kd, 0.04, EMP_COL, 3.2, 3);
        }
        glow.add(p.x, cy, p.z, (space ? 5.5 : 2.6) * kd * (0.8 + 0.2 * flick), EMP_COL.r * 1.2, EMP_COL.g * 1.2, EMP_COL.b * 1.2, 0.55 * flick);
        if (S && Math.random() < dt * 14) this.arc(p.x, cy, p.z, 0.9 * r * kd, 0.1, S, true);
      }
      if (f.inked) {
        // purple ink: drips falling off the hull and slow smoke, a violet glow so it reads from afar
        const I = this.ink;
        for (let k = this.rate(small ? 7 : 12, dt); k > 0; k--) {
          const lit = Math.random() < 0.25;
          I.emit(p.x + (Math.random() - 0.5) * r * 1.4, cy + (Math.random() - 0.3) * r, p.z + (Math.random() - 0.5) * r * 1.4, (Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8,
            0.9 + Math.random() * 0.7, (space ? 0.5 : 0.25) * kd, (space ? 1.5 : 0.7) * kd, lit ? INK_LIGHT : INK_DARK, 1, 0.8, space ? 2.2 : 3);
        }
        glow.add(p.x, cy, p.z, (space ? 4.5 : 2.2) * kd, 0.55, 0.12, 0.9, 0.35);
      }
      if (f.tractored) this.beam(p, cy, players, t, dt, kd, S, glow);
    }
    // ---- arcs of EMP bursts still alive
    for (let a = 0; a < 8; a++) {
      if (this.arcLife[a] <= 0) continue;
      this.arcLife[a] -= dt;
      if (this.arcLife[a] <= 0 || !S) continue;
      const u = clamp(this.arcLife[a] / 0.22, 0, 1), flick = Math.random() < 0.7 ? 1 : 0.35;
      for (let s = 0; s < 4; s++) {
        const o = (a * 4 + s) * 6, ax = this.arcs[o], ay = this.arcs[o + 1], az = this.arcs[o + 2], bx = this.arcs[o + 3], by = this.arcs[o + 4], bz = this.arcs[o + 5];
        const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz) || 1;
        S.add(bx, by, bz, dx / l, dy / l, dz / l, l, Math.max(0.35, l * 0.12), EMP_COL.r * 3 * u * flick, EMP_COL.g * 3 * u * flick, EMP_COL.b * 3 * u * flick, 1, 1);
      }
    }
    this.ink.update(dt);
    if (own) { own.end(); own.mesh.visible = own.n > 0; }
  }

  // A jagged 4-segment bolt from (x, y, z) outwards, `reach` m long (arcs[] slot a): from a flag (frame-long) or an fx burst (a few tenths).
  arc(x, y, z, reach, life, S, transient) {
    const a = this.arcN++ & 7, o = a * 24;
    let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    let px = x, py = y, pz = z;
    for (let s = 0; s < 4; s++) {
      const step = reach / 4, j = step * 0.6;
      const nx = px + dx * step + (Math.random() - 0.5) * j, ny = py + dy * step + (Math.random() - 0.5) * j, nz = pz + dz * step + (Math.random() - 0.5) * j;
      const b = o + s * 6;
      this.arcs[b] = px; this.arcs[b + 1] = py; this.arcs[b + 2] = pz; this.arcs[b + 3] = nx; this.arcs[b + 4] = ny; this.arcs[b + 5] = nz;
      px = nx; py = ny; pz = nz;
    }
    this.arcLife[a] = transient ? 0.1 : 0.22;
  }

  // The tractor beam: from the nearest other player (humans first: only humans can use it) within TRACTOR_RANGE to the pulled one: a
  // pulsing chain of streaks, a glow at each end and sparks flowing towards the puller.
  beam(p, cy, players, t, dt, kd, S, glow) {
    let best = null, bd = Infinity, bestBot = null, bdBot = Infinity;
    for (let j = 0; j < players.length; j++) {
      const q = players[j];
      if (q === p || q.mode !== p.mode || q.flags.dead) continue;
      const dd = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (q.flags.bot) { if (dd < bdBot) { bdBot = dd; bestBot = q; } } else if (dd < bd) { bd = dd; best = q; }
    }
    let from = null, L = 0;
    if (best && bd <= TRACTOR_RANGE) { from = best; L = bd; } else if (bestBot && bdBot <= TRACTOR_RANGE) { from = bestBot; L = bdBot; }
    if (!from) return;
    const space = this.M === 0, fy = from.y + (space ? 0 : 1.0);
    const dx = p.x - from.x, dy = cy - fy, dz = p.z - from.z, l = Math.hypot(dx, dy, dz) || 1, ux = dx / l, uy = dy / l, uz = dz / l;
    const wid = Math.max(space ? 0.7 : 0.3, l * 0.006 * kd);
    if (S) {
      const K = 5, seg = l / K;
      for (let k = 0; k < K; k++) {
        const pulse = 0.55 + 0.45 * Math.sin(t * 10 - k * 1.4);
        S.add(from.x + ux * seg * (k + 1), fy + uy * seg * (k + 1), from.z + uz * seg * (k + 1), ux, uy, uz, seg * 1.02, wid * (0.7 + 0.3 * pulse), BEAM_COL.r * 1.8 * pulse, BEAM_COL.g * 1.8 * pulse, BEAM_COL.b * 1.8 * pulse, 1, 1);
      }
    }
    glow.add(from.x, fy, from.z, (space ? 4 : 1.8) * kd, BEAM_COL.r * 1.6, BEAM_COL.g * 1.6, BEAM_COL.b * 1.6, 0.6);
    glow.add(p.x, cy, p.z, (space ? 5 : 2.2) * kd, BEAM_COL.r * 1.4, BEAM_COL.g * 1.4, BEAM_COL.b * 1.4, 0.55);
    const P = this.world.particles, sp = Math.min(40, l * 2.2);
    for (let k = this.rate(this.phone ? 14 : 26, dt); k > 0; k--) {
      const u = Math.random();
      P.emit(p.x - dx * u, cy - dy * u, p.z - dz * u, -ux * sp, -uy * sp, -uz * sp, Math.min(0.5, (l * (1 - u)) / sp), (space ? 0.7 : 0.35) * kd, 0.05, BEAM_COL, 3, 0);
    }
  }

  // fx messages of the mischief kinds (pos, colour = the attacker's / the owner's, size 3 on a victim, 1.5 for a dropped mine).
  fx(m) {
    const P = this.world.particles, rings = this.world.rings, space = this.M === 0;
    const pos = this.tmp.set(m.pos.x, m.pos.y + (space ? 0 : 0.9), m.pos.z);
    const cam = this.world.camPos, kd = clamp(cam.distanceTo(pos) / 45, 1, 4);
    const c = this.col.set(m.color ?? 0xffffff);
    const size = Number(m.size) || 1;
    switch (m.kind) {
      case "emp":
        P.burst(pos, EMP_COL, this.phone ? 26 : 44, 11 * kd, 0.5, 0.7 * kd, 0.05, { boost: 3.4, drag: 2.4 });
        rings.spawn(pos, 0x5ff3ff, (space ? 9 : 4.5) * kd, 0.7);
        if (this.streaks) for (let k = 0; k < 4; k++) this.arc(pos.x, pos.y, pos.z, (space ? 6 : 3) * kd, 0.2, this.streaks, false);
        break;
      case "inkbomb": {
        const I = this.ink;
        for (let k = 0; k < (this.phone ? 16 : 26); k++) {
          const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = (space ? 7 : 3.5) * kd * (0.4 + Math.random() * 0.6);
          I.emit(pos.x, pos.y, pos.z, Math.cos(th) * s * sp, u * sp, Math.sin(th) * s * sp, 1.0 + Math.random() * 0.7, (space ? 0.9 : 0.45) * kd, (space ? 3 : 1.4) * kd, Math.random() < 0.3 ? INK_LIGHT : INK_DARK, 1, 1.6, space ? 1.5 : 4);
        }
        P.burst(pos, INK_LIGHT, 12, 9 * kd, 0.35, 0.7 * kd, 0.05, { boost: 2.6, drag: 2 });
        rings.spawn(pos, 0xb04dff, (space ? 7 : 3.5) * kd, 0.6);
        break;
      }
      case "tractor": {
        // converging sparks and a ring pulled in: "you are being pulled"
        const R = (space ? 8 : 4) * kd;
        for (let k = 0; k < (this.phone ? 14 : 24); k++) {
          const th = Math.random() * 6.283, u = Math.random() * 1.6 - 0.8, s = Math.sqrt(1 - u * u), dx = Math.cos(th) * s, dy = u, dz = Math.sin(th) * s;
          P.emit(pos.x + dx * R, pos.y + dy * R, pos.z + dz * R, -dx * R * 2.2, -dy * R * 2.2, -dz * R * 2.2, 0.45, 0.6 * kd, 0.1, BEAM_COL, 3, 0);
        }
        rings.spawn(pos, 0x4fd8ff, R, 0.55, false, true);
        break;
      }
      case "mine":
        if (size < 2) { // dropped: a small pop in the owner's colour
          P.burst(pos, c, 12, 6, 0.35, 0.8 * kd * 0.5, 0.05, { boost: 3 });
          P.burst(pos, EMP_COL, 4, 3, 0.3, 1.2, 0.1, { boost: 3 });
        } else { // hit: the stun burst on the victim (the explosion is the server's `explode` fx)
          P.burst(pos, STUN_COL, this.phone ? 20 : 34, 13 * kd, 0.5, 0.9 * kd, 0.1, { boost: 3.6, drag: 2 });
          rings.spawn(pos, 0xffe066, (space ? 8 : 4) * kd, 0.6);
        }
        break;
      case "decoy":
        // the hologram switches on: cyan and white shimmer rising, a ring
        P.burst(pos, EMP_COL, this.phone ? 18 : 30, 4.5, 0.9, 0.7 * kd, 0.05, { boost: 2.8, drag: 1.8, grav: -2.2, spread: space ? 2 : 1 });
        P.burst(pos, c, 8, 3, 0.8, 0.8 * kd, 0.05, { boost: 2.6, drag: 1.5 });
        rings.spawn(pos, 0x8ff7ff, (space ? 5 : 2.5) * kd, 0.7);
        break;
      default: break;
    }
  }
}

class SpaceWorld {
  constructor(renderer, { phone, big }) {
    this.phone = phone;
    this.big = big;
    this.renderer = renderer;
    this.tmp = v3();
    this.tmp2 = v3();
    this.camPos = v3(); // the camera's position this frame (ShipView trails and the shots read it)
    const scene = (this.scene = new THREE.Scene());
    // Backdrop: the procedural nebula at once; A-011's panorama replaces it when (and if) it loads.
    const bg = nebulaBackdropTexture();
    bg.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = bg;
    scene.backgroundIntensity = 1;
    this.bgTexture = bg;
    this.env = null;
    loadAsset("spaceEnv", { phone }).then((env) => {
      if (!env) return;
      this.env = env;
      scene.add(env.object3d);
      scene.background = null;
      this.bgTexture?.dispose();
      this.bgTexture = null;
    });
    scene.fog = new THREE.FogExp2(0x1a1470, phone ? 0.0011 : 0.0009);
    // Bright, toon-like light: a blue-violet sky fill, a warm key and a saturated magenta rim. The key and rim directions
    // follow the planet's side of the sky (setSun) so the planet, the boss and the rocks are lit alike.
    scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x7a46dc, 1.1));
    this.key = new THREE.DirectionalLight(0xffeccf, 2.8);
    this.rim = new THREE.DirectionalLight(0xff48d2, 1.9);
    this.sun = v3();
    this.setSun(v3(1, 0.8, 0.5));
    scene.add(this.key, this.rim);
    this.flareLight = new THREE.PointLight(0xfff2c4, 0, 260, 1.2);
    scene.add(this.flareLight);
    // The boss's red light: its glow lands on the rocks and ships that fly close.
    this.bossLight = new THREE.PointLight(0xff2a1a, 0, 280, 1.6);
    scene.add(this.bossLight);
    scene.add(makeStars(phone ? 3500 : 7000));
    this.skyBusy = false;   // an A-011 variant switch is in flight (updateSky)
    this.skyFailed = false; // a variant failed to load: the sky that is up stays
    // The decorative cloud round the boss (World look): A-003's violet / magenta arcs (buildCloud, one per round at the server's
    // nebula) once the module loads; until then, or if it fails, the old additive puff batch (this.nebula, filled in setWorld)
    // stands in. setNebulaFade drives whichever is live; nebulaFlare lights the A-003 cloud round a FLARE.
    this.nebula = new BillboardBatch(phone ? 40 : 70, { map: puffTexture(), nearFade: 1.6, renderOrder: 5 });
    scene.add(this.nebula.mesh);
    this.cloud = null;     // this round's A-003 nebula
    this.cloudMake = null; // A-003's createNebula, once loaded
    this.cloudSeed = 1;
    this.cloudFade = 1;
    this.cloudTmp = v3();
    loadAsset("nebula").then((make) => { if (make) { this.cloudMake = make; this.buildCloud(); } });
    this.fore = null; // A-002's giant foreground rocks of this round (setLook)
    this.glow = new BillboardBatch(512, { renderOrder: 14 });
    scene.add(this.glow.mesh);
    this.particles = new Particles(phone ? 1800 : 4000);
    scene.add(this.particles.mesh);
    this.rings = new RingPool(10);
    scene.add(this.rings.group);
    this.shieldGeo = new THREE.SphereGeometry(2.6, 28, 18);
    this.shieldMat = SHIELD_MAT();
    // Laser streaks: the players' bullets and the boss's red shots, one instanced draw.
    this.streaks = new StreakBatch(256);
    scene.add(this.streaks.mesh);
    this.mischief = new MischiefLayer(this, "space"); // mines, decoys, emp / ink / tractor looks (adds to the streaks before updateShots ends them)
    this.shotCol = new THREE.Color();
    this.ships = new Map();
    this.rockIndex = [];
    this.rockKey = null;
    this.boss = null;
    this.planet = null; // ONLY the unlocked planet (world.planet): ShipView's landing dive, transition.js and the hud read it
    this.planetLook = new PlanetLook(this); // the planet you see: in view from the start, locked until the boss dies
    this.deco = [];     // decorative rock fields (World look)
    this.lookKey = null;
    this.sawLocked = false;
    this.farRocks = true;
    this.flash = 0; // 1 right after a huge explosion (the boss dies), falling to 0 over FLASH_SECONDS: the frame loop dims bloom / exposure by it
    this.dummy = new THREE.Object3D();
    worldSound.reset();
    this.efx = new WorldFx(this, "space"); // A-010 effects + hex shields (null-safe until it loads; fx() keeps the ad hoc bursts meanwhile)
  }

  // The key light's direction (towards the light) and the rim light opposite, a little below.
  setSun(dir) {
    this.sun.copy(dir).normalize();
    this.key.position.copy(this.sun).multiplyScalar(100);
    this.rim.position.set(-this.sun.x, -0.25, -this.sun.z).normalize().multiplyScalar(100);
  }

  // ---- world message ----
  setWorld(w) {
    const n = w.nebula;
    if (n && (!this.nebulaAt || this.nebulaAt.x !== n.x || this.nebulaAt.z !== n.z)) {
      this.nebulaAt = { ...n };
      const rnd = seeded(w.seed || 1);
      const cols = [0x3b7bff, 0x7c3aed, 0xc026d3, 0xec4899, 0x4f46e5, 0x22b8f0, 0x9333ea].map((c) => new THREE.Color(c));
      const b = this.nebula;
      b.begin();
      for (let i = 0; i < b.capacity; i++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = n.radius * (0.7 + rnd() * 0.7);
        const c = cols[i % cols.length];
        // A faint tint of cloud round the boss (A-011's panorama paints the real nebula): additive puffs that are too bright or
        // too big wash out the planet and the rocks behind them.
        b.add(n.x + Math.cos(th) * s * r, n.y + u * r * 0.5, n.z + Math.sin(th) * s * r, n.radius * (0.45 + rnd() * 0.6), c.r, c.g, c.b, 0.05 + rnd() * 0.06);
      }
      b.end();
      this.cloudSeed = Math.floor(w.seed) || 1;
      this.buildCloud(); // A-003 (when loaded) takes over from the puffs
    }
    const boss = w.targets.find((t) => t.kind === "boss");
    this.setLook(w, boss);
    this.setRocks(w);
    this.setBoss(boss);
    this.setPlanet(w.planet);
  }

  // This round's A-003 cloud at the server's nebula (a new one per round: its arcs and texture are seeded): 'low' = 24 puffs /
  // 48 triangles on the phone, 'high' = 80 / 160 on the TV, ONE draw call and one 128 px texture either way. The puff batch
  // retires (hidden) while it lives and comes back if it fails.
  buildCloud() {
    const n = this.nebulaAt;
    if (!this.cloudMake || !n) return;
    this.cloud?.dispose();
    this.cloud = null;
    try {
      const c = this.cloudMake({ radius: n.radius * NEBULA_SCALE, seed: this.cloudSeed, quality: this.phone ? "low" : "high", opacity: this.cloudOpacity() });
      c.object3d.position.set(n.x, n.y, n.z);
      this.scene.add(c.object3d);
      this.cloud = c;
    } catch (e) { entWarn("A-003 nebula (puffs stay)", e); }
    this.nebula.mesh.visible = !this.cloud;
  }
  cloudOpacity() { return (this.phone ? NEBULA_OPACITY.phone : NEBULA_OPACITY.big) * this.cloudFade; }
  // k = 1 normal .. 0 gone: the landing / take-off shot's sky dome hides the starfield, so the additive clouds (they would glow
  // through it) fade with it. Drives the A-003 cloud, or the puff batch's uFade in fallback mode (kept in step either way).
  setNebulaFade(k) {
    this.cloudFade = clamp(Number.isFinite(k) ? k : 1, 0, 1);
    this.nebula.material.uniforms.uFade.value = this.cloudFade;
    if (this.cloud) this.cloud.setOpacity(this.cloudOpacity());
  }
  // A FLARE at world `pos` lights the A-003 cloud round it for 14 s (world-fx calls this from fx()). setFlare wants root-local
  // coordinates; flares far outside the cloud are ignored (a new flare replaces the last one, so they must not cancel a near one).
  nebulaFlare(pos, strength = 1) {
    const c = this.cloud, n = this.nebulaAt;
    if (!c || !n || !pos) return;
    try {
      c.object3d.updateMatrixWorld();
      const p = c.object3d.worldToLocal(this.cloudTmp.set(pos.x, pos.y, pos.z));
      if (p.length() > n.radius * NEBULA_SCALE * 2) return;
      c.setFlare(p, clamp(Number.isFinite(strength) ? strength : 1, 0, 4));
    } catch (e) { entWarn("A-003 flare", e); }
  }
  // A-011's dim nebula-interior sky while the camera is inside the boss's nebula, the bright one outside (hysteresis
  // SKY_NEBULA_IN / OUT, SKY_SWITCH_GAP s apart), one switch in flight at most: the helper keeps the old sky up until the new image
  // is in. A failed load stops the switching. Not on the phone: a 2048 px decode + canvas shrink mid-fight is a visible hitch there.
  updateSky(cam) {
    const env = this.env, n = this.nebulaAt;
    if (this.phone || !env || !n || this.skyBusy || this.skyFailed) return;
    const d = Math.hypot(cam.x - n.x, cam.y - n.y, cam.z - n.z);
    const want = d < n.radius * (env.variant === "nebula" ? SKY_NEBULA_OUT : SKY_NEBULA_IN) ? "nebula" : "space";
    if (want === env.variant) return;
    const now = performance.now();
    if (now - (this.skyAt || -1e9) < SKY_SWITCH_GAP * 1000) return;
    this.skyAt = now;
    this.skyBusy = true;
    env.setVariant(want)
      .catch((e) => { this.skyFailed = true; entWarn("A-011 sky variant", e); })
      .finally(() => { this.skyBusy = false; });
  }

  // Once per round: the sun, the planet in view (locked) and the decorative rocks.
  setLook(w, boss) {
    if (!boss) return;
    const key = `${w.round}:${w.seed}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.sawLocked = false;
    const bossPos = v3(boss.x, boss.y, boss.z);
    // Where the server puts the planet once the boss dies: beyond the boss, on the line from the spawn.
    const planetAt = bossPos.clone().add(bossPos.clone().normalize().multiplyScalar(TUNING.planet.offset));
    // The sun sits behind the camera of the route (from the spawn, looking at the planet) on the left and above: it lights the
    // planet's left side (the right stays dark, with its city lights), the rocks and the ships from the upper left.
    const approach = planetAt.clone().normalize().negate(); // from the planet back towards the spawn
    const up = Math.abs(approach.y) > 0.95 ? v3(1, 0, 0) : v3(0, 1, 0);
    const right = v3().crossVectors(up, approach).normalize(); // the camera's right when it looks at the planet
    const sun = right.multiplyScalar(-0.8).addScaledVector(up, 0.55).addScaledVector(approach, 0.4).normalize();
    this.setSun(sun);
    this.planetLook.place(planetAt, Math.floor(w.seed) || 1, sun, approach);
    // Decorative rocks (never collide): a dense field of small ones around the boss, a few huge ones beside the route.
    for (const f of this.deco) f.dispose();
    this.deco = [];
    const plan = planDecoRocks({ seed: w.seed || 1, boss, planetAt, gameplay: w.rocks || [], phone: this.phone });
    const sd = this.phone ? 0 : 1; // 20 triangles per small rock on the phone, 80 on the big screen
    const small = new DecoField(plan.small, [chunkyRockGeometry(sd, 11, 6), chunkyRockGeometry(sd, 23, 7)], 6);
    const huge = new DecoField(plan.huge, [chunkyRockGeometry(3, 31, 13, 0.65), chunkyRockGeometry(3, 47, 14, 0.65), chunkyRockGeometry(3, 59, 12, 0.65)], 30);
    this.scene.add(small.group, huge.group);
    this.deco.push(small, huge);
    // A-002's giant foreground rocks (plan.fore: TV 12, phone 6, one draw call for all) replace the procedural huge ones (3 calls)
    // once they load; the previous round's are disposed at once. The procedural ones stay if the asset fails (or nothing fit).
    this.fore?.dispose();
    this.fore = null;
    const gen = (this.foreGen = (this.foreGen || 0) + 1);
    if (plan.fore.length) loadAsset("foreground", { seed: Math.floor(w.seed) || 1, rocks: plan.fore }).then((f) => {
      if (!f) return;
      if (gen !== this.foreGen) { f.dispose(); return; }
      this.fore = f;
      this.scene.add(f.object3d);
      huge.dispose();
      this.deco = this.deco.filter((d) => d !== huge);
    });
  }

  setRocks(w) {
    const key = `${w.round}:${w.seed}`;
    const ids = new Set(w.rocks.map((r) => r[0]));
    const known = new Map(this.rockIndex.map((r) => [r.id, r]));
    const needsRebuild = key !== this.rockKey || w.rocks.some((r) => !known.has(r[0]));
    if (!needsRebuild) {
      for (const r of this.rockIndex) if (r.alive && !ids.has(r.id)) { r.alive = false; this.writeRock(r, false); }
      return;
    }
    this.rockKey = key;
    const gen = (this.rockGen = (this.rockGen || 0) + 1);
    const records = w.rocks.map(([id, x, y, z, size, ti]) => {
      const rnd = seeded(id * 7919 + 1);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
      const type = ROCK_TYPE_NAMES[ti] || "stone";
      return { id, type, position: [x, y, z], radius: size, quaternion: [q.x, q.y, q.z, q.w] };
    });
    loadAsset("rocks").then((asset) => {
      if (gen !== this.rockGen) return;
      this.rockField?.dispose?.();
      // The phone draws one shape per batch (a third of the submitted triangles, same rocks); the big screen keeps A-002's batches.
      this.rockField = asset ? (this.phone ? splitRockField(asset, records, w.seed || 1) : asset.createRockField({ templates: asset.templates, rocks: records, seed: w.seed || 1 })) : placeholderRockField(records);
      this.scene.add(this.rockField.object3d);
      this.rockIndex = records.map((r) => {
        const h = this.rockField.handles.get(r.id);
        const mesh = h.field ? h.field.batches[h.type] : this.rockField.batches[h.type];
        const m = new THREE.Matrix4();
        mesh.getMatrixAt(h.index, m);
        return { id: r.id, mesh, index: h.index, matrix: m, pos: v3(...r.position), alive: true, shown: true };
      });
      this.lastRockCull = 0;
    });
  }
  writeRock(r, show) {
    r.shown = show;
    r.mesh.setMatrixAt(r.index, show ? r.matrix : ZERO_MATRIX);
    r.mesh.instanceMatrix.needsUpdate = true;
  }
  cullRocks(camPos, t) {
    if (t - (this.lastRockCull || 0) < 0.5) return;
    this.lastRockCull = t;
    const far = this.farRocks ? Infinity : 170;
    for (const r of this.rockIndex) {
      const show = r.alive && r.pos.distanceTo(camPos) < far;
      if (show !== r.shown) this.writeRock(r, show);
    }
  }

  setBoss(b) {
    if (!b) return;
    if (!this.boss) {
      const group = new THREE.Group();
      this.scene.add(group);
      // Mothership scale: the A-001 hull is 1.25 x the hit radius; a ring of girders, spokes and spires with red light strips
      // (two merged meshes) reach out to about twice the hit radius.
      const R = b.radius || TUNING.boss.radius;
      const hull = R * BOSS_HULL_K;
      const s = hull / BOSS_MODEL_RADIUS;
      const st = makeBossStructures(hull, this.phone);
      const metal = new THREE.Mesh(st.dark, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.15, fog: false }));
      const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.5, 0.35), toneMapped: false, fog: false });
      const lights = new THREE.Mesh(st.red, redMat);
      group.add(metal, lights);
      this.boss = { group, model: null, state: null, data: b, dead: false, scale: s, hull, st, redMat, crack: null };
      if (this.big) { this.boss.bar = bossBar(); this.scene.add(this.boss.bar); }
      loadAsset("boss").then((asset) => {
        const model = asset || placeholderBoss(hull / 12);
        if (asset) {
          asset.object3d.scale.setScalar(s);
          // A far boss must not dissolve into the fog: it is THE enemy, visible from anywhere on the map.
          asset.object3d.traverse((o) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.fog = false; });
        }
        group.add(model.object3d);
        this.boss.model = model;
        this.boss.state = null;
        this.applyBossState();
      });
    }
    const wasDead = this.boss.dead;
    this.boss.data = b;
    this.boss.dead = !!b.dead;
    this.boss.group.position.set(b.x, b.y, b.z);
    if (b.dead && !wasDead && this.boss.seenAlive) {
      // The big bang: hundreds of additive puffs the size of a ship piled up on one spot used to white the screen out for seconds
      // (bloom on top). Fewer, dimmer puffs (they also fade out near the camera, see Particles), and the bloom / exposure
      // give way for the first seconds (this.flash, read by the frame loop).
      // With A-010 loaded the fx `explode` (size 30) already draws the big blast and its chain over the hull: only a third of these
      // puffs then (debris colour round the chain), never two full bursts on one spot.
      const pos = v3(b.x, b.y, b.z), k = this.efx?.ok ? 0.33 : 1;
      this.particles.burst(pos, new THREE.Color(0xff6a2a), Math.round(90 * k), 40, 2.0, 5, 1, { boost: 1.9, drag: 1.2, spread: 10 });
      this.particles.burst(pos, new THREE.Color(0xffd27a), Math.round(40 * k), 25, 1.4, 7, 2, { boost: 1.9, drag: 1.6, spread: 6 });
      this.rings.spawn(pos, 0xff7a3a, 70, 1.6);
      this.rings.spawn(pos, 0xffd27a, 120, 2.2);
      this.flash = 1;
    }
    if (!b.dead) this.boss.seenAlive = true;
    this.applyBossState();
  }
  // The armour breaks as the boss loses health: intact, then cracked below 2/3, then broken (the red core bared) below 1/3.
  // (An older server that still sends armour keeps its own states.)
  applyBossState() {
    const B = this.boss;
    if (!B?.model) return;
    const b = B.data;
    const frac = b.hp / (b.maxHp || 1);
    const state = b.armour > 0
      ? (b.cracked || b.armour < (TUNING.boss.armour || 100) ? "armour_cracked" : "armour_intact")
      : frac > 0.66 ? "armour_intact" : frac > 0.33 ? "armour_cracked" : "armour_broken";
    if (state !== B.state) {
      B.state = state;
      B.model.setState?.(state);
    }
    B.group.visible = !b.dead;
    if (B.bar) B.bar.visible = !b.dead;
  }
  bossAlive() { return this.boss && !this.boss.dead ? this.boss.data : null; }

  // world.planet arrives when the boss dies: the planet you have been looking at all along unlocks (a burst, a ring, the
  // pulsing range ring). this.planet stays the UNLOCKED planet's data only.
  setPlanet(p) {
    const L = this.planetLook;
    if (!p) {
      this.planet = null;
      L.setUnlocked(false);
      this.sawLocked = true;
      return;
    }
    if (this.planet && this.planet.x === p.x && this.planet.z === p.z) return;
    const first = !this.planet;
    this.planet = { ...p, born: performance.now() };
    L.root.position.set(p.x, p.y, p.z);
    L.setUnlocked(true);
    if (first && this.sawLocked) {
      const c = v3(p.x, p.y, p.z);
      this.particles.burst(c, new THREE.Color(0x60a5fa), 140, 60, 1.8, 8, 2, { boost: 2.5, spread: p.radius });
      this.particles.burst(c, new THREE.Color(0xfff1c2), 70, 90, 1.4, 10, 2, { boost: 3, spread: p.radius * 0.5 });
      this.rings.spawn(c, 0x67e8f9, Math.max(80, (L.scale || 1) * p.radius * 2.6), 1.6);
      sfx.play("unlock", { volume: 0.8 });
    }
  }

  // Which ships get a full mesh this frame (entPlanLod): the phone keeps at most 8, the nearest to the camera (the
  // followed and its own ship always); the big screen everything within ~450 m. The others are impostors.
  planLod(list, ctx, cam, t) {
    const items = this.lodItems || (this.lodItems = []);
    items.length = 0;
    const subject = ctx.subject ? ctx.subject.name : null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i], s = this.ships.get(p.name);
      s.hadMesh = s.wantMesh;
      if (p.flags.dead || p.mode !== "space") { s.wantMesh = false; continue; }
      s.lodDist = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      s.forced = s.transit || p.name === ctx.me || p.name === subject;
      s.human = !this.phone && !p.flags.bot; // the TV shows the humans' drawings first (lodHumans)
      items.push(s);
    }
    // the TV lobby shows all 25 (a 5 x 5 wall of showcase ships); in play 12 meshes (the TV boss fight's budget: 12 x 3 calls of
    // default ships), the rest are glows
    const cap = this.phone ? 8 : ctx.lobby ? 30 : 12;
    lodHumans(items, cap);
    entPlanLod(items, this.phone, cap, 450, 520, this.lodOrder || (this.lodOrder = []), t);
  }

  // ---- per-frame ----
  update(dt, t, snap, ctx, camera) {
    this.glow.begin();
    this.streaks.begin(); // the ships add their engine trails, then updateShots the bullets and the boss's shots
    this.camPos.copy(camera.position);
    worldSound.tick(snap, ctx, camera, "space");
    // Ships: one build of a drawn mesh per frame at most (DRAWN.pump), then the LOD plan, then every view.
    try { DRAWN.pump(); } catch (e) { entWarn("drawn cache", e); }
    this.frame = (this.frame || 0) + 1;
    const list = snap.players;
    ctx.lobby = snap.phase === "lobby";
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      let s = this.ships.get(p.name);
      if (!s) { s = new ShipView(this, p.name, p.color); this.ships.set(p.name, s); }
      s.seen = this.frame;
    }
    this.planLod(list, ctx, camera.position, t);
    for (let i = 0; i < list.length; i++) {
      try { this.ships.get(list[i].name).update(list[i], dt, t, ctx); } catch (e) { entWarn(`ship ${list[i].name}`, e); }
    }
    for (const s of this.ships.values()) if (s.seen !== this.frame) { s.dispose(); this.ships.delete(s.name); }
    this.shieldMat.uniforms.uTime.value = t;
    // Mischief: mines, decoys, emp sparks, ink, tractor beams (their streaks join the batch before updateShots closes it).
    this.mischief.update(dt, t, snap, ctx, camera);
    // Bullets and the boss's shots: laser streaks along their motion, each with a glow.
    this.updateShots(snap, camera);
    // Flares: bright bursts with a real light on the nearest one.
    let best = null, bestD = Infinity;
    for (const f of snap.flares) {
      const [x, y, z, radius, left] = f;
      const life = clamp(left / TUNING.flare.seconds, 0, 1);
      const flick = 0.85 + 0.15 * Math.sin(t * 23 + x) * Math.sin(t * 17);
      this.glow.add(x, y, z, 7 * flick, 4, 3.6, 2.6, 1);
      this.glow.add(x, y, z, radius * 0.3 * (0.6 + 0.4 * life), 0.5 * life, 0.4 * life, 0.22 * life, 0.5);
      const dd = camera.position.distanceToSquared(this.tmp.set(x, y, z));
      if (dd < bestD) { bestD = dd; best = f; }
    }
    if (best) {
      this.flareLight.position.set(best[0], best[1], best[2]);
      this.flareLight.distance = best[3] * 2;
      this.flareLight.intensity = 350 * clamp(best[4] / TUNING.flare.seconds, 0.2, 1);
    } else this.flareLight.intensity = 0;
    this.updateBoss(dt, t, camera);
    this.updatePlanet(dt, t, ctx, camera);
    // World-look assets: the A-003 cloud's drift / breathing and its near-camera fade (a throw retires it for the puff batch),
    // then A-011's sky variant (dim inside the nebula).
    if (this.cloud) {
      try { this.cloud.update(dt, camera); } catch (e) { entWarn("A-003 nebula update (puffs back)", e); this.cloud.dispose(); this.cloud = null; this.nebula.mesh.visible = true; }
    }
    this.updateSky(camera.position);
    for (const f of this.deco) f.update(t);
    if (this.deco[0]) this.deco[0].group.visible = this.farRocks; // the lowest quality tier drops the small decorative field
    this.glow.end();
    this.particles.update(dt);
    this.rings.update(dt, camera);
    this.cullRocks(camera.position, t);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / FLASH_SECONDS);
    // A-010 effects: this scene's clock (after the ships asked for their hex bubbles: the unasked ones go), the boss's delayed blasts.
    this.efx.update(dt, t);
  }

  // Player bullets (mode 0) and boss shots as laser streaks: cylindrical billboards along their motion (the interpolated
  // snapshot carries the direction at indices 6, 7, 8), thicker and longer with distance so they stay visible from far.
  updateShots(snap, camera) {
    const S = this.streaks, cp = camera.position, col = this.shotCol, g = this.glow;
    for (const b of snap.bullets) {
      if ((b[5] || 0) !== 0) continue;
      col.set(b[4] || 0xffffff);
      const dx = b[6] || 0, dy = b[7] || 0, dz = b[8] || 0, l = Math.hypot(dx, dy, dz);
      const d = Math.hypot(b[1] - cp.x, b[2] - cp.y, b[3] - cp.z);
      const wid = Math.max(1.5, d * 0.012);
      if (l > 1e-4) S.add(b[1], b[2], b[3], dx / l, dy / l, dz / l, Math.max(5, d * 0.03), wid, col.r * 4.5, col.g * 4.5, col.b * 4.5, 1, 0);
      else S.add(b[1], b[2], b[3], 0, 0, -1, wid, wid, col.r * 4.5, col.g * 4.5, col.b * 4.5, 1, 0);
      g.add(b[1], b[2], b[3], Math.max(1.2, d * 0.008), col.r * 1.6, col.g * 1.6, col.b * 1.6, 0.7);
    }
    const B = this.boss && !this.boss.dead ? this.boss.data : null;
    for (const s of snap.bossShots) {
      let dx = s[6] || 0, dy = s[7] || 0, dz = s[8] || 0, l = Math.hypot(dx, dy, dz);
      if (l < 1e-4 && B) { dx = s[1] - B.x; dy = s[2] - B.y; dz = s[3] - B.z; l = Math.hypot(dx, dy, dz); } // a new shot: away from the boss
      if (l < 1e-4) { dx = 0; dy = 0; dz = -1; l = 1; }
      const d = Math.hypot(s[1] - cp.x, s[2] - cp.y, s[3] - cp.z);
      S.add(s[1], s[2], s[3], dx / l, dy / l, dz / l, Math.max(22, d * 0.06), Math.max(2.8, d * 0.014), 4.2, 0.4, 0.3, 1, 0);
      g.add(s[1], s[2], s[3], Math.max(4.5, d * 0.02), 3.2, 0.35, 0.3, 0.85);
    }
    S.end();
  }

  // The mothership: running red lights around the ring, blinking spire tips, a pulsing core and a faint red halo that reads
  // from across the map; plus its red light on the neighbourhood. Beacon sizes grow with the distance.
  updateBoss(dt, t, camera) {
    const B = this.boss;
    if (!B || B.dead) { this.bossLight.intensity = 0; return; }
    const b = B.data, st = B.st, g = this.glow, tmp = this.tmp, hull = B.hull;
    B.model?.update?.(dt);
    B.group.rotation.y += dt * 0.05;
    B.group.updateMatrixWorld();
    const dist = camera.position.distanceTo(B.group.position);
    const pulse = 0.6 + 0.4 * Math.sin(t * 2.4);
    B.redMat.color.setRGB(2.4 + 1.2 * pulse, 0.35 + 0.2 * pulse, 0.25 + 0.15 * pulse);
    const far = Math.max(1, dist * 0.006);
    for (let i = 0; i < st.ringBeacons.length; i++) {
      const k = Math.max(0, Math.sin(t * 3.4 - i * 0.55)), f = 0.3 + 0.7 * k * k;
      const w = tmp.copy(st.ringBeacons[i]).applyMatrix4(B.group.matrixWorld);
      g.add(w.x, w.y, w.z, Math.max(3.4, far) * (0.7 + 0.5 * k), 2.8 * f, 0.3 * f, 0.2 * f, 0.95);
    }
    for (let i = 0; i < st.tipBeacons.length; i++) {
      const on = Math.sin(t * 2.2 + i * 1.7) > 0.25 ? 1 : 0.3;
      const w = tmp.copy(st.tipBeacons[i]).applyMatrix4(B.group.matrixWorld);
      g.add(w.x, w.y, w.z, Math.max(4.6, far * 1.3) * (0.8 + 0.3 * on), 3 * on, 0.35 * on, 0.22 * on, 1);
    }
    // THE enemy from anywhere on the map (World look): past ~350 m a pulsing red eye of constant screen size (~2 degrees; bloom
    // catches its HDR centre) set in front of the hull towards the camera, so the armour never hides it, and a stronger halo.
    // Glow-batch quads: no draw call, the same on the phone.
    const farK = clamp((dist - 350) / 450, 0, 1);
    g.add(b.x, b.y, b.z, Math.max(hull * 1.3, dist * 0.025) * (0.9 + 0.2 * pulse), 2.2, 0.35, 0.2, 0.45); // the core
    g.add(b.x, b.y, b.z, Math.max(150, dist * 0.2), (0.3 + 0.12 * pulse) * (1 + 0.6 * farK), 0.03, 0.05, 0.5); // the halo
    if (farK > 0) {
      const e = tmp.copy(camera.position).sub(B.group.position).multiplyScalar(st.extent / dist).add(B.group.position);
      g.add(e.x, e.y, e.z, dist * 0.035 * (0.85 + 0.3 * pulse), 3.6 * farK, 0.4 * farK, 0.28 * farK, 1);  // the eye
    }
    this.bossLight.position.set(b.x, b.y, b.z);
    this.bossLight.intensity = 320 * (0.85 + 0.3 * pulse);
    // World hint of an older server (armour > 0): a glowing hairline crack where the armour is weakest.
    if (b.armour > 0 && B.model && !B.crack) { B.crack = bossCrack(B.model.object3d, hull * 1.05); B.group.add(B.crack.lines); }
    if (B.crack) {
      const on = b.armour > 0;
      B.crack.lines.visible = on;
      if (on) {
        const cracked = b.armour < (TUNING.boss.armour || 100);
        const k = (cracked ? 1.4 : 0.8) * (0.7 + 0.3 * Math.sin(t * 3.1)) * (0.85 + 0.15 * Math.sin(t * 17));
        B.crack.mat.color.setRGB(3.2 * k, 1.2 * k, 0.3 * k);
        const pts = B.crack.glowPoints;
        for (let i = 0; i < pts.length; i++) {
          const w = tmp.copy(pts[i]).applyMatrix4(B.group.matrixWorld);
          g.add(w.x, w.y, w.z, (cracked ? 2.2 : 1.4) * B.scale, 1.6 * k, 0.55 * k, 0.12 * k, 0.9);
        }
      }
    }
    if (B.bar) {
      B.bar.position.set(b.x, b.y + st.extent + 6, b.z);
      B.bar.material.uniforms.uFill.value = clamp(b.hp / (b.maxHp || 1), 0, 1);
      const d = camera.position.distanceTo(B.bar.position);
      B.bar.material.uniforms.uSize.value.set(clamp(d * 0.12, 14, 60), clamp(d * 0.0085, 1, 4.2));
    }
  }

  // The planet you see: scaled so it never covers less than ~5.7 degrees of the sky, true size inside ~400 m. The landing ring
  // pulses harder as the camera's subject gets close to the unlocked planet.
  updatePlanet(dt, t, ctx, camera) {
    const me = ctx.subject, P = this.planet;
    let near = 0;
    if (P && me && me.mode === "space") {
      const d = Math.hypot(me.x - P.x, me.y - P.y, me.z - P.z) - P.radius;
      near = d < P.landRange ? 1 : clamp(1 - (d - P.landRange) / 60, 0, 1) * 0.5;
    }
    this.planetLook.update(dt, t, camera.position, near);
  }

  fx(m) {
    worldSound.fx(m);
    const pos = v3(m.pos.x, m.pos.y, m.pos.z);
    const c = new THREE.Color(m.color ?? 0xffffff);
    const size = m.size || 1;
    const P = this.particles, F = this.efx;
    if (m.kind === "flare") this.nebulaFlare?.(pos, clamp(size / TUNING.flare.radius, 0.15, 1)); // the A-003 cloud lights up round it (a teleport's small flare a little)
    const mischief = m.kind === "emp" || m.kind === "inkbomb" || m.kind === "tractor" || m.kind === "mine" || m.kind === "decoy";
    if (F.ok && !mischief && m.kind !== "crack") {
      // A-010 (sizes grown with the camera distance for the TV and capped near the camera: WorldFx.size; rings face the camera,
      // sparks fly at it). The ad hoc bursts below stay as the fallback until (unless) it loads, and for crack (no A-010 kind).
      const k = m.kind, at = F.toCam(pos);
      if (k === "explode") {
        if (size >= 12) {
          // The boss (size 30): a blast at its core, then a chain over the hull for ~1.3 s (3 on the phone, 6 on the TV), each one
          // sized from the camera when it goes off: a mothership breaking up, never one screen-filling fireball.
          const R = TUNING.boss.radius * BOSS_HULL_K, n = this.phone ? 3 : 6;
          F.spawn("explosion_large", pos, F.size(pos, R * 0.3, 0.06), undefined, at);
          for (let i = 0; i < n; i++) {
            const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u) * R * 0.8;
            F.later(0.12 + i * 0.2, "explosion_medium", pos.x + Math.cos(th) * s, pos.y + u * R * 0.8, pos.z + Math.sin(th) * s, R * 0.18, 0.06, undefined, true);
          }
          this.flash = Math.max(this.flash, 0.6);
        } else {
          // small (rock bits, mines) / medium (ships, decoys, big rocks): A-010's fireball, the colour of what blew up in the debris
          F.spawn(size < 4 ? "explosion_small" : "explosion_medium", pos, F.size(pos, size * (size < 4 ? 0.6 : 0.5), 0.06), undefined, at);
          P.burst(pos, c, Math.min(24, 8 + size * 1.5), 5 + size * 1.5, 0.9, clamp(size * 0.25, 0.5, 1.6), 0.1, { boost: 2.2, drag: 1.4, spread: size * 0.4 });
        }
      } else if (k === "blast") F.spawn("blast", pos, F.size(pos, size / 12, 0.06), m.color, at);
      // the flare's light (TV) is 70 x size² at 24 x size m: size <= 2.5 keeps it from blowing out the flarer's own hull
      else if (k === "flare") F.spawn("flare", pos, Math.min(2.5, F.size(pos, 2 * clamp(size / TUNING.flare.radius, 0.15, 1), 0.08)), m.color ?? 0xfff1c2, at);
      // rings to 8 x size: capped at 0.15 x the distance they still fly out past the screen's edges, like the old 250 m ring
      else if (k === "scan") F.spawn("scan", pos, F.size(pos, (m.size || TUNING.scan.range) / 8, 0.15), undefined, at);
      else if (k === "drill") F.spawn("drill", pos, F.size(pos, 1, 0.15), undefined, at);
      else if (k === "respawn") F.spawn("respawn", pos, F.size(pos, 1.1, 0.15), m.color ?? 0x22d3ee, at);
      else if (k === "land") F.spawn("scan", pos, F.size(pos, 0.9, 0.15), m.color, at); // a landing dive / a lift-off: a ping in the player's colour
      else F.spawn("spark", pos, F.size(pos, 0.5 + size * 0.3, 0.15), m.color, at); // hit, spark
      return;
    }
    switch (m.kind) {
      case "explode": {
        // A white-hot flash, an orange fireball, the player's colour in the debris, and a shock ring for the bigger ones. Without
        // A-010 the boss's size 30 made 50 additive puffs 48 m wide (a white screen): puff sizes stop at size 6.
        const sz = Math.min(size, 6);
        P.burst(pos, new THREE.Color(0xfff0c8), 8, sz * 3, 0.3, sz * 2.6, sz * 0.7, { boost: 4 });
        P.burst(pos, new THREE.Color(0xffa040), Math.min(50, 10 + sz * 3), sz * 3.2, 0.7, sz * 1.6, sz * 0.4, { boost: 3.2, drag: 1.6 });
        P.burst(pos, c, Math.min(60, 14 + sz * 4), 6 + sz * 2.5, 1.1, Math.max(0.6, sz * 0.35), 0.1, { boost: 2.5, drag: 1.2, spread: sz * 0.6 });
        if (size >= 3) this.rings.spawn(pos, 0xffb060, sz * 2.2, 0.8);
        if (size >= 12) this.flash = Math.max(this.flash, 0.6);
        break;
      }
      case "blast":
        P.burst(pos, c, 60, size * 2.5, 0.9, 2.5, 0.2, { boost: 3 });
        this.rings.spawn(pos, m.color ?? 0xffffff, size * 1.2, 0.8);
        break;
      case "flare":
        P.burst(pos, new THREE.Color(0xfff1c2), 40, 30, 1.2, 3, 0.3, { boost: 4 });
        this.rings.spawn(pos, 0xffe08a, (m.size || TUNING.flare.radius) * 0.5, 1.2);
        break;
      case "scan":
        this.rings.spawn(pos, 0x22d3ee, m.size || TUNING.scan.range, 1.8);
        this.rings.spawn(pos, 0x22d3ee, (m.size || TUNING.scan.range) * 0.6, 1.3);
        break;
      case "drill":
        P.burst(pos, new THREE.Color(0xffc861), 14, 14, 0.45, 0.6, 0.05, { boost: 3.5, drag: 2 });
        P.burst(pos, c, 4, 6, 0.4, 0.9, 0.1, { boost: 2.5 });
        break;
      case "crack":
        P.burst(pos, new THREE.Color(0xff5a1f), 90, size * 2.2, 1.4, 2.6, 0.3, { boost: 3, spread: size * 0.5 });
        this.rings.spawn(pos, 0xff3b1f, size * 3, 1.1);
        break;
      case "hit":
        P.burst(pos, c, 10, 10, 0.35, 0.7, 0.05, { boost: 3 });
        break;
      case "respawn":
        P.burst(pos, c, 40, 9, 0.9, 1.2, 0.1, { boost: 3, drag: 1.5 });
        this.rings.spawn(pos, m.color ?? 0x22d3ee, 9, 0.9);
        break;
      case "emp":
      case "inkbomb":
      case "tractor":
      case "mine":
      case "decoy":
        this.mischief.fx(m);
        break;
      case "land":
      case "spark":
      default:
        P.burst(pos, c, 12, 8, 0.5, 0.8, 0.1, { boost: 3 });
    }
  }

  clearForRound() {
    this.particles.clear();
    this.mischief.clear();
    this.efx.clear(); // A-010: every effect, bubble and pending boss blast of the last round goes
    worldSound.reset();
    this.skyFailed = false; // world-assets: a new round may retry A-011's nebula sky after a failed load
  }
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const FLASH_SECONDS = 2.5; // how long a huge explosion dims bloom and exposure (SpaceWorld.flash)

// Placeholder rock field when A-002 is unavailable: one InstancedMesh per type, flat-shaded low-poly.
// Phone (World look): A-002's createRockField merges the 3 shapes of a type into ONE batch and collapses the unused ones with
// an instance attribute, but every instance still submits all 3 shapes (about 240 triangles for an 80-triangle rock: 77k for
// the 320 rocks, most of the phone's 120k budget). Here each rock keeps ONE shape: 3 fields (id % 3), one template per type
// each, so a third of the triangles for the same rocks, at the cost of 4 more draw calls.
function splitRockField(asset, records, seed) {
  const object3d = new THREE.Group();
  const fields = [];
  const handles = new Map();
  for (let v = 0; v < 3; v++) {
    const mine = records.filter((r) => r.id % 3 === v).map((r) => ({ ...r, variant: 1 }));
    if (!mine.length) continue;
    const templates = {};
    for (const type of Object.keys(asset.templates)) templates[type] = [asset.templates[type][v]];
    const field = asset.createRockField({ templates, rocks: mine, seed });
    fields.push(field);
    object3d.add(field.object3d);
    for (const r of mine) { const h = field.handles.get(r.id); handles.set(r.id, { type: h.type, index: h.index, field }); }
  }
  return { object3d, handles, dispose() { for (const f of fields) f.dispose(); object3d.removeFromParent(); } };
}

function placeholderRockField(records) {
  const object3d = new THREE.Group();
  const batches = {};
  const handles = new Map();
  const byType = {};
  records.forEach((r) => (byType[r.type] = byType[r.type] || []).push(r));
  const d = new THREE.Object3D();
  for (const [type, list] of Object.entries(byType)) {
    const crystal = type === "crystal";
    const geo = crystal ? new THREE.OctahedronGeometry(1, 0) : new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: crystal ? 0xc4b5fd : 0x8a7766, flatShading: true, roughness: crystal ? 0.2 : 0.95, emissive: crystal ? 0x6d28d9 : 0x000000, emissiveIntensity: crystal ? 1.4 : 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((r, i) => {
      d.position.fromArray(r.position);
      d.quaternion.fromArray(r.quaternion);
      d.scale.setScalar(r.radius);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      handles.set(r.id, { type, index: i });
    });
    mesh.computeBoundingSphere();
    object3d.add(mesh);
    batches[type] = mesh;
  }
  return { object3d, batches, handles, dispose() { object3d.removeFromParent(); for (const m of Object.values(batches)) { m.geometry.dispose(); m.material.dispose(); } } };
}

// A jagged hairline crack on the boss's armour: two branching lines laid on the model's real surface (raycast once
// at load), drawn as additive lines plus a few glow sprites along them. Lives in the boss group (turns with it).
function bossCrack(model, radius) {
  const rnd = seeded(4242);
  model.updateWorldMatrix(true, true);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const ray = new THREE.Raycaster();
  const parentInv = new THREE.Matrix4().copy(model.parent ? model.parent.matrixWorld : new THREE.Matrix4()).invert();
  const centre = v3().setFromMatrixPosition(model.matrixWorld);
  const onSurface = (lat, lon) => {
    const dir = v3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
    ray.set(centre.clone().addScaledVector(dir, radius * 3), dir.clone().negate());
    const hit = meshes.length ? ray.intersectObjects(meshes, false)[0] : null;
    const w = hit ? hit.point.addScaledVector(dir, 0.12) : centre.clone().addScaledVector(dir, radius);
    return w.applyMatrix4(parentInv);
  };
  const segs = [], glowPoints = [];
  const path = (lat0, lon0, dLat, dLon, n) => {
    let lat = lat0, lon = lon0, prev = onSurface(lat, lon);
    for (let i = 0; i < n; i++) {
      lat += dLat + (rnd() - 0.5) * 0.09;
      lon += dLon + (rnd() - 0.5) * 0.16;
      const p = onSurface(lat, lon);
      segs.push(prev, p);
      if (i % 2 === 0) glowPoints.push(p);
      prev = p;
    }
    return { lat, lon };
  };
  for (const lon0 of [0.2, Math.PI + 0.4]) {
    path(-0.85, lon0, 0.11, 0.015, 16);
    path(-0.2, lon0 + 0.05, 0.05, 0.1, 5);
    path(0.25, lon0, 0.04, -0.11, 5);
    path(0.5, lon0 + 0.05, -0.02, 0.09, 4);
  }
  const g = new THREE.BufferGeometry().setFromPoints(segs);
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(g, mat);
  lines.renderOrder = 12;
  return { lines, mat, glowPoints };
}

function placeholderBoss(s) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(12 * s, 1), new THREE.MeshStandardMaterial({ color: 0x3a3440, flatShading: true, roughness: 0.85, metalness: 0.3 }));
  const seams = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(3), toneMapped: false }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(6 * s, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(3), toneMapped: false }));
  g.add(shell, seams, core);
  return {
    object3d: g,
    setState(state) {
      shell.visible = seams.visible = state !== "armour_broken";
      shell.scale.setScalar(state === "armour_cracked" ? 0.94 : 1);
      core.visible = state === "armour_broken";
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Sound. ONE engine: sfx.js (createSfx: DSP-rendered buffers, a voice pool, a limiter), loaded by a dynamic import so the page keeps
// working when the server does not serve it (404 on an old server): then, and only then, the small oscillator synth below
// (makeSynth) stands in. `sfx` (exported; game.sfx is the same object) is the only entry point of both pages:
//   sfx.unlock()                       inside a user gesture (iOS). The pages call it on the first tap (capture listener) and the engine
//                                      listens by itself too; asked before sfx.js has loaded, it is done the moment it has.
//   sfx.play(name, { volume, pitch, pan, delay, size }) → bool    volume 0..1 (x the sound's own loudness), pitch = playback-rate
//                                      multiplier, pan -1..1, size "small" | "medium" | "large" (explosions). false until unlocked.
//   sfx.setMuted(bool)  sfx.muted  sfx.unlocked  sfx.ready  sfx.loop(name, opts) → { stop(), setPan(), setVolume() } (held actions)
// Names pages may use (UI only): click pop hint unlock. Every game sound is played by WorldSound below (laser bossLaser explosion
// explosionBig hit hitmark crack drill dig land touch takeoff chest scan flare boost emp ink tractor mine death respawn kill steal
// start win countdown, and the held boost / drill / dig loops): pages must not play those, or they would sound twice. Nothing here
// ever throws.
// <sound>  (the Node tests in dev/v12-client/render read everything from here to </sound>)
// name → [sfx.js name, playback-rate factor]
const SFX_MAP = {
  click: ["ui-tap", 1], pop: ["hint", 1], hint: ["hint", 1], unlock: ["chest", 1], start: ["countdown-go", 1], touch: ["land", 1.15],
  bossLaser: ["laser", 0.6], explosionBig: ["explosion-large", 1], zap: ["emp", 1], inkbomb: ["ink", 1],
};
// The fallback synth has fewer sounds: the new ones borrow the nearest.
const SYNTH_MAP = {
  emp: ["zap", 1], ink: ["zap", 0.7], tractor: ["zap", 0.55], mine: ["explosion", 1.3], death: ["explosionBig", 1], kill: ["chest", 1.3],
  respawn: ["pop", 1.3], crack: ["explosion", 0.75], shield: ["boost", 0.8], "ui-tap": ["click", 1], "countdown-go": ["start", 1],
  "explosion-large": ["explosionBig", 1], "explosion-small": ["explosion", 1.2], "explosion-medium": ["explosion", 1],
  steal: ["chest", 0.8], hitmark: ["click", 1.6],
};
const sfxLoader = () => import("./sfx.js");
const inertLoop = Object.freeze({ stop() {}, setPan() {}, setVolume() {} });

// The fallback synth: only when sfx.js did not load. A small WebAudio synth, no files: every sound is built from oscillators and
// filtered noise; master gain -> compressor -> speakers; at most 14 voices (the quietest give way), per-sound throttles. It installs its own
// gesture listeners when it is built, so a working page never builds it.
function makeSynth() {
  const VOICES = 14, MASTER = 0.9, FLOOR = 0.0001;
  let ctx = null, master = null, noiseBuf = null, primed = false, muted = false;
  const voices = [];
  const lastAt = Object.create(null);
  const noop = () => {};
  const hz = (f) => Math.min(18000, Math.max(20, f));

  // Gain envelope: silence -> peak in `a` s, held for `hold` s, then an exponential fall to silence at `dur`.
  function env(g, t, a, hold, dur, peak) {
    const p = g.gain, top = Math.max(FLOOR * 2, peak);
    p.setValueAtTime(FLOOR, t);
    p.exponentialRampToValueAtTime(top, t + a);
    if (hold > 0) p.setValueAtTime(top, t + a + hold);
    p.exponentialRampToValueAtTime(FLOOR, t + Math.max(dur, a + hold + 0.01));
  }
  function filt(c, dest, type, f, q = 0.7) {
    const b = c.createBiquadFilter();
    b.type = type; b.frequency.value = hz(f); b.Q.value = q;
    b.connect(dest);
    return b;
  }
  // One oscillator through its own envelope.
  function osc(c, dest, type, f0, f1, t, dur, peak, a = 0.004, hold = 0) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz(f0), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(hz(f1), t + dur);
    env(g, t, a, hold, dur, peak);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  // A burst of noise through a swept filter and its own envelope.
  function nz(c, dest, type, f0, f1, q, t, dur, peak, a = 0.004, hold = 0) {
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(hz(f0), t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(hz(f1), t + dur);
    env(g, t, a, hold, dur, peak);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return s;
  }
  function brass(c, dest, f, t, dur, peak) {
    const lp = filt(c, dest, "lowpass", 2000, 0.8);
    osc(c, lp, "sawtooth", f, f, t, dur, peak, 0.025, dur * 0.45);
    osc(c, lp, "sawtooth", f * 1.006, f * 1.006, t, dur, peak * 0.7, 0.025, dur * 0.45);
    osc(c, lp, "square", f * 0.5, f * 0.5, t, dur, peak * 0.3, 0.025, dur * 0.45);
  }
  function bell(c, dest, f, t, dur, peak) {
    osc(c, dest, "triangle", f, f, t, dur, peak, 0.004);
    osc(c, dest, "sine", f * 2.01, f * 2.01, t, dur * 0.6, peak * 0.35, 0.004);
  }

  // name -> { gap: min seconds between two plays, vol: level, pri: voice priority, make(c, out, t, pitch) -> seconds }
  const SOUNDS = {
    // Short square / saw zap with a fast pitch drop.
    laser: { gap: 0.05, vol: 0.5, pri: 2, make(c, out, t, p) {
      const lp = filt(c, out, "lowpass", 4600, 0.7);
      osc(c, lp, "sawtooth", 1750 * p, 250 * p, t, 0.16, 0.55, 0.002);
      osc(c, lp, "square", 880 * p, 125 * p, t, 0.14, 0.22, 0.002);
      nz(c, out, "highpass", 3500, 3500, 0.7, t, 0.03, 0.22, 0.001);
      return 0.22;
    } },
    // The boss's heavy red shot: lower and longer.
    bossLaser: { gap: 0.12, vol: 0.55, pri: 3, make(c, out, t, p) {
      const lp = filt(c, out, "lowpass", 2600, 0.8);
      osc(c, lp, "sawtooth", 560 * p, 80 * p, t, 0.34, 0.6, 0.003);
      osc(c, lp, "square", 280 * p, 55 * p, t, 0.3, 0.3, 0.003);
      nz(c, out, "bandpass", 1800 * p, 500 * p, 1.2, t, 0.25, 0.2, 0.003);
      return 0.4;
    } },
    explosion: { gap: 0.06, vol: 0.7, pri: 6, make(c, out, t, p) {
      nz(c, out, "lowpass", 2600 * p, 180 * p, 0.8, t, 0.7, 0.9, 0.003);
      osc(c, out, "sine", 130 * p, 38 * p, t, 0.5, 0.95, 0.004);
      nz(c, out, "bandpass", 900 * p, 300 * p, 0.9, t + 0.02, 0.35, 0.28, 0.003);
      return 0.78;
    } },
    explosionBig: { gap: 0.15, vol: 0.85, pri: 9, make(c, out, t, p) {
      nz(c, out, "lowpass", 1900 * p, 90 * p, 0.8, t, 1.5, 1.0, 0.004);
      osc(c, out, "sine", 95 * p, 26 * p, t, 0.95, 1.0, 0.005);
      nz(c, out, "bandpass", 700 * p, 200 * p, 0.9, t + 0.03, 0.9, 0.35, 0.004);
      nz(c, out, "lowpass", 700 * p, 120 * p, 0.7, t + 0.2, 0.9, 0.6, 0.01);
      osc(c, out, "sine", 60 * p, 25 * p, t + 0.12, 1.2, 0.5, 0.01);
      return 1.6;
    } },
    // Rising whoosh.
    boost: { gap: 0.3, vol: 0.55, pri: 5, make(c, out, t, p) {
      nz(c, out, "bandpass", 300 * p, 2600 * p, 1.4, t, 0.9, 0.6, 0.25);
      osc(c, filt(c, out, "lowpass", 700, 0.7), "sawtooth", 80 * p, 240 * p, t, 0.85, 0.3, 0.22);
      return 0.95;
    } },
    // A short gritty buzz; the game repeats it every ~0.35 s while drilling.
    drill: { gap: 0.1, vol: 0.5, pri: 3, make(c, out, t, p) {
      const bp = filt(c, out, "bandpass", 650 * p, 2.2);
      const g = c.createGain();
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.setValueAtTime(0.5, t + 0.3);
      g.gain.linearRampToValueAtTime(FLOOR, t + 0.4);
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 26; lg.gain.value = 0.32;
      lfo.connect(lg); lg.connect(g.gain);
      for (const [type, f] of [["sawtooth", 68], ["square", 71.5]]) {
        const o = c.createOscillator();
        o.type = type; o.frequency.value = hz(f * p);
        o.connect(g); o.start(t); o.stop(t + 0.45);
      }
      g.connect(bp);
      lfo.start(t); lfo.stop(t + 0.45);
      nz(c, out, "highpass", 2800, 2800, 0.7, t, 0.38, 0.14, 0.01);
      return 0.45;
    } },
    // Crunchy scoops.
    dig: { gap: 0.12, vol: 0.7, pri: 4, make(c, out, t, p) {
      for (let i = 0; i < 3; i++) nz(c, out, "bandpass", (1300 - i * 180) * p, (700 - i * 100) * p, 0.9, t + i * 0.075, 0.075, 0.55, 0.002);
      osc(c, out, "sine", 150 * p, 70 * p, t, 0.22, 0.5, 0.003);
      return 0.34;
    } },
    // The landing shot (3 s): an entry whoosh, the engines winding down, a thump at touchdown.
    land: { gap: 1, vol: 0.8, pri: 8, make(c, out, t, p) {
      nz(c, out, "bandpass", 500 * p, 2200 * p, 0.9, t + 0.1, 1.4, 0.4, 0.5);
      nz(c, out, "lowpass", 2400 * p, 350 * p, 0.7, t + 1.2, 1.7, 0.5, 0.6);
      osc(c, filt(c, out, "lowpass", 900, 0.7), "sawtooth", 210 * p, 70 * p, t, 2.7, 0.25, 0.6);
      osc(c, out, "sine", 100 * p, 34 * p, t + 2.85, 0.55, 1.0, 0.004);
      nz(c, out, "lowpass", 900 * p, 150 * p, 0.7, t + 2.85, 0.5, 0.7, 0.004);
      return 3.45;
    } },
    // A thump and a puff of dust (touchdown heard from elsewhere).
    touch: { gap: 0.3, vol: 0.8, pri: 6, make(c, out, t, p) {
      osc(c, out, "sine", 110 * p, 34 * p, t, 0.45, 1.0, 0.003);
      nz(c, out, "lowpass", 1100 * p, 160 * p, 0.7, t, 0.35, 0.7, 0.003);
      return 0.5;
    } },
    // The take-off shot (2 s): a swelling roar.
    takeoff: { gap: 1, vol: 0.8, pri: 8, make(c, out, t, p) {
      nz(c, out, "lowpass", 250 * p, 3800 * p, 0.8, t, 1.95, 0.75, 1.0);
      osc(c, filt(c, out, "lowpass", 900, 0.7), "sawtooth", 55 * p, 230 * p, t, 1.9, 0.36, 0.9);
      osc(c, filt(c, out, "lowpass", 1200, 0.7), "square", 110 * p, 460 * p, t, 1.9, 0.12, 0.9);
      return 2.05;
    } },
    // Bright arpeggio.
    chest: { gap: 0.2, vol: 0.55, pri: 8, make(c, out, t, p) {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(c, out, f * p, t + i * 0.085, 0.5, 0.3));
      nz(c, out, "highpass", 6500, 6500, 0.7, t + 0.25, 0.45, 0.08, 0.05);
      return 1.0;
    } },
    // Short metallic tick.
    hit: { gap: 0.045, vol: 0.5, pri: 4, make(c, out, t, p) {
      osc(c, out, "square", 940 * p, 700 * p, t, 0.09, 0.3, 0.001);
      osc(c, out, "triangle", 1530 * p, 1100 * p, t, 0.12, 0.3, 0.001);
      nz(c, out, "bandpass", 3800, 3800, 2, t, 0.04, 0.25, 0.001);
      return 0.16;
    } },
    // Mischief: a wobbling FM zap.
    zap: { gap: 0.15, vol: 0.55, pri: 6, make(c, out, t, p) {
      const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      car.type = "sine";
      car.frequency.setValueAtTime(hz(520 * p), t);
      car.frequency.exponentialRampToValueAtTime(hz(230 * p), t + 0.55);
      mod.type = "sine"; mod.frequency.value = hz(43 * p); mg.gain.value = 210;
      mod.connect(mg); mg.connect(car.frequency);
      lfo.frequency.value = 9; lg.gain.value = 70;
      lfo.connect(lg); lg.connect(car.frequency);
      env(g, t, 0.01, 0.15, 0.6, 0.6);
      car.connect(g); g.connect(out);
      for (const o of [car, mod, lfo]) { o.start(t); o.stop(t + 0.65); }
      return 0.65;
    } },
    click: { gap: 0.03, vol: 0.5, pri: 5, make(c, out, t, p) {
      osc(c, out, "triangle", 1400 * p, 900 * p, t, 0.05, 0.4, 0.001);
      nz(c, out, "highpass", 5000, 5000, 0.7, t, 0.02, 0.12, 0.001);
      return 0.08;
    } },
    pop: { gap: 0.05, vol: 0.55, pri: 5, make(c, out, t, p) {
      osc(c, out, "sine", 320 * p, 760 * p, t, 0.1, 0.6, 0.003);
      nz(c, out, "bandpass", 2400, 2400, 1, t, 0.02, 0.1, 0.001);
      return 0.14;
    } },
    // The unlock card: a magic sparkle chord.
    unlock: { gap: 0.2, vol: 0.55, pri: 7, make(c, out, t, p) {
      [523.25, 659.25, 783.99, 987.77, 1318.5].forEach((f, i) => bell(c, out, f * p, t + i * 0.045, 1.1, 0.26));
      for (let i = 0; i < 5; i++) osc(c, out, "sine", (2200 + i * 520) * p, (2400 + i * 520) * p, t + 0.18 + i * 0.07, 0.16, 0.1, 0.004);
      nz(c, out, "highpass", 7000, 7000, 0.7, t, 0.7, 0.06, 0.1);
      return 1.4;
    } },
    countdown: { gap: 0.2, vol: 0.5, pri: 7, make(c, out, t, p) {
      osc(c, filt(c, out, "lowpass", 3200, 0.7), "square", 880 * p, 880 * p, t, 0.17, 0.2, 0.003, 0.09);
      osc(c, out, "sine", 880 * p, 880 * p, t, 0.17, 0.35, 0.003, 0.09);
      return 0.22;
    } },
    // Fanfare.
    start: { gap: 1, vol: 0.6, pri: 9, make(c, out, t, p) {
      [[261.63, 0, 0.16], [329.63, 0.13, 0.16], [392, 0.26, 0.16]].forEach(([f, at, d]) => brass(c, out, f * p, t + at, d + 0.08, 0.34));
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => brass(c, out, f * p, t + 0.4, 0.8, 0.24));
      nz(c, out, "highpass", 6000, 6000, 0.7, t + 0.4, 0.5, 0.05, 0.02);
      return 1.3;
    } },
    // Victory jingle.
    win: { gap: 1.5, vol: 0.6, pri: 9, make(c, out, t, p) {
      [392, 523.25, 659.25, 783.99].forEach((f, i) => { brass(c, out, f * p, t + i * 0.11, 0.2, 0.3); bell(c, out, f * 2 * p, t + i * 0.11, 0.5, 0.14); });
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => brass(c, out, f * p, t + 0.52, 1.2, 0.24));
      for (let i = 0; i < 7; i++) osc(c, out, "sine", (1800 + i * 330) * p, (1900 + i * 330) * p, t + 0.55 + i * 0.09, 0.2, 0.09, 0.004);
      nz(c, out, "highpass", 7000, 7000, 0.7, t + 0.52, 1.0, 0.07, 0.05);
      return 2.0;
    } },
    // A radar ping (scan).
    scan: { gap: 0.3, vol: 0.5, pri: 3, make(c, out, t, p) {
      osc(c, out, "sine", 700 * p, 2100 * p, t, 0.3, 0.4, 0.01);
      osc(c, out, "sine", 700 * p, 2100 * p, t + 0.2, 0.3, 0.2, 0.01);
      return 0.55;
    } },
  };

  function create() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch { try { ctx = new AC(); } catch { ctx = null; return null; } }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function resume() {
    if (!ctx || ctx.state === "running") return;
    try { const r = ctx.resume(); if (r && r.catch) r.catch(noop); } catch { /* not allowed outside a gesture */ }
  }
  function unlock() {
    try {
      if (!create()) return false;
      resume();
      // The iOS trick: a silent buffer played inside the gesture. Repeat it until audio runs: on iOS a touch's pointerdown
      // is not a gesture (touchend / pointerup / click are), so the first try can be too early.
      if (!primed || ctx.state !== "running") {
        primed = true;
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
      }
      return ctx.state === "running";
    } catch { return false; }
  }
  function play(name, o) {
    try {
      if (!ctx || muted) return false;
      const def = SOUNDS[name];
      if (!def) return false;
      if (ctx.state !== "running") { resume(); return false; }
      const now = ctx.currentTime;
      if (now - (lastAt[name] ?? -9) < def.gap) return false;
      const vol = (o && Number.isFinite(o.volume) ? Math.min(o.volume, 1.5) : 1) * def.vol;
      if (!(vol > 0.012)) return false;
      // Voice cap: drop finished voices; when full, the new sound only replaces a quieter-priority one.
      for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
      if (voices.length >= VOICES) {
        let low = 0;
        for (let i = 1; i < voices.length; i++) if (voices[i].pri < voices[low].pri || (voices[i].pri === voices[low].pri && voices[i].end < voices[low].end)) low = i;
        if (voices[low].pri >= def.pri) return false;
        const v = voices.splice(low, 1)[0];
        v.bus.gain.cancelScheduledValues(now);
        v.bus.gain.setTargetAtTime(0, now, 0.012);
      }
      const bus = ctx.createGain();
      bus.gain.value = vol;
      bus.connect(master);
      const delay = o && Number.isFinite(o.delay) ? Math.max(0, o.delay) : 0;
      const t0 = now + 0.006 + delay;
      let dur;
      try { dur = def.make(ctx, bus, t0, o && Number.isFinite(o.pitch) && o.pitch > 0 ? o.pitch : 1); } catch (e) { try { bus.disconnect(); } catch { /* gone */ } return false; }
      lastAt[name] = now;
      voices.push({ end: t0 + dur, pri: def.pri, bus });
      setTimeout(() => { try { bus.disconnect(); } catch { /* gone */ } }, (dur + delay + 0.4) * 1000);
      return true;
    } catch { return false; }
  }
  function setMuted(m) {
    muted = !!m;
    try { if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.02); } catch { /* no context */ }
  }

  if (typeof document !== "undefined") {
    // Any later tap, click or key also (re)starts audio: iOS suspends it after calls, locks and tab switches.
    const gesture = () => { if (!ctx || ctx.state !== "running") unlock(); };
    for (const ev of ["pointerup", "touchend", "click", "keydown"]) document.addEventListener(ev, gesture, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      try { if (document.hidden) { const r = ctx.suspend(); if (r && r.catch) r.catch(noop); } else resume(); } catch { /* ignore */ }
    });
  }
  return {
    unlock, play, setMuted, resume,
    get muted() { return muted; },
    get ready() { return !!ctx && ctx.state === "running"; },
    names: Object.keys(SOUNDS),
  };
}

// The facade. state: 0 = sfx.js still loading (play() is false, unlock() is remembered), 1 = sfx.js, -1 = the fallback synth.
const sfx = (() => {
  let engine = null, synth = null, state = 0, muted = false, wantUnlock = false;
  const fallback = (e) => {
    state = -1;
    console.warn("[render] sfx.js unavailable, using the fallback synth:", e?.message || e);
    try { synth = makeSynth(); synth.setMuted(muted); if (wantUnlock) synth.unlock(); } catch { /* no WebAudio at all: stays silent */ }
  };
  sfxLoader().then((m) => {
    try { engine = m.createSfx(); } catch (e) { fallback(e); return; }
    state = 1;
    try { engine.mute(muted); if (wantUnlock) engine.unlock(); } catch { /* ignore */ }
  }, fallback);
  function play(name, o) {
    try {
      if (state === 1) {
        const m = SFX_MAP[name], rate = (o && o.pitch > 0 ? o.pitch : 1) * (m ? m[1] : 1);
        let opts;
        if (o) {
          opts = {};
          if (o.volume !== undefined) opts.volume = o.volume;
          if (o.pan) opts.pan = o.pan;
          if (o.size) opts.size = o.size;
        }
        if (rate !== 1) (opts || (opts = {})).rate = rate;
        const key = m ? m[0] : name;
        if (o && o.delay > 0) { setTimeout(() => { try { engine.play(key, opts); } catch { /* ignore */ } }, o.delay * 1000); return true; }
        return engine.play(key, opts);
      }
      if (state === -1) {
        const f = SYNTH_MAP[name === "explosion" && o && o.size === "large" ? "explosion-large" : name];
        return synth.play(f ? f[0] : name, f ? { ...o, pitch: ((o && o.pitch) || 1) * f[1] } : o);
      }
    } catch { /* never throws */ }
    return false;
  }
  return {
    play,
    unlock() {
      wantUnlock = true;
      try { if (state === 1) { engine.unlock(); return engine.unlocked; } if (state === -1) return synth.unlock(); } catch { /* ignore */ }
      return false;
    },
    setMuted(b) { muted = !!b; try { if (state === 1) engine.mute(muted); else if (state === -1) synth.setMuted(muted); } catch { /* ignore */ } },
    mute(b) { this.setMuted(b); },
    loop(name, o) { try { if (state === 1) { const m = SFX_MAP[name]; return engine.loop(m ? m[0] : name, o); } } catch { /* ignore */ } return inertLoop; },
    get muted() { return muted; },
    get unlocked() { return state === 1 ? !!engine.unlocked : state === -1 ? !!(synth && synth.ready) : false; },
    get ready() { return this.unlocked; },
    get engine() { return state === 1 ? "sfx.js" : state === -1 ? "synth" : "loading"; },
  };
})();

// The game's world sounds, hooked into the events the renderer already sees: fx messages, tick flags (boost, landing, take-off, my
// own death and respawn), new bullets and boss shots, phase changes, the last 10 s of the round, announce lines (my kills) and the
// personal mischief messages (what a rival did to ME). Volume falls with the distance from the camera's subject (the phone's own
// ship; the followed player on the big screen) and the sound pans with where it is on screen. Both worlds call tick() once per
// frame and fx() for their fx messages. One event, one sound: a mischief hit on my phone arrives as a `mischief` message AND as the
// fx burst on my ship: whichever comes first plays, the other is skipped for 600 ms (sup / fxAt).
// The held loops (WorldSound.loopTick): the sfx.js loop, the tick flag that holds it, its reference distance (m) and level. A loop starts
// once its flag has been held LOOP_HOLD_MS (a tap is just the boost whoosh; a hold adds the roar under it). Boost is the subject's
// alone; a drill or a dig is heard from whoever is nearest (the server sends no fx for them: the loop is their sound).
const LOOP_HOLD_MS = 300;
const BOSS_HIT_COL = 0xef4444, HEAL_COL = 0x4ade80; // world.js fx("hit") colours: the boss was hit / a heal (a player hit is orange)
const LOOP_KINDS = [
  { kind: "boost", flag: "boost", subjectOnly: true, ref: 60, v: 0.55 },
  { kind: "drill", flag: "drilling", subjectOnly: false, ref: 35, v: 0.8 },
  { kind: "dig", flag: "digging", subjectOnly: false, ref: 30, v: 0.85 },
];
class WorldSound {
  constructor() {
    this.game = null;
    this.L = { ok: false, x: 0, y: 0, z: 0, mode: "space", color: null };
    this.boost = new Map();
    this.shot = new Map();
    this.bullets = new Set();
    this.bTmp = new Set();
    this.shots = new Set();
    this.sTmp = new Set();
    this.names = new Set();
    this.phase = null;
    this.count = NaN;
    this.cam = null; // the camera's position (pan reference)
    this.right = [1, 0, 0]; // the camera's right axis (pan)
    this.meDead = false; // the phone's own ship was down last tick
    this.sup = Object.create(null); // mischief kind → performance.now() until which its fx sound is skipped
    this.fxAt = Object.create(null); // mischief kind → performance.now() of its last fx sound
    this.pan = 0; // the pan gain() worked out last
    // Held actions as loops (sfx.loop): one per kind, carried by the loudest player doing it (LOOP_KINDS). h = the handle, who = the
    // carrier, t0 = when it started (a loop is renewed every 24 s: sfx.js stops a forgotten one after maxSeconds), at = last re-aim,
    // cand / since = the would-be carrier and since when it holds (LOOP_HOLD_MS).
    this.loops = LOOP_KINDS.map((k) => ({ kind: k.kind, flag: k.flag, subjectOnly: k.subjectOnly, ref: k.ref, v: k.v, h: null, who: null, t0: 0, at: 0, cand: null, since: 0 }));
    // MY last bullets (id, last position, unit direction when known, when seen): a hit fx just ahead of where one vanished is MY hit →
    // the confirm tick (hitmark).
    this.myShots = Array.from({ length: 24 }, () => ({ id: -1, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, dir: false, t: 0 }));
  }
  attach(game) { this.game = game; }
  reset() { this.boost.clear(); this.shot.clear(); this.bullets.clear(); this.shots.clear(); this.phase = null; this.count = NaN; this.meDead = false; this.hush(); for (const s of this.myShots) s.id = -1; }
  // Every held loop off at once (a new round, the page paused or hidden: nothing may hum on behind the draw screen).
  hush() {
    for (const l of this.loops) if (l.h) { try { l.h.stop(0.12); } catch { /* ignore */ } l.h = null; l.who = null; }
  }
  // How loud a sound at a place is for the listener (0 = silent): quieter with distance, silent from the other world (unless `global`
  // is given). Sets this.pan by screen side.
  gain(x, y, z, mode, v, ref, global) {
    const L = this.L;
    this.pan = 0;
    if (!L.ok) return v * 0.5;
    if (mode !== L.mode) return global > 0 ? v * global : 0;
    const k = Math.hypot(x - L.x, y - L.y, z - L.z) / (ref || 60);
    v /= 1 + k * k;
    const c = this.cam;
    if (c) {
      const R = this.right, dx = x - c.x, dy = y - c.y, dz = z - c.z;
      this.pan = clamp(((dx * R[0] + dy * R[1] + dz * R[2]) / (Math.hypot(dx, dy, dz) + 8)) * 1.1, -0.85, 0.85);
    }
    return v;
  }
  // One sound at a place (see gain()).
  at(name, x, y, z, mode, o = {}) {
    const v = this.gain(x, y, z, mode, o.v === undefined ? 1 : o.v, o.ref, o.global);
    if (v < 0.03) return;
    sfx.play(name, { volume: v, pitch: o.pitch, pan: this.pan, size: o.size });
  }
  // The held loops, once per frame: the carrier of each kind is the loudest player with that flag (the subject at full volume; boost is
  // the subject's alone). Started once the carrier has held it LOOP_HOLD_MS (the rising edge is the one-shot whoosh, so a tap sounds
  // once), re-aimed every 100 ms, renewed every 24 s, stopped when nobody near does it. Nothing starts before audio is unlocked (an
  // inert handle would never be retried).
  loopTick(snap, subj) {
    const now = performance.now(), live = sfx.unlocked;
    for (const l of this.loops) {
      let best = null, bv = 0, bpan = 0;
      if (live) {
        for (const p of snap.players) {
          const f = p.flags;
          if (!f || !f[l.flag] || f.dead || f.invisible && p !== subj) continue;
          if (l.subjectOnly && p !== subj) continue;
          const v = p === subj ? l.v : this.gain(p.x, p.y, p.z, p.mode === "planet" ? "planet" : "space", l.v, l.ref, 0);
          if (v > bv) { bv = v; best = p; bpan = p === subj ? 0 : this.pan; }
        }
      }
      if (!best || bv < 0.04) { l.cand = null; if (l.h) { l.h.stop(0.15); l.h = null; l.who = null; } continue; }
      if (best.name !== l.cand) { l.cand = best.name; l.since = now; }
      if (l.h && now - l.t0 > 24000) { l.h.stop(0.05); l.h = null; }
      if (!l.h) {
        if (now - l.since < LOOP_HOLD_MS) continue;
        l.h = sfx.loop(l.kind, { volume: bv, pan: bpan, maxSeconds: 25 });
        l.t0 = l.at = now;
        l.who = best.name;
        continue;
      }
      if (now - l.at > 100 || l.who !== best.name) { l.at = now; l.who = best.name; l.h.setVolume(bv); l.h.setPan(bpan); }
    }
  }
  // A hit just ahead of where one of MY bullets was last drawn (the sampled bullet trails the server by ~100 ms plus a tick: up to ~25 m
  // in space) and close to its line → true. r = how far off the line still counts (the target's size). Bullets seen only once (no
  // direction yet) never count: an impact behind or beside my shot is someone else's.
  myHit(p, mode, r) {
    const now = performance.now(), reach = 28 + r; // bullets fly 140 m/s in both worlds: ~14-20 m short when the hit arrives
    for (const s of this.myShots) {
      if (s.id < 0 || !s.dir || now - s.t > 260) continue;
      const vx = p.x - s.x, vy = p.y - s.y, vz = p.z - s.z;
      const along = vx * s.dx + vy * s.dy + vz * s.dz;
      if (along < -3 || along > reach) continue;
      if (vx * vx + vy * vy + vz * vz - along * along < r * r) { s.id = -1; return true; }
    }
    return false;
  }
  // A mischief fx sound, unless the personal one of this very hit has just played (see the class comment).
  mischiefAt(kind, name, p, mode, o) {
    const now = performance.now();
    if (this.sup[kind] > now) return;
    this.fxAt[kind] = now;
    this.at(name, p.x, p.y, p.z, mode, o);
  }
  tick(snap, ctx, camera, scene) {
    const L = this.L, subj = ctx.subject;
    if (subj) { L.x = subj.x; L.y = subj.y; L.z = subj.z; L.mode = subj.mode === "planet" ? "planet" : "space"; L.color = subj.color; }
    else { L.x = camera.position.x; L.y = camera.position.y; L.z = camera.position.z; L.mode = scene; L.color = null; }
    L.ok = true;
    this.cam = camera.position;
    const me = camera.matrixWorld.elements;
    this.right[0] = me[0]; this.right[1] = me[1]; this.right[2] = me[2];
    // Phases: lobby -> playing is the start fanfare; the scoreboard is the win jingle.
    const phase = snap.phase;
    if (phase && phase !== this.phase) {
      const was = this.phase;
      this.phase = phase;
      if (was === "lobby" && phase === "playing") sfx.play("start", { volume: 0.85 });
      else if (was && was !== "scoreboard" && phase === "scoreboard") {
        // The winner's phone gets the full fanfare; every other phone a softer one (the TV: the room's). One sound either way.
        let top = null;
        for (const p of snap.players) if (!top || (p.score || 0) > (top.score || 0)) top = p;
        const phoneMe = this.game && this.game.screen === "phone" ? this.game.player : null;
        const iWon = !!phoneMe && !!top && top.name === phoneMe;
        sfx.play("win", { volume: iWon ? 1 : phoneMe ? 0.6 : 0.9 });
      }
    }
    // The last 10 s of the round: one beep per second, higher for the last three.
    const g = this.game, tk = g && g.snaps && g.snaps.latest;
    if (tk && (phase === "playing" || phase === "assists") && tk.left > 0) {
      const sec = Math.ceil(tk.left - Math.min(1, (Date.now() - g.snaps.latestAt) / 1000));
      if (sec !== this.count) {
        const first = Number.isNaN(this.count);
        this.count = sec;
        if (!first && sec >= 1 && sec <= 10) sfx.play("countdown", { volume: 0.7, pitch: sec <= 3 ? 1.5 : 1 });
      }
    } else this.count = NaN;
    // My own ship down / back (a phone): the personal sounds (the world's explosion is the fx; my respawn fx is skipped, see fx()).
    const mp = ctx.mePlayer;
    if (mp && g && g.screen === "phone") {
      const dead = !!mp.flags.dead;
      if (dead !== this.meDead) { this.meDead = dead; sfx.play(dead ? "death" : "respawn", { volume: dead ? 0.95 : 0.8 }); }
    } else this.meDead = false;
    // Players: boost, landing and take-off edges.
    const names = this.names;
    names.clear();
    for (const p of snap.players) {
      names.add(p.name);
      const f = p.flags || {};
      const b = !!f.boost;
      if (b && !this.boost.get(p.name)) this.at("boost", p.x, p.y, p.z, p.mode, { v: 0.55, ref: 70 }); // the whoosh; a held boost adds the loop (loopTick)
      this.boost.set(p.name, b);
      const st = f.landing ? "land" : f.takingOff ? "takeoff" : "";
      if (st && st !== (this.shot.get(p.name) || "")) this.at(st, p.x, p.y, p.z, p.mode, { v: 0.9, ref: 110 });
      this.shot.set(p.name, st);
    }
    if (this.boost.size > names.size) for (const k of this.boost.keys()) if (!names.has(k)) { this.boost.delete(k); this.shot.delete(k); }
    // Bullets: a laser zap for every new one close to the listener (the subject's own at full volume).
    const cur = this.bTmp;
    cur.clear();
    const now = performance.now(), ms = this.myShots;
    for (const b of snap.bullets) {
      cur.add(b[0]);
      const mine = L.color !== null && b[4] === L.color;
      if (mine) { // remember where MY bullet is and where it heads (its slot, else the stalest one); b[6..8] = its step this tick
        let s = ms[0];
        for (let i = 0; i < ms.length; i++) { if (ms[i].id === b[0]) { s = ms[i]; break; } if (ms[i].t < s.t) s = ms[i]; }
        if (s.id !== b[0]) s.dir = false;
        s.id = b[0]; s.x = b[1]; s.y = b[2]; s.z = b[3]; s.t = now;
        const len = b.length > 8 ? Math.hypot(b[6], b[7], b[8]) : 0;
        if (len > 1e-3) { s.dx = b[6] / len; s.dy = b[7] / len; s.dz = b[8] / len; s.dir = true; }
      }
      if (this.bullets.has(b[0])) continue;
      this.at("laser", b[1], b[2], b[3], b[5] ? "planet" : "space", { v: mine ? 0.6 : 0.22, ref: 45, pitch: 0.92 + (b[0] % 7) * 0.025 });
    }
    this.bTmp = this.bullets;
    this.bullets = cur;
    // The boss's shots.
    const curS = this.sTmp;
    curS.clear();
    for (const s of snap.bossShots) {
      curS.add(s[0]);
      if (!this.shots.has(s[0])) this.at("bossLaser", s[1], s[2], s[3], "space", { v: 0.5, ref: 140 });
    }
    this.sTmp = this.shots;
    this.shots = curS;
    this.loopTick(snap, subj);
  }
  // announce lines: "<me> ✕ <victim>" (+ " 💣" / " 🧲") is MY kill (a phone only). Steals (world.js: "💰 <thief> stole <n> points from
  // <victim>!", "💥 <thief> stole the boss from <victim>! ..."): the steal sting for the thief and (lower) the victim, and on the TV.
  announce(m) {
    const me = this.game && this.game.screen === "phone" ? this.game.player : null;
    const text = m && typeof m.text === "string" ? m.text : "";
    if (!text) return;
    if (me && text.startsWith(me + " ✕ ")) sfx.play("kill", { volume: 0.9 });
    const st = /^💰 (\S+) stole \d+ points from (\S+?)!/.exec(text) || /^💥 (\S+) stole the boss from (\S+?)!/.exec(text)
      || /^💥 (\S+) landed the last hit on the boss \(stolen from (\S+?)\)/.exec(text); // (the v1.2 wording)
    if (!st) return;
    if (!me) sfx.play("steal", { volume: 0.7 });
    else if (st[1] === me) sfx.play("steal", { volume: 0.95, delay: 0.25 }); // after my kill sting
    else if (st[2] === me) sfx.play("steal", { volume: 0.9, pitch: 0.78 });
  }
  // The personal mischief message (only the victim's / the owner's phone gets it): what hit me, at full volume. The fx burst on my
  // ship (same kind, within 600 ms) is skipped; and if that fx sound was first, this one is.
  mischief(m) {
    const k = m && m.kind, now = performance.now();
    if (!k) return;
    this.sup[k] = now + 600;
    if (now - (this.fxAt[k] || -1e9) < 600) return;
    switch (k) {
      case "emp": sfx.play("emp", { volume: 1 }); break;
      case "inkbomb": sfx.play("ink", { volume: 1 }); break;
      case "tractor": sfx.play("tractor", { volume: 0.9 }); break;
      case "mine": sfx.play("mine", { volume: 1 }); break;
      case "decoy": if (m.victim) sfx.play("chest", { volume: 0.5, pitch: 1.25 }); break; // my decoy fooled someone; a shot decoy already popped (explode fx)
      default: break;
    }
  }
  // fx messages (kind, mode, pos, color, size).
  fx(m) {
    const p = m && m.pos;
    if (!p) return;
    const mode = m.mode === "planet" ? "planet" : "space";
    const size = Number(m.size) || 1;
    // MY shot landed (a hit, a chip off a rock or a rock / ship blown up just ahead of my bullet): the crisp confirm tick on top of the
    // world's impact, full on my phone, softer for the TV's followed player. The fx sits at the target's centre: its size widens the line
    // (a rock chip always comes with size 1: allow the biggest rock, 11 m). A heal (green hit) is nobody's shot.
    if ((m.kind === "hit" || m.kind === "spark" || (m.kind === "explode" && size < 12)) && m.color !== HEAL_COL && this.L.color !== null
      && this.myHit(p, mode, (mode === "planet" ? 2 : 4) + (m.kind === "explode" ? size : m.kind === "spark" ? (mode === "planet" ? 2 : 11) : 0))) {
      sfx.play("hitmark", { volume: this.game && this.game.screen === "phone" ? 0.9 : 0.45, pitch: m.kind === "explode" ? 0.85 : 1 });
    }
    switch (m.kind) {
      case "explode":
        if (size >= 12) this.at("explosionBig", p.x, p.y, p.z, mode, { v: 1, ref: 220 });
        else this.at("explosion", p.x, p.y, p.z, mode, { v: 0.75, ref: 60 + size * 8, size: size >= 6 ? "medium" : "small", pitch: Math.min(1.25, Math.max(0.8, 1.25 - size * 0.04)) });
        break;
      case "blast": this.at("explosion", p.x, p.y, p.z, mode, { v: 0.6, ref: 90, size: "medium", pitch: 1.25 }); break;
      case "crack": this.at("crack", p.x, p.y, p.z, mode, { v: 0.8, ref: 120 }); break;
      // world.js colours a hit: red = the boss was hit (a deep armour clang heard from further away), green = a heal (a soft shimmer,
      // never a hit), orange = a ship / explorer / decoy hit (dry; ON me, on my phone: a heavy, close thump instead).
      case "hit":
        if (m.color === HEAL_COL) this.at("respawn", p.x, p.y, p.z, mode, { v: 0.4, ref: 40, pitch: 1.4 });
        else if (mode === "space" && m.color === BOSS_HIT_COL) this.at("hit", p.x, p.y, p.z, mode, { v: 0.85, ref: 150, pitch: 0.62 });
        else if (this.game && this.game.screen === "phone" && this.L.ok && mode === this.L.mode && Math.hypot(p.x - this.L.x, p.y - this.L.y, p.z - this.L.z) < 4) sfx.play("hit", { volume: 1, pitch: 0.72 });
        else this.at("hit", p.x, p.y, p.z, mode, { v: 0.7, ref: 50 });
        break;
      case "spark": this.at("hit", p.x, p.y, p.z, mode, { v: 0.35, ref: 40, pitch: 1.5 }); break;
      case "drill": this.at("drill", p.x, p.y, p.z, mode, { v: 0.7, ref: 40 }); break;
      case "dig": this.at("dig", p.x, p.y, p.z, mode, { v: 0.9, ref: 30 }); break;
      case "treasure": this.at("chest", p.x, p.y, p.z, mode, { v: 0.9, ref: 90, global: 0.3 }); break;
      case "land": if (mode === "planet") this.at("touch", p.x, p.y, p.z, mode, { v: 0.7, ref: 60 }); break;
      // A player back in the game (size 3): everyone hears the pop, except me (my flag edge plays mine); a decoy that ran out (size 2): silent.
      case "respawn":
        if (size >= 3 && !(this.L.color !== null && m.color === this.L.color && this.game && this.game.screen === "phone")) this.at("respawn", p.x, p.y, p.z, mode, { v: 0.7, ref: 60 });
        break;
      case "flare": this.at("flare", p.x, p.y, p.z, mode, { v: 0.5, ref: 90 }); break;
      case "scan": this.at("scan", p.x, p.y, p.z, mode, { v: 0.45, ref: 120 }); break;
      case "emp": this.mischiefAt("emp", "emp", p, mode, { v: 0.9, ref: 80 }); break;
      case "inkbomb": this.mischiefAt("inkbomb", "ink", p, mode, { v: 0.9, ref: 70 }); break;
      case "tractor": this.mischiefAt("tractor", "tractor", p, mode, { v: 0.8, ref: 70 }); break;
      // A mine: dropped (size 1.5: a small tick) or hit (size 3, on the victim: the warning and the boom).
      case "mine":
        if (size < 2) this.at("hit", p.x, p.y, p.z, mode, { v: 0.35, ref: 40, pitch: 0.7 });
        else this.mischiefAt("mine", "mine", p, mode, { v: 0.9, ref: 70 });
        break;
      case "decoy": this.mischiefAt("decoy", "scan", p, mode, { v: 0.45, ref: 70, pitch: 1.4 }); break;
      default: break;
    }
  }
}
const worldSound = new WorldSound();
// </sound>
export { sfx }; // the one sound entry point: pages call sfx.unlock() in a user gesture and sfx.play("click" | "pop" | "hint" | "unlock") for their own UI sounds
// ---------------------------------------------------------------------------------------------------------------
// World look: laser streaks. Instanced quads that turn around their own axis to face the camera (cylindrical
// billboards): player bullets, the boss's red shots, the engine trails and the gold light beams over the chests, in ONE draw call.
// Head = the leading tip (the bright end); the streak trails behind it along -dir. style 0 = laser, 1 = beam (constant
// width, brightest at the head, which is the base of the beam), 2 = engine trail (brightest at the head, tapering to the tail).
const STREAK_VERT = /* glsl */ `
  attribute vec3 iHead; attribute vec3 iDir; attribute vec3 iSize; attribute vec4 iColor;
  varying vec2 vUv; varying vec4 vColor; varying float vStyle;
  void main() {
    float len = iSize.x, wid = iSize.y;
    vec3 centre = iHead - iDir * (len * 0.5);
    vec3 side = cross(iDir, cameraPosition - centre);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    float taper = iSize.z > 1.5 ? mix(0.3, 1.0, position.y + 0.5) : 1.0; // engine trails thin out towards the tail
    vec3 wp = centre + iDir * (position.y * len) + side * (position.x * wid * taper);
    vUv = position.xy + 0.5;
    vColor = iColor;
    vStyle = iSize.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const STREAK_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec4 vColor; varying float vStyle;
  void main() {
    float ax = abs(vUv.x * 2.0 - 1.0);
    float along = clamp(vUv.y, 0.0, 1.0);
    float edge = 1.0 - smoothstep(0.55, 1.0, ax);
    float core, glow;
    if (vStyle > 1.5) {
      float f = pow(along, 1.4);
      core = exp(-ax * ax * 7.0) * f * edge;
      glow = exp(-ax * ax * 1.8) * 0.45 * f * edge;
    } else if (vStyle > 0.5) {
      float f = pow(along, 0.85);
      core = exp(-ax * ax * 6.0) * f * edge;
      glow = exp(-ax * ax * 1.6) * 0.55 * f * edge;
    } else {
      float tail = pow(along, 1.5);
      float cap = 1.0 - smoothstep(0.88, 1.0, along);
      core = exp(-ax * ax * 9.0) * tail * cap * edge;
      glow = exp(-ax * ax * 2.2) * 0.5 * tail * cap * edge;
    }
    vec3 col = vColor.rgb * (core * 1.5 + glow) + vec3(core * core * 0.9);
    gl_FragColor = vec4(col * vColor.a, 1.0);
  }`;
class StreakBatch {
  constructor(capacity, { renderOrder = 13 } = {}) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    this.head = new Float32Array(capacity * 3);
    this.dir = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 4);
    this.aHead = new THREE.InstancedBufferAttribute(this.head, 3).setUsage(THREE.DynamicDrawUsage);
    this.aDir = new THREE.InstancedBufferAttribute(this.dir, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iHead", this.aHead);
    g.setAttribute("iDir", this.aDir);
    g.setAttribute("iSize", this.aSize);
    g.setAttribute("iColor", this.aColor);
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.geometry = g;
    this.n = 0;
  }
  begin() { this.n = 0; }
  // (hx, hy, hz) head, (dx, dy, dz) UNIT direction of travel, len / wid in metres (wid = the whole quad: the bright core
  // is about a sixth of it), r g b the colour (HDR: > 1 blooms), a the alpha, style 0 laser / 1 beam.
  add(hx, hy, hz, dx, dy, dz, len, wid, r, g, b, a = 1, style = 0) {
    if (this.n >= this.capacity) return;
    const i = this.n++, i3 = i * 3;
    this.head[i3] = hx; this.head[i3 + 1] = hy; this.head[i3 + 2] = hz;
    this.dir[i3] = dx; this.dir[i3 + 1] = dy; this.dir[i3 + 2] = dz;
    this.size[i3] = len; this.size[i3 + 1] = wid; this.size[i3 + 2] = style;
    this.color[i * 4] = r; this.color[i * 4 + 1] = g; this.color[i * 4 + 2] = b; this.color[i * 4 + 3] = a;
  }
  end() {
    this.geometry.instanceCount = this.n;
    this.aHead.needsUpdate = this.aDir.needsUpdate = this.aSize.needsUpdate = this.aColor.needsUpdate = true;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
// ---------------------------------------------------------------------------------------------------------------
// World look: decorative rocks (never collide; the gameplay rocks are the A-002 ones). Two fields, each a few instanced
// meshes (one per shape): a dense field of small chunky rocks around the boss and along the spawn -> boss corridor, and
// 8-14 HUGE low-poly rocks drifting 120-500 m to the side of the spawn -> boss -> planet line, so they slide past the camera
// in the foreground (the reference picture); A-002's giant foreground rocks take their place once loaded (SpaceWorld.setLook).
// They tumble and bob in the vertex shader (no CPU work per frame) and dissolve when the camera comes inside them, so
// nothing ever clips through the camera.
const ROCK_TINTS = ["#8f7b6a", "#a38a72", "#7d6c5e", "#9a8470", "#86766a", "#6f6a72"].map((c) => new THREE.Color(c)); // warm greys and browns; the last (cool) one is not used
const PLANET_VISUAL_MAX = 230; // m: the visual planet seen from the spawn side (1900 m away) is about this big (PLANET_K x distance)

// A chunky low-poly rock: an icosphere pulled into a lumpy convex shape by random cutting planes (the more planes and the
// smaller `rough`, the more it looks like a few big flat facets), one flat colour per face (warm grey-brown; coplanar faces
// share a shade so the facets read), flat shading does the rest. Radius about 1.
function chunkyRockGeometry(detail, seed, cuts, rough = 1) {
  const rnd = seeded(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const planes = [];
  for (let k = 0; k < cuts; k++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    planes.push({ x: Math.cos(th) * s, y: u, z: Math.sin(th) * s, c: 0.72 + rnd() * 0.2 });
  }
  const waves = [];
  for (let k = 0; k < 4; k++) waves.push({ fx: (rnd() - 0.5) * 6, fy: (rnd() - 0.5) * 6, fz: (rnd() - 0.5) * 6, ph: rnd() * 6.28, a: (0.05 + rnd() * 0.07) * rough });
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    for (const w of waves) r += w.a * Math.sin(p.x * w.fx + p.y * w.fy + p.z * w.fz + w.ph);
    for (const pl of planes) { const d = p.x * pl.x + p.y * pl.y + p.z * pl.z; if (d > 0.04) r = Math.min(r, pl.c / d); }
    r = Math.max(0.55, Math.min(1.25, r));
    if (detail <= 1) { // few corners: pull each one in or out by its own amount (the same for every copy of it), no regular gems
      const j = Math.sin(Math.round(p.x * 997) * 12.9898 + Math.round(p.y * 997) * 78.233 + Math.round(p.z * 997) * 37.719) * 43758.5453;
      r *= 0.78 + (j - Math.floor(j)) * 0.42;
    }
    pos.setXYZ(i, p.x * r, p.y * r, p.z * r);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const base = ROCK_TINTS[Math.floor(rnd() * 5)];
  const c = new THREE.Color();
  const plane = (f) => { const k = Math.round(nrm.getX(f) * 5) * 121 + Math.round(nrm.getY(f) * 5) * 11 + Math.round(nrm.getZ(f) * 5); const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  for (let f = 0; f < pos.count; f += 3) {
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    c.copy(base).multiplyScalar((0.8 + plane(f) * 0.4) * (0.96 + rnd() * 0.08) * (0.88 + 0.2 * (cy * 0.5 + 0.5)));
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; }
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  return g;
}

const DECO_VERT_PARS = /* glsl */ `
  attribute vec4 iSpin; attribute vec4 iShape; attribute vec3 iDrift;
  uniform float uTime; uniform float uFadeMargin;
  varying float vFade;
  vec3 decoRot(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }`;
// iSpin = axis xyz + angular speed, iShape = squash xyz + phase, iDrift = world-space bobbing amplitude. The instance
// matrix holds only the position and a uniform scale (the radius).
const DECO_VERT_BODY = /* glsl */ `
  {
    transformed *= iShape.xyz;
    transformed = decoRot(transformed, iSpin.xyz, iShape.w + iSpin.w * uTime);
    float decoRad = length(instanceMatrix[0].xyz);
    vec3 decoBob = iDrift * sin(uTime * 0.09 + iShape.w * 3.1);
    transformed += decoBob / decoRad;
    vec3 decoCentre = (modelMatrix * vec4(instanceMatrix[3].xyz + decoBob, 1.0)).xyz;
    float decoR0 = decoRad * 1.7;
    vFade = smoothstep(decoR0, decoR0 + uFadeMargin + decoRad * 0.3, distance(decoCentre, cameraPosition));
    if (vFade <= 0.001) transformed *= 0.0;
  }`;
const DECO_FRAG_BODY = /* glsl */ `
  if (vFade < 0.999) {
    float decoTh = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vFade < decoTh) discard;
  }`;
function decoMaterial(uTime, fadeMargin) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.93, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uFadeMargin = { value: fadeMargin };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + DECO_VERT_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + DECO_VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n" + DECO_FRAG_BODY);
  };
  m.customProgramCacheKey = () => "world_deco_rock_v1";
  return m;
}

// items: [{ x, y, z, rad, sq: [3], axis: [3], spin, phase, drift: [3], tint: [3] }], one InstancedMesh per geometry
// (items go round-robin to the shapes).
class DecoField {
  constructor(items, geometries, fadeMargin) {
    this.group = new THREE.Group();
    this.uTime = { value: 0 };
    this.meshes = [];
    const lists = geometries.map(() => []);
    items.forEach((it, i) => lists[i % geometries.length].push(it));
    const mat4 = new THREE.Matrix4(), scl = new THREE.Vector3(), pos = new THREE.Vector3(), qI = new THREE.Quaternion(), col = new THREE.Color();
    geometries.forEach((geo, gi) => {
      const list = lists[gi];
      if (!list.length) { geo.dispose(); return; }
      const n = list.length;
      const geom = geo;
      const spin = new Float32Array(n * 4), shape = new Float32Array(n * 4), drift = new Float32Array(n * 3);
      const mesh = new THREE.InstancedMesh(geom, decoMaterial(this.uTime, fadeMargin), n);
      list.forEach((it, i) => {
        mat4.compose(pos.set(it.x, it.y, it.z), qI, scl.set(it.rad, it.rad, it.rad));
        mesh.setMatrixAt(i, mat4);
        mesh.setColorAt(i, col.setRGB(it.tint[0], it.tint[1], it.tint[2]));
        spin.set([it.axis[0], it.axis[1], it.axis[2], it.spin], i * 4);
        shape.set([it.sq[0], it.sq[1], it.sq[2], it.phase], i * 4);
        drift.set(it.drift, i * 3);
      });
      geom.setAttribute("iSpin", new THREE.InstancedBufferAttribute(spin, 4));
      geom.setAttribute("iShape", new THREE.InstancedBufferAttribute(shape, 4));
      geom.setAttribute("iDrift", new THREE.InstancedBufferAttribute(drift, 3));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
    });
  }
  update(t) { this.uTime.value = t; }
  dispose() {
    this.group.removeFromParent();
    for (const m of this.meshes) { m.geometry.dispose(); m.material.dispose(); m.dispose?.(); }
    this.meshes.length = 0;
  }
}

// Where the decorative rocks go, deterministic from the world seed. boss = the world's boss target, planetAt = where the
// planet appears, gameplay = world.rocks ([id, x, y, z, size, ...]) to keep clear of, big = the big screen.
function planDecoRocks({ seed, boss, planetAt, gameplay, phone }) {
  const rnd = seeded((seed >>> 0) * 2654435761 + 12345);
  const unit = () => { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u); return new THREE.Vector3(Math.cos(th) * s, u, Math.sin(th) * s); };
  const bossPos = new THREE.Vector3(boss.x, boss.y, boss.z);
  const hull = (boss.radius || TUNING.boss.radius) * 1.25;
  const routeLen = planetAt.length();
  const routeDir = planetAt.clone().normalize();
  const up = Math.abs(routeDir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const p1 = new THREE.Vector3().crossVectors(routeDir, up).normalize();
  const p2 = new THREE.Vector3().crossVectors(routeDir, p1).normalize();
  const pos = new THREE.Vector3();
  // What every decorative rock keeps clear of: the v1.3 spawn disc (TUNING.spawnRadius across the line at the origin; the
  // server keeps its rocks 40 m off it) and, for the big ones, the straight spawn -> boss segment (lineDist).
  const spawnR = TUNING.spawnRadius ?? 130, spawnKeep = spawnR + (TUNING.spawnClear ?? 35) + 40;
  const onLine = new THREE.Vector3();
  const lineDist = () => pos.distanceTo(onLine.copy(routeDir).multiplyScalar(clamp(pos.dot(routeDir), 0, bossPos.length())));
  const tintOf = () => { const k = 0.88 + rnd() * 0.24, w = (rnd() - 0.5) * 0.14; return [k * (1 + w), k, k * (1 - w)]; };
  const clearOfGameplay = (rad) => {
    for (const r of gameplay) {
      const dx = pos.x - r[1], dy = pos.y - r[2], dz = pos.z - r[3], m = rad + r[4] + 3;
      if (dx * dx + dy * dy + dz * dz < m * m) return false;
    }
    return true;
  };
  // Small rocks (World look: the minute of flying to the boss must look rich, not empty): 55% crowd round the boss (denser
  // close in), 35% fill the spawn -> boss corridor (bigger, 1.5-11 m, out to 320 m from the line; they dissolve round the
  // camera, so they never block it), 10% thinly beyond the boss towards the planet. Phone 400 x 20 triangles (8k, 2 calls),
  // TV 900 x 80 (72k, 2 calls); the lowest quality tier drops the whole field (SpaceWorld.update).
  const small = [];
  const nSmall = phone ? 400 : 900;
  const bossLen = bossPos.length();
  for (let guard = 0; small.length < nSmall && guard < nSmall * 14; guard++) {
    const zone = rnd();
    let rad;
    if (zone < 0.55) {
      rad = 0.7 + Math.pow(rnd(), 2.4) * 5.5;
      const d = unit(); d.y *= 0.6; d.normalize();
      pos.copy(bossPos).addScaledVector(d, hull + 40 + Math.pow(rnd(), 1.7) * 420);
    } else {
      const corridor = zone < 0.9;
      rad = corridor ? 1.5 + Math.pow(rnd(), 1.8) * 9.5 : 0.7 + Math.pow(rnd(), 2.4) * 5.5;
      pos.copy(routeDir).multiplyScalar(corridor ? bossLen * (0.06 + rnd() * 0.9) : bossLen + (routeLen - bossLen) * rnd());
      const a = rnd() * Math.PI * 2, l = corridor ? 40 + Math.pow(rnd(), 0.8) * 280 : 30 + rnd() * 230;
      pos.addScaledVector(p1, Math.cos(a) * l).addScaledVector(p2, Math.sin(a) * l * 0.7);
    }
    if (pos.length() < spawnR + 20 + rad || pos.distanceTo(bossPos) < hull + 40 + rad || pos.distanceTo(planetAt) < PLANET_VISUAL_MAX + 20 + rad) continue;
    if (!clearOfGameplay(rad)) continue;
    const ax = unit();
    small.push({
      x: pos.x, y: pos.y, z: pos.z, rad, sq: [0.7 + rnd() * 0.6, 0.65 + rnd() * 0.6, 0.7 + rnd() * 0.6],
      axis: [ax.x, ax.y, ax.z], spin: (0.04 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1), phase: rnd() * 6.28,
      drift: [(rnd() - 0.5) * 12, (rnd() - 0.5) * 8, (rnd() - 0.5) * 12], tint: tintOf(),
    });
  }
  // Huge rocks beside the route (never on it).
  const huge = [];
  const nHuge = phone ? 8 : 14;
  for (let guard = 0; huge.length < nHuge && guard < 400; guard++) {
    const rad = 25 + Math.pow(rnd(), 1.3) * 55;
    const lateral = Math.max(120, rad * 1.5 + 70) + rnd() * 330;
    const a = rnd() * Math.PI * 2;
    pos.copy(routeDir).multiplyScalar(routeLen * (0.04 + rnd() * 0.95));
    pos.addScaledVector(p1, Math.cos(a) * lateral).addScaledVector(p2, Math.sin(a) * lateral * 0.75);
    if (pos.length() < rad * 1.5 + spawnKeep || lineDist() < rad * 1.5 + 60 || pos.distanceTo(bossPos) < hull + rad + 80 || pos.distanceTo(planetAt) < PLANET_VISUAL_MAX + rad + 30) continue;
    if (huge.some((h) => Math.hypot(h.x - pos.x, h.y - pos.y, h.z - pos.z) < h.rad + rad + 30)) continue;
    const ax = unit();
    huge.push({
      x: pos.x, y: pos.y, z: pos.z, rad, sq: [0.8 + rnd() * 0.45, 0.7 + rnd() * 0.45, 0.8 + rnd() * 0.45],
      axis: [ax.x, ax.y, ax.z], spin: (0.008 + rnd() * 0.03) * (rnd() < 0.5 ? -1 : 1), phase: rnd() * 6.28,
      drift: [(rnd() - 0.5) * 40, (rnd() - 0.5) * 24, (rnd() - 0.5) * 40], tint: tintOf(),
    });
  }
  // A-002's giant foreground rocks (createForegroundRocks records; diameter 60 / 90 / 120 m; TV 12, phone 6): two near the boss,
  // two (TV) or one (phone) near the planet, the rest framing the spawn -> boss corridor 150-450 m off the straight line (round
  // it on a golden-angle spiral: sideways, above, below), clear of the boss, the planet's visual, each other and the gameplay
  // rocks, so they frame the view and never block the path. v1.3 spawn disc (TUNING.spawnRadius across the line at the origin,
  // the server keeps rocks 40 m off it): every surface stays >= spawnRadius + spawnClear + 40 (~205 m) from the spawn centre and
  // >= 70 m from the straight spawn -> boss line, so nobody spawns inside one or flies straight into one. `rad` is 0.6 x the
  // diameter (a long rock's half-diagonal, not just half its longest span). Own seeded stream: the fields above stay put.
  const rf = seeded((seed >>> 0) * 40503 + 977);
  const fore = [];
  const nFore = phone ? 6 : 12, nBoss = 2, nPlanet = phone ? 1 : 2;
  const q = new THREE.Quaternion(), eul = new THREE.Euler();
  for (let guard = 0, k = 0; fore.length < nFore && guard < 600; guard++) {
    const i = fore.length, where = guard > 300 || i >= nBoss + nPlanet ? 2 : i < nBoss ? 0 : 1; // 0 boss, 1 planet, 2 corridor (a crowded spot gives up)
    const diameter = where === 2 ? [60, 90, 120][Math.floor(rf() * 3)] : where === 0 ? (rf() < 0.5 ? 90 : 120) : 120;
    const rad = diameter * 0.6, minLat = Math.max(150, rad + 100);
    const along = where === 0 ? bossLen + (rf() - 0.5) * 240 : where === 1 ? routeLen - 120 + rf() * 160 : bossLen * (0.1 + rf() * 0.75);
    const lateral = where === 1 ? PLANET_VISUAL_MAX + rad + 40 + rf() * 120 : minLat + rf() * (450 - minLat);
    const a = k++ * 2.39996 + rf() * 0.6;
    pos.copy(routeDir).multiplyScalar(along).addScaledVector(p1, Math.cos(a) * lateral).addScaledVector(p2, Math.sin(a) * lateral * 0.8);
    // (240 m round the boss's hull stay open: the dogfight happens there, within a bullet's range of ~200 m, and nothing collides
    // with these opaque rocks: a ship behind one would vanish from the chase camera)
    if (pos.length() < rad + spawnKeep || pos.distanceTo(bossPos) < hull + rad + 240 || pos.distanceTo(planetAt) < PLANET_VISUAL_MAX + rad + 30) continue;
    if (lineDist() < rad + 70) continue; // the straight spawn -> boss segment
    if (fore.some((f) => Math.hypot(f.position[0] - pos.x, f.position[1] - pos.y, f.position[2] - pos.z) < f.diameter * 0.6 + rad + 40)) continue;
    if (!clearOfGameplay(rad)) continue;
    q.setFromEuler(eul.set(rf() * 6.28, rf() * 6.28, rf() * 6.28));
    fore.push({ id: i + 1, diameter, position: [pos.x, pos.y, pos.z], quaternion: [q.x, q.y, q.z, q.w] });
  }
  return { small, huge, fore };
}
// ---------------------------------------------------------------------------------------------------------------
// World look: the mothership. The A-001 hull (scaled to 1.25 x the hit radius) gets a tilted ring of dark girders with a
// red light strip, radial spokes and a crown of spires, all merged into two meshes (dark metal + red light): two draw
// calls. Returns the geometries and the local positions of the blinking beacons.
const BOSS_HULL_K = 1.25;        // hull radius = this x TUNING.boss.radius
const BOSS_MODEL_RADIUS = 13;    // mean shell radius of the A-001 model in its own units
function makeBossStructures(hull, phone) {
  const dark = [], red = [];
  const bake = (list, geo, color) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute("uv");
    const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    list.push(g);
  };
  const rnd = seeded(2024);
  const tub = phone ? 36 : 56;
  const R = hull * 1.55, tube = hull * 0.085;
  const ringM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.32, 0, 0.2));
  const ringBeacons = [], tipBeacons = [];
  const tmp = new THREE.Vector3();

  // The ring: a diamond-section girder, 12 pylons, 8 spokes to the hull, three red light strips.
  bake(dark, new THREE.TorusGeometry(R, tube, 4, tub).rotateX(Math.PI / 2).applyMatrix4(ringM), 0x5a546f);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    bake(dark, new THREE.BoxGeometry(hull * 0.17, hull * 0.34, hull * 0.17).rotateY(-a).translate(Math.cos(a) * R, 0, Math.sin(a) * R).applyMatrix4(ringM), k % 2 ? 0x484260 : 0x645e7c);
    if (k % 2 === 0) bake(red, new THREE.BoxGeometry(hull * 0.06, hull * 0.06, hull * 0.06).translate(Math.cos(a) * (R + hull * 0.1), hull * 0.12, Math.sin(a) * (R + hull * 0.1)).applyMatrix4(ringM), 0xffffff);
  }
  const spokeLen = R - tube - hull * 0.88;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const mid = hull * 0.88 + spokeLen / 2;
    bake(dark, new THREE.BoxGeometry(hull * 0.07, hull * 0.07, spokeLen).rotateY(Math.PI / 2 - a).translate(Math.cos(a) * mid, 0, Math.sin(a) * mid).applyMatrix4(ringM), 0x4e4866);
  }
  const strip = (radius, y) => new THREE.TorusGeometry(radius, hull * 0.014, 4, phone ? 32 : 48).rotateX(Math.PI / 2).translate(0, y, 0).applyMatrix4(ringM);
  bake(red, strip(R + tube * 0.95, 0), 0xffffff);
  bake(red, strip(R, tube * 0.95), 0xffffff);
  bake(red, strip(R, -tube * 0.95), 0xffffff);
  const nBeacon = 24;
  for (let k = 0; k < nBeacon; k++) {
    const a = (k / nBeacon) * Math.PI * 2;
    ringBeacons.push(new THREE.Vector3(Math.cos(a) * (R + tube * 1.05), 0, Math.sin(a) * (R + tube * 1.05)).applyMatrix4(ringM));
  }

  // The crown: two polar spires and eight more at mid latitudes, chunky tapered towers with two collars, a red band and a red tip.
  const dirs = [new THREE.Vector3(0.1, 1, 0.05).normalize(), new THREE.Vector3(-0.08, -1, 0.1).normalize()];
  for (let i = 0; i < 8; i++) {
    const lon = (i / 8) * Math.PI * 2 + rnd() * 0.5, lat = (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.65);
    dirs.push(new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)));
  }
  const Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  const r0 = hull * 0.1, r1 = hull * 0.03; // radius at the base and at the tip
  let extent = R + tube;
  dirs.forEach((d, i) => {
    const len = hull * (i < 2 ? 0.85 + rnd() * 0.2 : 0.45 + rnd() * 0.4);
    const base = hull * 0.84;
    const along = (f, g, col, list = dark) => bake(list, g.applyQuaternion(q).translate(d.x * (base + len * f), d.y * (base + len * f), d.z * (base + len * f)), col);
    const rAt = (f) => r0 + (r1 - r0) * f;
    q.setFromUnitVectors(Y, d);
    along(0.5, new THREE.CylinderGeometry(r1, r0, len, 6, 1), i % 3 === 0 ? 0x645e7c : 0x484260);
    along(0.25, new THREE.CylinderGeometry(rAt(0.25) * 1.3, rAt(0.25) * 1.3, hull * 0.05, 6, 1), 0x70698a);
    along(0.58, new THREE.CylinderGeometry(rAt(0.58) * 1.3, rAt(0.58) * 1.3, hull * 0.05, 6, 1), 0x70698a);
    along(0.8, new THREE.CylinderGeometry(rAt(0.8) * 1.14, rAt(0.8) * 1.14, hull * 0.028, 6, 1), 0xffffff, red);
    along(1 + (hull * 0.04) / len, new THREE.ConeGeometry(hull * 0.04, hull * 0.09, 6), 0xffffff, red);
    tipBeacons.push(tmp.copy(d).multiplyScalar(base + len + hull * 0.1).clone());
    extent = Math.max(extent, base + len + hull * 0.1);
  });
  const geoDark = mergeGeometries(dark, false), geoRed = mergeGeometries(red, false);
  for (const g of dark.concat(red)) g.dispose();
  return { dark: geoDark, red: geoRed, ringBeacons, tipBeacons, extent, ringRadius: R };
}
// ---------------------------------------------------------------------------------------------------------------
// World look: the planet in view from the start. A-004 (Earth-like: oceans, clouds, night-side city lights, locked
// shield shimmer) at the position the server will use (boss + normalize(boss) * planet.offset), locked until the boss
// dies, then unlocked with a burst and the pulsing range ring. The visual is scaled up with the distance so it always
// covers at least ~6.9 degrees of the sky (visual radius = max(real radius, distance * PLANET_K)); inside ~330 m it is
// exactly the real size. If A-004 fails to load, the procedural planet plus a shimmer shell stands in.
const PLANET_K = 0.12; // ~6.9 degrees; the visual is the real size inside TUNING.planet.radius / PLANET_K = 333 m

// The phone's texture budget: A-004's two 2048 x 1024 maps are shared and cached by its module, so shrink them in place
// to 1024 x 512 (drawn into a canvas once) before the first use; same uniforms, same texture objects.
async function shrinkPlanetMaps(m) {
  const maps = await m.loadPlanetMaps();
  for (const t of [maps.color, maps.data]) {
    const img = t.image;
    if (!img || !(img.width > 1024)) continue;
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 512;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, 1024, 512);
    t.image = c;
    t.needsUpdate = true;
  }
}

// An image URL drawn into a w x h canvas texture (for the phone's 1024 px texture cap).
function loadShrunkTexture(url, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d");
        g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, 0, w, h);
        resolve(new THREE.CanvasTexture(c));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("image failed to load: " + url));
    img.src = url;
  });
}

// The pulsing landing-range ring: a camera-facing glowing circle that sits just outside the planet. Shown once unlocked.
function makeRangeRing(radius, landRange) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uR: { value: radius + landRange }, uIn: { value: 0 } },
    vertexShader: /* glsl */ `uniform float uR; varying vec2 vUv;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); mv.xy += position.xy * uR * 2.3; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uIn; varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.3;
        float pulse = 0.55 + 0.45 * sin(uTime * (3.0 + 4.0 * uIn));
        float e1 = (d - 1.0) * 45.0, e2 = (d - 1.0) * 10.0;
        float ring = exp(-e1 * e1) * (0.8 + uIn) + exp(-e2 * e2) * 0.25;
        gl_FragColor = vec4(mix(vec3(0.2,1.0,1.4), vec3(1.0,1.6,1.4), uIn) * ring * pulse * 1.6, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return {
    mesh,
    update(dt, t, near, worldRadius) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uR.value = worldRadius;
      mat.uniforms.uIn.value = damp(mat.uniforms.uIn.value, +near || 0, 4, dt);
    },
    dispose() { mesh.geometry.dispose(); mat.dispose(); },
  };
}

// The locked planet's faint blue shield bands, for the procedural fallback (A-004 draws its own).
function makeShieldShell(radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float bands = pow(0.5 + 0.5 * sin(vY / ${radius.toFixed(3)} * 52.0 + uTime * 1.4), 18.0);
        float a = (0.1 + bands * 0.55) * (0.25 + fres * 1.1);
        gl_FragColor = vec4(vec3(0.15, 0.5, 1.2) * a * 1.4, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.05, 40, 24), mat);
  mesh.renderOrder = 8;
  return { mesh, update(t) { mat.uniforms.uTime.value = t; }, dispose() { mesh.geometry.dispose(); mat.dispose(); } };
}

class PlanetLook {
  constructor(space) {
    this.space = space;
    this.phone = space.phone;
    this.root = new THREE.Group();
    this.root.visible = false;
    space.scene.add(this.root);
    this.R = TUNING.planet.radius;
    this.landRange = TUNING.planet.landRange;
    this.ring = makeRangeRing(this.R, this.landRange);
    this.ring.mesh.visible = false;
    this.root.add(this.ring.mesh);
    this.view = null;   // the A-004 planet
    this.proc = null;   // procedural fallback
    this.shell = null;  // the fallback's locked shimmer
    this.approach = new THREE.Vector3(0, 0, 1);
    this.sun = new THREE.Vector3(1, 0.5, 0.4).normalize();
    this.unlocked = false;
    this.key = null;
    this.gen = 0;
    this.born = 0;
    this.scale = 1;
  }
  // The planet for this round: at `pos`, built from `seed`, lit from `sun`, its landing region turned to face `approach`
  // (the unit vector from the planet back towards the spawn). A new seed rebuilds it; the same seed only moves it.
  place(pos, seed, sun, approach) {
    this.root.position.copy(pos);
    this.approach.copy(approach);
    this.sun.copy(sun);
    if (this.key === seed) { this.orient(); this.view?.setSunDirection([sun.x, sun.y, sun.z]); return; }
    this.key = seed;
    this.clear();
    const gen = ++this.gen;
    loadAsset("planet", { seed, radius: this.R, unlocked: this.unlocked, sun: [sun.x, sun.y, sun.z], phone: this.phone }).then((planet) => {
      if (gen !== this.gen) { planet?.dispose?.(); return; }
      this.born = performance.now();
      if (planet) {
        this.view = planet;
        planet.setUnlocked(this.unlocked); // the boss may have died while it loaded (a late joiner)
        this.root.add(planet.object3d);
        this.orient();
      } else {
        this.proc = makePlanet(this.R, this.landRange, this.phone, this.sun);
        this.root.add(this.proc.group);
        this.shell = makeShieldShell(this.R);
        this.shell.mesh.visible = !this.unlocked;
        this.root.add(this.shell.mesh);
      }
      this.root.visible = true;
    });
  }
  orient() {
    if (!this.view) return;
    this.view.object3d.quaternion.setFromUnitVectors(this.view.landingDirection, this.approach);
    this.view.update(0);
  }
  setUnlocked(on) {
    this.unlocked = !!on;
    this.ring.mesh.visible = this.unlocked;
    this.view?.setUnlocked(this.unlocked);
    if (this.shell) this.shell.mesh.visible = !this.unlocked;
  }
  get ready() { return !!(this.view || this.proc); }
  // proximity 0..1: how close the camera's subject is (speeds up the ring pulse).
  update(dt, t, camPos, proximity) {
    if (!this.ready) return;
    const d = camPos.distanceTo(this.root.position);
    const age = Math.min(1, (performance.now() - this.born) / 800);
    this.scale = (Math.max(this.R, d * PLANET_K) / this.R) * Math.max(0.001, 1 - Math.pow(1 - age, 3));
    this.root.scale.setScalar(this.scale);
    if (this.view) { this.view.setProximity(proximity); this.view.update(dt); }
    else { this.proc.update(dt, t); this.shell.update(t); }
    this.ring.update(dt, t, proximity, (this.R + this.landRange) * this.scale);
  }
  clear() {
    if (this.view) { this.root.remove(this.view.object3d); this.view.dispose(); this.view = null; }
    if (this.proc) { this.root.remove(this.proc.group); this.proc.dispose(); this.proc = null; }
    if (this.shell) { this.root.remove(this.shell.mesh); this.shell.dispose(); this.shell = null; }
    this.root.visible = false;
  }
  dispose() {
    this.gen++;
    this.clear();
    this.ring.dispose();
    this.root.removeFromParent();
  }
}
// ---------------------------------------------------------------------------------------------------------------
// World look: the island's chests. ALL of them live in ONE instanced mesh (one draw call; the gold light beams over the
// closed chests in assists are one more): every instance holds the parts of both kinds and its state decides which show.
//   kind "buried": a sand mound with a big X on a dug-over patch; digging shrinks the mound and the chest rises out of it.
//   kind "rock":   a big chunky boulder of loose plates with glowing gold seams (the chest is locked inside); drilling
//                  brightens the seams and cracks the plates apart; when it opens the plates fly off and the chest pops up.
//   Then the chest waits (closed, gold shimmer, lid rattling); collected: the lid swings open on a glowing pile of gold.
// Part ids (attribute aPart): 0 hump, 1 boulder, 2 chest body, 3 chest lid, 4 X mark, 5 dug-over patch.
const CHEST = { w: 1.6, h: 0.74, d: 1.02 }; // chest body size (m); the lid's hinge is the back top edge
const BOULDER_Y = 0.85;                       // boulder centre height above the ground

function chestPart(geo, id, colorFn, glowFn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3), glow = new Float32Array(n), cen = new Float32Array(n * 3), part = new Float32Array(n).fill(id);
  const c = new THREE.Color();
  for (let f = 0; f < n; f += 3) {
    const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3, cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
    colorFn(c, f / 3, cx, cy, cz);
    const gl = glowFn ? glowFn(f / 3, cx, cy, cz) : 0;
    for (let k = 0; k < 3; k++) {
      const v = f + k;
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      glow[v] = gl;
      cen[v * 3] = cx; cen[v * 3 + 1] = cy; cen[v * 3 + 2] = cz;
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aPart", new THREE.BufferAttribute(part, 1));
  g.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1));
  g.setAttribute("aCentre", new THREE.BufferAttribute(cen, 3));
  return g;
}
const hash1 = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function buildChestGeometry() {
  const parts = [];
  const { w, h, d } = CHEST;
  const wood = new THREE.Color(0xc4762c), woodDark = new THREE.Color(0x7d4119), gold = new THREE.Color(0xffc93c), inside = new THREE.Color(0x3a1c0c);
  const sand = new THREE.Color(0xe9c27a), sandDark = new THREE.Color(0xb98a4c), mark = new THREE.Color(0xc2361a);
  const flat = (col, jit = 0.14) => (c, i) => c.copy(col).multiplyScalar(1 - jit / 2 + hash1(i) * jit);
  const half = (r, len, theta) => new THREE.CylinderGeometry(r, r, len, 10, 1, false, 0, theta).rotateZ(Math.PI / 2);

  // Chest body: wood box, plank grooves, two gold straps, gold base trim, a lock, and a glowing pile of coins.
  parts.push(chestPart(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), 2, (c, i, x, y) => (y > h - 0.01 ? c.copy(inside) : c.copy(wood).multiplyScalar(0.86 + hash1(i) * 0.26))));
  for (const y of [h * 0.3, h * 0.62]) parts.push(chestPart(new THREE.BoxGeometry(w + 0.02, 0.035, d + 0.02).translate(0, y, 0), 2, flat(woodDark, 0.1)));
  for (const x of [-w * 0.33, w * 0.33]) parts.push(chestPart(new THREE.BoxGeometry(0.16, h + 0.02, d + 0.07).translate(x, h / 2, 0), 2, flat(gold, 0.1), () => 0.3));
  parts.push(chestPart(new THREE.BoxGeometry(w + 0.08, 0.1, d + 0.08).translate(0, 0.05, 0), 2, flat(gold, 0.1), () => 0.25));
  parts.push(chestPart(new THREE.BoxGeometry(0.24, 0.28, 0.08).translate(0, h * 0.72, d / 2 + 0.04), 2, flat(gold, 0.1), () => 0.55));
  parts.push(chestPart(new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(w * 0.72, 0.5, d * 0.72).translate(0, h - 0.02, 0), 2, (c, i) => c.copy(gold).multiplyScalar(0.8 + hash1(i) * 0.5), () => 1));
  // Lid: a D-shaped barrel (round side up), wood with two gold straps; hinged at the back top edge.
  parts.push(chestPart(half(d / 2, w, Math.PI).translate(0, h, 0), 3, (c, i, x, y) => (Math.abs(x) > w / 2 - 0.02 ? c.copy(woodDark) : c.copy(wood).multiplyScalar(0.92 + (y - h) * 0.5 + hash1(i) * 0.16))));
  for (const x of [-w * 0.33, w * 0.33]) parts.push(chestPart(half(d / 2 + 0.035, 0.16, Math.PI).translate(x, h, 0), 3, flat(gold, 0.1), () => 0.3));

  // Sand mound: a low hump, a dug-over patch, and a big red-brown X lying across both.
  parts.push(chestPart(new THREE.SphereGeometry(1.15, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1), 0, (c, i, x, y) => c.copy(sand).multiplyScalar(0.9 + y * 0.35 + hash1(i) * 0.14)));
  parts.push(chestPart(new THREE.CylinderGeometry(2.3, 2.5, 0.12, 14).translate(0, 0.04, 0), 5, flat(sandDark, 0.16)));
  for (const a of [Math.PI / 4, -Math.PI / 4]) parts.push(chestPart(new THREE.BoxGeometry(5.2, 0.17, 0.6).rotateY(a).translate(0, 0.17, 0), 4, flat(mark, 0.18), () => 0.35));

  // Boulder: 80 loose plates (an icosphere pulled into a rock: lumps, a few cutting planes and a little jitter, every face
  // shrunk towards its centre by a different amount and pushed out) over a gold core whose glow shows through the gaps;
  // plates below the ground are left out.
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const rnd = seeded(777);
  const waves = [], cuts = [];
  for (let k = 0; k < 5; k++) waves.push({ fx: (rnd() - 0.5) * 6, fy: (rnd() - 0.5) * 6, fz: (rnd() - 0.5) * 6, ph: rnd() * 6.28, a: 0.07 + rnd() * 0.09 });
  for (let k = 0; k < 6; k++) { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sq = Math.sqrt(1 - u * u); cuts.push({ x: Math.cos(th) * sq, y: u, z: Math.sin(th) * sq, c: 0.8 + rnd() * 0.12 }); }
  const S = new THREE.Vector3(1.95, 1.5, 1.9), centre = new THREE.Vector3(0, BOULDER_Y, 0);
  const ip = ico.attributes.position, tmp = new THREE.Vector3();
  const lump = (v) => {
    let r = 1;
    for (const q of waves) r += q.a * Math.sin(v.x * q.fx + v.y * q.fy + v.z * q.fz + q.ph);
    for (const q of cuts) { const d = v.x * q.x + v.y * q.y + v.z * q.z; if (d > 0.05) r = Math.min(r, q.c / d); }
    const j = hash1(Math.round(v.x * 997) * 12.9898 + Math.round(v.y * 997) * 78.233 + Math.round(v.z * 997) * 37.719); // the same for every copy of a corner
    return Math.max(0.7, Math.min(1.3, r)) * (0.93 + j * 0.14);
  };
  const out = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), M = new THREE.Vector3();
  for (let f = 0; f < ip.count; f += 3) {
    const vs = [A, B, C];
    for (let k = 0; k < 3; k++) {
      tmp.fromBufferAttribute(ip, f + k).normalize();
      vs[k].copy(tmp).multiplyScalar(lump(tmp)).multiply(S).add(centre);
    }
    M.copy(A).add(B).add(C).divideScalar(3);
    if (M.y < 0.05) continue;
    N.crossVectors(B.clone().sub(A), C.clone().sub(A)).normalize();
    if (N.dot(M.clone().sub(centre)) < 0) N.negate();
    const lift = 0.08 + rnd() * 0.14, shrink = 0.84 + rnd() * 0.08;
    for (const v of vs) out.push(M.x + (v.x - M.x) * shrink + N.x * lift, M.y + (v.y - M.y) * shrink + N.y * lift, M.z + (v.z - M.z) * shrink + N.z * lift);
  }
  const plates = new THREE.BufferGeometry();
  plates.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  const stone = new THREE.Color(0xb39c84), stoneCool = new THREE.Color(0x978fa0), stoneDark = new THREE.Color(0x8a7762);
  parts.push(chestPart(plates, 1, (c, i, x, y) => {
    const h = hash1(i * 3.7);
    c.copy(h < 0.22 ? stoneCool : h < 0.4 ? stoneDark : stone).multiplyScalar((0.8 + hash1(i) * 0.4) * (0.85 + Math.min(1, y / 2.5) * 0.3));
  }));
  const core = new THREE.IcosahedronGeometry(1, 1).scale(S.x * 0.72, S.y * 0.72, S.z * 0.72).translate(0, BOULDER_Y, 0);
  parts.push(chestPart(core, 1, (c, i) => c.set(0xffc23a).multiplyScalar(0.8 + hash1(i * 1.7) * 0.4), (i) => 0.75 + hash1(i * 2.3) * 0.5));

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

const CHEST_VERT_PARS = /* glsl */ `
  attribute float aPart; attribute float aGlow; attribute vec3 aCentre;
  attribute vec4 iState; attribute vec4 iExtra;
  uniform float uTime;
  varying float vGlow;`;
// iState: x kind (0 buried, 1 rock), y dug 0..1, z rock released 0..1 (the shatter), w lid open 0..1.
// iExtra: x drill intensity 0..1, y waiting for pick-up (0/1), z random phase.
const CHEST_VERT_BODY = /* glsl */ `
  {
    float cKind = iState.x, cDug = iState.y, cRel = iState.z, cOpen = iState.w;
    float cDrill = iExtra.x, cAvail = iExtra.y, cPh = iExtra.z;
    float cPart = aPart;
    float cVis = 1.0, cGlow = 0.0;
    if (cPart < 0.5) {
      cVis = (cKind < 0.5 && cDug < 0.995) ? 1.0 : 0.0;
      transformed.xz *= 1.0 - 0.5 * cDug;
      transformed.y *= 1.0 - 0.8 * cDug;
    } else if (cPart < 1.5) {
      cVis = (cKind > 0.5 && cRel < 0.995) ? 1.0 : 0.0;
      vec3 cc = aCentre;
      vec3 outd = cc - vec3(0.0, ${BOULDER_Y.toFixed(3)}, 0.0);
      transformed += outd * (cDug * 0.09);
      transformed = cc + outd * (cRel * 2.4) + (transformed - cc) * (1.0 - cRel * 0.9);
      transformed.y -= cRel * cRel * 1.8;
      transformed.xz += vec2(sin(uTime * 61.0 + cPh), cos(uTime * 47.0 + cPh)) * (0.025 * cDrill);
      cGlow = aGlow * (0.55 + 0.25 * sin(uTime * 2.3 + cPh) + cDug * 0.7 + cDrill * 1.5);
    } else if (cPart < 3.5) {
      cVis = cKind < 0.5 ? step(0.002, cDug) : step(0.002, cRel);
      float cUp = cKind < 0.5 ? smoothstep(0.0, 1.0, cDug) : 1.0;
      float cHop = cKind > 0.5 ? sin(clamp(cRel / 0.6, 0.0, 1.0) * 3.14159) * 1.1 : 0.0;
      float cPop = cKind > 0.5 ? mix(0.45, 1.0, smoothstep(0.0, 0.3, cRel)) : 1.0;
      if (cPart > 2.5) {
        float cRattle = cAvail > 0.5 ? (-0.06 - 0.05 * sin(uTime * 9.0 + cPh)) * (1.0 - cOpen) : 0.0;
        float ca = -1.95 * cOpen + cRattle;
        float cs = sin(ca), cc2 = cos(ca);
        vec2 dd = vec2(transformed.y - ${CHEST.h.toFixed(3)}, transformed.z + ${(CHEST.d / 2).toFixed(3)});
        transformed.y = ${CHEST.h.toFixed(3)} + dd.x * cc2 - dd.y * cs;
        transformed.z = -${(CHEST.d / 2).toFixed(3)} + dd.x * cs + dd.y * cc2;
      }
      transformed *= cPop;
      transformed.y += (cUp - 1.0) * 1.0 + cHop;
      if (aGlow > 0.9) cGlow = 0.12 + cOpen * 1.7;
      else cGlow = aGlow * (0.3 + cAvail * (0.55 + 0.45 * sin(uTime * 5.0 + cPh)));
    } else if (cPart < 4.5) {
      cVis = (cKind < 0.5 && cDug < 0.02) ? 1.0 : 0.0;
      cGlow = aGlow * (0.7 + 0.6 * sin(uTime * 3.0 + cPh));
    } else {
      cVis = cKind < 0.5 ? 1.0 : 0.0;
    }
    if (cVis < 0.5) transformed *= 0.0;
    vGlow = cGlow;
  }`;
function chestMaterial(uTime) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.08, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + CHEST_VERT_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + CHEST_VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.64, 0.14) * vGlow;");
  };
  m.customProgramCacheKey = () => "world_chest_v1";
  return m;
}

const GOLD = new THREE.Color(0xffc94a);
const STONE_DUST = new THREE.Color(0xb7a590);
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _p3 = new THREE.Vector3(), _s3 = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _n3 = new THREE.Vector3();
class ChestField {
  constructor(isl) {
    this.isl = isl;
    this.records = new Map(); // id -> { data: { ...chest, y }, i, dug, rel, open, drill, phase, lastDug } (IslandWorld.chests)
    this.cap = 32;
    this.assists = false;
    this.uTime = { value: 0 };
    const geo = buildChestGeometry();
    this.iState = new Float32Array(this.cap * 4);
    this.iExtra = new Float32Array(this.cap * 4);
    this.aState = new THREE.InstancedBufferAttribute(this.iState, 4).setUsage(THREE.DynamicDrawUsage);
    this.aExtra = new THREE.InstancedBufferAttribute(this.iExtra, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iState", this.aState);
    geo.setAttribute("iExtra", this.aExtra);
    this.mesh = new THREE.InstancedMesh(geo, chestMaterial(this.uTime), this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    isl.scene.add(this.mesh);
    this.beams = new StreakBatch(48);
    isl.scene.add(this.beams.mesh);
  }
  // world.chests: [{ id, kind, x, z, buried, dug, open, by }] in island coordinates.
  sync(list, assists) {
    const isl = this.isl, H = isl.height;
    if (!H) return;
    this.assists = !!assists;
    const seen = new Set();
    let i = 0;
    for (const c of list) {
      if (i >= this.cap) break;
      seen.add(c.id);
      const y = H(c.x, c.z);
      let r = this.records.get(c.id);
      if (!r || r.data.kind !== c.kind || Math.abs(r.data.x - c.x) > 0.5 || Math.abs(r.data.z - c.z) > 0.5) {
        // First sight (or a new round): start from the present state, without any effects.
        r = { data: null, i, dug: c.buried ? c.dug || 0 : 1, rel: c.kind === "rock" && !c.buried ? 1 : 0, open: c.open ? 1 : 0, drill: 0, phase: Math.random() * 6.28, lastDug: c.dug || 0, dugAt: -9 };
        this.records.set(c.id, r);
        this.place(r, c, y);
      }
      const prev = r.data;
      if (prev) {
        const p = _p3.set(c.x, y, c.z);
        if (c.kind === "rock" && prev.buried && !c.buried) this.shatter(p);
        // the gold of an opened chest: with A-010 loaded the server's `treasure` fx of that same pickup draws it (IslandWorld.fx, at
        // the lid's height); a second burst here would only drain the particle pool. This one is the fallback without A-010.
        if (c.open && !prev.open && !isl.efx?.ok) {
          isl.particles.burst(p.clone().setY(y + 1), GOLD, 70, 12, 1.5, 0.55, 0.08, { boost: 2.4, grav: 6, drag: 0.8 });
          isl.rings.spawn(p.clone().setY(y + 1), 0xffd34d, 10, 1.2, true);
        }
      }
      r.data = { ...c, y };
      if (r.i !== i) { r.i = i; this.place(r, c, y); }
      i++;
    }
    for (const id of [...this.records.keys()]) if (!seen.has(id)) this.records.delete(id);
    this.mesh.count = i;
  }
  // Instance matrix: on the terrain, tilted with the slope (up to ~25 degrees), a random yaw per chest.
  place(r, c, y) {
    const H = this.isl.height;
    let sx = (H(c.x + 1, c.z) - H(c.x - 1, c.z)) / 2, sz = (H(c.x, c.z + 1) - H(c.x, c.z - 1)) / 2;
    const sl = Math.hypot(sx, sz);
    if (sl > 0.45) { sx *= 0.45 / sl; sz *= 0.45 / sl; }
    _qa.setFromUnitVectors(_up, _n3.set(-sx, 1, -sz).normalize());
    _qb.setFromAxisAngle(_up, hash1(c.id * 5.31) * Math.PI * 2);
    _m4.compose(_p3.set(c.x, y, c.z), _qa.multiply(_qb), _s3);
    this.mesh.setMatrixAt(r.i, _m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  // The boulder opens: stone chips, gold sparks, a ring.
  shatter(p) {
    const P = this.isl.particles, y = p.y;
    P.burst(_n3.set(p.x, y + 1.2, p.z), STONE_DUST, 46, 9, 1.3, 0.9, 0.2, { boost: 1.1, grav: 12, drag: 0.6, spread: 1.6 });
    P.burst(_n3.set(p.x, y + 1.2, p.z), GOLD, 60, 11, 1.1, 0.45, 0.05, { boost: 2.6, grav: 6, drag: 0.8, spread: 1.2 });
    this.isl.rings.spawn(_n3.set(p.x, y + 0.3, p.z), 0xffc94a, 9, 1.0, true);
    worldSound.at("explosion", p.x, y, p.z, "planet", { v: 0.8, ref: 60, pitch: 0.8 });
  }
  update(dt, t, snap) {
    const isl = this.isl, glow = isl.glow, P = isl.particles;
    this.uTime.value = t;
    this.beams.begin();
    // Who is drilling a rock chest right now: an explorer with flags.drilling within ~4.5 m, or the chest's dug rising.
    for (const r of this.records.values()) r.drillNow = 0;
    for (const p of snap.players) {
      if (p.mode !== "planet" || !p.flags.drilling) continue;
      let best = null, bd = 4.5;
      for (const r of this.records.values()) {
        const c = r.data;
        if (c.kind !== "rock" || !c.buried) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bd) { bd = d; best = r; }
      }
      if (best) best.drillNow = 1;
    }
    for (const r of this.records.values()) {
      const c = r.data;
      const i = r.i;
      if (i < 0 || i >= this.cap) continue;
      const rock = c.kind === "rock";
      if ((c.dug || 0) > r.lastDug + 0.001) r.dugAt = t;
      r.lastDug = c.dug || 0;
      if (rock && c.buried && t - r.dugAt < 0.5) r.drillNow = 1;
      r.drill = damp(r.drill, r.drillNow, 9, dt);
      r.dug = damp(r.dug, c.buried ? c.dug || 0 : 1, 8, dt);
      r.rel = rock ? Math.min(1, Math.max(0, r.rel + (c.buried ? -4 : 1.25) * dt)) : 0;
      r.open = damp(r.open, c.open ? 1 : 0, 5, dt);
      const avail = !c.buried && !c.open ? 1 : 0;
      const s4 = i * 4;
      this.iState[s4] = rock ? 1 : 0; this.iState[s4 + 1] = r.dug; this.iState[s4 + 2] = r.rel; this.iState[s4 + 3] = r.open;
      this.iExtra[s4] = r.drill; this.iExtra[s4 + 1] = avail; this.iExtra[s4 + 2] = r.phase; this.iExtra[s4 + 3] = 0;
      const x = c.x, y = c.y, z = c.z;
      const pulse = 0.75 + 0.25 * Math.sin(t * 2.5 + r.phase);
      if (rock && c.buried) {
        // The locked boulder: a gold throb that grows with the drilling, sparks flying off the working spot.
        glow.add(x, y + 2.6, z, 3.4 + r.drill * 2.4, 1.5 + r.drill, 0.9 + r.drill * 0.4, 0.18, (0.14 + 0.1 * pulse) + r.drill * 0.22); // centred high: a sprite is cut by the ground where it dips below it
        if (r.drill > 0.4 && Math.random() < dt * 55) {
          const a = Math.random() * Math.PI * 2;
          P.emit(x + Math.cos(a) * 1.9, y + 0.6 + Math.random() * 1.6, z + Math.sin(a) * 1.9, Math.cos(a) * (2 + Math.random() * 4), 2 + Math.random() * 4, Math.sin(a) * (2 + Math.random() * 4), 0.55, 0.28, 0.04, GOLD, 2.6, 0.8, 9);
        }
      } else if (c.buried) {
        const tw = Math.max(0, Math.sin(t * 3 + c.x)) ** 8;
        glow.add(x + 0.5, y + 0.5, z, 2.4 + tw * 4.5, 3 * tw + 0.45, 2.4 * tw + 0.35, 0.8 * tw + 0.1, 1);
      } else if (!c.open) {
        glow.add(x, y + 2.2, z, 4.5 * pulse, 1.7, 1.2, 0.3, 0.55);
      } else {
        glow.add(x, y + 2.8, z, 6.5 * pulse, 1.6, 1.15, 0.3, 0.6);
        glow.add(x, y + 5.5, z, 6, 1.2, 0.9, 0.3, 0.3);
      }
      // Assists: every closed chest gets a tall gold beam, visible from far.
      if (this.assists && !c.open) {
        const d = isl.camPos ? Math.hypot(x - isl.camPos.x, y - isl.camPos.y, z - isl.camPos.z) : 100;
        this.beams.add(x, y + 0.3, z, 0, -1, 0, Math.max(70, d * 0.4), Math.max(3.4, d * 0.022), 1.0, 0.72, 0.2, 0.75 + 0.25 * pulse, 1);
      }
    }
    this.aState.needsUpdate = this.aExtra.needsUpdate = true;
    this.beams.end();
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.beams.mesh.removeFromParent();
    this.beams.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Island scene (mode "planet"): terrain from Terrain.height, cheap animated water, sky, palms, rocks, chests, explorers.
const SUN_DIR = v3(-0.55, 0.32, -0.62).normalize(); // warm late-afternoon sun
// The island sky on both screens: a saturated cartoon gradient dome with a soft sun (one cheap draw). The three.js Sky add-on
// gave the big screen a white horizon that the bloom spread into a milky veil over the whole island.
function islandSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `uniform vec3 uSun; varying vec3 vD;
      void main(){
        float y = clamp(vD.y, -0.1, 1.0);
        vec3 col = mix(vec3(1.0,0.8,0.58), vec3(0.12,0.42,0.96), pow(max(y,0.0), 0.5));
        float s = max(dot(normalize(vD), uSun), 0.0);
        col += vec3(1.0,0.75,0.45) * (pow(s, 600.0) * 6.0 + pow(s, 12.0) * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

function palmGeometry() {
  const trunk = new THREE.CylinderGeometry(0.17, 0.32, 6.5, 5, 5, true).toNonIndexed();
  trunk.translate(0, 3.25, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i) / 6.5; tp.setX(i, tp.getX(i) + y * y * 1.3); }
  const parts = [[trunk, new THREE.Color(0x6b4a2e)]];
  for (let k = 0; k < 7; k++) {
    const leaf = new THREE.PlaneGeometry(3.6, 0.9, 4, 1).toNonIndexed();
    const lp = leaf.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const l = (lp.getX(i) + 1.8) / 3.6; // 0 at the crown
      lp.setXYZ(i, l * 3.4, -l * l * 1.7 + 0.25 * l, lp.getY(i) * (1 - l * 0.7));
    }
    leaf.rotateY((k / 7) * Math.PI * 2 + k * 0.3);
    leaf.translate(1.3, 6.4, 0);
    parts.push([leaf, new THREE.Color(k % 2 ? 0x2f8f2a : 0x3fae35)]);
  }
  const geos = parts.map(([g, c]) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const m = mergeGeometries(geos, false);
  m.computeVertexNormals();
  return m;
}

class IslandWorld {
  constructor(renderer, { phone, big }) {
    this.phone = phone;
    this.big = big;
    const scene = (this.scene = new THREE.Scene());
    const horizon = new THREE.Color(0xf3c9a0);
    scene.fog = new THREE.Fog(horizon, 160, phone ? 650 : 900);
    scene.background = horizon;
    scene.add(islandSky());
    // Bright, toon-like light: a strong sky fill with a warm sand bounce, a warm key, and a cool saturated rim from the other
    // side so explorers and chests pop.
    scene.add(new THREE.HemisphereLight(0xb4d8ff, 0xe2a45e, 1.85));
    const sun = new THREE.DirectionalLight(0xffd9a8, 3.2);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    const rim = new THREE.DirectionalLight(0x6fc8ff, 1.1);
    rim.position.set(0.55, 0.3, 0.62).multiplyScalar(100);
    scene.add(sun, rim);
    this.glow = new BillboardBatch(288, { renderOrder: 14 });
    this.particles = new Particles(phone ? 600 : 1200);
    this.rings = new RingPool(6);
    scene.add(this.glow.mesh, this.particles.mesh, this.rings.group);
    this.mischief = new MischiefLayer(this, "planet"); // mines, decoys, emp / ink / tractor looks on the island
    this.explorers = new Map();
    this.chests = new Map();
    this.seed = null;
    // ?island=procedural keeps the procedural island (fallback; the A-005 kit is the default on both screens).
    this.noKit = new URLSearchParams(location.search).get("island") === "procedural";
    this.tmp = v3();
    // Island PvP: laser streaks (bullets with mode 1), a spawn-shield bubble per explorer.
    this.bullets = makeBulletMesh(1.8, 0.09, 128);
    this.dummy = new THREE.Object3D();
    scene.add(this.bullets);
    this.shieldGeo = new THREE.SphereGeometry(1.25, 20, 12);
    this.shieldMat = SHIELD_MAT();
    // Parked ships on the landing pad (world.island.parked), keyed by player.
    this.parked = new Map();
    this.parkedList = [];
    this.parkYaw = 0;
    // The chests (World look): every chest in ONE instanced mesh (buried mound with a big X, rock boulder with gold seams, the
    // chest itself) plus the assist beams. `chests` stays the id -> { data } map the explorers read.
    this.camPos = v3();
    this.chestField = new ChestField(this);
    this.chests = this.chestField.records;
    this.efx = new WorldFx(this, "planet"); // A-010 effects + hex shields (null-safe until it loads; fx() keeps the ad hoc bursts meanwhile)
  }

  // A-005 kit over the procedural island (which stays as the fallback and while the kit loads).
  loadKit(w) {
    const seed = this.seed;
    if (this.kitSeed === seed || !Number.isInteger(seed) || this.noKit) return;
    this.kitSeed = seed;
    const L = w.island?.landing || { x: 0, z: 0 };
    const clearings = [{ x: L.x, z: L.z, radius: 16 }, ...(w.chests || []).map((c) => ({ x: c.x, z: c.z, radius: 4 }))];
    loadAsset("island", { seed, clearings, phone: this.phone }).then((kit) => {
      if (!kit) return;
      if (this.seed !== seed) return kit.dispose();
      this.kit?.object3d.removeFromParent();
      this.kit?.dispose();
      this.kit = kit;
      this.scene.add(kit.object3d);
      this.terrain.visible = false;
      this.props?.forEach((m) => (m.visible = false));
    });
  }

  // Bay of a player on the pad: same formula as world.js (slot = index in the tick's player list). The parked ship's own
  // x, z (world.island.parked) wins where it is known.
  bay(slot) {
    const L = this.landing || { x: 0, z: 0 };
    return { x: L.x + (slot % 5) * 5 - 10, z: L.z + Math.floor(slot / 5) * 5 };
  }
  groundAt(x, z) { return this.height ? Math.max(0, this.height(x, z)) : 0; }
  // The buried chest within r metres of (x, z) that is not dug out yet ("X marks the spot": the explorer kneels), or null.
  buriedChestNear(x, z, r) {
    for (const v of this.chests.values()) {
      const c = v.data;
      if (c && c.buried && !c.open && (c.dug || 0) < 1 && Math.hypot(c.x - x, c.z - z) < r) return c;
    }
    return null;
  }

  // A parked ship (its drawing, else A-009 / a placeholder) in the player's colour, nose pointing the way take-off leaves.
  makeParked(player, color) {
    const v = new ParkedShip(this, player, color);
    this.parked.set(player, v);
    return v;
  }
  disposeParked(player) {
    const v = this.parked.get(player);
    if (!v) return;
    v.dispose();
    this.parked.delete(player);
  }

  build(seed) {
    if (seed === this.seed) return;
    this.seed = seed;
    if (this.kit) { this.kit.object3d.removeFromParent(); this.kit.dispose(); this.kit = null; }
    this.terrain?.removeFromParent();
    this.terrain?.geometry.dispose();
    this.water?.removeFromParent();
    this.props?.forEach((m) => { m.removeFromParent(); m.geometry.dispose(); });
    const size = Terrain.ISLAND_SIZE * 1.35;
    const seg = this.phone ? 110 : 170;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const H = (x, z) => Terrain.height(x, z, seed);
    const c = new THREE.Color();
    const sand = new THREE.Color(0xf0dca0), wet = new THREE.Color(0xb89a68), grass = new THREE.Color(0x6cb543), grass2 = new THREE.Color(0x47923a), rock = new THREE.Color(0x8a7a6a), peak = new THREE.Color(0xb7aa9a);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = H(x, z);
      pos.setY(i, h);
      const slope = Math.hypot(H(x + 1.5, z) - h, H(x, z + 1.5) - h) / 1.5;
      const n = Terrain.hash(Math.floor(x / 3), Math.floor(z / 3), seed);
      if (h < 0.4) c.copy(wet).lerp(sand, clamp((h + 2) / 2.4, 0, 1));
      else if (h < 2.4) c.copy(sand);
      else c.copy(grass).lerp(grass2, n * 0.7).lerp(sand, clamp((3.4 - h), 0, 1));
      if (slope > 0.55) c.lerp(rock, clamp((slope - 0.55) * 3, 0, 1));
      if (h > 26) c.lerp(peak, clamp((h - 26) / 8, 0, 1));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(this.terrain);
    // Height texture for shallow water and shore foam.
    const N = 128, data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) - 0.5) * size, z = (j / (N - 1) - 0.5) * size;
      const v = clamp((H(x, z) + 8) / 48, 0, 1) * 255;
      data.set([v, v, v, 255], (j * N + i) * 4);
    }
    const htex = new THREE.DataTexture(data, N, N);
    htex.magFilter = htex.minFilter = THREE.LinearFilter;
    htex.needsUpdate = true;
    const fog = this.scene.fog;
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uH: { value: htex }, uSize: { value: size }, uSun: { value: SUN_DIR }, uSky: { value: new THREE.Color(0x9cc7ea) }, uFog: { value: fog.color }, uFogNear: { value: fog.near }, uFogFar: { value: fog.far } },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform sampler2D uH; uniform float uSize; uniform vec3 uSun; uniform vec3 uSky; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; varying vec3 vW;
        void main(){
          vec2 uv = vW.xz / uSize + 0.5;
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          float h = mix(-8.0, texture2D(uH, uv).r * 48.0 - 8.0, inside);
          float depth = clamp(-h / 7.0, 0.0, 1.0);
          vec2 p = vW.xz; float t = uTime;
          vec3 n = normalize(vec3(0.10*cos(p.x*0.21+t*1.1)+0.07*cos(p.y*0.33+t*1.4)+0.04*cos((p.x+p.y)*0.7+t*2.1), 1.0,
                                  0.10*cos(p.y*0.19+t*0.9)+0.07*cos(p.x*0.29-t*1.3)+0.04*cos((p.x-p.y)*0.8+t*1.8)));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
          vec3 col = mix(vec3(0.16,0.82,0.78), vec3(0.02,0.25,0.48), smoothstep(0.0, 1.0, depth));
          col = mix(col, uSky, fres * 0.7);
          col += vec3(1.0,0.85,0.6) * pow(max(dot(reflect(-uSun, n), V), 0.0), 160.0) * 3.0;
          float foam = (1.0 - smoothstep(0.0, 0.07, depth)) * (0.55 + 0.45 * sin(t * 1.8 + length(vW.xz) * 0.9));
          col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.75);
          float a = mix(0.5, 0.96, smoothstep(0.0, 0.45, depth));
          float f = smoothstep(uFogNear, uFogFar, length(cameraPosition - vW));
          gl_FragColor = vec4(mix(col, uFog, f), mix(a, 1.0, f));
        }`,
      transparent: true, depthWrite: false,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), this.waterMat);
    this.water.position.y = 0.05;
    this.water.renderOrder = 2;
    this.scene.add(this.water);
    // Props: palms and beach rocks, instanced (one draw each), deterministic from the seed.
    const rnd = seeded(seed * 31 + 5);
    const palms = [], rocks = [];
    const want = this.phone ? 110 : 230;
    for (let k = 0; k < 6000 && (palms.length < want || rocks.length < 70); k++) {
      const x = (rnd() - 0.5) * Terrain.ISLAND_SIZE, z = (rnd() - 0.5) * Terrain.ISLAND_SIZE, h = H(x, z);
      const slope = Math.hypot(H(x + 1.5, z) - h, H(x, z + 1.5) - h) / 1.5;
      if (palms.length < want && h > 1.6 && h < 18 && slope < 0.45) palms.push([x, h - 0.2, z, rnd()]);
      else if (rocks.length < 70 && h > -1.5 && (h < 2.2 || slope > 0.7)) rocks.push([x, h, z, rnd()]);
    }
    const d = new THREE.Object3D();
    const palmMesh = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), palms.length);
    palms.forEach(([x, y, z, r], i) => {
      d.position.set(x, y, z);
      d.rotation.set(0, r * Math.PI * 2, 0);
      d.scale.setScalar(0.8 + r * 0.6);
      d.updateMatrix();
      palmMesh.setMatrixAt(i, d.matrix);
    });
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8c7b6b, flatShading: true, roughness: 0.95 }), rocks.length);
    rocks.forEach(([x, y, z, r], i) => {
      d.position.set(x, y, z);
      d.rotation.set(r * 3, r * 7, r * 5);
      d.scale.set(0.8 + r * 2.2, 0.5 + r * 1.2, 0.8 + r * 1.8);
      d.updateMatrix();
      rockMesh.setMatrixAt(i, d.matrix);
    });
    palmMesh.computeBoundingSphere();
    rockMesh.computeBoundingSphere();
    this.props = [palmMesh, rockMesh];
    this.scene.add(palmMesh, rockMesh);
    this.height = H;
  }

  setWorld(w) {
    this.build(w.island?.seed ?? w.seed ?? 1);
    this.loadKit(w);
    this.landing = w.island?.landing || null;
    this.parkedList = w.island?.parked || [];
    // A ship that left the pad (take-off, a new round) frees its model now, even while the island is not on screen.
    for (const v of this.parked.values()) if (!v.transit && !this.parkedList.some((q) => q.player === v.name)) this.disposeParked(v.name);
    // Take-off leaves the planet the way world.js points the ship (away from the planet, towards the spawn).
    if (w.planet) this.parkYaw = Math.atan2(w.planet.x, w.planet.z);
    this.chestField.sync(w.chests || [], w.assists);
  }

  update(dt, t, snap, ctx, camera) {
    this.glow.begin();
    if (this.waterMat) this.waterMat.uniforms.uTime.value = t;
    this.kit?.update(dt, camera);
    this.camPos.copy(camera.position);
    worldSound.tick(snap, ctx, camera, "planet");
    this.chestField.update(dt, t, snap);
    // Explorers: the live planet players, one view each. A view's model is rebuilt only when its (type, drawing) changes,
    // and only while it is among the meshes (the phone keeps at most 8; the others are glow impostors).
    try { DRAWN.pump(); } catch (e) { entWarn("drawn cache", e); }
    this.frame = (this.frame || 0) + 1;
    const items = this.lodItems || (this.lodItems = []), plist = this.lodPlayers || (this.lodPlayers = []);
    items.length = 0;
    plist.length = 0;
    const subject = ctx.subject ? ctx.subject.name : null;
    for (const p of snap.players) {
      if (p.mode !== "planet") continue;
      let e = this.explorers.get(p.name);
      if (p.flags.dead || p.flags.takingOff) {
        // Take-off: the explorer is in the ship; dead: back at the respawn. Hidden meanwhile, the model goes after 20 s.
        if (e) {
          e.seen = this.frame;
          e.group.visible = false;
          e.hasPrev = false;
          e.wantMesh = false;
          if (e.hiddenSince < 0) e.hiddenSince = t; else if (t - e.hiddenSince > 20) e.drop();
        }
        continue;
      }
      if (!e) { e = new ExplorerView(this, p, ctx); this.explorers.set(p.name, e); }
      e.hiddenSince = -1;
      e.seen = this.frame;
      e.lodDist = camera.position.distanceTo(this.tmp.set(p.x, p.y, p.z));
      e.forced = p.name === ctx.me || p.name === subject;
      e.human = this.big && !p.flags.bot; // the TV shows the humans' drawings first, the nearest up to the cap (lodHumans)
      items.push(e);
      plist.push(p);
    }
    const ecap = this.phone ? 8 : 14;
    lodHumans(items, ecap);
    entPlanLod(items, this.phone, ecap, this.big ? 300 : 220, this.big ? 360 : 260, this.lodOrder || (this.lodOrder = []), t);
    for (let i = 0; i < items.length; i++) {
      try { items[i].step(plist[i], dt, t, ctx); } catch (e) { entWarn(`explorer ${items[i].name}`, e); }
    }
    for (const e of this.explorers.values()) if (e.seen !== this.frame) { e.dispose(); this.explorers.delete(e.name); }
    this.shieldMat.uniforms.uTime.value = t;
    // Parked ships: one per world.island.parked entry, on its bay (its owner's drawing, charred and smoking when wrecked;
    // the phone keeps at most 6 as meshes, the rest are glow impostors). Someone else's take-off lifts it away.
    const byName = this.byName || (this.byName = new Map());
    byName.clear();
    for (const p of snap.players) byName.set(p.name, p);
    const want = this.wantSet || (this.wantSet = new Set());
    want.clear();
    const pitems = this.parkItems || (this.parkItems = []);
    pitems.length = 0;
    for (const q of this.parkedList) {
      want.add(q.player);
      let v = this.parked.get(q.player);
      if (!v) v = this.makeParked(q.player, byName.get(q.player)?.color ?? 0x94a3b8);
      if (v.transit) continue;
      v.q = q;
      v.lodDist = camera.position.distanceTo(this.tmp.set(q.x, this.groundAt(q.x, q.z), q.z));
      v.forced = q.player === ctx.me || q.player === subject;
      pitems.push(v);
    }
    entPlanLod(pitems, this.phone, this.phone ? 6 : 10, this.big ? 300 : 220, this.big ? 360 : 260, this.lodOrderParked || (this.lodOrderParked = []), t);
    for (let i = 0; i < pitems.length; i++) {
      try { pitems[i].step(pitems[i].q, byName.get(pitems[i].q.player), dt, t, ctx); } catch (e) { entWarn(`parked ship ${pitems[i].name}`, e); }
    }
    for (const v of this.parked.values()) if (!want.has(v.name) && !v.transit) this.disposeParked(v.name);
    // Island bullets (mode 1).
    writeBullets(this.bullets, this.dummy, snap.bullets, 1);
    this.mischief.update(dt, t, snap, ctx, camera);
    this.glow.end();
    this.particles.update(dt);
    this.rings.update(dt, camera);
    // A-010 effects: this scene's clock (after the explorers asked for their hex bubbles: the unasked ones go).
    this.efx.update(dt, t);
  }

  clearForRound() {
    this.particles.clear();
    this.mischief.clear();
    this.efx.clear();
  }

  fx(m) {
    worldSound.fx(m);
    const pos = v3(m.pos.x, m.pos.y, m.pos.z);
    const c = new THREE.Color(m.color ?? 0xffffff);
    const P = this.particles, F = this.efx;
    const mischief = m.kind === "emp" || m.kind === "inkbomb" || m.kind === "tractor" || m.kind === "mine" || m.kind === "decoy";
    if (F.ok && !mischief) {
      // A-010 (sizes grown with the camera distance for the TV and capped near the camera: WorldFx.size); its rings lie flat on
      // the ground (normal up). The ad hoc bursts below stay as the fallback until (unless) it loads.
      const k = m.kind, size = m.size || 3;
      if (k === "dig") F.spawn("dig", pos.setY(pos.y + 0.2), F.size(pos, 1, 0.12));
      else if (k === "drill") F.spawn("drill", pos.setY(pos.y + 0.9), F.size(pos, 0.8, 0.12), undefined, _up); // sparks up off the boulder
      else if (k === "treasure") {
        // chest gold at the lid's height (A-010's glitter is depth-tested: centred on the ground the terrain cuts it), a flat gold ripple
        F.spawn("gold", pos.setY(pos.y + 1), F.size(pos, 1.6, 0.1));
        F.spawn("scan", pos.setY(pos.y - 0.85), F.size(pos, 1, 0.15), 0xffd34d);
      } else if (k === "land") F.spawn("landing", pos.setY(pos.y + 0.1), F.size(pos, 1.6, 0.1));
      else if (k === "explode") {
        // an explorer down (island PvP), a parked ship, a mine: A-010's blast at body height, the player's colour in a few sparks
        F.spawn("explosion", pos.setY(pos.y + 1), F.size(pos, size * 0.35, 0.06));
        P.burst(pos, c, 14, 6, 0.9, 0.5, 0.1, { boost: 2.2, drag: 1.2, grav: 4 });
      } else if (k === "respawn") F.spawn("respawn", pos.setY(pos.y + 0.15), F.size(pos, 0.7, 0.15), m.color ?? 0x22d3ee);
      // the flare's light (TV) is 70 x size² at 24 x size m: size <= 1.2 next to an explorer
      else if (k === "flare") F.spawn("flare", pos.setY(pos.y + 1.5), Math.min(1.2, F.size(pos, 1.2 * clamp(size / TUNING.flare.radius, 0.15, 1), 0.08)), m.color ?? 0xfff1c2);
      else if (k === "scan") F.spawn("scan", pos.setY(pos.y + 0.2), F.size(pos, (m.size || TUNING.scan.range) / 8, 0.15));
      else if (k === "blast") F.spawn("blast", pos.setY(pos.y + 1), F.size(pos, size / 12, 0.06), m.color);
      else F.spawn("spark", pos.setY(pos.y + 1), F.size(pos, 0.5, 0.15), m.color, _up); // hit, spark
      return;
    }
    if (m.kind === "dig") P.burst(pos.setY(pos.y + 0.3), DIRT, 18, 5, 0.8, 0.45, 0.15, { boost: 1, grav: 14, drag: 0.6 });
    else if (m.kind === "drill") P.burst(pos.setY(pos.y + 1.2), GOLD, 16, 9, 0.5, 0.4, 0.05, { boost: 2.6, grav: 8, drag: 1, spread: 1.6 });
    else if (m.kind === "treasure") { P.burst(pos.setY(pos.y + 1), new THREE.Color(0xffd34d), 110, 15, 1.7, 0.6, 0.08, { boost: 2.4, grav: 5, drag: 0.7 }); this.rings.spawn(pos, 0xffd34d, 14, 1.4, true); this.rings.spawn(pos.setY(pos.y + 0.6), 0xfff1c2, 7, 1.0, true); }
    else if (m.kind === "emp" || m.kind === "inkbomb" || m.kind === "tractor" || m.kind === "mine" || m.kind === "decoy") this.mischief.fx(m);
    else if (m.kind === "land") { P.burst(pos, new THREE.Color(0xe8d4a8), 40, 7, 1.2, 1.4, 0.3, { boost: 0.8, drag: 1.5 }); this.rings.spawn(pos.setY(pos.y + 0.2), 0xffffff, 8, 1, true); }
    else if (m.kind === "explode") {
      // An explorer down (island PvP): flash, smoke and a ring on the ground.
      const size = m.size || 3;
      P.burst(pos.setY(pos.y + 1), new THREE.Color(0xffd08a), 14, size * 3, 0.35, size * 1.2, size * 0.3, { boost: 3 });
      P.burst(pos, c, 40, 8, 1.1, 0.7, 0.1, { boost: 2.5, drag: 1.2, grav: 4 });
      P.burst(pos, new THREE.Color(0x6b6b6b), 16, 3, 1.6, 1.4, 2.2, { boost: 0.6, drag: 1, grav: -1.5 });
      this.rings.spawn(pos.setY(pos.y - 0.8), m.color ?? 0xff7a3a, size * 3, 0.9, true);
    } else if (m.kind === "respawn") {
      P.burst(pos.setY(pos.y + 1), c, 36, 6, 0.9, 0.6, 0.1, { boost: 3, drag: 1.5, grav: -2 });
      this.rings.spawn(pos.setY(pos.y - 0.9), m.color ?? 0x22d3ee, 5, 0.9, true);
    } else P.burst(pos, c, 16, 6, 0.6, 0.6, 0.1, { boost: 2.5 });
  }
}
const DIRT = new THREE.Color(0x8a6236);

// ---------------------------------------------------------------------------------------------------------------
// Ticks: buffer, clock offset, interpolation ~100 ms behind the newest tick.
const SNAP_NONE = Object.freeze([]); // an empty list in a sample (no decoys / mines this tick): nobody writes into a sample
class Snapshots {
  constructor() {
    this.list = [];
    this.offsets = [];
    this.latest = null;
    this.latestAt = 0;
    // sample() is pooled (no garbage per frame on the phone): one result object, its arrays, one interpolated player object per
    // name and the bullet / shot rows, all reused. Every reader takes a sample within its frame (game.lastSnap: projectPlayers and
    // hud() read the latest one; WorldSound, CameraRig and the worlds keep names and numbers, never a player object or a row).
    // Decoys stay fresh arrays: MischiefLayer keeps a vanished decoy's row (v.q) 0.4 s to fade it out where it was.
    this.out = { players: [], bullets: [], bossShots: [], flares: SNAP_NONE, mines: SNAP_NONE, decoys: SNAP_NONE, phase: undefined };
    this.empty = { players: [], bullets: [], bossShots: [], flares: [], mines: [], decoys: [] };
    this.pool = new Map(); // name → the reused interpolated player object
    this.rowsB = []; this.rowsN = []; this.rowsS = []; // bullet rows with a direction, new bullet rows, boss-shot rows
    this.prune = 0;
  }
  // listB's rows interpolated against the older tick's mapA into `out` (rows reused by index from `rows`): [id, x, y, z, color, mode,
  // dx, dy, dz]; a row new in listB is [id, x, y, z, color, mode] for bullets (from `fresh`), the tick's own row for boss shots.
  track(listB, mapA, u, out, rows, fresh) {
    out.length = 0;
    let n = 0, f = 0;
    for (let i = 0; i < listB.length; i++) {
      const q = listB[i], p = mapA.get(q[0]);
      if (!p) {
        if (!fresh) { out.push(q); continue; }
        const r = fresh[f] || (fresh[f] = [0, 0, 0, 0, 0, 0]);
        f++;
        r[0] = q[0]; r[1] = q[1]; r[2] = q[2]; r[3] = q[3]; r[4] = q[4]; r[5] = q[5] || 0;
        out.push(r);
        continue;
      }
      const r = rows[n] || (rows[n] = [0, 0, 0, 0, 0, 0, 0, 0, 0]);
      n++;
      r[0] = q[0]; r[1] = lerp(p[1], q[1], u); r[2] = lerp(p[2], q[2], u); r[3] = lerp(p[3], q[3], u); r[4] = q[4]; r[5] = q[5] || 0;
      r[6] = q[1] - p[1]; r[7] = q[2] - p[2]; r[8] = q[3] - p[3];
      out.push(r);
    }
    return out;
  }
  push(tick) {
    const local = Date.now();
    const t = Number.isFinite(tick.t) ? tick.t : local;
    this.offsets.push(local - t);
    if (this.offsets.length > 45) this.offsets.shift();
    this.offset = Math.min(...this.offsets);
    const entry = { t, tick, players: new Map(tick.players.map((p) => [p.name, p])), bullets: new Map(tick.bullets.map((b) => [b[0], b])), shots: new Map(tick.bossShots.map((b) => [b[0], b])), decoys: new Map((tick.decoys || []).map((d) => [d[0], d])) };
    // Ignore out-of-order ticks.
    if (this.list.length && t <= this.list[this.list.length - 1].t) return;
    this.list.push(entry);
    if (this.list.length > 30) this.list.shift();
    this.latest = tick;
    this.latestAt = local;
  }
  sample() {
    const L = this.list;
    if (!L.length) return this.empty;
    const rt = Date.now() - (this.offset || 0) - INTERP_DELAY_MS;
    let a = L[0], b = L[0];
    if (rt >= L[L.length - 1].t) a = b = L[L.length - 1];
    else if (rt > L[0].t) {
      for (let i = L.length - 2; i >= 0; i--) if (L[i].t <= rt) { a = L[i]; b = L[i + 1]; break; }
    }
    const u = b === a ? 0 : clamp((rt - a.t) / (b.t - a.t), 0, 1);
    const out = this.out, players = out.players, pool = this.pool;
    players.length = 0;
    for (const pb of b.tick.players) {
      const pa = a.players.get(pb.name);
      if (!pa || pa.mode !== pb.mode || pa.flags?.dead !== pb.flags?.dead) { players.push(pb); continue; }
      const near = u < 0.5 ? pa : pb;
      // the tick's player with the moving parts interpolated, on this name's reused object (a key the tick dropped is dropped too)
      let o = pool.get(pb.name);
      if (!o) pool.set(pb.name, (o = {}));
      else for (const k in o) if (!(k in pb)) delete o[k];
      Object.assign(o, pb);
      o.flags = near.flags;
      o.x = lerp(pa.x, pb.x, u); o.y = lerp(pa.y, pb.y, u); o.z = lerp(pa.z, pb.z, u);
      o.yaw = lerpAngle(pa.yaw, pb.yaw, u); o.pitch = lerp(pa.pitch, pb.pitch, u); o.roll = lerpAngle(pa.roll, pb.roll, u);
      o.shieldEnergy = lerp(pa.shieldEnergy, pb.shieldEnergy, u); o.boostEnergy = lerp(pa.boostEnergy, pb.boostEnergy, u);
      players.push(o);
    }
    // names that left: their objects go now and then (a few hundred frames)
    if (++this.prune > 600) { this.prune = 0; for (const k of pool.keys()) if (!b.players.has(k)) pool.delete(k); }
    // Bullets: [id, x, y, z, color, mode, dx, dy, dz] (mode 0 = space, 1 = island; old servers send no mode).
    this.track(b.tick.bullets, a.bullets, u, out.bullets, this.rowsB, this.rowsN);
    this.track(b.tick.bossShots, a.shots, u, out.bossShots, this.rowsS, null);
    // Decoys [id, x, y, z, yaw, color, owner, mode] glide (they fly / walk on); mines [id, x, y, z, mode, color] sit still.
    const dl = b.tick.decoys;
    out.decoys = dl && dl.length ? dl.map((q) => {
      const p = a.decoys.get(q[0]);
      return p && p[7] === q[7] ? [q[0], lerp(p[1], q[1], u), lerp(p[2], q[2], u), lerp(p[3], q[3], u), q[4], q[5], q[6], q[7]] : q;
    }) : SNAP_NONE;
    out.flares = b.tick.flares;
    out.mines = b.tick.mines || SNAP_NONE;
    out.phase = b.tick.phase;
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cockpit window frame (procedural, drawn in clip space so it fits any aspect; leaves > 70% of the view clear). The fallback:
// startGame swaps it for A-007's camera-mounted cockpit once that loads.
function cockpitFrame() {
  const pts = [], cols = [];
  const metal = [0.025, 0.03, 0.055], edge = [0.15, 0.75, 0.95];
  const quad = (a, b, c, d, col) => { pts.push(...a, 0, ...b, 0, ...c, 0, ...a, 0, ...c, 0, ...d, 0); for (let i = 0; i < 6; i++) cols.push(...col); };
  quad([-1, -1], [1, -1], [0.75, -0.74], [-0.75, -0.74], metal); // dashboard
  quad([-0.75, -0.74], [0.75, -0.74], [0.74, -0.725], [-0.74, -0.725], edge);
  quad([-1, -1], [-0.75, -0.74], [-0.86, 1], [-1, 1], metal); // left pillar
  quad([-0.75, -0.74], [-0.735, -0.73], [-0.845, 1], [-0.86, 1], edge);
  quad([1, -1], [1, 1], [0.86, 1], [0.75, -0.74], metal); // right pillar
  quad([0.75, -0.74], [0.86, 1], [0.845, 1], [0.735, -0.73], edge);
  quad([-1, 0.93], [1, 0.93], [1, 1], [-1, 1], metal); // top bar
  quad([-0.86, 0.92], [0.86, 0.92], [0.86, 0.93], [-0.86, 0.93], edge);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `attribute vec3 color; varying vec3 vC; void main(){ vC = color; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
    depthTest: false, depthWrite: false, transparent: true, // transparent so it sorts after every other transparent draw
  }));
  m.frustumCulled = false;
  m.renderOrder = 1000;
  m.visible = false;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Cameras: chase, cockpit, spectator (cuts at most every 8 s, smooth, shows the island when someone is on it).
// v1.3 cinematics, never blocking input (the server keeps simulating, only the camera eases): lobby -> play is a 1.6 s swoop
// over the fleet (TV) / a fly-in from the lobby framing behind my ship with a small fov kick (phone); the boss's death cuts
// the TV to a 3 s planet reveal (the phone only glances at it for a second); the scoreboard is a slow pull-back orbit round
// the winner (TV only). The TV director also cuts to key moments fed by rig.note(fx / announce): steals, kills, chest opens,
// wrecks, mischief, PvP hits (two humans framed over one's shoulder), boss hits; humans before bots, always.
const MOMENT_N = 24; // the moment pool (preallocated: note() and pickFocus allocate nothing)
const MOMENT_GAP = 2, MOMENT_MIN = 3; // never a cut within 2 s of the last one; 3 s minimum shot unless a bigger moment comes
const QUIET_PRIO = 20; // a quiet-time shot counts as a boss hit: a boss hit takes over only from a shot older than MOMENT_MIN
const PVP_RANGE = 80; // two humans this close, one hit: frame both
const INTRO_SECONDS = 1.6, REVEAL_DELAY = 1, REVEAL_SECONDS = 3, GLANCE_SECONDS = 1.1;
const RIG_UP = new THREE.Vector3(0, 1, 0);
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = v3(0, 30, 80);
    this.look = v3(0, 0, -100);
    this.scene = "space";
    this.focus = null;
    this.lastCut = -1e9;
    this.snapNext = true;
    this.side = 1;
    this.tmp = v3();
    this.f = v3();
    // update()'s temporaries (it allocates nothing per frame) and its result, reused: read it at once
    this.lk = v3(); this.P = v3(); this.U = v3(); this.dir = v3(); this.sv = v3(); this.fa = v3();
    this.q = new THREE.Quaternion(); this.eul = new THREE.Euler(0, 0, 0, "YXZ");
    this.out = { mode: "spectator", scene: "space", followed: null };
    // The director's key moments from rig.note(): { name, other, prio, until, at, kind } in the frame clock.
    this.moments = [];
    for (let i = 0; i < MOMENT_N; i++) this.moments.push({ name: null, other: null, prio: 0, until: 0, at: 0, kind: "" });
    this.shotPrio = 0;    // the shot on air: its moment's priority (0 = quiet time)
    this.holdUntil = 0;   // a moment shot keeps its subject until then
    this.other = null;    // a moment's second player (PvP, kill, steal, mischief): framed over the subject's shoulder
    this.hitAt = new Map(); // name -> when that player was last hit (PvP: two humans close with recent hits)
    this.players = null;  // the last sampled players: note() runs between frames and attributes an fx to them
    this.wall = performance.now() / 1000; // wall seconds minus the frame clock t (t = 0 now), so note() can stamp moments in the frame clock even before the first frame
    // Cinematic shots: "intro" (lobby -> play), "reveal" (TV: boss down -> the planet), "glance" (the phone's reveal),
    // "outro" (TV: the scoreboard). cp0 / cq0 = the intro's start pose; fovAdd = degrees the frame loop adds (phone intro).
    this.cine = ""; this.cineT0 = 0; this.cineDur = 0; this.cineArc = false;
    this.cp0 = v3(); this.cq0 = new THREE.Quaternion(); this.cq1 = new THREE.Quaternion(); this.m4 = new THREE.Matrix4();
    this.fovAdd = 0;
    this.lastPhase = null; this.revealed = false; this.boomAt = -1e9; this.orbitA = NaN;
  }
  // A stream message (handle(): fx and announce) -> the director's moments. Allocation: only an announce's regex match.
  note(m) {
    if (!m) return;
    const now = performance.now() / 1000 - this.wall;
    if (m.type === "fx") {
      // only the boss's death is that big (rocks 2-11, ships 8): the reveal (the boss state flip in watch() usually wins)
      if (m.kind === "explode" && m.size >= 12 && (m.mode || "space") === "space") this.boomAt = now;
      else if (m.kind === "hit" && m.pos) this.noteHit(m, now);
      return;
    }
    if (m.type !== "announce" || typeof m.text !== "string") return;
    const s = m.text;
    let r;
    if (s.startsWith("💥")) this.boomAt = now; // the boss is down
    else if ((r = /^💰 (\S+) stole \d+ points from (\S+?)!/u.exec(s))) this.push(r[1], r[2], 80, now, 4, "steal");
    else if ((r = /^(\S+) ✕ (\S+)/u.exec(s))) { const v = this.find(this.players, r[2]); this.push(r[1], r[2], v && !v.flags.bot ? 75 : 45, now, 3.5, "kill"); }
    else if ((r = /^💎 (\S+) opened a chest/u.exec(s))) this.push(r[1], null, 60, now, 3.5, "chest");
    else if ((r = /^🔧 (\S+) wrecked (\S+?)'s ship/u.exec(s))) this.push(r[1], r[2], 55, now, 3, "wreck");
    else if ((r = /^💣 (\S+) hit (\S+?)'s mine/u.exec(s))) this.push(r[1], null, 40, now, 3, "mine"); // the one stunned by the blast
    else if ((r = /^(⚡|🦑|🧲|🎭) (\S+) (?:scrambled|inked|pulled|shot) (\S+?)(?:'s|\s|$)/u.exec(s))) this.push(r[2], r[3], r[1] === "🧲" ? 45 : 40, now, 3, "mischief");
  }
  // A hit fx carries no player: red = the boss was hit (by the human whose nose points at the spot), orange = a player was
  // (the one at the spot; a human within PVP_RANGE aiming at a human victim, or hit too in the last 3 s, makes it PvP).
  noteHit(m, now) {
    const ps = this.players;
    if (!ps) return;
    const mode = m.mode || "space", x = m.pos.x, y = m.pos.y, z = m.pos.z;
    let humans = 0;
    for (let i = 0; i < ps.length; i++) if (!ps[i].flags.bot) humans++;
    if (m.color === 0xef4444) {
      const a = this.aimer(ps, x, y, z, mode, 320, null, humans > 0);
      if (a) this.push(a.name, null, QUIET_PRIO, now, 1.5, "boss");
      return;
    }
    if (m.color !== 0xf97316) return; // green = a heal
    let v = null, vd = 49;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.mode !== mode || p.flags.dead) continue;
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) + (p.z - z) * (p.z - z);
      if (d < vd) { v = p; vd = d; }
    }
    if (!v) return;
    this.hitAt.set(v.name, now);
    if (v.flags.bot) return;
    let a = this.aimer(ps, v.x, v.y, v.z, mode, PVP_RANGE, v, true);
    if (!a) {
      let bd = PVP_RANGE * PVP_RANGE;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (p === v || p.mode !== mode || p.flags.dead || p.flags.bot || !(now - (this.hitAt.get(p.name) ?? -1e9) < 3)) continue;
        const d = (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y) + (p.z - v.z) * (p.z - v.z);
        if (d < bd) { a = p; bd = d; }
      }
    }
    if (a) this.push(a.name, v.name, 50, now, 2.5, "pvp");
  }
  // The player within `range` of the point (humans only when `humans`) whose nose points at it best: the likely shooter.
  aimer(ps, x, y, z, mode, range, skip, humans) {
    let best = null, bestS = 0.9;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === skip || p.mode !== mode || p.flags.dead || (humans && p.flags.bot)) continue;
      const dx = x - p.x, dy = mode === "space" ? y - p.y : 0, dz = z - p.z, d = Math.hypot(dx, dy, dz);
      if (d > range || d < 0.5) continue;
      const F = forwardOf(p.yaw || 0, mode === "space" ? p.pitch || 0 : 0, this.fa);
      const s = (F.x * dx + F.y * dy + F.z * dz) / d - d / (range * 8); // the nearer of two aimers wins
      if (s > bestS) { best = p; bestS = s; }
    }
    return best;
  }
  // Queue a moment: the same player's live moment of the same kind is refreshed; else a free slot, else the weakest one.
  push(name, other, prio, now, ttl, kind) {
    if (!name) return;
    const M = this.moments;
    let slot = null;
    for (let i = 0; i < M.length && !slot; i++) if (M[i].name === name && M[i].kind === kind && M[i].until > now) slot = M[i];
    const fresh = !slot;
    if (fresh) {
      let w = Infinity;
      for (let i = 0; i < M.length; i++) { const s = M[i].until > now ? M[i].prio : -1; if (s < w) { w = s; slot = M[i]; } }
    }
    slot.name = name; slot.kind = kind; slot.at = now;
    slot.other = other || (fresh ? null : slot.other);
    slot.prio = fresh ? prio : Math.max(prio, slot.prio);
    slot.until = fresh ? now + ttl : Math.max(slot.until, now + ttl);
  }
  find(ps, name) {
    if (ps) for (let i = 0; i < ps.length; i++) if (ps[i].name === name) return ps[i];
    return null;
  }
  // The place a space player is heading for (a shared vector: read it at once, do not keep it).
  objectiveSpace(game, P) {
    const boss = game.space.bossAlive(), o = this.obj || (this.obj = v3());
    if (boss) return o.set(boss.x, boss.y, boss.z);
    if (game.world?.planet) return o.set(game.world.planet.x, game.world.planet.y, game.world.planet.z);
    return P ? null : o.set(0, 0, -100);
  }
  // The TV director. HUMANS FIRST: only the people playing are followed (flags.bot is false); bots only when no human is in the
  // round at all (a bots-only demo). A human who is down keeps the camera for the 3 s until they are back. Then, as before, the island
  // beats space; key moments win: a landing / take-off shot (at once), the human digging or drilling a chest, and the human closest to the
  // boss once it is below 20 % (cuts after 3 s instead of 8). Otherwise the human closest to the objective, cut at most every 8 s.
  pickFocus(game, players, t) {
    const pool = this.pool || (this.pool = []);
    pool.length = 0;
    let humans = 0, island = false;
    for (let i = 0; i < players.length; i++) if (!players[i].flags.bot) humans++;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.flags.dead || (humans > 0 && p.flags.bot)) continue;
      pool.push(p);
      if (p.mode === "planet") island = true;
    }
    if (island) { let n = 0; for (let i = 0; i < pool.length; i++) if (pool[i].mode === "planet") pool[n++] = pool[i]; pool.length = n; }
    if (!pool.length) {
      // every human is down for a moment: stay on the one we follow (their wreck) instead of cutting to a bot or the orbit shot
      if (humans > 0) for (let i = 0; i < players.length; i++) if (players[i].name === this.focus && !players[i].flags.bot) return players[i];
      return null;
    }
    const boss = game.space.bossAlive();
    const bossLow = !!boss && boss.hp / (boss.maxHp || 1) < 0.2;
    // A landing or take-off is the best shot in the game: follow that player at once (the shot itself is never cut).
    let shot = null, busy = false;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.flags.landing || p.flags.takingOff) { if (!shot) shot = p; if (p.name === this.focus) busy = true; }
    }
    if (shot && shot.name !== this.focus && !busy) {
      this.focus = shot.name; this.lastCut = t; this.snapNext = true; this.side *= -1; this.shotPrio = 0; this.holdUntil = 0; this.other = null;
      return shot;
    }
    // Key moments (rig.note), never during the followed player's landing / take-off: the best live one whose subject is in the
    // round (alive; no bot while a human plays) gets the camera, MOMENT_GAP s after the last cut at the earliest and, unless it
    // outranks the shot on air (a quiet one counts QUIET_PRIO), MOMENT_MIN s. The subject's own moments keep the camera on it.
    if (!busy) {
      const M = this.moments;
      let mo = null, moP = null, mine = null;
      for (let i = 0; i < M.length; i++) {
        const m = M[i];
        if (m.until <= t || !m.name) continue;
        const p = this.find(players, m.name);
        if (!p || p.flags.dead || (humans > 0 && p.flags.bot)) continue;
        if (m.name === this.focus && (!mine || m.prio > mine.prio)) mine = m;
        if (!mo || m.prio > mo.prio || (m.prio === mo.prio && m.at > mo.at)) { mo = m; moP = p; }
      }
      const age = t - this.lastCut;
      // Boss hits are the background of the fight (25 players hit it all the time): they rotate at the quiet-time pace, CUT_SECONDS
      // per hitter, instead of a cut every MOMENT_MIN; the focus's own hits stop holding the camera once that is up.
      const rotate = mine && mine.kind === "boss" && mo !== mine && age >= CUT_SECONDS;
      if (mine && mine.prio >= mo.prio && !rotate) {
        if (mine.until > this.holdUntil) this.holdUntil = mine.until;
        if (mine.prio > this.shotPrio) this.shotPrio = mine.prio;
        if (mine.other) this.other = mine.other;
      } else if (mo && age >= MOMENT_GAP && (age >= (mo.kind === "boss" ? CUT_SECONDS : MOMENT_MIN) || mo.prio > Math.max(this.shotPrio, QUIET_PRIO))) {
        this.focus = mo.name; this.lastCut = t; this.snapNext = true; this.side *= -1;
        this.shotPrio = mo.prio; this.holdUntil = mo.until; this.other = mo.other;
        return moP;
      }
      if (this.holdUntil > t) {
        const p = this.find(players, this.focus);
        if (p && !p.flags.dead && !(humans > 0 && p.flags.bot)) return p;
      }
      this.shotPrio = 0; this.holdUntil = 0; this.other = null; // quiet time: the old rules below
    }
    let best = pool[0], bestScore = this.scoreOf(game, pool[0], bossLow), current = null, currentScore = 0;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i], sc = i === 0 ? bestScore : this.scoreOf(game, p, bossLow);
      if (sc > bestScore) { best = p; bestScore = sc; }
      if (p.name === this.focus) { current = p; currentScore = sc; }
    }
    const cutAfter = bossLow ? 3 : CUT_SECONDS;
    if (!current || (best.name !== this.focus && t - this.lastCut >= cutAfter && ((best.mode === "planet") !== (current.mode === "planet") || bestScore > currentScore + 25))) {
      if (!current || t - this.lastCut >= cutAfter || !this.focus) {
        if (best.name !== this.focus) { this.focus = best.name; this.lastCut = t; this.snapNext = true; this.side *= -1; }
      }
    }
    return current && this.focus === current.name ? current : best;
  }
  // How worth watching one player is. Island: always, a chest being dug or drilled most. Space: closest to the objective (the boss; once it
  // is dead the planet), and below 20 % boss health the closest to the boss wins by a wide margin.
  scoreOf(game, p, bossLow) {
    if (p.mode === "planet") return 1e6 + (p.flags.digging || p.flags.drilling ? 1e5 : 0) - this.chestDistance(game, p);
    const o = this.objectiveSpace(game, p);
    return (game.world?.planet ? 5e5 : 0) + (bossLow ? 2e5 : 0) - (o ? Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) : 0);
  }
  chestDistance(game, p) {
    const cs = game.world?.chests;
    if (!cs) return 0;
    let best = Infinity;
    for (let i = 0; i < cs.length; i++) { const c = cs[i]; if (!c.open) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < best) best = d; } }
    return best === Infinity ? 0 : best;
  }
  // The lobby on the big screen: every ship that has joined (they sit on the spawn grid, 5 x 5, 12 m apart) framed
  // together from above and in front, about 35 degrees down so the drawings on their tops read, with a slow drift to
  // both sides. The camera distance follows the box of the ships, so it glides back as players join. On the big screen
  // the group is fitted into the free middle of the lobby page (x 26-74 %, y 15-70 % of the screen: the player cards
  // are at the sides, START and the counters below); elsewhere it fills most of the frame.
  lobbyShot(players, t, desired, look, bigScreen) {
    let n = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.mode !== "space" || p.flags.dead) continue;
      n++;
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
      if (p.z < z0) z0 = p.z;
      if (p.z > z1) z1 = p.z;
    }
    if (!n) { desired.set(0, 9, 24); look.set(0, 0, 0); return; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    // The box of the ships (plus a ship's own size, spin, bob and showcase scale) as the camera sees it: back far enough
    // for it to fill ~92 % of the free region, whatever the shape of the group (a 5 x 5 wall, a row, one ship).
    const m = bigScreen ? 6 : 3.2; // the TV shows 2.9x showcase ships (ShipView), the phone 1.7x
    const hx = (x1 - x0) / 2 + m, hy = (y1 - y0) / 2 + m, hz = (z1 - z0) / 2 + m;
    // ~35 degrees down on the phone; ~50 on the TV, where 5 rows must not hide each other and the drawings on top read
    const el = (bigScreen ? 0.86 : 0.62) + Math.sin(t * 0.11) * 0.05, az = Math.sin(t * 0.07) * 0.35; // a slow drift
    const d = this.lobD || (this.lobD = v3()), f = this.lobF || (this.lobF = v3()), r = this.lobR || (this.lobR = v3()), u = this.lobU || (this.lobU = v3());
    d.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); // from the centre to the camera
    f.copy(d).negate();
    r.set(-f.z, 0, f.x).normalize(); // forward x up
    u.crossVectors(r, f);
    const cam = this.camera, tv = Math.tan((cam.fov * Math.PI) / 360), th = tv * (cam.aspect || 1.6);
    const halfW = (bigScreen ? 0.48 : 0.86) * 0.92, halfH = (bigScreen ? 0.55 : 0.86) * 0.92; // of the NDC half extents
    const lift = bigScreen ? 0.15 : 0; // the free region's centre sits 15 % of the half height above the screen centre
    const Rx = Math.abs(r.x) * hx + Math.abs(r.y) * hy + Math.abs(r.z) * hz;
    const Ry = Math.abs(u.x) * hx + Math.abs(u.y) * hy + Math.abs(u.z) * hz;
    const Rz = Math.abs(f.x) * hx + Math.abs(f.y) * hy + Math.abs(f.z) * hz;
    const dist = Math.max(10, Math.max(Rx / (th * halfW), Ry / (tv * halfH)) + Rz);
    desired.set(cx + d.x * dist, cy + d.y * dist, cz + d.z * dist);
    // Aim a little below the group so that it appears in the upper middle of the screen.
    look.set(cx - u.x * lift * tv * dist, cy - u.y * lift * tv * dist, cz - u.z * lift * tv * dist);
  }
  update(dt, t, game, snap) {
    const cam = this.camera, players = snap.players, tv = game.screen !== "phone";
    this.wall = performance.now() / 1000 - t;
    this.players = players;
    const me = game.player ? this.find(players, game.player) : null;
    let mode = game.view;
    let subject = me && !me.flags.dead ? me : null;
    if (mode !== "spectator" && !subject) mode = "spectator";
    const phase = snap.phase;
    if (mode === "spectator") {
      // the results (TV): the winner, whoever the director was following
      const w = tv && phase === "scoreboard" ? this.winnerOf(game, players) : null;
      if (w) { if (w.name !== this.focus) { this.focus = w.name; this.lastCut = t; this.snapNext = true; } subject = w; }
      else subject = this.pickFocus(game, players, t);
    } else this.focus = subject.name;
    const scene = subject?.mode === "planet" ? "planet" : "space";
    if (scene !== this.scene) { this.scene = scene; this.snapNext = true; }
    this.watch(game, snap, t, mode, subject, tv);
    const desired = this.tmp, look = this.lk;
    let lamPos = 5, lamLook = 8;
    const outro = this.cine === "outro" && mode === "spectator";
    if (!subject && phase === "lobby") {
      this.lobbyShot(players, t, desired, look, game.screen === "big");
      lamPos = lamLook = 2.2;
    } else if (!subject) {
      // Nobody to follow: slow orbit around the boss nebula.
      const c = game.world?.nebula, a = t * 0.05, R = ((c && c.radius) || 80) * 2.2;
      const cx = c ? c.x : 0, cy = c ? c.y : 0, cz = c ? c.z : -300;
      desired.set(cx + Math.sin(a) * R, cy + R * 0.3, cz + Math.cos(a) * R);
      look.set(cx, cy, cz);
      lamPos = lamLook = 1.5;
    } else if (scene === "planet") {
      const H = game.island.height;
      const P = this.P.set(subject.x, subject.y, subject.z);
      const F = forwardOf(subject.yaw, 0, this.f);
      if (mode === "cockpit") {
        cam.position.set(P.x, P.y + 1.6, P.z);
        cam.rotation.set(subject.pitch || 0, subject.yaw, 0, "YXZ");
        this.pos.copy(cam.position);
        this.snapNext = false;
        return this.finish(mode, scene);
      }
      const Q = mode === "chase" || outro ? null : this.otherOf(players, subject);
      if (mode === "chase") {
        desired.set(P.x - F.x * 6.5, P.y + 3.4, P.z - F.z * 6.5);
        look.set(P.x + F.x * 4, P.y + 1.3, P.z + F.z * 4);
      } else if (outro) {
        this.orbit(P, t, desired, look, true);
        lamPos = 1.4; lamLook = 2;
      } else if (Q) {
        // Island PvP / a kill / mischief: over the subject's shoulder towards the other one, both in frame.
        const d = this.dir.set(Q.x - P.x, 0, Q.z - P.z), dist = d.length();
        if (dist > 1e-3) d.multiplyScalar(1 / dist); else d.copy(F);
        desired.set(P.x - d.x * 7 + d.z * 2.4 * this.side, P.y + 3.2, P.z - d.z * 7 - d.x * 2.4 * this.side);
        look.set(P.x + d.x * dist * 0.55, P.y + 1.2, P.z + d.z * dist * 0.55);
        lamPos = 2.6; lamLook = 3.5;
      } else {
        const a = t * 0.12 + this.side;
        desired.set(P.x + Math.sin(a) * 15, P.y + 7, P.z + Math.cos(a) * 15);
        look.set(P.x, P.y + 1.2, P.z);
        lamPos = 1.6; lamLook = 3;
      }
      desired.y = Math.max(desired.y, (H ? H(desired.x, desired.z) : 0) + 1.5, 1.2);
    } else {
      const P = this.P.set(subject.x, subject.y, subject.z);
      const F = forwardOf(subject.yaw, subject.pitch, this.f);
      const q = this.q.setFromEuler(this.eul.set(subject.pitch || 0, subject.yaw || 0, subject.roll || 0, "YXZ"));
      const U = this.U.set(0, 1, 0).applyQuaternion(q);
      if (mode === "cockpit") {
        cam.position.copy(P).addScaledVector(F, 0.4).addScaledVector(U, 0.55);
        cam.quaternion.copy(q);
        this.pos.copy(cam.position);
        this.snapNext = false;
        return this.finish(mode, scene);
      }
      const Q = mode === "chase" || outro || phase === "lobby" ? null : this.otherOf(players, subject);
      if (mode === "chase") {
        desired.copy(P).addScaledVector(F, -9).addScaledVector(U, 3.2);
        look.copy(P).addScaledVector(F, 14);
        lamPos = 7; lamLook = 12;
        if (this.cine === "glance" && t >= this.cineT0) this.glance(game, t, P, F, look);
      } else if (phase === "lobby") {
        // The big screen: every ship that has joined, framed together.
        this.lobbyShot(players, t, desired, look, game.screen === "big");
        lamPos = lamLook = 2.2;
      } else if (outro) {
        this.orbit(P, t, desired, look, false);
        lamPos = 1.4; lamLook = 2;
      } else if (Q) {
        // PvP / a kill / a steal / mischief: over the subject's shoulder towards the other one, both in frame.
        const d = this.dir.set(Q.x - P.x, Q.y - P.y, Q.z - P.z), dist = d.length();
        if (dist > 1e-3) d.multiplyScalar(1 / dist); else d.copy(F);
        const side = this.sv.crossVectors(d, RIG_UP);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0); else side.normalize();
        desired.copy(P).addScaledVector(d, -(11 + dist * 0.12)).addScaledVector(side, 5 * this.side);
        desired.y += 3.5;
        look.copy(P).addScaledVector(d, dist * 0.55);
        lamPos = 3; lamLook = 4;
      } else {
        // Cinematic follow: behind and to the side of the subject, the objective in frame beyond it.
        const O = this.objectiveSpace(game, P);
        const dir = O ? this.dir.copy(O).sub(P) : this.dir.copy(F);
        const dist = dir.length();
        dir.normalize();
        if (!Number.isFinite(dir.x) || dist < 1e-3) dir.copy(F);
        const side = this.sv.crossVectors(dir, RIG_UP).normalize();
        if (!Number.isFinite(side.x) || side.lengthSq() < 0.5) side.set(1, 0, 0);
        const near = O && dist < 60;
        desired.copy(P).addScaledVector(dir, near ? -26 : -20).addScaledVector(side, (near ? 14 : 8) * this.side);
        desired.y += near ? 10 : 6;
        look.copy(P).addScaledVector(dir, Math.min(dist * 0.45, 40));
        lamPos = 2; lamLook = 2.6;
      }
    }
    // The planet reveal (TV) holds its own pose; watch() cuts back to the director when it ends.
    if (this.cine === "reveal" && t >= this.cineT0 && scene === "space" && mode === "spectator" && this.revealPose(game, (t - this.cineT0) / this.cineDur, desired, look)) {
      this.pos.copy(desired);
      this.look.copy(look);
      this.snapNext = false;
    } else if (this.snapNext) {
      this.pos.copy(desired);
      this.look.copy(look);
      this.snapNext = false;
    } else {
      this.pos.x = damp(this.pos.x, desired.x, lamPos, dt); this.pos.y = damp(this.pos.y, desired.y, lamPos, dt); this.pos.z = damp(this.pos.z, desired.z, lamPos, dt);
      this.look.x = damp(this.look.x, look.x, lamLook, dt); this.look.y = damp(this.look.y, look.y, lamLook, dt); this.look.z = damp(this.look.z, look.z, lamLook, dt);
    }
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (this.cine === "intro") this.introBlend(t);
    return this.finish(mode, scene);
  }
  // Phase changes and the boss's death start the cinematic shots; the timed ones end here. fovAdd is set again each frame.
  watch(game, snap, t, mode, subject, tv) {
    const phase = snap.phase, cam = this.camera;
    this.fovAdd = 0;
    if (phase) {
      const was = this.lastPhase, clock = game.snaps?.latest?.clock;
      // lobby -> play, or the first frames of a round that has just started (a phone waking up from its lobby screen)
      if (phase === "playing" && was !== "playing" && was !== "assists" && (was === "lobby" || (Number.isFinite(clock) && clock < 3)) && subject && mode !== "cockpit") {
        // From the live lobby framing (the TV's fleet shot; the phone's view of its showcase ship, so the camera eases after the
        // ship as it launches); a page that was not drawing the lobby starts from the lobby shot of the fleet instead.
        if (was === "lobby") { this.cp0.copy(cam.position); this.cq0.copy(cam.quaternion); }
        else {
          this.lobbyShot(snap.players, t, this.cp0, this.dir, tv);
          this.m4.lookAt(this.cp0, this.dir, RIG_UP);
          this.cq0.setFromRotationMatrix(this.m4);
        }
        this.cine = "intro"; this.cineT0 = t; this.cineDur = INTRO_SECONDS; this.cineArc = tv;
        this.snapNext = true; this.lastCut = t;
      }
      if (phase === "scoreboard" && was !== "scoreboard" && tv) { this.cine = "outro"; this.cineT0 = t; this.orbitA = NaN; }
      else if (phase !== "scoreboard" && this.cine === "outro") this.cine = "";
      this.lastPhase = phase;
    }
    // The boss's death, only a fresh one (its planet born < 3 s ago, or the huge bang just noted): the TV cuts to the planet
    // once the explosion has been seen, the phone glances at it. A page that joins or wakes up later gets nothing.
    const B = game.space.boss, P = game.space.planet;
    if (B && !B.dead) this.revealed = false;
    else if (B && !this.revealed && B.seenAlive && (phase === "playing" || phase === "assists") && ((P && performance.now() - P.born < 3000) || t - this.boomAt < 1.5)) {
      this.revealed = true;
      if (mode !== "cockpit" && this.cine !== "intro") { this.cine = tv ? "reveal" : "glance"; this.cineT0 = t + (tv ? REVEAL_DELAY : 0.3); this.cineDur = tv ? REVEAL_SECONDS : GLANCE_SECONDS; }
    }
    if ((this.cine === "intro" || this.cine === "reveal" || this.cine === "glance") && t >= this.cineT0 + this.cineDur) {
      if (this.cine === "reveal") { this.snapNext = true; this.lastCut = t; } // a cut back to the director's shot
      this.cine = "";
    }
  }
  // The intro: from the start pose to the director's pose (already on the camera) along an arc over the fleet (TV), the look
  // turning a little ahead of the move; the phone's fly-in adds a small fov kick (the frame loop adds fovAdd).
  introBlend(t) {
    const cam = this.camera, u = clamp((t - this.cineT0) / this.cineDur, 0, 1), e = smooth01(u);
    this.cq1.copy(cam.quaternion);
    cam.position.lerpVectors(this.cp0, this.pos, e);
    if (this.cineArc) cam.position.y += clamp(this.cp0.distanceTo(this.pos) * 0.22, 4, 40) * Math.sin(Math.PI * e);
    cam.quaternion.slerpQuaternions(this.cq0, this.cq1, smooth01(u / 0.85));
    if (!this.cineArc) this.fovAdd = 7 * Math.sin(Math.PI * u) ** 2;
  }
  // The planet reveal: seen from its approach side (its landing region faces the spawn), a little above and to one side, a
  // slow push-in with a drift; the landing ring (radius + landRange, a billboard round the centre) fills ~70 % of the height.
  revealPose(game, u, pos, look) {
    const w = game.world?.planet, L = game.space.planetLook, c = w || L?.root?.position;
    if (!c) return false;
    const R = (w?.radius || L?.R || 40) + (w?.landRange || L?.landRange || 25);
    const A = this.dir;
    if (L?.approach) A.copy(L.approach); else A.set(-c.x, -c.y, -c.z);
    if (A.lengthSq() < 1e-6) A.set(0, 0, 1); else A.normalize();
    const S = this.sv.crossVectors(RIG_UP, A);
    if (S.lengthSq() < 1e-6) S.set(1, 0, 0); else S.normalize();
    const e = smooth01(u), D = R * (3.3 - 0.75 * e), a = (0.38 - 0.14 * e) * this.side;
    pos.set(c.x, c.y, c.z).addScaledVector(A, D * Math.cos(a)).addScaledVector(S, D * Math.sin(a));
    pos.y += D * 0.26;
    look.set(c.x, c.y + R * 0.04, c.z);
    return true;
  }
  // The phone's reveal: the chase camera's look leans towards the planet for about a second (not when it is behind the ship).
  glance(game, t, P, F, look) {
    const pl = game.world?.planet;
    if (!pl) return;
    const dx = pl.x - P.x, dy = pl.y - P.y, dz = pl.z - P.z, d = Math.hypot(dx, dy, dz) || 1;
    const facing = clamp(((F.x * dx + F.y * dy + F.z * dz) / d + 0.2) / 0.6, 0, 1);
    const w = 0.4 * Math.sin(Math.PI * clamp((t - this.cineT0) / this.cineDur, 0, 1)) * facing;
    if (w > 0) look.lerp(this.sv.set(P.x + (dx / d) * 14, P.y + (dy / d) * 14, P.z + (dz / d) * 14), w);
  }
  // The results (TV): a slow pull-back orbit round the winner, starting from the camera's own bearing (no swing).
  orbit(P, t, desired, look, planet) {
    if (!Number.isFinite(this.orbitA)) this.orbitA = Math.atan2(this.pos.x - P.x, this.pos.z - P.z) - t * 0.08;
    const k = smooth01((t - this.cineT0) / 6), a = this.orbitA + t * 0.08;
    const R = planet ? 7 + 13 * k : 16 + 26 * k, h = planet ? 2.5 + 5.5 * k : 4 + 10 * k;
    desired.set(P.x + Math.sin(a) * R, P.y + h, P.z + Math.cos(a) * R);
    look.set(P.x, P.y + (planet ? 1.2 : 0), P.z);
  }
  // A moment's second player while worth framing with the subject: same world, within PVP_RANGE (a dead one marks the wreck).
  otherOf(players, subject) {
    if (!this.other || this.other === subject.name) return null;
    const q = this.find(players, this.other);
    if (!q || q.mode !== subject.mode) return null;
    const dx = q.x - subject.x, dy = q.y - subject.y, dz = q.z - subject.z;
    return dx * dx + dy * dy + dz * dz < PVP_RANGE * PVP_RANGE ? q : null;
  }
  // The round's winner for the results shot: world.result's winner, else the top score in the snap; never a bot while a human plays.
  winnerOf(game, players) {
    let humans = 0, best = null;
    for (let i = 0; i < players.length; i++) if (!players[i].flags.bot) humans++;
    const w = this.find(players, game.world?.result?.winner);
    if (w && !(humans > 0 && w.flags.bot)) return w;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (humans > 0 && p.flags.bot) continue;
      if (!best || (p.score || 0) > (best.score || 0)) best = p;
    }
    return best;
  }
  // The camera's result (one reused object: read it at once). The frame loop also calls it while a landing shot owns the camera.
  finish(mode, scene) { const o = this.out; o.mode = mode; o.scene = scene; o.followed = this.focus; return o; }
}

// ---------------------------------------------------------------------------------------------------------------
// Performance: frame stats, adaptive governor, ?perf overlay, POST /perf.
const TIERS = [
  { pr: 2, bloom: true, far: true },
  { pr: 1.5, bloom: true, far: true },
  { pr: 1.25, bloom: true, far: true },
  { pr: 1, bloom: true, far: true },
  { pr: 1, bloom: false, far: true },
  { pr: 1, bloom: false, far: false },
];
// The governor: the 90th-percentile frame time of the last 60 frames steps the quality down past STEP_DOWN_MS (60 Hz screens
// sit at 17-18.6 ms, so 18 was a false alarm: it is 20 now). Two cases are NOT slow: a steady 30 Hz cap (iOS Low Power Mode:
// every frame ~33 ms while the CPU is idle, p10 >= 30 and p90 <= 36 with CPU work under 8 ms) and a pinned tier (?tier=N, for
// tests): quality stays where it is. After 5 s of headroom it steps back up (never into a tier it left less than 20 s ago).
const STEP_DOWN_MS = 20, STEP_UP_MS = 18.8;
class Perf {
  constructor() {
    this.dts = [];
    this.work = [];
    this.tier = 0;
    this.sinceChange = 0;
    this.goodFor = 0;
    this.blockUntil = {};
    this.pin = null; // a tier number: no governor (tests, ?tier=N)
    this.capped = false; // the last judgement saw a steady 30 Hz cap
  }
  pct(arr, q) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }
  frame(dtMs, workMs, nowS) {
    if (dtMs > 250) return false; // tab was hidden or stalled: not a real frame
    this.dts.push(dtMs);
    this.work.push(workMs);
    if (this.dts.length > 600) { this.dts.shift(); this.work.shift(); }
    if (Number.isInteger(this.pin)) { const t = clamp(this.pin, 0, TIERS.length - 1); if (t !== this.tier) { this.tier = t; return true; } return false; }
    this.sinceChange++;
    if (this.sinceChange < 60) return false;
    const last = this.dts.slice(-60), lastWork = this.work.slice(-60);
    const p90 = this.pct(last, 0.9), work90 = this.pct(lastWork, 0.9);
    this.capped = this.pct(last, 0.1) >= 30 && p90 <= 36 && work90 < 8;
    if (p90 > STEP_DOWN_MS && !this.capped && this.tier < TIERS.length - 1) {
      this.blockUntil[this.tier] = nowS + 20; // don't climb back into the tier we just left for 20 s
      return this.set(this.tier + 1);
    }
    // Step up after 5 s of headroom: CPU work under 12 ms and frames on time (vsync-capped intervals are ~16.7 ms).
    if (p90 <= STEP_UP_MS && work90 < 12) this.goodFor += dtMs / 1000;
    else this.goodFor = 0;
    if (this.goodFor > 5 && this.tier > 0 && !(this.blockUntil[this.tier - 1] > nowS)) return this.set(this.tier - 1);
    return false;
  }
  set(tier) {
    this.tier = tier;
    this.sinceChange = 0;
    this.goodFor = 0;
    return true;
  }
  stats() {
    const d = this.dts.slice(-300);
    if (!d.length) return { fps: 0, low1: 0, p90ms: 0, ms: 0 };
    const avg = d.reduce((a, b) => a + b, 0) / d.length;
    const worst = [...d].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(d.length * 0.01)));
    const worstAvg = worst.reduce((a, b) => a + b, 0) / worst.length;
    const w = this.work.slice(-60);
    return { fps: 1000 / avg, low1: 1000 / worstAvg, p90ms: this.pct(d.slice(-60), 0.9), ms: avg, workMs: w.reduce((a, b) => a + b, 0) / Math.max(1, w.length) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// HUD model (game.hud()).
function formatClock(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function computeHud(game) {
  const S = game.snaps;
  const tick = S.latest;
  const world = game.world;
  const snap = game.lastSnap || { players: [] };
  const phase = tick?.phase || "lobby";
  const elapsed = tick ? Math.min(1, (Date.now() - S.latestAt) / 1000) : 0;
  const clock = tick ? (phase === "lobby" || phase === "scoreboard" ? Math.max(0, tick.clock - elapsed) : tick.clock + elapsed) : 0;
  const meName = game.screen === "phone" ? game.player : game.followed || game.player;
  const meP = snap.players.find((p) => p.name === meName) || null;
  const meEntity = (meName && entities.get(meName)) || null;
  const me = meP ? { name: meP.name, color: meP.color, mode: meP.mode, hp: meP.hp, maxHp: TUNING.shipHp, score: meP.score, shieldEnergy: meP.shieldEnergy, boostEnergy: meP.boostEnergy, flags: meP.flags,
    respawnIn: meP.respawnIn ?? null, drawingsLeft: meP.drawingsLeft || null, entity: meEntity } : null;
  const boss = world?.targets?.find((t) => t.kind === "boss");
  const bossAlive = boss && !boss.dead;
  const H = HUD_COPY;
  let objective = null, bar = 0, status = "", objPos = null;
  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const pct = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;
  // Chests on the island (buried: DIG; rock: DRILL), for the counter and the planet objective.
  const allChests = world?.chests || [];
  const chests = { total: allChests.length, open: 0, buried: 0, rock: 0 };
  for (const c of allChests) { if (c.open) chests.open++; if (c.kind === "rock") chests.rock++; else chests.buried++; }
  // A phone whose ship has no weapon is told so before anything else (nothing is automatic, PLAN.md §0). Ships have no drill
  // since v1.2 (a planet skill for the rock chests): only a gun or a blast hurts the boss.
  const shipEntity = (meName && entShips.get(meName)) || meEntity; // the BOSS fight is about the ship, whatever the latest entity is
  const armed = !shipEntity || !Array.isArray(shipEntity.verbs) || shipEntity.verbs.some((v) => v === "shoot" || v === "blast");
  if (phase === "lobby") {
    objective = null;
    status = H.waitStart;
  } else if (meP && meP.mode === "planet") {
    objective = "openChests";
    const cs = allChests.filter((c) => !c.open);
    const near = cs.reduce((best, c) => (!best || Math.hypot(c.x - meP.x, c.z - meP.z) < Math.hypot(best.x - meP.x, best.z - meP.z) ? c : best), null);
    if (near) {
      const d = Math.hypot(near.x - meP.x, near.z - meP.z);
      const rock = near.kind === "rock";
      objPos = { x: near.x, y: meP.y, z: near.z };
      const working = (rock ? meP.flags.drilling : meP.flags.digging) || (near.dug > 0 && d < 4);
      if (working) { bar = near.dug || 0; status = (rock ? H.drilling : H.digging).replace("{pct}", pct(near.dug || 0)); }
      else { bar = clamp(1 - d / 120, 0, 1); status = (rock ? H.rockChest : H.buriedChest).replace("{m}", Math.round(d)); }
    } else status = H.allOpen;
  } else if (bossAlive) {
    const ref = meP && meP.mode === "space" ? meP : null;
    const d = ref ? Math.max(0, dist3(ref, boss) - boss.radius) : null;
    objPos = boss;
    bar = boss.hp / (boss.maxHp || 1);
    const near = d !== null && d < Math.max(250, world.nebula?.radius || TUNING.nebula.radius);
    if (game.screen === "phone" && ref && !armed) { objective = "weapon"; status = H.noWeapon; }
    else if (d === null || near) { objective = "destroyBoss"; status = H.bossHp.replace("{pct}", pct(bar)); }
    else { objective = "boss"; status = H.bossAway.replace("{m}", Math.round(d)); }
  } else if (world?.planet) {
    objective = "planet";
    const P = world.planet;
    objPos = P;
    if (meP && meP.mode === "space") {
      const d = Math.max(0, dist3(meP, P) - P.radius);
      bar = clamp(1 - (d - P.landRange) / 250, 0, 1);
      status = d <= P.landRange ? H.landNow : H.planetAway.replace("{m}", Math.round(d));
    } else status = H.planetOpen;
  }
  if (phase === "scoreboard") { objective = null; status = world?.result?.reason === "chests" ? H.allChests : H.timeUp; }
  const objectiveText = objective ? OBJECTIVES[objective] || H.objectives[objective] || "" : phase === "lobby" ? H.getReady : phase === "scoreboard" ? H.roundOver : "";
  // Time left until the 4:00 cap (tick.left), counting down smoothly between ticks.
  const playing = phase === "playing" || phase === "assists";
  const left = tick && playing && Number.isFinite(tick.left) ? Math.max(0, tick.left - elapsed) : 0;
  // Radar, heading-up: dx = metres to my right, dz = metres ahead, dy = metres above.
  const radar = [];
  if (meP) {
    const cy = Math.cos(meP.yaw), sy = Math.sin(meP.yaw);
    const rel = (x, y, z) => { const ex = x - meP.x, ez = z - meP.z; return { dx: ex * cy - ez * sy, dz: -ex * sy - ez * cy, dy: y - meP.y }; };
    radar.push({ kind: "you", dx: 0, dz: 0, dy: 0 });
    for (const p of snap.players) if (p.name !== meP.name && p.mode === meP.mode && !p.flags.dead && !p.flags.invisible) radar.push({ kind: "player", name: p.name, color: p.color, ...rel(p.x, p.y, p.z) });
    if (meP.mode === "space" && bossAlive) radar.push({ kind: "boss", ...rel(boss.x, boss.y, boss.z) });
    if (meP.mode === "space") for (const s of snap.bossShots || []) radar.push({ kind: "target", ...rel(s[1], s[2], s[3]) });
    if (objPos) radar.push({ kind: "objective", ...rel(objPos.x, objPos.y, objPos.z) });
  }
  const leaderboard = Array.isArray(world?.leaderboard) ? world.leaderboard : [];
  const stars = new Map(leaderboard.map((r) => [r.name, r.stars || 0]));
  const scores = (tick?.players || []).map((p) => ({ name: p.name, color: p.color, score: p.score, mode: p.mode, ready: !!p.flags?.ready, bot: !!p.flags?.bot, dead: !!p.flags?.dead, me: p.name === meName, stars: stars.get(p.name) || 0 })).sort((a, b) => b.score - a.score);
  return {
    phase, clock, clockText: formatClock(clock), round: tick?.round ?? world?.round ?? 0,
    left, leftText: formatClock(Math.ceil(left)),
    objective, objectiveText, bar: clamp(bar, 0, 1), status,
    assists: phase === "assists", note: phase === "assists" ? H.assists : "",
    chests, leaderboard, result: world?.result || null, playerCount: world?.playerCount ?? null, entities,
    me, followed: meName || null, radar, scores, tier: game.perf.tier, scene: game.sceneName,
    // The landing / take-off shot of the camera's subject: the phone fades its controller overlay with overlayAlpha.
    transition: game.shotState ? game.shotState.kind : null,
    overlayAlpha: game.shotState && game.shotState.player === meName ? game.shotState.overlayAlpha : 1,
  };
}

// ---------------------------------------------------------------------------------------------------------------
export function startGame({ canvas, screen = "big", view, player = null } = {}) {
  if (!canvas) throw new TypeError("startGame needs a canvas");
  const phone = screen === "phone";
  const big = !phone;
  DRAWN.configure(phone); // drawn-mesh cache: 16 meshes on the phone, 40 on the big screen
  const params = new URLSearchParams(location.search);
  const showPerf = params.has("perf");
  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, powerPreference: "high-performance", stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.info.autoReset = false;
  const camera = new THREE.PerspectiveCamera(phone ? 70 : 60, 1, 0.1, 6000);
  const baseFov = camera.fov;

  const game = {
    screen, player: player ? Contract.cleanName(player) || player : null, view: view || (phone ? "chase" : "spectator"),
    world: null, snaps: new Snapshots(), perf: new Perf(), followed: null, sceneName: "space", lastSnap: null,
  };
  game.space = new SpaceWorld(renderer, { phone, big });
  game.island = new IslandWorld(renderer, { phone, big });
  game.sfx = sfx; worldSound.attach(game); // World look: sound (pages call game.sfx.unlock() in their first tap)
  { const pinned = params.get("tier"); if (pinned !== null && /^\d+$/.test(pinned)) game.perf.pin = Number(pinned); } // ?tier=N pins the quality tier (tests, measurements)
  const rig = new CameraRig(camera);
  // Cockpit view (phone only; hidden in every other view, during the shots and on the TV): A-007's camera-mounted cockpit
  // once it loads (3 calls, 1,366 triangles, cockpit view only), the procedural clip-space frame (one per scene) until then
  // or if it fails. The camera is shared by both scenes and can have one parent: showCockpit hangs it in the scene being
  // drawn only while the cockpit shows (the renderer refreshes the matrixWorld of a PARENTLESS camera only, so a camera left
  // in a scene that is not drawn would go stale). fitCockpit refits after a resize and whenever the fov (boost kick) changed.
  const frames = [cockpitFrame(), cockpitFrame()];
  game.space.scene.add(frames[0]);
  game.island.scene.add(frames[1]);
  let cockpit = null, cockpitFov = 0, cockpitAspect = 0;
  function fitCockpit() {
    if (!cockpit) return;
    cockpitFov = camera.fov; cockpitAspect = camera.aspect;
    try { cockpit.fitToCamera(camera); } catch (e) { console.warn("[render] cockpit fit failed:", e?.message || e); }
  }
  function showCockpit(on, scene) {
    cockpit.object3d.visible = on;
    const parent = on ? scene : null;
    if (camera.parent !== parent) { if (parent) parent.add(camera); else camera.removeFromParent(); }
    if (on && (camera.fov !== cockpitFov || camera.aspect !== cockpitAspect)) fitCockpit();
  }
  if (phone) loadAsset("cockpit").then((c) => {
    if (!c) return;
    if (disposed) { c.dispose?.(); return; }
    cockpit = c;
    c.object3d.visible = false;
    camera.add(c.object3d);
    fitCockpit();
    for (const f of frames) { f.visible = false; f.removeFromParent(); f.geometry.dispose(); f.material.dispose(); }
  });

  // Post: bloom (half resolution on phones), output pass for tone mapping.
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(game.space.scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.72);
  if (phone) { const set = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => set(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))); }
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let width = 0, height = 0, pr = 0;
  function applySize(force) {
    const w = Math.max(1, canvas.clientWidth || innerWidth), h = Math.max(1, canvas.clientHeight || innerHeight);
    const tier = TIERS[game.perf.tier];
    const want = Math.min(devicePixelRatio || 1, tier.pr, 2);
    if (!force && w === width && h === height && want === pr) return;
    width = w; height = h; pr = want;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCockpit(); // A-007 keeps its window opening at the new aspect (no-op until it has loaded)
  }
  const ro = new ResizeObserver(() => applySize());
  ro.observe(canvas);
  applySize(true);

  // ---- the landing / take-off shot (transition.js), one continuous shot on the phone and the big screen ----
  // Plays for the camera's subject (me on a phone, the followed player on the big screen) from flags.landing /
  // flags.takingOff + startedAt; everyone else gets a cheap dive or lift-off. The shot owns the camera and the
  // ship until it ends and the subject's mode has switched, then the camera rig glides on from where it stopped.
  const white = document.createElement("div");
  white.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none";
  canvas.after(white);
  let shot = null, lastShotKey = null;
  const serverNow = () => Date.now() - (game.snaps.offset || 0);
  function startShot(p, kind) {
    lastShotKey = `${p.name}:${p.startedAt}`;
    if (!Transition) return;
    const dur = kind === "land" ? TUNING.planet.landingSeconds : TUNING.planet.takeoffSeconds;
    const elapsed = (serverNow() - INTERP_DELAY_MS - (p.startedAt || 0)) / 1000;
    if (elapsed > dur - 0.3) return; // joined too late: just cut
    const planet = game.world?.planet;
    const isl = game.island;
    const slot = Math.max(0, (game.snaps.latest?.players || []).findIndex((q) => q.name === p.name));
    const parkedAt = kind === "takeoff" ? isl.parkedList.find((c) => c.player === p.name) : null; // its own spot, else the bay formula
    const b = parkedAt || isl.bay(slot);
    const pad = v3(b.x, isl.groundAt(b.x, b.z), b.z);
    let ship, owner, ring;
    if (kind === "land") {
      owner = game.space.ships.get(p.name);
      if (!owner || !planet) return;
      ship = owner.group;
      const out = v3(p.x - planet.x, p.y - planet.y, p.z - planet.z).normalize();
      ring = v3(planet.x, planet.y, planet.z).addScaledVector(out, planet.radius + 4);
      owner.shield.visible = false;
    } else {
      if (!planet) return;
      owner = isl.parked.get(p.name) || isl.makeParked(p.name, p.color);
      ship = owner.group;
      ship.visible = true;
      ship.position.set(pad.x, pad.y + 0.55, pad.z);
      ship.rotation.set(0, isl.parkYaw, 0, "YXZ");
      // End where world.js puts the ship: radius + 15 m from the centre, facing away (transition adds 35 m ahead).
      const out = v3(-planet.x, -planet.y, -planet.z).normalize();
      ring = v3(planet.x, planet.y, planet.z).addScaledVector(out, planet.radius + 15).addScaledVector(forwardOf(isl.parkYaw, 0, v3()), -35);
    }
    owner.ensureModel?.(); // an impostor (no mesh yet) gets a stand-in at once; its real model arrives meanwhile
    owner.transit = true;
    try {
      const ctl = (kind === "land" ? Transition.playLanding : Transition.playTakeoff)({
        renderer, camera, spaceScene: game.space.scene, islandScene: isl.scene, ship, ringPosition: ring, padPosition: pad, duration: dur,
      });
      shot = { ctl, kind, player: p.name, owner, finished: false, ended: false };
      // Late start (a tick behind, or the page joined mid-shot): catch up in 0.1 s steps.
      for (let k = Math.max(0, elapsed); k > 0.02; k -= 0.1) ctl.update(Math.min(0.1, k));
    } catch (e) {
      console.warn("[render] transition failed:", e?.message || e);
      owner.transit = false;
      shot = null;
    }
  }
  function endShot(subject) {
    const s = shot;
    shot = null;
    white.style.opacity = 0;
    game.space.setNebulaFade(1);
    s.ctl.cancel?.();
    if (s.kind === "land") { game.space.scene.add(s.owner.group); s.owner.group.scale.setScalar(1); }
    else { game.island.scene.add(s.owner.group); }
    s.owner.transit = false;
    if (s.kind === "takeoff") game.island.disposeParked(s.player); // the ship left the pad: free its model now
    // Hand the camera back to the rig without a cut: it glides on from the shot's last pose.
    rig.scene = subject?.mode === "planet" ? "planet" : "space";
    rig.pos.copy(camera.position);
    rig.look.copy(camera.position).add(camera.getWorldDirection(v3()).multiplyScalar(12));
    rig.snapNext = false;
    rig.lastCut = (performance.now() - t0) / 1000; // keep the focus a while (no cut right after the shot)
    if (rig.cine !== "outro") rig.cine = ""; // an intro / reveal the shot cut short does not resume over the hand-back
  }
  function shotSubject(snap) {
    const subjectName = phone ? game.player : game.followed;
    const subject = subjectName ? snap.players.find((p) => p.name === subjectName) : null;
    if (!shot && subject && !subject.flags.dead) {
      const kind = subject.flags.landing ? "land" : subject.flags.takingOff ? "takeoff" : null;
      if (kind && `${subject.name}:${subject.startedAt}` !== lastShotKey) {
        if (camera.fov !== baseFov) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
        startShot(subject, kind);
      }
    }
    return subject;
  }
  function updateShot(dt, subject) {
    const s = shot;
    if (!s.finished) s.finished = !s.ctl.update(dt) || s.ctl.progress >= 1;
    else if (!s.ended) s.ended = !s.ctl.update(dt);
    white.style.opacity = s.ctl.whiteout || 0;
    // The sky dome hides the starfield; fade the additive nebula puffs with it (they would glow through the sky).
    game.space.setNebulaFade(1 - (s.ctl.skyMix || 0));
    // Hold the last pose until the dust settles and the server has switched the subject's mode (or 2 s at most).
    const want = s.kind === "land" ? "planet" : "space";
    const switched = !subject || subject.flags.dead || (subject.mode === want && !subject.flags.landing && !subject.flags.takingOff);
    if (s.finished) s.heldFor = (s.heldFor || 0) + dt;
    if (s.finished && ((s.ended && switched) || s.heldFor > 2)) endShot(subject);
  }

  // ---- events ----
  // The stream names who it is for: a phone `?player=<name>` (the server sends only that phone its toasts, mischief and
  // controller html), the TV `?screen=big` (no personal messages at all). A phone that changes its name (setPlayer) reconnects
  // under the new one; an old server ignores the query and sends everything, so the phone-side filters below stay.
  let es = null, esUrl = "";
  const eventsUrl = () => (phone ? (game.player ? `/events?player=${encodeURIComponent(game.player)}` : "/events") : "/events?screen=big");
  // One message from the stream (also the entry point for tests: game._internals.handle(m)).
  function handle(m) {
    switch (m.type) {
      case "world":
        if (game.world && game.world.round !== m.round) { game.space.clearForRound(); game.island.clearForRound(); }
        // world.entities is only in the message a screen gets on connect: keep the map when the key is absent.
        if (m.entities) entReset(m.entities);
        game.world = m;
        if (!warmed) warm();
        game.space.setWorld(m);
        game.island.setWorld(m);
        emit("world", m);
        break;
      case "tick":
        game.snaps.push(m);
        emit("tick", m);
        break;
      case "fx":
        (m.mode === "planet" ? game.island : game.space).fx(m);
        rig.note(m);
        emit("fx", m);
        break;
      case "toast":
        if (phone && m.player !== game.player) break;
        emit("toast", m);
        break;
      case "mischief": // what a rival did to ME (the server sends it to my stream only): the sound here, the screen effect on the page
      case "cooldown": // my verb fired and is ready again in `seconds`
        if (!game.player || m.player !== game.player) break;
        if (m.type === "mischief") worldSound.mischief(m);
        emit(m.type, m);
        break;
      case "announce":
        worldSound.announce(m);
        rig.note(m);
        emit("announce", m);
        break;
      case "entity":
        if (m.player && m.entity) { entNote(m.player, m.entity); if (m.entity.image && warmed) warmDrawn(); }
        emit("entity", m);
        break;
      default:
        emit(m.type, m);
    }
  }
  function connect() {
    const url = eventsUrl();
    if (es && esUrl === url) return;
    if (es) es.close();
    esUrl = url;
    es = new EventSource(url);
    es.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      handle(m);
    };
  }
  connect();

  // ---- perf overlay and POST /perf ----
  let overlay = null;
  if (showPerf) {
    overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;left:max(6px,env(safe-area-inset-left));bottom:6px;z-index:99;font:11px/1.35 ui-monospace,Menlo,monospace;color:#a5f3fc;background:rgba(2,6,23,.72);padding:5px 8px;border-radius:6px;pointer-events:none;white-space:pre";
    document.body.appendChild(overlay);
  }
  let last = { calls: 0, tris: 0 };
  function perfSample() {
    const s = game.perf.stats();
    return {
      player: game.player || (big ? "bigscreen" : "phone"), screen: big ? "big" : "phone", ua: navigator.userAgent,
      fps: +s.fps.toFixed(1), low1: +s.low1.toFixed(1), p90ms: +s.p90ms.toFixed(2), calls: last.calls, tris: last.tris,
      textures: renderer.info.memory.textures, tier: game.perf.tier, w: width, h: height, dpr: pr,
    };
  }
  const perfTimer = setInterval(() => {
    if (document.hidden || !game.perf.dts.length) return;
    fetch("/perf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(perfSample()) }).catch(() => {});
  }, PERF_POST_SECONDS * 1000);

  // ---- pre-warm (iPhone 1% lows): load the shared assets and compile both scenes once, before play starts ----
  let warmed = false, fxWarmed = false; // fxWarmed: the TV's second compile once A-010's lights are in (frame loop)
  function warm() {
    warmed = true;
    // The explorer is only prefetched (its rig file), never built here: building and disposing a retargeted A-008
    // explorer this early crashed WebKit now and then (dev/int-client A/B, 2026-10-09).
    import(assetUrl("A-008-rigs/person.js")).then((m) => m.loadPersonRig()).catch(() => {});
    Promise.all([loadAsset("ship", 0xffffff), loadAsset("chest", "closed"), loadAsset("boss"), loadAsset("rocks")]).then(([ship, chest]) => {
      if (disposed) return;
      const tmp = [ship, chest].filter(Boolean).map((a) => a.object3d);
      const holder = new THREE.Group();
      holder.position.set(0, -500, 0);
      tmp.forEach((o) => holder.add(o));
      game.island.scene.add(holder);
      try {
        renderer.compile(game.island.scene, camera);
        game.island.scene.remove(holder);
        game.space.scene.add(holder);
        renderer.compile(game.space.scene, camera);
      } catch (e) { console.warn("[render] pre-warm compile failed:", e?.message || e); }
      holder.removeFromParent();
      for (const a of [ship, chest]) a?.dispose?.();
    });
    if ([...entities.values()].some((e) => e && e.image)) warmDrawn();
  }
  // The drawn bodies' shader (a textured, vertex-coloured plush with a rim) compiled in both scenes before the first
  // drawing is built, so that build does not hitch. Only when a drawing exists: inflate.js stays lazy otherwise.
  let drawnWarmed = false;
  function warmDrawn() {
    if (drawnWarmed || disposed) return;
    drawnWarmed = true;
    entLoadInflate();
    entInflatePromise.then((inf) => {
      if (disposed || !inf || !inf.warmMaterial) return;
      const w = inf.warmMaterial();
      w.mesh.position.set(0, -500, 0);
      try {
        game.island.scene.add(w.mesh);
        renderer.compile(game.island.scene, camera);
        game.space.scene.add(w.mesh);
        renderer.compile(game.space.scene, camera);
      } catch (e) { /* the first real drawing compiles it instead */ }
      w.dispose();
    });
  }

  // ---- name tags: screen positions of every visible ship / explorer (bigscreen-extras, phone tags) ----
  const tagPool = [], tagOut = [];
  const tagV = v3();
  // Item shape { name, color, x, y, hp, maxHp, visible, dist, bot, flags } (CSS px; flags = the tick's flags of that player, read-only).
  // Visible players come first, nearest first, so a capped list (25) shows the nearest. In the lobby every ship is listed.
  // The returned array and its items are reused: read them before the next call.
  function projectPlayers() {
    const snap = game.lastSnap;
    const out = tagOut;
    out.length = 0;
    if (!snap) return out;
    const island = game.sceneName === "planet";
    const lobby = snap.phase === "lobby" && !island;
    const W = canvas.clientWidth || width, H = canvas.clientHeight || height;
    let i = 0;
    for (const p of snap.players) {
      if (p.flags.dead || p.flags.invisible || (phone && p.name === game.player)) continue;
      let obj = null, lift = 0;
      if (island) {
        if (p.mode !== "planet") continue;
        const e = game.island.explorers.get(p.name);
        if (!e || !e.group.visible) continue;
        obj = e.group; lift = 2.5;
      } else {
        if (p.mode !== "space") continue;
        const sv = game.space.ships.get(p.name);
        if (!sv || !sv.group.visible || sv.transit) continue;
        obj = sv.group; lift = lobby ? (phone ? 2.9 : 5.2) : 2.6;
      }
      tagV.setFromMatrixPosition(obj.matrixWorld);
      tagV.y += lift;
      const dist = tagV.distanceTo(camera.position);
      tagV.project(camera);
      const visible = tagV.z < 1 && Math.abs(tagV.x) < 1.1 && Math.abs(tagV.y) < 1.1 && (lobby || dist < (island ? 120 : 260));
      const o = tagPool[i] || (tagPool[i] = {});
      o.name = p.name; o.color = hexColor(p.color); o.hp = p.hp; o.maxHp = TUNING.shipHp; o.visible = visible; o.dist = dist;
      o.bot = !!p.flags.bot; o.flags = p.flags; // flags: the tick's flags object of that player (emp, inked, tractored, stun, ...), read-only
      o.x = ((tagV.x + 1) / 2) * W; o.y = ((1 - tagV.y) / 2) * H;
      out.push(o);
      i++;
    }
    // Insertion sort (a few dozen items at most, no allocation): visible first, then nearest first.
    for (let a = 1; a < out.length; a++) {
      const x = out[a];
      let b = a - 1;
      while (b >= 0 && (out[b].visible !== x.visible ? !out[b].visible : out[b].dist > x.dist)) { out[b + 1] = out[b]; b--; }
      out[b + 1] = x;
    }
    return out;
  }

  // ---- loop ----
  let raf = 0, lastT = performance.now(), lost = false, disposed = false, paused = false, lastHud = 0, lastOverlay = 0;
  const t0 = performance.now();
  function frame(now) {
    raf = 0;
    if (disposed || lost || paused || document.hidden) return;
    raf = requestAnimationFrame(frame);
    game.frames = (game.frames || 0) + 1;
    const dtMs = now - lastT;
    lastT = now;
    const dt = clamp(dtMs / 1000, 0, 0.1);
    const t = (now - t0) / 1000;
    const work0 = performance.now();
    applySize();
    const snap = game.snaps.sample();
    game.lastSnap = snap;
    // During the shot transition.js owns the camera; the followed player stays the same.
    const cam = shot ? rig.finish("chase", "space") : rig.update(dt, t, game, snap); // one reused result object, no allocation
    game.followed = cam.followed;
    const subject = shotSubject(snap);
    if (shot) cam.scene = shot.ctl.scene === game.island.scene ? "planet" : "space";
    game.sceneName = cam.scene;
    const ctx = { me: game.player, mePlayer: game.player ? snap.players.find((p) => p.name === game.player) : null, subject, cockpit: cam.mode === "cockpit", phone, big, t, serverNow: serverNow(), planet: game.space.planet };
    const W = cam.scene === "planet" ? game.island : game.space;
    W.update(dt, t, snap, ctx, camera);
    (W === game.space ? game.island : game.space).efx?.update(dt, t); // the hidden world's effects age too (WorldFx.update)
    if (shot) updateShot(dt, subject);
    game.shotState = shot ? { kind: shot.kind, player: shot.player, overlayAlpha: shot.ctl.overlayAlpha } : null;
    if (!shot) {
      // Camera shake and fov kick from the subject's animator (anim.js).
      // (not during the TV's planet reveal: the subject is far from that camera)
      const a = subject && rig.cine !== "reveal" ? (subject.mode === "planet" ? game.island.explorers.get(subject.name)?.anim : game.space.ships.get(subject.name)?.anim) : null;
      const shake = a ? a.shake || 0 : 0, kick = a ? a.fovKick || 0 : 0;
      if (shake > 0.001) {
        camera.position.x += (Math.sin(t * 61) + Math.sin(t * 43)) * 0.06 * shake;
        camera.position.y += (Math.sin(t * 53) + Math.cos(t * 37)) * 0.06 * shake;
      }
      const f = baseFov + kick + rig.fovAdd; // + the phone intro's fov kick (CameraRig.introBlend)
      if (Math.abs(f - camera.fov) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
    }
    const inCockpit = phone && cam.mode === "cockpit" && !shot;
    frames[0].visible = frames[1].visible = inCockpit && !cockpit;
    if (cockpit) showCockpit(inCockpit, W.scene);
    // The TV's A-010 systems each bring an always-on (zero-intensity) flare light: the light count changes once when they load, so
    // both scenes are compiled again right then (usually in the lobby), not at the first island view (the landing shot).
    if (big && !fxWarmed && game.space.efx?.ok && game.island.efx?.ok) {
      fxWarmed = true;
      try { renderer.compile(game.island.scene, camera); renderer.compile(game.space.scene, camera); } catch (e) { /* the first frame compiles it */ }
    }
    const tier = TIERS[game.perf.tier];
    game.space.farRocks = tier.far;
    // World look: bright and saturated without washing out: more exposure, a livelier island, bloom only on what glows.
    // The island blooms only what is really hot (sun disk, chest glow, sparks): a low threshold veiled the whole island.
    // A huge bang (the boss dies: game.space.flash 1 → 0 over FLASH_SECONDS) dims bloom and exposure, eased (smoothstep): held deep
    // while the blasts are brightest, no visible step when it ends. The sources are bounded as well (WorldFx.size caps every A-010
    // blast by its camera distance, Particles' maxAng caps a puff's screen size): this keeps the climax from blooming into white.
    const fl = cam.scene === "planet" ? 0 : game.space.flash, flash = fl * fl * (3 - 2 * fl);
    renderer.toneMappingExposure = (cam.scene === "planet" ? (big ? 0.98 : 1.02) : 1.05) * (1 - 0.3 * flash);
    bloom.strength = (cam.scene === "planet" ? 0.24 : 0.6) * (1 - 0.7 * flash);
    bloom.radius = cam.scene === "planet" ? 0.4 : 0.5;
    bloom.threshold = cam.scene === "planet" ? 1.0 : 0.9;
    renderer.info.reset();
    if (tier.bloom) {
      renderPass.scene = W.scene;
      composer.render(dt);
    } else renderer.render(W.scene, camera);
    last = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    if (listeners.frame?.length) emit("frame", t);
    const workMs = performance.now() - work0;
    if (game.perf.frame(dtMs, workMs, t)) applySize(true);
    if (now - lastHud > 100) {
      lastHud = now;
      emit("hud", computeHud(game));
    }
    if (overlay && now - lastOverlay > 250) {
      lastOverlay = now;
      const s = game.perf.stats();
      overlay.textContent = `${s.fps.toFixed(0)} fps  1% low ${s.low1.toFixed(0)}\nframe ${s.ms.toFixed(1)} ms  p90 ${s.p90ms.toFixed(1)}  cpu ${s.workMs.toFixed(1)}\ncalls ${last.calls}  tris ${(last.tris / 1000).toFixed(1)}k  tex ${renderer.info.memory.textures}\ntier ${game.perf.tier} (pr ${pr}${tier.bloom ? "" : ", no bloom"}${tier.far ? "" : ", near rocks"}${game.perf.capped ? ", 30 Hz cap" : ""})  ${width}x${height}`;
    }
  }
  const start = () => { if (!raf && !disposed && !lost && !paused && !document.hidden) { lastT = performance.now(); raf = requestAnimationFrame(frame); } };
  const onVis = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0), worldSound.hush()) : start()); // no held loop hums on in a hidden tab
  document.addEventListener("visibilitychange", onVis);
  const onLost = (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; worldSound.hush(); };
  const onRestored = () => { lost = false; applySize(true); start(); };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  start();

  return {
    setView(v) { if (["spectator", "chase", "cockpit"].includes(v)) { game.view = v; rig.snapNext = true; } },
    setPlayer(name) { game.player = name ? Contract.cleanName(name) || name : null; rig.snapNext = true; connect(); }, // a phone's stream is named after its player
    // pause(true): stop drawing (the phone's opaque draw screen covers the 3D view); the stream and the state keep up, pause(false) resumes.
    pause(on) { paused = !!on; if (paused) { cancelAnimationFrame(raf); raf = 0; worldSound.hush(); } else start(); }, // the frame loop drives the held loops: silence them
    on(event, cb) { (listeners[event] = listeners[event] || []).push(cb); return () => { listeners[event] = listeners[event].filter((f) => f !== cb); }; },
    hud: () => computeHud(game),
    sfx, // World look: the sound synth (same object as the `sfx` export): sfx.unlock() in a first tap, sfx.play("click")
    // The latest entity message of a player ({ type, rig, verbs, unlocked, parts, source, anims?, image? }) or null.
    entityOf: (name) => entities.get(name) || null,
    // Integration extras: the live camera and the screen position of every visible ship / explorer (name tags;
    // fresh after each "frame" event).
    camera,
    projectPlayers,
    // Extras for pages and tests (not part of the contract): live perf numbers and the camera's current state.
    perf: () => ({ ...perfSample(), scene: game.sceneName, followed: game.followed }),
    _internals: { game, renderer, camera, bloom, THREE, drawn: DRAWN, handle, worldSound },
    dispose() {
      disposed = true;
      white.remove();
      cancelAnimationFrame(raf);
      clearInterval(perfTimer);
      if (es) es.close();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      overlay?.remove();
      for (const s of game.space.ships.values()) s.dispose();
      for (const e of game.island.explorers.values()) e.dispose();
      for (const v of game.island.parked.values()) v.dispose();
      DRAWN.clear();
      worldSound.hush(); // no held loop outlives the game
      try { cockpit?.dispose?.(); } catch { /* already gone */ }
      composer.dispose?.();
      renderer.dispose();
    },
  };
}
