// Real GLTFLoader, projection, pixel-coverage and resource-lifetime checks.
// Temporary render targets belong to this test, never to the cockpit helper.
export async function runCockpitChecks(THREE, cockpitModule, renderer) {
  const checks = [], measurements = { fits: {}, sockets: [], ownership: {}, actual: {}, shaderErrors: [], glErrors: [] };
  const owned = [], resources = [];
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const attempt = async (name, fn) => { try { await fn(); } catch (error) { check(name, false, String(error?.stack || error).slice(0, 2000)); } };
  const close = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;
  const captureState = () => ({
    target: renderer.getRenderTarget(), cubeFace: renderer.getActiveCubeFace?.() || 0,
    mip: renderer.getActiveMipmapLevel?.() || 0, autoClear: renderer.autoClear,
    color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(), shadowEnabled: renderer.shadowMap.enabled,
    toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure,
    colorSpace: renderer.outputColorSpace, pixelRatio: renderer.getPixelRatio(),
    size: renderer.getSize(new THREE.Vector2()), infoAutoReset: renderer.info.autoReset,
  });
  const before = captureState();
  const oldShaderError = renderer.debug.onShaderError, oldShaderCheck = renderer.debug.checkShaderErrors;
  const originalRender = renderer.render, originalSetTarget = renderer.setRenderTarget;
  let renders = 0, targetChanges = 0;
  renderer.render = function (...args) { renders++; return originalRender.apply(this, args); };
  renderer.setRenderTarget = function (...args) { targetChanges++; return originalSetTarget.apply(this, args); };
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, p, v, f) => measurements.shaderErrors.push({
    program: (gl.getProgramInfoLog(p) || '').slice(0, 1500), vertex: (gl.getShaderInfoLog(v) || '').slice(0, 1500),
    fragment: (gl.getShaderInfoLog(f) || '').slice(0, 1500),
  });
  renderer.autoClear = true;
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, .01, 1000);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000); scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x353552, 2));
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(1, 2, 2); scene.add(key);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); resources.push(white);
  const target = new THREE.WebGLRenderTarget(480, 270, { depthBuffer: true, stencilBuffer: false }); resources.push(target);
  const draw = (width = target.width, height = target.height) => {
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.info.reset();
    const count = renders;
    renderer.render(scene, camera);
    const gl = renderer.getContext(), error = gl.getError();
    if (error !== gl.NO_ERROR) measurements.glErrors.push(error);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    return { pixels, width, height, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      renders: renders - count, textures: renderer.info.memory.textures };
  };
  const occupancy = (frame) => {
    let occupied = 0, centerOccupied = 0, centerPixels = 0;
    const mask = new Uint8Array(frame.width * frame.height);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const i = y * frame.width + x, p = i * 4;
      const filled = Math.max(frame.pixels[p], frame.pixels[p + 1], frame.pixels[p + 2]) > 32;
      if (filled) { occupied++; mask[i] = 1; }
      // An explicitly defined central aperture: middle 50% width x 40% height.
      if ((x + .5) / frame.width >= .25 && (x + .5) / frame.width <= .75 &&
          (y + .5) / frame.height >= .30 && (y + .5) / frame.height <= .70) {
        centerPixels++; if (filled) centerOccupied++;
      }
    }
    return { mask, clearFraction: 1 - occupied / mask.length, occupiedPixels: occupied,
      totalPixels: mask.length, centerClearFraction: 1 - centerOccupied / centerPixels,
      centerOccupied, centerPixels, threshold: 32 };
  };
  const pixelDifference = (a, b, mask, selected = true) => {
    let sum = 0, channels = 0, maximum = 0;
    for (let i = 0; i < mask.length; i++) if (!!mask[i] === selected) for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a[i * 4 + c] - b[i * 4 + c]); sum += delta; channels++; maximum = Math.max(maximum, delta);
    }
    return { mean: sum / Math.max(1, channels), maximum, channels };
  };
  const configure = (fov, aspect, zoom = 1) => {
    camera.fov = fov; camera.aspect = aspect; camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  };
  const projectGeometry = (cockpit) => {
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const result = [], p = new THREE.Vector3();
    for (const mesh of cockpit.meshes) {
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).project(camera);
        result.push(p.x, p.y);
      }
    }
    return result;
  };
  const maximumDelta = (a, b) => a.length === b.length ? a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0) : Infinity;
  const watchDispose = (resource) => { const tracker = { count: 0 }; resource.addEventListener('dispose', () => tracker.count++); return tracker; };
  const make = async (options = {}) => { const value = await cockpitModule.createCockpit(options); owned.push(value); return value; };
  let a, b;
  try {
    check('cockpit factory and authored camera contract are exported', typeof cockpitModule.createCockpit === 'function' &&
      cockpitModule.COCKPIT_CAMERA?.fov === 70 && close(cockpitModule.COCKPIT_CAMERA?.aspect, 16 / 9));
    check('real browser uses three.js r160', String(THREE.REVISION) === '160', THREE.REVISION);
    await attempt('real GLB loads without installing renderer state', async () => {
      const renderCount = renders, targetCount = targetChanges, state = captureState();
      a = await make({ camera });
      const after = captureState();
      check('loading performs no render, render-target setup or global renderer mutation', renderCount === renders && targetCount === targetChanges &&
        state.target === after.target && state.shadowEnabled === after.shadowEnabled && state.toneMapping === after.toneMapping &&
        state.exposure === after.exposure && state.colorSpace === after.colorSpace && state.pixelRatio === after.pixelRatio &&
        state.size.equals(after.size) && state.viewport.equals(after.viewport) && state.scissor.equals(after.scissor) &&
        state.scissorTest === after.scissorTest && state.autoClear === after.autoClear && state.color.equals(after.color) && state.alpha === after.alpha);
      camera.add(a.object3d);
      let lights = 0, cameras = 0, textures = 0, finite = true;
      a.object3d.traverse(node => {
        if (node.isLight) lights++; if (node.isCamera) cameras++;
        if (node.geometry) for (const attribute of Object.values(node.geometry.attributes)) for (const value of attribute.array) if (!Number.isFinite(value)) finite = false;
      });
      for (const material of a.materials) for (const value of Object.values(material)) if (value?.isTexture) textures++;
      const stats = a.getStats();
      measurements.actual.declared = stats;
      check('cockpit is finite and carries no lights, cameras, textures or animation', finite && lights === 0 && cameras === 0 && textures === 0 && stats.textures === 0 && stats.animations === 0,
        { lights, cameras, textures, stats });
      check('all authored surfaces load as PBR materials', a.materials.length === 3 && a.materials.every(m => m.isMeshStandardMaterial), a.materials.map(m => ({ name: m.name, type: m.type })));
      check('three authored meshes fit the 8000-triangle and four-call budget', stats.meshes === 3 && stats.triangles > 0 && stats.triangles <= 8000 && stats.calls <= 4, stats);
      check('opaque cockpit surfaces use ordinary depth with no shadow passes', a.materials.every(m => m.depthTest && m.depthWrite && !m.transparent && m.opacity === 1 && m.side === THREE.FrontSide) &&
        a.meshes.every(m => !m.castShadow && !m.receiveShadow && m.renderOrder === 0));
      const actual = draw(); measurements.actual.rendered = { calls: actual.calls, triangles: actual.triangles, renders: actual.renders };
      check('GPU submission matches the declared cockpit cost in one render', actual.calls === stats.calls && actual.triangles === stats.triangles && actual.renders === 1, measurements.actual.rendered);
    });

    await attempt('pixel aperture and projection fitting', () => {
      if (!a) throw new Error('GLB did not load');
      configure(70, 16 / 9); a.fitToCamera(camera); const reference = projectGeometry(a);
      for (const [name, width, height, fov, zoom] of [
        ['desktop', 1440, 900, 60, 1], ['landscape_phone', 844, 390, 70, 1],
        ['portrait_phone', 390, 844, 70, 1], ['square_wide', 900, 900, 90, 1],
        ['zoomed', 1440, 900, 70, 1.6],
      ]) {
        configure(fov, width / height, zoom); a.fitToCamera(camera);
        const projected = projectGeometry(a), delta = maximumDelta(reference, projected);
        const w = Math.round(width * 480 / Math.max(width, height)), h = Math.round(height * 480 / Math.max(width, height));
        scene.overrideMaterial = white; const frame = draw(w, h); scene.overrideMaterial = null;
        const area = occupancy(frame); delete area.mask;
        measurements.fits[name] = { sourceViewport: [width, height], sampleViewport: [w, h], fov, zoom, maximumNdcDelta: delta, ...area };
        check(name + ': at least 70% of the rendered view is clear', area.clearFraction >= .70, measurements.fits[name]);
        check(name + ': central 50% x 40% window is unobstructed', area.centerOccupied === 0,
          { centralClearFraction: area.centerClearFraction, centralPixels: area.centerPixels });
        check(name + ': fitting preserves screen-space geometry', delta < 1e-5, { maximumNdcDelta: delta, projectedVertices: reference.length / 2 });
      }
      configure(70, 16 / 9); a.fitToCamera(camera);
    });

    await attempt('gauge sockets face the camera and accept caller planes', () => {
      const names = ['socket_gauge_1', 'socket_gauge_2', 'socket_gauge_3'];
      check('all three exact gauge socket names are present once', names.every(name => {
        let count = 0; a.object3d.traverse(n => { if (n.name === name) count++; }); return count === 1 && a.sockets[name]?.name === name;
      }));
      const gaugeGeometry = new THREE.PlaneGeometry(.08, .045), gaugeMaterial = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
      resources.push(gaugeGeometry, gaugeMaterial);
      for (const name of names) {
        const socket = a.sockets[name], gauge = new THREE.Mesh(gaugeGeometry, gaugeMaterial); socket.add(gauge);
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        const center = socket.getWorldPosition(new THREE.Vector3()), projected = center.clone().project(camera);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(socket.getWorldQuaternion(new THREE.Quaternion()));
        const cameraBack = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
        const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const evidence = { name, world: center.toArray(), ndc: projected.toArray(), normal: normal.toArray(),
          facingDot: normal.dot(cameraBack), planeHits: ray.intersectObject(gauge, false).length };
        measurements.sockets.push(evidence);
        check(name + ': +Z PlaneGeometry faces the camera inside the viewport', evidence.facingDot > .999 && evidence.planeHits > 0 &&
          Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z > -1 && projected.z < 1, evidence);
        gauge.removeFromParent();
      }
    });

    await attempt('camera parent movement and physical depth occlusion', () => {
      configure(70, 16 / 9); a.fitToCamera(camera);
      const reference = projectGeometry(a), parent = new THREE.Group(); scene.remove(camera); scene.add(parent); parent.add(camera);
      parent.position.set(130, -47, 88); parent.rotation.set(.2, .7, -.3);
      camera.position.set(3, 7, -4); camera.rotation.set(-.1, .22, .13);
      const delta = maximumDelta(reference, projectGeometry(a));
      check('translated and rotated camera parents preserve cockpit projection', delta < 1e-5, { maximumNdcDelta: delta });
      scene.add(camera); parent.removeFromParent(); camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); camera.updateMatrixWorld(true);
      scene.overrideMaterial = white; const mask = occupancy(draw(480, 270)).mask; scene.overrideMaterial = null;
      const baseline = draw().pixels;
      const geometry = new THREE.PlaneGeometry(100, 100), material = new THREE.MeshBasicMaterial({ color: 0xff1709, transparent: true, opacity: .65, toneMapped: false });
      resources.push(geometry, material); const particle = new THREE.Mesh(geometry, material); particle.position.z = -10; scene.add(particle);
      const behind = draw().pixels, behindDifference = pixelDifference(baseline, behind, mask), windowDifference = pixelDifference(baseline, behind, mask, false);
      particle.position.z = -.03;
      const foreground = draw().pixels, foregroundDifference = pixelDifference(behind, foreground, mask);
      measurements.actual.depth = { behindDifference, windowDifference, foregroundDifference };
      check('transparent world geometry behind the cockpit is blocked by its depth while the aperture remains open', behindDifference.mean < 1 && windowDifference.mean > 10, measurements.actual.depth);
      check('physically closer world geometry can occlude the opaque cockpit', foregroundDifference.mean > 10, foregroundDifference);
      particle.removeFromParent();
    });

    await attempt('invalid camera arguments fail before loading', async () => {
      const bad = [new THREE.OrthographicCamera(), {}, ...['fov', 'aspect', 'zoom'].flatMap(field => [0, NaN, Infinity].map(value => {
        const c = new THREE.PerspectiveCamera(70, 1, .01, 100); c[field] = value; return c;
      }))];
      const wide = new THREE.PerspectiveCamera(179, 1, .01, 100), shifted = new THREE.PerspectiveCamera(70, 1, .01, 100), film = shifted.clone();
      shifted.setViewOffset(100, 100, 0, 0, 50, 100); film.filmOffset = 1; bad.push(wide, shifted, film);
      let loads = 0, constructorRejections = 0, fitRejections = 0;
      const loader = { loadAsync() { loads++; throw new Error('Invalid inputs should not load'); } };
      const scale = a.object3d.scale.clone();
      for (const invalid of bad) {
        try { await cockpitModule.createCockpit({ camera: invalid, loader }); } catch { constructorRejections++; }
        try { a.fitToCamera(invalid); } catch { fitRejections++; }
      }
      check('invalid camera projection arguments do not load or corrupt a live fit', constructorRejections === bad.length && fitRejections === bad.length &&
        loads === 0 && a.object3d.scale.equals(scale), { cases: bad.length, constructorRejections, fitRejections, loads });
    });

    await attempt('independent loads and caller-owned gauge lifetime', async () => {
      b = await make({ camera });
      const independent = a.object3d !== b.object3d && a.materials.every(m => !b.materials.includes(m)) &&
        a.meshes.every(m => !b.meshes.some(other => other.geometry === m.geometry));
      const otherColor = b.materials[0].color.clone(); a.materials[0].color.set(0xff0033);
      check('independent cockpit instances own their geometry and material state', independent && b.materials[0].color.equals(otherColor));
      const geometry = new THREE.PlaneGeometry(.08, .045), material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      resources.push(geometry, material);
      const gauge = new THREE.Mesh(geometry, material); a.sockets.socket_gauge_1.add(gauge);
      const foreignGeometry = watchDispose(geometry), foreignMaterial = watchDispose(material);
      const loaded = [...new Set([...a.meshes.map(m => m.geometry), ...a.materials])], counts = loaded.map(watchDispose);
      a.dispose(); a.dispose();
      let disposedRejections = 0;
      try { a.fitToCamera(camera); } catch { disposedRejections++; }
      measurements.ownership = { ownedDisposals: counts.map(v => v.count), foreignGeometry: foreignGeometry.count, foreignMaterial: foreignMaterial.count, disposedRejections };
      check('idempotent disposal releases only loaded resources and detaches the cockpit', counts.every(v => v.count === 1) && !a.object3d.parent && a.getStats().disposed &&
        foreignGeometry.count === 0 && foreignMaterial.count === 0 && disposedRejections === 1, measurements.ownership);
      gauge.removeFromParent(); camera.add(b.object3d); const actual = draw();
      check('disposing one instance preserves another renderable cockpit', !b.getStats().disposed && actual.calls === b.getStats().calls && actual.triangles === b.getStats().triangles,
        { calls: actual.calls, triangles: actual.triangles });
      b.dispose();
    });
    check('PBR and override shaders render without WebGL errors', measurements.shaderErrors.length === 0 && measurements.glErrors.length === 0,
      { shaderErrors: measurements.shaderErrors, glErrors: measurements.glErrors });
  } finally {
    scene.overrideMaterial = null;
    for (const cockpit of owned) cockpit.dispose();
    for (const resource of resources) resource.dispose();
    renderer.render = originalRender; renderer.setRenderTarget = originalSetTarget;
    renderer.setRenderTarget(before.target, before.cubeFace, before.mip);
    renderer.setViewport(before.viewport); renderer.setScissor(before.scissor); renderer.setScissorTest(before.scissorTest);
    renderer.setClearColor(before.color, before.alpha); renderer.autoClear = before.autoClear;
    renderer.shadowMap.enabled = before.shadowEnabled; renderer.toneMapping = before.toneMapping;
    renderer.toneMappingExposure = before.exposure; renderer.outputColorSpace = before.colorSpace; renderer.info.autoReset = before.infoAutoReset;
    renderer.debug.onShaderError = oldShaderError; renderer.debug.checkShaderErrors = oldShaderCheck;
  }
  return { checks, measurements, note: 'Offscreen desktop/emulated-browser pixel coverage and rendering checks; not physical-phone FPS. Temporary render targets are test equipment, not cockpit runtime requirements.' };
}
