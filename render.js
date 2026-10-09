// Shared three.js renderer for the big screen (space.html) and the phones (controller.html).
// API (contract.js): startGame({ canvas, screen: "big"|"phone", view: "spectator"|"chase"|"cockpit", player }) → game
//   game.setView(view)  game.setPlayer(name)  game.dispose()  game.on(event, cb) → off()  game.hud()
// It owns the /events connection, interpolation (~100 ms behind the newest tick), the two scenes (space and island),
// adaptive quality, the ?perf overlay and POST /perf. contract.js and terrain.js must be loaded first (globals).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Sky } from "three/addons/objects/Sky.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const Contract = globalThis.Contract;
const Terrain = globalThis.Terrain;
const { TUNING, ROCK_TYPE_NAMES, OBJECTIVES, PERF_POST_SECONDS } = Contract;
const INTERP_DELAY_MS = 100;
const CUT_SECONDS = 8;

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
  planet: null, // A-004 still in progress: procedural shader planet below.
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
  uniform float uNearFade;
  varying vec2 vUv; varying vec4 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float a = iColor.a;
    if (uNearFade > 0.0) a *= smoothstep(iSize * 0.2 * uNearFade, iSize * 0.8 * uNearFade, -mv.z);
    if (a < 0.003 || iSize <= 0.0 || mv.z > 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    mv.xy += position.xy * iSize;
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
class BillboardBatch {
  constructor(capacity, { map = null, nearFade = 0, renderOrder = 10 } = {}) {
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
      fragmentShader: BB_FRAG,
      uniforms: { uMap: { value: map }, uUseMap: { value: map ? 1 : 0 }, uNearFade: { value: nearFade }, uFade: { value: 1 } },
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
  constructor(capacity) {
    this.batch = new BillboardBatch(capacity, { renderOrder: 12 });
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
      this.items.push({ m, t: 0, dur: 1, size: 1, flat: false });
    }
    this.next = 0;
  }
  spawn(pos, color, size, dur = 1.2, flat = false) {
    const it = this.items[this.next++ % this.items.length];
    it.m.position.copy(pos);
    it.m.material.color.set(color).multiplyScalar(2.5);
    it.t = 0; it.dur = dur; it.size = size; it.flat = flat; it.m.visible = true;
  }
  update(dt, camera) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t += dt;
      const u = it.t / it.dur;
      if (u >= 1) { it.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - u, 3);
      it.m.scale.setScalar(Math.max(0.01, it.size * e));
      it.m.material.opacity = (1 - u) * 0.9;
      if (it.flat) it.m.rotation.set(-Math.PI / 2, 0, 0);
      else it.m.quaternion.copy(camera.quaternion);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Space scene.
function nebulaBackdropTexture() {
  // Equirectangular violet/magenta nebula painted with additive soft blobs; baked once at low resolution (it is all
  // soft gradients) and box-filtered so the browser's gradient dithering does not show up as a grid when magnified.
  const w = 512, h = 256;
  return canvasTexture(w, h, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#05030f");
    grad.addColorStop(0.35, "#0c0a2e");
    grad.addColorStop(0.55, "#1a0f45");
    grad.addColorStop(0.75, "#0b1440");
    grad.addColorStop(1, "#04030c");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const rnd = seeded(1337);
    const palette = ["124,58,237", "219,39,119", "37,99,235", "147,51,234", "192,38,211", "56,189,248", "236,72,153"];
    g.globalCompositeOperation = "lighter";
    const blob = (x, y, r, col, a) => {
      for (const ox of [-w, 0, w]) {
        const rg = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        rg.addColorStop(0, `rgba(${col},${a})`);
        rg.addColorStop(0.5, `rgba(${col},${a * 0.35})`);
        rg.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = rg;
        g.fillRect(x + ox - r, y - r, r * 2, r * 2);
      }
    };
    // A few big clouds along a band (the "galactic plane"), then wisps.
    for (let i = 0; i < 14; i++) {
      const cx = rnd() * w, cy = h * (0.35 + rnd() * 0.3);
      const col = palette[Math.floor(rnd() * palette.length)];
      for (let k = 0; k < 26; k++) blob(cx + (rnd() - 0.5) * w * 0.22, cy + (rnd() - 0.5) * h * 0.25, (0.03 + rnd() * 0.09) * w, col, 0.05 + rnd() * 0.07);
    }
    for (let i = 0; i < 120; i++) blob(rnd() * w, h * (0.15 + rnd() * 0.7), (0.01 + rnd() * 0.03) * w, palette[i % palette.length], 0.05);
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

function makeStars(count) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const tints = [0xffffff, 0x93c5fd, 0xfde68a, 0xf9a8d4, 0xc4b5fd].map((c) => new THREE.Color(c));
  const rnd = seeded(99);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 2500;
    pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
    const c = tints[i % tints.length], b = 0.6 + rnd() * 1.6;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const dot = canvasTexture(32, 32, (c) => {
    const rg = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.3, "rgba(255,255,255,0.6)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = rg;
    c.fillRect(0, 0, 32, 32);
  });
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  return pts;
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
  return { object3d: group, materials: [mat, dark], engines: [v3(-0.35, 0, 1.5), v3(0.35, 0, 1.5)], dispose() {} };
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
  return { object3d: group, materials: [suit, white, visor], play() {}, update() {}, dispose() {} };
}

// One ship: A-009 default ship (or placeholder) in player colour, engine glow + trail, hex shield, animator.
class ShipView {
  constructor(space, name, color) {
    this.space = space;
    this.name = name;
    this.color = new THREE.Color(color);
    this.group = new THREE.Group();
    // body: the animator's root (its transform stays identity; the animator moves the model under its own pivot).
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.model = placeholderShip(color);
    this.body.add(this.model.object3d);
    this.engines = this.model.engines;
    this.shield = new THREE.Mesh(space.shieldGeo, space.shieldMat);
    this.shield.visible = false;
    this.shield.renderOrder = 13;
    this.group.add(this.shield);
    this.vel = v3();
    this.prev = null;
    this.trailAcc = 0;
    this.opacity = 1;
    this.transit = false; // true while transition.js owns the group (the landing / take-off shot)
    this.anim = null;
    this.modelReady = false;
    this.lastStarted = undefined;
    this.lastHp = null;
    space.scene.add(this.group);
    loadAsset("ship", color).then((asset) => {
      this.modelReady = true;
      if (!asset) return;
      if (this.disposed) return asset.dispose();
      this.body.remove(this.model.object3d);
      this.model.dispose();
      // Normalise to about 3.2 m long so every ship reads the same.
      const box = new THREE.Box3().setFromObject(asset.object3d);
      const len = Math.max(box.max.z - box.min.z, box.max.x - box.min.x, 0.01);
      asset.object3d.scale.setScalar(3.2 / len);
      this.body.add(asset.object3d);
      const s = asset.object3d.scale.x;
      const sock = ["engine_l", "engine_r"].map((k) => asset.sockets[k]).filter(Boolean);
      asset.object3d.updateMatrixWorld(true);
      this.engines = sock.length
        ? sock.map((o) => { const p = v3(); o.getWorldPosition(p); this.group.worldToLocal(p); return p; })
        : [v3(0, 0, 1.6 * s)];
      this.model = asset;
      this.opacity = -1; // force material refresh
    });
  }
  setOpacity(a) {
    if (this.opacity === a) return;
    this.opacity = a;
    for (const m of this.model.materials || []) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
      m.needsUpdate = true;
    }
  }
  ensureAnim() {
    if (this.anim || !Anim || !this.modelReady || this.disposed) return;
    try {
      this.anim = Anim.createAnimator("ship", this.body, { anims: animsFor(this.name, "ship"), sockets: this.model.sockets, size: 3.2, fx: false, onFx: animFx(this.space.particles, this.color) });
    } catch (e) { console.warn("[render] ship animator failed:", e?.message || e); this.anim = false; }
  }
  update(p, dt, t, ctx) {
    if (this.transit) return; // the shot places, reparents and hides it
    const g = this.group;
    const dead = p.flags.dead || p.mode !== "space";
    const hideSelf = ctx.cockpit && p.name === ctx.me;
    const flicker = p.flags.stun && Math.floor(t * 14) % 2 === 0;
    g.visible = !dead && !hideSelf && !flicker;
    if (dead) { this.prev = null; this.lastHp = null; return; }
    if (this.prev) this.vel.set(p.x - this.prev.x, p.y - this.prev.y, p.z - this.prev.z).divideScalar(Math.max(dt, 1e-3));
    this.prev = { x: p.x, y: p.y, z: p.z };
    g.position.set(p.x, p.y, p.z);
    g.rotation.set(p.pitch, p.yaw, p.roll, "YXZ");
    g.scale.setScalar(1);
    const P = ctx.planet;
    if (P && p.flags.landing) {
      // Someone else's landing (the followed player gets the full shot): a dive into the planet.
      const k = clamp((ctx.serverNow - (p.startedAt || 0)) / (TUNING.planet.landingSeconds * 1000), 0, 1);
      const e = k * k;
      g.position.set(lerp(p.x, P.x, e * 0.92), lerp(p.y, P.y, e * 0.92), lerp(p.z, P.z, e * 0.92));
      g.scale.setScalar(1 - 0.7 * e);
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
    this.shield.visible = !!(p.flags.shield || p.flags.spawnShield);
    this.setOpacity(p.flags.invisible ? (p.name === ctx.me ? 0.35 : 0.12) : 1);
    if (this.model.setEnginePower) this.model.setEnginePower(p.flags.boost ? 2.2 : 1);
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
    const fwd = forwardOf(p.yaw, p.pitch, this.space.tmp);
    g.updateMatrixWorld();
    for (const e of this.engines) {
      const w = this.space.tmp2.copy(e).applyMatrix4(g.matrixWorld);
      glow.addColor(w, 1.2 + boost * 1.0, this.color, 1, 2.5);
      glow.add(w.x, w.y, w.z, 0.45 + boost * 0.3, 2.5, 2.5, 2.5, 1);
      // One puff every 0.3 m travelled (at least 30 per second), so trails stay continuous at any speed.
      const n = Math.min(10, Math.max(dt * 30, (this.vel.length() * dt) / 0.3) + (this.trailAcc % 1));
      this.trailAcc = n;
      for (let k = 0; k < Math.floor(n); k++) {
        const j = ((k + Math.random()) / Math.max(1, Math.floor(n))) * dt;
        parts.emit(w.x - this.vel.x * j, w.y - this.vel.y * j, w.z - this.vel.z * j, -fwd.x * 3, -fwd.y * 3, -fwd.z * 3,
          0.5 + boost * 0.6, 0.55 + boost * 0.5, 0.08, this.color, 2.0, 0.5);
      }
    }
  }
  dispose() {
    this.disposed = true;
    this.anim?.dispose?.();
    this.group.removeFromParent();
    this.model.dispose?.();
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
function makePlanet(radius, landRange, phone) {
  const group = new THREE.Group();
  const sunDir = v3(0.8, 0.35, 0.5).normalize();
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
  // Landing ring: a billboarded glowing circle at radius + landRange that pulses.
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uR: { value: radius + landRange }, uIn: { value: 0 } },
    vertexShader: /* glsl */ `uniform float uR; varying vec2 vUv;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); mv.xy += position.xy * uR * 2.3; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uIn; varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.3;
        float pulse = 0.55 + 0.45 * sin(uTime * (3.0 + 4.0 * uIn));
        float ring = exp(-pow((d - 1.0) * 45.0, 2.0)) * (0.8 + uIn) + exp(-pow((d - 1.0) * 10.0, 2.0)) * 0.25;
        gl_FragColor = vec4(mix(vec3(0.2,1.0,1.4), vec3(1.0,1.6,1.4), uIn) * ring * pulse * 1.6, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
  ring.frustumCulled = false;
  ring.renderOrder = 9;
  group.add(body, clouds, atmo, ring);
  return {
    group,
    update(dt, t, inRange) {
      clouds.rotation.y += dt * 0.02;
      body.rotation.y += dt * 0.004;
      cloudMat.uniforms.uTime.value = t;
      ringMat.uniforms.uTime.value = t;
      ringMat.uniforms.uIn.value = damp(ringMat.uniforms.uIn.value, +inRange || 0, 4, dt);
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
    mesh.setColorAt(n, _bulletCol.set(b[4] || 0xffffff).multiplyScalar(3.5));
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

class SpaceWorld {
  constructor(renderer, { phone, big }) {
    this.phone = phone;
    this.big = big;
    this.tmp = v3();
    this.tmp2 = v3();
    const scene = (this.scene = new THREE.Scene());
    const bg = nebulaBackdropTexture();
    bg.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = bg;
    scene.backgroundIntensity = 0.85;
    scene.fog = new THREE.FogExp2(0x160c36, phone ? 0.0019 : 0.0015);
    scene.add(new THREE.HemisphereLight(0xa78bfa, 0x1e1b4b, 0.9));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.0);
    key.position.set(1, 0.8, 0.5);
    const rim = new THREE.DirectionalLight(0xff4fd8, 1.4);
    rim.position.set(-1, -0.3, -0.8);
    scene.add(key, rim);
    this.flareLight = new THREE.PointLight(0xfff2c4, 0, 260, 1.2);
    scene.add(this.flareLight);
    scene.add(makeStars(phone ? 2500 : 5000));
    this.nebula = new BillboardBatch(phone ? 40 : 70, { map: puffTexture(), nearFade: 1.6, renderOrder: 5 });
    scene.add(this.nebula.mesh);
    this.glow = new BillboardBatch(512, { renderOrder: 14 });
    scene.add(this.glow.mesh);
    this.particles = new Particles(phone ? 1400 : 3000);
    scene.add(this.particles.mesh);
    this.rings = new RingPool(6);
    scene.add(this.rings.group);
    this.shieldGeo = new THREE.SphereGeometry(2.6, 28, 18);
    this.shieldMat = SHIELD_MAT();
    // Bullets: thin bright streaks in the shooter's colour, one instanced draw.
    this.bullets = makeBulletMesh(2.6, 0.14, 512);
    scene.add(this.bullets);
    this.bossShots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(4), toneMapped: false, fog: false }), 64);
    this.bossShots.count = 0;
    this.bossShots.frustumCulled = false;
    scene.add(this.bossShots);
    this.ships = new Map();
    this.rockIndex = [];
    this.rockKey = null;
    this.boss = null;
    this.planet = null;
    this.farRocks = true;
    this.dummy = new THREE.Object3D();
  }

  // ---- world message ----
  setWorld(w) {
    const n = w.nebula;
    if (n && (!this.nebulaAt || this.nebulaAt.x !== n.x || this.nebulaAt.z !== n.z)) {
      this.nebulaAt = { ...n };
      const rnd = seeded(w.seed || 1);
      const cols = [0x7c3aed, 0xc026d3, 0xdb2777, 0x4f46e5, 0x9333ea, 0x2563eb].map((c) => new THREE.Color(c));
      const b = this.nebula;
      b.begin();
      for (let i = 0; i < b.capacity; i++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = n.radius * (0.75 + rnd() * 0.7);
        const c = cols[i % cols.length];
        b.add(n.x + Math.cos(th) * s * r, n.y + u * r * 0.5, n.z + Math.sin(th) * s * r, n.radius * (0.6 + rnd() * 0.7), c.r, c.g, c.b, 0.16 + rnd() * 0.14);
      }
      b.end();
    }
    this.setRocks(w);
    this.setBoss(w.targets.find((t) => t.kind === "boss"));
    this.setPlanet(w.planet);
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
      this.rockField = asset ? asset.createRockField({ templates: asset.templates, rocks: records, seed: w.seed || 1 }) : placeholderRockField(records);
      this.scene.add(this.rockField.object3d);
      this.rockIndex = records.map((r) => {
        const h = this.rockField.handles.get(r.id);
        const mesh = this.rockField.batches[h.type];
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
      const s = (b.radius || TUNING.boss.radius) / 9;
      // Hostile red accents (reference mothership): a slowly turning ring plus red lights, until A-001 gets its seams.
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(3), toneMapped: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(17 * s, 0.35 * s, 6, 64), ringMat);
      ring.rotation.x = Math.PI / 2.3;
      group.add(ring);
      this.boss = { group, ring, model: null, state: null, data: b, dead: false, scale: s };
      if (this.big) { this.boss.bar = bossBar(); this.scene.add(this.boss.bar); }
      loadAsset("boss").then((asset) => {
        const model = asset || placeholderBoss(s);
        if (asset) asset.object3d.scale.setScalar(s * 1.05);
        group.add(model.object3d);
        this.boss.model = model;
        this.boss.state = null;
        this.boss.crack = bossCrack(model.object3d, (b.radius || TUNING.boss.radius) * 1.05);
        group.add(this.boss.crack.lines);
        this.applyBossState();
      });
    }
    const wasDead = this.boss.dead;
    this.boss.data = b;
    this.boss.dead = !!b.dead;
    this.boss.group.position.set(b.x, b.y, b.z);
    if (b.dead && !wasDead && this.boss.seenAlive) {
      const pos = v3(b.x, b.y, b.z);
      this.particles.burst(pos, new THREE.Color(0xff6a2a), 160, 40, 2.2, 6, 1, { boost: 3, drag: 1.2, spread: 10 });
      this.particles.burst(pos, new THREE.Color(0xffd27a), 80, 25, 1.6, 9, 2, { boost: 3, drag: 1.6, spread: 6 });
      this.rings.spawn(pos, 0xff7a3a, 70, 1.6);
    }
    if (!b.dead) this.boss.seenAlive = true;
    this.applyBossState();
  }
  applyBossState() {
    const B = this.boss;
    if (!B?.model) return;
    const b = B.data;
    const state = b.armour <= 0 ? "armour_broken" : b.cracked || b.armour < (TUNING.boss.armour || 100) ? "armour_cracked" : "armour_intact";
    if (state !== B.state) {
      B.state = state;
      B.model.setState?.(state);
    }
    B.group.visible = !b.dead;
    if (B.bar) B.bar.visible = !b.dead;
  }
  bossAlive() { return this.boss && !this.boss.dead ? this.boss.data : null; }

  setPlanet(p) {
    if (!p) {
      if (this.planet) { this.planet.view.group.removeFromParent(); this.planet.view.dispose(); this.planet = null; }
      return;
    }
    if (this.planet && this.planet.x === p.x && this.planet.z === p.z) return;
    if (this.planet) { this.planet.view.group.removeFromParent(); this.planet.view.dispose(); }
    const view = makePlanet(p.radius, p.landRange, this.phone);
    view.group.position.set(p.x, p.y, p.z);
    view.group.scale.setScalar(0.01);
    this.scene.add(view.group);
    this.planet = { ...p, view, born: performance.now() };
    this.particles.burst(v3(p.x, p.y, p.z), new THREE.Color(0x60a5fa), 120, 60, 1.8, 8, 2, { boost: 2.5, spread: p.radius });
  }

  // ---- per-frame ----
  update(dt, t, snap, ctx, camera) {
    this.glow.begin();
    // Ships.
    const seen = new Set();
    for (const p of snap.players) {
      seen.add(p.name);
      let s = this.ships.get(p.name);
      if (!s) { s = new ShipView(this, p.name, p.color); this.ships.set(p.name, s); }
      s.update(p, dt, t, ctx);
    }
    for (const [name, s] of this.ships) if (!seen.has(name)) { s.dispose(); this.ships.delete(name); }
    this.shieldMat.uniforms.uTime.value = t;
    // Bullets (oriented along their motion): only the space ones (mode 0).
    writeBullets(this.bullets, this.dummy, snap.bullets, 0);
    const d = this.dummy;
    // Boss shots: red orbs with a hostile glow.
    const red = this.red || (this.red = new THREE.Color(0xff2a2a));
    let n = 0;
    for (const s of snap.bossShots) {
      if (n >= 64) break;
      d.position.set(s[1], s[2], s[3]);
      d.rotation.set(t * 3, t * 2, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.bossShots.setMatrixAt(n++, d.matrix);
      this.glow.add(s[1], s[2], s[3], 4.5, red.r * 2.5, red.g * 2.5, red.b * 2.5, 1);
    }
    d.rotation.set(0, 0, 0);
    this.bossShots.count = n;
    this.bossShots.instanceMatrix.needsUpdate = true;
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
    // Boss.
    const B = this.boss;
    if (B && !B.dead) {
      const b = B.data;
      B.ring.rotation.z += dt * 0.25;
      B.model?.update?.(dt);
      B.group.rotation.y += dt * 0.05;
      const hostile = this.red;
      const s = B.scale;
      for (let i = 0; i < 6; i++) {
        const a = t * 0.25 + (i / 6) * Math.PI * 2;
        this.tmp.set(Math.cos(a) * 17 * s, 0, Math.sin(a) * 17 * s).applyEuler(B.ring.rotation).add(B.group.position);
        this.glow.add(this.tmp.x, this.tmp.y, this.tmp.z, 3.2 * s, hostile.r * 3, hostile.g * 3, hostile.b * 3, 0.9);
      }
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.4);
      this.glow.add(b.x, b.y, b.z, 30 * s, 0.35 * pulse, 0.03, 0.05, 0.5);
      // World hint: a glowing hairline crack shows where the armour is weakest (brighter once drilling cracks it).
      if (B.crack) {
        const on = b.armour > 0;
        B.crack.lines.visible = on;
        if (on) {
          const cracked = b.armour < (TUNING.boss.armour || 100);
          const k = (cracked ? 1.4 : 0.8) * (0.7 + 0.3 * Math.sin(t * 3.1)) * (0.85 + 0.15 * Math.sin(t * 17));
          B.crack.mat.color.setRGB(3.2 * k, 1.2 * k, 0.3 * k);
          B.group.updateMatrixWorld();
          const pts = B.crack.glowPoints;
          for (let i = 0; i < pts.length; i++) {
            const w = this.tmp.copy(pts[i]).applyMatrix4(B.group.matrixWorld);
            this.glow.add(w.x, w.y, w.z, (cracked ? 2.2 : 1.4) * s, 1.6 * k, 0.55 * k, 0.12 * k, 0.9);
          }
        }
      }
      if (b.armour <= 0) this.glow.add(b.x, b.y, b.z, 18 * s * (0.9 + 0.2 * pulse), 3, 1.3, 0.3, 1);
      if (B.bar) {
        B.bar.position.set(b.x, b.y + 19 * s, b.z);
        B.bar.material.uniforms.uFill.value = clamp(b.hp / (b.maxHp || 1), 0, 1);
        const dist = camera.position.distanceTo(B.bar.position);
        B.bar.material.uniforms.uSize.value.set(clamp(dist * 0.12, 14, 60), clamp(dist * 0.0085, 1, 4.2));
      }
    }
    // Planet.
    if (this.planet) {
      const P = this.planet;
      const k = clamp((performance.now() - P.born) / 1500, 0, 1);
      P.view.group.scale.setScalar(0.01 + 0.99 * (1 - Math.pow(1 - k, 3)));
      // World hint: the landing ring pulses harder as the followed ship (mine on a phone) gets close.
      const me = ctx.subject;
      const d = me && me.mode === "space" ? Math.hypot(me.x - P.x, me.y - P.y, me.z - P.z) - P.radius : Infinity;
      P.view.update(dt, t, d < P.landRange ? 1 : clamp(1 - (d - P.landRange) / 60, 0, 1) * 0.5);
    }
    this.glow.end();
    this.particles.update(dt);
    this.rings.update(dt, camera);
    this.cullRocks(camera.position, t);
  }

  fx(m) {
    const pos = v3(m.pos.x, m.pos.y, m.pos.z);
    const c = new THREE.Color(m.color ?? 0xffffff);
    const size = m.size || 1;
    const P = this.particles;
    switch (m.kind) {
      case "explode":
        P.burst(pos, new THREE.Color(0xffd08a), 10, size * 3, 0.35, size * 2.4, size * 0.6, { boost: 3 });
        P.burst(pos, c, Math.min(60, 14 + size * 4), 6 + size * 2.5, 1.1, Math.max(0.6, size * 0.35), 0.1, { boost: 2.5, drag: 1.2, spread: size * 0.6 });
        break;
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
      case "land":
      case "spark":
      default:
        P.burst(pos, c, 12, 8, 0.5, 0.8, 0.1, { boost: 3 });
    }
  }

  clearForRound() {
    this.particles.clear();
  }
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

// Placeholder rock field when A-002 is unavailable: one InstancedMesh per type, flat-shaded low-poly.
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
// Island scene (mode "planet"): terrain from Terrain.height, cheap animated water, sky, palms, rocks, chests, explorers.
const SUN_DIR = v3(-0.55, 0.32, -0.62).normalize(); // warm late-afternoon sun
function islandSky(big) {
  if (big) {
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
    return sky;
  }
  // Phone: a gradient dome with a soft sun (one cheap draw).
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `uniform vec3 uSun; varying vec3 vD;
      void main(){
        float y = clamp(vD.y, -0.1, 1.0);
        vec3 col = mix(vec3(1.0,0.78,0.55), vec3(0.22,0.5,0.88), pow(max(y,0.0), 0.45));
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

function chestView() {
  const wood = new THREE.Color(0x7a4a22), gold = new THREE.Color(0xffc44d);
  const paint = (g, c) => {
    g = g.toNonIndexed();
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    return g;
  };
  const body = mergeGeometries([
    paint(new THREE.BoxGeometry(1.3, 0.75, 0.85).translate(0, 0.375, 0), wood),
    paint(new THREE.BoxGeometry(1.36, 0.12, 0.9).translate(0, 0.1, 0), gold),
    paint(new THREE.BoxGeometry(0.14, 0.78, 0.9).translate(-0.45, 0.39, 0), gold),
    paint(new THREE.BoxGeometry(0.14, 0.78, 0.9).translate(0.45, 0.39, 0), gold),
    paint(new THREE.BoxGeometry(0.22, 0.26, 0.06).translate(0, 0.6, -0.45), gold),
  ]);
  const lid = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.43, 0.43, 1.3, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.43), wood),
    paint(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(-0.45, 0, 0.43), gold),
    paint(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0.45, 0, 0.43), gold),
  ]);
  lid.computeVertexNormals();
  body.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.5, flatShading: true });
  const g = new THREE.Group();
  const b = new THREE.Mesh(body, mat);
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.75, 0.43);
  const l = new THREE.Mesh(lid, mat);
  l.position.set(0, 0, -0.43);
  lidPivot.add(l);
  g.add(b, lidPivot);
  g.scale.setScalar(1.25);
  return { group: g, lid: lidPivot, dispose() { body.dispose(); lid.dispose(); mat.dispose(); } };
}

class IslandWorld {
  constructor(renderer, { phone, big }) {
    this.phone = phone;
    this.big = big;
    const scene = (this.scene = new THREE.Scene());
    const horizon = new THREE.Color(0xf3c9a0);
    scene.fog = new THREE.Fog(horizon, 160, phone ? 650 : 900);
    scene.background = horizon;
    scene.add(islandSky(big));
    scene.add(new THREE.HemisphereLight(0xbfdcff, 0x8a6a3a, 1.2));
    const sun = new THREE.DirectionalLight(0xffd7a0, 3.0);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    scene.add(sun);
    this.glow = new BillboardBatch(128, { renderOrder: 14 });
    this.particles = new Particles(phone ? 600 : 1200);
    this.rings = new RingPool(4);
    scene.add(this.glow.mesh, this.particles.mesh, this.rings.group);
    this.explorers = new Map();
    this.chests = new Map();
    this.seed = null;
    // ?island=procedural keeps the procedural island (fallback; the A-005 kit is the default on both screens).
    this.noKit = new URLSearchParams(location.search).get("island") === "procedural";
    this.tmp = v3();
    // Island PvP: laser streaks (bullets with mode 1), a spawn-shield bubble per explorer.
    this.bullets = makeBulletMesh(1.3, 0.07, 128);
    this.dummy = new THREE.Object3D();
    scene.add(this.bullets);
    this.shieldGeo = new THREE.SphereGeometry(1.25, 20, 12);
    this.shieldMat = SHIELD_MAT();
    // Parked ships on the landing pad (world.island.parked), keyed by player.
    this.parked = new Map();
    this.parkedList = [];
    this.parkYaw = 0;
    // X marks on the sand over every buried chest (world hint: they glint).
    const bar = (rot) => new THREE.BoxGeometry(2.6, 0.06, 0.38).rotateY(rot);
    this.xGeo = mergeGeometries([bar(Math.PI / 4), bar(-Math.PI / 4)]);
    this.xMat = new THREE.MeshLambertMaterial({ color: 0x8b2a14, emissive: 0x3a0a02, polygonOffset: true, polygonOffsetFactor: -2 });
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

  // Bay of a player on the pad: same formula as world.js (slot = index in the tick's player list).
  bay(slot) {
    const L = this.landing || { x: 0, z: 0 };
    return { x: L.x + (slot % 4) * 4 - 6, z: L.z + Math.floor(slot / 4) * 4 };
  }
  groundAt(x, z) { return this.height ? Math.max(0, this.height(x, z)) : 0; }

  // A parked ship (A-009 or placeholder) in the player's colour, nose pointing the way take-off leaves.
  makeParked(player, color) {
    const group = new THREE.Group();
    const v = { group, model: placeholderShip(color), transit: false };
    group.add(v.model.object3d);
    this.scene.add(group);
    loadAsset("ship", color).then((asset) => {
      if (!asset) return;
      if (v.disposed) return asset.dispose();
      group.remove(v.model.object3d);
      const box = new THREE.Box3().setFromObject(asset.object3d);
      asset.object3d.scale.setScalar(3.2 / Math.max(box.max.z - box.min.z, box.max.x - box.min.x, 0.01));
      group.add(asset.object3d);
      v.model = asset;
    });
    this.parked.set(player, v);
    return v;
  }
  disposeParked(player) {
    const v = this.parked.get(player);
    if (!v) return;
    v.disposed = true;
    v.group.removeFromParent();
    v.model.dispose?.();
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
    // Take-off leaves the planet the way world.js points the ship (away from the planet, towards the spawn).
    if (w.planet) this.parkYaw = Math.atan2(w.planet.x, w.planet.z);
    const seen = new Set();
    for (const c of w.chests || []) {
      seen.add(c.id);
      let v = this.chests.get(c.id);
      if (!v) {
        v = chestView();
        const mound = new THREE.Mesh(this.moundGeo || (this.moundGeo = new THREE.SphereGeometry(1.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), this.moundMat || (this.moundMat = new THREE.MeshLambertMaterial({ color: 0xc9a46a })));
        mound.scale.y = 0.5;
        v.mound = mound;
        v.x = new THREE.Mesh(this.xGeo, this.xMat);
        this.scene.add(v.group, mound, v.x);
        this.chests.set(c.id, v);
        const id = c.id;
        loadAsset("chest", c.buried && !(c.dug > 0) ? "buried" : "closed").then((a) => {
          if (!a) return;
          if (this.chests.get(id) !== v) return a.dispose();
          v.group.clear();
          v.dispose();
          v.group.scale.setScalar(1);
          v.group.add(a.object3d);
          v.asset = a;
        });
      }
      const y = this.height(c.x, c.z);
      if (c.open && !v.data?.open) {
        const p = v3(c.x, y + 1, c.z);
        this.particles.burst(p, new THREE.Color(0xffd34d), 90, 12, 1.6, 0.9, 0.1, { boost: 3, grav: 6, drag: 0.8 });
        this.rings.spawn(p, 0xffd34d, 10, 1.2, true);
      }
      v.data = { ...c, y };
      v.group.position.set(c.x, y, c.z);
      v.mound.position.set(c.x, y - 0.05, c.z);
      // Lay the X on the local slope.
      const H = this.height, sx = (H(c.x + 1, c.z) - H(c.x - 1, c.z)) / 2, sz = (H(c.x, c.z + 1) - H(c.x, c.z - 1)) / 2;
      v.x.position.set(c.x, y + 0.04, c.z);
      v.x.rotation.set(Math.atan(sz), 0, -Math.atan(sx));
      v.x.visible = c.buried && !(c.dug > 0) && !c.open;
    }
    for (const [id, v] of this.chests) if (!seen.has(id)) { v.group.removeFromParent(); v.mound.removeFromParent(); v.x.removeFromParent(); v.dispose(); this.chests.delete(id); }
  }

  update(dt, t, snap, ctx, camera) {
    this.glow.begin();
    if (this.waterMat) this.waterMat.uniforms.uTime.value = t;
    this.kit?.update(dt, camera);
    // Chests: buried = sand mound + glint; dig progress raises the chest; open = lid up and gold glow.
    for (const v of this.chests.values()) {
      const c = v.data;
      if (!c) continue;
      const dug = c.buried ? clamp(c.dug || 0, 0, 1) : 1;
      if (v.asset) {
        // A-006: buried variant until digging starts, then the closed chest rises out of a shrinking mound.
        const A = v.asset;
        const want = c.open ? "open" : c.buried && dug <= 0 ? "buried" : "closed";
        if (want === "open") { if (A.state !== "open" && A.state !== "opening") A.open(); }
        else if (A.state !== want) A.setState(want);
        A.update(dt);
        v.group.position.y = want === "buried" ? c.y : c.y - 1.2 * (1 - dug);
        v.mound.visible = c.buried && dug > 0 && dug < 1;
      } else {
        v.group.position.y = c.y - 1.15 * (1 - dug);
        v.mound.visible = c.buried && dug < 1;
        v.lid.rotation.x = damp(v.lid.rotation.x, c.open ? -1.9 : 0, 4, dt);
      }
      v.mound.scale.set(1 - dug * 0.6, 0.5 * (1 - dug * 0.8), 1 - dug * 0.6);
      const gx = c.x, gz = c.z, gy = c.y;
      if (c.buried && dug < 1) {
        const tw = Math.max(0, Math.sin(t * 3 + gx)) ** 8;
        this.glow.add(gx + 0.3, gy + 0.55, gz, 1.2 + tw * 2.5, 3 * tw + 0.4, 2.4 * tw + 0.3, 0.8 * tw + 0.1, 1);
      } else {
        const pulse = 0.75 + 0.25 * Math.sin(t * 2.5 + gz);
        this.glow.add(gx, gy + 0.9, gz, (c.open ? 9 : 4.5) * pulse, 1.6, 1.15, 0.3, 0.9);
        if (c.open) this.glow.add(gx, gy + 5, gz, 10, 1.2, 0.9, 0.3, 0.5);
      }
    }
    // Explorers.
    const seen = new Set();
    const pickup = TUNING.island.pickupRange || 3;
    for (const p of snap.players) {
      if (p.mode !== "planet" || p.flags.dead || p.flags.takingOff) continue; // take-off: the explorer is in the ship
      seen.add(p.name);
      let e = this.explorers.get(p.name);
      if (!e) e = this.addExplorer(p, ctx);
      const g = e.group;
      const prev = e.prev || p;
      const speed = Math.hypot(p.x - prev.x, p.z - prev.z) / Math.max(dt, 1e-3);
      e.prev = { x: p.x, y: p.y, z: p.z };
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(0, p.yaw, 0);
      const flick = p.flags.stun && Math.floor(t * 14) % 2 === 0;
      g.visible = !(ctx.cockpit && p.name === ctx.me) && !flick;
      const ground = this.groundAt(p.x, p.z);
      // World hint: standing still on an X, the explorer kneels and pats the ground.
      let onX = null;
      if (!p.flags.digging && speed < 0.8 && p.y <= ground + 0.4) {
        for (const v of this.chests.values()) {
          const c = v.data;
          if (c && c.buried && !c.open && (c.dug || 0) < 1 && Math.hypot(c.x - p.x, c.z - p.z) < pickup) { onX = c; break; }
        }
      }
      const hasClip = (n) => (e.model.clips || []).some((c) => c.name === n);
      const stepping = e.stepOutUntil > t;
      let clip = p.flags.digging ? "dig" : p.y > ground + 0.4 ? "jump" : speed > TUNING.island.walkSpeed * 1.3 ? "run" : speed > 0.6 ? "walk" : onX ? "kneel" : "idle";
      if (stepping && clip === "idle") clip = "step_out";
      if (clip === "kneel" && !hasClip("kneel")) clip = "idle";
      if (clip === "step_out" && !hasClip("step_out")) clip = "idle";
      if (clip !== e.clip) { e.clip = clip; try { e.model.play?.(clip, clip === "step_out" ? { loop: false, restart: true } : undefined); } catch { /* clip missing in placeholder */ } }
      // Without a kneel clip, crouch procedurally (the animator owns the model's own transform, the root is ours).
      if (onX && !hasClip("kneel")) g.position.y -= 0.35;
      if (onX && Math.random() < dt * 2.2) {
        const f = forwardOf(p.yaw, 0, this.tmp);
        this.particles.burst(v3(p.x + f.x * 0.6, ground + 0.1, p.z + f.z * 0.6), DIRT, 5, 1.6, 0.6, 0.3, 0.1, { boost: 1, grav: 8, drag: 1 });
      }
      // Procedural layer (anim.js) on top of the clips; its dt feeds the mixer (hit-stop freezes it).
      this.ensureExplorerAnim(e, p.name);
      let animDt = dt;
      if (e.anim) {
        if (e.pendingStepOut) { e.pendingStepOut = false; e.anim.trigger("stepOut", {}); }
        if (e.lastStarted !== undefined && p.startedAt !== e.lastStarted && p.slot && p.slot !== "mount") e.anim.trigger(p.slot, { verb: p.action });
        if (e.lastHp !== null && p.hp < e.lastHp - 0.5) e.anim.trigger("hit", { intensity: clamp((e.lastHp - p.hp) / 20, 0.4, 1.5) });
        animDt = e.anim.update(dt, { speed: clamp(speed / (TUNING.island.walkSpeed * TUNING.island.runMultiplier), 0, 1), grounded: p.y <= ground + 0.4, digging: !!p.flags.digging });
        if (!Number.isFinite(animDt)) animDt = dt;
      }
      e.lastStarted = p.startedAt;
      e.lastHp = p.hp;
      e.model.update?.(animDt);
      e.shield.visible = !!(p.flags.spawnShield || p.flags.shield);
      if (p.flags.digging && Math.random() < dt * 14) {
        const f = forwardOf(p.yaw, 0, this.tmp);
        this.particles.emit(p.x + f.x * 0.8, ground + 0.2, p.z + f.z * 0.8, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.8, 0.35, 0.15, DIRT, 1.0, 0.5, 12);
      }
      this.glow.add(p.x, p.y + 2.3, p.z, 0.5, e.color.r * 3, e.color.g * 3, e.color.b * 3, 1);
    }
    for (const [name, e] of this.explorers) if (!seen.has(name)) { e.group.removeFromParent(); e.anim?.dispose?.(); e.model.dispose?.(); this.explorers.delete(name); }
    this.shieldMat.uniforms.uTime.value = t;
    // Parked ships: one per world.island.parked entry, on its bay. Someone else's take-off lifts it away.
    const colorOf = new Map(snap.players.map((p) => [p.name, p]));
    const want = new Set();
    for (const q of this.parkedList) {
      want.add(q.player);
      const p = colorOf.get(q.player);
      let v = this.parked.get(q.player);
      if (!v) v = this.makeParked(q.player, p?.color ?? 0x94a3b8);
      if (v.transit) continue;
      const g = v.group;
      g.visible = !v.hidden;
      g.position.set(q.x, this.groundAt(q.x, q.z) + 0.55, q.z);
      g.rotation.set(0, this.parkYaw, 0);
      if (p?.flags.takingOff) {
        const k = clamp((ctx.serverNow - (p.startedAt || 0)) / (TUNING.planet.takeoffSeconds * 1000), 0, 1);
        g.position.y += k * k * 60;
        g.rotation.x = k * 0.6;
        if (k > 0.97) g.visible = false;
        if (Math.random() < dt * 30) this.particles.emit(g.position.x, g.position.y - 0.4, g.position.z, (Math.random() - 0.5) * 2, -6, (Math.random() - 0.5) * 2, 0.6, 1.0, 0.2, new THREE.Color(p.color), 2.5, 0.5);
      }
    }
    for (const name of [...this.parked.keys()]) if (!want.has(name) && !this.parked.get(name).transit) this.disposeParked(name);
    // Island bullets (mode 1).
    writeBullets(this.bullets, this.dummy, snap.bullets, 1);
    this.glow.end();
    this.particles.update(dt);
    this.rings.update(dt, camera);
  }

  addExplorer(p, ctx) {
    const group = new THREE.Group();
    const e = { group, model: placeholderExplorer(p.color), color: new THREE.Color(p.color), clip: null, anim: null, modelReady: false, lastStarted: undefined, lastHp: null };
    e.shield = new THREE.Mesh(this.shieldGeo, this.shieldMat);
    e.shield.position.y = 0.95;
    e.shield.scale.set(1, 1.15, 1);
    e.shield.visible = false;
    e.shield.renderOrder = 13;
    // Just landed: the explorer climbs out next to the parked ship (A-008 step_out + the animator's stepOut).
    if (p.action === "land" && ctx.serverNow - (p.startedAt || 0) < TUNING.planet.landingSeconds * 1000 + 2500) {
      e.pendingStepOut = true;
      e.stepOutUntil = ctx.t + 1.5;
    }
    group.add(e.model.object3d, e.shield);
    this.scene.add(group);
    this.explorers.set(p.name, e);
    loadAsset("explorer", p.color).then((asset) => {
      e.modelReady = true;
      if (!asset || this.explorers.get(p.name) !== e) return asset?.dispose();
      group.remove(e.model.object3d);
      const box = new THREE.Box3().setFromObject(asset.object3d);
      const h = Math.max(box.max.y - box.min.y, 0.01);
      asset.object3d.scale.setScalar(1.8 / h);
      group.add(asset.object3d);
      e.model = asset;
      e.clip = null;
    });
    return e;
  }

  ensureExplorerAnim(e, name) {
    if (e.anim || e.anim === false || !Anim || !e.modelReady) return;
    try {
      // Root = the explorer group; the animator moves the model (and the bubble) under its own pivot.
      e.anim = Anim.createAnimator("person", e.group, { anims: animsFor(name, "person"), sockets: e.model.sockets, clips: e.model.clips, play: e.model.play, size: 1.8, fx: false, onFx: animFx(this.particles, e.color) });
    } catch (err) { console.warn("[render] explorer animator failed:", err?.message || err); e.anim = false; }
  }

  fx(m) {
    const pos = v3(m.pos.x, m.pos.y, m.pos.z);
    const c = new THREE.Color(m.color ?? 0xffffff);
    const P = this.particles;
    if (m.kind === "dig") P.burst(pos.setY(pos.y + 0.3), DIRT, 18, 5, 0.8, 0.45, 0.15, { boost: 1, grav: 14, drag: 0.6 });
    else if (m.kind === "treasure") { P.burst(pos.setY(pos.y + 1), new THREE.Color(0xffd34d), 120, 14, 1.8, 1, 0.1, { boost: 3, grav: 5, drag: 0.7 }); this.rings.spawn(pos, 0xffd34d, 14, 1.4, true); }
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
class Snapshots {
  constructor() {
    this.list = [];
    this.offsets = [];
    this.latest = null;
    this.latestAt = 0;
  }
  push(tick) {
    const local = Date.now();
    const t = Number.isFinite(tick.t) ? tick.t : local;
    this.offsets.push(local - t);
    if (this.offsets.length > 45) this.offsets.shift();
    this.offset = Math.min(...this.offsets);
    const entry = { t, tick, players: new Map(tick.players.map((p) => [p.name, p])), bullets: new Map(tick.bullets.map((b) => [b[0], b])), shots: new Map(tick.bossShots.map((b) => [b[0], b])) };
    // Ignore out-of-order ticks.
    if (this.list.length && t <= this.list[this.list.length - 1].t) return;
    this.list.push(entry);
    if (this.list.length > 30) this.list.shift();
    this.latest = tick;
    this.latestAt = local;
  }
  sample() {
    const L = this.list;
    if (!L.length) return { players: [], bullets: [], bossShots: [], flares: [] };
    const rt = Date.now() - (this.offset || 0) - INTERP_DELAY_MS;
    let a = L[0], b = L[0];
    if (rt >= L[L.length - 1].t) a = b = L[L.length - 1];
    else if (rt > L[0].t) {
      for (let i = L.length - 2; i >= 0; i--) if (L[i].t <= rt) { a = L[i]; b = L[i + 1]; break; }
    }
    const u = b === a ? 0 : clamp((rt - a.t) / (b.t - a.t), 0, 1);
    const players = [];
    for (const pb of b.tick.players) {
      const pa = a.players.get(pb.name);
      if (!pa || pa.mode !== pb.mode || pa.flags?.dead !== pb.flags?.dead) { players.push(pb); continue; }
      const near = u < 0.5 ? pa : pb;
      players.push({
        ...pb, flags: near.flags,
        x: lerp(pa.x, pb.x, u), y: lerp(pa.y, pb.y, u), z: lerp(pa.z, pb.z, u),
        yaw: lerpAngle(pa.yaw, pb.yaw, u), pitch: lerp(pa.pitch, pb.pitch, u), roll: lerpAngle(pa.roll, pb.roll, u),
        shieldEnergy: lerp(pa.shieldEnergy, pb.shieldEnergy, u), boostEnergy: lerp(pa.boostEnergy, pb.boostEnergy, u),
      });
    }
    // Bullets: [id, x, y, z, color, mode, dx, dy, dz] (mode 0 = space, 1 = island; old servers send no mode).
    const track = (listB, mapA, color) => listB.map((q) => {
      const p = mapA.get(q[0]);
      if (!p) return color ? [q[0], q[1], q[2], q[3], q[4], q[5] || 0] : q;
      const x = lerp(p[1], q[1], u), y = lerp(p[2], q[2], u), z = lerp(p[3], q[3], u);
      return [q[0], x, y, z, q[4], q[5] || 0, q[1] - p[1], q[2] - p[2], q[3] - p[3]];
    });
    return { players, bullets: track(b.tick.bullets, a.bullets, true), bossShots: track(b.tick.bossShots, a.shots, false), flares: b.tick.flares, phase: b.tick.phase };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cockpit window frame (procedural, drawn in clip space so it fits any aspect; leaves > 70% of the view clear).
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
  }
  objectiveSpace(game, P) {
    const boss = game.space.bossAlive();
    if (boss) return v3(boss.x, boss.y, boss.z);
    if (game.world?.planet) return v3(game.world.planet.x, game.world.planet.y, game.world.planet.z);
    return P ? null : v3(0, 0, -100);
  }
  pickFocus(game, players, t) {
    const live = players.filter((p) => !p.flags.dead);
    const onIsland = live.filter((p) => p.mode === "planet");
    const pool = onIsland.length ? onIsland : live;
    if (!pool.length) return null;
    // Progress: island beats space, digging beats walking; in space, closest to the objective.
    const score = (p) => {
      if (p.mode === "planet") return 1e6 + (p.flags.digging ? 1e5 : 0) - this.chestDistance(game, p);
      const o = this.objectiveSpace(game, p);
      return (game.world?.planet ? 5e5 : 0) + (p.flags.drilling ? 1e4 : 0) - (o ? Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) : 0);
    };
    // A landing or take-off is the best shot in the game: follow that player at once (the shot itself is never cut).
    const shot = live.find((p) => p.flags.landing || p.flags.takingOff);
    if (shot && shot.name !== this.focus && !live.some((p) => p.name === this.focus && (p.flags.landing || p.flags.takingOff))) {
      this.focus = shot.name; this.lastCut = t; this.snapNext = true; this.side *= -1;
      return shot;
    }
    const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
    const current = pool.find((p) => p.name === this.focus);
    const sceneOf = (p) => (p.mode === "planet" ? "planet" : "space");
    if (!current || (best.name !== this.focus && t - this.lastCut >= CUT_SECONDS && (sceneOf(best) !== sceneOf(current) || score(best) > score(current) + 25))) {
      if (!current || t - this.lastCut >= CUT_SECONDS || !this.focus) {
        if (best.name !== this.focus) { this.focus = best.name; this.lastCut = t; this.snapNext = true; this.side *= -1; }
      }
    }
    return pool.find((p) => p.name === this.focus) || best;
  }
  chestDistance(game, p) {
    const cs = (game.world?.chests || []).filter((c) => !c.open);
    return cs.length ? Math.min(...cs.map((c) => Math.hypot(c.x - p.x, c.z - p.z))) : 0;
  }
  update(dt, t, game, snap) {
    const cam = this.camera;
    const me = game.player ? snap.players.find((p) => p.name === game.player) : null;
    let mode = game.view;
    let subject = me && !me.flags.dead ? me : null;
    if (mode !== "spectator" && !subject) mode = "spectator";
    if (mode === "spectator") subject = this.pickFocus(game, snap.players, t);
    else this.focus = subject.name;
    const scene = subject?.mode === "planet" ? "planet" : "space";
    if (scene !== this.scene) { this.scene = scene; this.snapNext = true; }
    const desired = this.tmp, look = v3();
    let lamPos = 5, lamLook = 8;
    const phase = snap.phase;
    if (!subject) {
      // Nobody to follow: slow orbit around the boss nebula (or the spawn area in the lobby).
      const c = game.world?.nebula || { x: 0, y: 0, z: -300, radius: 80 };
      const a = t * 0.05;
      const R = (c.radius || 80) * 2.2;
      desired.set(c.x + Math.sin(a) * R, c.y + R * 0.3, c.z + Math.cos(a) * R);
      look.set(c.x, c.y, c.z);
      lamPos = lamLook = 1.5;
    } else if (scene === "planet") {
      const H = game.island.height || (() => 0);
      const P = v3(subject.x, subject.y, subject.z);
      const F = forwardOf(subject.yaw, 0, this.f);
      if (mode === "cockpit") {
        cam.position.set(P.x, P.y + 1.6, P.z);
        cam.rotation.set(subject.pitch || 0, subject.yaw, 0, "YXZ");
        this.pos.copy(cam.position);
        this.snapNext = false;
        return this.finish(mode, scene);
      }
      if (mode === "chase") {
        desired.set(P.x - F.x * 6.5, P.y + 3.4, P.z - F.z * 6.5);
        look.set(P.x + F.x * 4, P.y + 1.3, P.z + F.z * 4);
      } else {
        const a = t * 0.12 + this.side;
        desired.set(P.x + Math.sin(a) * 15, P.y + 7, P.z + Math.cos(a) * 15);
        look.set(P.x, P.y + 1.2, P.z);
        lamPos = 1.6; lamLook = 3;
      }
      desired.y = Math.max(desired.y, H(desired.x, desired.z) + 1.5, 1.2);
    } else {
      const P = v3(subject.x, subject.y, subject.z);
      const F = forwardOf(subject.yaw, subject.pitch, this.f);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(subject.pitch, subject.yaw, subject.roll, "YXZ"));
      const U = v3(0, 1, 0).applyQuaternion(q);
      if (mode === "cockpit") {
        cam.position.copy(P).addScaledVector(F, 0.4).addScaledVector(U, 0.55);
        cam.quaternion.copy(q);
        this.pos.copy(cam.position);
        this.snapNext = false;
        return this.finish(mode, scene);
      }
      if (mode === "chase") {
        desired.copy(P).addScaledVector(F, -9).addScaledVector(U, 3.2);
        look.copy(P).addScaledVector(F, 14);
        lamPos = 7; lamLook = 12;
      } else if (phase === "lobby") {
        const a = t * 0.08;
        desired.set(P.x + Math.sin(a) * 30, P.y + 10, P.z + Math.cos(a) * 30 + 10);
        look.set(P.x * 0.3, P.y, P.z - 30);
        lamPos = lamLook = 1.5;
      } else {
        // Cinematic follow: behind and to the side of the subject, the objective in frame beyond it.
        const O = this.objectiveSpace(game, P);
        const dir = O ? O.clone().sub(P) : F.clone();
        const dist = dir.length();
        dir.normalize();
        if (!Number.isFinite(dir.x) || dist < 1e-3) dir.copy(F);
        const side = v3().crossVectors(dir, v3(0, 1, 0)).normalize();
        if (!Number.isFinite(side.x) || side.lengthSq() < 0.5) side.set(1, 0, 0);
        const near = O && dist < 60;
        desired.copy(P).addScaledVector(dir, near ? -26 : -20).addScaledVector(side, (near ? 14 : 8) * this.side).add(v3(0, near ? 10 : 6, 0));
        look.copy(P).addScaledVector(dir, Math.min(dist * 0.45, 40));
        lamPos = 2; lamLook = 2.6;
      }
    }
    if (this.snapNext) {
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
    return this.finish(mode, scene);
  }
  finish(mode, scene) { return { mode, scene, followed: this.focus }; }
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
class Perf {
  constructor() {
    this.dts = [];
    this.work = [];
    this.tier = 0;
    this.sinceChange = 0;
    this.goodFor = 0;
    this.blockUntil = {};
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
    this.sinceChange++;
    if (this.sinceChange < 60) return false;
    const last = this.dts.slice(-60), lastWork = this.work.slice(-60);
    const p90 = this.pct(last, 0.9);
    if (p90 > 18 && this.tier < TIERS.length - 1) {
      this.blockUntil[this.tier] = nowS + 20; // don't climb back into the tier we just left for 20 s
      return this.set(this.tier + 1);
    }
    // Step up after 5 s of headroom: CPU work under 12 ms and frames on time (vsync-capped intervals are ~16.7 ms).
    if (p90 <= 17.5 && this.pct(lastWork, 0.9) < 12) this.goodFor += dtMs / 1000;
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
  const me = meP ? { name: meP.name, color: meP.color, mode: meP.mode, hp: meP.hp, maxHp: TUNING.shipHp, score: meP.score, shieldEnergy: meP.shieldEnergy, boostEnergy: meP.boostEnergy, flags: meP.flags,
    respawnIn: meP.respawnIn ?? null, drawingsLeft: meP.drawingsLeft || null } : null;
  const boss = world?.targets?.find((t) => t.kind === "boss");
  const bossAlive = boss && !boss.dead;
  let objective = null, bar = 0, status = "", objPos = null;
  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  if (phase === "lobby") {
    objective = null;
    status = "WAITING FOR PLAYERS";
  } else if (meP && meP.mode === "planet") {
    objective = "chest";
    const cs = (world?.chests || []).filter((c) => !c.open);
    const near = cs.reduce((best, c) => (!best || Math.hypot(c.x - meP.x, c.z - meP.z) < Math.hypot(best.x - meP.x, best.z - meP.z) ? c : best), null);
    if (near) {
      const d = Math.hypot(near.x - meP.x, near.z - meP.z);
      objPos = { x: near.x, y: meP.y, z: near.z };
      if (meP.flags.digging || (near.buried && near.dug > 0 && d < 4)) { bar = near.dug || 0; status = `DIGGING ${Math.round((near.dug || 0) * 100)}%`; }
      else { bar = clamp(1 - d / 120, 0, 1); status = `${near.buried ? "BURIED CHEST" : "CHEST"} ${Math.round(d)} M`; }
    }
  } else if (bossAlive) {
    const ref = meP && meP.mode === "space" ? meP : null;
    const d = ref ? Math.max(0, dist3(ref, boss) - boss.radius) : null;
    objPos = boss;
    const near = d !== null && d < (world.nebula?.radius || TUNING.nebula.radius);
    if (boss.armour <= 0) { objective = "destroyBoss"; bar = boss.hp / (boss.maxHp || 1); status = `BOSS HP ${Math.ceil(boss.hp)} / ${boss.maxHp}`; }
    else if (near) { objective = "crackBoss"; bar = boss.armour / (TUNING.boss.armour || 100); status = `ARMOUR ${Math.round(bar * 100)}%  ·  HOLD DRILL CLOSE`; }
    else { objective = "boss"; bar = boss.hp / (boss.maxHp || 1); status = d !== null ? `DISTANCE TO BOSS ${Math.round(d)} M` : "FIND THE BOSS IN THE NEBULA"; }
  } else if (world?.planet) {
    objective = "planet";
    const P = world.planet;
    objPos = P;
    if (meP) {
      const d = Math.max(0, dist3(meP, P) - P.radius);
      bar = clamp(1 - (d - P.landRange) / 250, 0, 1);
      status = d <= P.landRange ? "IN RANGE: LAND NOW" : `DISTANCE TO PLANET ${Math.round(d)} M`;
    } else status = "THE PLANET HAS APPEARED";
  }
  if (phase === "scoreboard") { objective = null; status = "ROUND OVER"; }
  const objectiveText = objective ? OBJECTIVES[objective] : phase === "lobby" ? "GET READY" : phase === "scoreboard" ? "ROUND OVER" : "";
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
  const scores = (tick?.players || []).map((p) => ({ name: p.name, color: p.color, score: p.score, mode: p.mode, ready: !!p.flags?.ready, bot: !!p.flags?.bot, dead: !!p.flags?.dead, me: p.name === meName })).sort((a, b) => b.score - a.score);
  return {
    phase, clock, clockText: formatClock(clock), round: tick?.round ?? world?.round ?? 0,
    objective, objectiveText, bar: clamp(bar, 0, 1), status,
    assists: phase === "assists", note: phase === "assists" ? "ASSISTS ON" : "",
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
  const rig = new CameraRig(camera);
  const frames = [cockpitFrame(), cockpitFrame()];
  game.space.scene.add(frames[0]);
  game.island.scene.add(frames[1]);

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
    const b = isl.bay(slot);
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
    game.space.nebula.material.uniforms.uFade.value = 1;
    s.ctl.cancel?.();
    if (s.kind === "land") { game.space.scene.add(s.owner.group); s.owner.group.scale.setScalar(1); }
    else { game.island.scene.add(s.owner.group); }
    s.owner.transit = false;
    // Hand the camera back to the rig without a cut: it glides on from the shot's last pose.
    rig.scene = subject?.mode === "planet" ? "planet" : "space";
    rig.pos.copy(camera.position);
    rig.look.copy(camera.position).add(camera.getWorldDirection(v3()).multiplyScalar(12));
    rig.snapNext = false;
    rig.lastCut = (performance.now() - t0) / 1000; // keep the focus a while (no cut right after the shot)
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
    game.space.nebula.material.uniforms.uFade.value = 1 - (s.ctl.skyMix || 0);
    // Hold the last pose until the dust settles and the server has switched the subject's mode (or 2 s at most).
    const want = s.kind === "land" ? "planet" : "space";
    const switched = !subject || subject.flags.dead || (subject.mode === want && !subject.flags.landing && !subject.flags.takingOff);
    if (s.finished) s.heldFor = (s.heldFor || 0) + dt;
    if (s.finished && ((s.ended && switched) || s.heldFor > 2)) endShot(subject);
  }

  // ---- events ----
  const es = new EventSource("/events");
  es.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    switch (m.type) {
      case "world":
        if (game.world && game.world.round !== m.round) { game.space.clearForRound(); game.island.particles.clear(); }
        // world.entities is only in the message a screen gets on connect: keep the map when the key is absent.
        if (m.entities) { entities.clear(); for (const [k, v] of Object.entries(m.entities)) entities.set(k, v); }
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
        emit("fx", m);
        break;
      case "toast":
        if (phone && m.player !== game.player) break;
        emit("toast", m);
        break;
      case "entity":
        if (m.player && m.entity) entities.set(m.player, m.entity);
        emit("entity", m);
        break;
      default:
        emit(m.type, m);
    }
  };

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
  let warmed = false;
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
  }

  // ---- name tags: screen positions of every visible ship / explorer (bigscreen-extras, phone tags) ----
  const tagPool = [];
  const tagV = v3();
  function projectPlayers() {
    const snap = game.lastSnap;
    const out = [];
    if (!snap) return out;
    const island = game.sceneName === "planet";
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
        obj = sv.group; lift = 2.6;
      }
      tagV.setFromMatrixPosition(obj.matrixWorld);
      tagV.y += lift;
      const dist = tagV.distanceTo(camera.position);
      tagV.project(camera);
      const visible = tagV.z < 1 && Math.abs(tagV.x) < 1.1 && Math.abs(tagV.y) < 1.1 && dist < (island ? 120 : 260);
      const o = tagPool[i] || (tagPool[i] = {});
      o.name = p.name; o.color = hexColor(p.color); o.hp = p.hp; o.maxHp = TUNING.shipHp; o.visible = visible; o.dist = dist;
      o.x = ((tagV.x + 1) / 2) * W; o.y = ((1 - tagV.y) / 2) * H;
      out.push(o);
      i++;
    }
    return out;
  }

  // ---- loop ----
  let raf = 0, lastT = performance.now(), lost = false, disposed = false, lastHud = 0, lastOverlay = 0;
  const t0 = performance.now();
  function frame(now) {
    raf = 0;
    if (disposed || lost || document.hidden) return;
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
    const cam = shot ? { mode: "chase", scene: "space", followed: rig.focus } : rig.update(dt, t, game, snap);
    game.followed = cam.followed;
    const subject = shotSubject(snap);
    if (shot) cam.scene = shot.ctl.scene === game.island.scene ? "planet" : "space";
    game.sceneName = cam.scene;
    const ctx = { me: game.player, mePlayer: game.player ? snap.players.find((p) => p.name === game.player) : null, subject, cockpit: cam.mode === "cockpit", phone, big, t, serverNow: serverNow(), planet: game.space.planet };
    const W = cam.scene === "planet" ? game.island : game.space;
    W.update(dt, t, snap, ctx, camera);
    if (shot) updateShot(dt, subject);
    game.shotState = shot ? { kind: shot.kind, player: shot.player, overlayAlpha: shot.ctl.overlayAlpha } : null;
    if (!shot) {
      // Camera shake and fov kick from the subject's animator (anim.js).
      const a = subject ? (subject.mode === "planet" ? game.island.explorers.get(subject.name)?.anim : game.space.ships.get(subject.name)?.anim) : null;
      const shake = a ? a.shake || 0 : 0, kick = a ? a.fovKick || 0 : 0;
      if (shake > 0.001) {
        camera.position.x += (Math.sin(t * 61) + Math.sin(t * 43)) * 0.06 * shake;
        camera.position.y += (Math.sin(t * 53) + Math.cos(t * 37)) * 0.06 * shake;
      }
      const f = baseFov + kick;
      if (Math.abs(f - camera.fov) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
    }
    frames[0].visible = frames[1].visible = cam.mode === "cockpit" && !shot;
    const tier = TIERS[game.perf.tier];
    game.space.farRocks = tier.far;
    renderer.toneMappingExposure = cam.scene === "planet" ? (big ? 0.6 : 0.95) : 1.0;
    bloom.strength = cam.scene === "planet" ? 0.25 : 0.65;
    bloom.threshold = cam.scene === "planet" ? 0.95 : 0.82;
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
      overlay.textContent = `${s.fps.toFixed(0)} fps  1% low ${s.low1.toFixed(0)}\nframe ${s.ms.toFixed(1)} ms  p90 ${s.p90ms.toFixed(1)}  cpu ${s.workMs.toFixed(1)}\ncalls ${last.calls}  tris ${(last.tris / 1000).toFixed(1)}k  tex ${renderer.info.memory.textures}\ntier ${game.perf.tier} (pr ${pr}${tier.bloom ? "" : ", no bloom"}${tier.far ? "" : ", near rocks"})  ${width}x${height}`;
    }
  }
  const start = () => { if (!raf && !disposed && !lost && !document.hidden) { lastT = performance.now(); raf = requestAnimationFrame(frame); } };
  const onVis = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0)) : start());
  document.addEventListener("visibilitychange", onVis);
  const onLost = (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; };
  const onRestored = () => { lost = false; applySize(true); start(); };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  start();

  return {
    setView(v) { if (["spectator", "chase", "cockpit"].includes(v)) { game.view = v; rig.snapNext = true; } },
    setPlayer(name) { game.player = name ? Contract.cleanName(name) || name : null; rig.snapNext = true; },
    on(event, cb) { (listeners[event] = listeners[event] || []).push(cb); return () => { listeners[event] = listeners[event].filter((f) => f !== cb); }; },
    hud: () => computeHud(game),
    // Integration extras: the live camera and the screen position of every visible ship / explorer (name tags;
    // fresh after each "frame" event).
    camera,
    projectPlayers,
    // Extras for pages and tests (not part of the contract): live perf numbers and the camera's current state.
    perf: () => ({ ...perfSample(), scene: game.sceneName, followed: game.followed }),
    _internals: { game, renderer, camera, bloom, THREE },
    dispose() {
      disposed = true;
      white.remove();
      cancelAnimationFrame(raf);
      clearInterval(perfTimer);
      es.close();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      overlay?.remove();
      for (const s of game.space.ships.values()) s.dispose();
      composer.dispose?.();
      renderer.dispose();
    },
  };
}
