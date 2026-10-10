// Isolated browser checks. Call before starting the preview's animation loop.
// Uses real JPEG loads and an injected delayed loader for lifecycle races.
export async function runEnvironmentChecks(THREE, envModule, renderer) {
  const checks = [], measurements = { variants: {}, camera: {}, poles: {}, seam: {}, loading: {}, shaderErrors: [], glErrors: [] };
  const owned = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const attempt = async (name, fn) => {
    try { await fn(); } catch (error) { check(name, false, String(error?.stack || error).slice(0, 1800)); }
  };
  const originalRender = renderer.render, originalTarget = renderer.setRenderTarget;
  const oldTarget = renderer.getRenderTarget(), oldAutoClear = renderer.autoClear;
  const oldShaderError = renderer.debug.onShaderError, oldShaderCheck = renderer.debug.checkShaderErrors;
  let renderInvocations = 0, targetChanges = 0;
  renderer.render = function (...args) { renderInvocations++; return originalRender.apply(this, args); };
  renderer.setRenderTarget = function (target, ...args) { if (target) targetChanges++; return originalTarget.call(this, target, ...args); };
  renderer.autoClear = true;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => measurements.shaderErrors.push({
    program: (gl.getProgramInfoLog(program) || '').slice(0, 1500),
    vertex: (gl.getShaderInfoLog(vertex) || '').slice(0, 1500), fragment: (gl.getShaderInfoLog(fragment) || '').slice(0, 1500),
  });
  const camera = new THREE.PerspectiveCamera(65, 1.6, .1, 10000);
  camera.position.set(0, 6, 18); camera.lookAt(0, 6, 0); camera.updateMatrixWorld();
  const make = async (options = {}) => {
    const scene = new THREE.Scene();
    const environment = await envModule.createSpaceEnvironment(options);
    owned.push(environment); scene.add(environment.object3d);
    return { scene, environment };
  };
  const draw = (scene) => {
    renderer.setRenderTarget(null); renderer.info.reset();
    const before = renderInvocations;
    renderer.render(scene, camera);
    const gl = renderer.getContext(), error = gl.getError();
    if (error !== gl.NO_ERROR) measurements.glErrors.push(error);
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, renderInvocations: renderInvocations - before,
      textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
  };
  const pixels = (size = 256) => {
    const gl = renderer.getContext(), w = Math.min(gl.drawingBufferWidth, size), h = Math.min(gl.drawingBufferHeight, size);
    const data = new Uint8Array(w * h * 4);
    gl.readPixels(Math.floor((gl.drawingBufferWidth - w) / 2), Math.floor((gl.drawingBufferHeight - h) / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  };
  const compare = (a, b) => {
    let maxDifference = 0, totalDifference = 0, different = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (i % 4 !== 3) {
      const d = Math.abs(a[i] - b[i]); maxDifference = Math.max(maxDifference, d); totalDifference += d; n++; if (d) different++;
    }
    return { maxDifference, meanDifference: totalDifference / n, changedChannels: different, channels: n };
  };
  const dimensions = (texture) => ({ width: texture.image?.naturalWidth || texture.image?.width, height: texture.image?.naturalHeight || texture.image?.height });
  const watchDispose = (resource) => {
    const result = { count: 0 };
    resource.addEventListener('dispose', () => result.count++);
    return result;
  };
  const finiteObject = (root) => {
    let bad = 0, numbers = 0;
    root.traverse((o) => {
      for (const attribute of Object.values(o.geometry?.attributes || {})) for (const value of attribute.array) { numbers++; if (!Number.isFinite(value)) bad++; }
      for (const value of [...o.position, ...o.quaternion, ...o.scale, ...o.matrix.elements, ...o.matrixWorld.elements]) { numbers++; if (!Number.isFinite(value)) bad++; }
    });
    return { bad, numbers };
  };
  const delayedLoader = () => {
    const real = new THREE.TextureLoader();
    const pending = [], calls = [];
    let hold = false;
    return {
      calls, pending, set hold(value) { hold = value; },
      loader: { loadAsync(url) {
        calls.push(url);
        if (!hold) return real.loadAsync(url);
        return new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
      } },
      async release(index) {
        const entry = pending[index];
        const texture = await real.loadAsync(entry.url), disposal = watchDispose(texture);
        entry.resolve(texture);
        return { texture, disposal };
      },
    };
  };
  try {
    check('environment factory is exported', typeof envModule.createSpaceEnvironment === 'function');

    await attempt('real textures, sky budget and diffuse probe', async () => {
      const baseline = renderer.info.memory.textures;
      const beforeLoad = renderInvocations;
      const { scene, environment: e } = await make();
      check('loading requires no renderer operation', renderInvocations === beforeLoad && targetChanges === 0);
      for (const variant of ['space', 'nebula']) {
        if (variant !== e.variant) await e.setVariant(variant);
        const texture = e.texture, size = dimensions(texture), actual = draw(scene);
        measurements.variants[variant] = { ...size, colorSpace: texture.colorSpace, actual };
        check(`${variant}: 2048×1024 sRGB image texture`, size.width === 2048 && size.height === 1024 && texture.colorSpace === THREE.SRGBColorSpace && texture.isTexture && !texture.isCubeTexture, measurements.variants[variant]);
        check(`${variant}: 12 triangles and one sky draw`, actual.calls === 1 && actual.triangles === 12 && actual.renderInvocations === 1, actual);
        check(`${variant}: exactly one resident sky texture`, actual.textures === baseline + 1, { baseline, actual: actual.textures });
      }
      const coefficients = e.probe.sh.coefficients;
      check('diffuse lighting uses nine finite SH coefficients', e.probe.isLightProbe && coefficients.length === 9 &&
        coefficients.every((v) => [v.x, v.y, v.z].every(Number.isFinite)) && coefficients.some((v) => v.lengthSq() > 0),
        { intensity: e.probe.intensity, coefficients: coefficients.map((v) => v.toArray()) });
      e.setRotation(0);
      const unrotated = e.probe.sh.clone(), angle = .73, axis = new THREE.Vector3(0, 1, 0);
      e.setRotation(angle);
      let maximumLightingError = 0;
      for (const xyz of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, -1, 0], [.3, .7, -.8]]) {
        const direction = new THREE.Vector3(...xyz).normalize();
        const actual = e.probe.sh.getAt(direction, new THREE.Vector3());
        const expected = unrotated.getAt(direction.clone().applyAxisAngle(axis, -angle), new THREE.Vector3());
        maximumLightingError = Math.max(maximumLightingError, actual.distanceTo(expected));
      }
      check('diffuse SH rotation follows the panorama orientation', maximumLightingError < .0001, { maximumLightingError });
      check('sky does not trigger environment/cubemap conversion', scene.environment === null && scene.background === null && targetChanges === 0);
      e.setIntensity(.7); e.setLightingIntensity(.25); e.setRotation(.5);
      draw(scene);
      const finite = finiteObject(e.object3d);
      check('public appearance controls retain finite geometry and lighting', finite.bad === 0 && e.probe.intensity === .25 &&
        e.probe.sh.coefficients.every((v) => v.toArray().every(Number.isFinite)), finite);
      e.dispose();
      check('variant teardown releases the resident texture', renderer.info.memory.textures === baseline,
        { baseline, after: renderer.info.memory.textures });
    });

    await attempt('camera invariance and panorama orientation', async () => {
      const { scene, environment: e } = await make({ rotation: 0 });
      camera.position.set(0, 6, 18); camera.quaternion.identity(); camera.updateMatrixWorld();
      draw(scene); const initial = pixels();
      camera.position.add(new THREE.Vector3(31, 17, -23)); camera.updateMatrixWorld();
      draw(scene); const translated = pixels();
      measurements.camera.translation = compare(initial, translated);
      check('camera translation leaves the distant panorama unchanged', measurements.camera.translation.meanDifference < .02 && measurements.camera.translation.maxDifference <= 2,
        measurements.camera.translation);
      camera.rotateY(.8); camera.updateMatrixWorld(); draw(scene); const turned = pixels();
      measurements.camera.rotation = compare(translated, turned);
      check('camera rotation reveals a different part of the panorama', measurements.camera.rotation.meanDifference > .05, measurements.camera.rotation);
      camera.quaternion.identity(); camera.updateMatrixWorld(); e.setRotation(.8); draw(scene); const rotatedEnvironment = pixels();
      measurements.camera.environmentRotation = compare(translated, rotatedEnvironment);
      check('environment rotation visibly changes the backdrop', measurements.camera.environmentRotation.meanDifference > .05, measurements.camera.environmentRotation);
      e.setRotation(-.8); draw(scene);
      measurements.camera.oppositeRotationEquivalence = compare(turned, pixels());
      check('opposite panorama rotation matches the camera rotation', measurements.camera.oppositeRotationEquivalence.meanDifference < .05,
        measurements.camera.oppositeRotationEquivalence);
      e.setRotation(0); draw(scene); const restored = pixels();
      check('resetting panorama rotation restores the original view', compare(translated, restored).meanDifference < .02, compare(translated, restored));
      e.dispose(); camera.position.set(0, 6, 18); camera.quaternion.identity(); camera.updateMatrixWorld();
    });

    await attempt('baked polar caps remain stable under Y rotation', async () => {
      const response = await fetch(new URL('./lighting.json', import.meta.url));
      if (!response.ok) throw new Error(`Polar metadata HTTP ${response.status}`);
      const baked = await response.json();
      const { scene, environment: e } = await make();
      for (const variant of ['space', 'nebula']) {
        await e.setVariant(variant);
        const uniforms = e.sky.material.uniforms;
        const poles = { north: uniforms.uPoleNorth?.value, south: uniforms.uPoleSouth?.value };
        check(`${variant}: finite polar colors match baked linear radiance`, ['north', 'south'].every((side) => {
          const actual = poles[side]?.toArray(), expected = baked.poles?.[variant]?.[side];
          return Array.isArray(actual) && Array.isArray(expected) && actual.length === 3 && expected.length === 3 &&
            actual.every((value, i) => Number.isFinite(value) && value >= 0 && Math.abs(value - expected[i]) < 1e-9);
        }), { north: poles.north?.toArray(), south: poles.south?.toArray() });
        measurements.poles[variant] = {};
        for (const side of ['north', 'south']) {
          camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), side === 'north' ? Math.PI / 2 : -Math.PI / 2);
          camera.updateMatrixWorld();
          e.setRotation(0); draw(scene); const base = pixels(8);
          let maximumDifference = 0, maximumMeanDifference = 0;
          for (const angle of [Math.PI / 2, Math.PI, 5.1]) {
            e.setRotation(angle); draw(scene);
            const result = compare(base, pixels(8));
            maximumDifference = Math.max(maximumDifference, result.maxDifference);
            maximumMeanDifference = Math.max(maximumMeanDifference, result.meanDifference);
          }
          const visible = base.some((value, i) => i % 4 !== 3 && value > 0);
          const detail = { pixels: 64, rotationsCompared: 3, maximumDifference, maximumMeanDifference, visible, centerRGBA: Array.from(base.slice(0, 4)) };
          measurements.poles[variant][side] = detail;
          check(`${variant}: ${side} polar center is stable under Y rotation`, visible && maximumDifference <= 2 && maximumMeanDifference < .15, detail);
        }
      }
      e.dispose(); camera.position.set(0, 6, 18); camera.quaternion.identity(); camera.updateMatrixWorld();
    });

    await attempt('longitude wrap has no dark mip stripe', async () => {
      const { scene, environment: e } = await make({ rotation: 0 });
      camera.position.set(0, 0, 0); camera.lookAt(-1, 0, 0); camera.updateMatrixWorld();
      for (const variant of ['space', 'nebula']) {
        await e.setVariant(variant); e.setRotation(0); draw(scene);
        const gl = renderer.getContext(), width = 13, height = Math.floor(gl.drawingBufferHeight / 2);
        const data = new Uint8Array(width * height * 4);
        gl.readPixels(Math.floor(gl.drawingBufferWidth / 2) - 6, Math.floor(gl.drawingBufferHeight / 4), width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        const columns = Array(width).fill(0);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          columns[x] += (data[i] + data[i + 1] + data[i + 2]) / (3 * height);
        }
        // The exact longitude wrap lies between the middle two pixel centers.
        // Distant neighbors avoid including the 2-4px faulty-mipmap footprint.
        const centerMean = (columns[5] + columns[6]) / 2;
        const neighborMean = (columns[0] + columns[1] + columns[11] + columns[12]) / 4;
        const detail = { columnMeanRgb: columns, centerMean, neighborMean, dip: neighborMean - centerMean, rows: height };
        measurements.seam[variant] = detail;
        check(`${variant}: longitude seam has no dark sampling stripe`, centerMean > 0 && detail.dip < 2, detail);
      }
      e.dispose(); camera.position.set(0, 6, 18); camera.quaternion.identity(); camera.updateMatrixWorld();
    });

    await attempt('lazy switching and independent scenes', async () => {
      const loader = delayedLoader();
      const a = await make({ loader: loader.loader }), b = await make({ variant: 'nebula' });
      check('initial create loads only the selected JPEG', loader.calls.length === 1 && /space\.jpg(?:[?#]|$)/.test(String(loader.calls[0])), { calls: loader.calls.map(String) });
      const initial = a.environment.texture, initialDisposal = watchDispose(initial), bTexture = b.environment.texture;
      const bCoefficients = JSON.stringify(b.environment.probe.sh.coefficients.map((v) => v.toArray()));
      const unchanged = await a.environment.setVariant('space');
      check('selecting the active variant performs no load', unchanged === false && loader.calls.length === 1 && a.environment.texture === initial);
      await a.environment.setVariant('nebula');
      check('switch replaces and disposes the previous texture once', a.environment.texture !== initial && initialDisposal.count === 1 && loader.calls.length === 2,
        { calls: loader.calls.map(String), oldDisposals: initialDisposal.count });
      a.environment.setRotation(1); a.environment.setLightingIntensity(.1); a.environment.dispose();
      const actual = draw(b.scene);
      check('scene instances own independent textures, lighting and lifetime', b.environment.texture === bTexture && bTexture !== initial &&
        JSON.stringify(b.environment.probe.sh.coefficients.map((v) => v.toArray())) === bCoefficients && actual.calls === 1 && actual.triangles === 12, actual);
      b.environment.dispose();
    });

    await attempt('asynchronous switch races', async () => {
      const loader = delayedLoader(), { environment: e } = await make({ loader: loader.loader });
      const initial = e.texture;
      loader.hold = true;
      const obsolete = e.setVariant('nebula');
      const duplicate = e.setVariant('nebula');
      await Promise.resolve();
      check('duplicate pending variants share one load', loader.pending.length === 1 && obsolete === duplicate);
      const canceled = await e.setVariant('space');
      check('selecting current variant cancels a pending alternate', canceled === false && e.variant === 'space' && e.texture === initial);
      const newest = e.setVariant('nebula');
      await Promise.resolve();
      const fresh = await loader.release(1); await newest;
      const stale = await loader.release(0); const staleApplied = await obsolete;
      measurements.loading.races = { loadCalls: loader.calls.length, staleApplied, staleDisposals: stale.disposal.count };
      check('newest variant wins and stale loaded textures are disposed', e.variant === 'nebula' && e.texture === fresh.texture && staleApplied === false && stale.disposal.count === 1,
        measurements.loading.races);
      const current = e.texture;
      const failing = e.setVariant('space').then(() => false, () => true);
      await Promise.resolve();
      loader.pending[2].reject(new Error('Deliberate validator load failure'));
      check('load failure preserves the current environment', await failing && e.texture === current && e.variant === 'nebula');
      e.dispose();
    });

    await attempt('dispose during a pending load', async () => {
      const loader = delayedLoader(), { scene, environment: e } = await make({ loader: loader.loader });
      const foreign = new THREE.Group(); scene.add(foreign);
      draw(scene);
      const textureDisposal = watchDispose(e.texture), geometryDisposal = watchDispose(e.sky.geometry), materialDisposal = watchDispose(e.sky.material);
      loader.hold = true;
      const pending = e.setVariant('nebula').then((value) => ({ value }), (error) => ({ error: String(error) }));
      await Promise.resolve();
      e.dispose(); e.dispose();
      const late = await loader.release(0), outcome = await pending;
      const actual = draw(scene);
      measurements.loading.disposal = { textureDisposals: textureDisposal.count, geometryDisposals: geometryDisposal.count,
        materialDisposals: materialDisposal.count, lateTextureDisposals: late.disposal.count, outcome, actual };
      check('disposal is idempotent and cleans arriving textures', textureDisposal.count === 1 && geometryDisposal.count === 1 && materialDisposal.count === 1 &&
        late.disposal.count === 1 && !e.object3d.parent && actual.calls === 0 && scene.children.includes(foreign), measurements.loading.disposal);
    });

    check('all checks avoid render targets, cube renders and PMREM passes', targetChanges === 0, { nonNullRenderTargetChanges: targetChanges, totalRenderInvocations: renderInvocations });
    check('WebGL shaders compile and render without errors', !measurements.shaderErrors.length && !measurements.glErrors.length,
      { shaderErrors: measurements.shaderErrors, glErrors: measurements.glErrors });
  } finally {
    for (const environment of owned) { try { environment.dispose(); } catch (error) { check('final cleanup', false, String(error)); } }
    renderer.render = originalRender; renderer.setRenderTarget = originalTarget;
    renderer.debug.onShaderError = oldShaderError; renderer.debug.checkShaderErrors = oldShaderCheck;
    renderer.autoClear = oldAutoClear; renderer.setRenderTarget(oldTarget);
  }
  return { pass: checks.every((c) => c.pass), checks, measurements,
    limitations: ['Desktop or emulated WebGL evidence only; physical-phone performance is not measured.',
      'Diffuse LightProbe lighting is tested; this helper does not provide specular image-based reflections.',
      'GPU residency checks use renderer.info.memory.textures; browser HTTP/decoded-image caching is outside that counter.',
      'Panorama art quality, seams and pole appearance require visual review.'] };
}
