// Render agent: where do the draw calls go? Boss-fight scene at 25 players: a per-top-level-object breakdown of what is drawn.
//   dev/v12-client/render/locked.sh 300 node dev/v12-client/render/diag.mjs --label before [--tier 0] [--phone-only] [--tv-only]
import fs from "fs";
import path from "path";
import { args, makeLogger, installSignalHandlers, runCleanups, startServer, launchBig, launchPhoneBrowser, post, sleep, hook, input, ROOT, RHERE, serveHost, openHost, joinWithShip } from "./lib2.mjs";
const A = args();
const log = makeLogger("render-diag");
installSignalHandlers(log);
const PORT = A.num("port", 8264), BOTS = A.num("bots", 24), LABEL = A.opt("label", "diag"), TIER = A.opt("tier", null);

const BREAKDOWN = () => {
  const g = window.__game, I = g._internals, THREE = I.THREE, G = I.game, cam = I.camera;
  const scene = G.sceneName === "planet" ? G.island.scene : G.space.scene;
  cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum();
  fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const top = (o) => { while (o.parent && o.parent !== scene) o = o.parent; return o; };
  const names = new Map();
  const nameOf = (o) => {
    if (names.has(o)) return names.get(o);
    let n = null;
    for (const [k, v] of G.space.ships) if (v.group === o) n = "ship:" + (v.model ? v.kind : "impostor");
    if (!n && G.space.boss && G.space.boss.group === o) n = "boss";
    if (!n && G.space.planetLook && G.space.planetLook.root === o) n = "planetLook";
    if (!n && G.space.rockField && G.space.rockField.object3d === o) n = "rockField";
    for (const f of G.space.deco) if (!n && f.group === o) n = "deco";
    if (!n && G.space.particles.mesh === o) n = "particles";
    if (!n && G.space.glow.mesh === o) n = "glow";
    if (!n && G.space.nebula.mesh === o) n = "nebula";
    if (!n && G.space.streaks.mesh === o) n = "streaks";
    if (!n && G.space.rings.group === o) n = "rings";
    if (!n && G.space.env && G.space.env.object3d === o) n = "spaceEnv";
    if (!n && o.isPoints) n = "stars";
    names.set(o, n || o.type + ":" + (o.name || "?"));
    return names.get(o);
  };
  const rows = {};
  let drawn = 0, tris = 0;
  scene.traverseVisible((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints || o.isLineSegments)) return;
    const geo = o.geometry; if (!geo) return;
    if (o.frustumCulled) {
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const s = geo.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      if (!fr.intersectsSphere(s)) return;
    }
    // every drawn material of a multi-material mesh is a call
    const mats = Array.isArray(o.material) ? o.material.length : 1;
    const inst = o.isInstancedMesh ? o.count : (geo.instanceCount !== undefined && geo.isInstancedBufferGeometry ? geo.instanceCount : 1);
    if (inst === 0) return;
    const idx = geo.index ? geo.index.count : (geo.attributes.position ? geo.attributes.position.count : 0);
    const t = (idx / 3) * inst;
    const key = nameOf(top(o));
    const r = rows[key] || (rows[key] = { calls: 0, tris: 0, objects: 0 });
    r.calls += mats; r.tris += Math.round(t); r.objects++;
    drawn += mats; tris += t;
  });
  const info = I.renderer.info.render;
  return { scene: G.sceneName, infoCalls: info.calls, infoTris: info.triangles, sceneCalls: drawn, sceneTris: Math.round(tris), passesOverhead: info.calls - drawn, rows };
};

async function main() {
  const server = await startServer({ port: PORT, bots: BOTS, serverArgs: ["--cap", "900", "--assists", "800"], env: { PERF_LOG: path.join(RHERE, `diag-${LABEL}.log`) }, logFile: path.join(RHERE, `diag-server-${LABEL}.log`), script: "dev/v12-client/server.cjs", log });
  const base = server.base;
  for (const [i, n] of ["phoneguy", "ana"].entries()) await joinWithShip(base, n, i + 1);
  const big = A.flag("phone-only") ? null : await launchBig();
  if (big) await serveHost(big.context);
  const pb = A.flag("tv-only") ? null : await launchPhoneBrowser();
  const ph = pb ? await pb.newPhone() : null;
  if (ph) await serveHost(ph.context);
  if (big) await openHost(big.page, base, { screen: "big", perf: true });
  if (ph) await openHost(ph.page, base, { screen: "phone", player: "phoneguy", view: "chase" });
  if (TIER !== null) for (const pg of [big && big.page, ph && ph.page].filter(Boolean)) await pg.evaluate((t) => { window.__game._internals.game.perf.pin = Number(t); }, TIER);
  await sleep(3000);
  const out = { label: LABEL, tier: TIER, phases: {} };
  const dump = async (name) => {
    out.phases[name] = {};
    for (const [k, pg] of [["tv", big && big.page], ["phone", ph && ph.page]]) if (pg) { await sleep(300); out.phases[name][k] = await pg.evaluate(BREAKDOWN); }
    log(`${name}: ` + JSON.stringify(Object.fromEntries(Object.entries(out.phases[name]).map(([k, v]) => [k, { info: v.infoCalls, scene: v.sceneCalls, over: v.passesOverhead, tris: v.infoTris }]))));
  };
  await dump("lobby");
  await post(base, "/start", { countdown: false }); await sleep(5000);   // v1.4: no 3-2-1
  const state = await hook.state(base), b = state.boss;
  let k = 0;
  for (const n of Object.keys(state.players)) await hook.teleport(base, { player: n, near: { x: b.x, y: b.y, z: b.z }, distance: b.radius + 45 + (k++ % 9) * 12, face: { x: b.x, y: b.y, z: b.z }, heal: true });
  await hook.boss(base, { hp: 4000 });
  for (const n of ["phoneguy", "ana"]) await input(base, n, "shoot", true);
  await sleep(8000);
  await dump("boss");
  await sleep(2000);
  await dump("boss2");
  fs.writeFileSync(path.join(RHERE, `diag-${LABEL}.json`), JSON.stringify(out, null, 2));
  for (const ph2 of ["lobby", "boss"]) for (const k2 of Object.keys(out.phases[ph2])) {
    const v = out.phases[ph2][k2];
    console.log(`\n== ${ph2} ${k2}: info.calls ${v.infoCalls} (scene objects ${v.sceneCalls}, passes ${v.passesOverhead}) tris ${v.infoTris}`);
    for (const [n, r] of Object.entries(v.rows).sort((a, b) => b[1].calls - a[1].calls)) console.log(`   ${n.padEnd(28)} calls ${String(r.calls).padStart(3)} objs ${String(r.objects).padStart(3)} tris ${r.tris}`);
  }
  await runCleanups();
}
main().then(() => process.exit(0)).catch(async (e) => { console.error(`[render-diag] failed: ${e.stack || e.message}`); await runCleanups(); process.exit(1); });
