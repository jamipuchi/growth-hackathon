// Procedural animation for any entity (PLAN.md section 6, "Animations"). Browser ES module, three@0.160.0.
//
//   const animator = createAnimator(type, root, { anims, sockets, clips, play, materials, size, fx, onFx });
//   animator.trigger(slot, { intensity = 1, verb, dirX, dirZ });     // on a tick action change
//   const animDt = animator.update(dt, state);                      // every frame; feed animDt to explorer.update()
//   animator.shake (0..1), animator.fovKick (degrees), animator.flame (0..1+), animator.hitStop (seconds left)
//   animator.dispose();
//   state = { speed 0..1, turn -1..1, grounded, boost, shield, dead, drilling, digging, invisible }
//
// The animator never touches `root`'s own transform (the game places it). It moves its children under one pivot
// group, so spring offsets, squash and stretch, spins and shakes are all local to the entity. Limb motion comes from
// the rig's clips when `play` (the A-009 explorer.play) and `clips` are given and the clip exists; otherwise the
// pivot carries the whole motion. Everything on the hot path uses preallocated typed arrays and scalars.
import * as THREE from "three";
import "./anims.js";

const Anims = globalThis.Anims;

// Spring channels. Position channels are in units of the entity size; rotations in radians.
const PX = 0, PY = 1, PZ = 2, RX = 3, RY = 4, RZ = 5, ST = 6, FL = 7, FV = 8, SH = 9, CL = 10, NCH = 11;
const OMEGA = [15, 16, 15, 14, 11, 10, 17, 9, 8, 17, 9];
const ZETA = [0.42, 0.38, 0.42, 0.45, 0.5, 0.5, 0.33, 0.8, 0.85, 0.4, 0.9];

const P = {};
Anims.PROFILES.forEach((name, i) => (P[name] = i));
const SC_SPIN = 1, SC_WARP = 2, SC_BLINK = 3, SC_CELEB = 4, SC_BARREL = 5, SC_STEPOUT = 6, SC_POP = 7;
const EV_VEL = 0, EV_POS = 1, EV_FX = 2, EV_FLASH = 3, EV_SHAKE = 4, EV_SCRIPT = 5;
const NEV = 40, NSC = 4, NP = 128;
const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutBack = (t) => { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Shared fx material: one draw call per animator. Premultiplied output; `aAdd` 1 = additive glow, 0 = normal blend.
const fxUniforms = { uScale: { value: 500 } };
let fxMaterial = null;
function getFxMaterial() {
  if (fxMaterial) return fxMaterial;
  fxMaterial = new THREE.ShaderMaterial({
    uniforms: fxUniforms,
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aAdd; attribute vec3 aColor;
      uniform float uScale; varying float vA; varying float vAdd; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 160.0); vA = aAlpha; vAdd = aAdd; vC = aColor; }`,
    fragmentShader: `varying float vA; varying float vAdd; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a * vA;
        gl_FragColor = vec4(vC * a, a * (1.0 - vAdd)); }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  return fxMaterial;
}
// Tell the fx how big a world unit is on screen: call on resize or fov change (heightPx = drawing buffer height).
export function setFxView(heightPx, fovDeg) {
  fxUniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

let shieldGeo = null;
const shieldVert = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const shieldFrag = `uniform float uT; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float s = 0.5 + 0.5 * sin(vP.y * 14.0 + vP.x * 6.0 + uT * 3.0);
    float a = uA * (0.07 + f * 0.8 + f * 0.2 * s);
    gl_FragColor = vec4(vec3(0.35, 0.85, 1.0) * a, a); }`;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export function createAnimator(type, root, opts = {}) {
  const anims = opts.anims || Anims.get(type);
  const kind = Anims.ROWS[type] ? type : Anims.FALLBACK;
  const rigid = kind === "ship" || kind === "car";
  const biped = kind === "person";
  const isShip = kind === "ship";
  const onFx = typeof opts.onFx === "function" ? opts.onFx : null;
  const builtinFx = opts.fx !== false;
  const fovDeg = opts.fovDeg ?? 6;

  const pivot = new THREE.Group();
  pivot.name = "anim_pivot";
  pivot.rotation.order = "YXZ";
  for (const child of root.children.slice()) pivot.add(child);
  root.add(pivot);

  const box = new THREE.Box3().setFromObject(root);
  const hasBox = !box.isEmpty();
  const size = opts.size || (hasBox ? Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) : 1);
  const center = new THREE.Vector3();
  if (hasBox) { box.getCenter(center); pivot.worldToLocal(center); }

  const sockets = {};
  root.traverse((o) => {
    if (o.name && o.name.startsWith("socket_")) sockets[o.name.slice(7)] = o;
  });
  Object.assign(sockets, opts.parts || {}, opts.sockets || {});

  const mats = [];
  const seen = new Set();
  const addMat = (m) => { if (m && !seen.has(m)) { seen.add(m); mats.push(m); } };
  if (opts.materials) opts.materials.forEach(addMat);
  else root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(addMat); });
  const nm = mats.length;
  const mEmis = new Float32Array(nm * 3), mInt = new Float32Array(nm), mOp = new Float32Array(nm), mTrans = new Uint8Array(nm), mIsEngine = new Uint8Array(nm);
  mats.forEach((m, i) => {
    if (m.emissive) { mEmis[i * 3] = m.emissive.r; mEmis[i * 3 + 1] = m.emissive.g; mEmis[i * 3 + 2] = m.emissive.b; mInt[i] = m.emissiveIntensity; }
    mOp[i] = m.opacity; mTrans[i] = m.transparent ? 1 : 0;
    mIsEngine[i] = m.name === "engine_glow" ? 1 : 0;
  });

  const clipNames = new Map();
  for (const c of opts.clips || []) clipNames.set(typeof c === "string" ? c : c.name, typeof c === "string" ? 1 : c.duration);
  const play = typeof opts.play === "function" ? opts.play : null;
  const clipDriven = !!play && clipNames.size > 0;
  const hasClip = (n) => !!n && clipNames.has(n);

  // Springs
  const x = new Float32Array(NCH), v = new Float32Array(NCH), tg = new Float32Array(NCH), om = Float32Array.from(OMEGA), ze = Float32Array.from(ZETA), ov = new Float32Array(NCH);

  // Timed events (kicks, fx, flashes, shakes, scripts)
  const evT = new Float32Array(NEV).fill(-1), evK = new Uint8Array(NEV), evA = new Float32Array(NEV), evB = new Float32Array(NEV), evS = new Array(NEV).fill(null), evE = new Array(NEV).fill(null);
  const sId = new Uint8Array(NSC), sT = new Float32Array(NSC), sD = new Float32Array(NSC), sK = new Float32Array(NSC);

  // Particles
  const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pSize = new Float32Array(NP), pAlpha = new Float32Array(NP), pAddA = new Float32Array(NP);
  const pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP), pMax = new Float32Array(NP), pS0 = new Float32Array(NP), pS1 = new Float32Array(NP), pDrag = new Float32Array(NP), pGrav = new Float32Array(NP), pC0 = new Float32Array(NP * 3), pC1 = new Float32Array(NP * 3), pA0 = new Float32Array(NP);
  let pHead = 0, pAlive = 0, points = null;
  if (builtinFx) {
    const geo = new THREE.BufferGeometry();
    const dyn = (arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    geo.setAttribute("position", dyn(pPos, 3));
    geo.setAttribute("aColor", dyn(pCol, 3));
    geo.setAttribute("aSize", dyn(pSize, 1));
    geo.setAttribute("aAlpha", dyn(pAlpha, 1));
    geo.setAttribute("aAdd", dyn(pAddA, 1));
    points = new THREE.Points(geo, getFxMaterial());
    points.frustumCulled = false;
    points.renderOrder = 10;
    points.visible = false;
    points.name = "anim_fx";
  }

  // Shield bubble
  let shield = null;
  const shieldRadius = opts.shieldRadius || size * (rigid ? 0.56 : 0.72);
  {
    shieldGeo = shieldGeo || new THREE.IcosahedronGeometry(1, 2);
    const mat = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uA: { value: 1 } }, vertexShader: shieldVert, fragmentShader: shieldFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    shield = new THREE.Mesh(shieldGeo, mat);
    shield.position.copy(center);
    shield.visible = false;
    shield.name = "anim_shield";
    shield.frustumCulled = false;
    pivot.add(shield);
  }

  const animator = { type, root, pivot, size, shake: 0, fovKick: 0, flame: 0, hitStop: 0, flash: 0, hidden: false, dead: false };

  // Runtime scalars
  let time = 0, shakeImp = 0, shakeCont = 0, freezeT = 0, flash = 0, flashDirty = false, cloakApplied = false;
  let speedS = 0, turnS = 0, phase = 0, prevStep = 0, airT = 0, wasGrounded = true;
  let deadFlag = false, deadPose = 0, deadT = 0, deadClip = null, prevStateDead = false;
  let pBoost = false, pShield = false, pDrill = false, pDig = false, pInvis = false;
  let oneShotT = 0, curClip = null, curAct = null, celebT = 0, emitAcc = 0, drillAcc = 0, digPrev = 0, trailAcc = 0;
  let idleP = P[(anims.idle && anims.idle.profile) || "none"], moveP = P[(anims.move && anims.move.profile) || "none"];
  let us = 1, zs = 1, xyk = 1; // script scale overlays
  const lastFire = new Float32Array(Anims.PROFILES.length).fill(-9);
  if (clipDriven && hasClip("idle")) { curAct = play("idle", { fade: 0 }); curClip = "idle"; }

  // ---------- events ----------
  function queue(delay, k, a, b, s, e) {
    if (delay <= 0) { runEv(k, a, b, s, e); return; }
    for (let i = 0; i < NEV; i++) {
      if (evT[i] < 0) { evT[i] = delay; evK[i] = k; evA[i] = a; evB[i] = b; evS[i] = s; evE[i] = e; return; }
    }
  }
  function runEv(k, a, b, s, e) {
    if (k === EV_VEL) v[a] += b;
    else if (k === EV_POS) x[a] += b;
    else if (k === EV_FX) emitFx(s, e, b);
    else if (k === EV_FLASH) flash = Math.max(flash, a);
    else if (k === EV_SHAKE) shakeImp = Math.max(shakeImp, a);
    else if (k === EV_SCRIPT) startScript(a, b);
  }
  const kick = (ch, vel, delay = 0) => queue(delay, EV_VEL, ch, vel, null, null);
  const pos = (ch, d, delay = 0) => queue(delay, EV_POS, ch, d, null, null);
  const flashAt = (f, delay = 0) => queue(delay, EV_FLASH, f, 0, null, null);

  function startScript(id, dur, k = 1) {
    let slot = -1;
    for (let i = 0; i < NSC; i++) { if (sId[i] === id) { slot = i; break; } if (slot < 0 && sId[i] === 0) slot = i; }
    if (slot < 0) slot = 0;
    sId[slot] = id; sT[slot] = 0; sD[slot] = dur; sK[slot] = k;
    animator.hidden = false;
  }
  const script = (id, dur, k = 1, delay = 0) => { if (delay > 0) queue(delay, EV_SCRIPT, id, dur, null, null); else startScript(id, dur, k); };

  // ---------- particles ----------
  const rnd = () => Math.random();
  function emitP(px, py, pz, vx, vy, vz, life, s0, s1, r0, g0, b0, r1, g1, b1, alpha, add, drag, grav) {
    const i = pHead; pHead = (pHead + 1) % NP;
    const i3 = i * 3;
    pPos[i3] = px; pPos[i3 + 1] = py; pPos[i3 + 2] = pz;
    pVel[i3] = vx; pVel[i3 + 1] = vy; pVel[i3 + 2] = vz;
    pC0[i3] = r0; pC0[i3 + 1] = g0; pC0[i3 + 2] = b0; pC1[i3] = r1; pC1[i3 + 1] = g1; pC1[i3 + 2] = b1;
    pLife[i] = life; pMax[i] = life; pS0[i] = s0; pS1[i] = s1; pA0[i] = alpha; pAddA[i] = add; pDrag[i] = drag; pGrav[i] = grav;
    pSize[i] = s0; pAlpha[i] = alpha;
    pAlive++;
  }
  // World position of a named socket into _p, facing (-Z) in _d, with _q the pivot's world rotation.
  function locate(name) {
    pivot.getWorldQuaternion(_q);
    _d.set(0, 0, -1).applyQuaternion(_q);
    if (name === "ground" || name === "feet") {
      root.getWorldPosition(_p);
      if (name === "ground") _p.addScaledVector(_d, size * 0.3);
      return;
    }
    const s = name && name !== "root" && name !== "centre" && name !== "center" ? sockets[name] : null;
    if (s) { s.updateWorldMatrix(true, false); s.getWorldPosition(_p); } else { _p.copy(center); pivot.localToWorld(_p); }
  }
  function rndDir() {
    const a = rnd() * TAU, c = rnd() * 2 - 1, s = Math.sqrt(1 - c * c);
    _v.set(Math.cos(a) * s, c, Math.sin(a) * s);
  }
  function emitFx(kindName, sockName, k) {
    if (onFx) { locate(sockName); onFx(kindName, sockName, k, _p, _d, animator); }
    if (!builtinFx) return;
    locate(sockName);
    const u = size, px = _p.x, py = _p.y, pz = _p.z, fx = _d.x, fy = _d.y, fz = _d.z;
    switch (kindName) {
      case "muzzle": case "muzzleBig": {
        const big = kindName === "muzzleBig" ? 2.2 : 1;
        emitP(px, py, pz, fx * 2, fy * 2, fz * 2, 0.09 * big, 0.45 * u * big, 0.1 * u, 1, 0.95, 0.7, 1, 0.6, 0.2, 1, 1, 0, 0);
        for (let i = 0; i < 6 * big; i++) {
          rndDir();
          emitP(px, py, pz, (fx * 3 + _v.x) * u * 3.2 * k, (fy * 3 + _v.y) * u * 3.2 * k, (fz * 3 + _v.z) * u * 3.2 * k, 0.14 + rnd() * 0.1, 0.1 * u * big, 0.02 * u, 1, 0.85, 0.4, 1, 0.35, 0.1, 1, 1, 2, 0);
        }
        break;
      }
      case "burst":
        for (let i = 0; i < 9; i++) { rndDir(); emitP(px, py, pz, (-fx * 4 + _v.x * 0.8) * u * 2 * k, (-fy * 4 + _v.y * 0.8) * u * 2 * k, (-fz * 4 + _v.z * 0.8) * u * 2 * k, 0.3 + rnd() * 0.15, 0.2 * u, 0.04 * u, 0.7, 0.95, 1, 0.2, 0.45, 1, 0.9, 1, 1.5, 0); }
        break;
      case "spark":
        for (let i = 0; i < 12; i++) { rndDir(); emitP(px, py, pz, (fx * 1.5 + _v.x) * u * 2.4 * k, (fy * 1.5 + _v.y) * u * 2.4 * k + u, (fz * 1.5 + _v.z) * u * 2.4 * k, 0.25 + rnd() * 0.25, 0.12 * u, 0.03 * u, 1, 0.9, 0.5, 1, 0.4, 0.1, 1, 1, 1, u * 5); }
        break;
      case "dust":
        for (let i = 0; i < 7; i++) { const a = rnd() * TAU; emitP(px + Math.cos(a) * u * 0.1, py + u * 0.02, pz + Math.sin(a) * u * 0.1, Math.cos(a) * u * 0.7, u * 0.35, Math.sin(a) * u * 0.7, 0.55 + rnd() * 0.2, 0.1 * u, 0.3 * u, 0.85, 0.8, 0.72, 0.7, 0.68, 0.62, 0.5 * k, 0.1, 2.5, -u * 0.2); }
        break;
      case "dirt":
        for (let i = 0; i < 9; i++) { const a = rnd() * TAU; emitP(px, py + u * 0.04, pz, Math.cos(a) * u * 0.6 + fx * u * 0.5, u * (1.1 + rnd() * 0.8), Math.sin(a) * u * 0.6 + fz * u * 0.5, 0.55 + rnd() * 0.2, 0.07 * u, 0.05 * u, 0.55, 0.38, 0.22, 0.4, 0.28, 0.16, 1, 0, 0.3, u * 4.5); }
        break;
      case "explosion":
        emitP(px, py, pz, 0, 0, 0, 0.22, 0.6 * u, 2.6 * u, 1, 1, 0.9, 1, 0.5, 0.1, 1, 1, 0, 0);
        for (let i = 0; i < 40; i++) { rndDir(); const sp = u * (1 + rnd() * 3.2); emitP(px, py, pz, _v.x * sp, _v.y * sp, _v.z * sp, 0.45 + rnd() * 0.5, 0.3 * u, 0.55 * u, 1, 0.9, 0.55, 0.5, 0.12, 0.05, 0.9, 0.8, 1.6, 0); }
        for (let i = 0; i < 14; i++) { rndDir(); const sp = u * (1.5 + rnd() * 2.5); emitP(px, py, pz, _v.x * sp, _v.y * sp, _v.z * sp, 0.7 + rnd() * 0.6, 0.09 * u, 0.06 * u, 0.5, 0.85, 0.95, 0.2, 0.3, 0.4, 1, 0.2, 0.6, u * 1.2); }
        break;
      case "warp":
        for (let i = 0; i < 22; i++) { rndDir(); emitP(px + _v.x * u * 1.1, py + _v.y * u * 1.1, pz + _v.z * u * 1.1, -_v.x * u * 3.2, -_v.y * u * 3.2, -_v.z * u * 3.2, 0.34, 0.16 * u, 0.04 * u, 0.6, 0.95, 1, 0.9, 1, 1, 1, 1, 0, 0); }
        break;
      case "ring":
        for (let i = 0; i < 34; i++) { const a = (i / 34) * TAU; emitP(px, py, pz, Math.cos(a) * u * 3.6, 0, Math.sin(a) * u * 3.6, 0.6, 0.14 * u, 0.06 * u, 0.5, 1, 0.85, 0.2, 0.8, 1, 0.9, 1, 1.4, 0); }
        break;
      case "shield":
        for (let i = 0; i < 20; i++) { rndDir(); emitP(px + _v.x * u * 0.4, py + _v.y * u * 0.4, pz + _v.z * u * 0.4, _v.x * u * 2.5, _v.y * u * 2.5, _v.z * u * 2.5, 0.32, 0.1 * u, 0.03 * u, 0.5, 0.95, 1, 0.3, 0.7, 1, 1, 1, 3, 0); }
        break;
      case "glow":
        emitP(px, py, pz, 0, u * 0.15, 0, 0.9, 0.6 * u, 1.6 * u, 1, 0.95, 0.7, 1, 0.8, 0.4, 0.9, 1, 0, 0);
        break;
      case "heal":
        for (let i = 0; i < 9; i++) { const a = rnd() * TAU; emitP(px + Math.cos(a) * u * 0.35, py - u * 0.2 + rnd() * u * 0.3, pz + Math.sin(a) * u * 0.35, 0, u * (0.8 + rnd() * 0.6), 0, 0.9, 0.12 * u, 0.05 * u, 0.55, 1, 0.6, 0.2, 1, 0.5, 1, 1, 0.8, 0); }
        break;
      case "trail":
        emitP(px, py, pz, 0, 0, 0, 0.4, 0.09 * u, 0.02 * u, 0.7, 0.95, 1, 0.3, 0.6, 1, 0.45 * k, 1, 0, 0);
        break;
      default:
    }
  }
  function updateParticles(dt) {
    if (!points) return;
    let alive = 0;
    for (let i = 0; i < NP; i++) {
      if (pLife[i] <= 0) { if (pAlpha[i] !== 0) pAlpha[i] = 0; continue; }
      pLife[i] -= dt;
      if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
      alive++;
      const i3 = i * 3, u = 1 - pLife[i] / pMax[i], damp = Math.max(0, 1 - pDrag[i] * dt);
      pVel[i3] *= damp; pVel[i3 + 1] = pVel[i3 + 1] * damp - pGrav[i] * dt; pVel[i3 + 2] *= damp;
      pPos[i3] += pVel[i3] * dt; pPos[i3 + 1] += pVel[i3 + 1] * dt; pPos[i3 + 2] += pVel[i3 + 2] * dt;
      pSize[i] = pS0[i] + (pS1[i] - pS0[i]) * u;
      pCol[i3] = pC0[i3] + (pC1[i3] - pC0[i3]) * u; pCol[i3 + 1] = pC0[i3 + 1] + (pC1[i3 + 1] - pC0[i3 + 1]) * u; pCol[i3 + 2] = pC0[i3 + 2] + (pC1[i3 + 2] - pC0[i3 + 2]) * u;
      pAlpha[i] = pA0[i] * (1 - u) * (1 - u * 0.5);
    }
    pAlive = alive;
    const a = points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aAdd.needsUpdate = true;
    points.visible = alive > 0;
  }

  // ---------- profiles ----------
  function debounced(pid) {
    if (time - lastFire[pid] < 0.12) return true;
    lastFire[pid] = time;
    return false;
  }
  function fire(profile, k, o) {
    const pid = P[profile];
    switch (pid) {
      case P.recoil: {
        const m = biped ? 0.7 : 1;
        pos(PZ, 0.05 * k * m); pos(RX, 0.06 * k * m); pos(ST, -0.03 * k);
        if (biped) pos(RX, 0.05 * k);
        break;
      }
      case P.blastRecoil:
        pos(PZ, -0.035 * k); pos(ST, 0.04 * k);
        pos(PZ, 0.16 * k, 0.12); kick(RX, 1.1 * k, 0.12); pos(ST, -0.07 * k, 0.12); flashAt(0.4 * k, 0.12);
        break;
      case P.lunge:
        pos(PZ, 0.05 * k); pos(ST, -0.08 * k); kick(PZ, -3.2 * k, 0.1); pos(RX, -0.14 * k, 0.1); pos(ST, 0.1 * k, 0.1);
        break;
      case P.boostSurge: case P.dashLunge: {
        const m = pid === P.dashLunge ? 1.4 : 1;
        pos(PZ, 0.06 * k * m); pos(ST, -0.05 * k);
        kick(PZ, -1.9 * k * m, 0.07); pos(ST, 0.16 * k * m, 0.07); pos(FL, 0.9 * k, 0.05); pos(FV, 0.8 * k, 0.05);
        flashAt(0.06 * k, 0.07);
        break;
      }
      case P.shieldPop:
        if (debounced(pid)) break;
        pos(ST, -0.04 * k); flashAt(0.3 * k, 0.05);
        break;
      case P.cloak:
        if (debounced(pid)) break;
        pos(ST, -0.12 * k); pos(ST, 0.12 * k, 0.1); flashAt(0.18 * k, 0.05);
        break;
      case P.drillShake:
        if (debounced(pid)) break;
        pos(PZ, -0.03 * k); kick(RX, -0.4 * k);
        break;
      case P.knockback: {
        const dx = o && typeof o.dirX === "number" ? o.dirX : 0, dz = o && typeof o.dirZ === "number" ? o.dirZ : 1;
        const l = Math.hypot(dx, dz) || 1;
        kick(PX, (dx / l) * 3.4 * k); kick(PZ, (dz / l) * 3.4 * k);
        pos(RZ, -(dx / l) * 0.32 * k); pos(RX, (dz / l) * 0.28 * k);
        pos(ST, -0.15 * k); pos(ST, 0.07 * k, 0.07);
        flash = Math.max(flash, 0.8);
        break;
      }
      case P.spinOut: script(SC_SPIN, 0.9, k); markDead(0); break;
      case P.pop: script(SC_POP, 0.36, k); markDead(0); break;
      case P.fall: markDead(1); kick(RX, 3.2 * k); kick(PY, 0.9); break;
      case P.flop: markDead(2); kick(RZ, 3.2 * k); kick(PY, 0.8); break;
      case P.warpIn: script(SC_WARP, 0.75, k); break;
      case P.blink: script(SC_BLINK, 0.36, k); break;
      case P.jumpSquash:
        pos(ST, -0.26 * k); kick(ST, 5 * k, 0.07); kick(PY, 0.9 * k, 0.07); pos(RX, 0.04, 0);
        break;
      case P.hop:
        pos(ST, -0.2 * k); kick(ST, 4 * k, 0.07); kick(PY, 1.5 * k, 0.07);
        break;
      case P.digLoop:
        if (debounced(pid)) break;
        pos(RX, -0.1 * k); pos(ST, -0.04 * k);
        break;
      case P.celebrate:
        script(SC_CELEB, biped ? 2 : 1.4, k); celebT = biped ? 2 : 1.4;
        break;
      case P.barrelRoll: script(SC_BARREL, 0.8, k); break;
      case P.pulse:
        pos(ST, 0.09 * k); pos(PY, 0.015 * k); flashAt(0.18 * k);
        break;
      case P.stepOut: script(SC_STEPOUT, 0.55, k); break;
      case P.dock: pos(PY, -0.04 * k); kick(PY, 0.5 * k, 0.12); pos(ST, -0.06 * k); break;
      case P.morph:
        pos(ST, -0.3 * k); pos(ST, 0.28 * k, 0.1); kick(RY, 5 * k, 0.1); flashAt(0.5 * k, 0.1);
        break;
      default:
    }
  }
  function markDead(mode) {
    deadFlag = true; animator.dead = true; deadPose = mode; deadT = 0;
    tg[SH] = 0; pShield = false;
  }
  function clearDead() {
    deadFlag = false; animator.dead = false; deadPose = 0; deadT = 0; x.fill(0); v.fill(0); om.set(OMEGA); evT.fill(-1);
    for (let i = 0; i < NSC; i++) if (sId[i] === SC_SPIN || sId[i] === SC_POP) sId[i] = 0;
    animator.hidden = false;
    curClip = null;
  }

  // ---------- public: trigger ----------
  function trigger(slot, o) {
    const row = anims[slot];
    if (!row) return false;
    const e = o && o.verb && row.byVerb && row.byVerb[o.verb] ? row.byVerb[o.verb] : row;
    const k = o && typeof o.intensity === "number" ? o.intensity : 1;
    if (slot === "die" && deadFlag) return false;
    if (slot === "respawn") {
      if (deadFlag) clearDead();
    }
    const name = e.clip && clipDriven ? (hasClip(e.clip) ? e.clip : slot === "die" && hasClip("fall") ? "fall" : null) : null;
    if (name && slot !== "move" && slot !== "idle" && slot !== "look") {
      const loop = slot === "celebrate" || (slot === "use" && name === "dig");
      curAct = play(name, { fade: 0.08, restart: true, loop });
      curClip = name;
      oneShotT = slot === "die" ? 999 : Math.min(clipNames.get(name) || 0.8, slot === "jump" ? 0.9 : 1.6);
      if (slot === "die") deadClip = name;
    }
    if (e.profile && e.profile !== "none") fire(e.profile, k, o);
    if (slot === "die" && !deadFlag) markDead(0);
    for (let i = 0; i < e.fx.length; i++) {
      const f = e.fx[i];
      queue(f.at, EV_FX, 0, k, f.kind, f.socket);
    }
    if (e.shake) shakeImp = Math.max(shakeImp, e.shake * k);
    if (e.hitStop) freezeT = Math.max(freezeT, e.hitStop / 60);
    return true;
  }
  // ---------- update ----------
  function update(dtIn, state) {
    const dt = clamp(dtIn, 0, 0.05);
    const st = state || {};
    const speed = clamp(st.speed || 0, 0, 1), turn = clamp(st.turn || 0, -1, 1);
    const grounded = st.grounded !== false;
    const boost = !!st.boost, shieldOn = !!st.shield, drilling = !!st.drilling, digging = !!st.digging, invisible = !!st.invisible, stateDead = !!st.dead;

    // state edges
    if (stateDead && !prevStateDead && !deadFlag) trigger("die", null);
    else if (!stateDead && prevStateDead && deadFlag) trigger("respawn", null);
    prevStateDead = stateDead;
    if (!deadFlag) {
      if (boost && !pBoost && anims.move) trigger("move", { verb: "boost" });
      if (shieldOn && !pShield) trigger("defend", { verb: "shield" });
      if (!shieldOn && pShield) { flashAt(0.15); emitFx("shield", "root", 0.6); }
      if (drilling && !pDrill) trigger("primary", { verb: "drill" });
      if (digging && !pDig) trigger("use", { verb: "dig" });
      if (invisible && !pInvis) trigger("defend", { verb: "invisible" });
      if (!invisible && pInvis) { flashAt(0.3); emitFx("warp", "root", 0.8); }
      if (biped || kind === "quadruped") {
        if (!grounded) airT += dt;
        if (grounded && !wasGrounded) {
          const k = clamp(airT / 0.5, 0.3, 1.2);
          pos(ST, -0.24 * k); pos(PY, -0.01);
          emitFx("dust", "feet", k);
          if (clipDriven && hasClip("land") && airT > 0.3) { curAct = play("land", { fade: 0.05, restart: true }); curClip = "land"; oneShotT = 0.3; }
        }
        if (grounded) airT = 0;
        wasGrounded = grounded;
      }
    }
    pBoost = boost; pShield = shieldOn; pDrill = drilling; pDig = digging; pInvis = invisible;

    // hit-stop: the entity freezes, flash and shake keep their own clock
    let dtA = dt;
    if (freezeT > 0) { freezeT -= dt; dtA = 0; }
    animator.hitStop = freezeT > 0 ? freezeT : 0;
    time += dtA;

    for (let i = 0; i < NEV; i++) {
      if (evT[i] < 0) continue;
      evT[i] -= dtA;
      if (evT[i] <= 0) {
        evT[i] = -1;
        runEv(evK[i], evA[i], evB[i], evS[i], evE[i]);
      }
    }

    // smoothed inputs
    const lag = 1 - Math.exp(-dtA * 8);
    speedS += (speed - speedS) * lag;
    turnS += (turn - turnS) * (1 - Math.exp(-dtA * 9));
    const accel = clamp((speed - speedS) * 2.2, -1, 1);

    // targets
    tg[PX] = tg[PY] = tg[PZ] = tg[RX] = tg[RY] = tg[RZ] = tg[ST] = 0;
    tg[FL] = boost ? 1 : 0;
    tg[FV] = boost ? 1 : 0;
    tg[SH] = shieldOn && !deadFlag ? 1 : 0;
    tg[CL] = invisible && !deadFlag ? 1 : 0;
    ze[SH] = tg[SH] ? 0.38 : 1;
    ov.fill(0);
    us = 1; zs = 1; xyk = 1;
    let sp = speedS;

    if (!deadFlag) {
      if (isShip) {
        tg[RZ] = -turnS * 0.55; tg[RY] = -turnS * 0.1; tg[RX] = -accel * 0.07 + (boost ? -0.02 : 0);
      } else if (kind === "car") {
        tg[RZ] = turnS * 0.07 * sp; tg[RX] = -accel * 0.09;
      } else {
        tg[RX] = -(sp * 0.13 + accel * 0.1) * (biped ? 1 : 0.5); tg[RZ] = -turnS * 0.09 * sp;
      }
      if (boost) tg[ST] += 0.07;
      if (idleP === P.idleBob) {
        const f = 1 - 0.5 * sp;
        ov[PY] += (Math.sin(time * 1.7) * 0.02 + Math.sin(time * 2.9 + 1.3) * 0.007) * f; ov[RZ] += Math.sin(time * 1.1) * 0.022 * f; ov[RX] += Math.sin(time * 1.4 + 0.5) * 0.008 * f;
      } else if (idleP === P.breathe && !clipDriven) {
        ov[ST] += Math.sin(time * 2.1) * 0.007; ov[PY] += Math.sin(time * 2.1 + 0.6) * 0.003;
      } else if (idleP === P.engineIdle) {
        ov[PY] += (Math.sin(time * 34) * 0.0024 + Math.sin(time * 53) * 0.0014) * (1 - 0.4 * sp); ov[ST] += Math.sin(time * 7) * 0.004;
      } else if (idleP === P.wobbleIdle) {
        ov[ST] += Math.sin(time * 3.2) * 0.045; ov[RZ] += Math.sin(time * 1.7) * 0.05; ov[PY] += Math.sin(time * 3.2 - 0.8) * 0.01;
      }
      if (moveP === P.walkCycle || moveP === P.gait) {
        if (sp > 0.02) {
          const fast = moveP === P.gait ? 1.35 : 1;
          if (!curAct) phase += dtA * (5 + 5 * sp) * fast;
          const ph = curAct && clipNames.get(curClip) ? (curAct.time / clipNames.get(curClip)) * TAU : phase;
          const gain = clipDriven ? 0.45 : 1;
          ov[PY] += Math.abs(Math.sin(ph)) * 0.016 * sp * gain * (moveP === P.gait ? 1.3 : 1);
          ov[RZ] += Math.sin(ph * 0.5) * 0.035 * sp * gain; ov[RY] += Math.sin(ph * 0.5) * 0.04 * sp * gain;
          if (moveP === P.gait) ov[RX] += Math.cos(ph) * 0.03 * sp;
          // step dust
          const step = Math.floor(ph / Math.PI);
          if (step !== prevStep) { prevStep = step; if (sp > 0.6 && grounded && builtinFx) emitFx("dust", "feet", 0.35 + sp * 0.4); }
        }
      } else if (moveP === P.drive) {
        ov[PY] += Math.sin(time * 9) * 0.003 * sp; ov[RX] += Math.sin(time * 6.3) * 0.006 * sp;
      } else if (moveP === P.hop && sp > 0.05) {
        phase += dtA * (6 + 3 * sp);
        const s = Math.abs(Math.sin(phase * 0.5)), c = 1 - s;
        ov[PY] += s * 0.1 * sp; ov[ST] += (0.08 * s - 0.2 * c * c * c * c) * sp;
      }
      if (drilling) {
        const w = time * 62;
        ov[PX] += Math.sin(w) * 0.007; ov[PY] += Math.sin(w * 1.37 + 1) * 0.006; ov[RZ] += Math.sin(w * 0.8) * 0.012; ov[PZ] += -0.012;
      }
      if (digging) {
        if (!clipDriven) { const w = time * 5.2; ov[RX] += -0.12 - Math.max(0, Math.sin(w)) * 0.2; ov[PY] += -Math.abs(Math.sin(w)) * 0.02; }
        else tg[RX] += -0.07;
      }
    } else {
      deadT += dtA;
      if (deadPose === 1) { tg[RX] = 1.5; tg[PY] = 0.1; om[RX] = 10; }
      else if (deadPose === 2) { tg[RZ] = 1.5; tg[PY] = 0.12; }
    }

    // springs, two substeps
    const h = dtA * 0.5;
    for (let s = 0; s < 2; s++) {
      for (let c = 0; c < NCH; c++) {
        const w = om[c];
        v[c] += (w * w * (tg[c] - x[c]) - 2 * ze[c] * w * v[c]) * h;
        x[c] += v[c] * h;
      }
    }

    // scripts
    for (let i = 0; i < NSC; i++) {
      const id = sId[i];
      if (!id) continue;
      sT[i] += dtA;
      const d = sD[i], t = sT[i], p = clamp(t / d, 0, 1), k = sK[i];
      switch (id) {
        case SC_SPIN: {
          const e = p * p;
          ov[RY] += e * TAU * 2.2; ov[RZ] += e * TAU * 0.9; ov[RX] += -p * 0.5;
          ov[PY] += -p * p * 0.3; ov[PZ] += -p * 0.12; us *= 1 - smooth(0.7, 1, p);
          flash = Math.max(flash, p > 0.1 ? 0.35 * Math.pow(Math.sin(p * 38), 2) : 0);
          if (p >= 1) { animator.hidden = true; sId[i] = 0; }
          break;
        }
        case SC_POP: {
          us *= p < 0.45 ? 1 + easeInOutCubic(p / 0.45) * 0.35 : 1.35 * (1 - smooth(0.45, 0.8, p));
          flash = Math.max(flash, 0.6 * p);
          if (p >= 1) { animator.hidden = true; sId[i] = 0; }
          break;
        }
        case SC_WARP: {
          const q = 1 - p;
          us *= clamp(easeOutBack(p), 0, 2);
          zs *= 1 + q * q * 2.5; xyk *= 1 - q * q * 0.75;
          ov[RY] -= q * q * q * TAU; ov[PZ] += q * q * 0.35;
          flash = Math.max(flash, q * q * 0.6);
          if (p >= 1) sId[i] = 0;
          break;
        }
        case SC_BLINK: {
          const f = p < 0.5 ? easeInOutCubic(p * 2) : 1 - easeOutBack((p - 0.5) * 2);
          const g = clamp(f, 0, 1);
          xyk *= 1 - g * 0.85; zs *= 1 + g * 1.4; us *= p > 0.46 && p < 0.54 ? 0.2 : 1;
          flash = Math.max(flash, smooth(0.3, 0.5, p) * (1 - smooth(0.5, 0.8, p)) * 0.8);
          if (p >= 1) sId[i] = 0;
          break;
        }
        case SC_CELEB: {
          if (biped || kind === "quadruped" || kind === "blob" || kind === "car") {
            const hops = 3, a = p * Math.PI * hops, hh = Math.abs(Math.sin(a)), fade = 1 - p * 0.35;
            ov[PY] += hh * 0.16 * fade * k;
            const c = Math.cos(a) * Math.sign(Math.sin(a) || 1);
            ov[ST] += (0.1 * Math.max(0, c) - 0.16 * Math.pow(1 - hh, 6)) * fade;
            ov[RY] += easeInOutCubic(clamp(p * 1.6, 0, 1)) * TAU;
            ov[RZ] += Math.sin(a * 2) * 0.07 * fade;
          }
          if (p >= 1) { sId[i] = 0; celebT = 0; }
          break;
        }
        case SC_BARREL: {
          const e = easeInOutCubic(p);
          ov[RZ] += -e * TAU; ov[PY] += Math.sin(p * Math.PI) * 0.12; ov[ST] += Math.sin(p * Math.PI) * 0.05;
          if (p >= 1) sId[i] = 0;
          break;
        }
        case SC_STEPOUT: {
          us *= clamp(easeOutBack(Math.min(1, p * 1.25)), 0, 2);
          ov[PY] += Math.sin(p * Math.PI) * 0.14; ov[PZ] += -(1 - p) * (1 - p) * 0.25;
          ov[ST] += (1 - p) * 0.12 * Math.sin(p * 9);
          if (p >= 1) sId[i] = 0;
          break;
        }
        default: sId[i] = 0;
      }
    }

    // flash and shake clocks
    flash *= Math.exp(-dtA * 9);
    if (flash < 0.01 && !flashDirty) flash = 0;
    shakeImp *= Math.exp(-dt * 5.5);
    if (shakeImp < 0.003) shakeImp = 0;
    shakeCont = (drilling ? 0.22 : 0) + (digging ? 0.05 : 0) + (boost ? 0.05 * sp + 0.02 : 0);
    animator.shake = Math.min(1, Math.max(shakeImp, shakeCont));
    animator.fovKick = clamp(x[FV] + ov[FV], -0.3, 1.5) * fovDeg;
    animator.flame = Math.max(0, x[FL] + 0.3 + sp * 0.3);
    animator.flash = flash;

    // apply to the pivot
    const u = size;
    const sAmt = clamp(x[ST] + ov[ST], -0.7, 1.5);
    const stretch = 1 + sAmt, squeeze = 1 / Math.sqrt(stretch);
    const sx = squeeze * us * xyk, sy = (rigid ? squeeze : stretch) * us * xyk, sz = (rigid ? stretch : squeeze) * us * zs;
    pivot.position.set((x[PX] + ov[PX]) * u, (x[PY] + ov[PY]) * u, (x[PZ] + ov[PZ]) * u);
    pivot.rotation.set(x[RX] + ov[RX], x[RY] + ov[RY], x[RZ] + ov[RZ]);
    pivot.scale.set(Math.max(0.0001, sx), Math.max(0.0001, sy), Math.max(0.0001, sz));
    pivot.visible = !animator.hidden;

    // shield bubble
    const sh = Math.max(0, x[SH]);
    if (sh > 0.01 && !animator.hidden) {
      shield.visible = true;
      const r = shieldRadius * sh;
      shield.material.uniforms.uT.value = time;
      shield.material.uniforms.uA.value = clamp(sh, 0, 1) * (0.85 + 0.15 * Math.sin(time * 6));
      // cancel the pivot squash so the bubble stays round
      shield.scale.set(r / sx, r / sy, r / sz);
    } else shield.visible = false;

    // materials: white flash, engine surge, cloak
    const cl = clamp(x[CL], 0, 1);
    const opacity = 1 - cl * 0.78;
    if (flash > 0 || flashDirty || cl > 0.001 || cloakApplied || isShip) {
      for (let i = 0; i < nm; i++) {
        const m = mats[i];
        if (m.emissive) {
          if (mIsEngine[i]) m.emissiveIntensity = mInt[i] * (0.75 + 0.9 * clamp(x[FL], 0, 2) + 1.2 * flash);
          else {
            m.emissive.setRGB(mEmis[i * 3] + (1 - mEmis[i * 3]) * flash, mEmis[i * 3 + 1] + (1 - mEmis[i * 3 + 1]) * flash, mEmis[i * 3 + 2] + (1 - mEmis[i * 3 + 2]) * flash);
            m.emissiveIntensity = mInt[i] + flash * 0.9;
          }
        }
        if (cl > 0.001) {
          if (!m.transparent) m.transparent = true;
          m.opacity = mOp[i] * opacity * (0.9 + 0.1 * Math.sin(time * 9 + i));
        } else if (cloakApplied) { m.opacity = mOp[i]; m.transparent = !!mTrans[i]; }
      }
      flashDirty = flash > 0;
      cloakApplied = cl > 0.001;
    }

    // continuous fx: exhaust, wing trails, drill sparks, dig dirt
    if (builtinFx && !animator.hidden) {
      if (isShip && !deadFlag) {
        const fl = clamp(x[FL], 0, 1.4);
        emitAcc += dtA * (38 + 70 * fl);
        while (emitAcc >= 1) {
          emitAcc -= 1;
          for (let e = 0; e < 2; e++) {
            const s = sockets[e ? "engine_r" : "engine_l"];
            if (!s) continue;
            s.updateWorldMatrix(true, false); s.getWorldPosition(_p);
            pivot.getWorldQuaternion(_q); _d.set(0, 0, 1).applyQuaternion(_q);
            const spd = (1.2 + 6 * fl + 2 * sp) * u;
            emitP(_p.x, _p.y, _p.z, _d.x * spd, _d.y * spd, _d.z * spd, 0.1 + 0.1 * fl, (0.1 + 0.07 * fl) * u, 0.02 * u, 0.75, 0.97, 1, 0.15, 0.4, 1, 0.8, 1, 1, 0);
          }
        }
        trailAcc += dtA * (Math.abs(turnS) * sp * 30 + (boost ? 26 : 0));
        while (trailAcc >= 1) { trailAcc -= 1; emitFx("trail", "wing_l", 1); emitFx("trail", "wing_r", 1); }
      }
      if (drilling && !deadFlag) {
        drillAcc += dtA * 24;
        while (drillAcc >= 1) { drillAcc -= 1; emitFx("spark", "nose", 0.45); }
      }
    }
    if (digging && curAct && curClip === "dig" && clipNames.get("dig")) {
      const ph = (curAct.time / clipNames.get("dig")) % 1;
      if (ph < digPrev && builtinFx) emitFx("dirt", "ground", 1);
      digPrev = ph;
    }

    // clip selection
    if (clipDriven) {
      if (oneShotT > 0 && oneShotT < 900) oneShotT -= dtA;
      if (oneShotT <= 0) {
        let want;
        if (deadFlag) want = deadClip || (hasClip("fall") ? "fall" : "idle");
        else if (!grounded && biped) want = hasClip("fall") ? "fall" : "idle";
        else if (digging && hasClip("dig")) want = "dig";
        else if (celebT > 0 && hasClip("celebrate")) want = "celebrate";
        else want = sp > 0.72 && hasClip("run") ? "run" : sp > 0.1 && hasClip("walk") ? "walk" : "idle";
        if (want !== curClip && hasClip(want)) { curAct = play(want, { fade: 0.18, loop: !(deadFlag) }); curClip = want; }
      }
      if (curAct && (curClip === "walk" || curClip === "run")) curAct.timeScale = 0.55 + sp * (curClip === "run" ? 0.5 : 0.75);
    }
    if (celebT > 0) celebT -= dtA;

    // particles, pivot sits in the world already
    if (points) {
      const par = opts.fxParent || root.parent;
      if (par && points.parent !== par) par.add(points);
      updateParticles(dtA);
    }

    // a dead biped holds its pose: freeze the skeleton once it has settled
    if (deadFlag && deadPose !== 0 && deadT > 1.1) return 0;
    return dtA;
  }

  function dispose() {
    if (points) { points.removeFromParent(); points.geometry.dispose(); }
    shield.removeFromParent(); shield.material.dispose();
    for (let i = 0; i < nm; i++) {
      const m = mats[i];
      if (m.emissive) { m.emissive.setRGB(mEmis[i * 3], mEmis[i * 3 + 1], mEmis[i * 3 + 2]); m.emissiveIntensity = mInt[i]; }
      m.opacity = mOp[i]; m.transparent = !!mTrans[i];
    }
    for (const child of pivot.children.slice()) root.add(child);
    pivot.removeFromParent();
  }

  animator.trigger = trigger;
  animator.update = update;
  animator.dispose = dispose;
  return animator;
}
