// Space <-> planet landing and take-off: ONE continuous shot, never a cut.
// Pure three.js (three@0.160.0). No render loop of its own, no per-frame allocation, ~0.02 ms per update.
// The ship is reparented between the two scenes at the white-out peak; the caller renders `controller.scene`.
import * as THREE from "three";

const SWITCH = 0.62; // pose time where the world switches (white-out is at its plateau here)
const A_END = 1 / 3; // end of the approach segment
const TOUCH = 0.94; // touchdown, as a fraction of the pose timeline
const DUST_LIFE = 1.1;
const DUST_N = 56;
const STREAK_N = 48;
const STREAK_Z = 10;
const TAIL_PITCH = 1.15;

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
function lerpAngle(a, b, u) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Same convention as the game: yaw about Y then pitch about X, nose to -Z.
function forwardOf(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

let softTexture = null;
function getSoftTexture() {
  if (softTexture || typeof document === "undefined") return softTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  softTexture = new THREE.CanvasTexture(c);
  return softTexture;
}

function createShot(landing, o) {
  const { camera, spaceScene, islandScene, ship } = o;
  const D = o.duration ?? (landing ? 3 : 2);
  const s = landing ? 1 : -1;

  _box.setFromObject(ship).getSize(_size);
  const maxDim = Math.max(_size.x, _size.y, _size.z);
  const r = clamp(Number.isFinite(maxDim) && maxDim > 0 ? maxDim * 0.5 : 1.5, 0.5, 8);
  const H = o.descentHeight ?? Math.max(r * 16, 28);
  const back = H * 0.6;
  const pad = new THREE.Vector3().copy(o.padPosition);
  pad.y += o.padClearance ?? r * 0.35;
  const ring = new THREE.Vector3().copy(o.ringPosition);

  _euler.setFromQuaternion(ship.quaternion, "YXZ");
  const yaw0 = _euler.y;
  const pitch0 = _euler.x;
  const roll0 = _euler.z;
  const S0 = new THREE.Vector3();
  let yawH = yaw0;
  if (landing) {
    S0.copy(ship.position);
    const dx = ring.x - S0.x;
    const dz = ring.z - S0.z;
    if (dx * dx + dz * dz > 1e-4) yawH = Math.atan2(-dx, -dz);
  } else {
    const st = Math.max(r * 12, 35);
    forwardOf(yawH, 0, _fwd);
    S0.copy(ring).addScaledVector(_fwd, st);
    S0.y += r * 3;
  }

  const persp = camera.isPerspectiveCamera === true;
  const fov0 = persp ? camera.fov : 0;
  const camStartPos = camera.position.clone();
  const camStartQ = camera.quaternion.clone();
  const blendWindow = landing ? 0.3 : 0.2;

  const ctrl = {
    scene: landing ? spaceScene : islandScene,
    overlayAlpha: landing ? 1 : 0.2,
    whiteout: 0,
    skyMix: 0,
    progress: 0,
    update: null,
    cancel: null,
  };

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff7320,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), glowMat);
  glow.scale.set(r * 0.9, r * 0.6, r * 1.5);
  glow.position.z = -r * 0.15;
  glow.visible = false;
  glow.frustumCulled = false;
  ship.add(glow);

  const fx = new THREE.Group();
  fx.frustumCulled = false;
  const far = persp ? camera.far : 1000;
  const domeMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const domeGeo = new THREE.SphereGeometry(far * 0.9, 16, 10);
  {
    const pa = domeGeo.attributes.position;
    const col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const k = smooth(-0.1, 0.9, pa.getY(i) / (far * 0.9));
      col[i * 3] = 0.82 + (0.3 - 0.82) * k;
      col[i * 3 + 1] = 0.92 + (0.62 - 0.92) * k;
      col[i * 3 + 2] = 1 + (0.95 - 1) * k;
    }
    domeGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  fx.add(dome);

  const stPos = new Float32Array(STREAK_N * 12);
  const stCol = new Float32Array(STREAK_N * 12);
  const stIdx = new Uint16Array(STREAK_N * 6);
  const stAng = new Float32Array(STREAK_N);
  const stRho = new Float32Array(STREAK_N);
  const stSpd = new Float32Array(STREAK_N);
  const stW = new Float32Array(STREAK_N);
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < STREAK_N; i++) {
    stAng[i] = rnd() * Math.PI * 2;
    stRho[i] = 0.6 + rnd() * 8.5;
    stSpd[i] = 0.6 + rnd() * 0.9;
    stW[i] = 0.025 + rnd() * 0.035;
    const b = i * 12;
    for (let v = 0; v < 4; v++) stPos[b + v * 3 + 2] = -STREAK_Z;
    const head = 0.7 + rnd() * 0.3;
    stCol.set([0, 0, 0, 0, 0, 0, head * 0.85, head * 0.95, head, head * 0.85, head * 0.95, head], b);
    const v0 = i * 4;
    stIdx.set([v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2], i * 6);
  }
  const stGeo = new THREE.BufferGeometry();
  const stPosAttr = new THREE.BufferAttribute(stPos, 3);
  stPosAttr.setUsage(THREE.DynamicDrawUsage);
  stGeo.setAttribute("position", stPosAttr);
  stGeo.setAttribute("color", new THREE.BufferAttribute(stCol, 3));
  stGeo.setIndex(new THREE.BufferAttribute(stIdx, 1));
  const stMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const streaks = new THREE.Mesh(stGeo, stMat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 999;
  fx.add(streaks);
  fx.visible = landing;
  spaceScene.add(fx);

  const stars = [];
  spaceScene.traverse((obj) => {
    if (obj.isPoints && obj.material && !Array.isArray(obj.material)) {
      stars.push({ mat: obj.material, opacity: obj.material.opacity, transparent: obj.material.transparent });
    }
  });

  const dustPos = new Float32Array(DUST_N * 3);
  const dustVel = new Float32Array(DUST_N * 3);
  const dustGeo = new THREE.BufferGeometry();
  const dustAttr = new THREE.BufferAttribute(dustPos, 3);
  dustAttr.setUsage(THREE.DynamicDrawUsage);
  dustGeo.setAttribute("position", dustAttr);
  const dustMat = new THREE.PointsMaterial({
    color: 0xe6d2a8,
    size: r * 0.45,
    map: getSoftTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    fog: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  let dustT = -1;
  let dustActive = false;

  function emitDust() {
    dustT = 0;
    dustActive = true;
    for (let i = 0; i < DUST_N; i++) {
      const a = rnd() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rho = r * (0.5 + rnd() * 0.9);
      const spd = r * (1.2 + rnd() * 3.2);
      const b = i * 3;
      dustPos[b] = pad.x + ca * rho;
      dustPos[b + 1] = pad.y - r * 0.3 + rnd() * r * 0.2;
      dustPos[b + 2] = pad.z + sa * rho;
      dustVel[b] = ca * spd;
      dustVel[b + 1] = r * (0.3 + rnd() * 1.1);
      dustVel[b + 2] = sa * spd;
    }
    dustAttr.needsUpdate = true;
    islandScene.add(dust);
  }

  function stepDust(dt) {
    dustT += dt;
    const k = dustT / DUST_LIFE;
    if (k >= 1) {
      islandScene.remove(dust);
      dustMat.opacity = 0;
      dustActive = false;
      return;
    }
    const drag = Math.exp(-1.7 * dt);
    const floor = pad.y - r * 0.3;
    for (let i = 0; i < DUST_N; i++) {
      const b = i * 3;
      dustVel[b] *= drag;
      dustVel[b + 2] *= drag;
      dustVel[b + 1] = dustVel[b + 1] * drag - r * 0.9 * dt;
      dustPos[b] += dustVel[b] * dt;
      dustPos[b + 1] = Math.max(floor, dustPos[b + 1] + dustVel[b + 1] * dt);
      dustPos[b + 2] += dustVel[b + 2] * dt;
    }
    dustAttr.needsUpdate = true;
    dustMat.opacity = 0.6 * Math.pow(1 - k, 1.3);
    dustMat.size = r * (0.45 + 1.1 * k);
  }

  function stepStreaks(dt, amount, speedHint) {
    stMat.opacity = amount;
    const step = (3 + speedHint) * amount * dt;
    for (let i = 0; i < STREAK_N; i++) {
      let rho = stRho[i] + (stRho[i] * 2.4 + 1) * stSpd[i] * step;
      if (rho > 9.5) {
        rho = 0.6 + rnd() * 1.6;
        stAng[i] = rnd() * Math.PI * 2;
      }
      stRho[i] = rho;
      const len = (0.4 + rho * 0.8) * amount;
      const ca = Math.cos(stAng[i]);
      const sa = Math.sin(stAng[i]);
      const w = stW[i] * (1 + rho * 0.25);
      const x0 = ca * rho;
      const y0 = sa * rho;
      const x1 = ca * (rho + len);
      const y1 = sa * (rho + len);
      const px = -sa * w;
      const py = ca * w;
      const b = i * 12;
      stPos[b] = x0 - px;
      stPos[b + 1] = y0 - py;
      stPos[b + 3] = x0 + px;
      stPos[b + 4] = y0 + py;
      stPos[b + 6] = x1 - px;
      stPos[b + 7] = y1 - py;
      stPos[b + 9] = x1 + px;
      stPos[b + 10] = y1 + py;
    }
    stPosAttr.needsUpdate = true;
  }

  let t = 0;
  let finished = false;
  let done = false;
  let dustTriggered = false;

  function applyPose(pp, dt) {
    const toIsland = pp >= SWITCH;
    const target = toIsland ? islandScene : spaceScene;
    if (target !== ctrl.scene) {
      ship.removeFromParent();
      target.add(ship);
      ctrl.scene = target;
      fx.visible = !toIsland;
      if (o.onSwitchScene) o.onSwitchScene(target);
    }

    let yaw = yawH;
    let pitch = 0;
    let roll = 0;
    let e = 1;
    if (!toIsland) {
      if (pp < A_END) {
        e = smooth(0, A_END, pp);
        _pos.lerpVectors(S0, ring, e);
        if (landing) {
          const k = smooth(0, A_END * 0.7, pp);
          yaw = lerpAngle(yaw0, yawH, k);
          pitch = pitch0 * (1 - k);
          roll = roll0 * (1 - k);
        }
      } else {
        const b = (pp - A_END) / (SWITCH - A_END);
        forwardOf(yawH, 0, _fwd);
        _pos.copy(ring).addScaledVector(_fwd, s * r * 3 * b);
        _pos.y -= r * 9 * b * b;
        pitch = -s * TAIL_PITCH * smooth(0, 1, b);
      }
    } else {
      const c = clamp((pp - SWITCH) / (TOUCH - SWITCH), 0, 1);
      e = 1 - (1 - c) * (1 - c);
      forwardOf(yawH, 0, _fwd);
      _pos.copy(pad);
      _pos.y += H * (1 - e);
      _pos.addScaledVector(_fwd, -s * back * (1 - e));
      pitch = -s * TAIL_PITCH * (1 - smooth(0, 0.9, c));
    }
    ship.position.copy(_pos);
    _euler.set(pitch, yaw, roll, "YXZ");
    ship.quaternion.setFromEuler(_euler);

    // camera
    if (!toIsland) {
      forwardOf(yaw, pitch * 0.35, _fwd);
      const dist = r * (6 + 2.2 * smooth(0.34, 0.6, pp));
      _camPos.copy(_pos).addScaledVector(_fwd, -dist);
      _camPos.y += r * 2;
      _look.copy(_pos).addScaledVector(_fwd, r * 5);
    } else {
      forwardOf(yaw, 0, _fwd);
      _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      _camPos.copy(_pos).addScaledVector(_fwd, -(r * 9 + (r * 6.5 - r * 9) * e));
      _camPos.y += r * 8 + (r * 2.2 - r * 8) * e;
      _camPos.addScaledVector(_right, r * 3.5 * e);
      _look.copy(_pos).lerp(pad, e);
      _look.y += r * 0.5 * e;
    }
    const heat = smooth(0.34, 0.5, pp) * (1 - smooth(0.62, 0.92, pp));
    const shake = r * 0.05 * heat;
    if (shake > 0) {
      _camPos.x += Math.sin(t * 61) * shake;
      _camPos.y += Math.sin(t * 47 + 1.3) * shake;
    }
    camera.position.copy(_camPos);
    camera.lookAt(_look);
    const w = smooth(0, blendWindow, landing ? pp : 1 - pp);
    if (w < 1) {
      _camQ.copy(camera.quaternion);
      camera.position.lerpVectors(camStartPos, _camPos, w);
      camera.quaternion.slerpQuaternions(camStartQ, _camQ, w);
    }
    if (persp) {
      const fk = 1 + 0.22 * smooth(0.3, 0.58, pp) * (1 - smooth(0.62, 0.85, pp));
      const f = fov0 * fk;
      if (Math.abs(f - camera.fov) > 1e-3) {
        camera.fov = f;
        camera.updateProjectionMatrix();
      }
    }

    // effects
    const sky = smooth(0.34, 0.6, pp) * (toIsland ? 0 : 1);
    ctrl.skyMix = sky;
    ctrl.whiteout = smooth(0.4, 0.58, pp) * (1 - smooth(0.66, 0.86, pp));
    domeMat.opacity = sky;
    for (let i = 0; i < stars.length; i++) {
      stars[i].mat.transparent = true;
      stars[i].mat.opacity = stars[i].opacity * (1 - sky);
    }
    if (heat > 0.001) {
      glow.visible = true;
      const flick = 1 + 0.06 * Math.sin(t * 43);
      glow.scale.set(r * 0.9 * flick, r * 0.6 * flick, r * 1.5 * flick);
      glowMat.opacity = heat * 0.6;
      glowMat.color.setRGB(1, 0.45 + 0.45 * smooth(0.7, 1, heat), 0.12 + 0.6 * smooth(0.7, 1, heat));
    } else glow.visible = false;
    const streakAmt = toIsland ? 0 : smooth(0.36, 0.5, pp) * (1 - smooth(0.56, 0.62, pp));
    streaks.visible = streakAmt > 0.001;
    if (streaks.visible) stepStreaks(dt, streakAmt, 40 * heat);
    if (fx.visible) {
      fx.position.copy(camera.position);
      fx.quaternion.copy(camera.quaternion);
    }
  }

  function cleanup() {
    ship.remove(glow);
    glow.geometry.dispose();
    glowMat.dispose();
    spaceScene.remove(fx);
    domeGeo.dispose();
    domeMat.dispose();
    stGeo.dispose();
    stMat.dispose();
    for (let i = 0; i < stars.length; i++) {
      stars[i].mat.opacity = stars[i].opacity;
      stars[i].mat.transparent = stars[i].transparent;
    }
    if (persp && camera.fov !== fov0) {
      camera.fov = fov0;
      camera.updateProjectionMatrix();
    }
    ctrl.skyMix = 0;
    ctrl.whiteout = 0;
  }

  function finish(callDone) {
    finished = true;
    applyPose(landing ? 1 : 0, 0);
    ctrl.progress = 1;
    ctrl.overlayAlpha = landing ? 0.2 : 1;
    if (!dustTriggered) {
      dustTriggered = true;
      emitDust();
    }
    cleanup();
    if (!landing) {
      islandScene.remove(dust);
      dustActive = false;
    }
    if (callDone && o.onDone) o.onDone();
    if (!dustActive) release();
  }

  function release() {
    if (done) return;
    done = true;
    dustGeo.dispose();
    dustMat.dispose();
  }

  ctrl.update = function update(dt) {
    if (done) return false;
    if (finished) {
      if (dustActive) stepDust(dt);
      if (!dustActive) release();
      return !done;
    }
    dt = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    t += dt;
    const u = clamp(t / D, 0, 1);
    ctrl.progress = u;
    ctrl.overlayAlpha = landing ? 1 - 0.8 * smooth(0, 0.33, u) : 0.2 + 0.8 * smooth(0.66, 1, u);
    if (u >= 1) {
      finish(true);
      return !done;
    }
    applyPose(landing ? u : 1 - u, dt);
    if (!dustTriggered && u >= (landing ? 0.93 : 0.03)) {
      dustTriggered = true;
      emitDust();
    }
    if (dustActive) stepDust(dt);
    return true;
  };

  ctrl.cancel = function cancel() {
    if (done) return;
    if (!finished) finish(false);
    if (dustActive) {
      islandScene.remove(dust);
      dustActive = false;
    }
    release();
  };

  applyPose(landing ? 0 : 1, 0);
  return ctrl;
}

export function playLanding(opts) {
  return createShot(true, opts);
}

export function playTakeoff(opts) {
  return createShot(false, opts);
}
