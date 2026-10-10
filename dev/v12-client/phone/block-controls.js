// ---- hit areas, multi-touch (the DOM controls: the fallback when Sol's controller frame is not in use) ----
const controls = [];         // { b, el, knob, badge, info (locked?), presses, on }
function buildHits() {
  $("hits").replaceChildren();
  controls.length = 0;
  for (const b of S.layout.buttons) {
    const el = document.createElement("div");
    el.className = "hit " + b.type;
    el.dataset.action = C.normaliseAction(b.action);   // mischief-fx's EMP finds the controls, and which is which, through this
    Object.assign(el.style, { left: b.x * 100 + "%", top: b.y * 100 + "%", width: b.w * 100 + "%", height: b.h * 100 + "%" });
    const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = controlName(b); el.append(lab);
    const ctl = { b, el, presses: 0, on: false, info: null, badge: null };
    if (b.type === "stick") { ctl.knob = document.createElement("div"); ctl.knob.className = "knob"; el.appendChild(ctl.knob); }
    $("hits").appendChild(el);
    controls.push(ctl);
  }
  refreshLocks();
  if (S.ghost) placeGhost();
}
// A control whose skill the current ship / explorer cannot do is dimmed and wears a lock; sticks and movement are never locked.
function refreshLocks() {
  const e = S.entity || S.drawn.ship;     // before the server's first entity message, the ship I just drew
  for (const ctl of controls) {
    ctl.info = lockInfo(ctl.b.action, e);
    ctl.el.classList.toggle("locked", !!ctl.info);
    if (ctl.info && !ctl.badge) { ctl.badge = document.createElement("span"); ctl.badge.className = "lock"; ctl.badge.textContent = "🔒"; ctl.el.append(ctl.badge); }
    if (ctl.badge) ctl.badge.classList.toggle("hidden", !ctl.info);
  }
  syncDisabled();      // the sandboxed controller greys the same controls
}
const entityKey = (e) => (e ? `${e.type}|${(e.verbs || []).join(",")}` : "");
function setEntity(e) {
  if (!e || typeof e !== "object") return;
  const changed = entityKey(e) !== entityKey(S.entity);
  S.entity = e;
  if (changed) refreshLocks();
}

const inside = (b, fx, fy) => fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h;
function controlAt(fx, fy) {
  // smallest containing control wins, so a button drawn inside a big stick zone still works
  let best = null;
  for (const c of controls) if (inside(c.b, fx, fy) && (!best || c.b.w * c.b.h < best.b.w * best.b.h)) best = c;
  return best;
}
// EMP on the DOM controls: mischief-fx moves the boxes (CSS translate) and tells us { place's action: action standing there now } through
// onSwap; a touch on a place triggers what is SHOWN there. null = no EMP running.
let empMap = null;
const actualOf = (place) => { const a = empMap && empMap[place.b.action]; return (a && controls.find((c) => c.b.action === a)) || place; };
const pointers = new Map();  // pointerId -> { ctl: the control it holds, place: the control whose box it started on (the same unless an EMP swapped them) }
let hitRect = null;
function frac(e) { const r = hitRect || (hitRect = $("hits").getBoundingClientRect()); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r]; }
function press(ctl, down) {
  ctl.presses += down ? 1 : -1;
  if (down && ctl.presses === 1) { ctl.el.classList.add("down"); sendInput(ctl.b.action, true); if (ctl.b.action === "view") toggleView(); }
  if (!down && ctl.presses === 0) { ctl.el.classList.remove("down"); sendInput(ctl.b.action, false); }
}
function moveStick(ctl, e, place = ctl) {
  const [fx, fy, r] = frac(e);
  const b = place.b, w = b.w * r.width, h = b.h * r.height, rad = Math.max(10, Math.min(w, h) / 2 - 10);   // the finger is on the PLACE's box
  let dx = (fx - b.x - b.w / 2) * r.width / rad, dy = (fy - b.y - b.h / 2) * r.height / rad;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  ctl.knob.style.transform = `translate(${dx * rad}px, ${dy * rad}px)`;
  sendAxis(ctl.b.action, dx, -dy, false);    // y up = +1
}
function release(id) {
  const p = pointers.get(id);
  if (!p) return;
  const ctl = p.ctl;
  pointers.delete(id);
  onControlUp(ctl);
  if (ctl.b.type === "stick") {
    ctl.el.classList.remove("down"); ctl.knob.style.transform = "";
    sendAxis(ctl.b.action, 0, 0, true);
  } else press(ctl, false);
}
// Let go of everything: the DOM controls, and the sandboxed frame's controls (its kit sends the releases and a centred stick).
function releaseAll() {
  for (const id of [...pointers.keys()]) release(id);
  if (S.ctl && S.ctl.handle) { try { S.ctl.handle.releaseAll(); } catch {} }
  S.held = {};
  for (const a of Object.keys(holdTimers)) { clearTimeout(holdTimers[a]); delete holdTimers[a]; }
}

// ---- the tip above a control: "🔒 BOOST · draw an exhaust with fire on your ship" (locked), "EMP · READY IN 12 S" (cooling down), or what a
// held control does (its first 3 holds). Both kinds of controller use these; each passes where its control is on the screen. ----
const tipsSeen = store.get("tipsSeen") || {};   // each control explains itself the first 3 times it is held
function tipAt(r, { title = "", text, lock = false, ms = 0 }) {    // r: { left, right, top, bottom, width } in CSS px
  const el = $("tip");
  $("tipTitle").textContent = title; $("tipTitle").classList.toggle("hidden", !title);
  $("tipText").textContent = text;
  el.classList.toggle("lock", lock);
  el.classList.remove("on");
  const w = el.offsetWidth, h = el.offsetHeight;
  const x = Math.max(8 + w / 2, Math.min(window.innerWidth - 8 - w / 2, r.left + r.width / 2));
  const above = r.top - 8 - h > 4;
  el.style.left = x + "px";
  el.style.top = (above ? r.top - 8 : r.bottom + 8 + h) + "px";
  void el.offsetWidth;
  el.classList.add("on");
  clearTimeout(tipAt.t);
  if (ms) tipAt.t = setTimeout(hideTip, ms);
}
function hideTip() { clearTimeout(tipAt.t); $("tip").classList.remove("on"); }
const coolLeft = (action) => Math.max(0, ((S.cool[action] || 0) - performance.now()) / 1000);   // seconds until a skill is ready again
const verbName = (verb) => String(V && V.labelOf ? V.labelOf(verb) : verb).toUpperCase();      // "INK BOMB", not "inkbomb"
const holdTimers = {};     // action -> the timer of its "what it does" tip
function tipOnPress(action, name, rect) {      // rect: () => where the control is now
  const act = C.normaliseAction(action);
  const info = lockInfo(act, S.entity || S.drawn.ship);
  if (info) {       // locked: say why, at once; the server's own refusal toast for this skill stays quiet for a while
    S.tipAt[info.verb] = performance.now();
    return tipAt(rect(), { text: lockText(name, info, COPY.what.ship), lock: true, ms: 2800 });
  }
  const left = coolLeft(act);
  if (left > 0) return tipAt(rect(), { text: tpl(COPY.cool.tip, { name: verbName(act), n: Math.ceil(left) }), ms: 1800 });
  if ((tipsSeen[act] || 0) >= 3) return;
  clearTimeout(holdTimers[act]);
  holdTimers[act] = setTimeout(() => {      // still held after 450 ms: name it and say in one line what it does
    delete holdTimers[act];
    tipsSeen[act] = (tipsSeen[act] || 0) + 1; store.set("tipsSeen", tipsSeen);
    tipAt(rect(), { title: name, text: COPY.does[act] || (V.VERBS[act] && V.VERBS[act].hint) || "" });
  }, HOLD_TIP_MS);
}
function tipOnRelease(action) {
  const act = C.normaliseAction(action);
  clearTimeout(holdTimers[act]); delete holdTimers[act];
  if (!lockInfo(act, S.entity || S.drawn.ship) && coolLeft(act) <= 0) hideTip();   // a lock or cooldown tip stays its few seconds
}
const onControlDown = (ctl) => tipOnPress(ctl.b.action, controlName(ctl.b), () => ctl.el.getBoundingClientRect());
const onControlUp = (ctl) => tipOnRelease(ctl.b.action);

// After a new controller: its control names, for 3 seconds. The name is what the control shows (the frame's labels, or the drawn word).
function legendItems() {
  const e = S.entity || S.drawn.ship;
  if (S.ctl && S.ctl.live) return S.ctl.handle.controls().map((c) => ({ name: String(c.label || verbName(c.action)).toUpperCase(), locked: !!lockInfo(c.action, e) }));
  return controls.map((c) => ({ name: controlName(c.b), locked: !!c.info }));
}
function showLegend() {
  const el = $("legend");
  el.replaceChildren();
  for (const it of legendItems()) {
    const chip = document.createElement("span"); chip.className = "chip" + (it.locked ? " lk" : "");
    chip.textContent = (it.locked ? "🔒 " : "") + it.name;
    el.append(chip);
  }
  el.classList.add("on");
  clearTimeout(showLegend.t);
  showLegend.t = setTimeout(() => el.classList.remove("on"), LEGEND_MS);
}
// The legend waits for the sandboxed frame when one is on its way (its labels come from the frame); the DOM controls show it at once.
function maybeLegend() {
  if (!S.legendPending || S.screen !== "play") return;
  if (S.ctlPending || (S.ctl && !S.ctl.live)) return;
  S.legendPending = false;
  showLegend();
}

const hits = $("hits");
hits.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  hitRect = hits.getBoundingClientRect();
  const [fx, fy] = frac(e);
  const place = controlAt(fx, fy);
  if (!place) return;
  const ctl = actualOf(place);
  try { hits.setPointerCapture(e.pointerId); } catch {}
  if (ctl.b.type === "toggle") { ctl.on = !ctl.on; ctl.el.classList.toggle("on", ctl.on); sendInput(ctl.b.action, ctl.on); if (ctl.info) onControlDown(ctl); return; }
  pointers.set(e.pointerId, { ctl, place });
  onControlDown(ctl);
  if (ctl.b.type === "stick") { ctl.el.classList.add("down"); moveStick(ctl, e, place); }
  else press(ctl, true);
});
hits.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (p.ctl.b.type === "stick") return moveStick(p.ctl, e, p.place);
  const [fx, fy] = frac(e);
  if (!inside(p.place.b, fx, fy)) release(e.pointerId);   // sliding off a button releases it
});
hits.addEventListener("pointerup", (e) => release(e.pointerId));
hits.addEventListener("lostpointercapture", (e) => release(e.pointerId));
hits.addEventListener("pointercancel", (e) => release(e.pointerId));   // only that finger (a second one keeps its control)
window.addEventListener("blur", releaseAll);

// ============================================================================================================
// Sol's controller: the whole pad as HTML in a sandboxed frame (ctrl-sandbox.js). The frame owns the touches (multi-touch, sticks, pressed
// states) and only reports press / release / axis; this page owns the network, the locks, the cooldowns and the tips. Every controller
// answer of the server carries the pad as HTML (its template at once, Sol's own later as `generated` kind "html"); a reloaded phone, or
// one that skipped drawing, asks POST /controller-html. Without the module, or without server HTML (an old server), the DOM controls
// above (#hits) work exactly as before.
// ============================================================================================================
let MFX = null;      // mischief-fx.js, once loaded (null: the effects are replaced by plain words)
const SBP = import("./ctrl-sandbox.js").catch((e) => (console.warn("ctrl-sandbox.js unavailable, using the plain controls", e), null));
import("./mischief-fx.js").then((m) => { MFX = m; }).catch((e) => console.warn("mischief-fx.js unavailable, no screen effects", e));

// The server's pad answer in one shape: { html, controls, source: "template"|"model", padLayout } or null.
const padOf = (m) => (m && typeof m.html === "string" && m.html.length > 20 ? { html: m.html, controls: Array.isArray(m.controls) ? m.controls : [], source: m.htmlSource || "template", padLayout: m.padLayout || m.layout || null } : null);
const padActions = (pad) => [...new Set([...((pad.padLayout && pad.padLayout.buttons) || []), ...(pad.controls || [])].map((b) => C.normaliseAction(b.action)).filter(Boolean))];
// The server's pad is the truth: its layout drives the lock list, the legend and where hints go; its HTML is what the frame shows.
// mount: false = the caller mounts it next (ensureCtl).
function adoptPad(pad, { mount = true } = {}) {
  if (!pad) return;
  S.pad = pad; S.padFailed = false;
  const lay = pad.padLayout;
  if (lay && Array.isArray(lay.buttons) && lay.buttons.length && !C.CHECKS.layout(lay).length) applyLayout(lay, S.inkBase, S.inkButtons);
  if (mount && S.screen === "play") ensureCtl();
}
async function fetchPad() {
  try { const r = await post("/controller-html", { player: S.player }); return r && r.ok ? padOf(r) : null; } catch { return null; }
}

let ctlRun = 0;      // the newest ensureCtl run wins
// Make the play screen show the right controller: the sandboxed pad when the module and the server HTML are there, else the DOM controls.
async function ensureCtl() {
  if (S.screen !== "play") return;
  const run = ++ctlRun;
  S.ctlPending = true;
  try {
    const mod = await SBP;
    if (run !== ctlRun || S.screen !== "play") return;
    if (!mod) return dropCtl();
    if (!S.pad && !S.padFailed) {
      const pad = await fetchPad();
      if (run !== ctlRun) return;
      if (pad) adoptPad(pad, { mount: false }); else S.padFailed = true;
    }
    if (!S.pad || S.pad.bad) return dropCtl();
    mountPad(mod);
  } finally {
    if (run === ctlRun) { S.ctlPending = false; maybeLegend(); }
  }
}
function mountPad(mod) {
  const pad = S.pad, actions = padActions(pad), sig = actions.join(",");
  const cur = S.ctl;
  if (cur && cur.sig === sig) {      // the same controls: swap the document in place (it loads hidden and goes live when no finger is down)
    if (cur.html === pad.html) return;
    cur.handle.replace(pad.html).then((ok) => {
      if (S.ctl !== cur) return;
      if (ok) { cur.html = pad.html; cur.source = pad.source; }
      else if (S.pad === pad) { pad.html = cur.html; pad.source = cur.source; }   // the new document was refused: the one that works stays
    });
    return;
  }
  if (cur) destroyCtl();
  if (!actions.length) return dropCtl();
  const rec = { handle: null, sig, html: pad.html, source: pad.source, actions, live: false };
  try {
    rec.handle = mod.mountController($("ctl"), pad.html, {
      allowedActions: actions, requiredActions: actions, fallbackHtml: pad.html,
      readyTimeoutMs: 6000,      // the page is busy starting WebGL in the same moment: the kit's 2.5 s default is too tight on a phone
      onPress: (a) => sbPress(rec, a), onRelease: (a) => sbRelease(rec, a), onAxis: (axis, x, y) => sbAxis(rec, axis, x, y),
      onReady: () => sbReady(rec),
      onViolation: (v) => console.warn("controller frame:", v.kind, v.detail),
    });
  } catch (e) { console.warn("controller frame failed:", e); pad.bad = true; return dropCtl(); }
  S.ctl = rec;
  $("area").classList.add("sb");     // the DOM controls hide and the drawing turns faint
  rec.handle.ready.then((list) => {
    if (S.ctl !== rec || list.length) return;
    console.warn("controller frame reported no controls: using the plain ones");
    pad.bad = true; dropCtl();
  });
}
function destroyCtl() {
  const rec = S.ctl;
  S.ctl = null; S.held = {};
  if (rec && rec.handle) { try { rec.handle.destroy(); } catch {} }
  $("area").classList.remove("sb");
}
function dropCtl() { destroyCtl(); syncDisabled(); maybeLegend(); }   // back to the DOM controls (they are built from S.layout already)
function sbReady(rec) {
  if (S.ctl !== rec) return;
  const have = new Set(rec.handle.controls().map((c) => c.action));
  const missing = rec.actions.filter((a) => !have.has(a));
  if (missing.length) { console.warn("controller frame lacks", missing.join(", "), ": using the plain controls"); if (S.pad) S.pad.bad = true; return dropCtl(); }
  rec.live = true;
  syncDisabled();
  hideTip();
  maybeLegend();
}
const sbLabel = (act) => { const c = S.ctl && S.ctl.handle.controls().find((o) => o.action === act); return String((c && c.label) || verbName(act)).toUpperCase(); };
// Where a control of the frame is on the screen (its fractions of the frame times the frame's box).
function sbRect(act) {
  const fr = $("ctl").getBoundingClientRect();
  const c = S.ctl && S.ctl.handle.controls().find((o) => o.action === act);
  if (!c) return { left: fr.left + fr.width / 2, right: fr.left + fr.width / 2, top: fr.top + fr.height / 2, bottom: fr.top + fr.height / 2, width: 0 };
  const l = fr.left + c.x * fr.width, t = fr.top + c.y * fr.height, w = c.w * fr.width, h = c.h * fr.height;
  return { left: l, top: t, width: w, right: l + w, bottom: t + h };
}
function sbPress(rec, action) {
  if (S.ctl !== rec) return;
  const act = C.normaliseAction(action);
  sendInput(act, true);          // the server stays the authority: it refuses a locked skill and ignores one that is cooling down
  if (act === "view") toggleView();
  tipOnPress(act, sbLabel(act), () => sbRect(act));
}
function sbRelease(rec, action) {
  if (S.ctl !== rec) return;
  const act = C.normaliseAction(action);
  sendInput(act, false);
  tipOnRelease(act);
}
function sbAxis(rec, axis, x, y) {
  if (S.ctl !== rec) return;
  S.held[axis] = !!(x || y);
  sendAxis(axis, x, y, !x && !y);
}

// ---- greyed controls: skills the ship cannot do (locked) and skills that were just used (cooling down, with a number on them) ----
function syncDisabled() {
  const ent = S.entity || S.drawn.ship;
  if (S.ctl && S.ctl.handle) {
    const off = S.ctl.actions.filter((a) => lockInfo(a, ent) || coolLeft(a) > 0);
    try { S.ctl.handle.setDisabled(off); } catch {}
  }
  for (const c of controls) c.el.classList.toggle("cool", coolLeft(C.normaliseAction(c.b.action)) > 0);
  paintCooldowns();
}
const cdChips = new Map();   // action -> the little number over its control
function paintCooldowns() {
  const now = performance.now(), root = $("cd");
  const live = Object.keys(S.cool).filter((a) => S.cool[a] > now);
  for (const [a, el] of cdChips) if (!live.includes(a)) { el.remove(); cdChips.delete(a); }
  if (!live.length) return;
  const rects = {};      // action -> { x, y, w, h } as fractions of the play area (both kinds of controller fill it)
  if (S.ctl && S.ctl.live) for (const c of S.ctl.handle.controls()) rects[c.action] = c;
  else for (const b of S.layout ? S.layout.buttons : []) rects[C.normaliseAction(b.action)] = b;
  for (const a of live) {
    const r = rects[a];
    let el = cdChips.get(a);
    if (!r) { if (el) { el.remove(); cdChips.delete(a); } continue; }
    if (!el) { el = document.createElement("div"); el.className = "cdchip"; root.append(el); cdChips.set(a, el); }
    el.style.left = (r.x + r.w / 2) * 100 + "%"; el.style.top = (r.y + r.h / 2) * 100 + "%";
    const n = String(Math.ceil((S.cool[a] - now) / 1000));
    if (el.textContent !== n) el.textContent = n;
  }
}
let coolTimer = 0;
function coolTick() {
  const now = performance.now();
  let any = false, ended = false;
  for (const a of Object.keys(S.cool)) { if (S.cool[a] <= now) { delete S.cool[a]; ended = true; } else any = true; }
  if (ended) syncDisabled(); else paintCooldowns();
  if (!any && coolTimer) { clearInterval(coolTimer); coolTimer = 0; }
}
// { type: "cooldown", player, verb, seconds }: that skill fired and is ready again in `seconds`.
function onCooldown(m) {
  if (!m || (m.player && m.player !== S.player) || !m.verb) return;
  const sec = Number(m.seconds);
  if (!(sec > 0)) return;
  S.cool[C.normaliseAction(m.verb)] = performance.now() + Math.min(sec, 120) * 1000;
  syncDisabled();
  if (!coolTimer) coolTimer = setInterval(coolTick, 250);
}
function clearCooldowns() { S.cool = {}; coolTick(); syncDisabled(); }

// A newer pad from the server: a finished controller / button drawing (kind "controller" | "button", also what I just committed), or Sol's own
// HTML for the same pad (kind "html", it swaps in without a flash). Only my own messages carry it.
function onGenerated(m) {
  if (!m || m.player !== S.player) return;
  const pad = padOf(m);
  if (!pad || (S.pad && S.pad.html === pad.html)) return;
  adoptPad(pad);
}
