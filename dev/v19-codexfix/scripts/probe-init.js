// v19-codexfix M6 probe (a Playwright init script, runs before the page's own scripts): frame intervals from its own rAF loop, time spent
// in every rAF callback, main-thread timer lag, the game's own per-frame JS work, shader programs / textures, running CSS animations and
// visible canvases. window.__probe.read() returns the window since the last read and resets it.
(() => {
  const P = (window.__probe = { raf: 0, rafMs: 0, rafMax: 0, lagSum: 0, lagMax: 0, lagN: 0, iv: [], last: 0, lastFrames: 0 });
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => orig((ts) => { const t0 = performance.now(); try { cb(ts); } finally { const d = performance.now() - t0; P.raf++; P.rafMs += d; if (d > P.rafMax) P.rafMax = d; } });
  const loop = (ts) => { if (P.last) P.iv.push(ts - P.last); P.last = ts; orig(loop); };
  orig(loop);
  let exp = performance.now() + 50;
  setInterval(() => { const now = performance.now(), lag = Math.max(0, now - exp); P.lagSum += lag; P.lagN++; if (lag > P.lagMax) P.lagMax = lag; exp = now + 50; }, 50);
  const q = (s, f) => (s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0);
  P.read = () => {
    const iv = P.iv.splice(0), s = [...iv].sort((a, b) => a - b);
    const g = window.__game || (window.__sp && window.__sp.game), I = g && g._internals, R = I && I.renderer, G = I && I.game, W = G && G.perf;
    const nNew = G && G.frames ? G.frames - P.lastFrames : 0;
    if (G) P.lastFrames = G.frames || 0;
    let work = null;
    if (W && W.work.length && nNew > 0) { const w = W.work.slice(-Math.min(W.work.length, nNew)), ws = [...w].sort((a, b) => a - b); work = { n: w.length, avg: +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2), p90: +q(ws, 0.9).toFixed(2), max: +ws[ws.length - 1].toFixed(2) }; }
    let anims = null, animList = null;
    try { const run = document.getAnimations().filter((a) => a.playState === "running"); anims = run.length; animList = run.slice(0, 6).map((a) => (a.animationName || a.transitionProperty || a.id || "anim") + "@" + ((a.effect && a.effect.target && (a.effect.target.id || String(a.effect.target.className || a.effect.target.tagName).slice(0, 30))) || "?")); } catch {}
    const out = {
      at: Date.now(), frames: iv.length, ivAvg: iv.length ? +(iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(2) : 0, ivP90: +q(s, 0.9).toFixed(2), ivMax: +(s[s.length - 1] || 0).toFixed(1),
      gameFrames: nNew, raf: P.raf, rafMs: +P.rafMs.toFixed(1), rafMax: +P.rafMax.toFixed(1), lagAvg: P.lagN ? +(P.lagSum / P.lagN).toFixed(2) : 0, lagMax: +P.lagMax.toFixed(1), work,
      tier: W ? W.tier : null, programs: R && R.info.programs ? R.info.programs.length : null, textures: R ? R.info.memory.textures : null, geometries: R ? R.info.memory.geometries : null,
      calls: R ? R.info.render.calls : null, scene: G ? G.sceneName : null, anims, animList,
      canvases: [...document.querySelectorAll("canvas")].filter((c) => c.width && c.height && c.getClientRects().length).map((c) => (c.id || "c") + ":" + c.width + "x" + c.height).join(","),
      screen: window.__sp ? window.__sp.screen : null, hidden: document.hidden,
    };
    P.raf = 0; P.rafMs = 0; P.rafMax = 0; P.lagSum = 0; P.lagN = 0; P.lagMax = 0;
    return out;
  };
})();
