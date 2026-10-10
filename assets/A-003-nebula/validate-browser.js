// Browser checks for the decorative cloud helper; no game state or gameplay inputs.
export async function runNebulaChecks(THREE, nebulaModule, renderer) {
  const checks = [], measurements = { qualities: {}, visuals: {}, stress: {}, shaderErrors: [], glErrors: [] };
  const owned = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const attempt = async (name, fn) => { try { await fn(); } catch (error) { check(name, false, String(error?.stack || error).slice(0, 1800)); } };
  const camera = new THREE.PerspectiveCamera(60, 1.6, .1, 100000);
  const radius = 250;
  const outside = () => { camera.position.set(0, radius * .17, radius * 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); };
  outside();
  const oldTarget = renderer.getRenderTarget(), oldAutoClear = renderer.autoClear;
  const oldError = renderer.debug.onShaderError, oldCheck = renderer.debug.checkShaderErrors;
  const originalRender = renderer.render, originalSetTarget = renderer.setRenderTarget;
  let renderInvocations = 0, targetChanges = 0;
  renderer.render = function (...args) { renderInvocations++; return originalRender.apply(this, args); };
  renderer.setRenderTarget = function (target, ...args) { if (target) targetChanges++; return originalSetTarget.call(this, target, ...args); };
  renderer.autoClear = true; renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => measurements.shaderErrors.push({
    program: (gl.getProgramInfoLog(program) || '').slice(0, 1500),
    vertex: (gl.getShaderInfoLog(vertex) || '').slice(0, 1500), fragment: (gl.getShaderInfoLog(fragment) || '').slice(0, 1500),
  });
  const make = (options = {}) => {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020414);
    const nebula = nebulaModule.createNebula({ radius, seed: 73, ...options });
    owned.push(nebula); scene.add(nebula.object3d);
    return { scene, nebula };
  };
  const draw = (scene) => {
    renderer.setRenderTarget(null); renderer.info.reset(); const before = renderInvocations;
    renderer.render(scene, camera);
    const gl = renderer.getContext(), error = gl.getError();
    if (error !== gl.NO_ERROR) measurements.glErrors.push(error);
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, renders: renderInvocations - before,
      textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
  };
  const snapshot = (root) => {
    const data = [];
    root.traverse((o) => { if (o.geometry) for (const name of Object.keys(o.geometry.attributes).sort()) {
      const attribute = o.geometry.attributes[name]; data.push({ name, itemSize: attribute.itemSize, values: Array.from(attribute.array) });
    } });
    return JSON.stringify(data);
  };
  const finite = (root) => {
    let bad = 0, numbers = 0;
    root.traverse((o) => {
      for (const attribute of Object.values(o.geometry?.attributes || {})) for (const value of attribute.array) { numbers++; if (!Number.isFinite(value)) bad++; }
      for (const value of [...o.position, ...o.quaternion, ...o.scale, ...o.matrixWorld.elements]) { numbers++; if (!Number.isFinite(value)) bad++; }
    });
    return { bad, numbers };
  };
  const pixels = () => {
    const gl = renderer.getContext(), width = Math.min(512, gl.drawingBufferWidth), height = Math.min(512, gl.drawingBufferHeight);
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(Math.floor((gl.drawingBufferWidth - width) / 2), Math.floor((gl.drawingBufferHeight - height) / 2), width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  };
  const compare = (a, b) => {
    let sum = 0, max = 0, changed = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (i % 4 !== 3) { const delta = Math.abs(a[i] - b[i]); sum += delta; max = Math.max(max, delta); if (delta) changed++; n++; }
    return { mean: sum / n, max, changed, channels: n };
  };
  const disposalCount = (resource) => { const count = { value: 0 }; resource.addEventListener('dispose', () => count.value++); return count; };
  const texturesIn = (root) => {
    const textures = new Set();
    root.traverse((o) => {
      for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
      }
    });
    return textures;
  };
  try {
    check('decorative nebula factory is exported', typeof nebulaModule.createNebula === 'function');
    await attempt('quality budgets and texture residency', () => {
      for (const [quality, puffs] of [['low', 24], ['medium', 48], ['high', 80]]) {
        const baseline = renderer.info.memory.textures, { scene, nebula: n } = make({ quality });
        n.update(0, camera); const actual = draw(scene), stats = n.getStats();
        measurements.qualities[quality] = { stats, actual, finite: finite(n.object3d) };
        check(`${quality}: one draw and two triangles per puff`, actual.calls === 1 && actual.triangles === puffs * 2 && actual.renders === 1 &&
          stats.puffs === puffs && stats.meshDrawCalls === actual.calls && stats.submittedTriangles === actual.triangles, measurements.qualities[quality]);
        const textures = [...texturesIn(n.object3d)], texture = textures[0];
        check(`${quality}: one 128px procedural alpha texture`, textures.length === 1 && texture.image?.width === 128 && texture.image?.height === 128 &&
          actual.textures === baseline + 1 && stats.textures === 1, { width: texture?.image?.width, height: texture?.image?.height, resident: actual.textures - baseline });
        check(`${quality}: geometry and declared bounds are finite`, finite(n.object3d).bad === 0 && Number.isFinite(stats.boundsRadius) && stats.boundsRadius > 0 && stats.boundsRadius <= radius, { boundsRadius: stats.boundsRadius });
        const mesh = n.object3d.children.find((o) => o.geometry?.attributes.aCenterSize);
        const centers = mesh.geometry.attributes.aCenterSize.array, detail = mesh.geometry.attributes.aDetail.array;
        let outer = 0, inner = Infinity;
        for (let i = 0; i < puffs; i++) {
          const distance = Math.hypot(centers[i * 4], centers[i * 4 + 1], centers[i * 4 + 2]);
          const extent = centers[i * 4 + 3] * Math.hypot(detail[i * 4], detail[i * 4 + 1]);
          outer = Math.max(outer, distance + extent); inner = Math.min(inner, distance - extent);
        }
        check(`${quality}: puff geometry fits its radius and retains an open center`, outer <= radius + .001 && inner > 0 &&
          stats.boundsRadius + .001 >= outer && stats.hollowRadius <= inner + .001, { outer, inner, reportedHollow: stats.hollowRadius });
        let lights = 0; n.object3d.traverse((o) => { if (o.isLight) lights++; });
        check(`${quality}: no fog, lights or reflection setup`, lights === 0 && scene.fog === null && scene.environment === null && targetChanges === 0);
        n.dispose();
        check(`${quality}: texture residency returns to baseline`, renderer.info.memory.textures === baseline, { baseline, actual: renderer.info.memory.textures });
      }
    });

    await attempt('seeded layout and shader animation', () => {
      const a = make(), b = make(), c = make({ seed: 74 });
      const initial = snapshot(a.nebula.object3d);
      const textureA = [...texturesIn(a.nebula.object3d)][0].image.data;
      const textureB = [...texturesIn(b.nebula.object3d)][0].image.data;
      const textureC = [...texturesIn(c.nebula.object3d)][0].image.data;
      check('matching seeds produce identical static buffers and alpha textures', initial === snapshot(b.nebula.object3d) && textureA.every((value, i) => value === textureB[i]));
      check('different seeds change static buffers and alpha textures', initial !== snapshot(c.nebula.object3d) && textureA.some((value, i) => value !== textureC[i]));
      a.nebula.update(0, camera); draw(a.scene); const start = pixels();
      a.nebula.update(3, camera); draw(a.scene); const animated = pixels();
      measurements.visuals.animation = compare(start, animated);
      check('time animates the cloud without rewriting static geometry', snapshot(a.nebula.object3d) === initial && measurements.visuals.animation.mean > .001, measurements.visuals.animation);
      for (const instance of [a, b, c]) instance.nebula.dispose();
    });

    await attempt('inside and outside camera views', () => {
      const { scene, nebula: n } = make();
      const empty = new THREE.Scene(); empty.background = scene.background;
      for (const view of ['outside', 'inside']) {
        if (view === 'outside') outside(); else { camera.position.set(0, 0, 0); camera.lookAt(0, 0, -1); camera.updateMatrixWorld(); }
        draw(empty); const background = pixels();
        n.update(0, camera); draw(scene); const cloud = pixels();
        measurements.visuals[view] = compare(background, cloud);
        check(`${view}: decorative clouds remain visibly rendered`, measurements.visuals[view].max > 1 && measurements.visuals[view].changed > 100,
          measurements.visuals[view]);
      }
      n.dispose(); outside();
    });

    await attempt('flare copy, visibility and decay', () => {
      const a = make(), control = make();
      a.nebula.update(0, camera); draw(a.scene); const before = pixels();
      const position = new THREE.Vector3(0, 0, radius * .5);
      a.nebula.setFlare(position, 2); position.set(999, 999, 999);
      a.nebula.update(0, camera); draw(a.scene); const bright = pixels(), initial = a.nebula.getStats();
      measurements.visuals.flare = compare(before, bright);
      check('flare copies its local position and is visible', initial.flareActive && initial.flareRemaining === 14 &&
        JSON.stringify(initial.flarePosition) === JSON.stringify([0, 0, radius * .5]) && measurements.visuals.flare.mean > .001,
        { stats: initial, pixels: measurements.visuals.flare });
      a.nebula.update(7, camera); const half = a.nebula.getStats();
      check('flare remains active halfway through its 14-second life', half.flareActive && Math.abs(half.flareRemaining - 7) < 1e-7, half);
      a.nebula.update(7, camera); control.nebula.update(14, camera);
      draw(a.scene); const expired = pixels(); draw(control.scene); const unflared = pixels();
      const after = a.nebula.getStats(), difference = compare(expired, unflared);
      check('flare expires at 14 seconds without residual visual change', !after.flareActive && after.flareRemaining === 0 && difference.mean < .02, { stats: after, pixels: difference });
      a.nebula.setFlare([0, 0, 0], 1); a.nebula.setFlare([0, 0, 0], 0);
      check('zero-strength flare clears the accent', !a.nebula.getStats().flareActive);
      a.nebula.dispose(); control.nebula.dispose();
    });

    await attempt('root transforms and copied camera position', () => {
      const { scene, nebula: n } = make();
      const parent = new THREE.Group(); scene.remove(n.object3d); scene.add(parent); parent.add(n.object3d);
      parent.position.set(130, -40, 75); parent.rotation.y = .6; parent.scale.setScalar(1.3);
      parent.updateMatrixWorld(true);
      const localCamera = new THREE.Vector3(0, 50, 750);
      camera.position.copy(parent.localToWorld(localCamera.clone())); camera.lookAt(parent.getWorldPosition(new THREE.Vector3())); camera.updateMatrixWorld();
      n.update(.1, camera); const copied = n.getStats().cameraLocal;
      const actual = draw(scene);
      check('camera coordinates respect translated rotated scaled parents', new THREE.Vector3(...copied).distanceTo(localCamera) < .0001 && actual.calls === 1 && finite(n.object3d).bad === 0,
        { cameraLocal: copied, actual });
      camera.position.addScalar(10); camera.updateMatrixWorld();
      check('camera coordinates are copied during update', JSON.stringify(copied) === JSON.stringify(n.getStats().cameraLocal));
      n.update(0, camera);
      check('camera movement updates the stored local position', JSON.stringify(copied) !== JSON.stringify(n.getStats().cameraLocal));
      n.dispose(); outside();
    });

    await attempt('invalid input guards', () => {
      const badOptions = [{ radius: 0 }, { radius: 1e7 }, { radius: NaN }, { seed: NaN }, { quality: 'invalid' },
        { opacity: Infinity }, { color: NaN }, { color: new THREE.Color().setRGB(NaN, 0, 0) }];
      let badCreations = 0;
      for (const options of badOptions) {
        try { nebulaModule.createNebula(options).dispose(); } catch { badCreations++; }
      }
      check('invalid constructor radius, seed, quality, opacity and color are rejected', badCreations === badOptions.length,
        { rejected: badCreations, cases: badOptions.length });
      const { nebula: n } = make();
      const runs = [
        () => n.update(-1, camera), () => n.update(NaN, camera), () => n.update(1e13, camera), () => n.update(0, {}),
        () => n.setFlare([NaN, 0, 0], 1), () => n.setFlare([1e10, 0, 0], 1), () => n.setFlare([0, 0, 0], -1), () => n.setFlare([0, 0, 0], NaN),
        () => n.setOpacity(-1), () => n.setOpacity(2), () => n.setOpacity(NaN),
      ];
      let rejected = 0;
      for (const run of runs) { try { run(); } catch { rejected++; } }
      check('invalid position, strength, opacity, camera and time are rejected', rejected === runs.length && n.getStats().time === 0 && finite(n.object3d).bad === 0,
        { rejected, cases: runs.length, stats: n.getStats() });
      n.setFlare([1, 2, 3], 1); n.update(.1, camera);
      check('valid updates continue after invalid inputs', n.getStats().flareActive && Math.abs(n.getStats().time - .1) < 1e-7);
      n.dispose();
    });

    await attempt('opacity, disposal and scene independence', () => {
      const a = make(), b = make({ seed: 18 });
      const foreign = new THREE.Group(); a.scene.add(foreign);
      a.nebula.update(.1, camera); draw(a.scene); b.nebula.update(.1, camera); draw(b.scene);
      const geometry = [], material = [], textures = [...texturesIn(a.nebula.object3d)];
      a.nebula.object3d.traverse((o) => { if (o.geometry) geometry.push(o.geometry); if (o.material) material.push(o.material); });
      const resources = [...new Set([...geometry, ...material, ...textures])], disposals = resources.map(disposalCount);
      a.nebula.setOpacity(0); const hidden = draw(a.scene);
      check('zero opacity removes invisible rendering work', hidden.calls === 0 && a.nebula.getStats().opacity === 0, hidden);
      a.nebula.setOpacity(.22); check('opacity can restore the cloud', draw(a.scene).calls === 1);
      a.nebula.dispose(); a.nebula.dispose();
      a.nebula.setFlare([0, 0, 0], 1); a.nebula.update(1, camera); a.nebula.setOpacity(1);
      check('disposal is idempotent and releases owned GPU resources', disposals.every((count) => count.value === 1) &&
        a.nebula.getStats().disposed && !a.nebula.object3d.parent && draw(a.scene).calls === 0 && a.scene.children.includes(foreign),
        { resourceDisposals: disposals.map((count) => count.value) });
      check('disposing one scene preserves another nebula', draw(b.scene).calls === 1 && !b.nebula.getStats().disposed);
      b.nebula.dispose();
    });

    await attempt('bounded desktop CPU measurements', () => {
      const { scene, nebula: n } = make({ quality: 'high' });
      const initial = snapshot(n.object3d), update = [], submission = [];
      let maximumCalls = 0, maximumTriangles = 0;
      n.setFlare([50, 0, 60], 1);
      for (let frame = 0; frame < 180; frame++) {
        const t0 = performance.now(); n.update(1 / 60, camera); const t1 = performance.now(); const actual = draw(scene); const t2 = performance.now();
        maximumCalls = Math.max(maximumCalls, actual.calls); maximumTriangles = Math.max(maximumTriangles, actual.triangles);
        if (frame >= 30) { update.push(t1 - t0); submission.push(t2 - t1); }
      }
      const stats = (values) => { const v = [...values].sort((a, b) => a - b); return { medianMs: v[Math.floor(v.length / 2)], p95Ms: v[Math.ceil(v.length * .95) - 1], maxMs: v.at(-1) }; };
      measurements.stress = { iterations: 180, warmupIterations: 30, samples: update.length, update: stats(update), renderSubmission: stats(submission), maximumCalls, maximumTriangles,
        note: 'Tight-loop desktop CPU update and render-submission timing including gl.getError. Excludes GPU completion; not FPS or physical-phone performance.' };
      check('sustained updates retain bounded geometry and draw cost', initial === snapshot(n.object3d) && finite(n.object3d).bad === 0 && maximumCalls === 1 && maximumTriangles === 160, measurements.stress);
      n.dispose();
    });
    check('no render target or reflection passes occur', targetChanges === 0, { targetChanges, renderInvocations });
    check('WebGL shaders compile and render without errors', !measurements.shaderErrors.length && !measurements.glErrors.length,
      { shaderErrors: measurements.shaderErrors, glErrors: measurements.glErrors });
  } finally {
    for (const n of owned) { try { n.dispose(); } catch (error) { check('final cleanup', false, String(error)); } }
    renderer.render = originalRender; renderer.setRenderTarget = originalSetTarget;
    renderer.debug.onShaderError = oldError; renderer.debug.checkShaderErrors = oldCheck;
    renderer.autoClear = oldAutoClear; renderer.setRenderTarget(oldTarget);
  }
  return { pass: checks.every((c) => c.pass), checks, measurements,
    limitations: ['Desktop/emulated WebGL tests do not establish physical-phone performance.',
      'One transparent batch does not sort individual overlapping puffs.', 'Boss readability and final scene composition require visual review.'] };
}
