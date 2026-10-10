import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Real GPU submission, source-parity, culling and ownership checks for the foreground helper. */
export async function runForegroundChecks(THREE, foregroundModule, renderer) {
  const checks = [], measurements = { actual: {}, variants: [], culling: {}, lifetime: {}, shaderErrors: [], glErrors: [] };
  const fields = [], resources = new Set();
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const attempt = async (name, fn) => {
    try { await fn(); }
    catch (e) { check(name, false, String(e?.stack || e).slice(0, 2000)); }
    finally { for (const field of fields) field.object3d.removeFromParent(); }
  };
  const originalRender = renderer.render, originalSetTarget = renderer.setRenderTarget;
  const originalShaderError = renderer.debug.onShaderError, originalShaderCheck = renderer.debug.checkShaderErrors;
  const state = () => ({ target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace?.() || 0,
    mip: renderer.getActiveMipmapLevel?.() || 0, color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(), autoClear: renderer.autoClear, shadow: renderer.shadowMap.enabled,
    tone: renderer.toneMapping, exposure: renderer.toneMappingExposure, colorSpace: renderer.outputColorSpace,
    size: renderer.getSize(new THREE.Vector2()), ratio: renderer.getPixelRatio(), autoReset: renderer.info.autoReset });
  const before = state(), earlierPrograms = new Set(renderer.info.programs);
  let renders = 0, targetChanges = 0;
  renderer.render = function (...args) { renders++; return originalRender.apply(this, args); };
  renderer.setRenderTarget = function (...args) { targetChanges++; return originalSetTarget.apply(this, args); };
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => measurements.shaderErrors.push({
    program: gl.getProgramInfoLog(program), vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment) });
  renderer.autoClear = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 3000);
  const lights = [new THREE.HemisphereLight(0xc5e2ff, 0x22152c, 1.3), new THREE.DirectionalLight(0xffefcb, 3.2)];
  lights[1].position.set(-100, 160, 130); scene.add(...lights);
  const target = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: true }); resources.add(target);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); resources.add(white);
  const aim = (eye, at = [0, 0, 0]) => { camera.position.fromArray(eye); camera.lookAt(...at); camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); };
  aim([0, 110, 500]);
  const draw = () => {
    renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.info.reset();
    const count = renders; renderer.render(scene, camera);
    const pixels = new Uint8Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
    const gl = renderer.getContext(), error = gl.getError();
    if (error !== gl.NO_ERROR) measurements.glErrors.push(error);
    return { pixels, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, renders: renders - count };
  };
  const mask = pixels => {
    const value = new Uint8Array(pixels.length / 4);
    for (let i = 0; i < value.length; i++) value[i] = Math.max(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]) > 8 ? 1 : 0;
    return value;
  };
  const difference = (a, b) => {
    const ma = mask(a), mb = mask(b); let union = 0, mismatch = 0, delta = 0, maximum = 0;
    for (let i = 0; i < ma.length; i++) if (ma[i] || mb[i]) {
      union++; if (ma[i] !== mb[i]) mismatch++;
      for (let c = 0; c < 3; c++) { const d = Math.abs(a[i * 4 + c] - b[i * 4 + c]); delta += d; maximum = Math.max(maximum, d); }
    }
    return { occupiedUnion: union, silhouetteMismatch: mismatch / Math.max(1, union), meanRGBDifference: delta / Math.max(1, union * 3), maximum };
  };
  const make = async options => { const field = await foregroundModule.createForegroundRocks(options); fields.push(field); return field; };
  const track = resource => { const value = { count: 0 }; resource.addEventListener('dispose', () => value.count++); return value; };
  const sourceMeshes = [];
  let main, source;
  try {
    check('foreground factory is exported and runs with three.js r160', typeof foregroundModule.createForegroundRocks === 'function' && String(THREE.REVISION) === '160', THREE.REVISION);
    await attempt('real foreground GLB loading and submitted cost', async () => {
      const records = [1, 2, 3].map((variant, i) => ({ id: `rock-${variant}`, variant, diameter: [60, 90, 120][i], position: [(i - 1) * 130, 0, 0] }));
      const previous = state(), count = renders, changes = targetChanges;
      main = await make({ rocks: records, seed: 7 }); scene.add(main.object3d);
      const after = state();
      check('loading does not install renderer state or extra rendering', count === renders && changes === targetChanges && previous.target === after.target &&
        previous.color.equals(after.color) && previous.alpha === after.alpha && previous.viewport.equals(after.viewport) && previous.scissor.equals(after.scissor) &&
        previous.scissorTest === after.scissorTest && previous.autoClear === after.autoClear && previous.shadow === after.shadow && previous.tone === after.tone &&
        previous.exposure === after.exposure && previous.colorSpace === after.colorSpace && previous.size.equals(after.size) && previous.ratio === after.ratio);
      let meshes = 0, lightCount = 0, cameraCount = 0, finite = true;
      main.object3d.traverse(node => { if (node.isLight) lightCount++; if (node.isCamera) cameraCount++; if (node.isMesh) meshes++;
        if (node.geometry) for (const attribute of Object.values(node.geometry.attributes)) for (const value of attribute.array) if (!Number.isFinite(value)) finite = false; });
      const material = main.mesh.material, textures = Object.values(material).filter(v => v?.isTexture).length;
      const actual = draw(), stats = main.getStats(); measurements.actual = { calls: actual.calls, triangles: actual.triangles, renders: actual.renders, stats };
      check('three rocks use one InstancedMesh with one shared opaque PBR material and zero textures', meshes === 1 && main.mesh.isInstancedMesh &&
        !Array.isArray(material) && material.isMeshStandardMaterial && !material.transparent && material.side === THREE.FrontSide && textures === 0,
        { meshes, material: material.name, materialType: material.type, textures });
      check('three variants submit one call and no more than 300 triangles per rock', actual.calls === 1 && actual.triangles > 0 && actual.triangles <= 900 && actual.renders === 1, measurements.actual);
      check('foreground adds no lights, camera, shadow pass or nonfinite geometry', !lightCount && !cameraCount && finite && !main.mesh.castShadow && !main.mesh.receiveShadow,
        { lightCount, cameraCount, finite });
      main.object3d.removeFromParent();
      source = await new GLTFLoader().loadAsync(new URL('./foreground.glb', import.meta.url).href); source.scene.updateMatrixWorld(true);
      source.scene.traverse(node => { if (!node.isMesh) return; sourceMeshes.push(node); resources.add(node.geometry);
        for (const m of Array.isArray(node.material) ? node.material : [node.material]) { resources.add(m); for (const v of Object.values(m)) if (v?.isTexture) resources.add(v); } });
      sourceMeshes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      check('direct GLTFLoader exposes exactly three source variants', sourceMeshes.length === 3, sourceMeshes.map(m => m.name));
    });

    await attempt('source geometry, normals and colours match all rendered shader variants', async () => {
      const images = [];
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(.18, -.23, .11)).toArray();
      for (let variant = 1; variant <= 3; variant++) {
        const field = await make({ rocks: [{ id: 'one', variant, diameter: 90, position: [0, 0, 0], quaternion }] });
        const sourceMesh = sourceMeshes[variant - 1], geometry = sourceMesh.geometry.clone().applyMatrix4(sourceMesh.matrixWorld);
        resources.add(geometry); const direct = new THREE.Mesh(geometry, sourceMesh.material);
        field.mesh.getMatrixAt(0, direct.matrix); direct.matrix.decompose(direct.position, direct.quaternion, direct.scale);
        const views = [];
        for (const eye of [[0, 20, 180], [150, 45, 130], [-110, 90, 150]]) {
          aim(eye); scene.add(field.object3d); const instanced = draw(); field.object3d.removeFromParent();
          scene.add(direct); const original = draw(); direct.removeFromParent();
          const result = difference(instanced.pixels, original.pixels); views.push({ eye, ...result });
          if (views.length === 1) images.push(instanced.pixels);
        }
        measurements.variants.push({ variant, source: sourceMesh.name, views });
        check(`variant ${variant}: shader silhouette, colour and normals match the direct GLTF source`, views.every(v => v.occupiedUnion > 500 && v.silhouetteMismatch < .01 && v.meanRGBDifference < 1.5), views);
      }
      const pairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => ({ variants: [a + 1, b + 1], ...difference(images[a], images[b]) }));
      measurements.silhouettes = pairs;
      check('all three foreground variants have distinct rendered silhouettes', pairs.every(v => v.silhouetteMismatch > .025), pairs);
    });

    await attempt('seeded variant selection and copied transform inputs', async () => {
      const records = Array.from({ length: 12 }, (_, i) => ({ id: i, diameter: 60, position: [i * 90, 0, 0] }));
      const a = await make({ rocks: records, seed: 37 }), b = await make({ rocks: records, seed: 37 }), c = await make({ rocks: records, seed: 84 });
      const selections = [a, b, c].map(field => [...field.handles.values()].map(handle => handle.variant));
      check('omitted variants are seeded, valid and reproducible', selections[0].every(v => [1, 2, 3].includes(v)) &&
        JSON.stringify(selections[0]) === JSON.stringify(selections[1]) && JSON.stringify(selections[0]) !== JSON.stringify(selections[2]), selections);
      let release; const gate = new Promise(resolve => { release = resolve; });
      const input = { id: 'copied', variant: 2, diameter: 120, position: [41, -19, 73], quaternion: [.2, -.3, .1, .8] };
      const originalPosition = input.position.slice(), originalQuaternion = input.quaternion.slice();
      const loading = make({ rocks: [input], loader: { async loadAsync(url) { await gate; return new GLTFLoader().loadAsync(url); } } });
      input.position[0] = 9000; input.quaternion[0] = 10; input.diameter = 60; input.variant = 1;
      release(); const field = await loading, handle = field.handles.get('copied'), actual = new THREE.Matrix4(); field.mesh.getMatrixAt(0, actual);
      const expected = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(originalPosition), new THREE.Quaternion().fromArray(originalQuaternion).normalize(), new THREE.Vector3(60, 60, 60));
      const error = actual.elements.reduce((max, value, i) => Math.max(max, Math.abs(value - expected.elements[i])), 0);
      measurements.copiedTransform = { maximumMatrixError: error, handle: { ...handle, position: [...handle.position], quaternion: [...handle.quaternion] } };
      check('records are copied before awaiting load and nonunit quaternions are normalized', error < 1e-4 && handle.variant === 2 && handle.diameter === 120 &&
        handle.position !== input.position && handle.quaternion !== input.quaternion && handle.position.every((v, i) => v === originalPosition[i]) &&
        Math.abs(Math.hypot(...handle.quaternion) - 1) < 1e-6, measurements.copiedTransform);
    });

    await attempt('bounds contain actual selected geometry and distant instances are culled correctly', async () => {
      const records = [1, 2, 3].map((variant, i) => ({ id: variant, variant, diameter: [60, 90, 120][i], position: [(i - 1) * 800, 17 * i, 5 * i],
        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(.23 * i, -.41 * i, .17 * i)).toArray() }));
      const field = await make({ rocks: records }); scene.add(field.object3d); scene.updateMatrixWorld(true);
      const expected = new THREE.Box3(), point = new THREE.Vector3(), matrix = new THREE.Matrix4();
      let missingBox = 0, missingSphere = 0;
      const box = field.mesh.boundingBox?.clone(), sphere = field.mesh.boundingSphere?.clone();
      if (!box || !sphere) throw new Error('The InstancedMesh must have explicit conservative bounds for shader variants.');
      box.expandByScalar(.001); sphere.radius += .001;
      for (const record of records) {
        const handle = field.handles.get(record.id), sourceMesh = sourceMeshes[record.variant - 1]; field.mesh.getMatrixAt(handle.index, matrix);
        const transform = matrix.clone().multiply(sourceMesh.matrixWorld), position = sourceMesh.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i).applyMatrix4(transform); expected.expandByPoint(point);
          if (!box.containsPoint(point)) missingBox++; if (!sphere.containsPoint(point)) missingSphere++;
        }
      }
      const visibility = [];
      for (const record of records) {
        aim([record.position[0], record.position[1] + 30, record.position[2] + 190], record.position);
        const frame = draw(); visibility.push({ id: record.id, calls: frame.calls, occupied: mask(frame.pixels).reduce((a, b) => a + b, 0) });
      }
      // Put the entire conservative sphere behind the camera, not just its rocks.
      const awayZ = sphere.center.z + sphere.radius + 500;
      aim([sphere.center.x, sphere.center.y, awayZ], [sphere.center.x, sphere.center.y, awayZ + 500]); const away = draw();
      measurements.culling = { expected: { min: expected.min.toArray(), max: expected.max.toArray() },
        actual: { min: box.min.toArray(), max: box.max.toArray(), sphereCenter: sphere.center.toArray(), sphereRadius: sphere.radius }, missingBox, missingSphere,
        visibleAtEachInstance: visibility, facingAwayCalls: away.calls, facingAwayOccupied: mask(away.pixels).reduce((a, b) => a + b, 0) };
      check('bounding box and sphere include every transformed vertex of all three selected variants', missingBox === 0 && missingSphere === 0 && Number.isFinite(sphere.radius), measurements.culling);
      check('widely separated variants remain visible near either end of the batch', visibility.every(v => v.calls === 1 && v.occupied > 100), visibility);
      check('a batch entirely behind the camera is culled without a draw', field.mesh.frustumCulled && away.calls === 0 && measurements.culling.facingAwayOccupied === 0, measurements.culling);
      field.object3d.removeFromParent();
    });

    await attempt('hiding compacts actual submissions and empty fields allocate no asset', async () => {
      const field = await make({ rocks: [1, 2, 3].map((variant, i) => ({ id: variant, variant, diameter: 90, position: [(i - 1) * 110, 0, 0] })) });
      scene.add(field.object3d); aim([0, 70, 420]); const initial = draw();
      const buffers = field.mesh.geometry, material = field.mesh.material, instanceMatrix = field.mesh.instanceMatrix;
      const first = field.hide(2), repeated = field.hide(2), absent = field.hide('missing'), reduced = draw();
      const liveIndices = [...field.handles.values()].filter(h => !h.hidden).map(h => h.index).sort();
      check('hide compacts instance count without replacing geometry, material or matrix buffers', first === true && repeated === false && absent === false &&
        field.mesh.count === 2 && reduced.calls === 1 && reduced.triangles === initial.triangles * 2 / 3 && buffers === field.mesh.geometry &&
        material === field.mesh.material && instanceMatrix === field.mesh.instanceMatrix && JSON.stringify(liveIndices) === '[0,1]',
        { beforeTriangles: initial.triangles, afterTriangles: reduced.triangles, liveIndices, hidden: field.handles.get(2) });
      field.hide(1); field.hide(3); const hidden = draw();
      check('hiding all rocks leaves zero submitted geometry and zero visible pixels', hidden.triangles === 0 && hidden.calls === 0 && mask(hidden.pixels).every(v => v === 0),
        { calls: hidden.calls, triangles: hidden.triangles, stats: field.getStats() });
      field.object3d.removeFromParent();
      let loads = 0; const empty = await make({ rocks: [], loader: { loadAsync() { loads++; throw new Error('Empty fields must not load a GLB'); } } });
      scene.add(empty.object3d); const frame = draw(); empty.object3d.removeFromParent();
      check('an empty field avoids asset loading, mesh allocation and GPU submissions', loads === 0 && empty.mesh === null && frame.calls === 0 && frame.triangles === 0 &&
        mask(frame.pixels).every(v => v === 0), { loads, stats: empty.getStats() });
    });

    await attempt('invalid input is rejected before loading', async () => {
      const valid = { id: 'valid', variant: 1, diameter: 90, position: [0, 0, 0] };
      const invalid = [
        { rocks: null }, { rocks: {} }, { rocks: [null] }, { rocks: [valid, { ...valid }] },
        ...[0, 4, 1.5, NaN].map(variant => ({ rocks: [{ ...valid, variant }] })),
        ...[0, -60, Infinity, NaN].map(diameter => ({ rocks: [{ ...valid, diameter }] })),
        ...[[0, 0], [0, 0, Infinity], [NaN, 0, 0], null].map(position => ({ rocks: [{ ...valid, position }] })),
        ...[[0, 0, 0, 0], [0, 0, 1], [0, 0, 0, NaN]].map(quaternion => ({ rocks: [{ ...valid, quaternion }] })),
        ...[NaN, Infinity].map(seed => ({ rocks: [valid], seed })),
      ];
      let loads = 0, rejected = 0;
      for (const options of invalid) {
        try { const field = await foregroundModule.createForegroundRocks({ ...options, loader: { loadAsync() { loads++; throw new Error('Invalid input reached loader'); } } }); field.dispose(); }
        catch { rejected++; }
      }
      check('invalid records, transforms, duplicate IDs and seeds fail before asset loading', rejected === invalid.length && loads === 0, { cases: invalid.length, rejected, loads });
    });

    await attempt('independent instance ownership and disposal', async () => {
      const options = { rocks: [{ id: 'one', variant: 3, diameter: 90, position: [0, 0, 0] }] };
      const a = await make(options), b = await make(options), expectedColor = b.mesh.material.color.clone();
      a.mesh.material.color.set(0xff0033);
      check('independent factory calls own separate geometry, material and transforms', a.object3d !== b.object3d && a.mesh.geometry !== b.mesh.geometry &&
        a.mesh.material !== b.mesh.material && a.mesh.instanceMatrix !== b.mesh.instanceMatrix && b.mesh.material.color.equals(expectedColor));
      const externalGeometry = new THREE.BoxGeometry(1, 1, 1), externalMaterial = new THREE.MeshBasicMaterial(); resources.add(externalGeometry); resources.add(externalMaterial);
      const external = new THREE.Mesh(externalGeometry, externalMaterial); a.object3d.add(external);
      const geom = track(a.mesh.geometry), mat = track(a.mesh.material), mesh = track(a.mesh), extGeom = track(externalGeometry), extMat = track(externalMaterial);
      scene.add(a.object3d); a.dispose(); a.dispose(); external.removeFromParent();
      let rejected = false; try { a.hide('one'); } catch { rejected = true; }
      measurements.lifetime = { geometry: geom.count, material: mat.count, instancedMesh: mesh.count, externalGeometry: extGeom.count, externalMaterial: extMat.count, hideAfterDisposeRejected: rejected };
      check('idempotent disposal releases owned GPU resources exactly once and preserves caller resources', geom.count === 1 && mat.count === 1 && mesh.count === 1 &&
        extGeom.count === 0 && extMat.count === 0 && !a.object3d.parent && a.getStats().disposed, measurements.lifetime);
      scene.add(b.object3d); aim([0, 30, 180]); const frame = draw(); b.object3d.removeFromParent();
      check('disposing one field preserves a second renderable field', !b.getStats().disposed && frame.calls === 1 && frame.triangles > 0 && frame.triangles <= 300 && mask(frame.pixels).some(v => v),
        { calls: frame.calls, triangles: frame.triangles });
    });

    await attempt('actual shader attribute capacity and WebGL errors', () => {
      const gl = renderer.getContext(), limit = gl.getParameter(gl.MAX_VERTEX_ATTRIBS), programs = [];
      for (const program of renderer.info.programs) {
        if (earlierPrograms.has(program)) continue;
        const attributes = [], count = gl.getProgramParameter(program.program, gl.ACTIVE_ATTRIBUTES); let slots = 0, end = 0;
        for (let i = 0; i < count; i++) {
          const attribute = gl.getActiveAttrib(program.program, i), location = gl.getAttribLocation(program.program, attribute.name);
          const width = attribute.type === gl.FLOAT_MAT4 ? 4 : attribute.type === gl.FLOAT_MAT3 ? 3 : attribute.type === gl.FLOAT_MAT2 ? 2 : 1;
          slots += width * attribute.size; end = Math.max(end, location + width * attribute.size); attributes.push({ name: attribute.name, location, slots: width * attribute.size });
        }
        programs.push({ slots, highestLocationPlusOne: end, attributes });
      }
      measurements.attributes = { hardwareLimit: limit, programs };
      check('linked shader attribute locations fit a 16-slot phone GPU budget', programs.length > 0 && programs.every(p => p.slots <= 16 && p.highestLocationPlusOne <= 16 && p.highestLocationPlusOne <= limit), measurements.attributes);
      check('foreground and source PBR shaders render without shader or WebGL errors', !measurements.shaderErrors.length && !measurements.glErrors.length,
        { shaderErrors: measurements.shaderErrors, glErrors: measurements.glErrors });
    });
  } finally {
    scene.overrideMaterial = null;
    for (const field of fields) field.dispose();
    for (const resource of resources) resource.dispose();
    renderer.render = originalRender; renderer.setRenderTarget = originalSetTarget;
    renderer.setRenderTarget(before.target, before.face, before.mip); renderer.setViewport(before.viewport);
    renderer.setScissor(before.scissor); renderer.setScissorTest(before.scissorTest); renderer.setClearColor(before.color, before.alpha);
    renderer.autoClear = before.autoClear; renderer.shadowMap.enabled = before.shadow; renderer.toneMapping = before.tone;
    renderer.toneMappingExposure = before.exposure; renderer.outputColorSpace = before.colorSpace; renderer.info.autoReset = before.autoReset;
    renderer.debug.onShaderError = originalShaderError; renderer.debug.checkShaderErrors = originalShaderCheck;
  }
  return { checks, measurements, note: 'Real browser GPU submission and 256×256 source-parity samples. No physical-phone FPS measurement; test render targets and lights are not installed by the foreground asset.' };
}
