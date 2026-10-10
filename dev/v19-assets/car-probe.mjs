// v1.9 assets, node only (no browser): checks render.js's A-009 default car stand-in (the code between
// "---- v1.9 A-009 default car" and "---- end of the A-009 default car", evaluated as is) against car.js itself:
// clones share geometry and own materials + wheel batch, 3 draw calls / 4,776 triangles, wheels sit on the ground,
// drive() poses the wheels exactly like car.js's setWheel (spin + front steer), a parked car uploads nothing,
// dispose frees only the clone. Run: THREE_JS=/path/to/three.module.js (r160, addons beside it) node dev/v19-assets/car-probe.mjs
import fs from "node:fs";
const { THREE, fileLoader, ROOT, tris } = await import("./three-node.mjs");
const { createDefaultCar } = await import(new URL("assets/A-009-defaults/car.js", ROOT).href);
const src = fs.readFileSync(new URL("render.js", ROOT), "utf8");
const a = src.indexOf("const DEFAULT_CAR = "), b = src.indexOf("// ---- end of the A-009 default car");
if (a < 0 || b < 0) throw new Error("default car block not found in render.js");
let tplPromise = null;
const loadAsset = (name) => (name === "car" ? (tplPromise ||= createDefaultCar({ loader: fileLoader })) : Promise.resolve(null));
const mk = new Function("THREE", "loadAsset", "clamp", "ENT_TAU", src.slice(a, b) + "\nreturn { DEFAULT_CAR, defaultCarLoad, defaultCarMake };");
const R = mk(THREE, loadAsset, THREE.MathUtils.clamp, Math.PI * 2);
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
check(R.defaultCarMake(0xff3355) === null, "null before the template is in (callers show the toy)");
const t0 = performance.now();
const tpl = await R.defaultCarLoad();
console.log(`template load+check ${(performance.now() - t0).toFixed(1)} ms; state ${R.DEFAULT_CAR.state}`);
check(R.DEFAULT_CAR.state === 2 && !!tpl, "template ready");
const t1 = performance.now();
const cars = [0xff3355, 0x22c55e, 0x3b82f6, 0xffffff].map((c) => R.defaultCarMake(c));
console.log(`4 clones ${(performance.now() - t1).toFixed(2)} ms`);
const [c1, c2] = cars;
// draw calls + triangles of one clone
let calls = 0, tri = 0;
c1.object3d.traverse((o) => { if (o.isMesh) { calls++; tri += tris(o.geometry) * (o.isInstancedMesh ? o.count : 1); } });
check(calls === 3 && tri === 4776, `clone draws ${calls} calls / ${tri} triangles (3 / 4,776)`);
// shared geometry, own materials, own wheel batch
const meshes = (c) => { const m = []; c.object3d.traverse((o) => o.isMesh && m.push(o)); return m; };
const m1 = meshes(c1), m2 = meshes(c2), mt = meshes(tpl);
check(m1.every((o, i) => o.geometry === m2[i].geometry && o.geometry === mt[i].geometry), "geometry shared with the template");
check(m1.every((o, i) => o.material !== m2[i].material && o.material !== mt[i].material), "materials owned per clone");
const b1 = c1.object3d.getObjectByName("car_wheel_instances"), b2 = c2.object3d.getObjectByName("car_wheel_instances"), bt = tpl.object3d.getObjectByName("car_wheel_instances");
check(b1.instanceMatrix !== b2.instanceMatrix && b1.instanceMatrix.array !== bt.instanceMatrix.array, "wheel batch owned per clone");
check(c1.materials.length === 3, `3 materials listed (${c1.materials.length})`);
const body1 = c1.object3d.getObjectByName("car_body").material.color, bodyW = cars[3].object3d.getObjectByName("car_body").material.color;
check(body1.r > body1.g * 2 && bodyW.r === 1 && bodyW.g === 1, `body tint: red player ${body1.getHexString()} / white player ${bodyW.getHexString()}`);
check(["seat", "roof", "front", "back", "top", "mouth", "tail"].every((k) => c1.sockets[k]?.isObject3D), "sockets incl. the toy's aliases");
// on the ground, nose -Z
const box = new THREE.Box3().setFromObject(c1.object3d);
check(Math.abs(box.min.y) < 0.01 && box.max.z - box.min.z > 3.9 && Math.abs(box.min.z + 2.02) < 0.01, `bounds y ${box.min.y.toFixed(3)}..${box.max.y.toFixed(3)} z ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)}`);
// drive() == car.js setWheel for the same spin / steer
const ref = await createDefaultCar({ loader: fileLoader });
const dt = 1 / 60;
let spin = 0, maxErr = 0;
for (let i = 0; i < 90; i++) c1.drive(8, 0.9, dt); // 1.5 s at 8 m/s turning left 0.9 rad/s
spin = (-(8 * 90 * dt) / 0.5519999861717224) % (Math.PI * 2);
const steer = c1.object3d.getObjectByName("wheel_fl").quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -spin)); // remove spin
const steerAngle = 2 * Math.atan2(steer.y, steer.w);
for (const k of ["fl", "fr"]) ref.setWheel(k, { spin, steer: steerAngle });
for (const k of ["bl", "br"]) ref.setWheel(k, { spin });
const rb = ref.wheelMesh, A = new THREE.Matrix4(), B = new THREE.Matrix4();
for (let i = 0; i < 4; i++) { b1.getMatrixAt(i, A); rb.getMatrixAt(i, B); for (let j = 0; j < 16; j++) maxErr = Math.max(maxErr, Math.abs(A.elements[j] - B.elements[j])); }
const wantSteer = Math.atan((2.45 * 0.9) / 8);
check(maxErr < 1e-5, `drive() matrices = car.js setWheel (max error ${maxErr.toExponential(2)})`);
check(steerAngle > 0 && Math.abs(steerAngle - wantSteer) < 0.01, `front steer ${steerAngle.toFixed(3)} rad left (bicycle model ${wantSteer.toFixed(3)})`);
b1.getMatrixAt(2, A);
check(Math.abs(new THREE.Quaternion().setFromRotationMatrix(A).y) < 1e-6, "rear wheels never steer");
// a parked car: no upload once straight
for (let i = 0; i < 120; i++) c1.drive(0, 0, dt);
const v0 = b1.instanceMatrix.version;
for (let i = 0; i < 30; i++) c1.drive(0, 0, dt);
check(b1.instanceMatrix.version === v0, `parked: no uploads (version ${v0} -> ${b1.instanceMatrix.version})`);
c1.drive(-3, 0, dt);
check(b1.instanceMatrix.version > v0, "reversing spins the wheels again");
check(Number.isFinite(b1.instanceMatrix.array[0]) && (c1.drive(NaN, NaN, dt), b1.instanceMatrix.array.every(Number.isFinite)) && (c1.drive(5, 1, 0), true), "NaN / zero dt inputs stay finite");
// dispose: the clone only
let disposedGeo = 0;
for (const o of mt) o.geometry.addEventListener("dispose", () => disposedGeo++);
let disposedMat = 0;
for (const m of c1.materials) m.addEventListener("dispose", () => disposedMat++);
let disposedBatch = 0;
b1.addEventListener("dispose", () => disposedBatch++);
c1.dispose();
check(disposedGeo === 0 && disposedMat === 3 && disposedBatch === 1, `dispose: clone materials ${disposedMat}/3 + batch ${disposedBatch}, shared geometry untouched (${disposedGeo})`);
const c5 = R.defaultCarMake(0x123456);
check(!!c5 && meshes(c5).length === 3, "a new clone after a dispose still builds");
console.log(fails.length ? `${fails.length} FAILED` : "ALL CAR CHECKS PASS");
process.exit(fails.length ? 1 : 0);
