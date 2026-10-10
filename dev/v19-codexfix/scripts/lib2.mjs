// Render-agent harness helpers (extends dev/v11-client/lib.mjs). Nothing here edits the game.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
export * from "./lib.mjs";
export const RHERE = path.dirname(fileURLToPath(import.meta.url));
export const HOST_HTML = fs.readFileSync("/private/tmp/claude-501/v19-codexfix/dev/v12-client/render/host.html", "utf8");

// Serves the host page at /__render/host.html on this context (the game server does not know it).
export async function serveHost(context) {
  await context.route(/\/__render\/host\.html/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }));
}
export async function openHost(page, base, { screen, player, view, perf = true } = {}) {
  const q = new URLSearchParams({ screen });
  if (player) q.set("player", player);
  if (view) q.set("view", view);
  await page.goto(`${base}/__render/host.html?${q}${perf ? "&perf" : ""}`, { waitUntil: "load", timeout: 40000 });
  await page.waitForFunction(() => window.__hostReady === true, null, { timeout: 40000 });
}
// Per-frame sampler inside the page: draw calls, triangles, frame time, scene, tier, CPU work.
export const installSampler = (page) => page.evaluate(() => {
  const g = window.__game, I = g._internals, R = I.renderer;
  const S = (window.__pf = { calls: [], tris: [], dt: [], scene: [], tier: [], run: true, last: performance.now() });
  g.on("frame", () => {
    if (!S.run) return;
    const n = performance.now();
    S.dt.push(n - S.last); S.last = n;
    S.calls.push(R.info.render.calls); S.tris.push(R.info.render.triangles);
    S.scene.push(I.game.sceneName); S.tier.push(I.game.perf.tier);
  });
});
export const resetSampler = (page) => page.evaluate(() => { const S = window.__pf; S.calls.length = S.tris.length = S.dt.length = S.scene.length = S.tier.length = 0; S.last = performance.now(); });
export const readSampler = (page) => page.evaluate(() => { const S = window.__pf; return { calls: S.calls.slice(), tris: S.tris.slice(), dt: S.dt.slice(1), scene: S.scene.slice(), tier: S.tier.slice() }; });
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };
const r1 = (n) => Math.round(n * 10) / 10;
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export function summarise(s) {
  if (!s || !s.dt.length) return null;
  const mean = avg(s.dt);
  return {
    frames: s.dt.length, fps: r1(1000 / mean), low1: r1(1000 / pct(s.dt, 99)), p90ms: r1(pct(s.dt, 90)), worstMs: r1(Math.max(...s.dt)),
    calls: { avg: r1(avg(s.calls)), p95: pct(s.calls, 95), max: Math.max(...s.calls) }, tris: { avg: Math.round(avg(s.tris)), p95: pct(s.tris, 95), max: Math.max(...s.tris) },
    tier: { min: Math.min(...s.tier), max: Math.max(...s.tier) }, scenes: [...new Set(s.scene)],
  };
}
// A small PNG as the dev-kit ship drawing (any valid PNG data URL): the lib's sample ships.
export async function joinWithShip(base, name, variant = 1) {
  const { post, Samples } = await import("./lib.mjs");
  const j = await post(base, "/join", { player: name, device: "render-" + name + "-device-token" });
  const g = await post(base, "/generate", { player: name, kind: "ship", image: Samples.dataUrl("ship", variant), source: "draw", speculative: false, requestId: `r-${name}` });
  return { join: j.json, gen: g.json && { ok: g.json.ok, verbs: g.json.entity && g.json.entity.verbs, image: g.json.entity && g.json.entity.image, error: g.json.error } };
}

// v19-codexfix: per-frame draw-call attribution over the whole sampling window. installAttrib wraps renderer.renderBufferDirect and
// buckets every draw by the nearest known owner (explorer / parked ship / decoy / kit part / chest field / ...), else by the scene's
// top-level child; readAttrib returns { frames, maxTotal, worst: {label: n} (the max frame), over: {label: avg} (frames > 110), avg }.
export const installAttrib = (page) => page.evaluate(() => {
  const g = window.__game, I = g._internals, R = I.renderer, G = I.game;
  const labelOf = new Map();
  const tag = (o, l) => { if (o) labelOf.set(o, l); };
  const retag = () => {
    labelOf.clear();
    const isl = G.island;
    for (const e of isl.explorers.values()) tag(e.group, "explorer:" + (e.kind || "none") + (e.model && e.model.entity3d ? "/e3d" : ""));
    for (const v of isl.parked.values()) tag(v.group, "parked:" + (v.kind || "none") + (v.model && v.model.ship3d ? "/s3d" : ""));
    if (isl.mischief) { for (const v of isl.mischief.decoys.values()) tag(v.group, "decoy:" + (v.kind || "none")); tag(isl.mischief.mines, "mines"); tag(isl.mischief.ink && isl.mischief.ink.mesh, "ink"); tag(isl.mischief.ownStreaks && isl.mischief.ownStreaks.mesh, "streaks"); }
    if (isl.kit) { tag(isl.kit.object3d, "kit"); for (const c of isl.kit.object3d.children) tag(c, "kit/" + (c.name || c.type)); }
    tag(isl.terrain, "terrain"); tag(isl.water, "water"); (isl.props || []).forEach((m) => tag(m, "props"));
    tag(isl.blobs && isl.blobs.mesh, "blobs"); tag(isl.glow && isl.glow.mesh, "glow"); tag(isl.particles && isl.particles.mesh, "particles"); tag(isl.rings && isl.rings.group, "rings"); tag(isl.bullets, "bullets");
    if (isl.chestField) for (const k of Object.keys(isl.chestField)) { const o = isl.chestField[k]; if (o && o.isObject3D) tag(o, "chests/" + k); }
    if (isl.efx) { for (const k of Object.keys(isl.efx)) { const o = isl.efx[k]; if (o && o.isObject3D) tag(o, "efx/" + k); } if (isl.efx.sys && isl.efx.sys.object3d) tag(isl.efx.sys.object3d, "efx"); }
  };
  const label = (scene, object) => {
    if (scene !== G.island.scene && scene !== G.space.scene) return "post";
    for (let o = object; o; o = o.parent) { const l = labelOf.get(o); if (l) return l; }
    let o = object; while (o.parent && o.parent !== scene) o = o.parent;
    return "top:" + (o.name || o.type) + (object.isInstancedMesh ? "[I]" : "") + (object.isSkinnedMesh ? "[S]" : "");
  };
  const orig = R.renderBufferDirect;
  const S = (window.__attr = { orig, cur: new Map(), acc: new Map(), over: new Map(), nOver: 0, n: 0, maxT: 0, worst: null, on: true });
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (S.on) { const l = label(scene, object); S.cur.set(l, (S.cur.get(l) || 0) + 1); }
    return orig.apply(this, arguments);
  };
  retag();
  S.off = g.on("frame", () => {
    if (!S.on) return;
    if (S.n % 20 === 0) retag();
    let tot = 0;
    for (const c of S.cur.values()) tot += c;
    for (const [l, c] of S.cur) S.acc.set(l, (S.acc.get(l) || 0) + c);
    if (tot > 110) { S.nOver++; for (const [l, c] of S.cur) S.over.set(l, (S.over.get(l) || 0) + c); }
    if (tot > S.maxT) { S.maxT = tot; S.worst = Object.fromEntries([...S.cur.entries()].sort((a, b) => b[1] - a[1])); }
    S.n++;
    S.cur = new Map();
  });
});
export const resetAttrib = (page) => page.evaluate(() => { const S = window.__attr; S.acc.clear(); S.over.clear(); S.nOver = 0; S.n = 0; S.maxT = 0; S.worst = null; S.cur = new Map(); });
export const readAttrib = (page) => page.evaluate(() => {
  const S = window.__attr; S.on = false;
  const avg = {}, over = {};
  [...S.acc.entries()].sort((a, b) => b[1] - a[1]).forEach(([l, c]) => (avg[l] = Math.round((c / Math.max(1, S.n)) * 10) / 10));
  [...S.over.entries()].sort((a, b) => b[1] - a[1]).forEach(([l, c]) => (over[l] = Math.round((c / Math.max(1, S.nOver)) * 10) / 10));
  return { frames: S.n, maxTotal: S.maxT, framesOver110: S.nOver, worst: S.worst, over, avg };
});
// v19-codexfix: what IslandWorld.countFixed counts, by top-level child (patched render.js only), and the actor budget it gives.
export const fixedBreakdown = (page) => page.evaluate(() => {
  const G = window.__game._internals.game, isl = G.island;
  if (typeof isl.countFixed !== "function") return null;
  const out = {};
  const callsOf = (o) => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return 0; const arr = Array.isArray(o.material), m = arr ? o.material[0] : o.material; const g = arr && o.geometry && o.geometry.groups.length ? o.geometry.groups.length : 1; return g * (m && m.transparent && m.side === 2 && !m.forceSinglePass ? 2 : 1); };
  for (const top of isl.scene.children) {
    let n = 0;
    const walk = (o, all) => { if (o.userData.actor || (!all && !o.visible)) return; if (o.userData.pool) all = true; n += callsOf(o); for (const c of o.children) walk(c, all); };
    walk(top, false);
    if (n) { const k = (top.name || top.type) + (top.userData.pool ? "(pool)" : ""); out[k] = (out[k] || 0) + n; }
  }
  return { total: isl.countFixed(), byTop: out, fixedDraws: isl.fixedDraws };
});
