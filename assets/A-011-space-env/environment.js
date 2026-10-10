/** Space Party environment helper — original CC0-1.0 source. three.js r160. */
import * as THREE from 'three';

const IMAGE_URLS = Object.freeze({
  space: new URL('./space.jpg', import.meta.url).href,
  nebula: new URL('./space_nebula.jpg', import.meta.url).href,
});
const LIGHTING_URL = new URL('./lighting.json', import.meta.url).href;
const TAU = Math.PI * 2;

function checkVariant(variant) {
  if (variant !== 'space' && variant !== 'nebula') throw new RangeError('variant must be "space" or "nebula"');
  return variant;
}
function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
function intensityValue(value, name) {
  finite(value, name);
  if (value < 0 || value > 1e6) throw new RangeError(`${name} must be between 0 and 1000000`);
  return value;
}
function rotationValue(value) {
  finite(value, 'rotation');
  return ((value % TAU) + TAU) % TAU;
}
function lightingCoefficients(data) {
  const result = {};
  for (const variant of ['space', 'nebula']) {
    const values = data?.[variant];
    if (!Array.isArray(values) || values.length !== 9 || values.some(row => !Array.isArray(row) || row.length !== 3 || row.some(value => !Number.isFinite(value)))) {
      throw new TypeError(`lighting.json ${variant} must contain nine finite RGB spherical-harmonic coefficients`);
    }
    result[variant] = values.map(row => new THREE.Vector3(...row));
  }
  return result;
}
function poleColors(data) {
  const result = {};
  for (const variant of ['space', 'nebula']) {
    result[variant] = {};
    for (const pole of ['north', 'south']) {
      const values = data?.poles?.[variant]?.[pole];
      if (!Array.isArray(values) || values.length !== 3 || values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new TypeError(`lighting.json poles.${variant}.${pole} must contain three linear RGB values from zero to one`);
      }
      result[variant][pole] = new THREE.Vector3(...values);
    }
  }
  return result;
}

// THREE uses Y and Z in its l=1 terms and a Z-oriented l=2 basis. Convert the
// quadratics to a symmetric traceless tensor, rotate Q'=R^T Q R, then recover
// coefficients. This is exact for l<=2 and never captures or renders a cubemap.
function rotateCoefficients(source, destination, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), cs = c * s;
  const a = .315392, b = .546274;
  for (const component of ['x', 'y', 'z']) {
    destination[0][component] = source[0][component];
    destination[1][component] = source[1][component];
    destination[2][component] = c * source[2][component] - s * source[3][component];
    destination[3][component] = s * source[2][component] + c * source[3][component];
    const qxx = b * source[8][component] - a * source[6][component];
    const qyy = -b * source[8][component] - a * source[6][component];
    const qzz = 2 * a * source[6][component];
    const qxy = b * source[4][component], qyz = b * source[5][component], qxz = b * source[7][component];
    const rxx = c * c * qxx + 2 * cs * qxz + s * s * qzz;
    const rzz = s * s * qxx - 2 * cs * qxz + c * c * qzz;
    const rxy = c * qxy + s * qyz;
    const ryz = -s * qxy + c * qyz;
    const rxz = cs * (qzz - qxx) + (c * c - s * s) * qxz;
    destination[4][component] = rxy / b;
    destination[5][component] = ryz / b;
    destination[6][component] = rzz / (2 * a);
    destination[7][component] = rxz / b;
    destination[8][component] = (rxx - qyy) / (2 * b);
  }
}

const vertexShader = /* glsl */`
varying vec3 vDirection;
void main() {
  vDirection = position;
  // Camera translation is deliberately absent: this cube is an infinitely
  // distant background. The root's transform does not move the sky.
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.);
  gl_Position = clip.xyww;
}`;
const fragmentShader = /* glsl */`
uniform sampler2D uMap;
uniform float uIntensity;
uniform vec2 uRotation;
uniform vec3 uPoleNorth, uPoleSouth;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  // Sample RY(-rotation)*direction so positive angles rotate the artwork +Y.
  direction = vec3(uRotation.x * direction.x - uRotation.y * direction.z,
                   direction.y,
                   uRotation.y * direction.x + uRotation.x * direction.z);
  // Latitude-longitude artwork can converge into a radial pinch. Fade the
  // polar caps to their baked linear edge averages, becoming completely
  // independent of longitude before reaching either mathematical pole.
  float poleBlend = smoothstep(.80, .995, abs(direction.y));
  vec3 poleColor = direction.y >= 0. ? uPoleNorth : uPoleSouth;
  vec3 color = poleColor;
  // Calculate derivatives outside divergent sampling branches. Longitude jumps
  // from U=1 to U=0 at the wrap, but its true local footprint remains small.
  // Wrapping the U derivative prevents an erroneously coarse mip stripe there.
  float longitude = dot(direction.xz, direction.xz) > .000000000001
    ? atan(direction.z, direction.x) : 0.;
  vec2 uv = vec2(.5 + longitude * .15915494309189535,
                .5 + asin(clamp(direction.y, -1., 1.)) * .3183098861837907);
  vec2 gradientX = dFdx(uv), gradientY = dFdy(uv);
  gradientX.x -= floor(gradientX.x + .5);
  gradientY.x -= floor(gradientY.x + .5);
  // Skip texture sampling in the uniform cap; atan(0,0) is guarded above.
  if (poleBlend < 1.) {
    color = texture2DGradEXT(uMap, uv, gradientX, gradientY).rgb;
    // Generated panoramas can have a small residual edge mismatch. Blend only
    // the final one percent on either side toward the mirrored edge average.
    // RepeatWrapping still supplies correct bilinear/mipmap sampling at U=0/1.
    float seamDistance = min(uv.x, 1. - uv.x);
    if (seamDistance < .01) {
      vec3 opposite = texture2DGradEXT(uMap, vec2(1. - uv.x, uv.y),
        vec2(-gradientX.x, gradientX.y), vec2(-gradientY.x, gradientY.y)).rgb;
      color = mix((color + opposite) * .5, color, smoothstep(0., .01, seamDistance));
    }
    color = mix(color, poleColor, poleBlend);
  }
  gl_FragColor = vec4(color * uIntensity, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * One equirectangular JPEG + one diffuse LightProbe, without PMREM, cube
 * conversion, reflection renders, scene.background or scene.environment.
 * Caller adds object3d to its scene. Designed for a perspective game camera.
 * A supplied loader must return a fresh Texture for each request; the helper
 * owns only those returned textures and its own geometry/material/probe.
 */
export async function createSpaceEnvironment({variant = 'space', intensity = 1, lightingIntensity = .35, rotation = 0, loader = new THREE.TextureLoader()} = {}) {
  checkVariant(variant);
  intensity = intensityValue(intensity, 'intensity');
  lightingIntensity = intensityValue(lightingIntensity, 'lightingIntensity');
  rotation = rotationValue(rotation);
  if (!loader || typeof loader.load !== 'function' && typeof loader.loadAsync !== 'function') throw new TypeError('loader must provide load or loadAsync');
  const response = await fetch(LIGHTING_URL);
  if (!response.ok) throw new Error(`Could not load environment lighting: HTTP ${response.status}`);
  const lightingData = await response.json();
  const coefficients = lightingCoefficients(lightingData), poles = poleColors(lightingData);
  const object3d = new THREE.Group(); object3d.name = 'space_environment';
  const uniforms = {uMap: {value: null}, uIntensity: {value: intensity}, uRotation: {value: new THREE.Vector2(Math.cos(rotation), Math.sin(rotation))}, uPoleNorth: {value: new THREE.Vector3()}, uPoleSouth: {value: new THREE.Vector3()}};
  const material = new THREE.ShaderMaterial({name: 'space_equirectangular', uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: false, toneMapped: true});
  // r160 maps texture2DGradEXT to core textureGrad on WebGL2; these flags also
  // request the corresponding derivative/LOD extensions on WebGL1.
  material.extensions.derivatives = true;
  material.extensions.shaderTextureLOD = true;
  material.forceSinglePass = true;
  const sky = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  sky.name = 'space_sky'; sky.frustumCulled = false; sky.renderOrder = -10000;
  sky.castShadow = sky.receiveShadow = false;
  const probe = new THREE.LightProbe(new THREE.SphericalHarmonics3(), lightingIntensity); probe.name = 'space_diffuse_probe';
  object3d.add(sky, probe);
  let disposed = false, requestId = 0, activeVariant = null, activeTexture = null, pending = null;
  const released = new WeakSet();
  function release(texture) {
    if (!texture?.isTexture || released.has(texture)) return;
    released.add(texture); texture.dispose();
  }
  function loadTexture(url) {
    if (typeof loader.load !== 'function') return Promise.resolve().then(() => loader.loadAsync(url));
    return new Promise((resolve, reject) => {
      let candidate, failed = false;
      try {
        candidate = loader.load(url, resolve, undefined, error => {
          failed = true; release(candidate);
          reject(error instanceof Error ? error : new Error(`Could not load environment texture: ${url}`, {cause: error}));
        });
        // A test/custom loader may complete synchronously before returning.
        if (failed) release(candidate);
      } catch (error) {release(candidate); reject(error);}
    });
  }
  function setVariant(nextVariant) {
    if (disposed) return Promise.resolve(false);
    checkVariant(nextVariant);
    if (pending?.variant === nextVariant) return pending.promise;
    if (activeVariant === nextVariant) {
      // Selecting the current sky cancels a pending switch to another sky.
      requestId++; pending = null; return Promise.resolve(false);
    }
    const id = ++requestId;
    const promise = (async () => {
      let texture;
      try {
        texture = await loadTexture(IMAGE_URLS[nextVariant]);
        if (!texture?.isTexture) throw new TypeError('Environment loader must return a THREE.Texture');
        if (disposed || id !== requestId) {release(texture); return false;}
        texture.name = nextVariant === 'space' ? 'space_panorama' : 'space_nebula_panorama';
        texture.colorSpace = THREE.SRGBColorSpace;
        // Keep UVMapping: assigning EquirectangularReflectionMapping would
        // invite three.js's cubemap conversion path if used elsewhere.
        texture.mapping = THREE.UVMapping;
        texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true; texture.anisotropy = 1; texture.flipY = true;
        texture.needsUpdate = true;
        const previous = activeTexture;
        activeTexture = texture; activeVariant = nextVariant;
        uniforms.uMap.value = texture;
        uniforms.uPoleNorth.value.copy(poles[nextVariant].north);
        uniforms.uPoleSouth.value.copy(poles[nextVariant].south);
        rotateCoefficients(coefficients[nextVariant], probe.sh.coefficients, rotation);
        release(previous);
        return true;
      } catch (error) {
        if (texture !== activeTexture) release(texture);
        throw error;
      } finally {
        if (pending?.id === id) pending = null;
      }
    })();
    pending = {id, variant: nextVariant, promise};
    return promise;
  }
  function setIntensity(value) {
    if (disposed) return;
    uniforms.uIntensity.value = intensityValue(value, 'intensity');
  }
  function setLightingIntensity(value) {
    if (disposed) return;
    probe.intensity = intensityValue(value, 'lightingIntensity');
  }
  function setRotation(value) {
    if (disposed) return;
    rotation = rotationValue(value);
    uniforms.uRotation.value.set(Math.cos(rotation), Math.sin(rotation));
    if (activeVariant) rotateCoefficients(coefficients[activeVariant], probe.sh.coefficients, rotation);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; requestId++; pending = null;
    object3d.removeFromParent(); release(activeTexture);
    activeTexture = null; uniforms.uMap.value = null;
    sky.geometry.dispose(); material.dispose(); probe.dispose(); object3d.clear();
  }
  const environment = {
    object3d, sky, probe,
    get texture() {return activeTexture;},
    get variant() {return activeVariant;},
    setVariant, setIntensity, setLightingIntensity, setRotation, dispose,
  };
  try {await setVariant(variant); return environment;} catch (error) {dispose(); throw error;}
}
