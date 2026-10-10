// Astra HTML: the drawn controller, written by Sol as one self-contained HTML document (PLAN.md section 0, "The
// controller is written by Sol as HTML"). One gpt-6.1-sol call (Responses API, service tier ultrafast, reasoning
// effort medium) gets the photo of the drawing plus the layout Astra already read from it and returns a FORTNITE-style
// controller (owner, 9 October 23:55): chunky slanted tiles in rarity colours (gold weapons, purple powers, blue
// the rest), thick white borders, hard dark drop shadows, heavy condensed ITALIC capitals in white with a dark
// outline, big touch targets and playful pop-ins; NOT thin sci-fi lines (no 1-2 px neon outlines, no wireframe or
// HUD look). Every control sits where the player drew it. Everything after the call is plain code: the answer is
// checked here (size, no network, no storage, no escape from the frame, only allowed actions, every drawn control
// present, and a static style gate that sends a clearly non-Fortnite answer back to the template) and on any
// failure the deterministic template below is used instead: same Fortnite look, always works. The phone runs the
// result with ctrl-sandbox.js, whose kit does all the input handling.
//
//   generateControllerHtml({ image, layout, allowedActions, style, signal, timeoutMs, player })
//     → Promise<{ ok: true, html, controls: [{ action, kind: "button"|"stick"|"toggle", label }],
//                 source: "model"|"template", ms, bytes, style: { score, of, missing, italic }, error?, warnings? }
//       | { ok: false, error }                       // only when the layout has no usable control at all
//     image: PNG/JPEG data URL of the drawing (optional; without it Sol works from the layout alone).
//     layout: contract layout v2 { buttons: [{ type, action, label, x, y, w, h }] } (fractions of the drawing,
//       which maps onto the whole play area). allowedActions: the actions the HTML may use (default: the
//       layout's own). style: { accent: "#2f8bff" } (stick knob colour). error says why the model's HTML was not
//       used ("rejected: style (…)" when it was valid but not Fortnite-like). The result's own `style` is the
//       Fortnite score of the HTML that is returned (the template always scores full marks); `warnings` carries
//       the mild misses ("style: no condensed font").
//   templateHtml(layout, { allowedActions, style }) → html          (sync, deterministic, < 1 ms)
//   validateHtml(html, { allowedActions, layout }) → { ok, errors, warnings, controls, bytes,
//                                                      style: { score, of, missing, italic } }
//     style is the static Fortnite gate (7 checks: slant, 3 px borders, heavy weight, dark text outline, two
//     rarity colours, condensed font, no thin-line look). It never changes `ok`; generateControllerHtml refuses
//     an answer that misses 3 or more checks, or the thin-line check plus any other.
//
// Markup contract (kit v1, dev/v12-modules/SPEC.md): buttons carry data-action (+ data-toggle), sticks
// data-stick="steer"|"move" with a data-knob child, labels data-label; the kit sets .is-down/.is-on/.is-disabled.
//
// Env: OPENAI_API_KEY (else a .env next to this file, the same loader as astra.js; a key that is present but blank
// means NO key and .env is not consulted), OPENAI_MODEL (pinned to gpt-6.1-sol: only a value starting with
// "gpt-6.1-sol", e.g. a dated snapshot, is used; anything else is ignored with one warning),
// OPENAI_SERVICE_TIER ("" or "none" omits it), ASTRA_HTML_EFFORT (default medium), ASTRA_HTML_TIMEOUT_MS,
// ASTRA_HTML_CALL_LOG (append one JSON line per HTTP request to the model), ASTRA_MOCK=1 (no network: the
// template, at once).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Contract = require("./contract.js");
const Verbs = require("./verbs.js");

const API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-6.1-sol";
const DEFAULT_TIER = "ultrafast";
const DEFAULT_EFFORT = "medium"; // owner 12:41: "a bit more effort for sol" (was low; 45 s timeout kept)
const TIMEOUT_MS = 45000;
const MAX_HTML_BYTES = 60 * 1024;
const MAX_OUTPUT_TOKENS = 12000;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const MAX_CONTROLS = 16;
const MIN_TOUCH_PX = 56;    // the kit's hit minimum (ctrl-sandbox.js MIN_HIT_PX): what a finger must be able to hit
const MIN_VISUAL_PX = 64;   // how big the template draws a button: fat and easy to see (the hit area is a bonus)
const MIN_STICK_PX = 110;
const ACCENT = "#2f8bff";   // stick knob colour: Fortnite rare blue
const STICKS = Verbs.STICKS;
const ACTIONS = [...Object.keys(Verbs.VERBS), ...Verbs.MOVES, ...Verbs.STICKS, ...Contract.META_ACTIONS];

let fetchImpl = (...args) => globalThis.fetch(...args);
let timeoutMs = Number(process.env.ASTRA_HTML_TIMEOUT_MS) || TIMEOUT_MS;
let defaultTierOnly = false;   // set only once a request WITHOUT the tier worked after the tier was named in a 4xx
let warnedModel = false;
let envKey;
const cache = new Map();     // key → result (newest 64)
const inflight = new Map();  // key → { promise, controller, owners }
// v1.5 (owner, 10 Oct 11:31: every round starts from scratch): the round generation, part of every cache key. newRound()
// (server.js, at each new lobby) bumps it, forgets every cached controller and stops the calls still running, so a
// controller drawing sent again in a later round is written afresh.
let roundGen = 0;
function newRound() {
  roundGen++;
  for (const entry of inflight.values()) { try { entry.controller.abort(); } catch {} }
  inflight.clear();
  cache.clear();
  return roundGen;
}

// The key from the environment, else .env. A key that is present but blank (a harness blanks it on purpose) means
// NO key: .env is not consulted then.
function apiKey() {
  if (process.env.OPENAI_API_KEY !== undefined) return String(process.env.OPENAI_API_KEY).trim() || null;
  if (envKey === undefined) {
    envKey = null;
    try {
      const text = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
      const match = text.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/m);
      if (match) envKey = match[1].trim().replace(/^["']|["']$/g, "") || null;
    } catch {}
  }
  return envKey;
}

// The model is pinned (owner): gpt-6.1-sol, or a snapshot of it ("gpt-6.1-sol-…"). OPENAI_MODEL may only pick such a
// name; any other value is ignored with one warning and the default is used.
function modelName() {
  const want = String(process.env.OPENAI_MODEL || "").trim();
  if (!want) return DEFAULT_MODEL;
  if (/^gpt-6\.1-sol(-[\w.-]+)?$/.test(want)) return want;   // same rule as astra.js
  if (!warnedModel) {
    warnedModel = true;
    console.warn(`astra-html: OPENAI_MODEL "${want.slice(0, 40)}" ignored: the controller model is pinned to ${DEFAULT_MODEL} (or a ${DEFAULT_MODEL}-… snapshot)`);
  }
  return DEFAULT_MODEL;
}

const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const round3 = (v) => Math.round(v * 1000) / 1000;
const fix = (v) => +v.toFixed(2);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- Layout → controls -------------------------------------------------------------------------------------------

function allowedSet(allowedActions, controls) {
  const list = Array.isArray(allowedActions) && allowedActions.length ? allowedActions : controls.map((c) => c.action);
  return new Set(list.map((a) => Contract.normaliseAction(a)));
}

// The layout's controls, cleaned like Contract.CHECKS.layout: known actions, rectangles inside 0..1, sticks only
// for steer/move. Controls whose action is not allowed are dropped (reported in `dropped`).
function cleanLayout(layout, allowedActions) {
  const raw = layout && Array.isArray(layout.buttons) ? layout.buttons.slice(0, MAX_CONTROLS) : [];
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const action = Contract.normaliseAction(b.action || "");
    if (!ACTIONS.includes(action)) continue;
    let type = ["button", "stick", "toggle"].includes(b.type) ? b.type : "button";
    if (STICKS.includes(action)) type = "stick";
    else if (type === "stick") type = "button";
    const x = clamp01(b.x), y = clamp01(b.y);
    const w = Math.max(0.02, Math.min(clamp01(b.w), 1 - x)), h = Math.max(0.02, Math.min(clamp01(b.h), 1 - y));
    const label = String(b.label ?? "").replace(/[^\p{L}\p{N} +\-!?.#*<>^←→↑↓◀▶▲▼⬅➡⬆⬇]/gu, "").trim().toUpperCase().slice(0, 16);
    out.push({ type, action, label, x: round3(x), y: round3(y), w: round3(w), h: round3(h) });
  }
  const allowed = allowedSet(allowedActions, out);
  return { controls: out.filter((c) => allowed.has(c.action)), dropped: out.filter((c) => !allowed.has(c.action)).map((c) => c.action), allowed };
}

// ---- Template: the same look, built in code ----------------------------------------------------------------------

// Stroke icons on a 24 × 24 grid, drawn in the line colour.
const ICONS = {
  shoot: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4.2M12 17.3v4.2M2.5 12h4.2M17.3 12h4.2"/><circle cx="12" cy="12" r="1.3" class="f"/>',
  boost: '<path d="M4.5 6l6 6-6 6M12 6l6 6-6 6"/>',
  shield: '<path d="M12 2.8l7.2 3v5.6c0 4.4-3 8-7.2 9.8-4.2-1.8-7.2-5.4-7.2-9.8V5.8z"/><path d="M12 7v10" class="d"/>',
  blast: '<path d="M12 2.5l2.1 5.4 5.6-1.6-3.2 4.9 4.2 3.8-5.8.4-.8 5.8-3.3-4.7-4.8 3.1 1.3-5.6L2.5 12.8l5.4-2.1-1.4-5.6 4.9 3z"/>',
  drill: '<path d="M7.5 2.8h9v4h-9zM9 6.8h6l-3 14.4z"/><path d="M9.6 10.4l4.6-1.4M10.4 14l3.2-1"/>',
  land: '<path d="M12 2.8v8.4M8.4 7.8L12 11.4l3.6-3.6"/><path d="M5 15.6h14M7.6 15.6l-2.2 4.6M16.4 15.6l2.2 4.6M3.4 20.2h4M16.6 20.2h4"/>',
  takeoff: '<path d="M12 2.4c3 2.6 4.2 6.2 4.2 9.8l-2.2 3.2h-4L7.8 12.2c0-3.6 1.2-7.2 4.2-9.8z"/><circle cx="12" cy="9" r="1.6"/><path d="M10.4 17.6l-1 3.6M13.6 17.6l1 3.6M12 18v3.8"/>',
  dig: '<path d="M12 2.8v10.4M9 2.8h6"/><path d="M7.8 13.2h8.4l-.9 5.2L12 21.4l-3.3-3z"/>',
  scan: '<circle cx="12" cy="12" r="1.6" class="f"/><path d="M12 12l6.6-5.6"/><path d="M4.8 15.6A8 8 0 0 1 8 4.9M19.2 8.4A8 8 0 0 1 16 19.1M8.4 13.6a4 4 0 0 1 1.5-5.1"/>',
  flare: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2M5.4 5.4l2.2 2.2M16.4 16.4l2.2 2.2M5.4 18.6l2.2-2.2M16.4 7.6l2.2-2.2"/>',
  heal: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4"/><path d="M12 7.6v8.8M7.6 12h8.8"/>',
  invisible: '<path d="M2.6 12s3.4-6 9.4-6 9.4 6 9.4 6-3.4 6-9.4 6-9.4-6-9.4-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.4 19.6L19.6 4.4"/>',
  teleport: '<ellipse cx="12" cy="12.6" rx="5.2" ry="8.4"/><ellipse cx="12" cy="12.6" rx="2" ry="4.4"/><path d="M19.4 2.6v3.6M17.6 4.4h3.6"/>',
  jump: '<path d="M12 18.6V5.4M7.2 10.2L12 5.4l4.8 4.8"/><path d="M5.6 21h12.8"/>',
  shapeshift: '<path d="M4.6 9.4a7.6 7.6 0 0 1 13.6-2.6M19.4 14.6a7.6 7.6 0 0 1-13.6 2.6"/><path d="M18.6 3.4v3.6H15M5.4 20.6v-3.6H9"/>',
  grapple: '<path d="M12 2.6v10.6"/><path d="M6.6 12.4a5.4 5.4 0 0 0 10.8 0"/><path d="M6.6 12.4L4.6 10M17.4 12.4l2-2.4"/>',
  drive: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.6v6.2M12 14.2v6.2M3.6 12h6.2M14.2 12h6.2"/>',
  fly: '<path d="M12 9.6c-2.6-3.6-6.6-4.6-9.4-3.6 1.6 3.6 5 6 9.4 6.4 4.4-.4 7.8-2.8 9.4-6.4-2.8-1-6.8 0-9.4 3.6z"/><path d="M12 12.4v6.4"/>',
  swim: '<path d="M2.6 9.2c2.4-2 4.6-2 7 0s4.6 2 7 0 3.4-1.4 4.8-1M2.6 15.2c2.4-2 4.6-2 7 0s4.6 2 7 0 3.4-1.4 4.8-1"/>',
  left: '<path d="M14.6 5.4L8 12l6.6 6.6"/>',
  right: '<path d="M9.4 5.4L16 12l-6.6 6.6"/>',
  up: '<path d="M5.4 14.6L12 8l6.6 6.6"/>',
  down: '<path d="M5.4 9.4L12 16l6.6-6.6"/>',
  forward: '<path d="M5.4 12.6L12 6l6.6 6.6M5.4 18.6L12 12l6.6 6.6"/>',
  back: '<path d="M5.4 5.4L12 12l6.6-6.6M5.4 11.4L12 18l6.6-6.6"/>',
  strafeleft: '<path d="M10.6 5.4L4 12l6.6 6.6M20 12H5"/>',
  straferight: '<path d="M13.4 5.4L20 12l-6.6 6.6M4 12h15"/>',
  rise: '<path d="M12 19V6M6.6 11.4L12 6l5.4 5.4M5 3.4h14"/>',
  sink: '<path d="M12 5v13M6.6 12.6L12 18l5.4-5.4M5 20.6h14"/>',
  ready: '<path d="M4.6 12.6l4.6 4.6 10.2-10.2"/>',
  view: '<path d="M3.4 8.2h4l1.8-2.6h5.6l1.8 2.6h4v11H3.4z"/><circle cx="12" cy="13.4" r="3.4"/>',
  // v1.3 mischief: lightning bolt, horseshoe magnet, spiked mine, ink drop, a ship and its dashed copy.
  emp: '<path d="M13.6 2.4L5.4 13.4h5.8l-1.6 8.2 8.4-11.2h-5.8z"/>',
  tractor: '<path d="M5.2 3.2h4.4v8.4a2.4 2.4 0 0 0 4.8 0V3.2h4.4v8.4a6.8 6.8 0 0 1-13.6 0z"/><path d="M5.2 7.2h4.4M14.4 7.2h4.4"/>',
  mine: '<circle cx="12" cy="13" r="5"/><path d="M12 3.4v4.4M12 18.2v2.8M3.2 13H7M17 13h3.8M5.8 6.8l2.6 2.6M15.6 9.4l2.6-2.6M5.8 19.2l2.6-2.6M15.6 16.6l2.6 2.6"/>',
  inkbomb: '<path d="M12 2.8c3.4 4.4 5.8 7.6 5.8 10.8a5.8 5.8 0 0 1-11.6 0c0-3.2 2.4-6.4 5.8-10.8z"/><circle cx="4.2" cy="19.8" r="1.5" class="f"/><circle cx="19.9" cy="18.6" r="1.2" class="f"/>',
  decoy: '<path d="M8.6 3.4l5.2 11.2H3.4z"/><path d="M16.4 9.6l4 8.6h-8z" class="d"/>',
};

// The word a control shows when the player wrote none: how the game writes the skill ("INK BOMB", not "INKBOMB").
const actionWord = (action) => (typeof Verbs.labelOf === "function" ? Verbs.labelOf(action) : String(action).toUpperCase());

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

// The look (PLAN.md section 0, "Style like Fortnite"): chunky slanted tiles in rarity colours (gold for weapons,
// purple for powers, blue for moving and the rest) with thick white borders and a hard dark drop shadow, heavy
// condensed ITALIC capitals in white with a dark outline, a press that sinks and bounces back, and a pop-in when the
// controller appears. Nothing thin: no 1-2 px lines, no glow outlines. The frame's CSP allows no web fonts, so the
// stack starts with the condensed heavy faces every iPhone and Mac has.
const FONT = '"Futura-CondensedExtraBold","Futura Condensed ExtraBold","AvenirNextCondensed-Heavy","Avenir Next Condensed","Bebas Neue","Barlow Condensed","Arial Narrow",Impact,system-ui,sans-serif';
const TIERS = { gold: ["#ffe36e", "#ffb21f", "#d26a06"], purple: ["#d49bff", "#9d4dff", "#5a1bc4"], blue: ["#86dcff", "#2f8bff", "#1647c8"] };
const TIER_OF = {
  shoot: "gold", blast: "gold", drill: "gold", mine: "gold",
  shield: "purple", invisible: "purple", teleport: "purple", shapeshift: "purple", heal: "purple", grapple: "purple", scan: "purple", flare: "purple",
  emp: "purple", inkbomb: "purple", tractor: "purple", decoy: "purple",
};
const tierOf = (action) => TIER_OF[action] || "blue";
const OUTLINE = "#0b1033";
// The phone's HUD (vitals, tools, objective, timer, score, radar) owns the top of the frame: no control's top edge goes
// above this band (a control drawn up there slides down just enough; everything else stays exactly where it was drawn).
const HUD_BAND = "clamp(72px,26vh,116px)";

function templateCss(accent) {
  const rgb = hexRgb(accent);
  const dark = toHex(rgb.map((v) => v * 0.55));
  const o = OUTLINE;
  return [
    `:root{--k:${accent};--k2:${dark};--ol:${o};--hud:${HUD_BAND}}`,
    `html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:${FONT};color:#fff}`,
    ".ctl{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;" +
      "transform-origin:0 0;transform:translate(-50%,-50%);animation:kpop .46s cubic-bezier(.26,1.5,.48,1) both;animation-delay:var(--d,0s);" +
      "transition:transform .14s cubic-bezier(.34,1.56,.64,1),box-shadow .1s,filter .1s}",
    // transform-origin 0 0 is the control's centre once translated: skew and scale pivot there, so a slanted tile stays
    // centred where it was drawn (skew listed first = applied last).
    ".btn{transform:skewX(-9deg) translate(-50%,-50%);border-radius:12px;border:3px solid rgba(255,255,255,.94);opacity:.92;" +
      "background:linear-gradient(180deg,var(--t1) 0%,var(--t2) 50%,var(--t3) 100%);" +
      `box-shadow:0 5px 0 ${o},0 9px 16px rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.38),inset 0 -4px 0 rgba(0,0,0,.18)}`,
    ".btn.is-down{transform:skewX(-9deg) translateY(4px) scale(.95) translate(-50%,-50%);filter:brightness(1.2) saturate(1.1);" +
      `box-shadow:0 1px 0 ${o},0 3px 8px rgba(0,0,0,.3),inset 0 3px 0 rgba(255,255,255,.28),inset 0 -2px 0 rgba(0,0,0,.18)}`,
    `.ico{width:min(34px,46%);max-height:46%;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;overflow:visible;filter:drop-shadow(0 2px 0 ${o})}`,
    ".ico .f{fill:#fff}.ico .d{stroke-dasharray:2 2.4;opacity:.8}",
    ".only .ico{width:min(46px,62%);max-height:66%}",
    // Slant, once: the tile is skewed -9deg and its contents are skewed back +9deg, so icons keep their shape and the
    // capitals lean only by their italic (a synthesised italic leans about 14deg, near the tile's 9). Without the
    // skew-back the capitals would be sheared AND italic: 23deg of lean, mushy strokes.
    ".btn>.lab,.btn>.ico,.btn>.led{transform:skewX(9deg)}",
    ".lab{font-size:var(--fs,16px);font-style:italic;font-weight:900;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;line-height:.95;color:#fff;" +
      `text-shadow:0 2px 0 ${o},1.5px 0 0 ${o},-1.5px 0 0 ${o},0 -1.5px 0 ${o},0 4px 7px rgba(0,0,0,.45)}`,
    ".tog{flex-direction:row;gap:9px;border-radius:999px}",
    ".led{width:13px;height:13px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;flex:none;background:rgba(11,16,51,.6)}",
    `.tog.is-on{--t1:${TIERS.gold[0]};--t2:${TIERS.gold[1]};--t3:${TIERS.gold[2]}}`,
    ".tog.is-on .led{background:#fff;box-shadow:0 0 10px #fff}",
    ".stick{border-radius:50%;border:4px solid rgba(255,255,255,.8);background:radial-gradient(circle,rgba(47,139,255,.3) 0,rgba(11,16,51,.42) 64%,rgba(11,16,51,.3) 100%);" +
      `box-shadow:0 5px 0 rgba(11,16,51,.55),inset 0 0 0 9px rgba(255,255,255,.07)}`,
    `.chev{position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:rgba(255,255,255,.88);stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round;overflow:visible;filter:drop-shadow(0 2px 0 rgba(11,16,51,.65))}`,
    ".knob{position:absolute;left:30%;top:30%;width:40%;height:40%;box-sizing:border-box;border-radius:50%;border:3px solid #fff;display:grid;place-items:center;" +
      "background:radial-gradient(circle at 38% 30%,#d4f1ff 0,var(--k) 42%,var(--k2) 100%);" +
      `box-shadow:0 5px 0 ${o},0 8px 14px rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.42);transition:transform .14s cubic-bezier(.34,1.56,.64,1),filter .1s}`,
    ".knob .lab{--fs:13px}",
    ".stick.is-down{border-color:#fff}",
    ".stick.is-down .knob{transform:scale(1.1);filter:brightness(1.15)}",
    "@keyframes kpop{0%{opacity:0;scale:.35}62%{opacity:1;scale:1.08}100%{opacity:1;scale:1}}",
  ].join("\n");
}

// Each control centred where it was drawn, never visually smaller than MIN_VISUAL_PX (the kit's hit area is at least
// MIN_TOUCH_PX around it), always fully on screen.
function placeCss(id, c, n, i) {
  const cx = fix((c.x + c.w / 2) * 100), cy = fix((c.y + c.h / 2) * 100), W = fix(c.w * 100), H = fix(c.h * 100);
  const delay = `--d:${(i * 0.055).toFixed(3)}s;`;
  if (c.type === "stick") {
    const size = `max(${MIN_STICK_PX}px,min(${W}vw,${H}vh))`, half = `max(${MIN_STICK_PX / 2}px,min(${fix(W / 2)}vw,${fix(H / 2)}vh))`;
    return `#${id}{${delay}width:${size};height:${size};left:clamp(${half},${cx}vw,calc(100vw - ${half}));top:clamp(min(calc(var(--hud) + ${half}),calc(100vh - ${half})),${cy}vh,calc(100vh - ${half}))}`;
  }
  const tier = TIERS[tierOf(c.action)];
  const hw = `max(${MIN_VISUAL_PX / 2}px,${fix(W / 2)}vw)`, hh = `max(${MIN_VISUAL_PX / 2}px,${fix(H / 2)}vh)`;
  // Label size: fits the width (≈ 0.56 em per heavy condensed capital), between 12 and 24 px.
  const fs = n ? `--fs:clamp(12px,${fix((W * 0.8) / Math.max(2.4, n * 0.56))}vw,24px);` : "";
  return `#${id}{${delay}--t1:${tier[0]};--t2:${tier[1]};--t3:${tier[2]};${fs}width:max(${MIN_VISUAL_PX}px,${W}vw);height:max(${MIN_VISUAL_PX}px,${H}vh);` +
    `left:clamp(${hw},${cx}vw,calc(100vw - ${hw}));top:clamp(min(calc(var(--hud) + ${hh}),calc(100vh - ${hh})),${cy}vh,calc(100vh - ${hh}))}`;
}

const ARROW_LABELS = /^[←→↑↓◀▶▲▼⬅➡⬆⬇<>^V]$/;
const PLAIN_STICK = /^(|STICK|JOYSTICK|JOY|STEER|MOVE|ARROWS|DPAD|D-PAD)$/;

function controlHtml(id, c) {
  const icon = ICONS[c.action] ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[c.action]}</svg>` : "";
  if (c.type === "stick") {
    // Four chunky chevrons; a word the player wrote (WALK, FLY...) rides on the knob, nothing else is written.
    const custom = !PLAIN_STICK.test(c.label);
    const label = custom ? c.label : c.action.toUpperCase();
    return `<div class="ctl stick" id="${id}" data-stick="${c.action}" data-label="${esc(label)}">` +
      '<svg class="chev" viewBox="0 0 100 100" aria-hidden="true"><path d="M43 13l7-6 7 6M43 87l7 6 7-6M13 43l-6 7 6 7M87 43l6 7-6 7"/></svg>' +
      `<div class="knob" data-knob>${custom ? `<span class="lab">${esc(label)}</span>` : ""}</div></div>`;
  }
  // Arrows and unlabelled movement show only their icon; everything else shows the player's word.
  const iconOnly = icon && (!c.label || ARROW_LABELS.test(c.label)) && Verbs.MOVES.includes(c.action);
  const label = c.label && !ARROW_LABELS.test(c.label) ? c.label : actionWord(c.action);
  const cls = `ctl btn${c.type === "toggle" ? " tog" : ""}${iconOnly ? " only" : ""}`;
  const led = c.type === "toggle" ? '<i class="led"></i>' : "";
  const text = iconOnly ? "" : `<span class="lab">${esc(label)}</span>`;
  return `<div class="${cls}" id="${id}" data-action="${c.action}"${c.type === "toggle" ? " data-toggle" : ""} data-label="${esc(label)}">${led}${c.type === "toggle" ? "" : icon}${text}</div>`;
}

function templateHtml(layout, { allowedActions, style } = {}) {
  const { controls } = cleanLayout(layout, allowedActions);
  const accent = hexRgb(style && style.accent) ? toHex(hexRgb(style.accent)) : ACCENT;
  const css = [templateCss(accent)];
  const body = [];
  controls.forEach((c, i) => {
    const id = `k${i}`;
    const shown = c.type === "stick" ? "" : c.label && !ARROW_LABELS.test(c.label) ? c.label : actionWord(c.action);
    const iconOnly = ICONS[c.action] && (!c.label || ARROW_LABELS.test(c.label)) && Verbs.MOVES.includes(c.action);
    css.push(placeCss(id, c, iconOnly ? 0 : shown.length, i));
    body.push(controlHtml(id, c));
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Controller</title><style>\n${css.join("\n")}\n</style></head>` +
    `<body>\n${body.join("\n")}\n</body></html>`;
}

// ---- Validation ----------------------------------------------------------------------------------------------------

const BAD_TAGS = /<\s*(iframe|frame|frameset|object|embed|applet|form|input|textarea|select|option|link|base|audio|video|source|track|portal|area|map|dialog|fencedframe|webview)\b/i;
const URL_ATTRS = /\s(src|href|xlink:href|action|formaction|poster|data|background|srcset|ping|codebase|manifest|cite|longdesc|lowsrc|dynsrc|usemap)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SAFE_URL = /^\s*(#|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i;
const SVG_NAMESPACES = /https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml|XML\/1998\/namespace)/gi;
// Script checks (defence in depth: the frame's sandbox and CSP are the real wall).
const JS_DENY = [
  [/\bfetch\b/, "fetch"], [/XMLHttpRequest/, "XMLHttpRequest"], [/\bReflect\b/, "Reflect"], [/\bdefaultView\b/, "defaultView"],
  [/\.\s*(parent|top)\s*\.\s*(postMessage|location|document|frames|open)\b/, "window escape"], [/WebSocket/, "WebSocket"], [/\bimport\s*\(/, "import()"],
  [/(^|[;{}\s])import\s+[\w{*'"]/, "import"], [/\blocalStorage\b/, "localStorage"], [/\bsessionStorage\b/, "sessionStorage"],
  [/\bindexedDB\b/, "indexedDB"], [/\bcookie\b/, "document.cookie"], [/(^|[^.\w$])top\s*[.[]/, "top."], [/(^|[^.\w$])parent\s*[.[]/, "parent."],
  [/\b(window|self|globalThis)\s*\.\s*(top|parent|opener|frameElement)\b/, "window escape"], [/\bopener\b/, "opener"], [/\bframeElement\b/, "frameElement"],
  [/\bpostMessage\b/, "postMessage"], [/\beval\s*\(/, "eval"], [/\bFunction\s*\(/, "Function()"],
  [/\bset(Timeout|Interval)\s*\(\s*['"`]/, "string timer"], [/\bnavigator\s*\.\s*(sendBeacon|serviceWorker|clipboard|geolocation|mediaDevices|credentials|share|locks|storage)\b/, "navigator API"],
  [/\bsendBeacon\b/, "sendBeacon"], [/\bEventSource\b/, "EventSource"], [/RTC(PeerConnection|DataChannel)/, "WebRTC"], [/\b(Shared)?Worker\s*\(/, "Worker"],
  [/\bimportScripts\b/, "importScripts"], [/\bcaches\s*\./, "caches"], [/\blocation\b/, "location"], [/\bwindow\s*\.\s*open\b/, "window.open"],
  [/\bdocument\s*\.\s*(write|writeln|domain|open)\b/, "document.write"], [/\b(window|self|globalThis|document|frames)\s*\[/, "dynamic global access"],
  [/\bWebAssembly\b/, "WebAssembly"], [/\bfromCharCode\b|\batob\s*\(/, "obfuscation"], [/\\x[0-9a-f]{2}/i, "hex escape"],
  [/\bgame\s*\[/, "dynamic game access"], [/\bsetAttribute\s*\(\s*['"`]on/i, "handler attribute"], [/\bsrcdoc\b/, "srcdoc"],
  [/<\s*\/?\s*(script|iframe|frame|object|embed|link|base|form|meta)\b/i, "markup injection"], [/['"`][^'"`]*\son[a-z]+\s*=/i, "handler in markup"],
  [/data-(action|stick|toggle)|dataset\s*\.\s*(action|stick|toggle)/i, "script creates controls"],
  [/\.on(pointer|touch|mouse|click|key|gesture)[a-z]*\s*=/i, "input handler"], [/addEventListener\s*\(\s*['"`](pointer|touch|mouse|click|dblclick|key|gesture)/i, "input handler"],
];
const CSS_DENY = [[/@import\b/i, "@import"], [/expression\s*\(/i, "expression()"], [/-moz-binding|behavior\s*:/i, "binding"]];

function attrsOf(tagBody) {
  const out = {};
  String(tagBody).replace(/([^\s=\/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (m, name, _v, a, b, c) => {
    out[name.toLowerCase()] = a ?? b ?? c ?? "";
    return "";
  });
  return out;
}

// ---- Style gate: Fortnite or not, read from the CSS alone ----------------------------------------------------------
// Seven static checks on everything styled in the answer (style blocks, style attributes, svg attributes). A document
// that misses 3 or more, or the thin-line check together with any other, is not the bold chunky look the owner asked
// for (PLAN.md section 0): generateControllerHtml refuses it and the template shows instead. Fewer misses are only
// warnings. The template scores full marks.

const STYLE_MISS = {
  slant: "no slant", chunky: "no 3px border", heavy: "no heavy weight", outline: "no dark text outline",
  rarity: "under 2 rarity colours", font: "no condensed font", thin: "thin lines",
};
const STYLE_OF = Object.keys(STYLE_MISS).length;
const NAMED_COLOURS = { black: [0, 0, 0], white: [255, 255, 255], navy: [0, 0, 128], darkblue: [0, 0, 139], midnightblue: [25, 25, 112], indigo: [75, 0, 130], darkslateblue: [72, 61, 139], darkslategray: [47, 79, 79], darkslategrey: [47, 79, 79] };
const COLOUR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]{0,60}\)|hsla?\([^)]{0,60}\)/gi;   // bounded: no slow scans on hostile text
const BORDER_PROP = /^(border|outline)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;
const BORDER_WIDTH_PROP = /^(border|outline)(-(top|right|bottom|left|block|inline)(-(start|end))?)?-width$/;

// "#rgb", "#rrggbb" (alpha digits ignored), rgb()/rgba(), hsl()/hsla() and a few dark names → [r, g, b] or null.
function parseColour(text) {
  const s = String(text).trim().toLowerCase();
  let m = /^#([0-9a-f]+)$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return [...h.slice(0, 3)].map((c) => parseInt(c + c, 16));
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return null;
  }
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[2].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (p.length < 3) return null;
    if (m[1][0] === "r") {
      const rgb = p.map((v) => (v.endsWith("%") ? parseFloat(v) * 2.55 : parseFloat(v)));
      return rgb.every(Number.isFinite) ? rgb.map((v) => Math.max(0, Math.min(255, v))) : null;
    }
    const h = (((parseFloat(p[0]) % 360) + 360) % 360) / 360, sat = Math.min(1, Math.max(0, parseFloat(p[1]) / 100)), l = Math.min(1, Math.max(0, parseFloat(p[2]) / 100));
    if (![h, sat, l].every(Number.isFinite)) return null;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, pp = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return (t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp) * 255; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  return Object.prototype.hasOwnProperty.call(NAMED_COLOURS, s) ? NAMED_COLOURS[s] : null;
}

const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

// The rarity colour family of a colour (near shades count), or null for greys, near-black, near-white and pastels.
function rarityFamily([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d || l < 0.18 || l > 0.9) return null;
  const sat = d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.5) return null;
  const hue = (((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60) + 360) % 360;
  if (hue >= 25 && hue <= 58) return "gold";     // #ffe36e #ffb21f #d26a06
  if (hue >= 250 && hue <= 295) return "purple"; // #d49bff #9d4dff #5a1bc4
  if (hue >= 200 && hue <= 245) return "blue";   // #2f8bff #1647c8 (the light tint #86dcff and sci-fi cyan #5ee7ff are not)
  return null;
}

// Splits at the top level only: outside parentheses. sep "," or whitespace.
function splitTop(text, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of String(text)) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (!depth && (sep === "," ? ch === "," : /\s/.test(ch))) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const WIDTH_WORDS = { thin: 1, medium: 3, thick: 5 };
// A CSS length token in px (a 800 x 390 frame: 1vw = 8px, 1vh = 3.9px), or null when it is not a plain length.
function lengthPx(token) {
  const t = String(token).trim().toLowerCase();
  if (t.length > 24) return null;
  if (Object.prototype.hasOwnProperty.call(WIDTH_WORDS, t)) return WIDTH_WORDS[t];
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|pt|em|rem|vw|vh|vmin|vmax)?$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return { em: n * 16, rem: n * 16, pt: n * 1.33, vw: n * 8, vmax: n * 8, vh: n * 3.9, vmin: n * 3.9 }[m[2]] ?? n;
}

// [property, value] pairs of every declaration (custom properties resolved), rules and @media flattened.
function cssDecls(css) {
  const decls = [], vars = {};
  // Linear scan: every chunk between ; { } is "name: value" or a selector (no valid name before its first colon).
  for (const chunk of String(css).replace(/\/\*[\s\S]*?\*\//g, " ").split(/[;{}]/).slice(0, 6000)) {
    const i = chunk.indexOf(":");
    if (i < 0) continue;
    const name = chunk.slice(0, i).trim().toLowerCase(), value = chunk.slice(i + 1).trim();
    if (!/^-{0,2}[a-z_][\w-]*$/.test(name)) continue;
    if (name.startsWith("--")) vars[name] = value; else decls.push([name, value]);
  }
  const sub = (v) => v.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/gi, (all, n, fallback) => String(vars[n.toLowerCase()] ?? fallback ?? "").trim().slice(0, 200));
  return decls.map(([name, value]) => [name, sub(sub(value)).slice(0, 2000)]);
}

// Widths in px of every visible border and outline, and of box-shadow rings (0 0 0 3px #fff).
function borderWidths(decls) {
  const out = [];
  for (const [prop, value] of decls) {
    if (BORDER_PROP.test(prop) && !/\btransparent\b/i.test(value)) {
      const first = splitTop(value, " ").map(lengthPx).find((n) => n !== null);
      if (first !== undefined) out.push(first);
    } else if (BORDER_WIDTH_PROP.test(prop)) {
      for (const n of splitTop(value, " ").map(lengthPx)) if (n !== null) out.push(n);
    } else if (prop === "box-shadow") {
      for (const layer of splitTop(value, ",")) {
        if (/\binset\b/i.test(layer)) continue;
        const lens = splitTop(layer, " ").map(lengthPx).filter((n) => n !== null);
        if (lens.length >= 4 && lens[0] === 0 && lens[1] === 0 && lens[2] === 0 && lens[3] > 0) out.push(lens[3]);
      }
    }
  }
  return out.filter((w) => w > 0);
}

const firstColour = (text) => { for (const tok of splitTop(text, " ")) { const c = parseColour(tok); if (c) return c; } return null; };
const isDark = (text) => { const c = firstColour(text); return !!c && luminance(c) < 0.12; };

function styleGate(css = "", doc = css) {
  css = String(css); doc = String(doc);
  const decls = cssDecls(css);
  // Svg presentation attributes count like declarations (<text font-weight="900" font-style="italic" ...>).
  for (const m of doc.matchAll(/\s(font-weight|font-style|font-family|font-stretch|transform)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) decls.push([m[1].toLowerCase(), (m[2] ?? m[3]).slice(0, 2000)]);
  const miss = [];
  // 1. A slant: a skew of 3 degrees or more, or an italic (custom properties resolved).
  const skew = decls.some(([p, v]) => /^(-webkit-)?transform$/.test(p) && [...v.matchAll(/skew[xy]?\(\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*(deg|rad|turn|grad)?/gi)]
    .some((m) => Math.abs(parseFloat(m[1])) * { deg: 1, rad: 57.3, turn: 360, grad: 0.9 }[(m[2] || "deg").toLowerCase()] >= 3));
  const italic = decls.some(([p, v]) => (p === "font-style" && /^(italic|oblique)\b/i.test(v)) || (p === "font" && /(^|\s)(italic|oblique)(\s|$)/i.test(v)));
  if (!skew && !italic) miss.push(STYLE_MISS.slant);
  // 2 and 7. Borders: some 3 px or more (chunky); only thin ones, or thin strokes and no fills, is the sci-fi line look.
  const borders = borderWidths(decls);
  const strokes = [...doc.matchAll(/stroke-width\s*[:=]\s*["']?\s*(\d*\.?\d+)/gi)].map((m) => parseFloat(m[1])).filter((w) => w > 0);
  const chunky = borders.some((w) => w >= 3);
  const thin = borders.length ? !chunky : strokes.length > 0 && strokes.every((w) => w < 3) && !/(linear|radial|conic)-gradient\(/i.test(css);
  if (!chunky) miss.push(STYLE_MISS.chunky);
  // 3. Heavy weight (bold or 700+).
  if (!decls.some(([p, v]) => (p === "font-weight" && /^(bold|bolder|[7-9]00|1000)\b/i.test(v)) || (p === "font" && /(^|\s)(bold|bolder|[7-9]00)(\s|$)/i.test(v)))) miss.push(STYLE_MISS.heavy);
  // 4. A dark text outline: a text-shadow layer or a text-stroke in a dark colour (a neon glow is not one).
  const outline = decls.some(([p, v]) => (p === "text-shadow" && splitTop(v, ",").some(isDark)) || (/^(-webkit-)?text-stroke(-color)?$/.test(p) && isDark(v)));
  if (!outline) miss.push(STYLE_MISS.outline);
  // 5. At least two rarity colour families (gold, purple, blue) among the colours used anywhere.
  const families = new Set();
  for (const m of doc.matchAll(COLOUR_RE)) { const c = parseColour(m[0]); const f = c && rarityFamily(c); if (f) families.add(f); }
  if (families.size < 2) miss.push(STYLE_MISS.rarity);
  // 6. A condensed heavy font stack.
  const fonts = decls.filter(([p]) => p === "font-family" || p === "font" || p === "font-stretch").map(([, v]) => v).join(" ");
  if (!/condensed|impact|bebas|oswald|anton|league gothic|arial narrow|haettenschweiler|compacta|knockout/i.test(fonts)) miss.push(STYLE_MISS.font);
  if (thin) miss.push(STYLE_MISS.thin);
  return { score: STYLE_OF - miss.length, of: STYLE_OF, missing: miss, italic };
}

// The answer is refused when it misses 3 or more checks, or the thin-line check plus any other.
const styleRejects = (style) => style.missing.length >= 3 || (style.missing.includes(STYLE_MISS.thin) && style.missing.length >= 2);

function validateHtml(html, { allowedActions, layout } = {}) {
  const errors = [], warnings = [];
  if (typeof html !== "string" || !html.trim()) return { ok: false, errors: ["empty"], warnings, controls: [], bytes: 0, style: { score: 0, of: STYLE_OF, missing: Object.values(STYLE_MISS), italic: false } };
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_HTML_BYTES) errors.push(`too large: ${bytes} bytes`);
  const doc = html.replace(/<!--[\s\S]*?-->/g, "");
  const { controls: drawn, allowed } = cleanLayout(layout || { buttons: [] }, allowedActions);
  const allowedAll = allowedActions && allowedActions.length ? new Set(allowedActions.map((a) => Contract.normaliseAction(a))) : allowed;

  // Scripts: no src, classic scripts only, and the deny list on their text.
  if (/<script\b[^>]*\bsrc\s*=/i.test(doc)) errors.push("<script src>");
  const opens = (doc.match(/<script\b/gi) || []).length, closes = (doc.match(/<\/script\s*>/gi) || []).length;
  if (opens !== closes) errors.push("unclosed <script>");
  if ((doc.match(/<style\b/gi) || []).length !== (doc.match(/<\/style\s*>/gi) || []).length) errors.push("unclosed <style>");
  const scripts = [];
  doc.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => (scripts.push({ attrs: attrsOf(attrs), body }), ""));
  for (const s of scripts) {
    if (s.attrs.type && !/^(text|application)\/javascript$/i.test(s.attrs.type)) errors.push(`script type ${s.attrs.type.slice(0, 20)}`);
    for (const [re, what] of JS_DENY) if (re.test(s.body)) errors.push(`script uses ${what}`);
    s.body.replace(/\bgame\s*\.\s*(press|release|axis)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/g, (m, fn, q, action) => {
      if (!q) errors.push(`game.${fn} with a computed action`);
      else if (!allowedAll.has(action) || (fn === "axis") !== STICKS.includes(action)) errors.push(`game.${fn}("${action.slice(0, 20)}") not allowed`);
      return "";
    });
  }
  const markup = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  if (/<[^>]+\son[a-z]+\s*=/i.test(markup)) errors.push("inline event handler attribute");
  const badTag = BAD_TAGS.exec(markup);
  if (badTag) errors.push(`<${badTag[1].toLowerCase()}> not allowed`);
  for (const m of markup.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = attrsOf(m[1]);
    if (a["http-equiv"] != null) errors.push("<meta http-equiv>");
    else if (!("charset" in a) && !/^(viewport|color-scheme|description)$/i.test(a.name || "")) errors.push(`<meta ${(a.name || "").slice(0, 20)}>`);
  }
  for (const m of markup.matchAll(URL_ATTRS)) {
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    if (!SAFE_URL.test(value)) errors.push(`${m[1].toLowerCase()}="${value.slice(0, 30)}"`);
  }
  if (/(java|vb)script\s*:|data\s*:\s*text\/html/i.test(doc)) errors.push("script URL");
  if (/\b(?:https?|wss?|ftp):\/\//i.test(doc.replace(SVG_NAMESPACES, ""))) errors.push("network URL");
  const css = [...doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join("\n") +
    [...markup.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3]).join("\n");
  for (const [re, what] of CSS_DENY) if (re.test(css)) errors.push(`css ${what}`);
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) if (!SAFE_URL.test(m[2])) errors.push(`css url(${m[2].slice(0, 30)})`);
  for (const m of markup.matchAll(/\b(?:fill|stroke|filter|mask|clip-path|marker-(?:start|mid|end))\s*=\s*["']\s*url\(\s*['"]?([^'")]*)/gi)) if (!SAFE_URL.test(m[1])) errors.push(`svg url(${m[1].slice(0, 30)})`);

  // Controls: every data-action / data-stick, all allowed, and every drawn action present.
  const controls = [];
  for (const m of markup.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const a = attrsOf(m[2]);
    if (a["data-stick"] == null && a["data-action"] == null) continue;
    const stick = a["data-stick"] != null;
    const action = String(stick ? a["data-stick"] : a["data-action"]).trim().toLowerCase();
    const kind = stick ? "stick" : a["data-toggle"] != null ? "toggle" : "button";
    if (!allowedAll.has(action)) errors.push(`action "${action.slice(0, 24)}" not allowed`);
    else if (stick !== STICKS.includes(action)) errors.push(stick ? `stick "${action}" must be steer or move` : `"${action}" must be a data-stick`);
    controls.push({ action, kind, label: String(a["data-label"] || "").trim().toUpperCase().slice(0, 24) });
  }
  if (!controls.length) errors.push("no controls");
  if (controls.length > 24) errors.push(`too many controls: ${controls.length}`);
  for (const c of drawn) if (!controls.some((k) => k.action === c.action)) errors.push(`missing control: ${c.action}`);
  if (controls.some((c) => c.kind === "stick") && !/\bdata-knob\b/i.test(markup)) warnings.push("stick without data-knob");
  if (!/<style\b/i.test(doc) && !/\sstyle\s*=/i.test(markup)) errors.push("no styles");
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, controls, bytes, style: styleGate(css, doc) };
}

// ---- Prompt ----------------------------------------------------------------------------------------------------------

const INSTRUCTIONS = `You write the touch controller for one player of SPACE PARTY, a multiplayer sci-fi party game played on phones held in LANDSCAPE. The player drew their controller on paper or on the phone; you get the picture of the drawing and the controls the game already read from it (action, label, rarity colour and where each one was drawn). Turn it into ONE self-contained HTML document: a bold, chunky, FORTNITE-STYLE game controller that keeps the player's layout.

THE PAGE
- It is shown in a full-screen TRANSPARENT frame ON TOP of the live 3D game. html and body backgrounds stay transparent and nothing covers the screen with a solid or dark fill: only the controls are visible.
- The frame is the whole play area (about 800 x 390 CSS px on an iPhone, but any size). Position every control absolutely in vw / vh units, never in fixed pixel positions.
- No external resources at all: no <script src>, no <link>, no <img> except data: URIs (prefer inline SVG), no web fonts (system fonts only, see LOOK), no network, no storage, no cookies, no iframes, no forms or inputs, no links, no navigation, no alerts. Never mention parent, top, opener, postMessage, fetch, XMLHttpRequest, WebSocket, import, eval, location, localStorage.

INPUT IS HANDLED FOR YOU
- The game injects a kit that handles every touch: multi-touch, analog sticks, toggles and pressed states. Do NOT write pointer, touch, mouse, click or key handlers, and no inline on* attributes.
- Mark each control declaratively:
  - Button: an element with data-action="<action>" and data-label="<LABEL>", e.g. <div class="btn" data-action="shoot" data-label="FIRE">...</div>.
  - Toggle (type toggle): the same plus the data-toggle attribute.
  - Stick (type stick): an element with data-stick="steer" or data-stick="move" that contains exactly one child with the data-knob attribute. The kit moves the knob with the CSS translate property: centre the knob with left/top or margins, never with translate.
- The kit sets classes; style every one: .is-down (held), .is-on (toggle on), .is-disabled (dimmed; a default exists). Dragged sticks get --x and --y (-1..1).
- Use EXACTLY the action ids listed below, one control per entry, nothing added, dropped or renamed.

LOOK: FORTNITE (chunky, bold, slanted, playful). NOT a thin sci-fi HUD.
Picture Fortnite's mobile buttons: fat, solid, saturated, cartoony, easy to hit with a thumb. Every control is a big SOLID filled shape.
- Tiles: slanted with transform: skewX(-9deg) (a button drawn round stays a round disc). A thick 3-4 px WHITE border, rounded corners, a vertical rarity-colour gradient fill, a light inner highlight on top (inset 0 3px 0 #ffffff80) and a HARD dark drop shadow under it (box-shadow: 0 5px 0 #0b1033, no blur), so every button reads as a chunky solid tile. Slightly see-through (opacity about 0.92) so the game shows around them.
- Rarity colours: gold (#ffe36e to #ffb21f to #d26a06) for weapons (shoot, blast, drill, mine); purple (#d49bff to #9d4dff to #5a1bc4) for powers (shield, invisible, teleport, heal, scan, flare, grapple, shapeshift, emp, inkbomb, tractor, decoy); blue (#86dcff to #2f8bff to #1647c8) for moving and everything else. The control list below names each rarity. A toggle turns gold when on.
- Labels: heavy condensed ITALIC capitals: font-style: italic; font-weight: 900; text-transform: uppercase; letter-spacing about 0.04em; 16-26 px; white with a dark #0b1033 outline (text-shadow on all four sides plus a soft drop). The frame cannot load web fonts, so use exactly this font stack: "Futura-CondensedExtraBold","Futura Condensed ExtraBold","AvenirNextCondensed-Heavy","Avenir Next Condensed","Arial Narrow",Impact,sans-serif. The tile is skewed, so put its icon and label in one inner element with transform: skewX(9deg): the letters stay clean and their italic is their only slant.
- Use the player's own word from the label (or the action name when the label is empty). Add a chunky white SVG icon that fits the action (stroke-width 3 or more, same dark drop shadow: filter: drop-shadow(0 2px 0 #0b1033)): crosshair (shoot), double chevron (boost), shield (shield), drill bit (drill), legs touching a line (land), shovel (dig), radar arcs (scan), sun (flare), lightning bolt (emp), horseshoe magnet (tractor), spiked ball (mine), ink drop with splats (inkbomb), a small ship with a dashed copy (decoy), arrows for movement. With no word written, write the skill the way players say it: INK BOMB for inkbomb, EMP, TRACTOR, MINE, DECOY.
- Sticks: a round base (4 px white rim, dark translucent fill, four chunky white chevrons near the rim) with a big glossy knob of about 40% of the base (3 px white rim, blue gradient, hard dark drop shadow). The base diameter is the smaller side of its rectangle and at least 110 px.
- NOT thin sci-fi lines: no border or stroke under 3 px on a control, no 1-2 px neon outlines, no wireframe or HUD-frame look, no glow-only outlines, no hairlines, no thin cyan line art, no empty see-through frames. Solid, fat, bright.
- Motion: every control pops in once when the page appears (keyframes on opacity and the CSS scale property only: from about 0.35 over 1.07 to 1 in about 0.45 s, staggered by about 50 ms; never animate transform or translate, the skew and the kit's own moves use them). .is-down sinks a button (translate: 0 4px; scale: .95; shorter shadow; brighter) and it bounces back on release (overshoot easing). Nothing animates forever.
- Nothing overlaps: labels, icons, chevrons and the knob each keep clear space. A stick label is optional; if you add one put it on the knob.
- Echo the drawing: a button drawn round is a round disc, a square one a square tile, a star a star, arrows look like arrows, a joystick is a round base with a knob.
- Touch: every button at least 64 x 64 CSS px (use max(64px, ...)); keep every control fully on screen (use clamp() on its centre).
- The TOP BAND belongs to the game's HUD (health, tools, objective, timer, score, radar): define --hud: ${HUD_BAND} on :root and clamp every control's centre so its TOP EDGE stays below it (top: clamp(min(calc(var(--hud) + half its height), calc(100vh - half its height)), centre, calc(100vh - half its height)): the min() keeps a very tall control fully on screen). Nothing is drawn, faded or tinted in that band.
- Layout: centre each control on the centre of the rectangle where the player drew it, with left/top plus negative half-size margins (transform stays free for the skew). Rectangles are fractions of the drawing (x, y = top left; w, h = size) and the drawing maps onto the whole frame, so centre = left (x + w/2) * 100vw, top (y + h/2) * 100vh. Keep the player's relative sizes; grow small controls to the minimum.
- iPhone performance over a 3D game: no backdrop-filter, no blur filters on large areas. Keep the whole document under 10 KB.
- A <script> is optional and only for cosmetics; it must never handle input or call the game.

OUTPUT: only the HTML document, starting with <!doctype html>. No markdown fences, no explanations.`;

function layoutText(controls, style) {
  const lines = controls.map((c, i) => `${i + 1}. type ${c.type}, action "${c.action}", label "${c.label}"${c.type === "stick" ? "" : `, rarity ${tierOf(c.action)}`}, x ${c.x}, y ${c.y}, w ${c.w}, h ${c.h}` +
    ` (centre ${fix((c.x + c.w / 2) * 100)}vw ${fix((c.y + c.h / 2) * 100)}vh)`);
  return [
    "Controls read from the drawing (rectangles as fractions of the drawing):",
    ...lines,
    `Stick knob colour: ${(style && style.accent) || ACCENT}.`,
    "Style: Fortnite (chunky slanted tiles, 3-4 px white borders, italic 900 capitals with a dark outline, rarity gradients, hard drop shadows), NOT thin sci-fi lines.",
    "Write the controller now.",
  ].join("\n");
}

function buildRequest(controls, image, style, useTier = true) {
  const content = [{ type: "input_text", text: layoutText(controls, style) }];
  if (image) content.push({ type: "input_image", image_url: image, detail: "low" });
  const req = {
    model: modelName(),
    instructions: INSTRUCTIONS,
    input: [{ role: "user", content }],
    reasoning: { effort: process.env.ASTRA_HTML_EFFORT || DEFAULT_EFFORT },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
  };
  const tier = process.env.OPENAI_SERVICE_TIER ?? DEFAULT_TIER;
  if (useTier && !defaultTierOnly && tier && tier !== "none") req.service_tier = tier;
  return req;
}

// ---- Network -------------------------------------------------------------------------------------------------------

function extractText(data) {
  if (!data || typeof data !== "object") throw new Error("empty response");
  if (data.status === "incomplete") throw new Error(`incomplete: ${(data.incomplete_details && data.incomplete_details.reason) || "unknown"}`);
  let text = "";
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && part.type === "refusal") throw new Error("model refused");
      if (part && part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  if (!text && typeof data.output_text === "string") text = data.output_text;
  if (!text) throw new Error("no output_text in response");
  return text;
}

// The document out of the answer: fences dropped, from <!doctype or <html to </html>.
// Sol is told to define --hud on :root. If its document uses var(--hud) without defining it, every clamp() on it is
// invalid and its controls fall to top:auto: define it for Sol (the template's band) at the top of the head.
function ensureHud(html) {
  if (typeof html !== "string" || !/var\(\s*--hud\b/.test(html) || /--hud\s*:/.test(html)) return html;
  const tag = `<style>:root{--hud:${HUD_BAND}}</style>`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const style = html.search(/<style\b/i);
  return style >= 0 ? html.slice(0, style) + tag + html.slice(style) : html;
}

function extractHtml(text) {
  let body = String(text).trim();
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(body);
  if (fenced) body = fenced[1].trim();
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) throw new Error("no HTML document in the answer");
  body = body.slice(start);
  const end = body.toLowerCase().lastIndexOf("</html>");
  return end >= 0 ? body.slice(0, end + 7) : body;
}

function logCall(entry) {
  const file = process.env.ASTRA_HTML_CALL_LOG;
  if (!file) return;
  try { fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n"); } catch {}
}

async function post(req, key, signal) {
  return fetchImpl(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
}

async function callModel(controls, image, style, signal) {
  const key = apiKey();
  if (!key) throw new Error("no OPENAI_API_KEY");
  let req = buildRequest(controls, image, style);
  const t0 = Date.now();
  // One HTTP request = one log line, whatever happens to it (a recording run counts these lines against its call cap).
  const send = async (r) => {
    try { return await post(r, key, signal); } catch (err) {
      logCall({ ms: Date.now() - t0, tier: r.service_tier || null, outcome: `no response: ${String((err && err.message) || err).slice(0, 80)}` });
      throw err;
    }
  };
  let res = await send(req);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logCall({ status: res.status, ms: Date.now() - t0, tier: req.service_tier || null, outcome: "http error" });
    // Only an error that NAMES the tier is a tier problem: a bad image, format or reasoning setting fails the same on
    // any tier, so it must not switch the fast tier off. Retry once without the tier, and remember "default tier only"
    // when (and only when) that retry works.
    const tierProblem = res.status >= 400 && res.status < 500 && req.service_tier && /service[_ ]tier|ultrafast|\btiers?\b/i.test(text);
    if (!tierProblem) throw new Error(`OpenAI HTTP ${res.status}`);
    const refused = { tier: req.service_tier, status: res.status };
    req = buildRequest(controls, image, style, false);
    res = await send(req);
    if (!res.ok) { logCall({ status: res.status, ms: Date.now() - t0, tier: null, outcome: "http error" }); throw new Error(`OpenAI HTTP ${res.status}`); }
    defaultTierOnly = true;
    console.log(`astra-html: service tier ${refused.tier} rejected (HTTP ${refused.status}) and the default tier works; using the default tier from now on`);
  }
  const data = await res.json().catch(() => null);
  if (!data) { logCall({ status: res.status, ms: Date.now() - t0, tier: req.service_tier || null, outcome: "bad response: not JSON" }); throw new Error("bad response: not JSON"); }
  const usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens, reasoning: data.usage.output_tokens_details && data.usage.output_tokens_details.reasoning_tokens } : null;
  try {
    const html = extractHtml(extractText(data));
    logCall({ status: res.status, ms: Date.now() - t0, tier: req.service_tier || null, bytes: Buffer.byteLength(html), usage, outcome: "html" });
    return { html, usage };
  } catch (err) {
    logCall({ status: res.status, ms: Date.now() - t0, tier: req.service_tier || null, usage, outcome: err.message });
    throw err;
  }
}

// ---- Main ------------------------------------------------------------------------------------------------------------

const templateResult = (controls, allowed, style, ms, error) => {
  const html = templateHtml({ buttons: controls }, { allowedActions: [...allowed], style });
  const check = validateHtml(html, { allowedActions: [...allowed] });
  return { ok: true, html, controls: check.controls, source: "template", ms, bytes: Buffer.byteLength(html), style: check.style, ...(error ? { error } : {}) };
};

async function generateControllerHtml({ image, layout, allowedActions, style, signal, timeoutMs: perCallTimeout, player } = {}) {
  const t0 = Date.now();
  const { controls, allowed, dropped } = cleanLayout(layout, allowedActions);
  if (!controls.length) return { ok: false, error: dropped.length ? `no allowed controls (${dropped.join(", ")})` : "layout has no controls" };
  const img = typeof image === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(image) && image.length <= MAX_IMAGE_CHARS ? image : null;
  const accent = hexRgb(style && style.accent) ? style.accent : ACCENT;
  const log = (r) => console.log(`astra-html ${Contract.cleanName(player) || "-"} ${r.source} ${r.ms}ms ${r.bytes}B style ${r.style.score}/${r.style.of}${r.error ? ` (${r.error})` : ""}`);
  if (process.env.ASTRA_MOCK === "1") { const r = templateResult(controls, allowed, { accent }, Date.now() - t0, "mock"); log(r); return r; }
  if (signal && signal.aborted) return templateResult(controls, allowed, { accent }, 0, "aborted");

  const gen = roundGen;
  const key = sha1(JSON.stringify([img ? sha1(img) : "", controls, [...allowed].sort(), accent, ...(gen ? [gen] : [])]));
  const cached = cache.get(key);
  if (cached) return { ...cached, ms: Date.now() - t0 };

  let entry = inflight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, owners: 0, timedOut: false };
    const timer = setTimeout(() => ((entry.timedOut = true), controller.abort()), perCallTimeout || timeoutMs);
    entry.promise = (async () => {
      try {
        const html = ensureHud((await callModel(controls, img, { accent }, controller.signal)).html);
        const check = validateHtml(html, { allowedActions: [...allowed], layout: { buttons: controls } });
        if (!check.ok) return templateResult(controls, allowed, { accent }, 0, `rejected: ${check.errors.slice(0, 4).join("; ")}`);
        // Valid but not Fortnite (a thin-line sci-fi HUD...): the template has the look the owner asked for. Mild misses
        // only warn.
        if (styleRejects(check.style)) return templateResult(controls, allowed, { accent }, 0, `rejected: style (${check.style.missing.join(", ")})`);
        const warnings = [...check.warnings, ...check.style.missing.map((m) => `style: ${m}`), ...(check.style.italic ? [] : ["style: no italic labels"])];
        const result = { ok: true, html, controls: check.controls, source: "model", ms: 0, bytes: check.bytes, style: check.style, ...(warnings.length ? { warnings } : {}) };
        if (gen === roundGen) cache.set(key, result); // v1.5: never an earlier round's answer in this round's cache
        if (cache.size > 64) cache.delete(cache.keys().next().value);
        return result;
      } catch (err) {
        return templateResult(controls, allowed, { accent }, 0, entry.timedOut ? "timeout" : String((err && err.message) || err));
      } finally {
        clearTimeout(timer);
        if (inflight.get(key) === entry) inflight.delete(key);
      }
    })();
    inflight.set(key, entry);
  }
  entry.owners++;
  let onAbort = null;
  const aborted = signal ? new Promise((resolve) => {
    onAbort = () => resolve(templateResult(controls, allowed, { accent }, 0, "aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  }) : null;
  const result = await (aborted ? Promise.race([entry.promise, aborted]) : entry.promise);
  if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  entry.owners--;
  if (entry.owners <= 0 && signal && signal.aborted && inflight.get(key) === entry) entry.controller.abort(); // nobody waits any more
  const out = { ...result, ms: Date.now() - t0 };
  log(out);
  return out;
}

const _internals = {
  setFetch: (fn) => (fetchImpl = fn),
  setTimeoutMs: (ms) => (timeoutMs = ms),
  reset: () => { roundGen = 0; cache.clear(); inflight.clear(); defaultTierOnly = false; warnedModel = false; timeoutMs = Number(process.env.ASTRA_HTML_TIMEOUT_MS) || TIMEOUT_MS; },
  state: () => ({ cache: cache.size, inflight: inflight.size, defaultTierOnly, warnedModel }),
  INSTRUCTIONS, ICONS, MAX_HTML_BYTES, MIN_TOUCH_PX, MIN_VISUAL_PX, MIN_STICK_PX, STYLE_MISS, TIER_OF, cleanLayout, buildRequest, layoutText, extractText, extractHtml, attrsOf,
  modelName, styleGate, styleRejects, tierOf,
};

module.exports = { generateControllerHtml, templateHtml, validateHtml, newRound, _internals };
