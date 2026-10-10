// Render-agent harness helpers (extends dev/v11-client/lib.mjs). Nothing here edits the game.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
export * from "../../v11-client/lib.mjs";
export const RHERE = path.dirname(fileURLToPath(import.meta.url));
export const HOST_HTML = fs.readFileSync(path.join(RHERE, "host.html"), "utf8");

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
  const { post, Samples } = await import("../../v11-client/lib.mjs");
  const j = await post(base, "/join", { player: name, device: "render-" + name + "-device-token" });
  const g = await post(base, "/generate", { player: name, kind: "ship", image: Samples.dataUrl("ship", variant), source: "draw", speculative: false, requestId: `r-${name}` });
  return { join: j.json, gen: g.json && { ok: g.json.ok, verbs: g.json.entity && g.json.entity.verbs, image: g.json.entity && g.json.entity.image, error: g.json.error } };
}
