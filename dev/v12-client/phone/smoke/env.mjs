// Node-only harness for the v1.2 phone page (no browser, no server): a tiny fake DOM (dom.mjs, from the v1.1 smoke tests), a fake
// server behind fetch, and FAKE render.js / ctrl-sandbox.js / mischief-fx.js / bigscreen-extras.js modules written next to the page module so that
// its imports resolve to them. phone-extras.js is the real file.
//   const t = await boot({ sandbox: true, fx: true, padApi: "ok" });   t.$, t.S (window.__sp), t.T (window.__spTest), t.state (server), t.R (render), t.SB, t.MFX
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { Document, parseInto, Element } from "./dom.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../../../..");
const require = createRequire(import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let booted = 0;

export const PAD_HTML = '<!doctype html><html><body><div data-stick="steer" data-label="STEER"><div data-knob></div></div><div data-action="shoot" data-label="FIRE">FIRE</div><div data-action="boost" data-label="BOOST">BOOST</div></body></html>';
export const DEFAULT_PAD = { buttons: [
  { type: "stick", action: "steer", label: "STEER", x: 0.04, y: 0.4, w: 0.3, h: 0.55 },
  { type: "button", action: "boost", label: "BOOST", x: 0.56, y: 0.62, w: 0.17, h: 0.32 },
  { type: "button", action: "shoot", label: "SHOOT", x: 0.76, y: 0.5, w: 0.21, h: 0.44 },
] };

export async function boot({ width = 844, height = 390, stored = {}, sandbox = true, fx = true, padApi = "ok", rename = false, joinError = null, sessionOnly = false } = {}) {
  const html = fs.readFileSync(path.join(ROOT, "controller.html"), "utf8");
  const OUT = `/tmp/phone-v12-smoke/run-${process.pid}-${++booted}`;
  fs.mkdirSync(OUT, { recursive: true });
  const bodyHtml = html.slice(html.indexOf("<body"), html.indexOf('<script type="importmap">')).replace(/^<body[^>]*>/, "");
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  fs.writeFileSync(`${OUT}/page.mjs`, script);
  fs.copyFileSync(path.join(ROOT, "phone-extras.js"), `${OUT}/phone-extras.js`);

  const doc = new Document();
  parseInto(doc, bodyHtml);
  const G = globalThis;
  const winL = {};
  Object.assign(G, {
    document: doc, window: G, innerWidth: width, innerHeight: height, devicePixelRatio: 3, isSecureContext: true,
    location: { search: "", host: "localhost" }, screen: { orientation: { angle: 90 } }, __rects: {},
    addEventListener: (t, cb) => (winL[t] = winL[t] || []).push(cb), removeEventListener() {},
    dispatchEvent: (ev) => (winL[ev.type] || []).forEach((f) => f(ev)),
    requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 0), cancelAnimationFrame: (t) => clearTimeout(t),
    ResizeObserver: class { observe() {} disconnect() {} },
    Image: function () { return new Element("img", doc); },
    ImageData: class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } },
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
  });
  G.__winL = winL;
  Object.defineProperty(G, "navigator", { value: { userAgent: "iPhone" }, configurable: true });
  const mem = new Map(Object.entries(stored));
  G.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), mem };
  const smem = new Map();
  G.sessionStorage = { getItem: (k) => (smem.has(k) ? smem.get(k) : null), setItem: (k, v) => smem.set(k, String(v)), removeItem: (k) => smem.delete(k), mem: smem };
  if (sessionOnly) G.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, mem: new Map() };
  require(path.join(ROOT, "contract.js")); require(path.join(ROOT, "verbs.js"));

  // ---- the server, faked ----
  const state = { calls: [], used: 0, answers: [], delay: 10, rename, joinError, padApi, padHtml: PAD_HTML, padLayout: DEFAULT_PAD, htmlCalls: 0 };
  G.__server = state;
  const entityFor = (kind) => kind === "ship"
    ? { type: "ship", rig: "ship", verbs: ["shoot", "boost", "shield", "land", "emp", "mine"], unlocked: [{ verb: "shoot", part: "cannon" }, { verb: "boost", part: "exhaust flames" }, { verb: "land", part: "landing legs" }, { verb: "emp", part: "lightning bolt" }, { verb: "mine", part: "spikes" }], parts: [], source: "model" }
    : { type: "car", rig: "car", verbs: ["drive", "takeoff", "dig", "shoot"], unlocked: [{ verb: "dig", part: "shovel" }, { verb: "shoot", part: "gun" }], parts: [], source: "model" };
  const padFor = (layout) => ({ html: state.padHtml, controls: layout.buttons.map((b) => ({ action: b.action, kind: b.type, label: b.label || "" })), htmlSource: "template", padLayout: layout });
  async function generate(body) {
    await sleep(state.delay);
    const left = () => ({ space: 5 - state.used, planet: 5 });
    const forced = state.answers.shift();
    if (forced) return { ...forced, drawingsLeft: left() };
    if (!body.speculative) state.used++;
    if (body.kind === "ship" || body.kind === "explorer") return { ok: true, entity: entityFor(body.kind), looksLike: "entity", drawingsLeft: left() };
    if (body.kind === "button") { const layout = { buttons: [{ type: "button", action: "land", label: "LAND", x: 0.4, y: 0.2, w: 0.2, h: 0.2 }] }; return { ok: true, layout, ...padFor({ buttons: [...state.padLayout.buttons.filter((b) => b.action !== "land"), ...layout.buttons] }), drawingsLeft: left() }; }
    const layout = { buttons: [
      { type: "stick", action: "steer", label: "STEER", x: 0.04, y: 0.4, w: 0.3, h: 0.55 },
      { type: "button", action: "shoot", label: "FIRE", x: 0.6, y: 0.3, w: 0.2, h: 0.3 },
      { type: "button", action: "boost", label: "BOOST", x: 0.55, y: 0.65, w: 0.2, h: 0.3 },
      { type: "button", action: "land", label: "LAND", x: 0.8, y: 0.65, w: 0.15, h: 0.3 },
    ] };
    state.padLayout = layout;
    return { ok: true, layout, looksLike: "controller", ...(state.noHtmlOnGenerate ? {} : padFor(layout)), drawingsLeft: left() };
  }
  G.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    state.calls.push({ url, body });
    const reply = (o) => ({ ok: true, text: async () => JSON.stringify(o) });
    if (url === "/join") {
      if (state.joinError) return { ok: false, text: async () => JSON.stringify({ error: state.joinError }) };
      return reply(state.rename ? { player: body.player + "2", color: 0x22d3ee, renamed: true } : { player: body.player, color: 0x22d3ee });
    }
    if (url === "/generate") return reply(await generate(body));
    if (url === "/controller-html") {
      state.htmlCalls++;
      await sleep(state.delay);
      if (state.padApi === "404") return { ok: false, text: async () => "" };
      return reply({ ok: true, ...padFor(state.padLayout), pending: false });
    }
    return { ok: true, text: async () => "" };
  };
  G.EventSource = class { constructor() { this.onmessage = null; } close() {} };

  // ---- the fake modules, written next to the page ----
  G.__render = { played: [], shows: [], vis: [], created: 0, handlers: {}, pauses: [], tags: null, hud: { phase: "lobby", clock: 0, left: 0, leftText: "4:00", objectiveText: "REACH THE BOSS", status: "BOSS 850 M AWAY", bar: 1, radar: [], scores: [], me: { name: "tester", hp: 100, shieldEnergy: 1, boostEnergy: 1, mode: "space", flags: {} } } };
  fs.writeFileSync(`${OUT}/render.js`, `
const R = globalThis.__render;
export const sfx = { play(n) { R.played.push(n); return true; }, unlock() { R.unlocked = (R.unlocked || 0) + 1; }, setMuted(b) { R.muted = b; }, muted: false };
export function createEntityPreview(o) { R.created++; return { show: async (x) => { R.shows.push(x); return { ok: !R.failShow }; }, clear() { R.cleared = (R.cleared || 0) + 1; }, setVisible(v) { R.vis.push(v); }, dispose() {} }; }
export async function startGame(opts) {
  R.started = opts;
  return { on(ev, cb) { (R.handlers[ev] = R.handlers[ev] || []).push(cb); }, hud: () => R.hud, setView(v) { R.view = v; }, setPlayer() {}, entityOf: () => R.entity || null,
    projectPlayers: () => [], pause(b) { R.pauses.push(!!b); } };
}
`);
  fs.writeFileSync(`${OUT}/bigscreen-extras.js`, `
const R = globalThis.__render;
export function createNameTags(container, opts) { R.tags = opts; return { el: { style: {} }, update() {} }; }
`);
  G.__sb = { mounts: [], last: null };
  if (sandbox) fs.writeFileSync(`${OUT}/ctrl-sandbox.js`, `
const SB = globalThis.__sb;
export function mountController(container, html, opts) {
  const rec = { container, html, opts, controls: [], destroyed: false, disabled: [], released: 0, replaced: [], fx: [], down: new Set(), readyDone: false };
  SB.mounts.push(rec); SB.last = rec;
  rec.ready = new Promise((r) => (rec.resolveReady = r));
  const handle = {
    get iframe() { return {}; }, usingFallback: false, ready: rec.ready,
    controls: () => rec.controls.map((c) => ({ ...c })),
    releaseAll() { rec.released++; for (const a of [...rec.down]) { rec.down.delete(a); opts.onRelease(a); } },
    setDisabled(a) { rec.disabled.push([...a]); },
    replace(h) { rec.replaced.push(h); return new Promise((r) => { rec.pendingReplace = r; }); },
    destroy() { handle.releaseAll(); rec.destroyed = true; rec.resolveReady([]); },
    fx(k, o) { rec.fx.push([k, o]); return Promise.resolve({ map: {} }); },
    stats: () => ({ accepted: 0 }), busy: () => false,
  };
  rec.handle = handle;
  rec.press = (a) => { rec.down.add(a); opts.onPress(a); };
  rec.release = (a) => { rec.down.delete(a); opts.onRelease(a); };
  rec.becomeReady = (controls) => { rec.controls = controls; rec.readyDone = true; opts.onReady({ controls }); rec.resolveReady(controls); };
  container.ctrlSandbox = handle;
  return handle;
}
`);
  G.__mfx = { calls: [] };
  if (fx) fs.writeFileSync(`${OUT}/mischief-fx.js`, `
const M = globalThis.__mfx;
const rec = (name) => (...args) => { M.calls.push({ name, args }); return { done: Promise.resolve({}), cancel() {} }; };
export const emp = rec("emp"), inkBomb = rec("inkBomb"), tractorHit = rec("tractorHit"), mineHit = rec("mineHit"), decoyFooled = rec("decoyFooled"), toast = rec("toast");
`);
  const mod = await import(`${OUT}/page.mjs`);
  await sleep(250);      // the page's dynamic imports (ctrl-sandbox.js, mischief-fx.js, render.js after 250 ms) settle
  return { doc, G, state, R: G.__render, SB: G.__sb, MFX: G.__mfx, $: (id) => doc.getElementById(id), S: G.__sp, T: G.__spTest, OUT, mem, smem };
}

// pad controls as the kit would report them (fractions of the frame)
export const KIT_CONTROLS = [
  { action: "steer", kind: "stick", label: "STEER", x: 0.04, y: 0.4, w: 0.3, h: 0.55 },
  { action: "boost", kind: "button", label: "BOOST", x: 0.56, y: 0.62, w: 0.17, h: 0.32 },
  { action: "shoot", kind: "button", label: "SHOOT", x: 0.76, y: 0.5, w: 0.21, h: 0.44 },
];
export function makeChecker() {
  let fails = 0, n = 0;
  const show = (v) => { if (typeof v === "string") return v; try { return JSON.stringify(v, (k, x) => (x && typeof x === "object" && x.ownerDocument ? `<${x.localName}#${x.id}>` : x)); } catch (e) { return String(v); } };
  const ok = (name, cond, extra = "") => { n++; if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  → " + show(extra) : ""}`); };
  return { ok, done: () => { console.log(`\n${n} checks, ${fails} failed`); return fails; } };
}
