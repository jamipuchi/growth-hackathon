// Browser-only checks for the delivered FX module. The caller supplies its imported
// THREE namespace, the fx.js namespace and a WebGLRenderer. No game state is used.
export async function runFxChecks(THREE, fx, renderer) {
  const checks = [];
  const measurements = { perKind: {}, stress: {}, shaderErrors: [], glErrors: [] };
  const owned = [];
  const camera = new THREE.PerspectiveCamera(55, 1.6, 0.05, 2000);
  camera.position.set(0, 6, 18);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const canonical = ['laser', 'explosion', 'drill', 'flare', 'scan', 'shield', 'boost', 'landing', 'dig', 'gold'];
  const oldTarget = renderer.getRenderTarget();
  const oldAutoClear = renderer.autoClear;
  const oldError = renderer.debug.onShaderError;
  const oldShaderCheck = renderer.debug.checkShaderErrors;
  renderer.autoClear = true;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    measurements.shaderErrors.push({
      program: (gl.getProgramInfoLog(program) || '').slice(0, 1800),
      vertex: (gl.getShaderInfoLog(vertex) || '').slice(0, 1800),
      fragment: (gl.getShaderInfoLog(fragment) || '').slice(0, 1800),
    });
  };
  const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const attempt = async (name, run) => {
    try { await run(); } catch (error) { check(name, false, String(error?.stack || error).slice(0, 2000)); }
  };
  const make = (options = {}) => {
    const scene = new THREE.Scene();
    const system = fx.createFxSystem({ scene, seed: 77, ...options });
    owned.push({ scene, system });
    return { scene, system };
  };
  const counters = (s) => [s.activeParticles, s.activeRings, s.activeShields, s.activeEmitters, s.activeLights];
  const live = (s) => counters(s).some((n) => n > 0);
  const finiteObject = (root) => {
    let bad = 0, numbers = 0;
    root.traverse((o) => {
      for (const a of Object.values(o.geometry?.attributes || {})) {
        for (const x of a.array) { numbers++; if (!Number.isFinite(x)) bad++; }
      }
      for (const x of [...o.position, ...o.quaternion, ...o.scale]) {
        numbers++; if (!Number.isFinite(x)) bad++;
      }
    });
    return { bad, numbers };
  };
  const arrays = (root) => {
    const out = [];
    root.traverse((o) => {
      if (!o.geometry) return;
      for (const name of Object.keys(o.geometry.attributes).sort()) {
        const a = o.geometry.attributes[name];
        out.push({ name, itemSize: a.itemSize, values: Array.from(a.array) });
      }
      if (o.geometry.index) out.push({ name: 'index', itemSize: 1, values: Array.from(o.geometry.index.array) });
    });
    return out;
  };
  const arrayShape = (root) => arrays(root).map(({ name, itemSize, values }) => `${name}:${itemSize}:${values.length}`);
  const draw = (scene) => {
    renderer.setRenderTarget(null);
    renderer.info.reset();
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const error = gl.getError();
    if (error !== gl.NO_ERROR) measurements.glErrors.push(error);
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  };
  const step = (system, seconds, dt = 1 / 60) => {
    const count = Math.ceil(seconds / dt);
    for (let i = 0; i < count; i++) system.update(dt);
  };
  const capacityBounds = (stats) => {
    const cap = stats.capacities;
    return stats.activeParticles <= cap.maxParticles && stats.activeRings <= cap.maxRings &&
      stats.activeShields <= cap.maxShields && stats.activeEmitters <= cap.maxEmitters &&
      stats.activeLights <= cap.maxLights && counters(stats).every((x) => Number.isInteger(x) && x >= 0);
  };
  try {
    check('ten canonical kinds and scene lifecycle exports',
      canonical.length === fx.FX_KINDS?.length && canonical.every((k) => fx.FX_KINDS.includes(k)) &&
      ['createFxSystem', 'spawnFx', 'updateFx', 'clearFx', 'disposeFx'].every((k) => typeof fx[k] === 'function'));

    await attempt('all kinds render', () => {
      const { scene, system } = make();
      for (const kind of canonical) {
        system.clear();
        const handle = system.spawn(kind, { x: 0, y: 1, z: 0 }, { size: 2, seed: 9 });
        system.update(1 / 30);
        const actual = draw(scene), stats = system.getStats();
        measurements.perKind[kind] = { ...actual, stats };
        check(`${kind}: active and visible in WebGL`, handle?.active && live(stats) && actual.calls > 0 && actual.triangles > 0, actual);
        check(`${kind}: submitted budget matches renderer`, actual.calls <= 3 && actual.calls === stats.meshDrawCalls && actual.triangles === stats.submittedTriangles,
          { actual, reported: { calls: stats.meshDrawCalls, triangles: stats.submittedTriangles } });
      }
      const finite = finiteObject(system.object3d);
      check('all effect geometry and transforms contain finite values', finite.bad === 0, finite);
      system.clear();
      const empty = draw(scene);
      check('clear removes all active effects and rendering work', !live(system.getStats()) && empty.calls === 0, { stats: system.getStats(), actual: empty });
    });

    await attempt('determinism', () => {
      const a = make(), b = make(), c = make({ seed: 78 });
      for (const instance of [a, b, c]) {
        for (let i = 0; i < canonical.length; i++) {
          instance.system.spawn(canonical[i], [i % 3 - 1, 1, -Math.floor(i / 3)], { size: 1.5 });
        }
        step(instance.system, 0.25);
      }
      const aa = JSON.stringify(arrays(a.system.object3d));
      const bb = JSON.stringify(arrays(b.system.object3d));
      const cc = JSON.stringify(arrays(c.system.object3d));
      check('equal seeds and time steps produce identical GPU attributes', aa === bb, { attributeBytesCompared: aa.length });
      check('different seeds change emitted geometry', aa !== cc);
    });

    await attempt('caller inputs are copied', () => {
      const a = make(), b = make();
      const origin = new THREE.Vector3(0, 1, 0);
      const direction = new THREE.Vector3(0, 0, -1);
      const color = new THREE.Color(0x45ceff);
      const moving = a.system.spawn('boost', origin, { direction, color, duration: Infinity, seed: 90 });
      const reference = b.system.spawn('boost', [0, 1, 0], { direction: [0, 0, -1], color: 0x45ceff, duration: Infinity, seed: 90 });
      origin.set(999, 999, 999); direction.set(1, 0, 0); color.set(0xff0000);
      step(a.system, 0.15); step(b.system, 0.15);
      check('reused caller position, direction and color cannot alter an effect',
        JSON.stringify(arrays(a.system.object3d)) === JSON.stringify(arrays(b.system.object3d)));
      const next = new THREE.Vector3(2, 1, 0);
      moving.setPosition(next); reference.setPosition([2, 1, 0]); next.set(-999, -999, -999);
      step(a.system, 0.15); step(b.system, 0.15);
      check('setPosition copies the caller vector', JSON.stringify(arrays(a.system.object3d)) === JSON.stringify(arrays(b.system.object3d)));
    });

    await attempt('turning boost emitter', () => {
      const { system } = make({ maxParticles: 128 });
      const handle = system.spawn('boost', [0, 1, 0], { direction: [0, 0, -1], duration: Infinity, seed: 41 });
      system.update(0.1);
      const mesh = system.object3d.children.find((o) => o.geometry?.attributes.aVelocityLife);
      const velocity = mesh.geometry.attributes.aVelocityLife.array;
      const origin = mesh.geometry.attributes.aOriginStart.array;
      const oldCount = system.getStats().activeParticles;
      const oldVelocity = Array.from(velocity.slice(0, oldCount * 4));
      const oldOrigin = Array.from(origin.slice(0, oldCount * 4));
      const direction = new THREE.Vector3(1, 0, 0);
      handle.setDirection(direction);
      direction.set(0, 0, 1);
      system.update(0.2);
      const newCount = system.getStats().activeParticles;
      let turned = newCount > oldCount;
      for (let i = oldCount; i < newCount; i++) turned &&= velocity[i * 4] < 0 && Math.abs(velocity[i * 4]) > Math.abs(velocity[i * 4 + 2]) * 2;
      check('boost direction changes only future particles and copies its input', turned &&
        JSON.stringify(oldVelocity) === JSON.stringify(Array.from(velocity.slice(0, oldCount * 4))) &&
        JSON.stringify(oldOrigin) === JSON.stringify(Array.from(origin.slice(0, oldCount * 4))), { oldCount, newCount });
    });

    await attempt('invalid input guards', () => {
      const { system } = make();
      const cases = [
        () => system.spawn('missing', [0, 0, 0]),
        () => system.spawn('laser', [NaN, 0, 0]),
        () => system.spawn('laser', [1e10, 0, 0]),
        () => system.spawn('laser', [0, 0, 0], { size: NaN }),
        () => system.spawn('laser', [0, 0, 0], { color: NaN }),
        () => system.spawn('laser', [0, 0, 0], { color: new THREE.Color().setRGB(NaN, 1, 1) }),
        () => system.spawn('laser', [0, 0, 0], { size: -1 }),
        () => system.spawn('laser', [0, 0, 0], { duration: Infinity }),
        () => system.spawn('laser', [0, 0, 0], { duration: 0 }),
        () => system.spawn('laser', [0, 0, 0], { direction: [0, 0, 0] }),
        () => system.spawn('scan', [0, 0, 0], { normal: [0, 0, 0] }),
        () => system.spawn('laser', [0, 0, 0], { seed: NaN }),
        () => system.update(-0.1),
        () => system.update(NaN),
        () => system.update(1e13),
      ];
      let rejected = 0;
      for (const run of cases) { try { run(); } catch { rejected++; } }
      check('bad input is rejected before corrupting active pools', rejected === cases.length && !live(system.getStats()) && system.getStats().time === 0 &&
        finiteObject(system.object3d).bad === 0, { rejected, cases: cases.length });
      const valid = system.spawn('laser', [0, 1, 0], { color: 0x66ddff, duration: 1 });
      system.update(0.1);
      check('valid effects still work after rejected position, color and time inputs', valid.active && live(system.getStats()) && finiteObject(system.object3d).bad === 0);
    });

    await attempt('pool pressure and stale handles', () => {
      const { scene, system } = make({ maxParticles: 12, maxRings: 1, maxShields: 1, maxEmitters: 1, maxLights: 1 });
      const shapeBefore = arrayShape(system.object3d);
      const old = system.spawn('shield', [0, 1, 0], { duration: Infinity, seed: 20 });
      const replacement = system.spawn('shield', [1, 1, 0], { duration: Infinity, seed: 21 });
      system.update(0);
      const before = JSON.stringify(arrays(system.object3d));
      old.setPosition([200, 200, 200]);
      old.setDirection([1, 0, 0]);
      old.stop();
      system.update(0);
      check('recycled handles cannot move or stop their replacement', !old.active && replacement.active && before === JSON.stringify(arrays(system.object3d)), system.getStats());
      for (let i = 0; i < 40; i++) system.spawn(canonical[i % canonical.length], [0, 1, 0], { seed: i, size: 2 });
      system.update(1 / 60);
      const stats = system.getStats();
      measurements.stress.pool = { stats, actual: draw(scene), finite: finiteObject(system.object3d) };
      check('pool pressure remains bounded and recycles storage', capacityBounds(stats) && Object.values(stats.overwritten).some((count) => count > 0) && JSON.stringify(shapeBefore) === JSON.stringify(arrayShape(system.object3d)), measurements.stress.pool);
      step(system, 4);
      check('recycled finite effects expire', !live(system.getStats()), system.getStats());
    });

    await attempt('duration and stopping', () => {
      const { scene, system } = make();
      for (const kind of canonical) {
        system.clear();
        const handle = system.spawn(kind, [0, 1, 0], { duration: 0.3, seed: 31 });
        step(system, 0.1);
        const early = handle.active;
        step(system, 2.5);
        check(`${kind}: finite duration completes`, early && !handle.active && !live(system.getStats()), system.getStats());
      }
      for (const kind of ['shield', 'boost']) {
        system.clear();
        const handle = system.spawn(kind, [0, 1, 0], { duration: Infinity, seed: 32 });
        step(system, 3);
        const persistent = handle.active;
        handle.setPosition([2, 1, 0]);
        system.update(1 / 60);
        handle.stop();
        system.update(0);
        const actual = draw(scene);
        check(`${kind}: persistent effect stops cleanly`, persistent && !handle.active && !live(system.getStats()) && actual.calls === 0,
          { actual, stats: system.getStats() });
      }
    });

    await attempt('lights and scene isolation', () => {
      const a = make({ maxLights: 1 }), b = make({ maxLights: 0 });
      for (const s of [a, b]) for (let i = 0; i < 8; i++) s.system.spawn('flare', [i * 0.2, 1, 0], { duration: 0.4, seed: i });
      for (const s of [a, b]) s.system.update(0.05);
      const lightCount = (scene) => {
        let active = 0;
        scene.traverseVisible((o) => { if (o.isPointLight && o.intensity > 0) active++; });
        return active;
      };
      check('flare lighting obeys the configured cap and casts no shadows', lightCount(a.scene) === 1 && lightCount(b.scene) === 0 &&
        a.system.getStats().activeLights <= 1 && b.system.getStats().activeLights === 0,
        { enabled: a.system.getStats().activeLights, disabled: b.system.getStats().activeLights });
      let castsShadow = false;
      a.scene.traverse((o) => { if (o.isLight && o.castShadow) castsShadow = true; });
      check('FX lights do not enable shadow passes', !castsShadow);
      fx.clearFx(a.scene);
      check('clearing one scene preserves another scene', !live(a.system.getStats()) && live(b.system.getStats()));
      step(b.system, 3);
      check('expired flares release their lights', !live(b.system.getStats()) && lightCount(b.scene) === 0);
    });

    await attempt('zero pools', () => {
      const { scene, system } = make({ maxParticles: 0, maxRings: 0, maxShields: 0, maxEmitters: 0, maxLights: 0 });
      for (const kind of canonical) system.spawn(kind, [0, 0, 0]);
      system.update(0.1);
      const stats = system.getStats(), actual = draw(scene);
      check('disabled pools do not allocate active effects or draw', !live(stats) && actual.calls === 0, { stats, actual });
    });

    await attempt('wrapper lifecycle and disposal', () => {
      const { scene, system } = make();
      const foreign = new THREE.Group();
      foreign.name = 'unrelated_scene_content';
      scene.add(foreign);
      const handle = fx.spawnFx(scene, 'flare', { x: 0, y: 1, z: 0 }, { seed: 3 });
      fx.updateFx(scene, 0.1);
      check('scene wrappers reuse the configured system', handle.active && system.getStats().time >= 0.1 && live(system.getStats()));
      draw(scene);
      const geometries = new Set(), materials = new Set();
      system.object3d.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
      let geometryDisposals = 0, materialDisposals = 0;
      for (const g of geometries) g.addEventListener('dispose', () => geometryDisposals++);
      for (const m of materials) m.addEventListener('dispose', () => materialDisposals++);
      fx.disposeFx(scene);
      system.dispose();
      fx.disposeFx(scene);
      const actual = draw(scene);
      check('dispose is idempotent and releases owned GPU resources', geometryDisposals === geometries.size && materialDisposals === materials.size &&
        system.getStats().disposed && !handle.active && !system.object3d.parent && actual.calls === 0 && scene.children.includes(foreign),
        { geometries: geometries.size, geometryDisposals, materials: materials.size, materialDisposals, actual });
      const fresh = fx.spawnFx(scene, 'scan', [0, 0, 0], { seed: 4 });
      fx.updateFx(scene, 0.1);
      check('disposed scene can create a fresh system', fresh.active && draw(scene).calls > 0);
      fx.disposeFx(scene);
    });

    await attempt('sustained stress', () => {
      const { scene, system } = make({ maxParticles: 256, maxRings: 4, maxShields: 4, maxEmitters: 4, maxLights: 1 });
      const shapeBefore = JSON.stringify(arrayShape(system.object3d));
      const started = performance.now();
      let peakParticles = 0, peakEmitters = 0, bounded = true;
      for (let frame = 0; frame < 600; frame++) {
        if (frame % 3 === 0) system.spawn(canonical[(frame / 3) % canonical.length], [Math.sin(frame) * 2, 1, 0], { seed: frame, size: 2 });
        system.update(1 / 60);
        const stats = system.getStats();
        peakParticles = Math.max(peakParticles, stats.activeParticles);
        peakEmitters = Math.max(peakEmitters, stats.activeEmitters);
        bounded &&= capacityBounds(stats);
      }
      measurements.stress.sustained = { simulatedSeconds: 10, iterations: 600, cpuLoopMs: performance.now() - started, peakParticles, peakEmitters,
        actual: draw(scene), stats: system.getStats(), finite: finiteObject(system.object3d) };
      check('sustained emissions stay finite and retain fixed buffer sizes', bounded && measurements.stress.sustained.finite.bad === 0 &&
        shapeBefore === JSON.stringify(arrayShape(system.object3d)), measurements.stress.sustained);
    });

    await attempt('25-player defaults and desktop CPU timings', () => {
      const { scene, system } = make();
      const shields = [], boosts = [];
      for (let i = 0; i < 25; i++) {
        const position = [(i % 5 - 2) * 3, 1, (Math.floor(i / 5) - 2) * 3];
        shields.push(system.spawn('shield', position, { duration: Infinity, size: 1.2, seed: 100 + i }));
        boosts.push(system.spawn('boost', position, { duration: Infinity, size: 0.7, seed: 200 + i }));
      }
      system.update(1 / 60);
      check('default pools retain 25 shields and 25 boost emitters', shields.every((h) => h.active) && boosts.every((h) => h.active) &&
        system.getStats().activeShields === 25, system.getStats());
      const updateMs = [], submitMs = [];
      let maxCalls = 0, maxTriangles = 0;
      for (let frame = 0; frame < 180; frame++) {
        const position = [(frame % 5 - 2) * 3, 1, (Math.floor(frame / 5) % 5 - 2) * 3];
        if (frame % 4 === 0) system.spawn('laser', position, { seed: 1000 + frame, size: 0.4 });
        if (frame % 15 === 0) system.spawn('explosion', position, { seed: 2000 + frame, size: 1.5 });
        if (frame % 60 === 0) system.spawn('flare', position, { seed: 3000 + frame, size: 1 });
        const t0 = performance.now();
        system.update(1 / 60);
        const t1 = performance.now();
        const actual = draw(scene);
        const t2 = performance.now();
        maxCalls = Math.max(maxCalls, actual.calls);
        maxTriangles = Math.max(maxTriangles, actual.triangles);
        if (frame >= 30) { updateMs.push(t1 - t0); submitMs.push(t2 - t1); }
      }
      const summary = (list) => {
        const sorted = [...list].sort((a, b) => a - b);
        return { medianMs: sorted[Math.floor(sorted.length * 0.5)], p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)], maxMs: sorted.at(-1) };
      };
      measurements.stress.desktopCpu = { playerCount: 25, iterations: 180, warmupIterations: 30, sampleCount: updateMs.length,
        update: summary(updateMs), renderSubmission: summary(submitMs), maxCalls, maxTriangles, stats: system.getStats(),
        note: 'Desktop CPU durations measured in a tight loop. Render submission includes renderer.render and gl.getError, not GPU completion. These are not real-time FPS or physical-phone measurements.' };
      check('25-player effects retain the three-call bound', maxCalls <= 3 && capacityBounds(system.getStats()) && finiteObject(system.object3d).bad === 0, measurements.stress.desktopCpu);
      for (const handle of [...shields, ...boosts]) handle.stop();
      step(system, 4);
      check('25-player stress drains after stopping persistent effects', !live(system.getStats()), system.getStats());
    });
    check('WebGL compiles and renders without shader or GL errors', !measurements.shaderErrors.length && !measurements.glErrors.length,
      { shaderErrors: measurements.shaderErrors, glErrors: measurements.glErrors });
  } finally {
    for (const { scene, system } of owned) {
      try { system.dispose(); fx.disposeFx(scene); } catch (error) { check('final cleanup', false, String(error)); }
    }
    renderer.debug.onShaderError = oldError;
    renderer.debug.checkShaderErrors = oldShaderCheck;
    renderer.autoClear = oldAutoClear;
    renderer.setRenderTarget(oldTarget);
  }
  return { pass: checks.every((c) => c.pass), checks, measurements,
    limitations: ['Desktop WebGL validation only; not physical-phone performance.', 'Visual quality and bloom appearance require the accompanying preview review.', 'CPU loop timing excludes real-time pacing and is not an FPS measurement.'] };
}
