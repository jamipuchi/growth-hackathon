/** Space Party decorative nebula — original CC0-1.0 source; three.js r160. */
import * as THREE from 'three';

const COUNTS = Object.freeze({low: 24, medium: 48, high: 80});
const TAU = Math.PI * 2, PERIOD = 120, FLARE_SECONDS = 14, TEXTURE_SIZE = 128;
const PALETTE = [0x9351e7, 0x7147cd, 0xc944d6, 0x6742c9, 0xaa55dc, 0x514bbe].map(value => new THREE.Color(value));

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
function opacityValue(value) {
  finite(value, 'opacity');
  if (value < 0 || value > 1) throw new RangeError('opacity must be between zero and one');
  return value;
}
function vector(value, name) {
  const entries = Array.isArray(value) || ArrayBuffer.isView(value) ? value : value && [value.x, value.y, value.z];
  if (!entries || entries.length < 3) throw new TypeError(`${name} must be a Vector3, xyz object or three-element array`);
  const values = [finite(entries[0], name), finite(entries[1], name), finite(entries[2], name)];
  if (values.some(v => Math.abs(v) > 1e9)) throw new RangeError(`${name} components must be within one billion metres`);
  return new THREE.Vector3(...values);
}
function colorValue(value) {
  if (value == null) return null;
  if (value.isColor) {
    if (![value.r, value.g, value.b].every(v => Number.isFinite(v) && v >= 0 && v <= 1e6)) throw new TypeError('color must contain finite nonnegative RGB channels');
    return value.clone();
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new RangeError('numeric color must be an RGB hex integer');
  } else if (typeof value === 'string') {
    value = value.trim();
    if (!/^(#[\da-f]{3}|#[\da-f]{6}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i.test(value) || /^[a-z]+$/i.test(value) && THREE.Color.NAMES[value.toLowerCase()] === undefined) throw new TypeError('color must be a valid CSS color');
  } else throw new TypeError('color must be a THREE.Color, CSS color string or RGB hex number');
  return new THREE.Color(value);
}
function random(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296;};
}
function hash2(x, y, seed) {
  let hash = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  hash = Math.imul(hash ^ hash >>> 13, 1274126177); return ((hash ^ hash >>> 16) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let sx = x - ix, sy = y - iy; sx = sx * sx * (3 - 2 * sx); sy = sy * sy * (3 - 2 * sy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function cloudTexture(seed) {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) {
    const u = (x + .5) / TEXTURE_SIZE, v = (y + .5) / TEXTURE_SIZE;
    const px = u * 2 - 1, py = v * 2 - 1;
    const coarse = noise(u * 3.7 + 13, v * 3.7 + 19, seed);
    const medium = noise(u * 8.3 + 37, v * 8.3 + 7, seed + 17);
    const fine = noise(u * 18.6, v * 18.6, seed + 41);
    const grain = noise(u * 39.1, v * 39.1, seed + 73);
    const billow = coarse * .56 + medium * .28 + fine * .12 + grain * .04;
    const warpedX = px + .14 * Math.sin(py * 5 + coarse * 3);
    const warpedY = py + .1 * Math.sin(px * 4 - medium * 3);
    const radius2 = warpedX * warpedX + warpedY * warpedY;
    const envelope = Math.pow(Math.max(0, 1 - radius2), 1.6);
    const breakup = Math.pow(THREE.MathUtils.clamp((billow - .2) * 1.9, 0, 1), 1.25);
    // A final unwarped rim guarantees zero alpha at every texture edge.
    const rim = THREE.MathUtils.smoothstep(1 - Math.max(Math.abs(px), Math.abs(py)), 0, .12);
    const offset = (y * TEXTURE_SIZE + x) * 4;
    data[offset] = Math.round(billow * 255);
    data[offset + 1] = Math.round(medium * 255);
    data[offset + 2] = Math.round(fine * 255);
    data[offset + 3] = Math.round(envelope * breakup * rim * 255);
  }
  // Explicit zero edges also keep mip levels free of a square sprite outline.
  for (let i = 0; i < TEXTURE_SIZE; i++) for (const index of [i, (TEXTURE_SIZE - 1) * TEXTURE_SIZE + i, i * TEXTURE_SIZE, i * TEXTURE_SIZE + TEXTURE_SIZE - 1]) data[index * 4 + 3] = 0;
  const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'nebula_cloud_noise'; texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 1; texture.needsUpdate = true;
  return texture;
}

const vertexShader = /* glsl */`
uniform float uPhase, uRadius;
uniform vec3 uCameraLocal;
uniform vec4 uFlare;
attribute vec4 aCenterSize, aColorPhase, aDetail;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vCloud;
void main() {
  float breathing = .96 + .04 * sin(uPhase + aColorPhase.w);
  float scaleWorld = max(length(modelMatrix[0].xyz), max(length(modelMatrix[1].xyz), length(modelMatrix[2].xyz)));
  float size = aCenterSize.w * breathing;
  vec2 local = position.xy * aDetail.xy;
  float angle = aDetail.z + .06 * sin(uPhase * 2. + aDetail.w);
  local = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * local;
  vec4 centerView = modelViewMatrix * vec4(aCenterSize.xyz, 1.);
  vec4 mv = centerView;
  mv.xy += local * size * scaleWorld;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vColor = aColorPhase.rgb;
  float localDistance = length(uCameraLocal - aCenterSize.xyz);
  float nearFade = smoothstep(size * .1, size * 1.2, localDistance);
  float planeFade = smoothstep(0., size * scaleWorld * .65, -centerView.z);
  float flareDistance = length(aCenterSize.xyz - uFlare.xyz) / max(uRadius * .8, .001);
  float flareWeight = exp(-flareDistance * flareDistance * 2.);
  vCloud = vec3(aColorPhase.w, nearFade * planeFade, flareWeight);
}`;
const fragmentShader = /* glsl */`
uniform sampler2D uCloud;
uniform float uPhase, uOpacity;
uniform vec4 uFlare;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vCloud;
void main() {
  vec2 drift = vec2(sin(uPhase + vCloud.x), cos(uPhase * 2. + vCloud.x)) * .023;
  vec4 detail = texture2D(uCloud, vUv);
  vec4 flowing = texture2D(uCloud, clamp(vUv + drift, 0., 1.));
  float density = mix(detail.a, flowing.a, .32);
  float billow = .86 + .14 * sin(uPhase * 3. + vCloud.x + detail.g * 2.);
  float flare = uFlare.w * vCloud.z;
  vec3 color = vColor * (.68 + detail.r * 1.1);
  color = mix(color, vec3(.3, .64, 1.15), min(.7, flare * .24));
  color *= 1. + flare * 1.7;
  float alpha = density * billow * uOpacity * vCloud.y;
  if (alpha < .001) discard;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Decorative luminous clouds only: this helper never adds fog, obscures by a
 * gameplay visibility rule, creates lights, captures reflections or moves a
 * camera. Coordinates for setFlare are local to object3d. Default hollow arcs
 * surround the centre; use opacity to blend the decoration during transitions.
 */
export function createNebula({radius = 250, seed = 1, quality = 'medium', opacity = .22, color} = {}) {
  finite(radius, 'radius'); finite(seed, 'seed');
  if (radius < .01 || radius > 1e6) throw new RangeError('radius must be from .01 to 1000000 metres');
  if (!Object.hasOwn(COUNTS, quality)) throw new RangeError('quality must be low, medium or high');
  opacity = opacityValue(opacity);
  const overrideColor = colorValue(color), count = COUNTS[quality], rng = random(seed);
  const texture = cloudTexture(seed >>> 0);
  const geometry = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(2, 2);
  geometry.index = plane.index.clone();
  for (const name of Object.keys(plane.attributes)) geometry.setAttribute(name, plane.attributes[name].clone());
  plane.dispose();
  const centers = new Float32Array(count * 4), colors = new Float32Array(count * 4), detail = new Float32Array(count * 4);
  let boundsRadius = 0, hollowRadius = Infinity;
  const arcPhase = rng() * TAU;
  for (let i = 0; i < count; i++) {
    const arc = i % 3, part = Math.floor(i / 3), parts = Math.ceil((count - arc) / 3);
    const t = (part + .15 + rng() * .7) / parts;
    const angle = arcPhase + arc * 1.9 + t * Math.PI * 1.45;
    const distance = radius * (.58 + .09 * Math.sin(t * Math.PI) + .025 * (rng() - .5));
    const center = new THREE.Vector3(Math.cos(angle) * distance, radius * .1 * Math.sin(angle * 2.1 + arc), Math.sin(angle) * distance);
    if (arc === 1) center.applyAxisAngle(new THREE.Vector3(0, 0, 1), .58);
    if (arc === 2) center.applyAxisAngle(new THREE.Vector3(1, 0, 0), -.68);
    const size = radius * (.105 + rng() * .07), aspectX = 1.35 + rng() * .5, aspectY = .58 + rng() * .34;
    const extent = size * Math.hypot(aspectX, aspectY);
    if (center.length() + extent > radius * .995) center.setLength(radius * .995 - extent);
    const tint = overrideColor ? overrideColor.clone() : PALETTE[Math.floor(rng() * PALETTE.length)].clone();
    tint.multiplyScalar(.82 + rng() * .3);
    centers.set([center.x, center.y, center.z, size], i * 4);
    colors.set([tint.r, tint.g, tint.b, rng() * TAU], i * 4);
    detail.set([aspectX, aspectY, angle * .75 + rng() * .5, rng() * TAU], i * 4);
    boundsRadius = Math.max(boundsRadius, center.length() + extent);
    hollowRadius = Math.min(hollowRadius, center.length() - extent);
  }
  geometry.setAttribute('aCenterSize', new THREE.InstancedBufferAttribute(centers, 4));
  geometry.setAttribute('aColorPhase', new THREE.InstancedBufferAttribute(colors, 4));
  geometry.setAttribute('aDetail', new THREE.InstancedBufferAttribute(detail, 4));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boundsRadius);
  const uniforms = {uCloud: {value: texture}, uPhase: {value: 0}, uOpacity: {value: opacity}, uRadius: {value: radius}, uCameraLocal: {value: new THREE.Vector3(0, 0, radius * 3)}, uFlare: {value: new THREE.Vector4(0, 0, 0, 0)}};
  const material = new THREE.ShaderMaterial({name: 'nebula_clouds', uniforms, vertexShader, fragmentShader, transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, side: THREE.FrontSide, fog: false, toneMapped: true});
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'nebula_puffs'; mesh.frustumCulled = false; mesh.renderOrder = 15;
  mesh.castShadow = mesh.receiveShadow = false; mesh.visible = opacity > 0;
  const object3d = new THREE.Group(); object3d.name = 'decorative_nebula'; object3d.add(mesh);
  let time = 0, phase = 0, disposed = false, flareStart = -Infinity, flareStrength = 0;
  const flarePosition = new THREE.Vector3(), cameraWorld = new THREE.Vector3();
  let signature = 2166136261;
  for (const array of [centers, colors, detail]) for (const word of new Uint32Array(array.buffer)) {signature ^= word; signature = Math.imul(signature, 16777619) >>> 0;}
  for (const byte of texture.image.data) {signature ^= byte; signature = Math.imul(signature, 16777619) >>> 0;}
  const fixedSignature = signature.toString(16).padStart(8, '0');
  function remaining() {return flareStrength > 0 ? Math.max(0, FLARE_SECONDS - (time - flareStart)) : 0;}
  function setFlare(position, strength = 1) {
    if (disposed) return;
    const nextPosition = vector(position, 'flare position'); finite(strength, 'strength');
    if (strength < 0) throw new RangeError('strength must be nonnegative');
    flarePosition.copy(nextPosition); flareStrength = Math.min(strength, 4); flareStart = time;
    uniforms.uFlare.value.set(flarePosition.x, flarePosition.y, flarePosition.z, flareStrength);
  }
  function update(dt, camera) {
    if (disposed) return;
    finite(dt, 'dt'); if (dt < 0) throw new RangeError('dt must be nonnegative');
    if (camera != null && !camera.isCamera) throw new TypeError('camera must be a THREE.Camera');
    const nextTime = time + dt;
    if (!Number.isFinite(nextTime) || nextTime > 1e12) throw new RangeError('nebula clock exceeds one trillion seconds');
    if (camera) {
      camera.getWorldPosition(cameraWorld);
      object3d.worldToLocal(cameraWorld);
      if (![cameraWorld.x, cameraWorld.y, cameraWorld.z].every(Number.isFinite)) throw new RangeError('camera/root transforms must be finite and invertible');
      uniforms.uCameraLocal.value.copy(cameraWorld);
    }
    time = nextTime; phase = (phase + dt * (TAU / PERIOD)) % TAU; uniforms.uPhase.value = phase;
    uniforms.uFlare.value.w = flareStrength * Math.pow(remaining() / FLARE_SECONDS, 1.3);
  }
  function setOpacity(value) {
    if (disposed) return;
    opacity = opacityValue(value); uniforms.uOpacity.value = opacity; mesh.visible = opacity > 0;
  }
  function getStats() {
    const draws = !disposed && object3d.visible && mesh.visible ? 1 : 0;
    return {quality, puffs: count, submittedTriangles: draws * count * 2, potentialTriangles: count * 2, meshDrawCalls: draws, textures: disposed ? 0 : 1, textureSize: TEXTURE_SIZE, textureBytesWithMips: 87380, radius, boundsRadius, hollowRadius, opacity, flareActive: !disposed && remaining() > 0, flareRemaining: disposed ? 0 : remaining(), flareStrength: disposed ? 0 : flareStrength, flarePosition: flarePosition.toArray(), time, phase, cameraLocal: uniforms.uCameraLocal.value.toArray(), disposed, signature: fixedSignature};
  }
  function dispose() {
    if (disposed) return;
    disposed = true; flareStrength = 0; uniforms.uFlare.value.w = 0;
    object3d.removeFromParent(); texture.dispose(); geometry.dispose(); material.dispose(); object3d.clear();
  }
  return {object3d, setFlare, update, setOpacity, getStats, dispose};
}
