/** Space Party pooled effects — original CC0-1.0 source. three.js r160. */
import * as THREE from 'three';

export const FX_KINDS = Object.freeze(['laser', 'explosion', 'drill', 'flare', 'scan', 'shield', 'boost', 'landing', 'dig', 'gold']);
const registry = new WeakMap();
const aliases = Object.freeze({
  laser_bolt: 'laser', drill_sparks: 'drill', flare_burst: 'flare', scan_ping: 'scan',
  shield_bubble: 'shield', boost_trail: 'boost', landing_dust: 'landing', dig_dirt: 'dig', chest_gold: 'gold',
  explode: 'explosion', blast: 'explosion', land: 'landing', treasure: 'gold', spark: 'drill', hit: 'drill', respawn: 'scan',
  explosion_small: 'explosion', explosion_medium: 'explosion', explosion_large: 'explosion',
});
const durations = {laser: .55, explosion: 1.65, drill: .7, flare: 2.2, scan: 1.8, shield: 2, boost: 1.5, landing: 1.6, dig: 1, gold: 1.8};
const colors = {laser: 0x67ddff, explosion: 0xff6b14, drill: 0xffbd51, flare: 0xff3822, scan: 0x44ddff, shield: 0x39cfff, boost: 0x65dfff, landing: 0xd6b28a, dig: 0x926039, gold: 0xffd24c};
const noopHandle = Object.freeze({get active() {return false;}, stop() {}, setPosition() {}, setDirection() {}});
const finite = (value, name) => {if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`); return value;};
const capacity = (value, name, limit) => {if (!Number.isInteger(value) || value < 0 || value > limit) throw new RangeError(`${name} must be an integer from 0 to ${limit}`); return value;};
function vector(value, name, fallback) {
  if (value == null && fallback) return fallback.clone();
  const a = Array.isArray(value) || ArrayBuffer.isView(value) ? value : value && [value.x, value.y, value.z];
  if (!a || a.length < 3) throw new TypeError(`${name} must be a Vector3, xyz object or three-element array`);
  const values = [finite(a[0], name), finite(a[1], name), finite(a[2], name)];
  if (values.some(v => Math.abs(v) > 1e9)) throw new RangeError(`${name} components must be within one billion metres`);
  return new THREE.Vector3(...values);
}
function direction(value, name, fallback) {
  const result = vector(value, name, fallback);
  if (result.lengthSq() < 1e-12) throw new RangeError(`${name} must have nonzero length`);
  return result.normalize();
}
function random(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296;};
}
function paint(value, fallback) {
  if (value == null) return new THREE.Color(fallback);
  if (value.isColor) {
    if (![value.r, value.g, value.b].every(Number.isFinite)) throw new TypeError('color channels must be finite');
    return value.clone();
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > 0xffffff)) throw new RangeError('numeric color must be between 0 and 0xffffff');
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError('color must be a THREE.Color, CSS color string or RGB hex number');
  if (typeof value === 'string' && (!/^(#[\da-f]{3}|#[\da-f]{6}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i.test(value.trim()) || /^[a-z]+$/i.test(value.trim()) && THREE.Color.NAMES[value.trim().toLowerCase()] === undefined)) throw new TypeError('color must be a valid CSS color');
  return new THREE.Color(value);
}

const particleVertex = /* glsl */`
uniform float uTime;
attribute vec4 aOriginStart, aVelocityLife, aColor, aShape, aExtra;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vInfo;
void main() {
  float age = uTime - aOriginStart.w;
  float life = max(aVelocityLife.w, .0001);
  float t = clamp(age / life, 0., 1.);
  float alive = step(.000001, aVelocityLife.w) * step(0., age) * (1. - step(life, age));
  age = clamp(age, 0., life);
  vec3 velocity = aVelocityLife.xyz;
  float travel = max(age, 0.) / (1. + aExtra.y * max(age, 0.));
  vec3 center = aOriginStart.xyz + velocity * travel;
  center.y -= .5 * aShape.w * age * age;
  vec4 mv = modelViewMatrix * vec4(center, 1.);
  float radius = aShape.x * max(.01, 1. + aShape.y * t);
  vec2 local = position.xy;
  if (aExtra.z > .01) {
    vec2 axis = (modelViewMatrix * vec4(velocity, 0.)).xy;
    axis = length(axis) > .00001 ? normalize(axis) : vec2(1., 0.);
    local = axis * position.x * (1. + aExtra.z) + vec2(-axis.y, axis.x) * position.y;
  } else if (aShape.z > 2.5) {
    float angle = aExtra.x * 6.283185 + age * (aExtra.x - .5) * 5.;
    local = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * local;
  }
  mv.xy += local * radius * alive;
  gl_Position = projectionMatrix * mv;
  vUv = uv * 2. - 1.;
  vColor = aColor;
  vInfo = vec4(t, aShape.z, aExtra.w * alive, aExtra.x);
}`;
const particleFragment = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vInfo;
void main() {
  float r = length(vUv);
  float t = vInfo.x;
  float style = vInfo.y;
  float edge = 1. - smoothstep(.75, 1., r);
  float alpha = exp(-r * r * 3.8) * edge;
  vec3 color = vColor.rgb * vColor.a;
  if (style > .5 && style < 1.5 || style > 4.5) {
    alpha = (1. - smoothstep(.15, .8, abs(vUv.y))) * (1. - smoothstep(.5, 1., abs(vUv.x)));
    color = mix(color, vec3(max(vColor.a, 1.)), pow(max(0., 1. - abs(vUv.y) * 4.), 3.) * .45);
  } else if (style > 1.5 && style < 2.5) {
    float ripple = .82 + .18 * sin(vUv.x * 12. + vInfo.w * 10.) * sin(vUv.y * 10. - t * 4.);
    alpha = (1. - smoothstep(.35, 1., r * ripple)) * .55;
  } else if (style > 2.5 && style < 3.5) {
    float diamond = abs(vUv.x) + abs(vUv.y);
    alpha = 1. - smoothstep(.65, .95, diamond);
    alpha = max(alpha * .75, exp(-abs(vUv.x) * 25.) * exp(-abs(vUv.y) * 2.) * .6);
    color *= .75 + .25 * sin(t * 30. + vInfo.w * 10.);
  } else if (style > 3.5 && style < 4.5) {
    alpha = (1. - smoothstep(.6, .8, max(abs(vUv.x), abs(vUv.y)))) * .9;
  }
  float fade = pow(1. - t, style > 1.5 && style < 2.5 ? .85 : 1.35);
  alpha *= vInfo.z * fade * min(1., t * 22. + .3);
  if (alpha < .003) discard;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const ringVertex = /* glsl */`
uniform float uTime;
attribute vec4 aOriginStart, aNormalLife, aColor, aShape;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vInfo;
void main() {
  float age = uTime - aOriginStart.w;
  float life = max(aNormalLife.w, .0001);
  float t = clamp(age / life, 0., 1.);
  float alive = step(.000001, aNormalLife.w) * step(0., age) * (1. - step(life, age));
  vec3 n = normalize(aNormalLife.xyz);
  vec3 tangent = normalize(cross(abs(n.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.), n));
  vec3 bitangent = cross(n, tangent);
  float radius = mix(aShape.x, aShape.y, 1. - pow(1. - t, 1.45));
  vec3 p = aOriginStart.xyz + (tangent * position.x + bitangent * position.y) * radius * alive;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
  vUv = uv * 2. - 1.; vColor = aColor; vInfo = vec3(t, aShape.z, aShape.w);
}`;
const ringFragment = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vInfo;
void main() {
  float r = length(vUv);
  float ring = 1. - smoothstep(vInfo.y, vInfo.y + .02, abs(r - .87));
  float angular = atan(vUv.y, vUv.x);
  float dashed = vInfo.z > .5 ? .45 + .55 * step(.15, sin(angular * 36. - vInfo.x * 12.)) : 1.;
  float inner = exp(-abs(r - .65) * 45.) * .06;
  float alpha = (ring * dashed + inner) * pow(1. - vInfo.x, .8) * min(1., vInfo.x * 20.);
  if (alpha < .003 || r > 1.) discard;
  gl_FragColor = vec4(vColor.rgb * vColor.a, alpha * .85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const shieldVertex = /* glsl */`
uniform float uTime;
attribute vec4 aOriginStart, aColor, aShape;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vNormal, vView;
varying float vFade;
void main() {
  float age = uTime - aOriginStart.w;
  float alive = step(0., age) * (1. - step(aShape.y, age));
  float appear = min(1., max(age, 0.) * 8.);
  float end = min(1., max(aShape.y - age, 0.) * 4.);
  float radius = aShape.x * (.98 + .02 * sin(age * 3. + aShape.z));
  vec3 p = aOriginStart.xyz + position * radius * alive;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  vUv = uv; vColor = aColor; vNormal = normalize(normalMatrix * normal); vView = -mv.xyz;
  vFade = alive * appear * end * aShape.w;
}`;
const shieldFragment = /* glsl */`
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vNormal, vView;
varying float vFade;
void main() {
  float fresnel = pow(1. - abs(dot(normalize(vNormal), normalize(vView))), 2.5);
  vec2 p = vUv * vec2(48., 24.);
  vec2 grid = vec2(1., 1.7320508);
  vec2 a = mod(p, grid) - grid * .5;
  vec2 b = mod(p - grid * .5, grid) - grid * .5;
  vec2 cell = dot(a, a) < dot(b, b) ? a : b;
  float hex = max(abs(cell.x), dot(abs(cell), vec2(.5, .8660254)));
  float line = smoothstep(.41, .48, hex);
  float alpha = (.025 + fresnel * .58 + line * .2) * vFade;
  if (alpha < .003) discard;
  gl_FragColor = vec4(vColor.rgb * vColor.a * (.55 + fresnel + line * .45), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Fixed pools: sprites + planar rings + hex spheres, at most three mesh draws. */
export function createFxSystem({scene, seed = 1, maxParticles = 1024, maxRings = 24, maxShields = 32, maxEmitters = 32, maxLights = 1} = {}) {
  if (scene != null && !scene.isObject3D) throw new TypeError('scene must be a THREE.Scene or Object3D');
  if (scene && registry.has(scene)) throw new Error('This scene already has an FX system; reuse it or call disposeFx(scene) first');
  finite(seed, 'seed');
  const capacities = Object.freeze({maxParticles: capacity(maxParticles, 'maxParticles', 65536), maxRings: capacity(maxRings, 'maxRings', 4096), maxShields: capacity(maxShields, 'maxShields', 256), maxEmitters: capacity(maxEmitters, 'maxEmitters', 4096), maxLights: capacity(maxLights, 'maxLights', 8)});
  const object3d = new THREE.Group(); object3d.name = 'fx_system';
  let time = 0, timeOrigin = 0, disposed = false, nextId = 1;
  const rng = random(seed), records = new Map();
  const overwritten = {particles: 0, rings: 0, shields: 0, emitters: 0, lights: 0};
  const uniforms = {uTime: {value: 0}};
  const recordLimit = Math.max(1, maxParticles + maxRings + maxShields + maxEmitters + maxLights);
  function material(name, vertexShader, fragmentShader, blending, side = THREE.FrontSide) {
    const m = new THREE.ShaderMaterial({name, uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: true, blending, side, toneMapped: true});
    m.forceSinglePass = true; return m;
  }
  function pool(name, count, base, fields, mat) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index.clone();
    for (const key of Object.keys(base.attributes)) geometry.setAttribute(key, base.attributes[key].clone());
    base.dispose();
    const attributes = {};
    for (const key of fields) {
      attributes[key] = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(key, attributes[key]);
    }
    geometry.instanceCount = 0;
    const mesh = new THREE.Mesh(geometry, mat); mesh.name = `fx_${name}`; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = name === 'particles' ? 21 : 20;
    mesh.castShadow = mesh.receiveShadow = false; object3d.add(mesh);
    const signatureWords = Object.values(attributes).map(attribute => new Uint32Array(attribute.array.buffer));
    return {name, count, mesh, geometry, attributes, signatureWords, owners: new Uint32Array(count), ends: new Float64Array(count), order: new Float64Array(count), serial: 0, high: 0};
  }
  const particles = pool('particles', maxParticles, new THREE.PlaneGeometry(2, 2), ['aOriginStart', 'aVelocityLife', 'aColor', 'aShape', 'aExtra'], material('fx_particles', particleVertex, particleFragment, THREE.NormalBlending));
  const rings = pool('rings', maxRings, new THREE.PlaneGeometry(2, 2), ['aOriginStart', 'aNormalLife', 'aColor', 'aShape'], material('fx_rings', ringVertex, ringFragment, THREE.AdditiveBlending, THREE.DoubleSide));
  const shields = pool('shields', maxShields, new THREE.SphereGeometry(1, 24, 16), ['aOriginStart', 'aColor', 'aShape'], material('fx_shields', shieldVertex, shieldFragment, THREE.AdditiveBlending));
  const pools = [particles, rings, shields];
  const emitters = Array.from({length: maxEmitters}, () => ({owner: 0, order: 0, end: 0}));
  const lights = Array.from({length: maxLights}, () => {
    const light = new THREE.PointLight(0xffffff, 0, 0, 2); light.name = 'fx_flare_light'; light.castShadow = false; light.visible = false; object3d.add(light);
    return {light, owner: 0, order: 0, end: 0};
  });
  let resourceSerial = 0;
  const write = (p, key, slot, values) => {p.attributes[key].array.set(values, slot * 4); p.attributes[key].needsUpdate = true;};
  function claim(p, record, end) {
    if (!p.count) return -1;
    let slot = -1, oldest = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.ends[i] <= time || !p.owners[i]) {slot = i; break;}
      if (p.order[i] < oldest) {oldest = p.order[i]; slot = i;}
    }
    const previous = records.get(p.owners[slot]);
    if (p.ends[slot] > time && p.owners[slot]) overwritten[p.name]++;
    if (previous) previous[p.name].delete(slot);
    p.owners[slot] = record.id; p.ends[slot] = end; p.order[slot] = ++p.serial;
    record[p.name].add(slot); p.high = Math.max(p.high, slot + 1); p.geometry.instanceCount = p.high; p.mesh.visible = true;
    return slot;
  }
  function allocateSmall(list, record, name, end) {
    if (!list.length) return null;
    let slot = list.find(x => !x.owner || x.end <= time);
    if (!slot) {slot = list.reduce((a, b) => a.order < b.order ? a : b); overwritten[name]++;}
    const previous = records.get(slot.owner); if (previous) previous[name].delete(slot);
    slot.owner = record.id; slot.end = end; slot.order = ++resourceSerial; record[name].add(slot); return slot;
  }
  function particle(record, origin, velocity, {life = record.duration, size = .2, grow = 0, style = 0, gravity = 0, drag = 0, stretch = 0, opacity = 1, brightness = 2, color = record.color, delay = 0} = {}) {
    const birth = time + delay, slot = claim(particles, record, birth + life); if (slot < 0) return;
    write(particles, 'aOriginStart', slot, [origin.x, origin.y, origin.z, birth - timeOrigin]);
    write(particles, 'aVelocityLife', slot, [velocity.x, velocity.y, velocity.z, life]);
    write(particles, 'aColor', slot, [color.r, color.g, color.b, brightness]);
    write(particles, 'aShape', slot, [size, grow, style, gravity]);
    write(particles, 'aExtra', slot, [record.rng(), drag, stretch, opacity]);
  }
  function ring(record, {normal = record.normal, start = .2, end = 8, life = record.duration, width = .03, dashed = 0, brightness = 3, delay = 0} = {}) {
    const birth = time + delay, slot = claim(rings, record, birth + life); if (slot < 0) return;
    write(rings, 'aOriginStart', slot, [record.position.x, record.position.y + .025 * record.size, record.position.z, birth - timeOrigin]);
    write(rings, 'aNormalLife', slot, [normal.x, normal.y, normal.z, life]);
    write(rings, 'aColor', slot, [record.color.r, record.color.g, record.color.b, brightness]);
    write(rings, 'aShape', slot, [start * record.size, end * record.size, width, dashed]);
  }
  function unit(record, hemisphere = false) {
    const y = hemisphere ? record.rng() : record.rng() * 2 - 1, angle = record.rng() * Math.PI * 2, radius = Math.sqrt(1 - y * y);
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }
  function emitBoost(record, position, count = 3) {
    for (let j = 0; j < count; j++) {
      const scatter = unit(record).multiplyScalar(.2 * record.size);
      const velocity = record.direction.clone().multiplyScalar(-(7 + record.rng() * 3) * record.size).add(scatter);
      particle(record, position.clone().add(scatter), velocity, {life: .7 + record.rng() * .2, size: (.13 + record.rng() * .07) * record.size, grow: -.55, stretch: 3, drag: .15, brightness: 2.8, opacity: .75});
    }
  }
  function alive(record) {
    if (disposed || record.stopped) return false;
    for (const p of pools) for (const slot of record[p.name]) if (p.owners[slot] === record.id && p.ends[slot] > time) return true;
    for (const name of ['emitters', 'lights']) for (const slot of record[name]) if (slot.owner === record.id && slot.end > time) return true;
    return false;
  }
  function stop(record) {
    if (record.stopped) return;
    record.stopped = true;
    for (const p of pools) for (const slot of record[p.name]) {
      if (p.owners[slot] !== record.id) continue;
      p.owners[slot] = 0; p.ends[slot] = 0;
      const field = p === particles ? 'aVelocityLife' : p === rings ? 'aNormalLife' : 'aShape';
      p.attributes[field].array[slot * 4 + (p === shields ? 1 : 3)] = 0; p.attributes[field].needsUpdate = true;
    }
    for (const name of ['emitters', 'lights']) for (const slot of record[name]) {
      if (slot.owner !== record.id) continue;
      slot.owner = 0; slot.end = 0; if (slot.light) {slot.light.intensity = 0; slot.light.visible = false;}
    }
    records.delete(record.id); refreshVisibility();
  }
  function move(record, input) {
    if (!alive(record)) return;
    const position = vector(input, 'position'), delta = position.clone().sub(record.position);
    // A trail leaves previous particles in place; its emitter interpolates from the old head.
    if (record.kind !== 'boost') for (const p of pools) for (const slot of record[p.name]) {
      if (p.owners[slot] !== record.id || p.ends[slot] <= time) continue;
      const a = p.attributes.aOriginStart;
      a.array[slot * 4] += delta.x; a.array[slot * 4 + 1] += delta.y; a.array[slot * 4 + 2] += delta.z; a.needsUpdate = true;
    }
    record.position.copy(position);
    for (const slot of record.lights) if (slot.owner === record.id) slot.light.position.copy(position);
  }
  function refreshVisibility() {
    for (const p of pools) {
      let high = 0;
      for (let i = 0; i < p.high; i++) if (p.owners[i] && p.ends[i] > time) high = i + 1;
      p.mesh.visible = high > 0; p.geometry.instanceCount = high;
    }
  }
  function spawn(kind, position, options = {}) {
    if (disposed) return noopHandle;
    const originalKind = kind; kind = aliases[kind] || kind;
    if (!FX_KINDS.includes(kind)) throw new RangeError(`Unknown FX kind: ${originalKind}`);
    const pos = vector(position, 'position');
    const sizeInput = options.size ?? ({explosion_small: 1, explosion_medium: 2, explosion_large: 4}[originalKind] || 1);
    finite(sizeInput, 'size'); if (sizeInput <= 0) throw new RangeError('size must be positive');
    const size = THREE.MathUtils.clamp(sizeInput, .01, 1000);
    const rawDuration = options.duration ?? durations[kind];
    if (!(rawDuration === Infinity && (kind === 'boost' || kind === 'shield'))) {
      finite(rawDuration, 'duration'); if (rawDuration <= 0) throw new RangeError('duration must be positive');
    }
    const duration = rawDuration === Infinity ? Infinity : THREE.MathUtils.clamp(rawDuration, .02, 60);
    const dir = direction(options.direction, 'direction', new THREE.Vector3(0, 0, -1));
    const normal = direction(options.normal, 'normal', new THREE.Vector3(0, 1, 0));
    const color = paint(options.color, colors[kind]);
    if (options.seed != null) finite(options.seed, 'seed');
    while (records.size >= recordLimit) stop(records.values().next().value);
    const record = {id: nextId++, kind, position: pos, size, duration, direction: dir, normal, color, rng: random((rng() * 4294967296) ^ (options.seed ?? 0)), stopped: false, particles: new Set(), rings: new Set(), shields: new Set(), emitters: new Set(), lights: new Set()};
    records.set(record.id, record);
    const zero = new THREE.Vector3();
    if (kind === 'laser') {
      particle(record, pos, dir.clone().multiplyScalar(24 * size), {size: .095 * size, style: 5, stretch: 10, brightness: 6, opacity: 1});
      particle(record, pos, dir.clone().multiplyScalar(24 * size), {size: .35 * size, grow: -.45, brightness: 2, opacity: .45});
    } else if (kind === 'explosion') {
      particle(record, pos, zero, {life: duration * .16, size: 1.2 * size, grow: 1.8, brightness: 7, color: new THREE.Color(0xffe4a0)});
      for (let i = 0; i < 38; i++) {
        const velocity = unit(record).multiplyScalar((2 + record.rng() * 5) * size / Math.max(duration, .3));
        particle(record, pos, velocity, {life: duration * (.45 + record.rng() * .55), size: (.18 + record.rng() * .35) * size, grow: 1.5, brightness: 3.4, drag: .35, gravity: .25 * size});
      }
      for (let i = 0; i < 15; i++) {
        particle(record, pos, unit(record).multiplyScalar((1 + record.rng() * 3) * size / Math.max(duration, .3)), {life: duration, size: (.5 + record.rng() * .6) * size, grow: 2, style: 2, brightness: 1, color: new THREE.Color(.14, .12, .13), opacity: .55, drag: .6, delay: duration * .05});
      }
      for (let i = 0; i < 22; i++) particle(record, pos, unit(record).multiplyScalar((5 + record.rng() * 7) * size / Math.max(duration, .3)), {life: duration * (.4 + record.rng() * .4), size: .045 * size, style: 1, stretch: 3, gravity: 2 * size, brightness: 4, drag: .5});
      ring(record, {end: 6, life: duration * .55, width: .015, brightness: 4});
    } else if (kind === 'drill') {
      for (let i = 0; i < 30; i++) {
        const velocity = unit(record).addScaledVector(dir, 1.5).normalize().multiplyScalar((3 + record.rng() * 6) * size / Math.max(duration, .3));
        particle(record, pos, velocity, {life: duration * (.4 + record.rng() * .6), size: (.028 + record.rng() * .03) * size, style: 1, stretch: 3 + record.rng() * 3, gravity: 7 * size, drag: .25, brightness: 4.5});
      }
      particle(record, pos, zero, {life: Math.min(duration, .2), size: .6 * size, brightness: 5});
    } else if (kind === 'flare') {
      particle(record, pos, zero, {life: duration, size: .7 * size, grow: 1.8, brightness: 5});
      for (let i = 0; i < 32; i++) particle(record, pos, unit(record).multiplyScalar((3 + record.rng() * 4) * size / Math.max(duration, .3)), {life: duration * (.45 + record.rng() * .55), size: (.04 + record.rng() * .08) * size, style: 1, stretch: 6, brightness: 4, drag: .22});
      ring(record, {end: 5, life: duration * .55, brightness: 3});
      const slot = allocateSmall(lights, record, 'lights', time + duration);
      if (slot) {slot.light.color.copy(color); slot.light.position.copy(pos); slot.light.distance = 24 * size; slot.base = 70 * size * size; slot.birth = time; slot.duration = duration; slot.light.intensity = slot.base; slot.light.visible = true;}
    } else if (kind === 'scan') {
      ring(record, {end: 8, dashed: 1, width: .025, brightness: 3.6});
      ring(record, {end: 6.5, dashed: 1, width: .012, life: duration * .8, delay: duration * .15, brightness: 2.6});
      particle(record, pos, zero, {size: .4 * size, grow: 2, life: duration * .3, brightness: 3});
    } else if (kind === 'shield') {
      const slot = claim(shields, record, time + duration);
      if (slot >= 0) {
        write(shields, 'aOriginStart', slot, [pos.x, pos.y, pos.z, time - timeOrigin]);
        write(shields, 'aColor', slot, [color.r, color.g, color.b, 2.1]);
        write(shields, 'aShape', slot, [2.5 * size, duration === Infinity ? 1e20 : duration, record.rng() * 10, 1]);
      }
    } else if (kind === 'boost') {
      const slot = allocateSmall(emitters, record, 'emitters', time + duration);
      if (slot) {slot.record = record; slot.previous = pos.clone(); slot.accumulator = 0; slot.birth = time; emitBoost(record, pos, 5);}
    } else if (kind === 'landing') {
      for (let i = 0; i < 38; i++) {
        const angle = record.rng() * Math.PI * 2;
        const velocity = new THREE.Vector3(Math.cos(angle), .08 + record.rng() * .25, Math.sin(angle)).multiplyScalar((1.2 + record.rng() * 2.4) * size / Math.max(duration, .3));
        particle(record, pos.clone().add(new THREE.Vector3(0, .08 * size, 0)), velocity, {life: duration * (.7 + record.rng() * .3), size: (.25 + record.rng() * .3) * size, grow: 2.5, style: 2, brightness: 1, opacity: .3, drag: .28});
      }
      ring(record, {start: .2, end: 3.5, width: .045, brightness: .8, life: duration * .6});
    } else if (kind === 'dig') {
      for (let i = 0; i < 30; i++) {
        const velocity = unit(record, true).multiplyScalar((2 + record.rng() * 4) * size / Math.max(duration, .3)); velocity.y += 1.5 * size;
        particle(record, pos, velocity, {life: duration * (.6 + record.rng() * .4), size: (.04 + record.rng() * .075) * size, style: 4, gravity: 8 * size, brightness: .8});
      }
      for (let i = 0; i < 8; i++) particle(record, pos, unit(record, true).multiplyScalar(size), {life: duration, size: .3 * size, grow: 3, style: 2, brightness: .9, opacity: .3});
    } else if (kind === 'gold') {
      for (let i = 0; i < 48; i++) {
        const velocity = unit(record, true).multiplyScalar((.5 + record.rng() * 2) * size / Math.max(duration, .5)); velocity.y += (2 + record.rng() * 2) * size / Math.max(duration, .5);
        particle(record, pos, velocity, {life: duration * (.65 + record.rng() * .35), size: (.055 + record.rng() * .08) * size, style: 3, gravity: 1.8 * size / Math.max(duration, .5), brightness: 4.2});
      }
      particle(record, pos, zero, {life: duration * .3, size: .8 * size, grow: 2, brightness: 3});
    }
    return {
      get active() {return alive(record);},
      stop() {if (!disposed) stop(record);},
      setPosition(p) {if (!disposed) move(record, p);},
      // Future trail emissions follow the new direction; existing trail particles keep their momentum.
      setDirection(d) {if (alive(record)) record.direction.copy(direction(d, 'direction'));},
    };
  }
  function update(dt) {
    if (disposed) return;
    finite(dt, 'dt'); if (dt < 0) throw new RangeError('dt must be nonnegative');
    const previousTime = time, nextTime = time + dt;
    if (!Number.isFinite(nextTime) || nextTime > 1e12) throw new RangeError('FX clock exceeds the supported one trillion seconds');
    time = nextTime;
    // Rebase infrequently so Float32 start times retain sub-frame precision in long sessions.
    if (time - timeOrigin > 4096) {
      const shift = time - timeOrigin;
      for (const p of pools) {
        let changed = false;
        for (let i = 0; i < p.high; i++) if (p.owners[i] && p.ends[i] > time) {p.attributes.aOriginStart.array[i * 4 + 3] -= shift; changed = true;}
        if (changed) p.attributes.aOriginStart.needsUpdate = true;
      }
      timeOrigin = time;
    }
    uniforms.uTime.value = time - timeOrigin;
    for (const slot of emitters) {
      if (!slot.owner) continue;
      const record = slot.record;
      if (!record || record.stopped || slot.end <= previousTime) {slot.owner = 0; continue;}
      const elapsed = Math.max(0, Math.min(time, slot.end) - previousTime);
      slot.accumulator += elapsed * 36;
      const count = Math.min(18, Math.floor(slot.accumulator));
      slot.accumulator = Math.min(1, slot.accumulator - count);
      // Cap catch-up after hidden tabs: at most 18 particles per emitter per update.
      if (slot.end > time) for (let i = 0; i < count; i++) emitBoost(record, slot.previous.clone().lerp(record.position, (i + 1) / count), 1);
      slot.previous.copy(record.position);
      if (slot.end <= time) {slot.owner = 0; record.emitters.delete(slot);}
    }
    for (const slot of lights) {
      if (!slot.owner) continue;
      const t = THREE.MathUtils.clamp((time - slot.birth) / slot.duration, 0, 1);
      slot.light.intensity = slot.base * Math.pow(1 - t, 2) * (.9 + .1 * Math.cos(t * 28));
      if (slot.end <= time) {slot.light.visible = false; slot.light.intensity = 0; const record = records.get(slot.owner); if (record) record.lights.delete(slot); slot.owner = 0;}
    }
    refreshVisibility();
    for (const record of records.values()) if (!alive(record)) {record.stopped = true; records.delete(record.id);}
  }
  function getStats() {
    const active = p => {let count = 0; for (let i = 0; i < p.high; i++) if (p.owners[i] && p.ends[i] > time) count++; return count;};
    let signature = 2166136261;
    const hash = value => {signature ^= value; signature = Math.imul(signature, 16777619) >>> 0;};
    for (const p of pools) for (let i = 0; i < p.high; i++) if (p.owners[i] && p.ends[i] > time) {
      hash(p.owners[i]);
      for (const words of p.signatureWords) for (let j = 0; j < 4; j++) hash(words[i * 4 + j]);
    }
    for (const slot of emitters) if (slot.owner && slot.end > time) {hash(slot.owner); hash(Math.round(slot.record.position.x * 1000)); hash(Math.round(slot.record.position.y * 1000)); hash(Math.round(slot.record.position.z * 1000));}
    return {activeParticles: disposed ? 0 : active(particles), activeRings: disposed ? 0 : active(rings), activeShields: disposed ? 0 : active(shields), activeEmitters: disposed ? 0 : emitters.filter(x => x.owner && x.end > time).length, activeLights: disposed ? 0 : lights.filter(x => x.owner && x.end > time).length, capacities, meshDrawCalls: disposed ? 0 : pools.filter(p => p.mesh.visible).length, submittedTriangles: disposed ? 0 : pools.reduce((sum, p) => sum + (p.mesh.visible ? p.geometry.index.count / 3 * p.geometry.instanceCount : 0), 0), overwritten: {...overwritten}, time, disposed, signature: signature.toString(16).padStart(8, '0')};
  }
  function clear() {
    if (disposed) return;
    for (const record of [...records.values()]) stop(record);
    for (const p of pools) {p.owners.fill(0); p.ends.fill(0); p.high = 0; p.geometry.instanceCount = 0; p.mesh.visible = false;}
  }
  function dispose() {
    if (disposed) return;
    clear(); disposed = true; object3d.removeFromParent();
    for (const p of pools) {p.geometry.dispose(); p.mesh.material.dispose();}
    for (const slot of lights) {slot.light.visible = false; slot.light.intensity = 0; slot.light.dispose();}
    object3d.clear(); if (scene && registry.get(scene) === system) registry.delete(scene);
  }
  const system = {object3d, spawn, update, getStats, clear, dispose};
  if (scene) {scene.add(object3d); registry.set(scene, system);}
  return system;
}

export function spawnFx(scene, kind, position, options = {}) {
  if (!scene?.isObject3D) throw new TypeError('scene must be a THREE.Scene or Object3D');
  const system = registry.get(scene) || createFxSystem({scene});
  return system.spawn(kind, position, options);
}
export function updateFx(scene, dt) {registry.get(scene)?.update(dt);}
export function clearFx(scene) {registry.get(scene)?.clear();}
export function disposeFx(scene) {registry.get(scene)?.dispose();}
