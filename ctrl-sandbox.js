// Sandboxed controller: runs a controller written as HTML (by Sol through astra-html.js, or its template) in
// <iframe sandbox="allow-scripts"> (no same-origin, so its origin is "null") under a strict CSP. The frame gets a
// trusted kit, injected before the controller's own markup, that does all the input handling (multi-touch pointer
// events, hit areas of at least 56 px, analog sticks, toggles, pressed states) and talks to the page only through
// postMessage. The page checks every message: it comes from this frame with origin "null", has a known type, an
// allowed action, clamped axis values, and at most `rate` messages per second per control.
//
//   mountController(container, html, {
//     allowedActions,            // required: the actions the frame may send ("steer"/"move" for sticks)
//     onPress(action), onRelease(action), onAxis(axis, x, y),   // x, y in -1..1, y up = +1
//     onReady({ controls }),     // controls: [{ action, kind: "button"|"stick"|"toggle", label, x, y, w, h }],
//                                // rectangles as fractions of the frame; called once per mounted document
//     onViolation({ kind, detail }),   // kind: action | type | rate | flood | navigate | timeout | missing
//     fallbackHtml,              // mounted instead when the frame navigates away, floods, never reports ready
//     requiredActions,           //   within readyTimeoutMs, or reports none of requiredActions' controls
//     readyTimeoutMs = 2500, rate = 60, pageCsp = true,   // pageCsp: see below
//     momentaryActions,          // one-shot skills (BLAST, LAND, EMP...): a switch (data-toggle) bound to one fires once per
//                                // tap (press, release 120 ms later) and never stays "on" (it took two taps per use)
//   }) → handle {
//     iframe, ready (Promise<controls>), controls(), releaseAll(), destroy(), setDisabled(actions), busy(),
//     replace(html, { waitIdleMs = 4000 }) → Promise<boolean>,  // load another document hidden, go live when it
//                                // reports every required control and no finger is down; false = discarded
//     fx("emp", { seconds = 5, seed }) → Promise<{ map }>,   // the kit swaps the controls' places, then restores
//     usingFallback, stats() }
//   container.ctrlSandbox and handle.iframe.ctrlSandbox point at the handle (mischief-fx.js finds it there).
//
// Controller markup contract (kit v1, dev/v12-modules/SPEC.md): a button is any element with data-action="shoot"
// (add data-toggle for a toggle), a stick is data-stick="steer"|"move" with one data-knob child, data-label
// overrides the text. The kit sets .is-down, .is-on, .is-disabled and html.is-emp, and --x / --y on sticks.
// Inside the frame: window.game = { press(action), release(action), axis(name, x, y) }.
//
// The one request the frame's own CSP cannot stop is a navigation of the frame itself (location = url). So the first
// mount also adds <meta http-equiv="Content-Security-Policy" content="frame-src 'none'"> to the page's <head>:
// srcdoc frames still load, URL navigations of any frame on the page are refused. Opt out with { pageCsp: false };
// a navigation is then still caught (second load event) and the fallback mounted, but its request has left.

export const KIT_VERSION = 1;
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";
export const MIN_HIT_PX = 56;
const SLOP_PX = 6;          // hit rectangles grow by this much on every side
const KEEP_PX = 14;         // a held button is released when the finger slides this far outside its hit rectangle
const STICKS = ["steer", "move"];
const MAX_ACTION_CHARS = 32;

// Base styles for every controller document. !important where the page must win: a transparent page, no
// scrolling, selection, callouts or zoom, and no backdrop-filter (too slow on an iPhone over WebGL).
const KIT_CSS = `
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden!important;background:transparent!important;overscroll-behavior:none}
*,*::before,*::after{touch-action:none!important;-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important;-webkit-tap-highlight-color:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
:focus{outline:none}
[data-action],[data-stick]{cursor:pointer}
.is-disabled{filter:grayscale(1) brightness(.8);opacity:.42}
[data-action]{transition:scale .16s cubic-bezier(.3,1.8,.5,1)}
[data-action].is-down{scale:.9;transition:scale .05s ease-out}
@media (prefers-reduced-motion:reduce){[data-action],[data-action].is-down{transition:none}}
`;
// v1.5 press juice: the individual "scale" property (Safari 14.1+) composes with whatever transform Sol's own CSS puts on a
// button (slanted panels), so a pressed control squashes and springs back without losing its look. No filter (Sol's drop
// shadows stay) and nothing on sticks (their knob maths reads the stick's box).

// ---- The kit: runs inside the frame, before the controller's own markup ---------------------------------------------
// Serialised with Function.prototype.toString, so it must not use anything from this module's scope.
function kit(cfg) {
  "use strict";
  const P = window.parent;
  const D = document;
  const MOMENTARY = new Set(Array.isArray(cfg.momentary) ? cfg.momentary : []);
  const ROOT = D.documentElement;
  const controls = [];        // { el, action, kind, label, knob, down, on, x, y, rect, sent }
  const pointers = new Map(); // pointerId → { c, rect }
  let raf = 0;
  let emp = null;             // { timer, saved: [[el, translate, transition]] }
  let lastReport = "";

  const send = (m) => { m.ch = cfg.ch; try { P.postMessage(m, "*"); } catch (e) {} };
  const clamp = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // ---- discovery ----
  function discover() {
    const found = [...D.querySelectorAll("[data-action],[data-stick]")].filter((el) => !el.parentElement || !el.parentElement.closest("[data-action],[data-stick]"));
    const keep = [];
    for (const el of found) {
      const stick = el.hasAttribute("data-stick");
      const action = String(stick ? el.getAttribute("data-stick") : el.getAttribute("data-action")).trim().toLowerCase();
      const kind = stick ? "stick" : el.hasAttribute("data-toggle") ? "toggle" : "button";
      const label = String(el.getAttribute("data-label") || el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 24);
      let c = controls.find((o) => o.el === el);
      if (c && c.down && (c.action !== action || c.kind !== kind)) releaseControl(c, true); // rewired while held
      if (!c) c = { el, down: 0, on: false, x: 0, y: 0, sent: null };
      Object.assign(c, { action, kind, label, knob: stick ? el.querySelector("[data-knob]") : null });
      keep.push(c);
    }
    for (const c of controls) if (!keep.includes(c)) releaseControl(c, true);
    controls.length = 0;
    controls.push(...keep);
    clearCovers();
    settle(report);
  }

  // Report rectangles only once finite animations (a pop-in, a bounce) are done, at most 1.2 s later: a control
  // caught mid-animation would report a scaled-down box.
  const own = new WeakSet(); // the kit's own glitch animations: never waited for
  function settle(fn) {
    let running = [];
    try {
      running = D.getAnimations().filter((a) => {
        const t = a.effect && a.effect.getComputedTiming();
        return a.playState === "running" && !own.has(a) && t && Number.isFinite(t.endTime);
      });
    } catch (e) {}
    if (!running.length) return fn();
    Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1200))]).then(fn);
  }

  // A controller must never hide the game: anything but a control that covers over a third of the frame with a fill
  // (colour alpha over 0.15, or a background image) is made transparent.
  let cleared = 0;
  function clearCovers() {
    const W = innerWidth || 1, H = innerHeight || 1;
    const all = D.body ? D.body.getElementsByTagName("*") : [];
    for (let i = 0; i < all.length && i < 400; i++) {
      const el = all[i];
      if (el.closest("[data-action],[data-stick]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < W * H * 0.35) continue;
      const cs = getComputedStyle(el);
      const m = /rgba?\(([^)]*)\)/.exec(cs.backgroundColor);
      const parts = m ? m[1].split(/[\s,/]+/).filter(Boolean) : [];
      const alpha = !m ? 0 : parts.length > 3 ? parseFloat(parts[3]) : 1;
      if (alpha > 0.15 || (cs.backgroundImage && cs.backgroundImage !== "none")) {
        el.style.setProperty("background", "transparent", "important");
        cleared++;
      }
    }
  }

  function report() {
    const W = innerWidth || 1, H = innerHeight || 1;
    const list = [];
    for (const c of controls) {
      const r = c.el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // hidden controls cannot be pressed: not reported
      list.push({ action: c.action, kind: c.kind, label: c.label, x: r3(r.left / W), y: r3(r.top / H), w: r3(r.width / W), h: r3(r.height / H) });
    }
    const key = JSON.stringify(list) + cleared;
    if (key === lastReport) return;
    lastReport = key;
    send({ type: "ready", kit: cfg.version, controls: list, cleared });
  }

  // ---- hit testing: rendered boxes grown to at least MIN px, smallest containing box wins ----
  function hitRect(c) {
    const r = c.el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const w = Math.max(r.width, cfg.minHit) + cfg.slop * 2, h = Math.max(r.height, cfg.minHit) + cfg.slop * 2;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2, cx, cy, box: r };
  }
  function hit(x, y) {
    let best = null, bestInside = false, bestScore = Infinity;
    for (const c of controls) {
      const h = hitRect(c);
      if (!h || x < h.l || x > h.r || y < h.t || y > h.b) continue;
      const inside = x >= h.box.left && x <= h.box.right && y >= h.box.top && y <= h.box.bottom;
      // Inside a drawn box beats the grown margin; then the smaller box, then the nearer centre.
      const score = inside ? h.box.width * h.box.height : Math.hypot((x - h.cx) / (h.r - h.l), (y - h.cy) / (h.b - h.t));
      if ((inside && !bestInside) || (inside === bestInside && score < bestScore)) { best = { c, h }; bestInside = inside; bestScore = score; }
    }
    return best;
  }

  // ---- bridge ----
  const held = new Map(); // action → holders (two buttons with one action stay down until both lift)
  function press(action) {
    action = String(action);
    const n = (held.get(action) || 0) + 1;
    held.set(action, n);
    if (n === 1) send({ type: "press", action });
  }
  function release(action) {
    action = String(action);
    const n = held.get(action) || 0;
    if (!n) return;
    if (n === 1) { held.delete(action); send({ type: "release", action }); } else held.set(action, n - 1);
  }
  function axis(name, x, y) {
    send({ type: "axis", axis: String(name), x: r3(clamp(+x || 0)), y: r3(clamp(+y || 0)) });
  }

  // ---- controls ----
  function setDown(c, on) { c.el.classList.toggle("is-down", on); }
  function moveStick(c, h, px, py) {
    const knob = c.knob ? c.knob.getBoundingClientRect() : null;
    const rad = Math.max(16, Math.min(h.box.width, h.box.height) / 2 - (knob ? Math.min(knob.width, knob.height) * 0.3 : 10));
    let dx = (px - h.cx) / rad, dy = (py - h.cy) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    c.x = r3(dx); c.y = r3(-dy);
    if (c.knob) c.knob.style.setProperty("translate", `${(dx * rad).toFixed(1)}px ${(dy * rad).toFixed(1)}px`, "important");
    c.el.style.setProperty("--x", c.x);
    c.el.style.setProperty("--y", c.y);
    if (!raf) raf = requestAnimationFrame(flushAxes); // at most one axis message per frame per stick
  }
  function flushAxes() {
    raf = 0;
    for (const c of controls) {
      if (c.kind !== "stick" || !c.down) continue;
      if (c.sent && c.sent[0] === c.x && c.sent[1] === c.y) continue;
      c.sent = [c.x, c.y];
      axis(c.action, c.x, c.y);
    }
  }
  function centreStick(c) {
    c.x = 0; c.y = 0;
    if (c.knob) c.knob.style.removeProperty("translate");
    c.el.style.setProperty("--x", 0);
    c.el.style.setProperty("--y", 0);
    if (c.sent && (c.sent[0] || c.sent[1])) axis(c.action, 0, 0);
    c.sent = null;
  }
  function releaseControl(c, all) {
    if (!c.down) return;
    c.down = all ? 0 : c.down - 1;
    if (c.down) return;
    setDown(c, false);
    if (c.kind === "stick") centreStick(c);
    else release(c.action);
  }
  function releaseAll() {
    pointers.clear();
    for (const c of controls) {
      releaseControl(c, true);
      // a switch that was on is off now (its release goes out below): the next tap turns it on again instead of being lost
      if (c.kind === "toggle" && c.on) { c.on = false; c.el.classList.remove("is-on"); }
    }
    for (const a of [...held.keys()]) { held.set(a, 1); release(a); }
  }

  // ---- pointer events (window, capture phase: they run before anything the controller adds) ----
  addEventListener("pointerdown", (e) => {
    const found = hit(e.clientX, e.clientY);
    if (!found) return;
    e.preventDefault();
    const { c, h } = found;
    if (c.kind === "toggle") {
      if (MOMENTARY.has(c.action)) { // a switch for a one-shot skill: one use per tap, never latched
        press(c.action);
        setDown(c, true);
        setTimeout(() => { release(c.action); setDown(c, false); }, 120);
        return;
      }
      c.on = !c.on;
      c.el.classList.toggle("is-on", c.on);
      if (c.on) press(c.action); else release(c.action);
      setDown(c, true);
      setTimeout(() => setDown(c, false), 140);
      return;
    }
    try { ROOT.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { c, h });
    c.down++;
    if (c.kind === "stick") {
      if (c.down === 1) setDown(c, true);
      c.sent = c.sent || [0, 0];
      moveStick(c, h, e.clientX, e.clientY);
    } else if (c.down === 1) {
      setDown(c, true);
      press(c.action);
    }
  }, { capture: true, passive: false });

  addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.c.kind === "stick") return moveStick(p.c, p.h, e.clientX, e.clientY);
    const { h } = p; // sliding off a button releases it
    if (e.clientX < h.l - cfg.keep || e.clientX > h.r + cfg.keep || e.clientY < h.t - cfg.keep || e.clientY > h.b + cfg.keep) {
      pointers.delete(e.pointerId);
      releaseControl(p.c, false);
    }
  }, { capture: true, passive: false });

  const lift = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    releaseControl(p.c, false);
  };
  addEventListener("pointerup", lift, true);
  addEventListener("pointercancel", lift, true);
  // iOS: no scrolling, zoom, magnifier or callout; the pointer events above still fire.
  for (const type of ["touchstart", "touchmove", "gesturestart", "gesturechange", "contextmenu", "dblclick", "selectstart", "dragstart"]) {
    addEventListener(type, (e) => { if (e.cancelable) e.preventDefault(); }, { capture: true, passive: false });
  }
  D.addEventListener("visibilitychange", () => { if (D.hidden) releaseAll(); });
  addEventListener("pagehide", releaseAll);

  // ---- EMP: release everything, swap the controls' places, glitch; restore after `seconds` ----
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // The glitch runs through element.animate(), on top of whatever the controller animates itself, so ending it never
  // restarts the controller's own animations (a pop-in would replay).
  const GLITCH = [{ filter: "none" }, { filter: "hue-rotate(150deg) saturate(3) brightness(1.6)", opacity: 0.55 }, { filter: "invert(.25) hue-rotate(-80deg)", opacity: 1 },
    { filter: "hue-rotate(70deg) contrast(2.2)", opacity: 0.7 }, { filter: "none", opacity: 1 }];
  const FLICKER = [{ opacity: 1, filter: "none" }, { opacity: 0.78, filter: "hue-rotate(40deg) saturate(1.8)" }, { opacity: 0.92, filter: "none" }, { opacity: 1, filter: "none" }];
  function glitch(el) {
    try {
      const list = [el.animate(GLITCH, { duration: 450, iterations: 2, easing: "steps(2, jump-none)" }),
        el.animate(FLICKER, { duration: 900, delay: 900, iterations: Infinity, easing: "steps(3, jump-none)" })];
      list.forEach((a) => own.add(a));
      return list;
    } catch (e) { return []; }
  }

  function empStart(seconds, seed) {
    empStop(false);
    releaseAll();
    const live = controls.map((c) => ({ c, r: c.el.getBoundingClientRect() })).filter((o) => o.r.width >= 1 && o.r.height >= 1);
    const rand = rng(seed);
    const buttons = live.filter((o) => o.c.kind !== "stick"), sticks = live.filter((o) => o.c.kind === "stick");
    const target = new Map(); // item → the item whose place it takes
    const cycle = (list) => { // Sattolo: a random single cycle, so nobody keeps its place
      const idx = list.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * i); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      list.forEach((o, i) => target.set(o, list[idx[i]]));
    };
    if (buttons.length >= 2) cycle(buttons);
    if (sticks.length === 2) cycle(sticks);
    if (buttons.length === 1 && sticks.length === 1) cycle([buttons[0], sticks[0]]);
    const map = {};
    const saved = [];
    for (const o of live) {
      const t = target.get(o);
      const ax = o.r.left + o.r.width / 2, ay = o.r.top + o.r.height / 2;
      const bx = t ? t.r.left + t.r.width / 2 : innerWidth - ax, by = t ? t.r.top + t.r.height / 2 : ay; // a lone one mirrors
      saved.push([o.c.el, o.c.el.style.getPropertyValue("translate"), o.c.el.style.getPropertyValue("transition"), glitch(o.c.el)]);
      o.c.el.style.setProperty("transition", "translate .24s steps(4,jump-end)", "important");
      o.c.el.style.setProperty("translate", `${(bx - ax).toFixed(1)}px ${(by - ay).toFixed(1)}px`, "important");
      if (t) map[t.c.action] = o.c.action; // what you now get by pressing where t used to be
    }
    ROOT.classList.add("is-emp");
    emp = { saved, map, timer: setTimeout(() => empStop(true), Math.max(0.2, Math.min(30, seconds)) * 1000) };
    setTimeout(() => settle(report), 300); // after the swap transition
    return map;
  }
  function empStop(notify) {
    if (!emp) return;
    clearTimeout(emp.timer);
    releaseAll();
    for (const [el, translate, transition, anims] of emp.saved) {
      if (translate) el.style.setProperty("translate", translate); else el.style.removeProperty("translate");
      if (transition) el.style.setProperty("transition", transition); else el.style.removeProperty("transition");
      for (const a of anims) try { a.cancel(); } catch (e) {}
    }
    ROOT.classList.remove("is-emp");
    const map = emp.map;
    emp = null;
    setTimeout(() => settle(report), 300);
    if (notify) send({ type: "fxdone", kind: "emp", map });
  }

  // ---- messages from the page ----
  addEventListener("message", (e) => {
    if (e.source !== P) return;
    const m = e.data;
    if (!m || m.ch !== cfg.ch) return;
    if (m.type === "reset") releaseAll();
    else if (m.type === "disabled") {
      const off = new Set(Array.isArray(m.actions) ? m.actions.map(String) : []);
      for (const c of controls) c.el.classList.toggle("is-disabled", off.has(c.action));
    } else if (m.type === "fx" && m.kind === "emp") {
      const map = empStart(+m.seconds || 5, (m.seed >>> 0) || ((Math.random() * 4294967296) >>> 0));
      send({ type: "fxstart", kind: "emp", map });
    }
  });

  Object.defineProperty(window, "game", { value: Object.freeze({ press, release, axis }), enumerable: true });

  // ---- start: discover once the markup is parsed and laid out, then follow changes ----
  let pending = 0;
  const later = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; discover(); }); };
  const start = () => {
    discover();
    // Structure only: the kit's own class flips and cosmetic style animations must not re-run discovery every frame.
    new MutationObserver(later).observe(D.body || ROOT, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-action", "data-stick", "data-toggle", "data-label", "hidden"] });
  };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", () => requestAnimationFrame(start)); else requestAnimationFrame(start);
  addEventListener("load", later);
  addEventListener("resize", later);
  addEventListener("animationend", later, true);
}

// ---- Page side ---------------------------------------------------------------------------------------------------------

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// The frame's document: our CSP, viewport and kit first, then the controller's markup (its own doctype dropped,
// so ours keeps the document in standards mode; extra <html>/<head> tags in it are merged by the parser).
// The frame's colour scheme is pinned to the page's: a frame whose scheme differs from its embedder's gets an opaque
// backdrop in Chromium, which would hide the game (Sol likes to write color-scheme: dark).
export function buildSrcdoc(html, cfg = {}) {
  const body = String(html == null ? "" : html).replace(/^\uFEFF/, "").replace(/^\s*<!doctype[^>]*>/i, "");
  const scheme = /^(normal|light|dark|light dark|dark light|only light|only dark)$/.test(cfg.scheme || "") ? cfg.scheme : "normal";
  const config = JSON.stringify({ version: KIT_VERSION, minHit: MIN_HIT_PX, slop: SLOP_PX, keep: KEEP_PX, ...cfg }).replace(/</g, "\\u003c");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${escapeAttr(CSP)}">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">` +
    `<style>${KIT_CSS}html:root:not(#kit-a):not(#kit-b){color-scheme:${scheme}!important}</style>` +
    `<script>(${kit.toString()})(${config});</script>\n${body}`;
}

const nonce = () => {
  const a = new Uint32Array(4);
  (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = (Math.random() * 4294967296) >>> 0));
  return [...a].map((v) => v.toString(36)).join("");
};

// Sliding one-second window: at most `rate` events per key in any 1000 ms.
function limiter(rate) {
  const rings = new Map();
  return {
    take(key, now) {
      let r = rings.get(key);
      if (!r) rings.set(key, (r = { t: new Float64Array(rate), i: 0 }));
      if (r.t[r.i] && now - r.t[r.i] < 1000) return false;
      r.t[r.i] = now;
      r.i = (r.i + 1) % rate;
      return true;
    },
    wait(key, now) { // ms until the next slot opens
      const r = rings.get(key);
      return r && r.t[r.i] ? Math.max(0, 1000 - (now - r.t[r.i])) : 0;
    },
  };
}

// Page-wide and permanent (a CSP cannot be lifted once applied), so it only touches frame-src.
function lockFrameNavigation() {
  if (document.querySelector("meta[data-ctrl-sandbox-csp]")) return;
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = "frame-src 'none'";
  meta.setAttribute("data-ctrl-sandbox-csp", "");
  document.head.appendChild(meta);
}

export function mountController(container, html, opts = {}) {
  if (!container || !container.appendChild) throw new Error("mountController: container element required");
  if (opts.pageCsp !== false) lockFrameNavigation();
  const allowed = new Set((opts.allowedActions || []).map((a) => String(a).toLowerCase()));
  const rate = Math.max(1, Math.min(240, opts.rate | 0 || 60));
  const readyTimeoutMs = opts.readyTimeoutMs == null ? 2500 : opts.readyTimeoutMs;
  const required = (opts.requiredActions || []).map((a) => String(a).toLowerCase()).filter((a) => allowed.has(a));
  const momentary = (opts.momentaryActions || []).map((a) => String(a).toLowerCase()).filter((a) => allowed.has(a) && !STICKS.includes(a)).slice(0, 64);
  const call = (fn, ...args) => { if (typeof fn === "function") try { fn(...args); } catch (err) { console.error(err); } };
  const now = () => performance.now();

  if (getComputedStyle(container).position === "static") container.style.position = "relative";

  const stats = { accepted: 0, dropped: { origin: 0, type: 0, action: 0, rate: 0, shape: 0 }, violations: [] };
  const down = new Set();                  // actions the page has seen pressed and not released
  const axes = new Map();                  // axis → [x, y] last delivered
  const pendingAxis = new Map();           // axis → { x, y, timer } waiting for a slot
  let limit = limiter(rate);
  // One record per frame: the live one (cur) and, during replace(), the one loading hidden (next).
  let cur = null, next = null;
  let readyTimer = 0, destroyed = false, usingFallback = false, empUntil = 0;
  let controls = [];
  let floodWindow = { start: 0, drops: 0, strikes: 0 };
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const fxWaiters = new Map();             // kind → [resolve]

  function violation(kind, detail) {
    const v = { kind, detail: String(detail == null ? "" : detail).slice(0, 120), at: Date.now() };
    if (stats.violations.length < 50) stats.violations.push(v);
    call(opts.onViolation, v);
    if (opts.debug) console.warn("ctrl-sandbox:", kind, v.detail);
  }

  function deliverAxis(axis, x, y) {
    const last = axes.get(axis);
    if (last && last[0] === x && last[1] === y) return;
    if (x === 0 && y === 0) axes.delete(axis); else axes.set(axis, [x, y]);
    stats.accepted++;
    call(opts.onAxis, axis, x, y);
  }

  function releaseAll() {
    for (const a of [...down]) { down.delete(a); call(opts.onRelease, a); }
    for (const [axis, p] of pendingAxis) { clearTimeout(p.timer); pendingAxis.delete(axis); }
    for (const axis of [...axes.keys()]) deliverAxis(axis, 0, 0);
    post({ type: "reset" });
  }

  function post(m, rec = cur) {
    if (!rec || !rec.el.contentWindow) return;
    try { rec.el.contentWindow.postMessage({ ...m, ch: rec.ch }, "*"); } catch {}
  }

  function noteFlood() {
    const t = now();
    if (t - floodWindow.start > 1000) {
      floodWindow.strikes = floodWindow.drops > rate * 5 ? floodWindow.strikes + 1 : 0;
      floodWindow = { start: t, drops: 0, strikes: floodWindow.strikes };
      if (floodWindow.strikes >= 3) { violation("flood", "sustained message flood"); fallback("flood"); }
    }
    floodWindow.drops++;
  }

  // The controls a frame reports, kept only when allowed (a stick only as a stick).
  function cleanControls(list) {
    const clean = [];
    for (const c of Array.isArray(list) ? list.slice(0, 64) : []) {
      if (!c || typeof c.action !== "string") continue;
      const action = c.action.toLowerCase();
      const kind = ["button", "stick", "toggle"].includes(c.kind) ? c.kind : "button";
      if (!allowed.has(action) || (kind === "stick") !== STICKS.includes(action)) { violation("action", `control ${action.slice(0, MAX_ACTION_CHARS)}`); continue; }
      const n = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);
      clean.push({ action, kind, label: String(c.label || "").slice(0, 24), x: n(c.x), y: n(c.y), w: n(c.w), h: n(c.h) });
    }
    return clean;
  }
  const missingOf = (clean) => required.filter((a) => !clean.some((c) => c.action === a));

  function onMessage(e) {
    if (destroyed) return;
    if (next && e.source === next.el.contentWindow) return onNextMessage(e);
    if (!cur || e.source !== cur.el.contentWindow) return;
    if (e.origin !== "null") { stats.dropped.origin++; violation("navigate", `message from ${e.origin}`); return fallback("navigate"); }
    const m = e.data;
    if (!m || typeof m !== "object" || m.ch !== cur.ch || typeof m.type !== "string") { stats.dropped.type++; noteFlood(); return; }
    if (m.type === "press" || m.type === "release") {
      const action = typeof m.action === "string" && m.action.length <= MAX_ACTION_CHARS ? m.action.toLowerCase() : "";
      if (!allowed.has(action) || STICKS.includes(action)) { stats.dropped.action++; noteFlood(); return violation("action", action || typeof m.action); }
      if (m.type === "release") { // always delivered (a held action must never stick), but only once per press
        if (!down.has(action)) return;
        down.delete(action);
        stats.accepted++;
        return call(opts.onRelease, action);
      }
      if (down.has(action)) return;
      if (!limit.take("p:" + action, now())) { stats.dropped.rate++; return noteFlood(); }
      down.add(action);
      stats.accepted++;
      return call(opts.onPress, action);
    }
    if (m.type === "axis") {
      const axis = typeof m.axis === "string" ? m.axis.toLowerCase() : "";
      if (!STICKS.includes(axis) || !allowed.has(axis)) { stats.dropped.action++; noteFlood(); return violation("action", axis || typeof m.axis); }
      if (typeof m.x !== "number" || typeof m.y !== "number" || !Number.isFinite(m.x) || !Number.isFinite(m.y)) { stats.dropped.shape++; return noteFlood(); }
      const x = Math.round(Math.max(-1, Math.min(1, m.x)) * 1000) / 1000, y = Math.round(Math.max(-1, Math.min(1, m.y)) * 1000) / 1000;
      const key = "a:" + axis, t = now();
      const pending = pendingAxis.get(axis);
      if (!pending && limit.take(key, t)) return deliverAxis(axis, x, y);
      // Over budget: keep only the newest value and deliver it when a slot opens (a stick always returns to 0).
      stats.dropped.rate++;
      noteFlood();
      if (pending) { pending.x = x; pending.y = y; return; }
      const p = { x, y, timer: 0 };
      const flush = () => {
        if (destroyed) return;
        if (!limit.take(key, now())) { p.timer = setTimeout(flush, limit.wait(key, now()) + 1); return; }
        pendingAxis.delete(axis);
        deliverAxis(axis, p.x, p.y);
      };
      p.timer = setTimeout(flush, limit.wait(key, t) + 1);
      pendingAxis.set(axis, p);
      return;
    }
    if (m.type === "ready") {
      const clean = cleanControls(m.controls);
      controls = clean;
      if (typeof m.cleared === "number") stats.clearedCovers = m.cleared;
      if (cur.reported) return;
      const missing = missingOf(clean);
      if (missing.length && opts.fallbackHtml && !usingFallback) { violation("missing", missing.join(",")); return fallback("missing"); }
      cur.reported = true;
      clearTimeout(readyTimer);
      call(opts.onReady, { controls: clean.map((c) => ({ ...c })) });
      return resolveReady(clean.map((c) => ({ ...c })));
    }
    if (m.type === "fxstart" || m.type === "fxdone") {
      if (m.type === "fxdone") { const list = fxWaiters.get(m.kind) || []; fxWaiters.delete(m.kind); list.forEach((r) => r({ map: m.map && typeof m.map === "object" ? { ...m.map } : {} })); }
      return;
    }
    stats.dropped.type++;
    noteFlood();
  }

  function frameEl(markup, rec) {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.setAttribute("referrerpolicy", "no-referrer");
    f.setAttribute("scrolling", "no");
    f.setAttribute("allowtransparency", "true");
    f.setAttribute("title", "Controller");
    f.setAttribute("data-ctrl-sandbox", "");
    const scheme = getComputedStyle(container).colorScheme || "normal";
    f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;margin:0;padding:0;display:block;background:transparent;touch-action:none;" +
      `color-scheme:${scheme};transition:opacity .18s ease-out;`;
    // The first load is our srcdoc. Any later one means the document navigated (or reloaded) itself.
    rec.onload = () => {
      rec.loads++;
      if (rec.loads < 2) return;
      if (rec === cur) { violation("navigate", "the controller document navigated"); fallback("navigate"); }
      else if (rec === next) dropNext("navigate");
    };
    f.addEventListener("load", rec.onload);
    f.srcdoc = buildSrcdoc(markup, { ch: rec.ch, scheme, momentary });
    f.ctrlSandbox = handle;
    rec.el = f;
    return rec;
  }

  function mountCurrent(markup) {
    limit = limiter(rate);
    cur = frameEl(markup, { ch: nonce(), loads: 0, reported: false });
    clearTimeout(readyTimer);
    if (readyTimeoutMs > 0) readyTimer = setTimeout(() => { if (cur && !cur.reported) { violation("timeout", `no controls after ${readyTimeoutMs} ms`); fallback("timeout"); } }, readyTimeoutMs);
    container.appendChild(cur.el);
  }

  function unmount(rec) {
    if (!rec) return;
    rec.el.removeEventListener("load", rec.onload);
    rec.el.remove();
  }

  // Swap in the fallback document. Without one (or when the fallback itself misbehaves) a frame that navigated or
  // flooded is removed (the page keeps its own controls); a slow or incomplete one stays up.
  function fallback(reason) {
    if (destroyed) return;
    const hostile = reason === "navigate" || reason === "flood";
    if (!(opts.fallbackHtml && !usingFallback) && !hostile) return;
    releaseAll();
    const old = cur;
    if (opts.fallbackHtml && !usingFallback) {
      usingFallback = true;
      mountCurrent(opts.fallbackHtml);
    } else {
      cur = null;
      clearTimeout(readyTimer);
      resolveReady([]);
    }
    unmount(old);
    stats.fallbackReason = reason;
  }

  // ---- replace(): the new document loads hidden; it goes live once it reports every required control and no
  // finger is down (and no EMP is running), so the swap never drops a held control or flashes.
  const busy = () => down.size > 0 || axes.size > 0 || pendingAxis.size > 0 || now() < empUntil;
  function dropNext(reason) {
    if (!next) return;
    const n = next;
    next = null;
    clearTimeout(n.timer);
    unmount(n);
    if (reason) violation(reason, "replacement discarded");
    n.resolve(false);
  }
  function onNextMessage(e) {
    const n = next;
    if (e.origin !== "null") return dropNext("navigate");
    const m = e.data;
    if (!m || typeof m !== "object" || m.ch !== n.ch || m.type !== "ready" || n.controls) return;
    const clean = cleanControls(m.controls);
    const missing = missingOf(clean);
    if (missing.length || !clean.length) { violation("missing", missing.join(",") || "no controls"); return dropNext(); }
    n.controls = clean;
    const swap = () => {
      if (next !== n || destroyed) return;
      if (busy() && now() < n.deadline) { n.timer = setTimeout(swap, 60); return; }
      clearTimeout(n.timer);
      releaseAll();
      const old = cur;
      next = null;
      cur = n;
      cur.reported = true;
      limit = limiter(rate);
      usingFallback = false;
      controls = clean;
      clearTimeout(readyTimer);
      cur.el.style.opacity = "1";
      cur.el.style.pointerEvents = "";
      unmount(old);
      call(opts.onReady, { controls: clean.map((c) => ({ ...c })) });
      resolveReady(clean.map((c) => ({ ...c })));
      n.resolve(true);
    };
    swap();
  }

  function onVisibility() { if (document.hidden) releaseAll(); }

  const handle = {
    get iframe() { return cur ? cur.el : null; },
    get usingFallback() { return usingFallback; },
    ready,
    controls: () => controls.map((c) => ({ ...c })),
    releaseAll,
    busy,
    setDisabled(actions) { post({ type: "disabled", actions: (actions || []).map(String) }); },
    // Replace the live controller with another document (the template now, Sol's HTML when it arrives).
    // Resolves true once it is live, false if it failed (the current one stays). waitIdleMs caps the wait for a
    // quiet moment; after it the swap happens anyway (held controls are released first).
    replace(markup, { waitIdleMs = 4000, timeoutMs = readyTimeoutMs || 2500 } = {}) {
      if (destroyed) return Promise.resolve(false);
      dropNext();
      return new Promise((resolve) => {
        const n = frameEl(markup, { ch: nonce(), loads: 0, reported: false, resolve, controls: null });
        n.deadline = now() + timeoutMs + waitIdleMs;
        n.el.style.opacity = "0";
        n.el.style.pointerEvents = "none";
        n.timer = setTimeout(() => { if (next === n && !n.controls) dropNext("timeout"); }, timeoutMs);
        next = n;
        container.appendChild(n.el);
      });
    },
    fx(kind, o = {}) {
      if (kind !== "emp" || !cur) return Promise.resolve({ map: {} });
      releaseAll();
      const seconds = Math.max(0.2, Math.min(30, Number(o.seconds) || 5));
      empUntil = now() + seconds * 1000 + 300;
      return new Promise((resolve) => {
        const list = fxWaiters.get(kind) || [];
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        list.push(finish);
        fxWaiters.set(kind, list);
        setTimeout(() => finish({ map: {} }), seconds * 1000 + 1500); // a frame that never answers cannot hang the caller
        post({ type: "fx", kind, seconds, seed: o.seed == null ? undefined : o.seed >>> 0 });
      });
    },
    stats: () => JSON.parse(JSON.stringify({ ...stats, down: [...down], axes: [...axes] })),
    destroy() {
      if (destroyed) return;
      releaseAll();
      destroyed = true;
      clearTimeout(readyTimer);
      for (const [, p] of pendingAxis) clearTimeout(p.timer);
      removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", releaseAll);
      if (next) { clearTimeout(next.timer); unmount(next); next.resolve(false); next = null; }
      unmount(cur);
      cur = null;
      if (container.ctrlSandbox === handle) delete container.ctrlSandbox;
      for (const [, list] of fxWaiters) list.forEach((r) => r({ map: {} }));
      fxWaiters.clear();
      resolveReady([]);
    },
  };

  addEventListener("message", onMessage);
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("pagehide", releaseAll);
  container.ctrlSandbox = handle;
  mountCurrent(html);
  return handle;
}
